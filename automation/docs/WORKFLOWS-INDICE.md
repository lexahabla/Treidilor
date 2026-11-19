# Workflows de n8n de Treidilor AI — índice por agente

Estos JSON los **genera** `scripts/automation/build-workflows.mjs` a partir del código probado de `automation/lib` (no se editan a mano). Todos tienen `active: false` y solo disparador manual. Ninguno se importa, activa ni programa desde el repositorio. Registro de agentes aprobado: `automation/director/registro-agentes.v1.json` (14 agentes, 00–13).

## Índice

| Agente | Archivo | Finalidad | Estado conocido | Ubicación |
|---|---|---|---|---|
| **01** Investigador de tendencias y productos | `investigador-comercial.local.json` | «Investigador comercial v0 (local)»: lee el feed de lectura del catálogo y propone candidatos sin inventar precios ni descuentos (los descuentos declarados se marcan como no verificados). 7 nodos. | Solo local, manual; no desplegado en producción. | `automation/workflows/` |
| **04** Calidad del catálogo | `calidad-catalogo.local.json` | «Calidad del catálogo v0 (local)»: auditoría de solo lectura del feed del catálogo y guardado de una instantánea; para el n8n de pruebas aislado. 16 nodos. | Validado en local y en n8n de pruebas. | `automation/workflows/` |
| **04** Calidad del catálogo | `calidad-catalogo.produccion.json` | «Calidad del catálogo v0 (produccion)»: la misma auditoría para el n8n de producción (hasta 8 páginas, pausa de 7 s entre páginas). 16 nodos. SHA-256 en `GUIA-DESPLIEGUE-AGENTE-04-PRODUCCION.md`. | Desplegado, supervisado y manual (**comunicado** por el propietario; no verificado aquí): ejecuciones `ex-16` (línea base) y `ex-18`. Sin publicar ni programar. | `automation/workflows/` |
| **04** Calidad del catálogo (auxiliar) | `calidad-instantaneas-crear-tabla.json` | «Calidad · crear tabla de instantáneas»: crea una sola vez la Data Table `calidad_catalogo_instantaneas`. 3 nodos. | Usado en el despliegue (comunicado). | `automation/workflows/` |
| **12** Auditor General | `auditor-general.local.json` | «Auditor General v0 (local)»: salud del sitio, rutas y enlaces con GET a páginas públicas; seguimiento con memoria persistente (2c). 20 nodos. | Validado en local y en n8n de pruebas (validación integral). | `automation/workflows/` |
| **12** Auditor General | `auditor-general.produccion.json` | «Auditor General v0 (produccion)»: lo mismo contra `https://treidilor.com`. 14 nodos. | Desplegado, manual y sin publicar ni programar (**comunicado**): `ex-13` y `ex-17`. **Nunca ejecutar en pruebas.** | `automation/workflows/` |
| **12** Auditor General (auxiliar) | `auditor-instantaneas-crear-tabla.json` | «Auditor · crear tabla de instantáneas»: crea una sola vez la Data Table `auditor_general_instantaneas`. 3 nodos. | Usado en el despliegue (comunicado). | `automation/workflows/` |

`compartidos/`: ningún workflow es compartido entre agentes. `pendientes-clasificar/`: ninguno sin clasificar. Base de la correspondencia: nombre y contenido de cada JSON, `AGENTS.md`, `AGENTE-04-CALIDAD.md`, `AGENTE-12-VALIDACION-PRODUCCION.md` y, para el 01, la ficha del registro (invocación «workflow local, solo manual») y `automation/lib/researcher.mjs`; la documentación no nombra expresamente al 01 con este workflow, así que esa asignación es la menos explícita.

## Estado de la reorganización en subcarpetas: NO realizada (bloqueada)

Estructura prevista: `agente-01-investigador/`, `agente-04-calidad/`, `agente-12-auditor/`. Los siete archivos **siguen en esta carpeta** porque moverlos rompería mecanismos existentes sin tocar archivos protegidos (los 467 del respaldo del 14/11/2026):

- `scripts/automation/build-workflows.mjs` (protegido) escribe y comprueba (`--check`) cada JSON en `automation/workflows/<archivo>`; con otra ruta, `--check` falla y las pruebas que lo invocan (`automation-calidad-integracion`, `automation-calidad-workflow`) también.
- `scripts/automation/lint-workflows.mjs` (protegido) lista **solo** los `.json` de la carpeta, sin recursión: un workflow en una subcarpeta quedaría **fuera del comprobador de seguridad** (riesgo real, no solo de ruta).
- Pruebas protegidas con la ruta literal: `automation-calidad-produccion`, `automation-calidad-workflow`, `automation-calidad-integracion`, `automation-persistencia`, `automation-seguridad`, `automation-seguimiento`.
- No protegidos pero también dependientes: `scripts/automation/{importar-local,prueba-auditor-completo,prueba-persistencia-2c}.mjs`, `scripts/tests/{automation-agents,automation-auditor-completo}.test.mjs`, y las comprobaciones de integridad de `automation/director/` (`hashWorkflows` lee la carpeta sin recursión).
- La documentación (guías de despliegue, `AGENTS.md`, etc.) cita estas rutas y los nombres de archivo para importarlos en n8n.

Para hacerlo en una tarea posterior hace falta tu autorización para editar los archivos protegidos citados (un mapa archivo→subcarpeta en el constructor, `lint` recursivo y las rutas de las pruebas), y sin duplicar archivos. No se ha creado ninguna carpeta vacía: las pruebas de integridad actuales leen cada entrada de esta carpeta como archivo.
