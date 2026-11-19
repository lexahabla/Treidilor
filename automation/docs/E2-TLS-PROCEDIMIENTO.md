# E2 corregida: candidato con router http + router https (`tls: {}`) — PREPARADO, NO EJECUTADO

**Estado (17/11/2026):** diseño, archivos y pruebas escritos en local. **No se ha ejecutado nada**: ni Docker, ni la fase `tls`, ni los scripts del VPS, ni las pruebas de F23/F24. El asistente no ha accedido al VPS. `custom.yaml` original intacto y retirado. E3 y F9 siguen pendientes de ejecución; el despliegue de agentes no está autorizado.

## 1. Causa (hecho + inferencia)
- **Hecho (propietario, E2-bis):** diez peticiones https de bloqueo → Traefik las encaminó al router `https-practice_project_n8n_n8n-0@file` y al servicio de n8n, HTTP 404. Traefik 3.6.7, montaje, `FILE_DIRECTORY`/`WATCH` y hash de la regla correctos; `main.yaml` intacto.
- **Hecho (repositorio):** la prueba local nunca ejercitó TLS: `traefik.yaml`/`traefik.e0b*.yaml` no declaran `tls` y ningún router de la base lo declara (el lanzador anterior no tiene cliente TLS). 132/132 y 104/104 se obtuvieron sobre un entrypoint «https» en claro.
- **Confirmado por el propietario con la documentación oficial de Traefik:** un router HTTPS debe declarar `tls` para atender tráfico TLS; uno sin `tls` solo atiende conexiones sin TLS.
- **Inferencia, aún sin demostrar con TLS real:** el candidato (dos routers) bloquea. Lo demuestra la fase `tls` local (§3) y, después, E3 desde fuera.

## 2. Candidato
Archivo **nuevo**: `automation/dev/prueba-traefik/config-candidata/tai-bloqueo-lector-tls.yaml` (1305 bytes, solo LF).
**SHA-256: `75703a2ca62f4793203952e4fb4f7729acf23526eb4e8a62a2592a4c96e81746`** (fijado en `matriz.mjs` → `HASH_CANDIDATA_TLS` y en el script del VPS; `.gitattributes` fuerza LF para que el hash no cambie con la conversión de saltos de línea).
- Dos routers, `tai-bloquear-lector-prod-http` (entrypoint `http`) y `tai-bloquear-lector-prod-https` (entrypoint `https`, `tls: {}`), con **la misma regex, prioridad 10 000 000, middleware `ipAllowList` 192.0.2.1/32 y `noop@internal`** que la regla validada.
- Sin `certResolver` ni certificados: no solicita nada; el certificado lo elige el handshake por SNI entre los ya existentes (inferencia, la comprueba la fase local con el certificado por defecto de Traefik).
- El nombre **no empieza por `custom`**: la puerta previa del VPS rechaza cualquier `custom*.yaml`/`tai-bloqueo*.yaml` activo (los `*.retirado*` no cuentan).

### Consecuencia de la redirección HTTP → HTTPS (diseño; se comprueba en la fase `tls`)
| Cómo redirige el VPS | Efecto con el candidato |
|---|---|
| **Router + middleware** en `main.yaml` (prioridad por longitud de regla, menor que 10 000 000) | El router http del candidato gana: la ruta del lector por http da **403** y no llega a redirigirse |
| **Redirección en el entrypoint** (configuración estática) | Se ejecuta **antes** de enrutar: el router http del candidato no llega a verla; http da **308** hacia https y allí la bloquea el router con TLS. Un 308 por sí solo NO distingue «no cargada» de «cargada» |
| No consta cuál de las dos es | La puerta previa del VPS (solo lectura, §4) lo consulta. La prueba de bloqueo **decisiva es la de https** |

## 3. Pruebas locales TLS (preparadas, sin ejecutar)
`node scripts/automation/prueba-traefik.mjs tls` (misma autorización y guardas que `e0b`/`verificar-clf`: `TAI_PRUEBA_TRAEFIK_AUTORIZADA=1`, destino Docker local verificado, marca de ejecución, limpieza única; las imágenes ya están descargadas). **Reutiliza** el lanzador, el compose (sin cambios), `prepararN8n`, `correrLote`, los evaluadores y las variantes de ruta; **no repite E0b**: matriz reducida de 22 celdas + controles.
| Fase | Qué demuestra | Criterio |
|---|---|---|
| T0 base sin regla (TLS real, router de n8n con `tls`) | Entorno fiel: el canario abierto se alcanza por https | 2/2 |
| T1 regla **original** | **Reproduce E2**: por https NO bloquea (llega a n8n por `n8n-https`), por http sí | 2/2 + 1/1 |
| T2 candidato | Bloqueo por TLS (15 celdas: base, codificadas, GET, HEAD, http), SNI otro/ninguno, Host≠SNI, HTTP/2 (3), controles https (healthz, interfaz, webhook público ×2 versiones del protocolo), 10 negativos, http con redirección | 15 + 7 + 4 + 10 + 2 |
| T3 reversión | Se retira el candidato: https vuelve a n8n y el volumen queda idéntico al inicial (solo `main.yaml`) | restaurado + idéntico |
| T4 redirección en el entrypoint | http → 308 a https y la redirigida queda bloqueada | ok |
Además: hashes de la regla original y del candidato (archivo y volumen) y que los tres contenedores preexistentes y el proyecto queden como estaban. Informe: `resultados-tls-<ts>/informe-tls.json`. **Pruebas sin Docker:** `automation/director/tests/f23-prueba-traefik-tls.test.mjs`.
Límite: Docker Desktop local, sin Swarm ni modo `host`, certificado autogenerado y no validado. **No sustituye a E3.**

## 4. Procedimiento en el VPS (uno solo; los scripts no se han ejecutado nunca)
**Puerta previa de solo lectura** (además de lo ya verificado en E0/E1): si la redirección http es de router o de entrypoint (`TRAEFIK_ENTRYPOINTS_*REDIRECTIONS*` en el servicio y `redirectScheme` en `main.yaml`) y si el router `https-practice_project_n8n_n8n-0` declara `tls`. Solo informa; la instalación no depende de ello.

`automation/dev/prueba-traefik/e2/instalar-regla-tls.sh` (`bash instalar-regla-tls.sh /ruta/tai-bloqueo-lector-tls.yaml`, como root):
1. **Puerta**: root; servicio `easypanel-traefik` `traefik:3.6.7` 1/1; `main.yaml` con su SHA-256/8033 bytes/`root:root 644`; directorio `root:root 755`; ningún bloqueo activo ni `.tmp`; origen con el hash y los 1305 bytes del candidato; un único contenedor. **Si algo falla no escribe nada.**
2. **Instalación atómica**: copia a `.tmp` (extensión ignorada por el proveedor), `chown/chmod`, verifica el hash de la copia y `mv -T` al nombre final.
3. **Visibilidad**: `docker exec … sha256sum` dentro del contenedor (si no se puede, avisa y deciden las sondas).
4. **Validación inmediata desde el VPS** (`curl --resolve host:443:127.0.0.1`, TLS real con SNI, `--path-as-is`, sin seguir redirecciones; hasta 30 s por la recarga): https lector → `403 Forbidden` (y 3 veces seguidas), http lector → 403 o 308 (registra cuál), https público ficticio → 404 JSON de n8n (`not registered`), https `/healthz` → 200.
5. `main.yaml` con el mismo hash y servicio sin cambios. Imprime `E2_VALIDACION_INMEDIATA_OK`.
**Retirada automática ante fallo inmediato:** un `trap` EXIT/INT/TERM/HUP renombra el archivo a `*.retirado-<hora>`, borra solo el `.tmp` que ella creó y comprueba `main.yaml`. **No hay temporizadores, procesos persistentes ni reversión «a los N minutos»**: lo que falle *después* de esta ejecución se revierte a mano.
**Reversión manual:** `bash retirar-regla-tls.sh` (renombra, no borra; comprueba `main.yaml`; espera el 404 de n8n). Nunca toca `main.yaml`, no reinicia nada.

### Quién prueba qué
| Pruebas **desde el VPS** (este procedimiento) | Pruebas **exteriores independientes** (E3, desde el PC; no forman parte de este bloque) |
|---|---|
| Puerta inmediata: ¿se cargó y bloquea desde dentro? Origen: el propio host con `--resolve` (no recorre Internet ni el ingress público) | Matriz exterior reducida con curl/`Sonda` de E1 por Internet real, atestados firmados, correlación CLF y ejecuciones de n8n |
| Puede retirar la regla sola | Solo informa; retirar sigue siendo una decisión (y el script manual) |

## 5. Riesgos y límites
- **Webhooks públicos y otros dominios:** la regla no lleva `Host`: aplica a cualquier dominio de ese Traefik, pero solo a rutas con `webhook…tai-lector-prod-` (sin distinguir mayúsculas). Los 10 negativos de la prueba local y las sondas del VPS cubren `/healthz`, la interfaz y los webhooks públicos ficticios.
- **Sin verificar:** semántica exacta de Traefik 3.6.7 ante `tls: {}` sin `certResolver` con certificados de EasyPanel (SNI); que la extensión `.tmp` se ignore en el VPS (se comprobó en local); que `docker exec … sha256sum` exista en la imagen; el nombre real del router http y la forma de la redirección.
- **El script instalador valida desde dentro del VPS**: no demuestra que el bloqueo funcione desde Internet ni con el ingress de Swarm; eso es E3.
- Si el contenedor se recrea (reinicio del servicio) el archivo permanece (volumen del host), y el bloqueo con él.

## 6. Ejecución definitiva en Hostinger (17/11/2026; la fase local `tls` ya SUPERÓ: 15/15, 7/7, controles, negativos, reversión)
**Huellas fijadas** (se comprueban en el PC antes y en el VPS después de transferir):
| Archivo | Bytes | SHA-256 |
|---|---|---|
| `tai-bloqueo-lector-tls.yaml` | 1305 | `75703a2ca62f4793203952e4fb4f7729acf23526eb4e8a62a2592a4c96e81746` |
| `instalar-regla-tls.sh` | 8589 | `393648ffa5c91904c223bb374bb72766ae0e3795822eada801760ef5a38be8a8` |
| `retirar-regla-tls.sh` | 2128 | `e5cadf5492f491e373a67640639f78dd62e2a7ebae9284b464e4d008192ed79c` |
Transferencia: Base64 con saltos de línea desde Windows PowerShell 5.1 → consola web de Hostinger (`cat <<'FIN' | tr -d '\r' | base64 -d > archivo`). Son archivos públicos del repositorio (sin secretos): el portapapeles no es un riesgo. Comandos exactos en el mensaje de entrega de esta fase. Cambios de esta revisión en `instalar-regla-tls.sh`: comprobación previa de utilidades, mensaje claro si falla ANTES de escribir nada y listado del directorio antes de instalar. Nada de lo demás se debilitó.

## 7. Cierre de E3 (17/11/2026; E2 instalada y validada: exterior 403 / healthz 200 / público ficticio 404, datos del propietario, no verificados por el asistente)
**Qué queda de E3 (y qué no):** ya consta el 403 exterior, el 200 de `/healthz` y el 404 del público ficticio. Falta: (1) matriz exterior completa (31 variantes × https/http + 5 métodos; centinelas antes y después; 6 negativos) → `scripts/automation/sonda-exterior-e3.mjs`; (2) correlación en el registro de Traefik + huellas + servicio → `e2/evidencia-e3.sh` (solo lectura); (3) canario publicado con el bloqueo vigente (0 ejecuciones en n8n) y camino interior; (4) E4: persistencia ≥ 24 h y tras reinicios. No se repiten E0/E0b/E1/TLS.
La sonda se probó solo contra un servidor falso local (7 pruebas, `f25-sonda-exterior-e3.test.mjs`): detecta fuga, anula si un centinela cae y no guarda la credencial. Un 400/404/405/414/421 de Traefik (p. ej. `%2Fwebhook/…` sin barra inicial) cuenta como bloqueado si no responde n8n (criterio de `ESTADOS_BLOQUEO`).
