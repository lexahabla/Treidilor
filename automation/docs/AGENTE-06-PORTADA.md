# Agente 06 — Diseñador de categorías, portada e historias (local, sin publicar)

Estado: **construido_local** (14/11/2026). Capa de PROPUESTA sobre la portada editable que ya existe (`src/lib/homeLayout/`); no es otro editor ni otro sistema de categorías. Ficha: `automation/agents/06-portada-historias.md`. Código: `automation/director/agentes/portada/{portada,sandbox,fixtures}.mjs`; integración en `director.mjs`, `intencion.mjs` y `registro-agentes.v1.json`. Pruebas: `automation/director/tests/f5-agente06.test.mjs` (17).

## Capacidades (registro)
| Capacidad | Nivel | Disponibilidad | Qué hace |
|---|---|---|---|
| `06.proponer-portada` | L1 | `propuesta_f1` | Informe `informe-agente/1` + borrador PROPUESTO (bloques e historias) + propuestas sobre categorías. Sin efectos. |
| `06.guardar-borrador-portada` | L3 reversible | `simulacion_local` | Tras aprobación simulada, guarda la propuesta como borrador en un ÁREA PRIVADA del Director (`<ledger>/sandbox-portada/`), con copia previa y deshacer. Nunca `home-layout.json`. |

Publicar, activar y reorganizar categorías reales son **L4 humano**: no existen como capacidad (alcances `[]`); «publica/activa la portada» → acción humana.

## Funciones existentes reutilizadas
`initialLayout` (diseño y selección), `validate`, `resolve` (visibilidad e incidencias), `initialStories` + `stories` (historias y `checkStories`), `draft.prepareDraftSave`, `draftBackups.protectDraft/planRestoreBackup`, `publish.diffBlocks`, `commercialClaims.shownDiscount` (descuento verificado). El agente no copia ninguna (prueba que lo comprueba).

## Qué propone y con qué datos
- Bloques: el diseño existente (maqueta v4) con las categorías e imágenes reales de las fuentes; si se aporta un informe del Agente 05, un bloque «Oportunidades verificadas» solo con productos de oportunidad `confirmado` que existan y sean presentables.
- Historias: las del generador existente, siempre `borrador`; «Bajadas» solo con descuentos verificados.
- Categorías (informativo): vacías, sin subcategorías (≥ 8 productos), subcategoría con un producto, padre inexistente, nombres duplicados, producto con categoría inválida.
- Cada informe declara suposiciones, limitaciones y si los datos son de prueba. No hay predicciones ni textos editoriales propios.

## Guardado simulado y deshacer
Aprobación L3 ligada por huella a `propuestaRef` (propuesta guardada por contenido en `<ledger>/propuestas/`). Orden de escritura: copia previa → borrador → historias. Verificación: releer y comparar huella de bloques con la propuesta. Un archivo corrupto del área privada no se sobrescribe. `Director.deshacerBorradorPortada()` (acción del propietario, evento `ejecucion_humana_confirmada`) restaura la copia previa o deja el borrador vacío.

## Pendiente / desactivado
- Datos reales: hoy solo fuentes sintéticas por `--portada <json>` (consola) o `rutaDatosPortada`; leer el catálogo real exigiría L0 con alcance `catalog:read` (decisión pendiente).
- Guardar en el borrador REAL (`home-layout.json`) = alcance `drafts:write` previsto en la ficha: NO concedido; sigue simulado.
- Informe del Agente 01 (formato propio) no integrado; el del 05 solo en memoria de la sesión.
- Cuando se decida, el siguiente agente recomendado según el registro: **10 Analítica agregada (L0, solo lectura)**, que alimentaría con datos reales de interés a este agente.
