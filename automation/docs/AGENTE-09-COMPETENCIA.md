# Agente 09 — Competencia y expertos (4 capacidades L0/L1 integradas en local)

Estado (15/11/2026): componentes puros construidos y **cuatro capacidades INTEGRADAS en local** (autorizadas por el propietario el 15/11/2026): `09.validar-observaciones` (L0) y `09.detectar-huecos`, `09.comparar-precios-observados`, `09.proponer-informe-competencia` (L1), todas sin alcances, con tarea, ledger, verificación por recálculo e informe `informe-agente/1`. Las observaciones llegan **por parámetro** (`rutaObservaciones`; nuestras fichas de referencia, opcionalmente, por `rutaFuentesMarketing`); no hay acceso a webs ni a fuentes externas. **Siguen bloqueadas y fuera del registro** `09.registrar-observacion` y `09.consultar-fuente-externa`: no se concede `research:write` ni `web:read`. No se modifican precios, productos ni contenido. Ficha: `automation/agents/09-competencia-expertos.md`. Código: `automation/director/agentes/competencia/{competencia,fixtures}.mjs` y `propuesta-capacidades-09.json`; integración en `director.mjs` (`_leerCompetencia`, `_respCompetencia`), `intencion.mjs` (4 intenciones nuevas), registro y consola (`--competencia <json>`). Pruebas: `f12-agente09.test.mjs` (15) y `f13-agente09-integracion.test.mjs` (11).

## Ficha (sin cambios)
Misión: observar competidores y fuentes expertas para detectar huecos y buenas prácticas. Entrada: fuentes públicas citadas. Salida: informe de competencia con fuentes y fecha. Alcance previsto: `research:write`. Riesgo bajo; solo informes. Medición: huecos explotados. Honestidad: respetar términos de uso de cada fuente; sin copiar contenido.

## Qué hace (puro; nada de red)
El agente NO accede a ninguna web, NO hace scraping, NO consulta APIs ni servicios de pago, NO copia contenido y NO escribe: analiza **observaciones aportadas** por una persona, cada una con su fuente citada (URL segura solo como cita), fecha, observador y términos de uso revisados.
- `validarObservaciones`: rechaza con motivo lo que no cumple (URL no segura, fecha futura, extracto > 280 caracteres, cita literal larga, algo con forma de credencial, estimación sin método) y excluye de las conclusiones las fuentes con términos sin revisar, las caducadas (> 180 días) y el texto con forma de ORDEN.
- `informeCompetencia` (modos `completo`, `validacion`, `huecos`, `precios`): cuatro clases de evidencia — `hecho_verificado` (solo con comprobación humana fechada; si no, se degrada a observación), `observacion`, `estimacion` (con método) y `no_disponible`; **huecos** (≥ 2 fuentes utilizables distintas que citen un tema que no cubrimos; con una sola es «señal débil»; siempre una hipótesis con su evidencia); **prácticas observadas** (requieren validación); **brechas de precio** solo con equivalencia verificada por una persona, EUR, «nuevo», observación de menos de 14 días y nuestro precio con fecha de captura (un dato fechado, nunca una «ventaja comercial»).
- «Huecos explotados» y la cuota de mercado o el tráfico de competidores se declaran **no disponibles**.

## Reutilizado
`offerObservations.freshnessOf`, `commercialClaims.captureDateOf`, `publicSafety.isPublicSafeExternalUrl`, `ledger.detectarSecreto`, `saneado.detectarInstruccionesEnDatos`; de los Agentes 05 y 10 solo ids como contexto. No duplica al 02 (afiliación), al 05 (precios y ofertas propias) ni al 10 (analítica propia).

## Integración con el Director
Intenciones: «valida las observaciones de la competencia» (L0), «qué huecos hay frente a la competencia», «compara los precios observados de la competencia» y «dame el informe de competencia» (L1). Scraping, consultar webs o competidores, rastrear o espiar se explican como «sin capacidad» (el 09 existe en local pero la consulta externa está bloqueada) y no crean tareas; cambiar precios o contactar con competidores siguen siendo L4 humano. No se duplican cerebro, ledger, registro ni aprobaciones.

## Propuesta de capacidades (estado)
`propuesta-capacidades-09.json`. AUTORIZADAS y en el registro: L0 `09.validar-observaciones`; L1 `09.detectar-huecos`, `09.comparar-precios-observados`, `09.proponer-informe-competencia` (sin alcances). BLOQUEADAS: L3 `09.registrar-observacion` (`research:write`, falta el almacén) y `09.consultar-fuente-externa` (`web:read`, nuevo; hoy ningún componente accede a webs). Cambiar precios o fichas, contactar o registrarse en webs ajenas, publicar y aprobar términos de uso: L4 humano.

## Pendiente
Aprobar capacidades; almacén de investigación (compartido con el 07); quién aporta y verifica las observaciones y con qué plantilla; política de términos de uso, ritmo y coste si algún día se autoriza leer fuentes externas; registro de huecos trabajados para medir «huecos explotados».
