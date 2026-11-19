# Imagen del DIRECTOR 00 (L0, solo lectura, proveedor simulado). PREPARADA, NO CONSTRUIDA NI DESPLEGADA (17/11/2026). Se construye SOLO desde el TAR verificado (D-3 provisional).
# Contexto de build = un directorio con ÚNICAMENTE este Dockerfile y el TAR (nunca el repositorio):
#   docker build -f Dockerfile --build-arg TAR_SHA256=<sha256 del TAR> --build-arg TAR_NOMBRE=treidilor-director-<version>.tar -t treidilor-director:<version> <directorio>
# Sin puertos, sin servidor: se usa con `docker compose run --rm director <comando>` (D-2: CLI privada). Datos: solo fixtures SINTÉTICOS incluidos en el TAR; el ledger vive en un volumen aparte.
FROM node:22-bookworm-slim
ARG TAR_SHA256
ARG TAR_NOMBRE=treidilor-director.tar
RUN echo "${TAR_SHA256}" | grep -Eq '^[0-9a-f]{64}$'
WORKDIR /opt/tai
COPY ${TAR_NOMBRE} /tmp/director.tar
# El hash se comprueba DENTRO del build: si el TAR no es el verificado, el build falla antes de extraer nada.
RUN echo "${TAR_SHA256}  /tmp/director.tar" | sha256sum -c - \
 && tar -xf /tmp/director.tar -C /opt/tai --no-same-owner --no-same-permissions \
 && rm -f /tmp/director.tar \
 && mkdir -p /var/lib/tai-director && chown node:node /var/lib/tai-director \
 && TAI_DIRECTOR_DIR=/tmp/humo node scripts/automation/director.mjs ayuda > /dev/null \
 && TAI_DIRECTOR_DIR=/tmp/humo node scripts/automation/director.mjs agentes > /dev/null \
 && rm -rf /tmp/humo
ENV TAI_DIRECTOR_DIR=/var/lib/tai-director \
    NODE_ENV=production
USER node
VOLUME ["/var/lib/tai-director"]
ENTRYPOINT ["node", "/opt/tai/scripts/automation/director.mjs"]
CMD ["ayuda"]
