# Agente 11 — Webs nicho (componentes puros locales; sin capacidades aprobadas)

Estado (15/11/2026): componentes puros construidos y probados en local con datos e informes SINTÉTICOS; **NO integrado en el Director**: el registro mantiene el 11 `planificado` y sin capacidades. Ficha: `automation/agents/11-webs-nicho.md` (ficha: «Expansión mediante webs nicho»; registro: «Webs nicho»). Código: `automation/director/agentes/nichos/{nichos,fixtures}.mjs` y `propuesta-capacidades-11.json`. Pruebas: `automation/director/tests/f14-agente11.test.mjs` (14).

## Ficha (sin cambios)
Misión: estudiar la viabilidad de nuevos nichos y webs (demanda, competencia, afiliación, coste). Entrada: informes de mercado y afiliación. Salida: estudio de viabilidad con hipótesis y riesgos. Alcance previsto: `research:write`. Riesgo bajo; decisión del propietario. Medición: estudios con decisión. Honestidad: hipótesis marcadas como tales.

## Dentro de la ficha (puro; todo por parámetro)
- `estudiarNicho`: estudio en BORRADOR con cinco dimensiones, cada una con su estado (`verificado`, `observacion`, `estimacion`, `hipotesis`, `parcial` o `no_disponible`): demanda y costes (cifras APORTADAS por una persona; nunca se suman ni se proyectan; los mal etiquetados se degradan), competencia (informe del Agente 09), afiliación (informe del 02) y catálogo propio (nuestras fichas de referencia); indicio sobre nuestro tráfico (informe del 10); cuatro hipótesis marcadas como tales con cómo validarlas; riesgos derivados de lo que falta; «madurez de la evidencia» (mide cuánta evidencia hay, no si el nicho es rentable).
- `analizarOportunidades`: ordena por madurez de la evidencia, no por beneficio previsto.
- `informeNichos`: informe `informe-agente/1` (agente `11`) en dos modos (`viabilidad`, `oportunidades`). Se declaran NO disponibles los ingresos y la rentabilidad, el tráfico potencial, la demanda no aportada y las decisiones del propietario («estudios con decisión» = 0).

## Fuera de la ficha (propuestas pendientes de autorización; no figuran en ningún informe del estudio)
`proponerEstructuraSitio` (esqueleto de secciones con NUESTRAS categorías, los huecos del 09 y páginas legales) y `proponerEstrategiaContenido` (piezas a redactar derivadas de los huecos del 09, de nuestras fichas y de la estacionalidad del calendario del 07, con las capacidades 07/08 como destino). La ficha no menciona ninguna de las dos: están marcadas `fueraDeFicha`, no crean nada (ni nombre, dominio, tecnología, textos, tráfico ni ingresos) y requieren autorización expresa para registrarse.

## Reutilizado
Informes `informe-agente/1` de los Agentes 02, 09 y 10 (sin recalcular su lógica) y, del 07, `momentosEnHorizonte`; el catálogo de referencia y las categorías de los fixtures del 07. No se crea otro sistema de SEO, marketing, investigación o gestión de productos.

## Cambios en el Director
Preguntas sobre nichos o viabilidad se dirigen al 11 «planificado» (sin tarea ni aprobación) y crear una web, comprar un dominio o contratar alojamiento se clasifican como acción humana L4 (`crearWeb`).

## Propuesta de capacidades (NO aprobada)
`propuesta-capacidades-11.json`. De la ficha: L1 `11.analizar-oportunidades-nicho`, L1 `11.estudiar-viabilidad-nicho` (sin alcances) y L3 bloqueada `11.registrar-estudio` (`research:write`, falta el almacén). Fuera de la ficha, pendientes de autorización expresa: `11.proponer-estructura-sitio` y `11.proponer-estrategia-contenido` (L1). Crear webs, comprar dominios, contratar alojamiento, publicar, activar campañas, darse de alta en programas y decidir el nicho: L4 humano.

## Pendiente
Aprobar capacidades (y decidir si se autorizan o se descartan las dos fuera de la ficha); almacén de investigación (compartido con 07 y 09); quién aporta y verifica la demanda y los costes y con qué plantilla; registro de la decisión del propietario por estudio.
