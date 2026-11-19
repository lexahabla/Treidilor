# Treidilor AI — automatización y agentes

Aquí vive todo lo necesario para desarrollar, probar y desplegar los agentes de Treidilor en **n8n** de forma segura y versionada.

> **Estado (Fase 2.0):** construido y probado en local; los workflows están desactivados (`active: false`) y son de **sólo lectura**. **Excepción comunicada (13/11/2026):** el Agente 04 — Calidad del catálogo está desplegado en producción de forma supervisada (workflow sin publicar ni programar; ejecuciones manuales `ex-16` y `ex-18`, la segunda con comparación correcta; ver `docs/AGENTE-04-CALIDAD.md`), y el Agente 12 — Auditor General también, con dos ejecuciones manuales (`docs/AGENTE-12-VALIDACION-PRODUCCION.md`). El resto de agentes no está desplegado.

## Contenido
| Ruta | Qué es |
|---|---|
| [`PLAN-MAESTRO.md`](PLAN-MAESTRO.md) | Estrategia, principios, agentes, hoja de ruta, riesgos |
| `agents/` | Ficha de cada agente (misión, datos, permisos mínimos, límites, aprobación) |
| `lib/` | **Código de los agentes**: módulos puros y probados (`auditor`, `researcher`, `urlPolicy`, `common`) |
| `config/` | Configuración por entorno (`local.json`, `produccion.json`) |
| `workflows/` | JSON de n8n **generados** desde `lib` (no se editan a mano) |
| `schemas/` | Esquemas de los informes (`informe-auditor`, `informe-investigador`) |
| `dev/` | `docker-compose.n8n.yml` del n8n de pruebas (no arrancado) y `.env.n8n.example` |
| `docs/` | Procedimientos, qué falta para ejecutar, diseño de la API de automatización y diseño del Agente 00 — Director (`AGENTE-00-DIRECTOR-DISENO.md`, `AGENTE-00-F0-CONSOLIDACION.md`, `AGENTE-00-BATERIA-EVALUACION.md`, `AGENTE-00-F0-AJUSTES-PROPUESTOS.md`, `AGENTE-00-F0-CIERRE.md`, `INFRAESTRUCTURA-VPS-PRODUCCION.md` (infraestructura, despliegue y seguridad del VPS), `INSPECCION-AUTOMATICA-VPS-DISENO.md` (diseño del acceso de inspección restringido) , `INSPECCION-ETAPA-0-INFORME.md` y `INSPECCION-ETAPA-0-VALIDACION-LINUX.md` (etapa 0 local completada y validada en Linux; el código está en `automation/inspeccion/`; nada instalado en producción), `PROTOCOLO-AGENTES.md`, `REGISTRO-AGENTES.md`, `MATRIZ-PERMISOS.md`, `MEMORIA-LEDGER-DISENO.md`, `CONFORMIDAD-AGENTES.md`; solo diseño) |
| `reports/` | (ignorado por git) salidas locales de pruebas |

Herramientas en `scripts/automation/`: `build-workflows.mjs`, `lint-workflows.mjs`, `normalize-workflow.mjs`, `simulate-workflow.mjs`, `make-test-data.mjs`, `validate-schema.mjs`. Pruebas: `scripts/tests/automation-*.test.mjs` (se ejecutan con `npm test`).

## Estructura de carpetas en el n8n de producción
Dato comunicado por el responsable (no verificado por el asistente):
```
Treidilor AI/
└── Agente 04 — Calidad del catálogo/
    ├── Calidad del catálogo — Producción          (workflow; sin publicar, sin programación)
    └── Preparar historial — Calidad del catálogo  (workflow auxiliar: crea la tabla; idempotente)
Credencial:  Treidilor — Catálogo (solo lectura)
Data Table:  calidad_catalogo_instantaneas
```
La carpeta del Agente 12 (Auditor General), su credencial y su tabla `auditor_general_instantaneas` son independientes y no se han modificado. Origen en el repo: `automation/workflows/calidad-catalogo.produccion.json` y `calidad-instantaneas-crear-tabla.json`.

## Ciclo de trabajo (sin n8n)
```bash
# 1) editar la lógica en automation/lib/*.mjs (y su prueba)
# 2) regenerar los workflows
node scripts/automation/build-workflows.mjs --write
# 3) comprobar seguridad y sincronía
node scripts/automation/lint-workflows.mjs
node scripts/automation/build-workflows.mjs --check
# 4) pruebas
npm test
```

## Reglas
1. **Sólo lectura** en esta fase: los workflows sólo hacen peticiones GET a URLs que fija el código con la política de `lib/urlPolicy.mjs`.
2. **Nunca** salida de afiliado, API con efectos, panel, Mi Radar ni fichas de producto en producción (cada visita cuenta en la analítica).
3. **Ningún secreto** en el repositorio. Las credenciales se crean a mano en n8n y se referencian por **nombre**.
4. **Ningún agente usa `TRADYLOR_API_TOKEN`.**
5. Un cambio en `lib/` exige regenerar los JSON (la prueba de sincronía lo comprueba).
6. Activar, programar o importar a producción: sólo con autorización expresa (`docs/PROCEDIMIENTOS.md`).
