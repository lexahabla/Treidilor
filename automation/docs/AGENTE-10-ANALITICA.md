# Agente 10 — Analítica y conversión (local, solo lectura)

Estado: **construido_local** (15/11/2026). Capa de LECTURA y ANÁLISIS sobre la analítica que ya existe (`src/lib/analyticsMonths.ts`); no instala seguimiento ni crea un sistema paralelo. Ficha: `automation/agents/10-analitica-conversion.md`. Código: `automation/director/agentes/analitica/{analitica,fixtures}.mjs`; integración en `director.mjs`, `intencion.mjs` y `registro-agentes.v1.json`. Pruebas: `automation/director/tests/f6-agente10.test.mjs` (17).

## Capacidad (registro, sin cambios de responsabilidad)
| Capacidad | Nivel | Alcance | Disponibilidad |
|---|---|---|---|
| `10.leer-analitica-agregada` | L0 consulta | `analytics:read` | `lectura_f1` (antes `planificada`) |

El registro solo aprueba esta capacidad. Los experimentos que menciona la ficha («se aprueban») son hallazgos PROPUESTOS dentro del informe; ninguna capacidad los lanza. Vaciar/reiniciar la analítica, activar seguimiento o publicar resultados = L4 humano.

## Qué hace
Compara los últimos 7 días con los 7 anteriores (anclados al final del día UTC del último evento, para ser reproducibles) y usa `computeMetricas`, `computeFuentes`, `computeTopProductos` y `computeTopReferrers` sin copiarlas. Informa de sesiones, tasa de clic a salida (sesiones con clic de salida ÷ sesiones), tendencias, fuentes y dominios de origen, y productos con **mucho tráfico y poca salida** o **poco tráfico y mucha salida** (solo con ≥ 20 visitas y ≥ 3 productos con muestra), más experimentos propuestos sin efecto prometido.

## Rigor de los datos
- Cada cifra: `medido`, `derivado`, `estimacion` (visitantes por id de navegador), `declarado` (compras del Return Flow, sin confirmación de la red) o `no_disponible` (ventas verificadas, ingresos/comisiones, conversión a venta, coste, tasa por fuente o dispositivo).
- Con menos de 30 sesiones no se calcula ninguna tasa ni tendencia ni se señala ningún producto; se dice expresamente. También se declaran datos no actuales (> 1 día), ventana recortada (tope de 10 000 eventos del almacén), días sin datos (no se interpretan como caída) y tráfico concentrado (≥ 70 %).
- Datos de prueba rotulados `datos_de_prueba`. Umbrales configurables y visibles en el informe.
- Privacidad: se descartan al entrar los campos que no son de analítica agregada (IP, agente de usuario, rutas con parámetros) y del referente solo se conserva el dominio; el informe y el ledger no contienen ids de sesión o visitante (probado).

## Para otros agentes
`Director.senalesAnalitica()` devuelve solo ids de producto y la naturaleza de los datos (`senalesParaAgentes`). El Agente 06 ya recibe el informe del 10 en su lista de informes, pero declara que **aún no lo integra** y su propuesta no cambia (probado); integrarlo requiere decidir cómo y con datos reales.

## Pendiente / desactivado
- Datos reales: hoy solo `--analitica <json>` (consola) o `rutaAnalitica` con eventos sintéticos. Leer la exportación real (`analytics.json` del volumen) exige conceder `analytics:read` y definir cómo se exporta sin identificadores; sin esa decisión no se lee nada real.
- Ventas, ingresos y comisiones: no disponibles; el libro de ventas es otro sistema y no se lee.
- Siguiente en el registro: ver el informe de entrega.
