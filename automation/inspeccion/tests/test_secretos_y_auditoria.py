# -*- coding: utf-8 -*-
"""Filtro de secretos con credenciales FICTICIAS, informes y registro de auditoría."""
import json
import os
import unittest

import helpers as H
from tai_inspect import informe, redact
from tai_inspect.audit import Audit, mask_ip, origin_from_ssh_connection, sanitize_text

# Credenciales FICTICIAS (se construyen por partes para no parecer claves reales en el código fuente).
FALSOS = {
    "bearer": "Authorization: Bearer " + "abcdEFGH1234" * 4,
    "tai_token": "tai_" + "0123456789abcdef" + "_" + "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789",
    "jwt": "eyJ" + "hbGciOiJIUzI1NiJ9" + "." + "eyJzdWIiOiIxMjM0NTY3ODkwIn0" + "." + "dBjftJeZ4CVPmB92K27uhbUJU1p1r",
    "token_github": "gh" + "p_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8",
    "clave_api_sk": "sk" + "-" + "proj0123456789ABCDEFGHIJKLMNOP",
    "clave_aws": "AK" + "IA" + "ABCDEFGHIJKLMNOP",
    "token_slack": "xox" + "b-" + "1234567890-abcdefghij",
    "clave_privada": "-----BEGIN " + "OPENSSH PRIVATE KEY-----",
    "url_credenciales": "postgres://" + "usuario:contrasenaSegura@" + "db.interno:5432/n8n",
    "asignacion_secreto": "POSTGRES_PASSWORD=" + "s3cr3t0-muy-largo",
    "email": "persona" + "@" + "ejemplo.com",
    "hex_largo": "a1b2c3d4" * 6,
    "alta_entropia": "Qm9u" + "dm9pZ29vZEx1Y2tXaXRoVGhpc1JhbmRvbVN0cmluZzEyMzQ1Njc4OQ",
    "ip_publica": "cliente 8.8.4.4 conectado",
}


class DeteccionDeSecretos(unittest.TestCase):
    def test_cada_tipo_de_secreto_ficticio_se_detecta_en_cualquier_posicion(self):
        for pid, valor in FALSOS.items():
            for forma in ({"campo": valor}, {"a": {"b": ["x", valor]}}, {valor: "x"}, {"texto": "antes " + valor + " despues"}):
                ids = {h[0] for h in redact.scan(forma)}
                self.assertTrue(ids, "%s no detectado en %r" % (pid, list(forma)[:1]))
        self.assertIn("clave_sensible", {h[0] for h in redact.scan({"password": "unaclave-no-trivial"})})
        self.assertIn("clave_sensible", {h[0] for h in redact.scan({"API-KEY": "abc"})})

    def test_los_hallazgos_nunca_contienen_el_secreto(self):
        for valor in FALSOS.values():
            hall = redact.scan({"x": valor})
            self.assertTrue(hall)
            self.assertNotIn(valor, repr(hall))
            for pid, ruta in hall:
                self.assertRegex(pid, r"^[a-z_0-9]+$")

    def test_contenido_legitimo_no_se_marca(self):
        legitimo = {
            "version": "2.38.6", "imagen": "n8nio/n8n:2.38.6", "replicas": "1/1", "puertos": [{"proto": "tcp", "puerto": 443, "ambito": "todas"}],
            "directivas": {"permitrootlogin": "without-password", "passwordauthentication": "yes", "port": "22"},
            "servicio": "practice_project_n8n_n8n", "contenedor": "practice_project_n8n_n8n.1.abcdefghijklmnopqrstuvwxy",
            "ip_privada": "10.0.1.5", "red": "172.18.0.0", "carga": {"1m": 0.5}, "texto": "Docker Application Container Engine",
            "meta": {"sha256": "a" * 64}, "huella": "b" * 64,
        }
        self.assertEqual(redact.scan(legitimo), [])

    def test_un_hash_solo_se_admite_en_los_campos_de_huella(self):
        self.assertEqual(redact.scan({"sha256": "a" * 64}), [])
        self.assertTrue(redact.scan({"otro": "a" * 64}))
        self.assertTrue(redact.scan({"sha256": "a" * 80}))

    def test_enmascarado_de_texto(self):
        for valor in FALSOS.values():
            self.assertNotIn(valor, redact.mask_text("linea " + valor + " fin"))
        self.assertIn("<ip>", redact.mask_text("conexion desde 198.51.100.7"))

    def test_normalizacion_de_mensajes_de_registro(self):
        crudo = ('2026-11-13 21:00:01 ERROR user persona@ejemplo.com from 198.51.100.7 failed "token abc" id 5f3a9c2e-1111-2222-3333-444455556666 '
                 'password=Zx9-secreto-largo http://interno/ruta?x=1 intento 42')
        n = redact.normalize_log_message(crudo)
        for no_debe in ("persona@ejemplo.com", "198.51.100.7", "Zx9-secreto", "5f3a9c2e", "42", "http://interno", "token abc"):
            self.assertNotIn(no_debe, n, no_debe)
        self.assertLessEqual(len(redact.normalize_log_message("x " * 500)), 200)
        self.assertEqual(redact.normalize_log_message("Error 500 en 192.0.2.1"), redact.normalize_log_message("Error 404 en 192.0.2.99"))


class InformesYDescarte(unittest.TestCase):
    def test_un_informe_con_secreto_se_descarta_entero_y_no_lo_contiene(self):
        for pid, valor in FALSOS.items():
            cuerpo = informe.construir("docker-servicios", {"servicios": [{"nombre": "x", "nota": valor}]}, [], H.T0, 5)
            datos, estado = informe.finalizar(cuerpo, H.T0)
            self.assertEqual(estado, "secreto_detectado", pid)
            self.assertNotIn(valor.encode("ascii"), datos)
            rep = json.loads(datos)
            self.assertEqual(rep["error"], "secreto_detectado")
            self.assertNotIn("datos", rep, "el informe de error no puede arrastrar el resto de datos")
            self.assertEqual(redact.scan(rep), [], "el propio informe de error debe estar limpio")

    def test_informe_valido_lleva_huella_y_esquema(self):
        cuerpo = informe.construir("host-recursos", {"cpus": 2}, ["aviso"], H.T0, 5)
        datos, estado = informe.finalizar(cuerpo, H.T0)
        self.assertEqual(estado, "ok")
        rep = json.loads(datos)
        self.assertEqual(rep["esquema"], "tai-informe/1")
        self.assertEqual(len(rep["meta"]["sha256"]), 64)
        self.assertEqual(redact.scan(rep), [])

    def test_limite_de_64_kib(self):
        grande = {"servicios": [{"nombre": "svc-%d" % i, "imagen": "x" * 200} for i in range(600)]}
        datos, estado = informe.finalizar(informe.construir("docker-servicios", grande, [], H.T0, 5), H.T0)
        self.assertEqual(estado, "informe_demasiado_grande")
        self.assertLess(len(datos), 400)
        justo = informe.construir("docker-servicios", {"a": "y" * 100}, [], H.T0, 5)
        datos2, estado2 = informe.finalizar(justo, H.T0, max_bytes=70000)
        self.assertEqual(estado2, "ok")
        self.assertLessEqual(len(datos2), 64 * 1024)


class Auditoria(unittest.TestCase):
    def setUp(self):
        self.ent = H.Entorno()
        self.reloj = H.Reloj()

    def tearDown(self):
        self.ent.limpiar()

    def test_campos_desconocidos_y_valores_peligrosos_se_neutralizan(self):
        a = Audit(self.ent.gate_log, now=self.reloj.now)
        a.log("gate", resultado="ok", contrasena="NO-DEBE-SALIR", check="../../etc/passwd", sha256="no-es-un-hash",
              detalle="linea1\nlinea2 " + FALSOS["token_github"], id="zz", ms="5", bytes=True)
        crudo = open(self.ent.gate_log, encoding="ascii").read()
        self.assertEqual(crudo.count("\n"), 1, "una línea por evento: no se puede inyectar saltos de línea")
        for no_debe in ("NO-DEBE-SALIR", "passwd", FALSOS["token_github"], "contrasena"):
            self.assertNotIn(no_debe, crudo)
        reg = json.loads(crudo)
        self.assertEqual(reg["check"], "-")
        self.assertEqual(reg["sha256"], "-")
        self.assertEqual(reg["ms"], 0)
        self.assertEqual(reg["bytes"], 0)

    def test_la_auditoria_se_acumula_sin_sobrescribir(self):
        a = Audit(self.ent.gate_log, now=self.reloj.now)
        for i in range(5):
            a.log("gate", resultado="ok")
        self.assertEqual(len(self.ent.lineas_auditoria(self.ent.gate_log)), 5)

    def test_ip_enmascarada(self):
        self.assertEqual(mask_ip("198.51.100.77"), "198.51.100.x")
        self.assertEqual(mask_ip("2001:db8:1234:5678::1"), "2001:0db8:1234::x")
        self.assertEqual(mask_ip("no-es-ip"), "desconocido")
        self.assertEqual(origin_from_ssh_connection("198.51.100.77 5555 203.0.113.9 22"), "198.51.100.x")
        self.assertEqual(origin_from_ssh_connection(None), "desconocido")
        self.assertEqual(origin_from_ssh_connection("basura"), "desconocido")

    def test_texto_saneado(self):
        s = sanitize_text("hola\x00\x1b[31m " + FALSOS["jwt"] + " " + "x" * 200, 64)
        self.assertLessEqual(len(s), 64)
        self.assertTrue(all(32 <= ord(c) < 127 for c in s))
        self.assertNotIn(FALSOS["jwt"], s)


if __name__ == "__main__":
    unittest.main()
