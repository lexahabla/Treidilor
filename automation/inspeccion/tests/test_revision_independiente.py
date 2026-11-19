# -*- coding: utf-8 -*-
"""Regresión de la revisión independiente (R1–R5): publicación solo con resultado auditado, correspondencia por identificador único,
límites propios del colector, integridad del historial de auditoría y filtrado/habilitación de comprobaciones sensibles.
Datos simulados; no usan red ni credenciales."""
import json
import os
import re
import unittest

import helpers as H
from tai_inspect import ancla, config, fsattr, informe
from tai_inspect import collector as col_mod
from tai_inspect.audit import Audit
from tai_inspect.collector import Colector
from tai_inspect.gate import OK, SIN_RESPUESTA, Gate
from tai_inspect.pathsafe import atomic_write

AJUSTES = {"servicio_n8n": None, "servicio_runner": None, "servicio_postgres": None, "servicios_registros": [], "tablas_agentes": [],
           "plantillas_registro": []}
CANNED = {"docker_node_ls": H.NODE_LS, "docker_network_ls": H.NET_LS, "docker_df": H.DF}
HEX32 = re.compile(r"[0-9a-f]{32}")


class AuditFalla(object):
    """Registro real que puede fallar (disco lleno, permisos…) para eventos concretos."""

    def __init__(self, real, falla=None):
        self.real, self.falla, self.eventos = real, falla or (lambda ev: False), []

    def log(self, evento, **campos):
        if self.falla(evento):
            raise OSError(28, "No space left on device")
        self.eventos.append((evento, campos.get("resultado")))
        return self.real.log(evento, **campos)


def montar(enabled=("docker-nodos", "docker-redes"), falla=None, canned=None, max_daily=60, max_pending=5, ajustes=None):
    ent, reloj = H.Entorno(), H.Reloj()
    runner = H.RunnerFalso(CANNED if canned is None else canned)
    audit = AuditFalla(Audit(ent.col_log, now=reloj.now), falla)
    col = Colector(ent.req, ent.rep, runner, set(enabled), ajustes or AJUSTES, audit, now=reloj.now, install_dir=ent.raiz, root=ent.raiz,
                   staging_dir=ent.staging, state_dir=ent.cstate, gate_audit_path=ent.gate_log, max_daily=max_daily, max_pending=max_pending)
    return col, ent, runner, audit, reloj


def peticion(ent, check="docker-nodos", idp=None):
    idp = idp or os.urandom(16).hex()
    with open(os.path.join(ent.req, idp + ".req"), "wb") as f:
        f.write(json.dumps({"check": check, "v": 1}).encode())
    return idp


class R1PublicacionSoloConResultadoAuditado(unittest.TestCase):
    def test_disco_lleno_al_preparar_el_informe_no_publica_nada(self):
        col, ent, runner, audit, _ = montar()
        original = col_mod.write_exclusive
        try:
            def lleno(path, datos, mode=0o640):
                raise OSError(28, "No space left on device")
            col_mod.write_exclusive = lleno
            peticion(ent)
            col.procesar()
            self.assertEqual(os.listdir(ent.rep), [])
            self.assertEqual(os.listdir(ent.staging), [])
            self.assertIn(("colector_resultado", "escritura_fallida"), audit.eventos)
            self.assertNotIn("colector_publicacion", [e[0] for e in audit.eventos])
        finally:
            col_mod.write_exclusive = original
            ent.limpiar()

    def test_si_el_resultado_no_se_puede_registrar_no_se_publica_y_la_peticion_se_conserva(self):
        col, ent, runner, audit, _ = montar(falla=lambda ev: ev == "colector_resultado")
        try:
            idp = peticion(ent)
            col.procesar()
            self.assertEqual(os.listdir(ent.rep), [], "sin resultado registrado no hay informe disponible")
            self.assertEqual(os.listdir(ent.staging), [], "el informe preparado se retira")
            self.assertEqual(os.listdir(ent.req), [idp + ".req"], "la petición se conserva para reintentarla")
        finally:
            ent.limpiar()

    def test_el_informe_anterior_no_se_sustituye_si_falla_la_auditoria(self):
        col, ent, runner, audit, _ = montar(falla=lambda ev: ev == "colector_resultado")
        try:
            viejo = os.path.join(ent.rep, "docker-nodos.json")
            with open(viejo, "wb") as f:
                f.write(b'{"viejo":true}')
            peticion(ent)
            col.procesar()
            with open(viejo, "rb") as f:
                self.assertEqual(f.read(), b'{"viejo":true}')
        finally:
            ent.limpiar()

    def test_interrupcion_antes_de_publicar_deja_solo_staging_y_se_limpia(self):
        col, ent, runner, audit, reloj = montar()
        original = os.replace
        try:
            def cae(src, dst):
                if os.path.dirname(dst) == ent.rep:
                    raise OSError(5, "Input/output error")
                return original(src, dst)
            os.replace = cae
            peticion(ent)
            col.procesar()
        finally:
            os.replace = original
        try:
            self.assertEqual(os.listdir(ent.rep), [], "la publicación atómica falló: nada visible")
            self.assertEqual(os.listdir(ent.staging), [])
            self.assertIn(("colector_publicacion", "fallida"), audit.eventos)
        finally:
            ent.limpiar()

    def test_resto_en_staging_tras_un_corte_nunca_se_publica(self):
        col, ent, runner, audit, _ = montar()
        try:
            resto = os.path.join(ent.staging, "a" * 32 + ".docker-nodos.json")
            with open(resto, "wb") as f:
                f.write(b'{"check":"docker-nodos","peticion":"' + b"a" * 32 + b'"}')
            col.procesar()
            self.assertEqual(os.listdir(ent.rep), [])
            self.assertEqual(os.listdir(ent.staging), [])
        finally:
            ent.limpiar()

    def test_al_publicar_el_resultado_ya_esta_en_la_auditoria(self):
        col, ent, runner, audit, _ = montar()
        original, vistos = os.replace, []
        try:
            def espia(src, dst):
                if os.path.dirname(dst) == ent.rep:
                    vistos.append([e["evento"] for e in ent.lineas_auditoria(ent.col_log)])
                return original(src, dst)
            os.replace = espia
            peticion(ent)
            col.procesar()
        finally:
            os.replace = original
        try:
            self.assertEqual(len(vistos), 1)
            self.assertIn("colector_resultado", vistos[0])
            self.assertNotIn("colector_publicacion", vistos[0], "la confirmación se escribe DESPUÉS de publicar")
            self.assertEqual([e["evento"] for e in ent.lineas_auditoria(ent.col_log) if e["evento"].startswith("colector_") and e["evento"] != "colector_ancla"],
                             ["colector_intencion", "colector_resultado", "colector_publicacion"])
        finally:
            ent.limpiar()

    def test_tras_una_caida_la_peticion_conservada_se_atiende_en_la_pasada_siguiente(self):
        col, ent, runner, audit, reloj = montar(falla=lambda ev: ev == "colector_resultado")
        try:
            peticion(ent)
            col.procesar()
            audit.falla = lambda ev: False
            reloj.t += 400                                  # pasa el intervalo mínimo propio del colector
            col.procesar()
            informes = os.listdir(ent.rep)
            self.assertEqual(informes, ["docker-nodos.json"])
            self.assertEqual(os.listdir(ent.req), [])
        finally:
            ent.limpiar()


def _gate(ent, reloj, responder=None, check="docker-nodos"):
    def dormir(s):
        if responder is not None:
            responder()
        reloj.sleep(s)
    audit = Audit(ent.gate_log, now=reloj.now)
    return Gate(set([check]), H.RunnerFalso(), AJUSTES, ent.req, ent.rep, ent.state, ent.disable, audit, now=reloj.now, sleep=dormir,
                wait=2, poll=0.5, root=ent.raiz)


def _escribir_informe(ent, reloj, check, peticion_id, avisos=None):
    cuerpo = informe.construir(check, {"nodos": []}, avisos or [], reloj.now(), 5, peticion=peticion_id)
    datos, _ = informe.finalizar(cuerpo, reloj.now())
    atomic_write(os.path.join(ent.rep, check + ".json"), datos, 0o640)
    return datos


class R2CorrespondenciaPorIdentificador(unittest.TestCase):
    def test_el_informe_lleva_el_identificador_de_su_peticion(self):
        col, ent, runner, audit, _ = montar()
        try:
            idp = peticion(ent)
            col.procesar()
            with open(os.path.join(ent.rep, "docker-nodos.json"), "rb") as f:
                self.assertEqual(json.loads(f.read().decode())["peticion"], idp)
        finally:
            ent.limpiar()

    def test_un_informe_de_error_tambien_lleva_el_identificador(self):
        col, ent, runner, audit, _ = montar(canned={})
        try:
            idp = peticion(ent)
            col.procesar()
            with open(os.path.join(ent.rep, "docker-nodos.json"), "rb") as f:
                rep = json.loads(f.read().decode())
            self.assertEqual(rep["peticion"], idp)
        finally:
            ent.limpiar()

    def test_un_informe_anterior_con_otro_identificador_no_se_entrega(self):
        ent, reloj = H.Entorno(), H.Reloj()
        try:
            _escribir_informe(ent, reloj, "docker-nodos", "0" * 32)      # existía ANTES de esta petición, aunque sea de hace un instante
            codigo = _gate(ent, reloj).handle("solicitar docker-nodos")[0]
            self.assertEqual(codigo, SIN_RESPUESTA)
        finally:
            ent.limpiar()

    def test_un_informe_generado_por_otra_peticion_concurrente_no_se_entrega(self):
        ent, reloj = H.Entorno(), H.Reloj()
        try:
            gate = _gate(ent, reloj, responder=lambda: _escribir_informe(ent, reloj, "docker-nodos", "f" * 32))
            self.assertEqual(gate.handle("solicitar docker-nodos")[0], SIN_RESPUESTA)
        finally:
            ent.limpiar()

    def test_con_el_identificador_correcto_se_entrega(self):
        ent, reloj = H.Entorno(), H.Reloj()
        try:
            def responde():
                for n in os.listdir(ent.req):
                    _escribir_informe(ent, reloj, "docker-nodos", n[:-4])
            gate = _gate(ent, reloj, responder=responde)
            self.assertEqual(gate.handle("solicitar docker-nodos")[0], OK)
        finally:
            ent.limpiar()

    def test_un_informe_de_otra_comprobacion_con_el_mismo_identificador_no_se_entrega(self):
        ent, reloj = H.Entorno(), H.Reloj()
        try:
            def responde():
                for n in os.listdir(ent.req):
                    cuerpo = informe.construir("docker-redes", {"redes": []}, [], reloj.now(), 5, peticion=n[:-4])
                    datos, _ = informe.finalizar(cuerpo, reloj.now())
                    atomic_write(os.path.join(ent.rep, "docker-nodos.json"), datos, 0o640)      # nombre de uno, contenido de otro
            gate = _gate(ent, reloj, responder=responde)
            self.assertEqual(gate.handle("solicitar docker-nodos")[0], SIN_RESPUESTA)
        finally:
            ent.limpiar()

    def test_el_identificador_es_aleatorio_y_estricto(self):
        ent, reloj = H.Entorno(), H.Reloj()
        try:
            vistos = []
            def espia():
                vistos.extend(os.listdir(ent.req))
            for _ in range(3):
                _gate(ent, reloj, responder=espia).handle("solicitar docker-nodos")
                reloj.t += 1000
                for n in os.listdir(ent.state):
                    os.unlink(os.path.join(ent.state, n))
            nombres = set(vistos)
            self.assertEqual(len(nombres), 3, "tres peticiones, tres identificadores distintos")
            for n in nombres:
                self.assertTrue(n.endswith(".req") and HEX32.fullmatch(n[:-4]))
        finally:
            ent.limpiar()

    def test_el_gate_ya_no_empareja_por_fecha(self):
        fuente = open(os.path.join(H.RAIZ, "tai_inspect", "gate.py"), encoding="utf-8").read()
        self.assertNotIn("calendar", fuente)
        self.assertNotIn("_epoch", fuente)
        self.assertIn('rep.get("peticion") == idp', fuente)


class R3LimitesPropiosDelColector(unittest.TestCase):
    def test_el_cupo_diario_se_aplica_aunque_las_peticiones_no_pasen_por_el_gate(self):
        col, ent, runner, audit, _ = montar(enabled=("docker-nodos", "docker-redes", "docker-disco"), max_daily=2)
        try:
            for c in ("docker-nodos", "docker-redes", "docker-disco"):
                peticion(ent, c)
            col.procesar()
            ejecutadas = [e for e in audit.eventos if e[0] == "colector_resultado" and e[1] not in ("limite_diario", "intervalo_minimo")]
            self.assertEqual(len(ejecutadas), 2, "solo dos ejecuciones: el resto se descarta")
            self.assertIn(("colector_resultado", "limite_diario"), audit.eventos)
            self.assertEqual(os.listdir(ent.req), [])
        finally:
            ent.limpiar()

    def test_el_intervalo_minimo_se_aplica(self):
        col, ent, runner, audit, reloj = montar()
        try:
            peticion(ent)
            col.procesar()
            reloj.t += 5
            peticion(ent)
            col.procesar()
            n1 = len(runner.llamadas)
            self.assertGreater(n1, 0)
            self.assertIn(("colector_resultado", "intervalo_minimo"), audit.eventos)
            reloj.t += 400
            peticion(ent)
            col.procesar()
            self.assertEqual(len(runner.llamadas), 2 * n1, "tras el intervalo se ejecuta de nuevo; antes no se había ejecutado")
        finally:
            ent.limpiar()

    def test_un_estado_manipulado_se_ignora_sin_romper_nada(self):
        col, ent, runner, audit, _ = montar()
        try:
            for contenido in (b"no es json", b'{"count": -5, "last": {}}', b'{"count": true, "last": {}}', b'{"count": 1, "last": []}', b"x" * 20000):
                with open(os.path.join(ent.cstate, "cuota.json"), "wb") as f:
                    f.write(contenido)
                for n in os.listdir(ent.cstate):
                    if n != "cuota.json":
                        os.unlink(os.path.join(ent.cstate, n))
                peticion(ent)
                col.procesar()
                self.assertIn("docker-nodos.json", os.listdir(ent.rep))
                os.unlink(os.path.join(ent.rep, "docker-nodos.json"))
        finally:
            ent.limpiar()

    def test_la_inundacion_de_peticiones_se_acota(self):
        col, ent, runner, audit, _ = montar(max_pending=5)
        try:
            total = config.MAX_PENDING_TOTAL + 10
            for i in range(total):
                idp = "%032x" % (i + 1)
                peticion(ent, "docker-nodos", idp)
                os.utime(os.path.join(ent.req, idp + ".req"), (1000 + i, 1000 + i))
            col.procesar()
            ejecutadas = [e for e in audit.eventos if e[0] == "colector_resultado" and e[1] not in ("limite_diario", "intervalo_minimo")]
            self.assertEqual(len(ejecutadas), 1, "el intervalo mínimo deja pasar una sola ejecución")
            restantes = len(os.listdir(ent.req))
            self.assertLessEqual(restantes, config.MAX_PENDING_TOTAL, "el exceso se descartó")
            self.assertEqual(sum(1 for e in audit.eventos if e == ("peticion_descartada", "exceso_de_peticiones")), 10)
        finally:
            ent.limpiar()

    def test_una_peticion_para_una_comprobacion_del_gate_o_inexistente_se_descarta(self):
        col, ent, runner, audit, _ = montar(enabled=("docker-nodos", "host-recursos"))
        try:
            peticion(ent, "host-recursos")
            peticion(ent, "../../etc/passwd")
            peticion(ent, "no-existe")
            col.procesar()
            self.assertEqual(runner.llamadas, [])
            self.assertEqual(os.listdir(ent.req), [])
            self.assertEqual(os.listdir(ent.rep), [])
        finally:
            ent.limpiar()


class R4IntegridadDelHistorial(unittest.TestCase):
    def _registro(self, n=5):
        ent, reloj = H.Entorno(), H.Reloj()
        a = Audit(ent.gate_log, now=reloj.now)
        for i in range(n):
            a.log("gate_intencion", check="host-recursos", resultado="x")
        return ent, reloj, a

    def test_seq_es_correlativo_y_el_llamante_no_puede_fijarlo(self):
        ent, reloj, a = self._registro(0)
        try:
            a.log("a", resultado="x", seq=99)
            a.log("b", resultado="x", seq=1)
            self.assertEqual([l["seq"] for l in ent.lineas_auditoria(ent.gate_log)], [1, 2])
        finally:
            ent.limpiar()

    def test_un_registro_intacto_se_ancla_y_admite_lineas_nuevas(self):
        ent, reloj, a = self._registro()
        try:
            v1 = ancla.verificar(ent.gate_log, None)
            self.assertTrue(v1["ok"])
            a.log("gate_intencion", resultado="x")
            v2 = ancla.verificar(ent.gate_log, v1["ancla"])
            self.assertTrue(v2["ok"])
            self.assertEqual(v2["ancla"]["seq"], 6)
        finally:
            ent.limpiar()

    def _reescribir(self, ent, fn):
        with open(ent.gate_log, "rb") as f:
            lineas = f.read().split(b"\n")[:-1]
        nuevas = fn(lineas)
        with open(ent.gate_log, "wb") as f:
            f.write(b"".join(l + b"\n" for l in nuevas))

    def test_modificar_el_historial_anclado_se_detecta(self):
        ent, reloj, a = self._registro()
        try:
            v = ancla.verificar(ent.gate_log, None)
            self._reescribir(ent, lambda ls: [ls[0].replace(b"x", b"y")] + ls[1:])
            self.assertEqual(ancla.verificar(ent.gate_log, v["ancla"])["motivo"], "historial_modificado")
        finally:
            ent.limpiar()

    def test_truncar_o_borrar_el_registro_se_detecta(self):
        ent, reloj, a = self._registro()
        try:
            v = ancla.verificar(ent.gate_log, None)
            self._reescribir(ent, lambda ls: ls[:2])
            self.assertEqual(ancla.verificar(ent.gate_log, v["ancla"])["motivo"], "registro_truncado")
            os.unlink(ent.gate_log)
            self.assertEqual(ancla.verificar(ent.gate_log, v["ancla"])["motivo"], "registro_ausente")
        finally:
            ent.limpiar()

    def test_borrar_una_linea_posterior_al_ancla_deja_un_hueco_de_secuencia(self):
        ent, reloj, a = self._registro()
        try:
            v = ancla.verificar(ent.gate_log, None)
            for _ in range(3):
                a.log("gate_intencion", resultado="x")
            self._reescribir(ent, lambda ls: ls[:6] + ls[7:])           # quita la línea 7
            self.assertEqual(ancla.verificar(ent.gate_log, v["ancla"])["motivo"], "secuencia_con_huecos")
        finally:
            ent.limpiar()

    def test_el_colector_conserva_el_ancla_previa_y_deja_alarma_cuando_hay_alteracion(self):
        col, ent, runner, audit, _ = montar()
        try:
            Audit(ent.gate_log, now=H.Reloj().now).log("gate_intencion", resultado="x")
            Audit(ent.gate_log, now=H.Reloj().now).log("gate_intencion", resultado="x")
            col.procesar()
            ruta = os.path.join(ent.cstate, "ancla-gate.json")
            with open(ruta, "rb") as f:
                antes = f.read()
            self.assertIn(("colector_ancla", "ok"), audit.eventos)
            self._reescribir(ent, lambda ls: [ls[0].replace(b"x", b"z")] + ls[1:])
            col.procesar()
            with open(ruta, "rb") as f:
                self.assertEqual(f.read(), antes, "la ancla anterior NO se sustituye por un historial alterado")
            self.assertIn(("colector_ancla", "historial_modificado"), audit.eventos)
        finally:
            ent.limpiar()

    def test_la_comprobacion_de_integridad_informa_del_estado_del_registro_del_gate(self):
        col, ent, runner, audit, _ = montar(enabled=("integridad-inspeccion",))
        try:
            Audit(ent.gate_log, now=H.Reloj().now).log("gate_intencion", resultado="x")
            col.procesar()
            self._reescribir(ent, lambda ls: [ls[0].replace(b"x", b"z")])
            col._anclar()
            from tai_inspect.checks import sistema
            datos, avisos = sistema.integridad(col._ctx())
            self.assertFalse(datos["registro_gate"]["ok"])
            self.assertIn("registro_gate_alterado", avisos)
            self.assertIn("registro_gate_sin_solo_anadir", avisos, "no se presupone chattr +a: sin comprobarlo se avisa")
        finally:
            ent.limpiar()

    def test_fsattr_solo_lee_y_no_presupone(self):
        self.assertIsNone(fsattr.solo_anadir(os.path.join(H.RAIZ, "no-existe-xyz")))
        fuente = open(os.path.join(H.RAIZ, "tai_inspect", "fsattr.py"), encoding="utf-8").read()
        self.assertNotIn("SETFLAGS", fuente)
        self.assertNotIn("subprocess", fuente)

    def test_la_auditoria_solo_se_abre_para_anadir(self):
        fuente = open(os.path.join(H.RAIZ, "tai_inspect", "audit.py"), encoding="utf-8").read()
        self.assertIn("O_APPEND", fuente)
        self.assertNotRegex(fuente, r"open\([^)]*[\"']w")


class R5FiltradoYHabilitacion(unittest.TestCase):
    def test_sin_validacion_las_comprobaciones_sensibles_siguen_deshabilitadas(self):
        ent = H.Entorno()
        try:
            ruta, val = os.path.join(ent.raiz, "enabled.json"), os.path.join(ent.raiz, "validaciones.json")
            with open(ruta, "w") as f:
                json.dump(sorted(config.CHECKS), f)
            habilitadas = config.load_enabled(ruta, val)
            self.assertEqual(habilitadas, set(n for n in config.CHECKS if not config.es_sensible(n)))
            self.assertEqual(len(config.SENSIBLES), 11)
            for mala in ('{"docker-nodos": {"muestra_sha256": "abc"}}', '{"docker-nodos": {}}', '{"docker-nodos": true}', "[]", "no json",
                         '{"docker-nodos": {"muestra_sha256": "' + "G" * 64 + '"}}', '{"inexistente": {"muestra_sha256": "' + "a" * 64 + '"}}'):
                with open(val, "w") as f:
                    f.write(mala)
                self.assertEqual(config.load_enabled(ruta, val), habilitadas, mala)
            with open(val, "w") as f:
                f.write('{"docker-nodos": {"muestra_sha256": "' + "a" * 64 + '"}}')
            self.assertEqual(config.load_enabled(ruta, val), habilitadas | {"docker-nodos"}, "se valida UNA sola; el resto sigue cerrado")
        finally:
            ent.limpiar()

    def test_el_colector_no_ejecuta_una_sensible_que_no_esta_habilitada(self):
        col, ent, runner, audit, _ = montar(enabled=("host-recursos",))
        try:
            peticion(ent, "docker-nodos")
            col.procesar()
            self.assertEqual(runner.llamadas, [])
        finally:
            ent.limpiar()

    def test_registros_solo_muestra_plantillas_validadas_y_nunca_datos_personales(self):
        crudo = ("2026-11-13T10:00:00Z Registered runner abc123def456\n"
                 "2026-11-13T10:00:01Z ERROR login failed for maria.perez@example.com from 198.51.100.77\n"
                 "2026-11-13T10:00:02Z token=ghp_" + "Q" * 36 + " refused\n"
                 "2026-11-13T10:00:03Z cliente Juan Gomez pidio el pedido 99887\n")
        ajustes = dict(AJUSTES, servicios_registros=["svc_worker"])
        col, ent, runner, audit, _ = montar(enabled=("registros-resumen",), canned={("docker_service_logs", "svc_worker"): crudo}, ajustes=ajustes)
        try:
            peticion(ent, "registros-resumen")
            col.procesar()
            with open(os.path.join(ent.rep, "registros-resumen.json"), "rb") as f:
                texto = f.read().decode()
            for prohibido in ("maria", "example.com", "198.51", "ghp_", "Juan", "Gomez", "99887"):
                self.assertNotIn(prohibido, texto)
            rep = json.loads(texto)
            serv = rep["datos"]["servicios"][0] if "datos" in rep else None
            if serv is not None:
                self.assertEqual(serv["mensajes_no_mostrados"], 3)
                self.assertEqual(len(serv["mensajes_frecuentes"]), 1)
        finally:
            ent.limpiar()

    def test_no_se_amplian_comandos_ni_permisos(self):
        """Tabla de comandos sin cambios respecto a la revisada: 17 especificaciones, solo estos siete ejecutables, ninguno es un intérprete."""
        from tai_inspect import runner
        self.assertEqual(len(config.CHECKS), 18)
        self.assertEqual(len(runner.SPECS), 17)
        permitidos = {"/usr/bin/ss", "/usr/bin/systemctl", "/usr/bin/apt", "/usr/bin/timedatectl", "/usr/bin/docker", "/usr/sbin/sshd", "/usr/bin/journalctl"}
        self.assertEqual(set(spec["argv"][0] for spec in runner.SPECS.values()), permitidos)
        fuente = open(os.path.join(H.RAIZ, "tai_inspect", "runner.py"), encoding="utf-8").read()
        self.assertNotIn("shell=True", fuente)


if __name__ == "__main__":
    unittest.main()
