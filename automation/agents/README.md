# Agentes de Treidilor AI

Fichas de especificación (diseño). Cada agente declara su misión, datos, permisos mínimos, límites y aprobación. **Ningún agente usa `TRADYLOR_API_TOKEN`**; todos trabajan con permisos acotados y, hasta la Etapa 2.2, sólo en lectura.

| Agente | Riesgo | Etapa |
|---|---|---|
| [Director y coordinador conversacional](00-coordinador.md) | Medio | F0–F5 (D1 y D8 aprobadas; **F0 cerrada documentalmente**; F1 sin iniciar; antes «Coordinador», 2.6) |
| [Investigador de tendencias y productos](01-investigador-mercado.md) | Bajo | 2.0 (v0 reglas) → 2.5 (web) |
| [Investigador de programas de afiliación](02-investigador-afiliacion.md) | Bajo | 2.5 |
| [Importador (Amazon, Temu, AliExpress, eBay)](03-importador.md) | Medio | 2.5 |
| [Calidad y enriquecimiento del catálogo](04-calidad-catalogo.md) | Medio | 2.4 (detectar) → 2.5 (proponer) · **v0 en producción, manual y supervisado** (línea base `ex-16`; segunda ejecución `ex-18` correcta, 14/11/2026; catálogo sin corregir) |
| [Analista de ofertas, precios y comparaciones](05-analista-precios.md) | Alto | 2.4 → 2.5 |
| [Diseñador de categorías, portada e historias](06-portada-historias.md) | Medio | 2.5 |
| [Marketing multicanal y SEO](07-marketing-seo.md) | Medio | Posterior a 2.6 |
| [Creación de contenido y recursos visuales](08-contenido-visual.md) | Medio | Posterior a 2.6 |
| [Investigación de competencia y expertos](09-competencia-expertos.md) | Bajo | Posterior a 2.5 |
| [Analítica y optimización de conversiones](10-analitica-conversion.md) | Bajo | Posterior a 2.5 |
| [Expansión mediante webs nicho](11-webs-nicho.md) | Bajo | Posterior a 2.5 |
| [Auditor General](12-auditor-general.md) | Bajo | 2.0 (v0 piloto) · en producción con **dos ejecuciones manuales correctas** (`ex-13`, `ex-17`; dato comunicado 14/11/2026), sin programar; separado del Agente 04 |
| [Asistente conversacional y futura voz](13-asistente-ia.md) | Medio | 2.6 / 2.7 · canal del Agente 00 (D1 aprobada) |

Plantilla común: misión · entradas · salidas · permisos mínimos · límites · riesgo y aprobación · etapa · métrica · regla de honestidad.

Contratos comunes para todos los agentes (registro, sobre de tarea, estados, informe normalizado, errores, lista de conformidad): `automation/docs/PROTOCOLO-AGENTES.md` (diseño).
Registro completo de agentes y capacidades: `automation/docs/REGISTRO-AGENTES.md`; permisos L0–L4: `MATRIZ-PERMISOS.md`; requisitos para agentes nuevos: `CONFORMIDAD-AGENTES.md`.
