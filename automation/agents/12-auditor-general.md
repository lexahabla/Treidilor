# Auditor General

**Misión.** Supervisa de forma continua salud, rutas, enlaces, integridad del catálogo y estado de las automatizaciones; genera informes de incidencias.

## Entradas
- /api/health
- Páginas públicas
- Feed del catálogo (sólo en pruebas)
- Ejecuciones de n8n

## Salidas
- Informe de incidencias con evidencias y acciones sugeridas

## Permisos mínimos (alcances)
- `Sólo lectura (GET) a URLs permitidas`

## Límites
- Ritmo, tiempo y presupuesto fijados por ejecución (ver `automation/docs/PROCEDIMIENTOS.md`).
- Una sola ejecución a la vez; sin reintentos ilimitados; parada de emergencia global.

## Riesgo y aprobación
- **Riesgo:** Bajo.
- **Aprobación humana:** Sólo informa.

## Etapa
2.0 (v0 piloto)

## Cómo se mide
Incidencias detectadas antes que por un visitante; falsos positivos

## Regla de honestidad
v0 determinista, sin IA ni coste; en producción NO visita fichas (cuentan en la analítica).
## Estado de validación (14/11/2026, dato comunicado por el propietario; no verificado por el asistente)
- **Producción:** workflow `Auditor General | Producción`, **sin publicar y sin programar** (solo disparador manual). Dos ejecuciones manuales correctas: `ex-13` (13/11, línea base) y `ex-17` (14/11, `seguimiento.modo` = `comparacion`, `origenReferencia` = `historial`, 1 fila válida y 0 duplicadas, calidad `completa`, 0 incidencias, 38 peticiones, 4 rutas, 33 enlaces internos, 37 de 37 páginas respondidas, `persistencia.escritura` = `guardada` con `filaId` 2); la tabla `auditor_general_instantaneas` tiene exactamente 2 filas.
- **Pendiente antes de programar:** responsable, frecuencia, canal de avisos y procedimiento ante incidencias; zona horaria efectiva; una tercera ejecución en otro día; restauración probada o aceptación del riesgo; retención de ejecuciones; informe final con tamaño y recursos; concurrencia. Detalle en `automation/docs/AGENTE-12-VALIDACION-PRODUCCION.md` §6.
