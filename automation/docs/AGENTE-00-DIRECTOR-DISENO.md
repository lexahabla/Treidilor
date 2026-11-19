# Agente 00 — Director y coordinador conversacional de Treidilor AI (DISEÑO)

> **Estado (13/11/2026): DISEÑO; F0 CERRADA DOCUMENTALMENTE (D1, D8 provisional, D10, diseño de D3 y A-01…A-07 aprobados; ver [`AGENTE-00-F0-CIERRE.md`](AGENTE-00-F0-CIERRE.md)). Nada implementado; F1 sin iniciar; ninguna decisión autoriza la ejecución autónoma de agentes.** No hay código, workflows, credenciales, servicios contratados ni APIs de pago. No se ha modificado producción ni los workflows de los Agentes 04 y 12. Todo lo marcado «PROPUESTA» requiere autorización expresa antes de actuar; en especial, **este documento no altera el orden de implementación aprobado** (§12 lo trata como propuesta razonada aparte).
>
> **Qué es fiable en este documento:** el estado del código y de los agentes existentes (leído del repositorio). **Qué NO lo es:** precios, límites y características de proveedores externos: son órdenes de magnitud sin verificar con las tarifas vigentes (no se ha consultado ni contratado ningún proveedor). Verificar antes de decidir.
>
> Documentos hermanos: [`PROTOCOLO-AGENTES.md`](PROTOCOLO-AGENTES.md) (contratos de comunicación, informes y coordinación), [`../PLAN-MAESTRO.md`](../PLAN-MAESTRO.md), [`../agents/00-coordinador.md`](../agents/00-coordinador.md).

## 1. Visión
Un agente central, con personalidad propia, accesible por **texto y voz** (ordenador y móvil), que es el **único interlocutor** del propietario. El propietario no necesita saber qué agente hace qué: el Director interpreta la intención, elige los agentes, coordina su intervención, sintetiza resultados y propone mejoras estratégicas que se debaten antes de actuar.

**Objetivo funcional prioritario: conversación por voz.** La voz es el modo de interacción prioritario del Director (la selección tecnológica y la implementación son de F4, D11). No adelanta a F1–F3 ni relaja ninguna salvaguarda: por voz se consulta, se propone y se solicita; la confirmación L3/L4 es en la interfaz autenticada.

**Cuatro categorías que nunca se confunden** (principio obligatorio; cada mensaje del Director debe etiquetar de cuál habla):

| Categoría | Significa | Ejemplo de frase |
|---|---|---|
| **Consulta** | Lectura de algo que existe, con fuente y fecha | «Según el informe `ex-16` (13/11, comunicado/registrado), 38 productos tienen incidencias.» |
| **Propuesta** | Idea o plan del Director; no compromete nada | «Propongo revisar la normalización del comercio.» |
| **Instrucción pendiente** | El propietario ha pedido algo y falta confirmar/ejecutar | «Pendiente de tu confirmación: lanzar la auditoría de calidad.» |
| **Acción ejecutada** | Terminó Y hay confirmación independiente (§7, punto 4) | «Ejecutada: auditoría `ex-17`, guardada (fila 42 confirmada).» |

Regla de honestidad (heredada de la ficha del Coordinador): **no afirma como hecho lo que el registro no confirma**; sin dato, dice «no consta».

## 2. Relación con fichas existentes (a decidir, D1)
- La ficha **00-Coordinador** (prioriza trabajo, cola de tareas, resumen semanal; etapa 2.6) y la **13-Asistente conversacional y futura voz** (etapas 2.6/2.7) se solapan con este agente. **PROPUESTA:** el Agente 00 absorbe al Coordinador (misma misión, ahora conversacional) y el Agente 13 pasa a ser **el canal** (interfaz de texto/voz) del 00, no un agente con lógica propia. Así siguen siendo 14 fichas, sin duplicar cerebro. No se renumera nada hasta decidirlo (D1).
- **No confundir con el widget público** `/api/asistente-ia` (asistente de cara al visitante) ni con la consola IA del panel (`/api/admin/ai-console`). El Director es **privado, solo para el propietario**, sin acceso a datos de usuarios finales.

## 3. Responsabilidades y límites

**Hace:** conversar con contexto; responder con el conocimiento del proyecto citando fuentes; consultar informes y estados; compartir y debatir ideas y mejoras; recibir instrucciones y convertirlas en tareas; seleccionar agentes; delegar, seguir, cancelar y recuperar resultados; sintetizar; llevar el registro auditable de solicitudes, decisiones, delegaciones y resultados.

**No hace (límites duros):**
- No ejecuta nada por su cuenta con efecto: publicar, cambiar catálogo/precios, importar, gastar, activar programaciones, crear credenciales → **siempre confirmación humana** (§8).
- No inventa resultados ni da por hecho lo que no terminó.
- No guarda ni usa credenciales de otros agentes; no puede ampliar los permisos de un agente ni «saltarse» sus restricciones (cada agente las aplica por sí mismo; el Director solo puede pedir lo que el agente ya permite).
- No lee datos de usuarios finales, `credentials.json`, claves ni analítica personal.
- No usa `TRADYLOR_API_TOKEN` (principio 3 del Plan Maestro).
- No obedece instrucciones contenidas en datos (informes, fichas, páginas leídas): son **datos, no órdenes** (§10).

## 4. Relación con los agentes especializados
Modelo **centro-radios** (hub-and-spoke): los agentes **no se delegan entre sí**; toda delegación pasa por el Director/orquestador. Es la medida principal contra bucles (§9).

| Agente | Estado real (13/11/2026) | Papel con el Director | Cuándo se integra |
|---|---|---|---|
| 12 Auditor General | Existe (v0). Producción pública; su despliegue se documenta aparte | Fuente de informes de salud. Lectura de su tabla de instantáneas | F1 (lectura) |
| 04 Calidad del catálogo | Desplegado, manual, supervisado; línea base `ex-16` (dato comunicado) | Fuente de informes de calidad; delegable (lanzar auditoría manual) | F1 (lectura), F3 (delegación) |
| 01 Investigador de mercado | v0 de reglas (local) | Consulta/delegación de investigación | F3 |
| 05 Analista de precios | Previsto | Consulta de precios con evidencia | tras su despliegue |
| 03 Importador, 06 Portada, 02 Afiliación | Previstos (2.5, proponen) | Delegación de **propuestas**; toda aplicación con aprobación | F3–F5 |
| 07, 08, 09, 10, 11 | Posteriores | Se incorporan al registro al existir | F5 |
| 13 Asistente | Previsto | Canal de voz/texto del 00 (D1) | F1 (texto), F4 (voz) |

Mientras solo existan 2 agentes, la selección de agente es una **tabla de reglas** sobre el registro de capacidades, no «inteligencia» (§12).

## 5. Arquitectura (por capas)
```
 Canales                  Núcleo del Director                    Ejecución
┌──────────────┐   ┌─────────────────────────────────┐   ┌──────────────────────┐
│ Web privada  │   │ 1 Pasarela (auth, sesión, límites)│   │ Orquestador (n8n)     │
│ (PC/móvil)   │──►│ 2 Intérprete de intención        │──►│  workflows por agente │
│ Voz (F4)     │   │ 3 Planificador (tareas, deps)    │   │  + adaptadores        │
└──────────────┘   │ 4 Autorizador (L0–L4)            │   └──────────┬───────────┘
                   │ 5 Contador de costes y límites   │              │ informes
                   │ 6 Registro/ledger auditable      │◄─────────────┘ normalizados
                   │ 7 Adaptador de proveedor LLM ────┼──► Modelos (externos o locales)
                   └───────┬─────────────────────────┘
                           │ lectura / escritura
   ┌───────────────────────▼───────────────────────────────┐
   │ Memoria y conocimiento (§6): documentado · registro ·  │
   │ estado actual · histórico · decisiones · tareas        │
   └────────────────────────────────────────────────────────┘
```
Componentes (qué son, no cómo se programan):
1. **Pasarela:** autenticación del propietario, sesión, límites de uso, sanea entradas. Única puerta.
2. **Intérprete:** convierte el mensaje en una *intención estructurada* (categoría §1, agentes candidatos, parámetros, riesgo). Salida validada contra esquema; si es ambigua, **pregunta**.
3. **Planificador:** descompone en tareas y dependencias (grafo acíclico), con presupuesto y plazo.
4. **Autorizador:** clasifica cada paso por nivel de riesgo (§8) y exige la confirmación correspondiente; ninguna delegación con efecto sale sin su aprobación.
5. **Contador de costes:** presupuesto por conversación, tarea, día y mes; corta al llegar al límite.
6. **Ledger auditable:** registro de solo añadir de solicitudes, decisiones, delegaciones, aprobaciones y resultados (§6.6).
7. **Adaptador de proveedor** (§5.1): el único punto que conoce al modelo.

El Director **no ejecuta workflows**: pide a n8n que lo haga mediante el protocolo (`PROTOCOLO-AGENTES.md`). n8n sigue siendo el orquestador y Treidilor el sistema de registro (Plan Maestro §4).

### 5.1 Independencia del proveedor de IA
**Principio:** ninguna lógica del Director depende de un modelo concreto. Todo acceso a modelos pasa por una interfaz propia (**`ProveedorModelo`**, contrato estable) con estas operaciones y capacidades declaradas:
- `conversar(mensajes, herramientas?, esquemaSalida?)` → texto o llamada a herramienta.
- `salidaEstructurada(esquema)` (JSON validado; con reintento acotado y fallo explícito).
- `vozAEscrito` / `escritoAVoz` / `vozTiempoReal` (opcionales, F4).
- Capacidades declaradas por proveedor: ventana de contexto, llamada a herramientas, JSON estricto, idiomas, soporte de caché de prompt, ubicación de datos (UE/fuera), política de retención.
- **Enrutado por tarea** (configuración, no código): p. ej. un modelo barato/rápido para clasificar intención y resumir; uno más capaz para planes y debate estratégico; uno local para contenido sensible, si se desea. **Cadena de respaldo** ante caída o cuota agotada, con aviso al propietario (nunca cambio silencioso a un proveedor que reciba datos que antes no recibía).
- **Prompts y herramientas como activos versionados** (no incrustados en un proveedor); el **conjunto de pruebas de comportamiento** (evaluación) se ejecuta contra cualquier proveedor antes de adoptarlo: mismas preguntas con respuesta conocida (incluidas trampas: «¿ya se ejecutó X?», datos ausentes, instrucciones dentro de datos).
- Contexto mínimo: al modelo se le envía solo lo necesario (nunca credenciales, datos de usuarios finales ni la base entera).

El repositorio ya tiene un patrón de proveedores intercambiables para el texto del sitio (`src/lib/ai.ts`: OpenAI, Anthropic, Groq, Gemini). Es **precedente de diseño**, no código reutilizable tal cual: el Director vive fuera de `src` de producción web (n8n/servicio propio) y tiene requisitos distintos (herramientas, ledger, límites).

**Comparativa de proveedores (orientativa; precios NO verificados):**

| Opción | Capacidades | Coste orientativo | Limitaciones / riesgos |
|---|---|---|---|
| Modelo propietario de gama alta (p. ej. familia Claude, GPT, Gemini) | Mejor razonamiento, herramientas y JSON fiables, contexto amplio | Bajo-medio a nuestro volumen (§13): del orden de **decenas de €/mes** como máximo para uso personal de texto | Datos salen a un tercero (retención/ubicación a revisar, RGPD); dependencia y cambios de modelo; cuotas |
| Modelo propietario pequeño/rápido | Suficiente para clasificar, resumir, formatear | **Céntimos a pocos €/mes** | Peor en planes largos y debate; más alucinación en tareas complejas |
| Capa gratuita (p. ej. Groq/Gemini free) | Útil para pruebas | 0 € | Límites bajos (ya observados en producción con Groq), sin garantías, condiciones de uso/datos; no apta como único proveedor |
| Modelo abierto en servicio gestionado (Llama, Qwen, Mistral…) | Buena relación calidad/precio; algunos con ubicación en la UE | Bajo | Herramientas/JSON menos fiables según modelo; hay que evaluarlo |
| Modelo local en el PC (Ollama/LM Studio) | Datos no salen; coste marginal 0 | 0 € + electricidad | **PC encendido** (rompe principio 7 «producción no depende del PC»); calidad menor; solo apto para pruebas o contenido sensible |
| Modelo propio en el VPS | Autonomía total | Sin GPU: lento y de baja calidad; con GPU dedicada: **cientos de €/mes** | Desproporcionado a este volumen; no recomendado |

**Recomendación (a decidir, D2):** adaptador + **un solo proveedor** externo de gama media para F1, un segundo pequeño para clasificar cuando haga falta, y el modelo local solo como pruebas. El coste lo domina el uso de voz, no el texto (§13).

## 6. Memoria y conocimiento centralizados
**Problema:** depender solo del historial de conversación pierde información, se contradice y se vuelve obsoleto. **Solución:** el Director consulta **fuentes distintas, con distinta fiabilidad y frescura**, y siempre indica de cuál procede cada dato.

| Capa | Contenido | Fuente de verdad | Frescura | Cómo se usa |
|---|---|---|---|---|
| **6.1 Documentada** | Visión, arquitectura, plan maestro, fichas, procedimientos, guías, decisiones aprobadas | Documentos versionados en git (`AGENTS.md`, `automation/**`) | Cambia por commit; **puede ir por detrás de la realidad** | Recuperación por búsqueda sobre documentos con **cita** (archivo+sección+commit). Se indexa solo lo aprobado |
| **6.2 Registro** | Agentes, capacidades, herramientas, permisos, esquemas, límites, estado (operativo/planificado/desactivado) | Archivo de registro versionado (`registro-agentes`, §7.1) | Por cambio revisado | Selección de agentes; el Director **no** puede darse permisos nuevos |
| **6.3 Estado actual** | ¿Está vivo el sitio? ¿Qué tareas corren? ¿Cuánto se ha gastado hoy? | **Consulta en vivo** a sistemas (health, n8n, ledger) | Segundos; cada dato lleva `capturadoEn` | Nunca se cachea sin TTL ni se recita de memoria: se vuelve a consultar |
| **6.4 Histórico** | Informes e instantáneas (p. ej. `ex-16` de calidad; auditorías previas) | Tablas de instantáneas **inmutables** de cada agente | Fija (fecha del informe) | Comparar, tendencias, «qué cambió desde…». Se cita el id de ejecución |
| **6.5 Decisiones y tareas** | Qué se decidió, por quién, cuándo, con qué base; tareas, dependencias, estado | Registro operativo propio (§6.6) | Vivo, con revisión | Continuidad entre sesiones sin depender del chat |
| **6.6 Ledger y conversación** | Solicitudes, aprobaciones, delegaciones y resultados (solo añadir); resúmenes de conversación | Ledger propio | Inmutable | Auditoría; el chat completo es **efímero** y solo se conserva resumido y enlazado a decisiones |

**Reglas de precedencia y honestidad:**
1. Para «cómo está ahora»: **estado actual > histórico > documentado**. Un documento nunca prueba el presente.
2. Cada afirmación factual del Director lleva etiqueta de origen: `[doc]`, `[registro]`, `[en vivo hh:mm]`, `[histórico ex-16]`, `[decisión D-012]`, `[comunicado por el propietario]`. Sin etiqueta no se afirma.
3. Si dos capas discrepan, **lo dice** y no elige en silencio (p. ej. la documentación dice «desplegado» pero el estado en vivo no lo confirma).
4. La memoria **no la escribe el modelo libremente**: se registra por operaciones definidas (crear decisión, crear tarea, cerrar tarea) que el propietario puede revisar/editar. Corregir una entrada crea una **nueva versión**, no borra.
5. El contenido recuperado (documentos, informes) entra al modelo como **datos delimitados**, nunca como instrucciones (§10).

**Almacenamiento (PROPUESTA, D3):** al inicio, tablas propias en el patrón ya validado (Data Tables de n8n con instantáneas inmutables, como las de los Agentes 04 y 12, con sus limitaciones conocidas: sin transacciones, lectura por entorno). Si el ledger o las tareas crecen o necesitan consultas relacionales y atomicidad, migrar a una base de datos dedicada (p. ej. PostgreSQL propio) **antes** de F3. La recuperación de documentos (búsqueda léxica primero; vectorial solo si hace falta) es un índice **reconstruible** desde git: no es fuente de verdad.

## 7. Comunicación estandarizada entre agentes (resumen; contrato completo en `PROTOCOLO-AGENTES.md`)
1. **Registro de capacidades:** cada agente publica fichas de capacidad (qué hace, modo consulta/propuesta/acción, alcances, riesgo, entrada/salida, límites, plazo, coste).
2. **Sobre de tarea** común: `idTarea`, `idCorrelacion`, `profundidad`, `origen`, `agente`, `capacidad`, `modo`, `prioridad`, `alcancesSolicitados`, `aprobacion`, `parametros`, `plazoMs`, `presupuesto`, `claveIdempotencia`.
3. **Máquina de estados** única: `creada → (esperando_aprobacion) → aceptada → en_curso → completada | parcial | fallida | cancelada | expirada | rechazada` (la aprobación se obtiene antes de delegar; solo L2–L4).
4. **Confirmación de resultado (clave):** una tarea solo es «acción ejecutada» cuando el agente devuelve **evidencia** y el Director la **verifica por una segunda vía** (p. ej. relee la fila guardada, o el estado en el sistema). Es el mismo criterio que ya usa el Agente 04 («guardada» solo si el Insert devuelve la fila, `pendiente` = no confirmada).
5. **Informe normalizado** (`informe-agente/1`): sobre común que envuelve los informes propios de cada agente sin cambiar sus workflows (adaptador de solo lectura, §12).
6. **Errores y reintentos** con catálogo de códigos y política (sin reintento ciego; idempotencia).

## 8. Autorización de acciones
**Niveles de riesgo (cada capacidad del registro tiene uno fijo; el Director no puede bajarlo):**

| Nivel | Qué es | Requisito |
|---|---|---|
| **L0 Consulta** | Leer informes, estados, documentos | Ninguno (con límites de volumen) |
| **L1 Propuesta** | Redactar plan/idea/borrador sin efecto externo | Ninguno; queda registrada |
| **L2 Ejecución de lectura con coste/carga** | Lanzar una auditoría manual (consume cuota API, carga el VPS) | Confirmación explícita del propietario con resumen de coste/carga/límites |
| **L3 Acción con efecto reversible** | Crear borradores, importar a revisión, preparar una tarea programada **en pausa** (activarla es L4) | Aprobación explícita + vista previa + vía de deshacer |
| **L4 Sensible o irreversible** | Publicar, cambiar catálogo/precios, gastar dinero, activar programación, credenciales, borrar | Aprobación explícita **por canal fuerte** (panel web autenticado; nunca solo por voz), con caducidad corta y ligada al hash exacto de la acción |

**Reglas:** la aprobación se liga a la acción concreta (si cambian los parámetros, hace falta una nueva); caduca; por voz solo se puede **solicitar y resumir**, la confirmación L3/L4 se hace en pantalla; una aprobación nunca se reutiliza ni se infiere de otra; el propietario puede **consultar y detener** cualquier tarea (parada de emergencia global); toda aprobación y rechazo va al ledger. Un agente que no tiene permiso **no lo obtiene** porque el Director lo pida.

## 9. Costes, límites, bucles y recuperación
- **Presupuesto** por conversación, tarea, día y mes (en euros y en llamadas); alcanzar el límite detiene y avisa; el modo «solo lectura sin modelo» sigue disponible. Cada respuesta del proveedor registra tokens y coste en el ledger.
- **Límites de agentes:** el Director respeta los de cada agente (p. ej. API de automatización: 10 peticiones/min y 500/día por cliente; intervalo ≥ 2 min entre auditorías de calidad) y nunca los suma ni los elude con varios tokens.
- **Anti-bucles y duplicados:** centro-radios (los agentes no se delegan entre sí); `profundidad` máxima (propuesta: 2); grafo de tareas **acíclico** validado antes de ejecutar; **una tarea activa por capacidad**; `claveIdempotencia` (una aprobación = una ejecución; la regla de ventana está **propuesta** en `AGENTE-00-F0-AJUSTES-PROPUESTOS.md` §2); tope de tareas por conversación/hora; tiempo de espera obligatorio en cada tarea.
- **Recuperación:** una tarea sin respuesta pasa a `expirada` (no «completada»); el Director informa «no consta resultado», consulta el estado real y **no reintenta a ciegas** (un reintento es una tarea nueva y, si tiene efecto, requiere nueva aprobación). Reinicio del Director: se reconstruye desde el ledger y el estado en vivo.
- **Parada de emergencia:** interruptor único que impide nuevas delegaciones y cancela las en curso que lo permitan.

## 10. Seguridad
- **Autenticación:** un único propietario (más adelante, otros roles por decisión expresa); acceso privado con segundo factor; sesión corta. La **voz no autentica por sí sola**; las acciones L3/L4 exigen el canal fuerte.
- **Separación de credenciales:** el Director **no almacena** credenciales de agentes ni de Treidilor; solo puede pedir al orquestador ejecutar tareas del registro con la identidad propia de ese agente. Credencial propia mínima y revocable para el Director (alcance «invocar tareas del registro» y «leer informes»), jamás `TRADYLOR_API_TOKEN`.
- **Inyección de instrucciones:** todo texto procedente de informes, páginas, fichas o agentes se trata como dato; no puede cambiar el registro, los permisos, el nivel de riesgo ni disparar acciones. Las salidas del modelo que piden una acción se validan contra el registro y el Autorizador **fuera** del modelo.
- **Privacidad:** sin datos de usuarios finales; al proveedor externo solo el contexto mínimo; se documenta qué proveedor recibe qué y dónde se procesa; RGPD/LSSI a validar antes de F1 con proveedor externo (D6).
- **Límites del modelo:** nunca ejecuta código arbitrario ni accede al sistema de ficheros del VPS.

## 11. Personalidad
Profesional, cercana, proactiva y adaptable: tutea (idioma español), directa, honesta sobre lo que no sabe, resume primero y detalla si se pide, distingue siempre consulta/propuesta/pendiente/ejecutado, discrepa con argumentos cuando una idea tiene riesgos, y propone el siguiente paso. Se define como **guía de estilo versionada** (tono, fórmulas de confirmación, cómo dice «no consta», cómo debate una mejora) y se comprueba con la batería de evaluación; no como un texto suelto dentro de un proveedor.

## 12. Hoja de ruta por fases y criterios de aceptación
> **PROPUESTA razonada.** El orden aprobado de los agentes existentes (`PLAN-MAESTRO.md` §5) **no cambia**; el Director se inserta en paralelo y cada fase pide autorización expresa. Las dependencias están detalladas en §14.

| Fase | Alcance | Criterios de aceptación (todos medibles) |
|---|---|---|
| **F0 Fundaciones (sin modelo) — CERRADA documentalmente (13/11/2026)** | Registro de agentes y capacidades; protocolo y esquemas; ledger y niveles de riesgo definidos; documentación de conocimiento indexable; batería de evaluación | (a) Registro con los 14 agentes y estado real; (b) esquemas validan **informes reales** de los Agentes 04 y 12 mediante adaptador de lectura, sin tocar sus workflows; (c) ≥ 30 casos de evaluación escritos (incluye trampas); (d) revisión del propietario aprobada |
| **F1 Director textual de consulta** | Chat privado; responde sobre el proyecto con citas; consulta informes/instantáneas; sin delegar ni ejecutar | (a) 0 afirmaciones sin fuente en la batería; (b) responde «no consta» cuando falta el dato (100 % de los casos de prueba); (c) distingue consulta/propuesta/pendiente/ejecutado en el 100 %; (d) trata instrucciones dentro de datos como datos (casos de inyección superados); (e) coste mensual ≤ presupuesto fijado y límite probado; (f) el proveedor puede cambiarse pasando la batería sin tocar la lógica; (g) 0 acciones con efecto posibles |
| **F2 Memoria operativa y propuestas** | Decisiones, tareas e ideas persistentes; propuestas debatibles; ledger auditable | (a) cada decisión tiene origen y base; (b) el estado de tareas se reconstruye tras reiniciar; (c) editar crea versión, no borra; (d) el ledger es de solo añadir y exportable; (e) el Director no pierde una decisión entre sesiones (prueba de 10 casos) |
| **F3 Delegación supervisada** | Lanzar capacidades L2 (p. ej. auditoría manual) con confirmación; seguimiento, cancelación, síntesis; planes de 2 pasos | (a) 0 ejecuciones sin confirmación; (b) 0 duplicadas con la misma clave; (c) 0 bucles (profundidad y grafo probados con casos hostiles); (d) «ejecutada» solo con evidencia verificada; (e) cancelación efectiva y registrada; (f) respeta límites de cada agente; (g) los agentes siguen idénticos salvo el adaptador autorizado |
| **F4 Voz** | Primero pulsar-para-hablar (voz→texto, texto→voz); después tiempo real | (a) misma batería superada por voz; (b) confirmaciones L3/L4 solo en pantalla; (c) latencia y tasa de errores de reconocimiento medidas y aceptadas; (d) coste por minuto y tope diario probados; (e) móvil y escritorio verificados |
| **F5 Coordinación avanzada** | Planes con dependencias entre ≥ 3 agentes, resumen semanal, propuestas estratégicas; programación solo bajo aprobación | (a) planes con dependencias ejecutados con 100 % de trazabilidad; (b) propuesta aprobada/propuesta total medida; (c) autonomía limitada solo con métricas y decisión expresa (2.8) |

## 13. Alternativas tecnológicas y costes (orientativos, SIN verificar)
**Hipótesis de uso del propietario:** ~20 turnos/día, ~6 000 tokens de entrada (contexto + documentos + informes) y ~600 de salida por turno → ≈ 3,6 M de tokens de entrada y ≈ 0,36 M de salida al mes. Si se usa una banda de **0,15–1 €/M entrada y 0,6–4 €/M salida** (modelo pequeño) → **≈ 1–6 €/mes**; con una banda de **2–6 €/M y 10–30 €/M** (gama alta) → **≈ 10–35 €/mes**. Con caché de prompt y contexto recortado, menos. **Esas bandas son supuestos, no tarifas consultadas.**

| Componente | Alternativas | Coste orientativo | Comentario |
|---|---|---|---|
| **Interfaz** | (A) Página privada en el panel actual `/upayp1b4` (PWA para móvil) · (B) App móvil nativa · (C) Telegram/WhatsApp | A: 0 € de licencias · B: alto (desarrollo, tiendas) · C: bot gratuito, pero datos en terceros | **Recomendado A** (reutiliza autenticación y estilos; sirve en PC y móvil). C solo como aviso de alertas, nunca para aprobar L3/L4 |
| **Motor conversacional** | Ver §5.1 | Texto: del orden de 1–35 €/mes | El texto es barato; el riesgo es el diseño, no el precio |
| **Orquestación** | n8n ya instalado (workflows por agente) frente a un servicio propio de orquestación | n8n: sin coste adicional (ya existe) | **Recomendado**: n8n para ejecutar agentes; el «cerebro» del Director como servicio aparte con su propio ledger. Ojo: los agentes actuales solo tienen disparador manual; invocarlos exige un adaptador autorizado (D5) |
| **Voz** | (A) Navegador (Web Speech API): gratis, calidad y soporte irregulares, solo texto↔voz básico · (B) STT+TTS de pago en pulsar-para-hablar: del orden de **céntimos/min** (≈ 5–30 €/mes con 30 min/día) · (C) Voz en tiempo real de extremo a extremo: del orden de **decenas de céntimos/min**; con 30 min/día **≈ decenas a >100 €/mes** | A: 0 · B: bajo · C: alto | Voz **es el coste dominante**: empezar por A/B (F4a), tiempo real solo con tope diario y medición (F4b) |
| **Memoria** | Data Tables de n8n (patrón actual) · PostgreSQL dedicado · base vectorial | Data Tables: 0 · PostgreSQL en VPS: 0–pocos € · vectorial gestionada: variable | Ver §6: empezar con tablas propias y búsqueda léxica; vectorial solo si la evaluación lo justifica |
| **Alojamiento** | VPS actual (el mismo que n8n) | Sin coste nuevo si hay recursos | A comprobar: RAM/CPU libres del VPS y separación de red del Director (D7) |
| **Observabilidad** | Ledger propio + panel de consumo | 0 € | El ledger es imprescindible desde F1 |

**Coste total orientativo de F1–F3 (texto):** del orden de **decenas de €/mes como máximo**, más el tiempo de desarrollo. **Voz en tiempo real** es lo único que podría superar las decenas de €/mes; por eso se deja al final y con tope.

## 14. Orden de desarrollo propuesto (basado en dependencias, impacto, seguridad y coste)
> **Aprobado provisionalmente (D8).** No altera el orden aprobado de agentes; fija cuándo encaja el Director. Cada fase requiere autorización expresa.

**Dependencias técnicas:** el Director necesita (1) informes normalizados que leer, (2) un registro de capacidades, (3) un ledger y niveles de riesgo **antes** de poder delegar, (4) límites de coste **antes** de usar un modelo de pago, (5) agentes con efectos solo cuando exista el panel de aprobación (2.5).

**Construir pronto (valor alto, riesgo bajo, evita retrabajo):**
1. **Protocolo, esquemas y registro** (`PROTOCOLO-AGENTES.md`): es el contrato que deben respetar los agentes futuros; si se retrasa, cada agente nuevo se diseñaría sin él y habría que reformarlo.
2. **Ledger, niveles de riesgo y contador de costes.**
3. **Adaptador de proveedor y batería de evaluación.**
4. **Conocimiento documentado indexable** y **lectura de informes** (los Agentes 04 y 12 ya producen datos reales).
5. **Director textual de consulta (F1):** impacto inmediato (el propietario deja de leer informes a mano), riesgo mínimo (solo lectura).

**Esperar (a que existan más agentes/datos o decisiones):**
- **Selección inteligente de agentes y planificación con dependencias:** con 2 agentes una tabla de reglas basta; la planificación real necesita ≥ 3–4 agentes útiles.
- **Delegación con efecto (L3/L4):** exige el panel de aprobación de 2.5.
- **Voz en tiempo real:** coste alto y menor valor que el texto; tras 2.6.
- **Autonomía y programación:** solo con métricas (2.8).
- **Memoria semántica avanzada:** solo si la evaluación muestra que la búsqueda simple no basta.

**Encaje propuesto (sin cambiar el orden de los agentes):** F0 ahora (solo documentación y esquemas); F1 en paralelo a 2.4; F2 antes de 2.5; F3 junto con 2.5; F4 con 2.6/2.7; F5 con 2.8.

## 15. Decisiones que requieren autorización
| # | Decisión | Opciones / recomendación |
|---|---|---|
| D1 | Fusionar Coordinador + Asistente en el Agente 00 (13 = canal) | **APROBADA (13/11/2026)**; sin renumerar |
| D2 | Proveedor(es) de IA y dónde se procesa | Un externo de gama media + adaptador; revisar RGPD |
| D3 | Dónde vive el ledger/memoria (Data Tables vs PostgreSQL) | **Aprobado solo el DISEÑO del esquema** (`MEMORIA-LEDGER-DISENO.md`); tecnología y migración **pendientes** |
| D4 | Dónde corre el Director (servicio propio en el VPS vs página del panel) | Servicio separado, interfaz en el panel |
| D5 | Adaptadores para invocar los Agentes 04/12 sin modificar sus workflows | Lectura de instantáneas primero; lanzar ejecuciones solo en F3 |
| D6 | Envío de contexto al proveedor externo (qué datos) y revisión RGPD/LSSI | Contexto mínimo, sin datos personales |
| D7 | Recursos del VPS y red del Director (aislamiento) | Comprobar capacidad antes de F1 |
| D8 | Orden propuesto de §14 y su encaje con 2.4–2.8 | **APROBADA PROVISIONALMENTE**, sin alterar ni retrasar lo aprobado del Plan Maestro |
| D9 | Presupuesto mensual y tope diario de IA | Fijar antes de F1 |
| D10 | Qué acciones pasan a L3/L4 y canal de aprobación | **APROBADO el principio** (interfaz autenticada + acción exacta); detalle en `MATRIZ-PERMISOS.md` |
| D11 | Voz: navegador / STT+TTS / tiempo real | **Objetivo funcional prioritario fijado**; tecnología pendiente (F4) |
| D12 | Credencial propia del Director y alcance | Mínima, revocable, sin `TRADYLOR_API_TOKEN` |

## 16. Riesgos principales
| Riesgo | Mitigación |
|---|---|
| El modelo inventa o confirma lo no ejecutado | Etiquetas de fuente obligatorias; «ejecutada» solo con evidencia verificada fuera del modelo; batería de evaluación |
| Inyección de instrucciones vía informes/páginas | Datos delimitados; Autorizador fuera del modelo; registro como única fuente de permisos |
| Delegaciones circulares o duplicadas | Centro-radios, profundidad, grafo acíclico, idempotencia, una tarea activa por capacidad |
| Coste desbocado (sobre todo voz) | Presupuestos por nivel, topes, medición por respuesta, voz al final |
| Dependencia de un proveedor | Adaptador + batería + respaldo |
| Memoria desactualizada o contradictoria | Capas con frescura y precedencia; contradicciones visibles |
| Aprobar por error (voz, mensajería) | Canal fuerte para L3/L4, aprobación ligada al hash de la acción, con caducidad |
| Exceso de alcance del Director | Credencial mínima propia; sin credenciales de agentes; sin datos de usuarios |
| Solapamiento con Coordinador/Asistente | D1 |
| Fricción con workflows existentes (solo disparador manual) | Adaptadores de lectura primero; cambios solo con autorización (D5) |

## 17. Lo que NO se ha hecho ni verificado
- No se ha implementado, ejecutado, contratado ni probado nada; no hay credenciales ni claves nuevas.
- Precios, límites y capacidades de proveedores: **supuestos orientativos**, sin consulta a tarifas vigentes.
- Recursos libres del VPS, capacidad de las Data Tables del n8n real y la API del n8n de producción: **no inspeccionados**.
- Los datos sobre el despliegue del Agente 04 (`ex-16`) son **comunicados por el propietario** (ver `AGENTE-04-CALIDAD.md`).
