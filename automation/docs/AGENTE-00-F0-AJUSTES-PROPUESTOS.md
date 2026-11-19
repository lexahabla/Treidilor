# Agente 00 — F0: ajustes propuestos para el cierre definitivo

> **Estado (13/11/2026): A-01…A-07 APROBADAS por el propietario (F0 cerrada documentalmente; ver `AGENTE-00-F0-CIERRE.md`).** Los valores son **iniciales y configurables** (los de A-03, además, **provisionales**) y se **revisan durante las pruebas**. Las **correcciones de coherencia** de §6 quedan aceptadas (A-06) y no modifican ningún comportamiento ya desplegado. **Ninguna de estas decisiones autoriza la ejecución autónoma de agentes.** No hay código, workflows, credenciales ni producción afectados; no se ha ejecutado ninguna prueba.
>
> **Identificadores:** las decisiones nuevas se numeran **A-01…A-07** para no mezclarlas con D1–D12. Los valores numéricos son **hipótesis de diseño**, no medidas: el uso real los puede mover, por eso se revisan en las pruebas de F1 (condición 4 del propietario).

## 1. Umbrales de frescura de informes y datos (A-01: APROBADA como valores iniciales configurables)

### 1.1 Principio: la frescura depende de la pregunta, no solo de la fecha
| Tipo de pregunta | Qué exige | Ejemplo |
|---|---|---|
| **Histórica o comparativa** | Un informe de **cualquier edad**, siempre con su fecha e id; no hay umbral | «¿Qué mostró `ex-16`?», «¿qué cambió entre dos auditorías?» |
| **De presente** («cómo está», «ahora», «hoy») | Un dato **vigente**; si no lo hay, lo dice y ofrece actualizar | «¿Está bien el catálogo?» |
| **De decisión** (basar una acción en el dato) | Dato **vigente y completo**; si no, avisa antes de proponer | «¿Lanzo la importación?» |

### 1.2 Estados de frescura (los asigna el Director, con reglas fijas, no el modelo)
- **`vigente`**: puede presentarse como estado **a esa fecha** sin advertencia.
- **`a_actualizar`**: se presenta **con aviso** («tiene N días»; recomienda leer en vivo o lanzar una nueva ejecución, que es L2 con confirmación).
- **`solo_historico`**: solo como **registro histórico**; para preguntas de presente el Director responde «**no consta un dato actual**».
- Un informe con `completo=false` **nunca** es `vigente` (queda como mínimo `a_actualizar`) ni sustituye la referencia anterior.
- Un dato **en vivo** sin lectura posible: «no consta ahora»; nunca se rellena con el histórico.

- **Los informes históricos se conservan y se pueden consultar siempre** (condición del propietario): `solo_historico` describe cómo se **presenta** un dato (como registro, nunca como estado actual), **no** que se archive, oculte o borre. El Director no borra instantáneas; las del agente son inmutables.

### 1.3 Umbrales iniciales (aprobados, configurables)
| Fuente (capa) | `vigente` | `a_actualizar` | `solo_historico` | Invalidación por evento |
|---|---|---|---|---|
| Estado en vivo (K3): salud, disponibilidad | ≤ **60 s** desde la lectura | (se vuelve a leer) | — | — |
| Estado en vivo (K3): tareas, consumo | ≤ **5 min** | (se vuelve a leer) | — | Cambio de estado de tarea |
| Informe del **Auditor (12)** | ≤ **24 h** | 24 h – **7 d** | > **7 d** | Despliegue posterior (si el informe registra la versión desplegada y la lectura en vivo difiere) |
| Informe de **calidad (04)** | ≤ **7 d** | 7 – **30 d** | > **30 d** | **Cualquier evento registrado** posterior que altere el catálogo (importación, cambios masivos, publicación) |
| **Documentación (K1)** | No caduca por edad: cita siempre el **commit** y advierte «puede ir por detrás» | — | — | Commit más reciente del mismo archivo |
| **Registro (K2)** | Una sola versión vigente; se **relee al abrir sesión y antes de cada delegación** | — | — | Cambio de versión |
| **Decisiones (K5)** | Vigente hasta que otra decisión la sustituye | — | — | `decision_resuelta` posterior |
| **Comunicado (K7)** | Sin caducidad automática; se mantiene «comunicado» | A partir de **30 d**: «comunicado hace N días, sin verificar»; sugiere verificar | — | Verificación o refutación |
| Agentes futuros (05 precios, 10 analítica…) | Se fija en **su ficha de capacidad** (`frescura`) al darse de alta | | | |

### 1.4 Por qué estos valores (justificación)
- **60 s / 5 min en vivo:** la salud puede cambiar en un minuto; el coste de releer es casi nulo (L0). Más margen no ahorra nada y sí arriesga contestar con un dato caduco.
- **Auditor 24 h / 7 d:** revisa rutas, enlaces e integridad, que cambian con cada despliegue pero no cada minuto; hoy se lanza a mano, y un informe diario es un ritmo razonable. La salud inmediata la da el estado en vivo, no este informe. Por encima de 7 días ya no representa el sitio actual.
- **Calidad 7 d / 30 d:** el catálogo cambia por tandas (importaciones, ediciones), no por segundo; el Agente 04 está pensado para auditorías supervisadas (≤ 20 al día, pero en la práctica espaciadas). Una semana es un periodo de referencia útil; pasado un mes ya no describe el catálogo.
- **Invalidación por evento:** la edad es una señal pobre. Un informe de ayer queda obsoleto si se importó un lote después. Solo se aplica con eventos que **constan** en el ledger o que el propietario comunica; el Director **no puede ver** cambios hechos fuera de su registro, y lo dice («no consta si el catálogo cambió desde entonces»).
- **Documentación por commit y no por edad:** un documento antiguo puede ser exacto y uno reciente, erróneo; lo que importa es cuál es la última versión y que K1 nunca prueba el presente.
- **Comunicado a 30 d:** recuerda verificar sin degradar automáticamente algo que puede seguir siendo cierto.
- **Parametrizable:** los umbrales viven en la **ficha de capacidad** (`frescura: {vigenteHasta, actualizarHasta, invalidadoPor}`) y se cambian por **versión del registro**, no en código ni por el modelo.
- **Riesgo reconocido:** si el propietario lanza la auditoría de calidad cada 10 días, el informe estará casi siempre `a_actualizar`: el Director lo avisará con frecuencia. Es deliberado; se ajusta con uso real.

### 1.5 Comportamiento esperado
| Estado | Pregunta de presente | Pregunta histórica |
|---|---|---|
| `vigente` | Responde con fecha | Responde con fecha |
| `a_actualizar` | Responde **con aviso** y ofrece actualizar (L2 si lanza algo) | Responde con fecha |
| `solo_historico` | «No consta un dato actual» + ofrece actualizar | Responde como histórico |

## 2. Ventana de idempotencia (A-02: APROBADA; idempotencia vinculada a la huella y a su aprobación específica)

### 2.1 Objetivo y problema encontrado
Evitar **ejecuciones duplicadas** (doble clic, reenvío, reintento de red, petición repetida) **sin impedir** una nueva ejecución **autorizada**. El ejemplo actual de `PROTOCOLO-AGENTES.md` (clave con la hora: `…:2026-11-14T11`) **bloquearía** una segunda auditoría legítima dentro de la misma hora aunque el propietario la apruebe; por eso se **neutraliza** el ejemplo (§6, C2) y se propone esta regla.

### 2.2 Regla en cuatro capas
1. **Solicitud pendiente (antes de aprobar).** Si ya existe una aprobación `pendiente` y no caducada para la **misma `huella`**, una petición igual **reutiliza** esa solicitud; no se crea otra. Ventana = hasta la caducidad de la aprobación (A-03).
2. **Ejecución (una aprobación = una ejecución).** `claveIdempotencia = hash(huella ‖ idAprobacion)`. Un reenvío con la misma clave devuelve **la tarea existente** (`duplicada`), **en cualquier momento**: la clave no vence (existe mientras exista el ledger; se indexa para respuesta rápida al menos 7 días y, pasado ese plazo, se consulta el ledger).
3. **Concurrencia.** Una tarea **activa** por capacidad: si hay una activa con la misma `huella`, una petición nueva **no crea otra**, aunque traiga una aprobación nueva (se rechaza sin consumir esa aprobación y se informa de la activa). Si es otra `huella` de la misma capacidad, rige el límite de concurrencia (`limite_alcanzado`).
4. **Intervalo y cuotas de la capacidad.** Es un **límite distinto** (p. ej. 04: ≥ 2 min entre ejecuciones; ≤ 20 al día): se aplica siempre y devuelve `limite_alcanzado`; **no** es idempotencia.

### 2.3 Qué sí está permitido
- **Nueva ejecución autorizada:** una vez terminada la anterior, una petición nueva genera **otra aprobación** (otra `idAprobacion`) y por tanto **otra clave**: se ejecuta, siempre que respete el intervalo y las cuotas (capa 4).
- **Aviso informativo de repetición reciente (no bloquea):** si la misma capacidad y `huella`-sin-aprobación se ejecutó con éxito en los últimos **10 min** (propuesta), el Director muestra «se ejecutó hace X con este resultado; ¿repetir?». Si el propietario confirma, sigue el flujo normal.
- **Reintento tras fallo:** `fallida`/`expirada` → es una **tarea nueva** con **nueva aprobación** si hay efecto. Antes de proponerla, el Director **comprueba el estado real** (el primer intento pudo haber surtido efecto: p. ej. una instantánea ya escrita).

### 2.4 Justificación
- **No usar tiempo como clave** (p. ej. «una hora») evita bloquear lo legítimo y no depende del reloj.
- **Atar la clave a la aprobación** hace imposible ejecutar dos veces con una sola autorización, y deja que cada autorización nueva sea una ejecución nueva.
- **Reutilizar la solicitud pendiente** evita acumular aprobaciones equivalentes (riesgo de aprobar la que no era).
- **Clave sin vencimiento + índice de 7 días:** un reenvío tardío (red, reinicio) sigue siendo duplicado; no se depende de que el índice esté en memoria.
- **10 min de aviso:** menos que la caducidad L2 propuesta (15 min) y mayor que el intervalo mínimo del 04 (2 min); es una ayuda, no una barrera.

### 2.5 Aplicación por nivel
| Nivel | Reglas aplicables |
|---|---|
| L0, L1 | Sin idempotencia de ejecución (lecturas y propuestas no tienen efecto); reintento libre dentro del volumen |
| L2, L3 | Capas 1–4 |
| L4 | Capas 1–2 (la ejecuta una persona; una aprobación solo se consume una vez) |

### 2.6 Pendiente
Si un fallo **sin efecto** (p. ej. `origen_no_disponible` en una lectura L2) debe permitir un reintento **sin** nueva aprobación mientras ésta siga vigente: mejora de usabilidad, pero **debilita** «una aprobación = una ejecución». **Decisión A-07: se mantiene la prohibición** de reintentos automáticos sin nueva autorización cuando hay incertidumbre sobre los efectos; la lectura estricta (nueva aprobación siempre para una tarea) está explicada en `AGENTE-00-F0-CIERRE.md` §2 (I-2).

## 3. Caducidades de aprobación y reautenticación (A-03: APROBADA PROVISIONALMENTE; A-04: APROBADA)
**Revisión de los valores de `MATRIZ-PERMISOS.md` (15/10/5 min aprobados provisionalmente, A-03; reautenticación y sesión aprobadas, A-04):**

| Nivel | Caducidad inicial | Propuesta | Justificación | Si es demasiado corta | Si es demasiado larga |
|---|---|---|---|---|---|
| **L2** | 15 min | **Mantener 15 min** | Cubre leer el resumen (qué se lanza, cuota, límites) y decidir; es más corto que la vida útil de lo que se muestra: ventana de 60 s del API, tope diario y estado del agente cambian con el tiempo | Fricción en cada auditoría | El resumen mostrado (cuota, margen del día) puede dejar de ser cierto |
| **L3** | 10 min | **Mantener 10 min** | Exige revisar una **vista previa** y la vía de deshacer; tiempo suficiente sin dejar abierto un cambio | Revisión apresurada | El borrador/estado previsto puede cambiar |
| **L4** | 5 min | **Mantener 5 min**, con **renovación** (ver abajo) | Irreversible: la ventana debe ser mínima; coincide con la reautenticación | Presión sobre una revisión grande → riesgo de aprobar sin leer | Una aprobación olvidada o un acceso ajeno podrían aprovecharla |

**Reglas comunes propuestas:**
1. El reloj empieza cuando la solicitud se **muestra** al propietario (no cuando se crea), y se registra en el ledger **antes** de mostrarse.
2. La caducidad afecta al **inicio**: una tarea **ya iniciada no se cancela** por caducar su aprobación (se detiene solo con `cancelar`).
3. **Planes de varios pasos:** la aprobación de cada paso se solicita **cuando ese paso queda listo** (dependencias cumplidas), nunca por adelantado; así sus datos y límites son actuales.
4. **Renovación:** si caduca mientras el propietario aún revisa, se puede **volver a presentar la misma `huella`** con **nuevo reloj y nueva reautenticación**; **máximo 2 renovaciones** y solo si el contenido es **idéntico** (cualquier cambio exige nueva solicitud). En L4 una revisión larga es una señal de que conviene **trocear** la acción.
5. **Silencio ≠ aprobación**; tras caducar, `aprobacion_caducada` y se pide una nueva.

**Reautenticación (A-04) y sesión:**
| Nivel | Propuesta | Justificación |
|---|---|---|
| L0, L1 | Sesión válida | Sin efecto |
| L2 | Sesión válida | Solo lectura con carga; aprobar ya exige interfaz autenticada |
| **L3** | **Obligatoria si la última autenticación fue hace > 30 min** (en la matriz es «recomendada») | Equilibrio entre fricción y riesgo: cambia algo reversible; una sesión larga y desatendida es el riesgo |
| **L4** | **Obligatoria**, realizada **≤ 5 min antes** de confirmar (la matriz ya dice ≤ 5 min) | Irreversible; coincide con la caducidad para que la reautenticación y la confirmación sean **del mismo acto** |
| **Sesión** | **Inactividad 30 min**; duración máxima **8 h** | Las sesiones del DISENO son «cortas»; estos valores evitan sesiones abiertas sin uso |
| **Voz** | La voz **no autentica**; nunca sustituye la reautenticación | Decisión D10 ya aprobada |

**Qué sale de aquí (aprobado):** las tres caducidades **no cambian** (provisionales, A-03), y **sí** (A-04) L3 pasa a «obligatoria > 30 min» y se fija la sesión (30 min de inactividad / 8 h).

## 4. Casos de evaluación añadidos (A-05: ACEPTADOS los 68 casos, 43 críticos)
Se añaden **9 casos** a la batería (EV-60…EV-68), que pasa a **68** (43 críticos). Los que dependen de parámetros llevan la marca **[A-0n]**; esos parámetros son iniciales y configurables, así que sus criterios se **revisan durante las pruebas**.

| Id | Cubre | Crítico | Desde |
|---|---|---|---|
| EV-60 | `solicitud_invalida`: parámetros fuera de esquema | Sí | F3 |
| EV-61 | `solicitud_invalida`: salida estructurada del modelo no válida | Sí | F1 |
| EV-62 | `interno`: fallo no clasificado de un agente/orquestador | Sí | F3 |
| EV-63 | `interno`: el ledger no puede registrar (**sin registro no hay ejecución**) | Sí | F2 |
| EV-64 | Nueva ejecución autorizada tras completar (no es `duplicada`) **[A-02]** | Sí | F3 |
| EV-65 | Doble petición antes de aprobar: reutiliza la solicitud pendiente **[A-02]** | No | F3 |
| EV-66 | Tres estados de frescura y pregunta de presente vs histórica **[A-01]** | Sí | F1 |
| EV-67 | Invalidación por evento del ledger **[A-01]** | No | F2 |
| EV-68 | Aprobación caducada con tarea ya iniciada y aprobación por paso **[A-03]** | Sí | F3 |
Detalle en `AGENTE-00-BATERIA-EVALUACION.md`. **Principio aprobado (A-05) que fijan EV-62/63:** *registro previo* (write-ahead): las acciones sensibles se registran en el ledger **antes** de ejecutarse; si el ledger falla, **no se inicia ninguna acción nueva** que requiera autorización o trazabilidad.

## 5. Decisiones (estado tras la autorización del 13/11/2026)
| # | Decisión | Estado |
|---|---|---|
| **A-01** | Umbrales de frescura (§1) | **Aprobada** como valores iniciales configurables |
| **A-02** | Idempotencia vinculada a huella y aprobación (§2) | **Aprobada** |
| **A-03** | Caducidades 15 / 10 / 5 min (§3) | **Aprobada provisionalmente** |
| **A-04** | Reautenticación y sesión (§3) | **Aprobada** |
| **A-05** | 68 casos (43 críticos) y registro previo de acciones | **Aceptada** |
| **A-06** | 12 correcciones de coherencia (§6), sin modificar comportamientos desplegados | **Aceptadas** |
| **A-07** | Reintentos automáticos sin nueva autorización con incertidumbre | **Prohibición mantenida** |
Siguen pendientes, sin cambios, **D2, D4, D5, D6, D7, D9, D11 (F4) y D12**, la tecnología de almacén del ledger (D3) y la autorización de inicio de F1; ordenadas por dependencias en `AGENTE-00-F0-CIERRE.md` §6.

## 6. Revisión de coherencia: batería · protocolo · matriz · ledger
Revisadas las referencias cruzadas, estados, códigos, niveles y campos. **Correcciones aplicadas** (no cambian valores; son errores internos entre documentos) y **observaciones**:

| # | Hallazgo | Documentos | Acción |
|---|---|---|---|
| C1 | El ejemplo de `aprobacion` caducaba a los **10 min** de crearse, pero L2 es de **15** | Protocolo §3 ↔ Matriz §3 | **Corregido** (11:15) |
| C2 | La clave de idempotencia de ejemplo incluía la **hora**: bloquearía una segunda ejecución autorizada | Protocolo §3 ↔ A-02 | **Corregido**: ejemplo neutro y regla remitida a A-02 |
| C3 | `esperando_aprobacion` figuraba **después** de `en_curso`, pero la aprobación se obtiene **antes** de delegar (D10) | Protocolo §4, Diseño §7 ↔ Matriz §4 | **Corregido**: va entre `creada` y `aceptada`, solo para L2–L4 |
| C4 | La matriz remitía la evidencia al §4 del protocolo (estados); la evidencia está en §5 y **§13** | Matriz §3 ↔ Protocolo | **Corregido** |
| C5 | El ledger no tenía el estado de aprobación **`consumida`** (una aprobación = una ejecución) ni `revocada` | Ledger §3 ↔ Matriz §4 | **Corregido** |
| C6 | El ledger no tenía eventos para **solicitud duplicada** ni para la **ejecución humana de L4** | Ledger §4.2 ↔ Protocolo §7, Matriz §3 | **Corregido** (`solicitud_duplicada`, `ejecucion_humana_confirmada`) |
| C7 | El protocolo no decía **quién ejecuta** L4 (la matriz: una persona en el panel) | Protocolo §3 ↔ Matriz §3 | **Corregido**: campo `ejecutor: agente|humano`; el Director no envía L4 |
| C8 | El Diseño ponía «programar una ejecución manual» en L3 y la matriz **activar programaciones** en L4 | Diseño §8 ↔ Matriz §6 | **Corregido**: «preparar una tarea programada **en pausa**» (L3); activarla es L4 |
| C9 | El Diseño citaba «§7.4», sección inexistente | Diseño §1 | **Corregido**: «§7, punto 4» |
| C10 | «Reintento libre (L0)» en la matriz chocaba con «máx. 1 reintento» del protocolo | Matriz §3 ↔ Protocolo §7 | **Corregido**: lectura L0 sin tarea es libre; una tarea, ≤ 1 reintento |
| C11 | Los casos EV-21/29/33 dependían de valores «pendientes» sin decirlo | Batería ↔ A-01…A-03 | **Corregido**: marcados **[A-0n]** |
| C12 | El plan de varios pasos no decía **cuándo** se pide la aprobación de cada paso | Protocolo §8 ↔ Batería EV-12 | **Corregido** (cuando el paso queda listo; ver §3, regla 3) |
| O1 | Los códigos `solicitud_invalida` e `interno` no estaban cubiertos | Batería ↔ Protocolo §7 | **Cubierto** por EV-60…63 |
| O2 | `rechazada` es estado terminal pero el protocolo no distinguía su origen | Protocolo §4 | **Aclarado**: aprobación rechazada o solicitud rechazada por validación del receptor |
| O3 | El límite «≤ 20 ejecuciones/día» del 04 es una **recomendación** de su guía, no un límite del API | Registro ↔ Batería EV-54 | **Sin cambio**: figura como límite de la capacidad (`maxPorDia`) en el registro |
| O4 | Los eventos y estados de la **batería** (`cancelada_por_usuario`, `parada_emergencia`, etc.) existen en el protocolo | Batería ↔ Protocolo §7 | Coherente |
| O5 | Todos los niveles de la batería coinciden con la clasificación de la matriz §6 y del registro | Batería ↔ Matriz ↔ Registro | Coherente |
| O6 | Los eventos del ledger cubren la cadena completa (solicitud → mensaje) | Ledger §4.2/§6 ↔ Protocolo §14 | Coherente |

## 7. Qué no se ha hecho
Ninguna decisión autoriza la ejecución autónoma de agentes ni inicia F1; no hay código, harness ni esquemas; no se ha ejecutado ninguna prueba; no se ha accedido a producción ni a proveedores; no se han tocado workflows ni credenciales; sin commits, merge ni push.

## 8. Condiciones de la autorización (13/11/2026)
1. **Históricos:** los informes históricos se conservan y se pueden consultar siempre, diferenciados de la información vigente (§1.2).
2. **Fallo o pérdida de comunicación:** el Director **comprueba el estado real** (lectura del sistema o de la instantánea guardada) **antes** de recomendar repetir. Un fallo no se da por «sin efecto» sin comprobarlo (EV-36, EV-62).
3. **Registro previo:** las acciones sensibles se registran **antes** de ejecutarse. Si el ledger falla, **no se inician nuevas acciones** que requieran autorización o trazabilidad. Las consultas L0 pueden seguir con aviso; las propuestas L1 no se convierten en tareas; las tareas ya iniciadas continúan y se reconcilian (EV-63).
4. **Configurables y revisables:** frescura, caducidad e idempotencia son parámetros configurables y se revisan durante las pruebas (§9).
5. **Sin autonomía:** nada de lo anterior autoriza la ejecución autónoma de agentes.

## 9. Parámetros configurables y revisión
Lista completa, con valor inicial, estado y dónde se define cada uno, en `AGENTE-00-F0-CIERRE.md` §4. Reglas: se cambian **por versión** (registro/configuración), con constancia en el ledger, **nunca** por el modelo ni por el agente; relajar un parámetro de seguridad (caducidad, reautenticación, niveles) requiere autorización expresa. Las revisiones durante las pruebas se registran con su motivo.
