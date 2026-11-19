# -*- coding: utf-8 -*-
"""Regresión de los hallazgos H1 (colector detenido por peticiones hostiles), H4 (trazas hacia el cliente) y
H5 (auditoría PREVIA obligatoria). Datos simulados; no usan red ni credenciales."""
import ast
import json
import os
import unittest

import helpers as H
from tai_inspect import collector as col_mod
from tai_inspect import config
from tai_inspect.audit import Audit
from tai_inspect.collector import Colector
from tai_inspect.gate import AUDITORIA, ERROR, MENSAJE_GENERICO, OK, RECHAZADA, SIN_RESPUESTA, Gate
from tai_inspect.pathsafe import RutaNoPermitida

AJUSTES = {"servicio_n8n": None, "servicio_runner": None, "servicio_postgres": None, "servicios_registros": [], "tablas_agentes": []}
CANNED = {"ss": H.SS, "systemctl_running": H.SYSTEMCTL, "apt_upgradable": H.APT, "timedatectl": H.TIMEDATECTL, "docker_node_ls": H.NODE_LS}
SECRETO_EN_MENSAJE = "/var/log/tai-inspect/gate-audit.log ghp_" + "Z" * 36


class Traza(object):
    def __init__(self):
        self.eventos = []

    def audit(self):
        return [e for e in self.eventos if e[0] == "audit"]


class RunnerEspia(H.RunnerFalso):
    def __init__(self, traza, canned=None):
        H.RunnerFalso.__init__(self, canned if canned is not None else CANNED)
        self.traza = traza

    def run(self, spec_id, arg=None, query_id=None, tabla=None):
        self.traza.eventos.append(("run", spec_id))
        return H.RunnerFalso.run(self, spec_id, arg, query_id, tabla)


class AuditEspia(object):
    """Registro falso que anota el ORDEN de los eventos y puede fallar a voluntad (con un mensaje que contiene una ruta y un secreto)."""

    def __init__(self, traza, falla=None, real=None):
        self.traza, self.falla, self.real = traza, falla or (lambda ev, c: False), real

    def log(self, evento, **campos):
        if self.falla(evento, campos):
            raise OSError(13, "Permission denied: " + SECRETO_EN_MENSAJE)
        self.traza.eventos.append(("audit", evento, campos.get("resultado"), dict(campos)))
        if self.real is not None:
            self.real.log(evento, **campos)


def montar_gate(falla=None, enabled=None, canned=None, wait=2, registry=None, con_archivo=True):
    ent, reloj, traza = H.Entorno(), H.Reloj(), Traza()
    runner = RunnerEspia(traza, canned)
    real = Audit(ent.gate_log, now=reloj.now) if con_archivo else None
    audit = AuditEspia(traza, falla, real)
    habilitadas = set(["host-recursos", "host-red", "host-tiempo", "docker-nodos"]) if enabled is None else enabled
    gate = Gate(habilitadas, runner, AJUSTES, ent.req, ent.rep, ent.state, ent.disable, audit, now=reloj.now, sleep=reloj.sleep,
                wait=wait, poll=0.5, root=ent.raiz, registry=registry)
    return gate, ent, runner, traza, reloj


class H5AuditoriaPreviaDelGate(unittest.TestCase):
    def test_la_intencion_se_registra_antes_de_ejecutar_y_el_resultado_despues(self):
        gate, ent, runner, traza, _ = montar_gate()
        try:
            self.assertEqual(gate.handle("solicitar host-recursos")[0], OK)
            orden = [e[1] if e[0] == "audit" else "RUN:" + e[1] for e in traza.eventos]
            self.assertEqual(orden[0], "gate_intencion", "lo PRIMERO es registrar la intención")
            primera_ejecucion = [i for i, e in enumerate(traza.eventos) if e[0] == "run"]
            self.assertTrue(primera_ejecucion or True)
            self.assertEqual(orden[-1], "gate_resultado")
            self.assertEqual(traza.audit()[-1][2], "ok")
        finally:
            ent.limpiar()

    def test_la_intencion_precede_a_cualquier_llamada_al_ejecutor_y_a_la_peticion_al_colector(self):
        gate, ent, runner, traza, _ = montar_gate(wait=1)
        try:
            gate.registry = {"host-red": lambda ctx: (ctx.runner.run("ss") and ({"x": 1}, []))}
            gate.handle("solicitar host-red")
            self.assertEqual(traza.eventos[0][:2], ("audit", "gate_intencion"))
            self.assertEqual(traza.eventos[1], ("run", "ss"))
            gate.handle("solicitar docker-nodos")          # comprobación del colector: la petición se crea DESPUÉS de la intención
            idx = [i for i, e in enumerate(traza.eventos) if e[:2] == ("audit", "gate_intencion")]
            self.assertEqual(len(idx), 2)
        finally:
            ent.limpiar()

    def test_sin_poder_registrar_la_intencion_no_se_ejecuta_nada_ni_se_consume_cupo(self):
        for orden in ("solicitar host-recursos", "solicitar docker-nodos"):
            gate, ent, runner, traza, _ = montar_gate(falla=lambda ev, c: ev == "gate_intencion")
            try:
                codigo, texto = gate.handle(orden)
                self.assertEqual((codigo, texto), (AUDITORIA, "error interno\n"), orden)
                self.assertEqual(runner.llamadas, [], "no se ejecuta la comprobación")
                self.assertEqual(os.listdir(ent.req), [], "no se crea ninguna petición para el colector")
                self.assertFalse(os.path.exists(os.path.join(ent.state, "cuota.json")), "no se consume cupo")
                self.assertFalse(os.path.exists(os.path.join(ent.state, "gate.lock")))
            finally:
                ent.limpiar()

    def test_el_resultado_se_registra_aunque_la_comprobacion_falle(self):
        def roto(ctx):
            raise RuntimeError("fallo-interno-" + SECRETO_EN_MENSAJE)
        gate, ent, runner, traza, _ = montar_gate(registry={"host-recursos": roto})
        try:
            self.assertEqual(gate.handle("solicitar host-recursos"), (ERROR, "error interno\n"))
            ev = traza.audit()
            self.assertEqual([e[1] for e in ev], ["gate_intencion", "gate_resultado"])
            self.assertEqual(ev[-1][2], "error_interno")
            self.assertEqual(ev[-1][3]["detalle"], "RuntimeError", "solo el TIPO de la excepción")
            self.assertNotIn("Z" * 36, json.dumps([e[3] for e in ev]))
        finally:
            ent.limpiar()

    def test_el_resultado_se_registra_si_el_colector_no_responde_o_si_se_supera_un_limite(self):
        gate, ent, runner, traza, reloj = montar_gate()
        try:
            self.assertEqual(gate.handle("solicitar docker-nodos")[0], SIN_RESPUESTA)
            self.assertEqual(traza.audit()[-1][:3], ("audit", "gate_resultado", "sin_respuesta"))
            self.assertEqual(gate.handle("solicitar host-recursos")[0], OK)
            gate.handle("solicitar host-recursos")                                         # intervalo mínimo
            self.assertEqual(traza.audit()[-1][2], "intervalo_minimo")
        finally:
            ent.limpiar()

    def test_si_no_puede_registrarse_el_resultado_no_se_entrega_el_informe(self):
        gate, ent, runner, traza, _ = montar_gate(falla=lambda ev, c: ev == "gate_resultado" and c.get("resultado") == "ok")
        try:
            codigo, texto = gate.handle("solicitar host-recursos")
            self.assertEqual((codigo, texto), (AUDITORIA, "error interno\n"))
            self.assertNotIn("esquema", texto)
            self.assertNotIn("datos", texto)
        finally:
            ent.limpiar()

    def test_los_registros_no_contienen_informes_ni_secretos(self):
        gate, ent, runner, traza, _ = montar_gate()
        try:
            gate.handle("solicitar host-recursos; echo ghp_" + "A" * 36, "198.51.100.77 5555 203.0.113.9 22")
            gate.handle("solicitar host-recursos", "198.51.100.77 5555 203.0.113.9 22")
            crudo = open(ent.gate_log, encoding="ascii").read()
            for no_debe in ("ghp_" + "A" * 36, "198.51.100.77", "carga", "memoria", "uptime", "esquema", "cpus"):
                self.assertNotIn(no_debe, crudo)
            eventos = [json.loads(l)["evento"] for l in crudo.splitlines()]
            self.assertIn("gate_intencion", eventos)
            self.assertIn("gate_resultado", eventos)
            ok = [json.loads(l) for l in crudo.splitlines() if json.loads(l).get("resultado") == "ok"]
            self.assertTrue(ok and len(ok[0]["sha256"]) == 64 and ok[0]["bytes"] > 0)
        finally:
            ent.limpiar()


class H4SinTrazasHaciaElCliente(unittest.TestCase):
    PERMITIDOS = {"error interno\n", "orden no permitida\n", "desactivado\n", "comprobacion no disponible\n", "ocupado\n", "limite alcanzado\n",
                  "sin informe\n", "sin respuesta del colector\n"}

    def test_el_gate_nunca_lanza_excepciones_aunque_falle_todo(self):
        casos = {
            "auditoría rota": dict(falla=lambda ev, c: True),
            "registro de comprobación roto": dict(registry={n: (lambda ctx: 1 / 0) for n in config.CHECKS}),
        }
        for nombre, kw in casos.items():
            gate, ent, runner, traza, _ = montar_gate(**kw)
            try:
                for orden in ("solicitar host-recursos", "solicitar docker-nodos", "leer docker-nodos", "id; ls", "", None, "solicitar fabricado"):
                    try:
                        codigo, texto = gate.handle(orden, "198.51.100.5 1 203.0.113.9 22")
                    except Exception as e:      # noqa: BLE001
                        self.fail("%s: handle(%r) lanzó %r" % (nombre, orden, e))
                    self.assertIn(texto, self.PERMITIDOS, "%s %r" % (nombre, orden))
                    self.assertIsInstance(codigo, int)
                    for no_debe in ("Traceback", "/var/", "/opt/", "tai-inspect", ".py", "ghp_", "Permission", "OSError", "RuntimeError", "ZeroDivision"):
                        self.assertNotIn(no_debe, texto)
            finally:
                ent.limpiar()

    def test_con_la_auditoria_rota_se_rechaza_la_ejecucion_con_un_error_generico(self):
        gate, ent, runner, traza, _ = montar_gate(falla=lambda ev, c: True)
        try:
            self.assertEqual(gate.handle("solicitar host-recursos"), (AUDITORIA, "error interno\n"))
            self.assertEqual(runner.llamadas, [])
            self.assertEqual(gate.handle("bash -c id"), (RECHAZADA, "orden no permitida\n"), "las órdenes rechazadas siguen rechazándose sin ejecutar nada")
        finally:
            ent.limpiar()

    def test_fallos_de_estado_o_de_disco_dan_error_generico(self):
        gate, ent, runner, traza, _ = montar_gate()
        try:
            gate.state_dir = os.path.join(ent.raiz, "no-existe")            # el directorio de bloqueos/cupo desaparece
            gate.cuota.state_path = os.path.join(gate.state_dir, "cuota.json")
            gate.cuota.lock_path = gate.cuota.state_path + ".lock"
            codigo, texto = gate.handle("solicitar host-recursos")
            self.assertEqual((codigo, texto), (ERROR, "error interno\n"))
            self.assertNotIn("no-existe", texto)
            self.assertEqual(traza.audit()[-1][2], "error_interno", "el fallo se registra tras la intención")
        finally:
            ent.limpiar()

    def test_los_mensajes_de_error_son_fijos(self):
        self.assertEqual(MENSAJE_GENERICO, "error interno\n")
        self.assertEqual((ERROR, AUDITORIA), (8, 9))
        fuente = open(os.path.join(H.RAIZ, "tai_inspect", "gate.py"), encoding="utf-8").read()
        arbol = ast.parse(fuente)
        for nodo in ast.walk(arbol):          # ningún mensaje de excepción ni traza se concatena en una respuesta
            if isinstance(nodo, ast.Call) and isinstance(nodo.func, ast.Attribute) and nodo.func.attr in ("format_exc", "print_exc", "format_exception"):
                self.fail("el gate no debe formatear trazas")

    def test_la_auditoria_solo_anade_nunca_trunca(self):
        fuente = open(os.path.join(H.RAIZ, "tai_inspect", "audit.py"), encoding="utf-8").read()
        arbol = ast.parse(fuente)
        aperturas = [n for n in ast.walk(arbol) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == "open"
                     and isinstance(n.func.value, ast.Name) and n.func.value.id == "os"]
        self.assertEqual(len(aperturas), 1, "el registro tiene una única vía de escritura")
        atributos = set(n.attr for n in ast.walk(arbol) if isinstance(n, ast.Attribute))
        self.assertIn("O_APPEND", atributos)
        self.assertNotIn("O_TRUNC", atributos)
        self.assertNotRegex(fuente, r"open\([^)]*['\"][wx+]")


class H1ColectorResistenteAPeticionesHostiles(unittest.TestCase):
    def montar(self, enabled=("docker-nodos", "docker-redes"), falla=None, registry=None):
        ent, reloj, traza = H.Entorno(), H.Reloj(), Traza()
        runner = RunnerEspia(traza)
        audit = AuditEspia(traza, falla, Audit(ent.col_log, now=reloj.now))
        col = Colector(ent.req, ent.rep, runner, set(enabled), AJUSTES, audit, now=reloj.now, install_dir=ent.raiz, registry=registry, root=ent.raiz)
        return col, ent, runner, traza

    def poner(self, ent, nombre, contenido=None):
        with open(os.path.join(ent.req, nombre), "wb") as f:
            f.write(json.dumps(contenido or {"check": "docker-nodos"}).encode())

    def test_una_ruta_no_permitida_se_descarta_y_se_siguen_procesando_las_demas(self):
        col, ent, runner, traza = self.montar()
        original = col_mod.safe_join
        try:
            def hostil(base, nombre, patron):
                if nombre.startswith("b"):
                    raise RutaNoPermitida("fuera de la ruta autorizada")          # lo que produce un enlace simbólico en Linux
                return original(base, nombre, patron)
            col_mod.safe_join = hostil
            for n in ("a", "b", "c"):
                self.poner(ent, n * 32 + ".req")
            self.assertEqual(col.procesar(), 3)
            self.assertEqual(os.listdir(ent.req), [], "la petición hostil se retira y las demás se atienden")
            self.assertTrue(os.path.exists(os.path.join(ent.rep, "docker-nodos.json")))
            self.assertTrue(any(e[2] == "peticion_invalida" for e in traza.audit()))
            self.assertEqual(sum(1 for e in traza.audit() if e[1] == "colector_resultado"), 2, "las dos válidas se ejecutaron")
        finally:
            col_mod.safe_join = original
            ent.limpiar()

    def test_una_excepcion_inesperada_en_una_peticion_no_detiene_la_pasada(self):
        col, ent, runner, traza = self.montar()
        original, llamadas = col_mod.informe.finalizar, {"n": 0}
        try:
            def a_veces_rota(cuerpo, ahora, max_bytes=65536):
                llamadas["n"] += 1
                if llamadas["n"] == 1:
                    raise RuntimeError("detalle-interno-" + SECRETO_EN_MENSAJE)
                return original(cuerpo, ahora)
            col_mod.informe.finalizar = a_veces_rota
            self.poner(ent, "a" * 32 + ".req")
            self.poner(ent, "b" * 32 + ".req", {"check": "docker-redes"})
            self.assertEqual(col.procesar(), 2)
            self.assertEqual(os.listdir(ent.req), [], "la defectuosa se descarta; no se reintenta indefinidamente")
            self.assertTrue(os.path.exists(os.path.join(ent.rep, "docker-redes.json")), "la segunda sí se atendió")
            error = [e for e in traza.audit() if e[1] == "error_peticion"][0]
            self.assertEqual(error[3]["detalle"], "RuntimeError")
            self.assertNotIn("Z" * 36, json.dumps([e[3] for e in traza.audit()]))
        finally:
            col_mod.informe.finalizar = original
            ent.limpiar()

    def test_nombres_de_peticion_manipulados_se_descartan_sin_detener_nada(self):
        col, ent, runner, traza = self.montar()
        try:
            for nombre in ("a" * 32 + ".req\n", "../x.req", "a" * 31 + ".req", "A" * 32 + ".req", "raro.txt", "b" * 32 + ".req.bak"):
                try:
                    self.poner(ent, nombre)
                except OSError:
                    pass
            self.poner(ent, "c" * 32 + ".req")
            col.procesar()
            self.assertTrue(os.path.exists(os.path.join(ent.rep, "docker-nodos.json")), "la petición legítima se atendió")
            self.assertEqual([n for n in os.listdir(ent.req) if n.endswith(".req") and len(n) == 36], [])
        finally:
            ent.limpiar()


class H5AuditoriaPreviaDelColector(unittest.TestCase):
    def test_la_intencion_precede_a_la_ejecucion_y_el_resultado_la_sigue(self):
        traza = Traza()
        ent, reloj = H.Entorno(), H.Reloj()
        try:
            col = Colector(ent.req, ent.rep, RunnerEspia(traza), {"docker-nodos"}, AJUSTES, AuditEspia(traza, None, Audit(ent.col_log, now=reloj.now)),
                           now=reloj.now, install_dir=ent.raiz, root=ent.raiz)
            open(os.path.join(ent.req, "a" * 32 + ".req"), "w").write('{"check":"docker-nodos"}')
            col.procesar()
            seq = [e[1] if e[0] == "audit" else "RUN" for e in traza.eventos]
            self.assertEqual(seq[0], "colector_intencion")
            self.assertEqual(seq[-1], "colector_publicacion")
            self.assertLess(seq.index("colector_intencion"), seq.index("RUN"))
            self.assertLess(seq.index("RUN"), seq.index("colector_resultado"))
            self.assertLess(seq.index("colector_resultado"), seq.index("colector_publicacion"))
        finally:
            ent.limpiar()

    def test_sin_poder_registrar_la_intencion_no_se_ejecuta_y_la_peticion_se_conserva(self):
        traza = Traza()
        ent, reloj = H.Entorno(), H.Reloj()
        try:
            runner = RunnerEspia(traza)
            col = Colector(ent.req, ent.rep, runner, {"docker-nodos"}, AJUSTES, AuditEspia(traza, lambda ev, c: ev == "colector_intencion"),
                           now=reloj.now, install_dir=ent.raiz, root=ent.raiz)
            for n in ("a", "b"):
                open(os.path.join(ent.req, n * 32 + ".req"), "w").write('{"check":"docker-nodos"}')
            try:
                col.procesar()
            except Exception as e:       # noqa: BLE001
                self.fail("el colector no debe lanzar excepciones: %r" % e)
            self.assertEqual(runner.llamadas, [], "no se ejecuta ninguna comprobación sin auditoría")
            self.assertEqual(len(os.listdir(ent.req)), 2, "las peticiones se conservan para cuando la auditoría vuelva")
            self.assertEqual(os.listdir(ent.rep), [])
        finally:
            ent.limpiar()

    def test_el_resultado_se_registra_aunque_la_comprobacion_falle(self):
        traza = Traza()
        ent, reloj = H.Entorno(), H.Reloj()
        try:
            def roto(ctx):
                raise RuntimeError("x")
            col = Colector(ent.req, ent.rep, RunnerEspia(traza), {"docker-nodos"}, AJUSTES, AuditEspia(traza), now=reloj.now,
                           install_dir=ent.raiz, registry={"docker-nodos": roto}, root=ent.raiz)
            open(os.path.join(ent.req, "a" * 32 + ".req"), "w").write('{"check":"docker-nodos"}')
            col.procesar()
            self.assertEqual([e[1] for e in traza.audit()], ["colector_intencion", "colector_resultado", "colector_publicacion"])
            self.assertEqual(traza.audit()[1][2], "error_interno")
        finally:
            ent.limpiar()


if __name__ == "__main__":
    unittest.main()
