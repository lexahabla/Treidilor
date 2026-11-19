# -*- coding: utf-8 -*-
"""Pruebas LOCALES (sin VPS, sin red, sin Docker) de automation/scripts/f7-referencia.sh (verificar, clasificar y aprobar) y de su bloque de pegado.

Se ejecuta con bash --posix y programas simulados (sshd, docker, ss, systemctl, journalctl, stat) en un directorio temporal.
Las rutas fijas del servidor solo se sustituyen con TAI_F7_PRUEBAS=1 (variable que no existe en el VPS).
"""
import hashlib
import io
import os
import re
import shutil
import subprocess
import tempfile
import unittest

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.abspath(os.path.join(AQUI, "..", "..", ".."))
SCRIPT = os.path.join(RAIZ, "automation", "scripts", "f7-referencia.sh")
PEGAR = os.path.join(RAIZ, "automation", "scripts", "F7-REFERENCIA-pegar.txt")
BASH = r"C:\Program Files\Git\bin\bash.exe"
if not os.path.exists(BASH):
    BASH = shutil.which("bash") or "bash"
SSH_DIR = os.path.expanduser("~/.ssh")
EXP = "SHA256:zzEk73jAM3o9yO0f7uBlYhu2gZhxRWbpTrL0RzKIlfE"
ANT = "b6844f77fc79c167c54be083865fc99ec5b01a41c30e4f4d19da26e9052f9757"
TEMPORALES = ["MEl5trNFK6qjlZf6ZPsyXjAdFAPz1wgqYE7Ra9gHq3Y", "VgMn6IkpdREAwlaxYcthXs8VuqgP5AdivssDget93es", "abJQSyckM1cqSjiHQOViZPenkiRAXpcVYMz9j8NkuGw",
              "jEsHrue29MoKJP1sEz4i6RWjMEfj0K15FJpnwJlEvwk", "kr0M0l6cLy4/YMulfY9atpzz/4xWK8FIaavfV3ZpElQ", "o46G9rMhyvTi9IkjYZYlhlK8ajUHi78/E4EEZu/Hh5U",
              "xC+DFYIh4WmbHWMYVT9q8duvvgPGv6kPi21yktSP/2I"]


def p(x):
    return x.replace("\\", "/")


def msys(x):
    return re.sub(r"^([A-Za-z]):", lambda m: "/" + m.group(1).lower(), p(x))


def leer(ruta, modo="r"):
    with io.open(ruta, modo, **({} if "b" in modo else {"encoding": "utf-8", "newline": ""})) as fh:
        return fh.read()


def escribe(ruta, texto):
    with io.open(ruta, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(texto)


def clave_publica(nombre):
    ruta = os.path.join(SSH_DIR, nombre)
    return leer(ruta).replace("\r\n", "\n") if os.path.exists(ruta) else None


def acceso(ts, pid, ip, fp, metodo="publickey", tipo="ED25519"):
    if metodo != "publickey":
        return "%s vps sshd[%s]: Accepted %s for root from %s port 5 ssh2\n" % (ts, pid, metodo, ip)
    return "%s vps sshd[%s]: Accepted publickey for root from %s port 5 ssh2: %s %s\n" % (ts, pid, ip, tipo, fp)


def journal_normal():
    return "".join(acceso("2026-11-14T10:0%d:00+0000" % i, 100 + i, "176.84.216.197", EXP) for i in range(6))


def journal_con_temporales(extra=""):
    return journal_normal() + "".join(acceso("2026-11-14T15:%02d:33+0000" % (30 + i), 200 + i, "169.254.0.1", "SHA256:" + fp, tipo="RSA") for i, fp in enumerate(TEMPORALES)) + extra


STAT = r'''#!/bin/sh
case "$2" in
  "%U:%G %a") cat $TAI_T/stat_perm 2>/dev/null || echo "root:root 600" ;;
  "%U:%G %a size=%s mtime=%y") [ -f $TAI_T/stat_falla ] && exit 1; echo "root:root 600 size=99 mtime=2026-11-14 15:37:32" ;;
  "%y") echo "2026-11-14 15:37:32" ;;
  *) /usr/bin/stat "$@" ;;
esac
'''
STUBS = {
    "sshd": "#!/bin/sh\ncat $TAI_T/sshd.txt\n",
    "docker": '#!/bin/sh\necho "web|1/1"\n',
    "ss": '#!/bin/sh\nn=$(cat $TAI_T/ssn 2>/dev/null || echo 0); n=$((n+1)); echo $n > $TAI_T/ssn\nif [ -f $TAI_T/ss_flip ] && [ $n -ge 2 ]; then echo "tcp LISTEN 0 128 0.0.0.0:99"; else echo "tcp LISTEN 0 128 0.0.0.0:22"; fi\n',
    "systemctl": '#!/bin/sh\necho active; [ -n "$3" ] && echo active; exit 0\n',
    "journalctl": '#!/bin/sh\n[ -f $TAI_T/journal_falla ] && exit 1\ncat $TAI_T/journal.txt\n',
    "stat": STAT,
}


class Entorno(object):
    def __init__(self, ak=None, journal=None):
        self.t = tempfile.mkdtemp(prefix="tai-f7ref-")
        self.D = os.path.join(self.t, "D"); self.bin = os.path.join(self.t, "bin")
        os.makedirs(self.D); os.makedirs(self.bin)
        self.F = os.path.join(self.t, "authorized_keys")
        self.contenido = ak if ak is not None else clave_publica("id_ed25519.pub")
        escribe(self.F, self.contenido)
        for n, c in STUBS.items():
            escribe(os.path.join(self.bin, n), c)
        escribe(os.path.join(self.t, "sshd.txt"), "port 22\n")
        escribe(os.path.join(self.t, "journal.txt"), journal if journal is not None else journal_normal())
        self.sha_nuevo = hashlib.sha256(self.contenido.encode()).hexdigest()
        self.run_inv()        # referencia ORIGINAL simulada: la salida de inv() con el hash anterior de authorized_keys
        ruta = os.path.join(self.D, "invariantes-base.txt")
        base = re.sub(r"(?m)^[0-9a-f]{64}( .*authorized_keys)$", ANT + r"\1", leer(ruta))
        with io.open(ruta, "w", encoding="utf-8", newline="") as fh:
            fh.write(base)
        self.base_original = base
        if os.path.exists(os.path.join(self.t, "ssn")):
            os.remove(os.path.join(self.t, "ssn"))
        self.orig = self.ruta("invariantes-base.original-%s.txt" % ANT[:12])
        self.acta = self.ruta("invariantes-aprobacion-%s-%s.txt" % (ANT[:12], self.sha_nuevo[:12]))

    def env(self, **extra):
        e = dict(os.environ, TAI_F7_PRUEBAS="1", TAI_F=p(self.F), TAI_D=p(self.D), TAI_T=p(self.t), TAI_EXP=EXP, TAI_BIN=msys(self.bin))
        e.pop("APRUEBO", None); e.pop("SHA_APROBADO", None)
        e.update(extra)
        return e

    def run_inv(self):
        src = leer(SCRIPT)
        fun = re.search(r"^inv\(\).*$", src, re.M).group(0)
        subprocess.run([BASH, "--posix", "-c", 'PATH="$TAI_BIN:$PATH"\nF="$TAI_F"\nD="$TAI_D"\n' + fun + '\ninv "$D/invariantes-base.txt"'],
                       env=self.env(), capture_output=True, text=True)

    def sh(self, modo, aprueba=False, sha=None):
        extra = {}
        if aprueba:
            extra["APRUEBO"] = "SI"
        if sha:
            extra["SHA_APROBADO"] = sha
        return subprocess.run([BASH, "--posix", "-c", 'PATH="$TAI_BIN:$PATH"; . "$0"', p(SCRIPT), modo], env=self.env(**extra),
                              capture_output=True, text=True, timeout=120)

    def aprobar(self):
        return self.sh("aprobar", aprueba=True, sha=self.sha_nuevo)

    def ruta(self, nombre):
        return os.path.join(self.D, nombre)

    def journal(self, texto):
        escribe(os.path.join(self.t, "journal.txt"), texto)

    def snapshot(self):
        """Contenido de TODO lo que hay en D y de authorized_keys (para comprobar que algo NO cambia)."""
        s = {}
        for raiz, _, nombres in os.walk(self.D):
            for n in nombres:
                s[os.path.join(raiz, n)] = leer(os.path.join(raiz, n), "rb")
        s["F"] = leer(self.F, "rb")
        return s

    def limpiar(self):
        shutil.rmtree(self.t, ignore_errors=True)


@unittest.skipIf(clave_publica("id_ed25519.pub") is None, "requiere ~/.ssh/id_ed25519.pub (la clave real del propietario)")
class Referencia(unittest.TestCase):
    def setUp(self):
        self.e = Entorno()

    def tearDown(self):
        self.e.limpiar()

    # ---------------------------------------------------------------- verificar: solo lectura
    def test_verificar_ok_y_no_escribe_nada(self):
        antes = self.e.snapshot()
        r = self.e.sh("verificar")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr); self.assertIn("CLAVE_ROOT_VERIFICADA", r.stdout)
        self.assertIn("PENDIENTE_DE_APROBAR", r.stdout); self.assertIn("SHA_PARA_APROBAR=" + self.e.sha_nuevo, r.stdout)
        self.assertEqual(antes, self.e.snapshot(), "verificar no escribe ni cambia nada (ni en D ni en authorized_keys)")

    def _no_verificada(self, esperado):
        antes = self.e.snapshot()
        r = self.e.sh("verificar")
        self.assertNotEqual(r.returncode, 0); self.assertIn("CLAVE_ROOT_NO_VERIFICADA", r.stdout); self.assertNotIn("CLAVE_ROOT_VERIFICADA\n", r.stdout)
        self.assertNotIn("SHA_PARA_APROBAR", r.stdout)
        self.assertIn(esperado, r.stdout, r.stdout)
        self.assertEqual(antes, self.e.snapshot())

    def test_huella_distinta(self):
        self.e.limpiar(); self.e = Entorno(ak=clave_publica("tai-inspect_ed25519.pub"))
        self._no_verificada("la huella no es la de tu clave")

    def test_dos_claves(self):
        self.e.limpiar(); self.e = Entorno(ak=clave_publica("id_ed25519.pub") + clave_publica("tai-inspect_ed25519.pub"))
        self._no_verificada("hay 2 claves")

    def test_opciones_en_la_linea(self):
        self.e.limpiar(); self.e = Entorno(ak='command="id" ' + clave_publica("id_ed25519.pub"))
        self._no_verificada("opciones")

    def test_una_reescritura_del_proveedor_con_la_misma_clave_se_verifica_por_huella(self):
        # mismo contenido de clave con otro comentario: el hash cambia, la identidad (huella) no
        pub = clave_publica("id_ed25519.pub").split()
        escribe(self.e.F, "%s %s otro-comentario\n" % (pub[0], pub[1]))
        r = self.e.sh("verificar")
        self.assertIn("CLAVE_ROOT_VERIFICADA", r.stdout, r.stdout)

    def test_huella_no_clasificada_en_el_registro(self):
        self.e.journal(journal_normal() + acceso("2026-11-14T11:00:00+0000", 7, "198.51.100.7", "SHA256:" + "A" * 43))
        self._no_verificada("huella NO clasificada")

    def test_acceso_de_root_por_contrasena(self):
        self.e.journal(journal_normal() + acceso("2026-11-14T11:00:00+0000", 7, "198.51.100.7", "", metodo="password"))
        self._no_verificada("metodo que no es clave publica")

    def test_registro_de_sshd_ilegible(self):
        escribe(os.path.join(self.e.t, "journal_falla"), "1")
        self._no_verificada("no se puede leer el registro de sshd")

    def test_stat_falla(self):
        escribe(os.path.join(self.e.t, "stat_falla"), "1")
        self._no_verificada("no se puede leer el estado")

    def test_permisos_distintos(self):
        escribe(os.path.join(self.e.t, "stat_perm"), "root:root 644")
        self._no_verificada("propietario o permisos")

    def test_archivo_inexistente(self):
        os.remove(self.e.F)
        r = self.e.sh("verificar")
        self.assertIn("CLAVE_ROOT_NO_VERIFICADA", r.stdout); self.assertNotEqual(r.returncode, 0)

    def test_referencia_inesperada(self):
        escribe(self.e.ruta("invariantes-base.txt"), "otra cosa\n")
        self._no_verificada("no contiene exactamente una linea de authorized_keys")

    def test_sin_accesos_en_el_registro_se_verifica_por_la_huella(self):
        self.e.journal("")
        r = self.e.sh("verificar")
        self.assertIn("CLAVE_ROOT_VERIFICADA", r.stdout); self.assertIn("sin accesos de root por clave", r.stdout)

    # ---------------------------------------------------------------- clasificar (registrar, NO autorizar)
    def test_clasificar_sin_autorizacion_no_hace_nada(self):
        self.e.journal(journal_con_temporales()); antes = self.e.snapshot()
        r = self.e.sh("clasificar")
        self.assertEqual(r.returncode, 2); self.assertIn("RECHAZADO", r.stdout); self.assertEqual(antes, self.e.snapshot())

    def test_las_siete_temporales_bloquean_hasta_clasificarlas_y_luego_se_verifica(self):
        self.e.journal(journal_con_temporales())
        r = self.e.sh("verificar")
        self.assertIn("CLAVE_ROOT_NO_VERIFICADA", r.stdout); self.assertEqual(r.stdout.count("huella NO clasificada"), 7)
        c = self.e.sh("clasificar", aprueba=True)
        self.assertEqual(c.returncode, 0, c.stdout); self.assertIn("NO autorizadas", c.stdout)
        txt = leer(self.e.ruta("f7-huellas-temporales.txt"))
        self.assertEqual(len(txt.strip().splitlines()), 7)
        for fp in TEMPORALES:
            self.assertIn("SHA256:" + fp + "|169.254.0.1,|", txt)
        v = self.e.sh("verificar")
        self.assertIn("CLAVE_ROOT_VERIFICADA", v.stdout, v.stdout); self.assertEqual(v.stdout.count("TEMPORAL_CLASIFICADA (NO autorizada)"), 7)
        self.assertEqual(leer(self.e.F, "rb"), self.e.contenido.encode(), "authorized_keys intacto")
        # clasificar de nuevo no duplica
        antes = self.e.snapshot()
        self.assertIn("NADA_QUE_CLASIFICAR", self.e.sh("clasificar", aprueba=True).stdout)
        self.assertEqual(antes, self.e.snapshot())

    def test_clasificar_rechaza_un_origen_que_no_es_link_local(self):
        self.e.journal(journal_normal() + acceso("2026-11-14T11:00:00+0000", 7, "198.51.100.7", "SHA256:" + "A" * 43, tipo="RSA"))
        antes = self.e.snapshot()
        r = self.e.sh("clasificar", aprueba=True)
        self.assertNotEqual(r.returncode, 0); self.assertIn("no es un unico origen link-local", r.stdout); self.assertEqual(antes, self.e.snapshot())

    def test_clasificar_rechaza_una_huella_usada_mas_de_una_vez(self):
        fp = "SHA256:" + "B" * 43
        self.e.journal(journal_normal() + acceso("2026-11-14T11:00:00+0000", 7, "169.254.0.1", fp, tipo="RSA") + acceso("2026-11-14T12:00:00+0000", 8, "169.254.0.1", fp, tipo="RSA"))
        r = self.e.sh("clasificar", aprueba=True)
        self.assertNotEqual(r.returncode, 0); self.assertIn("se uso 2 veces", r.stdout); self.assertFalse(os.path.exists(self.e.ruta("f7-huellas-temporales.txt")))

    def test_clasificar_rechaza_una_huella_que_esta_autorizada_ahora(self):
        # la clave "temporal" esta realmente en authorized_keys: eso es una clave autorizada, no un resto de consola
        otra = clave_publica("tai-inspect_ed25519.pub")
        self.e.limpiar(); self.e = Entorno(ak=clave_publica("id_ed25519.pub"))
        fp_otra = "SHA256:OW0d/GCWjasNxmoh7RWafXSFQZvvYt7nNIgtHXVpQtU"
        escribe(self.e.F, clave_publica("id_ed25519.pub") + otra)
        self.e.journal(journal_normal() + acceso("2026-11-14T11:00:00+0000", 7, "169.254.0.1", fp_otra, tipo="ED25519"))
        r = self.e.sh("clasificar", aprueba=True)
        self.assertNotEqual(r.returncode, 0); self.assertIn("AUTORIZADA ahora", r.stdout)

    def test_clasificar_rechaza_accesos_por_otro_metodo(self):
        self.e.journal(journal_con_temporales(acceso("2026-11-14T16:00:00+0000", 9, "198.51.100.9", "", metodo="password")))
        r = self.e.sh("clasificar", aprueba=True)
        self.assertNotEqual(r.returncode, 0); self.assertIn("metodo que no es clave publica", r.stdout)

    def test_una_temporal_clasificada_que_se_reutiliza_vuelve_a_bloquear(self):
        self.e.journal(journal_con_temporales()); self.e.sh("clasificar", aprueba=True)
        self.e.journal(journal_con_temporales(acceso("2026-11-14T17:00:00+0000", 300, "169.254.0.1", "SHA256:" + TEMPORALES[0], tipo="RSA")))
        r = self.e.sh("verificar")
        self.assertIn("CLAVE_ROOT_NO_VERIFICADA", r.stdout); self.assertIn("huella NO clasificada", r.stdout)

    def test_una_temporal_clasificada_desde_otro_origen_vuelve_a_bloquear(self):
        self.e.journal(journal_con_temporales()); self.e.sh("clasificar", aprueba=True)
        self.e.journal(journal_normal() + acceso("2026-11-14T15:30:33+0000", 200, "198.51.100.7", "SHA256:" + TEMPORALES[0], tipo="RSA"))
        self.assertIn("CLAVE_ROOT_NO_VERIFICADA", self.e.sh("verificar").stdout)

    def test_una_huella_nueva_tras_clasificar_bloquea(self):
        self.e.journal(journal_con_temporales()); self.e.sh("clasificar", aprueba=True)
        self.e.journal(journal_con_temporales(acceso("2026-11-14T18:00:00+0000", 400, "169.254.0.1", "SHA256:" + "C" * 43, tipo="RSA")))
        r = self.e.sh("verificar")
        self.assertIn("CLAVE_ROOT_NO_VERIFICADA", r.stdout); self.assertEqual(r.stdout.count("huella NO clasificada"), 1)

    # ---------------------------------------------------------------- aprobar
    def test_aprobar_sin_autorizacion_rechaza_sin_tocar_nada(self):
        antes = self.e.snapshot()
        r = self.e.sh("aprobar", aprueba=False, sha=self.e.sha_nuevo)
        self.assertEqual(r.returncode, 2); self.assertIn("RECHAZADO", r.stdout); self.assertNotIn("APROBADA", r.stdout)
        self.assertEqual(antes, self.e.snapshot())

    def test_aprobar_sin_el_hash_revisado_rechaza(self):
        antes = self.e.snapshot()
        r = self.e.sh("aprobar", aprueba=True)
        self.assertEqual(r.returncode, 2); self.assertIn("falta SHA_APROBADO", r.stdout); self.assertEqual(antes, self.e.snapshot())

    def test_aprobar_con_un_hash_distinto_del_verificado_no_cambia_nada(self):
        antes = self.e.snapshot()
        r = self.e.sh("aprobar", aprueba=True, sha="0" * 64)
        self.assertNotEqual(r.returncode, 0); self.assertIn("SHA_APROBADO no coincide", r.stdout); self.assertEqual(antes, self.e.snapshot())

    def test_aprobar_con_clave_no_verificada_rechaza_sin_tocar_nada(self):
        self.e.journal(journal_normal() + acceso("2026-11-14T11:00:00+0000", 7, "198.51.100.7", "SHA256:" + "A" * 43))
        antes = self.e.snapshot()
        r = self.e.aprobar()
        self.assertNotEqual(r.returncode, 0); self.assertIn("RECHAZADO", r.stdout); self.assertEqual(antes, self.e.snapshot())

    def test_aprobar_correcto(self):
        r = self.e.aprobar()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr); self.assertIn("REFERENCIA_APROBADA_Y_VERIFICADA", r.stdout)
        self.assertEqual(leer(self.e.orig), self.e.base_original, "la copia conserva EXACTAMENTE la referencia original")
        h = hashlib.sha256(leer(self.e.orig, "rb")).hexdigest()
        self.assertIn(h, leer(self.e.orig + ".sha256"))
        base = leer(self.e.ruta("invariantes-base.txt"))
        self.assertNotEqual(base, self.e.base_original); self.assertIn(self.e.sha_nuevo, base); self.assertNotIn(ANT, base)
        acta = leer(self.e.acta)
        for frag in (EXP, ANT, self.e.sha_nuevo, h, "SHA_APROBADO=" + self.e.sha_nuevo):
            self.assertIn(frag, acta)
        dif = [l for l in leer(self.e.ruta("invariantes-diff-aprobacion.txt")).splitlines() if l[:1] in "<>"]
        self.assertEqual(len(dif), 2)
        self.assertEqual(leer(self.e.F, "rb"), self.e.contenido.encode(), "authorized_keys intacto")
        for f in os.listdir(self.e.D):
            self.assertFalse(f.endswith(".tmp"), "no quedan temporales: " + f)
        self.assertFalse(os.path.exists(self.e.ruta(".f7-referencia.lock")), "el cerrojo se libera")

    def test_aprobar_con_las_temporales_clasificadas_las_deja_en_el_acta_como_no_autorizadas(self):
        self.e.journal(journal_con_temporales()); self.e.sh("clasificar", aprueba=True)
        r = self.e.aprobar()
        self.assertEqual(r.returncode, 0, r.stdout)
        acta = leer(self.e.acta)
        self.assertIn("NO autorizadas", acta)
        for fp in TEMPORALES:
            self.assertIn(fp, acta)

    def test_ejecucion_repetida_no_cambia_nada(self):
        self.e.aprobar()
        antes = self.e.snapshot()
        r = self.e.aprobar()
        self.assertEqual(r.returncode, 0, r.stdout); self.assertIn("REFERENCIA_AL_DIA", r.stdout)
        self.assertEqual(antes, self.e.snapshot())
        self.assertIn("AL_DIA", self.e.sh("verificar").stdout)

    def test_copia_original_previa_identica_se_reutiliza(self):
        shutil.copyfile(self.e.ruta("invariantes-base.txt"), self.e.orig)
        escribe(self.e.orig + ".sha256", "%s  %s\n" % (hashlib.sha256(leer(self.e.orig, "rb")).hexdigest(), p(self.e.orig)))
        r = self.e.aprobar()
        self.assertIn("se reutiliza", r.stdout); self.assertIn("REFERENCIA_APROBADA_Y_VERIFICADA", r.stdout)

    def test_copia_original_previa_distinta_no_se_sobrescribe(self):
        escribe(self.e.orig, "otra cosa\n"); escribe(self.e.orig + ".sha256", "0" * 64 + "  " + p(self.e.orig) + "\n")
        antes = self.e.snapshot()
        r = self.e.aprobar()
        self.assertNotEqual(r.returncode, 0); self.assertIn("NO coincide", r.stdout)
        self.assertEqual(antes, self.e.snapshot(), "ni la copia ni la referencia cambian")

    def test_copia_original_con_sha_incorrecto_no_se_reutiliza(self):
        shutil.copyfile(self.e.ruta("invariantes-base.txt"), self.e.orig)
        escribe(self.e.orig + ".sha256", "0" * 64 + "  " + p(self.e.orig) + "\n")
        r = self.e.aprobar()
        self.assertNotEqual(r.returncode, 0); self.assertIn("PARAR", r.stdout); self.assertEqual(leer(self.e.ruta("invariantes-base.txt")), self.e.base_original)

    def test_el_diff_con_otra_diferencia_no_aprueba_y_limpia_su_copia(self):
        escribe(os.path.join(self.e.t, "sshd.txt"), "port 22\nmaxauthtries 6\n")      # el estado real difiere ademas en otra cosa
        r = self.e.aprobar()
        self.assertNotEqual(r.returncode, 0); self.assertIn("NO es solo la linea de authorized_keys", r.stdout)
        self.assertEqual(leer(self.e.ruta("invariantes-base.txt")), self.e.base_original)
        self.assertFalse(os.path.exists(self.e.orig), "la copia creada por esta ejecucion se retira")
        self.assertFalse(os.path.exists(self.e.acta)); self.assertFalse(os.path.exists(self.e.ruta(".f7-referencia.lock")))

    def test_error_de_escritura_al_copiar_la_original(self):
        os.makedirs(self.e.orig + ".tmp")        # el temporal es un directorio: la copia no puede completarse
        r = self.e.aprobar()
        self.assertNotEqual(r.returncode, 0); self.assertIn("PARAR", r.stdout)
        self.assertEqual(leer(self.e.ruta("invariantes-base.txt")), self.e.base_original, "la referencia original NO se sustituye")

    def test_error_de_escritura_al_sustituir_la_referencia(self):
        os.makedirs(self.e.ruta("invariantes-base.txt.tmp"))                           # no se puede preparar la nueva referencia
        r = self.e.aprobar()
        self.assertNotEqual(r.returncode, 0); self.assertIn("invariantes-base.txt NO se ha tocado", r.stdout)
        self.assertEqual(leer(self.e.ruta("invariantes-base.txt")), self.e.base_original)
        self.assertFalse(os.path.exists(self.e.acta), "sin acta si no se aprueba"); self.assertFalse(os.path.exists(self.e.orig))

    def test_error_de_escritura_del_acta(self):
        os.makedirs(self.e.acta + ".tmp")
        r = self.e.aprobar()
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(leer(self.e.ruta("invariantes-base.txt")), self.e.base_original)

    def test_si_el_estado_cambia_tras_sustituir_se_restaura_la_original(self):
        escribe(os.path.join(self.e.t, "ss_flip"), "1")       # la 2.a lectura del estado (comprobacion final) ya no coincide
        r = self.e.aprobar()
        self.assertNotEqual(r.returncode, 0); self.assertIn("REFERENCIA_RESTAURADA_A_LA_ORIGINAL", r.stdout)
        self.assertEqual(leer(self.e.ruta("invariantes-base.txt")), self.e.base_original, "queda la referencia original")
        self.assertFalse(os.path.exists(self.e.acta), "sin acta de una aprobacion que no se mantuvo")

    def test_ejecucion_concurrente_o_resto_de_cerrojo(self):
        os.makedirs(self.e.ruta(".f7-referencia.lock"))
        antes = self.e.snapshot()
        r = self.e.aprobar()
        self.assertNotEqual(r.returncode, 0); self.assertIn("otra ejecucion en curso", r.stdout)
        self.assertEqual(antes, self.e.snapshot())

    # ---------------------------------------------------------------- propiedades del script
    def test_el_script_solo_escribe_en_el_directorio_de_trabajo(self):
        src = leer(SCRIPT)
        for prohibido in ("> \"$F\"", ">> \"$F\"", "rm -f \"$F\"", "mv -f \"$F\"", "cp -p \"$NUEVA\" \"$F\"", "chmod", "chown", "systemctl reload", "systemctl restart",
                          "systemctl stop", "systemctl start", "sshd_config.d", "authorized_keys.tai"):
            self.assertNotIn(prohibido, src, prohibido)
        self.assertNotRegex(src, r"(?m)^[^#]*ssh-keygen\s+-(?!lf)")

    def test_sintaxis_posix(self):
        r = subprocess.run([BASH, "--posix", "-n", p(SCRIPT)], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_uso_incorrecto(self):
        r = self.e.sh("otra")
        self.assertEqual(r.returncode, 2); self.assertIn("uso:", r.stdout)


class BloqueDePegado(unittest.TestCase):
    def setUp(self):
        self.t = tempfile.mkdtemp(prefix="tai-f7pegar-")

    def tearDown(self):
        shutil.rmtree(self.t, ignore_errors=True)

    def ejecutar(self, txt):
        d = os.path.join(self.t, "d"); os.makedirs(d, exist_ok=True)
        txt = txt.replace("D=/root/tai-etapa2", "D=" + p(d), 1)
        r = subprocess.run([BASH, "--posix", "-s"], input=txt, capture_output=True, text=True, timeout=60)
        return d, r

    def test_el_bloque_contiene_exactamente_el_script_y_su_huella(self):
        src = leer(SCRIPT); txt = leer(PEGAR)
        self.assertIn("cat > $D/f7-referencia.sh.nuevo <<'TAI_F7_EOF'\n" + src + "TAI_F7_EOF\n", txt)
        self.assertIn(hashlib.sha256(src.encode("utf-8")).hexdigest(), txt)
        for frag in ("chmod 700 $D/f7-referencia.sh.nuevo", "chown root:root", "F7_SCRIPT_CORRUPTO_NO_USAR", "F7_SCRIPT_INSTALADO_OK", "umask 077", "umask $U"):
            self.assertIn(frag, txt)
        self.assertNotRegex(txt.split("TAI_F7_EOF\n")[-1], r"(?m)^\s*exit\b")

    def test_instala_solo_el_script_aprobado(self):
        d, r = self.ejecutar(leer(PEGAR))
        esperado = leer(SCRIPT, "rb")
        self.assertIn("F7_SCRIPT_INSTALADO_OK " + hashlib.sha256(esperado).hexdigest(), r.stdout, r.stdout + r.stderr)
        self.assertEqual(leer(os.path.join(d, "f7-referencia.sh"), "rb"), esperado)
        self.assertFalse(os.path.exists(os.path.join(d, "f7-referencia.sh.nuevo")))

    def test_descarta_un_script_alterado(self):
        txt = leer(PEGAR)
        malo = txt.replace('[ "$APRUEBO" = SI ]', '[ "$APRUEBO" != NO ]', 1)
        self.assertNotEqual(malo, txt)
        d, r = self.ejecutar(malo)
        self.assertIn("F7_SCRIPT_CORRUPTO_NO_USAR", r.stdout, r.stdout + r.stderr); self.assertNotIn("INSTALADO_OK", r.stdout)
        self.assertFalse(os.path.exists(os.path.join(d, "f7-referencia.sh"))); self.assertFalse(os.path.exists(os.path.join(d, "f7-referencia.sh.nuevo")))

    def test_el_pegado_de_f7_vps_sigue_intacto(self):
        txt = leer(os.path.join(RAIZ, "automation", "scripts", "F7-VPS-pegar.txt"))
        self.assertIn(hashlib.sha256(leer(os.path.join(RAIZ, "automation", "scripts", "f7-vps.sh")).encode()).hexdigest(), txt)


if __name__ == "__main__":
    unittest.main()
