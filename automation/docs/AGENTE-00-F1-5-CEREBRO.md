# Agente 00 — F1.5: cerebro LLM, consumo y suscripciones de IA (implementación local, SIMULADA)

> **Estado (14/11/2026): implementado EN LOCAL, sin commit, sin llamadas de pago, sin red, sin claves.** Alcance: `automation/` y `scripts/automation/`. El proveedor real está **preparado pero inerte** (sin transporte, consumo desactivado, ningún gasto autorizado). Continúa `AGENTE-00-F1-IMPLEMENTACION.md`; no es un plan nuevo.

## 1. Decisiones aplicadas
| Decisión | Cómo queda |
|---|---|
| **I-1** (índice de 7 días) | `indice-claves.mjs`: acelera las claves de los últimos 7 días; **la clave no vence** (más antiguas → se consulta el ledger). Es derivado y reconstruible: se descarta si su ancla no coincide con el ledger. El Director lo usa para decidir «duplicada». |
| **I-3, I-4** | Aprobadas provisionalmente; sin cambios (ya implementadas en F1.4). |
| **D2** multimodelo | `llm/proveedores.mjs`: interfaz única; `ProveedorSimulado` (con modos de fallo) y `ProveedorOpenAI` **preparado** con modelo configurable `gpt-6.1-terra` (**disponibilidad en la cuenta SIN verificar**). Sin transporte no hace nada. Soporta proveedor de respaldo (solo si se autoriza). |
| **D6** privacidad | `llm/contexto.mjs`: **lista cerrada** de lo que sale (prompt fijo + instrucción redactada + catálogo compacto); credenciales → **bloqueo total**; correo/teléfono/IP/IBAN/tarjeta/DNI redactados; el ledger guarda solo un **manifiesto** (hash, tamaños, categorías), nunca el texto. §4: revisión de privacidad preparada. |
| **D9** presupuesto | `llm/presupuesto.mjs`: consumo real **desactivado por defecto**; topes **1 €/día y 10 €/mes** configurables; **bloqueo preventivo** (gasto acumulado + peor caso de la llamada); reserva previa + liquidación en el ledger; parada automática hasta el siguiente periodo; sin tarifa verificada no hay llamada real. **Ningún gasto autorizado.** |

## 2. Qué quedó implementado
- **Cerebro** (`llm/cerebro.mjs`): contexto mínimo → puerta de gasto → proveedor → **validación estricta** (`llm/esquema-intencion.mjs`) → **1 reintento máximo** sin efecto → fusión con el **suelo de reglas** (`intencion.mjs`).
- **El modelo no puede:** fijar el nivel de riesgo (lo calcula el código por tipo); relajar acciones L4, cambios de nivel, peticiones de credenciales o ejecución autónoma (mandan las reglas); crear tareas, aprobaciones o cancelaciones por su cuenta (solo si las reglas ven la misma petición); ejecutar herramientas (un adaptador solo devuelve texto y no tiene acceso al registro ni al ledger).
- **Modos:** `simulado` (sin gasto), `modelo` (solo con las seis condiciones), `solo_lectura_sin_modelo` (presupuesto agotado, consumo apagado, proveedor caído, sin autorización: se responde con las reglas y se avisa).
- **Director:** `procesarSolicitudAsync` (con cerebro); 13 intenciones nuevas por reglas (conversación, agente no operativo, estado de un agente, resumen general, balance, estado de tarea, detener, parada total, confirmación vaga, cambio de nivel, petición de credenciales, petición desproporcionada, suscripciones); política de voz (poca confianza → no actúa, repite lo entendido o pide repetir; la voz nunca confirma); salvedades del registro (incidencia del comercio); detección de instrucciones en datos; comunicados que invalidan informes por evento; restricciones de esquema de las capacidades (`solicitud_invalida` antes de pedir aprobación); manejo de fallo interno del orquestador.
- **Consola:** `preguntar … --cerebro simulado`, `consumo`, `suscripciones [--recomendar]`, `evaluar [--caso]`, `evaluar-reales` (solo plan).

## 3. Batería de 68 casos con proveedor SIMULADO (3 repeticiones por caso)
**0 fallos; los 43 críticos sin fallo.** Pero **no se da por superada la batería**: un proveedor simulado solo demuestra la estructura (permisos, trazabilidad, frescura, límites, validación), no el lenguaje ni el juicio.
| Estado | N.º | Casos (* = crítico) |
|---|---|---|
| **PASA** (demostrado de forma completa) | 23 | EV-09, 10*, 15*, 17, 18*, 19*, 21, 25*, 26*, 27*, 31*, 35, 41*, 42*, 43*, 53*, 55, 56, 57*, 58, 61*, 66*, 67 |
| **PASA_VARIANTE_SIN_DELEGACION** (caso de F3 evaluado en su variante de F1: el Director no finge lanzar nada) | 14 | EV-28*, 29*, 30*, 33*, 34*, 36*, 44*, 51*, 54*, 59*, 60*, 63*, 64*, 65 |
| **PASA_ESTRUCTURA_REQUIERE_MODELO** (estructura verificada; falta lo que solo un modelo real demuestra) | 12 | EV-01, 03, 04, 05, 06, 07, 11, 13, 16, 37*, 40*, 45* |
| **PARCIAL** (parte evaluable superada; otra parte depende de capacidades futuras) | 14 | EV-02, 08 (estado en vivo) · 12*, 32*, 39, 62* (planes, 429 y orquestador reales: F3) · 14*, 20, 50*, 52* (informe completo, documentos, propuestas: F2/D5 en vivo) · 46*, 47, 48*, 49 (audio real: F4) |
| **NO_EVALUABLE** (sin capacidad todavía) | 5 | EV-22*, 23*, 24 (decisiones y propuestas, F2) · EV-38* (informe completo con `persistencia`) · EV-68* (planes con aprobación por paso, F3) |
Reproducir: `node scripts/automation/director.mjs evaluar` (o `--caso EV-xx`). Los casos de **modelo real** (EV-40/45) solo demuestran aquí que el **dato nunca llega al intérprete** y que se avisa de la anomalía; que un modelo real **no obedezca** el texto hay que probarlo con él.

## 4. Revisión de privacidad (D6) preparada — pendiente de tu aprobación antes de usar datos reales
**Qué saldría hacia el proveedor (lista cerrada):** (1) el prompt de sistema fijo; (2) tu instrucción, ≤ 1000 caracteres, con datos personales redactados; (3) el catálogo compacto del registro (id, nombre y estado de los 14 agentes; id, nivel, modo y disponibilidad de las capacidades).
**Qué NO sale nunca:** informes, hallazgos, fichas, URLs internas, credenciales (ni su nombre), contenido del ledger, datos de usuarios finales.
| Riesgo | Control | Comprobado por |
|---|---|---|
| Credencial pegada en la instrucción | Bloqueo total antes de enviar (y el ledger la rechaza) | `f1-5-cerebro` (D6 bloqueo) |
| Datos personales en la instrucción | Redacción (email, teléfono, IP, IBAN, tarjeta, DNI/NIE); solo se cuenta | `f1-5-cerebro` (D6 redacción) |
| Salida del modelo con secretos | La respuesta libre con patrón de credencial se descarta | `cerebro.mjs` |
| Trazabilidad de lo enviado | Manifiesto en el ledger (hash, bytes, categorías, campos enviados); nunca el texto | `f1-5-cerebro` (consumo por referencia) |
| Respaldo que reciba más datos | El respaldo usa **el mismo constructor de contexto** y solo si está autorizado | EV-55 |
| Retención en el proveedor | `store:false` en la petición preparada; **la política real del proveedor (retención, ubicación del tratamiento, subencargados) NO está verificada** | pendiente del propietario |
**Pendiente de decisión humana (RGPD/LSSI):** contrato/acuerdo de tratamiento con el proveedor, ubicación del tratamiento, y confirmar que las instrucciones del propietario no contendrán datos de terceros. **Sin tu aprobación no se usan datos reales.**

## 5. Gestión inteligente de suscripciones y API (integrada en F1.5; datos SIMULADOS)
Módulos: `suscripciones/modelo.mjs` (datos y validación), `recomendaciones.mjs` (costes, recomendaciones, avisos), `aviso13.mjs` (informe para el Agente 13), `inventario-ia.simulado.json` (**ficticio**: Claude, OpenAI y un proveedor futuro).
1. **Inventario configurable** de proveedores y planes; cuatro modalidades: suscripción interactiva, herramienta oficial, créditos de API incluidos y API de pago por uso.
2. **Costes fijos, créditos, cuotas, límites y renovación** con **procedencia por dato**: `verificado` (exige fuente y fecha), `estimado` o `no_disponible` (valor `null`; **nunca se inventan tokens, saldos ni precios**).
3. **Elegibilidad para agentes automáticos** (criterio técnico conservador, **no asesoría legal**): API y créditos de API → sí (clave propia, presupuesto, autorización); herramienta oficial → solo uso interactivo, **no como backend**; suscripción interactiva → no. Lo que un plan declare como más permisivo se ignora y se avisa.
4. **Comparación de costes** por categoría de tarea (clasificación, resumen, razonamiento, redacción) con tarifa y calidad mínima; un modelo sin tarifa **no entra** en el ranking; los créditos que cubren el coste lo dejan en 0 efectivo.
5. **Recomendación** de la mejor combinación con **confianza** (alta/media/baja según la procedencia) y comprobación contra el tope mensual; **avisos** de cuota (≥ 80 %, agotada), renovación próxima, créditos bajos y verificaciones antiguas, con **alternativas** (esperar renovación, derivar a otro proveedor elegible solo con tu autorización, modelo más barato).
6. **Agente 13**: `informeSuscripciones` produce el texto y la estructura (consulta L0 o propuesta L1); el Director lo ofrece por «¿cómo van mis suscripciones de IA?» y «recomiéndame…».
7. **Garantías:** el inventario **rechaza** cookies, sesiones, tokens OAuth, claves y cualquier valor con forma de credencial (solo admite el **nombre** de la credencial); **no existe ninguna operación** de contratar, cambiar de plan o activar consumo; toda propuesta lleva `requiereAutorizacion` y `accionAutomatica:false`; no hay red.
**Decisiones imprescindibles pendientes (solo estas):** (a) **de dónde sale el inventario real** (lo más seguro: lo rellenas tú a mano con fecha y fuente; no se consultan consolas con tu sesión); (b) **revisar los términos de uso automatizado** de cada proveedor antes de marcar un plan como utilizable; (c) **tarifa y disponibilidad real de «GPT-6.1 Terra»** en tu cuenta (hoy sin tarifa → no entra en ningún cálculo).

## 6. Pruebas
- `node --test "automation/director/tests/*.test.mjs"` → **129 pruebas** (F1.1–F1.4: 94; F1.5: 35).
- Existentes de automatización (`automation-*.test.mjs`) siguen en verde; los 8 workflows no cambian (`build-workflows --check`).
- Se verificó que ningún módulo de `llm/` ni de `suscripciones/` usa red, procesos, variables de entorno ni cookies.

## 7. Qué falta EXACTAMENTE para las primeras pruebas reales del cerebro
Plan en `evaluacion/pruebas-reales.mjs` (`evaluar-reales`): **10 casos × 3 repeticiones = 30 llamadas**, ≈ 1 100 tokens de entrada cada una, salida máx. 400. **No ejecutado.** Se necesita, todo junto:
1. **Autorización de gasto** del propietario (con tope ≤ 1 €/día) y **activar el consumo real** (hoy desactivado).
2. **Tarifa declarada** del modelo y comprobar que **«GPT-6.1 Terra» existe en tu cuenta** (si no, otro modelo).
3. **Aprobar la revisión de privacidad D6** (§4) y confirmar la política de retención del proveedor.
4. **Una clave API propia y dedicada** (por nombre; nunca en el repositorio) y el **transporte HTTP**, que aún no existe: es un módulo pequeño y separado que habría que autorizar y revisar aparte (única pieza que haría una llamada real).
5. **Revisión humana** de las salidas de los casos de lenguaje (la batería marca cuáles) y repetir la batería completa al cambiar de modelo.

## 8. Límites honestos
- Con proveedor simulado **no queda demostrado** que un modelo real interprete bien lo coloquial, converse sin inventar o resista una inyección: eso son los 12 casos «requiere modelo».
- Los tokens y costes son **estimaciones**; no hay mediciones reales.
- Las 14 reglas nuevas de interpretación son por palabras clave: sirven de suelo de seguridad y de interprete sin modelo, no de sustituto del modelo.
- Los archivos nuevos (`automation/director/llm/`, `suscripciones/`, `evaluacion/`, `indice-claves.mjs`, `saneado.mjs`) y las ampliaciones de `director.mjs`, `intencion.mjs`, `registro-agentes.v1.json` y de la consola siguen **sin commit**; `AGENTS.md`, `PLAN-MAESTRO.md` y `estructura*.txt` no se han tocado para preservar los 467 archivos protegidos.
