# -*- coding: utf-8 -*-
"""Pruebas del PROCEDIMIENTO de la etapa 2 (documento `INSPECCION-ETAPA-2-PLAN.md`):
  · el bloque que verifica el TAR antes de extraerlo se EXTRAE del propio documento y se ejecuta contra paquetes legítimos y manipulados
    (rutas absolutas y con `..`, enlaces simbólicos y duros, dispositivos y tuberías, permisos peligrosos, propietario ajeno, ficheros de más o de
    menos, contenido modificado, entradas duplicadas, huella del TAR equivocada);
  · ningún comando de `systemd-analyze` del plan va conectado a una tubería (una tubería oculta el código de salida).
Se omiten si el documento no está disponible (p. ej. en el contenedor de pruebas) o fuera de Linux."""
import io
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest

import helpers as H



def _bash():
    """Linux: `bash` del sistema. Windows: el `bash` de Git for Windows (trae `tar` GNU, `awk` y `sha256sum`); nunca el `bash.exe` de WSL."""
    if sys.platform.startswith("linux"):
        return shutil.which("bash") if shutil.which("tar") else None
    for p in (r"C:\Program Files\Git\bin\bash.exe", r"C:\Program Files (x86)\Git\bin\bash.exe"):
        if os.path.exists(p):
            return p
    return None


BASH = _bash()
LINUX = BASH is not None
CANDIDATOS = [os.path.join(H.RAIZ, "..", "docs", "INSPECCION-ETAPA-2-PLAN.md"), os.path.join(H.RAIZ, "..", "..", "docs", "plan-etapa-2.md")]
PLAN = next((os.path.abspath(p) for p in CANDIDATOS if os.path.exists(p)), None)
INI, FIN = "<!-- VERIFICAR-TAR:INICIO -->", "<!-- VERIFICAR-TAR:FIN -->"


def leer_plan():
    with io.open(PLAN, encoding="utf-8", newline="") as f:
        return f.read().replace("\r\n", "\n")


def bloque_verificacion():
    texto = leer_plan()
    i, j = texto.index(INI), texto.index(FIN)
    m = re.search(r"```bash\n(.*?)\n```", texto[i:j], flags=re.S)
    return m.group(1)


def script_reversion():
    """Contenido de `revertir.sh`, tomado del bloque marcado del documento (el texto entre `<<'FIN'` y `FIN`)."""
    texto = leer_plan()
    i, j = texto.index("<!-- REVERSION:INICIO -->"), texto.index("<!-- REVERSION:FIN -->")
    m = re.search(r"<<'FIN'\n(.*?)\nFIN\n", texto[i:j], flags=re.S)
    return m.group(1) + "\n"


@unittest.skipUnless(PLAN, "el documento del plan no está disponible")
class PlanSinTuberiasQueOcultenErrores(unittest.TestCase):
    def bloques(self):
        return re.findall(r"```(?:sh|bash)\n(.*?)\n```", leer_plan(), flags=re.S)

    def test_systemd_analyze_nunca_va_conectado_a_una_tuberia(self):
        usadas = 0
        for b in self.bloques():
            for linea in b.splitlines():
                if "systemd-analyze" in linea and not linea.lstrip().startswith("#"):
                    usadas += 1
                    self.assertNotIn("|", linea, "una tubería oculta el código de salida de systemd-analyze: " + linea)
        self.assertGreaterEqual(usadas, 2, "el plan debe ejecutar `verify` y `security`")

    def test_se_comprueba_el_codigo_de_salida_de_verify_y_de_security(self):
        texto = leer_plan()
        self.assertRegex(texto, r"systemd-analyze verify [^\n|]*> [^\n]*verify\.txt 2>&1; rc=\$\?")
        self.assertRegex(texto, r"systemd-analyze security --offline=true --no-pager [^\n|]*> [^\n]*seguridad\.txt 2>&1; rc=\$\?")
        self.assertIn("VERIFY_OK", texto)
        self.assertIn("SECURITY_OK", texto)

    def test_el_orden_de_las_unidades_es_verificar_antes_de_copiar(self):
        texto = leer_plan()
        iv = texto.index("systemd-analyze verify")
        isec = texto.index("systemd-analyze security")
        icopia = texto.index("/etc/systemd/system/tai-collector.service")
        self.assertLess(iv, isec)
        self.assertLess(isec, icopia, "las unidades no se copian a /etc/systemd/system hasta que verify y security pasen")

    def test_condiciones_de_la_segunda_revision_estan_presentes(self):
        texto = leer_plan()
        for fragmento in ("sshd -t", "sshd -T -C user=root", "sshd -T -C user=tai-inspect", "usepam yes", "9.6p1", "-p 2222", "ListenAddress=127.0.0.1",
                          "systemd-run", "tai-reversion", "consola web", "no se presupone", "VERIFICAR-TAR:INICIO"):
            self.assertIn(fragmento, texto.lower() if fragmento.islower() else texto, fragmento)
        self.assertNotIn("la SSH actual; **no se cierran**", texto, "ya no se exige una sesión SSH existente")

    def test_el_sshd_real_no_se_toca_hasta_la_prueba_en_el_puerto_de_prueba(self):
        texto = leer_plan()
        self.assertLess(texto.index("-p 2222"), texto.index("systemctl reload ssh"), "la prueba con la configuración real va ANTES de recargar")
        self.assertLess(texto.index("systemd-run --unit=tai-reversion"), texto.index("systemctl is-active ssh; systemctl reload ssh"),
                        "el temporizador de reversión se arma ANTES de recargar")
        self.assertLess(texto.index("ssh-keygen -l -f /etc/ssh/authorized_keys.tai-inspect"), texto.index("systemd-run --unit=tai-reversion"),
                        "la huella de la clave real se cotejá ANTES de recargar")

    def test_el_temporizador_de_reversion_usa_el_script_ensayado_y_nunca_borra_en_linea(self):
        texto = leer_plan()
        armados = [l for l in texto.splitlines() if "systemd-run --unit=tai-reversion" in l and "--on-active" in l and not l.lstrip().startswith("|")
                   and "…" not in l]
        self.assertEqual(len(armados), 1, "un solo armado: no hay rearmado durante una activacion F7")
        for l in armados:
            self.assertIn("/bin/sh $D/revertir.sh", l)
            self.assertIn("--timer-property=AccuracySec=1s", l, "sin precisión fijada el temporizador puede disparar hasta 1 min tarde")
            self.assertNotIn("rm -f", l, "el temporizador no borra directamente: ejecuta el script con guarda de huella")
        self.assertIn("--setenv=F=$D/ensayo.conf", texto, "F0 ensaya el MISMO script con rutas de prueba")
        self.assertIn("AJENO_CONSERVADO", texto)
        self.assertNotIn("systemctl restart ssh", texto.replace("nunca `restart`", ""), "nunca restart")
        self.assertNotRegex(texto, r"(?m)^(pkill|killall) .*sshd", "matar sshd por nombre mataría el sshd en uso")

    def test_sin_rearmado_el_temporizador_solo_se_detiene_tras_la_puerta_o_una_reversion_confirmada(self):
        texto = leer_plan()
        self.assertNotIn("REARMAR:INICIO", texto)
        self.assertNotIn("rearmada rc=", texto)
        lineas = [l for l in texto.splitlines() if "systemctl stop tai-reversion.timer" in l and not l.lstrip().startswith(("|", "`", "#"))]
        # Solo dos usos ejecutables: la cancelacion condicionada a PUERTA=1 y la reversion manual condicionada a rc=0
        self.assertEqual(len(lineas), 2, lineas)
        self.assertTrue(any('[ "$PUERTA" -eq 1 ]' in l for l in lineas))
        self.assertTrue(any('"$REVERSION_RC" -eq 0' in l for l in lineas))
        for l in lineas:
            self.assertFalse(l.lstrip().startswith("systemctl stop"), "ninguna parada incondicional: " + l)
        self.assertNotRegex(texto, r"(?i)\bre-?arma(r|do)? con el bloque")

    def test_el_script_de_windows_no_declara_exito_fuera_del_margen(self):
        texto = leer_plan()
        i, j = texto.index("<!-- PS-V:INICIO -->"), texto.index("<!-- PS-V:FIN -->")
        ps = texto[i:j]
        self.assertIn("$fueraMargen", ps)
        self.assertLess(ps.index("$fueraMargen = "), ps.index("AUTOMATICAS_OK (V0-V8"))
        self.assertIn("if ($abortado -or $ko -gt 0 -or $fueraMargen)", ps)
        self.assertNotIn("REARMAR", ps)

    def test_el_script_independiente_de_windows_es_el_del_plan_con_parametros(self):
        texto = leer_plan()
        i, j = texto.index("<!-- PS-V:INICIO -->"), texto.index("<!-- PS-V:FIN -->")
        plan = re.search(r"```powershell\n(.*?)\n```", texto[i:j], flags=re.S).group(1)
        ruta = os.path.join(H.RAIZ, "..", "scripts", "F7-Validacion-Windows.ps1")
        with open(ruta, "rb") as f:
            datos = f.read()
        datos.decode("ascii")
        archivo = datos.decode("ascii").replace("\r\n", "\n")
        self.assertIn("[Parameter(Mandatory = $true)]", archivo)
        self.assertIn("$fueraMargen", archivo)
        # Cuerpo identico desde las funciones AhoraUtc/Dormir hasta el final
        marca = "if (-not (Test-Path function:AhoraUtc))"
        self.assertEqual(archivo[archivo.index(marca):].rstrip("\n"), plan[plan.index(marca):].rstrip("\n"))
        for prohibido in ("systemctl", "Set-Content", "Remove-Item", "Out-File", "scp ", "sftp", "Invoke-Expression", "Start-Process", "docker ", "git "):
            self.assertNotIn(prohibido, archivo, prohibido)

    def test_no_se_recarga_si_el_temporizador_de_reversion_no_es_preciso(self):
        texto = leer_plan()
        self.assertIn("REVERSION_IMPRECISA_PARAR", texto)
        self.assertLess(texto.index("REVERSION_PRECISA"), texto.index("systemctl is-active ssh; systemctl reload ssh"),
                        "la comprobación de precisión va ANTES de recargar")
        self.assertIn("192264110ba3d7d2184df0713e098209e35172463e784881bd4a542746ed012e", texto, "huella del script ensayado en F0")

    def test_la_huella_del_script_del_plan_es_la_ensayada_en_el_vps(self):
        import hashlib
        self.assertEqual(hashlib.sha256(script_reversion().encode("utf-8")).hexdigest(),
                         "192264110ba3d7d2184df0713e098209e35172463e784881bd4a542746ed012e")

    def test_la_huella_por_defecto_del_script_es_la_de_la_plantilla_aprobada(self):
        import hashlib
        script = script_reversion()
        h = re.search(r"H=\$\{H:-([0-9a-f]{64})\}", script).group(1)
        with open(os.path.join(H.RAIZ, "deploy", "sshd_config.d", "00-tai-inspect.conf"), "rb") as f:
            self.assertEqual(h, hashlib.sha256(f.read()).hexdigest(), "el script solo retira la plantilla EXACTA que se instaló")


class Paquete(object):
    """Construye en memoria un TAR con los archivos de código y plantillas del producto (los 'ficheros revisados')."""

    def __init__(self):
        self.entradas = []          # (nombre, bytes, modo, tipo, uid, linkname)
        for base in ("tai_inspect", "bin", "deploy"):
            for dp, ds, fs in os.walk(os.path.join(H.RAIZ, base)):
                ds[:] = sorted(d for d in ds if d != "__pycache__")
                for f in sorted(fs):
                    ruta = os.path.join(dp, f)
                    rel = os.path.relpath(ruta, H.RAIZ).replace(os.sep, "/")
                    with open(ruta, "rb") as fh:
                        datos = fh.read()
                    self.entradas.append([rel, datos, 0o755 if rel.startswith("bin/") else 0o644, tarfile.REGTYPE, 0, ""])
        self.dirs = ["bin", "tai_inspect", "tai_inspect/checks", "deploy", "deploy/systemd", "deploy/sshd_config.d"]

    def escribir(self, ruta, extra=(), quitar=None, cambiar=None, dirs_modo=0o755):
        with tarfile.open(ruta, "w", format=tarfile.GNU_FORMAT) as t:
            for d in self.dirs:
                ti = tarfile.TarInfo(d)
                ti.type, ti.mode, ti.uid, ti.gid, ti.mtime = tarfile.DIRTYPE, dirs_modo, 0, 0, 1794000000
                t.addfile(ti)
            for nombre, datos, modo, tipo, uid, link in self.entradas:
                if nombre == quitar:
                    continue
                if cambiar and nombre == cambiar[0]:
                    datos, modo, tipo, uid, link = cambiar[1] if cambiar[1] is not None else datos, cambiar[2] or modo, cambiar[3] or tipo, cambiar[4] if cambiar[4] is not None else uid, cambiar[5] or link
                ti = tarfile.TarInfo(nombre)
                ti.type, ti.mode, ti.uid, ti.gid, ti.mtime, ti.linkname = tipo, modo, uid, 0, 1794000000, link
                if tipo == tarfile.REGTYPE:
                    ti.size = len(datos)
                    t.addfile(ti, io.BytesIO(datos))
                else:
                    t.addfile(ti)
            for nombre, datos, modo, tipo, uid, link in extra:
                ti = tarfile.TarInfo(nombre)
                ti.type, ti.mode, ti.uid, ti.gid, ti.mtime, ti.linkname = tipo, modo, uid, 0, 1794000000, link
                if tipo == tarfile.REGTYPE:
                    ti.size = len(datos)
                    t.addfile(ti, io.BytesIO(datos))
                else:
                    t.addfile(ti)

    def lista_huellas(self, ruta):
        import hashlib
        with open(ruta, "w", newline="\n") as f:
            for nombre, datos, *_ in sorted(self.entradas):
                f.write("%s  %s\n" % (hashlib.sha256(datos).hexdigest(), nombre))


@unittest.skipUnless(PLAN and LINUX, "requiere el documento del plan y bash con tar de GNU (Linux o Git for Windows)")
class VerificacionDelTar(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pkg = Paquete()
        cls.script = bloque_verificacion()

    def setUp(self):
        self.d = tempfile.mkdtemp(prefix="tai-tar-")

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)

    def ejecutar(self, huella=None, **kw):
        import hashlib
        tar = os.path.join(self.d, "treidilor-inspeccion.tar")
        self.pkg.escribir(tar, **kw)
        self.pkg.lista_huellas(os.path.join(self.d, "SHA256SUMS-CODIGO.txt"))
        with open(tar, "rb") as f:
            ht = huella or hashlib.sha256(f.read()).hexdigest()
        script = re.sub(r"(?m)^HT=.*$", "HT='%s'" % ht, self.script)
        # D="." con cwd=<temporal>: rutas relativas (en Windows `C:` se confundiría con un host remoto de tar)
        r = subprocess.run([BASH, "-c", script], env=dict(os.environ, D="."), cwd=self.d, capture_output=True, text=True, timeout=300)
        return r.stdout + r.stderr

    def aceptado(self, salida):
        return "TAR_VERIFICADO" in salida and "TAR_RECHAZADO" not in salida

    def test_un_paquete_legitimo_se_acepta(self):
        salida = self.ejecutar()
        self.assertTrue(self.aceptado(salida), salida)
        self.assertNotIn("FALLA", salida)

    def rechazado(self, motivo, **kw):
        salida = self.ejecutar(**kw)
        self.assertFalse(self.aceptado(salida), "debía rechazarse (%s): %s" % (motivo, salida))
        self.assertIn("TAR_RECHAZADO", salida, motivo)
        return salida

    def test_huella_del_tar_equivocada(self):
        self.rechazado("huella del tar", huella="0" * 64)

    def test_enlace_simbolico(self):
        self.rechazado("symlink", extra=[("tai_inspect/enlace", b"", 0o777, tarfile.SYMTYPE, 0, "/etc/shadow")])

    def test_enlace_simbolico_que_sustituye_a_un_fichero_revisado(self):
        self.rechazado("symlink en lugar de fichero", cambiar=("tai_inspect/gate.py", None, 0o777, tarfile.SYMTYPE, None, "/etc/passwd"))

    def test_enlace_duro(self):
        self.rechazado("hardlink", extra=[("tai_inspect/duro", b"", 0o644, tarfile.LNKTYPE, 0, "tai_inspect/gate.py")])

    def test_ruta_absoluta(self):
        self.rechazado("ruta absoluta", extra=[("/etc/cron.d/malo", b"x", 0o644, tarfile.REGTYPE, 0, "")])

    def test_ruta_con_recorrido_de_directorios(self):
        self.rechazado("..", extra=[("../escape", b"x", 0o644, tarfile.REGTYPE, 0, "")])
        self.rechazado("../ intermedio", extra=[("tai_inspect/../../escape", b"x", 0o644, tarfile.REGTYPE, 0, "")])

    def test_nombre_con_espacios_o_caracteres_raros(self):
        self.rechazado("espacio", extra=[("tai_inspect/con espacio.py", b"x", 0o644, tarfile.REGTYPE, 0, "")])
        self.rechazado("punto inicial", extra=[(".oculto", b"x", 0o644, tarfile.REGTYPE, 0, "")])

    def test_dispositivo_y_tuberia(self):
        self.rechazado("fifo", extra=[("tai_inspect/tuberia", b"", 0o644, tarfile.FIFOTYPE, 0, "")])
        self.rechazado("dispositivo", extra=[("tai_inspect/disp", b"", 0o644, tarfile.CHRTYPE, 0, "")])

    def test_permisos_peligrosos(self):
        self.rechazado("setuid", cambiar=("tai_inspect/gate.py", None, 0o4755, None, None, None))
        self.rechazado("escribible por todos", cambiar=("tai_inspect/gate.py", None, 0o666, None, None, None))
        self.rechazado("escribible por el grupo", cambiar=("tai_inspect/config.py", None, 0o664, None, None, None))
        self.rechazado("ejecutable fuera de bin/", cambiar=("tai_inspect/config.py", None, 0o755, None, None, None))
        self.rechazado("lanzador sin ejecución", cambiar=("bin/tai-gate", None, 0o644, None, None, None))
        self.rechazado("directorio con escritura para todos", dirs_modo=0o777)

    def test_propietario_ajeno(self):
        self.rechazado("uid 1000", cambiar=("tai_inspect/gate.py", None, None, None, 1000, None))

    def test_fichero_de_mas(self):
        self.rechazado("extra", extra=[("tai_inspect/puerta_trasera.py", b"import os\n", 0o644, tarfile.REGTYPE, 0, "")])

    def test_fichero_de_menos(self):
        self.rechazado("falta uno", quitar="tai_inspect/gate.py")

    def test_contenido_modificado(self):
        self.rechazado("un byte distinto", cambiar=("tai_inspect/gate.py", b"# modificado\n", None, None, None, None))

    def test_entrada_duplicada(self):
        original = next(e for e in self.pkg.entradas if e[0] == "tai_inspect/ctx.py")
        self.rechazado("duplicado", extra=[("tai_inspect/ctx.py", original[1], 0o644, tarfile.REGTYPE, 0, "")])

    def test_el_bloque_no_extrae_nada(self):
        self.ejecutar()
        self.assertEqual(sorted(os.listdir(self.d)), sorted(set(os.listdir(self.d))))
        self.assertFalse(os.path.exists(os.path.join(self.d, "tai_inspect")), "la verificación NO extrae")


@unittest.skipUnless(PLAN and LINUX, "requiere el documento del plan y bash (Linux o Git for Windows)")
class ScriptDeReversion(unittest.TestCase):
    """Ejecuta el `revertir.sh` del documento con `sshd` y `systemctl` SIMULADOS (nunca toca el sistema)."""

    def setUp(self):
        self.d = tempfile.mkdtemp(prefix="tai-rev-")
        self.escribir("revertir.sh", script_reversion())
        self.escribir("sshd_ok", "#!/bin/sh\nexit 0\n")
        self.escribir("sshd_mal", "#!/bin/sh\necho 'config rota' >&2\nexit 1\n")
        self.escribir("systemctl", '#!/bin/sh\necho "$@" >> calls.txt\ncase "$1" in\n  is-active) exit "${ACTIVO:-0}";;\n  reload) exit "${RECARGA:-0}";;\nesac\nexit 0\n')
        self.contenido = b"Match User tai-inspect\n    ForceCommand /opt/tai-inspect/bin/tai-gate\n"
        import hashlib
        self.huella = hashlib.sha256(self.contenido).hexdigest()
        for hermano in ("50-cloud-init.conf", "60-otro.conf"):
            self.escribir(hermano, "PasswordAuthentication yes\n")

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)

    def escribir(self, nombre, texto):
        with open(os.path.join(self.d, nombre), "wb") as f:
            f.write(texto if isinstance(texto, bytes) else texto.encode("utf-8"))

    def ejecutar(self, sshd="sshd_ok", con_archivo=True, contenido=None, **env):
        if con_archivo:
            self.escribir("00-tai-inspect.conf", self.contenido if contenido is None else contenido)
        e = dict(os.environ, F="./00-tai-inspect.conf", H=self.huella, SSHD="./" + sshd, SYSTEMCTL="./systemctl", LOG="./reversion.log")
        e.update(env)
        r = subprocess.run([BASH, "./revertir.sh"], env=e, cwd=self.d, capture_output=True, text=True, timeout=60)
        return r.returncode, r.stdout + r.stderr

    def llamadas(self):
        ruta = os.path.join(self.d, "calls.txt")
        return open(ruta).read().split("\n") if os.path.exists(ruta) else []

    def hermanos(self):
        return sorted(n for n in os.listdir(self.d) if n in ("50-cloud-init.conf", "60-otro.conf"))

    def test_retira_su_propio_archivo_y_recarga(self):
        rc, salida = self.ejecutar()
        self.assertEqual(rc, 0, salida)
        self.assertFalse(os.path.exists(os.path.join(self.d, "00-tai-inspect.conf")))
        self.assertIn("reload ssh", self.llamadas())
        self.assertIn("retirado", salida)

    def test_no_borra_un_archivo_cambiado_por_otra_persona(self):
        rc, salida = self.ejecutar(contenido=b"Match User tai-inspect\n    ForceCommand /bin/bash\n")
        self.assertEqual(rc, 3, salida)
        self.assertTrue(os.path.exists(os.path.join(self.d, "00-tai-inspect.conf")), "un archivo ajeno NO se borra")
        self.assertNotIn("reload ssh", self.llamadas(), "no se recarga si no se ha revertido nada")
        self.assertIn("NO se retira", salida)

    def test_es_idempotente_si_el_archivo_ya_no_existe(self):
        rc, salida = self.ejecutar(con_archivo=False)
        self.assertEqual(rc, 0, salida)
        self.assertIn("nada que retirar", salida)
        self.assertIn("reload ssh", self.llamadas())

    def test_no_recarga_si_sshd_t_falla_tras_retirar(self):
        rc, salida = self.ejecutar(sshd="sshd_mal")
        self.assertEqual(rc, 5, salida)
        self.assertNotIn("reload ssh", self.llamadas(), "no se recarga una configuración que no pasa `sshd -t`")

    def test_si_ssh_no_esta_activo_no_intenta_recargar(self):
        rc, salida = self.ejecutar(ACTIVO="3")
        self.assertEqual(rc, 0, salida)
        self.assertNotIn("reload ssh", self.llamadas())
        self.assertIn("proxima conexion", salida)

    def test_un_fallo_de_recarga_se_notifica(self):
        rc, salida = self.ejecutar(RECARGA="1")
        self.assertEqual(rc, 4, salida)
        self.assertIn("FALLO al recargar", salida)

    def test_nunca_toca_otros_archivos_de_sshd_config_d(self):
        for caso in ({}, {"contenido": b"otro"}, {"con_archivo": False}):
            self.ejecutar(**caso)
            self.assertEqual(self.hermanos(), ["50-cloud-init.conf", "60-otro.conf"], caso)
            with open(os.path.join(self.d, "50-cloud-init.conf")) as f:
                self.assertEqual(f.read(), "PasswordAuthentication yes\n")

    def test_el_script_no_contiene_operaciones_peligrosas(self):
        s = script_reversion()
        self.assertEqual(len(re.findall(r"\brm\b", s)), 1, "un único rm, sobre $F")
        self.assertIn('rm -f "$F"', s)
        for prohibido in ("rm -r", "restart", "kill", "authorized_keys", "sshd_config.orig", "cp ", "mv ", "chmod", "chown", "useradd", "userdel"):
            self.assertNotIn(prohibido, s, prohibido)


if __name__ == "__main__":
    unittest.main()
