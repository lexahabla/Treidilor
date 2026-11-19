# -*- coding: utf-8 -*-
"""Colector y flujo completo gate → petición → colector → informe → gate, con ejecutor y reloj simulados."""
import json
import os
import threading
import unittest

import helpers as H
from tai_inspect import config
from tai_inspect.audit import Audit
from tai_inspect.collector import Colector, ejecutar_con_limite
from tai_inspect.gate import Gate, OK, SIN_RESPUESTA, ERROR, LIMITE
from tai_inspect.runner import Resultado

COLECTOR_CHECKS = [n for n, m in config.CHECKS.items() if m["kind"] == "colector"]
CANNED = {"docker_node_ls": H.NODE_LS, "docker_service_ls": H.SERVICE_LS, "docker_service_ps": H.SERVICE_PS, "docker_stats": H.STATS,
          "docker_network_ls": H.NET_LS, "docker_network_inspect": H.NET_INSPECT, "docker_system_df": H.DF, "docker_volume_count": "a\n"}
AJUSTES = {"servicio_n8n": None, "servicio_runner": None, "servicio_postgres": None, "servicios_registros": [], "tablas_agentes": []}


class Montaje(object):
    def __init__(self, canned=None, enabled=None, registry=None, wait=3):
        self.ent, self.reloj = H.Entorno(), H.Reloj()
        self.runner = H.RunnerFalso(CANNED if canned is None else canned)
        self.enabled = set(COLECTOR_CHECKS if enabled is None else enabled)
        self.audit_col = Audit(self.ent.col_log, now=self.reloj.now)
        self.col = Colector(self.ent.req, self.ent.rep, self.runner, self.enabled, AJUSTES, self.audit_col, now=self.reloj.now,
                            install_dir=self.ent.raiz, registry=registry, root=self.ent.raiz)
        self.gate = Gate(self.enabled, self.runner, AJUSTES, self.ent.req, self.ent.rep, self.ent.state, self.ent.disable,
                         Audit(self.ent.gate_log, now=self.reloj.now), now=self.reloj.now, sleep=self._sleep, wait=wait, poll=0.5,
                         root=self.ent.raiz, registry=registry)
        self.activo = True        # simula que systemd .path arranca el colector al aparecer peticiones

    def _sleep(self, s):
        self.reloj.sleep(s)
        if self.activo:
            self.col.procesar()

    def limpiar(self):
        self.ent.limpiar()


class Flujo(unittest.TestCase):
    def test_extremo_a_extremo_con_el_colector(self):
        m = Montaje()
        try:
            codigo, texto = m.gate.handle("solicitar docker-nodos", "198.51.100.5 1 203.0.113.9 22")
            self.assertEqual(codigo, OK)
            rep = json.loads(texto)
            self.assertEqual(rep["check"], "docker-nodos")
            self.assertTrue(rep["datos"]["un_solo_nodo"])
            self.assertEqual(os.listdir(m.ent.req), [], "la petición debe quedar retirada")
            self.assertTrue(os.path.exists(os.path.join(m.ent.rep, "docker-nodos.json")))
            c, t2 = m.gate.handle("leer docker-nodos")
            self.assertEqual((c, json.loads(t2)["meta"]["sha256"]), (OK, rep["meta"]["sha256"]))
            col = m.ent.lineas_auditoria(m.ent.col_log)
            self.assertTrue(any(r["evento"] == "colector_resultado" and r["resultado"] == "ok" and len(r["sha256"]) == 64 for r in col))
        finally:
            m.limpiar()

    def test_un_informe_antiguo_no_se_toma_por_la_respuesta_a_una_peticion_nueva(self):
        m = Montaje()
        try:
            self.assertEqual(m.gate.handle("solicitar docker-nodos")[0], OK)
            m.activo = False
            m.reloj.t += 400                      # pasa el intervalo mínimo; el colector está parado
            codigo, _ = m.gate.handle("solicitar docker-nodos")
            self.assertEqual(codigo, SIN_RESPUESTA, "el informe viejo no es la respuesta a la petición nueva")
        finally:
            m.limpiar()

    def test_informe_con_secreto_manipulado_en_disco_no_se_imprime(self):
        m = Montaje()
        try:
            m.gate.handle("solicitar docker-nodos")
            ruta = os.path.join(m.ent.rep, "docker-nodos.json")
            rep = json.load(open(ruta))
            rep["datos"]["nota"] = "gh" + "p_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"
            json.dump(rep, open(ruta, "w"))
            codigo, texto = m.gate.handle("leer docker-nodos")
            self.assertEqual(codigo, ERROR)
            self.assertNotIn("ghp_", texto)
        finally:
            m.limpiar()

    def test_informe_demasiado_grande_o_basura_no_se_imprime(self):
        m = Montaje()
        try:
            ruta = os.path.join(m.ent.rep, "docker-nodos.json")
            with open(ruta, "wb") as f:
                f.write(b"x" * (config.MAX_REPORT_BYTES + 1))
            self.assertEqual(m.gate.handle("leer docker-nodos")[0], 4)       # sin informe legible
            with open(ruta, "w") as f:
                f.write("no es json")
            self.assertEqual(m.gate.handle("leer docker-nodos")[0], ERROR)
        finally:
            m.limpiar()

    def test_lectura_de_informe_enlazado_fuera_de_la_ruta(self):
        m = Montaje()
        try:
            fuera = os.path.join(m.ent.raiz, "fuera.json")
            open(fuera, "w").write('{"x":1}')
            try:
                os.symlink(fuera, os.path.join(m.ent.rep, "docker-nodos.json"))
            except (OSError, NotImplementedError):
                self.skipTest("sin enlaces simbólicos")
            self.assertEqual(m.gate.handle("leer docker-nodos")[0], 4)
        finally:
            m.limpiar()

    def test_cada_comprobacion_de_la_lista_funciona_de_extremo_a_extremo(self):
        m = Montaje()
        try:
            for nombre in COLECTOR_CHECKS:
                m.reloj.t += 400
                codigo, texto = m.gate.handle("solicitar " + nombre)
                rep = json.loads(texto)
                self.assertIn(codigo, (OK, ERROR), nombre)
                self.assertEqual(rep["check"], nombre)
                self.assertLess(len(texto), config.MAX_REPORT_BYTES)
        finally:
            m.limpiar()


class ColectorDirecto(unittest.TestCase):
    def poner(self, ent, nombre, contenido):
        with open(os.path.join(ent.req, nombre), "wb") as f:
            f.write(contenido)

    def test_peticiones_invalidas_se_descartan_sin_ejecutar_nada(self):
        m = Montaje()
        try:
            self.poner(m.ent, "a" * 32 + ".req", b"no es json")
            self.poner(m.ent, "b" * 32 + ".req", json.dumps({"check": "host-recursos"}).encode())          # de host: no es del colector
            self.poner(m.ent, "c" * 32 + ".req", json.dumps({"check": "../../etc/passwd"}).encode())
            self.poner(m.ent, "d" * 32 + ".req", json.dumps({"check": "fabricado"}).encode())
            self.poner(m.ent, "e" * 32 + ".req", json.dumps({"check": "docker-nodos", "x": "y" * 2000}).encode())   # demasiado grande
            self.poner(m.ent, "nombre-raro.req", b"{}")
            self.poner(m.ent, "..", b"") if False else None
            m.col.procesar()
            self.assertEqual(os.listdir(m.ent.req), [])
            self.assertEqual(os.listdir(m.ent.rep), [])
            self.assertEqual(m.runner.llamadas, [])
        finally:
            m.limpiar()

    def test_solo_se_atienden_las_peticiones_permitidas_por_pasada(self):
        m = Montaje(enabled={"docker-nodos"})
        try:
            for i in range(12):
                self.poner(m.ent, ("%032x" % (i + 1)) + ".req", json.dumps({"check": "docker-nodos"}).encode())
            self.assertEqual(m.col.procesar(), config.MAX_PENDING_REQUESTS)
            self.assertEqual(len(os.listdir(m.ent.req)), 12 - config.MAX_PENDING_REQUESTS)
        finally:
            m.limpiar()

    def test_comprobacion_no_habilitada_no_se_ejecuta(self):
        m = Montaje(enabled={"docker-nodos"})
        try:
            # `docker-servicios` SÍ haría llamadas al ejecutor si se ejecutara; al no estar habilitada no debe hacer ninguna.
            self.poner(m.ent, "a" * 32 + ".req", json.dumps({"check": "docker-servicios"}).encode())
            m.col.procesar()
            self.assertEqual(m.runner.llamadas, [])
            self.assertEqual(os.listdir(m.ent.rep), [])
        finally:
            m.limpiar()

    def test_fallo_interno_no_filtra_el_mensaje_ni_la_traza(self):
        def roto(ctx):
            raise RuntimeError("clave-interna-" + "Z" * 30)
        m = Montaje(registry={"docker-nodos": roto}, enabled={"docker-nodos"})
        try:
            self.poner(m.ent, "a" * 32 + ".req", json.dumps({"check": "docker-nodos"}).encode())
            m.col.procesar()
            rep = json.load(open(os.path.join(m.ent.rep, "docker-nodos.json")))
            self.assertEqual(rep["error"], "error_interno")
            self.assertNotIn("clave-interna", json.dumps(rep) + open(m.ent.col_log).read())
        finally:
            m.limpiar()

    def test_tiempo_total_agotado(self):
        evento = threading.Event()

        def lento(ctx):
            evento.wait(10)
            return {}, []
        m = Montaje(registry={"docker-nodos": lento}, enabled={"docker-nodos"})
        m.col.total_seconds = 0.2
        try:
            self.poner(m.ent, "a" * 32 + ".req", json.dumps({"check": "docker-nodos"}).encode())
            m.col.procesar()
            self.assertEqual(json.load(open(os.path.join(m.ent.rep, "docker-nodos.json")))["error"], "tiempo_agotado")
        finally:
            evento.set()
            m.limpiar()

    def test_directorios_ilegibles_o_disco_lleno_no_provocan_caida(self):
        m = Montaje()
        try:
            m.col.req_dir = os.path.join(m.ent.raiz, "no-existe")
            self.assertEqual(m.col.procesar(), 0)
            m.col.req_dir = m.ent.req
            m.col.rep_dir = os.path.join(m.ent.raiz, "no-existe-rep")
            self.poner(m.ent, "a" * 32 + ".req", json.dumps({"check": "docker-nodos"}).encode())
            try:
                m.col.procesar()
            except Exception as e:        # noqa: BLE001
                self.fail("el colector no debe lanzar excepciones: %r" % e)
            self.assertTrue(any(r.get("resultado") in ("escritura_fallida", "fallida") for r in m.ent.lineas_auditoria(m.ent.col_log)))
        finally:
            m.limpiar()

    def test_un_comando_que_falla_da_un_informe_con_avisos_no_un_error(self):
        m = Montaje(canned={"docker_node_ls": Resultado(rc=1, salida="")}, enabled={"docker-nodos"})
        try:
            self.poner(m.ent, "a" * 32 + ".req", json.dumps({"check": "docker-nodos"}).encode())
            m.col.procesar()
            rep = json.load(open(os.path.join(m.ent.rep, "docker-nodos.json")))
            self.assertIn("docker_node_ls_no_disponible", rep["avisos"])
        finally:
            m.limpiar()

    def test_la_auditoria_del_colector_no_contiene_contenido_de_informes(self):
        m = Montaje()
        try:
            m.gate.handle("solicitar docker-servicios")
            crudo = open(m.ent.col_log, encoding="ascii").read()
            for no_debe in ("practice_project", "n8nio", "treidilor_web", "overlay"):
                self.assertNotIn(no_debe, crudo)
        finally:
            m.limpiar()

    def test_ejecutar_con_limite(self):
        self.assertEqual(ejecutar_con_limite(lambda: 5, 1), (5, None, False))
        self.assertEqual(ejecutar_con_limite(lambda: 1 / 0, 1), (None, "ZeroDivisionError", False))
        ev = threading.Event()
        self.assertTrue(ejecutar_con_limite(lambda: ev.wait(5), 0.1)[2])
        ev.set()


if __name__ == "__main__":
    unittest.main()
