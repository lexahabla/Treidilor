# Agente 08 — Contenido y recursos visuales (componentes puros + 5 capacidades L0/L1 integradas en local)

Estado (15/11/2026): componentes puros construidos y **cinco capacidades INTEGRADAS en local** (autorizadas por el propietario el 15/11/2026): `08.proponer-borrador-ficha`, `08.proponer-recursos-visuales`, `08.proponer-borrador-historia`, `08.proponer-borrador-redes` (L1) y `08.revisar-pieza` (L0), todas sin alcances, con tarea, ledger, verificación por recálculo e informe `informe-agente/1`. Las fuentes llegan **por parámetro** (`rutaFuentesContenido`); no hay acceso al catálogo real. **Siguen bloqueadas y fuera del registro** `08.guardar-borrador-contenido` y `08.generar-imagen-ia`: no se concede `drafts:write` ni `images:generate`. No se generan imágenes, no se consumen créditos, no se publica ni se modifica la web; los derechos de imagen y la publicación los valida una persona (L4). Ficha: `automation/agents/08-contenido-visual.md`. Código: `automation/director/agentes/contenido/{contenido,fixtures}.mjs` y `propuesta-capacidades-08.json`; integración en `director.mjs` (`_leerContenido`, `_respContenido`), `intencion.mjs` (5 intenciones nuevas), registro y consola (`--contenido <json>`). Pruebas: `f10-agente08.test.mjs` (14) y `f11-agente08-integracion.test.mjs` (11).

## Ficha (sin cambios)
Misión: redactar textos y proponer imágenes/vídeos para fichas, guías, historias y redes. Entradas: briefs del agente de marketing y datos reales del catálogo. Salidas: borradores de texto y recursos. Alcance previsto: `drafts:write`. Riesgo medio; revisión humana antes de publicar. Medición: piezas aprobadas / generadas. Honestidad: imágenes con derechos claros; sin precios ni descuentos inventados.

## Componentes (puros; fuentes por parámetro; nada se publica, genera, sube ni envía)
- `borradorFicha`: título, descripción y puntos clave solo con datos de la ficha (plantilla local, no IA). Precio solo con fecha de captura; descuento solo si es el verificado; sin datos suficientes no inventa.
- `proponerRecursosVisuales`: cada imagen clasificada por origen y derechos (prueba, de tienda, generada por IA ya existente, desconocida, no segura, ausente); los derechos de tienda y desconocidos quedan PENDIENTES de verificar; texto alternativo; prompt de imagen propuesto como TEXTO (no se genera); vídeo no disponible.
- `borradorHistoria`: historia con el modelo del Agente 06 (siempre borrador, validada con `validateStories`/`checkStories`) desde los mensajes verificados de un brief del 07; una pantalla por mensaje con imagen segura; nada se recorta.
- `borradorPostsRedes`: textos ≤ 280 caracteres con marcador `[enlace pendiente]` (nunca un enlace real) y divulgación de afiliación, revisados con las reglas del 07.
- `revisarPieza`, `informeContenido` y `prepararContenidoCampana`: revisión (texto, derechos, URL segura), informe `informe-agente/1` (agente `08`) y paquete completo de una campaña del plan del 07.
- Naturaleza de cada elemento: `real` (dato literal de ficha no sintética), `simulado` (de una ficha sintética), `generado` (plantilla) y `pendiente_verificacion` (derechos, texto legal, afirmaciones). «Aprobadas / generadas» se declara no disponible (no hay registro de aprobaciones humanas).

## Reutilizado
`ai.synthesizeTitleLocally` y `ai.buildProductImagePrompt` (solo las funciones puras; ninguna que llame a una IA), `imageQuality.toHiResImageUrl`, `homeLayout/publicSafety.isPublicSafeImage`, `homeLayout/stories` y `portada.construirFuentes` (Agente 06), `commercialClaims`, `publicClaims` y, del Agente 07, `planificarCampanas`, `redactarBrief` y `revisarTextoPublicitario`.

## Propuesta de capacidades (NO aprobada)
`propuesta-capacidades-08.json`: L1 `08.proponer-borrador-ficha`, `08.proponer-recursos-visuales`, `08.proponer-borrador-historia`, `08.proponer-borrador-redes`; L0 `08.revisar-pieza`; L3 bloqueadas `08.guardar-borrador-contenido` (`drafts:write`) y `08.generar-imagen-ia` (alcance nuevo, gasto de IA). Publicar, modificar contenido real y aprobar derechos de imagen: L4 humano.

## Integración con el Director
Intenciones: «redacta la descripción de la ficha del …», «propón imágenes para el producto …», «redacta la historia de la campaña de …», «redacta posts para redes de la campaña de …» (L1) y «revisa esta pieza: «…» [URL de imagen]» (L0; el texto viaja por huella). Generar imágenes, subir, crear vídeo o guardar contenido siguen sin capacidad (se explica que el 08 no puede) y publicar es L4 humano. El parámetro `imagenUrl` es de un tipo `url` (≤ 300 caracteres, http/https) en el esquema del cerebro. No se duplican cerebro, ledger, registro ni aprobaciones.

## Pendiente
Aprobación de capacidades; almacén de borradores (compartido con el 07); política y verificación de derechos de imagen; si algún día se autoriza generar imágenes con IA y con qué presupuesto; registro de aprobaciones para medir «aprobadas / generadas».
