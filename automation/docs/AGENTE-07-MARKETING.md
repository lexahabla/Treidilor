# Agente 07 — Marketing multicanal y SEO (componentes puros locales; sin capacidades aprobadas)

Estado (15/11/2026): componentes puros construidos y **cuatro capacidades INTEGRADAS en local** (autorizadas por el propietario el 15/11/2026): `07.proponer-plan-campanas` (L1), `07.redactar-briefs` (L1), `07.auditar-seo-contenido` (L1) y `07.revisar-texto-publicitario` (L0), todas sin alcances, `propuesta_f1`/`lectura_f1`, con tarea, ledger, verificación por recálculo e informe `informe-agente/1`. Las fuentes (productos y categorías de referencia) llegan **por parámetro** (`rutaFuentesMarketing`); no hay acceso al catálogo real. Las dos L3 (`07.guardar-borrador-campana`, `07.registrar-investigacion`) **siguen bloqueadas** y fuera del registro. Publicar, enviar comunicaciones, activar campañas e invertir son L4 humano. Ficha: `automation/agents/07-marketing-seo.md`. Código: `automation/director/agentes/marketing/{marketing,fixtures}.mjs` y `propuesta-capacidades-07.json`; integración en `director.mjs` (`_leerMarketing`, `_respMarketing`), `intencion.mjs` (4 intenciones nuevas), registro y consola (`--marketing <json>`). Pruebas: `f8-agente07.test.mjs` (16) y `f9-agente07-integracion.test.mjs` (12).

## Ficha (sin cambios)
Misión: planificar calendario de contenidos, campañas y mejoras SEO medibles para tráfico cualificado. Entradas: analítica, informes de producto/precio, estacionalidad. Salidas: plan de campañas y briefs; auditoría SEO. Alcances previstos: `research:write`, `drafts:write`. Riesgo medio; nada se publica sin aprobación. Medición: tráfico cualificado y coste por visita. Honestidad: cumplir normas de afiliación y publicidad, sin afirmaciones no demostrables.

## Componentes (puros; reciben las fuentes por parámetro; no escriben ni usan red)
- `planificarCampanas`: plan propuesto sobre el calendario comercial existente, con estado calculado respecto a la fecha dada, categorías que encajan, candidatos (precio, imagen, sin agotar; orden por descuento VERIFICADO y señales de los informes 05 y 10), canales (publicar/enviar siempre L4 humano) y datos no disponibles declarados.
- `redactarBrief`: borrador no publicado: objetivo sin promesas numéricas, ángulos evaluados, mensajes factuales con fecha de captura (nada de precio sin fecha), cumplimiento, calendario de acciones (preparación y decisiones humanas) y medición.
- `revisarTextoPublicitario`: reglas R1–R6 existentes más afiliación, urgencia, superlativos, precio sin fecha y cifras de comisión; un descuento solo se cita si es el verificado de la ficha.
- `auditarSEO`: auditoría de contenido de fichas y categorías aportadas (títulos, descripciones, imagen, precio, disponibilidad, duplicados, categorías finas). No rastrea la web (eso es del Agente 12) ni consulta buscadores.

## Reutilizado
`marketingCalendar.getMomentosComerciales`, `commercialClaims` (`shownDiscount`, `captureDateOf`, `verifiedAtOf`), `publicClaims.claimProblem`, `categories.DEFAULT_CATEGORIES`, informes de los Agentes 05, 06 y 10. No se reutiliza `marketingInsights.getCampanaCatalogo` porque lee el catálogo real de disco; se aplica su misma regla de coincidencia sobre fuentes aportadas.

## Integración con el Director
Intenciones: «planifica las campañas», «redacta el brief de la campaña de X», «auditoría SEO de las fichas» (L1) y «revisa este texto publicitario: «…»» (L0; el texto viaja por huella, no en la intención). Enviar emails o mensajes, lanzar campañas o invertir en publicidad se clasifican como acción humana L4 (`envioPublicidad`) y «SEO/campaña/marketing» ya no lanza la auditoría del 04. Las señales de los informes 05 y 10 ya registradas en el Director entran en el plan. No se duplican cerebro, ledger, registro ni aprobaciones.

## Propuesta de capacidades (estado)
Ver `propuesta-capacidades-07.json`. AUTORIZADAS y en el registro: L1 `07.proponer-plan-campanas`, `07.redactar-briefs`, `07.auditar-seo-contenido` (sin alcances); L0 `07.revisar-texto-publicitario`. BLOQUEADAS: L3 `07.guardar-borrador-campana` (`drafts:write`) y `07.registrar-investigacion` (`research:write`), estas dos bloqueadas hasta definir dónde se guardan. Publicar, enviar e invertir nunca serán capacidad del agente (L4 humano).

## Pendiente
Aprobación de capacidades; almacén de borradores e investigación; si recibe fuentes por parámetro o con `catalog:read`; datos de gasto y de buscador (hoy no existen); texto legal de divulgación (lo valida el propietario); base de consentimiento antes de cualquier email.
