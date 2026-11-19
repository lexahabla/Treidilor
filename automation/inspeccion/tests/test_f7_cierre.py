# -*- coding: utf-8 -*-
"""Pruebas LOCALES (sin VPS, sin red, sin Docker) del cierre automatizado de F7: automation/scripts/f7-vps.sh y F7-Validacion-Windows.ps1.

El script de la consola se ejecuta con bash --posix y PROGRAMAS SIMULADOS (systemctl, systemd-run, sshd, su, sudo...) en un directorio temporal.
Nada toca el sistema real: las rutas fijas del servidor solo se sustituyen con TAI_F7_PRUEBAS=1, variable que no existe en el VPS.
"""
import hashlib
import hmac
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.abspath(os.path.join(AQUI, "..", "..", ".."))
SCRIPT = os.path.join(RAIZ, "automation", "scripts", "f7-vps.sh")
PS1 = os.path.join(RAIZ, "automation", "scripts", "F7-Validacion-Windows.ps1")
BASH = r"C:\Program Files\Git\bin\bash.exe"
if not os.path.exists(BASH):
    BASH = shutil.which("bash") or "bash"


def p(x):
    return x.replace("\\", "/")


def msys(x):
    """Ruta en formato MSYS (/c/...), necesaria dentro de PATH (los dos puntos de C: lo rompen)."""
    return re.sub(r"^([A-Za-z]):", lambda m: "/" + m.group(1).lower(), p(x))


STUBS = {
    "systemctl": r'''#!/bin/sh
S=$TAI_S
echo "systemctl $*" >> $S/calls.txt
getv() { cat "$S/$1" 2>/dev/null || echo "$2"; }
case "$1" in
  is-active)
    if [ "$2" = --quiet ]; then [ "$(getv timer inactive)" = active ]; exit $?; fi
    case "$2" in
      tai-reversion.timer) getv timer inactive; [ "$(getv timer inactive)" = active ]; exit $? ;;
      tai-reversion.service) getv svc inactive; exit 0 ;;
      ssh) getv ssh active; [ -n "$3" ] && echo active; exit 0 ;;
      *) echo active; exit 0 ;;
    esac ;;
  show)
    unit=$2; prop=$4
    if [ "$unit" = ssh.service ]; then
      case "$prop" in
        ActiveEnterTimestamp) getv ssh_enter "Sat 2026-11-14 10:00:00 UTC" ;;
        ActiveEnterTimestampMonotonic) getv ssh_mono 12345 ;;
      esac
      exit 0
    fi
    case "$prop" in
      ActiveState) getv timer inactive ;;
      SubState) if [ "$(getv timer inactive)" = active ]; then echo waiting; else echo dead; fi ;;
      AccuracyUSec) getv accuracy 1s ;;
      ActiveEnterTimestamp) e=$(getv enter 0); case "$e" in 0) ;; ''|*[!0-9]*) echo "$e" ;; *) date -u -d @$e '+%a %Y-%m-%d %H:%M:%S UTC' ;; esac ;;
      ActiveEnterTimestampMonotonic) getv mono "" ;;
    esac ;;
  stop) rc=$(getv stop_rc 0); [ "$rc" = 0 ] && echo inactive > $S/timer; exit $rc ;;
  reload) exit $(getv reload_rc 0) ;;
  list-timers) [ "$(getv timer inactive)" = active ] && echo "x tai-reversion.timer x"; exit 0 ;;
esac
exit 0
''',
    "systemd-run": r'''#!/bin/sh
S=$TAI_S
echo "systemd-run $*" >> $S/calls.txt
rc=$(cat $S/arm_rc 2>/dev/null || echo 0)
[ "$rc" = 0 ] || exit $rc
echo active > $S/timer; echo "$RANDOM$RANDOM$RANDOM" > $S/mono
if [ -f $S/enter_forzado ]; then cp $S/enter_forzado $S/enter; else date +%s > $S/enter; fi
[ -f $S/forzar_mono_vacio ] && : > $S/mono
exit 0
''',
    "sshd": r'''#!/bin/sh
S=$TAI_S; D=$TAI_D
case "$1" in
  -t) cat $S/sshd_t_out 2>/dev/null; exit $(cat $S/sshd_t_rc 2>/dev/null || echo 0) ;;
  -T) if [ "$2" = -C ]; then
        case "$3" in
          user=root*) cat $D/r-root.txt ;;
          user=tai-inspect*) if [ -e "$TAI_DROPIN" ]; then cat $D/tai-esperado.txt; else echo none; fi ;;
        esac
      else cat $D/r-glob.txt; cat $S/glob_extra 2>/dev/null; fi ;;
esac
exit 0
''',
    "install": r'''#!/bin/sh
eval "src=\${$(($#-1))}; dst=\${$#}"
cp "$src" "$dst"
''',
    "ss": '#!/bin/sh\necho "tcp 0.0.0.0:22"\n',
    "docker": '#!/bin/sh\necho "web|1/1"\n',
    "ssh-keygen": '#!/bin/sh\nfp=$(awk \'!/^#/ && NF {print $2; exit}\' "$2")\nif [ "$fp" = KEYGOOD ]; then echo "256 SHA256:zzEk73jAM3o9yO0f7uBlYhu2gZhxRWbpTrL0RzKIlfE tradylor (ED25519)"; else echo "256 SHA256:OTRAHUELLAOTRAHUELLAOTRAHUELLAOTRAHUELLA00 otra (ED25519)"; fi\n',
    "stat": '#!/bin/sh\nif [ "$1" = -c ] && [ "$2" = "%U:%G %a" ]; then cat $TAI_S/ak_perm 2>/dev/null || echo "root:root 600"; else exec /usr/bin/stat "$@"; fi\n',
    "su": "#!/bin/sh\ncat $TAI_S/v13_out 2>/dev/null\nexit 0\n",
    "sudo": '#!/bin/sh\nif [ -f $TAI_S/sudo_out ]; then cat $TAI_S/sudo_out; else echo "User tai-inspect is not allowed to run sudo on host."; fi\n',
    "id": '#!/bin/sh\ncase "$1" in -G) cat $TAI_S/id_g 2>/dev/null || echo 997;; -u) echo 0;; *) /usr/bin/id "$@";; esac\n',
    "journalctl": '#!/bin/sh\ncase "$*" in *"-u ssh"*) [ -f $TAI_S/ssh_journal_falla ] && exit 1; cat $TAI_S/ssh_journal 2>/dev/null; exit 0 ;; esac\nif [ -f $TAI_S/journal ]; then cat $TAI_S/journal; else printf "tai-gate gate_intencion\\ntai-gate gate_resultado\\n"; fi\n',
    "python3": '#!/bin/sh\nexec "' + sys.executable.replace("\\", "/") + '" "$@"\n',
}


class Entorno(object):
    def __init__(self):
        self.t = tempfile.mkdtemp(prefix="tai-f7-")
        self.D = os.path.join(self.t, "D"); self.S = os.path.join(self.t, "S"); self.bin = os.path.join(self.t, "bin")
        self.proc = os.path.join(self.t, "proc"); self.sshd_d = os.path.join(self.t, "sshd_config.d")
        for d in (self.D, self.S, self.bin, self.proc, self.sshd_d):
            os.makedirs(d)
        for n, c in STUBS.items():
            with io.open(os.path.join(self.bin, n), "w", newline="\n") as f:
                f.write(c)
        self.dropin = os.path.join(self.sshd_d, "00-tai-inspect.conf")
        self.plantilla = os.path.join(self.t, "plantilla.conf")
        self.audit = os.path.join(self.t, "gate-audit.log")
        self.cuota = os.path.join(self.t, "cuota.json")
        self.escribe(self.plantilla, "Match User tai-inspect\n    PermitTTY no\n")
        self.escribe(os.path.join(self.D, "revertir.sh"),
                     'echo "revertir $(date +%s)" >> $TAI_S/calls.txt\nrm -f "$TAI_DROPIN"\nexit $(cat $TAI_S/revert_rc 2>/dev/null || echo 0)\n')
        self.escribe(os.path.join(self.D, "r-root.txt"), "permitrootlogin yes\nport 22\n")
        self.escribe(os.path.join(self.D, "r-glob.txt"), "maxauthtries 6\nport 22\n")
        self.escribe(os.path.join(self.D, "tai-esperado.txt"), "forcecommand /opt/tai-inspect/bin/tai-gate\npermittty no\n")
        self.h_rev = hashlib.sha256(io.open(os.path.join(self.D, "revertir.sh"), "rb").read()).hexdigest()
        self.h_drop = hashlib.sha256(open(self.plantilla, "rb").read()).hexdigest()
        self.ak = os.path.join(self.t, "authorized_keys")
        self.escribe(self.ak, "ssh-ed25519 KEYGOOD tradylor-vps-antigravity\n")
        self.escribe(self.cuota, json.dumps({"last": {"host-actualizaciones": time.time() - 1000}, "count": 3}))
        self.seq = 100
        self.escribe(self.audit, "")
        self.audita(["host-recursos"])      # historial previo con el formato real (JSON por linea, seq entero, ts ISO)
        self.consola(111); self.consola(222)
        # linea base de invariantes con los mismos programas simulados
        self.sh("--base")

    def escribe(self, ruta, texto):
        with io.open(ruta, "w", newline="\n") as f:
            f.write(texto)

    def consola(self, pid, vivo=True):
        d = os.path.join(self.proc, str(pid))
        if vivo:
            os.makedirs(d, exist_ok=True)
            self.escribe(os.path.join(d, "stat"), "%d (bash) S 1 1 1 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 %d 0 0\n" % (pid, 5000 + pid))
        else:
            shutil.rmtree(d, ignore_errors=True)

    def env(self, ppid):
        e = dict(os.environ)
        e.update(TAI_F7_PRUEBAS="1", TAI_D=p(self.D), TAI_S=p(self.S), TAI_DROPIN=p(self.dropin), TAI_AUDIT=p(self.audit), TAI_CUOTA=p(self.cuota),
                 TAI_PROC=p(self.proc), TAI_PPID=str(ppid), TAI_PLANTILLA=p(self.plantilla), TAI_HASH_DROPIN=self.h_drop, TAI_HASH_REVERTIR=self.h_rev, TAI_ROOT_FP="SHA256:zzEk73jAM3o9yO0f7uBlYhu2gZhxRWbpTrL0RzKIlfE",
                 TAI_BIN=msys(self.bin), TAI_ROOT_AK=p(self.ak))
        return e

    def sh(self, *args, **kw):
        ppid = kw.get("ppid", 111)
        if args == ("--base",):
            with io.open(SCRIPT, encoding="utf-8") as fh:
                src = fh.read()
            fun = re.search(r"^inv\(\).*$", src, re.M).group(0)
            # misma funcion inv() del script, con los MISMOS programas simulados, para fijar la linea base
            r = subprocess.run([BASH, "--posix", "-c", 'PATH="$TAI_BIN:$PATH"\nD="$TAI_D"\nROOT_AK="$TAI_ROOT_AK"\n' + fun + '\ninv "$D/invariantes-base.txt"'], env=self.env(ppid), capture_output=True, text=True)
            return r
        # los programas simulados ANTEPUESTOS al PATH (Git for Windows reordena el PATH al arrancar bash)
        r = subprocess.run([BASH, "--posix", "-c", 'PATH="$TAI_BIN:$PATH"; . "$0"', p(SCRIPT)] + list(args), env=self.env(ppid), capture_output=True, text=True, timeout=120)
        return r

    def llamadas(self, patron):
        ruta = os.path.join(self.S, "calls.txt")
        txt = io.open(ruta, encoding="utf-8").read() if os.path.exists(ruta) else ""
        return len([l for l in txt.splitlines() if re.search(patron, l)])

    def audita(self, checks=None):
        """Escribe en el registro del gate lo que V1-V8 provocarian (ts actuales, seq correlativo)."""
        checks = checks or ["host-recursos", "host-recursos", "host-red", "host-servicios", "host-tiempo", "host-actualizaciones"]
        lineas = []
        for c in checks:
            for ev, res in (("gate_intencion", "intencion"), ("gate_resultado", "ok")):
                self.seq += 1
                lineas.append(json.dumps({"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "seq": self.seq, "evento": ev, "check": c, "resultado": res}))
        with io.open(self.audit, "a", newline="\n") as f:
            f.write("\n".join(lineas) + "\n")

    def estado(self):
        r = os.path.join(self.D, "f7-estado")
        return io.open(r, encoding="utf-8").read() if os.path.exists(r) else None

    def lee(self, nombre, defecto=""):
        r = os.path.join(self.S, nombre)
        return io.open(r, encoding="utf-8").read().strip() if os.path.exists(r) else defecto

    def limpiar(self):
        shutil.rmtree(self.t, ignore_errors=True)


def firma(clave, id_, ver="AUTOMATICAS_OK", ok=20, ko=0, pend=0, ab=0, fu=0, vence="", adm="NO_PROBADO"):
    msg = "F7R1|%s|%s|%s|%s|%s|%s|%s|%s|%s" % (id_, ver, ok, ko, pend, ab, fu, vence, adm)
    return hmac.new(clave.encode(), msg.encode(), hashlib.sha256).hexdigest()


def linea(id_, clave, vence, ver="AUTOMATICAS_OK", ok=20, ko=0, pend=0, ab=0, fu=0, adm="NO_PROBADO", hm=None):
    hm = hm or firma(clave, id_, ver, ok, ko, pend, ab, fu, vence, adm)
    return "F7R1 id=%s veredicto=%s ok=%s ko=%s pend=%s abortado=%s fuera=%s vence=%s admin=%s hmac=%s" % (id_, ver, ok, ko, pend, ab, fu, vence, adm, hm)


def activa(env):
    """consola B (222) registrada ANTES; activar desde la consola A (111). Devuelve (resultado, id, clave, vence)."""
    env.sh("consola-b", ppid=222)
    time.sleep(1.1)   # B_REG < T0 (resolucion de 1 s)
    r = env.sh("activar", ppid=111)
    m = re.search(r"-VenceUtc '([^']+)' -IdActivacion '([^']+)' -SecretoActivacion '([0-9a-f]+)'", r.stdout)
    if not m:
        return r, None, None, None
    return r, m.group(2), m.group(3), m.group(1)


class VpsCierre(unittest.TestCase):
    def setUp(self):
        self.e = Entorno()

    def tearDown(self):
        self.e.limpiar()

    def activar_ok(self):
        r, id_, clave, vence = activa(self.e)
        self.assertIn("F7_ACTIVADO", r.stdout, r.stdout + r.stderr)
        self.activar_salida = r.stdout
        return id_, clave, vence

    # ------------------------------------------------------------------ flujo feliz
    def test_flujo_completo_activar_y_cerrar(self):
        pre = self.e.sh("consola-b", ppid=222); self.assertIn("CONSOLA_B_REGISTRADA", pre.stdout)
        time.sleep(1.1)
        prep = self.e.sh("preparar", ppid=111); self.assertIn("F7_PREPARADO", prep.stdout, prep.stdout)
        id_, clave, vence = self.activar_ok()
        self.assertEqual(self.e.llamadas(r"^systemd-run"), 1, "un solo armado")
        # 3E.8.16: la ruta de Windows es RELATIVA a la raíz del repositorio (portable); se imprime intacta (sin escapes de echo) y sin la ruta absoluta antigua
        self.assertIn(r'-File ".\automation\scripts\F7-Validacion-Windows.ps1"', self.activar_salida, "la ruta de Windows se imprime intacta (sin escapes de echo)")
        self.assertNotIn("D:\\AXEL", self.activar_salida, "ya no hay ninguna ruta absoluta del equipo")
        self.assertIn("desde la raiz del repositorio", self.activar_salida)
        self.assertEqual(self.e.llamadas(r"^systemctl reload ssh"), 1)
        self.assertEqual(self.e.llamadas(r"^systemctl restart"), 0)
        self.assertTrue(os.path.exists(self.e.dropin))
        for ok in ("REVERSION_PRECISA", "VENCIMIENTO_VERIFICADO", "F7_VALIDADO", "ROOT_IDENTICO", "GLOBAL_IDENTICO", "TAI_EFECTIVO_OK"):
            self.assertIn(ok, self.activar_salida)
        self.e.audita()
        r = self.e.sh("cerrar", linea(id_, clave, vence), ppid=111)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("F7_CERRADO_OK", r.stdout)
        self.assertEqual(self.e.lee("timer"), "inactive")
        self.assertEqual(self.e.llamadas(r"^systemctl stop tai-reversion.timer"), 1)
        self.assertEqual(self.e.llamadas(r"^revertir"), 0, "no se revierte si todo es correcto")
        self.assertIsNone(self.e.estado(), "el estado de la activacion se destruye")
        hist = io.open(os.path.join(self.e.D, "f7-historial", id_ + ".CERRADA"), encoding="utf-8").read()
        self.assertIn("E_ESTADO=CERRADA", hist); self.assertNotIn("E_CLAVE", hist, "la clave no se conserva")
        self.assertTrue(os.path.exists(self.e.dropin), "cerrar con exito conserva la configuracion restringida")

    def test_el_mismo_resultado_no_cierra_dos_veces(self):
        id_, clave, vence = self.activar_ok(); self.e.audita()
        l = linea(id_, clave, vence)
        self.assertEqual(self.e.sh("cerrar", l, ppid=111).returncode, 0)
        r = self.e.sh("cerrar", l, ppid=111)
        self.assertNotEqual(r.returncode, 0); self.assertIn("F7_NO_HAY_ACTIVACION", r.stdout)

    # ------------------------------------------------------------------ requisito 6: otra activacion no autoriza
    def test_el_resultado_de_una_activacion_anterior_no_cierra_la_nueva(self):
        id1, clave1, vence1 = self.activar_ok(); self.e.audita()
        antigua = linea(id1, clave1, vence1)
        self.assertEqual(self.e.sh("cerrar", antigua, ppid=111).returncode, 0)
        # se revierte a mano y se hace una activacion NUEVA
        self.e.sh("revertir", ppid=111)
        self.assertFalse(os.path.exists(self.e.dropin))
        time.sleep(1.1)
        r, id2, clave2, vence2 = activa(self.e)
        self.assertIn("F7_ACTIVADO", r.stdout, r.stdout + r.stderr)
        self.assertNotEqual(id1, id2); self.assertNotEqual(clave1, clave2)
        self.e.audita()
        antes = self.e.llamadas(r"^systemctl stop tai-reversion.timer")
        r = self.e.sh("cerrar", antigua, ppid=111)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("F7_CIERRE_RECHAZADO", r.stdout); self.assertIn("no es el de esta activacion", r.stdout)
        self.assertIn("F7_REVERTIDO", r.stdout, "una condicion fallida revierte con seguridad")
        self.assertFalse(os.path.exists(self.e.dropin))

    def test_un_resultado_con_la_clave_de_otra_activacion_se_rechaza(self):
        id_, clave, vence = self.activar_ok(); self.e.audita()
        r = self.e.sh("cerrar", linea(id_, "00" * 16, vence), ppid=111)
        self.assertIn("firma HMAC", r.stdout); self.assertIn("F7_REVERTIDO", r.stdout)
        self.assertEqual(self.e.llamadas(r"^systemctl stop tai-reversion.timer"), 1, "solo el stop de la reversion correcta (rc=0)")

    # ------------------------------------------------------------------ condiciones: cualquier fallo => no cancelar y revertir
    def _fallo(self, preparar, esperado, **kw):
        id_, clave, vence = self.activar_ok(); self.e.audita()
        preparar(self.e, id_, clave, vence)
        args = dict(kw)
        r = self.e.sh("cerrar", linea(id_, clave, vence, **args), ppid=111)
        self.assertNotEqual(r.returncode, 0, r.stdout)
        self.assertIn("F7_CIERRE_RECHAZADO", r.stdout, r.stdout)
        self.assertIn(esperado, r.stdout, r.stdout)
        self.assertNotIn("F7_CERRADO_OK", r.stdout); self.assertNotIn("cancelada rc=", r.stdout, "no se cancela")
        self.assertIn("F7_REVERTIDO", r.stdout); self.assertEqual(self.e.llamadas(r"^revertir"), 1)
        return r

    def test_veredicto_distinto_de_automaticas_ok(self):
        self._fallo(lambda e, i, c, v: None, "veredicto de Windows = V_FALLA", ver="V_FALLA", ko=1)

    def test_incompleto_con_pendientes(self):
        self._fallo(lambda e, i, c, v: None, "veredicto de Windows = V_INCOMPLETO", ver="V_INCOMPLETO", pend=1, ok=19)

    def test_fuera_de_margen_en_windows(self):
        self._fallo(lambda e, i, c, v: None, "fuera_de_margen=1", fu=1)

    def test_pocas_pruebas(self):
        self._fallo(lambda e, i, c, v: None, "solo 19 pruebas correctas", ok=19)

    def test_acceso_admin_ssh_fallido(self):
        self._fallo(lambda e, i, c, v: None, "acceso administrativo por SSH", adm="FALLA")

    def test_vence_de_otra_tanda(self):
        id_, clave, vence = self.activar_ok(); self.e.audita()
        otro = "2020-01-01T00:00:00Z"
        r = self.e.sh("cerrar", linea(id_, clave, otro), ppid=111)
        self.assertIn("no es el de esta activacion", r.stdout); self.assertIn("F7_REVERTIDO", r.stdout)

    def test_temporizador_ya_vencido_o_distinto(self):
        def prep(e, i, c, v):
            e.escribe(os.path.join(e.S, "timer"), "inactive\n")
        r = self._fallo(prep, "el temporizador no esta active/waiting")

    def test_temporizador_de_otra_instancia(self):
        def prep(e, i, c, v):
            e.escribe(os.path.join(e.S, "mono"), "999\n")
        self._fallo(prep, "no es el que armo ESTA activacion")

    def test_margen_de_tiempo_insuficiente(self):
        def prep(e, i, c, v):
            now = int(time.time())
            e.escribe(os.path.join(e.S, "enter"), "%d\n" % (now - 580))                  # systemd: quedan ~20 s
            e.escribe(os.path.join(e.D, "rev_vence.epoch"), "%d\n" % (now + 20))
        self._fallo(prep, "quedan solo")

    def test_vencimiento_no_verificable(self):
        def prep(e, i, c, v):
            e.escribe(os.path.join(e.S, "enter"), "0\n")                                  # systemd no da ActiveEnterTimestamp
        self._fallo(prep, "vencimiento no verificable")

    def test_invariantes_distintos(self):
        def prep(e, i, c, v):
            e.escribe(os.path.join(e.S, "glob_extra"), "permitrootlogin yes\n")
        self._fallo(prep, "invariantes distintos")

    def test_consola_b_cerrada(self):
        def prep(e, i, c, v):
            e.consola(222, vivo=False)
        self._fallo(prep, "consola B")

    def test_consola_b_reutilizada_por_otro_proceso(self):
        def prep(e, i, c, v):
            d = os.path.join(e.proc, "222")
            e.escribe(os.path.join(d, "stat"), "222 (bash) S 1 1 1 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 77777 0 0\n")   # mismo PID, otro inicio
        self._fallo(prep, "consola B")

    def test_v13_permisos(self):
        self._fallo(lambda e, i, c, v: e.escribe(os.path.join(e.S, "v13_out"), "ESCRIBIBLE:/opt/tai-inspect\n"), "V13")

    def test_v14_sudo(self):
        self._fallo(lambda e, i, c, v: e.escribe(os.path.join(e.S, "sudo_out"), "User tai-inspect may run the following commands: (ALL) NOPASSWD: ALL\n"), "V14")

    def test_v14_grupos(self):
        self._fallo(lambda e, i, c, v: e.escribe(os.path.join(e.S, "id_g"), "997 27\n"), "V14")

    def test_v15_secuencia_rota(self):
        def prep(e, i, c, v):
            with io.open(e.audit, "a", newline="\n") as f:
                f.write(json.dumps({"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "seq": e.seq + 50, "evento": "gate_resultado", "check": "host-red", "resultado": "ok"}) + "\n")
        self._fallo(prep, "V15")

    def test_auditoria_sin_evidencia_de_las_peticiones(self):
        id_, clave, vence = self.activar_ok()      # NO se escribe auditoria: Windows "dice" OK pero el gate no vio nada
        r = self.e.sh("cerrar", linea(id_, clave, vence), ppid=111)
        self.assertIn("AUDITORIA", r.stdout); self.assertIn("F7_REVERTIDO", r.stdout); self.assertNotIn("cancelada rc=", r.stdout)

    def test_la_cancelacion_falla(self):
        id_, clave, vence = self.activar_ok(); self.e.audita()
        self.e.escribe(os.path.join(self.e.S, "stop_rc"), "1\n")
        r = self.e.sh("cerrar", linea(id_, clave, vence), ppid=111)
        self.assertNotEqual(r.returncode, 0); self.assertIn("F7_REVERSION_SEGURA: la cancelacion fallo", r.stdout)

    # ------------------------------------------------------------------ la reversion nunca detiene el temporizador si falla
    def test_si_la_reversion_falla_el_temporizador_se_conserva(self):
        id_, clave, vence = self.activar_ok(); self.e.audita()
        self.e.escribe(os.path.join(self.e.S, "revert_rc"), "4\n")
        r = self.e.sh("cerrar", linea(id_, clave, vence, ver="V_FALLA", ko=1), ppid=111)
        self.assertIn("REVERSION_FALLO rc=4", r.stdout)
        self.assertEqual(self.e.lee("timer"), "active", "el temporizador sigue armado")
        self.assertEqual(self.e.llamadas(r"^systemctl stop tai-reversion.timer"), 0)
        self.assertIn("E_ESTADO=REVERSION_FALLIDA", self.e.estado())
        # una activacion en ese estado NO puede cerrarse
        r2 = self.e.sh("cerrar", linea(id_, clave, vence), ppid=111)
        self.assertIn("F7_ESTADO_REVERSION_FALLIDA", r2.stdout); self.assertEqual(self.e.llamadas(r"^systemctl stop tai-reversion.timer"), 0)

    # ------------------------------------------------------------------ formato: no cancela ni revierte
    def test_linea_mal_copiada_no_cancela_ni_revierte(self):
        id_, clave, vence = self.activar_ok(); self.e.audita()
        for mala in ("", "F7R1 id=%s" % id_, "hola", linea(id_, clave, vence)[:-10], linea(id_, clave, vence) + " extra=1"):
            r = self.e.sh("cerrar", mala, ppid=111)
            self.assertEqual(r.returncode, 3, mala); self.assertIn("F7_ENTRADA_INVALIDA", r.stdout)
        self.assertEqual(self.e.llamadas(r"^systemctl stop tai-reversion.timer"), 0)
        self.assertEqual(self.e.llamadas(r"^revertir"), 0)
        self.assertEqual(self.e.lee("timer"), "active")
        # y la linea correcta todavia sirve
        self.assertEqual(self.e.sh("cerrar", linea(id_, clave, vence), ppid=111).returncode, 0)

    def test_sin_activacion_nada_que_cerrar(self):
        r = self.e.sh("cerrar", "F7R1 id=x", ppid=111)
        self.assertIn("F7_NO_HAY_ACTIVACION", r.stdout); self.assertEqual(self.e.llamadas(r"^systemctl stop"), 0)

    # ------------------------------------------------------------------ activacion: rechazos sin tocar nada y fallos con reversion
    def test_sin_consola_b_no_se_activa_nada(self):
        r = self.e.sh("activar", ppid=111)
        self.assertIn("F7_ACTIVACION_RECHAZADA", r.stdout); self.assertIn("CONSOLA B", r.stdout)
        self.assertFalse(os.path.exists(self.e.dropin)); self.assertEqual(self.e.llamadas(r"^systemd-run"), 0)

    def test_activar_desde_la_consola_b_se_rechaza(self):
        self.e.sh("consola-b", ppid=222); time.sleep(1.1)
        r = self.e.sh("activar", ppid=222)
        self.assertIn("esta es la consola B", r.stdout); self.assertEqual(self.e.llamadas(r"^systemd-run"), 0)

    def test_limitador_sin_esperar_se_rechaza(self):
        self.e.escribe(self.e.cuota, json.dumps({"last": {"host-actualizaciones": time.time() - 100}, "count": 3}))
        self.e.sh("consola-b", ppid=222); time.sleep(1.1)
        r = self.e.sh("activar", ppid=111)
        self.assertIn("F7_ACTIVACION_RECHAZADA", r.stdout); self.assertRegex(r.stdout, r"esperar 1\d\d s mas")
        self.assertEqual(self.e.llamadas(r"^systemd-run"), 0)

    def test_activar_no_pisa_una_activacion_sin_resolver(self):
        self.activar_ok()
        self.e.escribe(os.path.join(self.e.S, "timer"), "inactive\n"); os.remove(self.e.dropin)
        r = self.e.sh("activar", ppid=111)
        self.assertIn("activacion anterior sin resolver", r.stdout)

    def test_validacion_de_sshd_falla_retira_el_archivo_y_no_arma(self):
        self.e.sh("consola-b", ppid=222); time.sleep(1.1)
        self.e.escribe(os.path.join(self.e.S, "sshd_t_out"), "aviso: algo que sshd -t no deberia imprimir\n")   # sshd -t sale 0 pero NO en silencio
        r = self.e.sh("activar", ppid=111)
        self.assertIn("F7_FALLA", r.stdout); self.assertFalse(os.path.exists(self.e.dropin))
        self.assertEqual(self.e.llamadas(r"^systemd-run"), 0); self.assertEqual(self.e.llamadas(r"^systemctl reload"), 0)

    def test_temporizador_impreciso_no_recarga_y_revierte(self):
        self.e.sh("consola-b", ppid=222); time.sleep(1.1)
        self.e.escribe(os.path.join(self.e.S, "accuracy"), "1min\n")
        r = self.e.sh("activar", ppid=111)
        self.assertIn("REVERSION_IMPRECISA_PARAR", r.stdout); self.assertIn("F7_REVERTIDO", r.stdout)
        self.assertEqual(self.e.llamadas(r"^systemctl reload"), 0)

    def test_armado_fallido_no_recarga(self):
        self.e.sh("consola-b", ppid=222); time.sleep(1.1)
        self.e.escribe(os.path.join(self.e.S, "arm_rc"), "1\n")
        r = self.e.sh("activar", ppid=111)
        self.assertIn("F7_REVERSION_SEGURA", r.stdout); self.assertEqual(self.e.llamadas(r"^systemctl reload"), 0); self.assertFalse(os.path.exists(self.e.dropin))

    def test_recarga_fallida_revierte(self):
        self.e.sh("consola-b", ppid=222); time.sleep(1.1)
        self.e.escribe(os.path.join(self.e.S, "reload_rc"), "1\n")
        r = self.e.sh("activar", ppid=111)
        self.assertIn("F7_REVERSION_SEGURA: la recarga de ssh fallo", r.stdout); self.assertFalse(os.path.exists(self.e.dropin))
        self.assertIsNone(self.e.estado())

    # ------------------------------------------------------------------ margen de 90 s
    def _con_restan(self, segundos):
        def prep(e, i, c, v):
            now = int(time.time())
            e.escribe(os.path.join(e.S, "enter"), "%d\n" % (now - 600 + segundos))
            e.escribe(os.path.join(e.D, "rev_vence.epoch"), "%d\n" % (now + segundos))
        return prep

    def test_margen_de_90_s_exacto_al_empezar(self):
        self._fallo(self._con_restan(80), "quedan solo")                      # 80 s < 90 s: no se autoriza

    def test_con_mas_de_90_s_y_controles_completos_se_cierra(self):
        id_, clave, vence = self.activar_ok(); self.e.audita()
        self._con_restan(120)(self.e, id_, clave, vence)
        t = time.time()
        r = self.e.sh("cerrar", linea(id_, clave, vence), ppid=111)
        self.assertEqual(r.returncode, 0, r.stdout)
        m = re.search(r"controles_s=(\d+) restan_s=(\d+)", r.stdout)
        self.assertIsNotNone(m, r.stdout)
        self.assertLessEqual(int(m.group(1)), 45, "los controles completos caben en el margen")
        self.assertGreaterEqual(int(m.group(2)), 20)
        self.assertLess(time.time() - t, 60, "evaluacion y cierre completos en menos de 60 s (aqui con programas simulados y bash de Windows)")

    # ------------------------------------------------------------------ secretos de un solo uso
    def test_la_clave_de_un_solo_uso_no_queda_en_registros_ni_salidas_innecesarias(self):
        r, id_, clave, vence = activa(self.e)
        self.assertEqual(r.stdout.count(clave), 1, "la clave se imprime UNA sola vez (en la linea de Windows)")
        self.assertNotIn(clave, r.stderr)
        self.e.audita()
        c = self.e.sh("cerrar", linea(id_, clave, vence), ppid=111)
        self.assertEqual(c.returncode, 0)
        self.assertNotIn(clave, c.stdout + c.stderr)
        for raiz, _, nombres in os.walk(self.e.t):
            for n in nombres:
                ruta = os.path.join(raiz, n)
                if n == "calls.txt":
                    continue      # registro del programa simulado de pruebas (no existe en el VPS)
                self.assertNotIn(clave, io.open(ruta, encoding="utf-8", errors="replace").read(), "clave persistida en " + ruta)

    def test_la_clave_se_destruye_si_la_reversion_falla(self):
        id_, clave, vence = self.activar_ok(); self.e.audita()
        self.e.escribe(os.path.join(self.e.S, "revert_rc"), "4\n")
        r = self.e.sh("cerrar", linea(id_, clave, vence, ver="V_FALLA", ko=1), ppid=111)
        self.assertNotIn(clave, r.stdout); self.assertNotIn("E_CLAVE", self.e.estado())

    def test_la_clave_no_viaja_en_argumentos_de_procesos(self):
        with io.open(SCRIPT, encoding="utf-8") as fh:
            src = fh.read()
        self.assertNotIn("sys.argv[1:4]", src)
        self.assertRegex(src, r"hmac_ok\(\) \{ printf '%s\\n%s\\n%s\\n' \"\$1\" \"\$2\" \"\$3\" \| python3")

    # ------------------------------------------------------------------ formatos reales distintos de los esperados => falla seguro, ANTES de armar
    def _preparar_falla(self, preparar, esperado):
        self.e.sh("consola-b", ppid=222)
        preparar(self.e)
        r = self.e.sh("preparar", ppid=111)
        self.assertIn("F7_PREPARACION_FALLA", r.stdout, r.stdout); self.assertIn(esperado, r.stdout, r.stdout)
        a = self.e.sh("activar", ppid=111)
        self.assertIn("F7_ACTIVACION_RECHAZADA", a.stdout)
        self.assertEqual(self.e.llamadas(r"^systemd-run"), 0); self.assertFalse(os.path.exists(self.e.dropin))

    def test_formato_de_timestamp_de_systemd_no_reconocido(self):
        self._preparar_falla(lambda e: e.escribe(os.path.join(e.S, "ssh_enter"), "n/a\n"), "ActiveEnterTimestamp de systemd no reconocido")

    def test_formato_del_contador_monotono_no_reconocido(self):
        self._preparar_falla(lambda e: e.escribe(os.path.join(e.S, "ssh_mono"), "abc\n"), "ActiveEnterTimestampMonotonic no reconocido")

    def test_registro_del_gate_vacio_o_con_otro_formato(self):
        self._preparar_falla(lambda e: e.escribe(e.audit, ""), "no tiene el formato esperado")
        self.tearDown(); self.setUp()
        self._preparar_falla(lambda e: e.escribe(e.audit, "2026-11-14 gate_resultado host-red ok\n2026-11-14 gate_resultado host-red ok\n"), "no tiene el formato esperado")
        self.tearDown(); self.setUp()
        self._preparar_falla(lambda e: e.escribe(e.audit, '{"ts":"14/11/2026","seq":"1","evento":"x"}\n{"ts":"14/11/2026","seq":"2","evento":"x"}\n'), "no tiene el formato esperado")

    def test_limitador_con_otro_formato(self):
        self._preparar_falla(lambda e: e.escribe(e.cuota, "{rota"), "no se puede leer el limitador")

    def test_salida_de_sudo_no_reconocida_no_autoriza(self):
        self._fallo(lambda e, i, c, v: e.escribe(os.path.join(e.S, "sudo_out"), "El usuario tai-inspect no esta en el archivo sudoers\n"), "V14")

    def test_marca_temporal_de_systemd_ilegible_al_armar_no_recarga_y_revierte(self):
        self.e.sh("consola-b", ppid=222); time.sleep(1.1)
        self.e.escribe(os.path.join(self.e.S, "enter_forzado"), "basura\n")
        r = self.e.sh("activar", ppid=111)
        self.assertIn("VENCIMIENTO_NO_VERIFICABLE_PARAR", r.stdout); self.assertIn("F7_REVERTIDO", r.stdout)
        self.assertEqual(self.e.llamadas(r"^systemctl reload"), 0); self.assertFalse(os.path.exists(self.e.dropin))

    def test_contador_monotono_vacio_al_armar_revierte_sin_recargar(self):
        self.e.sh("consola-b", ppid=222); time.sleep(1.1)
        # el simulado de systemd-run no crea 'mono' si existe un directorio con ese nombre: se emula con el archivo vacio por el stub
        self.e.escribe(os.path.join(self.e.S, "forzar_mono_vacio"), "1\n")
        r = self.e.sh("activar", ppid=111)
        self.assertIn("F7_REVERTIDO", r.stdout, r.stdout); self.assertEqual(self.e.llamadas(r"^systemctl reload"), 0)

    # ------------------------------------------------------------------ bloque de pegado
    def _ejecuta_bloque(self, txt):
        d = os.path.join(self.e.t, "pegado"); os.makedirs(d)
        txt = txt.replace("D=/root/tai-etapa2", "D=" + p(d), 1)
        r = subprocess.run([BASH, "--posix", "-s"], input=txt, capture_output=True, text=True, timeout=60)   # por la entrada estandar, como al pegar en la consola
        return d, r

    def test_el_bloque_de_pegado_instala_solo_el_script_aprobado(self):
        ruta = os.path.join(RAIZ, "automation", "scripts", "F7-VPS-pegar.txt")
        with io.open(ruta, encoding="utf-8", newline="") as fh:
            txt = fh.read()
        d, r = self._ejecuta_bloque(txt)
        with io.open(SCRIPT, "rb") as fh:
            esperado = fh.read()
        self.assertIn("F7_SCRIPT_INSTALADO_OK " + hashlib.sha256(esperado).hexdigest(), r.stdout, r.stdout + r.stderr)
        with io.open(os.path.join(d, "f7-vps.sh"), "rb") as fh:
            self.assertEqual(fh.read(), esperado)
        self.assertFalse(os.path.exists(os.path.join(d, "f7-vps.sh.nuevo")))

    def test_el_bloque_de_pegado_descarta_un_script_alterado(self):
        ruta = os.path.join(RAIZ, "automation", "scripts", "F7-VPS-pegar.txt")
        with io.open(ruta, encoding="utf-8", newline="") as fh:
            txt = fh.read()
        malo = txt.replace("MARGEN_CIERRE=90", "MARGEN_CIERRE=1", 1)
        self.assertNotEqual(malo, txt)
        d, r = self._ejecuta_bloque(malo)
        self.assertIn("F7_SCRIPT_CORRUPTO_NO_USAR", r.stdout, r.stdout + r.stderr); self.assertNotIn("INSTALADO_OK", r.stdout)
        self.assertFalse(os.path.exists(os.path.join(d, "f7-vps.sh")), "no queda instalado"); self.assertFalse(os.path.exists(os.path.join(d, "f7-vps.sh.nuevo")))

    # ------------------------------------------------------------------ consola B: comprobacion de solo lectura
    def test_la_comprobacion_de_la_consola_b_no_modifica_nada_ni_cierra_la_consola(self):
        self.e.sh("consola-b", ppid=222)
        antes = io.open(os.path.join(self.e.D, "f7-consola-b"), encoding="utf-8").read()
        for _ in range(3):
            self.e.sh("estado", ppid=111)
        self.assertEqual(io.open(os.path.join(self.e.D, "f7-consola-b"), encoding="utf-8").read(), antes)
        self.assertIn("consola B: viva", self.e.sh("estado", ppid=111).stdout)
        self.assertTrue(os.path.exists(os.path.join(self.e.proc, "222", "stat")))
        self.assertEqual(self.e.llamadas(r"kill|pkill|stop|restart"), 0)
        with io.open(SCRIPT, encoding="utf-8") as fh:
            src = fh.read()
        self.assertNotRegex(src, r"(?m)^[^#]*\b(kill|pkill|killall)\b")

    # ------------------------------------------------------------------ invariantes ANTES de empezar y vigilancia de accesos de root
    def test_invariantes_distintos_antes_de_empezar_no_arma_nada(self):
        self.e.sh("consola-b", ppid=222); time.sleep(1.1)
        self.e.escribe(os.path.join(self.e.S, "glob_extra"), "permitrootlogin yes\n")        # p. ej. authorized_keys reescrito por el proveedor
        for modo in ("preparar", "activar"):
            r = self.e.sh(modo, ppid=111)
            self.assertIn("ANTES de empezar", r.stdout, r.stdout)
        self.assertEqual(self.e.llamadas(r"^systemd-run"), 0); self.assertFalse(os.path.exists(self.e.dropin))
        self.assertEqual(self.e.llamadas(r"^systemctl reload"), 0)

    @staticmethod
    def _iso(delta=0):
        return time.strftime("%Y-%m-%dT%H:%M:%S+0000", time.gmtime(time.time() + delta))

    def _acceso_root(self, ts, fp, ip="169.254.0.1", metodo="publickey"):
        if metodo != "publickey":
            return "%s vps sshd[900]: Accepted %s for root from %s port 5 ssh2\n" % (ts, metodo, ip)
        return "%s vps sshd[900]: Accepted publickey for root from %s port 5 ssh2: ED25519 %s\n" % (ts, ip, fp)

    def test_un_acceso_de_root_con_clave_desconocida_durante_la_activacion_bloquea_el_cierre(self):
        id_, clave, vence = self.activar_ok(); self.e.audita()
        self.e.escribe(os.path.join(self.e.S, "ssh_journal"), self._acceso_root(self._iso(+1), "SHA256:" + "R" * 43))
        r = self.e.sh("cerrar", linea(id_, clave, vence), ppid=111)
        self.assertNotEqual(r.returncode, 0); self.assertIn("ACCESOS_ROOT", r.stdout); self.assertIn("F7_REVERTIDO", r.stdout); self.assertNotIn("cancelada rc=", r.stdout)

    def test_un_acceso_de_root_por_contrasena_durante_la_activacion_bloquea_el_cierre(self):
        id_, clave, vence = self.activar_ok(); self.e.audita()
        self.e.escribe(os.path.join(self.e.S, "ssh_journal"), self._acceso_root(self._iso(+1), "", "198.51.100.7", metodo="password"))
        r = self.e.sh("cerrar", linea(id_, clave, vence), ppid=111)
        self.assertIn("ACCESOS_ROOT", r.stdout); self.assertIn("F7_REVERTIDO", r.stdout)

    def test_accesos_antiguos_o_de_la_clave_conocida_no_bloquean(self):
        id_, clave, vence = self.activar_ok(); self.e.audita()
        self.e.escribe(os.path.join(self.e.S, "ssh_journal"),
                       self._acceso_root(self._iso(-3600), "SHA256:" + "R" * 43)                     # una temporal ANTERIOR a la activacion (p. ej. al abrir la consola B)
                       + self._acceso_root(self._iso(+1), "SHA256:zzEk73jAM3o9yO0f7uBlYhu2gZhxRWbpTrL0RzKIlfE", "176.84.216.197"))
        r = self.e.sh("cerrar", linea(id_, clave, vence), ppid=111)
        self.assertEqual(r.returncode, 0, r.stdout); self.assertIn("F7_CERRADO_OK", r.stdout)

    def test_registro_de_sshd_ilegible_al_cerrar_bloquea(self):
        id_, clave, vence = self.activar_ok(); self.e.audita()
        self.e.escribe(os.path.join(self.e.S, "ssh_journal_falla"), "1")
        r = self.e.sh("cerrar", linea(id_, clave, vence), ppid=111)
        self.assertIn("ACCESOS_ROOT: no se puede leer el registro de sshd", r.stdout); self.assertIn("F7_REVERTIDO", r.stdout)

    # ------------------------------------------------------------------ authorized_keys reescrito por el proveedor: identidad por huella, resto estricto
    def _hash_ak_en(self, nombre):
        for l in io.open(os.path.join(self.e.D, nombre), encoding="utf-8", errors="replace").read().splitlines():
            if re.match(r"^[0-9a-f]{64} [ *].*authorized_keys$", l):
                return l.split()[0]

    def test_reescritura_con_la_misma_clave_no_bloquea_preparar_activar_ni_cerrar(self):
        self.e.sh("consola-b", ppid=222); time.sleep(1.1)
        self.e.escribe(self.e.ak, "# gestionado por el proveedor\nssh-ed25519 KEYGOOD otro-comentario\n\n")      # misma clave, otro contenido (otro hash)
        prep = self.e.sh("preparar", ppid=111)
        self.assertIn("F7_PREPARADO", prep.stdout, prep.stdout)
        self.assertNotEqual(self._hash_ak_en("invariantes-base.txt"), self._hash_ak_en("invariantes-previo.txt"), "la prueba ejercita un hash DISTINTO")
        r, id_, clave, vence = activa(self.e)
        self.assertIn("F7_ACTIVADO", r.stdout, r.stdout + r.stderr)
        self.e.escribe(self.e.ak, "ssh-ed25519 KEYGOOD tercer-comentario\n")                                       # otra reescritura DENTRO de la ventana
        self.e.audita()
        c = self.e.sh("cerrar", linea(id_, clave, vence), ppid=111)
        self.assertEqual(c.returncode, 0, c.stdout); self.assertIn("F7_CERRADO_OK", c.stdout)
        self.assertEqual(self.e.llamadas(r"^revertir"), 0)

    def _clave_no_valida(self, contenido, esperado, perm=None):
        self.e.sh("consola-b", ppid=222); time.sleep(1.1)
        if perm:
            self.e.escribe(os.path.join(self.e.S, "ak_perm"), perm + "\n")
        self.e.escribe(self.e.ak, contenido)
        for modo in ("preparar", "activar"):
            r = self.e.sh(modo, ppid=111)
            self.assertIn("CLAVE_ROOT", r.stdout, r.stdout); self.assertIn(esperado, r.stdout, r.stdout)
        self.assertEqual(self.e.llamadas(r"^systemd-run"), 0); self.assertFalse(os.path.exists(self.e.dropin))

    def test_clave_anadida_bloquea(self):
        self._clave_no_valida("ssh-ed25519 KEYGOOD a\nssh-ed25519 OTRA b\n", "exactamente una clave")

    def test_clave_sustituida_bloquea(self):
        self._clave_no_valida("ssh-ed25519 OTRA c\n", "no es la del propietario")

    def test_opciones_ssh_bloquean(self):
        for linea_ak in ('command="id" ssh-ed25519 KEYGOOD c\n', 'no-pty,from="1.2.3.4" ssh-ed25519 KEYGOOD c\n', 'restrict ssh-ed25519 KEYGOOD c\n'):
            self.tearDown(); self.setUp()
            self._clave_no_valida(linea_ak, "opciones o no es ED25519")

    def test_permisos_incorrectos_bloquean(self):
        self._clave_no_valida("ssh-ed25519 KEYGOOD c\n", "root:root 600", perm="root:root 644")

    def test_propietario_incorrecto_bloquea(self):
        self._clave_no_valida("ssh-ed25519 KEYGOOD c\n", "root:root 600", perm="usuario:usuario 600")

    def test_tipo_de_clave_distinto_bloquea(self):
        self._clave_no_valida("ssh-rsa KEYGOOD c\n", "opciones o no es ED25519")

    def test_archivo_inexistente_bloquea(self):
        self.e.sh("consola-b", ppid=222); time.sleep(1.1); os.remove(self.e.ak)
        r = self.e.sh("preparar", ppid=111)
        self.assertIn("CLAVE_ROOT", r.stdout)

    def test_clave_anadida_durante_la_ventana_bloquea_el_cierre_y_revierte(self):
        id_, clave, vence = self.activar_ok(); self.e.audita()
        self.e.escribe(self.e.ak, "ssh-ed25519 KEYGOOD a\nssh-ed25519 OTRA b\n")
        r = self.e.sh("cerrar", linea(id_, clave, vence), ppid=111)
        self.assertNotEqual(r.returncode, 0); self.assertIn("CLAVE_ROOT", r.stdout); self.assertIn("F7_REVERTIDO", r.stdout); self.assertNotIn("cancelada rc=", r.stdout)

    def test_clave_con_opciones_durante_la_ventana_bloquea_el_cierre(self):
        id_, clave, vence = self.activar_ok(); self.e.audita()
        self.e.escribe(self.e.ak, 'command="id" ssh-ed25519 KEYGOOD a\n')
        r = self.e.sh("cerrar", linea(id_, clave, vence), ppid=111)
        self.assertIn("CLAVE_ROOT", r.stdout); self.assertIn("F7_REVERTIDO", r.stdout)

    def test_el_resto_de_invariantes_sigue_siendo_estricto_aunque_cambie_el_hash_de_authorized_keys(self):
        self.e.sh("consola-b", ppid=222); time.sleep(1.1)
        self.e.escribe(self.e.ak, "ssh-ed25519 KEYGOOD otro-comentario\n")
        self.e.escribe(os.path.join(self.e.S, "glob_extra"), "permitrootlogin yes\n")
        r = self.e.sh("preparar", ppid=111)
        self.assertIn("F7_PREPARACION_FALLA", r.stdout); self.assertIn("ANTES de empezar", r.stdout)

    def test_el_resto_de_invariantes_estricto_en_el_cierre(self):
        id_, clave, vence = self.activar_ok(); self.e.audita()
        self.e.escribe(self.e.ak, "ssh-ed25519 KEYGOOD otro-comentario\n")
        self.e.escribe(os.path.join(self.e.S, "glob_extra"), "permitrootlogin yes\n")
        r = self.e.sh("cerrar", linea(id_, clave, vence), ppid=111)
        self.assertIn("invariantes distintos", r.stdout); self.assertIn("F7_REVERTIDO", r.stdout)

    def test_una_referencia_sin_la_linea_del_hash_no_se_acepta(self):
        self.e.sh("consola-b", ppid=222); time.sleep(1.1)
        base = os.path.join(self.e.D, "invariantes-base.txt")
        txt = io.open(base, encoding="utf-8", newline="").read()
        io.open(base, "w", encoding="utf-8", newline="").write(re.sub(r"(?m)^[0-9a-f]{64} [ *].*authorized_keys\r?\n", "", txt))
        r = self.e.sh("preparar", ppid=111)
        self.assertIn("ANTES de empezar", r.stdout)

    def test_la_comparacion_no_usa_diff_directo_de_la_referencia(self):
        with io.open(SCRIPT, encoding="utf-8") as fh:
            src = fh.read()
        self.assertNotRegex(src, r"\bdiff\s+\S*invariantes-base\.txt\s+\S*invariantes-\w+\.txt\s*>\s*/dev/null", "ninguna comparacion directa (>/dev/null) de la referencia")
        self.assertEqual(src.count("inv_igual "), 4, "previos, cerrar (previo), cerrar (despues) y revertir_seguro")
        self.assertEqual((src.count("clave_root_ok()"), src.count("$(clave_root_ok)"), src.count("clave_root_ok > /dev/null")), (1, 2, 1))   # definicion, previos+cerrar y comprobacion final

    # ------------------------------------------------------------------ invariantes del propio script
    def test_el_script_solo_detiene_el_temporizador_en_dos_sitios_condicionados(self):
        src = io.open(SCRIPT, encoding="utf-8").read()
        usos = [l.strip() for l in src.splitlines() if "systemctl stop tai-reversion.timer" in l and not l.strip().startswith("#")]
        self.assertEqual(len(usos), 2, usos)
        self.assertTrue(any(u.startswith("if systemctl is-active --quiet tai-reversion.timer") for u in usos))   # dentro de revertir_seguro con rc=0
        self.assertTrue(any(u.startswith("systemctl stop tai-reversion.timer; rc=$?") for u in usos))           # cerrar, tras TODAS las condiciones
        self.assertEqual(src.count("systemd-run --unit="), 1, "un solo armado; nunca rearmado")
        self.assertNotIn("restart", src.replace("nunca restart", ""))
        self.assertNotRegex(src, r"(?m)^[^#]*(rm -f|rm -rf)\s+/etc/ssh(?!/sshd_config\.d/00-tai-inspect)")
        # el unico cuerpo de decision va entre la lectura del formato y la cancelacion
        self.assertLess(src.index("comprobar_auditoria \"$E_T0\""), src.index("systemctl stop tai-reversion.timer; rc=$?"))
        self.assertLess(src.index('hmac_ok "$E_CLAVE"'), src.index("systemctl stop tai-reversion.timer; rc=$?"))

    def test_el_script_no_toca_la_configuracion_de_ssh_ni_el_gate(self):
        src = io.open(SCRIPT, encoding="utf-8").read()
        for prohibido in ("sshd_config ", "> /etc/ssh/authorized_keys", ">> /etc/ssh", "/opt/tai-inspect/bin", "chattr", "ufw", "iptables", "docker service update"):
            self.assertNotIn(prohibido, src.replace("/etc/ssh/sshd_config; echo", "").replace("/etc/ssh/sshd_config\"", ""), prohibido)

    def test_sintaxis_posix(self):
        r = subprocess.run([BASH, "--posix", "-n", p(SCRIPT)], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_el_bloque_de_pegado_contiene_exactamente_el_script(self):
        ruta = os.path.join(RAIZ, "automation", "scripts", "F7-VPS-pegar.txt")
        txt = io.open(ruta, encoding="utf-8", newline="").read().replace("\r\n", "\n")
        src = io.open(SCRIPT, encoding="utf-8", newline="").read().replace("\r\n", "\n")
        self.assertIn("cat > $D/f7-vps.sh.nuevo <<'TAI_F7_EOF'\n" + src + "TAI_F7_EOF\n", txt)
        for frag in ("chmod 700 $D/f7-vps.sh.nuevo", "chown root:root", "F7_SCRIPT_CORRUPTO_NO_USAR", "F7_SCRIPT_INSTALADO_OK", "umask 077"):
            self.assertIn(frag, txt)
        self.assertNotRegex(txt.split("TAI_F7_EOF\n")[-1], r"(?m)^\s*exit\b", "el bloque no cierra la consola del usuario")
        self.assertIn(hashlib.sha256(src.encode("utf-8")).hexdigest(), txt, "el bloque de pegado lleva la huella esperada")


@unittest.skipUnless(shutil.which("powershell.exe"), "requiere Windows PowerShell")
class WindowsYVpsJuntos(unittest.TestCase):
    """El script REAL de Windows (contra un ssh simulado) produce la linea que verifica el script REAL de la consola (HMAC compatible)."""

    def setUp(self):
        self.e = Entorno()
        self.w = tempfile.mkdtemp(prefix="tai-f7ps-")

    def tearDown(self):
        self.e.limpiar(); shutil.rmtree(self.w, ignore_errors=True)

    def windows(self, modo, id_, clave, vence, admin=False, x=None):
        cmd = ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", os.path.join(AQUI, "f7_ps", "harness.ps1"), "-Modo", modo,
               "-Script", PS1, "-Dir", self.w, "-Id", id_, "-Clave", clave, "-Vence", vence]
        if admin:
            cmd.append("-ConAdmin")
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        m = re.search(r"cerrar '(F7R1 [^']+)'", r.stdout)
        return r.stdout, (m.group(1) if m else None)

    def test_normal_con_admin_cierra(self):
        r, id_, clave, vence = activa(self.e)
        self.assertIn("F7_ACTIVADO", r.stdout, r.stdout + r.stderr)
        self.e.audita()
        out, l = self.windows("normal", id_, clave, vence, admin=True)
        self.assertIsNotNone(l, out); self.assertIn("AUTOMATICAS_OK", out); self.assertIn("veredicto=AUTOMATICAS_OK", l); self.assertIn("admin=SSH_OK", l)
        c = self.e.sh("cerrar", l, ppid=111)
        self.assertEqual(c.returncode, 0, c.stdout + c.stderr); self.assertIn("F7_CERRADO_OK", c.stdout)

    def test_windows_con_fallo_hace_que_la_consola_revierta(self):
        r, id_, clave, vence = activa(self.e); self.e.audita()
        out, l = self.windows("pty_concedido", id_, clave, vence)
        self.assertIn("veredicto=V_FALLA", l)
        c = self.e.sh("cerrar", l, ppid=111)
        self.assertIn("F7_REVERTIDO", c.stdout); self.assertNotIn("cancelada rc=", c.stdout)

    def test_admin_ssh_que_falla(self):
        r, id_, clave, vence = activa(self.e); self.e.audita()
        out, l = self.windows("admin_falla", id_, clave, vence, admin=True)
        self.assertIn("admin=FALLA", l)
        c = self.e.sh("cerrar", l, ppid=111)
        self.assertIn("F7_REVERTIDO", c.stdout)

    def test_clave_incorrecta_en_windows_no_cierra(self):
        r, id_, clave, vence = activa(self.e); self.e.audita()
        out, l = self.windows("normal", id_, "ff" * 16, vence)
        c = self.e.sh("cerrar", l, ppid=111)
        self.assertIn("firma HMAC", c.stdout); self.assertIn("F7_REVERTIDO", c.stdout)


if __name__ == "__main__":
    unittest.main()
