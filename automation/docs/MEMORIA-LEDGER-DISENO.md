# Memoria y ledger del Director: diseño lógico independiente del almacenamiento (F0)

> **Estado (13/11/2026): F0 documental; nada implementado.** Cubre la parte **autorizada** de la decisión **D3: solo el diseño del esquema de memoria y ledger**. **La tecnología de almacenamiento y cualquier migración siguen PENDIENTES** (Data Tables, PostgreSQL u otra: no se elige aquí). Todo lo que sigue se define como **modelo lógico y requisitos**, de modo que cualquier almacén que los cumpla sirva. Complementa `AGENTE-00-DIRECTOR-DISENO.md` §6.

## 1. Objetivos y principios
1. El Director no depende del historial de chat: conoce el proyecto por **capas con fuente y frescura** distintas.
2. **Una sola fuente de verdad por tipo de dato**; lo demás son **proyecciones** reconstruibles.
3. **Ledger de solo añadir** (append-only) con huella encadenada: nada se edita ni se borra; corregir = nuevo evento que referencia al anterior.
4. **Procedencia obligatoria** en todo dato servido al modelo o al propietario.
5. **Sin secretos ni datos personales** de usuarios finales en ninguna capa.
6. **Independencia del almacén:** el código solo conoce las interfaces de §7.

## 2. Capas y su fuente de verdad
| Capa | Qué contiene | Fuente de verdad | Mutabilidad | Frescura | Etiqueta de procedencia |
|---|---|---|---|---|---|
| **K1 Documentada** | Visión, arquitectura, plan, fichas, procedimientos, decisiones aprobadas | Documentos versionados en git (`AGENTS.md`, `automation/**`) | Cambia por commit | **Puede ir por detrás de la realidad** | `[doc archivo#sección @commit]` |
| **K2 Registro** | Agentes, capacidades, permisos, niveles, límites, estado | Archivo `registro-agentes` versionado (generado desde `REGISTRO-AGENTES.md`) | Cambio de versión aprobado | Por versión | `[registro vN]` |
| **K3 Estado actual** | Salud del sitio, tareas en curso, consumo del día, estado del orquestador | **Consulta en vivo** a cada sistema | No se persiste como verdad (solo como evento de lectura en el ledger) | Segundos; con `capturadoEn` y TTL | `[en vivo hh:mm sistema]` |
| **K4 Histórico** | Informes e instantáneas de los agentes (p. ej. `ex-16`) | Almacén de instantáneas **de cada agente** (inmutables) | Inmutable | Fija (fecha del informe) | `[histórico agente idEjecucion]` |
| **K5 Decisiones y tareas** | Decisiones, tareas, dependencias, propuestas, aprobaciones | **Ledger** (proyecciones) | Solo por eventos | Vivo | `[decisión D-nnn]`, `[tarea t_…]` |
| **K6 Conversación** | Mensajes, resúmenes, transcripciones de voz | Ledger (eventos `mensaje`) + resúmenes | Inmutable; el chat completo es efímero y se conserva **resumido** | Sesión | `[conversación c_…]` |
| **K7 Comunicado** | Lo que afirma el propietario y nadie ha verificado | Evento `comunicado` en el ledger | Inmutable; puede quedar `verificado` por evento posterior | Fecha | `[comunicado por el propietario, fecha]` |

### 2.1 Reglas de precedencia y conflicto
1. «Cómo está ahora» → **K3 > K4 > K1** (el documento nunca prueba el presente).
2. «Qué dijo el informe» → K4 (con su fecha), nunca K1.
3. «Qué está permitido» → **K2**; si K1 y K2 discrepan, manda K2 y se avisa.
4. Lo **comunicado (K7)** no se promociona a hecho: se cita como comunicado hasta que haya una verificación.
5. **Si dos capas discrepan, se dice** y se muestran ambas con su procedencia; no se elige en silencio.
6. Un dato sin procedencia **no se afirma**; sin dato, «no consta».

## 3. Modelo de entidades (lógico)
Todas llevan `id` estable, `version`, `creadaEn`, `creadaPor` y `procedencia`. Los campos son **lógicos** (no implican tabla ni columna).

| Entidad | Campos principales | Origen |
|---|---|---|
| **Solicitud** | idSolicitud, canal (texto/voz/panel), texto o transcripción (+ confianza), propietario autenticado, idCorrelacion | Evento `solicitud` |
| **Intención** | idIntencion, idSolicitud, categoría (consulta/propuesta/pendiente/ejecutada), agentes candidatos, parámetros, riesgo máximo, ambigüedad | Evento `intencion` |
| **Plan** | idPlan, idIntencion, pasos {idTarea, depende, nivel}, presupuesto total, estado | Evento `plan` (+ cambios) |
| **Tarea** | idTarea, idCorrelacion, idPadre, profundidad, agente, capacidad (+versión), modo, nivel, prioridad, estado, claveIdempotencia, plazoMs, presupuesto | Proyección de eventos `tarea_*` |
| **Aprobación** | idAprobacion, idTarea, nivel, huella, resumen mostrado, estado (pendiente/aprobada/rechazada/caducada/**consumida**/revocada), caduca, por, canal | Eventos `aprobacion_*` |
| **Evidencia** | idEvidencia, idTarea, tipo, referencia, hash, capturadaEn, verificada {método, resultado, en} | Evento `evidencia` |
| **Decisión** | idDecision (`D-nnn`), título, texto, estado (propuesta/aprobada/sustituida/retirada), base (ids de documentos, informes, mensajes), alcance, sustituyeA | Proyección de eventos `decision_*` |
| **Propuesta** | idPropuesta, título, origen (Director/agente), base, estado (abierta/aprobada/rechazada/aplicada por humano), notas | Eventos `propuesta_*` |
| **Comunicado** | idComunicado, texto, fecha, estado (sin_verificar/verificado/refutado) y evidencia | Evento `comunicado` |
| **Consumo** | idConsumo, idTarea o idSolicitud, proveedor/modelo, tokens (entrada/salida), voz (segundos), coste estimado, tope aplicable | Evento `consumo` |
| **Resumen de conversación** | idResumen, idCorrelacion, texto, decisiones y tareas enlazadas | Evento `resumen` |
| **Instantánea de agente** | (propiedad del agente) agente, entorno, idEjecucion, generadoEn, completo, informe, huella | Almacén del agente (K4); el Director la **lee** |

**Estado de una entidad = último evento válido** que la modifica (proyección). Una corrección crea un evento `corrige` que apunta al evento corregido; **la versión anterior permanece**.

## 4. El ledger
### 4.1 Evento (`evento-ledger/1`)
```
idEvento        único, ordenable (p. ej. ULID)
secuencia       entero creciente sin huecos dentro de la partición
instante        ISO-8601 UTC, tomado por el ledger (no por el cliente)
tipo            ver §4.2
actor           propietario | director | agente:<id> | sistema | orquestador
refs            { idSolicitud?, idCorrelacion?, idTarea?, idPlan?, idAprobacion?, idDecision?, idEvidencia?, corrige? }
version         { capacidad?, registro?, prompt?, esquema }     # con qué versiones se hizo
datos           contenido del evento (sin secretos; tamaño acotado)
huellaPrevia    huella del evento anterior (encadenamiento)
huella          hash del evento canónico incluida huellaPrevia
```
**Propiedades exigidas:** solo añadir; secuencia sin huecos; encadenamiento verificable (si se altera un evento, la cadena falla); instante asignado por el ledger; tamaño máximo por evento; sin secretos (se rechaza un evento que contenga patrones de credencial); **idempotencia** (mismo `idEvento` o misma clave de evento = no duplica).

### 4.2 Tipos de evento
`solicitud` · `intencion` · `plan` · `plan_modificado` · `tarea_creada` · `tarea_estado` · `tarea_cancelada` · `aprobacion_solicitada` · `aprobacion_resuelta` · `delegacion_enviada` · `solicitud_duplicada` · `ejecucion_humana_confirmada` · `respuesta_recibida` · `evidencia` · `verificacion` · `mensaje_al_propietario` · `decision_propuesta` · `decision_resuelta` · `propuesta_abierta` · `propuesta_resuelta` · `comunicado` · `comunicado_verificado` · `consumo` · `limite_alcanzado` · `parada_emergencia` · `registro_cambiado` · `lectura_estado` (captura de un dato en vivo que se usó en una respuesta) · `resumen` · `corrige` · `error`.

### 4.3 Garantías de orden y concurrencia
Cada partición lógica (p. ej. por correlación) tiene **un único escritor efectivo** o usa **comparación de secuencia** (`añadir(evento, secuenciaEsperada)`): si otra escritura se coló, falla y se reintenta con el estado actual. Sin esto, dos tareas podrían aprobarse o registrarse a la vez. Es el requisito que **descarta** almacenes sin comparación atómica para el ledger de delegación (decisión D3 pendiente).
**Registro previo (write-ahead; aprobado, A-05):** las acciones sensibles (toda tarea L2–L4 que requiera autorización o trazabilidad) se registran **antes** de mostrarse, aprobarse o enviarse; si el ledger no puede registrar, **no se inicia ninguna acción nueva** de ese tipo (las ya iniciadas siguen su curso y se **reconcilian** al recuperarse). Las consultas L0 pueden atenderse avisando de que no quedan registradas; las propuestas L1 pueden comentarse pero **no se convierten en tareas**.

## 5. Proyecciones y reconstrucción
- **Tareas, decisiones, propuestas y estado de aprobaciones** son vistas derivadas del ledger.
- **Reinicio del Director:** se reconstruyen las proyecciones desde el ledger y se **vuelve a consultar** el estado en vivo (K3); nunca se «recuerda» un estado.
- **Índices de búsqueda** (de documentos o de eventos) son **reconstruibles** y no son fuente de verdad.
- **Consistencia:** una proyección guarda la `secuencia` hasta la que está calculada; si va por detrás, se avisa o se recalcula antes de responder.

## 6. Trazabilidad extremo a extremo
**Cadena canónica:**
```
mensaje al propietario ─► afirmación (con procedencia)
        ▲                       │
   respuesta_recibida ◄─ tarea ◄─ aprobación ◄─ plan ◄─ intención ◄─ solicitud ◄─ (voz/texto)
        │                  │
   evidencia ─► verificación ─► (sistema independiente)
   lectura_estado / K4 / K1 con su commit
```
**Preguntas que debe poder contestar el ledger** (criterio de aceptación): ¿quién pidió esto y cuándo? ¿qué entendió el Director? ¿con qué versión de capacidad, registro y prompt? ¿quién aprobó qué huella, por qué canal y cuándo caducaba? ¿qué respondió el agente? ¿qué evidencia hay y quién la verificó? ¿qué dije al propietario y con qué fuentes? ¿cuánto costó? ¿qué se corrigió después?
Cada afirmación factual de un mensaje guarda sus **referencias** (`[doc …]`, `[histórico …]`, `[en vivo …]`…). Una traza **incompleta** se declara («la fuente no consta»).

## 7. Interfaces lógicas (independientes del almacén)
| Interfaz | Operaciones | Requisitos |
|---|---|---|
| **AlmacénLedger** | `añadir(evento, secuenciaEsperada)`, `leer(desde, hasta, filtro)`, `ultimaSecuencia(partición)`, `verificarCadena(rango)`, `exportar(rango)` | Solo añadir; atomicidad por partición; encadenamiento verificable; exportación íntegra; copia de seguridad y **restauración probada** |
| **AlmacénConocimiento** | `buscar(consulta, capas)`, `obtener(id, versión)` con `procedencia` | Índice reconstruible desde git; devuelve **citas** (archivo, sección, commit) |
| **LectorEstado** | `leer(sistema, objeto)` → dato + `capturadoEn` + TTL | Solo lectura; credencial mínima; **no cachea sin TTL** |
| **LectorInstantáneas** | `ultima(agente, entorno)`, `listar(agente, entorno, n)`, `obtener(agente, idEjecucion)` | Solo lectura; nunca modifica ni borra |
| **Contador** | `registrar(consumo)`, `acumulado(ámbito)`, `puedeGastar(coste)` | Atómico respecto al tope |

Cualquier tecnología que cumpla estos contratos es válida. **La elección (D3) sigue pendiente.**

## 8. Requisitos que debe cumplir el almacén elegido (criterios para decidir D3)
| Requisito | Por qué |
|---|---|
| Escritura **atómica** con comprobación de secuencia (compare-and-set) | Evitar aprobaciones o registros duplicados/solapados |
| Solo-añadir impuesto (permisos o diseño) | Inmutabilidad real |
| Lectura ordenada y por rangos | Reconstrucción y auditoría |
| Consultas por `idTarea`, `idCorrelacion`, `idDecision`, tipo y fechas | Trazabilidad |
| Exportación íntegra y verificación de cadena | Auditoría y salida del proveedor |
| Copia de seguridad con **restauración probada** | Principio de recuperación del Plan Maestro |
| Control de acceso separado (el Director solo añade/lee su ledger; los agentes no lo escriben) | Separación de responsabilidades |
| Retención configurable sin borrado silencioso | §9 |
| Coste y mantenimiento acotados | Principio de coste controlado |
**Observación honesta:** las Data Tables del n8n tal como se usan hoy (instantáneas inmutables Get+Insert) **no ofrecen transacciones**; para el ledger de delegación (L3/L4) esto es un riesgo conocido. No se presume que bastarán más allá de la lectura de F1.

## 9. Datos, privacidad y retención (propuesta, a validar)
- **No se guardan:** credenciales, tokens, valores de variables de entorno, datos de usuarios finales, cuerpos completos de respuestas del catálogo (solo referencias y hashes).
- **Históricos:** las instantáneas e informes históricos **se conservan y se pueden consultar siempre**; la frescura (`vigente`, `a_actualizar`, `solo_historico`, A-01) solo cambia **cómo se presentan**, nunca si existen. El Director no borra instantáneas de los agentes (son inmutables) ni entradas del ledger.
- **Voz:** se guarda la **transcripción** y su confianza; el **audio** no se conserva por defecto (decisión de F4).
- **Retención inicial propuesta:** ledger y decisiones **sin borrado** (se archivan); conversación completa efímera, **resumen** permanente; consumo agregado mensual permanente. Cualquier borrado o anonimización es una acción L4 con constancia.
- **Redacción:** antes de escribir un evento se pasa un filtro de secretos; los textos del propietario pueden contener datos sensibles: se almacenan solo en el ledger privado.
- **Proveedor de IA:** lo que se envía al modelo se limita a una **lista cerrada** (D6, pendiente) y queda registrado qué se envió (referencias, no copias).

## 10. Versionado y evolución
`evento-ledger/1` solo admite campos nuevos **opcionales**; un cambio incompatible crea `/2` y convive con migración **explícita**. Las entidades llevan `version`; el ledger registra con qué versión del esquema se escribió cada evento.

## 11. Criterios de aceptación del diseño (para comenzar F1)
1. Toda entidad de §3 tiene su origen en el ledger o en una fuente identificada.
2. Cada pregunta de §6 tiene respuesta trazable en un caso de ejemplo escrito.
3. Los requisitos de §8 están **revisados por el propietario** (la elección de almacén queda aparte).
4. El filtro de secretos y la lista de datos prohibidos (§9) están aprobados.
5. Hay casos de prueba escritos de: reinicio con reconstrucción, corrección (`corrige`), conflicto de capas, dato comunicado sin verificar, traza incompleta.
