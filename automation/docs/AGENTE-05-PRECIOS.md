# Agente 05 — Analista de ofertas y precios (capa de análisis local, fixtures sintéticos)

> **Estado (14/11/2026): construido EN LOCAL, sin commit, sin red, sin créditos; no modifica `src/`, catálogo, precios, producción ni workflows.** Ficha `automation/agents/05-analista-precios.md` (riesgo **alto**: «nunca escribe precios: solo propone») y registro: **una** capacidad, `05.detectar-caidas-precio` (**L1**, propuesta, sin efectos). Regla de la ficha: «un descuento solo existe si hay observación verificada».

## Qué reutiliza (no hay sistema paralelo)
| Función existente de Treidilor | Uso |
|---|---|
| `commercialClaims.verifiedDiscountOf` | Un descuento solo existe con observación verificada; el declarado por el comercio se cuenta («descuentos falsos evitados») y NO se presenta |
| `offerObservations` (`freshnessOf`, `evaluateDrop`, `contextKey`, `isValidPrice`, `DEFAULT_MAX_AGE_HOURS`) | Vigencia de una lectura (72 h) y bajadas entre lecturas comparables (mismo contexto) |
| `priceHistoryView.collectPoints` | Lecturas reales (solo verificadas si hay ≥ 2) para media y rareza |
| `comparableOffers.getComparableOffers` | Ofertas del MISMO producto entre comercios, sin mezclar condición, variante ni vendedor dudoso |
| Director (Agente 00) | Registro, ledger, tareas con evidencia y verificación por recálculo, permisos L0–L4, parada de emergencia, I-3, cerebro con suelo de reglas, informe `informe-agente/1` |

## Qué hace (`automation/director/agentes/precios/`)
- **Procedencia del precio:** «verificado vigente» solo con observación verificada, ≤ 72 h, en EUR y coincidente con el publicado; si no, `desactualizado`, `no verificado`, `otra moneda` o `no coincide`. Nunca se presenta como actual un precio simulado, declarado, sin observación o antiguo.
- **Descuentos:** verificado / verificado obsoleto / declarado sin verificar.
- **Bajadas:** verificada (2 lecturas comparables verificadas y la última vigente) o no verificada; un salto brusco (≤ −40 % o ≥ +60 %) es anomalía, no oportunidad.
- **Anomalías (umbrales iniciales configurables y declarados):** precio publicado ≠ observado, moneda no EUR, precio anterior ≥ 3× el actual, precio < 50 % de su mediana verificada, salto brusco, sin stock.
- **Comparación entre comercios:** solo ofertas verificadas y vigentes con total (precio + envío) conocido; si falta algo, «no concluyente» y por qué; otras versiones y casos ambiguos quedan para una persona.
- **Oportunidades de ahorro:** más barata entre comercios (ahorro en €) y precio verificado vigente por debajo de su media verificada (≥ 3 lecturas).
- **Propuestas de corrección con evidencia:** publicado frente a observado; la corrección es **L4 humano** (el agente no tiene ninguna operación de escritura).
- Informe normalizado con certeza (confirmado / advertencia / no verificable), prioridad P1–P4 y limitaciones; `persistencia: no_procede`.
- En el Director: «Analiza los precios / ¿hay ofertas o descuentos verificados? / ¿dónde sale más barato…?» → tarea L1 con verificación; «Cambia los precios» → L4 humano; «Actualiza los precios» → aclaración.

## Simulado / pendiente de integración
- Catálogo y observaciones **sintéticos** (`catalogo-precios.sintetico.json`, generado con el motor existente); no se lee `products.json` ni se consulta ningún comercio.
- **Pendiente:** vía de lectura del catálogo y de `extra.observations` vivos (exportación solo lectura, D5); decidir si las señales de bajada alimentan las **«Alertas de precio»** y el Agente 13 (hoy el agente no crea alertas, solo informa); alcance `proposals:create` (previsto, no existente) para la cola de propuestas; cargador de TypeScript del servicio (D4); interfaz autenticada para aplicar correcciones (L4); medición de la ficha («descuentos falsos evitados», «oportunidades aprovechadas») requiere memoria de decisiones (F2).

## Pruebas
- Agente 05: **18** (`f4-agente05.test.mjs`; el comando plano las relanza con el cargador de TS).
- Director: **147**; batería de 68 casos sin fallos (EV-04, 09, 20 y 35 usan el registro FX-REG, donde 02, 03 y 05 están `planificado`, como describe la batería).
- Regresión: precios/ofertas existentes (20 archivos) **226/226**; importación (17) **283/283**; automatización (6) **147/147**; workflows sin cambios.
