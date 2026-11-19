/**
 * Constructor de FIXTURES (datos SINTÉTICOS) con la forma de las exportaciones de las tablas de instantáneas de los Agentes 04 y 12:
 * una fila por ejecución con las columnas reales (`COLUMNAS_INSTANTANEAS` de seguimiento.mjs) y `payload` = instantánea compacta serializada.
 * No contiene datos de producción. Los ids de ejecución (`fx-…`) no coinciden con los reales (`ex-…`) para no confundirlos.
 */
import { createHash } from 'node:crypto';
import { ESQUEMA_SEGUIMIENTO } from '../../lib/seguimiento.mjs';
import { FORMATO_EXPORTACION } from '../lectores.mjs';

const NOMBRE_AGENTE = { '04': 'calidad-catalogo', '12': 'auditor-general' };
const TABLA = { '04': 'calidad_catalogo_instantaneas', '12': 'auditor_general_instantaneas' };

/** `incidencias`: [[clave, gravedad, cantidad?], …] */
export function instantanea({ agente = '04', entorno = 'produccion', generadoEn, estado = 'completa', motivos = [], incidencias = [], fichas = [], host = 'treidilor.com', version = '0.2.0' }) {
  return {
    esquema: ESQUEMA_SEGUIMIENTO,
    agente: NOMBRE_AGENTE[agente],
    version,
    entorno,
    host,
    generadoEn,
    calidad: { estado, motivos },
    alcance: { host, salud: true, rutas: [], enlaces: [], fichas, contenido: null, catalogo: { leido: true, completo: estado === 'completa' } },
    incidencias: incidencias.map(([clave, gravedad, cantidad = null]) => {
      const [area, codigo] = clave.split(':');
      return { clave, area, codigo, gravedad, cantidad, ocurrencias: 1 };
    }),
  };
}

export function fila({ id, agente = '04', idEjecucion, origen = 'manual', ...resto }) {
  const inst = instantanea({ agente, ...resto });
  const huella = createHash('sha256').update(inst.incidencias.map((i) => i.clave).join('|')).digest('hex').slice(0, 16);
  return { id, entorno: inst.entorno, host: inst.host, generadoEn: inst.generadoEn, idEjecucion, origen, calidad: inst.calidad.estado, huella, payload: JSON.stringify(inst) };
}

export function exportacion({ agente, filas, exportadoEn = '2026-11-14T12:00:00.000Z', sintetico = true }) {
  return { formato: FORMATO_EXPORTACION, agente, tabla: TABLA[agente], exportadoEn, sintetico, filas };
}

/** Conjunto de fixtures por defecto (dos ejecuciones por agente; la segunda cambia el reparto de incidencias). */
export function fixturesPorDefecto() {
  const fichas = Array.from({ length: 12 }, (_, i) => `p-${String(i + 1).padStart(3, "0")}`);
  const calidad = exportacion({
    agente: '04',
    filas: [
      fila({ id: 1, agente: '04', idEjecucion: 'fx-04-01', generadoEn: '2026-11-13T09:00:00.000Z', fichas, incidencias: [['ficha:sin_categoria:p-001', 'media'], ['ficha:sin_categoria:p-002', 'media'], ['ficha:comercio_malformado:p-003', 'media'], ['ficha:fecha_captura_antigua:p-004', 'baja']] }),
      fila({ id: 2, agente: '04', idEjecucion: 'fx-04-02', generadoEn: '2026-11-14T09:00:00.000Z', fichas, incidencias: [['ficha:sin_categoria:p-001', 'media'], ['ficha:comercio_malformado:p-003', 'media'], ['ficha:fecha_captura_antigua:p-004', 'baja'], ['ficha:red_no_identificada:p-005', 'baja']] }),
    ],
  });
  const auditor = exportacion({
    agente: '12',
    filas: [
      fila({ id: 1, agente: '12', idEjecucion: 'fx-12-01', generadoEn: '2026-11-13T08:00:00.000Z', incidencias: [] }),
      fila({ id: 2, agente: '12', idEjecucion: 'fx-12-02', generadoEn: '2026-11-14T08:00:00.000Z', incidencias: [['enlace:no_encontrada:/ejemplo', 'media']] }),
    ],
  });
  return { '04': calidad, '12': auditor };
}
