/**
 * TREIDILOR — CACHÉ AUXILIAR DE METADATOS «DIRECTOR IA».
 *
 * El historial conversacional del Director vive en el servicio persistente
 * (Canal 13 + Director 00) y es la fuente de verdad. Este almacén NO duplica
 * mensajes: solo guarda metadatos ligeros de la conversación principal de cada
 * usuario (id de la conversación del Director, título derivado y fechas) para
 * reconstruir el menú lateral sin consultar al Director en cada carga.
 *
 * Guardado en <DATA_DIR>/director-ia-conversaciones.json (volumen persistente),
 * escritura atómica con .bak. El fichero dañado o de esquema más nuevo NO se
 * sobrescribe.
 *
 * Estructura:
 *   {
 *     version: 1,
 *     actualizadoEn: ISO,
 *     conversaciones: [ { id, userId, titulo, creadoEn, actualizadoEn } ]
 *   }
 *
 * Solo se usa desde los endpoints de API del panel (servidor). El navegador
 * nunca accede directamente al fichero.
 */

import fs from 'node:fs';
import path from 'node:path';
import { dataFile } from './paths';
import { randomBytes } from 'node:crypto';

const NOMBRE_FICHERO = 'director-ia-conversaciones.json';
const ESQUEMA_VERSION = 1;
const MAX_CONVERSACIONES_POR_USUARIO = 50;
const TAM_MAX_FICHERO_BYTES = 2_000_000; // 2 MB

export interface ConversacionMeta {
  id: string;
  userId: string;
  titulo: string;
  creadoEn: string;
  actualizadoEn: string;
}

interface ConversacionesFile {
  version: number;
  actualizadoEn: string;
  conversaciones: ConversacionMeta[];
}

function idAleatorio(): string {
  return `${randomBytes(6).toString('hex')}-${randomBytes(4).toString('hex')}`;
}

function ahoraIso(): string {
  return new Date().toISOString();
}

/** Ruta absoluta del almacén (fuera del repositorio y de rutas públicas). */
export function rutaConversaciones(): string {
  return dataFile(NOMBRE_FICHERO);
}

/** Escribe atómicamente: .tmp + renombrado, con .bak del previo. */
function escribirAtomicamente(contenido: string, ruta: string): void {
  const dir = path.dirname(ruta);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = ruta + `.tmp-${process.pid}`;
  const bak = ruta + '.bak';
  fs.writeFileSync(tmp, contenido, 'utf8');
  if (fs.existsSync(ruta)) {
    try { fs.copyFileSync(ruta, bak); } catch { /* si no se puede hacer backup, se sigue */ }
    fs.renameSync(tmp, ruta);
  } else {
    fs.renameSync(tmp, ruta);
  }
}

/** Lee el almacén. Devuelve vacío si no existe o está dañado/esquema nuevo. */
function leerAlmacen(): ConversacionesFile {
  const ruta = rutaConversaciones();
  if (!fs.existsSync(ruta)) {
    return { version: ESQUEMA_VERSION, actualizadoEn: ahoraIso(), conversaciones: [] };
  }
  let raw: string;
  try { raw = fs.readFileSync(ruta, 'utf8'); } catch { return { version: ESQUEMA_VERSION, actualizadoEn: ahoraIso(), conversaciones: [] }; }
  if (!raw.trim()) return { version: ESQUEMA_VERSION, actualizadoEn: ahoraIso(), conversaciones: [] };
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch {
    // Fichero dañado: no se sobrescribe, se conserva para diagnóstico.
    return { version: ESQUEMA_VERSION, actualizadoEn: ahoraIso(), conversaciones: [] };
  }
  if (!parsed || parsed.version !== ESQUEMA_VERSION || !Array.isArray(parsed.conversaciones)) {
    // Esquema desconocido o más nuevo: no se toca.
    return { version: ESQUEMA_VERSION, actualizadoEn: ahoraIso(), conversaciones: [] };
  }
  return parsed as ConversacionesFile;
}

function guardarAlmacen(datos: ConversacionesFile): void {
  datos.actualizadoEn = ahoraIso();
  const contenido = JSON.stringify(datos, null, 2);
  if (Buffer.byteLength(contenido) > TAM_MAX_FICHERO_BYTES) {
    throw new Error('almacen_demasiado_grande');
  }
  escribirAtomicamente(contenido, rutaConversaciones());
}

/** Título derivado del primer mensaje del usuario (máx. 60 chars). */
function tituloPorDefecto(contenido: string): string {
  const t = String(contenido).replace(/\s+/g, ' ').trim().slice(0, 60);
  return t || 'Conversación nueva';
}

/** Guarda/actualiza los metadatos de una conversación (caché auxiliar). */
export function guardarConversacionPrincipal(userId: string, conversacionId: string, textoUsuario: string): ConversacionMeta {
  const datos = leerAlmacen();
  const ahora = ahoraIso();
  let existente = datos.conversaciones.find((c) => c.userId === userId && c.id === conversacionId);
  if (existente) {
    existente.actualizadoEn = ahora;
  } else {
    existente = { id: conversacionId, userId, titulo: tituloPorDefecto(textoUsuario), creadoEn: ahora, actualizadoEn: ahora };
    datos.conversaciones.push(existente);
    recortarConversaciones(datos, userId);
  }
  guardarAlmacen(datos);
  return existente;
}

/** Devuelve los metadatos de una conversación de un userId (caché, sin mensajes). */
export function obtenerConversacionMeta(id: string, userId: string): ConversacionMeta | null {
  const datos = leerAlmacen();
  const c = datos.conversaciones.find((x) => x.id === id && x.userId === userId);
  return c ?? null;
}

/** Lista las conversaciones de un usuario (sin mensajes; para el menú lateral). */
export function listarConversaciones(userId: string): Array<Pick<ConversacionMeta, 'id' | 'titulo' | 'creadoEn' | 'actualizadoEn'>> {
  const datos = leerAlmacen();
  return datos.conversaciones
    .filter((c) => c.userId === userId)
    .map(({ id, titulo, creadoEn, actualizadoEn }) => ({ id, titulo, creadoEn, actualizadoEn }))
    .sort((a, b) => b.actualizadoEn.localeCompare(a.actualizadoEn));
}

/** Crea una conversación con el primer mensaje del usuario (guarda metadatos en caché). */
export function crearConversacion(userId: string, textoUsuario: string): ConversacionMeta {
  const id = idAleatorio();
  return guardarConversacionPrincipal(userId, id, textoUsuario);
}

/** Registra actividad en una conversación existente (solo metadatos; no duplica mensajes). */
export function tocarConversacion(id: string, userId: string, textoUsuario?: string): ConversacionMeta | null {
  const datos = leerAlmacen();
  const idx = datos.conversaciones.findIndex((x) => x.id === id && x.userId === userId);
  if (idx === -1) return null;
  const c = datos.conversaciones[idx];
  c.actualizadoEn = ahoraIso();
  if (textoUsuario && c.titulo === tituloPorDefecto('')) c.titulo = tituloPorDefecto(textoUsuario);
  datos.conversaciones[idx] = c;
  guardarAlmacen(datos);
  return c;
}

/** Elimina una conversación de un usuario (solo del caché auxiliar). */
export function eliminarConversacion(id: string, userId: string): boolean {
  const datos = leerAlmacen();
  const idx = datos.conversaciones.findIndex((x) => x.id === id && x.userId === userId);
  if (idx === -1) return false;
  datos.conversaciones.splice(idx, 1);
  guardarAlmacen(datos);
  return true;
}

/** Devuelve el recuento de conversaciones de un usuario. */
export function contarConversaciones(userId: string): number {
  return leerAlmacen().conversaciones.filter((c) => c.userId === userId).length;
}

function recortarConversaciones(datos: ConversacionesFile, userId: string): void {
  const delUsuario = datos.conversaciones.filter((c) => c.userId === userId);
  if (delUsuario.length <= MAX_CONVERSACIONES_POR_USUARIO) return;
  const ordenadas = [...delUsuario].sort((a, b) => a.actualizadoEn.localeCompare(b.actualizadoEn));
  const aEliminar = new Set(ordenadas.slice(0, delUsuario.length - MAX_CONVERSACIONES_POR_USUARIO).map((c) => c.id));
  datos.conversaciones = datos.conversaciones.filter((c) => c.userId !== userId || !aEliminar.has(c.id));
}
