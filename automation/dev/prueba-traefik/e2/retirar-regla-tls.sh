#!/usr/bin/env bash
# E2 (corregida, 17/11/2026): REVERSIÓN MANUAL del candidato. Úsala ante cualquier incidencia posterior a la instalación. NO se ha ejecutado nunca.
# Solo renombra el archivo del candidato (no lo borra: queda como `.retirado-<hora>` para el análisis) y comprueba que main.yaml sigue intacto. No reinicia nada ni toca otros archivos.
# Uso (como root):  bash retirar-regla-tls.sh
set -u
[ -n "${BASH_VERSION:-}" ] && set -o pipefail
NOMBRE='tai-bloqueo-lector-tls.yaml'
DIR='/etc/easypanel/traefik/config'
HASH_MAIN='5a0113d86b3af7fd66afa027d59adb5d714a74c70fa346209f2374db307ab267'
HOST="${HOST_N8N:-practice-project-n8n-n8n.b3cnxu.easypanel.host}"
fallo() { echo "E2_RETIRADA_PARAR: $1"; exit 1; }
[ "$(id -u)" = 0 ] || fallo "hay que ejecutarlo como root"
MARCA=$(date -u +%Y%m%dT%H%M%SZ)
if [ -e "$DIR/$NOMBRE" ]; then mv -f -- "$DIR/$NOMBRE" "$DIR/$NOMBRE.retirado-$MARCA" || fallo "no se pudo renombrar el candidato"; echo "E2_RETIRADA $NOMBRE -> $NOMBRE.retirado-$MARCA"; else echo "E2_RETIRADA: el candidato ya no estaba instalado"; fi
[ -e "$DIR/$NOMBRE.tmp" ] && rm -f -- "$DIR/$NOMBRE.tmp" && echo "E2_RETIRADA: eliminado el .tmp sobrante"
SHA=$(sha256sum "$DIR/main.yaml") || fallo "sha256sum de main.yaml falló"
[ "${SHA%% *}" = "$HASH_MAIN" ] || fallo "main.yaml NO coincide con la referencia (${SHA%% *}): NO lo toques y avisa"
echo "E2_MAIN_INTACTO sha256=${SHA%% *}"
# Comprobación de que vuelve la línea base (puede tardar unos segundos en recargar): el lector ficticio debe dar 404 JSON de n8n
for _ in 1 2 3 4 5 6 7 8 9 10; do
  f=$(mktemp) || break
  w=$(curl -s --path-as-is --max-redirs 0 --connect-timeout 5 --max-time 15 --resolve "$HOST:443:127.0.0.1" -X POST -o "$f" -w '%{http_code}' "https://$HOST/webhook/tai-lector-prod-retirada$(date +%s)") || w=000
  c=$(head -c 240 "$f" | tr '\r\n' '  '); rm -f "$f"
  case "$w|$c" in 404\|*not\ registered*) echo "E2_LINEA_BASE_RESTAURADA estado=$w"; exit 0 ;; esac
  sleep 2
done
echo "E2_AVISO: no se vio todavía el 404 de n8n (última respuesta: $w|$c). main.yaml está intacto; repite la comprobación en unos segundos."
exit 0
