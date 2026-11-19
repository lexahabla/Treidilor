# Agente 04 — Calidad del catálogo (v0 «detectar»): ETAPAS 1 y 2 (motor local y su validación)

Estado: **DESPLEGADO en producción de forma supervisada y con DOS ejecuciones manuales correctas: `ex-16` (13/11/2026, línea base) y `ex-18` (14/11/2026, comparación)**, comunicadas por el responsable del proyecto (ver «DESPLIEGUE SUPERVISADO Y PRIMERA EJECUCIÓN REAL» y «SEGUNDA AUDITORÍA MANUAL SUPERVISADA», al final). Sin publicar y sin programación automática. Las secciones anteriores describen el desarrollo y la validación LOCAL (etapas 1-5), que siguen vigentes.

## Qué es
Módulo PURO y determinista (`automation/lib/calidadCatalogo.mjs`, sin red, disco, reloj, IA ni coste) que analiza el feed `automation-catalog/1` ya leído por n8n y produce el informe `informe-calidad/1` (`automation/schemas/informe-calidad.schema.json`). Solo lectura: no modifica nada y no inventa datos que el feed no traiga.

## Reparto con el Auditor General (que NO cambia)
El Auditor supervisa la disponibilidad del sistema (en producción, modo `publico`, sin catálogo). El Agente 04 lee el feed y evalúa la calidad por ficha. Reutiliza del Auditor `leerCatalogo`, `emparejar`, `incidencia`, `imagenAceptable` y `markdownSeguimiento` (solo se añadió `export` a tres de ellas: el constructor lo elimina y **los workflows del Auditor son idénticos**, comprobado con `build-workflows --check`) y el motor `seguimiento.mjs` entero. No se editó `common.mjs`, `urlPolicy.mjs` ni `seguimiento.mjs` (están incrustados en los workflows del Auditor: cualquier cambio alteraría su JSON).

## Política de URLs `lectura_catalogo` (`urlPolicyCalidad.mjs`, política HERMANA de `urlPolicy.mjs`)
Solo HTTPS (http solo en local y sobre el host local declarado), UN host exacto, ruta `/api/automation/v1/catalog`, método GET sin cuerpo ni redirecciones, parámetros únicos `limit` (1-100) y `page` (1-8) en forma canónica, cabeceras declaradas (la autenticación la pone la credencial de n8n por nombre). `validarConfigCalidad` exige además un único host, respetar `peticionesPorMinuto` con `pausaMs` y una tabla propia distinta de la del Auditor. El modo `publico` del Auditor sigue rechazando catálogo y fichas.

## Contrato del feed y certezas (30 reglas)
- **Confirmado:** el contrato permite acreditar el defecto. Un campo anulable que llega a `null` es una ausencia acreditada: `precio_ausente`, `sin_categoria`, `sin_imagen`, `sin_descripcion` (longitud 0)… además de **`comercio_malformado`** (C3, 14/11/2026: `merchant` es exactamente «[object Object]», en cualquier red; informa id, red declarada y campo; solo informa, no repara ni presume la red), `precio_extremo`, `precio_anterior_menor`, `imagen_no_segura`, `valoracion_incoherente`, `fecha_futura`, `id_duplicado`.
- **Advertencia (dato existente pero sospechoso):** `precio_atipico`, `titulo_incompleto`, `titulo_largo`, `categoria_sin_id`, `sin_subcategoria`, `descripcion_corta`, `descuento_sospechoso`, `enlace_afiliado_ausente` (solo donde ≥ 90 % de su red lo tiene), `captura_ausente`, `captura_antigua`, `verificacion_antigua`, `posible_duplicado`.
- **No verificable (info, no puntúa, no es defecto):** `descuento_declarado`, `valoracion_por_defecto`, `stock_desconocido`, `verificacion_ausente`, `enlace_afiliado_no_calibrable`, `titulo_igual_no_duplicado` y **`campo_no_entregado`** (el campo no llega o llega con un tipo que el contrato no admite: no se puede acreditar y las reglas que dependen de él no se aplican).
- **Conjunto:** `feed_no_disponible`, `feed_parcial`, `reduccion_brusca`.
Sin categoría o red conocida no se forman grupos (mediana, subcategoría, afiliación). Prioridad = peso × certeza (1 / 0,6) × factor del producto → P1-P4; una advertencia persistente sube un 25 %. Sin tráfico no hay prioridad por visitas.

## Duplicados y comparación entre comercios
**Se conservan siempre todas las ofertas** (sirven para comparar precios); nunca se fusiona ni se propone eliminar. Par «posible duplicado» solo con misma red + mismo comercio CONOCIDO + título igual (o mismos términos en otro orden, o diferencia únicamente en palabras de relleno comercial) + mismos dígitos (modelo/capacidad/cantidad) + misma categoría + precio parecido. Mismo título en otro comercio/red, con comercio desconocido o con otro precio: solo informativo (`titulo_igual_no_duplicado`). Colores, tallas, capacidades, packs, lados y modelos distintos nunca se relacionan.

## Integridad del feed (solo «completo» si todo cuadra)
Todas las páginas 1..N, `total` y `totalPages` coherentes entre sí y entre páginas, cada página con el nº de productos que le corresponde, tantos productos como `total`, ≥ 1, todos con identificador, y ningún id repetido ENTRE páginas (la paginación pudo desplazarse; un id repetido dentro de una página con el total cuadrando sí es `id_duplicado`). Errores 401/403 (credencial), 429 (límite), tiempo agotado y red tienen su motivo; los textos de error se ocultan (`Bearer`, `tai_…`, claves). Tope de 8 páginas (800 productos). Una ejecución incompleta **no se guarda** y **no resuelve** nada.

## Seguimiento
Claves `ficha:codigo:idProducto` (área `ficha`) y `catalogo:codigo`: una incidencia solo se da por resuelta si su ficha se leyó; si el producto desaparece queda «no verificada» y caduca a las 7 ejecuciones. `alcance.salud` = «el feed respondió». La instantánea se rotula `calidad-catalogo` y mantiene el límite de 60 KB (si no cabe, no se guarda con motivo `instantanea_demasiado_grande` y la referencia válida se conserva). El informe lista las 300 incidencias de mayor prioridad y 100 por lista del seguimiento (el recuento completo queda en `resumen` y `seguimiento.omitidas`). Tabla prevista (aún NO creada): `calidad_catalogo_instantaneas`.

## Tamaño en n8n (poda medida)
Dos nodos Code: «Analizar» ≈ 35,7 kB e «Informe» (`construirInformeDesdeAnalisis`) ≈ 53,2 kB, más «Confirmar escritura» ≈ 13,7 kB (en un solo nodo serían ≈ 80 kB, sin margen frente al límite de 80 kB). `build-workflows.mjs` registra el agente `calidad` en `ORDEN` (inerte: no genera ningún workflow todavía).

## Pruebas (108 en dos ficheros)
`automation-calidad.test.mjs` (etapa 1, 44) y `automation-calidad-integracion.test.mjs` (etapa 2, 64; datos en `_calidadFixtures.mjs`): positivos, negativos y límites de las 30 reglas; contrato del feed; batería de casos trampa de duplicados entre comercios y variantes; integridad del feed (131 y 800+ productos, repetidos entre páginas, totales incoherentes, vacío, cambios durante la paginación, 401/429/timeouts); seguimiento (línea base, nuevas, persistentes, resueltas, reaparecidas, desaparición, reducción brusca, escritura fallida, límite de tamaño); seguridad (fuzz de 3.000 mutaciones de URL, secretos, Markdown, ausencia de escrituras); determinismo, no mutación (entrada congelada), robustez (400 catálogos con datos basura) y compatibilidad con el Auditor.

## ETAPA 3 — Workflow local de n8n (generado, SIN desplegar)
Estado (14/11/2026): `automation/workflows/calidad-catalogo.local.json` y `calidad-instantaneas-crear-tabla.json` los genera `scripts/automation/build-workflows.mjs` desde `automation/lib` y `automation/config/calidad.local.json` (modo `lectura_catalogo`, 8 páginas máx., 10 peticiones/min, pausa de 7 s). No hay Data Table real, credencial real ni importación en ningún n8n. `active: false`; sin Schedule ni webhooks.

**Cadena de nodos:** Ejecutar a mano → *Configuración* (valida aislamiento + política y fija la 1.ª página) → *Pedir catálogo* (HTTP GET) → *Páginas restantes* → *Pedir catálogo (resto)* → *Analizar* (feed + reglas) → *Uno tabla* → *Comprobar tabla* (List) → *Uno historial* → *Leer historial* (Get) → *Informe* (seguimiento + informe JSON/Markdown + fila) → *Solo la fila* → *Guardar instantánea* (Insert, sin reintentos, dos salidas) → *Confirmar escritura*.
- **Tamaño por nodo Code (bytes, medidos):** Configuración 10.394 · Páginas restantes 12.198 · **Analizar 43.046 · Informe 55.484 · Confirmar escritura 21.628** (límite del linter 80.000): la separación Analizar / Informe / Confirmar evita el nodo único de ≈ 80 kB.
- **Nodos HTTP:** solo GET a `={{ $json.url }}` (la fija el código con `evaluarUrlCalidad`), sin cuerpo, `followRedirects: false`, timeout 15 s, lotes de 1 con pausa ≥ `pausaMs`, cabeceras solo `User-Agent` y `X-Treidilor-Agente`; **la credencial va por NOMBRE** («Treidilor — Catálogo local (solo lectura)», Header Auth, id `REEMPLAZAR_AL_IMPORTAR`): el token nunca está en el JSON. Una sola «hora» (`ahoraIso`) sale de *Analizar* y la reutiliza *Informe*.
- **Marcador:** si el catálogo cabe en una página, *Páginas restantes* emite un marcador autorizado (`limit=1&page=1`) que no se analiza (cuesta 1 petición del cliente, no un producto ni una página).
- **Segunda barrera:** cada nodo con configuración ejecuta `validarAislamiento` + `validarConfigCalidad` antes de actuar: si alguien cambia host, modo, pausa, tope de páginas o tabla dentro del JSON, el nodo se detiene sin pedir nada.

**Linter ampliado (solo aditivo):** acepta `evaluarUrlCalidad` como política y, en los workflows del Agente 04 (se detectan por su guardia, no por el campo `modo`), exige configuración válida, pausa ≥ `pausaMs`, páginas de una en una, credencial por nombre solo en los nodos «Pedir catálogo…» y solo las dos cabeceras de identificación. Los resultados para el Auditor no cambian.

**Simulador ampliado:** reloj virtual (cada petición lleva `t`: lotes de `batchSize` cada `batchInterval` ms; `virtualMs` total), cabeceras del nodo y bandera de redirecciones hacia el `fetchSimulado`.

**Sitio sintético (`sitio-calidad.mjs`, sin tocar `sitio-prueba.mjs` del Auditor):** feed `automation-catalog/1` con paginación (`limit` 1-100, `page`, `total`, `totalPages`), 131 productos (defectos, duplicado real, ofertas equivalentes de Amazon/AliExpress y eBay/Temu, variantes y packs), `CALIDAD_ESPERADO` (lo que el agente debe encontrar) y 18 escenarios: base, arreglado, mixto, sano, 401, 403, 429 en la pág. 2, 500, conexión cortada, tiempo agotado, redirección, total incoherente, página corta, vacío, catálogo que cambia, ids repetidos, 50 / 800 / 801 productos y límite de ritmo. `verificarRegistroCalidad` comprueba de forma independiente que solo hubo GET canónicos al feed, con credencial de forma ficticia, y el ritmo. Servidor loopback opcional.

**Memoria histórica (tabla propia `calidad_catalogo_instantaneas`, aún NO creada):** instantáneas inmutables; solo se guardan ejecuciones completas; una incompleta no sustituye la referencia; una incidencia solo se resuelve si su ficha se leyó (si el producto desaparece, «no verificada»); escritura «pendiente» hasta que *Confirmar escritura* comprueba la fila devuelta por el Insert (fallida con `error_insert` o `sin_confirmacion`); el reintento de una ejecución ya guardada no duplica (`ya_guardada` / `orden_invalido`); orígenes válidos `manual` / `programada`; el histórico de otro entorno y la tabla del Auditor no se mezclan.

**Pruebas (150 del Agente 04):** `automation-calidad-workflow.test.mjs` (42): estructura, linter y variantes inseguras, tamaños, credenciales, sitio, lectura de varias páginas, informe y prioridades, duplicados y variantes, 13 escenarios de fallo, 800/801, ritmo, marcador, configuración alterada, memoria (creación de tabla, línea base, nuevas/persistentes/resueltas/reaparecidas/no verificadas, escritura fallida, reintento, orígenes, tabla ausente/ambigua, otro entorno) y compatibilidad con el Auditor.

## ETAPA 4 — Validación en n8n REAL aislado (`tai-prueba-dt`, 13/11/2026; solo local)
**Entorno:** proyecto Compose `tai-prueba-dt` (n8n 2.38.6 + PostgreSQL 17, red `tai-dt-aislada` con `internal: true`, único puerto publicado `127.0.0.1:5689`) + la variante `automation/dev/prueba-data-tables/docker-compose.calidad.yml` (nueva; NO sustituye a `docker-compose.validacion.yml` del Auditor): habilita solo el nodo HTTP y añade el contenedor `tai-dt-sitio-calidad` (sitio sintético `sitio-calidad.mjs`, alias `puente-treidilor`, sin puertos). Antes de ejecutar nada se comprobó DESDE n8n: solo `puente-treidilor` responde; Treidilor, Internet, `host.docker.internal` y la base de datos quedan bloqueados.
Aplicar: `docker compose -p tai-prueba-dt --env-file <env fuera del repo> -f automation/dev/prueba-data-tables/docker-compose.yml -f automation/dev/prueba-data-tables/docker-compose.calidad.yml up -d --pull never`.
**Importado (inactivos, sin programación ni webhooks):** `calidad-catalogo.local` y `calidad-instantaneas-crear-tabla` (copias con el id de credencial ficticia; el repo no se toca) + 5 variantes de prueba («Insert: columna/tabla inexistente», «Insert sin salida», «Sin marcador A/B»). **Data Table real** `calidad_catalogo_instantaneas` creada solo en el n8n local (idempotente: dos ejecuciones → una tabla; 8 columnas de texto).
**Resultados:** 32 pasos en n8n real contra el simulador con el MISMO historial: todos iguales salvo uno (ver abajo, corregido). Línea base, persistentes, resueltas, nuevas, reaparecidas, desaparecidos (→ «no verificada», no «resuelta»), 401/403/429/500/corte/tiempo agotado/redirección/total incoherente/página corta/vacío/repetidos/catálogo que cambia/801 productos (ninguno guarda ni sustituye la referencia), 800 productos (huecos de 7,0 s exactos, 42,7 s), escritura fallida (tabla inexistente → `error_insert`; columna inexistente → `sin_confirmacion`; Insert sin salida → `pendiente`) y reintento (una sola fila, `idEjecucion` únicos), fila duplicada y fila corrupta inyectadas (`duplicadas:1`, `descartadas:1`), `docker restart` y `compose down`/`up` sin `-v` (historial intacto).
**Hallazgos:** (1) el simulador daba «guardada» con una columna inexistente; n8n real no guarda ni devuelve la fila y el agente lo informa correctamente como `fallida/sin_confirmacion` → el simulador acepta ahora `columnasPorTabla` (aditivo) y hay prueba. (2) La petición marcador `limit=1&page=1` ES NECESARIA: sin ella, con una sola página, «Páginas restantes» emite 0 elementos y n8n termina en «success» sin informe ni escritura (parada silenciosa). Una alternativa con `alwaysOutputData` en «Páginas restantes» y en el HTTP funciona en 2.38.6, pero depende de ese comportamiento y puede ocultar errores del HTTP: NO adoptada. (3) `docker restart` simultáneo de n8n y PostgreSQL deja n8n caído (`restart: "no"` y carrera en la migración); usar `compose up` (respeta `depends_on: healthy`) o arrancar n8n después de la BD.
**Fuera del repo:** controlador y salidas en `D:\treidilor-pruebas\prueba-dt\calidad\` (`cal.mjs`, `secuencia.mjs`, `variantes.mjs`, `persistencia.mjs`, `integridad.mjs`, `marcador.mjs`, `seguridad.mjs`; `salidas/`).

## ETAPA 5 — Variante de PRODUCCIÓN preparada (13/11/2026; solo local, SIN importar ni ejecutar)
**Generado:** `automation/workflows/calidad-catalogo.produccion.json` (constructor existente; configuración `automation/config/calidad.produccion.json`; SHA-256 de la versión desplegada `c4126e6ff548ac29f49c411a4e624c0cc0daa076faf76f3bc7f40e3b2161ac42`). Inactivo, solo disparador manual, mismos nodos, versiones y orden que el local validado en n8n real. Solo lee `https://treidilor.com/api/automation/v1/catalog?limit&page` (GET, sin redirecciones, 8 páginas como máximo, pausa de 7 s entre las peticiones de un mismo nodo, sin reintentos). Credencial POR NOMBRE `Treidilor — Catálogo (solo lectura)` con id de relleno (se selecciona a mano al importar). Tabla propia `calidad_catalogo_instantaneas` (list/get/insert; lectura filtrada por entorno `produccion`). El workflow de preparación `calidad-instantaneas-crear-tabla.json` no cambia.
**Seguridad añadida (solo Agente 04):** `validarProduccionCalidad` (host exacto, ≤ 10 peticiones/min, pausa ≥ 7000 ms, ≤ 8 páginas, credencial obligatoria) la incrusta SOLO el workflow de producción: el local sigue sin mencionar el dominio real. El linter exige, para producción, inactivo + único disparador manual + credencial con id de relleno + la guardia; un workflow de producción que no sea el del Agente 04 sigue sin poder llevar credenciales. Nada del Auditor, de `urlPolicy`, `common` ni `seguimiento` cambia (workflows idénticos).
**Límites:** ventana fija de 60 s por cliente (10) y cuota diaria UTC (500), modelados en las pruebas; intervalo mínimo seguro ≥ 2 min entre ejecuciones manuales. **Hallazgo:** la pausa de 7 s no separa las páginas 1 y 2 (son nodos distintos); no incumple las 10/min. Mejora propuesta (nodo Wait de 7 s antes de «Pedir catálogo (resto)»), sin aplicar: exige validarla antes en n8n local.
**Guía:** `automation/docs/GUIA-DESPLIEGUE-AGENTE-04-PRODUCCION.md` (pasos 0-8, acciones que requieren autorización, retirada). Pruebas: `scripts/tests/automation-calidad-produccion.test.mjs` (18).

## VALIDACIÓN TÉCNICA FINAL (13/11/2026): nodo Wait entre páginas y runner externo (solo local)
**Wait.** Se añade el nodo `Pausa entre páginas` (`n8n-nodes-base.wait` v1.1, `resume: timeInterval`, 7 s) entre «Páginas restantes» y «Pedir catálogo (resto)», en el workflow local y en el de producción. Constructor: `nodoEspera` (segundos = `pausaMs` / 1000). Linter: el Wait solo se admite en el Agente 04, por intervalo en segundos, 1-60 s, ≥ `pausaMs`, sin `webhookId`, y debe ir justo ahí; el HTTP puede recibir datos de un Wait que reenvía lo de un Code. Simulador: el Wait avanza el reloj virtual. Sitio sintético: `verificarRegistroCalidad(registro, { pausaMinMs })` mide el hueco mínimo. Con una sola página el Wait también precede a la petición marcador (se mantiene).
**Medido en n8n 2.38.6 real (local, runner externo):** 32 pasos iguales al simulador; huecos entre peticiones GET de 7,001 a 7,073 s (con 8 páginas: 7 huecos de ≈ 7,00 s, 50,6 s en total, máximo 8 peticiones por minuto); sin paradas silenciosas (una página, dos páginas, ocho páginas y fallos 401/403/429/500/corte/redirección en la página 2); las incompletas no guardan ni sustituyen la referencia; workflows inactivos, 0 disparadores automáticos, 0 workflows activos.
**Runner externo.** `docker-compose.runner.yml` (nuevo) + `lanzador-runner-prueba.mjs` (nuevo): n8n en modo externo y un contenedor aparte con `@n8n/task-runner` (mismo ejecutor JavaScript que `n8nio/runners`), token solo de pruebas, red aislada, sin puertos. Resultados: sin runner, el primer nodo Code falla con «Task request timed out» (61 s, sin peticiones ni escritura); con runner, todo funciona; la copia de producción con respuestas sintéticas (sin nodos HTTP ni red) se ejecuta íntegra y da el informe del simulador. **Límite:** no es la imagen oficial `n8nio/runners:2.38.6` (no estaba en el PC y no se descargó), ni su `task-runner-launcher` (lo sustituye un lanzador mínimo escrito para la prueba), ni su configuración de permisos; la validación en el runner de producción queda para la primera ejecución supervisada.
**Hash vigente del workflow de producción en el repositorio** (con la regla C3 `comercio_malformado`, 14/11/2026; **NO desplegado**): `16a3390ac1ca54dfc3d3fb01db6e88ad0e03c4b066459f8fb9aa32b7fd04d04f`. **Hash del workflow DESPLEGADO en producción** (versión sin C3, ejecuciones `ex-16` y `ex-18`): `c4126e6ff548ac29f49c411a4e624c0cc0daa076faf76f3bc7f40e3b2161ac42`. Para activar la detección C3 en producción habría que importar el nuevo JSON (autorización aparte).

## DESPLIEGUE SUPERVISADO Y PRIMERA EJECUCIÓN REAL (documentado el 13/11/2026)

### Cómo leer esta sección: verificado vs comunicado
**Todo lo que sigue sobre producción (despliegue, ejecución `ex-16`, cifras, estado del workflow, segunda auditoría) lo ha COMUNICADO el responsable del proyecto.** El asistente que redacta esto NO tiene acceso al n8n ni al VPS de producción, no ha visto la ejecución, la tabla ni la credencial, y no ha reproducido las cifras. Se registran tal cual se comunicaron; no son una verificación independiente.

| Dato | Origen |
|---|---|
| Workflow `Calidad del catálogo — Producción`, carpeta `Treidilor AI / Agente 04 — Calidad del catálogo` | Comunicado |
| Workflow auxiliar `Preparar historial — Calidad del catálogo` | Comunicado |
| Credencial `Treidilor — Catálogo (solo lectura)` | Comunicado (el nombre coincide con el previsto en `calidad.produccion.json`; el valor nunca se ha visto) |
| Tabla `calidad_catalogo_instantaneas` | Comunicado (el nombre coincide con el previsto) |
| Ejecución `ex-16`: completada y guardada; 131 productos, 2 de 2 páginas | Comunicado |
| 25 defectos confirmados · 45 advertencias · 5 avisos informativos · 38 productos afectados | Comunicado |
| Workflow sin publicar y sin programación automática | Comunicado |
| Segunda auditoría manual supervisada: 14/11/2026 | **Realizada** (`ex-18`); ver «SEGUNDA AUDITORÍA MANUAL SUPERVISADA» |
| El workflow generado en el repo (SHA-256 `c4126e6ff548ac29f49c411a4e624c0cc0daa076faf76f3bc7f40e3b2161ac42` en la versión desplegada; `16a3390ac1ca54dfc3d3fb01db6e88ad0e03c4b066459f8fb9aa32b7fd04d04f` con la regla C3; 16 nodos, inactivo) sigue sincronizado con su configuración | **Verificado** localmente (`build-workflows --check`, linter) |
| `GET /api/automation/v1/catalog` sin token responde 401 en `treidilor.com` (la API 2.2 está activa) | **Verificado** (una petición sin credenciales, paso 0, 13/11/2026) |
| `/api/health` de producción: código fusionado (`affa3de`, `sourceHash` igual al esperado) | **Verificado** (13/11/2026) |
| Que el JSON importado en n8n de producción sea idéntico al del repo; versión de n8n, runner oficial, Data Tables | **No verificado** por el asistente |

### Resultado de la primera auditoría (`ex-16`, datos comunicados)
- Catálogo leído completo (131 productos, 2 de 2 páginas; solo las ejecuciones completas se guardan), instantánea guardada en `calidad_catalogo_instantaneas`.
- **25 defectos confirmados**, **45 advertencias**, **5 avisos informativos**; **38 productos afectados** (de 131).
- **Línea base:** `ex-16` es la PRIMERA instantánea y por tanto la línea base del seguimiento. Según el motor (`seguimiento.mjs`), la primera ejecución no distingue nuevas/persistentes/resueltas: esa comparación empieza con la segunda auditoría. No debe borrarse ni sustituirse; las ejecuciones incompletas no se guardan.
- **Incidencias principales:** el desglose por regla y producto NO se ha registrado aquí (el asistente no ha visto el informe). Pendiente de que el responsable lo aporte o autorice leerlo; no se inventa.

### Problemas observados (REGISTRADOS, SIN CORREGIR)
Comunicados como observados en la primera auditoría; no se ha modificado código ni se han reproducido.
1. **Normalización del comercio: aparece `[object Object]`** en lugar del nombre. **(14/11/2026: causa identificada en el importador antiguo de Amazon (`String(raw.seller)` con un objeto), corregida en local (`amazonImport.ts`); el Agente 04 ya detecta el valor como defecto CONFIRMADO `comercio_malformado` —solo informa—; la reparación de fichas existentes sigue siendo solo un diseño: `docs/c3-reparacion-malformed-merchant.md`; nada está desplegado.)** Es el síntoma típico de convertir un objeto a texto (`String(obj)`). Sin confirmar dónde se produce (feed `automation-catalog/1`, Treidilor o el agente); el motor usa `plegar(p.merchant)` y `texto(p.merchant)` (`calidadCatalogo.mjs`). **Impacto posible (hipótesis):** el comercio forma parte de la clave de «mismo comercio» de los duplicados; un valor corrupto común a varias fichas podría fabricar u ocultar coincidencias y falsear el reparto por comercio.
2. **Redes no identificadas:** fichas cuya red no se reconoce (`claveRed` = `~`). Quedan fuera de las comparaciones por red (duplicados, calibración de enlaces de afiliación). Sin cifra verificada.
3. **Acción prevista:** diagnosticar (con autorización) leyendo el feed y los casos concretos, decidir si la causa está en el agente o en el origen y corregir en una etapa posterior. **No se corrige todavía**; no interpretar el reparto por comercio ni por red de `ex-16` hasta entonces.

### Limitaciones y riesgos pendientes
- **Cifras no verificadas por el asistente** (ver tabla), y afectadas por los problemas 1 y 2.
- **Umbrales sin calibrar con datos reales:** se fijaron con datos sintéticos; con 131 productos reales pueden sobre- o infra-detectar.
- **Runner de Code oficial** (`n8nio/runners:2.38.6`): en desarrollo solo se probó una reproducción local. La ejecución comunicada indica que funcionó, pero no se ha comprobado desde aquí.
- **Nodo Wait:** validado en n8n 2.38.6 local; en el n8n real solo consta por la ejecución comunicada.
- **Límites de la API de automatización:** 10 peticiones/min y 500/día por cliente (`n8n-calidad`), contadores en memoria (se reinician con cada despliegue), compartidos con cualquier otro uso del token. Intervalo recomendado ≥ 2 min entre ejecuciones manuales y ≤ 20 al día.
- **Caducidad del token** `n8n-calidad`: hacia el 13/12/2026.
- **Sin programación ni publicación:** cada auditoría es manual y supervisada hasta autorización expresa. Persistencia en Data Table de n8n sin garantías transaccionales («pendiente» = escritura no confirmada).
- **Retención:** el historial lee las últimas 60 instantáneas; no hay limpieza automática.

### Separación de responsabilidades con el Agente 12 (Auditor General) — sin cambios
- **Agente 12:** disponibilidad y salud del sistema (páginas públicas, modo `publico`, sin catálogo). Su workflow, política de URLs, motor y tabla `auditor_general_instantaneas` NO se han tocado; sus JSON siguen idénticos (comprobado con `build-workflows --check`).
- **Agente 04:** calidad por ficha a partir del feed de catálogo, con credencial, tabla, workflows, política (`urlPolicyCalidad`) y límites PROPIOS; nunca comparte tabla ni credencial con el Auditor.
- Ningún agente usa `TRADYLOR_API_TOKEN`; ninguno escribe en Treidilor.

### Próximo paso
La segunda auditoría se realizó el 14/11/2026 (`ex-18`, ver más abajo). Las condiciones que faltan antes de autorizar una ejecución automática están en «Condiciones pendientes antes de autorizar una ejecución automática». El asistente no ejecuta nada en producción.
## SEGUNDA AUDITORÍA MANUAL SUPERVISADA (`ex-18`, 14/11/2026)

### Cómo leer esta sección
Resultados **verificados por ChatGPT (revisor externo)** a partir del JSON del nodo «Confirmar escritura» y de capturas de n8n, y **trasladados por el propietario**. **El asistente que redacta esto no ha visto el JSON, las capturas, la tabla ni n8n, no se ha conectado a ningún sistema y no ha reproducido las cifras**: se registran tal cual, como `[Verificado por ChatGPT; no reproducido por el asistente]`. `[Inferido]` = deducción del asistente. No se ha modificado código, catálogo, workflows, n8n, servidor ni infraestructura; sin commits ni pushes. El workflow sigue **sin publicar y sin programar**.

### Resultados de `ex-18`
| Dato | Valor |
|---|---|
| Workflow | `Calidad del catálogo — Producción` |
| Ejecuciones | Primera `ex-16` (13/11/2026) · segunda **`ex-18`** (14/11/2026) |
| Modo | `comparacion` |
| Referencia | `historial`, comparada con `ex-16` |
| Lectura del historial | **1 fila válida, 0 duplicadas** |
| Productos | **131**, lectura completa de las **2 páginas** |
| Incidencias | **75 persistentes · 0 nuevas · 0 resueltas · 0 reaparecidas · 0 no verificadas** |
| Defectos confirmados · advertencias · informativos | **25 · 45 · 5** |
| Productos afectados | **38** |
| Calidad de la ejecución | `completa` |
| Persistencia | `resultado = guardada`, `filaId = 2` |
| Tabla `calidad_catalogo_instantaneas` | **2 filas visibles**: `ex-16` y `ex-18` |
**Lectura.** 25 + 45 + 5 = **75**: **[Inferido]** todas las incidencias abiertas de la línea base siguen presentes y no aparece ninguna otra. Es lo esperado, porque **no se ha corregido nada del catálogo** entre una ejecución y otra, y las cifras de `ex-18` coinciden con las de `ex-16` (25 · 45 · 5 · 38 afectados).

### Dos planos distintos (no se mezclan)
**Plano 1 — Funcionamiento del agente: VALIDADO en producción con dos ejecuciones manuales.** Quedó comprobado que:
- lee el catálogo completo (131 productos, 2 de 2 páginas) y solo guarda ejecuciones `completa`;
- guarda la instantánea y **confirma la fila** (`guardada` con `filaId` real; la tabla tiene exactamente las 2 filas esperadas; sin `pendiente`);
- lee el historial sin duplicados y se **compara con la ejecución anterior** (`modo comparacion`, `origen historial`);
- es **estable**: sobre un catálogo sin cambios reproduce las mismas 75 incidencias como persistentes, sin falsas nuevas ni resueltas.
**Qué NO se ha visto todavía en producción:** incidencias **nuevas, resueltas, reaparecidas o no verificadas** (todas a 0; ese comportamiento solo está validado en local y en `tai-prueba-dt`); ejecuciones parciales o fallidas; escritura `fallida`/`pendiente`; el origen `programada`; el historial con varias filas (hoy 1) o con el tope de 60.
**Plano 2 — Problemas del catálogo: NO CORREGIDOS.** El agente **detecta**; **no corrige** nada y la v0 no propone. Que `ex-18` funcione **no** significa que esos problemas estén resueltos: siguen todos abiertos (ver abajo).

### Pendientes del catálogo (REGISTRADOS, SIN CORREGIR; decisiones del propietario)
| # | Problema | Qué se sabe | Qué no se sabe | Quién/cuándo |
|---|---|---|---|---|
| C1 | **25 fichas sin categoría** | Comunicado como observado | **[Inferido]** coincide en número con los 25 defectos confirmados, pero **no consta** que sean el mismo conjunto: el desglose por regla y por producto no se ha registrado aquí | Categorizarlas es un cambio de catálogo: requiere autorización; no lo hace el agente |
| C2 | **Advertencias por fechas de captura del precio** (captura ausente o antigua, verificación antigua) | Las reglas `captura_ausente`, `captura_antigua` y `verificacion_antigua` son advertencias; sin cifra desglosada | Cuántas de las 45 advertencias son de este tipo | Decidir la política de refresco de precios (actualización por plataforma); es una tarea de datos, no del agente |
| C3 | **Valores `[object Object]` en el comercio de algunas fichas de Amazon** (causa: importador antiguo de Amazon, corregido solo en local; detección `comercio_malformado` en el agente, no desplegada) | Comunicado como observado en `ex-16` y de nuevo en `ex-18` (concretado a fichas de Amazon) | **Dónde se produce** (feed `automation-catalog/1`, Treidilor o el agente) y cuántas fichas | Diagnóstico con autorización; **no se corrige todavía**. Hasta entonces no interpretar el reparto por comercio ni los duplicados «del mismo comercio» |
| C4 | **Redes no identificadas** (`claveRed` = `~`) | Fichas fuera de las comparaciones por red | Cifra | Se diagnostica junto con C3 |

### Condiciones pendientes antes de autorizar una ejecución automática (NINGUNA autorizada)
**Bloquean la programación** (decide el propietario; el agente permanece inactivo hasta entonces):
| # | Condición | Estado |
|---|---|---|
| A1 | **Responsable** de revisar los informes, **frecuencia**, **canal de avisos** y procedimiento ante un informe `critico` | Pendiente de decisión (no se inventa) |
| A2 | **Política de ruido:** las 75 incidencias persistentes aparecerían en cada informe; decidir qué se notifica (p. ej. solo nuevas, reaparecidas o empeoramientos) y si la línea base actual se acepta como «conocida» | Pendiente de decisión |
| A3 | **Diagnóstico de C3 y C4** (`[object Object]`, redes no identificadas): contaminan duplicados y reparto por comercio/red | Pendiente; requiere autorización de lectura del feed |
| A4 | **Calibración de umbrales** con datos reales (se fijaron con datos sintéticos; 131 productos) y registro del **desglose por regla y producto** de `ex-16`/`ex-18` | Pendiente (el desglose no consta aquí) |
| A5 | **Tercera ejecución manual en otro día**, siguiendo el criterio ya fijado para el Auditor (≥ 3 ejecuciones manuales en días distintos; para el Agente 04 no hay criterio propio escrito, **se propone el mismo**) | Pendiente; decisión |
| A6 | **Token `n8n-calidad`**: caduca hacia el **13/12/2026**; planificar su rotación antes de programar (una programación con el token caducado fallaría) | Pendiente |
| A7 | **Zona horaria efectiva**, hora de la programación y **reparto de la API** (10 peticiones/min y 500/día por cliente; contadores en memoria que se reinician con cada despliegue): evitar solapes con el Agente 12 y con despliegues | Pendiente |
| A8 | **Compartidos con el Agente 12** (no se duplican aquí; ver `AGENTE-12-VALIDACION-PRODUCCION.md` §6): restauración probada o aceptación del riesgo R1, retención de ejecuciones y de la tabla, informe final con tamaño por ejecución y recursos del VPS, concurrencia | Pendientes |
| A9 | **Comportamientos no vistos en producción** (Plano 1): incidencias nuevas/resueltas/reaparecidas, ejecución parcial/fallida, escritura `fallida`, origen `programada` | Se verán en la primera semana supervisada; deben tener parada y reversión definidas |
| A10 | **Autorización expresa** de la programación y creación manual del Schedule en n8n (no se crea desde el repositorio) | No autorizada |
**No bloquean, pero conviene tener presentes:** runner de Code oficial (`n8nio/runners:2.38.6`) y nodo Wait ya funcionaron en producción según las dos ejecuciones, pero no se han verificado desde aquí; la etapa 2.5 (proponer correcciones) es posterior y separada.
**Corregir C1–C4 NO es requisito técnico para automatizar**, pero A2 y A3 condicionan la **utilidad** de un informe diario: sin ellos se repetirían las mismas 75 incidencias, y las de comercio/red no serían fiables.
