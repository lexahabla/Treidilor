# Lector de PRODUCCIÓN de instantáneas (agentes 04 y 12): diseño, seguridad y despliegue

**Estado (15/11/2026): PREPARADO EN LOCAL. NO importado, NO publicado, NO ejecutado en producción.** Nada de lo que sigue se ha comprobado en el VPS, en EasyPanel ni en el n8n de producción: lo que se afirma sobre ellos se rotula **[Comprobado]**, **[Documentado]** o **[Sin verificar]**.

## 1. Qué se ha preparado (todo con archivos NUEVOS; los protegidos no se tocan)
| Pieza | Archivo |
|---|---|
| Lógica pura de producción (entorno único, ventana de la solicitud, selección por fecha, rechazo de lecturas truncadas) | `automation/lib/lectorProduccion.mjs` (reutiliza `lectorPuente.mjs`) |
| Workflow de producción, inactivo, **generado** | `automation/workflows-puente/produccion/lector-instantaneas.produccion.json` (subcarpeta: el linter general **no** la recorre y sigue rechazando cualquier variante de producción) |
| Constructor / linter estricto | `scripts/automation/build-lector-produccion.mjs` (`--write`/`--check`) · `scripts/automation/lint-lector-produccion.mjs` |
| Cliente interno del Director | `automation/director/puente/lector-produccion.mjs` (`crearLectorProduccion`) y `--n8n-produccion … --hosts …` en `scripts/automation/puente.mjs` |
| Pruebas | `automation/director/tests/f20-lector-produccion.test.mjs` (14) |

`build-workflows.mjs`, `lint-workflows.mjs`, los **siete workflows originales** y el lector local **no se han modificado** (el lector local sigue inactivo y su linter intacto). **No hace falta modificar ningún archivo protegido.** Si más adelante se quisiera que el linter general también cubra la variante, sería un cambio aparte que se presentaría antes de aplicarlo.

### Cómo es el workflow
Dos Webhooks POST (`/webhook/tai-lector-prod-04` y `…-12`), cada uno: **Webhook (credencial exclusiva) → Code «Validar solicitud» → Data table «Get» → Code «Armar respuesta» → Respond to Webhook**.
- Una sola tabla fija por agente (`calidad_catalogo_instantaneas`, `auditor_general_instantaneas`), por nombre, filtro `entorno = produccion` (el valor ya validado), ≤ 200 filas, ordenadas por `generadoEn` descendente. **Solo `row/get`**: sin insertar, actualizar ni borrar, sin HTTP saliente, sin disparadores manuales o programados, sin reintentos.
- «Armar respuesta» **no depende del orden**: descarta (y cuenta) filas de otro entorno, sin `idEjecucion`, con `generadoEn` ilegible o futuro (> 5 min) o demasiado grandes; ordena por la fecha **parseada** (desempate por `idEjecucion`) y devuelve solo las `limite` más recientes (≤ 60). Si el origen devolviera tantas filas como el límite de lectura (200) **se niega** (`LECTURA INCOMPLETA`): no puede asegurar que la más reciente esté incluida.
- No guarda datos de ejecución (`saveData*: none`): las filas de producción no quedan copiadas en el historial de n8n. `executionTimeout` 60 s. Respuesta sin datos extra: solo las 8 columnas del historial (+ `id`).
- El archivo **no contiene secretos**: la credencial se referencia por nombre y con `id` de marcador (`REEMPLAZAR_AL_IMPORTAR`); el linter rechaza cualquier cosa con forma de secreto.

## 2. Seguridad de la comunicación
| Requisito | Cómo se cumple | Límite honesto |
|---|---|---|
| Solo comunicación interna | `crearLectorProduccion` exige lista explícita de hosts y **rechaza dominios públicos** (solo bucle local, red privada o nombre de servicio sin puntos); ruta base `/webhook` (nunca `/webhook-test`); sin redirecciones | Es una barrera del **cliente**. No impide que alguien llegue al webhook por otro camino: ver §3 |
| Credencial exclusiva | `Treidilor — Lector puente PRODUCCIÓN (solo lectura)`, Header Auth con cabecera **`x-treidilor-lector-prod`** (distinta de la local); el linter rechaza la del lector local | El valor se crea a mano en n8n y el Director lo lee de `TAI_LECTOR_PROD_TOKEN` (variable de entorno o archivo fuera del repositorio) |
| Sin secretos en archivos / sin `TRADYLOR_API_TOKEN` | El JSON no lleva valores; el token nunca va por argumento ni se registra; no se usa la API de la web | — |
| Validación de solicitud y respuesta | El mismo código valida en n8n y en el Director: esquema cerrado, agente/entorno/límite, eco de `idSolicitud`, agente, tabla y entorno, filas sin columnas extra, `sintetico:false` obligatorio en producción | El Director trata lo que devuelve n8n como dato no fiable |
| Repetición / idempotencia | La solicitud lleva `emitidoEn`; n8n rechaza (500) una solicitud fuera de ±2 min; `idSolicitud` único por petición y respuesta atada a él; la lectura es idempotente (solo lectura) | Dentro de los 2 min una captura **puede reenviarse** y obtener la misma lectura (solo lectura); n8n no guarda estado de nonces (haría falta escritura) |
| Tamaño, tiempo, frecuencia | Respuesta ≤ 2 MiB, tiempo de espera 10 s, ≤ 20 peticiones/min en el cliente (+ caché de 30 s), ≤ 60 filas, payload ≤ 200 000 caracteres, timeout del workflow 60 s | No hay limitador de frecuencia **dentro de n8n**: depende del cliente y del proxy |
| Respuestas mínimas | Solo columnas del historial; sin ejecuciones guardadas; errores sin detalles de datos (500 genérico) | El `payload` contiene claves de incidencias con rutas/URL públicas del sitio |
| Procedencia | El Director rotula `LECTURA DE PRODUCCIÓN`, etiqueta `real_produccion`, y repite que el **estado actual NO está verificado**; no es «prueba», ni «saneada», ni «copia» | La consistencia de las dos lecturas es una comprobación de coherencia, no una verificación de que el dato sea cierto |

## 3. Aislamiento: ¿alcanzable desde Internet? **No se puede dar por garantizado**
- **[Documentado]** n8n corre en Swarm, sin puertos publicados (5678 no publicado; 80/443 son de Traefik) y con **dominio público con HTTPS** en EasyPanel (el propio proyecto lo usa: `N8N_CLICK_WEBHOOK_URL=https://<tu-n8n>/webhook/…`; la guía del Auditor lista «dominio público de n8n» como comprobación).
- **Consecuencia:** una URL *interna* del Director **no impide** que `https://<dominio-n8n>/webhook/tai-lector-prod-04` llegue al mismo webhook a través de Traefik: Traefik enruta **todas** las rutas del dominio a n8n. Una vez publicado, quedaría protegido **solo** por la cabecera secreta.
- **[Sin verificar]** si hoy hay una regla en Traefik/EasyPanel que lo impida; no hay acceso al VPS ni a EasyPanel para comprobarlo.

**Modificación mínima propuesta (NO ejecutada): bloquear en Traefik, para fuera, las rutas del lector.** Un archivo de configuración dinámica de Traefik (en EasyPanel, normalmente `/etc/easypanel/traefik/config/` **[Sin verificar]**; la sintaxis depende de la versión de Traefik **[Sin verificar]**):
```yaml
http:
  routers:
    tai-bloquear-lector-prod:
      rule: "PathPrefix(`/webhook/tai-lector-prod-`) || PathPrefix(`/webhook-test/tai-lector-prod-`)"
      entryPoints: [http, https]
      priority: 100000
      middlewares: [tai-solo-interno]
      service: noop@internal
  middlewares:
    tai-solo-interno:
      ipAllowList:            # Traefik v3 (en v2: ipWhiteList)
        sourceRange: ["127.0.0.1/32"]
```
El Director llega por la red interna sin pasar por Traefik, así que no se ve afectado. Es una **adición** (no cambia rutas existentes) y se revierte borrando el archivo. Capa adicional opcional en cada Webhook: *Options → IP(s) Whitelist* con la IP/red interna del Director, **configurada a mano al importar** (es un dato del entorno; el linter solo admite `options: {}` en el archivo).

## 4. Arquitectura de red propuesta (decisión del propietario pendiente)
**Hecho clave: hoy el Director NO está en el VPS** (corre en el PC del propietario, solo en `127.0.0.1`). «Comunicación exclusivamente interna» exige que el Director o un túnel esté dentro de la red del VPS.
| Opción | Descripción | Coste / riesgo |
|---|---|---|
| **A (recomendada como destino)** | Ejecutar el servicio del Director (`puente.mjs`, solo lectura) como servicio de EasyPanel **en la misma red que n8n**; URL `http://<servicio-n8n>:5678/webhook` (nombre DNS interno de Swarm, probablemente `<proyecto>_n8n` **[Sin verificar]**) | Un servicio nuevo en producción (autorización y diseño propios); el ledger del Director viviría en un volumen |
| **B (transitoria)** | Túnel SSH desde el PC con una clave **dedicada y restringida** (`restrict,port-forwarding,permitopen="127.0.0.1:5678"`, sin shell) hacia un puerto de n8n publicado **solo en 127.0.0.1 del host** | Requiere un usuario/clave nuevos y un cambio de puertos de n8n en EasyPanel; choca con el SSH tal como está (F8 superada con riesgos residuales el 16/11/2026) y con el endurecimiento actual (`tai-inspect` tiene el reenvío desactivado). Si el puerto se publicara en `0.0.0.0` dependería solo del cortafuegos de Hostinger |
| **C (descartada)** | Usar la URL pública `https://<dominio-n8n>` con cabecera secreta y lista de IP | No es «exclusivamente interna»: una sola barrera |
En cualquiera de las tres, **el bloqueo de Traefik del §3 sigue siendo necesario**.

## 5. Procedimiento de despliegue (solo cuando el propietario lo autorice, paso a paso) y reversión
**Antes (sin cambiar nada)**
1. Desde un equipo **fuera** de la red (4G): `curl -si https://<dominio-n8n>/webhook/tai-lector-prod-04`. n8n responde 404 JSON («webhook … not registered») ⇒ el proxy **sí** llega a los webhooks ⇒ el bloqueo es imprescindible. Una respuesta de Traefik (404 «page not found»/403) ⇒ ya está filtrado. Anotar el resultado.
2. Con acceso al VPS: nombre del servicio n8n y red (`docker service ls`, `docker network ls`, `docker service inspect <n8n> --format '{{json .Spec.TaskTemplate.Networks}}'`), versión de Traefik, ruta de su configuración dinámica, y que el 5678 no está publicado (`ss -tuln`). **[Requiere acceso al VPS: no disponible]**
3. Confirmar en n8n 2.38.6 que el nodo Data table ofrece «Order By» (la variante local de prueba es 2.46.6) y que las tablas existen con exactamente esos nombres; no se leen datos.

**Despliegue**
4. Aplicar el bloqueo del §3 (Traefik) y repetir el `curl` externo: debe dar 403/404 **de Traefik** incluso con la ruta aún sin publicar. Si no se puede garantizar → **parar aquí**.
5. Crear en n8n la credencial **Header Auth** `Treidilor — Lector puente PRODUCCIÓN (solo lectura)` (cabecera `x-treidilor-lector-prod`, valor aleatorio de ≥ 32 bytes generado en el momento; guardarlo solo en un archivo fuera del repositorio con permisos restringidos o en una variable de entorno).
6. Importar `lector-instantaneas.produccion.json` **como workflow nuevo** (nunca sobre un existente), asignar la credencial a los dos Webhooks y **dejarlo inactivo**. Comprobar que los 7 workflows existentes, su estado (activo/inactivo), las tablas y sus filas **no cambian** (recuento de filas antes/después, sin leerlas).
7. Publicar **solo** este workflow (desde la interfaz no hace falta reiniciar; por CLI sí, y afectaría a lo que esté activo: preferir la interfaz) y probar **una lectura por agente** desde el Director (`TAI_LECTOR_PROD_TOKEN=… node scripts/automation/puente.mjs servir --n8n-produccion http://<servicio-interno>:5678/webhook --hosts <servicio-interno>`): debe salir `LECTURA DE PRODUCCIÓN`, `ex-19` (04) y `ex-17` (12) o las más recientes, consistencia `confirmada`.
8. Repetir el `curl` externo con y sin cabecera: sigue siendo 403/404 de Traefik.

**Reversión (si cualquier comprobación falla o ante la duda):** despublicar el workflow (y reiniciar n8n), borrarlo, borrar la credencial, retirar el archivo de Traefik, rotar/eliminar el token. Las tablas y los demás workflows no se han tocado, así que no hay nada que restaurar en ellos. El lector local y sus pruebas siguen siendo independientes.

## 6. Qué requiere acceso al VPS (no disponible hoy)
Pasos 1–2–4–8 de §5 salvo el `curl` externo (que puede hacerlo el propietario desde su móvil), nombres de servicio/red, configuración de Traefik y su versión, el Order By de n8n 2.38.6, la relación con las claves/sshd (opción B) y E-1 (validación final del ledger en Linux), que **sigue pendiente**.

## 7. Estado de lo demás (sin cambios)
E-1 pendiente en el VPS · F8 superada con riesgos residuales (16/11/2026) · F9 sin autorizar · el lector local sigue inactivo · no se ha usado ninguna credencial ni acceso de producción · sin commits ni push.
