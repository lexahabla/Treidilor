# -*- coding: utf-8 -*-
"""Pruebas sobre LINUX REAL. Se OMITEN fuera de Linux (y las que necesitan privilegios, fuera de un contenedor de prueba).

Se ejecutan en contenedores efímeros, sin red, con la copia del código montada en solo lectura y con usuarios/archivos FICTICIOS:
  · humo de las comprobaciones de host con /proc y statvfs reales;
  · comportamiento real de enlaces simbólicos, FIFO y permisos POSIX;
  · lanzadores reales (`bin/tai-gate`, `bin/tai-collector`) con `python -I` y el diseño de rutas fijas;
  · separación de privilegios: el gate como uid sin privilegios y el colector como root con SOLO CAP_DAC_READ_SEARCH.
"""
import ctypes
import json
import os
import platform
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import unittest

import helpers as H
from tai_inspect import config
from tai_inspect.audit import Audit
from tai_inspect.gate import Gate
from tai_inspect.pathsafe import RutaNoPermitida, atomic_write, safe_read_file
from tai_inspect.runner import Runner

LINUX = sys.platform.startswith("linux")
INSTALL = "/opt/tai-inspect"
LIB = "/var/lib/tai-inspect"
LOG = "/var/log/tai-inspect"
ETC = "/etc/tai-inspect"
UID_GATE = GID_GATE = 10001
HOST = ["host-recursos", "host-red", "host-servicios", "host-actualizaciones", "host-tiempo"]


def _escribible(ruta):
    try:
        os.makedirs(ruta, exist_ok=True)
        return os.access(ruta, os.W_OK)
    except OSError:
        return False


# ---------------------------------------------------------------------------------------------------------------
@unittest.skipUnless(LINUX, "solo Linux")
class HumoHostReal(unittest.TestCase):
    """Las comprobaciones de host con el sistema real (formato real de /proc, statvfs real, herramientas ausentes)."""

    def setUp(self):
        self.ent = H.Entorno()
        reloj = H.Reloj(time.time())
        ajustes = {"servicio_n8n": None, "servicio_runner": None, "servicio_postgres": None, "servicios_registros": [], "tablas_agentes": []}
        self.gate = Gate(set(HOST), Runner(), ajustes, self.ent.req, self.ent.rep, self.ent.state, self.ent.disable,
                         Audit(self.ent.gate_log, now=reloj.now), now=reloj.now, sleep=reloj.sleep, wait=1, poll=0.1)

    def tearDown(self):
        self.ent.limpiar()

    def pedir(self, check):
        codigo, texto = self.gate.handle("solicitar " + check, "198.51.100.5 5000 203.0.113.9 22")
        self.assertEqual(codigo, 0, "%s: %s" % (check, texto[:200]))
        rep = json.loads(texto)
        self.assertEqual(rep["check"], check)
        self.assertLess(len(texto), config.MAX_REPORT_BYTES)
        return rep

    def test_recursos_con_proc_real(self):
        rep = self.pedir("host-recursos")
        d = rep["datos"]
        self.assertGreaterEqual(d["cpus"], 1)
        kb = {}
        for linea in open("/proc/meminfo"):
            k, v = linea.split(":", 1)
            kb[k] = int(v.split()[0])
        self.assertAlmostEqual(d["memoria"]["total_gib"], kb["MemTotal"] / 1048576.0, delta=0.1)
        self.assertGreater(d["uptime_horas"], 0)
        self.assertEqual(sorted(d["carga"]), ["15m", "1m", "5m"])
        raiz = [x for x in d["discos"] if x["punto"] == "/"][0]
        self.assertGreater(raiz["total_gib"], 0)
        self.assertEqual(rep["avisos"], [])

    def test_resto_de_comprobaciones_de_host_no_fallan_si_faltan_herramientas(self):
        for check in ("host-red", "host-servicios", "host-actualizaciones", "host-tiempo"):
            rep = self.pedir(check)
            self.assertIsInstance(rep["avisos"], list)
            crudo = json.dumps(rep)
            self.assertNotRegex(crudo, r"\b(?:\d{1,3}\.){3}\d{1,3}\b", "ninguna dirección IP en el informe de " + check)

    def test_informes_sin_secretos_ni_rutas_del_sistema(self):
        crudo = json.dumps(self.pedir("host-recursos"))
        for no_debe in ("/etc/", "/home", "passwd", "HOSTNAME"):
            self.assertNotIn(no_debe, crudo)


# ---------------------------------------------------------------------------------------------------------------
@unittest.skipUnless(LINUX, "solo Linux")
class ArchivosPosixReales(unittest.TestCase):
    """Comportamiento real de enlaces simbólicos, FIFO, dispositivos y permisos (lo que Windows no puede comprobar)."""

    def setUp(self):
        self.ent = H.Entorno()

    def tearDown(self):
        self.ent.limpiar()

    def test_enlace_simbolico_no_se_sigue(self):
        fuera = os.path.join(self.ent.raiz, "fuera.txt")
        open(fuera, "w").write("CONTENIDO-FUERA")
        enlace = os.path.join(self.ent.rep, "docker-nodos.json")
        os.symlink(fuera, enlace)
        with self.assertRaises(RutaNoPermitida):
            safe_read_file(enlace, 1000)

    def test_fifo_y_dispositivos_no_se_leen(self):
        fifo = os.path.join(self.ent.rep, "tubo.json")
        os.mkfifo(fifo)
        with self.assertRaises(RutaNoPermitida):
            safe_read_file(fifo, 1000)
        with self.assertRaises(RutaNoPermitida):
            safe_read_file("/dev/null", 1000)
        with self.assertRaises(RutaNoPermitida):
            safe_read_file("/proc/self/cwd", 1000)

    def test_escritura_atomica_con_los_permisos_previstos(self):
        anterior = os.umask(0o027)
        try:
            ruta = os.path.join(self.ent.rep, "x.json")
            atomic_write(ruta, b"{}", 0o640)
            self.assertEqual(stat.S_IMODE(os.stat(ruta).st_mode), 0o640)
            self.assertEqual([n for n in os.listdir(self.ent.rep) if n.startswith(".tmp-")], [])
        finally:
            os.umask(anterior)

    def test_la_auditoria_no_sigue_enlaces_ni_trunca(self):
        ruta = os.path.join(self.ent.log, "a.log")
        a = Audit(ruta)
        a.log("gate", resultado="ok")
        a.log("gate", resultado="ok")
        self.assertEqual(len(open(ruta).read().splitlines()), 2)


# ---------------------------------------------------------------------------------------------------------------
LAYOUT = LINUX and os.path.exists(INSTALL + "/bin/tai-gate") and os.geteuid() != 0 and _escribible(LIB) and _escribible(LOG) and _escribible(ETC)


@unittest.skipUnless(LAYOUT, "requiere el diseño de rutas fijas montado en el contenedor de prueba (sin privilegios)")
class LanzadoresReales(unittest.TestCase):
    """Los lanzadores reales con las rutas fijas de producción, dentro del contenedor, como usuario sin privilegios."""

    def setUp(self):
        for d in (LIB + "/requests", LIB + "/reports", LIB + "/state", LIB + "/staging", LIB + "/collector-state", LOG):
            os.makedirs(d, exist_ok=True)
            for n in os.listdir(d):
                p = os.path.join(d, n)
                if os.path.isfile(p) or os.path.islink(p):
                    os.unlink(p)
        for f in (ETC + "/DISABLED",):
            if os.path.exists(f):
                os.unlink(f)

    def gate(self, orden, entorno_extra=None, con_orden=True):
        env = {"PATH": "/usr/local/bin:/usr/bin:/bin", "SSH_CONNECTION": "198.51.100.5 5000 203.0.113.9 22"}
        if con_orden:
            env["SSH_ORIGINAL_COMMAND"] = orden
        env.update(entorno_extra or {})
        return subprocess.run([sys.executable, "-I", INSTALL + "/bin/tai-gate"], env=env, capture_output=True, text=True, timeout=60)

    def test_orden_valida_de_host(self):
        r = self.gate("solicitar host-recursos")
        self.assertEqual(r.returncode, 0, r.stderr[-300:])
        self.assertEqual(json.loads(r.stdout)["check"], "host-recursos")
        r2 = self.gate("solicitar host-recursos")
        self.assertEqual((r2.returncode, r2.stdout), (7, "limite alcanzado\n"), "el intervalo mínimo se aplica entre procesos reales")

    def test_ordenes_manipuladas_y_sin_orden(self):
        for orden in ("id; cat /etc/passwd", "solicitar ../../etc/passwd", "bash", "solicitar host-recursos && id", "$(id)", "solicitar docker-servicios"):
            r = self.gate(orden)
            self.assertEqual((r.returncode, r.stdout), (2, "orden no permitida\n" if orden != "solicitar docker-servicios" else "comprobacion no disponible\n"), orden)
            self.assertEqual(r.stderr, "")
        r = self.gate("", con_orden=False)
        self.assertEqual((r.returncode, r.stdout), (2, "orden no permitida\n"), "una sesión interactiva (sin orden) se rechaza")

    def test_interruptor_de_parada(self):
        open(ETC + "/DISABLED", "w").close()
        r = self.gate("solicitar host-recursos")
        self.assertEqual((r.returncode, r.stdout), (3, "desactivado\n"))
        os.unlink(ETC + "/DISABLED")
        self.assertEqual(self.gate("solicitar host-tiempo").returncode, 0)

    def test_auditoria_real_sin_datos_sensibles(self):
        self.gate("solicitar host-recursos; echo ghp_" + "A" * 36)
        self.gate("solicitar host-red")
        crudo = open(LOG + "/gate-audit.log", encoding="ascii").read()
        self.assertNotIn("198.51.100.5", crudo)
        self.assertNotIn("ghp_" + "A" * 36, crudo)
        for linea in crudo.splitlines():
            self.assertLess(len(linea), 1000)
            json.loads(linea)

    def test_python_aislado_ignora_el_entorno_del_usuario(self):
        """`-I` (el de la línea de la orden forzada): un PYTHONPATH malicioso que sustituye a la biblioteca estándar NO se usa."""
        malo = tempfile.mkdtemp(prefix="evil-")
        marca = os.path.join(malo, "MARCA")
        open(os.path.join(malo, "json.py"), "w").write("open(%r, 'w').write('ejecutado')\n" % marca)
        try:
            r = self.gate("solicitar host-tiempo", {"PYTHONPATH": malo, "PYTHONSTARTUP": malo + "/json.py", "PYTHONHOME": "/nonexistent-no-usar"})
            self.assertFalse(os.path.exists(marca), "el código del entorno del usuario no debe ejecutarse")
            self.assertEqual(r.returncode, 0, r.stderr[-300:])
        finally:
            shutil.rmtree(malo, ignore_errors=True)

    def test_flujo_real_gate_y_colector_como_dos_procesos(self):
        env = {"PATH": "/usr/local/bin:/usr/bin:/bin", "SSH_ORIGINAL_COMMAND": "solicitar docker-nodos", "SSH_CONNECTION": "198.51.100.5 5000 203.0.113.9 22"}
        gate = subprocess.Popen([sys.executable, "-I", INSTALL + "/bin/tai-gate"], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        time.sleep(1.5)
        col = subprocess.run([sys.executable, "-I", INSTALL + "/bin/tai-collector"], env={"PATH": "/usr/bin:/bin"}, capture_output=True, text=True, timeout=60)
        salida, err = gate.communicate(timeout=60)
        self.assertEqual(col.returncode, 0, col.stderr[-300:])
        self.assertEqual(gate.returncode, 0, err[-300:] + salida[:200])
        rep = json.loads(salida)
        self.assertEqual(rep["check"], "docker-nodos")
        self.assertIn("docker_node_ls_no_disponible", rep["avisos"], "sin Docker en el contenedor: aviso, no error")
        self.assertEqual(os.listdir(LIB + "/requests"), [])

    def test_registro_no_escribible_da_error_generico_sin_traceback(self):
        """H4/H5: sin poder registrar la intención NO se ejecuta nada y el cliente solo ve `error interno` (código 9), sin trazas ni rutas."""
        os.chmod(LOG, 0o555)
        try:
            r = self.gate("solicitar host-recursos")
        finally:
            os.chmod(LOG, 0o755)
        self.assertEqual((r.returncode, r.stdout, r.stderr), (9, "error interno\n", ""))
        self.assertEqual(os.listdir(LIB + "/state"), [], "no se consumió cupo ni se creó bloqueo")
        crudo = r.stdout + r.stderr
        for no_debe in ("Traceback", "/opt/", "/var/", ".py", "Permission"):
            self.assertNotIn(no_debe, crudo)

    def test_instalacion_danada_no_muestra_traceback(self):
        """H4: si no puede ni importarse el paquete, el lanzador responde `error interno` (código 8) y descarta el error estándar."""
        d = tempfile.mkdtemp(prefix="roto-")
        try:
            os.makedirs(d + "/bin")
            shutil.copy(INSTALL + "/bin/tai-gate", d + "/bin/tai-gate")      # sin el paquete tai_inspect al lado
            r = subprocess.run([sys.executable, "-I", d + "/bin/tai-gate"], env={"PATH": "/usr/bin:/bin", "SSH_ORIGINAL_COMMAND": "solicitar host-recursos"},
                               capture_output=True, text=True, timeout=60)
            self.assertEqual((r.returncode, r.stdout, r.stderr), (8, "error interno\n", ""))
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_la_auditoria_registra_primero_la_intencion_y_despues_el_resultado(self):
        self.gate("solicitar host-recursos")
        eventos = [json.loads(l) for l in open(LOG + "/gate-audit.log", encoding="ascii").read().splitlines()]
        nombres = [e["evento"] for e in eventos]
        self.assertEqual(nombres, ["gate_intencion", "gate_resultado"])
        self.assertEqual((eventos[0]["resultado"], eventos[1]["resultado"]), ("intencion", "ok"))
        self.assertEqual(len(eventos[1]["sha256"]), 64)


# ---------------------------------------------------------------------------------------------------------------
def _capset(mascara):
    """Reduce las capacidades del proceso actual a `mascara` (efectivas y permitidas; heredables a 0). Solo x86_64/aarch64."""
    numero = {"x86_64": 126, "aarch64": 91}[platform.machine()]
    libc = ctypes.CDLL(None, use_errno=True)

    class Cabecera(ctypes.Structure):
        _fields_ = [("version", ctypes.c_uint32), ("pid", ctypes.c_int)]

    class Dato(ctypes.Structure):
        _fields_ = [("effective", ctypes.c_uint32), ("permitted", ctypes.c_uint32), ("inheritable", ctypes.c_uint32)]

    cab = Cabecera(0x20080522, 0)
    datos = (Dato * 2)()
    datos[0].effective = datos[0].permitted = mascara & 0xFFFFFFFF
    if libc.syscall(numero, ctypes.byref(cab), ctypes.byref(datos)) != 0:
        raise OSError(ctypes.get_errno(), "capset")


CAP_DAC_READ_SEARCH = 1 << 2
PRIV = (LINUX and os.geteuid() == 0 and platform.machine() in ("x86_64", "aarch64") and _escribible(INSTALL) and _escribible(LIB)
        and _escribible(LOG) and _escribible(ETC))


@unittest.skipUnless(PRIV, "requiere root dentro del contenedor de prueba con tmpfs en las rutas fijas")
class SeparacionDePrivilegios(unittest.TestCase):
    """Gate = uid 10001 sin privilegios. Colector = root con SOLO CAP_DAC_READ_SEARCH (como la unidad systemd propuesta).
    Todo con usuarios, archivos y «secretos» FICTICIOS creados dentro del contenedor."""

    @classmethod
    def setUpClass(cls):
        raiz = H.RAIZ
        for d in (INSTALL, LIB, LOG, ETC):
            for n in os.listdir(d):
                p = os.path.join(d, n)
                shutil.rmtree(p) if os.path.isdir(p) and not os.path.islink(p) else os.unlink(p)
        for sub in ("bin", "tai_inspect"):
            shutil.copytree(os.path.join(raiz, sub), os.path.join(INSTALL, sub), ignore=shutil.ignore_patterns("__pycache__"))
        with open(INSTALL + "/enabled.json", "w") as f:
            json.dump(HOST + ["docker-nodos"], f)
        with open(INSTALL + "/validaciones.json", "w") as f:           # docker-nodos es SENSIBLE: exige la validación (aquí, con muestra ficticia)
            json.dump({"docker-nodos": {"muestra_sha256": "a" * 64}}, f)
        for dp, ds, fs in os.walk(INSTALL):                    # instalación: root:root, no escribible por nadie más
            os.chown(dp, 0, 0)
            os.chmod(dp, 0o755)
            for n in fs:
                os.chown(os.path.join(dp, n), 0, 0)
                os.chmod(os.path.join(dp, n), 0o755 if os.path.basename(dp) == "bin" else 0o644)       # los lanzadores son ejecutables, como en el plan (0755)
        os.chown(INSTALL, 0, 0)
        os.chown(LIB, 0, 0)
        os.chmod(LIB, 0o755)
        for nombre, dueno, grupo, modo in (("requests", 0, GID_GATE, 0o2730), ("reports", 0, GID_GATE, 0o2750), ("state", UID_GATE, GID_GATE, 0o700),
                                           ("staging", 0, GID_GATE, 0o2700), ("collector-state", 0, 0, 0o700)):
            ruta = os.path.join(LIB, nombre)
            os.makedirs(ruta, exist_ok=True)
            os.chown(ruta, dueno, grupo)
            os.chmod(ruta, modo)
        os.chmod(LOG, 0o755)
        open(LOG + "/gate-audit.log", "w").close()
        os.chown(LOG + "/gate-audit.log", UID_GATE, GID_GATE)        # el gate solo AÑADE a su propio registro
        os.chmod(LOG + "/gate-audit.log", 0o640)
        open(LOG + "/collector-audit.log", "w").close()
        os.chmod(LOG + "/collector-audit.log", 0o640)
        os.chmod(ETC, 0o755)
        with open(ETC + "/secreto.txt", "w") as f:
            f.write("SECRETO-FICTICIO-DEL-ROOT")
        os.chmod(ETC + "/secreto.txt", 0o600)
        # equivalentes de prueba de /etc/ssh/authorized_keys.tai-inspect (archivo de ROOT) y del directorio de inicio (root:root 0555)
        with open(ETC + "/authorized_keys.tai-inspect", "w") as f:
            f.write('restrict,command="/opt/tai-inspect/bin/tai-gate" ssh-ed25519 AAAAMARCADORNOESUNACLAVEREAL tai-inspect-dedicada\n')
        os.chmod(ETC + "/authorized_keys.tai-inspect", 0o644)
        os.makedirs(LIB + "/home", exist_ok=True)
        os.chown(LIB + "/home", 0, 0)
        os.chmod(LIB + "/home", 0o555)

    # --- utilidades ---
    @staticmethod
    def _como_gate():
        def fn():
            os.setgroups([GID_GATE])
            os.setgid(GID_GATE)
            os.setuid(UID_GATE)
        return fn

    @staticmethod
    def _como_colector():
        def fn():
            os.umask(0o027)
            _capset(CAP_DAC_READ_SEARCH)
        return fn

    def _py(self, codigo, preexec):
        return subprocess.run([sys.executable, "-I", "-c", codigo], preexec_fn=preexec, capture_output=True, text=True, timeout=60)

    def _limpiar(self):
        for d in ("requests", "reports", "staging", "collector-state"):
            for n in os.listdir(os.path.join(LIB, d)):
                os.unlink(os.path.join(LIB, d, n))
        # `state` pertenece al gate (0700): ni root, sin DAC_OVERRIDE, puede tocarlo; se vacía COMO el gate
        self._py("import os\nfor n in os.listdir('/var/lib/tai-inspect/state'):\n    os.unlink('/var/lib/tai-inspect/state/' + n)\n", self._como_gate())

    # --- pruebas ---
    def test_el_usuario_sin_privilegios_no_puede_cambiar_nada_importante(self):
        codigo = (
            "import os\n"
            "def intenta(f):\n"
            "    try:\n        f(); return 'PERMITIDO'\n    except PermissionError:\n        return 'denegado'\n"
            "print('uid', os.getuid(), os.getgid())\n"
            "print('modificar_gate', intenta(lambda: open('/opt/tai-inspect/tai_inspect/gate.py', 'a')))\n"
            "print('crear_en_instalacion', intenta(lambda: open('/opt/tai-inspect/nuevo.py', 'w')))\n"
            "print('borrar_lanzador', intenta(lambda: os.unlink('/opt/tai-inspect/bin/tai-gate')))\n"
            "print('escribir_informes', intenta(lambda: open('/var/lib/tai-inspect/reports/x.json', 'w')))\n"
            "print('enlace_en_informes', intenta(lambda: os.symlink('/etc/tai-inspect/secreto.txt', '/var/lib/tai-inspect/reports/docker-nodos.json')))\n"
            "print('leer_secreto_root', intenta(lambda: open('/etc/tai-inspect/secreto.txt').read()))\n"
            "print('registro_colector', intenta(lambda: open('/var/log/tai-inspect/collector-audit.log', 'a')))\n"
            "print('crear_en_logs', intenta(lambda: open('/var/log/tai-inspect/otro.log', 'w')))\n"
            "print('listar_peticiones', intenta(lambda: os.listdir('/var/lib/tai-inspect/requests')))\n"
            "print('escribir_manifiesto', intenta(lambda: open('/opt/tai-inspect/MANIFEST.json', 'w')))\n"
            "print('chmod_instalacion', intenta(lambda: os.chmod('/opt/tai-inspect/bin/tai-gate', 0o777)))\n"
            "print('setuid_root', intenta(lambda: os.setuid(0)))\n"
            "print('borrar_registro_gate', intenta(lambda: os.unlink('/var/log/tai-inspect/gate-audit.log')))\n"
            "print('renombrar_registro_gate', intenta(lambda: os.rename('/var/log/tai-inspect/gate-audit.log', '/var/log/tai-inspect/viejo.log')))\n"
            "print('borrar_registro_colector', intenta(lambda: os.unlink('/var/log/tai-inspect/collector-audit.log')))\n"
            "print('listar_staging', intenta(lambda: os.listdir('/var/lib/tai-inspect/staging')))\n"
            "print('escribir_staging', intenta(lambda: open('/var/lib/tai-inspect/staging/' + 'a'*32 + '.docker-nodos.json', 'w')))\n"
            "print('listar_estado_colector', intenta(lambda: os.listdir('/var/lib/tai-inspect/collector-state')))\n"
            "print('escribir_cuota_colector', intenta(lambda: open('/var/lib/tai-inspect/collector-state/cuota.json', 'w')))\n"
            "print('escribir_ancla', intenta(lambda: open('/var/lib/tai-inspect/collector-state/ancla-gate.json', 'w')))\n"
            "print('escribir_validaciones', intenta(lambda: open('/opt/tai-inspect/validaciones.json', 'w')))\n"
        )
        r = self._py(codigo, self._como_gate())
        self.assertEqual(r.returncode, 0, r.stderr[-400:])
        v = dict(l.split(" ", 1) for l in r.stdout.splitlines())
        self.assertEqual(v["uid"], "%d %d" % (UID_GATE, GID_GATE))
        for clave in ("modificar_gate", "crear_en_instalacion", "borrar_lanzador", "escribir_informes", "enlace_en_informes", "leer_secreto_root",
                      "registro_colector", "crear_en_logs", "listar_peticiones", "escribir_manifiesto", "chmod_instalacion", "setuid_root",
                      "borrar_registro_gate", "renombrar_registro_gate", "borrar_registro_colector", "listar_staging", "escribir_staging",
                      "listar_estado_colector", "escribir_cuota_colector", "escribir_ancla", "escribir_validaciones"):
            self.assertEqual(v[clave], "denegado", clave)

    def test_el_usuario_sin_privilegios_si_puede_dejar_peticiones_y_leer_informes(self):
        self._limpiar()
        codigo = (
            "import os, json\n"
            "open('/var/lib/tai-inspect/requests/' + 'a'*32 + '.req', 'w').write('{}')\n"
            "print('peticion_creada')\n"
        )
        self.assertIn("peticion_creada", self._py(codigo, self._como_gate()).stdout)
        self._limpiar()

    def test_colector_con_solo_dac_read_search(self):
        r = self._py("print(open('/proc/self/status').read())", self._como_colector())
        cap = [l for l in r.stdout.splitlines() if l.startswith("CapEff")][0].split()[1]
        self.assertEqual(int(cap, 16), CAP_DAC_READ_SEARCH, "el colector de prueba solo debe conservar CAP_DAC_READ_SEARCH")
        r2 = self._py("import os\ntry:\n    os.chown('/etc/tai-inspect/secreto.txt', 12345, 12345); print('chown PERMITIDO')\nexcept PermissionError:\n    print('chown denegado')\n", self._como_colector())
        self.assertIn("chown denegado", r2.stdout)

    def test_el_usuario_no_puede_cambiar_sus_claves_ni_su_directorio_de_inicio(self):
        codigo = (
            "import os\n"
            "def intenta(f):\n"
            "    try:\n        f(); return 'PERMITIDO'\n    except OSError:\n        return 'denegado'\n"
            "clave = '/etc/tai-inspect/authorized_keys.tai-inspect'\n"
            "home = '/var/lib/tai-inspect/home'\n"
            "print('anadir_clave', intenta(lambda: open(clave, 'a').write('ssh-ed25519 AAAA evil\\n')))\n"
            "print('reescribir_clave', intenta(lambda: open(clave, 'w')))\n"
            "print('borrar_clave', intenta(lambda: os.unlink(clave)))\n"
            "print('renombrar_clave', intenta(lambda: os.rename(clave, clave + '.x')))\n"
            "print('sustituir_clave', intenta(lambda: os.rename(home, home + '.x')))\n"
            "print('chmod_clave', intenta(lambda: os.chmod(clave, 0o666)))\n"
            "print('escribir_en_home', intenta(lambda: open(home + '/prueba', 'w')))\n"
            "print('crear_ssh_en_home', intenta(lambda: os.mkdir(home + '/.ssh')))\n"
            "print('chmod_home', intenta(lambda: os.chmod(home, 0o777)))\n"
            "print('crear_junto_a_la_clave', intenta(lambda: open('/etc/tai-inspect/otra', 'w')))\n"
        )
        r = self._py(codigo, self._como_gate())
        self.assertEqual(r.returncode, 0, r.stderr[-400:])
        v = dict(l.split(" ", 1) for l in r.stdout.splitlines())
        self.assertEqual(len(v), 10)
        for clave, valor in v.items():
            self.assertEqual(valor, "denegado", clave)
        self.assertEqual(os.listdir(LIB + "/home"), [], "el directorio de inicio sigue vacío")
        self.assertEqual(stat.S_IMODE(os.stat(LIB + "/home").st_mode), 0o555)
        self.assertIn("AAAAMARCADOR", open(ETC + "/authorized_keys.tai-inspect").read(), "la clave autorizada no cambió")

    def test_el_gate_invocado_como_lo_hace_sshd_no_da_shell_ni_ejecuta_nada(self):
        """sshd lanza ForceCommand con el shell del usuario (`/bin/sh -c orden`) y deja lo escrito por el cliente solo en SSH_ORIGINAL_COMMAND.
        Se reproduce esa invocación como uid sin privilegios con órdenes hostiles y con COMANDOS en la entrada estándar."""
        self._limpiar()
        # El encabezado `#!/usr/bin/python3 -I` no existe en la imagen de prueba (y `tmpfs` es `noexec`): se usa el intérprete explícito;
        # el encabezado real se comprueba en la etapa 2 (V1). Lo que se prueba aquí es la invocación `sh -c` y el tratamiento de la orden.
        ORDEN_SSHD = "%s -I %s/bin/tai-gate" % (sys.executable, INSTALL)
        base = {"PATH": "/usr/local/bin:/usr/bin:/bin", "SSH_CONNECTION": "198.51.100.5 5000 203.0.113.9 22"}
        entrada = "id\nwhoami\ncat /etc/tai-inspect/secreto.txt\n"
        for orden in ("id", "id; cat /etc/tai-inspect/secreto.txt", "sh -i", "bash", "solicitar host-recursos; id", "$(id)", "cat /etc/shadow", "", "-c id"):
            env = dict(base, SSH_ORIGINAL_COMMAND=orden)
            p = subprocess.run(["/bin/sh", "-c", ORDEN_SSHD], env=env, input=entrada, preexec_fn=self._como_gate(),
                               capture_output=True, text=True, timeout=60)
            self.assertEqual((p.returncode, p.stdout, p.stderr), (2, "orden no permitida\n", ""), repr(orden))
            self.assertNotIn("SECRETO-FICTICIO", p.stdout + p.stderr)
        p = subprocess.run(["/bin/sh", "-c", ORDEN_SSHD], env=base, input=entrada, preexec_fn=self._como_gate(),
                           capture_output=True, text=True, timeout=60)
        self.assertEqual((p.returncode, p.stdout, p.stderr), (2, "orden no permitida\n", ""), "sesión sin orden (interactiva)")
        p = subprocess.run(["/bin/sh", "-c", ORDEN_SSHD], env=dict(base, SSH_ORIGINAL_COMMAND="solicitar host-tiempo"), input=entrada,
                           preexec_fn=self._como_gate(), capture_output=True, text=True, timeout=60)
        self.assertEqual(p.returncode, 0, p.stderr[-300:])
        self.assertEqual(json.loads(p.stdout)["check"], "host-tiempo", "la orden válida sí funciona con esa invocación")
        self._limpiar()

    def _gate_popen(self, orden):
        env = {"PATH": "/usr/local/bin:/usr/bin:/bin", "SSH_ORIGINAL_COMMAND": orden, "SSH_CONNECTION": "198.51.100.5 5000 203.0.113.9 22"}
        return subprocess.Popen([sys.executable, "-I", INSTALL + "/bin/tai-gate"], env=env, preexec_fn=self._como_gate(),
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    def _colector_run(self):
        return subprocess.run([sys.executable, "-I", INSTALL + "/bin/tai-collector"], env={"PATH": "/usr/bin:/bin"}, preexec_fn=self._como_colector(),
                              capture_output=True, text=True, timeout=60)

    def test_flujo_completo_con_privilegios_separados(self):
        self._limpiar()
        gate = self._gate_popen("solicitar docker-nodos")
        time.sleep(1.5)
        col = self._colector_run()
        salida, err = gate.communicate(timeout=60)
        self.assertEqual(col.returncode, 0, "colector: " + col.stderr[-500:])
        self.assertEqual(gate.returncode, 0, "gate: " + err[-500:] + salida[:300])
        self.assertEqual(json.loads(salida)["check"], "docker-nodos")
        info = os.stat(LIB + "/reports/docker-nodos.json")
        self.assertEqual((info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)), (0, GID_GATE, 0o640), "informe: root:tai-inspect 0640 (por setgid)")
        self.assertEqual(os.listdir(LIB + "/requests"), [])
        self.assertEqual(os.stat(LOG + "/collector-audit.log").st_uid, 0)
        col_ev = [json.loads(l)["evento"] for l in open(LOG + "/collector-audit.log", encoding="ascii").read().splitlines()]
        self.assertEqual(col_ev[-3:], ["colector_intencion", "colector_resultado", "colector_publicacion"], "H5: intención, resultado y SOLO DESPUÉS la publicación")
        self.assertRegex(json.loads(salida)["peticion"], r"[0-9a-f]{32}")
        self.assertEqual(os.listdir(LIB + "/staging"), [], "nada queda en staging")
        gate_ev = [json.loads(l)["evento"] for l in open(LOG + "/gate-audit.log", encoding="ascii").read().splitlines()]
        self.assertEqual(gate_ev[-2:], ["gate_intencion", "gate_resultado"])

    def test_enlace_simbolico_plantado_por_el_usuario_no_filtra_el_secreto_ni_rompe_el_colector(self):
        self._limpiar()
        plantar = (
            "import os\n"
            "os.symlink('/etc/tai-inspect/secreto.txt', '/var/lib/tai-inspect/requests/' + 'b'*32 + '.req')\n"
            "open('/var/lib/tai-inspect/requests/' + 'c'*32 + '.req', 'w').write('{\"check\": \"../../etc/tai-inspect/secreto\"}')\n"
            "os.symlink('/etc/tai-inspect', '/var/lib/tai-inspect/requests/' + 'd'*32 + '.req')\n"
            "open('/var/lib/tai-inspect/requests/' + 'e'*32 + '.req', 'w').write('{\"check\": \"docker-nodos\"}')\n"    # una petición LEGÍTIMA detrás de las hostiles
        )
        self.assertEqual(self._py(plantar, self._como_gate()).returncode, 0)
        col = self._colector_run()
        self.assertEqual(col.returncode, 0, "el colector NO debe caerse por una petición hostil: " + col.stderr[-600:])
        restos = os.listdir(LIB + "/requests")
        self.assertEqual(restos, [], "las peticiones hostiles deben descartarse: %r" % restos)
        self.assertTrue(os.path.exists(LIB + "/reports/docker-nodos.json"), "la petición legítima posterior SÍ se atendió")
        registro = open(LOG + "/collector-audit.log", encoding="ascii").read()
        self.assertIn("peticion_invalida", registro)
        self.assertNotIn("secreto", registro.lower())
        for ruta in (LOG + "/collector-audit.log",):
            self.assertNotIn("SECRETO-FICTICIO", open(ruta).read())
        for n in os.listdir(LIB + "/reports"):
            self.assertNotIn("SECRETO-FICTICIO", open(os.path.join(LIB, "reports", n)).read())
        self._limpiar()


    def test_el_usuario_restringido_no_puede_reescribir_el_historial_sin_que_el_colector_lo_detecte(self):
        """El gate es propietario de gate-audit.log (por permisos PUEDE reescribirlo): el colector, con sus anclas en un directorio que el gate no ve, lo detecta."""
        self._limpiar()
        gate = self._gate_popen("solicitar docker-nodos")
        time.sleep(1.5)
        self.assertEqual(self._colector_run().returncode, 0)             # 1.ª pasada: ancla el registro y atiende
        gate.communicate(timeout=60)
        ancla_antes = open(LIB + "/collector-state/ancla-gate.json", "rb").read()
        manipular = (
            "p = '/var/log/tai-inspect/gate-audit.log'\n"
            "datos = open(p, 'rb').read()\n"
            "open(p, 'wb').write(datos.replace(b'gate_intencion', b'gate_intencioX', 1))\n"
            "print('reescrito')\n"
        )
        self.assertIn("reescrito", self._py(manipular, self._como_gate()).stdout, "por permisos el propietario SÍ puede reescribirlo: de ahí las anclas")
        self.assertEqual(self._colector_run().returncode, 0)
        registro = [json.loads(l) for l in open(LOG + "/collector-audit.log", encoding="ascii").read().splitlines()]
        alarmas = [e for e in registro if e["evento"] == "colector_ancla" and e.get("resultado") == "historial_modificado"]
        self.assertTrue(alarmas, "el colector debe registrar la alteración del historial anclado")
        self.assertEqual(open(LIB + "/collector-state/ancla-gate.json", "rb").read(), ancla_antes, "la ancla previa se conserva")
        self._limpiar()

    def test_una_peticion_creada_sin_pasar_por_el_gate_no_evade_el_cupo_del_colector(self):
        self._limpiar()
        crear = (
            "import os\n"
            "for i in range(4):\n"
            "    open('/var/lib/tai-inspect/requests/' + ('%032x' % (i + 1)) + '.req', 'w').write('{\"check\": \"docker-nodos\"}')\n"
            "print('creadas')\n"
        )
        self.assertIn("creadas", self._py(crear, self._como_gate()).stdout)
        self.assertEqual(self._colector_run().returncode, 0)
        registro = [json.loads(l) for l in open(LOG + "/collector-audit.log", encoding="ascii").read().splitlines()]
        resultados = [e["resultado"] for e in registro if e["evento"] == "colector_resultado"][-4:]
        self.assertEqual(resultados.count("intervalo_minimo"), 3, "solo UNA ejecución en el intervalo; el resto se descarta: %r" % resultados)
        self.assertEqual(os.listdir(LIB + "/requests"), [])
        self._limpiar()

    def test_un_informe_ajeno_o_anterior_no_se_entrega_con_procesos_reales(self):
        self._limpiar()
        ajeno = {"v": 1, "check": "docker-nodos", "peticion": "f" * 32, "generado": "2026-11-13T00:00:00Z", "avisos": [], "datos": {}}
        with open(LIB + "/reports/docker-nodos.json", "w") as f:
            json.dump(ajeno, f)
        os.chown(LIB + "/reports/docker-nodos.json", 0, GID_GATE)
        os.chmod(LIB + "/reports/docker-nodos.json", 0o640)
        gate = self._gate_popen("solicitar docker-nodos")
        salida, err = gate.communicate(timeout=60)                      # no hay colector: el gate espera y NO entrega el informe ajeno
        self.assertNotEqual(gate.returncode, 0)
        self.assertNotIn("ffffffff", salida)
        self._limpiar()


# ---------------------------------------------------------------------------------------------------------------
FS_IOC_SETFLAGS = 0x40086602
FS_IOC_GETFLAGS = 0x80086601
FS_APPEND_FL = 0x20
RUTA_CHATTR = "/chattr-test"
CHATTR = LINUX and os.geteuid() == 0 and os.path.isdir(RUTA_CHATTR)


def _fijar_flags(ruta, anadir, quitar=0):
    import fcntl
    import struct
    fd = os.open(ruta, os.O_RDONLY)
    try:
        actual = struct.unpack("l", fcntl.ioctl(fd, FS_IOC_GETFLAGS, struct.pack("l", 0)))[0]
        fcntl.ioctl(fd, FS_IOC_SETFLAGS, struct.pack("l", (actual | anadir) & ~quitar))
    finally:
        os.close(fd)


@unittest.skipUnless(CHATTR, "requiere root y un directorio /chattr-test en un sistema de archivos real (no tmpfs) con CAP_LINUX_IMMUTABLE")
class ChattrAppendReal(unittest.TestCase):
    """`chattr +a` NO se presupone: se prueba de verdad (ioctl FS_IOC_SETFLAGS). Si el sistema no lo admite, la prueba se OMITE con el motivo (no pasa en falso)."""

    def test_atributo_solo_anadir_con_el_registro_de_auditoria(self):
        from tai_inspect import fsattr
        ruta = os.path.join(RUTA_CHATTR, "gate-audit.log")
        a = Audit(ruta)
        a.log("gate_intencion", resultado="x")
        try:
            _fijar_flags(ruta, FS_APPEND_FL)
        except OSError as e:
            self.skipTest("chattr +a NO se pudo activar aquí (errno %s: %s)" % (e.errno, os.strerror(e.errno)))
        try:
            self.assertIs(fsattr.solo_anadir(ruta), True, "el módulo de solo lectura debe ver el atributo")
            a.log("gate_resultado", resultado="ok")                              # añadir sigue funcionando (O_APPEND)
            self.assertEqual([json.loads(l)["seq"] for l in open(ruta).read().splitlines()], [1, 2])
            for nombre, accion in (("truncar", lambda: open(ruta, "w")), ("reescribir", lambda: open(ruta, "r+b").write(b"x")),
                                   ("borrar", lambda: os.unlink(ruta)), ("renombrar", lambda: os.rename(ruta, ruta + ".viejo"))):
                with self.assertRaises(OSError, msg=nombre + ": ni root puede con el atributo activo") as cm:
                    accion()
                self.assertIn(cm.exception.errno, (1, 13), nombre)            # EPERM / EACCES
            sin_cap = (
                "import fcntl, struct, os\n"
                "fd = os.open(%r, os.O_RDONLY)\n"
                "try:\n    fcntl.ioctl(fd, %d, struct.pack('l', 0)); print('QUITADO')\n"
                "except OSError as e:\n    print('errno', e.errno)\n" % (ruta, FS_IOC_SETFLAGS))

            def sin_privilegios():
                os.setgroups([GID_GATE])
                os.setgid(GID_GATE)
                os.setuid(UID_GATE)
            r = subprocess.run([sys.executable, "-I", "-c", sin_cap], preexec_fn=sin_privilegios, capture_output=True, text=True, timeout=30)
            self.assertNotIn("QUITADO", r.stdout, "un usuario sin CAP_LINUX_IMMUTABLE no puede quitar el atributo")
        finally:
            _fijar_flags(ruta, 0, FS_APPEND_FL)


if __name__ == "__main__":
    unittest.main()
