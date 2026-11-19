# Prueba local del bloqueo de webhooks con Traefik 3.6.7

**Estado (16/11/2026): EJECUTADA EN LOCAL Y VALIDADA** (5.ª ejecución de la regla; E0b con `forwardedHeaders.insecure=true` y registro CLF; verificación complementaria `verificar-clf`). Resultados, rutas y SHA-256 de las evidencias: `automation/docs/AISLAMIENTO-VPS-PROCEDIMIENTO.md` §1h. Nada de aquí toca el VPS, EasyPanel, producción ni la web, y **la validación local no sustituye a las pruebas reales en Docker Swarm y modo `host`** (E1–E3).

## Para qué
Fijar y verificar, **con la misma versión que producción** (Traefik 3.6.7 y n8n 2.38.6 con PostgreSQL 17 y `N8N_PROXY_HOPS=1`), la regla candidata de `AISLAMIENTO-WEBHOOKS-LECTOR.md` antes de aplicar nada en el VPS. Reproduce lo confirmado (`providers.file.directory=/data/config`, `watch=true`) y deja como **supuestos** lo que el VPS aún debe confirmar (nombres de entrypoints `http`/`https`; que Traefik no confía en `X-Forwarded-*` externas).

## Recursos
| Recurso | Estado | Acción |
|---|---|---|
| `traefik:v3.6.7` | **Descargada el 15/11/2026** (digest `a9890c898f379c1905ee5b28342f6b408dc863f08db2dab20e46c267d1ff463a`, **idéntico al del VPS**) | Ninguna: `--pull never` |
| `n8nio/n8n:2.38.6`, `postgres:17`, `node:22-bookworm-slim` | **Ya descargadas** (comprobado con `docker images`) | Ninguna: el lanzador usa `--pull never` y se detiene si falta alguna |
| Red `tai-tf-aislada` (**interna**, sin Internet) y `tai-tf-exterior` (puente, solo para publicar) | Se crean | Aisladas y con nombre propio |
| Puertos `127.0.0.1:18080` (entrypoint `http`) y `127.0.0.1:18081` (`https`, sin TLS) | Se publican **solo en loopback** | Simulan «Internet»; comprobar que no están en uso |
| Volúmenes `tai_tf_pg`, `tai_tf_n8n` | Se crean | Se eliminan al terminar (`down -v`) |
| Contenedores `tai-tf-db`, `tai-tf-n8n`, `tai-tf-traefik`, `tai-tf-cliente`, `tai-tf-cfg` (y `tai-tf-eco` solo en `e0b`) | Se crean | Límites de CPU/memoria, sin privilegios, sin socket de Docker; todos (y redes y volúmenes) con la etiqueta `com.treidilor.prueba=traefik-aislamiento` |
| Secretos aleatorios de la prueba (clave de cifrado, contraseña de PostgreSQL, credencial del canario) | Se generan | En `D:/treidilor-pruebas/prueba-traefik/` (fuera del repositorio); no hay ningún secreto real |
| Disco | ≈ 1,5 GB entre imágenes (solo 1 nueva) y volúmenes | Revisar el espacio libre |

**No** se usa el n8n de pruebas ya existente (`treidilor-n8n-pruebas`), ni el entorno `tai-prueba-dt`, ni sus datos: es un proyecto aparte (`tai-prueba-tf`).

## Qué hace la prueba (orden `ejecutar`, con limpieza siempre)
1. Levanta PostgreSQL 17 + n8n 2.38.6, importa el **canario** (sin datos; credencial desechable; lista de IP = subred de la red interna) y una **ruta pública de control** (`tai-publico-prueba`), y arranca Traefik con solo `main.yaml` (simula lo que genera EasyPanel).
2. **Fase A — sin regla:** pasa la matriz exterior. **Debe filtrarse** (si no, la prueba no sirve: no puede fallar).
3. **Fase B — con la regla candidata** (`config-candidata/custom.yaml` copiado a la carpeta vigilada): espera a que `watch` la cargue y pasa **toda** la matriz:
   - **Exterior** (68 celdas): variantes de ruta (`/webhook/…`, `/WEBHOOK/…`, `//webhook//…`, barra final, `/./`, `/x/../`, `%74ai…`, `%2F`, `?x=1`, `;x=1`, `webhook-test`, `webhook-waiting`) × http/https × con y sin credencial; métodos GET/HEAD/OPTIONS/PUT/DELETE; otros `Host`. **Correcta = la petición no llega a n8n** (estado 400/403/404/405/414/421, sin marcas de n8n ni cuerpo del canario y, con el registro de acceso de Traefik, sin respuesta del origen).
   - **Controles** (4): `/healthz`, la interfaz y el webhook público de control **siguen llegando a n8n** (el bloqueo no es demasiado amplio).
   - **Interior** (2): desde `tai-tf-cliente` (hace de Director) el canario responde por la red interna con la credencial y no sin ella.
   - **Regeneración:** reescribe `main.yaml` (simula a EasyPanel) y comprueba que la regla propia sigue vigente.
4. **Fase D — reversión:** borra `custom.yaml`, comprueba que la regla se retira y limpia todo.
5. Escribe `informe-<fecha>.json` en la carpeta de trabajo (fuera del repo): códigos, motivos de cada fallo y huellas. **Sin datos reales.**

## Cómo se verifican los resultados
- **Resultado correcto** = fase A con fugas (> 0) **y** fase B sin ningún fallo (68 + 4 + 2 + regeneración) **y** reversión confirmada.
- Cualquier celda exterior filtrada = **la regla no sirve**; se corrige y se repite. No se aplica nada en el VPS hasta una ejecución limpia.
- La evidencia combina la **respuesta** y el **registro de acceso JSON de Traefik** (`OriginStatus`, `ServiceName`, `RouterName`, identificado por la cabecera `X-Prueba-Id`).
- Pruebas automáticas sin Docker: `automation/director/tests/f21-prueba-traefik.test.mjs` (evaluador, matriz, canario, archivos del entorno y bloqueo sin autorización). `node scripts/automation/prueba-traefik.mjs ensayo` las repasa sin tocar Docker.

## Riesgos de la propia prueba
1. *(Superado en las ejecuciones del 15–16/11/2026; se conserva como histórico.)* **Los lanzadores no se han podido probar sin Docker:** el alta del propietario, la importación por CLI del canario y la publicación (que en 2.38.6 requiere reiniciar n8n) **pueden necesitar un ajuste en la primera ejecución real**; el entorno se limpia siempre (`finally` + `limpiar`).
2. **No reproduce EasyPanel ni Swarm *ingress***: la IP de cliente que ve Traefik/n8n en producción puede ser distinta; la capa 2 (lista de IP) solo se confirma de verdad con el canario en el VPS.
3. **Supuestos de la configuración estática** (nombres `http`/`https`, no confiar en `X-Forwarded-*`): si el VPS difiere, hay que repetir con los valores reales.
4. **Alteración de otras cosas del equipo:** ninguna; puertos solo en 127.0.0.1, red interna, proyecto Compose propio, `--pull never`, `down -v` solo de ese proyecto (nunca `prune`).
5. **Falsos negativos:** un `ESTADOS_BLOQUEO` demasiado laxo podría aceptar una respuesta que no sea del proxy; por eso se exige además la ausencia de marcas de n8n y del origen en el registro.

## Resultados y órdenes de validación (16/11/2026)
| Prueba | Orden | Resultado | Evidencia (fuera del repositorio) |
|---|---|---|---|
| 5.ª ejecución de la regla | `ejecutar` | 68/68 + 64/64 bloqueadas; regla validada localmente | `resultados-1794785149334` |
| **E0b** (`insecure=true`, CLF, suplantación de cabeceras) | `e0b` | **132/132** rutas y **104/104** suplantaciones bloqueadas; controles 4/4, negativos 20/20, interior 2/2; el indicador global quedó en «no validada» por un **defecto del evaluador** (exigía 0 ejecuciones en toda la fase CLF, pero el webhook público legítimo ejecuta su workflow) | `resultados-1794840770557/informe.json` (SHA-256 `453b771a…c048`; **se conserva intacto**) |
| **Verificación complementaria del evaluador corregido** | `verificar-clf` | **SUPERADA**: control positivo del contador 1/1, 9/9 bloqueadas con 0 ejecuciones, webhook público 2/2, 4/4 centinelas en el CLF, secuencia original (`faseClf`) ok / 0 / 2 | `resultados-clf-1794845045681/informe-clf.json` (SHA-256 `a63ff9d2…5dff`) |
Regla de referencia: `config-candidata/custom.yaml` (517 bytes, SHA-256 `2f9c5b1b5bcba1b64683559f1b6e4be6a0c9caa52af1a7c038765d1f6113af39`), **sin modificar** en ninguna de las ejecuciones.
Tras cada ejecución: recursos de `tai-prueba-tf` eliminados (sin `prune`) y los tres contenedores preexistentes (`treidilor-puente-entrada`, `treidilor-n8n-pruebas`, `treidilor-puente-salida`) **intactos** (mismos ID, arranque y estado; no se arrancan ni se detienen).
Los archivos de E0b son: `traefik.e0b.yaml` (insecure=true, registro JSON), `traefik.e0b-clf.yaml` (insecure=true, registro CLF), el servicio `eco` del compose (solo `e0b`) y las funciones de `matriz.mjs` (suplantación, CLF y verificación). Las matrices y criterios de la regla no cambiaron.

## Seguridad del lanzador (desde el 16/11/2026)
Toda orden con efectos en Docker (`ejecutar`, `e0b`, `verificar-clf`, `limpiar`, `descargar`): (1) exige la autorización — sin ella `docker()` solo deja pasar lectura; (2) verifica el **destino** antes de nada: sin `DOCKER_HOST`/`DOCKER_CONTEXT`/`DOCKER_TLS_VERIFY`/`DOCKER_CERT_PATH`, contexto `desktop-linux`, endpoint `npipe:////./pipe/dockerDesktopLinuxEngine`, Docker Desktop y Swarm inactivo; (3) se detiene si ya hay recursos `tai-tf` o una marca `ejecucion-en-curso.json`; (4) limpia **una sola vez** y solo lo que creó (en el `finally`, ante SIGINT/SIGTERM/SIGHUP/SIGBREAK y en `exit`); (5) borra siempre la credencial temporal. Un apagado forzoso (`taskkill /F`, SIGKILL) no puede ejecutar nada: la recuperación es `limpiar`, que se niega si hay una ejecución viva o recursos `tai-tf` sin la etiqueta de la prueba. Pruebas sin Docker: `f21` (13) y `f22` (17) = 30/30.

## Autorización y uso (cuando se conceda)
```powershell
# Variable limitada a ESA ejecución y restaurada después, también si hay error (PowerShell):
$var = 'TAI_PRUEBA_TRAEFIK_AUTORIZADA'; $previo = [Environment]::GetEnvironmentVariable($var, 'Process'); Push-Location 'd:\AXEL\WEBS\TRADYLOR\tradylor_web'
try { [Environment]::SetEnvironmentVariable($var, '1', 'Process'); node scripts/automation/prueba-traefik.mjs <orden> }
finally { [Environment]::SetEnvironmentVariable($var, $previo, 'Process'); Pop-Location }
```
`<orden>`: `ensayo` (repaso sin Docker; no necesita la variable) · `descargar` (única descarga: `traefik:v3.6.7`; ya hecha) · `ejecutar` (prueba completa; limpia siempre) · `e0b` (con `insecure=true` y suplantación) · `verificar-clf` (verificación complementaria) · `limpiar` (recuperación manual tras una interrupción forzosa).
Sin la variable, todas salvo `ensayo` **no hacen nada** (código de salida 3).
