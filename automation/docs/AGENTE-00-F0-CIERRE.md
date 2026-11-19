# Agente 00 — Informe de cierre documental de F0 (13/11/2026)

> **F0 CERRADA DOCUMENTALMENTE.** Todo es documentación local. **F1 no ha comenzado y requiere autorización expresa.** **Ninguna de estas decisiones autoriza la ejecución autónoma de agentes.** No hay código, esquemas ejecutables, workflows nuevos, credenciales, servicios contratados ni accesos a producción; no se ha ejecutado ninguna prueba; no hay commits, merge ni push. Los workflows de los Agentes 04 y 12 no se han tocado (comprobado con `build-workflows --check`).

## 1. Decisiones aprobadas
| # | Decisión | Estado | Alcance exacto |
|---|---|---|---|
| D1 | Fusión del Coordinador en el Agente 00; el 13 es su canal | Aprobada (anterior) | Sin renumerar |
| D8 | Encaje F0–F5 con el Plan Maestro | Aprobada provisionalmente (anterior) | Sin alterar ni retrasar lo ya aprobado |
| D10 | L3/L4 por interfaz autenticada y acción exacta | Aprobada (anterior) | Principio |
| D3 | Esquema de memoria y ledger | Aprobado solo el diseño (anterior) | Almacén y migración pendientes |
| **A-01** | Clasificación de frescura y umbrales | **Aprobada** como **valores iniciales configurables** | `AJUSTES-PROPUESTOS.md` §1 |
| **A-02** | Idempotencia vinculada a la huella y a su aprobación específica | **Aprobada** | `AJUSTES-PROPUESTOS.md` §2: una aprobación = una ejecución |
| **A-03** | Caducidades de aprobación 15 / 10 / 5 min (L2 / L3 / L4) | **Aprobada provisionalmente** | Se revisan durante las pruebas |
| **A-04** | Reautenticación y duración de sesión | **Aprobada** | L3 > 30 min obligatoria; L4 ≤ 5 min antes de confirmar; sesión 30 min de inactividad / 8 h |
| **A-05** | 68 casos de evaluación (43 críticos) y registro previo de acciones | **Aceptada** | Batería y principio de registro previo |
| **A-06** | 12 correcciones documentales de coherencia (C1–C12) | **Aceptadas** | Sin modificar comportamientos ya desplegados (ninguna toca workflows ni `src`) |
| **A-07** | Prohibición de reintentos automáticos sin nueva autorización con incertidumbre sobre los efectos | **Mantenida** | Ver §2, I-2 |

## 2. Interpretaciones que he aplicado (confírmalas o corrígelas)
- **I-1 (A-02).** He tratado el **aviso informativo de repetición reciente (10 min)** y el **índice de respuesta rápida de 7 días** como parte de A-02 y, por tanto, como **valores iniciales configurables** (condición 4). La clave no vence.
- **I-2 (A-07).** Tu redacción prohíbe reintentar de forma automática sin nueva autorización **cuando hay incertidumbre sobre los efectos**. He mantenido la lectura **estricta**: ningún reintento automático de una **tarea** (L2+); todo reintento es una **tarea nueva con su aprobación y su clave** (A-02), incluso cuando consta que el primer intento no tuvo efecto. Solo se permiten reintentos **internos sin efecto**: máximo 1 de una salida del modelo no válida (EV-61) o de una lectura L0. Si querías permitir el reintento sin nueva aprobación **cuando los efectos sean ciertamente nulos**, indícalo (equivale a la antigua propuesta que ya descartamos).
- **I-3 (condición 3).** Con el ledger caído: **no se inicia ninguna acción nueva** que requiera autorización o trazabilidad (L2–L4 y toda delegación); las **consultas L0** pueden atenderse **avisando de que no quedan registradas**; las **propuestas L1** pueden comentarse pero **no se convierten en tareas**; las tareas **ya iniciadas** continúan y se **reconcilian** al recuperarse el ledger.
- **I-4 (A-03).** «Provisional» significa que 15/10/5 min se usan ya en el diseño y en los casos, pero se **revisan con las primeras pruebas con aprobaciones** (el primer uso real es F3; en F1 solo se evalúan con aprobaciones simuladas).

## 3. Condiciones del propietario y dónde se reflejan
| Condición | Reflejo en la documentación |
|---|---|
| 1. Los informes históricos se conservan y se consultan siempre, diferenciados de la información vigente | `AJUSTES-PROPUESTOS.md` §1.2; `MEMORIA-LEDGER-DISENO.md` §9; `REGISTRO-AGENTES.md` §7; EV-66 |
| 2. Ante fallo o pérdida de comunicación, el Director comprueba el estado real antes de recomendar repetir | `PROTOCOLO-AGENTES.md` §7; `AJUSTES-PROPUESTOS.md` §2.3 y §8; EV-36, EV-62 |
| 3. Acciones sensibles registradas antes de ejecutarse; un fallo del ledger impide nuevas acciones con autorización o trazabilidad | `MEMORIA-LEDGER-DISENO.md` §4.3; `MATRIZ-PERMISOS.md` §4; EV-63 |
| 4. Frescura, caducidad e idempotencia configurables y revisables en las pruebas | §4 de este documento; `AJUSTES-PROPUESTOS.md` §9 |
| 5. Nada de esto autoriza la ejecución autónoma de agentes | Aviso en este documento, en `MATRIZ-PERMISOS.md`, `AGENTE-00-F0-CONSOLIDACION.md` y `AGENTE-00-DIRECTOR-DISENO.md` |

## 4. Parámetros configurables (valores iniciales)
Ningún valor está escrito «en código» (aún no hay código). Se definen en la **ficha de capacidad / registro / configuración del Director** y se **cambian por versión**, con aprobación y constancia en el ledger; **nunca** los cambia el modelo ni el propio agente.
| Parámetro | Valor inicial | Estado | Dónde se define | Se revisa en |
|---|---|---|---|---|
| Frescura del estado en vivo | 60 s (salud) / 5 min (tareas, consumo) | Aprobado (A-01) | Configuración del Director | Pruebas de F1 (EV-66) |
| Frescura Auditor (12) | vigente ≤ 24 h · a_actualizar ≤ 7 d · histórico > 7 d | Aprobado (A-01) | `frescura` de la capacidad | F1 (EV-21, EV-66) |
| Frescura Calidad (04) | vigente ≤ 7 d · a_actualizar ≤ 30 d · histórico > 30 d | Aprobado (A-01) | `frescura` de la capacidad | F1 (EV-66, EV-67) |
| Comunicado sin verificar | aviso a los 30 d | Aprobado (A-01) | Configuración del Director | F1 |
| Invalidación por evento | eventos que alteran el catálogo | Aprobado (A-01) | `invalidadoPor` de la capacidad | F2 (EV-67) |
| Idempotencia: clave | `hash(huella ‖ idAprobacion)` | Aprobado (A-02) | Protocolo | F3 (EV-33, 64, 65) |
| Aviso de repetición reciente | 10 min | Aprobado como inicial (I-1) | Configuración del Director | F3 |
| Índice rápido de claves | 7 días (la clave no vence) | Aprobado como inicial (I-1) | Configuración del almacén | F3 |
| Caducidad de aprobación | L2 15 min · L3 10 min · L4 5 min | **Provisional** (A-03) | Matriz / configuración de aprobaciones | F3 (EV-29, EV-68) |
| Renovación | ≤ 2, contenido idéntico, nueva reautenticación | Aprobado (A-03/A-04) | Configuración de aprobaciones | F3 |
| Reautenticación | L3 si > 30 min; L4 ≤ 5 min | Aprobado (A-04) | Interfaz autenticada | F3 |
| Sesión | 30 min inactividad / 8 h | Aprobado (A-04) | Interfaz autenticada | F1 |
| Profundidad de delegación | 2 | Diseño (anterior) | Protocolo | F3 (EV-34) |
| Límites por capacidad | p. ej. 04: ≥ 2 min entre ejecuciones, ≤ 20/día, 10/min, 500/día | Registro | Ficha de capacidad | F3 (EV-54) |
| Presupuesto y tope de IA | — | **Pendiente (D9)** | Configuración del Director | F1 |
**Gobierno propuesto de cambios (decisión G-01, §6):** endurecer un parámetro de seguridad (caducidades, reautenticación, niveles) puede hacerse con aviso y versión; **relajarlo requiere autorización expresa**. Durante las pruebas se revisan y se registran los ajustes con su motivo.

## 5. Documentos de F0 (todos en `automation/docs/`, salvo indicación)
`AGENTE-00-DIRECTOR-DISENO.md` · `PROTOCOLO-AGENTES.md` · `REGISTRO-AGENTES.md` · `MATRIZ-PERMISOS.md` · `MEMORIA-LEDGER-DISENO.md` · `CONFORMIDAD-AGENTES.md` · `AGENTE-00-BATERIA-EVALUACION.md` (68 casos) · `AGENTE-00-F0-AJUSTES-PROPUESTOS.md` (A-01…A-07, ya aprobados) · `AGENTE-00-F0-CONSOLIDACION.md` · este informe de cierre. Además: ficha `automation/agents/00-coordinador.md`, índice de agentes, `PLAN-MAESTRO.md`, `AGENTS.md`.

## 6. Decisiones pendientes para comenzar F1, ordenadas por dependencias
Cada paso depende de los anteriores. **Ninguna está tomada ni autorizada.**

| Orden | Decisión / autorización | Depende de | Por qué en este punto |
|---|---|---|---|
| **0** | **Autorizar la inspección de solo lectura del VPS y del n8n real** (versión, runner, Data Tables y límites, recursos, tablas de los Agentes 04 y 12, caducidad del token) | — | Es la fuente de hechos que desbloquea las demás; hoy el estado de producción es **comunicado**, no verificado |
| **1** | **D7** Recursos del VPS y aislamiento de red del Director | 0 | Sin saber la RAM/CPU libres y la red no se puede decidir dónde correr |
| **2** | **D4** Dónde corre el Director (servicio propio frente a otras opciones) | 1 | Depende de que haya recursos y de poder aislarlo |
| **3** | **D3 (almacén mínimo para el ledger de F1)** | 0, 2 | Depende de lo que ofrezcan las Data Tables reales y de dónde corre el servicio; la migración sigue siendo antes de F3 |
| **4** | **D5 (parte de lectura)** Vía para leer las instantáneas de los Agentes 04 y 12, sin modificar sus workflows | 0, 3 | Necesita conocer las tablas reales y el almacén; fija qué puede leer F1 |
| **5** | **D12** Credencial propia del Director (alcance solo lectura, caducidad, revocación) | 2, 4 | Se define para lo que debe leer y desde dónde; no se crea sin autorización |
| **6** | **D6** Lista cerrada de contexto enviado al proveedor y revisión RGPD/LSSI | 4 | Se sabe qué datos se leen, por tanto qué podría enviarse |
| **7** | **D2** Proveedor(es) de IA y dónde se procesa | 6 | Los requisitos de privacidad y ubicación condicionan la elección |
| **8** | **D9** Presupuesto mensual, tope diario y corte | 7 | Se calcula con las tarifas del proveedor elegido |
| **9** | **G-01** Gobierno de cambios de parámetros (nueva) | Puede ir en paralelo, antes de las pruebas | Evita relajar por accidente parámetros de seguridad al ajustar |
| **10** | **Autorización del entorno de pruebas** (harness: código de prueba, fixtures, ledger aislado) | 3, 7, 8 | Ejecutar los 68 casos exige un almacén de pruebas, un modelo y un tope de gasto |
| **11** | **Alta del registro v1** (generado de `REGISTRO-AGENTES.md`), **lista cerrada de documentos de conocimiento (K1)** y **plan de pruebas de F1** aprobado | 6, 10 | Son los insumos de la evaluación |
| **12** | **Autorización expresa de inicio de F1** | 0–11 | Puerta de entrada (`CONSOLIDACION` §5) |

Hechos de infraestructura ya comprobados manualmente el 13/11/2026 (recursos, versiones, puertos, firewall), riesgos y comprobaciones que quedan: [`INFRAESTRUCTURA-VPS-PRODUCCION.md`](INFRAESTRUCTURA-VPS-PRODUCCION.md).

**No bloquean F1 (más tarde):** D11 voz (antes de F4) · migración del almacén y parte de **ejecución** de D5, envoltorio de workflows (antes de F3) · alcances nuevos de la API (2.5) · ejecución autónoma (F5/2.8; **no autorizada**).

## 7. Casos candidatos de regresión (no añadidos a la batería aprobada)
La batería aceptada tiene 68 casos y no se amplía sin tu autorización. Candidatos para F1: petición de **ejecución autónoma o programada** («hazlo tú solo cada noche») (condición 5); ledger caído con una tarea ya iniciada (reconciliación, I-3); informe histórico pedido por un agente distinto del propietario; consulta de históricos con el almacén degradado.

## 8. Riesgos abiertos
- Estado de producción de los Agentes 04 y 12 **comunicado, no verificado**; hoy no consta una vía de lectura de sus instantáneas.
- Umbrales y caducidades sin contraste con uso real (por eso son configurables y provisionales).
- Costes de proveedores sin verificar (D2/D9).
- El Agente 04 mantiene dos incidencias abiertas (comercio `[object Object]`, redes no identificadas).
- El token `n8n-calidad` caduca hacia el 13/12/2026.

## 9. Qué NO se ha hecho
No se ha iniciado F1; no hay código, harness, esquemas ejecutables ni tablas; no se ha tocado producción, workflows ni credenciales; no se ha contactado con proveedores ni contratado nada; no se ha ejecutado ninguna prueba; sin commits, merge ni push.
