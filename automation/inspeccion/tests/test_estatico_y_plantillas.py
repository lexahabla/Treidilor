# -*- coding: utf-8 -*-
"""Garantías estáticas («no modifica producción»), plantillas de despliegue y manifiesto de integridad."""
import ast
import os
import re
import stat
import unittest

import helpers as H
from tai_inspect import manifest

RAIZ = H.RAIZ
PAQUETE = os.path.join(RAIZ, "tai_inspect")
FUENTES = [os.path.join(d, f) for d, _, fs in os.walk(PAQUETE) for f in fs if f.endswith(".py")]
BIN = [os.path.join(RAIZ, "bin", f) for f in os.listdir(os.path.join(RAIZ, "bin"))]

IMPORTS_PROHIBIDOS = {"socket", "ssl", "urllib", "http", "requests", "ftplib", "smtplib", "telnetlib", "xmlrpc", "ctypes", "pickle", "marshal",
                      "shelve", "importlib", "pty", "pdb", "code", "codeop", "cgi", "webbrowser", "asyncio", "multiprocessing", "sqlite3", "shutil", "tempfile"}
LLAMADAS_PROHIBIDAS = {"eval", "exec", "compile", "__import__", "system", "popen", "execv", "execve", "execl", "execlp", "execvp", "spawnl", "spawnv",
                       "fork", "forkpty", "mkdir", "makedirs", "rmdir", "removedirs", "rename", "chmod", "chown", "symlink", "link", "truncate", "setuid", "setgid"}


def _arbol(ruta):
    with open(ruta, encoding="utf-8") as f:
        return ast.parse(f.read(), ruta)


def _modulo(ruta):
    return os.path.splitext(os.path.basename(ruta))[0]


class AnalisisEstatico(unittest.TestCase):
    def test_sin_red_ni_modulos_peligrosos(self):
        for ruta in FUENTES:
            for nodo in ast.walk(_arbol(ruta)):
                nombres = []
                if isinstance(nodo, ast.Import):
                    nombres = [a.name.split(".")[0] for a in nodo.names]
                elif isinstance(nodo, ast.ImportFrom) and nodo.level == 0 and nodo.module:
                    nombres = [nodo.module.split(".")[0]]
                for n in nombres:
                    self.assertNotIn(n, IMPORTS_PROHIBIDOS, "%s importa %s" % (ruta, n))

    def test_subprocess_solo_en_el_ejecutor_y_sin_shell(self):
        for ruta in FUENTES:
            usa = False
            for nodo in ast.walk(_arbol(ruta)):
                if isinstance(nodo, (ast.Import, ast.ImportFrom)):
                    mods = [a.name for a in nodo.names] if isinstance(nodo, ast.Import) else [nodo.module or ""]
                    if any(m.split(".")[0] == "subprocess" for m in mods):
                        usa = True
                if isinstance(nodo, ast.keyword) and nodo.arg == "shell":
                    self.assertTrue(isinstance(nodo.value, ast.Constant) and nodo.value.value is False, "%s usa shell≠False" % ruta)
            if usa:
                self.assertEqual(_modulo(ruta), "runner")

    def test_sin_ejecucion_dinamica_ni_cambios_de_sistema(self):
        for ruta in FUENTES:
            for nodo in ast.walk(_arbol(ruta)):
                if isinstance(nodo, ast.Call):
                    f = nodo.func
                    nombre = f.id if isinstance(f, ast.Name) else (f.attr if isinstance(f, ast.Attribute) else "")
                    if isinstance(f, ast.Attribute) and nombre == "compile":
                        continue            # re.compile es una expresión regular, no la función integrada compile()
                    self.assertNotIn(nombre, LLAMADAS_PROHIBIDAS, "%s llama a %s" % (ruta, nombre))
                    if nombre == "getattr" and len(nodo.args) >= 2 and isinstance(nodo.args[1], ast.Constant):
                        self.assertNotIn(nodo.args[1].value, LLAMADAS_PROHIBIDAS | {"O_TRUNC"}, ruta)

    def test_borrado_solo_donde_corresponde(self):
        permitidos = {"limits", "collector", "gate"}
        for ruta in FUENTES:
            for nodo in ast.walk(_arbol(ruta)):
                if isinstance(nodo, ast.Call) and isinstance(nodo.func, ast.Attribute) and nodo.func.attr in ("unlink", "remove"):
                    self.assertIn(_modulo(ruta), permitidos, ruta)

    def test_escritura_de_archivos_solo_en_los_modulos_previstos(self):
        """`open(..., 'w')` solo en manifest (utilidad de administración); el resto escribe con os.open O_EXCL/O_APPEND controlados."""
        for ruta in FUENTES:
            for nodo in ast.walk(_arbol(ruta)):
                if isinstance(nodo, ast.Call) and isinstance(nodo.func, ast.Name) and nodo.func.id == "open":
                    modo = None
                    if len(nodo.args) >= 2 and isinstance(nodo.args[1], ast.Constant):
                        modo = nodo.args[1].value
                    for kw in nodo.keywords:
                        if kw.arg == "mode" and isinstance(kw.value, ast.Constant):
                            modo = kw.value.value
                    if modo and any(c in str(modo) for c in "wax+"):
                        self.assertEqual(_modulo(ruta), "manifest", "%s escribe con open()" % ruta)

    def test_ningun_comando_de_modificacion_en_el_codigo_fuente(self):
        patrones = re.compile(r"\b(rm -rf|docker (rm|run|kill|restart|update|stop|start|prune)|systemctl (restart|stop|start|enable|disable)|apt (install|remove|upgrade)|chmod|chown|useradd|usermod|iptables|ufw)\b")
        for ruta in FUENTES:
            for i, linea in enumerate(open(ruta, encoding="utf-8"), 1):
                if linea.lstrip().startswith("#"):
                    continue
                self.assertIsNone(patrones.search(linea), "%s:%d %s" % (ruta, i, linea.strip()))

    def test_finales_de_linea_lf_y_lanzadores(self):
        for ruta in FUENTES + BIN + [os.path.join(RAIZ, "deploy", n) for n in ("authorized_keys.example", "LEEME-DESPLIEGUE.md")]:
            with open(ruta, "rb") as f:
                self.assertNotIn(b"\r", f.read(), "%s tiene CRLF" % ruta)
        for ruta in BIN:
            with open(ruta, encoding="utf-8") as f:
                self.assertEqual(f.readline().rstrip("\n"), "#!/usr/bin/python3 -I", ruta)
            compile(open(ruta, encoding="utf-8").read(), ruta, "exec")

    def test_los_puntos_de_entrada_no_leen_rutas_ni_limites_del_entorno(self):
        # Solo se permiten estas lecturas del entorno en el gate (datos de sshd); nada que cambie rutas o límites.
        permitidas = {"SSH_ORIGINAL_COMMAND", "SSH_CONNECTION"}
        for ruta in FUENTES:
            fuente = open(ruta, encoding="utf-8").read()
            for m in re.finditer(r"os\.environ(?:\.get)?\(?\[?[\"']([A-Z_]+)[\"']", fuente):
                self.assertIn(m.group(1), permitidas, "%s lee %s" % (ruta, m.group(1)))
            self.assertNotIn("os.getenv", fuente, ruta)


class Plantillas(unittest.TestCase):
    def leer(self, *p):
        with open(os.path.join(RAIZ, "deploy", *p), encoding="utf-8") as f:
            return f.read()

    def test_sshd_match(self):
        texto = self.leer("sshd_config.d", "00-tai-inspect.conf")
        lineas = [l.strip() for l in texto.splitlines() if l.strip() and not l.strip().startswith("#")]
        self.assertEqual(lineas[0], "Match User tai-inspect")
        d = {}
        for l in lineas[1:]:
            k, v = l.split(None, 1)
            d[k] = v
        validas_en_match = {"ForceCommand", "PermitTTY", "DisableForwarding", "AllowTcpForwarding", "AllowAgentForwarding", "X11Forwarding", "PermitTunnel",
                            "GatewayPorts", "PermitUserRC", "PasswordAuthentication", "KbdInteractiveAuthentication", "AuthenticationMethods", "MaxSessions",
                            "MaxAuthTries", "ClientAliveInterval", "ClientAliveCountMax", "AuthorizedKeysFile", "AuthorizedKeysCommand",
                            "AuthorizedPrincipalsFile", "PermitOpen"}
        self.assertTrue(set(d) <= validas_en_match, set(d) - validas_en_match)
        self.assertEqual(d["ForceCommand"], "/opt/tai-inspect/bin/tai-gate")
        for k in ("PermitTTY", "AllowTcpForwarding", "AllowAgentForwarding", "X11Forwarding", "PermitTunnel", "PasswordAuthentication", "KbdInteractiveAuthentication", "PermitUserRC"):
            self.assertEqual(d[k], "no", k)
        self.assertEqual(d["DisableForwarding"], "yes")
        self.assertEqual(d["AuthenticationMethods"], "publickey")
        self.assertEqual(d["MaxSessions"], "1")
        # decisiones aprobadas: clave en un archivo de ROOT (no en el home del usuario), sin comandos de claves y sin reenvíos
        self.assertEqual(d["AuthorizedKeysFile"], "/etc/ssh/authorized_keys.tai-inspect")
        self.assertEqual((d["AuthorizedKeysCommand"], d["AuthorizedPrincipalsFile"], d["PermitOpen"]), ("none", "none", "none"))
        self.assertNotIn(".ssh", d["AuthorizedKeysFile"])
        self.assertNotIn("PermitUserEnvironment", d, "no es válida dentro de un Match (la rechaza `sshd -t`)")

    def test_el_nombre_del_archivo_ordena_primero_y_la_precedencia_esta_documentada(self):
        nombres = sorted(os.listdir(os.path.join(RAIZ, "deploy", "sshd_config.d")))
        self.assertEqual(nombres, ["00-tai-inspect.conf"])
        texto = self.leer("sshd_config.d", "00-tai-inspect.conf")
        self.assertIn("PRECEDENCIA", texto)
        self.assertIn("99-", texto)

    def test_documento_de_despliegue_con_las_decisiones_aprobadas(self):
        texto = self.leer("LEEME-DESPLIEGUE.md")
        for fragmento in ("--shell /bin/sh", "usermod -p '*'", "-m 0555 /var/lib/tai-inspect/home", "/etc/ssh/authorized_keys.tai-inspect",
                          "00-tai-inspect.conf", "sshd -T -C user=root", "no garantiza prioridad"):
            self.assertIn(fragmento, texto)
        self.assertNotRegex(texto, r"--shell /(usr/sbin/)?nologin")

    def test_authorized_keys_restringido_y_sin_clave_real(self):
        lineas = [l for l in self.leer("authorized_keys.example").splitlines() if l.strip() and not l.startswith("#")]
        self.assertEqual(len(lineas), 1)
        self.assertTrue(lineas[0].startswith('restrict,command="/opt/tai-inspect/bin/tai-gate" ssh-ed25519 '))
        self.assertIn("MARCADOR", lineas[0], "debe ser un marcador, no una clave real")
        self.assertIn("/etc/ssh/authorized_keys.tai-inspect", self.leer("authorized_keys.example"))

    def test_unidad_systemd_aislada(self):
        texto = self.leer("systemd", "tai-collector.service")
        kv = dict(l.split("=", 1) for l in texto.splitlines() if "=" in l and not l.startswith("#"))
        for k, v in {"NoNewPrivileges": "yes", "ProtectSystem": "strict", "ProtectHome": "yes", "PrivateTmp": "yes", "PrivateDevices": "yes",
                     "RestrictAddressFamilies": "AF_UNIX", "IPAddressDeny": "any", "MemoryDenyWriteExecute": "yes", "LockPersonality": "yes",
                     "RestrictNamespaces": "yes", "ReadWritePaths": "/var/lib/tai-inspect /var/log/tai-inspect", "Type": "oneshot",
                     "ExecStart": "/opt/tai-inspect/bin/tai-collector"}.items():
            self.assertEqual(kv.get(k), v, k)
        for k in ("MemoryMax", "CPUQuota", "TasksMax", "TimeoutStartSec"):
            self.assertIn(k, kv)
        self.assertNotIn("SupplementaryGroups", kv)
        self.assertNotIn("Environment", kv)
        self.assertNotIn("EnvironmentFile", kv)
        self.assertNotRegex(texto, r"docker\.sock|ExecStartPre|ExecStartPost|Restart=")
        self.assertEqual(kv["CapabilityBoundingSet"], "CAP_DAC_READ_SEARCH")

    def test_unidad_path(self):
        texto = self.leer("systemd", "tai-collector.path")
        self.assertIn("DirectoryNotEmpty=/var/lib/tai-inspect/requests", texto)
        self.assertIn("Unit=tai-collector.service", texto)
        self.assertIn("TriggerLimitBurst=", texto)


class Manifiesto(unittest.TestCase):
    def setUp(self):
        self.ent = H.Entorno()
        self.inst = os.path.join(self.ent.raiz, "instalacion")
        os.makedirs(os.path.join(self.inst, "bin"))
        for rel, c in (("bin/tai-gate", "a"), ("modulo.py", "b"), ("enabled.json", "[]")):
            with open(os.path.join(self.inst, rel), "w") as f:
                f.write(c)
        self.man = os.path.join(self.ent.raiz, "MANIFEST.json")
        manifest.guardar(self.inst, self.man, comprobar_permisos=False)

    def tearDown(self):
        self.ent.limpiar()

    def test_estado_limpio(self):
        r = manifest.verificar(self.inst, self.man, comprobar_permisos=False)
        self.assertTrue(r["ok"])
        self.assertEqual(r["archivos"], 3)

    def test_deteccion_de_cambios_altas_y_bajas(self):
        with open(os.path.join(self.inst, "modulo.py"), "w") as f:
            f.write("MODIFICADO")
        with open(os.path.join(self.inst, "nuevo.py"), "w") as f:
            f.write("extra")
        os.remove(os.path.join(self.inst, "enabled.json"))
        r = manifest.verificar(self.inst, self.man, comprobar_permisos=False)
        self.assertFalse(r["ok"])
        self.assertEqual((r["distintos"], r["sobran"], r["faltan"]), (1, 1, 1))
        self.assertNotIn("MODIFICADO", str(r), "el informe no incluye contenido de archivos")

    def test_manifiesto_ausente_o_corrupto(self):
        self.assertFalse(manifest.verificar(self.inst, os.path.join(self.ent.raiz, "no.json"), False)["ok"])
        with open(self.man, "w") as f:
            f.write("{roto")
        self.assertFalse(manifest.verificar(self.inst, self.man, False)["ok"])

    def test_enlaces_simbolicos_se_marcan(self):
        try:
            os.symlink(os.path.join(self.inst, "modulo.py"), os.path.join(self.inst, "enlace.py"))
        except (OSError, NotImplementedError):
            self.skipTest("sin enlaces simbólicos")
        r = manifest.verificar(self.inst, self.man, comprobar_permisos=False)
        self.assertFalse(r["ok"])
        self.assertGreaterEqual(r["problemas"], 1)

    @unittest.skipIf(os.name == "nt", "los permisos POSIX no existen en Windows")
    def test_ficheros_escribibles_por_otros(self):
        os.chmod(os.path.join(self.inst, "modulo.py"), stat.S_IMODE(0o666))
        self.assertFalse(manifest.verificar(self.inst, self.man, comprobar_permisos=True)["ok"])

    def test_el_propio_paquete_tiene_manifiesto_estable(self):
        man, _ = manifest.construir(RAIZ, comprobar_permisos=False)
        self.assertIn("tai_inspect/gate.py", man)
        self.assertIn("bin/tai-gate", man)
        self.assertFalse(any("__pycache__" in k for k in man))
        man2, _ = manifest.construir(RAIZ, comprobar_permisos=False)
        self.assertEqual(man, man2)


if __name__ == "__main__":
    unittest.main()
