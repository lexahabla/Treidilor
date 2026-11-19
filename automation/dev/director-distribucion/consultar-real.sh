#!/usr/bin/env bash
# DIRECTOR 00 · CONSULTA REAL de los informes de los agentes 04 y 12 (solo lectura). Sin puertos publicados, sin catálogo, sin L2/L4, sin proveedor de IA.
#   bash consultar-real.sh token            una vez: guarda la credencial EXCLUSIVA del lector (la pide sin mostrarla)
#   bash consultar-real.sh                  secuencia completa: informe 04, informe 12, comparaciones, verificación del ledger
#   bash consultar-real.sh informe 04       una orden concreta del Director (se añade --lector real)
# Descubre solo (solo lectura): el servicio de n8n y su red de Docker. Variables opcionales: TAI_LECTOR_RED (si n8n está en varias redes), TAI_LECTOR_HOST (nombre DNS interno de n8n).
set -u
[ -n "${BASH_VERSION:-}" ] && set -o pipefail
IMG="${TAI_DIRECTOR_IMAGEN:-treidilor-director}:actual"
DIR_SECRETOS="${TAI_DIRECTOR_SECRETOS:-/root/tai-secretos}"; ARCH_CRED="$DIR_SECRETOS/lector-prod.token"
fallo() { echo "DIRECTOR_PARAR: $1"; exit 1; }
[ "$(id -u)" = 0 ] || fallo "hay que ejecutarlo como root"
for U in docker grep head cut date; do command -v "$U" > /dev/null 2>&1 || fallo "falta la utilidad «$U»"; done

if [ "${1:-}" = token ]; then
  mkdir -p "$DIR_SECRETOS" && chmod 700 "$DIR_SECRETOS" || fallo "no se pudo crear $DIR_SECRETOS"
  [ ! -e "$ARCH_CRED" ] || fallo "ya existe $ARCH_CRED (bórralo antes si quieres cambiarlo)"
  printf 'Valor de la credencial EXCLUSIVA del lector (no se muestra): '; read -rs V; echo
  [ "${#V}" -ge 32 ] && [ "${#V}" -le 128 ] || fallo "el valor debe tener entre 32 y 128 caracteres"
  case "$V" in *[!A-Za-z0-9_.-]*) fallo "solo se admiten letras, cifras, «_», «.» y «-»" ;; esac
  # 0444 DENTRO de un directorio 0700 de root: el usuario «node» del contenedor lo lee; en el host solo root accede
  ( umask 022; printf '%s' "$V" > "$ARCH_CRED" ) && chmod 444 "$ARCH_CRED" || fallo "no se pudo guardar"
  echo "DIRECTOR_TOKEN_GUARDADO ($ARCH_CRED, ${#V} caracteres)"; exit 0
fi

[ -r "$ARCH_CRED" ] || fallo "falta $ARCH_CRED (ejecuta primero: bash $0 token)"
docker image inspect "$IMG" > /dev/null 2>&1 || fallo "no hay imagen $IMG (ejecuta instalar.sh)"
# ── descubrimiento (solo lectura): UN servicio de n8n y su red ──
SVC="${TAI_LECTOR_HOST:-}"
if [ -z "$SVC" ]; then
  L=$(docker service ls --format '{{.Name}} {{.Image}}' | grep -E ' (docker\.n8n\.io/)?n8nio/n8n(:|$)' | cut -d' ' -f1)
  [ "$(printf '%s\n' "$L" | grep -c .)" = 1 ] || fallo "no hay exactamente un servicio de n8n (encontrados: $(printf '%s' "$L" | tr '\n' ' ')); define TAI_LECTOR_HOST"
  SVC="$L"
fi
case "$SVC" in *[!a-z0-9_-]*|'') fallo "nombre de servicio no válido o con puntos («$SVC»): el Director solo admite nombres internos sin puntos" ;; esac
RED="${TAI_LECTOR_RED:-}"
if [ -z "$RED" ]; then
  REDES=$(docker service inspect "$SVC" --format '{{range .Spec.TaskTemplate.Networks}}{{.Target}} {{end}}') || fallo "no se pudo inspeccionar el servicio $SVC"
  NOMBRES=''; for R in $REDES; do N=$(docker network inspect "$R" --format '{{.Name}}' 2>/dev/null) && NOMBRES="$NOMBRES $N"; done
  NOMBRES=$(printf '%s\n' $NOMBRES | grep -vE '^(ingress|bridge|host|docker_gwbridge)$' || true)
  [ "$(printf '%s\n' "$NOMBRES" | grep -c .)" = 1 ] || fallo "no se pudo determinar UNA red de n8n (candidatas: $(printf '%s' "$NOMBRES" | tr '\n' ' ')); define TAI_LECTOR_RED"
  RED="$NOMBRES"
fi
ATT=$(docker network inspect "$RED" --format '{{.Attachable}}' 2>/dev/null) || fallo "la red «$RED» no existe"
echo "DIRECTOR_DESTINO servicio=$SVC red=$RED attachable=$ATT"
[ "$ATT" = true ] || fallo "la red «$RED» no es «attachable»: un contenedor suelto no puede unirse a ella. Usa «docker network inspect $RED» y consulta el procedimiento (alternativa: trabajo de Swarm)."

# ── ejecución: sin puertos, solo lectura, sin capacidades, un único volumen escribible (el ledger), credencial montada en solo lectura ──
ejecutar() {
  docker run --rm --network "$RED" --read-only --user node --cap-drop ALL --security-opt no-new-privileges:true --memory 256m --cpus 0.5 --tmpfs /tmp:size=16m,mode=1777 \
    -v tai_director_ledger:/var/lib/tai-director -v "$ARCH_CRED:/run/secrets/lector_prod_token:ro" \
    -e TAI_DIRECTOR_DIR=/var/lib/tai-director -e TAI_DIRECTOR_LECTOR_REAL=si -e "TAI_LECTOR_PROD_URL=http://$SVC:5678/webhook" -e "TAI_LECTOR_PROD_HOSTS=$SVC" -e TAI_LECTOR_PROD_TOKEN_FILE=/run/secrets/lector_prod_token \
    "$IMG" "$@"
}
if [ "$#" -gt 0 ]; then
  case "$1" in informe|preguntar|tarea|canal|ledger|agentes|tareas) ;; *) fallo "orden no permitida en el modo real: $1" ;; esac
  ejecutar "$@" --lector real; exit $?
fi
RC=0
for ORDEN in "informe 04" "informe 12" "informe 04 --comparar" "informe 12 --comparar"; do
  echo; echo "══ director $ORDEN ══"
  # shellcheck disable=SC2086
  ejecutar $ORDEN --lector real || RC=1
done
echo; echo "══ ledger ══"; ejecutar ledger verificar || RC=1
[ "$RC" = 0 ] && echo "DIRECTOR_CONSULTA_REAL_OK" || echo "DIRECTOR_CONSULTA_REAL_CON_ERRORES (revisa los mensajes anteriores: «origen no disponible» = el lector no respondió)"
exit $RC
