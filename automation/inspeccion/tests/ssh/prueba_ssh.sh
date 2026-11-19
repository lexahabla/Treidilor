#!/bin/sh
# Pruebas de SSH REAL de la plantilla `Match User tai-inspect`. SOLO para un contenedor efímero y aislado (sin red; solo 127.0.0.1):
# crea usuarios, claves y passphrase FICTICIOS dentro del contenedor y arranca un `sshd` temporal en 127.0.0.1:2222.
# NO es producto, no se instala y no debe ejecutarse en un servidor. Necesita `sshd` y `ssh` (OpenSSH) y busybox/ash.
#
# Variables: SRC (producto montado, por defecto /work), PLANT (plantilla del Match), NOMBRE (nombre con el que se instalaría en sshd_config.d).
# El «gate» es un SIMULADOR de shell (el real es Python y se prueba aparte): aquí se prueba el comportamiento de sshd, no el del gate.
set -u
SRC=${SRC:-/work}
PLANT=${PLANT:-$SRC/deploy/sshd_config.d/00-tai-inspect.conf}
NOMBRE=${NOMBRE:-00-tai-inspect.conf}
W=/tmp/sb
FRASE="frase-de-prueba-ficticia-1"
OK=0
KO=0
ok() { echo "OK     $*"; OK=$((OK + 1)); }
ko() { echo "FALLA  $*"; KO=$((KO + 1)); }
info() { echo "INFO   $*"; }
# afirma <descripcion> <comando...>: OK si el comando termina con 0
afirma() { d=$1; shift; if "$@" >/dev/null 2>&1; then ok "$d"; else ko "$d"; fi; }
# niega <descripcion> <comando...>: OK si el comando termina distinto de 0
niega() { d=$1; shift; if "$@" >/dev/null 2>&1; then ko "$d"; else ok "$d"; fi; }
tiene() { printf '%s' "$1" | grep -q -- "$2"; }

mkdir -p "$W"
echo "== $(ssh -V 2>&1) | plantilla=$PLANT | nombre=$NOMBRE"

# ---------------- entorno ficticio ----------------
rm -rf /etc/ssh/sshd_config.d/* /etc/ssh/ssh_host_* 2>/dev/null
mkdir -p /etc/ssh/sshd_config.d /var/empty /opt/tai-inspect/bin /var/lib/tai-inspect/home /root/.ssh
chmod 700 /root/.ssh
ssh-keygen -q -t ed25519 -N '' -f /etc/ssh/ssh_host_ed25519_key
grep -q '^sshd:' /etc/passwd || { addgroup -S sshd; adduser -S -D -H -G sshd -h /var/empty -s /sbin/nologin sshd; }
addgroup -S tai-inspect 2>/dev/null
adduser -S -D -H -G tai-inspect -h /var/lib/tai-inspect/home -s /bin/sh tai-inspect 2>/dev/null
adduser -D -s /bin/sh usuario1 2>/dev/null
info "campo de contraseña inicial de tai-inspect en /etc/shadow: $(grep '^tai-inspect:' /etc/shadow | cut -d: -f2 | cut -c1-3)"
chown root:root /var/lib/tai-inspect/home
chmod 0555 /var/lib/tai-inspect/home
sed -i 's/^root:[^:]*:/root:*:/' /etc/shadow            # root sin contraseña utilizable (como en Ubuntu); entra por clave
sed -i 's/^tai-inspect:[^:]*:/tai-inspect:*:/' /etc/shadow
TAI_UID=$(id -u tai-inspect)

cat >/opt/tai-inspect/bin/tai-gate <<'GATE'
#!/bin/sh
printf 'GATE uid=%s orden=[%s] tty=%s agente=%s\n' "$(id -u)" "${SSH_ORIGINAL_COMMAND-<sin>}" "$(tty 2>&1 | head -c 12)" "${SSH_AUTH_SOCK-no}"
GATE
chmod 0755 /opt/tai-inspect/bin/tai-gate

ssh-keygen -q -t ed25519 -N '' -f "$W/rootkey"
ssh-keygen -q -t ed25519 -N '' -f "$W/evil"
ssh-keygen -q -t ed25519 -N "$FRASE" -f "$W/tai-pass"
cat "$W/rootkey.pub" >/root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
printf 'restrict,command="/opt/tai-inspect/bin/tai-gate" %s\n' "$(cat "$W/tai-pass.pub")" >/etc/ssh/authorized_keys.tai-inspect
chown root:root /etc/ssh/authorized_keys.tai-inspect
chmod 0644 /etc/ssh/authorized_keys.tai-inspect
# una clave «maliciosa» en el home del usuario restringido: sshd debe IGNORARLA
mkdir -p /var/lib/tai-inspect/home/.ssh
cat "$W/evil.pub" >/var/lib/tai-inspect/home/.ssh/authorized_keys

# sshd_config estilo Ubuntu 24.04: Include al principio, root y contraseña permitidos, reenvíos permitidos
cat >/etc/ssh/sshd_config <<'CFG'
Include /etc/ssh/sshd_config.d/*.conf
Port 2222
ListenAddress 127.0.0.1
HostKey /etc/ssh/ssh_host_ed25519_key
PidFile /tmp/sb/sshd.pid
LogLevel VERBOSE
PermitRootLogin yes
PasswordAuthentication yes
PubkeyAuthentication yes
AllowTcpForwarding yes
AllowAgentForwarding yes
X11Forwarding yes
MaxAuthTries 6
AuthorizedKeysFile .ssh/authorized_keys
PerSourcePenalties no
CFG
CFG=/etc/ssh/sshd_config
eff() { sshd -T -f "$1" -C "user=$2,host=localhost,addr=127.0.0.1" 2>&1 | sort; }
effg() { sshd -T -f "$1" 2>&1 | sort; }
val() { eff "$1" "$2" | grep -E "^$3 " | head -1; }

echo "---- 1. Línea base (SIN el archivo del Match)"
eff $CFG root >"$W/root0"
eff $CFG usuario1 >"$W/u1_0"
effg $CFG >"$W/glob0"
afirma "la configuración base es válida (sshd -t)" sshd -t -f $CFG
tiene "$(cat "$W/root0")" "^permitrootlogin yes" && ok "base: root puede entrar" || ko "base: permitrootlogin"
tiene "$(cat "$W/root0")" "^passwordauthentication yes" && ok "base: contraseña permitida para root" || ko "base: passwordauthentication"

echo "---- 2. Se instala la plantilla como $NOMBRE"
cp "$PLANT" "/etc/ssh/sshd_config.d/$NOMBRE"
afirma "sshd -t con el archivo del Match" sshd -t -f $CFG
eff $CFG root >"$W/root1"
eff $CFG usuario1 >"$W/u1_1"
effg $CFG >"$W/glob1"
afirma "root: directivas efectivas IDÉNTICAS (sshd -T -C user=root)" cmp -s "$W/root0" "$W/root1"
afirma "usuario normal: directivas efectivas IDÉNTICAS" cmp -s "$W/u1_0" "$W/u1_1"
afirma "configuración global: IDÉNTICA (sshd -T sin -C)" cmp -s "$W/glob0" "$W/glob1"
niega "tai-inspect: SÍ difiere de la base" cmp -s "$W/root1" "$(eff $CFG tai-inspect >"$W/tai1"; echo "$W/tai1")"
for par in "forcecommand /opt/tai-inspect/bin/tai-gate" "authorizedkeysfile /etc/ssh/authorized_keys.tai-inspect" "passwordauthentication no" "pubkeyauthentication yes" \
           "kbdinteractiveauthentication no" "authenticationmethods publickey" "permittty no" "allowtcpforwarding no" "allowagentforwarding no" "x11forwarding no" \
           "disableforwarding yes" "maxsessions 1" "permitopen none" "authorizedkeyscommand none" "permituserrc no"; do
    clave=${par%% *}
    [ "$(val $CFG tai-inspect "$clave")" = "$par" ] && ok "tai-inspect efectivo: $par" || ko "tai-inspect efectivo: esperado «$par», obtenido «$(val $CFG tai-inspect "$clave")»"
done

echo "---- 3. Precedencia REAL entre bloques Match (el nombre del archivo no la garantiza)"
# Un bloque Match anterior (otro archivo) toca las mismas palabras clave para el mismo usuario.
prec() {   # prec <nombre del archivo del Match> → deja la configuración en $W/p
    rm -rf "$W/p"; mkdir -p "$W/p/d"
    sed -e "s#^Include .*#Include $W/p/d/*.conf#" -e "s#^PidFile .*#PidFile $W/p/pid#" $CFG >"$W/p/sshd_config"
    printf 'Match User tai-inspect\n    AllowTcpForwarding yes\n    PermitTTY yes\n    PasswordAuthentication yes\n    AuthorizedKeysFile .ssh/authorized_keys\n' >"$W/p/d/10-competidor.conf"
    cp "$PLANT" "$W/p/d/$1"
}
prec 99-tai-inspect.conf
r99="$(val "$W/p/sshd_config" tai-inspect allowtcpforwarding)"
info "con el nombre 99-… y un Match anterior que permite reenvíos: $r99 (el Match anterior GANA si dice yes)"
[ "$r99" = "allowtcpforwarding yes" ] && ok "demostrado: el nombre 99 NO garantiza prioridad (gana el primer Match leído)" || info "con 99 ganó el Match propio: la precedencia no es la supuesta"
prec 00-tai-inspect.conf
for par in "allowtcpforwarding no" "permittty no" "passwordauthentication no" "authorizedkeysfile /etc/ssh/authorized_keys.tai-inspect"; do
    clave=${par%% *}
    [ "$(val "$W/p/sshd_config" tai-inspect "$clave")" = "$par" ] && ok "con 00-… prevalece sobre el Match competidor: $par" || ko "con 00-… NO prevalece: $par (obtenido «$(val "$W/p/sshd_config" tai-inspect "$clave")»)"
done
# Fugas de ámbito: ni los globales posteriores ni otros Match posteriores se ven afectados
printf 'X11Forwarding yes\nMaxSessions 7\n' >"$W/p/d/20-global.conf"
printf 'Match User usuario1\n    AllowTcpForwarding no\n' >"$W/p/d/30-otro.conf"
printf 'MaxAuthTries 6\n' >>"$W/p/sshd_config"
[ "$(val "$W/p/sshd_config" root maxsessions)" = "maxsessions 7" ] && ok "sin fuga: un global posterior (MaxSessions 7) sigue valiendo para root" || ko "FUGA de ámbito en maxsessions de root: $(val "$W/p/sshd_config" root maxsessions)"
[ "$(val "$W/p/sshd_config" usuario1 allowtcpforwarding)" = "allowtcpforwarding no" ] && ok "sin fuga: un Match posterior de otro usuario sigue funcionando" || ko "Match posterior de usuario1 roto"
[ "$(val "$W/p/sshd_config" root allowtcpforwarding)" = "allowtcpforwarding yes" ] && ok "root conserva allowtcpforwarding yes (global)" || ko "root pierde allowtcpforwarding"
[ "$(val "$W/p/sshd_config" root maxauthtries)" = "maxauthtries 6" ] && ok "sin fuga: la directiva global tras el Include sigue valiendo para root" || ko "FUGA tras el Include"

echo "---- 4. sshd real en 127.0.0.1:2222 con la configuración instalada"
/usr/sbin/sshd -f $CFG -D -e -E "$W/sshd.log" &
for i in 1 2 3 4 5 6 7 8 9 10; do
    ssh-keyscan -p 2222 127.0.0.1 >/dev/null 2>&1 && break
    sleep 0.5
done
SSHO="-F /dev/null -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=5 -o BatchMode=yes -o IdentitiesOnly=yes -p 2222"
eval "$(ssh-agent -a "$W/agent.sock" -s)" >/dev/null
export SSH_AUTH_SOCK="$W/agent.sock"
printf '#!/bin/sh\necho "%s"\n' "$FRASE" >"$W/askpass"
printf '#!/bin/sh\necho "frase-incorrecta"\n' >"$W/askpass_mal"
chmod 700 "$W/askpass" "$W/askpass_mal"
tai() { ssh $SSHO -o IdentityAgent="$W/agent.sock" -i "$W/tai-pass.pub" ${TAIOPT-} tai-inspect@127.0.0.1 "$@"; }

# 4.1 passphrase y agente
sal="$(tai 2>&1 </dev/null)"
tiene "$sal" "GATE" && ko "la clave con passphrase NO debe poder usarse sin cargarla en el agente" || ok "sin cargar en el agente la clave con passphrase no se puede usar"
SSH_ASKPASS="$W/askpass_mal" SSH_ASKPASS_REQUIRE=force DISPLAY=:0 timeout 5 ssh-add "$W/tai-pass" >/dev/null 2>&1 </dev/null && ko "passphrase incorrecta aceptada" || ok "una passphrase incorrecta no carga la clave"
SSH_ASKPASS="$W/askpass" SSH_ASKPASS_REQUIRE=force DISPLAY=:0 timeout 10 ssh-add -t 3 "$W/tai-pass" >/dev/null 2>&1 </dev/null && ok "la passphrase correcta carga la clave en el agente con caducidad (-t 3)" || ko "no se pudo cargar la clave con la passphrase correcta"

# 4.2 la clave pública SÍ funciona; la salida solo es la del gate
sal="$(tai 2>&1 </dev/null)"
tiene "$sal" "GATE uid=$TAI_UID orden=\[<sin>\]" && ok "clave pública + passphrase: entra y SOLO ejecuta el gate (uid de tai-inspect)" || ko "la autenticación por clave pública no funciona: $sal"

# 4.3 el gate no se puede sustituir ni obtener shell
for orden in 'id' 'id; cat /etc/passwd' 'sh -i' 'bash' 'solicitar host-recursos; id' '$(id)' 'cat /etc/shadow'; do
    sal="$(tai "$orden" 2>&1 </dev/null)"
    if tiene "$sal" "GATE uid=$TAI_UID orden=\[" && ! tiene "$sal" "gid=" && ! tiene "$sal" "root:" && ! tiene "$sal" "uid=0"; then
        ok "ForceCommand: «$orden» llega al gate solo como TEXTO, no se ejecuta"
    else
        ko "ForceCommand: «$orden» → $sal"
    fi
done
sal="$(printf 'id\nwhoami\nexit\n' | tai 2>&1)"
{ tiene "$sal" "GATE" && ! tiene "$sal" "gid=" && ! tiene "$sal" "tai-inspect$"; } && ok "sesión sin orden con comandos por la entrada estándar: no hay shell interactivo" || ko "shell interactivo posible: $sal"
sal="$(TAIOPT=-tt tai 'id' 2>&1 </dev/null)"
tiene "$sal" "PTY allocation request failed" && ok "se rechaza la asignación de pseudoterminal (-tt)" || ko "se concedió un pseudoterminal: $sal"
sal="$(TAIOPT="-W 127.0.0.1:2222" tai 2>&1 </dev/null)"
{ ! tiene "$sal" "SSH-2.0" && ! tiene "$sal" "GATE"; } && ok "reenvío con -W denegado" || ko "reenvío -W permitido: $sal"
sal="$(TAIOPT=-A tai 'x' 2>&1 </dev/null)"
tiene "$sal" "agente=no" && ok "el agente SSH no se reenvía al gate (-A)" || ko "agente reenviado: $sal"
sal="$(ssh $SSHO -o PreferredAuthentications=password -o PubkeyAuthentication=no -v tai-inspect@127.0.0.1 true 2>&1 </dev/null)"
{ tiene "$sal" "Authentications that can continue: publickey" && ! tiene "$sal" "continue: .*password"; } && ok "la autenticación por contraseña NO se ofrece a tai-inspect" || ko "se ofrece contraseña: $(printf '%s' "$sal" | grep -i 'can continue')"
sal="$(ssh $SSHO -i "$W/evil" tai-inspect@127.0.0.1 2>&1 </dev/null)"
{ ! tiene "$sal" "GATE"; } && ok "una clave plantada en el home del usuario se IGNORA (solo vale el archivo de root)" || ko "clave del home aceptada"
ssh $SSHO -o IdentityAgent="$W/agent.sock" -i "$W/tai-pass.pub" root@127.0.0.1 id >"$W/o" 2>&1 </dev/null
tiene "$(cat "$W/o")" "uid=0" && ko "la clave de tai-inspect abre ROOT" || ok "la clave dedicada no sirve para root"

# 4.4 root: reglas existentes intactas
sal="$(ssh $SSHO -i "$W/rootkey" root@127.0.0.1 id 2>&1 </dev/null)"
tiene "$sal" "uid=0(root)" && ok "root conserva su acceso por clave y su shell sin restricciones" || ko "root afectado: $sal"
sal="$(ssh $SSHO -i "$W/rootkey" -L 3334:127.0.0.1:2222 root@127.0.0.1 'echo reenvio-ok' 2>&1 </dev/null)"
tiene "$sal" "reenvio-ok" && ok "root conserva la posibilidad de reenvío (regla global intacta)" || ko "root pierde el reenvío: $sal"

# 4.5 tai-inspect no puede cambiar claves, instalación ni configuración
for ruta in /etc/ssh/authorized_keys.tai-inspect /etc/ssh/sshd_config /etc/ssh/sshd_config.d /etc/ssh/sshd_config.d/$NOMBRE /opt/tai-inspect /opt/tai-inspect/bin/tai-gate /var/lib/tai-inspect/home /root/.ssh; do
    su -s /bin/sh tai-inspect -c "[ -w '$ruta' ]" >/dev/null 2>&1 && ko "tai-inspect PUEDE escribir en $ruta" || ok "tai-inspect no puede escribir en $ruta"
done
su -s /bin/sh tai-inspect -c "echo x >> /etc/ssh/authorized_keys.tai-inspect" >/dev/null 2>&1 && ko "escritura real en la clave autorizada" || ok "intento real de añadir una clave autorizada: denegado"
su -s /bin/sh tai-inspect -c "touch /var/lib/tai-inspect/home/prueba" >/dev/null 2>&1 && ko "escritura real en el home" || ok "intento real de escribir en el directorio de inicio: denegado"

# 4.6 contraseña inutilizable: no bloquea la clave pública; la cuenta bloqueada sí la bloquearía (sin PAM)
sed -i 's/^tai-inspect:[^:]*:/tai-inspect:!:/' /etc/shadow
sal="$(tai 2>&1 </dev/null)"
tiene "$sal" "GATE" && info "campo '!' (cuenta bloqueada): la clave pública SÍ entra con este sshd" || info "campo '!' (cuenta bloqueada): la clave pública NO entra con este sshd (sin PAM): por eso se usa '*'"
sed -i 's/^tai-inspect:[^:]*:/tai-inspect:*:/' /etc/shadow
sal="$(tai 2>&1 </dev/null)"
tiene "$sal" "GATE" && ok "campo '*' (contraseña inutilizable): la clave pública funciona" || ko "con '*' no entra: $sal"
sleep 3
ssh-add -l >/dev/null 2>&1 && info "la clave sigue cargada" || info "la clave caducó del agente (-t 3)"
sal="$(tai 2>&1 </dev/null)"
tiene "$sal" "GATE" && ko "la clave sigue siendo utilizable tras caducar en el agente" || ok "tras la caducidad del agente la clave con passphrase ya no es utilizable"

kill "$(cat "$W/sshd.pid" 2>/dev/null)" 2>/dev/null
ssh-agent -k >/dev/null 2>&1
echo "== RESULTADO: $OK correctas, $KO fallidas"
[ "$KO" -eq 0 ]
