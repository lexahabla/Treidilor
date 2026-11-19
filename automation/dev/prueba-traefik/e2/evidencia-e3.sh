#!/usr/bin/env bash
# E3 · EVIDENCIA DESDE EL VPS (SOLO LECTURA; no escribe, no reinicia, no toca main.yaml ni el candidato). Se ejecuta DESPUÉS de la sonda exterior del PC, con el prefijo que ella imprimió.
# Uso (como root, consola web de Hostinger):  bash evidencia-e3.sh e3202611161830
# Comprueba: huellas (candidato y main.yaml), servicio, y la correlación del registro de acceso de Traefik con las peticiones exteriores (las IP se enmascaran).
set -u
[ -n "${BASH_VERSION:-}" ] && set -o pipefail
PREFIJO="${1:-}"
case "$PREFIJO" in e3[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]) ;; *) echo "E3_PARAR: indica el prefijo que imprimió la sonda (p. ej. e3202611161830)"; exit 1 ;; esac
DIR=/etc/easypanel/traefik/config
CAND='75703a2ca62f4793203952e4fb4f7729acf23526eb4e8a62a2592a4c96e81746'
MAIN='5a0113d86b3af7fd66afa027d59adb5d714a74c70fa346209f2374db307ab267'
echo "E3_HORA_UTC=$(date -u +%FT%TZ)"
H1=$(sha256sum "$DIR/tai-bloqueo-lector-tls.yaml" 2>/dev/null | cut -d' ' -f1); [ "$H1" = "$CAND" ] && echo "E3_CANDIDATO=intacto" || echo "E3_CANDIDATO=DISTINTO_O_AUSENTE ($H1)"
H2=$(sha256sum "$DIR/main.yaml" | cut -d' ' -f1); [ "$H2" = "$MAIN" ] && echo "E3_MAIN=intacto" || echo "E3_MAIN=CAMBIADO ($H2)"
echo "E3_DIRECTORIO:"; ls -la --time-style=full-iso "$DIR"
echo "E3_SERVICIO: $(docker service ls --filter name=easypanel-traefik --format '{{.Name}} {{.Image}} {{.Replicas}}')"
echo "E3_UPTIME_CONTENEDOR: $(docker ps --filter name=easypanel-traefik --format '{{.Status}}')"
TMP=$(mktemp) || exit 1; trap 'rm -f "$TMP"' EXIT
docker service logs --no-task-ids --since 3h easypanel-traefik 2>&1 | grep -F "tai=$PREFIJO-" | sed -E 's/^[^"]*"?[0-9a-fA-F:.]+ - [^ ]* /<ip> /; s/[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/<ip>/g' > "$TMP"
N=$(grep -c . "$TMP")
echo "E3_LINEAS_CON_EL_PREFIJO=$N"
if [ "$N" = 0 ]; then echo "E3_REGISTRO=sin_lineas (el registro de acceso puede no estar activo o con retraso: la respuesta de la sonda sigue siendo la evidencia principal)"; exit 0; fi
# Las peticiones bloqueadas NO deben aparecer con el router/servicio de n8n; los centinelas (healthz, publico-ficticio, negativos) SÍ.
BLOQ=$(grep -E 'tai-lector-prod-|%2[Ff]|%5[Cc]|WEBHOOK|webhook-(test|waiting)' "$TMP" | grep -v 'tai-publico-zz' || true)
FUGA=$(printf '%s\n' "$BLOQ" | grep -iE 'n8n' | grep -v 'tai-bloquear' || true)
echo "E3_BLOQUEADAS_EN_REGISTRO=$(printf '%s\n' "$BLOQ" | grep -c .)  E3_CON_ROUTER_DE_N8N=$(printf '%s\n' "$FUGA" | grep -c .)"
echo "E3_MUESTRA (máx. 12 líneas, IP enmascaradas):"; head -n 12 "$TMP" | cut -c1-220
if [ -n "$FUGA" ]; then echo "E3_FUGA_EN_REGISTRO: alguna petición bloqueada figura con el router de n8n; revisa y, si procede, bash retirar-regla-tls.sh NO (el candidato no se retira por esto sin decidirlo): informa."; exit 2; fi
echo "E3_REGISTRO=sin_fugas"
