# Agente 12 — Auditor General: validación en producción (dos ejecuciones manuales, 13 y 14/11/2026)

> **Origen de los datos.** Todo lo que sigue lo **comunicó el propietario** tras comprobarlo en la interfaz de n8n del VPS. **El asistente no lo ha verificado de forma independiente** (no se ha conectado a n8n, a la base ni al servidor). Etiquetas como en `INFRAESTRUCTURA-VPS-PRODUCCION.md`: **[Comunicado 14/11]** = confirmado por el propietario en n8n; **[Inferido]** = deducción del asistente; **[Pendiente]** = no se sabe.
> **No se ha modificado código, workflows, infraestructura ni producción** para escribir este documento; sin commits ni pushes.

## 1. Estado
| Elemento | Estado | Origen |
|---|---|---|
| Workflow `Auditor General \| Producción` | **Sin publicar y sin programar** (solo disparador manual); se conserva así | [Comunicado 14/11] y decisión del propietario |
| Data Table `auditor_general_instantaneas` | Existe en producción con **exactamente 2 filas** (`ex-13` y `ex-17`) | [Comunicado 14/11] |
| Ejecución 1 — `ex-13` (13/11/2026) | **Línea base**; guardada | [Comunicado 14/11] (detalle de su informe: ver §3) |
| Ejecución 2 — `ex-17` (14/11/2026) | **Comparación con el historial**; guardada | [Comunicado 14/11] |
| Programación automática (F7) | **No autorizada y no activada** | — |
**Conclusión registrada: las dos ejecuciones manuales funcionaron correctamente** (F3.4, F3.5 y F3.6 del plan de entrada, ver §4).

## 2. Segunda ejecución `ex-17` (14/11/2026) — resultados [Comunicado 14/11]
| Dato | Valor |
|---|---|
| Workflow | `Auditor General \| Producción` |
| `seguimiento.modo` | `comparacion` |
| `seguimiento.origenReferencia` | `historial` (referencia leída de la Data Table, no entregada a mano) |
| Lectura del historial | **1 fila válida, 0 duplicadas** |
| Calidad de la ejecución | `completa` |
| Incidencias | **0** |
| Peticiones | **38** (dentro del tope de 45 del plan F3.4) |
| Rutas revisadas | 4 |
| Enlaces internos | 33 |
| Páginas respondidas | **37 de 37** |
| `persistencia.escritura.resultado` | `guardada` |
| `persistencia.escritura.filaId` | **2** (fila real devuelta por el Insert) |
| Tabla tras la ejecución | **Exactamente 2 filas**: `ex-13` y `ex-17`; sin duplicados |
**Lectura.** 4 rutas + 33 enlaces = 37 páginas, todas respondidas. Las 38 peticiones son una más que las páginas; **[Inferido]** la diferencia es la comprobación de salud (`/api/health`), no desglosada en lo comunicado. **No consta** el tamaño medido de la ejecución, la hora ni la memoria/disco del VPS durante la misma (ver §6).

## 3. Primera ejecución `ex-13` (13/11/2026)
Fue la **línea base** (primera instantánea): la segunda la encontró como referencia por `historial`, lo que demuestra que la fila de `ex-13` existía y era válida (1 fila válida). El resto de su informe (peticiones, páginas, tamaño) **no se ha comunicado** y no se inventa. **[Pendiente]** anotar esos datos en el registro de resultados (F3.7).

## 4. Contraste con el plan de entrada a F3 (`F2B-CIERRE-PENDIENTES-ANTES-DE-F3.md` §8)
| Paso | Criterio | Resultado |
|---|---|---|
| F3.4 Primera ejecución manual supervisada | Solo GET a la web, ≤ 45 peticiones | **Cumplido en `ex-17`** (38 ≤ 45); en `ex-13` **no se ha comunicado el detalle** |
| F3.5 Persistencia | `escritura.resultado = guardada` con `filaId` real; la tabla tiene exactamente 1 fila tras la primera; sin duplicados | **Cumplido** (la segunda dio `filaId` 2 y la tabla tiene 2 filas exactas) |
| F3.6 Segunda ejecución manual (otro día) | `modo comparacion`, origen manual, sin duplicados, seguimiento coherente | **Cumplido** (`comparacion`, `historial`, 0 duplicadas) |
| F3.7 Revisión y decisión | Informe final con tamaño por ejecución, crecimiento de la base y disco | **Pendiente** (§6) |
**Qué demuestra:** que la memoria persistente de la versión 2c funciona **en producción**: se guarda la instantánea, se confirma la fila (no queda `pendiente`), se lee el historial, no hay duplicados y la segunda ejecución se compara con la primera. También que el Auditor audita las páginas reales de la web con respuesta completa y sin incidencias.
**Qué NO demuestra:** ver §5.

## 5. Límites de lo validado
1. **Ambas ejecuciones fueron manuales.** El origen `programada` (disparo real por Schedule, `$execution.mode` = producción) **no se ha ejercitado en producción**.
2. **Las dos tuvieron 0 incidencias.** El seguimiento **con incidencias reales** (nuevas, persistentes, resueltas, reaparecidas) **no se ha visto en producción**; solo está validado en local (`AUDITOR-VALIDACION-INTEGRAL.md`: ejecuciones 129–152). Tampoco se han visto en producción los casos de ejecución **parcial** (no se guarda) o de escritura **fallida/pendiente**.
3. La lectura del historial fue de **1 fila**: no se ha probado en producción con el tope de 60 ni con la deduplicación en acción.
4. Que el informe salga limpio **no prueba** que el Auditor detectaría un problema real de la web en producción; esa capacidad está validada solo contra un sitio sintético.
5. Dos ejecuciones en dos días **no cumplen** el requisito de **≥ 3 ejecuciones manuales en días distintos** (`GUIA-DESPLIEGUE-AUDITOR-PRODUCCION.md` §8) antes de programar.

## 6. Validaciones y decisiones PENDIENTES antes de cualquier activación automática (F7)
**Bloquean la programación** (nada se programa mientras no estén resueltas, y solo con autorización expresa):
| # | Pendiente | Origen del requisito | Estado |
|---|---|---|---|
| P1 | **Responsable** de revisar los informes, **frecuencia** de revisión, **canal de avisos** y procedimiento ante un informe `critico` (D3) | F2B §5.4 y R4 | Pendiente de decisión |
| P2 | **Zona horaria efectiva** de n8n/servidor (R5): fijar la hora de la programación sin ambigüedad | F2B R5 | Pendiente de confirmar |
| P3 | **Tercera ejecución manual** en un día distinto (las incidencias controladas se ensayan **solo en local**, nunca en producción) | Guía §8 | Falta ≥ 1 |
| P4 | **Restauración probada** (C) o aceptación expresa y reiterada del riesgo R1; copia periódica externa (D1) | F2B §6–7 | Omitida; sin decisión |
| P5 | **Retención de ejecuciones** definitiva (D2): ≈ 9 MB por ejecución diaria del Auditor; fijar `EXECUTIONS_DATA_MAX_AGE`/máximo y revisar el crecimiento de la base y del disco | F2B D2 | Pendiente |
| P6 | **Informe final de F3 (F3.7)**: tamaño medido de `ex-13` y `ex-17`, memoria y disco del VPS durante las ejecuciones, registros de acceso de la web sin 5xx ni escrituras | F2B §8 | Datos **no comunicados** |
| P7 | **Concurrencia (R10):** que una ejecución programada no se solape con una manual ni consigo misma | F2B R10 | Diseñada, no probada |
**No bloquean pero conviene cerrar antes o durante la primera semana programada:**
| # | Pendiente | Nota |
|---|---|---|
| P8 | Confirmar `NODES_EXCLUDE` (R8) y la versión 2.38.6 de n8n | Dato no comunicado |
| P9 | Primera ejecución **programada** supervisada con **revisión diaria** durante la primera semana, y desactivación inmediata ante 5xx, memoria > 85 % o peticiones fuera de lista | Guía §8 |
| P10 | Contraste con `alwaysOutputData` (no aplicado) y regla heredada: `pendiente` = escritura **no confirmada** → comprobar siempre la tabla | F2B / validación integral |
| P11 | Un **adaptador de solo lectura** para que el Agente 00 lea las instantáneas (D5) y una credencial solo lectura: hoy **no existe**; la tabla sí existe (dato comunicado) | `PROTOCOLO-AGENTES.md`, `AGENTE-00-F0-CONSOLIDACION.md` |
| P12 | Copia manual de PostgreSQL **antes** de cambios futuros en n8n y registro de la hora; clave de cifrado de n8n conservada fuera del VPS | F2B §6 |
**Decisiones que no se toman aquí:** frecuencia, hora, destinatario de avisos y aceptación de R1 son del propietario.

## 7. Qué cambia en los documentos
`PLAN-MAESTRO.md` (hoja de ruta 2.1b y estado de validación), `agents/12-auditor-general.md`, `agents/README.md`, `docs/REGISTRO-AGENTES.md` (estado de las capacidades del Agente 12), `docs/F2B-CIERRE-PENDIENTES-ANTES-DE-F3.md` (actualización), `docs/AGENTE-00-F0-CONSOLIDACION.md`, `docs/INFRAESTRUCTURA-VPS-PRODUCCION.md`, `docs/FALTA-PARA-EJECUTAR.md` y `AGENTS.md`. Los workflows y el código no cambian.
