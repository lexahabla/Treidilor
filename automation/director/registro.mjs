/**
 * Agente 00 · F1.1 · REGISTRO DE AGENTES Y CAPACIDADES (`registro-agentes/1`). El Director solo LEE: aquí no hay ninguna función que escriba.
 * Valida la coherencia del registro (nivel ↔ modo ↔ efectos ↔ aprobación) y decide qué capacidades se pueden ASIGNAR ahora.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODOS, NIVELES, canonico, sha256 } from './protocolo.mjs';
import { nivelIndice, requiereAprobacion } from './permisos.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const RUTA_REGISTRO_V1 = path.join(AQUI, 'registro-agentes.v1.json');
export const ESTADOS_AGENTE = ['planificado', 'construido_local', 'operativo', 'pausado', 'retirado'];
export const ORIGENES_ESTADO = ['documentado', 'verificado', 'comunicado'];
export const DISPONIBILIDADES = ['lectura_f1', 'propuesta_f1', 'simulacion_local', 'requiere_f3', 'planificada'];
export const EFECTOS = ['ninguno', 'lectura_con_carga', 'escritura_reversible', 'irreversible'];

/** Coherencia exigida por la matriz: el nivel mínimo que implican el modo y los efectos; nunca por debajo. */
function nivelMinimoPorEfectos(cap) {
  if (cap.efectos === 'irreversible') return 'L4';
  if (cap.efectos === 'escritura_reversible') return 'L3';
  if (cap.efectos === 'lectura_con_carga' || cap.modo === 'accion') return 'L2';
  if (cap.modo === 'propuesta') return 'L1';
  return 'L0';
}

/** `{ ok, errores:[texto] }`; no lanza. */
export function validarRegistro(reg) {
  const errores = [];
  if (!reg || typeof reg !== 'object') return { ok: false, errores: ['El registro no es un objeto.'] };
  if (reg.registro !== 'registro-agentes/1') errores.push('registro debe ser registro-agentes/1.');
  if (!Array.isArray(reg.agentes) || !Array.isArray(reg.capacidades)) return { ok: false, errores: [...errores, 'Faltan agentes o capacidades.'] };
  const ids = new Set();
  for (const a of reg.agentes) {
    if (!/^\d{2}$/.test(a.id || '')) errores.push(`Agente con id inválido (${a.id}).`);
    if (ids.has(a.id)) errores.push(`Agente ${a.id} duplicado.`);
    ids.add(a.id);
    if (!ESTADOS_AGENTE.includes(a.estado)) errores.push(`Agente ${a.id}: estado «${a.estado}» no permitido.`);
    if (!ORIGENES_ESTADO.includes(a.origenEstado)) errores.push(`Agente ${a.id}: origen del estado «${a.origenEstado}» no permitido.`);
    if (a.credencial && /(sk-|Bearer|tai_[0-9a-f]{8})/.test(String(a.credencial))) errores.push(`Agente ${a.id}: la credencial debe ir por NOMBRE, nunca por valor.`);
  }
  const caps = new Set();
  for (const c of reg.capacidades) {
    if (!/^\d{2}\.[a-z0-9-]+$/.test(c.id || '')) errores.push(`Capacidad con id inválido (${c.id}).`);
    if (caps.has(c.id)) errores.push(`Capacidad ${c.id} duplicada.`);
    caps.add(c.id);
    if (!ids.has(c.agente) || !String(c.id).startsWith(`${c.agente}.`)) errores.push(`Capacidad ${c.id}: agente ${c.agente} inexistente o incoherente con el id.`);
    if (!MODOS.includes(c.modo)) errores.push(`Capacidad ${c.id}: modo inválido.`);
    if (!NIVELES.includes(c.nivelRiesgo)) errores.push(`Capacidad ${c.id}: nivel inválido.`);
    if (!EFECTOS.includes(c.efectos)) errores.push(`Capacidad ${c.id}: efectos inválidos.`);
    if (!DISPONIBILIDADES.includes(c.disponibilidad)) errores.push(`Capacidad ${c.id}: disponibilidad inválida.`);
    if (!Array.isArray(c.alcances)) errores.push(`Capacidad ${c.id}: alcances debe ser una lista.`);
    if (!Number.isInteger(c.plazoMs) || c.plazoMs <= 0) errores.push(`Capacidad ${c.id}: plazoMs inválido.`);
    if (NIVELES.includes(c.nivelRiesgo) && EFECTOS.includes(c.efectos)) {
      if (nivelIndice(c.nivelRiesgo) < nivelIndice(nivelMinimoPorEfectos(c))) errores.push(`Capacidad ${c.id}: el nivel ${c.nivelRiesgo} es inferior al que exigen su modo y efectos (${nivelMinimoPorEfectos(c)}); el nivel no se puede bajar.`);
      if (requiereAprobacion(c.nivelRiesgo) !== Boolean(c.requiereAprobacion)) errores.push(`Capacidad ${c.id}: requiereAprobacion no coincide con el nivel ${c.nivelRiesgo}.`);
      if (!requiereAprobacion(c.nivelRiesgo) && c.modo === 'accion') errores.push(`Capacidad ${c.id}: una acción no puede ser L0/L1.`);
      if (requiereAprobacion(c.nivelRiesgo) && (!c.verificacion || c.verificacion === '—')) errores.push(`Capacidad ${c.id}: una capacidad L2–L4 debe declarar cómo se verifica su resultado.`);
    }
    if (['lectura_f1', 'propuesta_f1', 'simulacion_local'].includes(c.disponibilidad) && !c.frescura) errores.push(`Capacidad ${c.id}: una consulta de estado debe declarar su frescura.`);
  }
  return { ok: errores.length === 0, errores };
}

/** Carga y valida un registro. Lanza si es inválido (un registro roto no se usa a medias). */
export function cargarRegistro(ruta = RUTA_REGISTRO_V1) {
  const crudo = fs.readFileSync(ruta, 'utf8');
  const datos = JSON.parse(crudo);
  const v = validarRegistro(datos);
  if (!v.ok) throw new Error(`Registro inválido: ${v.errores.join(' | ')}`);
  return crearRegistro(datos);
}

/** Vista de solo lectura sobre un registro ya validado (objetos congelados). */
export function crearRegistro(datos) {
  const v = validarRegistro(datos);
  if (!v.ok) throw new Error(`Registro inválido: ${v.errores.join(' | ')}`);
  const congelar = (x) => {
    if (x && typeof x === 'object' && !Object.isFrozen(x)) {
      Object.values(x).forEach(congelar);
      Object.freeze(x);
    }
    return x;
  };
  const copia = congelar(JSON.parse(JSON.stringify(datos)));
  const agentes = new Map(copia.agentes.map((a) => [a.id, a]));
  const capacidades = new Map(copia.capacidades.map((c) => [c.id, c]));
  return {
    version: copia.version,
    huella: sha256(canonico(copia)),
    datos: copia,
    agente: (id) => agentes.get(id) || null,
    buscarCapacidad: (id) => capacidades.get(id) || null,
    agentes: () => [...agentes.values()],
    capacidades: (filtro = () => true) => [...capacidades.values()].filter(filtro),
    capacidadesDe: (idAgente) => [...capacidades.values()].filter((c) => c.agente === idAgente),
  };
}

/**
 * ¿Puede el Director asignar ahora esta capacidad? Devuelve `{ ok, motivo?, codigo? }`.
 *  · el agente debe estar `operativo` o `construido_local` (si no, `agente_no_operativo`);
 *  · F1 solo ejecuta capacidades de lectura (`lectura_f1`); lo que exige envoltorio es de F3 y lo planificado no existe todavía.
 */
export function evaluarAsignacion(registro, capacidadId) {
  const cap = registro.buscarCapacidad(capacidadId);
  if (!cap) return { ok: false, codigo: 'capacidad_desconocida', motivo: `La capacidad «${capacidadId}» no está en el registro.` };
  const ag = registro.agente(cap.agente);
  if (!ag || !['operativo', 'construido_local'].includes(ag.estado)) return { ok: false, codigo: 'agente_no_operativo', motivo: `El agente ${cap.agente} está «${ag ? ag.estado : 'desconocido'}».`, capacidad: cap };
  if (cap.disponibilidad === 'planificada') return { ok: false, codigo: 'agente_no_operativo', motivo: cap.motivoNoDisponible || 'Capacidad planificada, aún no existe.', capacidad: cap };
  return { ok: true, capacidad: cap, ejecutableEnF1: ['lectura_f1', 'propuesta_f1', 'simulacion_local'].includes(cap.disponibilidad), motivoNoEjecutable: ['lectura_f1', 'propuesta_f1', 'simulacion_local'].includes(cap.disponibilidad) ? null : cap.motivoNoDisponible || 'Requiere F3.' };
}

/** Capacidades candidatas para una intención (por agente y modo), ordenadas por nivel y por id: asignación determinista. */
export function candidatas(registro, { agente = null, modo = null, soloEjecutablesF1 = false } = {}) {
  return registro
    .capacidades((c) => (agente === null || c.agente === agente) && (modo === null || c.modo === modo))
    .filter((c) => evaluarAsignacion(registro, c.id).ok && (!soloEjecutablesF1 || c.disponibilidad === 'lectura_f1'))
    .sort((a, b) => nivelIndice(a.nivelRiesgo) - nivelIndice(b.nivelRiesgo) || a.id.localeCompare(b.id));
}
