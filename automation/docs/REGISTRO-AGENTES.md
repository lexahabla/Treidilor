# Registro de agentes y capacidades de Treidilor AI (F0) — DOCUMENTO DE DISEÑO

> **Estado (13/11/2026): F0 documental. Nada implementado.** Este registro es la fuente de verdad **documentada** (capa 6.2 de `AGENTE-00-DIRECTOR-DISENO.md`) de qué agentes existen, qué capacidades ofrecen y con qué permisos y nivel de riesgo. Cuando exista el archivo versionado `registro-agentes` se generará **a partir de este documento** (no al revés), y el Director solo podrá **leerlo**, nunca modificarlo.
>
> Contratos relacionados: [`PROTOCOLO-AGENTES.md`](PROTOCOLO-AGENTES.md) · [`MATRIZ-PERMISOS.md`](MATRIZ-PERMISOS.md) · [`CONFORMIDAD-AGENTES.md`](CONFORMIDAD-AGENTES.md) · [`MEMORIA-LEDGER-DISENO.md`](MEMORIA-LEDGER-DISENO.md).

## 1. Reglas del registro
1. Un agente **no existe para el Director** hasta estar en este registro con ficha de agente y fichas de capacidad completas y conformes (`CONFORMIDAD-AGENTES.md`).
2. **Estado** de un agente: `planificado` (solo ficha de diseño) · `construido_local` (código y pruebas en local, sin desplegar) · `operativo` (desplegado y utilizable) · `pausado` · `retirado`.
3. Cada estado lleva su **origen**: `documentado` (consta en el repositorio), `verificado` (comprobado por un sistema independiente, con fecha) o `comunicado` (lo afirma el propietario y nadie lo ha comprobado). El Director **debe mostrar el origen** al hablar del estado (regla de procedencia, DISENO §6).
4. El **nivel de riesgo** (L0–L4) de una capacidad lo fija este registro y la `MATRIZ-PERMISOS.md`; **ni el Director ni el agente pueden bajarlo** en ejecución.
5. **Alcances (permisos en la API de Treidilor).** Hoy la API de automatización solo tiene `catalog:read` (`docs/api-automatizacion.md`). Los demás alcances que citan las fichas (`proposals:create`, `drafts:write`, `research:write`, `import:simulate`, `analytics:read`, `tasks:*`, `audit:read`, `proposals:read`) son **previstos y NO existen**: crearlos es una decisión futura vinculada a 2.5 y requiere autorización. En la columna «Alcances» se distingue `existe` / `previsto`.
6. Los **nombres** de capacidad son provisionales hasta que el agente se construya; los identificadores (`<id>.<verbo-objeto>`) se congelan al alta en el registro.
7. Credenciales y workflows se referencian **por nombre**, nunca por id de instalación ni por valor.

## 2. Los 14 agentes (visión general)

| Id | Agente | Estado | Origen del estado | Etapa (Plan Maestro) | Riesgo ficha | Alcances de la ficha | Canal de invocación hoy |
|---|---|---|---|---|---|---|---|
| 00 | Director y coordinador conversacional (absorbe al Coordinador; D1 aprobada) | `planificado` (solo diseño) | documentado | Propuesta F0–F5 (D8 provisional) | Medio | `tasks:*`, `proposals:create`, `catalog:read` (previstos salvo `catalog:read`; se revisarán en D12) | — |
| 01 | Investigador de tendencias y productos | `construido_local` (v0 de reglas) | documentado | 2.0 → 2.5 | Bajo | `catalog:read` (existe) · `research:write`, `proposals:create` (previstos) | workflow local, solo manual |
| 02 | Investigador de programas de afiliación | `planificado` | documentado | 2.5 | Bajo | `research:write` (previsto) | — |
| 03 | Importador | `planificado` | documentado | 2.5 | Medio | `import:simulate`, `proposals:create` (previstos) | — |
| 04 | Calidad del catálogo | `operativo` (v0 «detectar», manual y supervisado; línea base `ex-16`; segunda ejecución `ex-18`, 14/11/2026) | **comunicado** (despliegue y cifras; ver `AGENTE-04-CALIDAD.md`) | 2.4 (detectar) → 2.5 (proponer) | Medio | `catalog:read` (existe) · `proposals:create` (previsto) | workflow n8n `Calidad del catálogo — Producción`, solo disparador manual |
| 05 | Analista de ofertas y precios | `planificado` | documentado | 2.4 → 2.5 | Alto | `catalog:read` (existe) · `proposals:create` (previsto) | — |
| 06 | Diseñador de categorías, portada e historias | `planificado` | documentado | 2.5 | Medio | `catalog:read` (existe) · `drafts:write` (previsto) | — |
| 07 | Marketing multicanal y SEO | `planificado` | documentado | Posterior a 2.6 | Medio | `research:write`, `drafts:write` (previstos) | — |
| 08 | Contenido y recursos visuales | `planificado` | documentado | Posterior a 2.6 | Medio | `drafts:write` (previsto) | — |
| 09 | Competencia y expertos | `planificado` | documentado | Posterior a 2.5 | Bajo | `research:write` (previsto) | — |
| 10 | Analítica y conversión | `planificado` | documentado | Posterior a 2.5 | Bajo | `analytics:read` (previsto; solo datos agregados) | — |
| 11 | Webs nicho | `planificado` | documentado | Posterior a 2.5 | Bajo | `research:write` (previsto) | — |
| 12 | Auditor General | `operativo` (v0) | **comunicado** en la solicitud del Director; en el repo está validado en local; en producción: **dos ejecuciones manuales correctas** (`ex-13` del 13/11 y `ex-17` del 14/11/2026, tabla con 2 filas; **comunicado por el propietario el 14/11, no verificado por el asistente**), sin publicar ni programar | 2.0 (v0 piloto) | Bajo | solo GET a URLs permitidas (política `urlPolicy`; no usa la API de automatización en modo `publico`) | workflow n8n, solo disparador manual |
| 13 | Asistente conversacional | `planificado`; **canal** del Agente 00 (D1 aprobada, sin renumerar) | documentado | 2.6 / 2.7 | Medio | `tasks:read`, `proposals:read`, `audit:read` (previstos) | — |

**Contabilidad:** 14 fichas (00–13). El 00 es el coordinador; el 13 es su canal y **no** ofrece capacidades delegables propias.

## 3. Fichas de capacidad de los agentes con datos reales (12 y 04)
Formato `capacidad/1` (campos en `PROTOCOLO-AGENTES.md` §2). Niveles según `MATRIZ-PERMISOS.md`.

### Agente 12 — Auditor General
| Capacidad | Modo | Nivel | Qué hace | Efectos | Verificación | Estado |
|---|---|---|---|---|---|---|
| `12.leer-ultimo-informe` | consulta | **L0** | Lee el último informe guardado (instantánea) | ninguno | El informe incluye `generadoEn`, `entorno`, `completo` | prevista; **requiere vía de lectura** (D5); la tabla existe en producción con 2 filas (comunicado 14/11) |
| `12.leer-historial` | consulta | **L0** | Lee varias instantáneas para comparar | ninguno | idem | prevista |
| `12.auditar-salud` | accion | **L2** | Lanza una auditoría (peticiones GET a páginas públicas del sitio) | Lectura con carga sobre el VPS; escritura de una instantánea inmutable | releer la fila guardada (`guardada` solo si el Insert devuelve la fila) | **no invocable por el Director** hasta que se autorice la automatización (F7) y un workflow envoltorio (D5); hoy solo existe el disparador manual en n8n |

Límites vigentes: solo GET, política de URLs `publico` (sin fichas ni salida de afiliado); una ejecución a la vez. **Nunca** se ejecuta su variante de producción en pruebas.

### Agente 04 — Calidad del catálogo
| Capacidad | Modo | Nivel | Qué hace | Efectos | Verificación | Estado |
|---|---|---|---|---|---|---|
| `04.leer-ultimo-informe` | consulta | **L0** | Lee la última instantánea de `calidad_catalogo_instantaneas` (p. ej. `ex-18`) | ninguno | `generadoEn`, `completo`, `persistencia.escritura = guardada` | prevista; vía de lectura pendiente (D5) |
| `04.comparar-informes` | consulta | **L0** | Compara dos instantáneas (nuevas / persistentes / resueltas) con el motor de seguimiento ya existente, solo lectura | ninguno | las dos instantáneas existen y son completas | prevista |
| `04.auditar-catalogo` | accion | **L2** | Lee el feed del catálogo (≤ 8 páginas) y guarda una instantánea | Consume cuota de la API (10/min, 500/día por cliente) y carga el VPS; escribe una fila inmutable | releer la fila (id numérico + `idEjecucion` propio) | **no invocable por el Director** hasta que se autorice la automatización y un envoltorio (D5); hoy solo existe el disparador manual en n8n |
| `04.proponer-correcciones` | propuesta | **L1** | Propone correcciones de fichas con datos reales | ninguno hasta aprobar | — | `planificado` (2.5); aplicarlas es L4 y lo ejecuta una persona en el panel |

Límites vigentes de `04.auditar-catalogo` (documentados): ≤ 8 páginas de 100, pausa de 7 s entre páginas, ≥ 2 min entre ejecuciones manuales y ≤ 20 al día, ventana de 60 s con 10 peticiones, cuota diaria UTC de 500. Token `n8n-calidad`: caduca hacia el 13/12/2026.
**Salvedad del propio informe:** los resultados de `ex-16` y `ex-18` están afectados por incidencias abiertas sin corregir (comercio `[object Object]` en algunas fichas de Amazon y redes no identificadas; además, 25 fichas sin categoría y advertencias por fechas de captura del precio, que son datos del catálogo y no del agente; `AGENTE-04-CALIDAD.md`). El Director debe **mencionarlo** cuando cite el reparto por comercio o por red.

## 4. Capacidades previstas de los demás agentes (nombres provisionales)
| Capacidad | Modo | Nivel previsto | Nota |
|---|---|---|---|
| `01.investigar-tendencias` | propuesta | L1 | v0 de reglas sobre catálogo; la versión con web externa llega en 2.5 |
| `02.estudiar-programa-afiliacion` | propuesta | L1 | Fuentes citadas; sin acciones |
| `03.simular-importacion` | consulta/propuesta | **L2** | La simulación puede consumir créditos de fuentes (Apify/ScraperAPI): confirma coste |
| `03.proponer-lote` | propuesta | L1 | **Importar** el lote es L4 y lo hace una persona en el panel |
| `05.detectar-caidas-precio` | propuesta | L1 | Solo con observaciones verificadas (regla de descuento ya codificada en Treidilor) |
| `06.proponer-portada` | propuesta | L1 | |
| `06.guardar-borrador-portada` | accion | **L3** | Reversible (borrador); **publicar y activar son L4** |
| `07.*`, `08.*` | propuesta/borrador | L1/L3 | Publicar contenido es L4 |
| `09.*`, `11.*` | propuesta | L1 | Fuentes externas citadas |
| `10.leer-analitica-agregada` | consulta | L0 | **Solo datos agregados**; nunca datos de usuarios finales |

## 5. Capacidades del Director (no delegables)
El Director no es invocable por otros agentes. Sus funciones internas (consultar, proponer, planificar, delegar, sintetizar) las rige `AGENTE-00-DIRECTOR-DISENO.md`. Las **acciones sobre el sistema** (publicar, importar, cambiar catálogo, gasto, activar programaciones, crear credenciales) **no son capacidades del Director ni de ningún agente**: las ejecuta una persona en el panel, con aprobación L4 (matriz de permisos).

## 6. Procedimiento de alta o cambio de un agente
1. Escribir la ficha de agente y las fichas de capacidad (`PROTOCOLO-AGENTES.md` §2).
2. Pasar la lista de `CONFORMIDAD-AGENTES.md` (cada punto con su evidencia).
3. Revisión del propietario; registrar la versión y la fecha en el registro.
4. Despliegue por su guía supervisada. Hasta entonces el estado es `planificado` o `construido_local`.
5. Un cambio de nivel, alcance o efecto de una capacidad es un **cambio de versión del registro** con aprobación expresa; nunca se aplica en caliente.

## 7. Frescura de las capacidades de consulta (A-01: valores iniciales configurables)
El campo `frescura` de cada ficha de capacidad define cuándo un dato es `vigente`, `a_actualizar` o `solo_historico`; se cambia **por versión del registro**. Los **históricos se conservan y se pueden consultar siempre** (se presentan como histórico, no se ocultan).
| Capacidad | vigente | a_actualizar | solo_historico | Invalidación por evento |
|---|---|---|---|---|
| `12.leer-ultimo-informe`, `12.leer-historial` | ≤ 24 h | ≤ 7 d | > 7 d | Despliegue posterior (si el informe registra la versión) |
| `04.leer-ultimo-informe`, `04.comparar-informes` | ≤ 7 d | ≤ 30 d | > 30 d | Evento registrado que altere el catálogo |
| Estado en vivo (K3) | ≤ 60 s (salud) / 5 min (tareas, consumo) | se vuelve a leer | — | — |
| Agentes futuros | Se fija en su ficha al darse de alta | | | |
