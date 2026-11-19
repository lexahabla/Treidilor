# Calidad y enriquecimiento del catálogo

**Misión.** Detecta fichas incompletas, incoherentes o duplicadas y propone correcciones y textos con datos reales.

## Entradas
- Catálogo (lectura)
- Informes del Auditor

## Salidas
- Lista priorizada de correcciones
- Borradores de texto con fuente

## Permisos mínimos (alcances)
- `catalog:read`
- `proposals:create`

## Límites
- Ritmo, tiempo y presupuesto fijados por ejecución (ver `automation/docs/PROCEDIMIENTOS.md`).
- Una sola ejecución a la vez; sin reintentos ilimitados; parada de emergencia global.

## Riesgo y aprobación
- **Riesgo:** Medio.
- **Aprobación humana:** Las correcciones se aprueban una a una o por lotes.

## Etapa
2.4 (detectar) → 2.5 (proponer)

## Estado actual (14/11/2026)
**v0 «detectar» desplegado en producción de forma supervisada** (dato comunicado por el responsable; no verificado por el asistente): workflow `Calidad del catálogo — Producción` sin publicar ni programar; primera ejecución manual `ex-16` completada y guardada (131 productos; 25 defectos confirmados, 45 advertencias, 5 informativos; 38 productos afectados), que es la **línea base**. **Segunda auditoría manual `ex-18` (14/11/2026): correcta** (modo `comparacion` contra `ex-16`, 1 fila válida, 0 duplicadas, 131 productos y 2 de 2 páginas, **75 incidencias persistentes** y 0 nuevas/resueltas/reaparecidas/no verificadas, `guardada` con `filaId` 2, tabla con 2 filas; verificado por ChatGPT a partir del JSON y de capturas, no reproducido por el asistente). **Funcionamiento validado en dos ejecuciones manuales; los problemas del catálogo siguen SIN corregir**: 25 fichas sin categoría, advertencias por fechas de captura del precio, `[object Object]` en el comercio de algunas fichas de Amazon y redes no identificadas. Pendientes antes de automatizar: `AGENTE-04-CALIDAD.md` («Condiciones pendientes…»). Detalle en `automation/docs/AGENTE-04-CALIDAD.md`. Reparto con el Agente 12 (Auditor General) sin cambios.

## Cómo se mide
Fichas completas / total

## Regla de honestidad
Nunca inventa especificaciones: sólo reorganiza lo que consta.
