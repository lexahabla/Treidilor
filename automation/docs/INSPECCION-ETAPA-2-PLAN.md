# Inspección automática del VPS — ETAPA 2: plan DEFINITIVO de instalación del acceso SSH restringido `tai-inspect` (14/11/2026)

**Estado: SOLO PLAN. No se ha creado ningún usuario, clave ni archivo; no hay conexión al VPS; no hay commits ni pushes. Espera autorización expresa.** Todo comando de este documento lo ejecutaría **el propietario** (consola web de Hostinger como root y su PC); el asistente no se conecta. La segunda revisión independiente aprobó la arquitectura D, R1–R5 y P1–P5 **con seis condiciones sobre este plan**; esta versión las resuelve y **sustituye** a la anterior. El código y las plantillas no han cambiado (mismas huellas).

## 0. Condiciones de la revisión y dónde se resuelven
| # | Condición | Resolución | Dónde |
|---|---|---|---|
| C1 | No se puede exigir una sesión SSH existente: no hay ninguna confirmada | La **consola web de Hostinger** es la vía de recuperación y se **ensaya antes** de cambiar nada; reversión automática por **temporizador de seguridad** (`systemd-run`) que no depende de que nadie conserve una sesión; **no se presupone ningún acceso SSH** | §2 (G4), F0, F7, §9 |
| C2 | Orden de validación de las unidades `systemd`; sin errores ocultos por tuberías | `verify` y `security` se ejecutan **antes** de copiar las unidades a `/etc/systemd/system`, con la salida a un archivo y `rc=$?` leído **antes** de mostrar nada; no hay tuberías en esos comandos; una salida no vacía de `verify` es fallo. Está **comprobado por una prueba** (`tests/test_plan_etapa2.py`) | F9 |
| C3 | Verificar el TAR antes de extraerlo | Bloque único que comprueba la huella del TAR, tipos (sin enlaces, dispositivos ni tuberías), rutas, permisos, propietario, ausencia de duplicados, conjunto exacto de archivos y la huella SHA-256 de **cada** archivo **sin extraer nada**. **Probado** contra 21 paquetes manipulados | F2 |
| C4 | `sshd -t` y `sshd -T -C` con OpenSSH 9.6 **y PAM del VPS** antes de recargar | Condición **obligatoria** (puerta de versión y PAM) y **instancia de `sshd` de prueba** en `127.0.0.1:2222` con la configuración real, PAM real y el gate real, **antes** de tocar `/etc/ssh/sshd_config.d` y de recargar el `sshd` en uso | F1, F5, F6, F7 |
| C5 | Separar las comprobaciones del host de las del colector privilegiado | **Fase A (F0–F8): solo gate** con las 5 comprobaciones del host, **sin colector, sin unidades `systemd` y sin ningún componente privilegiado**. **Fase B (F9): colector** con `integridad-inspeccion` y `auditoria-resumen`, tras una pausa y un punto de decisión propio | §6 |
| C6 | Mantener intactos root, Docker, n8n, EasyPanel, firewall y despliegues | Invariantes **medidos antes y después de cada fase** (§1.1) y lista de lo que no se toca | §1 |

## 1. Alcance e invariantes
Instalar el gate y, en una segunda fase, el colector, con un usuario SSH restringido. Las **11 comprobaciones sensibles siguen cerradas** (sin `validaciones.json`). **No se toca**: `/root/.ssh/authorized_keys`, `/etc/ssh/sshd_config` (global), el acceso de root, Docker (ni sus servicios ni su socket), n8n, EasyPanel, Traefik, el firewall de Hostinger, los despliegues, ni ningún servicio existente. No hay endurecimiento del SSH de root en esta etapa (queda como propuesta aparte). Todo lo nuevo es **inerte** hasta F7 (nadie lo ejecuta ni lo lee).

### 1.1 Invariantes (se miden en F1 y se comparan tras F7, F8 y F9)
```sh
D=/root/tai-etapa2
inv() { { echo "## sshd efectivo de root"; sshd -T -C user=root,host=localhost,addr=127.0.0.1 | sort; echo "## sshd global"; sshd -T | sort; echo "## huellas (no contenido)"; sha256sum /root/.ssh/authorized_keys /etc/ssh/sshd_config; echo "## docker (nombre y replicas)"; docker service ls --format '{{.Name}}|{{.Replicas}}'; echo "## puertos a la escucha"; ss -H -tuln | awk '{print $1, $5}' | sort; echo "## servicios"; systemctl is-active ssh docker; } > "$1" 2>&1; }
inv $D/invariantes-base.txt; wc -l $D/invariantes-base.txt
```
Tras cada fase: `inv $D/invariantes-despues.txt; diff $D/invariantes-base.txt $D/invariantes-despues.txt && echo INVARIANTES_IGUALES`. **Salvo la línea de `ss` del puerto 2222 durante F6, no debe haber ninguna diferencia.** Desde el PC, además: `https://<dominio>/api/health` con el mismo `sourceHash` y los servicios (web, n8n, panel) respondiendo como antes.

## 2. Puertas de entrada (todas obligatorias antes de ejecutar nada)
| # | Puerta | Estado |
|---|---|---|
| G1 | Segunda revisión independiente: **aprobada con condiciones C1–C6** (resueltas aquí); versión instalada fijada por huella: código y plantillas `2096f3e6db13ea46182a92471671a923b18c9f788991cfe6cf61c3632ade30fb` (29 archivos) | Revisión recibida; **falta tu confirmación de este plan** |
| G2 | Autorización expresa del propietario con **ventana de trabajo** (F0–F7 en una sesión; F8 es una pausa de ≥ 24 h; F9 con su propia autorización) | Pendiente |
| G3 | **Snapshot** de Hostinger tomado justo antes por el propietario y **visible en la lista** del panel (su restauración **no se puede ensayar**: es el último recurso, no el plan) | Pendiente |
| G4 | **Vía de recuperación sin SSH:** consola web de Hostinger **abierta como root y ensayada en F0**. Si la consola no responde, **no se empieza**. **No se presupone** ninguna sesión SSH existente; si el propietario puede abrir una de root desde su PC es un respaldo adicional, no un requisito | Pendiente (F0) |
| G5 | Clave dedicada **con passphrase** generada por el propietario (§4); el asistente solo recibe la clave **pública** | Pendiente |
| G6 | Nombres de los 7 servicios Swarm y valor de `permitrootlogin` anotados (informativos) | Pendiente |

## 3. Matriz de permisos y revisión de plantillas
**Matriz objetivo** (probada con procesos reales en Linux: uid sin privilegios + root con `CAP_DAC_READ_SEARCH`):
| Ruta | Propietario y modo | `tai-inspect` (gate) | Colector (root, solo `CAP_DAC_READ_SEARCH`) |
|---|---|---|---|
| `/opt/tai-inspect` (código, `enabled.json`, `ajustes.json`, `MANIFEST.json`) | `root:root` 0755; archivos 0644 (lanzadores 0755) | lee/ejecuta, **no escribe** | lee |
| `/etc/tai-inspect/DISABLED` (interruptor) | `root:root`, dir 0755 | lee | — |
| `/var/lib/tai-inspect/requests` | `root:tai-inspect` **2730** | crea, **no lista** | lee/borra |
| `/var/lib/tai-inspect/reports` | `root:tai-inspect` **2750** | solo lee | escribe (publica) |
| `/var/lib/tai-inspect/staging` | `root:tai-inspect` **2700** | **sin acceso** | escribe |
| `/var/lib/tai-inspect/state` | `tai-inspect:tai-inspect` 0700 | cupo y bloqueo del gate | — |
| `/var/lib/tai-inspect/collector-state` | `root:root` **0700** | **sin acceso** | cupo propio y anclas |
| `/var/lib/tai-inspect/home` | `root:root` **0555** | nada escribible | — |
| `/var/log/tai-inspect/gate-audit.log` | `tai-inspect:tai-inspect` 0640 (creado de antemano) | solo añade | lee y ancla |
| `/var/log/tai-inspect/collector-audit.log` | `root:root` 0640 | no lo modifica | escribe |
| `/etc/ssh/authorized_keys.tai-inspect` | `root:root` 0644 | **no puede cambiar su propia clave** | — |

**Ajustes P1–P9** (aplicados y validados con OpenSSH real; ver `INSPECCION-ETAPA-0-INFORME.md` §10): clave en archivo de root (P1); shell `/bin/sh` con `ForceCommand` + `restrict` (P2); plantilla instalada como **`00-tai-inspect.conf`**, porque el nombre `99-` **no** da prioridad (P3); contraseña `*` y no `!` (P4); home `root:root` 0555 (P5); `systemd-analyze` antes de abrir SSH (P6); recargar con `reload`, nunca `restart` (P7); `PermitUserEnvironment` no es válida en un `Match` (P8); las pruebas usaron OpenSSH 10.3p1 sin PAM, **por eso C4** (P9).

## 4. Clave dedicada con passphrase (la genera el propietario en su PC; no se crea aquí)
```powershell
# En el PC del propietario. La passphrase la escribe él; nadie más la ve. La clave PRIVADA no se comparte jamás.
ssh-keygen -t ed25519 -a 100 -f "$env:USERPROFILE\.ssh\tai-inspect_ed25519" -C "tai-inspect-dedicada"
Get-Content "$env:USERPROFILE\.ssh\tai-inspect_ed25519.pub"      # solo esta línea PÚBLICA se entrega
```
- Passphrase larga y única (gestor de contraseñas). Carga en el agente con caducidad: `ssh-add -t 4h "$env:USERPROFILE\.ssh\tai-inspect_ed25519"` (el agente de Windows puede requerir arrancar el servicio `ssh-agent` como administrador).
- Entrada de cliente (solo cuando se autorice): `Host tai-inspect-vps` con `IdentityFile` de esa clave, `IdentitiesOnly yes`, `ForwardAgent no`. Si el origen fuera fijo se añadiría `from="IP"`.
- Revocar = vaciar `/etc/ssh/authorized_keys.tai-inspect` (root), sin tocar ninguna otra clave.

## 5. Acciones manuales mínimas del propietario
| # | Dónde | Acción | Cuándo |
|---|---|---|---|
| M1 | PC | Generar la clave dedicada (§4) y entregar **solo** la línea pública | Antes de la ventana |
| M2 | Panel de Hostinger | Tomar el **snapshot** y confirmar que aparece en la lista | Justo antes de F0 |
| M3 | PC → VPS | Subir **2 archivos**: `treidilor-inspeccion.tar` y `SHA256SUMS-CODIGO.txt` (los genera el asistente en local al recibir la autorización, con su procedimiento y huellas), y **teclear a mano** la huella del TAR (recibida por otro canal) | F2 |
| M4 | Consola web (root) | Pegar los bloques de F0 a F7 (**8 pegados** más los de verificación) y devolver la salida en cada punto de control | F0–F7 |
| M5 | PC | Probar el acceso con la clave dedicada (V1–V8) y devolver el resultado | F7 |
| M6 | — | Esperar ≥ 24 h con solo el gate (F8) y decidir si se continúa | F8 |
| M7 | Consola web + PC | Fase B: pegar F9 y probar V9–V12 | F9, con autorización propia |
Subida de M3 (en orden de preferencia): (a) la herramienta de archivos del panel de Hostinger, si existe; (b) `scp`/`sftp` **iniciado por el propietario** con el acceso de root que ya utiliza (no se asume que funcione); (c) pegado por trozos desde el PC: `base64 -w0 treidilor-inspeccion.tar | split -b 12000 - parte_` y, en la consola, `cat >> /root/tai-etapa2/tar.b64` por cada trozo y `base64 -d /root/tai-etapa2/tar.b64 > /root/tai-etapa2/treidilor-inspeccion.tar`. En los tres casos **la verificación de F2 decide**; ningún canal se considera de confianza.

## 6. Orden de puesta en marcha (cada fase tiene su verificación y su reversión; si una verificación falla **se para**)
| Fase | Qué hace | Qué toca del sistema en uso | Riesgo |
|---|---|---|---|
| **F0** | Ensayo de recuperación y copias de la configuración | Solo `/root/tai-etapa2` y dos temporizadores transitorios de ensayo | Nulo |
| **F1** | Línea base, puerta de versión/PAM, comprobaciones previas | Nada (solo lectura) | Nulo |
| **F2** | Subir, **verificar** y extraer el paquete a `/opt/tai-inspect` | Directorio nuevo e inerte | Muy bajo |
| **F3** | Usuario `tai-inspect`, directorios y registros | Usuario y directorios nuevos e inertes | Bajo |
| **F4** | Configuración mínima (solo 5 comprobaciones de host), manifiesto y **prueba local del gate sin SSH** | Archivos en `/opt/tai-inspect` | Bajo |
| **F5** | Configuración de prueba de `sshd` en `/root/tai-etapa2` y validación con la versión y PAM reales | Crea `/etc/ssh/authorized_keys.tai-inspect` (no lo lee ningún `sshd` en uso) | Bajo |
| **F6** | `sshd` **de prueba** en `127.0.0.1:2222` con la configuración real, PAM real y el gate real | Un proceso temporal solo en loopback | Bajo |
| **F7** | Colocar `00-tai-inspect.conf`, validar, **armar la reversión automática** y recargar el `sshd` en uso | `/etc/ssh/sshd_config.d` y recarga de `ssh` | **El único paso con riesgo real**, mitigado por F6, F0 y el temporizador |
| **F8** | **Pausa ≥ 24 h** solo con el gate; revisión de registros e invariantes | Nada | Nulo |
| **F9** | **Colector** (unidades `systemd`), `integridad-inspeccion` y `auditoria-resumen` | Unidades `systemd` nuevas | Medio-bajo; autorización propia |

## 7. Procedimiento (consola web de Hostinger como root; **cada bloque termina con su verificación**)
### F0 — Ensayo de recuperación con el SCRIPT REAL de reversión (no cambia nada del sistema en uso)
Primero se crea el script de reversión (el mismo que usará F7) y se anota su huella:
<!-- REVERSION:INICIO -->
```bash
id; install -d -m 0700 /root/tai-etapa2; echo "dir rc=$?"
D=/root/tai-etapa2
cat > $D/revertir.sh <<'FIN'
#!/bin/sh
# Reversion del acceso tai-inspect. Retira SOLO su propio archivo y SOLO si sigue siendo el instalado; no toca nada mas.
F=${F:-/etc/ssh/sshd_config.d/00-tai-inspect.conf}
H=${H:-2cdadc4498abdd5268ee58e2aafe2c8dce1d05b7d65d0310e9cb4d94aa29d133}
SSHD=${SSHD:-/usr/sbin/sshd}
SYSTEMCTL=${SYSTEMCTL:-/usr/bin/systemctl}
LOG=${LOG:-/root/tai-etapa2/reversion.log}
say() { echo "$(date -u +%FT%TZ) tai-reversion: $*" >> "$LOG"; echo "tai-reversion: $*"; logger -t tai-reversion -- "$*" 2>/dev/null || true; return 0; }
if [ -e "$F" ]; then
    A=$(sha256sum "$F" | cut -d' ' -f1)
    if [ "$A" = "$H" ]; then
        rm -f "$F" && say "retirado $F"
    else
        say "NO se retira $F: su huella ($A) no es la instalada; alguien lo ha cambiado, revisar a mano"
        exit 3
    fi
else
    say "$F no existe: nada que retirar"
fi
if "$SSHD" -t; then
    if "$SYSTEMCTL" is-active --quiet ssh; then
        if "$SYSTEMCTL" reload ssh; then
            say "ssh recargado"
        else
            say "FALLO al recargar ssh"
            exit 4
        fi
    else
        say "ssh no esta activo (socket): la configuracion se leera en la proxima conexion"
    fi
else
    say "sshd -t FALLA tras retirar el archivo: NO se recarga"
    exit 5
fi
exit 0
FIN
chmod 0700 $D/revertir.sh; sha256sum $D/revertir.sh
```
<!-- REVERSION:FIN -->
Después se **ensaya ese mismo script** con rutas de prueba (nunca con el `sshd` real) y se comprueba que **retira lo suyo** y **respeta lo ajeno**:
```sh
D=/root/tai-etapa2
printf 'prueba' > $D/ensayo.conf; HE=$(sha256sum $D/ensayo.conf | cut -d' ' -f1)
systemd-run --unit=tai-ensayo --on-active=20s --setenv=F=$D/ensayo.conf --setenv=H=$HE --setenv=SSHD=/bin/true --setenv=SYSTEMCTL=/bin/true --setenv=LOG=$D/ensayo-reversion.log --description="ensayo del script de reversion" /bin/sh $D/revertir.sh; echo "armado rc=$?"
systemd-run --unit=tai-ensayo-cancel --on-active=10min --setenv=F=$D/ensayo-nunca.conf --setenv=H=$HE --setenv=SSHD=/bin/true --setenv=SYSTEMCTL=/bin/true --setenv=LOG=$D/ensayo-cancel.log --description="ensayo de cancelacion" /bin/sh $D/revertir.sh; echo "armado rc=$?"
systemctl stop tai-ensayo-cancel.timer; echo "cancelado rc=$?"
sleep 25
[ ! -e $D/ensayo.conf ] && echo ENSAYO_RETIRO_OK || echo ENSAYO_NO_RETIRO
cat $D/ensayo-reversion.log
journalctl -u tai-ensayo.service --no-pager --since "-2min" > $D/ensayo-journal.txt 2>&1; grep -ciE 'Finished|Deactivated successfully|Succeeded' $D/ensayo-journal.txt
systemctl list-timers --all --no-pager > $D/ensayo-timers.txt 2>&1; grep -c 'tai-ensayo-cancel' $D/ensayo-timers.txt
printf 'otro contenido' > $D/ensayo2.conf
F=$D/ensayo2.conf H=$HE SSHD=/bin/true SYSTEMCTL=/bin/true LOG=$D/ensayo2.log /bin/sh $D/revertir.sh; echo "ajeno rc=$?"
[ -e $D/ensayo2.conf ] && echo AJENO_CONSERVADO || echo AJENO_BORRADO_MAL
cp -a /etc/ssh/sshd_config $D/sshd_config.orig; echo "copia1 rc=$?"
cp -a /etc/ssh/sshd_config.d $D/sshd_config.d.orig; echo "copia2 rc=$?"
sshd -t > $D/sshd-t-base.txt 2>&1; echo "sshd -t base rc=$?"; cat $D/sshd-t-base.txt
```
**Esperado:** `uid=0`; la huella de `revertir.sh` anotada; los dos `armado rc=0` y `cancelado rc=0`; **`ENSAYO_RETIRO_OK`** y en el registro `retirado …` y `ssh recargado` (el temporizador **disparó solo** y el script retiró **su** archivo); el `grep -ci` del journal **≥ 1** y el último `grep -c` **0** (el cancelado no queda pendiente: el mecanismo **se arma y se cancela**); **`ajeno rc=3` y `AJENO_CONSERVADO`** (un archivo con otra huella **no se borra**); copias `rc=0`; `sshd -t base rc=0` y sin salida. **Ensayo de recuperación completado** si todo coincide; además el propietario anota cómo se restauraría el snapshot (sin hacerlo). *No se copian las claves de host de `/etc/ssh`.*
**Si algo falla: parar.** Sin consola web o sin temporizadores que funcionen no hay vía de recuperación y **no se continúa**.

**Registro de ejecución de F0 (14/11/2026; propietario, consola web; VPS en UTC con reloj sincronizado): SUPERADO funcionalmente.** `ENSAYO_RETIRO_OK`, `ajeno rc=3` y `AJENO_CONSERVADO`, `copia1 rc=0`, `copia2 rc=0`, `sshd -t base rc=0`, 0 unidades `tai-ensayo*` al final; huella de `revertir.sh` en el VPS **`192264110ba3d7d2184df0713e098209e35172463e784881bd4a542746ed012e`** (idéntica a la del script de este plan, comprobado); el registro del ensayo muestra `retirado …` y `ssh recargado` (simulado). **Desviación registrada:** el primer control dio `ENSAYO_NO_RETIRO` porque el temporizador aún no había terminado (armado 10:06:35 UTC, ejecutado y finalizado correctamente 10:07:01 UTC: 26 s para 20 s pedidos; un control posterior dio `ENSAYO_RETIRO_OK`). Causa probable **[Inferido]**: la precisión por defecto de los temporizadores transitorios (hasta 1 min) junto con una espera de 25 s muy ajustada. **Consecuencia:** F7 arma la reversión con `AccuracySec=1s` y comprueba que consta antes de recargar. Pendiente anotar cómo se restauraría el snapshot (sin hacerlo).

### F1 — Línea base y puertas de versión y PAM
Pegar el bloque de §1.1 y después:
```sh
dpkg-query -W -f='openssh-server ${Version}\n' openssh-server
dpkg-query -W -f='${Version}' openssh-server | grep -q '^1:9\.6p1' && echo VERSION_9.6_OK || echo VERSION_DISTINTA_PARAR
sshd -T | grep -qx 'usepam yes' && echo PAM_OK || echo PAM_NO_PARAR
test -f /etc/pam.d/sshd && echo PAMD_OK || echo PAMD_FALTA_PARAR
sshd -T | grep -E '^(permitrootlogin|passwordauthentication|permituserenvironment|usepam|port) '
grep -c '^Include' /etc/ssh/sshd_config
getent passwd tai-inspect | wc -l; ls -A /opt/tai-inspect /var/lib/tai-inspect /etc/tai-inspect 2>&1 | wc -l
ss -H -ltn 'sport = :2222' | wc -l
```
**Esperado:** `VERSION_9.6_OK`, `PAM_OK`, `PAMD_OK`, `Include` = **1**, usuario inexistente y rutas inexistentes (0 o error «No such file»), y **0** en el puerto 2222. **Cualquier otro resultado = PARAR y consultar** (en particular una versión distinta de 9.6p1: las pruebas se hicieron con 10.3p1 y la condición C4 exige validar con la del VPS). **Punto de control CP1:** el propietario devuelve esta salida y el asistente la contrasta con el Bloque A.

### F2 — Paquete: subir, verificar y extraer
Subir los 2 archivos a `/root/tai-etapa2/` (M3). Pegar el bloque de verificación, **tal cual**, tecleando la huella del TAR en la línea `HT=`:
<!-- VERIFICAR-TAR:INICIO -->
```bash
D=${D:-/root/tai-etapa2}
T=$D/treidilor-inspeccion.tar; S=$D/SHA256SUMS-CODIGO.txt
HT='PEGAR_AQUI_LA_HUELLA_SHA256_DEL_TAR_RECIBIDA_POR_OTRO_CANAL'
fallo=0; ko() { echo "FALLA: $*"; fallo=1; }
[ -f "$T" ] && [ -f "$S" ] || ko "faltan el tar o la lista de huellas"
# 1. huella del propio tar
[ "$(sha256sum "$T" | cut -d' ' -f1)" = "$HT" ] || ko "la huella SHA-256 del tar no coincide"
# 2. listado detallado SIN extraer; cualquier aviso de tar es un fallo
tar -tvf "$T" --numeric-owner > "$D/tar-lista.txt" 2> "$D/tar-avisos.txt"; rc=$?
[ $rc -eq 0 ] && [ ! -s "$D/tar-avisos.txt" ] || ko "tar no pudo listar el paquete sin avisos (rc=$rc)"
# 3. solo ficheros regulares y directorios: ni enlaces simbolicos ni duros, ni dispositivos, ni tuberias
[ -z "$(cut -c1 "$D/tar-lista.txt" | grep -v '^[-d]$')" ] || ko "hay entradas que no son ficheros ni directorios"
# 4. propietario 0/0 y permisos exactos: 0644 (ficheros fuera de bin/), 0755 (directorios y lanzadores de bin/, y SOLO ellos); sin setuid, setgid ni sticky
[ -z "$(awk '{ok = ($2=="0/0") && (($1=="drwxr-xr-x") || ($1=="-rwxr-xr-x" && $NF ~ /^bin\/tai-[a-z]+$/) || ($1=="-rw-r--r--" && $NF !~ /^bin\//)); if (!ok) print}' "$D/tar-lista.txt")" ] || ko "permisos o propietario no permitidos"
# 5. nombres relativos, sin '..', sin espacios ni caracteres raros, sin duplicados
tar -tf "$T" > "$D/tar-nombres.txt"
[ -z "$(grep -vE '^[A-Za-z0-9_][A-Za-z0-9_.-]*(/[A-Za-z0-9_][A-Za-z0-9_.-]*)*/?$' "$D/tar-nombres.txt")" ] || ko "nombres no permitidos (rutas absolutas, '..', espacios...)"
[ -z "$(sort "$D/tar-nombres.txt" | uniq -d)" ] || ko "entradas duplicadas"
# 6. el conjunto de ficheros coincide EXACTAMENTE con la lista de huellas revisada
grep -v '/$' "$D/tar-nombres.txt" | sort > "$D/tar-ficheros.txt"
cut -d' ' -f3- "$S" | sort > "$D/lista-esperada.txt"
cmp -s "$D/tar-ficheros.txt" "$D/lista-esperada.txt" || ko "los ficheros del tar no son exactamente los esperados"
# 7. huella SHA-256 de CADA fichero, leida del tar sin extraerlo
while read -r h f; do [ "$(tar -xOf "$T" -- "$f" 2>/dev/null | sha256sum | cut -d' ' -f1)" = "$h" ] || ko "huella distinta: $f"; done < <(sed 's/  / /' "$S")
[ "$fallo" -eq 0 ] && echo "TAR_VERIFICADO" || echo "TAR_RECHAZADO: NO EXTRAER"
```
<!-- VERIFICAR-TAR:FIN -->
**Esperado:** `TAR_VERIFICADO` y ninguna línea `FALLA`. **Si aparece `TAR_RECHAZADO`: no extraer, borrar los dos archivos y avisar** (no se «arregla»). Solo con `TAR_VERIFICADO`, en la **misma** consola (la variable `fallo` debe seguir en 0):
```sh
[ "$fallo" -eq 0 ] || echo "PARAR: el tar fue rechazado"
install -d -o root -g root -m 0755 /opt/tai-inspect
[ "$fallo" -eq 0 ] && [ -z "$(ls -A /opt/tai-inspect)" ] && tar -xf "$T" --no-same-owner --no-same-permissions -C /opt/tai-inspect; echo "extraccion rc=$?"
chown -R root:root /opt/tai-inspect; find /opt/tai-inspect -type d -exec chmod 0755 {} +; find /opt/tai-inspect -type f -exec chmod 0644 {} +
chmod 0755 /opt/tai-inspect/bin/tai-gate /opt/tai-inspect/bin/tai-collector /opt/tai-inspect/bin/tai-manifest
( cd /opt/tai-inspect && sha256sum -c "$S" > "$D/sha-instalado.txt" 2>&1; echo "sha instalado rc=$?" )
grep -vc ': OK$' "$D/sha-instalado.txt"
find /opt/tai-inspect \( -type l -o \( ! -type f ! -type d \) \) | wc -l
head -1 /opt/tai-inspect/bin/tai-gate
```
**Esperado:** `extraccion rc=0`, `sha instalado rc=0`, **0** líneas distintas de `OK`, **0** enlaces o ficheros especiales y la primera línea `#!/usr/bin/python3 -I`. **CP2.**

### F3 — Usuario, directorios y registros (todo inerte)
```sh
groupadd --system tai-inspect; echo "grupo rc=$?"
useradd --system --gid tai-inspect --no-create-home --home-dir /var/lib/tai-inspect/home --shell /bin/sh tai-inspect; echo "usuario rc=$?"
usermod -p '*' tai-inspect; echo "contrasena rc=$?"
install -d -o root -g root -m 0755 /etc/tai-inspect /var/lib/tai-inspect /var/log/tai-inspect
install -d -o root -g root -m 0555 /var/lib/tai-inspect/home
install -d -o root -g tai-inspect -m 2730 /var/lib/tai-inspect/requests
install -d -o root -g tai-inspect -m 2750 /var/lib/tai-inspect/reports
install -d -o root -g tai-inspect -m 2700 /var/lib/tai-inspect/staging
install -d -o tai-inspect -g tai-inspect -m 0700 /var/lib/tai-inspect/state
install -d -o root -g root -m 0700 /var/lib/tai-inspect/collector-state
install -o tai-inspect -g tai-inspect -m 0640 /dev/null /var/log/tai-inspect/gate-audit.log
install -o root -g root -m 0640 /dev/null /var/log/tai-inspect/collector-audit.log
id tai-inspect; getent shadow tai-inspect | cut -d: -f2; stat -c '%U:%G %a %n' /var/lib/tai-inspect/* /var/log/tai-inspect/* /etc/tai-inspect
```
**Esperado:** todos los `rc=0`; `id` con **solo** el grupo `tai-inspect`; el campo de contraseña es `*`; modos y propietarios iguales a la matriz de §3.

### F4 — Configuración mínima, manifiesto y prueba local del gate (sin SSH)
```sh
printf '["host-recursos","host-red","host-servicios","host-actualizaciones","host-tiempo"]' > /opt/tai-inspect/enabled.json
printf '{}' > /opt/tai-inspect/ajustes.json
chown root:root /opt/tai-inspect/enabled.json /opt/tai-inspect/ajustes.json; chmod 0644 /opt/tai-inspect/enabled.json /opt/tai-inspect/ajustes.json
/opt/tai-inspect/bin/tai-manifest; echo "manifiesto rc=$?"
runuser -u tai-inspect -- env -i PATH=/usr/bin:/bin SSH_ORIGINAL_COMMAND='solicitar host-recursos' /opt/tai-inspect/bin/tai-gate > $D/gate-local.json; echo "gate rc=$?"; head -c 400 $D/gate-local.json
runuser -u tai-inspect -- env -i PATH=/usr/bin:/bin SSH_ORIGINAL_COMMAND='id' /opt/tai-inspect/bin/tai-gate; echo "hostil rc=$?"
runuser -u tai-inspect -- env -i PATH=/usr/bin:/bin SSH_ORIGINAL_COMMAND='solicitar docker-nodos' /opt/tai-inspect/bin/tai-gate; echo "cerrada rc=$?"
tail -3 /var/log/tai-inspect/gate-audit.log
```
**Esperado:** `manifiesto rc=0` (`problemas: 0`); `gate rc=0` y un JSON de `host-recursos`; `hostil rc=2` con `orden no permitida`; `cerrada rc=2` con `comprobacion no disponible`; el registro con `gate_intencion` → `gate_resultado` y `seq` correlativo. Esto prueba el **encabezado `#!/usr/bin/python3 -I`**, Python 3.12 y las comprobaciones del host **como usuario sin privilegios y sin tocar SSH**. **CP3.**

### F5 — Validación de `sshd` con la versión y el PAM reales, SIN tocar `/etc/ssh/sshd_config.d`
```sh
P=$D/sshd-prueba; rm -rf $P; install -d -m 0700 $P $P/d
cp -a /etc/ssh/sshd_config.d/. $P/d/
cp /opt/tai-inspect/deploy/sshd_config.d/00-tai-inspect.conf $P/d/00-tai-inspect.conf
sed "s#^Include .*#Include $P/d/*.conf#" /etc/ssh/sshd_config > $P/sshd_config
grep -c "^Include $P/d/" $P/sshd_config
ssh-keygen -q -t ed25519 -N '' -C PRUEBA-TEMPORAL -f $D/clave-prueba; echo "clave de prueba rc=$?"
install -o root -g root -m 0644 /dev/null /etc/ssh/authorized_keys.tai-inspect
printf 'restrict,command="/opt/tai-inspect/bin/tai-gate" %s\n' "$(cat $D/clave-prueba.pub)" > /etc/ssh/authorized_keys.tai-inspect
sshd -t -f $P/sshd_config > $D/sshd-t-prueba.txt 2>&1; echo "sshd -t (prueba) rc=$?"; [ ! -s $D/sshd-t-prueba.txt ] && echo SSHD_T_LIMPIO || cat $D/sshd-t-prueba.txt
sshd -T -f $P/sshd_config -C user=root,host=localhost,addr=127.0.0.1 | sort > $D/p-root.txt
sshd -T -C user=root,host=localhost,addr=127.0.0.1 | sort > $D/r-root.txt
diff $D/p-root.txt $D/r-root.txt && echo ROOT_IDENTICO
sshd -T -f $P/sshd_config | sort > $D/p-glob.txt; sshd -T | sort > $D/r-glob.txt
diff $D/p-glob.txt $D/r-glob.txt && echo GLOBAL_IDENTICO
sshd -T -f $P/sshd_config -C user=tai-inspect,host=localhost,addr=127.0.0.1 | grep -E '^(forcecommand|authorizedkeysfile|passwordauthentication|pubkeyauthentication|kbdinteractiveauthentication|authenticationmethods|permittty|allowtcpforwarding|allowagentforwarding|x11forwarding|disableforwarding|maxsessions|permitopen|authorizedkeyscommand|permituserrc) ' | sort > $D/tai-efectivo.txt
cat > $D/tai-esperado.txt <<'FIN'
allowagentforwarding no
allowtcpforwarding no
authenticationmethods publickey
authorizedkeyscommand none
authorizedkeysfile /etc/ssh/authorized_keys.tai-inspect
disableforwarding yes
forcecommand /opt/tai-inspect/bin/tai-gate
kbdinteractiveauthentication no
maxsessions 1
passwordauthentication no
permitopen none
permittty no
permituserrc no
pubkeyauthentication yes
x11forwarding no
FIN
diff $D/tai-efectivo.txt $D/tai-esperado.txt && echo TAI_EFECTIVO_OK
```
**Esperado:** `Include` = 1; `SSHD_T_LIMPIO`, `ROOT_IDENTICO`, `GLOBAL_IDENTICO` y `TAI_EFECTIVO_OK`. Esto es la **validación de C4 con el OpenSSH 9.6 del VPS**: `sshd -T -C` para root y para `tai-inspect`. **Cualquier diferencia = PARAR** (nada se ha tocado en `/etc/ssh/sshd_config.d`).

### F6 — `sshd` de prueba en `127.0.0.1:2222` (PAM real, configuración real, gate real)
```sh
install -d -m 0755 /run/sshd
/usr/sbin/sshd -f $P/sshd_config -p 2222 -o ListenAddress=127.0.0.1 -o PidFile=$D/sshd-prueba.pid -E $D/sshd-prueba.log; echo "sshd de prueba rc=$?"
sleep 1; ss -H -ltn 'sport = :2222' | awk '{print $4}'
O="-p 2222 -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=$D/known-prueba -o LogLevel=ERROR"
ssh $O -i $D/clave-prueba tai-inspect@127.0.0.1 "solicitar host-red" > $D/t-red.json; echo "orden valida rc=$?"; head -c 300 $D/t-red.json
ssh $O -i $D/clave-prueba tai-inspect@127.0.0.1 "solicitar host-red"; echo "repetida rc=$?"
ssh $O -i $D/clave-prueba tai-inspect@127.0.0.1 "id; cat /etc/shadow"; echo "hostil rc=$?"
ssh $O -i $D/clave-prueba tai-inspect@127.0.0.1 "solicitar docker-nodos"; echo "cerrada rc=$?"
ssh $O -tt -i $D/clave-prueba tai-inspect@127.0.0.1 "id" 2>&1 | grep -c 'PTY allocation request failed'
ssh $O -i $D/clave-prueba -W 127.0.0.1:22 tai-inspect@127.0.0.1; echo "reenvio rc=$?"
ssh $O -o PreferredAuthentications=password -o PubkeyAuthentication=no -v tai-inspect@127.0.0.1 true 2>&1 | grep 'Authentications that can continue'
ssh $O -o PreferredAuthentications=password -o PubkeyAuthentication=no tai-inspect@127.0.0.1 true; echo "contrasena rc=$?"
grep -c 'Accepted publickey for tai-inspect' $D/sshd-prueba.log; grep -iE 'error|fatal|refused|locked|pam' $D/sshd-prueba.log | head -5
kill "$(cat $D/sshd-prueba.pid)"; sleep 1; ss -H -ltn 'sport = :2222' | wc -l
```
**Esperado:** `rc=0`; el puerto escucha **solo en `127.0.0.1:2222`**; `orden valida rc=0` con JSON; `repetida rc=7` (`limite alcanzado`); `hostil rc=2` (`orden no permitida`) **sin** contenido de `/etc/shadow`; `cerrada rc=2`; `1` línea de `PTY allocation request failed`; `reenvio` con código distinto de 0 y sin banner SSH; la línea `Authentications that can continue: publickey` (sin `password`); `contrasena rc=255`; **≥ 1** `Accepted publickey for tai-inspect` y **ningún** error de PAM o de cuenta bloqueada; al final **0** sockets en el 2222. Esto demuestra que **la clave pública funciona con PAM y la contraseña `*` no bloquea la cuenta en el VPS**. **CP4:** devolver la salida completa. **Limpieza obligatoria antes de seguir:**
```sh
rm -f $D/clave-prueba $D/clave-prueba.pub $D/known-prueba
: > /etc/ssh/authorized_keys.tai-inspect; grep -c PRUEBA-TEMPORAL /etc/ssh/authorized_keys.tai-inspect
```
**Esperado:** `0` y el archivo vacío (la clave de prueba **no sobrevive** a esta fase). Después el propietario pega **su línea pública real**:
```sh
printf 'restrict,command="/opt/tai-inspect/bin/tai-gate" %s\n' 'ssh-ed25519 AAAA…LA_CLAVE_PUBLICA_REAL… tai-inspect-dedicada' > /etc/ssh/authorized_keys.tai-inspect
wc -l < /etc/ssh/authorized_keys.tai-inspect; grep -c 'PRUEBA' /etc/ssh/authorized_keys.tai-inspect; stat -c '%U:%G %a' /etc/ssh/authorized_keys.tai-inspect
```
**Esperado:** `1`, `0` y `root:root 644`.
```sh
ssh-keygen -l -f /etc/ssh/authorized_keys.tai-inspect; echo "huella de la clave rc=$?"
```
**Esperado:** `rc=0` y **una** línea `256 SHA256:… tai-inspect-dedicada (ED25519)` que el propietario **compara con la de su PC** (`ssh-keygen -lf "$env:USERPROFILE\.ssh\tai-inspect_ed25519.pub"`): deben ser **idénticas**. Si no lo son, o `rc≠0`, la línea está mal pegada: **PARAR** (se detecta **antes** de recargar nada). *Aviso: para detener el `sshd` de prueba se usa **solo** `kill "$(cat $D/sshd-prueba.pid)"`; **nunca** `pkill sshd` ni `killall sshd`, que matarían también al `sshd` en uso.*

### F7 — Activar el acceso en el `sshd` en uso (con reversión automática) — PROCEDIMIENTO FINAL
**Registro del primer intento (14/11/2026):** F7 se aplicó y se revirtió (`REVERSION_RC=0`, invariantes idénticos, 223 líneas, `/api/health` correcto con el mismo `sourceHash`). V1 pasó. V2 devolvió `RC=0` en vez de `RC=7` **por la secuencia de la prueba, no por un defecto**: entre V1 y V2 pasaron más de 30 s (tecleo manual con el temporizador en marcha). Los registros reales lo demuestran (11:41:41 UTC aceptada · 11:42:02 UTC rechazada por `intervalo_minimo` a los 21 s · 11:42:22 UTC aceptada a los 41 s). **No se modifica el limitador.** **No se repiten F2–F6:** el usuario, `/opt/tai-inspect`, la clave autorizada y los archivos de referencia de F5 siguen en su sitio. Esta versión añade: V1–V8 en un solo script acotado (§8.1), control del **vencimiento real** del temporizador, resultado que **nunca** declara éxito definitivo, **puerta de cancelación** y **reversión manual segura**.
**Registro de cierre de F7 (14/11/2026): COMPLETADA.** `F7_CERRADO_OK`, 20 pruebas automáticas superadas, `INVARIANTES_IGUALES`, temporizador y servicio de reversión inactivos, CP5 correcto (`status ok`, `sourceHash 0885734050b5…7487`), referencia original conservada; acceso administrativo por SSH `NO_PROBADO`. Detalle, incidencias resueltas (falso negativo de V5 `-tt`, reescritura de `authorized_keys` por el proveedor, siete claves RSA temporales desde `169.254.0.1` sin confirmar) y limitaciones en `F7-CIERRE-INFORME.md`. **Siguiente: F8 (pausa ≥ 24 h con solo el gate).**

> **Procedimiento preferente desde 14/11/2026:** los Pasos 1–5 están automatizados (`automation/scripts/f7-vps.sh` + `F7-Validacion-Windows.ps1`; tres acciones dentro de la ventana, acceso administrativo preparado antes, cancelación solo si TODAS las condiciones se verifican). Ver `automation/docs/F7-CIERRE-AUTOMATIZADO.md`. Los bloques manuales de abajo siguen siendo la referencia y la alternativa.

**Paso 0 — Condiciones previas (solo lectura; ambos lados)**
Consola web (root; en la misma sesión que las fases anteriores, o con `D` e `inv` redefinidos):
```sh
D=/root/tai-etapa2
unset V_AUTO V_ADMIN V_CONSOLA V_OMISIONES PUERTA
ls /etc/ssh/sshd_config.d/00-tai-inspect.conf 2>&1 | head -1
wc -l < /etc/ssh/authorized_keys.tai-inspect
sha256sum $D/revertir.sh
systemctl list-timers --all --no-pager | grep -c 'tai-reversion'
ls $D/r-root.txt $D/r-glob.txt $D/tai-esperado.txt $D/invariantes-base.txt
systemctl is-active ssh
ss -H -ltn 'sport = :2222' | wc -l
type inv > /dev/null 2>&1 && echo INV_DEFINIDA || echo INV_NO_DEFINIDA
python3 -c "import json,time;d=json.load(open('/var/lib/tai-inspect/state/cuota.json'));print({k:round(time.time()-v) for k,v in d['last'].items()},'s desde la ultima peticion aceptada de cada comprobacion;',d['count'],'aceptadas hoy (UTC)')"
[ "$(ssh-keygen -l -f /etc/ssh/authorized_keys.tai-inspect | cut -d' ' -f2)" = "SHA256:OW0d/GCWjasNxmoh7RWafXSFQZvvYt7nNIgtHXVpQtU" ] && echo HUELLA_AUTORIZADA_OK || echo HUELLA_AUTORIZADA_DISTINTA_PARAR
for u in apt-daily.timer systemd-tmpfiles-clean.timer; do x=$(systemctl show $u -p ActiveEnterTimestamp --value); echo "$u ActiveState=$(systemctl show $u -p ActiveState --value) SubState=$(systemctl show $u -p SubState --value)"; date -d "$x" +%s > /dev/null 2>&1 && echo "FORMATO_TIMESTAMP_OK ($x)" || echo "FORMATO_TIMESTAMP_NO_VALIDO_PARAR ($x)"; done
date -u +%FT%TZ
```
**Esperado:** el primer `ls` dice `No such file or directory` (el archivo de `sshd` **no** está colocado); `1`; la huella `192264110ba3d7d2184df0713e098209e35172463e784881bd4a542746ed012e`; `0` temporizadores `tai-reversion`; los cuatro archivos de referencia listados; `active`; `0` en el 2222; `INV_DEFINIDA` (si saliera `INV_NO_DEFINIDA`, pegar **solo** las dos primeras líneas de §1.1 —`D=` e `inv()`—, **nunca** la tercera, que sobrescribiría la línea base); las edades del limitador (para no tener pendientes, conviene que `host-actualizaciones` tenga ≥ 300 s y las demás ≥ 30 s) y un contador de aceptadas muy por debajo de 60; **`HUELLA_AUTORIZADA_OK`** (la clave autorizada en el VPS es la huella real `SHA256:OW0d/GCWjasNxmoh7RWafXSFQZvvYt7nNIgtHXVpQtU`); y, para cada temporizador existente, `ActiveState=active SubState=waiting` y **`FORMATO_TIMESTAMP_OK`** (confirma que el vencimiento real se puede leer con `systemctl show` y `date -d`). Cualquier otra cosa → **PARAR y consultar**.
PC: Windows PowerShell 5.1 abierto y la clave dedicada cargada: `ssh-add -t 4h "$env:USERPROFILE\.ssh\tai-inspect_ed25519"` (el script comprueba en V0 el alias, la clave única `tai-inspect_ed25519`, `identitiesonly yes` —imprescindible: el bloque de `tai-inspect` permite solo 2 intentos— y que la huella cargada en el agente es **`SHA256:OW0d/GCWjasNxmoh7RWafXSFQZvvYt7nNIgtHXVpQtU`**, la comprobada en el VPS). Tener a mano un acceso de **administrador independiente** de `tai-inspect` (tu sesión SSH habitual) y la consola web abierta.

**Paso 1 — Colocar y validar con el árbol real (consola)**
```sh
install -o root -g root -m 0644 /opt/tai-inspect/deploy/sshd_config.d/00-tai-inspect.conf /etc/ssh/sshd_config.d/00-tai-inspect.conf; echo "colocado rc=$?"
ok7=1
sshd -t > $D/sshd-t-final.txt 2>&1; rc=$?; echo "sshd -t rc=$rc"; { [ $rc -eq 0 ] && [ ! -s $D/sshd-t-final.txt ]; } || ok7=0
sshd -T -C user=root,host=localhost,addr=127.0.0.1 | sort | diff - $D/r-root.txt && echo ROOT_IDENTICO || ok7=0
sshd -T | sort | diff - $D/r-glob.txt && echo GLOBAL_IDENTICO || ok7=0
sshd -T -C user=tai-inspect,host=localhost,addr=127.0.0.1 | grep -E '^(forcecommand|authorizedkeysfile|passwordauthentication|pubkeyauthentication|kbdinteractiveauthentication|authenticationmethods|permittty|allowtcpforwarding|allowagentforwarding|x11forwarding|disableforwarding|maxsessions|permitopen|authorizedkeyscommand|permituserrc) ' | sort | diff - $D/tai-esperado.txt && echo TAI_EFECTIVO_OK || ok7=0
[ $ok7 -eq 1 ] && echo F7_VALIDADO || { echo "F7_FALLA: se retira el archivo recien colocado y NO se recarga"; cmp -s /opt/tai-inspect/deploy/sshd_config.d/00-tai-inspect.conf /etc/ssh/sshd_config.d/00-tai-inspect.conf && rm -f /etc/ssh/sshd_config.d/00-tai-inspect.conf; }
```
**Paso 2 — Armar la reversión, comprobar que es precisa y fijar su vencimiento REAL (consola)**
**2a. Funciones de control del tiempo real** (se pegan **una sola vez**, en la misma sesión, **antes** de armar). El vencimiento se lee con `systemctl show tai-reversion.timer` (propiedad `ActiveEnterTimestamp`, el instante en que el temporizador quedó activo; `systemd-run --on-active=10min` vence 600 s después) y se **contrasta** con la hora calculada **antes** de armar; si no concuerdan o no se puede leer, **no hay vencimiento verificado** y no se recarga:
<!-- REVHELP:INICIO -->
```sh
rev_sistema() { s=$(systemctl show tai-reversion.timer -p ActiveEnterTimestamp --value 2>/dev/null); [ -n "$s" ] || return 1; e=$(date -d "$s" +%s 2>/dev/null) || return 1; echo $((e + 600)); }
rev_fijar() { SIS=$(rev_sistema); PRO=$(( $1 + 600 )); if [ -n "$SIS" ] && [ $((SIS - PRO)) -ge -5 ] && [ $((SIS - PRO)) -le 10 ]; then if [ "$SIS" -lt "$PRO" ]; then echo "$SIS" > $D/rev_vence.epoch; else echo "$PRO" > $D/rev_vence.epoch; fi; echo VENCIMIENTO_VERIFICADO; echo "VENCE_UTC=$(date -u -d @$(cat $D/rev_vence.epoch) +%Y-%m-%dT%H:%M:%SZ)"; else rm -f $D/rev_vence.epoch; echo "VENCIMIENTO_NO_VERIFICABLE_PARAR (calculada=$PRO systemd=${SIS:-vacio})"; fi; }
rev_restan() { s=$(rev_sistema) || { echo NO_VERIFICABLE; return 0; }; p=$(( $(cat $D/rev_vence.epoch 2>/dev/null || echo 0) - $(date +%s) )); s=$(( s - $(date +%s) )); if [ "$s" -lt "$p" ]; then echo "$s"; else echo "$p"; fi; }
rev_estado() { echo "timer=$(systemctl show tai-reversion.timer -p ActiveState --value 2>/dev/null) subestado=$(systemctl show tai-reversion.timer -p SubState --value 2>/dev/null) restan_s=$(rev_restan) ahora_utc=$(date -u +%T)"; }
```
<!-- REVHELP:FIN -->
Con la configuración por defecto de `systemd-run` un temporizador puede disparar **hasta 1 minuto tarde** (`AccuracySec=1min`; en F0 se armó con 20 s y disparó a los 26 s): por eso se arma con `AccuracySec=1s` y **no se recarga si no consta**. **2b. Armar** (solo con `F7_VALIDADO`):
<!-- ARMAR:INICIO -->
```sh
sha256sum $D/revertir.sh
T0=$(date +%s)
systemd-run --unit=tai-reversion --on-active=10min --timer-property=AccuracySec=1s --description="reversion automatica del acceso tai-inspect" /bin/sh $D/revertir.sh; echo "reversion armada rc=$?"
systemctl list-timers tai-reversion.timer --no-pager
systemctl show tai-reversion.timer -p AccuracyUSec --value | grep -Eqx '1s|1000ms|1000000' && echo REVERSION_PRECISA || echo REVERSION_IMPRECISA_PARAR
rev_fijar $T0
rev_estado
```
<!-- ARMAR:FIN -->
**Esperado:** la **misma huella** de `revertir.sh` que en F0 (`192264110ba3d7d2184df0713e098209e35172463e784881bd4a542746ed012e`), `reversion armada rc=0`, el temporizador con `NEXT` a unos 10 min, **`REVERSION_PRECISA`**, **`VENCIMIENTO_VERIFICADO`** con una línea **`VENCE_UTC=…`** (que se copiará a PowerShell **solo** en ese caso) y `rev_estado` con `timer=active subestado=waiting` y `restan_s` ≈ 600. El vencimiento es el **menor** de la hora calculada antes de armar y la leída de `systemctl show`; deben diferir como mucho unos segundos (la de systemd ≥ la calculada, porque se toma `T0` antes de armar). **Si sale `REVERSION_IMPRECISA_PARAR`, `VENCIMIENTO_NO_VERIFICABLE_PARAR` o el armado falla: no se recarga nada**; se ejecuta el **bloque de reversión manual segura** (más abajo), que retira el archivo recién colocado (nada se ha recargado todavía y el script comprueba `sshd -t`) y detiene el temporizador **solo si** `revertir.sh` terminó bien; se avisa.

**Paso 3 — Recargar (consola)**, **solo con `REVERSION_PRECISA` y `VENCIMIENTO_VERIFICADO`**:
```sh
systemctl is-active ssh; systemctl reload ssh; echo "reload rc=$?"
```
`reload` (nunca `restart`) mantiene las conexiones abiertas. Si `ssh` no está activo (SSH por socket) la configuración se lee en la próxima conexión y el `reload` puede fallar sin consecuencias.

**Paso 4 — V1–V8 desde Windows (PC) con control del vencimiento real**
1. En PowerShell: `$VenceUtc = '<el valor de VENCE_UTC del Paso 2>'` y pegar el script de §8.1 (empezar en menos de 1 minuto tras el `reload`). El script **se niega a empezar** si `$VenceUtc` falta, es de otra tanda o quedan menos de 90 s, y **cada llamada a `ssh` (también dentro de los bucles de V4 y V8) y cada espera comprueban de nuevo** que queden al menos 90 s: si no, **se detiene**.
2. **Sin rearmado (decisión del propietario, 14/11/2026).** Durante una activación F7 **no existe** ningún bloque para parar, sustituir ni volver a armar el temporizador: se mantiene el **original de diez minutos** hasta el final. Si el script se detiene por tiempo (`V_FALLA`, «reversión inminente» o `FUERA_DE_MARGEN`), o falla o queda pendiente cualquier prueba, o el vencimiento no es verificable: **no se cancela**; se ejecuta la **reversión manual segura** (más abajo) o se deja que dispare la **reversión automática**. Tras una reversión correcta (manual o automática) solo se puede **repetir F7 desde una activación nueva**: desde el **Paso 0**, comprobando que `tai-reversion.timer` y `tai-reversion.service` están inactivos y que `00-tai-inspect.conf` ya no está colocado. Nunca se continúa con la activación anterior.
3. Con `AUTOMATICAS_OK` (y sin pendientes): hacer a mano **V7-administrador** (abrir tu acceso de administrador habitual, **independiente** de `tai-inspect`, y comprobar que entra como siempre) y **V13–V15** en la consola (§8), y pasar la puerta del Paso 5 con **≥ 90 s** restantes. Si no queda tiempo, **no se cancela**: reversión manual segura o automática.
**El único modo de detener el temporizador** es: (a) la cancelación del Paso 5, **solo** si `PUERTA_CANCELACION_OK`; o (b) la reversión manual segura, **solo** si `revertir.sh` terminó con `rc=0`.

**Paso 5 — Puerta de cancelación y cancelación (consola)**
El script de Windows **no autoriza** nada. La cancelación solo es posible si el propietario **declara** los cuatro puntos (escribiéndolos él, **después** de comprobarlos) y la consola verifica lo que puede verificar por sí misma:
<!-- PUERTA:INICIO -->
```sh
# V_AUTO=SI        el script de Windows termino con AUTOMATICAS_OK
# V_ADMIN=SI       tu acceso de administrador habitual (INDEPENDIENTE de tai-inspect) entro como siempre
# V_CONSOLA=SI     V13-V15 en la consola correctos
# V_OMISIONES=NINGUNA (o RESUELTAS si hubo pendientes por el limitador y se resolvieron con RC=0)
# La puerta SE CIERRA si el vencimiento no se puede comprobar, si quedan menos de 90 s, si los invariantes difieren
# o si falta cualquiera de las cuatro declaraciones (entre ellas el acceso administrativo INDEPENDIENTE).
PUERTA=1
[ "$V_AUTO" = SI ] || { echo "FALTA V_AUTO=SI"; PUERTA=0; }
[ "$V_ADMIN" = SI ] || { echo "FALTA V_ADMIN=SI (acceso administrativo independiente)"; PUERTA=0; }
[ "$V_CONSOLA" = SI ] || { echo "FALTA V_CONSOLA=SI"; PUERTA=0; }
case "$V_OMISIONES" in NINGUNA|RESUELTAS) ;; *) echo "FALTA V_OMISIONES=NINGUNA|RESUELTAS"; PUERTA=0;; esac
{ [ "$(systemctl show tai-reversion.timer -p ActiveState --value)" = active ] && [ "$(systemctl show tai-reversion.timer -p SubState --value)" = waiting ]; } || { echo "TEMPORIZADOR_NO_ACTIVO_O_NO_PENDIENTE"; PUERTA=0; }
R=$(rev_restan); echo "restan $R s hasta el vencimiento real (el menor de la hora calculada y la de systemd)"
[ "$R" -ge 90 ] 2>/dev/null || { echo "VENCIMIENTO_NO_VERIFICABLE_O_MENOS_DE_90_S: NO cancelar (sin rearmado): reversion manual segura o dejar vencer la automatica"; PUERTA=0; }
inv $D/invariantes-previo.txt; diff $D/invariantes-base.txt $D/invariantes-previo.txt > /dev/null && echo INVARIANTES_IGUALES || { echo INVARIANTES_DISTINTOS; PUERTA=0; }
[ "$PUERTA" -eq 1 ] && echo PUERTA_CANCELACION_OK || echo PUERTA_CANCELACION_CERRADA
```
<!-- PUERTA:FIN -->
Solo con **`PUERTA_CANCELACION_OK`**:
```sh
[ "$PUERTA" -eq 1 ] && { systemctl stop tai-reversion.timer; echo "cancelada rc=$?"; } || echo "NO SE CANCELA: la puerta esta cerrada"
systemctl is-active tai-reversion.timer; systemctl is-active tai-reversion.service; systemctl list-timers --all --no-pager | grep -c tai-reversion
inv $D/invariantes-despues.txt; diff $D/invariantes-base.txt $D/invariantes-despues.txt && echo INVARIANTES_IGUALES
unset V_AUTO V_ADMIN V_CONSOLA V_OMISIONES PUERTA
```
**Esperado:** `cancelada rc=0`, el temporizador y el servicio `inactive` (o «unknown»), `0` temporizadores pendientes e `INVARIANTES_IGUALES`. Desde el PC, de nuevo `https://treidilor.com/api/health` (`status = ok` y el mismo `sourceHash`). **CP5.** Si la puerta sale `CERRADA`, **no se cancela**: se revierte (reversión manual segura o automática) y, si procede, se repite F7 desde una activación nueva. **No se re-arma.** La puerta permanece cerrada ante cualquier prueba pendiente, fallo o vencimiento no verificable.

**Reversión manual segura (si algo falla o se pierde el control)** — no necesita ninguna sesión SSH; el temporizador **solo se detiene si `revertir.sh` terminó bien**:
<!-- REVMAN:INICIO -->
```sh
sh $D/revertir.sh; REVERSION_RC=$?; echo "REVERSION_RC=$REVERSION_RC"
if [ "$REVERSION_RC" -eq 0 ]; then systemctl stop tai-reversion.timer; echo "temporizador detenido (la reversion termino bien)"; else echo "REVERSION_FALLO rc=$REVERSION_RC: NO se detiene el temporizador (proteccion automatica conservada). COMUNICAR este mensaje y la salida anterior"; fi
inv $D/invariantes-despues.txt; diff $D/invariantes-base.txt $D/invariantes-despues.txt && echo INVARIANTES_IGUALES
```
<!-- REVMAN:FIN -->
`REVERSION_RC` distinto de 0 (p. ej. `3`: el archivo de `sshd` fue cambiado por otra persona y no se borra; `4`/`5`: `sshd -t` o la recarga fallaron) **conserva la protección automática** y se comunica el error antes de seguir. Tras una reversión correcta: `INVARIANTES_IGUALES` y `https://treidilor.com/api/health` con el mismo `sourceHash`. Si no se interviene, a la hora de vencimiento el propio temporizador ejecuta el mismo script.

**Riesgos pendientes de F7 (y mitigación):**
| Riesgo | Mitigación |
|---|---|
| El script de §8.1 **no se ha ejecutado contra el `ssh.exe` real** (solo contra un `ssh` simulado que es un proceso real): los textos reales de `-tt`/`-W` podrían diferir y dar un falso `FALLA` | Un `FALLA` aislado en V5 se revisa con la salida completa **antes** de decidir; no se cancela; sin tiempo suficiente se revierte y se repite F7 desde una activación nueva (sin rearmado). Una vez fiable, se fija como procedimiento |
| El formato de `ActiveEnterTimestamp` y `SubState` en el systemd del VPS (255.4) no está comprobado sobre `tai-reversion.timer` (sí sobre temporizadores existentes en el Paso 0) | El vencimiento solo se da por verificado si concuerda con la hora calculada antes de armar (±5/+10 s); si no, **no se recarga** y, en la puerta, **se cierra** |
| Ventana de 10 min corta | Script de ≈ 2–3 min; **cada llamada a `ssh` y cada espera exigen ≥ 90 s** hasta el vencimiento (mayor que la iteración más larga de V8, 85 s); **sin rearmado**: si no alcanza el tiempo se revierte (manual o automática) y se repite F7 desde cero; el temporizador original nunca se detiene antes de la puerta |
| Estado persistente del limitador (`RC=7` inesperado) | Reintento automático (V1 y las comprobaciones de 30 s); `host-actualizaciones` pendiente se resuelve antes de cancelar; el Paso 0 muestra las edades |
| Clave no cargada, alias o clave equivocados | V0 aborta antes de conectar; `BatchMode` y límite de tiempo evitan colgarse |
| Más de 2 intentos de autenticación (`MaxAuthTries 2`) | `identitiesonly yes` verificado en V0 |
| Cupo diario (60) | Esta serie usa ≈ 20 peticiones; el Paso 0 muestra el contador |
| Confirmaciones `V_*` de una tanda anterior | `unset` al empezar y al terminar |
| Reinicio del servidor durante la ventana (el temporizador es transitorio) | No se reinicia; `sshd -t` ya validó la configuración |
| El snapshot (R4) revertiría cambios posteriores (p. ej. filas `ex-17` y `ex-18`) | Solo como último recurso; no se lanzan auditorías ni despliegues durante la ventana |
| Hora: el VPS está en UTC | Todas las horas de este paso son UTC |

### F8 — Pausa con solo el gate (≥ 24 h)
> **Cierre (16/11/2026): CERRADA con riesgos residuales; resultados, prueba controlada de la consola web y límites de atribución en `F8-CIERRE-INFORME.md`. F9 sigue sin autorizar.**

Sin colector ni unidades. El propietario usa las 5 comprobaciones del host cuando quiera y, pasadas 24 h, devuelve: `tail -20 /var/log/tai-inspect/gate-audit.log`, `journalctl -t tai-gate -n 20 --no-pager`, `diff` de invariantes y cualquier incidencia. **Decisión explícita para continuar con F9.**

### F9 — Fase B: colector (autorización propia). `systemd-analyze` ANTES de copiar nada
```sh
U=/opt/tai-inspect/deploy/systemd
systemd-analyze verify $U/tai-collector.service $U/tai-collector.path $U/tai-collector.timer > $D/verify.txt 2>&1; rc=$?
echo "verify rc=$rc"; cat $D/verify.txt
{ [ $rc -eq 0 ] && [ ! -s $D/verify.txt ]; } && echo VERIFY_OK || echo VERIFY_FALLA_PARAR
systemd-analyze security --offline=true --no-pager $U/tai-collector.service > $D/seguridad.txt 2>&1; rc=$?
echo "security rc=$rc"; cat $D/seguridad.txt
{ [ $rc -eq 0 ] && [ "$(grep -c 'Overall exposure level' $D/seguridad.txt)" = 1 ]; } && echo SECURITY_OK || echo SECURITY_FALLA_PARAR
```
**Esperado:** `verify rc=0` **y salida vacía** (`VERIFY_OK`) y `security rc=0` con la línea `Overall exposure level` (`SECURITY_OK`; se anota el nivel, no se exige un número). Si `verify` protesta por no encontrar `tai-collector.service` al cargar las tres unidades desde `/opt`, **es un fallo a consultar** (no se «arregla» copiando antes). **Solo con `VERIFY_OK` y `SECURITY_OK`:**
```sh
install -o root -g root -m 0644 $U/tai-collector.service /etc/systemd/system/tai-collector.service
install -o root -g root -m 0644 $U/tai-collector.path /etc/systemd/system/tai-collector.path
install -o root -g root -m 0644 $U/tai-collector.timer /etc/systemd/system/tai-collector.timer
systemctl daemon-reload; echo "daemon-reload rc=$?"
systemctl start tai-collector.service; echo "arranque unico rc=$?"
systemctl show tai-collector.service -p Result -p ExecMainStatus > $D/colector-estado.txt 2>&1; cat $D/colector-estado.txt
journalctl -u tai-collector.service --no-pager -n 20 > $D/colector-journal.txt 2>&1; cat $D/colector-journal.txt
```
**Esperado:** `arranque unico rc=0`, `Result=success`, `ExecMainStatus=0` y un journal sin trazas. **Solo entonces** habilitar las dos comprobaciones y los disparadores:
```sh
printf '["host-recursos","host-red","host-servicios","host-actualizaciones","host-tiempo","integridad-inspeccion","auditoria-resumen"]' > /opt/tai-inspect/enabled.json
chown root:root /opt/tai-inspect/enabled.json; chmod 0644 /opt/tai-inspect/enabled.json
/opt/tai-inspect/bin/tai-manifest; echo "manifiesto rc=$?"
systemctl enable --now tai-collector.path tai-collector.timer; echo "enable rc=$?"
systemctl list-timers tai-collector.timer --no-pager; systemctl is-active tai-collector.path
inv $D/invariantes-despues.txt; diff $D/invariantes-base.txt $D/invariantes-despues.txt && echo INVARIANTES_IGUALES
```
Desde el PC: V9–V12 (§8). **CP6.** Las 11 sensibles siguen cerradas.

## 8. Verificaciones de funcionamiento (V)
**Desde el PC** (PowerShell de Windows, alias `tai-inspect-vps`, clave dedicada cargada en el agente; la consola web abierta durante F7). Las ejecuta **el script de §8.1**:
**Cómo actúa el limitador (comprobado con los registros reales del VPS, 14/11/2026: 11:41:41 UTC aceptada, 11:42:02 rechazada a los 21 s, 11:42:22 aceptada a los 41 s):** cada comprobación tiene su propio intervalo mínimo (30 s; `host-actualizaciones`, 300 s) contado desde la última petición **aceptada**; las rechazadas ni consumen cupo ni alargan la espera, y el estado es **persistente** (`/var/lib/tai-inspect/state/cuota.json`): una petición aceptada poco antes —también en una prueba anterior— puede limitar la primera de esta serie.
| # | Prueba | Resultado esperado |
|---|---|---|
| V1 | `solicitar host-recursos` (primera petición del par) | `RC=0` y JSON válido de `host-recursos`. Si sale `RC=7` por una petición aceptada hace menos de 30 s, se espera 35 s y se reintenta **una** vez |
| V2 | **Inmediatamente** después de V1 (en el mismo script, ≈ 2 s, siempre < 30 s) la misma orden | `RC=7` y `limite alcanzado` |
| V2b | Esperar **35 s** desde la última petición **aceptada** y repetir | `RC=0` otra vez (el límite expira) |
| V3 | `solicitar docker-nodos` | `RC=2`, `comprobacion no disponible` (sensible cerrada) |
| V4 | `id`, `bash`, `solicitar ../x`, `id; cat /etc/passwd` y una sesión sin orden | `RC=2`, `orden no permitida`; ningún shell ni `uid=` |
| V5 | `ssh -W 127.0.0.1:22` y `ssh -v -tt` | Reenvío denegado (sin banner SSH); `PTY allocation request failed on channel N` con `RC=255`, tras `Authenticated to`, sin salida |
| V6 | Acceso por contraseña como `tai-inspect` | Solo `publickey` y acceso denegado |
| V7 | **OBLIGATORIA y automática:** `https://treidilor.com/api/health` (TLS 1.2) y, **a mano**, el acceso de administrador habitual (independiente de `tai-inspect`) | `status = ok` y `sourceHash` **idéntico, carácter a carácter** a `0885734050b5c946c3eb22e328120eea080d7a68adb17a1c10816da0f15c7487`; el acceso de administrador entra como antes. Un error de red es **fallo**, nunca «omitida» |
| V8 | `host-red`, `host-servicios`, `host-tiempo` y `host-actualizaciones` | `RC=0` y JSON válido. **No hace falta espaciarlas**: cada comprobación tiene su propio intervalo; una limitada (`RC=7`) se espera y reintenta una vez (las de 30 s) y `host-actualizaciones` (300 s) queda **PENDIENTE OBLIGATORIA** si se usó hace menos de 5 min: se resuelve antes de cancelar (§8.1) |
| V9 | (F9) `solicitar integridad-inspeccion` | Informe con `peticion` (32 hex); `integridad` con `ok: true`; aviso `registro_gate_sin_solo_anadir` (esperado) |
| V10 | (F9) `solicitar auditoria-resumen` | Informe válido |
| V11 | (F9, consola) tras ≤ 15 min: `tail -3 /var/log/tai-inspect/collector-audit.log` | `colector_ancla` con `resultado ok`; `colector_intencion` → `colector_resultado` → `colector_publicacion` |
| V12 | (F9, consola) `ls /var/lib/tai-inspect/staging` y `touch /etc/tai-inspect/DISABLED` + V1 + `rm /etc/tai-inspect/DISABLED` | Vacío; con el archivo `desactivado` (código 3); sin él, vuelve a funcionar |
**En la consola web** (F7 y F9):
| # | Prueba | Resultado esperado |
|---|---|---|
| V13 | `su -s /bin/sh tai-inspect -c 'for p in /opt/tai-inspect /var/lib/tai-inspect/reports /var/lib/tai-inspect/staging /var/lib/tai-inspect/collector-state /var/lib/tai-inspect/home /etc/ssh/authorized_keys.tai-inspect /etc/ssh/sshd_config.d; do [ -w "$p" ] && echo ESCRIBIBLE:$p; done; for p in /var/lib/tai-inspect/staging /var/lib/tai-inspect/collector-state /var/lib/tai-inspect/requests; do [ -r "$p" ] && echo LEGIBLE:$p; done'` | **Ninguna salida** |
| V14 | `sudo -l -U tai-inspect` y `id tai-inspect` | Sin permisos de sudo; solo su grupo |
| V15 | `tail -4 /var/log/tai-inspect/gate-audit.log` y `journalctl -t tai-gate -n 4 --no-pager` | `gate_intencion` → `gate_resultado` con `seq` correlativo; igual en `journald` |

### 8.1 V1–V8 desde Windows PowerShell 5.1 (script único, acotado en el tiempo)
Se pega **entero** en Windows PowerShell 5.1 **justo después de recargar** `sshd` (F7, paso 4), **tras fijar `$VenceUtc`** con la línea `VENCE_UTC=…` que imprimió la consola al armar la reversión (p. ej. `$VenceUtc = '2026-11-14T12:30:05Z'`). Usa el alias `tai-inspect-vps` (clave dedicada **`~/.ssh/tai-inspect_ed25519`**; **no** `id_ed25519_tai_inspect`). Solo ejecuta `ssh` —cada llamada **acotada en el tiempo**, con la entrada **cerrada** y el árbol de procesos **terminado** si excede su tiempo— y **una** consulta a `https://treidilor.com/api/health` (el dominio `tradylor.com` figura en el repositorio como **obsoleto**; se usa `treidilor.com`). Es solo ASCII y compatible con PowerShell 5.1. **No cancela ni autoriza cancelar la reversión.**
<!-- PS-V:INICIO -->
```powershell
# V1-V8 de F7 desde Windows PowerShell 5.1 (solo ASCII). Alias SSH: tai-inspect-vps; clave dedicada ~/.ssh/tai-inspect_ed25519.
# Ejecuta SOLO `ssh` (cada llamada ACOTADA en tiempo, con la entrada cerrada y el arbol de procesos eliminado si excede su tiempo) y UNA consulta HTTPS a /api/health.
# NO CANCELA NI AUTORIZA CANCELAR LA REVERSION: solo informa. La cancelacion se decide en la consola con su "puerta de cancelacion" (plan F7, paso 5).
# ANTES: $VenceUtc = "<VENCE_UTC que imprimio la consola al armar la reversion>"   (p. ej. '2026-11-14T12:30:05Z')
$Alias = "tai-inspect-vps"
if (-not (Test-Path variable:Dominio)) { $Dominio = "treidilor.com" }
if (-not (Test-Path variable:SourceHashEsperado)) { $SourceHashEsperado = "0885734050b5c946c3eb22e328120eea080d7a68adb17a1c10816da0f15c7487" }
if (-not (Test-Path variable:HuellaClave)) { $HuellaClave = "SHA256:OW0d/GCWjasNxmoh7RWafXSFQZvvYt7nNIgtHXVpQtU" }   # huella REAL de /etc/ssh/authorized_keys.tai-inspect (comprobada en el VPS)
if (-not (Test-Path variable:VenceUtc)) { $VenceUtc = "" }
if (-not (Test-Path variable:IdActivacion)) { $IdActivacion = "" }          # id que imprime `activar` en la consola
if (-not (Test-Path variable:SecretoActivacion)) { $SecretoActivacion = "" }  # clave de ESTA activacion (32 hex) que imprime `activar`
if (-not (Test-Path variable:AliasAdmin)) { $AliasAdmin = "" }            # opcional: alias SSH del administrador habitual (por clave)
if (-not (Test-Path variable:Esperas)) { $Esperas = 35 }       # s: reintento y V2b (limitador de 30 s)
if (-not (Test-Path variable:MaxSsh)) { $MaxSsh = 25 }         # s maximos de CADA llamada a ssh
if (-not (Test-Path variable:MargenS)) { $MargenS = 90 }       # s minimos que deben quedar hasta el vencimiento de la reversion
if (-not (Test-Path variable:SshExe)) { $SshExe = "" }         # solo para pruebas locales con un ssh simulado
if (-not (Test-Path variable:SshPrefijo)) { $SshPrefijo = @() }
if (-not (Test-Path function:AhoraUtc)) { function AhoraUtc { return (Get-Date).ToUniversalTime() } }
if (-not (Test-Path function:Dormir)) { function Dormir([int]$s) { Start-Sleep -Seconds $s } }
$ErrorActionPreference = "Continue"
$inicio = Get-Date
$ok = 0; $ko = 0; $abortado = $false
$omitidas = @(); $hijos = @()
$estadoAdmin = "NO_PROBADO"

function Marca { return ("{0:mm\:ss}" -f ((Get-Date) - $inicio)) }
function VenceDe([string]$t) { return [datetime]::ParseExact($t, "yyyy-MM-ddTHH:mm:ssZ", [Globalization.CultureInfo]::InvariantCulture, ([Globalization.DateTimeStyles]::AdjustToUniversal -bor [Globalization.DateTimeStyles]::AssumeUniversal)) }
function Restante { return [int](((VenceDe $VenceUtc) - (AhoraUtc)).TotalSeconds) }
function Margen([string]$donde) {
    $r = Restante
    if ($r -lt $MargenS) { throw "reversion inminente (quedan $r s antes de $donde; minimo $MargenS s): NO se rearma: NO cancelar; reversion manual segura o dejar vencer la automatica" }
}
function Control([string]$etapa) {
    $r = Restante
    "   [tiempo] antes de $etapa : quedan $r s para el vencimiento REAL de la reversion (minimo exigido $MargenS s)"
    Margen $etapa
}
function Espera([int]$s) {
    if ((Restante) - $s -lt $MargenS) { throw "no hay tiempo para esperar $s s (quedan $(Restante) s): NO se rearma; reversion manual segura o dejar vencer la automatica" }
    Dormir $s
}
function Q([string]$s) { if ($s -eq "" -or $s -match '[\s";]') { return '"' + ($s -replace '"', '\"') + '"' } else { return $s } }
function Ejecutar([string[]]$arg, [int]$seg) {
    $exe = $SshExe
    if ($exe -eq "") {
        $c = Get-Command ssh.exe -ErrorAction SilentlyContinue
        if (-not $c) { return [pscustomobject]@{ Rc = -1; Out = ""; Err = "ssh.exe no encontrado"; TimedOut = $false } }
        $exe = $c.Source
    }
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $exe
    $psi.Arguments = ((@($SshPrefijo) + @($arg)) | ForEach-Object { Q $_ }) -join " "
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $script:hijos += $p.Id
    $p.StandardInput.Close()
    $tOut = $p.StandardOutput.ReadToEndAsync(); $tErr = $p.StandardError.ReadToEndAsync()
    $timeout = $false
    if (-not $p.WaitForExit($seg * 1000)) {
        $timeout = $true
        & taskkill.exe /T /F /PID $p.Id 2>&1 | Out-Null
        [void]$p.WaitForExit(5000)
    }
    $o = ""; $e = ""
    if ($tOut.Wait(3000)) { $o = [string]$tOut.Result }
    if ($tErr.Wait(3000)) { $e = [string]$tErr.Result }
    $rc = -1
    if ($p.HasExited) { $rc = $p.ExitCode }
    return [pscustomobject]@{ Rc = $rc; Out = $o; Err = $e; TimedOut = $timeout }
}
function Gate([string]$orden, [string[]]$opc = @(), [int]$seg = $MaxSsh, [bool]$sinN = $false) {
    Margen "cada llamada a ssh"     # TODA llamada (tambien dentro de los bucles V4 y V8 y las repeticiones manuales) exige >= $MargenS s hasta el vencimiento
    $a = @("-o", "BatchMode=yes", "-o", "ConnectTimeout=10")
    if (-not $sinN) { $a = @("-n") + $a }
    $a = $a + $opc + @($Alias)
    if ($orden) { $a += $orden }
    return (Ejecutar $a $seg)
}
function Causa($r) {
    if ($r.TimedOut) { return "TIMEOUT: ssh excedio su tiempo y fue terminado" }
    if ($r.Rc -eq -1) { return "ERROR_LOCAL: " + $r.Err }
    if ($r.Rc -eq 255 -and $r.Err -match "Permission denied") { return "AUTENTICACION: la clave no se cargo o no fue aceptada" }
    if ($r.Rc -eq 255) { return "RED/CONEXION: " + (($r.Err -replace "\s+", " ").Trim()) }
    return "RC=" + $r.Rc
}
function EsRedOAuth($r) { return ($r.TimedOut -or $r.Rc -eq 255 -or $r.Rc -eq -1) }
function Res([string]$nombre, [bool]$bien, [string]$detalle) {
    if ($bien) { $script:ok++; "[{0}] OK     {1} ({2})" -f (Marca), $nombre, $detalle }
    else { $script:ko++; "[{0}] FALLA  {1} ({2})" -f (Marca), $nombre, $detalle }
}
function Json([string]$t) { try { return ($t | ConvertFrom-Json) } catch { return $null } }
function Pide([string]$check, [int]$espera) {
    $r = Gate ("solicitar " + $check)
    if ($r.Rc -eq 7 -and $espera -gt 0) {
        "   $check limitada por una peticion aceptada reciente (limitador persistente): espero $espera s y reintento UNA vez"
        Espera $espera
        $r = Gate ("solicitar " + $check)
    }
    return $r
}

try {
    "== V0: condiciones locales (sin conectar) y vencimiento de la reversion =="
    try { [void](VenceDe $VenceUtc) }
    catch { throw "defina `$VenceUtc con la hora VENCE_UTC que imprimio la consola al armar la reversion, SOLO si la consola dijo VENCIMIENTO_VERIFICADO (formato 2026-11-14T12:30:05Z)" }
    if ($IdActivacion -cnotmatch '^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{16}$') { throw "defina `$IdActivacion con el id que imprimio 'activar' en la consola (ej. 20261114T120000Z-0123456789abcdef)" }
    if ($SecretoActivacion -cnotmatch '^[0-9a-f]{32}$') { throw "defina `$SecretoActivacion con la clave que imprimio 'activar' en la consola (32 hexadecimales)" }
    if ($AliasAdmin -ceq $Alias) { throw "`$AliasAdmin no puede ser el alias de tai-inspect: debe ser el acceso de administrador habitual, INDEPENDIENTE" }
    $r0 = Restante
    if ($r0 -gt 660 -or $r0 -lt 0) { throw "`$VenceUtc no es de esta tanda (restan $r0 s; se esperan entre 0 y 660): vuelva a copiar VENCE_UTC del ultimo armado" }
    $g = Ejecutar @("-G", $Alias) 15
    $idf = @($g.Out -split "`r?`n" | Where-Object { $_ -match "^identityfile " })
    Res "V0 alias: usuario tai-inspect, UNA sola clave tai-inspect_ed25519 (no id_ed25519_tai_inspect) e identitiesonly yes" (($g.Rc -eq 0) -and ($g.Out -match '(?m)^user tai-inspect\s*$') -and ($idf.Count -eq 1) -and ($idf[0] -match 'tai-inspect_ed25519\s*$') -and ($g.Out -notmatch "id_ed25519_tai_inspect") -and ($g.Out -match '(?m)^identitiesonly yes\s*$')) ("identityfile=" + ($idf -join ";"))
    $ag = (& ssh-add -l 2>&1 | Out-String)
    Res "V0 la clave dedicada esta cargada en el agente" ($ag.Contains($HuellaClave)) ("huella esperada " + $HuellaClave)
    if ($ko -gt 0) { throw "las condiciones locales no se cumplen: corregir antes de probar contra el VPS" }
    Control "V1"

    "== V1/V2/V2b: limitador (30 s por comprobacion; V1 primera peticion, V2 la inmediata) =="
    $r1 = Pide "host-recursos" $Esperas
    if (EsRedOAuth $r1) { throw ("V1 NO CONCLUYENTE: " + (Causa $r1)) }
    $j1 = Json $r1.Out
    Res "V1 host-recursos acepta y devuelve JSON valido" (($r1.Rc -eq 0) -and ($j1 -ne $null) -and ($j1.check -eq "host-recursos")) (Causa $r1)
    $r2 = Gate "solicitar host-recursos"
    Res "V2 la repetida inmediata se rechaza (RC=7, limite alcanzado)" ((-not $r2.TimedOut) -and ($r2.Rc -eq 7) -and ($r2.Out -match "limite alcanzado")) (Causa $r2)
    "   espero $Esperas s desde la ultima peticion ACEPTADA (V1)"
    Espera $Esperas
    $r3 = Gate "solicitar host-recursos"
    $j3 = Json $r3.Out
    Res "V2b pasados $Esperas s vuelve a aceptar (RC=0, JSON valido)" (($r3.Rc -eq 0) -and ($j3 -ne $null) -and ($j3.check -eq "host-recursos")) (Causa $r3)

    Control "V3-V4"
    "== V3: comprobacion sensible cerrada =="
    $r = Gate "solicitar docker-nodos"
    Res "V3 docker-nodos no disponible (RC=2)" ((-not $r.TimedOut) -and ($r.Rc -eq 2) -and ($r.Out -match "comprobacion no disponible")) (Causa $r)
    "== V4: ordenes hostiles y sesion sin orden =="
    foreach ($o in @("id", "bash", "solicitar ../x", "id; cat /etc/passwd")) {
        $r = Gate $o
        Res "V4 orden hostil '$o' -> orden no permitida (RC=2), sin shell" ((-not $r.TimedOut) -and ($r.Rc -eq 2) -and ($r.Out -match "orden no permitida") -and ($r.Out -notmatch "uid=|root:")) (Causa $r)
    }
    $r = Gate "" @("-T")
    Res "V4 sesion sin orden -> orden no permitida (RC=2)" ((-not $r.TimedOut) -and ($r.Rc -eq 2) -and ($r.Out -match "orden no permitida")) (Causa $r)

    Control "V5-V6"
    $tc = [Math]::Min($MaxSsh, 15)
    "== V5: reenvio y pseudoterminal denegados POR EL SERVIDOR (no se acepta un simple error de red) =="
    $r = Gate "" @("-v", "-W", "127.0.0.1:22") $tc $true
    $pw = ((-not $r.TimedOut) -and ($r.Rc -ne 0) -and ($r.Err -match "Authenticated to") -and ($r.Err -match "administratively prohibited|stdio forwarding failed") -and ($r.Out -notmatch "SSH-2\.0"))
    Res "V5 -W: autentico y el servidor prohibio el reenvio" $pw $(if ($pw) { "RC=" + $r.Rc + ", denegado por el servidor" } else { Causa $r })
    $r = Gate "id" @("-v", "-tt") $tc
    # Con -tt el cliente trata el rechazo del PTY como FATAL (RC=255) ANTES de ejecutar el comando: no hay respuesta del gate. La evidencia del servidor es: sesion autenticada + CHANNEL_FAILURE del pty-req + ninguna salida.
    $ptt = ((-not $r.TimedOut) -and ($r.Rc -eq 255) -and ($r.Err -match "Authenticated to") -and ($r.Err -match "PTY allocation request failed on channel \d+") -and ([string]::IsNullOrWhiteSpace($r.Out)))
    Res "V5 -tt: autentico y el servidor rechazo el pseudoterminal (fatal con -tt; no se ejecuta ni el gate ni un shell)" $ptt $(if ($ptt) { "RC=255, PTY rechazado por el servidor tras autenticar" } else { (Causa $r) + "; stdout: " + (($r.Out -replace "\s+", " ").Trim()) + "; stderr: " + (($r.Err -replace "\s+", " ").Trim()) })
    "== V6: la contrasena no se ofrece (el servidor solo ofrece publickey) =="
    Margen "V6"
    $r = Ejecutar @("-v", "-n", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "PreferredAuthentications=password", "-o", "PubkeyAuthentication=no", $Alias, "true") $tc
    $ms = [regex]::Matches($r.Err, "Authentications that can continue: ([^\r\n]*)")
    $soloPk = ($ms.Count -ge 1)
    foreach ($m in $ms) { if ($m.Groups[1].Value.Trim() -ne "publickey") { $soloPk = $false } }
    $p6 = ((-not $r.TimedOut) -and ($r.Rc -ne 0) -and $soloPk)
    $det6 = "RC=" + $r.Rc + ", denegado por el servidor"
    if (-not $p6) { if (($ms.Count -ge 1) -and (-not $soloPk)) { $det6 = "METODOS OFRECIDOS: " + (($ms | ForEach-Object { $_.Groups[1].Value.Trim() }) -join " | ") } else { $det6 = Causa $r } }
    Res "V6 el servidor ofrece solo publickey y deniega" $p6 $det6

    Control "V7"
    "== V7 (OBLIGATORIA): /api/health de $Dominio =="
    if ([string]::IsNullOrWhiteSpace($Dominio)) { throw "V7 es obligatoria: `$Dominio no puede estar vacio" }
    if ($SourceHashEsperado -cnotmatch '^[0-9a-f]{64}$') { throw "V7 es obligatoria: `$SourceHashEsperado debe ser el sourceHash real (64 hexadecimales en minuscula)" }
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $h = Invoke-RestMethod ("https://" + $Dominio + "/api/health") -TimeoutSec 20
        $st = [string]$h.status; $sh = [string]$h.sourceHash
        Res "V7 /api/health status=ok" ($st -ceq "ok") ("status=" + $st)
        $dsh = "sourceHash=" + $sh; if ([string]::IsNullOrWhiteSpace($sh)) { $dsh = "sourceHash AUSENTE en la respuesta" }
        Res "V7 sourceHash REAL igual al esperado (exacto)" ($sh -ceq $SourceHashEsperado) $dsh
    } catch { Res "V7 /api/health (obligatoria)" $false ("error: " + $_.Exception.Message) }

    if ($AliasAdmin -ne "") {
        Control "V7-admin"
        "== V7-admin (opcional): el acceso de administrador habitual, independiente de tai-inspect, entra como siempre =="
        Margen "V7-admin"
        $ra = Ejecutar @("-n", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", $AliasAdmin, "echo TAI_ADMIN_OK") ([Math]::Min($MaxSsh, 15))
        $adminOk = ((-not $ra.TimedOut) -and ($ra.Rc -eq 0) -and ($ra.Out.Trim() -ceq "TAI_ADMIN_OK"))
        if ($adminOk) { $estadoAdmin = "SSH_OK" } else { $estadoAdmin = "FALLA" }
        Res "V7-admin acceso administrativo independiente por SSH (BatchMode, solo lectura: echo)" $adminOk $(if ($adminOk) { "entro como siempre" } else { Causa $ra })
    }

    Control "V8"
    "== V8: resto de comprobaciones del host (cada una con su propio intervalo; host-actualizaciones, 300 s) =="
    foreach ($c in @("host-red", "host-servicios", "host-tiempo", "host-actualizaciones")) {
        $espera = $Esperas; if ($c -eq "host-actualizaciones") { $espera = 0 }
        $r = Pide $c $espera
        if ($r.Rc -eq 7) { $omitidas += $c; "[{0}] PENDIENTE (limitador) V8 {1}: RC=7; es OBLIGATORIA y debe resolverse antes de cancelar la reversion" -f (Marca), $c; continue }
        $j = Json $r.Out
        Res ("V8 " + $c + " acepta y devuelve JSON valido") ((-not (EsRedOAuth $r)) -and ($r.Rc -eq 0) -and ($j -ne $null) -and ($j.check -eq $c)) (Causa $r)
        if ($r.Out -match "\b(\d{1,3}\.){3}\d{1,3}\b") { "   AVISO: aparece una direccion IP en el informe de $c; revisar el contenido" }
    }
} catch {
    $abortado = $true
    "ABORTADO: " + $_.Exception.Message
} finally {
    $vivos = 0
    foreach ($id in $hijos) { $q = Get-Process -Id $id -ErrorAction SilentlyContinue; if ($q) { $vivos++; & taskkill.exe /T /F /PID $id 2>&1 | Out-Null } }
    "   [procesos ssh que quedaban abiertos y se terminaron: $vivos]"
}

"== Resumen: $ok correctas, $ko fallidas, $($omitidas.Count) pendientes por el limitador; $(Marca) desde el arranque =="
# Margen de proteccion AL TERMINAR: nunca se declara un resultado satisfactorio (ni incompleto) si ya no queda margen o el vencimiento no se puede calcular
$finRestante = $null
try { $finRestante = Restante } catch { $finRestante = $null }
$fueraMargen = (($finRestante -eq $null) -or ($finRestante -lt ($MargenS + 60)))   # 90 s de margen + 60 s para pegar el cierre en la consola
if ($finRestante -ne $null) { "   [tiempo] al terminar: quedan $finRestante s para el vencimiento REAL de la reversion (minimo exigido $MargenS s)" }
if ($abortado -or $ko -gt 0 -or $fueraMargen) {
    if ($fueraMargen) { "FUERA_DE_MARGEN: no quedan los $($MargenS + 60) s necesarios (90 s de margen + 60 s para pegar el cierre) o no se puede calcular: ningun resultado es satisfactorio" }
    $veredicto = "V_FALLA"
    "V_FALLA: NO cancelar la reversion; NO se rearma: reversion manual segura o dejar vencer la automatica (F7, 'Si algo falla')"
} elseif ($omitidas.Count -gt 0) {
    $veredicto = "V_INCOMPLETO"
    "V_INCOMPLETO: pendientes OBLIGATORIAS por el limitador: " + ($omitidas -join ", ") + ". Resolver SOLO si queda margen (>= 90 s) en el temporizador ORIGINAL: esperar a que pase su intervalo y ejecutar en esta sesion: `$r = Gate 'solicitar <comprobacion>'; `$r.Rc; (`$r.Out | ConvertFrom-Json).check  -> RC=0 y la comprobacion correcta. NO se rearma: sin tiempo, NO cancelar; reversion manual segura o dejar vencer la automatica"
} else {
    $veredicto = "AUTOMATICAS_OK"
    "AUTOMATICAS_OK (V0-V8 automaticas superadas). ESTO NO AUTORIZA CANCELAR por si mismo: lo decide la consola con la orden 'cerrar' que se imprime abajo (o, en el procedimiento manual, con su puerta de cancelacion)."
}

# Resultado ATADO a esta activacion (id + HMAC con la clave que imprimio 'activar'); la consola lo verifica y decide. Se emite SIEMPRE: con un fallo, la consola revierte con seguridad.
$ab = 0; if ($abortado) { $ab = 1 }
$fu = 0; if ($fueraMargen) { $fu = 1 }
$msgF7 = "F7R1|" + $IdActivacion + "|" + $veredicto + "|" + $ok + "|" + $ko + "|" + $omitidas.Count + "|" + $ab + "|" + $fu + "|" + $VenceUtc + "|" + $estadoAdmin
$hmacF7 = New-Object System.Security.Cryptography.HMACSHA256 (, [Text.Encoding]::UTF8.GetBytes($SecretoActivacion))
$hexF7 = ([BitConverter]::ToString($hmacF7.ComputeHash([Text.Encoding]::UTF8.GetBytes($msgF7))) -replace "-", "").ToLower()
$psF7 = ""
try { if ($PSCommandPath) { $psF7 = " ps=" + (Get-FileHash -Algorithm SHA256 -LiteralPath $PSCommandPath).Hash.Substring(0, 16).ToLower() } } catch { $psF7 = "" }
$lineaF7 = "F7R1 id=" + $IdActivacion + " veredicto=" + $veredicto + " ok=" + $ok + " ko=" + $ko + " pend=" + $omitidas.Count + " abortado=" + $ab + " fuera=" + $fu + " vence=" + $VenceUtc + " admin=" + $estadoAdmin + $psF7 + " hmac=" + $hexF7
"== EN LA CONSOLA DE HOSTINGER, pegar esta orden (tambien si ha fallado: la consola decide y revierte con seguridad) =="
"sh /root/tai-etapa2/f7-vps.sh cerrar '" + $lineaF7 + "'"

```
<!-- PS-V:FIN -->
**Tres resultados posibles (el script nunca declara éxito definitivo):**
| Resultado final | Significado | Qué hacer |
|---|---|---|
| `V_FALLA` | Alguna prueba obligatoria falló, no fue concluyente (red, autenticación, tiempo agotado) o se abortó por el tiempo | **No cancelar.** Revertir con el bloque de reversión manual segura (F7) o esperar al vencimiento; anotar la salida completa |
| `V_INCOMPLETO` | Todo lo ejecutado pasó, pero quedan pruebas **obligatorias pendientes por el limitador** (solo puede ocurrir con `host-actualizaciones`, 300 s) | **No cancelar todavía.** Ver «Omisiones legítimas» |
| `AUTOMATICAS_OK` | Las pruebas **automáticas** V0–V8 pasaron. **No autoriza cancelar**: faltan los obligatorios **manuales** (V7 administrador independiente, V13–V15 en la consola) y la puerta de cancelación de la consola | Seguir con el Paso 5 |
**Pruebas obligatorias, condicionadas y manuales.** *Obligatorias automáticas:* V0 (alias, clave y agente), V1, V2, V2b, V3, V4 (5), V5 (2), V6, V7 (2) y V8 (4). *Condicionadas por el limitador:* V1 (se reintenta una vez tras 35 s si había una petición aceptada reciente) y V8 (cada comprobación se reintenta una vez; `host-actualizaciones` no, porque su intervalo es de 300 s): solo en ese caso puede quedar una prueba **pendiente**, nunca «superada». *Manuales obligatorias:* V7-administrador independiente y V13–V15 (consola).
**Omisiones legítimas — cómo se registran y se resuelven.** Una prueba solo queda pendiente por `RC=7` del limitador, y el script la **nombra** en el resultado (`V_INCOMPLETO: host-actualizaciones`). Para resolverla **antes** de cancelar: (1) en la consola, comprobar la edad de la última petición aceptada de esa comprobación (el `python3` del Paso 0); (2) esperar a que pase su intervalo (300 s para `host-actualizaciones`) **solo si el temporizador original deja ≥ 90 s** (no se re-arma: si no alcanza, reversión manual segura o automática y F7 desde una activación nueva); (3) en la **misma** sesión de PowerShell (las funciones del script siguen definidas) ejecutar `$r = Gate 'solicitar host-actualizaciones'; $r.Rc; ($r.Out | ConvertFrom-Json).check`, que debe dar `0` y `host-actualizaciones`; (4) solo entonces escribir `V_OMISIONES=RESUELTAS` en la consola (`NINGUNA` si no hubo pendientes). Sin eso la puerta de cancelación permanece **cerrada**.
**Cómo se acota el tiempo.** Cada llamada a `ssh` se ejecuta como proceso propio con `ConnectTimeout=10` **y** un límite total (25 s; 15 s para `-W`, `-tt` y la contraseña): si lo excede se **termina el árbol de procesos** (`taskkill /T /F`) y la prueba cuenta como **fallo no concluyente (TIMEOUT)**. La entrada se cierra al arrancar y se añade `-n` (salvo en `-W`), por lo que no hay lecturas pendientes de la entrada estándar; esto **sustituye a `$null | & ssh`**, que en PowerShell 5.1 deja la entrada del proceso abierta hasta terminar la tubería. Al final se comprueba y se informa de cuántos procesos `ssh` quedaban abiertos (debe ser 0). Se evita además la redirección `2>` de PowerShell 5.1, que envuelve la salida de error del programa en registros de error.
**Cómo se distingue una denegación de seguridad de un fallo de conexión.** Ninguna prueba se da por superada por un simple `RC≠0`: V5 `-W` exige que el cliente se **autentique** (`Authenticated to`) y que el **servidor** prohíba el reenvío (`administratively prohibited` o `stdio forwarding failed`); V5 `-tt` exige sesión **autenticada** (`Authenticated to`, con `-v`), `PTY allocation request failed on channel N` y `RC=255` **sin ninguna salida** (con `-tt`, OpenSSH trata el rechazo del PTY como **fatal** y termina **antes** de ejecutar el comando: el gate nunca responde; v. hallazgo 11); V6 exige que **todas** las listas de métodos que ofrece el servidor sean exactamente `publickey` (esa línea solo aparece si hubo conexión). Un `RC=255` se etiqueta como `AUTENTICACION` (clave no cargada o rechazada) o `RED/CONEXION`, y en V1 corta el script de inmediato (**no concluyente**).
**Control del vencimiento REAL de la reversión.** El script exige `$VenceUtc` (de la consola, solo si esta dijo `VENCIMIENTO_VERIFICADO`), comprueba que corresponde a **esta** tanda (entre 0 y 660 s), imprime el tiempo restante antes de cada grupo y **comprueba de nuevo en cada llamada a `ssh` y en cada espera —también dentro de los bucles de V4 y V8—** que queden al menos 90 s; si no, **se detiene**. La consola obtiene el vencimiento con `systemctl show tai-reversion.timer` (`ActiveEnterTimestamp` + 600 s) y lo **contrasta** con la hora calculada antes de armar (no depende de `list-timers`); toma la **menor**; la puerta de cancelación exige el temporizador `active`/`waiting`, el vencimiento **verificable** y ≥ 90 s.
**Hallazgos de la revisión de seguridad del script (14/11/2026) y su corrección:**
| # | Hallazgo | Naturaleza | Corrección |
|---|---|---|---|
| 1 | `V1_V8_OK` se emitía con pruebas omitidas; no distinguía obligatorias, condicionadas y manuales | **Error confirmado** (por lectura del código) | Tres resultados; las pendientes se nombran; nunca éxito definitivo |
| 2 | `Tiempo` medía desde el arranque del script, no el vencimiento del temporizador | **Error confirmado** | `$VenceUtc` obligatorio, comprobación en **cada** llamada a `ssh` y espera (margen de 90 s) y vencimiento de la consola leído de `systemctl show` y contrastado |
| 3 | `ConnectTimeout` no limita toda la sesión (`-W`, `-tt`, sesión sin orden podían colgarse); `$null \| & ssh` mantiene la entrada abierta | **Riesgo confirmado por documentación de OpenSSH/PowerShell; no medido en el `ssh.exe` real** | Proceso con límite total, entrada cerrada, `-n`, terminación del árbol; probado con un `ssh` que se cuelga (terminado en 4 s, 0 procesos) |
| 4 | V5 `-W` pasaba con cualquier `RC≠0` (un error de red contaba como «denegado»); V5 `-tt` no comprobaba que el gate respondiera | **Error confirmado** | Evidencia del servidor exigida (ver arriba); probado con red caída y reset |
| 5 | V6 aceptaba `RC≠0` con una sola coincidencia de la línea de métodos | Riesgo menor (el texto solo aparece con conexión) | Todas las listas ofrecidas deben ser exactamente `publickey`; probado con `publickey,password` y con rechazo de conexión |
| 6 | V7 era opcional y se omitía sin dominio; no fijaba TLS 1.2 | **Error confirmado** (V7 omitible); TLS: riesgo en PowerShell 5.1 | Obligatoria, valores fijos, `-ceq` exacto, TLS 1.2 explícito; probado con estado, hash distinto y hash en mayúsculas |
| 7 | La clave se aceptaba «la que muestre `ssh -G`» | **Contradicción del plan con la decisión del propietario** | V0 exige exactamente `tai-inspect_ed25519`, una sola clave, `identitiesonly yes`, sin `id_ed25519_tai_inspect`, y la huella cargada en el agente |
| 8 | La reversión manual detenía el temporizador **antes** de saber si `revertir.sh` terminó bien | **Error confirmado** (texto del plan) | Se ejecuta primero y el temporizador solo se detiene con `rc=0` |
| 9 | La cancelación no estaba condicionada a nada comprobable | **Error confirmado** | Puerta de cancelación en la consola (Paso 5) |
| 10 | Variables de confirmación de una tanda anterior podrían quedar en la sesión | Riesgo potencial | `unset` al empezar y al terminar |
| 11 | V5 `-tt` exigía `RC=2` y `orden no permitida` del gate; en la ejecución real de F7 (14/11/2026) dio `RC=255` solo con `PTY allocation request failed on channel 0` y se marcó `FALLA` | **Falso negativo confirmado** (defecto de la prueba, no del servidor): `client_status_confirm` de OpenSSH convierte el fallo de PTY en `fatal()` con `-t`/`-tt`, antes del `exec` | Se exige lo que sí demuestra el rechazo del servidor: `-v`, `Authenticated to`, el mensaje con `channel N`, `RC=255` y salida vacía; un error de red, de autenticación o una sesión que llegue a ejecutar algo siguen dando `FALLA` |
**Cómo se ha comprobado (14/11/2026, solo en local):** análisis de sintaxis de PowerShell sin errores, 0 caracteres no ASCII, y ejecución en Windows PowerShell 5.1 contra un **`ssh` simulado que es un proceso real** (reloj virtual y limitador de 30/300 s) en **31 escenarios**: el caso normal da 20 correctas y `AUTOMATICAS_OK`; se **detectan** como `V_FALLA` la red caída, la clave rechazada, V6 y V5 con error de red, el reenvío permitido, el PTY concedido, el limitador roto, una comprobación sensible abierta, un shell ante una orden hostil o sin orden, la contraseña ofrecida, un JSON roto, `/api/health` caído, con otro estado, con otro hash o con el hash en mayúsculas, la identidad antigua, la falta de `identitiesonly`, el agente vacío, la huella antigua `tUYYG5…`, `/api/health` sin `sourceHash`, `$SourceHashEsperado` vacío y un `$VenceUtc` ausente, obsoleto o inminente (incluida la **parada por tiempo dentro del bucle de V4**); un `-W` colgado se **termina por tiempo** y no queda ningún proceso; el estado previo del limitador provoca el reintento y `host-actualizaciones` reciente da `V_INCOMPLETO`. **Límite:** no se ha ejecutado contra el `ssh.exe` real ni contra el VPS; los textos reales de `-tt`/`-W` y el formato de `ActiveEnterTimestamp`/`SubState` de `tai-reversion.timer` se verán por primera vez en F7 (el Paso 0 comprueba el formato sobre temporizadores ya existentes y el Paso 2 contrasta dos fuentes).
**Criterio:** cualquier resultado distinto de lo esperado = **parar y revertir**; no se «arregla sobre la marcha».

## 9. Recuperación y reversión (no dependen de ninguna sesión SSH existente)
**Vía de recuperación = consola web de Hostinger (root), ensayada en F0**, más el temporizador de seguridad de F7. Si la consola no está disponible **no se empieza**.
### 9.1 Mecanismo de reversión (resumen)
| Pregunta | Respuesta |
|---|---|
| **Qué ejecuta** | `/bin/sh /root/tai-etapa2/revertir.sh` (root, 0700; su huella se anota en F0 y se vuelve a mostrar en F7). Retira **únicamente** `/etc/ssh/sshd_config.d/00-tai-inspect.conf`, comprueba `sshd -t` y, solo si pasa y `ssh` está activo, hace `systemctl reload ssh`. Registra en `/root/tai-etapa2/reversion.log` y en el journal (`tai-reversion`) |
| **Cómo se activa** | `systemd-run --unit=tai-reversion --on-active=10min --timer-property=AccuracySec=1s …` (temporizador **transitorio**; el nombre fijo impide armarlo dos veces) en F7, **después** de validar el árbol real y **antes** de recargar; se comprueba `REVERSION_PRECISA` antes de recargar (sin esa comprobación el disparo podría retrasarse hasta 1 min) |
| **Cómo se cancela** | `systemctl stop tai-reversion.timer` tras comprobar V1–V8; se verifica que no queda ningún temporizador ni servicio activo. **No se re-arma** durante una activación: el temporizador original de 10 min se mantiene hasta la cancelación o la reversión |
| **Cómo evita revertir cambios ajenos** | (1) solo toca **su** archivo; (2) lo borra **solo si su SHA-256 es el de la plantilla instalada** (`rc=3` y no lo borra si alguien lo modificó o sustituyó); (3) no restaura ni edita `sshd_config`, otros archivos de `sshd_config.d`, claves de root ni `authorized_keys` de nadie; (4) si tras retirarlo `sshd -t` falla (otro cambio ajeno roto) **no recarga**; (5) es **idempotente**: si el archivo ya no existe, no hace nada destructivo |
| **Qué pasa si no se cancela** | Se vuelve al estado **anterior** (sin el acceso restringido): es el sentido seguro; basta repetir F7 |
| **Límites** | Es transitorio: un **reinicio** del servidor durante la ventana lo elimina (no reinicia nadie en la ventana; `sshd -t` ya validó la configuración); no deshace el usuario ni los archivos de `/opt` (inertes); no sustituye al snapshot |
| **Cómo se ensaya** | En F0, con el **mismo script** y rutas de prueba: retira lo suyo, respeta lo ajeno (`rc=3`) y el temporizador dispara y se cancela. Además, `tests/test_plan_etapa2.py` ejecuta el script del documento en 8 escenarios |

### 9.2 Niveles de reversión
| Nivel | Cuándo | Acciones (consola web, como root) |
|---|---|---|
| **R0** | Cualquier fallo en F0–F6 | Nada que revertir en SSH. Detener la instancia de prueba si sigue (`kill "$(cat /root/tai-etapa2/sshd-prueba.pid)"`); `: > /etc/ssh/authorized_keys.tai-inspect`; borrar `/root/tai-etapa2/clave-prueba*`. El `sshd` en uso **nunca fue modificado** |
| **R1** | Fallo en F7 o tras recargar | **Automática:** al vencer el temporizador `tai-reversion` se ejecuta `revertir.sh`. **Manual (inmediata, idempotente):** el bloque «Reversión manual segura» de F7 (ejecuta `revertir.sh` y detiene el temporizador **solo si** terminó con `rc=0`; con `rc≠0` conserva la protección automática y se comunica). Si `rc=3`, el archivo fue cambiado por otra persona y **no** se borra: se decide a mano. Después comprobar `sshd -T -C user=root,host=localhost,addr=127.0.0.1 | sort | diff - /root/tai-etapa2/r-root.txt` (vacío). Si hiciera falta recuperar la configuración original: `cp -a /root/tai-etapa2/sshd_config.orig /etc/ssh/sshd_config` y repetir `sshd -t` y `reload` |
| **R2** | Retirar el colector (F9) | `systemctl disable --now tai-collector.path tai-collector.timer; rm -f /etc/systemd/system/tai-collector.service /etc/systemd/system/tai-collector.path /etc/systemd/system/tai-collector.timer; systemctl daemon-reload`; volver `enabled.json` a las 5 comprobaciones del host y `tai-manifest` |
| **R3** | Desinstalación completa | R1 + R2, y `userdel tai-inspect; groupdel tai-inspect; rm -rf /opt/tai-inspect /etc/tai-inspect /var/lib/tai-inspect /etc/ssh/authorized_keys.tai-inspect`. **Los registros NO se borran:** `mv /var/log/tai-inspect /root/tai-evidencia-AAAAMMDD` |
| **R4** | Último recurso | Restaurar el **snapshot** de Hostinger (G3). **Su restauración no se ha ensayado** y revertiría también cualquier cambio de producción posterior (despliegues, datos): solo si R1–R3 no bastan |
Tras revertir se verifica `INVARIANTES_IGUALES` y se anota la causa. **Siempre intactos:** `/root/.ssh/authorized_keys`, `/etc/ssh/sshd_config`, firewall, Docker, n8n, EasyPanel y despliegues.

## 10. Puntos de control con el asistente
| CP | Después de | El propietario devuelve | El asistente contrasta |
|---|---|---|---|
| CP1 | F1 | Salida de F1 e invariantes | Versión 9.6p1, PAM, Bloque A |
| CP2 | F2 | `TAR_VERIFICADO` y comprobaciones de la extracción | Huellas del paquete |
| CP3 | F4 | Salida de la prueba local del gate | Códigos de salida y registro |
| CP4 | F6 | Salida completa de la instancia de prueba | Ausencia de errores de PAM; ruta de la clave |
| CP5 | F7 | Resultado de V1–V8 e invariantes | Reglas de root intactas |
| CP6 | F9 | V9–V15 | Colector y anclas |

## 11. Qué NO incluye
Comprobaciones sensibles (Docker, PostgreSQL, registros, SSH) · `validaciones.json` · rotación implementada · **`chattr +a` en el VPS (autorización específica y archivo temporal, etapa aparte)** · endurecimiento del SSH de root, contraseña, `fail2ban` o reenvíos (propuesta aparte) · cambios de firewall · retirada o sustitución de la clave de root · etapas 3 a 7 · uso de los informes por agentes.

## 12. Siguiente paso
El propietario confirma este plan y, cuando lo decida, autoriza **expresamente** la ventana (G2). El asistente entonces genera en local `treidilor-inspeccion.tar`, `SHA256SUMS-CODIGO.txt` y la huella del TAR con el procedimiento determinista del paquete (sin pruebas, sin archivos ocultos) y la entrega por otro canal. **No se ejecuta nada antes.**
