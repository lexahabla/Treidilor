/**
 * Agente 00 · 3E.8.8 · CONFIGURACIÓN de la integridad periódica del diario (ver README-INTEGRIDAD en docs del prototipo, `FASE-3E8-8`).
 * Valores iniciales; relajarlos exige autorización expresa. Nada de esto programa nada: el disparador (n8n, el Director, un planificador) es externo y está SIN activar.
 */
const HORA = 3600000;
export const CONFIG_INTEGRIDAD = Object.freeze({
  /** Partición propia del ledger: su archivo, su cerrojo y su ancla no se mezclan con la conversación del Director. */
  particion: 'integridad',
  /** Política (misma semántica que el motor del prototipo): verificar cada 6 h; aviso a las 12 h y fallo a las 24 h sin una verificación correcta. */
  politica: Object.freeze({ intervaloMs: 6 * HORA, avisoMs: 12 * HORA, falloMs: 24 * HORA }),
  /** Cadencia PREVISTA del disparador externo (informativa): se comprueba si toca cada hora; solo se verifica cuando toca. */
  comprobacionCadaMs: HORA,
  /** Franjas en las que NO se lanza (hora de Madrid): gestor 09:00, vigilante 09:45, resumen 09:50. */
  zonaHoraria: 'Europe/Madrid',
  ventanasProhibidas: Object.freeze([Object.freeze({ desde: '08:50', hasta: '10:05' })]),
  /** Límites del proceso hijo: reloj, montón de V8 (MiB), bytes de salida aceptados y caducidad del cerrojo de «ya en ejecución». */
  timeoutMs: 120000,
  maxOldSpaceMiB: 160,
  maxSalidaBytes: 65536,
  bloqueoCaducaMs: 300000,
  /** Si el almacén tiene un cerrojo de escritura (bloqueo.json) tocado hace menos de este tiempo, la pasada se aplaza: no se verifica un almacén que se está escribiendo. */
  escrituraEnCursoMs: 120000,
  /** Errores operativos seguidos que elevan el aviso a fallo. */
  erroresSeguidosParaFallo: 3,
});
