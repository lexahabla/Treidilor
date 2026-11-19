/**
 * Agente 02 · INVESTIGADOR DE PROGRAMAS DE AFILIACIÓN (ficha `automation/agents/02-investigador-afiliacion.md`; riesgo bajo, solo informes/propuestas L1).
 * PURO, determinista y SIN red: estudia y compara programas y redes a partir de un conjunto de datos LOCAL (hoy SIMULADO). Reutiliza el modelo de
 * procedencia de las suscripciones (`dato`: verificado / estimado / no_disponible) y devuelve el informe normalizado `informe-agente/1` del protocolo.
 * Regla de honestidad de la ficha: toda cifra de comisión lleva fuente y fecha; sin datos → «no consta». Nunca se inventa una comisión, una cookie ni una
 * condición; lo que falta se lista aparte y NO entra en el ranking. Las recomendaciones son PROPUESTAS: este agente no se da de alta, no solicita
 * cuentas, no cambia la configuración de Treidilor ni toca conectores (eso es L4 humano).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectarSecreto } from '../../ledger.mjs';
import { VERIFICACIONES, esDatoUtil } from '../../suscripciones/modelo.mjs';
import { ESQUEMA_INFORME_AGENTE, canonico, sha256 } from '../../protocolo.mjs';

export const RUTA_PROGRAMAS_SIMULADO = path.join(path.dirname(fileURLToPath(import.meta.url)), 'programas.simulado.json');
export const CAMPOS_NUMERICOS = Object.freeze({ comisionPct: { min: 0, max: 100, unidad: '%' }, cookieDias: { min: 0, max: 3650, unidad: 'días', entero: true }, pagoMinimoEur: { min: 0, max: 100000, unidad: '€' }, periodoPagoDias: { min: 0, max: 365, unidad: 'días', entero: true } });
const CAMPOS_PROHIBIDOS = /(cookie_?sesion|session|oauth|refresh|access_?token|bearer|password|contrasena|secret|api_?key|clave_?api|authorization|publisher_?id|id_?afiliado|tracking_?id)/i;
const DIA = 86400000;
const esObjeto = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const esFecha = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s));
const FRESCURA_DATOS_DIAS = Object.freeze({ vigente: 90, aActualizar: 180 }); // valores iniciales configurables (ver ficha de capacidad)

/** Valida el conjunto de datos. { ok, errores[] }. No corrige nada. Rechaza identificadores de afiliado y credenciales. */
export function validarDatasetAfiliacion(ds) {
  const errores = [];
  if (!esObjeto(ds)) return { ok: false, errores: ['El conjunto de datos no es un objeto.'] };
  if (ds.esquema !== 'afiliacion-programas/1') errores.push('esquema debe ser afiliacion-programas/1');
  if (!Array.isArray(ds.programas)) return { ok: false, errores: [...errores, 'Faltan los programas'] };
  const secreto = detectarSecreto(JSON.stringify(ds));
  if (secreto) errores.push(`contiene algo que parece una credencial (${secreto})`);
  const revisar = (o, ruta) => { if (Array.isArray(o)) o.forEach((x, i) => revisar(x, `${ruta}[${i}]`)); else if (esObjeto(o)) for (const [k, v] of Object.entries(o)) { if (CAMPOS_PROHIBIDOS.test(k)) errores.push(`${ruta}.${k}: no se admiten credenciales ni identificadores de afiliado`); revisar(v, `${ruta}.${k}`); } };
  revisar(ds, '$');
  const ids = new Set();
  for (const p of ds.programas) {
    const r = `programa ${p.id}`;
    if (!/^[a-z0-9-]{2,30}$/.test(p.id || '')) errores.push(`${r}: id inválido`);
    if (ids.has(p.id)) errores.push(`${r}: duplicado`);
    ids.add(p.id);
    const dato = (d, ruta, cfg) => {
      if (!esObjeto(d) || !VERIFICACIONES.includes(d.verificacion)) { errores.push(`${ruta}: dato con procedencia inválido`); return; }
      if (d.verificacion === 'no_disponible' && d.valor !== null) errores.push(`${ruta}: un dato no disponible debe tener valor null (no se inventa)`);
      if (d.verificacion === 'verificado' && (!d.fuente || !esFecha(d.fecha))) errores.push(`${ruta}: «verificado» exige fuente y fecha`);
      if (d.verificacion !== 'no_disponible' && cfg && !(typeof d.valor === 'number' && d.valor >= cfg.min && d.valor <= cfg.max && (!cfg.entero || Number.isInteger(d.valor)))) errores.push(`${ruta}: fuera de rango (${cfg.min}–${cfg.max} ${cfg.unidad})`);
      if (d.verificacion !== 'no_disponible' && d.fecha !== null && d.fecha !== undefined && !esFecha(d.fecha)) errores.push(`${ruta}: fecha inválida`);
    };
    for (const [c, cfg] of Object.entries(CAMPOS_NUMERICOS)) dato(p[c], `${r}.${c}`, cfg);
    dato(p.mercadoEspana, `${r}.mercadoEspana`, null);
    dato(p.integradoEnTreidilor, `${r}.integradoEnTreidilor`, null);
    if (!Array.isArray(p.categorias)) errores.push(`${r}.categorias debe ser una lista`);
  }
  return { ok: errores.length === 0, errores };
}

export function cargarDatasetAfiliacion(ruta = RUTA_PROGRAMAS_SIMULADO) {
  const ds = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  const v = validarDatasetAfiliacion(ds);
  if (!v.ok) throw new Error(`Datos de afiliación inválidos: ${v.errores.slice(0, 4).join(' | ')}`);
  return ds;
}

const fechaDato = (d) => (esDatoUtil(d) && esFecha(d.fecha) ? Date.parse(d.fecha) : null);
const ref = (d) => ({ valor: d.valor, verificacion: d.verificacion, fuente: d.fuente ?? null, fecha: d.fecha ?? null });
const NOMBRES = { comisionPct: 'comisión', cookieDias: 'duración de la cookie', pagoMinimoEur: 'pago mínimo', periodoPagoDias: 'periodo de pago', mercadoEspana: 'mercado España', integradoEnTreidilor: 'integrado en Treidilor' };

/** Frescura de un conjunto de datos de un programa (el dato MÁS ANTIGUO con fecha manda; sin fechas → «sin_fecha»). */
export function frescuraDelPrograma(p, ahora) {
  const fechas = Object.keys(CAMPOS_NUMERICOS).map((c) => fechaDato(p[c])).filter((x) => x !== null);
  if (!fechas.length) return { estado: 'sin_fecha', edadDias: null };
  const edad = Math.floor((ahora - Math.min(...fechas)) / DIA);
  return { estado: edad <= FRESCURA_DATOS_DIAS.vigente ? 'vigente' : edad <= FRESCURA_DATOS_DIAS.aActualizar ? 'a_actualizar' : 'solo_historico', edadDias: edad };
}

function hallazgosDe(p, ahora) {
  const out = [];
  for (const campo of [...Object.keys(CAMPOS_NUMERICOS), 'mercadoEspana']) {
    const d = p[campo];
    if (esDatoUtil(d)) out.push({ clave: `programa:${p.id}:${campo}`, regla: 'dato_declarado', certeza: null, prioridad: null, gravedad: null, elemento: p.id, evidencia: { campo, ...ref(d) }, accionSugerida: d.verificacion === 'verificado' ? null : 'Contrastar con la documentación pública vigente de la red antes de decidir' });
    else out.push({ clave: `programa:${p.id}:${campo}`, regla: 'dato_ausente', certeza: null, prioridad: null, gravedad: null, elemento: p.id, evidencia: { campo, valor: null, verificacion: 'no_disponible', fuente: null, fecha: null }, accionSugerida: `No consta ${NOMBRES[campo]}: obtenerlo de la documentación pública (revisión humana)` });
  }
  for (const [i, c] of (p.condiciones || []).entries()) out.push({ clave: `programa:${p.id}:condicion:${i + 1}`, regla: 'condicion_declarada', certeza: null, prioridad: null, gravedad: null, elemento: p.id, evidencia: { texto: String(c.texto).slice(0, 200), fuente: c.fuente ?? null, fecha: c.fecha ?? null }, accionSugerida: null });
  for (const [i, r] of (p.restricciones || []).entries()) out.push({ clave: `programa:${p.id}:restriccion:${i + 1}`, regla: 'restriccion_declarada', certeza: null, prioridad: null, gravedad: null, elemento: p.id, evidencia: { texto: String(r).slice(0, 200) }, accionSugerida: null });
  const f = frescuraDelPrograma(p, ahora);
  if (f.estado !== 'vigente') out.push({ clave: `programa:${p.id}:frescura`, regla: 'datos_no_vigentes', certeza: null, prioridad: null, gravedad: null, elemento: p.id, evidencia: { estado: f.estado, edadDias: f.edadDias }, accionSugerida: 'Actualizar los datos del programa antes de decidir' });
  return out;
}

function sobre({ ds, capacidad, programas, hallazgos, resumenExtra, limitaciones, ahora, idEjecucion }) {
  const fechas = programas.flatMap((p) => Object.keys(CAMPOS_NUMERICOS).map((c) => fechaDato(p[c]))).filter((x) => x !== null);
  const generadoEn = new Date(fechas.length ? Math.max(...fechas) : Date.parse(ds.capturadoEn)).toISOString();
  const completos = programas.every((p) => esDatoUtil(p.comisionPct) && esDatoUtil(p.cookieDias));
  return {
    esquema: ESQUEMA_INFORME_AGENTE, agente: '02', capacidad, version: '0.1.0', entorno: 'local', idEjecucion, generadoEn, completo: completos,
    fuente: { sistema: 'dataset_local', tabla: 'afiliacion_programas', host: null, registrosLeidos: programas.length, origenDatos: ds.sintetico ? 'datos_de_prueba' : 'exportacion', origenEjecucion: 'local', firma: sha256(canonico(ds.programas)) },
    resumen: { estadoCalidad: completos ? 'completa' : 'incompleta', incidencias: hallazgos.filter((h) => h.regla === 'dato_ausente').length, porGravedad: { critica: 0, alta: 0, media: 0, baja: 0, info: 0 }, porCerteza: null, porPrioridad: null, elementosAfectados: programas.filter((p) => !(esDatoUtil(p.comisionPct) && esDatoUtil(p.cookieDias))).length, elementosTotales: programas.length, ...resumenExtra },
    hallazgos, seguimiento: null, persistencia: { escritura: 'no_procede' },
    limitaciones: [...limitaciones, ...(ds.sintetico ? ['DATOS DE PRUEBA: no son comisiones, cookies ni condiciones reales de ningún programa.'] : [])],
    honestidad: { datosAusentesDeclarados: true },
  };
}
const idEj = (capacidad, ds, extra) => `af-${createHash('sha256').update(canonico({ capacidad, firma: ds.programas, extra })).digest('hex').slice(0, 10)}`;

/**
 * Compara programas. Ranking SOLO con los que tienen comisión declarada (verificada o estimada); el resto va en `sinComision` («no consta»).
 * Criterio explícito y limitado: comisión declarada; desempate por cookie y nombre. NO incluye tasa de conversión ni ticket medio (no constan).
 * Devuelve { informe, ranking, sinComision, propuestas }.
 */
export function compararProgramas(ds, { categoria = null, soloIntegrados = false, ahora = Date.now() } = {}) {
  const candidatos = ds.programas.filter((p) => (!categoria || (p.categorias || []).includes(categoria)) && (!soloIntegrados || (esDatoUtil(p.integradoEnTreidilor) && p.integradoEnTreidilor.valor === true)));
  const conCom = candidatos.filter((p) => esDatoUtil(p.comisionPct));
  const ranking = conCom.map((p) => ({ id: p.id, nombre: p.nombre, comisionPct: ref(p.comisionPct), cookieDias: esDatoUtil(p.cookieDias) ? ref(p.cookieDias) : null, mercadoEspana: esDatoUtil(p.mercadoEspana) ? p.mercadoEspana.valor : null, frescura: frescuraDelPrograma(p, ahora), integrado: esDatoUtil(p.integradoEnTreidilor) ? p.integradoEnTreidilor.valor : null }))
    .sort((a, b) => b.comisionPct.valor - a.comisionPct.valor || (b.cookieDias ? b.cookieDias.valor : -1) - (a.cookieDias ? a.cookieDias.valor : -1) || a.id.localeCompare(b.id));
  const sinComision = candidatos.filter((p) => !esDatoUtil(p.comisionPct)).map((p) => ({ id: p.id, nombre: p.nombre, motivo: 'no consta la comisión' }));
  const hallazgos = candidatos.flatMap((p) => hallazgosDe(p, ahora));
  const propuestas = [];
  if (ranking.length) propuestas.push({ texto: `Con los datos disponibles, «${ranking[0].nombre}» declara la mayor comisión (${ranking[0].comisionPct.valor} %, ${ranking[0].comisionPct.verificacion}); no incluye conversión ni ticket medio, así que no implica más ingresos reales.`, requiereAutorizacion: false, accionAutomatica: false });
  if (ranking.some((r) => r.integrado === false)) propuestas.push({ texto: 'Alguno de los programas mejor situados no está integrado en Treidilor: integrarlo o darse de alta es una acción L4 que ejecuta una persona (el agente no se da de alta ni toca conectores).', requiereAutorizacion: true, accionAutomatica: false });
  for (const [i, pr] of propuestas.entries()) hallazgos.push({ clave: `propuesta:${i + 1}`, regla: 'propuesta', certeza: null, prioridad: null, gravedad: null, elemento: null, evidencia: { texto: pr.texto, requiereAutorizacion: pr.requiereAutorizacion }, accionSugerida: pr.requiereAutorizacion ? 'Decisión del propietario (L4, humano)' : null });
  const informe = sobre({ ds, capacidad: '02.comparar-programas', programas: candidatos, hallazgos, resumenExtra: { enRanking: ranking.length, sinComision: sinComision.length }, limitaciones: ['El ranking solo ordena por la comisión DECLARADA; no incorpora tasa de conversión, ticket medio, estacionalidad ni la fiabilidad del pago, que no constan.', sinComision.length ? `Sin comisión disponible (no entran en el ranking): ${sinComision.map((s) => s.nombre).join(', ')}.` : 'Todos los programas considerados tienen comisión declarada.', ...(ranking.some((r) => !r.comisionPct.fecha) ? [`${ranking.filter((r) => !r.comisionPct.fecha).length} comisión(es) SIN FECHA: no cumplen la regla de la ficha (fuente y fecha); tómalas como orientativas.`] : [])], ahora, idEjecucion: idEj('comparar', ds, { categoria, soloIntegrados }) });
  return { informe, ranking, sinComision, propuestas };
}

/** Estudia un programa concreto: perfil con procedencia, huecos de datos y frescura. Devuelve { informe, programa, huecos } o { informe:null, motivo }. */
export function estudiarPrograma(ds, id, { ahora = Date.now() } = {}) {
  const p = ds.programas.find((x) => x.id === String(id).toLowerCase());
  if (!p) return { informe: null, motivo: 'programa_no_encontrado', disponibles: ds.programas.map((x) => x.id) };
  const hallazgos = hallazgosDe(p, ahora);
  const huecos = hallazgos.filter((h) => h.regla === 'dato_ausente').map((h) => h.evidencia.campo);
  const informe = sobre({ ds, capacidad: '02.estudiar-programa-afiliacion', programas: [p], hallazgos, resumenExtra: { huecos: huecos.length }, limitaciones: [huecos.length ? `No consta: ${huecos.map((c) => NOMBRES[c]).join(', ')}.` : 'Sin huecos en los campos básicos.', ...(esDatoUtil(p.comisionPct) && !p.comisionPct.fecha ? ['La comisión no tiene fecha: no cumple la regla de la ficha (fuente y fecha); tómala como orientativa.'] : []), 'Las condiciones listadas son las declaradas en los datos; la documentación vigente de la red es la fuente de verdad y debe revisarla una persona antes de decidir.'], ahora, idEjecucion: idEj('estudiar', ds, { id: p.id }) });
  return { informe, programa: { id: p.id, nombre: p.nombre, tipo: p.tipo, integrado: esDatoUtil(p.integradoEnTreidilor) ? p.integradoEnTreidilor.valor : null, categorias: p.categorias, frescura: frescuraDelPrograma(p, ahora) }, huecos };
}
