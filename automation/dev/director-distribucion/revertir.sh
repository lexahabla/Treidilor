#!/usr/bin/env bash
# DIRECTOR 00 · ROLLBACK. Solo mueve etiquetas de imágenes del Director (nunca toca servicios, redes, n8n ni Traefik).
#   bash revertir.sh               vuelve a la versión anterior (`:anterior` pasa a `:actual`; la vigente queda como `:descartada`)
#   bash revertir.sh retirar       quita las imágenes del Director (actual, anterior, descartada y versiones); conserva el volumen del ledger
#   bash revertir.sh retirar --con-ledger   además borra el volumen `tai_director_ledger` (el registro de consultas: irrecuperable)
set -u
IMG="${TAI_DIRECTOR_IMAGEN:-treidilor-director}"
fallo() { echo "DIRECTOR_PARAR: $1"; exit 1; }
[ "$(id -u)" = 0 ] || fallo "hay que ejecutarlo como root"
command -v docker > /dev/null 2>&1 || fallo "falta docker"
if [ "${1:-}" = retirar ]; then
  for T in $(docker image ls "$IMG" --format '{{.Tag}}'); do docker rmi "$IMG:$T" > /dev/null 2>&1 && echo "DIRECTOR_IMAGEN_RETIRADA $IMG:$T"; done
  if [ "${2:-}" = --con-ledger ]; then docker volume rm tai_director_ledger > /dev/null 2>&1 && echo "DIRECTOR_LEDGER_BORRADO"; fi
  echo "DIRECTOR_RETIRADO (el volumen del ledger se conserva salvo --con-ledger)"; exit 0
fi
docker image inspect "$IMG:anterior" > /dev/null 2>&1 || fallo "no hay versión anterior a la que volver"
docker image inspect "$IMG:actual" > /dev/null 2>&1 && docker tag "$IMG:actual" "$IMG:descartada"
docker tag "$IMG:anterior" "$IMG:actual" || fallo "no se pudo restaurar la etiqueta"
echo "DIRECTOR_REVERTIDO ahora=$(docker image inspect "$IMG:actual" --format '{{index .Config.Labels "com.treidilor.tar-sha256"}}' 2>/dev/null)"
