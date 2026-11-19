# -*- coding: utf-8 -*-
"""Rutas seguras, ejecutor de comandos fijos, tabla de comandos y consultas SQL."""
import os
import re
import sys
import unittest

import helpers as H
from tai_inspect import pathsafe, runner
from tai_inspect.pathsafe import RutaNoPermitida
from tai_inspect.runner import ArgumentoNoPermitido, Runner, SPECS, QUERIES, QUERY_TEMPLATES

PY = sys.executable


def spec_python(codigo, arg_re=None):
    d = {"argv": [PY, "-c", codigo]}
    if arg_re:
        d["argv"] = [PY, "-c", codigo, "{arg}"]
        d["arg_re"] = arg_re
    return d


class RutasSeguras(unittest.TestCase):
    def setUp(self):
        self.ent = H.Entorno()

    def tearDown(self):
        self.ent.limpiar()

    def test_nombres_con_recorrido_de_directorios_se_rechazan(self):
        pat = re.compile(r"^[a-z0-9-]+\.json$")
        for malo in ("../x.json", "..\\x.json", "a/b.json", "/etc/passwd", "x.json\x00", "x.json/../../y", "%2e%2e.json", "A.json", "x.JSON", ".json", "x.json ", "x.json\n"):
            with self.assertRaises(RutaNoPermitida, msg=repr(malo)):
                pathsafe.safe_join(self.ent.rep, malo, pat)
        self.assertTrue(pathsafe.safe_join(self.ent.rep, "docker-nodos.json", pat).endswith("docker-nodos.json"))

    def test_lectura_no_sigue_enlaces_ni_lee_fuera_de_la_ruta(self):
        secreto = os.path.join(self.ent.raiz, "fuera.txt")
        with open(secreto, "w") as f:
            f.write("CONTENIDO-FUERA-DE-LA-RUTA")
        enlace = os.path.join(self.ent.rep, "docker-nodos.json")
        try:
            os.symlink(secreto, enlace)
        except (OSError, NotImplementedError):
            self.skipTest("no se pueden crear enlaces simbólicos en este sistema")
        with self.assertRaises(RutaNoPermitida):
            pathsafe.safe_read_file(enlace, 1000)

    def test_ficheros_no_regulares_o_demasiado_grandes(self):
        ruta = os.path.join(self.ent.rep, "grande.json")
        with open(ruta, "wb") as f:
            f.write(b"x" * 2000)
        with self.assertRaises(RutaNoPermitida):
            pathsafe.safe_read_file(ruta, 1000)
        with self.assertRaises(RutaNoPermitida):
            pathsafe.safe_read_file(self.ent.rep, 1000)       # un directorio
        self.assertEqual(pathsafe.safe_read_file(ruta, 5000), b"x" * 2000)

    def test_el_contexto_solo_lee_ficheros_de_la_lista(self):
        from tai_inspect.ctx import Contexto
        c = Contexto(H.RunnerFalso(), settings={}, root=self.ent.raiz)
        for clave in ("/etc/shadow", "../x", "passwd", "loadavg/../../etc", "env"):
            with self.assertRaises(KeyError):
                c.read_text(clave)
        self.assertIsNone(c.disk("/etc"))
        self.assertIsNone(c.disk("/var/lib/docker/../.."))
        self.assertIsNone(c.read_audit_tail("/etc/passwd"))

    def test_peticiones_con_nombre_invalido_o_enlace_se_descartan(self):
        self.assertIsNone(pathsafe.REQ_RE.match("../" + "a" * 32 + ".req"))
        self.assertIsNone(pathsafe.REQ_RE.match("A" * 32 + ".req"))
        self.assertIsNone(pathsafe.REQ_RE.match("a" * 31 + ".req"))
        self.assertIsNotNone(pathsafe.REQ_RE.match("a" * 32 + ".req"))


class EjecutorSeguro(unittest.TestCase):
    def test_no_hay_forma_de_ejecutar_un_comando_que_no_este_en_la_tabla(self):
        r = Runner()
        for malo in ("rm", "docker", "sh -c id", "", "ss ", "SS", "../ss", None):
            with self.assertRaises((ArgumentoNoPermitido, TypeError, AttributeError), msg=repr(malo)):
                r.run(malo)

    def test_argumentos_con_metacaracteres_no_se_aceptan(self):
        r = Runner()
        for malo in ("a;id", "a b", "a&&id", "$(id)", "`id`", "a\nb", "../x", "a|b", "a'b", 'a"b', "", " ", "-x", "--rm", "a" * 200, None, 5):
            with self.assertRaises(ArgumentoNoPermitido, msg=repr(malo)):
                r.run("docker_service_logs", arg=malo)

    def test_consultas_y_tablas_no_arbitrarias(self):
        r = Runner()
        for malo in ("x'; DROP TABLE a; --", 'data_table_user_1"; DROP', "data_table_user_", "otra_tabla", "data_table_user_../x", None):
            with self.assertRaises(ArgumentoNoPermitido, msg=repr(malo)):
                r.run("pg_query", arg="ctr_pg", query_id="filas_tabla", tabla=malo)
        with self.assertRaises(ArgumentoNoPermitido):
            r.run("pg_query", arg="ctr_pg", query_id="DROP TABLE x")
        with self.assertRaises(ArgumentoNoPermitido):
            r.run("pg_query", arg="ctr; id", query_id="version")

    def test_sin_shell_los_metacaracteres_del_argumento_son_texto(self):
        # Ejecuta un proceso REAL de prueba (solo imprime) para demostrar que no hay intérprete de órdenes.
        specs = {"eco": spec_python("import sys;print(sys.argv[1])", arg_re=r"[A-Za-z0-9;&|$`.-]{1,20}")}
        res = Runner(specs=specs, env={"PATH": os.environ.get("PATH", "")}).run("eco", arg="a;b&&c|$HOME")
        self.assertEqual(res.salida.strip(), "a;b&&c|$HOME")

    def test_entorno_minimo_no_hereda_secretos(self):
        os.environ["TAI_CANARIO_SECRETO"] = "VALOR-CANARIO-" + "Q" * 20
        try:
            specs = {"env": spec_python("import os;print(sorted(os.environ))")}
            res = Runner(specs=specs, env={"PATH": os.environ.get("PATH", ""), "LC_ALL": "C"}).run("env")
            self.assertNotIn("TAI_CANARIO_SECRETO", res.salida)
        finally:
            del os.environ["TAI_CANARIO_SECRETO"]
        self.assertEqual(set(runner.minimal_env()), {"PATH", "LC_ALL", "LANG", "HOME", "DOCKER_CONFIG"})

    def test_limite_de_tiempo(self):
        specs = {"lento": spec_python("import time;time.sleep(30)")}
        res = Runner(specs=specs, timeout=1, env={"PATH": os.environ.get("PATH", "")}).run("lento")
        self.assertTrue(res.tiempo_agotado)
        self.assertFalse(res.ok)

    def test_limite_de_tamano_de_salida(self):
        specs = {"mucho": spec_python("import sys\nwhile True: sys.stdout.write('x'*1000)")}
        res = Runner(specs=specs, timeout=10, max_bytes=5000, env={"PATH": os.environ.get("PATH", "")}).run("mucho")
        self.assertTrue(res.truncada)
        self.assertLessEqual(len(res.salida), 5000)

    def test_comando_inexistente_es_un_error_controlado(self):
        res = Runner(specs={"x": {"argv": ["/no/existe/binario"]}}).run("x")
        self.assertEqual(res.error, "no_ejecutable")
        self.assertFalse(res.ok)


class TablaDeComandos(unittest.TestCase):
    """Garantía estática de «solo lectura»: lo que la tabla permite ejecutar."""
    DOCKER_SUBCOMANDOS = {("node", "ls"), ("service", "ls"), ("service", "ps"), ("service", "logs"), ("stats",), ("network", "ls"),
                          ("network", "inspect"), ("system", "df"), ("volume", "ls"), ("ps",), ("exec",)}
    VERBOS_DE_ESCRITURA = {"rm", "run", "kill", "restart", "update", "create", "start", "stop", "pause", "prune", "build", "pull", "push",
                           "login", "logout", "scale", "rollback", "deploy", "cp", "commit", "tag", "load", "save", "import", "export", "swarm", "secret", "config"}

    def test_todo_comando_es_absoluto_y_sin_intermediarios(self):
        for nombre, spec in SPECS.items():
            exe = spec["argv"][0]
            self.assertTrue(exe.startswith("/usr/"), nombre)
            self.assertNotIn(os.path.basename(exe), {"sh", "bash", "dash", "env", "sudo", "su", "xargs", "eval", "python3", "perl", "ruby", "node"}, nombre)

    def test_docker_solo_con_subcomandos_de_lectura_y_formato_fijo(self):
        for nombre, spec in SPECS.items():
            argv = spec["argv"]
            if os.path.basename(argv[0]) != "docker":
                continue
            sub = tuple(a for a in argv[1:3] if not a.startswith("-"))
            self.assertTrue(any(sub[:len(p)] == p for p in self.DOCKER_SUBCOMANDOS), "%s: %r" % (nombre, argv))
            self.assertFalse(set(argv[1:3]) & self.VERBOS_DE_ESCRITURA, nombre)
            if nombre != "pg_query" and nombre not in ("docker_service_logs", "docker_volume_count"):
                self.assertIn("--format", argv, nombre)
            self.assertNotIn("inspect", argv[1:2], "nunca `docker inspect` (incluye variables de entorno)")
            for a in argv:
                self.assertNotRegex(a, r"\.Env|\.Config|\.Spec|\.Secrets|\.Labels|\.Options", nombre)

    def test_unico_exec_es_el_de_postgres_en_solo_lectura(self):
        execs = [n for n, s in SPECS.items() if "exec" in s["argv"]]
        self.assertEqual(execs, ["pg_query"])
        argv = SPECS["pg_query"]["argv"]
        self.assertIn("default_transaction_read_only=on", " ".join(argv))
        self.assertIn("statement_timeout=5000", " ".join(argv))

    def test_consultas_sql_son_de_solo_lectura_y_acotadas(self):
        prohibido = re.compile(r"\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|vacuum|call|do|execute|set|reset|begin|commit|lock|listen|notify|reindex|cluster|refresh|import|into)\b|pg_read_file|pg_ls_dir|lo_import|lo_export|dblink|--|/\*|;", re.IGNORECASE)
        todas = list(QUERIES.values()) + [t for t, _ in QUERY_TEMPLATES.values()]
        for q in todas:
            self.assertRegex(q, r"^(SELECT|SHOW)\b")
            self.assertNotRegex(q, prohibido, q)
            self.assertNotRegex(q, r"SELECT\s+\*", q)
            self.assertNotRegex(q, r"\bpayload\b|credentials_entity|\bdata\b\s*(,|FROM)", q)

    def test_identificadores_de_tabla_solo_con_prefijo_conocido(self):
        for _, rx in QUERY_TEMPLATES.values():
            self.assertTrue(rx.startswith("data_table_user_"))


if __name__ == "__main__":
    unittest.main()
