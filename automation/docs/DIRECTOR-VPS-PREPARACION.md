# Director en el VPS (opción A): inspección previa y requisitos reales

**Estado (15/11/2026): SOLO INSPECCIÓN Y PLANIFICACIÓN.** No se ha tocado el VPS, EasyPanel, Traefik, Docker ni n8n; no se ha construido ni desplegado ningún contenedor. Etiquetas: **[Documentado]** (lo dicen los documentos existentes), **[Comunicado]** (lo dijo el propietario; el asistente no lo ha reproducido), **[Sin verificar]** (hace falta mirar el VPS). Complementa `LECTOR-PRODUCCION-DESPLIEGUE.md` (no lo repite).

## A. Lo que se puede dar por conocido hoy
| Dato | Estado |
|---|---|
| 1 VPS (2 vCPU, 7,8 GiB, 83 GB libres), **Docker Swarm de un solo nodo**, EasyPanel, **Traefik** (80/443 publicados), n8n **2.38.6**, runner 2.38.6 (externo), PostgreSQL 17 | [Comunicado 13/11] |
| Firewall de Hostinger: solo TCP 22/80/443; 3000 cerrado; n8n 5678, runner 5680 y PostgreSQL sin publicar | [Comunicado 13/11] |
| Redes overlay diferenciadas para n8n y para Treidilor; **nombres y pertenencia sin identificar** | [Comunicado]; detalle [Sin verificar] |
| Proyecto EasyPanel `practice_project_n8n` con servicios `n8n`, `n8n-runner` y PostgreSQL (la guía del Auditor los nombra `n8n`, `n8n-runner`, `n8n-db`) | [Documentado]; nombres reales de servicio Swarm [Sin verificar] |
| n8n tiene **dominio público con HTTPS** en EasyPanel (el panel y n8n funcionan por HTTPS) | [Documentado] |
| Despliegue de la web: GitHub → webhook → EasyPanel (Git HTTPS) | [Documentado/Comunicado] |
| `Get` con filtro + `orderBy generadoEn DESC` + `limit` **ya se usa en producción** en los workflows del Auditor (`Leer historial`) y del Agente 04; `ex-17` y `ex-18` lo recorrieron | [Comunicado]: con 2–3 filas no prueba el orden ni el límite |
| El Director solo usa módulos de Node (sin dependencias npm); su servicio escucha en `127.0.0.1` (**fijo** en `puente.mjs`: hay que parametrizarlo antes de contenerizar) y su ledger vive en `TAI_DIRECTOR_DIR` | [Comprobado en el código] |
| SSH F7 cerrada y **F8 SUPERADA con riesgos residuales documentados (16/11/2026)**; E-1 **pendiente** de validar en el VPS; F9 sin autorizar | [Documentado] |

## B. Lo que falta y cómo obtenerlo (consola web de Hostinger, como root)
Los bloques son **de solo lectura**: no crean archivos (ninguna redirección), no cambian nada, no reinician nada y **no imprimen variables de entorno completas ni secretos** (de `Env` solo se muestran nombres de una lista cerrada; las etiquetas y configuraciones pasan por un filtro que descarta `users|password|secret|token|key|auth|email`). Revelan **nombres de servicio, imágenes, puertos, redes y el dominio público de n8n** (no son secretos). Pega la salida de cada bloque; si algo no te cuadra, no lo pegues y dímelo.

**Bloque 1 · Servicios, Docker y recursos**
```sh
date -u; docker info --format 'docker={{.ServerVersion}} swarm={{.Swarm.LocalNodeState}} nodos={{.Swarm.Nodes}}'
docker service ls --format '{{.Name}} | {{.Image}} | {{.Replicas}} | publicados={{.Ports}}'
docker stats --no-stream --format '{{.Name}} cpu={{.CPUPerc}} mem={{.MemUsage}}' | head -20
df -h / /var/lib/docker /etc/easypanel 2>/dev/null
```
**Bloque 2 · Traefik: versión y cómo recibe su configuración**
```sh
docker service ls --format '{{.Name}} | {{.Image}}' | grep -i traefik
T=$(docker service ls --format '{{.Name}}' | grep -i traefik | head -1); echo "TRAEFIK=$T"
docker service inspect "$T" --format 'imagen={{.Spec.TaskTemplate.ContainerSpec.Image}} puertos={{json .Endpoint.Spec.Ports}} montajes={{range .Spec.TaskTemplate.ContainerSpec.Mounts}}{{.Source}}->{{.Target}} {{end}}'
docker service inspect "$T" --format '{{json .Spec.TaskTemplate.ContainerSpec.Args}}' | sed -E 's/email=[^",]*/email=<oculto>/g'
docker ps --format '{{.Names}} | {{.Image}}' | grep -i traefik
ls -la /etc/easypanel/traefik /etc/easypanel/traefik/config 2>&1 | head -40
for f in /etc/easypanel/traefik/traefik.yaml /etc/easypanel/traefik/traefik.yml; do [ -f "$f" ] && { echo "== $f"; grep -viE 'email|key|token|secret|pass|auth' "$f" | head -60; }; done
```
Si la imagen sale como `latest` o sin versión, añade (solo lee la versión del binario): `docker exec "$(docker ps -q -f name=traefik | head -1)" traefik version`.

**Bloque 3 · n8n: servicio, red, puerto y cómo EasyPanel genera sus routers**
```sh
for S in $(docker service ls --format '{{.Name}}' | grep -i n8n); do
  echo "== $S"
  docker service inspect "$S" --format 'imagen={{.Spec.TaskTemplate.ContainerSpec.Image}} publicados={{json .Endpoint.Spec.Ports}} montajes={{range .Spec.TaskTemplate.ContainerSpec.Mounts}}{{.Type}}:{{.Target}} {{end}} redes={{range .Spec.TaskTemplate.Networks}}{{.Target}}({{.Aliases}}) {{end}}'
  docker service inspect "$S" --format '{{range $k,$v := .Spec.Labels}}{{$k}}={{$v}}{{"\n"}}{{end}}' | grep -iE 'traefik|easypanel' | grep -viE 'users|password|secret|token|key|auth'
  docker service inspect "$S" --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}' | grep -E '^(WEBHOOK_URL|N8N_HOST|N8N_PORT|N8N_PROTOCOL|N8N_PROXY_HOPS|N8N_ENDPOINT_WEBHOOK|N8N_ENDPOINT_WEBHOOK_TEST|N8N_DISABLE_UI|N8N_RUNNERS_MODE|EXECUTIONS_DATA_PRUNE|EXECUTIONS_DATA_MAX_AGE|EXECUTIONS_DATA_PRUNE_MAX_COUNT)='
done
```
**Bloque 4 · Redes (¿se puede compartir una red con n8n?)**
```sh
for N in $(docker network ls --filter driver=overlay --format '{{.Name}}'); do docker network inspect "$N" --format '{{.Name}} | id={{.ID}} | attachable={{.Attachable}} | internal={{.Internal}} | cifrada={{index .Options "encrypted"}} | subred={{range .IPAM.Config}}{{.Subnet}} {{end}} | con={{range .Containers}}{{.Name}} {{end}}'; done
ss -H -tuln | awk '{print $1,$5}' | sort | head -30
```
**Bloque 5 · Compatibilidad del nodo Data table en el n8n real (lectura de un archivo de la imagen, no de datos)**
```sh
C=$(docker ps --format '{{.Names}} {{.Image}}' | grep -E 'n8nio/n8n:' | head -1 | cut -d' ' -f1); echo "CONTENEDOR_N8N=$C"
docker exec "$C" sh -c 'grep -l "orderByColumn" /usr/local/lib/node_modules/n8n/node_modules/.pnpm/n8n-nodes-base*/node_modules/n8n-nodes-base/dist/nodes/DataTable/actions/row/get.operation.js; grep -rn "ROWS_LIMIT\|MAX_ROWS" /usr/local/lib/node_modules/n8n/node_modules/.pnpm/n8n-nodes-base*/node_modules/n8n-nodes-base/dist/nodes/DataTable/common/constants.js' 2>&1 | head -10
```
**Bloque 6 · Desde FUERA (tu móvil con datos, no el VPS): qué responde hoy el proxy.** Usa una ruta **ficticia**, nunca la real:
```sh
curl -si -m 10 -X POST https://<dominio-n8n>/webhook/tai-lector-prod-zz | head -12
```
Si la respuesta es un JSON de n8n (`"message":"The requested webhook … is not registered"`), el proxy **sí** entrega las rutas `/webhook/…` a n8n: el bloqueo es imprescindible. Si es una página de Traefik (`404 page not found`/`403`), ya hay un filtro.

## C. Aislamiento recomendado (CONDICIONADA a lo que salga de los bloques 2, 3 y 6)
**No propongo regla definitiva todavía.** La sintaxis y el lugar dependen de la versión de Traefik y de cómo EasyPanel registra los routers.
| Mecanismo | Se podrá usar si… | Observaciones |
|---|---|---|
| **1. Router de bloqueo en la configuración dinámica de Traefik (archivo)**: ruta `PathPrefix(/webhook/tai-lector-prod-)` y `/webhook-test/…` con prioridad explícita mayor que la de n8n, servicio `noop@internal` y `ipAllowList` a `127.0.0.1/32` (v3; `ipWhiteList` en v2) | El bloque 2 muestra un *provider* de archivo con directorio observado (`watch`) y que una configuración nueva en esa carpeta se carga | Aditivo y reversible (borrar el archivo). Hay que confirmar que EasyPanel **no regenera ni borra** archivos ajenos en esa carpeta y que los routers de n8n (bloque 3) no tienen una prioridad superior |
| **2. Etiquetas de Swarm en el servicio n8n** | El bloque 3 muestra que EasyPanel genera routers por etiquetas | Probable que EasyPanel las **reescriba en cada despliegue**: frágil; solo si se puede fijar desde su interfaz |
| **3. Defensa en n8n**: *Options → IP(s) Whitelist* en cada Webhook (IP/red del Director) + `N8N_PROXY_HOPS` correcto | El bloque 3 muestra el valor de `N8N_PROXY_HOPS`: si n8n toma la IP del cliente real (no la de Traefik), la lista de IP es efectiva | **Capa adicional, no sustituye** a la 1: depende de que n8n vea la IP real |
| **4. Quitar la exposición del dominio** (n8n sin dominio público) | Solo si el propietario puede prescindir de la interfaz web de n8n por Internet | Cambia cómo se administra n8n: decisión propia |

**Comprobación de aislamiento que debe superarse antes de leer nada de producción** (sin exponer datos): un 404 previo a publicar **no cuenta**. Se usa un **workflow CANARIO** (no tiene ninguna tabla ni dato: responde `{"canario":true}`), con la **misma credencial** y un path bajo el **mismo prefijo bloqueado** (`tai-lector-prod-canario`), generado y revisado con el linter estricto cuando se autorice. Se publica **el canario, no el lector**, y se exige:
1. **Interior (desde el contenedor del Director) con la credencial → 200 + `canario:true`.** Prueba que el camino interno funciona.
2. **Exterior (móvil/otra red) sin credencial → respuesta de Traefik (403/404 de proxy), NO el JSON `Authorization data is wrong` de n8n.** Si llega el JSON de n8n, el proxy entrega la ruta: **ABORTAR**.
3. **Exterior con la credencial real → bloqueado** (se hace con el canario porque no hay datos que filtrar).
4. **Repetir 2–3 tras cada reinicio de Traefik, cada redespliegue de n8n y cada actualización de EasyPanel**, y de nuevo **después de publicar el lector real** (solo los pasos 2 y 3 sin credencial/ con la del canario; nunca un `curl` externo con la credencial del lector real).
5. Solo con 1–4 correctos se autoriza **una** lectura real por agente desde el Director.
El resultado se guarda como evidencia (fecha, código HTTP y huella del cuerpo, sin datos).

## D. Servicio del Director (diseño mínimo; no se construye ni se despliega)
| Aspecto | Diseño |
|---|---|
| Qué es | Un servicio de EasyPanel con **una imagen Node 22 slim propia**, sin dependencias npm: `automation/director/**`, `automation/lib/**` y `scripts/automation/{puente,director}.mjs`. Ejecuta `puente.mjs servir --n8n-produccion … --hosts …` |
| Red | **Sin puerto publicado y sin dominio.** Los resultados reales del VPS corrigen el diseño inicial: **PostgreSQL y el runner están en la red `easypanel`**, la que EasyPanel da a todos sus servicios, así que **ni un proyecto aparte ni el mismo proyecto aíslan al Director de PostgreSQL a nivel de red**. Opciones (1: EasyPanel + controles compensatorios, recomendada; 2: red dedicada fuera de EasyPanel) y decisión D-4 en `AISLAMIENTO-WEBHOOKS-LECTOR.md` §B |
| Cambio de código previo (local, sin tocar `src/`) | `puente.mjs` debe poder escuchar en la interfaz del contenedor (`--host`) y mantener `127.0.0.1` por defecto; `GET /tai/v1/salud` ya existe para la sonda de salud |
| Volumen | `TAI_DIRECTOR_DIR` en un volumen persistente propio (ledger, tokens no: los tokens viven en memoria). Respaldo: copia periódica del volumen **y** verificación de la cadena (`verificarCadena`) en cada arranque. **E-1: ejecutar `_estres-ledger.mjs` en ese volumen del VPS antes de usarlo** (cierra E-1 si pasa) |
| Credenciales | Token del lector de producción en un **secreto/variable de EasyPanel** propio (`TAI_LECTOR_PROD_TOKEN`), distinto del de pruebas, de `TRADYLOR_API_TOKEN` y de cualquier clave de IA. Sin claves de IA mientras el cerebro sea simulado |
| Recursos | Límites bajos (p. ej. 256 MiB / 0,25 CPU; se afinan con el bloque 1); un solo réplica |
| Salud | Sonda HTTP interna a `/tai/v1/salud` (sin datos de negocio) y alarma si el lector declara `origen_no_disponible` |
| Cómo se le habla sin puerto público | **Decisión pendiente (D-2).** Hoy el Director lo usa el propietario desde el PC. Sin puerto público las opciones son: CLI por la consola de EasyPanel (`docker exec`), o un cliente (Agente 13) dentro de la misma red. Un dominio público con token no cumple «sin puerto público» |
| Cómo llega la imagen | **Decisión pendiente (D-3).** `automation/` no está en git (todo sin commitear) y un `push` a `main` **redespliega la web**. Recomendado: un repositorio privado **aparte** solo con lo necesario y un servicio de EasyPanel con su propia clave de despliegue, sin el webhook de la web. Alternativa: empaquetar un TAR verificado por huella como en F2 y construir en el VPS |
| Reversión | Parar/eliminar el servicio del Director en EasyPanel (no toca n8n ni la web) y conservar el volumen; despublicar el lector (`LECTOR-PRODUCCION-DESPLIEGUE.md` §5); retirar el router de bloqueo; rotar el token |

## E. Riesgos pendientes
1. **Exposición del webhook por el proxy** (el principal): no se puede garantizar sin los bloques 2, 3 y 6; mitigación = §C.
2. **Versión de Traefik y comportamiento de EasyPanel** al regenerar la configuración: una actualización de EasyPanel podría eliminar o ignorar el bloqueo; hay que re-ejecutar la comprobación (§C.4).
3. **PostgreSQL y runner alcanzables por red desde el Director** (red `easypanel`, confirmado): protegidos solo por la autenticación de PostgreSQL; se confirma en solo lectura y se acepta o se pasa a la red dedicada (`AISLAMIENTO-WEBHOOKS-LECTOR.md` §B).
4. **Orden y límite de 200 filas con datos reales en n8n 2.38.6**: el código del workflow lo protege (ordena por fecha parseada y se niega a responder si recibe 200 filas), pero el comportamiento real del nodo (orden de `orderBy` sobre texto, tope de `limit`) **queda pendiente de una prueba controlada** (en el n8n real de pruebas local 2.46.6 ya funciona; en 2.38.6 solo el bloque 5 y la primera lectura real lo confirmarán).
5. **Header Auth y registro de webhooks de producción en 2.38.6:** misma lectura de código local; **pendiente de prueba controlada** (el canario cubre autenticación y registro sin datos).
6. **Publicar un workflow en n8n por la interfaz** no requiere reinicio, pero no está confirmado en 2.38.6 con webhooks nuevos: la prueba del canario lo comprueba.
7. **E-1** sigue **pendiente** de la validación en el volumen del VPS; **F8** superada con riesgos residuales documentados (16/11/2026); **F9** sin autorizar; el SSH no se toca en este plan.
8. Sin bloqueo verificado, **no se publica nada**; sin repositorio/canal de entrega decidido, **no se construye**.

## F. Siguiente operación concreta
**Autorizar la ejecución, por tu parte, de los bloques 1–6 en la consola web de Hostinger (solo lectura) y pegar la salida.** Con ella se puede confirmar la versión de Traefik, el mecanismo de routers, el nombre y la red de n8n, y elegir (y verificar) el mecanismo de bloqueo. Decisiones que irán después (no ahora): D-1 mecanismo de bloqueo (según la salida), D-2 cómo se habla con el Director, D-3 cómo llega la imagen.
