# Guía operativa — primer despliegue controlado del Agente 04 «Calidad del catálogo» (n8n de producción)

> **Estado (13/11/2026, comunicado por el responsable; no verificado por el asistente):** esta guía se ha ejecutado de forma supervisada. Workflow, auxiliar, credencial y tabla creados; primera ejecución manual `ex-16` completada y guardada (línea base) y segunda `ex-18` (14/11/2026) con comparación correcta. Sin publicar ni programar. Resultados, limitaciones e incidencias abiertas en `AGENTE-04-CALIDAD.md` («DESPLIEGUE SUPERVISADO Y PRIMERA EJECUCIÓN REAL»).

**Estado: SOLO PREPARACIÓN (ETAPA 5, 13/11/2026). Nada de esto se ha ejecutado en el VPS ni en producción.** Cada paso marcado 🔒 requiere tu autorización expresa **en el momento**. Regla de oro: **mira nombres, no valores; no pegues secretos en ningún sitio** (ni en el chat, ni en capturas, ni en el JSON).

Decisiones aprobadas: mantener la petición marcador `limit=1&page=1` · política `lectura_catalogo` independiente · reutilizar la credencial existente `Treidilor — Catálogo (solo lectura)` · tabla propia `calidad_catalogo_instantaneas` (no se crea hasta el paso 3) · agente INACTIVO, sin Schedule ni webhooks.

## 0. Qué se despliega
| Pieza | Archivo / recurso | Notas |
|---|---|---|
| Workflow del agente | `automation/workflows/calidad-catalogo.produccion.json` | Inactivo. Solo disparador manual. 16 nodos (2 HTTP GET, 1 Wait de 7 s, 3 Data Table, 8 Code/Code mínimos, 1 nota, 1 disparador). |
| Workflow de preparación | `automation/workflows/calidad-instantaneas-crear-tabla.json` | Inactivo. Solo crea la tabla propia (idempotente). Sin red ni credenciales. |
| Credencial | `Treidilor — Catálogo (solo lectura)` (Header Auth, **ya existe**; solo se SELECCIONA) | No se crea, no se edita, no se rota en este despliegue. |
| Data Table | `calidad_catalogo_instantaneas` (8 columnas de texto) | Propia del agente. **No** se toca `auditor_general_instantaneas`. |

Huellas SHA-256 de los archivos (calculadas sobre el contenido con saltos de línea LF; comprueba que coinciden ANTES de importar):
```
calidad-catalogo.produccion.json            16a3390ac1ca54dfc3d3fb01db6e88ad0e03c4b066459f8fb9aa32b7fd04d04f
# (versión del repositorio con la regla C3 `comercio_malformado`, 14/11/2026, NO desplegada. La versión DESPLEGADA en producción, sin C3 (ejecuciones ex-16 y ex-18), tiene la huella c4126e6ff548ac29f49c411a4e624c0cc0daa076faf76f3bc7f40e3b2161ac42.)
calidad-instantaneas-crear-tabla.json       ed32125f19d5bd1115486fca40d41f3d90e92cf05da58bbbad82281214c94eb1
```
Comprobación: `node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync(process.argv[1],'utf8').replace(/\r\n/g,'\n')).digest('hex'))" automation/workflows/<archivo>`

## 1. Requisitos de la credencial (sin valores)
- **Nombre exacto:** `Treidilor — Catálogo (solo lectura)` (con la raya «—»). El comprobador del repositorio exige que acabe en «(solo lectura)».
- **Tipo:** Header Auth. **Nombre de cabecera:** `Authorization`. **Valor:** `Bearer ` + el token del cliente de automatización (forma `tai_<16 hex>_<43 caracteres>`). **El valor nunca se copia, se pega ni se captura.**
- **Cliente de la API en Treidilor:** `n8n-calidad` · alcance único `catalog:read` · 10 peticiones/minuto · 500/día · caducidad prevista ≈ 13/12/2026 (anótala: pasada esa fecha el feed responde 401; la rotación se hace con `F2C-ROTACION-TOKEN-RUNNER.md`, no aquí).
- En el JSON el nodo lleva `{ id: "REEMPLAZAR_AL_IMPORTAR", name: "Treidilor — Catálogo (solo lectura)" }`: un id de relleno. **Tras importar hay que seleccionar la credencial existente en los dos nodos HTTP** (paso 2); n8n no la enlaza solo por el nombre.
- Esta credencial **solo debe usarla el Agente 04**. Si otro workflow o persona la usa, comparte los límites (ver §3).

## 2. Límites y intervalo mínimo seguro entre ejecuciones manuales
Cómo cuenta el servidor (`src/lib/rateLimit.ts`, `src/lib/automationApi.ts`): **ventana fija de 60 s por cliente** que se abre con la primera petición (máx. 10 por ventana) y **cuota diaria por día UTC** (500). Los contadores viven en memoria: un reinicio del servicio los pone a cero. Una petición rechazada por el límite por minuto **no** descuenta de la cuota diaria; los fallos de autenticación (401) cuentan contra el bloqueo temporal por IP.

| Límite | Cómo lo respeta el workflow | Dónde se comprueba |
|---|---|---|
| 10 peticiones/min | Una ejecución hace como máximo 8 peticiones (≤ 8 páginas), las páginas 2…8 con 7 s entre ellas (42 s). El catálogo actual (131 productos) son **2 peticiones**. | Prueba «límites» (reloj virtual) |
| 500 peticiones/día | Peor caso 8 peticiones por ejecución → 62 ejecuciones; con el catálogo actual 250. Recomendado: **≤ 20 ejecuciones manuales al día** (≤ 160 peticiones en el peor caso, 32 % de la cuota). | Prueba «cuota diaria» |
| Máx. 8 páginas | `maxPaginasCatalogo = 8` en la configuración y en la política; con 801 productos solo se piden 8 páginas y el resultado es «parcial» (no se guarda). | `validarProduccionCalidad`, prueba 801 |
| Pausa mínima 7 s | Un nodo **Wait** de 7 s (`Pausa entre páginas`, por intervalo en segundos, sin webhook) separa la página 1 del resto, y `batchInterval = 7000`, `batchSize = 1` separa las demás; sin reintentos. **Medido en n8n 2.38.6 local: hueco mínimo entre dos GET = 7,001 s** (de 7,001 a 7,073 s en todas las ejecuciones, incluida la petición marcador). | Pruebas «Wait» y ejecuciones en n8n real local |

**Intervalo mínimo seguro:** deja **al menos 2 minutos entre el inicio de una ejecución y el de la siguiente** (y ≥ 60 s desde la última petición de la anterior si leyó 8 páginas). Una ejecución de 8 páginas dura ≈ 50 s (7 pausas de 7 s) y una de 2 páginas ≈ 8 s. Teóricamente bastan ~53 s si la ventana está alineada con la primera ejecución, pero no se recomienda apurarlo: otras peticiones del mismo token abren la ventana en otro momento, y a 40 s de separación dos ejecuciones de 8 páginas ya superarían las 10/min. **No lances dos ejecuciones a la vez** ni reintentes una fallida de inmediato.
Presupuesto compartido: si el token lo usa algo más (otro workflow, otra persona, la consola), réstalo de los 500/día y de las 10/min antes de lanzar.

## 3. Pasos (🔒 = necesita tu autorización explícita en ese momento)
### Paso 0 · Comprobaciones previas
Solo lectura; anota nombres y valores no secretos.
1. 🔒 n8n de producción: versión **2.38.6** (About n8n); la edición permite **Data Tables** (menú del proyecto → pestaña *Data tables*); proyecto/usuario con permiso de crearlas.
2. 🔒 n8n: **0 workflows activos** que no reconozcas; ningún workflow llamado «Treidilor AI · Calidad…» ya existente; la credencial `Treidilor — Catálogo (solo lectura)` existe (solo el nombre).
3. 🔒 Treidilor (panel `/upayp1b4`, solo lectura): API de automatización activa, cliente `n8n-calidad` **activo y no caducado** (días restantes), límites 10/min y 500/día; `/api/health` con `status: ok`.
4. Copia de PostgreSQL de n8n reciente (F1) y `N8N_ENCRYPTION_KEY` respaldada fuera del VPS: la importación y la tabla escriben en la base de n8n.
5. Runner de Code: producción usa un runner EXTERNO (`n8nio/runners:2.38.6`, `N8N_RUNNERS_MODE=external`; F2B/F2C). El agente se probó con un runner externo **reproducido en local** (mismo paquete `@n8n/task-runner`, contenedor aparte; ver §5 y los límites de esa reproducción). Los nodos Code del agente pesan hasta ≈ 57 kB (límite del linter 80 kB). Comprueba que el runner de producción está conectado (log de n8n: «Registered runner») antes de ejecutar.
6. Huellas SHA-256 de los dos archivos (arriba) coinciden. El repositorio está en el commit acordado.
**Parar si:** versión distinta de 2.38.6, sin Data Tables, token caducado/revocado, workflows activos desconocidos, o huellas distintas.

### Paso 1 · 🔒 Importar el workflow INACTIVO
1. n8n → *Workflows* → ⋯ → *Import from file* → `calidad-catalogo.produccion.json`.
2. Comprueba al importar: nombre «Treidilor AI · Calidad del catálogo v0 (produccion)», **interruptor «Active» apagado**, ningún nodo con «?» (tipo desconocido). **No pulses «Publish»/«Activate».** No lo ejecutes todavía.
3. Importa también `calidad-instantaneas-crear-tabla.json` (inactivo).

### Paso 2 · 🔒 Vincular la credencial existente (sin modificarla)
1. Abre el nodo **«Pedir catálogo»** → *Credential for Header Auth* → selecciona `Treidilor — Catálogo (solo lectura)`.
2. Repite en **«Pedir catálogo (resto)»**. Guarda el workflow.
3. No abras ni edites la credencial. No hay otro nodo con credenciales (si alguno la pide, detente).
4. Verifica sin ver el valor: ambos nodos muestran el nombre exacto; el JSON exportado (⋯ → *Download*) contiene el **nombre**, nunca `tai_` ni `Bearer`.

### Paso 3 · 🔒 Crear la Data Table propia
1. Abre «Treidilor AI · Calidad · crear tabla de instantáneas» → **Execute workflow** (una vez). Es idempotente: una segunda ejecución no duplica la tabla.
2. Verifica en *Data tables*: existe **solo** `calidad_catalogo_instantaneas`, con las 8 columnas de texto `entorno, host, generadoEn, idEjecucion, origen, calidad, huella, payload`, **0 filas**. `auditor_general_instantaneas` (si existe) no se ha tocado.
3. Alternativa manual: crear la tabla en la interfaz con esas 8 columnas de texto.

### Paso 4 · Verificar que no hay disparadores automáticos
1. En el workflow del agente: el único disparador es **«Ejecutar a mano»**; no hay Schedule, Webhook, Cron ni Execute Workflow.
2. En *Workflows*: ambos «Treidilor AI · Calidad…» figuran como **Inactive**.
3. (Opcional, solo lectura, 🔒 en el VPS) `select name, active from workflow_entity where name like 'Treidilor AI · Calidad%'` → `active = false` en todos.

### Paso 5 · 🔒 Primera ejecución manual SUPERVISADA
Precondiciones: pasos 0-4 correctos y tu autorización escrita para esta ejecución; no hay otra ejecución en curso; ≥ 2 minutos desde cualquier otro uso del token.
1. *Execute workflow* desde «Ejecutar a mano». **Una sola vez.**
2. Esperado: ≈ 8-10 s (incluye la pausa de 7 s del nodo Wait); todos los nodos en verde; «Pedir catálogo» 1 petición, «Pausa entre páginas» una espera de 7 s y «Pedir catálogo (resto)» 1 petición (131 productos → 2 páginas); «Leer historial» 0 filas; «Guardar instantánea» sale por la rama de éxito.
3. En Treidilor (panel, solo lectura): en el registro de auditoría de la API aparecen **2 peticiones** del cliente `n8n-calidad`, ambas 200, rutas `/api/automation/v1/catalog?limit=100&page=1|2`.
**Parar de inmediato (sin reintentar) si:** 401/403 (token), 429 (límite), nodo en rojo, más de 2 peticiones inesperadas, o cualquier salida distinta de la esperada.

### Paso 6 · Comprobar el informe
En la salida de **«Confirmar escritura»** (informe definitivo):
- `persistencia.tabla.estado = "ok"`; `persistencia.lectura.filas = 0`; `persistencia.escritura.resultado = "guardada"` con un `filaId` numérico; `origen = "manual"`; `idEjecucion = "ex-<id de la ejecución>"`.
- `seguimiento.modo = "linea_base"`, `motivo = "primera_ejecucion"`; `seguimiento.calidad.estado = "completa"`.
- `cobertura`: `paginasLeidas = totalPaginas = 2`, `completo = true`, sin `errores` ni `inconsistencias`; `productosLeidos` = total del catálogo (131 al redactar esta guía).
- `resumen.peticiones = 2`. Las incidencias son las del catálogo real: **es una línea base, no una lista de tareas**; los umbrales aún no están calibrados con datos reales (no actuar en masa sobre ella).
- El informe en Markdown (`markdown`) no contiene `tai_`, `Bearer` ni la credencial. Nada se ha escrito en Treidilor.

### Paso 7 · Confirmar la primera instantánea
En *Data tables → calidad_catalogo_instantaneas*: **exactamente 1 fila** con `entorno = produccion`, `host = treidilor.com`, `idEjecucion = ex-<id>`, `origen = manual`, `calidad = completa`, `huella` de 64 caracteres hexadecimales, y `payload` con JSON válido (≈ 5-10 kB). Busca `tai_` y `Bearer` en el payload: **no deben aparecer**. Si hay 0 filas con resultado «guardada», o más de 1, **detente** y no vuelvas a ejecutar.

### Paso 8 · Desactivación o retirada (en orden de menos a más drástico)
| Acción | Efecto | 🔒 |
|---|---|---|
| No volver a ejecutar | El agente está inactivo: no hace nada solo | — |
| Revocar el cliente `n8n-calidad` (panel de Treidilor) | El feed devuelve 401 de inmediato; el agente deja de leer | 🔒 |
| Archivar/eliminar el workflow del agente en n8n | Retira el agente | 🔒 |
| Exportar y eliminar la Data Table `calidad_catalogo_instantaneas` | Borra la memoria histórica (**exporta antes**) | 🔒 |
| Eliminar la credencial | **No** forma parte de este despliegue; solo si es exclusiva y con tu autorización | 🔒 |
Reversión completa: borrar los dos workflows y la tabla. **No hay nada que revertir en Treidilor** (el agente no escribe ni cambia configuración).

## 4. Acciones que requieren tu autorización explícita
Todo lo marcado 🔒: consultas en el VPS/n8n/panel de producción; importar los dos workflows; seleccionar la credencial en los nodos HTTP; crear la Data Table; la primera ejecución (y cada ejecución posterior); cualquier activación, programación o webhook (**no previstos**); revocar/rotar el cliente o el token; eliminar workflows, tabla o credencial; reiniciar servicios. **Nunca** sin autorización: activar el workflow, añadir Schedule/webhooks, tocar el Auditor General o su tabla, modificar la credencial, ejecutar con otra cuenta o fuera de las ventanas acordadas.

## 5. Compatibilidad con n8n 2.38.6
Tipos y versiones de nodo: los del Auditor de producción (`manualTrigger` v1, `code` v2, `httpRequest` v4.2, `dataTable` v1.1, `stickyNote` v1) **más el nodo Wait v1.1**, que el Auditor no usa (nodo del núcleo de n8n; por intervalo en segundos, sin webhook; validado en n8n 2.38.6 local: importa sin «?», espera 7 s y continúa). El agente se validó de extremo a extremo en **n8n 2.38.6 + PostgreSQL 17** (entorno local aislado `tai-prueba-dt`, 13/11/2026), primero con el runner interno (32 ejecuciones iguales al simulador) y después, con el Wait, con un **runner externo reproducido** (ver abajo).

**Runner externo (reproducción local, 13/11/2026).** n8n en `N8N_RUNNERS_MODE=external` + un contenedor aparte con el paquete `@n8n/task-runner` 2.38.2 (el ejecutor JavaScript que también usa `n8nio/runners`) autenticado en el task broker con un token solo de pruebas. Comprobado: sin el runner los nodos Code NO se ejecutan («Task request timed out» a los 61 s, sin peticiones ni escritura); con él, el agente local y la copia de producción (con respuestas sintéticas, sin red) funcionan y dan el informe del simulador. **Límite honesto:** no es la imagen oficial `n8nio/runners:2.38.6` (no estaba en el PC y no se descargó), ni su lanzador (`task-runner-launcher`: aquí lo sustituye un lanzador mínimo de pruebas) ni su configuración de permisos/variables. El código del agente no usa `require` ni módulos externos. Queda pendiente la primera ejecución real en el runner de producción (paso 5).

Lo que **no** se ha podido comprobar y queda como riesgo: la imagen oficial del runner de producción, y cualquier diferencia de configuración del n8n real (variables, límites de almacenamiento de Data Tables, retención de ejecuciones). Si el paso 0 detecta una diferencia de versión o de módulo, **detente** y documéntala antes de continuar.
