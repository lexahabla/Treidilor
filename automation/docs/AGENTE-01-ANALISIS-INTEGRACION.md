# Agente 01 — Situación y qué falta para conectarlo al Director (15/11/2026)

Solo análisis y propuesta: no se ha registrado ninguna capacidad, no se ha tocado el workflow y no se ha construido nada nuevo. Propuesta detallada (no aprobada): `automation/director/agentes/investigador/propuesta-capacidades-01.json`.

## 1. Ficha aprobada
«Investigador de tendencias y productos» (fichero `01-investigador-mercado.md`). Misión: detectar productos, categorías y nichos con potencial con datos reales (catálogo, observaciones verificadas y, más adelante, fuentes externas citadas). Entradas: catálogo (lectura), observaciones de precio verificadas, fuentes externas (v1, con presupuesto). Salida: informe de candidatos con evidencias y puntuación explicada. Alcances previstos: `catalog:read` (existe), `research:write`, `proposals:create`. Riesgo bajo; «sólo propone; no importa nada». Etapa 2.0 (v0 de reglas) → 2.5 (web). Medición: candidatos aceptados / propuestos. Honestidad: v0 con descuentos DECLARADOS, nunca verificados; sin valoraciones ni ventas inventadas.

## 2. Diseño aprobado en el registro
`REGISTRO-AGENTES.md` §4 documenta `01.investigar-tendencias` (propuesta, **L1**, «v0 de reglas sobre catálogo; la versión con web externa llega en 2.5», nombre provisional). El archivo versionado `registro-agentes.v1.json` tiene el 01 como `construido_local`, con invocación «workflow local, solo manual» y **ninguna capacidad**.

## 3. Lo que existe
- **Workflow local** `automation/workflows/investigador-comercial.local.json`: 7 nodos (disparador manual, nota, páginas de catálogo, dos peticiones HTTP al feed con la credencial de cabecera, informe), `active:false`, solo lectura. No persiste nada: el informe queda en la ejecución de n8n.
- **Lógica pura y probada** `automation/lib/researcher.mjs` (`construirInformeInvestigador`, sin estado) y esquema `informe-investigador.schema.json`.
- Un piloto con salidas guardadas en `INFORMES/2026-11-12/salidas-piloto-2/`.
- **No existe**: variante de producción, tabla de instantáneas, token `catalog:read` en producción (la API de automatización está desactivada) ni nada de esto en el Director.

## 4. Qué falta para conectarlo al Director
1. **Aprobar la capacidad** `01.investigar-tendencias` (L1, sin alcances) y su nombre (la v0 detecta *candidatos*, no *tendencias*: no hay serie temporal).
2. **Un adaptador pequeño y puro** `informe-investigador → informe-agente/1` (candidatos como hallazgos con su evidencia y puntuación explicada; las limitaciones de la v0 en el informe).
3. **Un método del Director** con el mismo patrón que 05, 07 o 09: ejecuta `construirInformeInvestigador` sobre un feed **por parámetro** (sintético en local). **No necesita n8n para funcionar en local.**
4. Solo para datos reales y ejecución en n8n: variante de producción + tabla de instantáneas + el lector compartido (ver `INTEGRACION-N8N-DISENO.md`) + token `catalog:read` y `AUTOMATION_API_ENABLED=true` (decisión aparte).
5. `research:write` y `proposals:create` → capacidad L3 **bloqueada** hasta definir el almacén de propuestas (decisión compartida con 06, 07, 08, 09 y 11).

## 5. Propuesta mínima (sin activar)
| Capacidad | Nivel | Alcances | Cuándo |
|---|---|---|---|
| `01.investigar-tendencias` | L1 | ninguno | Ya integrable en local tras tu aprobación |
| `01.leer-ultimo-informe` | L0 | ninguno | Solo cuando el 01 corra en n8n y persista informes |
| `01.lanzar-investigacion` | L2 | `catalog:read` | No propuesta aún: depende de F3 |
| `01.registrar-propuestas` | L3 | `research:write`, `proposals:create` | Bloqueada: falta el almacén |
