/**
 * TREIDILOR — ADJUNTOS DE LOS CHATS DEL DIRECTOR IA (separados del importador del catálogo: adjuntar NUNCA importa productos).
 *
 * Seguridad:
 *  · Tipo por CONTENIDO real (firma del archivo), no por el nombre: PNG, JPG, WebP, PDF, DOCX, XLSX (sin macros), CSV y TXT/MD/JSON en UTF-8.
 *    Un archivo cuyo contenido no coincide con su extensión, un ejecutable o un Office con macros se rechaza.
 *  · Límites: 10 MB por archivo, 8 por mensaje, 300 MB por propietario; ZIP de Office con ≤ 2 000 entradas y ≤ 60 MB descomprimidos (contra bombas ZIP).
 *  · Almacenamiento fuera de las rutas públicas: <DATA_DIR>/director-ia-adjuntos/<id>.bin + <id>.json (+ <id>.txt con el texto extraído), modo 0600;
 *    el nombre original solo se guarda como metadato saneado (nunca forma una ruta).
 *  · Extracción LOCAL (sin red ni proveedores): TXT/CSV/MD/JSON, XLSX (exceljs), DOCX (jszip), PDF (pdfjs-dist, sin evaluar código). Imágenes: se guardan
 *    y se ven, sin análisis visual. El texto extraído es solo DATO para el Director (no instrucciones).
 *  · Retención: mientras exista el chat; al purgarse el chat de la papelera (30 días) o al eliminar el adjunto, se borran sus archivos.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { dataFile } from './paths';

export const LIMITES_ADJUNTOS = Object.freeze({ bytesArchivo: 10 * 1024 * 1024, porMensaje: 8, bytesPropietario: 300 * 1024 * 1024, entradasZip: 2000, bytesZip: 60 * 1024 * 1024, caracteresTexto: 200_000, caracteresDirector: 60_000, paginasPdf: 300, filasHoja: 5000, nombre: 200 });
export type TipoAdjunto = 'png' | 'jpg' | 'webp' | 'pdf' | 'docx' | 'xlsx' | 'csv' | 'txt' | 'md' | 'json';
export const MIME: Record<TipoAdjunto, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv; charset=utf-8', txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8', json: 'application/json; charset=utf-8' };
const EXT: Record<string, TipoAdjunto[]> = { png: ['png'], jpg: ['jpg'], jpeg: ['jpg'], webp: ['webp'], pdf: ['pdf'], docx: ['docx'], xlsx: ['xlsx'], csv: ['csv', 'txt'], txt: ['txt', 'csv'], md: ['md', 'txt'], json: ['json', 'txt'] };
export const ID_ADJUNTO_RE = /^ad_[0-9a-f]{16}$/;

export interface Adjunto { id: string; userId: string; chatId: string; nombre: string; tipo: TipoAdjunto; mime: string; bytes: number; sha256: string; creadoEn: string; enviado: boolean;
  texto: { estado: 'ok' | 'truncado' | 'sin_texto' | 'no_disponible' | 'error'; caracteres: number; paginas?: number; hojas?: string[]; motivo?: string } }
export class ErrorAdjunto extends Error { constructor(public codigo: string, public status: number, mensaje: string) { super(mensaje); } }

const carpeta = () => dataFile('director-ia-adjuntos');
const ruta = (id: string, ext: 'bin' | 'json' | 'txt') => { if (!ID_ADJUNTO_RE.test(id)) throw new ErrorAdjunto('adjunto_invalido', 400, 'Identificador de adjunto no válido.'); return path.join(carpeta(), `${id}.${ext}`); };
export function nombreSeguro(n: unknown): string { const s = String(n ?? '').normalize('NFC').replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_').replace(/^\.+/, '').trim().slice(0, LIMITES_ADJUNTOS.nombre); return s || 'archivo'; }
const extension = (n: string) => (/\.([a-z0-9]{1,5})$/i.exec(n)?.[1] ?? '').toLowerCase();
const empieza = (b: Buffer, firma: number[]) => firma.every((x, i) => b[i] === x);

/** Tipo por contenido; null = no admitido. Para ZIP (Office) mira su contenido. */
export async function detectarTipo(b: Buffer, nombre: string): Promise<TipoAdjunto | null> {
  const ext = extension(nombre);
  let tipo: TipoAdjunto | null = null;
  if (empieza(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) tipo = 'png';
  else if (empieza(b, [0xff, 0xd8, 0xff])) tipo = 'jpg';
  else if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') tipo = 'webp';
  else if (b.subarray(0, 5).toString('latin1') === '%PDF-') tipo = 'pdf';
  else if (empieza(b, [0x50, 0x4b, 0x03, 0x04])) tipo = await tipoOffice(b);
  else if (!b.includes(0) && esUtf8(b)) tipo = (EXT[ext]?.[0] as TipoAdjunto) ?? 'txt';
  if (!tipo) return null;
  // la extensión debe ser coherente con el contenido (un .pdf que en realidad es otra cosa se rechaza)
  if (ext && EXT[ext] && !EXT[ext].includes(tipo)) return null;
  if (ext && !EXT[ext]) return null;
  return tipo;
}
function esUtf8(b: Buffer): boolean { try { new TextDecoder('utf-8', { fatal: true }).decode(b); return true; } catch { return false; } }
async function abrirZip(b: Buffer): Promise<any> {
  const JSZip = (await import('jszip')).default as any; const zip = await JSZip.loadAsync(b, { checkCRC32: false });
  const entradas = Object.values(zip.files) as any[];
  if (entradas.length > LIMITES_ADJUNTOS.entradasZip) throw new ErrorAdjunto('zip_sospechoso', 400, 'El documento tiene demasiadas partes internas.');
  const total = entradas.reduce((n, f) => n + Number(f._data?.uncompressedSize ?? 0), 0);
  if (total > LIMITES_ADJUNTOS.bytesZip) throw new ErrorAdjunto('zip_sospechoso', 400, 'El documento se expande a un tamaño excesivo.');
  return zip;
}
async function tipoOffice(b: Buffer): Promise<TipoAdjunto | null> {
  const zip = await abrirZip(b); const nombres = Object.keys(zip.files);
  if (nombres.some((n) => /vbaProject\.bin$/i.test(n))) throw new ErrorAdjunto('macros_no_admitidas', 400, 'Los documentos con macros no se admiten.');
  if (nombres.includes('word/document.xml')) return 'docx';
  if (nombres.includes('xl/workbook.xml')) return 'xlsx';
  return null;
}

const decodificarXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');
async function textoDocx(b: Buffer): Promise<string> {
  const zip = await abrirZip(b); const xml: string = await zip.file('word/document.xml').async('string');
  return decodificarXml(xml.replace(/<w:tab\/>/g, '\t').replace(/<w:br[^>]*\/>/g, '\n').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '')).replace(/\n{3,}/g, '\n\n').trim();
}
async function textoXlsx(b: Buffer): Promise<{ texto: string; hojas: string[] }> {
  const ExcelJS = (await import('exceljs')).default as any; const wb = new ExcelJS.Workbook(); await wb.xlsx.load(b);
  const partes: string[] = []; const hojas: string[] = [];
  wb.eachSheet((ws: any) => {
    hojas.push(String(ws.name).slice(0, 80)); partes.push(`## Hoja: ${String(ws.name).replace(/\n/g, ' ').slice(0, 80)}`); let n = 0;
    ws.eachRow({ includeEmpty: false }, (row: any) => {
      if (n++ >= LIMITES_ADJUNTOS.filasHoja) return;
      const celdas = (row.values as any[]).slice(1).map((v) => { const x = v && typeof v === 'object' ? (v.result ?? v.text ?? (v.richText ? v.richText.map((r: any) => r.text).join('') : v.hyperlink ?? '')) : v; const s = x instanceof Date ? x.toISOString().slice(0, 10) : String(x ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; });
      partes.push(celdas.join(','));
    });
  });
  return { texto: partes.join('\n'), hojas };
}
async function textoPdf(b: Buffer): Promise<{ texto: string; paginas: number }> {
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(b), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0, stopAtErrors: false }).promise;
  const paginas = doc.numPages; const textos: string[] = [];
  for (let i = 1; i <= Math.min(paginas, LIMITES_ADJUNTOS.paginasPdf); i += 1) {
    const p = await doc.getPage(i); const c = await p.getTextContent(); let linea = ''; const out: string[] = [];
    for (const it of c.items as any[]) { linea += it.str ?? ''; if (it.hasEOL) { out.push(linea); linea = ''; } }
    if (linea) out.push(linea); textos.push(out.join('\n').trim()); p.cleanup?.();
  }
  await doc.destroy?.();
  return { texto: textos.join('\n\f'), paginas };
}

/** Extrae el texto EN LOCAL. Nunca lanza: devuelve el estado. */
export async function extraerTexto(b: Buffer, tipo: TipoAdjunto): Promise<{ texto: string; estado: Adjunto['texto']['estado']; paginas?: number; hojas?: string[]; motivo?: string }> {
  try {
    let texto = ''; let paginas: number | undefined; let hojas: string[] | undefined;
    if (['txt', 'csv', 'md', 'json'].includes(tipo)) texto = b.toString('utf8').replace(/^﻿/, '');
    else if (tipo === 'docx') texto = await textoDocx(b);
    else if (tipo === 'xlsx') ({ texto, hojas } = await textoXlsx(b));
    else if (tipo === 'pdf') ({ texto, paginas } = await textoPdf(b));
    else return { texto: '', estado: 'no_disponible', motivo: 'El análisis visual de imágenes no está disponible.' };
    texto = texto.replace(/\u0000/g, '');
    if (!texto.trim()) return { texto: '', estado: 'sin_texto', paginas, hojas, motivo: tipo === 'pdf' ? 'El PDF no contiene texto seleccionable (puede ser escaneado).' : 'Sin texto.' };
    const truncado = texto.length > LIMITES_ADJUNTOS.caracteresTexto;
    return { texto: texto.slice(0, LIMITES_ADJUNTOS.caracteresTexto), estado: truncado ? 'truncado' : 'ok', paginas, hojas };
  } catch (e) { return { texto: '', estado: 'error', motivo: e instanceof ErrorAdjunto ? e.message : 'No se pudo leer el documento.' }; }
}

function leerMeta(id: string): Adjunto | null { try { return JSON.parse(fs.readFileSync(ruta(id, 'json'), 'utf8')) as Adjunto; } catch { return null; } }
function escribir(p: string, contenido: string | Buffer) { fs.mkdirSync(carpeta(), { recursive: true, mode: 0o700 }); const tmp = `${p}.tmp-${process.pid}`; fs.writeFileSync(tmp, contenido, { mode: 0o600 }); fs.renameSync(tmp, p); }
export function listarAdjuntos(userId: string, chatId?: string): Adjunto[] {
  const d = carpeta(); if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter((f) => /^ad_[0-9a-f]{16}\.json$/.test(f)).map((f) => leerMeta(f.slice(0, -5))).filter((a): a is Adjunto => Boolean(a && a.userId === userId && (!chatId || a.chatId === chatId)));
}

/** Guarda un adjunto validado. */
export async function guardarAdjunto(userId: string, chatId: string, nombreOriginal: string, b: Buffer): Promise<Adjunto> {
  if (!b.length) throw new ErrorAdjunto('archivo_vacio', 400, 'El archivo está vacío.');
  if (b.length > LIMITES_ADJUNTOS.bytesArchivo) throw new ErrorAdjunto('archivo_grande', 413, `Cada archivo puede ocupar hasta ${LIMITES_ADJUNTOS.bytesArchivo / 1024 / 1024} MB.`);
  const nombre = nombreSeguro(nombreOriginal);
  const tipo = await detectarTipo(b, nombre); if (!tipo) throw new ErrorAdjunto('tipo_no_admitido', 415, 'Tipo de archivo no admitido o su contenido no coincide con la extensión. Se admiten PNG, JPG, WebP, PDF, DOCX, XLSX, CSV, TXT, MD y JSON.');
  const usado = listarAdjuntos(userId).reduce((n, a) => n + a.bytes, 0);
  if (usado + b.length > LIMITES_ADJUNTOS.bytesPropietario) throw new ErrorAdjunto('cuota_llena', 507, 'Has alcanzado el espacio máximo de adjuntos: elimina chats o adjuntos antiguos.');
  const x = await extraerTexto(b, tipo);
  const id = `ad_${randomBytes(8).toString('hex')}`;
  const meta: Adjunto = { id, userId, chatId, nombre, tipo, mime: MIME[tipo], bytes: b.length, sha256: createHash('sha256').update(b).digest('hex'), creadoEn: new Date().toISOString(), enviado: false,
    texto: { estado: x.estado, caracteres: x.texto.length, ...(x.paginas !== undefined ? { paginas: x.paginas } : {}), ...(x.hojas ? { hojas: x.hojas } : {}), ...(x.motivo ? { motivo: x.motivo } : {}) } };
  escribir(ruta(id, 'bin'), b); if (x.texto) escribir(ruta(id, 'txt'), x.texto); escribir(ruta(id, 'json'), JSON.stringify(meta));
  return meta;
}
/** Adjunto del propietario (y del chat, si se indica); null si no existe o no es suyo. */
export function obtenerAdjunto(userId: string, id: string, chatId?: string): Adjunto | null { if (!ID_ADJUNTO_RE.test(id)) return null; const a = leerMeta(id); return a && a.userId === userId && (!chatId || a.chatId === chatId) ? a : null; }
export function bytesAdjunto(a: Adjunto): Buffer { return fs.readFileSync(ruta(a.id, 'bin')); }
export function textoAdjunto(a: Adjunto): string { try { return fs.readFileSync(ruta(a.id, 'txt'), 'utf8'); } catch { return ''; } }
export function marcarEnviados(ids: string[]): void { for (const id of ids) { const a = leerMeta(id); if (a && !a.enviado) { a.enviado = true; escribir(ruta(id, 'json'), JSON.stringify(a)); } } }
export function eliminarAdjunto(userId: string, id: string): boolean {
  const a = obtenerAdjunto(userId, id); if (!a) return false;
  for (const e of ['bin', 'txt', 'json'] as const) { try { fs.rmSync(ruta(id, e), { force: true }); } catch { /* ya no está */ } }
  return true;
}
/** Borra los adjuntos de los chats que ya no existen en el índice (purgados de la papelera). */
export function purgarAdjuntosHuerfanos(userId: string, chatsVivos: Set<string>): number { let n = 0; for (const a of listarAdjuntos(userId)) if (!chatsVivos.has(a.chatId) && eliminarAdjunto(userId, a.id)) n += 1; return n; }

/** Lo que recibe el Director con el mensaje (texto acotado; nunca rutas ni el propietario). */
export function paraDirector(a: Adjunto): { id: string; nombre: string; tipo: TipoAdjunto; texto: string; estadoTexto: string; paginas?: number; hojas?: string[]; bytes: number } {
  const t = textoAdjunto(a); const recorte = t.length > LIMITES_ADJUNTOS.caracteresDirector;
  return { id: a.id, nombre: a.nombre, tipo: a.tipo, texto: t.slice(0, LIMITES_ADJUNTOS.caracteresDirector), estadoTexto: recorte ? 'truncado' : a.texto.estado, ...(a.texto.paginas !== undefined ? { paginas: a.texto.paginas } : {}), ...(a.texto.hojas ? { hojas: a.texto.hojas } : {}), bytes: a.bytes };
}
