/**
 * ==============================================================================
 * TREIDILOR — OPERACIONES DE CATÁLOGO DEL DIRECTOR IA (API de automatización)
 * ==============================================================================
 * El Director ejecuta, DESPUÉS de la aprobación del propietario en el panel, dos operaciones que hasta ahora solo podía hacer una persona:
 *   · crear una categoría (o subcategoría) → la MISMA función que usa el panel (`createCategory`: nombre único por rama, un solo nivel);
 *   · asignar categoría a fichas → la MISMA semántica que la acción masiva del panel «set-category» (`category` = nombre, `category_id`,
 *     `subcategory_id`), pero en una sección ATÓMICA (`updateCatalog`) y con comprobación OPTIMISTA: solo se cambia la ficha si sigue como el
 *     Director la vio (`antes`); si cambió mientras tanto, se omite y se informa (nunca se pisa un cambio de otra persona).
 * Lecturas para decidir (alcance `catalog:read`): categorías con su recuento real y sugerencias para las fichas sin categoría, calculadas con las
 * palabras clave de cada categoría (las mismas que usa la importación).
 * Garantías: alcance EXCLUSIVO `catalog:write` (separado del de lectura); interruptor propio `AUTOMATION_WRITE_ENABLED` (apagado por defecto);
 * IDEMPOTENCIA por `clave` (la confirmación del Director: repetirla devuelve el mismo resultado sin volver a escribir); límites de tamaño; y un
 * REGISTRO de cada escritura (quién, qué operación, qué cambió antes/después) en `automation-writes.jsonl`. Nada de esto borra ni renombra.
 * ==============================================================================
 */
import fs from 'node:fs';
import { dataFile } from './paths';
import { createCategory, getCategories, getCategoryById, normalizeKey, type Category } from './categories';
import { readProductsFromFile, updateCatalog, type Product } from './productStore';
import { getCatalogProducts } from './catalog';

export const LIMITES_ESCRITURA = Object.freeze({ nombre: 60, asignacionesPorLote: 200, clave: 80 });
const RUTA_REGISTRO = (): string => dataFile('automation-writes.jsonl');
const CLAVE = /^[A-Za-z0-9._:-]{4,80}$/;
const NOMBRE_VALIDO = (s: string): boolean => s.length >= 2 && s.length <= LIMITES_ESCRITURA.nombre && !/[\u0000-\u001f<>{}[\]\\]/.test(s) && /\p{L}/u.test(s);

type Fallo = { ok: false; status: number; code: string; message: string };
const fallo = (status: number, code: string, message: string): Fallo => ({ ok: false, status, code, message });

/* ───────────────────────── registro e idempotencia ───────────────────────── */
interface Entrada { en: string; clientId: string; operacion: 'crear_categoria' | 'asignar_categorias'; clave: string; resultado: Record<string, unknown> }
function leerRegistro(): Entrada[] {
  try { return fs.readFileSync(RUTA_REGISTRO(), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) as Entrada; } catch { return null; } }).filter((x): x is Entrada => Boolean(x)); } catch { return []; }
}
function previa(clientId: string, operacion: Entrada['operacion'], clave: string): Entrada | undefined {
  return leerRegistro().reverse().find((e) => e.clientId === clientId && e.operacion === operacion && e.clave === clave);
}
function anotar(e: Entrada): void { fs.appendFileSync(RUTA_REGISTRO(), `${JSON.stringify(e)}\n`, { mode: 0o600 }); }
export function leerEscrituras(limite = 50): Entrada[] { return leerRegistro().slice(-limite).reverse(); }

/* ───────────────────────── lecturas ───────────────────────── */
const sinCategoria = (p: Product): boolean => !String((p as any).category_id ?? '').trim();
export function categoriasConRecuento(productos: Product[] = getCatalogProducts()): Array<{ id: string; nombre: string; padre: string | null; productos: number }> {
  const cats = getCategories(); const n = new Map<string, number>();
  for (const p of productos) { const c = String((p as any).category_id ?? ''); const s = String((p as any).subcategory_id ?? ''); if (c) n.set(c, (n.get(c) ?? 0) + 1); if (s) n.set(s, (n.get(s) ?? 0) + 1); }
  return cats.map((c) => ({ id: c.id, nombre: c.name, padre: c.parentId ?? null, productos: n.get(c.id) ?? 0 }));
}

export interface Sugerencia { productId: string; titulo: string; antes: { category_id: null }; propuesta: { categoryId: string; nombre: string; parecidas: string[]; cuota: number } | null; alternativas: Array<{ categoryId: string; nombre: string }>; certeza: 'segura' | 'dudosa' | 'sin_propuesta'; metodo: 'parecido' | 'palabras_clave' | null }
/** Fichas COMPLETAS (etiquetas, marca, descripción) de las que siguen en el catálogo: la proyección del catálogo no trae las etiquetas. */
function fichasCompletas(): Product[] { const vivos = new Set(getCatalogProducts().map((p) => String(p.id))); return readProductsFromFile().filter((p) => vivos.has(String(p.id))); }
const STOP = new Set('de del la las el los y o para con sin por en a al un una unos unas tipo pack set uds unidades nuevo nueva color negro blanco mini pro max plus x'.split(' '));
const palabras = (p: Product): Set<string> => new Set(normalizeKey([p.title, ...(Array.isArray((p as any).tags) ? (p as any).tags : [])].join(' ')).split(' ').filter((w) => w.length >= 3 && !STOP.has(w)));
/** Umbrales de «segura», fijados con la evaluación sobre el catálogo real (dejar una fuera, 28/11/2026): 86 de 86 aciertos (100 %); las palabras clave solas, 66 %. */
export const UMBRAL_SEGURA = Object.freeze({ cuota: 0.75, parecido: 0.3, vecinas: 5 });
/**
 * Fichas SIN categoría con la categoría que les correspondería, por PARECIDO con las fichas que YA están clasificadas en el propio catálogo (la convención real de la tienda):
 * se comparan las palabras del título y las etiquetas con todas las fichas clasificadas y votan las 5 más parecidas. «segura» solo con mayoría clara (≥ 75 %) y una ficha
 * muy parecida (≥ 0,3): es lo único que el Director propone aplicar. Las palabras clave de las categorías solo sirven de PISTA para las dudosas (nunca para aplicar).
 */
export function sugerenciasSinCategoria(productos: Product[] = fichasCompletas()): { total: number; sugerencias: Sugerencia[] } {
  const raices = getCategories().filter((c) => !c.parentId); const nombre = new Map(raices.map((c) => [c.id, c.name]));
  const clasificadas = productos.filter((p) => nombre.has(String((p as any).category_id ?? ''))).map((q) => ({ q, w: palabras(q) }));
  const sugerencias = productos.filter(sinCategoria).map((p): Sugerencia => {
    const wp = palabras(p);
    const sims = clasificadas.map(({ q, w }) => { let i = 0; for (const x of wp) if (w.has(x)) i += 1; return { q, s: i / ((wp.size + w.size - i) || 1) }; }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, UMBRAL_SEGURA.vecinas);
    const votos = new Map<string, number>(); for (const x of sims) { const c = String((x.q as any).category_id); votos.set(c, (votos.get(c) ?? 0) + x.s); }
    const orden = [...votos].sort((a, b) => b[1] - a[1]); const total = orden.reduce((s, x) => s + x[1], 0);
    const base = { productId: String(p.id), titulo: String(p.title ?? '').slice(0, 140), antes: { category_id: null } as { category_id: null } };
    if (orden.length) {
      const [top] = orden; const cuota = top[1] / total; const segura = cuota >= UMBRAL_SEGURA.cuota && sims[0].s >= UMBRAL_SEGURA.parecido;
      return { ...base, propuesta: { categoryId: top[0], nombre: nombre.get(top[0]) ?? top[0], parecidas: sims.filter((x) => String((x.q as any).category_id) === top[0]).slice(0, 2).map((x) => String(x.q.title ?? '').slice(0, 80)), cuota: Number(cuota.toFixed(2)) }, alternativas: orden.slice(1, 3).map(([id]) => ({ categoryId: id, nombre: nombre.get(id) ?? id })), certeza: segura ? 'segura' : 'dudosa', metodo: 'parecido' };
    }
    // sin ninguna ficha parecida: las palabras clave de las categorías solo dan una PISTA (dudosa)
    const h = ` ${normalizeKey([p.title, ...(Array.isArray((p as any).tags) ? (p as any).tags : [])].join(' '))} `;
    const kw = raices.map((c) => ({ c, n: (c.keywords ?? []).filter((k) => k && h.includes(` ${normalizeKey(k)} `)).length })).filter((x) => x.n).sort((a, b) => b.n - a.n);
    if (kw.length) return { ...base, propuesta: { categoryId: kw[0].c.id, nombre: kw[0].c.name, parecidas: [], cuota: 0 }, alternativas: kw.slice(1, 3).map((x) => ({ categoryId: x.c.id, nombre: x.c.name })), certeza: 'dudosa', metodo: 'palabras_clave' };
    return { ...base, propuesta: null, alternativas: [], certeza: 'sin_propuesta', metodo: null };
  });
  return { total: sugerencias.length, sugerencias };
}

/* ───────────────────────── escrituras ───────────────────────── */
export function crearCategoriaAutomatizada(input: { nombre?: unknown; padre?: unknown; clave?: unknown }, clientId: string): { ok: true; status: number; categoria: { id: string; nombre: string; padre: string | null }; existente: boolean; repetida: boolean } | Fallo {
  const nombre = typeof input.nombre === 'string' ? input.nombre.trim().replace(/\s+/g, ' ') : '';
  const padre = input.padre === undefined || input.padre === null || input.padre === '' ? null : String(input.padre);
  const clave = typeof input.clave === 'string' ? input.clave : '';
  if (!NOMBRE_VALIDO(nombre)) return fallo(400, 'nombre_no_valido', `El nombre debe tener entre 2 y ${LIMITES_ESCRITURA.nombre} caracteres, con letras y sin símbolos de marcado.`);
  if (!CLAVE.test(clave)) return fallo(400, 'clave_no_valida', 'Falta la clave de idempotencia (la confirmación que autoriza la operación).');
  const ya = previa(clientId, 'crear_categoria', clave); if (ya) return { ok: true, status: 200, ...(ya.resultado as any), repetida: true };
  if (padre !== null) { const p = getCategoryById(padre); if (!p) return fallo(404, 'padre_no_existe', 'La categoría padre no existe.'); if (p.parentId) return fallo(409, 'un_solo_nivel', `«${p.name}» ya es una subcategoría: solo se permite un nivel.`); }
  // ya existe con ese nombre en esa rama → no se duplica (se informa como existente)
  const igual = getCategories().find((c) => normalizeKey(c.name) === normalizeKey(nombre) && (c.parentId ?? null) === padre);
  if (igual) { const r = { categoria: { id: igual.id, nombre: igual.name, padre: igual.parentId ?? null }, existente: true }; anotar({ en: new Date().toISOString(), clientId, operacion: 'crear_categoria', clave, resultado: r }); return { ok: true, status: 200, ...r, repetida: false }; }
  const res = createCategory({ name: nombre, parentId: padre, keywords: [] });
  if (!res.ok || !res.category) return fallo(409, 'no_creada', res.message);
  const r = { categoria: { id: res.category.id, nombre: res.category.name, padre: res.category.parentId ?? null }, existente: false };
  anotar({ en: new Date().toISOString(), clientId, operacion: 'crear_categoria', clave, resultado: r });
  return { ok: true, status: 201, ...r, repetida: false };
}

export interface Asignacion { productId: string; categoryId: string; subcategoryId?: string | null; antes?: { category_id: string | null } }
export function asignarCategoriasAutomatizado(input: { asignaciones?: unknown; clave?: unknown }, clientId: string): { ok: true; status: number; aplicadas: Array<{ productId: string; antes: unknown; despues: unknown }>; omitidas: Array<{ productId: string; motivo: string }>; repetida: boolean } | Fallo {
  const clave = typeof input.clave === 'string' ? input.clave : '';
  if (!CLAVE.test(clave)) return fallo(400, 'clave_no_valida', 'Falta la clave de idempotencia (la confirmación que autoriza la operación).');
  const lista = Array.isArray(input.asignaciones) ? input.asignaciones : null;
  if (!lista || !lista.length || lista.length > LIMITES_ESCRITURA.asignacionesPorLote) return fallo(400, 'asignaciones_no_validas', `Entre 1 y ${LIMITES_ESCRITURA.asignacionesPorLote} asignaciones por lote.`);
  const ya = previa(clientId, 'asignar_categorias', clave); if (ya) return { ok: true, status: 200, ...(ya.resultado as any), repetida: true };
  const cats = getCategories(); const porId = new Map(cats.map((c) => [c.id, c]));
  const validas: Array<{ productId: string; raiz: Category; sub: Category | null; antes: string | null | undefined }> = []; const omitidas: Array<{ productId: string; motivo: string }> = [];
  for (const a of lista as any[]) {
    const productId = typeof a?.productId === 'string' ? a.productId.slice(0, 200) : '';
    if (!productId) { omitidas.push({ productId: '?', motivo: 'sin_producto' }); continue; }
    const raiz = porId.get(String(a.categoryId ?? '')); if (!raiz || raiz.parentId) { omitidas.push({ productId, motivo: 'categoria_no_valida' }); continue; }
    const sub = a.subcategoryId ? porId.get(String(a.subcategoryId)) ?? null : null; if (a.subcategoryId && (!sub || sub.parentId !== raiz.id)) { omitidas.push({ productId, motivo: 'subcategoria_no_valida' }); continue; }
    validas.push({ productId, raiz, sub, antes: a.antes && 'category_id' in a.antes ? (a.antes.category_id ?? null) : undefined });
  }
  const { result } = updateCatalog((productos) => {
    const aplicadas: Array<{ productId: string; antes: unknown; despues: unknown }> = [];
    for (const v of validas) {
      const p = productos.find((x) => x.id === v.productId) as any;
      if (!p) { omitidas.push({ productId: v.productId, motivo: 'producto_no_existe' }); continue; }
      const actual = String(p.category_id ?? '').trim() || null;
      if (v.antes !== undefined && actual !== v.antes) { omitidas.push({ productId: v.productId, motivo: 'cambiada_mientras_tanto' }); continue; } // optimista: no se pisa un cambio ajeno
      if (actual === v.raiz.id && (!v.sub || p.subcategory_id === v.sub.id)) { omitidas.push({ productId: v.productId, motivo: 'ya_asignada' }); continue; }
      const antes = { category: p.category ?? '', category_id: actual, subcategory_id: p.subcategory_id ?? null };
      p.category = v.raiz.name; p.category_id = v.raiz.id;
      if (v.sub) p.subcategory_id = v.sub.id; else if (p.subcategory_id) delete p.subcategory_id; // cambiar de raíz invalida la subcategoría anterior (como el panel)
      aplicadas.push({ productId: v.productId, antes, despues: { category: p.category, category_id: p.category_id, subcategory_id: p.subcategory_id ?? null } });
    }
    return { changed: aplicadas.length > 0, result: aplicadas };
  });
  const r = { aplicadas: result, omitidas };
  anotar({ en: new Date().toISOString(), clientId, operacion: 'asignar_categorias', clave, resultado: r });
  return { ok: true, status: 200, ...r, repetida: false };
}
