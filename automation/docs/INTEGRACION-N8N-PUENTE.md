# Puente Director ↔ n8n (primer circuito) — estado a 15/11/2026

**Alcance de esta entrega:** local, datos sintéticos, nada desplegado ni importado, sin commits. Complementa `INTEGRACION-N8N-DISENO.md` (opción B: Director + Canal 13 como servicio interno; n8n por webhooks).

## 1. Qué se ha construido

| Pieza | Archivo | Qué hace |
|---|---|---|
| Lógica compartida del lector | `automation/lib/lectorPuente.mjs` | Valida la solicitud (`tai-lector/1`) y arma/valida la respuesta (`tai-lector-respuesta/1`). **El mismo código** corre en el nodo Code de n8n y en el Director. |
| Workflow lector (generado) | `automation/workflows-puente/lector-instantaneas.local.json` | Dos Webhook POST (`tai-lector-04`, `tai-lector-12`) → Code (valida) → Data table **Get** (tabla fija) → Code (arma) → Responder. Sólo consulta. |
| Constructor y linter | `scripts/automation/build-workflows.mjs`, `lint-workflows.mjs` | Cambio mínimo: una entrada en `ORDEN`, la función del lector, `FABRICA_PUENTE` y `comprobarLector` (política explícita). Respaldo previo con hash en `respaldo-previo-bloque4-2026-11-15/`. |
| Cliente del lector | `automation/director/puente/lector-n8n.mjs` | `LectorN8n`: misma interfaz que `LectorInstantaneas`. `refrescar()` (async) hace **dos descargas independientes** por agente; las lecturas del Director siguen siendo síncronas. |
| Firma y anti-repetición | `puente/firma.mjs` | HMAC-SHA256, ventana de 5 min, nonce de un solo uso (caché acotada), comparación en tiempo constante, idempotencia por clave. |
| Tokens por cliente | `puente/tokens.mjs` | `tai_<id>_<secreto>`, sólo hash, caducidad ≤ 90 días, revocación; **no existe alcance de aprobación**. |
| Sobres estrictos | `puente/sobres.mjs` | Validación de `tai-puente/1`; trazabilidad leída del **ledger** (tareas, evidencias con hash, verificaciones). |
| Servicio HTTP | `puente/servidor.mjs`, `scripts/automation/puente.mjs` | `GET /tai/v1/salud`, `POST /tai/v1/mensajes`. Sólo bucle local; mensajes en serie. Sin ruta de aprobación. |
| Pruebas | `director/tests/f17-puente.test.mjs`, `_n8n-falso.mjs` | 19 pruebas. El «n8n falso» **ejecuta el JSON real** del workflow (los nodos Code generados). |

Un cambio en el Director (`director.mjs`): la segunda lectura independiente usa `lector.independiente()` si existe (antes creaba siempre un `LectorInstantaneas`). `lectores.mjs` separa `cargar` en lectura de archivo + `_normalizar` (mismas validaciones para n8n).

## 2. Primer resultado (verificado con datos sintéticos)

«¿Cómo está el sitio?» → `POST /tai/v1/mensajes` → Canal 13 → Director → `12.leer-ultimo-informe` → `LectorN8n` → webhook `tai-lector-12` → informe sintético del Agente 12.
La respuesta incluye `mensaje` (texto, avisos «DATOS DE PRUEBA», naturaleza `simulado`, fuentes) y `trazabilidad.tareas[]` con evidencia (`auditor_general_instantaneas#fx-12-01`, hash `sha256:…`), verificación `confirmada` (segunda descarga con otro `idSolicitud`) y estados. La ampliación al 04 usa **el mismo workflow** (`tai-lector-04`).

## 3. Autoridad: n8n no aprueba nada

- El lector sólo devuelve filas; el Director las trata como dato no fiable (validación estricta + `_normalizar`).
- No hay ruta de aprobación ni alcance de token que la permita; `autorizacion.apruebaElPuente = false`.
- `POST /tai/v1/respuestas` (n8n → Director) **no existe**; se diseñará cuando haya un caso que lo exija.

## 4. Compatibilidad real de autenticación y firma (hallazgo importante)

- **Director → n8n:** autenticación del webhook con credencial **Header Auth** por nombre (`Treidilor — Lector puente (solo lectura)`). Es lo que el nodo Webhook de n8n ofrece de serie.
- **HMAC en n8n: NO viable con los nodos disponibles.** El nodo Code no puede leer secretos (`$env`, `$vars` y `require` están prohibidos por el linter) y el nodo Crypto exigiría el secreto escrito en el workflow. Por tanto **no se afirma** firma HMAC hacia n8n. La firma HMAC (con marca, nonce y caducidad) protege las llamadas **entrantes al Director**; hacia n8n se confía en red interna + credencial + validación estricta de la respuesta (eco de `idSolicitud`, agente, entorno, tabla, columnas).
- **Pendiente de verificar en un n8n real (no hecho):** que `alwaysOutputData` en el Get devuelva un elemento vacío con tabla vacía; que `responseMode: responseNode` + `respondToWebhook` 1.1 con `JSON.stringify($json)` devuelva JSON; el formato de `body` del Webhook v2; y que Webhook esté admitido (`NODES_EXCLUDE`) en el n8n de producción.

## 5. Antes de importar en el n8n de pruebas (comunicación previa obligatoria)

Se importaría **un único archivo**: `automation/workflows-puente/lector-instantaneas.local.json` (inactivo, sin credenciales con valor). Protecciones: sólo lectura de dos tablas fijas por nombre; `Get` + `Responder`, sin `Insert`/HTTP/Schedule/Manual; credencial Header Auth creada a mano (valor no versionado); webhooks que **no se publican en Internet** (n8n de pruebas escucha en `127.0.0.1:5678`); ejecuciones **sin datos conservados** (`saveDataSuccessExecution: none`); activar solo a mano; `tai-lector-*` en `/webhook-test` mientras se prueba. Requiere tablas de prueba **locales** (las crea el workflow de preparación de cada agente en el n8n de pruebas, nunca las de producción). **No se ha importado nada.**

## 6. Carpeta del workflow

Se generó en `automation/workflows-puente/` y no en `automation/workflows/` porque `automation-persistencia.test.mjs` fija la lista exacta de siete archivos de esa carpeta (archivo protegido). Integrarlo en la carpeta común exige actualizar esa lista (autorización adicional). `README.md` de `automation/workflows/` se movió a `automation/docs/WORKFLOWS-INDICE.md` porque esa misma prueba lee **todos** los archivos de la carpeta como JSON.

## 7. Pendientes e impedimentos concretos

1. Importar y probar el lector en el n8n de pruebas (punto 4) — requiere tu confirmación tras leer el punto 5.
2. **E-1 (ledger en Windows) sigue abierta:** validar en Linux antes de delegaciones reales.
3. Producción: no existe variante de producción del lector (el linter la rechaza); decidir antes qué tablas, host interno y credencial.
4. Firma de las respuestas de n8n al Director: sin solución con los nodos actuales (§4); alternativa futura: nodo de la comunidad/credencial dedicada o un servicio intermedio.
5. Documentar en `AGENTS.md` y `estructura*.txt` queda pendiente (archivos protegidos).

## 8. Primera prueba REAL contra n8n de pruebas (15/11/2026)

**Instancia:** `treidilor-n8n-pruebas` (n8n 2.46.6, `docker-compose.n8n.yml`), red `aislada` (`internal`), único puerto `127.0.0.1:5678`. `comprobar-aislamiento.mjs --sin-servidor`: todas las comprobaciones OK (sin salida a treidilor.com, Internet, anfitrión ni Docker). Producción no se tocó. Credencial Header Auth de pruebas `taiLectorPrueb01` generada al azar, importada cifrada por CLI y guardada fuera del repositorio (`D:	reidilor-pruebas\lector-token.txt`); no aparece en código, JSON ni registros.

**Importado:** `lector-instantaneas.local.json` como workflow NUEVO (`jzRaQXpRQJvgRHOl`), con el id de la credencial de pruebas sustituido en una copia temporal (el archivo del repositorio no cambia). Las dos tablas (`calidad_catalogo_instantaneas`, `auditor_general_instantaneas`) y sus filas sintéticas (host `sintetico.example`) se crearon en ese n8n. Los workflows existentes del 04/12 no se modificaron. **Estado final: inactivo, webhooks sin registrar (404).**

**Resultados con n8n REAL** (`scripts/automation/probar-lector-real.mjs`):
| Prueba | Resultado |
|---|---|
| POST válido 12 / 04 | 200; JSON con las columnas esperadas + `id`; pasa la validación estricta del Director |
| Tabla vacía | 200 con `filas: []` (`alwaysOutputData` funciona); el Director responde «sin datos», sin inventar |
| Credencial incorrecta / ausente | 403 |
| Cuerpo inválido (agente, entorno, campo extra, no objeto) | 500 genérico («Error in workflow»), sin detalles |
| Ruta inexistente / GET | 404 |
| Servicio no disponible (pasarela parada) | respuesta `fallida` honesta; recupera al reiniciar |
| Circuito 13 → 00 → n8n → 00 → 13 (12 y 04) | `respondida`, «DATOS DE PRUEBA», evidencia `…#fx-12-01`/`#fx-04-02` con hash, tarea `aceptada→en_curso→completada`, ledger íntegro, idempotencia (misma clave → misma respuesta, 0 peticiones nuevas) |

**La segunda lectura es una comprobación de CONSISTENCIA** (dos descargas con `idSolicitud` distintos coinciden), no verifica que el dato de la fuente sea cierto. El texto del Director se corrigió en ese sentido.

**Defecto encontrado y corregido:** el normalizador quita `webhookId`, y sin él n8n registra la ruta como `<idWorkflow>/<nodo>/<path>` (distinta en cada instalación; los simuladores no lo detectaban). El constructor restaura un `webhookId` determinista solo en los Webhook del lector y el linter lo exige.

**Aún no probado en real:** `n8n execute`/CLI con Data Tables (no aplica), activación con la UI, HMAC hacia n8n (no viable, §4), producción.

## 9. Lectura de datos reales (15/11/2026): bloqueada, sin acceso de solo lectura verificable
- Se buscó una vía ya disponible: la única conexión MCP a n8n de la sesión es la del n8n de **pruebas** local; no hay MCP, API ni credencial hacia el n8n de producción. Las `N8N_*_WEBHOOK_URL` del `.env` son webhooks de envío (no de lectura) y no se usan. La clave MCP de n8n no tiene alcances (actúa con los permisos del propietario), así que no sería «verificablemente de solo lectura» ni en pruebas ni en producción.
- **No se accedió a producción.** Alternativa mínima: (a) que exportes desde la propia interfaz de n8n de producción (Data tables → descargar) **solo la última fila** de cada tabla y la dejes en una carpeta local, con lo que se sanea y se prueba en el n8n local; o (b) autorizar una variante de producción del lector (importarlo en el n8n de producción con credencial Header Auth propia): es una modificación de producción y requiere autorización expresa.
- Higiene: el token de pruebas (`D:	reidilor-pruebas\lector-token.txt`) y los archivos de clave del n8n de pruebas quedan con permiso solo para el usuario actual; 0 apariciones del token en el repositorio, los respaldos ni los logs de n8n. El workflow lector sigue **inactivo**.
- **Comprobación integral de aislamiento pendiente:** mientras no exista el servicio de pruebas del puerto 4350, `comprobar-aislamiento.mjs` sin `--sin-servidor` falla en su última comprobación (que la única puerta llega al Treidilor de pruebas). El resto de comprobaciones pasa.

## 10. Instantáneas reales saneadas (preparado el 15/11/2026; **faltan las dos exportaciones**)
- **Existencias locales:** no hay ninguna exportación real de `calidad_catalogo_instantaneas` ni de `auditor_general_instantaneas`. `D:	reidilor-pruebas` solo contiene salidas del sitio sintético y workflows exportados; los informes del repositorio solo recogen cifras sueltas (p. ej. `ex-16`, `ex-18`), no filas.
- **Herramienta:** `scripts/automation/instantanea-real.mjs`. `preparar` toma el CSV exportado de n8n, conserva SOLO la última fila de `produccion` (por `generadoEn`), retira secretos, correos e IPs, comprueba que el Director la lee y escribe `D:	reidilor-pruebaseales\<agente>.json` (`sintetico:false`, `saneado:true`). `probar` respalda las filas sintéticas, aparta las tablas sintéticas (renombra), carga las reales saneadas, publica el lector, ejecuta el circuito y **siempre restaura** (borra las tablas reales, devuelve las sintéticas, despublica y reinicia). Ensayo completo realizado con datos sintéticos (rotulados «ENSAYO»): restauración verificada (mismos ids, 0 workflows activos).
- **Rotulado:** una instantánea saneada se muestra como `real_saneado` («DATOS REALES SANEADOS … el estado actual del sitio NO está verificado»), distinta de `simulado` (prueba). La antigüedad la sigue clasificando `frescura.mjs`.
- Pruebas: `f18-instantanea-real.test.mjs`.

## 11. Correcciones tras la primera prueba con instantáneas reales (15/11/2026)
- **Copia transformada y huellas.** La `huella` de una fila es un hash NO criptográfico del conjunto de claves de incidencias (`filaDeInstantanea`), no del payload; rotular `entorno` no la altera. `aEntornoPruebas` la RECALCULA sobre la copia (si no coincide, rechaza) y declara la procedencia (`copia`: entorno original/copia, sha-256 del payload original y de la copia, huella de la fila). El Director solo comprueba la huella de la lectura (`huellaInforme`) entre las dos lecturas; nunca la columna `huella` de la fila. Muestra el aviso «COPIA DE PRUEBAS TRANSFORMADA» y no la presenta como idéntica al original.
- **Restauración.** `probar` exige el estado normal antes de empezar, restaura siempre (`finally`, SIGINT/SIGTERM, salida cerrada) con la misma lógica que `recuperar` (identifica cada tabla por id y contenido, nunca borra una sintética, verifica ids y filas). `node scripts/automation/instantanea-real.mjs recuperar` repara un estado interrumpido.
- **Falso positivo «simulado».** El ofrecimiento «Puedo solicitar una auditoría nueva (L2; en F1 sería simulada)» coincidía con la detección de datos simulados del Canal 13; las líneas de ofrecimiento ya no cuentan. Pruebas: `f19-correcciones-reales.test.mjs`.

## 12. Lector de producción (preparado, no desplegado)
Ver `LECTOR-PRODUCCION-DESPLIEGUE.md`: variante `automation/workflows-puente/produccion/`, linter estricto propio, cliente interno `crearLectorProduccion`, análisis de aislamiento frente al proxy público y procedimiento con reversión.
