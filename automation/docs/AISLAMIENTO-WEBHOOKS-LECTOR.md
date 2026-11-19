# Aislamiento de los webhooks del lector de producción (Traefik 3.6.7 + EasyPanel)

**Estado (15/11/2026): DISEÑO ACTUALIZADO con el bloque 7 (comunicado por el propietario, no reproducido por el asistente), pendiente de aprobación. No se ha modificado Traefik, EasyPanel, Docker, SSH, n8n ni producción.** Completa `DIRECTOR-VPS-PREPARACION.md` y `LECTOR-PRODUCCION-DESPLIEGUE.md`; no los repite.

## A. Diagnóstico de exposición (confirmado)
- **Confirmado desde Internet:** `POST https://practice-project-n8n-n8n.b3cnxu.easypanel.host/webhook/tai-lector-prod-zz` llegó a n8n (404 JSON propio de n8n). Traefik entrega **todas** las rutas `/webhook/…` de ese dominio a n8n y hoy **no hay ningún bloqueo** para el prefijo del lector.
- **Consecuencia:** al publicar el lector, la única barrera sería la cabecera secreta. No es aceptable: el requisito es que la ruta sea inaccesible desde Internet **incluso con la credencial correcta**.
- **Contexto conocido:** Traefik 3.6.7 monta `/etc/easypanel/traefik` como `/data`; su configuración dinámica generada por EasyPanel está en `config/main.yaml` (JSON, 16 routers, 5 middlewares, 6 servicios). **Bloque 7 [Comunicado]: `providers.file.directory=/data/config` y `watch=true`** → un archivo propio en esa carpeta **se carga** (queda por probar que EasyPanel no lo toca). n8n con `N8N_PROXY_HOPS=1`. Redes: `easypanel` (EasyPanel, Traefik, web, n8n **y también PostgreSQL y el runner**), `easypanel-practice_project_n8n` (n8n, PostgreSQL, runner), `easypanel-tradylor` (web), `ingress`. La imagen `n8nio/n8n:2.38.6` (la de producción) **ya está en el Docker local**.

## B. Solución recomendada: tres capas, con el bloqueo en Traefik como capa primaria
**Dónde va la regla:** en el **proxy exterior (Traefik)**, en un **archivo propio** de la carpeta de configuración dinámica, **no en `main.yaml`** (EasyPanel lo regenera) ni en etiquetas de Swarm (EasyPanel las reescribe al desplegar). La guía oficial de EasyPanel ([Custom Traefik Configuration](https://easypanel.io/docs/guides/custom-traefik-config)) indica crear `custom.yaml` en `/etc/easypanel/traefik/config/`; hay un [informe de usuarios](https://my.easypanel.io/feedback/post/critical-unable-to-enable-websockets-for-chatwoot-custom-traefik-config-is-ignored) de que ese archivo puede **ignorarse**, así que depende de que el proveedor de archivos de Traefik use `directory` y `watch` (la documentación de Traefik recomienda [`directory`](https://doc.traefik.io/traefik/v3.6/reference/routing-configuration/other-providers/file/) y avisa de que `watch` usa fsnotify y puede fallar con montajes). **Esto es lo primero que hay que confirmar.**

| Capa | Mecanismo | Qué cubre |
|---|---|---|
| **1 · Perímetro (obligatoria)** | Router de bloqueo en un archivo propio de Traefik: rutas `/webhook*/tai-lector-prod-…` (y su variante `-test`/`-waiting`), **cualquier host**, entrypoints `http` y `https`, **prioridad explícita** muy superior a la de los routers de n8n, y un *middleware* que **deniega a todos los orígenes** (`ipAllowList` con un rango inalcanzable). El Director no pasa por Traefik, así que no se ve afectado | Internet → n8n, **incluso con la credencial correcta** |
| **2 · Aplicación (defensa en profundidad)** | *Options → IP(s) Whitelist* en cada Webhook = la red/IP interna del Director (se configura **a mano al importar**; el linter solo admite `options: {}` en el archivo). Con `N8N_PROXY_HOPS=1` n8n toma como cliente la IP que **vio Traefik**, así que una petición externa no coincide con la red interna. El código de n8n 2.46.6 usa `net.BlockList` (admite rangos) y acepta si coincide `req.ip` **o** alguna de `req.ips` | Variantes de ruta que esquiven la regla de Traefik (la comprobación está en el nodo, no en la ruta). **Su comportamiento en 2.38.6 (rangos CIDR, uso de `req.ips`) no está verificado** |
| **3 · Credencial** | Header Auth exclusiva, ya diseñada | Quien llegue a la ruta aún necesita el secreto |

**Regla candidata** (NO definitiva hasta superar §C; la sintaxis de ruta con caracteres codificados y el comportamiento de `noop@internal` dependen de la versión y deben probarse):
```yaml
http:
  routers:
    tai-bloquear-lector-prod:
      rule: "PathRegexp(`(?i)^(?:/|%2f|%5c)+webhook.*tai-lector-prod-`)"
      entryPoints: [http, https]      # nombres reales: ver el bloque 7
      priority: 10000000
      middlewares: [tai-denegar-todo]
      service: noop@internal
  middlewares:
    tai-denegar-todo:
      ipAllowList:
        sourceRange: ["192.0.2.1/32"] # TEST-NET-1: nadie puede coincidir → 403 para todos
```
Notas: `(?i)` y `/+` cubren mayúsculas y barras repetidas (Express/n8n tolera ambas y un bloqueo sensible a mayúsculas se esquivaría con `/WEBHOOK/…`); el prefijo `webhook[^/]*` cubre `webhook`, `webhook-test` y `webhook-waiting`. Si Traefik compara con la ruta **codificada**, `%74ai-lector-…` podría esquivarlo: lo decide la matriz de §C.

**Alternativas descartadas o relegadas**
- *Editar `main.yaml`*: EasyPanel lo reescribe: no mantenible.
- *Solo IP whitelist de n8n / solo cabecera*: una sola capa y dependiente de la versión.
- *Quitar el dominio público de n8n*: elimina la interfaz web por Internet; decisión aparte.
- *Arquitectura «n8n empuja al Director»* (workflow con disparador programado que hace POST a un endpoint interno del Director; n8n sin webhook entrante): eliminaría el webhook, pero exige un disparador programado y una petición saliente (hoy prohibidos), un endpoint de **escritura** en el Director y cambia el contrato de los agentes. **Solo si la capa 1 resulta no verificable.**

**PostgreSQL / red del Director (CORREGIDO): no hay aislamiento de red respecto a PostgreSQL.** PostgreSQL y el runner están en la red `easypanel` junto a n8n, Traefik y la web, así que **cualquier servicio que EasyPanel cree se conectará a `easypanel` y podrá alcanzar el puerto de PostgreSQL**, esté en el proyecto que esté. Crear el Director en otro proyecto **no lo evita**. (La web, que da a Internet, ya está en esa misma situación hoy: el Director no empeora la exposición de red, pero tampoco la mejora.) Lo que protege a PostgreSQL es **su autenticación**, no la red.

| Opción | Qué garantiza | Coste |
|---|---|---|
| **1 · Director gestionado por EasyPanel (proyecto propio) + controles compensatorios** | Sin garantía de red. **Controles:** el Director **no recibe ninguna credencial ni variable de PostgreSQL** (ni de n8n salvo el token del lector); PostgreSQL exige contraseña a conexiones remotas (**comprobar solo lectura**: `pg_hba.conf` con `scram-sha-256`/`md5` y no `trust`, `listen_addresses`); contenedor sin privilegios (usuario no root, sistema de archivos de solo lectura salvo el volumen, `cap_drop ALL`, `no-new-privileges`, límites de recursos) **en la medida en que EasyPanel lo permita [Sin verificar]**; sin dominio ni puerto publicado | Mantenible y reversible; **el riesgo residual es de un Director comprometido que adivinara la contraseña de PostgreSQL** |
| **2 · Red dedicada `tai-lector` solo con n8n y el Director** | Aislamiento de red real: el Director **no** se une a `easypanel` | El Director se crea **fuera de EasyPanel** (`docker service create`) y n8n se une a la red con `docker service update --network-add` (**reinicia la tarea de n8n**); **EasyPanel puede sobrescribir la especificación de n8n en su siguiente despliegue y quitar la red** (el lector fallaría cerrado, pero habría que reaplicarla) y el Director deja de aparecer en su panel. Requiere ventana y autorización propias |
| **3 · Salida (push) de n8n al Director** | Sin webhook entrante en n8n | Rechazada por ahora (disparador programado, petición saliente y endpoint de escritura) |

**Recomendación:** opción 1 con los controles anteriores **y aceptación explícita del propietario** de que no hay aislamiento de red respecto a PostgreSQL; la opción 2 queda como mejora si se exige aislamiento de red. **Decisión pendiente (D-4).**

## C. Comprobaciones: qué está resuelto y qué falta
**Resuelto con el bloque 7 [Comunicado]:** el proveedor de archivos de Traefik vigila `/data/config` (`directory` + `watch`). **Queda confirmada la viabilidad de `custom.yaml`** (el caso de usuarios de EasyPanel en que se ignoraba era por no tener ese proveedor en modo directorio). Sigue abierto, para la prueba local y la prueba en el VPS:
1. **Sintaxis y semántica exactas en Traefik 3.6.7:** `PathRegexp` con `(?i)` y `/+`, `ipAllowList` como denegación total, `noop@internal`, prioridad frente a los routers de EasyPanel y tratamiento de rutas codificadas, dot-segments y `//`. → **prueba local con la misma versión** (propuesta abajo).
2. **Nombres reales de los entrypoints** (`http`/`https` por suposición) y **si Traefik confía en cabeceras `X-Forwarded-*` externas** (la cuarta línea del bloque 7 original: `entryPoints`, `forwardedHeaders`, `trustedIPs`, `insecure`): el propietario solo comunicó las dos líneas de `providers`. Hay que obtenerlas o confirmar que el archivo no define otros valores.
3. **Prioridad y reglas de los 16 routers** de `main.yaml` (que ninguno pueda casar antes que el bloqueo): `grep` del bloque 7 original, tercera línea.
4. **Que EasyPanel no borra ni reescribe `custom.yaml`** al desplegar o actualizar: solo comprobable en el VPS tras añadirlo (`ls -la --time-style=full-iso` antes/después de un despliegue de la web) y en la prueba local simulando la regeneración de `main.yaml`.
5. **PostgreSQL:** `pg_hba.conf`/autenticación (solo lectura) y que el Director no necesita nada de él (opción 1 de §B).
6. **n8n 2.38.6** (la imagen ya está en local, **sin descargas**): el código y el comportamiento de `ipWhitelist` (rangos, `req.ips`), Header Auth, registro de webhooks de producción con `webhookId`, `orderBy generadoEn DESC`, tope de `limit` y respuesta con 200 filas → **se comprueban en la misma prueba local**.

**Propuesta de prueba local:** ver `automation/dev/prueba-traefik/LEEME.md` (preparada, **no ejecutada**; solo descarga `traefik:v3.6.7`).

## D. Implantación y reversión (pendiente de aprobación; nada se ha hecho)
**Canario (generado y revisado por el linter estricto cuando se autorice):** workflow aparte, inactivo al importar, **sin tablas ni datos**: Webhook POST `tai-lector-prod-canario` + Respond `{"canario":true}`, con **credencial desechable propia** (distinta de la del lector, para no usar nunca el secreto real en pruebas externas) y la **misma IP Whitelist** del lector.

1. **Local:** Traefik 3.6.7 + n8n de pruebas, regla candidata y matriz de abajo → ajustar/aprobar la regla.
2. **VPS · añadir** `custom.yaml` (archivo nuevo; no se edita `main.yaml`) con la regla aprobada; comprobar en los registros de Traefik que se cargó sin errores y que los 16 routers y los sitios públicos (web, panel, n8n UI, webhooks legítimos) responden igual.
3. **Importar el canario** (nuevo, inactivo) y **publicar solo el canario**.
4. **Matriz de aislamiento (debe pasar entera):**
   - *Interior (desde el contenedor del Director, con la credencial del canario):* 200 + `canario:true`.
   - *Exterior (móvil/otra red), con y sin credencial del canario*, por **HTTPS y HTTP**, métodos POST/GET/HEAD/OPTIONS y variantes de ruta: exacta; `/WEBHOOK/…`; `//webhook//…`; barra final; `/./`; segmento codificado (`%74ai-…`); con parámetros; `/webhook-test/…`; `/webhook-waiting/…`; y por IP del VPS con `Host:` del dominio de n8n. **Esperado: respuesta de Traefik (403/404 de proxy) en todas; nunca el JSON del canario ni cuerpos propios de n8n** (`not registered`, `Authorization data is wrong`, `IP is not allowed`) para esas rutas.
   - *Rutas legítimas intactas:* interfaz de n8n, un webhook público existente, la web y el panel.
5. **Si falla cualquier celda:** despublicar el canario y retirar `custom.yaml`; no se publica el lector.
6. **Solo con la matriz correcta:** importar el lector (inactivo), credencial exclusiva, publicar, **repetir las filas exteriores sin credencial** (nunca con la del lector) y autorizar **una** lectura real por agente desde el Director.
7. **Repetir la matriz exterior** tras cada reinicio de Traefik, actualización de EasyPanel/n8n y redespliegue; guardar fecha, códigos y huella del cuerpo (sin datos).

**Reversión:** despublicar y borrar canario y lector → borrar su credencial → **borrar `custom.yaml`** (Traefik lo descarta al detectar el cambio) → retirar el IP Whitelist/credencial. `main.yaml`, los 7 workflows y las tablas no se han tocado, no hay nada que restaurar.

## E. Riesgos residuales
1. **PostgreSQL es alcanzable por red** desde cualquier servicio de `easypanel`, incluido el Director (§B). La barrera es su autenticación: hay que **confirmarla** (solo lectura) y aceptar el riesgo o pasar a la opción 2.
2. **Que EasyPanel borre o ignore `custom.yaml`** tras una actualización: por eso la matriz se repite tras cambios (§D.7) y se guarda una copia del archivo fuera del VPS.
3. **Variantes de ruta** que Traefik o n8n interpreten distinto: la matriz cubre solo la versión probada; la capa 2 (IP Whitelist) es la red de seguridad, **sujeta a lo que muestre el canario en 2.38.6**.
4. **Swarm *ingress* y la IP del cliente:** Traefik puede ver una IP interna de `ingress`; la capa 1 no depende de la IP (deniega a todos), pero la capa 2 sí. Si la IP Whitelist usara la subred de `easypanel`, también admitiría a los demás servicios de esa red (web, Traefik, PostgreSQL, runner): es acceso interno, no de Internet.
5. **Red `easypanel` compartida:** el Director es alcanzable desde la web y Traefik; mitigado con token y sin dominio.
6. **Una regla demasiado amplia** podría afectar a rutas legítimas: se acota al prefijo `tai-lector-prod-` y la prueba incluye controles de rutas públicas.
7. **La prueba local no sustituye a la del VPS** (mismo Traefik y n8n, pero no EasyPanel ni Swarm *ingress*): la matriz se repite en producción con el canario.
8. E-1 (validación del ledger en el VPS) y F9 siguen abiertos; F8 quedó SUPERADA con riesgos residuales documentados (16/11/2026).

## F. Siguiente operación que requiere autorización
**Autorizar la prueba local del bloqueo** (`automation/dev/prueba-traefik/`): **descargar `traefik:v3.6.7`** (única descarga; el resto de imágenes ya existe), crear una red y contenedores locales aislados con puertos solo en `127.0.0.1`, y ejecutar la matriz. Detalle, recursos, verificación y riesgos en `automation/dev/prueba-traefik/LEEME.md`. No toca el VPS ni producción.

> **Actualización 16/11/2026:** la regla vigente es la validada en la 5.ª ejecución local y el procedimiento para el VPS está en `AISLAMIENTO-VPS-PROCEDIMIENTO.md` (referencia, SHA-256, etapas, canario, reversión y supervisión).
>
> **Cierre de E0b (16/11/2026, SUPERADA; detalle en `AISLAMIENTO-VPS-PROCEDIMIENTO.md` §1h):** repetida en local con `forwardedHeaders.insecure=true` (como el VPS) y registro CLF, la **misma regla** (`custom.yaml`, SHA-256 `2f9c5b1b5bcba1b64683559f1b6e4be6a0c9caa52af1a7c038765d1f6113af39`, sin modificar) bloquea **132/132** rutas y **104/104** suplantaciones de cabeceras. El `informe.json` original (SHA-256 `453b771ac30fc0e1554d49a580bc1808c21da431394c80c2052201c6df49c048`) conserva su indicador «no validada» por un defecto del evaluador (contaba como fallo las ejecuciones del webhook público legítimo); la verificación complementaria `verificar-clf` (`informe-clf.json`, SHA-256 `a63ff9d25072c6256743a9e2e7303f2b8f26a43d66bee2a09a1cfc394a3b5dff`) lo resuelve: 9/9 bloqueadas con 0 ejecuciones, controles positivos y CLF correctos. **La prueba local no sustituye a la del VPS** (Swarm, `ingress`, modo `host` y router real de EasyPanel).
