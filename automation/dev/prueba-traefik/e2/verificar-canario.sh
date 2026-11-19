#!/usr/bin/env bash
# E3 · VERIFICACIÓN DEL CANARIO desde el VPS (consola de Hostinger, root). NO importa, NO activa, NO desactiva y NO modifica nada de n8n ni de Traefik: solo LEE el contador de ejecuciones del canario
# (consulta SELECT de solo lectura a la base de n8n) y hace UNA petición interna autorizada. Para el contador de ejecuciones el canario debe GUARDAR sus ejecuciones (el workflow del repositorio ya lo hace).
#
# Secuencia (una sola operación manual entre las dos fases: la sonda exterior del PC):
#   1) una vez:   bash verificar-canario.sh token          (pide el valor de la credencial desechable SIN mostrarlo y lo guarda en /root/tai-secretos/canario.token, modo 600)
#   2) fase 1:    bash verificar-canario.sh antes           (contador inicial → prueba POSITIVA interna con credencial: 200 {"canario":true} y +1 ejecución → prueba interna SIN credencial: 403 y +0)
#   3) en el PC:  node scripts/automation/sonda-exterior-e3.mjs --host <dominio-n8n> --salida <carpeta> --cred-file <canario.token>     (imprime el prefijo)
#   4) fase 2:    bash verificar-canario.sh despues <prefijo>  (el contador NO ha cambiado por la sonda exterior; el id de la prueba interna NO figura en Traefik; sin fugas)
# Veredicto final: E3_CANARIO_OK (código 0) | E3_CANARIO_FUGA (2) | E3_CANARIO_FALLA (1) | E3_CANARIO_NO_COMPROBABLE (3: no se pudo leer el contador; usa Executions de la interfaz de n8n)
set -u
[ -n "${BASH_VERSION:-}" ] && set -o pipefail
FASE="${1:-}"; PREFIJO="${2:-}"
DIR_SECRETOS="${TAI_E3_DIR_SECRETOS:-/root/tai-secretos}"; ARCHIVO_TOKEN="$DIR_SECRETOS/canario.token"; DIR_ESTADO="${TAI_E3_DIR_ESTADO:-/root/tai-e3}"; ESTADO="$DIR_ESTADO/canario-estado.env"
RUTA='tai-lector-prod-canario'; CABECERA='x-treidilor-canario'
fallo() { echo "E3_CANARIO_FALLA: $1"; exit 1; }
[ "$(id -u)" = 0 ] || fallo "hay que ejecutarlo como root"
for U in docker grep sed head tr date mktemp chmod; do command -v "$U" > /dev/null 2>&1 || fallo "falta la utilidad «$U»"; done

if [ "$FASE" = token ]; then
  mkdir -p "$DIR_SECRETOS" && chmod 700 "$DIR_SECRETOS" || fallo "no se pudo crear $DIR_SECRETOS"
  [ ! -e "$ARCHIVO_TOKEN" ] || fallo "ya existe $ARCHIVO_TOKEN (bórralo antes si quieres cambiarlo)"
  printf 'Valor de la credencial DESECHABLE del canario (no se muestra): '; read -rs V; echo
  [ "${#V}" -ge 32 ] && [ "${#V}" -le 128 ] || fallo "el valor debe tener entre 32 y 128 caracteres"
  case "$V" in *[!A-Za-z0-9_.-]*) fallo "solo se admiten letras, cifras, «_», «.» y «-»" ;; esac
  ( umask 077; printf '%s' "$V" > "$ARCHIVO_TOKEN" ) || fallo "no se pudo guardar"
  echo "E3_TOKEN_GUARDADO ($ARCHIVO_TOKEN, modo 600, ${#V} caracteres)"; exit 0
fi
case "$FASE" in antes|despues) ;; *) fallo "uso: bash $0 token | antes | despues <prefijo>" ;; esac
[ -r "$ARCHIVO_TOKEN" ] || fallo "falta $ARCHIVO_TOKEN (ejecuta primero: bash $0 token)"
mkdir -p "$DIR_ESTADO" && chmod 700 "$DIR_ESTADO"

# ── descubrimiento (solo lectura): exactamente UN contenedor de n8n (no los runners) y UNO de PostgreSQL ──
N8N=$(docker ps --format '{{.ID}} {{.Image}}' | grep -E ' (docker\.n8n\.io/)?n8nio/n8n(:|$)' | cut -d' ' -f1)
[ "$(printf '%s\n' "$N8N" | grep -c .)" = 1 ] || fallo "no hay exactamente un contenedor de n8n (encontrados: $(printf '%s' "$N8N" | tr '\n' ' '))"
PG=$(docker ps --format '{{.ID}} {{.Image}}' | grep -E ' postgres:' | cut -d' ' -f1)
if [ "$(printf '%s\n' "$PG" | grep -c .)" != 1 ]; then PG=''; fi

sql() {  # sql "<consulta de solo lectura>"  → imprime el resultado; vacío si no se pudo
  [ -n "$PG" ] || return 1
  docker exec "$PG" sh -c 'for B in $(psql -U "${POSTGRES_USER:-postgres}" -d postgres -Atc "select datname from pg_database where not datistemplate" 2>/dev/null); do R=$(psql -U "${POSTGRES_USER:-postgres}" -d "$B" -Atc "$1" 2>/dev/null) && [ -n "$R" ] && { echo "$R"; break; }; done' sh "$1" 2>/dev/null
}
# solo SELECT: las dos consultas están fijadas aquí; no se compone ninguna con datos externos
ID_WF=$(sql "select id from workflow_entity where name like '%Canario de aislamiento%'" | head -n 1)
[ -n "$ID_WF" ] || { echo "E3_CANARIO_NO_COMPROBABLE: no se pudo localizar el workflow del canario en la base de n8n (¿importado? ¿PostgreSQL accesible?). Usa Executions de la interfaz de n8n."; exit 3; }
case "$ID_WF" in *[!A-Za-z0-9_-]*) fallo "identificador de workflow inesperado" ;; esac
contar() { sql "select count(*) from execution_entity where \"workflowId\" = '$ID_WF'" | head -n 1; }
peticion() {  # peticion <con|sin> <id> → "estado|cuerpo"; la credencial viaja por stdin (nunca en la línea de órdenes ni en el entorno visible)
  local modo="$1" id="$2"
  { [ "$modo" = con ] && cat "$ARCHIVO_TOKEN" || true; } | docker exec -i "$N8N" node -e "
let t='';process.stdin.on('data',c=>t+=c).on('end',async()=>{try{const h={'content-type':'application/json'};if(t.trim())h['$CABECERA']=t.trim();
const r=await fetch('http://127.0.0.1:5678/webhook/$RUTA?tai=$id',{method:'POST',headers:h,body:'{\"sonda\":\"interior\"}',redirect:'error'});
console.log(r.status+'|'+(await r.text()).slice(0,80).replace(/\s+/g,' '))}catch(e){console.log('000|'+(e.code||e.message))}})" 2>/dev/null | head -n 1
}
esperar_cuenta() {  # esperar_cuenta <esperado> → imprime la cuenta final tras hasta 15 s
  local c=''; for _ in $(seq 1 15); do c=$(contar); [ "$c" = "$1" ] && break; sleep 1; done; echo "$c"
}

if [ "$FASE" = antes ]; then
  N0=$(contar); case "$N0" in ''|*[!0-9]*) echo "E3_CANARIO_NO_COMPROBABLE: no se pudo leer el contador de ejecuciones"; exit 3 ;; esac
  ID="int$(date +%s)"
  echo "E3_WORKFLOW_CANARIO=$ID_WF  E3_EJECUCIONES_ANTES=$N0"
  P=$(peticion con "$ID"); echo "E3_INTERIOR_CON_CREDENCIAL=$P"
  case "$P" in 200\|*'"canario":true'*) ;; 404\|*) fallo "404: el canario NO está publicado (activo): la prueba de «0 ejecuciones» no valdría" ;; *) fallo "el canario no respondió 200 {\"canario\":true} por la red interna: $P" ;; esac
  N1=$(esperar_cuenta $((N0 + 1))); echo "E3_EJECUCIONES_TRAS_POSITIVA=$N1"
  [ "$N1" = $((N0 + 1)) ] || fallo "la prueba positiva no generó exactamente 1 ejecución visible (antes $N0, ahora $N1): ¿el canario guarda sus ejecuciones?"
  S=$(peticion sin "ints$(date +%s)"); echo "E3_INTERIOR_SIN_CREDENCIAL=$S"
  case "$S" in 403\|*) ;; *) fallo "sin credencial se esperaba 403 de n8n: $S" ;; esac
  sleep 2; N2=$(contar); [ "$N2" = "$N1" ] || fallo "la petición sin credencial generó una ejecución ($N1 → $N2)"
  printf 'WF=%s\nN_BASE=%s\nID_INTERIOR=%s\nHORA=%s\n' "$ID_WF" "$N1" "$ID" "$(date -u +%FT%TZ)" > "$ESTADO"; chmod 600 "$ESTADO"
  echo "E3_FASE1_OK  base=$N1  SIGUIENTE: en el PC, la sonda exterior con --cred-file; luego: bash $0 despues <prefijo>"; exit 0
fi

# fase 2
case "$PREFIJO" in e3[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]) ;; *) fallo "indica el prefijo que imprimió la sonda exterior" ;; esac
[ -r "$ESTADO" ] || fallo "no hay estado de la fase 1 ($ESTADO): ejecuta antes «bash $0 antes»"
WF0=$(grep '^WF=' "$ESTADO" | cut -d= -f2); NB=$(grep '^N_BASE=' "$ESTADO" | cut -d= -f2); IDI=$(grep '^ID_INTERIOR=' "$ESTADO" | cut -d= -f2)
[ "$WF0" = "$ID_WF" ] || fallo "el workflow del canario cambió desde la fase 1"
sleep 3; NF=$(contar); echo "E3_EJECUCIONES_BASE=$NB  E3_EJECUCIONES_AHORA=$NF"
case "$NF" in ''|*[!0-9]*) echo "E3_CANARIO_NO_COMPROBABLE: no se pudo leer el contador"; exit 3 ;; esac
if [ "$NF" != "$NB" ]; then echo "E3_CANARIO_FUGA: el canario se ejecutó $((NF - NB)) vez/veces tras la sonda exterior (esperado 0). DESACTÍVALO YA en n8n e informa."; exit 2; fi
TMP=$(mktemp) || exit 1; trap 'rm -f "$TMP"' EXIT
docker service logs --no-task-ids --since 3h easypanel-traefik > "$TMP" 2>&1 || true
NP=$(grep -cF "tai=$PREFIJO-" "$TMP"); NI=$(grep -cF "tai=$IDI" "$TMP")
echo "E3_TRAEFIK_LINEAS_SONDA_EXTERIOR=$NP  E3_TRAEFIK_LINEAS_PRUEBA_INTERIOR=$NI"
[ "$NI" = 0 ] || fallo "la prueba interior figura en el registro de Traefik: no iba por la red interna"
if [ "$NP" = 0 ]; then echo "E3_AVISO: el registro de Traefik no muestra la sonda exterior (registro inactivo o con retraso); la evidencia es el contador y la respuesta de la sonda."; fi
echo "E3_CANARIO_OK  ejecuciones: base $NB, tras la sonda exterior $NF (0 adicionales); la positiva interna sí se ejecutó."
echo "SIGUIENTE: desactivar y borrar el canario y su credencial en n8n (E5); borrar $ARCHIVO_TOKEN y $ESTADO."
