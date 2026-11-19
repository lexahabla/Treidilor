# -*- coding: utf-8 -*-
"""Gate: lista cerrada, rechazo de órdenes manipuladas, inyección, límites y errores."""
import os
import random
import string
import unittest

import helpers as H
from tai_inspect import config
from tai_inspect.audit import Audit
from tai_inspect.gate import Gate, parse_orden, OK, RECHAZADA, DESACTIVADO, SIN_INFORME, SIN_RESPUESTA, OCUPADO, LIMITE
from tai_inspect.limits import Bloqueo

HOST = ["host-recursos", "host-red", "host-servicios", "host-actualizaciones", "host-tiempo"]


def montar(enabled=None, max_daily=60, wait=3, canned=None):
    ent, reloj = H.Entorno(), H.Reloj()
    runner = H.RunnerFalso(canned or {"ss": H.SS, "systemctl_running": H.SYSTEMCTL, "apt_upgradable": H.APT, "timedatectl": H.TIMEDATECTL})
    audit = Audit(ent.gate_log, now=reloj.now)
    ajustes = {"servicio_n8n": None, "servicio_runner": None, "servicio_postgres": None, "servicios_registros": [], "tablas_agentes": []}
    gate = Gate(set(HOST) if enabled is None else enabled, runner, ajustes, ent.req, ent.rep, ent.state, ent.disable, audit,
                now=reloj.now, sleep=reloj.sleep, max_daily=max_daily, wait=wait, poll=0.5, root=ent.raiz)
    return gate, ent, runner, reloj


class OrdenesPermitidas(unittest.TestCase):
    def test_solo_dos_verbos_y_nombres_de_la_lista(self):
        self.assertEqual(parse_orden("solicitar host-recursos"), ("solicitar", "host-recursos"))
        self.assertEqual(parse_orden("leer docker-nodos"), ("leer", "docker-nodos"))

    def test_lista_cerrada_coincide_con_las_comprobaciones_documentadas(self):
        self.assertEqual(len(config.CHECKS), 18)
        for nombre, meta in config.CHECKS.items():
            self.assertIn(meta["kind"], ("host", "colector"))
            self.assertRegex(nombre, r"^[a-z0-9]+(-[a-z0-9]+)*$")


class OrdenesManipuladas(unittest.TestCase):
    MALAS = [
        "", " ", "solicitar", "leer", "solicitar ", " solicitar host-recursos", "solicitar host-recursos ", "solicitar  host-recursos",
        "solicitar\thost-recursos", "solicitar\nhost-recursos", "solicitar host-recursos\n", "solicitar host-recursos\r",
        "SOLICITAR host-recursos", "Solicitar host-recursos", "solicitar HOST-RECURSOS", "solicitar host_recursos",
        "solicitar host-recursos; id", "solicitar host-recursos && id", "solicitar host-recursos | cat /etc/passwd",
        "solicitar host-recursos `id`", "solicitar host-recursos $(id)", "solicitar $(id)", "solicitar ${IFS}id",
        "solicitar host-recursos > /tmp/x", "solicitar host-recursos < /etc/shadow", "solicitar host-recursos &",
        "solicitar ../../etc/passwd", "solicitar ../host-recursos", "solicitar /etc/passwd", "solicitar host-recursos/../x",
        "solicitar %2e%2e%2f", "solicitar host-recursos%00", "solicitar host-recursos\x00", "solicitar host‑recursos",
        "solicitar host-recursosé", "solicitar -h", "solicitar --help", "solicitar -", "solicitar --", "solicitar host--recursos",
        "solicitar -host-recursos", "solicitar host-recursos-", "solicitar host-recursos extra", "solicitar host-recursos host-red",
        "leer host-recursos host-red", "leer ../reports/host-recursos", "ls", "id", "sh", "bash -c id", "/bin/sh", "/bin/sh -c id",
        "sh -c 'solicitar host-recursos'", "scp -t /tmp", "scp -f /etc/passwd", "sftp", "rsync --server -vlogDtpre.iLsfxC . /tmp",
        "internal-sftp", "git-upload-pack /x", "docker ps", "docker exec x sh", "sudo -l", "cat /etc/passwd", "env", "set",
        "solicitar " + "a" * 100, "solicitar host-recursos" + " " * 80, "x" * 10000, "solicitar host-recursos\\", "solicitar host-recursos'",
        'solicitar host-recursos"', "solicitar host-recursos#", "solicitar host-recursos!", "solicitar *", "solicitar ?", "solicitar [a-z]",
        "solicitar {host-recursos,host-red}", "solicitar ~", "solicitar $HOME", "solicitar $0", "solicitar \x1b[31m",
    ]

    def test_ninguna_orden_manipulada_se_acepta(self):
        for orden in self.MALAS:
            self.assertIsNone(parse_orden(orden), repr(orden))

    def test_el_gate_rechaza_sin_ejecutar_nada_ni_repetir_la_entrada(self):
        gate, ent, runner, reloj = montar()
        try:
            for orden in self.MALAS + [None]:
                codigo, texto = gate.handle(orden, "198.51.100.23 51234 203.0.113.9 22")
                self.assertEqual(codigo, RECHAZADA, repr(orden))
                self.assertEqual(texto, "orden no permitida\n")
                if isinstance(orden, str) and len(orden) > 4:
                    self.assertNotIn(orden.strip()[:12], texto)
            self.assertEqual(runner.llamadas, [], "ninguna orden rechazada debe ejecutar comandos")
            self.assertEqual(os.listdir(ent.req), [], "ninguna orden rechazada debe crear peticiones")
            self.assertEqual(os.listdir(ent.rep), [])
        finally:
            ent.limpiar()

    def test_fuzz_solo_pasan_las_ordenes_exactas_de_la_lista(self):
        rnd = random.Random(20261113)
        alfabeto = string.ascii_lowercase + string.digits + " -;|&$`'\"\\/.\n\t%*?<>()[]{}~!#"
        validas = {"solicitar " + n for n in config.CHECKS} | {"leer " + n for n in config.CHECKS}
        for _ in range(4000):
            s = "".join(rnd.choice(alfabeto) for _ in range(rnd.randint(0, 40)))
            r = parse_orden(s)
            if r is not None:                       # solo puede aceptar la FORMA exacta y su nombre debe ser sintácticamente puro
                self.assertRegex(s, r"^(solicitar|leer) [a-z0-9]+(-[a-z0-9]+)*$")
        # mutaciones de órdenes válidas: añadir/quitar/duplicar un carácter nunca produce una orden aceptada fuera de la forma
        for v in validas:
            for i in range(len(v)):
                for ch in ";|&$`'\"\\/. \n\t":
                    mutada = v[:i] + ch + v[i:]
                    r = parse_orden(mutada)
                    if r is not None:
                        self.assertRegex(mutada, r"^(solicitar|leer) [a-z0-9]+(-[a-z0-9]+)*$")

    def test_nombre_con_forma_valida_pero_fuera_de_la_lista_o_deshabilitado(self):
        gate, ent, runner, reloj = montar(enabled={"host-recursos"})
        try:
            for orden in ("solicitar fabricado", "solicitar docker-nodos", "leer postgres-estado", "solicitar host-red"):
                codigo, texto = gate.handle(orden)
                self.assertEqual(codigo, RECHAZADA, orden)
            self.assertEqual(runner.llamadas, [])
        finally:
            ent.limpiar()


class DesactivacionYErrores(unittest.TestCase):
    def test_interruptor_de_parada(self):
        gate, ent, runner, reloj = montar()
        try:
            open(ent.disable, "w").close()
            codigo, texto = gate.handle("solicitar host-recursos")
            self.assertEqual((codigo, texto), (DESACTIVADO, "desactivado\n"))
            self.assertEqual(runner.llamadas, [])
        finally:
            ent.limpiar()

    def test_archivo_de_habilitadas_dañado_no_habilita_nada(self):
        ent = H.Entorno()
        try:
            ruta = os.path.join(ent.raiz, "enabled.json")
            for contenido in ("no es json", '{"a":1}', "[1,2,3]", '["fabricado"]', ""):
                with open(ruta, "w") as f:
                    f.write(contenido)
                self.assertEqual(config.load_enabled(ruta), set(), contenido)
            self.assertEqual(config.load_enabled(os.path.join(ent.raiz, "no-existe.json")), set())
            with open(ruta, "w") as f:
                f.write('["host-recursos","fabricado","docker-nodos"]')
            val = os.path.join(ent.raiz, "validaciones.json")
            self.assertEqual(config.load_enabled(ruta, val), {"host-recursos"}, "docker-nodos es SENSIBLE: sin validación sigue deshabilitada")
            with open(val, "w") as f:
                f.write('{"docker-nodos": {"muestra_sha256": "' + "a" * 64 + '"}}')
            self.assertEqual(config.load_enabled(ruta, val), {"host-recursos", "docker-nodos"})
        finally:
            ent.limpiar()

    def test_ajustes_invalidos_se_ignoran(self):
        ent = H.Entorno()
        try:
            ruta = os.path.join(ent.raiz, "ajustes.json")
            with open(ruta, "w") as f:
                f.write('{"servicio_n8n":"a b; rm -rf /","servicio_postgres":"ok_pg","servicios_registros":["n8n","traefik","mi-proxy","a;b"],"tablas_agentes":["calidad_x","BAD NAME"]}')
            a = config.load_settings(ruta)
            self.assertIsNone(a["servicio_n8n"])
            self.assertEqual(a["servicio_postgres"], "ok_pg")
            self.assertEqual(a["servicios_registros"], ["n8n"], "los servicios de proxy/acceso nunca se resumen")
            self.assertEqual(a["tablas_agentes"], ["calidad_x"])
        finally:
            ent.limpiar()

    def test_errores_inesperados_no_filtran_detalles(self):
        gate, ent, runner, reloj = montar()
        try:
            def roto(ctx):
                raise RuntimeError("secreto-interno-" + "A" * 40)
            gate.registry = {"host-recursos": roto}
            codigo, texto = gate.handle("solicitar host-recursos")
            self.assertEqual(texto, "error interno\n")
            registro = open(ent.gate_log, encoding="ascii").read()
            self.assertNotIn("secreto-interno", registro)
            self.assertIn("RuntimeError", registro)
        finally:
            ent.limpiar()

    def test_leer_sin_informe_y_leer_de_comprobacion_de_host(self):
        gate, ent, runner, reloj = montar(enabled={"docker-nodos", "host-red"})
        try:
            self.assertEqual(gate.handle("leer docker-nodos")[0], SIN_INFORME)
            self.assertEqual(gate.handle("leer host-red")[0], RECHAZADA)
        finally:
            ent.limpiar()

    def test_sin_respuesta_del_colector_retira_la_peticion(self):
        gate, ent, runner, reloj = montar(enabled={"docker-nodos"}, wait=2)
        try:
            codigo, texto = gate.handle("solicitar docker-nodos")
            self.assertEqual((codigo, texto), (SIN_RESPUESTA, "sin respuesta del colector\n"))
            self.assertEqual(os.listdir(ent.req), [], "el gate debe retirar su propia petición")
        finally:
            ent.limpiar()


class LimitesDelGate(unittest.TestCase):
    def test_cupo_diario_y_las_rechazadas_no_consumen(self):
        gate, ent, runner, reloj = montar(max_daily=3)
        try:
            for orden in ("solicitar host-recursos", "solicitar host-red", "solicitar host-servicios"):
                self.assertEqual(gate.handle(orden)[0], OK, orden)
            self.assertEqual(gate.handle("solicitar host-tiempo")[0], LIMITE)
            for _ in range(10):
                gate.handle("id; rm -rf /")                 # rechazadas: no deben alterar el cupo
            reloj.t += 24 * 3600
            self.assertEqual(gate.handle("solicitar host-tiempo")[0], OK, "al día siguiente se renueva el cupo")
        finally:
            ent.limpiar()

    def test_el_cupo_por_defecto_es_60(self):
        self.assertEqual(config.MAX_DAILY_REQUESTS, 60)
        self.assertEqual(config.MAX_CONCURRENT, 1)
        self.assertEqual(config.MAX_REPORT_BYTES, 64 * 1024)

    def test_intervalo_minimo_por_comprobacion(self):
        gate, ent, runner, reloj = montar()
        try:
            self.assertEqual(gate.handle("solicitar host-recursos")[0], OK)
            self.assertEqual(gate.handle("solicitar host-recursos")[0], LIMITE)
            reloj.t += 31
            self.assertEqual(gate.handle("solicitar host-recursos")[0], OK)
        finally:
            ent.limpiar()

    def test_una_sola_peticion_simultanea(self):
        gate, ent, runner, reloj = montar()
        try:
            otro = Bloqueo(os.path.join(ent.state, "gate.lock"), ttl=100, now=reloj.now)
            self.assertTrue(otro.acquire())
            self.assertEqual(gate.handle("solicitar host-recursos")[0], OCUPADO)
            otro.release()
            self.assertEqual(gate.handle("solicitar host-recursos")[0], OK)
        finally:
            ent.limpiar()

    def test_bloqueo_huerfano_caduca(self):
        gate, ent, runner, reloj = montar()
        try:
            ruta = os.path.join(ent.state, "gate.lock")
            open(ruta, "w").close()
            os.utime(ruta, (reloj.t - 1000, reloj.t - 1000))
            self.assertEqual(gate.handle("solicitar host-recursos")[0], OK)
        finally:
            ent.limpiar()


class AuditoriaDelGate(unittest.TestCase):
    def test_auditoria_sin_informacion_sensible(self):
        gate, ent, runner, reloj = montar()
        try:
            secreto = "ghp_" + "Z" * 36
            gate.handle("solicitar host-recursos; echo " + secreto, "198.51.100.77 5555 203.0.113.9 22")
            gate.handle("solicitar host-recursos", "198.51.100.77 5555 203.0.113.9 22")
            crudo = open(ent.gate_log, encoding="ascii").read()
            self.assertNotIn(secreto, crudo)
            self.assertNotIn("198.51.100.77", crudo, "la IP del cliente debe ir enmascarada")
            self.assertIn("198.51.100.x", crudo)
            for reg in ent.lineas_auditoria(ent.gate_log):
                self.assertLess(len(str(reg)), 600)
                self.assertTrue(set(reg) <= set(("ts", "seq", "evento", "verbo", "check", "id", "resultado", "codigo", "ms", "bytes", "sha256", "origen", "cmd_hash", "detalle", "ref_seq")))
            self.assertTrue(any(r.get("resultado") == "orden_rechazada" for r in ent.lineas_auditoria(ent.gate_log)))
            self.assertTrue(any(r.get("resultado") == "ok" and len(r.get("sha256", "")) == 64 for r in ent.lineas_auditoria(ent.gate_log)))
        finally:
            ent.limpiar()


if __name__ == "__main__":
    unittest.main()
