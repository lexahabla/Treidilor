# Plan Maestro de Treidilor AI

> Documento vivo. Consolida la estrategia de automatización, agentes IA, marketing, crecimiento, calidad y auditoría de Treidilor, a partir de los informes de las fases 1, 1B y 2.0 (`INFORMES/2026-11-12/`) y de las especialidades definidas por el propietario. Si existe un «Plan Maestro ampliado» externo, se integra aquí sin perder su contenido.

## 1. Misión
Treidilor es una plataforma de **comercio por afiliación y comparación de productos**. Treidilor AI es el sistema de agentes que **trabaja cada día** para: mejorar la calidad del catálogo, captar tráfico cualificado, aumentar conversiones, investigar programas de afiliación, optimizar el marketing y **maximizar la rentabilidad sostenible**, siempre con datos reales y bajo control humano. Incluye un **Auditor General** que supervisa de forma continua el funcionamiento técnico y comercial.

## 2. Principios innegociables
1. **Datos reales, siempre.** Ningún agente inventa precios, descuentos, valoraciones, ventas ni características. Un descuento sólo existe con observación verificada (regla ya codificada en Treidilor). Sin dato → «no consta».
2. **Los agentes proponen; las personas aprueban.** Publicar, activar, borrar, cambiar precios o importar exige aprobación explícita en el panel.
3. **Mínimo privilegio.** Cada agente, su propio permiso acotado. **Ningún agente usa `TRADYLOR_API_TOKEN`.**
4. **Sólo lectura primero.** Se empieza en lectura, luego borradores, luego propuestas con aprobación. La autonomía crece sólo con métricas y decisión expresa.
5. **Reversible y auditado.** Copias probadas, referencia de recuperación antes de cada despliegue, registro de cada acción y parada de emergencia.
6. **Despliegues tempranos y pequeños.** Cada agente útil se despliega en cuanto es seguro; no se espera a tenerlos todos.
7. **Producción no depende del PC.** Los workflows se diseñan para correr en el n8n del VPS; el PC sólo se usa para desarrollar y probar.
8. **Coste controlado.** Presupuesto por agente, por ejecución y por mes; el piloto no tiene coste.
9. **Cumplimiento.** Normas de afiliación y publicidad, términos de uso de las fuentes, RGPD/LSSI; los agentes no reciben datos de usuarios finales.

## 3. Agentes (fichas en `agents/`)
| Área | Agente | Primera versión |
|---|---|---|
| Dirección | **Agente 00 — Director y coordinador conversacional** (absorbe al Coordinador; D1) | F0–F5 (D1 y D8 aprobadas; **F0 cerrada documentalmente; F1 implementada en local, sin despliegue, a 19/11/2026**), ver §5.1 |
| Mercado | Investigador de tendencias y productos | **v0 (esta fase)** |
| Afiliación | Investigador de programas de afiliación | 2.5 |
| Importación | Importador (Amazon, Temu, AliExpress, eBay) | 2.5 (simulaciones) |
| Catálogo | Calidad y enriquecimiento | 2.4–2.5 |
| Precios | Analista de ofertas, precios y comparaciones | 2.4–2.5 |
| Portada | Diseñador de categorías, portada e historias | 2.5 |
| Marketing | Marketing multicanal y SEO | tras 2.6 |
| Contenido | Redactor y recursos visuales | tras 2.6 |
| Inteligencia | Competencia y expertos | tras 2.5 |
| Analítica | Conversión y optimización | tras 2.5 |
| Expansión | Webs nicho | tras 2.5 |
| Auditoría | **Auditor General** | **v0 (esta fase)** |
| Interfaz | Asistente conversacional (+ voz) | 2.6 / 2.7 |

## 4. Arquitectura
- **n8n** orquesta (horarios, webhooks, colas, aprobaciones y avisos). **Treidilor** es el sistema de registro y guardián de las reglas.
- **Workflows como código:** la lógica de cada agente vive en módulos puros con pruebas (`automation/lib`); `scripts/automation/build-workflows.mjs` la incrusta en el JSON de n8n (`automation/workflows`). El JSON es **generado, normalizado y comprobado** por el comprobador de seguridad antes de importarse.
- **Dos n8n:** pruebas (local, sin credenciales reales) y producción (VPS). A producción sólo llegan JSON revisados.
- **API de automatización de Treidilor** (Etapa 2.2): tokens por agente con alcances, límites, auditoría, cola de propuestas e interruptor de emergencia (`docs/API-AUTOMATIZACION-DISENO.md`).
- **Asistente IA** del administrador: chat (y luego voz) que consulta el estado **real** y gestiona aprobaciones.

## 5. Hoja de ruta (despliegues tempranos y controlados)
| Etapa | Entrega | Estado |
|---|---|---|
| **2.0** | Infraestructura de workflows versionados, comprobador de seguridad, datos de prueba saneados, Auditor General v0, Investigador comercial v0, Compose de n8n de pruebas | **Construido en local (esta rama)** |
| 2.1 | Ejecución real en n8n y Treidilor de pruebas; conexión de Claude (MCP/API) al n8n de pruebas | Pendiente de autorización (C1–C3) |
| 2.1b | **Auditor en producción, sólo lectura pública** (salud + páginas públicas) en el n8n del VPS | **Desplegado, manual y supervisado (dato comunicado por el propietario, no verificado por el asistente): `ex-13` línea base (13/11/2026) y `ex-17` comparación con el historial (14/11/2026), ambas correctas (0 incidencias, 37 de 37 páginas, 38 peticiones, fila 2 guardada, tabla con 2 filas). Workflow sin publicar ni programar; la programación (F7) sigue pendiente: `docs/AGENTE-12-VALIDACION-PRODUCCION.md` §6.** |
| 2.2 | API de automatización (lectura primero), tokens con alcances, auditoría, límites, interruptor | Diseño hecho |
| 2.3 | Retirada del token general de los flujos | — |
| 2.4 | Agentes de lectura con datos verificados (Calidad, Precios, Investigador v1) | **Calidad (Agente 04 v0): desplegado, manual y supervisado; línea base `ex-16` (13/11/2026) y segunda ejecución `ex-18` (14/11/2026, comparación correcta: 75 persistentes, 0 nuevas, `guardada`, 2 filas; datos comunicados y verificados por ChatGPT, no reproducidos por el asistente). Funcionamiento validado; los problemas del catálogo siguen sin corregir; programación NO autorizada (`docs/AGENTE-04-CALIDAD.md`).** Precios e Investigador v1: pendientes |
| 2.5 | Agentes que proponen + panel de aprobación (importación, portada/historias, afiliación) | — |
| 2.6 | Asistente IA (texto) | — |
| 2.7 | Voz | — |
| 2.8 | Autonomía limitada (opcional, con métricas) | — |

### 5.1 Agente 00 — Director y coordinador conversacional (F0 CERRADA documentalmente el 13/11/2026; F1 IMPLEMENTADA EN LOCAL, sin despliegue, a 19/11/2026; D1, D8 provisional, D10, diseño de D3 y A-01…A-07 aprobados)
Agente central, con personalidad propia, accesible por **voz y texto**, que es el único interlocutor del propietario: conversa, consulta informes, debate mejoras, recibe instrucciones, **selecciona y coordina** a los agentes especializados (los 14 previstos, empezando por los operativos: **12 Auditor General** y **04 Calidad del catálogo**), sintetiza resultados y mantiene un historial auditable. **No modifica los workflows existentes en esta fase.**
- **Diseño, alternativas, costes, memoria, autorización, seguridad, roadmap y decisiones:** [`docs/AGENTE-00-DIRECTOR-DISENO.md`](docs/AGENTE-00-DIRECTOR-DISENO.md).
- **Contratos para todos los agentes** (registro de capacidades, sobre de tarea, estados, informe normalizado, errores, conformidad): [`docs/PROTOCOLO-AGENTES.md`](docs/PROTOCOLO-AGENTES.md).
- **Documentos F0:** [`docs/REGISTRO-AGENTES.md`](docs/REGISTRO-AGENTES.md) (agentes y capacidades), [`docs/MATRIZ-PERMISOS.md`](docs/MATRIZ-PERMISOS.md) (L0–L4), [`docs/MEMORIA-LEDGER-DISENO.md`](docs/MEMORIA-LEDGER-DISENO.md) (memoria y ledger, independiente del almacén), [`docs/CONFORMIDAD-AGENTES.md`](docs/CONFORMIDAD-AGENTES.md) (requisitos para futuros agentes) y [`docs/AGENTE-00-F0-CONSOLIDACION.md`](docs/AGENTE-00-F0-CONSOLIDACION.md) (decisiones, dependencias y criterios para comenzar F1), con la batería [`docs/AGENTE-00-BATERIA-EVALUACION.md`](docs/AGENTE-00-BATERIA-EVALUACION.md) (68 casos; sin ejecutar), con los [ajustes aprobados](docs/AGENTE-00-F0-AJUSTES-PROPUESTOS.md) (A-01…A-07, valores iniciales configurables); cierre y decisiones pendientes de F1: [`docs/AGENTE-00-F0-CIERRE.md`](docs/AGENTE-00-F0-CIERRE.md). Ninguna decisión autoriza la ejecución autónoma de agentes.
- **Infraestructura y seguridad del VPS** (hechos comprobados el 13/11/2026: webhook en HTTPS, firewall de Hostinger activo, Swarm de un nodo; riesgos pendientes): [`docs/INFRAESTRUCTURA-VPS-PRODUCCION.md`](docs/INFRAESTRUCTURA-VPS-PRODUCCION.md). Diseño del acceso de inspección restringido, por etapas y sin implementar: [`docs/INSPECCION-AUTOMATICA-VPS-DISENO.md`](docs/INSPECCION-AUTOMATICA-VPS-DISENO.md). Etapa 0 (código y pruebas locales, sin instalar nada): [`docs/INSPECCION-ETAPA-0-INFORME.md`](docs/INSPECCION-ETAPA-0-INFORME.md); validación en Linux (Python 3.8 y 3.12, contenedores aislados): [`docs/INSPECCION-ETAPA-0-VALIDACION-LINUX.md`](docs/INSPECCION-ETAPA-0-VALIDACION-LINUX.md).
- **Acceso SSH restringido `tai-inspect` (etapa 2 del diseño de inspección): F0–F7 COMPLETADAS el 14/11/2026** (`F7_CERRADO_OK`; informe y limitaciones en [`docs/F7-CIERRE-INFORME.md`](docs/F7-CIERRE-INFORME.md)). **F8** (pausa ≥ 24 h con solo el gate): **SUPERADA CON RIESGOS RESIDUALES DOCUMENTADOS el 16/11/2026** ([`docs/F8-CIERRE-INFORME.md`](docs/F8-CIERRE-INFORME.md)). Pendiente: **F9** (colector, autorización propia, sin autorizar); etapas 3–7 sin autorizar. No confundir con el «F7» del Auditor (programación, no autorizada).
- **Voz:** objetivo funcional prioritario; selección e implementación en F4.
- **Principios propios:** no inventa ni da por hecha una acción sin evidencia verificada; separa consulta / propuesta / instrucción pendiente / acción ejecutada; ningún agente elude las restricciones de otro; hub-and-spoke sin delegaciones circulares ni duplicadas; aprobación humana para publicaciones, catálogo, gasto y operaciones sensibles; independencia del proveedor de IA; memoria por capas (documentada, registro, estado en vivo, histórico, decisiones), no solo el chat.

**Encaje aprobado provisionalmente (D8; el orden de la tabla anterior NO cambia ni se retrasa).** Cada fase requiere autorización expresa.
| Fase | Contenido | Encaje propuesto |
|---|---|---|
| F0 Fundaciones | Registro, protocolo/esquemas, ledger, evaluación (sin modelo) | **CERRADA documentalmente (13/11/2026)** |
| F1 Director textual de consulta | Chat privado, informes, citas, sin acciones | En paralelo a 2.4 · **implementada en local a 19/11/2026 (consola, ledger, agentes con datos sintéticos y lectura L0, canal de texto, puente de solo lectura; además, aprobaciones SIMULADAS, integridad periódica con ejecución manual desactivada por defecto y distribución 1.1.0-rc2 de pruebas); sin despliegue en el VPS ni en producción; detalle en `docs/`** |
| F2 Memoria operativa y propuestas | Decisiones, tareas, ledger | Antes de 2.5 |
| F3 Delegación supervisada | Lanzar capacidades con confirmación, seguimiento, cancelación | Con 2.5 (panel de aprobación) |
| F4 Voz | Pulsar-para-hablar; luego tiempo real | Con 2.6 / 2.7 |
| F5 Coordinación avanzada | Planes con dependencias, resumen semanal | Con 2.8 |

## 6. Gobierno y métricas
- **Cada etapa:** rama propia, pruebas automáticas, comprobación en navegador si hay interfaz, referencia de recuperación y autorización expresa antes de desplegar.
- **Indicadores:** incidencias detectadas por el Auditor antes que por un visitante; fichas completas; propuestas aprobadas/propuestas totales; coste por informe; tiempo de recuperación probado; tráfico cualificado y clics de salida (cuando haya analítica agregada).
- **Revisión semanal** del propietario con el informe del Coordinador (desde 2.6; antes, informe del Auditor).

## 7. Riesgos principales y mitigación
| Riesgo | Mitigación |
|---|---|
| Token general con `delete-all` | API de automatización con alcances; retirada del token (2.2–2.3) |
| Agentes que inventan datos | Reglas de honestidad en el código; esquemas de informe que exigen evidencia; revisión humana |
| Coste descontrolado | Presupuestos y límites por agente; piloto sin coste |
| Carga sobre el VPS | Una ejecución a la vez, ritmo limitado, ejecuciones programadas fuera de horas punta |
| Efectos secundarios de leer producción | La política de URLs prohíbe fichas, salida de afiliado y APIs con efectos; en producción sólo páginas públicas |
| Compromiso de n8n | Red interna, 2FA, sin nodos de comunidad, credenciales mínimas, copias cifradas |
| Pérdida de datos | Copias automáticas con restauración probada **antes** de permitir escrituras |
