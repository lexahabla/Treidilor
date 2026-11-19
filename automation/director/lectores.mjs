/**
 * Agente 00 · F1.3 · LECTORES DE SOLO LECTURA de las instantáneas de los Agentes 04 y 12 (D5, parte de lectura).
 * Leen EXPORTACIONES de las tablas `calidad_catalogo_instantaneas` / `auditor_general_instantaneas` (archivo `<agente>.json` con
 * `formato: "instantaneas-exportadas/1"`), nunca n8n en vivo, y construyen el informe normalizado `informe-agente/1`.
 * Reutiliza el motor de seguimiento existente (`automation/lib/seguimiento.mjs`) para deduplicar filas y comparar instantáneas.
 * Garantías: solo `fs.readFileSync`; no escribe, no borra, no abre red; lo que no se puede leer se DECLARA (descartadas con su motivo),
 * nunca se rellena; los datos de prueba se rotulan como tales. Interfaz lógica `LectorInstantáneas` de MEMORIA-LEDGER-DISENO §7.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ESQUEMA_SEGUIMIENTO, LIMITES_PERSISTENCIA, compararInstantaneas, deduplicarFilas } from '../lib/seguimiento.mjs';
import { ESQUEMA_INFORME_AGENTE, ErrorProtocolo, canonico, sha256 } from './protocolo.mjs';

export const FORMATO_EXPORTACION = 'instantaneas-exportadas/1';
export const MAX_BYTES_EXPORTACION = 8 * 1024 * 1024;
export const MAX_HALLAZGOS_INFORME = 200;
/** Aviso fijo de las copias locales saneadas de instantáneas REALES: dato real e histórico, nunca el estado actual. */
export const TEXTO_SANEADO = 'DATOS REALES SANEADOS: copia local de una instantánea real (secretos y datos personales retirados). Describe un momento pasado; el estado actual del sitio NO está verificado.';
/** Aviso de las lecturas DIRECTAS de producción (n8n, sólo lectura): dato real e histórico, sin saneado propio y nunca el estado actual. */
export const TEXTO_PRODUCCION = 'LECTURA DE PRODUCCIÓN: instantánea guardada por el agente en n8n de producción, leída en modo solo lectura. Describe el momento en que se generó; el estado actual del sitio NO está verificado.';
/** Aviso de las copias de PRUEBAS transformadas (p. ej. entorno «produccion» rotulado «local»): no son idénticas al original y la huella de la fila no lo acredita. */
export function textoCopia(c) {
  return `COPIA DE PRUEBAS TRANSFORMADA: el entorno de origen «${c.entornoOriginal}» se rotuló «${c.entornoCopia}» y el payload se recodificó (sha-256 original ${String(c.sha256PayloadOriginal).slice(0, 12)}… ≠ copia ${String(c.sha256PayloadCopia).slice(0, 12)}…). La huella de la fila (${c.huellaFila}) es un hash del conjunto de claves de incidencias, ${c.huellaFilaCoincide ? 'se recalculó sobre la copia y coincide' : 'NO coincide al recalcularla'}; no acredita que la copia sea idéntica al original.`;
}
const TABLAS = { '04': 'calidad_catalogo_instantaneas', '12': 'auditor_general_instantaneas' };
const CAPACIDAD_ULTIMO = { '04': '04.leer-ultimo-informe', '12': '12.leer-ultimo-informe' };
const COLUMNAS_TEXTO = ['entorno', 'generadoEn', 'idEjecucion'];

const esObjeto = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const soloAgente = (a) => {
  if (!/^\d{2}$/.test(String(a))) throw new ErrorProtocolo('solicitud_invalida', 'Identificador de agente inválido.');
  if (!TABLAS[a]) throw new ErrorProtocolo('capacidad_desconocida', `El agente ${a} no tiene instantáneas que leer.`);
  return String(a);
};

/** Huella estable de un informe normalizado (sirve de verificación cruzada entre dos lecturas independientes). */
export const huellaInforme = (informe) => sha256(canonico(informe));

/** Fila exportada → informe normalizado `informe-agente/1`. Todo campo ausente se declara; nada se inventa. */
export function aInformeAgente({ fila, inst, agente, sintetico, tabla, saneado = false }) {
  const incidencias = Array.isArray(inst.incidencias) ? inst.incidencias : [];
  const porGravedad = { critica: 0, alta: 0, media: 0, baja: 0, info: 0 };
  for (const i of incidencias) if (i.gravedad in porGravedad) porGravedad[i.gravedad] += 1;
  const completo = Boolean(inst.calidad && inst.calidad.estado === 'completa');
  const limitaciones = [
    'La instantánea guardada solo conserva la clave, el código y la gravedad de cada incidencia: certeza, prioridad y detalle por ficha no constan aquí (están en el informe completo de n8n).',
  ];
  if (!completo) limitaciones.push(`Informe no completo (calidad: ${inst.calidad ? inst.calidad.estado : 'desconocida'}): nunca sustituye a la última referencia completa.`);
  if (inst.calidad && Array.isArray(inst.calidad.motivos) && inst.calidad.motivos.length) limitaciones.push(`Motivos de la calidad: ${inst.calidad.motivos.join(', ')}.`);
  if (sintetico) limitaciones.push('DATOS DE PRUEBA: no reflejan la producción.');
  if (saneado) limitaciones.push(TEXTO_SANEADO);
  const omitidos = Math.max(0, incidencias.length - MAX_HALLAZGOS_INFORME);
  if (omitidos) limitaciones.push(`Se omiten ${omitidos} hallazgos por el límite de tamaño del informe.`);
  return {
    esquema: ESQUEMA_INFORME_AGENTE,
    agente,
    capacidad: CAPACIDAD_ULTIMO[agente],
    version: typeof inst.version === 'string' ? inst.version : '',
    entorno: fila.entorno,
    idEjecucion: fila.idEjecucion,
    generadoEn: fila.generadoEn,
    completo,
    fuente: {
      sistema: 'instantanea_exportada',
      tabla,
      host: fila.host || null,
      registrosLeidos: 1,
      origenDatos: sintetico ? 'datos_de_prueba' : 'exportacion',
      origenEjecucion: fila.origen || null,
      firma: fila.huella || null,
    },
    resumen: {
      estadoCalidad: inst.calidad ? inst.calidad.estado : null,
      incidencias: incidencias.length,
      porGravedad,
      porCerteza: null,
      porPrioridad: null,
      elementosAfectados: null,
      elementosTotales: inst.alcance && Array.isArray(inst.alcance.fichas) ? inst.alcance.fichas.length : null,
    },
    hallazgos: incidencias.slice(0, MAX_HALLAZGOS_INFORME).map((i) => ({
      clave: i.clave,
      regla: i.codigo ?? null,
      certeza: null,
      prioridad: null,
      gravedad: i.gravedad ?? null,
      elemento: i.area ?? null,
      evidencia: { clave: i.clave, gravedad: i.gravedad ?? null, cantidad: i.cantidad ?? null, ocurrencias: i.ocurrencias ?? null },
      accionSugerida: null,
    })),
    seguimiento: null,
    persistencia: { escritura: 'guardada', idFila: fila.id ?? null },
    limitaciones,
    honestidad: { datosAusentesDeclarados: true },
  };
}

export class LectorInstantaneas {
  /** @param {{dir:string}} o  Directorio con `04.json` y/o `12.json` (exportaciones o fixtures). */
  constructor({ dir }) {
    if (!dir) throw new ErrorProtocolo('solicitud_invalida', 'Falta el directorio de instantáneas.');
    this.dir = path.resolve(dir);
  }

  /** Agentes de los que hay exportación disponible. */
  disponibles() {
    return Object.keys(TABLAS).sort().filter((a) => fs.existsSync(path.join(this.dir, `${a}.json`)));
  }

  /** Lee y valida la exportación de un agente. Devuelve filas válidas (con su instantánea), descartadas con motivo y metadatos. */
  cargar(agenteId) {
    const agente = soloAgente(agenteId);
    const ruta = path.join(this.dir, `${agente}.json`);
    const st = fs.statSync(ruta, { throwIfNoEntry: false });
    if (!st) throw new ErrorProtocolo('origen_no_disponible', `No hay exportación de instantáneas del agente ${agente} (se esperaba ${agente}.json).`);
    if (st.size > MAX_BYTES_EXPORTACION) throw new ErrorProtocolo('origen_no_disponible', `La exportación del agente ${agente} supera ${MAX_BYTES_EXPORTACION} bytes.`);
    let datos;
    try { datos = JSON.parse(fs.readFileSync(ruta, 'utf8')); } catch { throw new ErrorProtocolo('origen_no_disponible', `La exportación del agente ${agente} no es un JSON legible.`); }
    return this._normalizar(agente, datos, path.basename(ruta));
  }

  /** Valida y normaliza una exportación YA leída (de archivo o de n8n). Las filas inválidas se descartan con su motivo; nada se rellena. */
  _normalizar(agente, datos, archivo) {
    const filasCrudas = Array.isArray(datos) ? datos : esObjeto(datos) && Array.isArray(datos.filas) ? datos.filas : null;
    if (!filasCrudas) throw new ErrorProtocolo('origen_no_disponible', `La exportación del agente ${agente} no tiene filas.`);
    if (!Array.isArray(datos) && datos.formato !== FORMATO_EXPORTACION) throw new ErrorProtocolo('origen_no_disponible', `Formato de exportación no soportado (${String(datos.formato)}).`);
    const sintetico = !Array.isArray(datos) && datos.sintetico === true;
    const saneado = !Array.isArray(datos) && datos.saneado === true && !sintetico;
    const produccion = !Array.isArray(datos) && datos.produccion === true && !sintetico && !saneado;
    const c0 = !Array.isArray(datos) && esObjeto(datos.copia) ? datos.copia : null;
    const copia = c0 && ['entornoOriginal', 'entornoCopia', 'sha256PayloadOriginal', 'sha256PayloadCopia', 'huellaFila'].every((k) => typeof c0[k] === 'string' && c0[k]) ? { entornoOriginal: c0.entornoOriginal, entornoCopia: c0.entornoCopia, sha256PayloadOriginal: c0.sha256PayloadOriginal, sha256PayloadCopia: c0.sha256PayloadCopia, huellaFila: c0.huellaFila, huellaFilaCoincide: c0.huellaFilaCoincide === true } : null;
    const tabla = (!Array.isArray(datos) && datos.tabla) || TABLAS[agente];
    const descartadas = [];
    const validas = [];
    for (const [n, f] of filasCrudas.entries()) {
      const rotulo = esObjeto(f) ? `${f.idEjecucion ?? 'sin idEjecucion'}` : `fila ${n + 1}`;
      if (!esObjeto(f) || COLUMNAS_TEXTO.some((c) => typeof f[c] !== 'string' || !f[c])) { descartadas.push({ fila: rotulo, motivo: 'fila_incompleta' }); continue; }
      if (typeof f.payload !== 'string' || Buffer.byteLength(f.payload) > LIMITES_PERSISTENCIA.maxBytesInstantanea) { descartadas.push({ fila: rotulo, motivo: 'payload_invalido' }); continue; }
      let inst = null;
      try { inst = JSON.parse(f.payload); } catch { inst = null; }
      if (!esObjeto(inst)) { descartadas.push({ fila: rotulo, motivo: 'payload_invalido' }); continue; }
      if (inst.esquema !== ESQUEMA_SEGUIMIENTO || !Array.isArray(inst.incidencias)) { descartadas.push({ fila: rotulo, motivo: 'esquema_incompatible' }); continue; }
      if (inst.entorno !== f.entorno || inst.generadoEn !== f.generadoEn) { descartadas.push({ fila: rotulo, motivo: 'fila_incoherente' }); continue; }
      if (!inst.calidad || typeof inst.calidad.estado !== 'string') { descartadas.push({ fila: rotulo, motivo: 'sin_calidad' }); continue; }
      if (Number.isNaN(Date.parse(f.generadoEn))) { descartadas.push({ fila: rotulo, motivo: 'fecha_ilegible' }); continue; }
      validas.push({ ...f, _inst: inst });
    }
    const unicas = deduplicarFilas(validas);
    unicas.sort((a, b) => (a.generadoEn < b.generadoEn ? -1 : a.generadoEn > b.generadoEn ? 1 : a.idEjecucion < b.idEjecucion ? -1 : 1));
    return {
      agente, tabla, sintetico, saneado, produccion, copia, archivo, exportadoEn: (!Array.isArray(datos) && datos.exportadoEn) || null,
      leidas: filasCrudas.length, duplicadas: validas.length - unicas.length, descartadas,
      filas: unicas.map((f) => ({ fila: (({ _inst, ...resto }) => resto)(f), inst: f._inst })),
    };
  }

  /** Entorno por defecto: `produccion` si hay filas de él; si no, el de la última instantánea (se informa en el informe). */
  _filtrar(carga, entorno) {
    if (entorno) return carga.filas.filter((x) => x.fila.entorno === entorno);
    const prod = carga.filas.filter((x) => x.fila.entorno === 'produccion');
    return prod.length ? prod : carga.filas;
  }

  _informe(carga, x) {
    return aInformeAgente({ fila: x.fila, inst: x.inst, agente: carga.agente, sintetico: carga.sintetico, tabla: carga.tabla, saneado: carga.saneado });
  }

  /** Última instantánea (completa o no: `completo` lo dice el informe). `null` si no hay ninguna. */
  ultima(agente, { entorno = null } = {}) {
    const carga = this.cargar(agente);
    const filas = this._filtrar(carga, entorno);
    if (!filas.length) return { informe: null, carga: this._meta(carga) };
    return { informe: this._informe(carga, filas[filas.length - 1]), carga: this._meta(carga) };
  }

  /** Últimas `n` instantáneas, de la más reciente a la más antigua (los históricos se conservan y se consultan siempre). */
  listar(agente, { entorno = null, n = 10 } = {}) {
    const carga = this.cargar(agente);
    const filas = this._filtrar(carga, entorno);
    const limite = Math.max(1, Math.min(50, Number.isInteger(n) ? n : 10));
    return { informes: filas.slice(-limite).reverse().map((x) => this._informe(carga, x)), total: filas.length, carga: this._meta(carga) };
  }

  obtener(agente, idEjecucion, { entorno = null } = {}) {
    const carga = this.cargar(agente);
    const x = this._filtrar(carga, entorno).find((f) => f.fila.idEjecucion === idEjecucion);
    return { informe: x ? this._informe(carga, x) : null, carga: this._meta(carga) };
  }

  /**
   * Compara dos instantáneas con el motor de seguimiento existente (por defecto las dos últimas). Devuelve null en `informe` si no hay dos.
   * El informe devuelto es el de la instantánea ACTUAL con la sección `seguimiento` rellena.
   */
  comparar(agente, { entorno = null, anterior = null, actual = null } = {}) {
    const carga = this.cargar(agente);
    const filas = this._filtrar(carga, entorno);
    const act = actual ? filas.find((f) => f.fila.idEjecucion === actual) : filas[filas.length - 1];
    const idx = act ? filas.indexOf(act) : -1;
    const ant = anterior ? filas.find((f) => f.fila.idEjecucion === anterior) : idx > 0 ? filas[idx - 1] : null;
    if (!act || !ant) return { informe: null, motivo: !act ? 'no_hay_instantanea_actual' : 'no_hay_instantanea_anterior', carga: this._meta(carga) };
    const comp = compararInstantaneas(ant.inst, act.inst);
    const informe = this._informe(carga, act);
    informe.capacidad = `${agente}.comparar-informes`;
    informe.seguimiento = {
      modo: comp.modo,
      motivo: comp.motivo,
      comparadoCon: ant.fila.idEjecucion,
      comparadoConGeneradoEn: ant.fila.generadoEn,
      resumen: comp.resumen,
      nuevas: comp.nuevas.map((i) => i.clave),
      resueltas: comp.resueltas.map((i) => i.clave),
      reaparecidas: comp.reaparecidas.map((i) => i.clave),
      noVerificadas: comp.noVerificadas.map((i) => i.clave),
      indeterminadas: comp.indeterminadas.map((i) => i.clave),
    };
    return { informe, anterior: this._informe(carga, ant), carga: this._meta(carga) };
  }

  _meta(c) {
    return { agente: c.agente, tabla: c.tabla, archivo: c.archivo, sintetico: c.sintetico, saneado: c.saneado, produccion: c.produccion === true, copia: c.copia ?? null, exportadoEn: c.exportadoEn, leidas: c.leidas, duplicadas: c.duplicadas, descartadas: c.descartadas };
  }
}
