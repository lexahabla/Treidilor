/**
 * ==============================================================================
 * TREIDILOR — APLICACIÓN SEGURA DE PROPUESTAS (infraestructura; SOLO ejecutores de SIMULACIÓN)
 * ==============================================================================
 * Una aprobación humana NO aplica nada. Aplicar es una SEGUNDA acción explícita del administrador, con interruptor propio (`AUTOMATION_APPLY_ENABLED`, apagado por defecto), y exige:
 *   · propuesta APROBADA y dentro de su ventana de aplicación (7 días desde la decisión);
 *   · PREVISUALIZACIÓN previa: el `previewToken` liga la propuesta, su contenido, el ejecutor y la VERSIÓN de los datos que se verían afectados (si algo cambió, el token ya no vale);
 *   · confirmación explícita (`confirm:true`) y permiso según el ejecutor (`master` o `admin`);
 *   · tipo con ejecutor AUTORIZADO (sin ejecutor → rechazo) y ninguna incertidumbre (datos cambiados, producto inexistente, cambio sospechoso → se detiene SIN modificar nada);
 *   · idempotencia (la misma aplicación repetida devuelve la existente) y control de duplicados (mismo objetivo y mismo cambio ya aplicado).
 * Los ejecutores de esta etapa son de SIMULACIÓN: calculan el cambio y su inverso contra los datos actuales (lectura) y el único registro que se escribe es la aplicación simulada de la propia
 * propuesta. NO escriben catálogo, precios, categorías ni portada. Un ejecutor REAL exigiría contrato propio, parche inverso verificable y su propia prueba de reversión: no existe ninguno.
 * ==============================================================================
 */
import crypto from 'node:crypto';
import { getCatalogProducts } from './catalog';
import { getCategories } from './categories';
import { canonicalJson, readProposalRaw, saveApplication, type AdminProposal, type Application, type Fail, type Proposal, type ProposalType } from './automationProposals';

type Any = Record<string, any>;
export const APPLY_WINDOW_DAYS = 7;
export interface Change { campo: string; antes: unknown; despues: unknown }
export interface ExecutorInfo { id: string; type: ProposalType; permission: 'admin' | 'master'; simulation: true; writes: false }
export interface Actor { id: string; name: string; master: boolean }
export interface ApplyDeps { products: () => Any[]; categories: () => Any[]; now?: Date }

const fail = (status: number, code: string, message: string): Fail => ({ ok: false, status, code, message });
const sha = (v: unknown): string => crypto.createHash('sha256').update(typeof v === 'string' ? v : canonicalJson(v)).digest('hex');
const defaultDeps = (): ApplyDeps => ({ products: () => getCatalogProducts() as unknown as Any[], categories: () => getCategories() as unknown as Any[] });

type Exec = { ok: true; changes: Change[]; inverse: Change[]; warnings: string[]; dataVersion: string; targetKey: string } | Fail;
interface Executor extends ExecutorInfo { run(payload: Record<string, unknown>, deps: ApplyDeps): Exec }

const productOf = (deps: ApplyDeps, id: unknown): Any | undefined => (typeof id === 'string' ? deps.products().find((p) => p && p.id === id) : undefined);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim() !== '' && v.length <= max && !/[\u0000-\u001f]/.test(v);

const EXECUTORS: Executor[] = [
  {
    id: 'precio-simulado', type: 'precio', permission: 'master', simulation: true, writes: false,
    run(payload, deps) {
      const { productId, antes, despues } = payload as Any;
      if (!num(antes) || !num(despues) || antes <= 0 || despues <= 0) return fail(400, 'payload_no_valido', 'El precio anterior y el nuevo deben ser números positivos.');
      const p = productOf(deps, productId);
      if (!p) return fail(404, 'producto_no_encontrado', 'El producto ya no existe en el catálogo.');
      if (!num(p.price) || Math.abs(p.price - antes) > 0.005) return fail(409, 'datos_cambiaron', `El precio actual (${p.price}) ya no es el que vio el agente (${antes}): la propuesta está desfasada.`);
      if (Math.abs(despues - antes) / antes > 0.5) return fail(409, 'cambio_sospechoso', 'Un cambio de precio superior al 50 % no se aplica ni simulado: requiere revisión manual.');
      const warnings = despues === antes ? ['El precio propuesto es igual al actual.'] : [];
      return { ok: true, changes: [{ campo: 'price', antes: p.price, despues }], inverse: [{ campo: 'price', antes: despues, despues: p.price }], warnings, dataVersion: sha({ id: p.id, price: p.price }), targetKey: `precio:${p.id}:price` };
    },
  },
  {
    id: 'categoria-simulado', type: 'categoria', permission: 'admin', simulation: true, writes: false,
    run(payload, deps) {
      const { productId, categoryId, subcategoryId } = payload as Any;
      if (!text(categoryId, 80) || (subcategoryId !== undefined && !text(subcategoryId, 80))) return fail(400, 'payload_no_valido', 'Indica la categoría (y, si procede, la subcategoría).');
      const p = productOf(deps, productId);
      if (!p) return fail(404, 'producto_no_encontrado', 'El producto ya no existe en el catálogo.');
      const cats = deps.categories();
      const root = cats.find((c) => c.id === categoryId && !c.parentId);
      if (!root) return fail(409, 'categoria_no_valida', 'La categoría no existe o no es una categoría raíz.');
      const sub = subcategoryId === undefined ? null : cats.find((c) => c.id === subcategoryId && c.parentId === root.id);
      if (subcategoryId !== undefined && !sub) return fail(409, 'categoria_no_valida', 'La subcategoría no pertenece a esa categoría.');
      const antesCat = p.category_id ?? p.category ?? null; const antesSub = p.subcategory_id ?? null;
      const changes: Change[] = [];
      if (antesCat !== root.id) changes.push({ campo: 'category_id', antes: antesCat, despues: root.id });
      if (sub && antesSub !== sub.id) changes.push({ campo: 'subcategory_id', antes: antesSub, despues: sub.id });
      if (!changes.length) return fail(409, 'sin_cambio', 'La ficha ya tiene esa categoría: no hay nada que aplicar.');
      return { ok: true, changes, inverse: changes.map((c) => ({ campo: c.campo, antes: c.despues, despues: c.antes })), warnings: [], dataVersion: sha({ id: p.id, c: antesCat, s: antesSub, root: root.id, sub: sub?.id ?? null }), targetKey: `categoria:${p.id}:category` };
    },
  },
  {
    id: 'correccion-simulado', type: 'correccion_catalogo', permission: 'master', simulation: true, writes: false,
    run(payload, deps) {
      const { productId, campo, antes, despues } = payload as Any;
      if (!['title', 'brand', 'merchant'].includes(campo) || !text(despues, 160) || (antes !== null && antes !== undefined && typeof antes !== 'string')) return fail(400, 'payload_no_valido', 'Solo se admiten correcciones de title, brand o merchant con un texto válido.');
      const p = productOf(deps, productId);
      if (!p) return fail(404, 'producto_no_encontrado', 'El producto ya no existe en el catálogo.');
      if ((p[campo] ?? null) !== (antes ?? null)) return fail(409, 'datos_cambiaron', `El valor actual de «${campo}» ya no es el que vio el agente.`);
      if (despues === p[campo]) return fail(409, 'sin_cambio', 'El valor propuesto es igual al actual.');
      return { ok: true, changes: [{ campo, antes: p[campo] ?? null, despues }], inverse: [{ campo, antes: despues, despues: p[campo] ?? null }], warnings: [], dataVersion: sha({ id: p.id, campo, v: p[campo] ?? null }), targetKey: `correccion:${p.id}:${campo}` };
    },
  },
];

const executorOf = (type: ProposalType): Executor | undefined => EXECUTORS.find((e) => e.type === type);
export const executorInfo = (type: ProposalType): ExecutorInfo | null => { const e = executorOf(type); return e ? { id: e.id, type: e.type, permission: e.permission, simulation: true, writes: false } : null; };
export const EXECUTOR_TYPES = EXECUTORS.map((e) => e.type);

export interface Preview { ok: true; executor: ExecutorInfo; simulation: true; writes: false; changes: Change[]; inverse: Change[]; warnings: string[]; previewToken: string; appliableUntil: string; alreadyApplied: boolean }

function check(p: Proposal, now: Date): Fail | null {
  if (!p.decision || p.decision.state !== 'aprobada') return fail(409, 'no_aprobada', 'Solo se puede aplicar una propuesta APROBADA por una persona.');
  if (Date.parse(p.decision.at) + APPLY_WINDOW_DAYS * 86_400_000 < now.getTime()) return fail(409, 'ventana_vencida', `La ventana de aplicación (${APPLY_WINDOW_DAYS} días desde la aprobación) ha vencido.`);
  return null;
}

/** Previsualiza el cambio SIN escribir nada. Cualquier incertidumbre devuelve un error y se detiene. */
export function previewProposal(id: string, actor: Actor, deps: ApplyDeps = defaultDeps()): Preview | Fail {
  const now = deps.now ?? new Date();
  const raw = readProposalRaw(id);
  if (!raw.ok) return raw;
  const p = raw.proposal;
  const bad = check(p, now); if (bad) return bad;
  const ex = executorOf(p.type);
  if (!ex) return fail(422, 'tipo_sin_ejecutor', `El tipo «${p.type}» no tiene un ejecutor autorizado: no se puede aplicar.`);
  if (ex.permission === 'master' && !actor.master) return fail(403, 'permiso_insuficiente', 'Este tipo solo lo puede aplicar el administrador principal.');
  let r: Exec;
  try { r = ex.run(p.payload, deps); } catch { return fail(500, 'error_interno', 'No se pudo previsualizar; no se ha modificado nada.'); }
  if (!r.ok) return r;
  const previewToken = sha({ id: p.id, payload: p.payloadSha256, executor: ex.id, data: r.dataVersion });
  return { ok: true, executor: executorInfo(p.type)!, simulation: true, writes: false, changes: r.changes, inverse: r.inverse, warnings: r.warnings, previewToken, appliableUntil: new Date(Date.parse(p.decision!.at) + APPLY_WINDOW_DAYS * 86_400_000).toISOString(), alreadyApplied: Boolean(p.application) };
}

export type ApplyResult = { ok: true; applied: boolean; simulated: true; wroteData: false; proposal: AdminProposal } | Fail;

/** Segunda acción explícita: registra la aplicación SIMULADA. Idempotente; rechaza duplicados y cualquier desajuste con la previsualización. */
export function applyProposal(id: string, actor: Actor, input: { previewToken?: unknown; confirm?: unknown }, deps: ApplyDeps = defaultDeps()): ApplyResult {
  const now = deps.now ?? new Date();
  if (input.confirm !== true) return fail(400, 'confirmacion_obligatoria', 'Hace falta la confirmación explícita (confirm:true) tras ver la previsualización.');
  if (typeof input.previewToken !== 'string' || !/^[0-9a-f]{64}$/.test(input.previewToken)) return fail(400, 'vista_previa_obligatoria', 'Hace falta el token de la previsualización.');
  const raw = readProposalRaw(id);
  if (!raw.ok) return raw;
  const p = raw.proposal;
  if (p.application) {
    return p.application.previewToken === input.previewToken ? { ok: true, applied: false, simulated: true, wroteData: false, proposal: asAdmin(id, now) } : fail(409, 'ya_aplicada', 'Esta propuesta ya fue aplicada (simulación) con otra previsualización.');
  }
  const prev = previewProposal(id, actor, deps);
  if (!prev.ok) return prev;
  if (prev.previewToken !== input.previewToken) return fail(409, 'vista_previa_obsoleta', 'Los datos o la propuesta cambiaron desde la previsualización: vuelve a previsualizar.');
  const ex = executorOf(p.type)!;
  const r = ex.run(p.payload, deps); if (!r.ok) return r;
  const duplicada = raw.others.find((o) => o.application && o.application.targetKey === r.targetKey && canonicalJson(o.application.changes) === canonicalJson(r.changes));
  if (duplicada) return fail(409, 'objetivo_ya_aplicado', `Otra propuesta (${duplicada.id}) ya aplicó este mismo cambio sobre el mismo objetivo.`);
  const application: Application = { mode: 'simulada', executor: ex.id, previewToken: prev.previewToken, targetKey: r.targetKey, at: now.toISOString(), by: { id: actor.id.slice(0, 80), name: actor.name.slice(0, 80) }, changes: r.changes, inverse: r.inverse };
  const saved = saveApplication(id, application, now);
  return saved.ok ? { ok: true, applied: true, simulated: true, wroteData: false, proposal: saved.proposal } : saved;
}

function asAdmin(id: string, now: Date): AdminProposal {
  // Vista completa tras una repetición idempotente (la lectura no escribe).
  const raw = readProposalRaw(id) as { ok: true; proposal: Proposal };
  const { idempotencyKey: _k, state: _s, ...rest } = raw.proposal;
  return { ...rest, state: raw.proposal.decision ? raw.proposal.decision.state : Date.parse(raw.proposal.expiresAt) <= now.getTime() ? 'caducada' : 'pendiente' } as AdminProposal;
}
