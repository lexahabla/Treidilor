# Regenera los bloques para PEGAR en la consola de Hostinger a partir de los scripts auxiliares de F7. Solo escribe esos archivos locales.
#   f7-vps.sh        -> F7-VPS-pegar.txt
#   f7-referencia.sh -> F7-REFERENCIA-pegar.txt
# Cada bloque escribe el script en un archivo TEMPORAL, comprueba su SHA-256 (esta fijado aqui) y solo si coincide lo instala (root, 0700);
# si no coincide lo descarta y avisa. La consola no se cierra en ningun caso (no usa exit) y se restaura el umask.
import hashlib
import io
import os

AQUI = os.path.dirname(os.path.abspath(__file__))
ENTRADAS = (("f7-vps.sh", "F7-VPS-pegar.txt"), ("f7-referencia.sh", "F7-REFERENCIA-pegar.txt"))

for nombre, salida in ENTRADAS:
    src = io.open(os.path.join(AQUI, nombre), encoding="utf-8", newline="").read()
    assert "TAI_F7_EOF" not in src
    h = hashlib.sha256(src.encode("utf-8")).hexdigest()
    out = ("D=/root/tai-etapa2\nU=$(umask); umask 077\n"
           "cat > $D/" + nombre + ".nuevo <<'TAI_F7_EOF'\n" + src + "TAI_F7_EOF\n"
           "if [ \"$(sha256sum $D/" + nombre + ".nuevo | cut -d' ' -f1)\" = \"" + h + "\" ]; then chown root:root $D/" + nombre + ".nuevo; chmod 700 $D/" + nombre + ".nuevo; mv -f $D/" + nombre + ".nuevo $D/" + nombre + "; echo \"F7_SCRIPT_INSTALADO_OK " + h + "\"; "
           "else rm -f $D/" + nombre + ".nuevo; echo \"F7_SCRIPT_CORRUPTO_NO_USAR: la huella no coincide; se ha descartado y NO se ha instalado\"; fi\n"
           "umask $U\n")
    io.open(os.path.join(AQUI, salida), "w", encoding="utf-8", newline="").write(out)
    print(nombre, h)
