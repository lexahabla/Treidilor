#!/usr/bin/env bash
# DIRECTOR 00 · INSTALAR/ACTUALIZAR en el VPS (consola de Hostinger, root). No abre puertos, no toca servicios, redes, Traefik ni n8n: solo construye una imagen local desde el TAR verificado.
# Uso:  bash instalar.sh <SHA-256 del TAR que imprimió tu PC>
# El SHA-256 que TÚ pasas es la ancla de confianza (el del repositorio no basta): si no coincide con el TAR descargado, se para ANTES de ejecutar nada. El build vuelve a comprobarlo dentro de Docker.
# Rollback: la imagen vigente (`treidilor-director:actual`) pasa a `:anterior` antes de sustituirla; `bash revertir.sh` las intercambia.
set -u
[ -n "${BASH_VERSION:-}" ] && set -o pipefail
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ESPERADO="${1:-}"
IMG="${TAI_DIRECTOR_IMAGEN:-treidilor-director}"
DIR_ESTADO="${TAI_DIRECTOR_ESTADO:-/root/tai-director-estado}"
fallo() { echo "DIRECTOR_PARAR: $1"; exit 1; }
[ "$(id -u)" = 0 ] || fallo "hay que ejecutarlo como root"
for U in docker sha256sum tar grep head tail tr date mktemp cp; do command -v "$U" > /dev/null 2>&1 || fallo "falta la utilidad «$U»"; done
case "$ESPERADO" in *[!0-9a-f]*|'') fallo "indica el SHA-256 esperado (64 hex en minúsculas): bash instalar.sh <sha256>" ;; esac
[ "${#ESPERADO}" = 64 ] || fallo "el SHA-256 debe tener 64 caracteres"
VERSION=$(tr -d '[:space:]' < "$AQUI/VERSION" 2>/dev/null) || fallo "falta VERSION"
case "$VERSION" in *[!0-9A-Za-z._-]*|'') fallo "VERSION no válida" ;; esac
TAR="$AQUI/paquete/treidilor-director-$VERSION.tar"
[ -f "$TAR" ] && [ -f "$TAR.sha256" ] || fallo "faltan $TAR o su .sha256"
H=$(sha256sum "$TAR" | cut -d' ' -f1)
[ "$H" = "$ESPERADO" ] || fallo "el TAR descargado NO coincide con el SHA-256 que indicaste (descargado $H). No se instala nada"
[ "$(cut -d' ' -f1 < "$TAR.sha256")" = "$ESPERADO" ] || fallo "el .sha256 del repositorio no coincide con el esperado"
# contenido del TAR: sin rutas absolutas ni «..», y con MANIFIESTO.json el primero
LISTA=$(tar -tf "$TAR") || fallo "el TAR no se puede leer"
[ "$(printf '%s\n' "$LISTA" | head -n 1)" = MANIFIESTO.json ] || fallo "el primer elemento del TAR no es MANIFIESTO.json"
if printf '%s\n' "$LISTA" | grep -Eq '^/|(^|/)\.\.(/|$)'; then fallo "el TAR contiene rutas absolutas o con «..»"; fi
echo "DIRECTOR_TAR_VERIFICADO version=$VERSION sha256=$H archivos=$(printf '%s\n' "$LISTA" | grep -c .)"

# ¿ya instalada esta misma versión con este mismo TAR? (idempotente)
ACTUAL_ID=$(docker image inspect "$IMG:actual" --format '{{.Id}}' 2>/dev/null || true)
VER_ID=$(docker image inspect "$IMG:$VERSION" --format '{{.Id}}' 2>/dev/null || true)
VER_SHA=$(docker image inspect "$IMG:$VERSION" --format '{{index .Config.Labels "com.treidilor.tar-sha256"}}' 2>/dev/null || true)
if [ -n "$VER_ID" ] && [ "$VER_SHA" = "$ESPERADO" ]; then
  echo "DIRECTOR_YA_CONSTRUIDA version=$VERSION"
else
  CTX=$(mktemp -d) || fallo "mktemp falló"; trap 'rm -rf "$CTX"' EXIT
  cp -- "$AQUI/Dockerfile" "$CTX/Dockerfile" && cp -- "$TAR" "$CTX/" || fallo "no se pudo preparar el contexto de build"
  ( cd "$CTX" && docker build -q -f Dockerfile --build-arg "TAR_SHA256=$ESPERADO" --build-arg "TAR_NOMBRE=treidilor-director-$VERSION.tar" --label "com.treidilor.componente=director-00" --label "com.treidilor.tar-sha256=$ESPERADO" -t "$IMG:$VERSION" . ) > "$CTX/build.log" 2>&1 || fallo "el build falló (nada cambió: la imagen vigente sigue igual). Últimas líneas: $(tail -n 6 "$CTX/build.log" | tr '
' ' ')"
  VER_ID=$(docker image inspect "$IMG:$VERSION" --format '{{.Id}}') || fallo "no se encuentra la imagen recién construida"
  echo "DIRECTOR_IMAGEN_CONSTRUIDA $IMG:$VERSION"
fi
# prueba de humo SIN red, solo lectura: el Director arranca y lista sus agentes
# (la salida se captura entera: con «grep -q» en una tubería, docker recibiría SIGPIPE y pipefail daría un falso fallo)
HUMO=$(docker run --rm --network none --read-only --user node --cap-drop ALL --security-opt no-new-privileges:true --memory 256m --tmpfs /tmp:size=16m,mode=1777 -e TAI_DIRECTOR_DIR=/tmp/humo "$IMG:$VERSION" agentes 2>&1) || fallo "la prueba de humo de la imagen falló (no se activa): $HUMO"
printf '%s
' "$HUMO" | grep -q '^04 Calidad del cat' || fallo "la prueba de humo no listó los agentes esperados (no se activa)"
echo "DIRECTOR_HUMO_OK"
# rollback preparado: lo vigente pasa a :anterior (solo si es otra imagen)
if [ -n "$ACTUAL_ID" ] && [ "$ACTUAL_ID" != "$VER_ID" ]; then docker tag "$IMG:actual" "$IMG:anterior" || fallo "no se pudo preparar el rollback"; echo "DIRECTOR_ROLLBACK_PREPARADO anterior=${ACTUAL_ID#sha256:}"; fi
docker tag "$IMG:$VERSION" "$IMG:actual" || fallo "no se pudo activar la versión"
mkdir -p "$DIR_ESTADO" && chmod 700 "$DIR_ESTADO" && printf '%s version=%s sha256=%s\n' "$(date -u +%FT%TZ)" "$VERSION" "$ESPERADO" >> "$DIR_ESTADO/instalaciones.log"
echo "DIRECTOR_INSTALADO version=$VERSION (imagen $IMG:actual). Siguiente: bash consultar-real.sh   |  Rollback: bash revertir.sh"
