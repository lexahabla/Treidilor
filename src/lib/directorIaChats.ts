/**
 * TREIDILOR — CHATS Y PROYECTOS DEL PANEL «DIRECTOR IA» (solo METADATOS).
 *
 * Cada chat es una conversación PROPIA del Director 00 (`cv_…`): el Director es la fuente de verdad de los mensajes, de la memoria y del
 * contexto de cada conversación (no se mezclan historiales). Aquí solo se guarda lo que necesita la interfaz: título, proyecto, archivado,
 * papelera y fechas. La conversación PRINCIPAL (la de Telegram) queda fijada: no se puede archivar ni eliminar desde el panel.
 *
 * Eliminar = PAPELERA (recuperable 30 días); pasado ese plazo se olvida su ficha en el panel. El historial del Director NO se borra
 * desde aquí (su ledger es de solo añadir): quitarlo exige una orden expresa del propietario en el Director.
 *
 * Archivo: <DATA_DIR>/director-ia-chats.json (escritura atómica con .bak; un archivo dañado o de esquema más nuevo NO se sobrescribe).
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { dataFile } from './paths';

const NOMBRE = 'director-ia-chats.json';
const ESQUEMA = 1;
export const LIMITES_CHATS = Object.freeze({ chats: 500, proyectos: 50, titulo: 80, instrucciones: 4000, papeleraDias: 30, bytes: 3_000_000 });
export const ID_CONVERSACION_RE = /^cv_[0-9a-f]{16}$/;
const ID_PROYECTO_RE = /^pr_[0-9a-f]{12}$/;

export interface Chat { id: string; userId: string; titulo: string; proyectoId: string | null; principal: boolean; archivada: boolean; eliminadaEn: string | null; creadoEn: string; actualizadoEn: string; /** Confidencial: nada sale hacia modelos ni servicios de voz externos (Director ≥ 1.3.4). Desactivado por defecto. */ confidencial?: boolean }
export interface Proyecto { id: string; userId: string; nombre: string; instrucciones: string; creadoEn: string; actualizadoEn: string }
interface Archivo { version: number; actualizadoEn: string; chats: Chat[]; proyectos: Proyecto[] }

export class ErrorChats extends Error { constructor(public codigo: string, public status: number, mensaje: string) { super(mensaje); } }
const ahora = () => new Date().toISOString();
const vacio = (): Archivo => ({ version: ESQUEMA, actualizadoEn: ahora(), chats: [], proyectos: [] });
export const rutaChats = () => dataFile(NOMBRE);
/** Texto de una línea, sin caracteres de control, acotado. */
export function textoLimpio(v: unknown, max: number): string { return String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }

function leer(): Archivo {
  const ruta = rutaChats();
  if (!fs.existsSync(ruta)) return vacio();
  let j: any; try { j = JSON.parse(fs.readFileSync(ruta, 'utf8')); } catch { throw new ErrorChats('almacen_ilegible', 500, 'El archivo de chats está dañado: no se modifica.'); }
  if (!j || j.version !== ESQUEMA || !Array.isArray(j.chats) || !Array.isArray(j.proyectos)) throw new ErrorChats('almacen_ilegible', 500, 'Esquema de chats no reconocido: no se modifica.');
  return j as Archivo;
}
function guardar(a: Archivo): void {
  a.actualizadoEn = ahora();
  const texto = `${JSON.stringify(a, null, 2)}\n`;
  if (Buffer.byteLength(texto) > LIMITES_CHATS.bytes) throw new ErrorChats('almacen_lleno', 507, 'El índice de chats ha alcanzado su tamaño máximo.');
  const ruta = rutaChats(); fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const tmp = `${ruta}.tmp-${process.pid}`; fs.writeFileSync(tmp, texto, { mode: 0o600 });
  if (fs.existsSync(ruta)) { try { fs.copyFileSync(ruta, `${ruta}.bak`); } catch { /* sin copia previa */ } }
  fs.renameSync(tmp, ruta);
}
/** Quita de la papelera lo que lleva más de 30 días (solo la ficha del panel). */
function purgar(a: Archivo): boolean {
  const limite = Date.now() - LIMITES_CHATS.papeleraDias * 86_400_000; const antes = a.chats.length;
  a.chats = a.chats.filter((c) => !c.eliminadaEn || Date.parse(c.eliminadaEn) > limite); return a.chats.length !== antes;
}
const delUsuario = (a: Archivo, userId: string) => a.chats.filter((c) => c.userId === userId);
function chatDe(a: Archivo, userId: string, id: string): Chat {
  const c = a.chats.find((x) => x.userId === userId && x.id === id); if (!c) throw new ErrorChats('chat_desconocido', 404, 'No existe ese chat.'); return c;
}
function proyectoDe(a: Archivo, userId: string, id: string): Proyecto {
  const p = a.proyectos.find((x) => x.userId === userId && x.id === id); if (!p) throw new ErrorChats('proyecto_desconocido', 404, 'No existe ese proyecto.'); return p;
}

/** Lista para la barra lateral (incluye archivados y papelera, marcados). */
export function listarChats(userId: string): { chats: Chat[]; proyectos: Proyecto[] } {
  const a = leer(); if (purgar(a)) guardar(a);
  return { chats: delUsuario(a, userId).sort((x, y) => Number(y.principal) - Number(x.principal) || y.actualizadoEn.localeCompare(x.actualizadoEn)), proyectos: a.proyectos.filter((p) => p.userId === userId).sort((x, y) => x.nombre.localeCompare(y.nombre, 'es')) };
}
/** Registra la conversación principal (Telegram) como chat fijado. Idempotente. */
export function asegurarPrincipal(userId: string, id: string): Chat {
  if (!ID_CONVERSACION_RE.test(id)) throw new ErrorChats('conversacion_invalida', 400, 'Identificador de conversación no válido.');
  const a = leer(); let c = a.chats.find((x) => x.userId === userId && x.id === id);
  for (const x of delUsuario(a, userId)) if (x.principal && x.id !== id) x.principal = false; // la principal puede cambiar (p. ej. tras «conversacion-nueva»)
  if (!c) { const t = ahora(); c = { id, userId, titulo: 'Principal · Telegram', proyectoId: null, principal: true, archivada: false, eliminadaEn: null, creadoEn: t, actualizadoEn: t }; a.chats.push(c); }
  else { c.principal = true; c.archivada = false; c.eliminadaEn = null; }
  guardar(a); return c;
}
/** Registra un chat nuevo (la conversación ya la creó el Director). */
export function registrarChat(userId: string, id: string, { titulo = 'Chat nuevo', proyectoId = null }: { titulo?: string; proyectoId?: string | null } = {}): Chat {
  if (!ID_CONVERSACION_RE.test(id)) throw new ErrorChats('conversacion_invalida', 400, 'Identificador de conversación no válido.');
  const a = leer(); purgar(a);
  if (a.chats.some((x) => x.userId === userId && x.id === id)) return chatDe(a, userId, id);
  if (delUsuario(a, userId).length >= LIMITES_CHATS.chats) throw new ErrorChats('demasiados_chats', 409, `Máximo ${LIMITES_CHATS.chats} chats: archiva o elimina alguno.`);
  if (proyectoId) proyectoDe(a, userId, proyectoId);
  const t = ahora(); const c: Chat = { id, userId, titulo: textoLimpio(titulo, LIMITES_CHATS.titulo) || 'Chat nuevo', proyectoId, principal: false, archivada: false, eliminadaEn: null, creadoEn: t, actualizadoEn: t };
  a.chats.push(c); guardar(a); return c;
}
/** ¿Puede este usuario usar esta conversación? (registrada y no en la papelera). */
export function chatPermitido(userId: string, id: string): Chat | null {
  if (!ID_CONVERSACION_RE.test(id)) return null;
  let a: Archivo; try { a = leer(); } catch { return null; }
  const c = a.chats.find((x) => x.userId === userId && x.id === id); return c && !c.eliminadaEn ? c : null;
}
/** Actividad: fecha y, si aún es «Chat nuevo», título a partir del primer mensaje. */
export function tocarChat(userId: string, id: string, textoUsuario = ''): void {
  try { const a = leer(); const c = a.chats.find((x) => x.userId === userId && x.id === id); if (!c) return; c.actualizadoEn = ahora(); if (c.titulo === 'Chat nuevo' && textoUsuario.trim()) c.titulo = textoLimpio(textoUsuario, 60); guardar(a); } catch { /* solo metadatos */ }
}

export type AccionChat = { accion: 'renombrar'; id: string; titulo: string } | { accion: 'mover'; id: string; proyectoId: string | null } | { accion: 'archivar' | 'desarchivar' | 'eliminar' | 'restaurar'; id: string } | { accion: 'confidencial'; id: string; valor: boolean };
export function modificarChat(userId: string, o: AccionChat): Chat {
  const a = leer(); const c = chatDe(a, userId, o.id);
  if (c.principal && ['archivar', 'eliminar'].includes(o.accion)) throw new ErrorChats('principal_protegida', 409, 'La conversación principal (Telegram) no se puede archivar ni eliminar.');
  if (c.principal && o.accion === 'confidencial') throw new ErrorChats('principal_compartida', 409, 'La conversación principal se comparte con Telegram, que no aplica el modo confidencial: crea un chat aparte para lo confidencial.');
  switch (o.accion) {
    case 'renombrar': { const t = textoLimpio(o.titulo, LIMITES_CHATS.titulo); if (!t) throw new ErrorChats('titulo_invalido', 400, 'El título no puede quedar vacío.'); c.titulo = t; break; }
    case 'mover': if (o.proyectoId !== null && !ID_PROYECTO_RE.test(String(o.proyectoId))) throw new ErrorChats('proyecto_invalido', 400, 'Proyecto no válido.'); if (o.proyectoId) proyectoDe(a, userId, o.proyectoId); c.proyectoId = o.proyectoId; break;
    case 'archivar': c.archivada = true; break;
    case 'desarchivar': c.archivada = false; break;
    case 'eliminar': c.eliminadaEn = ahora(); break;
    case 'restaurar': c.eliminadaEn = null; break;
    case 'confidencial': if (typeof o.valor !== 'boolean') throw new ErrorChats('valor_invalido', 400, 'confidencial: true | false.'); c.confidencial = o.valor; break;
  }
  guardar(a); return c;
}

export function crearProyecto(userId: string, nombre: string, instrucciones = ''): Proyecto {
  const a = leer(); const n = textoLimpio(nombre, LIMITES_CHATS.titulo); if (!n) throw new ErrorChats('nombre_invalido', 400, 'El proyecto necesita un nombre.');
  if (a.proyectos.filter((p) => p.userId === userId).length >= LIMITES_CHATS.proyectos) throw new ErrorChats('demasiados_proyectos', 409, `Máximo ${LIMITES_CHATS.proyectos} proyectos.`);
  const t = ahora(); const p: Proyecto = { id: `pr_${randomBytes(6).toString('hex')}`, userId, nombre: n, instrucciones: String(instrucciones ?? '').slice(0, LIMITES_CHATS.instrucciones), creadoEn: t, actualizadoEn: t };
  a.proyectos.push(p); guardar(a); return p;
}
export function modificarProyecto(userId: string, id: string, cambios: { nombre?: unknown; instrucciones?: unknown }): Proyecto {
  const a = leer(); const p = proyectoDe(a, userId, id);
  if (cambios.nombre !== undefined) { const n = textoLimpio(cambios.nombre, LIMITES_CHATS.titulo); if (!n) throw new ErrorChats('nombre_invalido', 400, 'El proyecto necesita un nombre.'); p.nombre = n; }
  if (cambios.instrucciones !== undefined) p.instrucciones = String(cambios.instrucciones ?? '').replace(/\u0000/g, '').slice(0, LIMITES_CHATS.instrucciones);
  p.actualizadoEn = ahora(); guardar(a); return p;
}
/** Elimina el proyecto; sus chats quedan «sin proyecto» (no se borra ninguna conversación). */
export function eliminarProyecto(userId: string, id: string): number {
  const a = leer(); proyectoDe(a, userId, id); let n = 0;
  for (const c of delUsuario(a, userId)) if (c.proyectoId === id) { c.proyectoId = null; n += 1; }
  a.proyectos = a.proyectos.filter((p) => !(p.userId === userId && p.id === id)); guardar(a); return n;
}
