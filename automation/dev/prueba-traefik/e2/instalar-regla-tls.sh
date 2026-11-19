#!/usr/bin/env bash
# E2 (corregida, 17/11/2026): instala el candidato `tai-bloqueo-lector-tls.yaml` en el directorio dinámico de Traefik, lo VALIDA desde el propio VPS y, si algo falla, lo RETIRA solo.
# NO SE HA EJECUTADO NUNCA: requiere autorización expresa del propietario para E2. No modifica main.yaml, no reinicia nada, no crea temporizadores ni procesos persistentes.
# Solo hace de PUERTA INMEDIATA (¿se cargó y bloquea desde dentro?). NO sustituye a las pruebas EXTERIORES independientes de E3, que se hacen desde el PC.
#
# Uso (como root, en la consola web de Hostinger):  bash instalar-regla-tls.sh /ruta/al/tai-bloqueo-lector-tls.yaml
# Variables opcionales: HOST_N8N (por defecto el host público documentado)
#
# Qué comprueba, por este orden, y PARA ANTES DE TOCAR NADA si algo no cuadra:
#   1 · root, un único servicio easypanel-traefik 3.6.7 con 1 réplica, main.yaml con su SHA-256/tamaño/propietario de referencia y el directorio root:root 755
#   2 · NO existe ningún archivo de bloqueo previo (custom.yaml, el candidato ni *.tmp) y el archivo de origen tiene el SHA-256 y el tamaño del candidato
# Qué hace: copia a `.tmp` (extensión que el proveedor de archivos ignora), verifica el hash de la copia y la publica con `mv -T` (atómico). Después valida desde el VPS con curl --resolve (TLS REAL):
#   https lector → 403 `Forbidden` · http lector → 403 (router) o 308 (redirección del entrypoint: se registra cuál) · https público ficticio → 404 de n8n · https /healthz → 200
# Si cualquier paso falla (o se interrumpe con Ctrl-C), el `trap` retira el archivo (mv a .retirado-<hora>), comprueba main.yaml y sale con error.
set -u
[ -n "${BASH_VERSION:-}" ] && set -o pipefail

NOMBRE='tai-bloqueo-lector-tls.yaml'
DIR='/etc/easypanel/traefik/config'
SERVICIO='easypanel-traefik'
HASH_CANDIDATO='75703a2ca62f4793203952e4fb4f7729acf23526eb4e8a62a2592a4c96e81746'
BYTES_CANDIDATO='1305'
HASH_MAIN='5a0113d86b3af7fd66afa027d59adb5d714a74c70fa346209f2374db307ab267'
HOST="${HOST_N8N:-practice-project-n8n-n8n.b3cnxu.easypanel.host}"
ORIGEN="${1:-}"
FINAL="$DIR/$NOMBRE"
TMP="$DIR/$NOMBRE.tmp"
INSTALADO=0
CREADO_TMP=0
OK=0

fallo() { echo "E2_PARAR: $1"; exit 1; }
retirar() {
  # Solo retira lo que ESTA ejecución creó. Nunca toca main.yaml ni archivos ajenos.
  local marca; marca=$(date -u +%Y%m%dT%H%M%SZ)
  if [ "$CREADO_TMP" = 1 ] && [ -e "$TMP" ]; then rm -f -- "$TMP"; fi
  if [ "$INSTALADO" = 1 ] && [ -e "$FINAL" ]; then
    if mv -f -- "$FINAL" "$FINAL.retirado-$marca"; then echo "E2_RETIRADA: $NOMBRE -> $NOMBRE.retirado-$marca"; else echo "E2_ALERTA_RETIRADA_FALLIDA: retira a mano con retirar-regla-tls.sh"; fi
  fi
  local h; h=$(sha256sum "$DIR/main.yaml" 2>/dev/null) || h='?'
  echo "E2_MAIN_SHA256_TRAS_RETIRAR=${h%% *} (referencia $HASH_MAIN)"
}
al_salir() {
  local c=$?
  if [ "$OK" != 1 ]; then
    if [ "$INSTALADO" = 1 ] || [ "$CREADO_TMP" = 1 ]; then echo "E2_FALLIDA (código $c): se retira el candidato."; else echo "E2_FALLIDA (código $c) ANTES de escribir nada: no hay nada que retirar."; fi
    retirar
  fi
}
trap al_salir EXIT
trap 'echo "E2_INTERRUMPIDA"; exit 130' INT TERM HUP

# ── 1 · Puerta previa (solo lectura) ──
[ "$(id -u)" = 0 ] || fallo "hay que ejecutarlo como root"
for UTIL in docker curl sha256sum stat seq mktemp head tr cp mv chown chmod date grep ls id sleep; do command -v "$UTIL" > /dev/null 2>&1 || fallo "falta la utilidad «$UTIL» en el VPS"; done
[ -n "$ORIGEN" ] && [ -f "$ORIGEN" ] || fallo "indica el archivo de origen: bash $0 /ruta/$NOMBRE"
SVC=$(docker service ls --filter "name=$SERVICIO" --format '{{.Name}}|{{.Image}}|{{.Replicas}}') || fallo "docker service ls falló"
[ "$SVC" = "$SERVICIO|traefik:3.6.7|1/1" ] || fallo "servicio/imagen/réplicas inesperados: $SVC"
SHA=$(sha256sum "$DIR/main.yaml") || fallo "sha256sum de main.yaml falló"
[ "${SHA%% *}" = "$HASH_MAIN" ] || fallo "SHA-256 de main.yaml distinto del de referencia"
ST=$(stat -c '%U:%G %a %s' "$DIR/main.yaml") || fallo "stat de main.yaml falló"
[ "$ST" = "root:root 644 8033" ] || fallo "propietario/modo/tamaño de main.yaml distintos: $ST"
SD=$(stat -c '%U:%G %a' "$DIR") || fallo "stat del directorio falló"
[ "$SD" = "root:root 755" ] || fallo "directorio distinto: $SD"
LS=$(ls -A "$DIR") || fallo "ls -A del directorio falló"
printf '%s\n' "$LS" | grep -Eqi '^(custom|tai-bloqueo)[^ ]*\.(ya?ml|toml)$|\.tmp$'; R=$?
[ "$R" = 1 ] || fallo "ya hay un archivo de bloqueo ACTIVO (custom*.yaml, tai-bloqueo*.yaml) o un .tmp, o el grep falló (rc=$R); los *.retirado* no cuentan"
HO=$(sha256sum "$ORIGEN") || fallo "sha256sum del origen falló"
[ "${HO%% *}" = "$HASH_CANDIDATO" ] || fallo "el archivo de origen no tiene el SHA-256 del candidato"
BO=$(stat -c '%s' "$ORIGEN") || fallo "stat del origen falló"
[ "$BO" = "$BYTES_CANDIDATO" ] || fallo "el archivo de origen no tiene $BYTES_CANDIDATO bytes ($BO)"
CID=$(docker ps -q --filter "name=$SERVICIO") || fallo "docker ps falló"
[ "$(printf '%s\n' "$CID" | grep -c .)" = 1 ] || fallo "no hay exactamente un contenedor de $SERVICIO"
echo "E2_DIRECTORIO_ANTES (ls -A):"; printf '%s\n' "$LS"
echo "E2_PUERTA_PREVIA_OK contenedor=$CID"

# ── 2 · Instalación atómica ──
CREADO_TMP=1
cp -- "$ORIGEN" "$TMP" || fallo "cp a .tmp falló"
chown root:root "$TMP" && chmod 644 "$TMP" || fallo "chown/chmod de la copia falló"
HT=$(sha256sum "$TMP") || fallo "sha256sum de la copia falló"
[ "${HT%% *}" = "$HASH_CANDIDATO" ] || fallo "la copia no conserva el hash del candidato"
INSTALADO=1
mv -T -- "$TMP" "$FINAL" || fallo "mv atómico falló"
echo "E2_INSTALADA hora_utc=$(date -u +%FT%TZ)"

# ── 3 · El contenedor ve el archivo con el mismo hash (aviso si docker exec no es posible; las sondas decidirán) ──
VISTO=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  H=$(docker exec "$CID" sha256sum "/data/config/$NOMBRE" 2>/dev/null) && [ "${H%% *}" = "$HASH_CANDIDATO" ] && { VISTO=1; break; }
  sleep 1
done
[ "$VISTO" = 1 ] && echo "E2_VISIBLE_EN_CONTENEDOR=si" || echo "E2_VISIBLE_EN_CONTENEDOR=no_comprobado (las sondas decidirán)"

# ── 4 · Validación INMEDIATA desde el VPS (TLS real con SNI = host; --resolve evita salir a Internet). Sondeo hasta 30 s: la recarga del proveedor de archivos tarda unos segundos ──
TOK=$(date +%s)
sonda() {  # sonda <esquema> <metodo> <ruta>  → imprime "estado|cuerpo(primeros 80 car.)"
  local esq="$1" met="$2" ruta="$3" puerto=443; [ "$esq" = http ] && puerto=80
  local f; f=$(mktemp) || return 1
  local w; w=$(curl -s --path-as-is --max-redirs 0 --connect-timeout 5 --max-time 15 --resolve "$HOST:$puerto:127.0.0.1" -X "$met" -o "$f" -w '%{http_code}' "$esq://$HOST$ruta?tai=e2$TOK") || { rm -f "$f"; echo "000|curl_fallo"; return 0; }
  local c; c=$(head -c 240 "$f" | tr '\r\n' '  '); rm -f "$f"; echo "$w|$c"
}
BLOQ=0
for i in $(seq 1 15); do
  S=$(sonda https POST "/webhook/tai-lector-prod-e2$TOK")
  case "$S" in 403\|Forbidden*) BLOQ=1; break ;; esac
  sleep 2
done
echo "E2_SONDA_HTTPS_LECTOR=$S"
[ "$BLOQ" = 1 ] || fallo "el candidato no bloquea por https tras 30 s (respuesta: $S)"
for k in 1 2 3; do S2=$(sonda https POST "/webhook/tai-lector-prod-e2$TOK"); case "$S2" in 403\|Forbidden*) ;; *) fallo "bloqueo https inestable (intento $k: $S2)" ;; esac; done
SH=$(sonda http POST "/webhook/tai-lector-prod-e2$TOK"); echo "E2_SONDA_HTTP_LECTOR=$SH"
case "$SH" in 403\|*) echo "E2_HTTP=bloqueado_por_router" ;; 308\|*|301\|*) echo "E2_HTTP=redirigido_(se_bloquea_tras_seguir_a_https)" ;; *) fallo "http lector con respuesta inesperada: $SH" ;; esac
SP=$(sonda https POST "/webhook/tai-publico-e2$TOK"); echo "E2_SONDA_PUBLICO_FICTICIO=$SP"
case "$SP" in 404\|*not\ registered*) ;; *) fallo "el webhook público ficticio no responde el 404 JSON de n8n («not registered»): $SP" ;; esac
SZ=$(sonda https GET "/healthz"); echo "E2_SONDA_HEALTHZ=$SZ"
case "$SZ" in 200\|*) ;; *) fallo "healthz no responde 200: $SZ" ;; esac

# ── 5 · main.yaml intacto y servicio sin cambios ──
SHA2=$(sha256sum "$DIR/main.yaml") || fallo "sha256sum de main.yaml falló"
[ "${SHA2%% *}" = "$HASH_MAIN" ] || fallo "main.yaml cambió durante la instalación"
SVC2=$(docker service ls --filter "name=$SERVICIO" --format '{{.Name}}|{{.Image}}|{{.Replicas}}') || fallo "docker service ls falló"
[ "$SVC2" = "$SERVICIO|traefik:3.6.7|1/1" ] || fallo "el servicio cambió: $SVC2"
OK=1
echo "E2_VALIDACION_INMEDIATA_OK  candidato=$HASH_CANDIDATO  main=${SHA2%% *}"
echo "SIGUIENTE: pruebas EXTERIORES independientes (E3) desde el PC. Si algo falla después: bash retirar-regla-tls.sh"
