# Agente 03 — Importador (capa de inteligencia y coordinación; local, fixtures sintéticos)

> **Estado (14/11/2026): construido EN LOCAL, sin commit, sin red, sin gasto, sin tocar importadores, catálogo, producción ni workflows.** Sigue la ficha `automation/agents/03-importador.md` y el registro: capacidades `03.proponer-lote` (**L1**) y `03.simular-importacion` (**L2**, aprobación). **No es un segundo sistema de importación:** reutiliza el motor existente.

## 1. Qué reutiliza (no se duplica nada)
| Componente existente | Uso por el agente |
|---|---|
| `src/lib/jsonImport/engine.ts` · `runImport` (PURO) | Simulación (dry-run) sobre una **copia** del catálogo de referencia: identidad por oferta/GTIN/marca+MPN, vínculo entre comercios, conflictos → revisión, protección de lo enriquecido/editado, regla «solo productos nuevos» |
| `jsonImport/normalize.ts` | `extractRecords`, `normalizeRecord`, `platformFromUrl`: validación y normalización de registros |
| `jsonImport/reasonLabels.ts` | Motivos en español de cada revisión/rechazo |
| `temuShortLink.isTemuShortLink` | Reconocer enlaces cortos de afiliado de Temu (sin resolverlos: eso es red) |
| Director (Agente 00) | Registro de capacidades, matriz L0–L4, aprobaciones y huella, ledger, tareas con evidencia y verificación, parada de emergencia, ledger caído (I-3), cerebro con suelo de reglas, filtro de secretos |
El módulo **no tiene** validación de GTIN, claves de oferta, fusión ni normalización propias (lo comprueba una prueba) y **no tiene ninguna operación de escritura ni de red**. El catálogo de entrada se compara por huella antes y después de cada simulación.

## 2. Funciones implementadas (`automation/director/agentes/importador/`)
1. **Analizar solicitudes e identificar plataforma y tipo de entrada** (`identificarEntrada`): JSON, ASIN, URL de producto o de categoría (Amazon, AliExpress, eBay, Temu), enlace corto de Temu; nunca abre una URL.
2. **Validar y detectar incidencias**: lo decide el motor (`rechazada`, `falta_titulo`, `precio_invalido`…).
3. **Duplicados y conflictos entre comercios**: «oferta ya existente», «misma identidad en otro comercio» y conflictos (`identificadores_contradictorios`…), con candidatos; ante la duda el motor no fusiona y el informe lo dice.
4. **Propuesta y simulación**: resumen (nuevas, vinculadas, actualizadas, sin cambios, revisiones, rechazadas, errores) y qué omitiría «solo productos nuevos».
5. **Informe normalizado** `informe-agente/1`: clave estable por registro, evidencia literal, limitaciones, rótulo de datos de prueba, `persistencia: no_procede`.
6. **Solicitud de autorización de la importación REAL** (`solicitud-importacion/1`): se **prepara, no se envía**; L4, ejecutor humano, huella del lote y del catálogo base, efectos previstos, requisitos (copia de seguridad, categoría, revisar las revisiones, repetir si cambia la huella) y su irreversibilidad.
7. **Integración con el Director**: «analiza/prepara/propón…» → tarea **L1** con evidencia y verificación por recálculo; «simula la importación…» → solicitud **L2** con huella ligada a la **entrada exacta** → tras la aprobación (simulada en F1) se ejecuta **en local** y se verifica; «importa…» a secas sigue siendo **L4 humano**. La entrada se guarda **por referencia** (el ledger y la aprobación solo llevan su huella; se rechaza si parece una credencial).

## 3. Capacidades todavía SIMULADAS o declaradas no disponibles
- **Importación real** (L4): no es capacidad del agente ni del Director; solo se prepara la solicitud.
- **Entradas con fuente externa** (ASIN, URL, categoría, enlace corto): el agente las **identifica y declara** que hace falta ScraperAPI/Apify/API oficial (**de pago o con red**; coste: no disponible) y **no las consulta**; el camino es aportar el JSON de la extracción.
- **Catálogo de referencia**: sintético (`catalogo.sintetico.json`); no lee `products.json` de producción.
- **Aprobaciones L2**: simuladas (sin interfaz autenticada todavía).

## 4. Dependencias pendientes para la integración real
1. **Vía de lectura del catálogo vivo** (exportación solo lectura, D5) para simular contra el catálogo real y no contra uno sintético.
2. **Cargador de TypeScript** en el proceso del Director (el motor es TS): en local va con `--experimental-transform-types --import ./scripts/register-ts.mjs`; en un servicio habría que compilarlo o invocar el motor por su API interna. Decisión de arquitectura (D4).
3. **Extracción de fuentes externas** (créditos de Apify/ScraperAPI, `import:simulate` — alcance **previsto, no existente**): requiere autorización y política de gasto (D9).
4. **Interfaz autenticada** del panel para confirmar L2/L4 y ejecutar la importación real con los candados existentes.
5. **Parámetro de categoría de destino**: una ficha nueva sin categoría queda en revisión (regla del motor); la simulación lo muestra, pero elegir destino es del propietario.

## 5. Pruebas
- Agente 03: **18** (`f3-agente03.test.mjs`; se ejecuta en un subproceso con el cargador de TS cuando se lanza con el comando plano).
- Director completo: **146** (`node --test "automation/director/tests/*.test.mjs"`); batería de 68 casos del Agente 00 sin fallos.
- Regresión del motor y los importadores (17 archivos de `scripts/tests`: json-import, import-safety, comparable-offers, id-from-url, reimport, repair…): **283 de 283**. Automatización existente (6 archivos): **147 de 147**; workflows sin cambios.
- Los registros del 03 y la nueva disponibilidad `simulacion_local` obligaron a actualizar 4 pruebas del Director que usaban el 03 como ejemplo de «agente planificado» (ahora usan el 06 y el 05).
