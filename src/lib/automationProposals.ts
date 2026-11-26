/**
 * ==============================================================================
 * TREIDILOR — COLA DE PROPUESTAS DE LOS AGENTES (almacén, validación y decisiones humanas)
 * ==============================================================================
 * Diseño: `automation/docs/API-AUTOMATIZACION-DISENO.md` §4. Una PROPUESTA es lo que un agente entrega para que el propietario la revise: nunca se aplica sola.
 * Esta biblioteca crea, lee y registra la DECISIÓN HUMANA (aprobada / rechazada) en SU PROPIO archivo (`automation-proposals.json`, escritura atómica + `.bak`). NO importa ni
 * toca productos, categorías, precios, portada ni credenciales, y NO existe ninguna función que «aplique» una propuesta: «aprobada» solo significa «revisada y aceptada por una
 * persona»; aplicar un cambio al catálogo sería una etapa posterior, con los motores ya validados de Treidilor, y no está implementada.
 *
 * Garantías: validación estricta y cerrada (agente, tipo, título, carga útil acotada, evidencias, riesgo, caducidad); rechazo de cualquier forma de credencial o clave en el
 * contenido; IDEMPOTENCIA por (cliente, clave); límites por cliente y globales; aislamiento entre clientes (un agente solo ve las suyas y solo su estado); una decisión es
 * ÚNICA e irreversible (repetirla por la misma persona es idempotente; cualquier otra decisión sobre la misma propuesta es un conflicto); queda el historial (creación y decisión,
 * con responsable y fecha); un archivo ilegible NO se sobrescribe y la operación falla cerrada.
 *
 * Exposición: `/api/automation/v1/proposals` (clientes con alcance EXCLUSIVO `proposals:create`) y `/api/admin/automation-proposals` (panel; sesión de administrador + CSRF),
 * ambas tras `AUTOMATION_PROPOSALS_ENABLED` (apagado por defecto). Sin despliegue.
 * ==============================================================================
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dataFile } from './paths';

export const PROPOSAL_TYPES = ['correccion_catalogo', 'categoria', 'precio', 'portada', 'borrador_ficha', 'borrador_historia', 'campana', 'investigacion', 'importacion', 'otro'] as const;
export type ProposalType = (typeof PROPOSAL_TYPES)[number];
export const PROPOSAL_RISKS = ['bajo', 'medio', 'alto'] as const;
export type ProposalRisk = (typeof PROPOSAL_RISKS)[number];
export const EVIDENCE_KINDS = ['url', 'texto', 'captura', 'observacion'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
export const DECISIONS = ['aprobada', 'rechazada'] as const;
export type DecisionState = (typeof DECISIONS)[number];

export const LIMITS = Object.freeze({ title: 200, payloadBytes: 32 * 1024, evidence: 20, evidenceValue: 500, maxPendingPerClient: 200, maxTotal: 2000, defaultTtlDays: 14, maxTtlDays: 60, note: 300, maxStored: 5000 });

export interface Evidence { kind: EvidenceKind; value: string; at?: string }
export interface Decision { state: DecisionState; by: { id: string; name: string }; at: string; note: string | null }
export interface HistoryEvent { at: string; event: 'creada' | DecisionState | 'aplicacion_simulada' | 'aplicacion_real' | 'aplicacion_en_curso'; by: string; note?: string | null }
/** Registro de una aplicación. Hoy SOLO existe la SIMULADA (no escribe nada fuera de este almacén); una aplicación real exigiría ejecutores con reversión verificable. */
/** `en_curso`: intención registrada ANTES de escribir el catálogo (recuperable con «reconciliar» si se interrumpe). */
export interface Application { mode: 'simulada' | 'real' | 'en_curso'; executor: string; previewToken: string; targetKey: string; at: string; by: { id: string; name: string }; changes: Array<{ campo: string; antes: unknown; despues: unknown }>; inverse: Array<{ campo: string; antes: unknown; despues: unknown }> }
export interface Proposal {
  id: string;
  clientId: string;
  agent: string;
  type: ProposalType;
  title: string;
  payload: Record<string, unknown>;
  evidence: Evidence[];
  risk: ProposalRisk;
  /** `pendiente` hasta que una persona decide; después `aprobada` o `rechazada`. */
  state: 'pendiente' | DecisionState;
  decision: Decision | null;
  /** Aplicación de una propuesta aprobada; null mientras no se haya aplicado. */
  application: Application | null;
  history: HistoryEvent[];
  createdAt: string;
  expiresAt: string;
  idempotencyKey: string;
  executionId: string | null;
  payloadSha256: string;
  /** true si la aplicación modificó el catálogo, false si fue solo simulada. */
  applied: boolean;
}
/** Vista para el agente que la creó: su estado y la fecha de decisión, sin la identidad del responsable ni la nota. */
export type PublicProposal = Omit<Proposal, 'idempotencyKey' | 'payloadSha256' | 'state' | 'decision' | 'history' | 'application'> & { state: 'pendiente' | 'caducada' | DecisionState; decidedAt: string | null };
/** Vista para el panel del propietario (completa, con cliente, decisión e historial). */
export type AdminProposal = Omit<Proposal, 'idempotencyKey' | 'payloadSha256' | 'state'> & { state: 'pendiente' | 'caducada' | DecisionState; payloadSha256: string };

interface StoreDoc { schemaVersion: 1; proposals: Proposal[] }
export type Fail = { ok: false; status: number; code: string; message: string };
const fail = (status: number, code: string, message: string): Fail => ({ ok: false, status, code, message });

const storePath = () => dataFile('automation-proposals.json');

/* ───────────────────────── Almacén ───────────────────────── */

type Read = { status: 'ok'; doc: StoreDoc } | { status: 'corrupt' };

function readStore(): Read {
  const file = storePath();
  if (!fs.existsSync(file)) return { status: 'ok', doc: { schemaVersion: 1, proposals: [] } };
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (doc && doc.schemaVersion === 1 && Array.isArray(doc.proposals) && doc.proposals.every((p: any) => p && typeof p.id === 'string' && typeof p.clientId === 'string' && typeof p.idempotencyKey === 'string')) {
      for (const p of doc.proposals) { p.decision ??= null; p.application ??= null; p.history ??= []; }
      return { status: 'ok', doc };
    }
  } catch { /* ilegible */ }
  return { status: 'corrupt' };
}

/** Temporales huérfanos de una escritura interrumpida (`…json.<pid>.tmp`): se ignoran al leer y se limpian al escribir si tienen más de una hora. */
function tmpFiles(): string[] {
  try {
    const dir = path.dirname(storePath());
    const base = path.basename(storePath());
    return fs.readdirSync(dir).filter((n) => n.startsWith(`${base}.`) && n.endsWith('.tmp')).map((n) => path.join(dir, n));
  } catch { return []; }
}

function writeStore(doc: StoreDoc): void {
  const file = storePath();
  for (const t of tmpFiles()) { try { if (Date.now() - fs.statSync(t).mtimeMs > 3_600_000) fs.rmSync(t, { force: true }); } catch { /* limpieza opcional */ } }
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(doc)}\n`, { mode: 0o600 });
  try { if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`); } catch { /* copia opcional */ }
  fs.renameSync(tmp, file);
}

/* ───────────────────────── Validación ───────────────────────── */

const SECRET_RES = [/\btai_[0-9a-f]{16}_[A-Za-z0-9_-]{20,}/, /\bbearer\s+[A-Za-z0-9._~+/-]{16,}/i, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\b(?:sk|pk)-[A-Za-z0-9]{16,}/, /\bghp_[A-Za-z0-9]{20,}/, /\bxox[bp]-[A-Za-z0-9-]{10,}/, /\bAKIA[0-9A-Z]{16}\b/];
const AGENT_RE = /^(0[0-9]|1[0-3])$/;
const KEY_RE = /^[A-Za-z0-9._-]{8,80}$/;
const EXEC_RE = /^[A-Za-z0-9._:-]{1,80}$/;
const ID_RE = /^pr_[0-9a-f]{16}$/;

const isPlain = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const containsSecret = (s: string): boolean => SECRET_RES.some((re) => re.test(s));

/** Serialización con claves ordenadas: la misma carga siempre da la misma huella. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (isPlain(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}

function validUrl(raw: string): boolean {
  try { const u = new URL(raw); return /^https?:$/.test(u.protocol) && !u.username && !u.password; } catch { return false; }
}

export interface ValidInput { agent: string; type: ProposalType; title: string; payload: Record<string, unknown>; evidence: Evidence[]; risk: ProposalRisk; ttlDays: number }

export function validateProposalInput(raw: unknown): { ok: true; value: ValidInput } | Fail {
  if (!isPlain(raw)) return fail(400, 'propuesta_no_valida', 'La propuesta debe ser un objeto.');
  const allowed = new Set(['agent', 'type', 'title', 'payload', 'evidence', 'risk', 'ttlDays']);
  const extra = Object.keys(raw).filter((k) => !allowed.has(k));
  if (extra.length) return fail(400, 'campos_no_permitidos', `Campos no permitidos: ${extra.slice(0, 5).join(', ')}.`);
  const agent = typeof raw.agent === 'string' ? raw.agent : '';
  if (!AGENT_RE.test(agent)) return fail(400, 'agente_no_valido', 'El agente debe ser un identificador 00–13.');
  if (!PROPOSAL_TYPES.includes(raw.type as ProposalType)) return fail(400, 'tipo_no_valido', `Tipo no permitido. Tipos: ${PROPOSAL_TYPES.join(', ')}.`);
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (title.length < 3 || title.length > LIMITS.title || /[\u0000-\u001f]/.test(title)) return fail(400, 'titulo_no_valido', `El título debe tener de 3 a ${LIMITS.title} caracteres, sin caracteres de control.`);
  if (!isPlain(raw.payload)) return fail(400, 'carga_no_valida', 'La carga útil debe ser un objeto.');
  const payloadText = canonicalJson(raw.payload);
  if (Buffer.byteLength(payloadText, 'utf8') > LIMITS.payloadBytes) return fail(413, 'carga_demasiado_grande', `La carga útil supera ${LIMITS.payloadBytes} bytes.`);
  if (!PROPOSAL_RISKS.includes(raw.risk as ProposalRisk)) return fail(400, 'riesgo_no_valido', `Riesgo: ${PROPOSAL_RISKS.join(', ')}.`);
  const evidenceIn = raw.evidence === undefined ? [] : raw.evidence;
  if (!Array.isArray(evidenceIn) || evidenceIn.length > LIMITS.evidence) return fail(400, 'evidencias_no_validas', `Hasta ${LIMITS.evidence} evidencias.`);
  const evidence: Evidence[] = [];
  for (const e of evidenceIn) {
    if (!isPlain(e) || !EVIDENCE_KINDS.includes(e.kind as EvidenceKind) || typeof e.value !== 'string' || !e.value.trim() || e.value.length > LIMITS.evidenceValue) return fail(400, 'evidencia_no_valida', `Cada evidencia necesita tipo (${EVIDENCE_KINDS.join('/')}) y valor de hasta ${LIMITS.evidenceValue} caracteres.`);
    if (e.kind === 'url' && !validUrl(e.value.trim())) return fail(400, 'evidencia_url_no_valida', 'Las URL de evidencia deben ser http(s) sin usuario ni contraseña.');
    if (e.at !== undefined && (typeof e.at !== 'string' || !Number.isFinite(Date.parse(e.at)))) return fail(400, 'evidencia_fecha_no_valida', 'La fecha de la evidencia debe ser ISO.');
    evidence.push({ kind: e.kind as EvidenceKind, value: e.value.trim(), ...(typeof e.at === 'string' ? { at: e.at } : {}) });
  }
  const ttl = raw.ttlDays === undefined ? LIMITS.defaultTtlDays : Number(raw.ttlDays);
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > LIMITS.maxTtlDays) return fail(400, 'caducidad_no_valida', `La caducidad debe ser de 1 a ${LIMITS.maxTtlDays} días.`);
  if (containsSecret(`${title}\n${payloadText}\n${evidence.map((e) => e.value).join('\n')}`)) return fail(422, 'contenido_sensible', 'El contenido parece incluir una credencial o clave; no se guarda.');
  return { ok: true, value: { agent, type: raw.type as ProposalType, title, payload: raw.payload as Record<string, unknown>, evidence, risk: raw.risk as ProposalRisk, ttlDays: ttl } };
}

/* ───────────────────────── Vistas ───────────────────────── */

const effectiveState = (p: Proposal, now: number): 'pendiente' | 'caducada' | DecisionState => (p.decision ? p.decision.state : Date.parse(p.expiresAt) <= now ? 'caducada' : 'pendiente');
const isPending = (p: Proposal, now: number): boolean => !p.decision && Date.parse(p.expiresAt) > now;

const publicView = (p: Proposal, now: number): PublicProposal => {
  const { idempotencyKey: _k, payloadSha256: _h, decision, history: _hist, state: _s, application: _a, ...rest } = p;
  return { ...rest, state: effectiveState(p, now), decidedAt: decision ? decision.at : null };
};
const adminView = (p: Proposal, now: number): AdminProposal => {
  const { idempotencyKey: _k, state: _s, ...rest } = p;
  return { ...rest, state: effectiveState(p, now) };
};

/* ───────────────────────── Operaciones de los agentes ───────────────────────── */

export interface CreateMeta { idempotencyKey?: unknown; executionId?: unknown }
export type CreateResult = { ok: true; created: boolean; proposal: PublicProposal } | Fail;

export function createProposal(clientId: string, raw: unknown, meta: CreateMeta, now: Date = new Date()): CreateResult {
  const key = typeof meta.idempotencyKey === 'string' ? meta.idempotencyKey : '';
  if (!KEY_RE.test(key)) return fail(400, 'idempotency_key_obligatoria', 'Se exige la cabecera Idempotency-Key (8–80 caracteres: letras, números, . _ -).');
  const executionId = meta.executionId === undefined || meta.executionId === null || meta.executionId === '' ? null : String(meta.executionId);
  if (executionId !== null && !EXEC_RE.test(executionId)) return fail(400, 'ejecucion_no_valida', 'X-Execution-Id no es válido.');
  const v = validateProposalInput(raw);
  if (!v.ok) return v;
  const read = readStore();
  if (read.status !== 'ok') return fail(423, 'almacen_ilegible', 'El archivo de propuestas está dañado y no se sobrescribe.');
  const hash = crypto.createHash('sha256').update(canonicalJson({ ...v.value, ttlDays: undefined })).digest('hex');
  const t = now.getTime();
  const same = read.doc.proposals.find((p) => p.clientId === clientId && p.idempotencyKey === key);
  if (same) return same.payloadSha256 === hash ? { ok: true, created: false, proposal: publicView(same, t) } : fail(409, 'idempotencia_conflicto', 'Esa Idempotency-Key ya se usó con otra propuesta.');
  const pending = read.doc.proposals.filter((p) => p.clientId === clientId && isPending(p, t)).length;
  if (pending >= LIMITS.maxPendingPerClient) return fail(429, 'limite_pendientes', `Máximo ${LIMITS.maxPendingPerClient} propuestas pendientes por cliente.`);
  if (read.doc.proposals.filter((p) => isPending(p, t)).length >= LIMITS.maxTotal) return fail(429, 'cola_llena', 'La cola de propuestas está llena; el propietario debe revisarla.');
  const proposal: Proposal = {
    id: `pr_${crypto.randomBytes(8).toString('hex')}`, clientId, agent: v.value.agent, type: v.value.type, title: v.value.title, payload: v.value.payload, evidence: v.value.evidence, risk: v.value.risk,
    state: 'pendiente', decision: null, application: null, history: [{ at: now.toISOString(), event: 'creada', by: `cliente:${clientId}` }], createdAt: now.toISOString(), expiresAt: new Date(t + v.value.ttlDays * 86_400_000).toISOString(),
    idempotencyKey: key, executionId, payloadSha256: hash, applied: false,
  };
  // Se conservan las decididas (trazabilidad) y las no caducadas o caducadas hace menos de 30 días; con tope global.
  const keep = read.doc.proposals.filter((p) => p.decision || Date.parse(p.expiresAt) > t - 30 * 86_400_000).slice(-(LIMITS.maxStored - 1));
  writeStore({ schemaVersion: 1, proposals: [...keep, proposal] });
  return { ok: true, created: true, proposal: publicView(proposal, t) };
}

/** Un cliente solo ve SUS propuestas; una ajena o inexistente es indistinguible (404). */
export function getProposal(clientId: string, id: string, now: Date = new Date()): { ok: true; proposal: PublicProposal } | Fail {
  const read = readStore();
  if (read.status !== 'ok') return fail(423, 'almacen_ilegible', 'El archivo de propuestas está dañado.');
  const p = ID_RE.test(id) ? read.doc.proposals.find((x) => x.id === id && x.clientId === clientId) : undefined;
  return p ? { ok: true, proposal: publicView(p, now.getTime()) } : fail(404, 'no_encontrada', 'Propuesta no encontrada.');
}

/** Lectura (vista de agente) de todas las propuestas, por estado. Solo la usan pruebas y herramientas internas; el panel usa las funciones `…Admin`. */
export function listProposals(opts: { state?: 'pendiente' | 'caducada' | DecisionState; limit?: number } = {}, now: Date = new Date()): { ok: true; proposals: PublicProposal[] } | Fail {
  const read = readStore();
  if (read.status !== 'ok') return fail(423, 'almacen_ilegible', 'El archivo de propuestas está dañado.');
  const all = read.doc.proposals.map((p) => publicView(p, now.getTime())).filter((p) => !opts.state || p.state === opts.state).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return { ok: true, proposals: all.slice(0, Math.min(Math.max(opts.limit ?? 100, 1), 500)) };
}

/* ───────────────────────── Operaciones del panel (propietario) ───────────────────────── */

export function listProposalsAdmin(opts: { state?: 'pendiente' | 'caducada' | DecisionState; agent?: string; limit?: number } = {}, now: Date = new Date()): { ok: true; proposals: AdminProposal[]; counts: Record<string, number> } | Fail {
  const read = readStore();
  if (read.status !== 'ok') return fail(423, 'almacen_ilegible', 'El archivo de propuestas está dañado y no se sobrescribe.');
  const t = now.getTime();
  const all = read.doc.proposals.map((p) => adminView(p, t));
  const counts: Record<string, number> = { pendiente: 0, aprobada: 0, rechazada: 0, caducada: 0 };
  for (const p of all) counts[p.state] += 1;
  const rows = all.filter((p) => (!opts.state || p.state === opts.state) && (!opts.agent || p.agent === opts.agent)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return { ok: true, proposals: rows.slice(0, Math.min(Math.max(opts.limit ?? 100, 1), 500)), counts };
}

export function getProposalAdmin(id: string, now: Date = new Date()): { ok: true; proposal: AdminProposal } | Fail {
  const read = readStore();
  if (read.status !== 'ok') return fail(423, 'almacen_ilegible', 'El archivo de propuestas está dañado y no se sobrescribe.');
  const p = ID_RE.test(id) ? read.doc.proposals.find((x) => x.id === id) : undefined;
  return p ? { ok: true, proposal: adminView(p, now.getTime()) } : fail(404, 'no_encontrada', 'Propuesta no encontrada.');
}

export interface Actor { id: string; name: string }
export type DecideResult = { ok: true; decided: boolean; proposal: AdminProposal } | Fail;

/**
 * Registra la DECISIÓN de una persona. Única e irreversible: repetir la misma decisión por la misma persona es idempotente (`decided:false`); cualquier otra decisión sobre una
 * propuesta ya decidida (otra persona o decisión contraria) es un conflicto 409; una propuesta caducada no se puede decidir. NO aplica nada: `applied` sigue siendo false.
 */
export function decideProposal(id: string, decision: unknown, actor: Actor, note: unknown, now: Date = new Date()): DecideResult {
  if (!DECISIONS.includes(decision as DecisionState)) return fail(400, 'decision_no_valida', `La decisión debe ser ${DECISIONS.join(' o ')}.`);
  if (!actor || typeof actor.id !== 'string' || !actor.id || typeof actor.name !== 'string' || !actor.name) return fail(400, 'responsable_obligatorio', 'Hace falta el responsable de la decisión.');
  const text = note === undefined || note === null || note === '' ? null : typeof note === 'string' ? note.trim() : undefined;
  if (text === undefined || (text !== null && (text.length > LIMITS.note || /[\u0000-\u001f]/.test(text)))) return fail(400, 'nota_no_valida', `La nota debe ser texto de hasta ${LIMITS.note} caracteres, sin caracteres de control.`);
  if (text && containsSecret(text)) return fail(422, 'contenido_sensible', 'La nota parece incluir una credencial o clave; no se guarda.');
  const read = readStore();
  if (read.status !== 'ok') return fail(423, 'almacen_ilegible', 'El archivo de propuestas está dañado y no se sobrescribe.');
  const p = ID_RE.test(id) ? read.doc.proposals.find((x) => x.id === id) : undefined;
  if (!p) return fail(404, 'no_encontrada', 'Propuesta no encontrada.');
  const t = now.getTime();
  if (p.decision) {
    if (p.decision.state === decision && p.decision.by.id === actor.id) return { ok: true, decided: false, proposal: adminView(p, t) };
    return fail(409, 'ya_decidida', `Esta propuesta ya fue ${p.decision.state} el ${p.decision.at}; la decisión es única y no se puede cambiar.`);
  }
  if (Date.parse(p.expiresAt) <= t) return fail(409, 'caducada', 'La propuesta ha caducado y ya no se puede decidir.');
  p.decision = { state: decision as DecisionState, by: { id: actor.id.slice(0, 80), name: actor.name.slice(0, 80) }, at: now.toISOString(), note: text };
  p.state = decision as DecisionState;
  p.history.push({ at: now.toISOString(), event: decision as DecisionState, by: `usuario:${actor.id.slice(0, 80)}`, note: text });
  writeStore(read.doc);
  return { ok: true, decided: true, proposal: adminView(p, t) };
}

/* ───────────────────────── Acceso para la aplicación (solo este almacén) ───────────────────────── */

/** Datos de las propuestas necesarios para decidir una aplicación (vista completa, sin clave de idempotencia). */
export function readProposalRaw(id: string): { ok: true; proposal: Proposal; others: Proposal[] } | Fail {
  const read = readStore();
  if (read.status !== 'ok') return fail(423, 'almacen_ilegible', 'El archivo de propuestas está dañado y no se sobrescribe.');
  const p = ID_RE.test(id) ? read.doc.proposals.find((x) => x.id === id) : undefined;
  return p ? { ok: true, proposal: p, others: read.doc.proposals.filter((x) => x.id !== id) } : fail(404, 'no_encontrada', 'Propuesta no encontrada.');
}

/** Guarda el registro de una aplicación (simulada o real) en el almacén de propuestas.
 * Si opts.force es true y ya existe una aplicación con el mismo previewToken, se sobrescribe.
 * Si ya existe una aplicación con previewToken distinto, rechaza con 409.
 */
export function saveApplication(id: string, application: Application, now: Date, opts?: { force?: boolean }): { ok: true; proposal: AdminProposal } | Fail {
  const read = readStore();
  if (read.status !== 'ok') return fail(423, 'almacen_ilegible', 'El archivo de propuestas está dañado y no se sobrescribe.');
  const p = ID_RE.test(id) ? read.doc.proposals.find((x) => x.id === id) : undefined;
  if (!p) return fail(404, 'no_encontrada', 'Propuesta no encontrada.');
  if (p.application) {
    if (opts?.force && p.application.previewToken === application.previewToken) {
      p.application = application;
      p.history.push({ at: now.toISOString(), event: application.mode === 'real' ? 'aplicacion_real' : application.mode === 'en_curso' ? 'aplicacion_en_curso' : 'aplicacion_simulada', by: `usuario:${application.by.id.slice(0, 80)}` });
      writeStore(read.doc);
      return { ok: true, proposal: adminView(p, now.getTime()) };
    }
    return fail(409, 'ya_aplicada', 'Esta propuesta ya tiene una aplicación registrada.');
  }
  p.application = application;
  p.history.push({ at: now.toISOString(), event: application.mode === 'real' ? 'aplicacion_real' : application.mode === 'en_curso' ? 'aplicacion_en_curso' : 'aplicacion_simulada', by: `usuario:${application.by.id.slice(0, 80)}` });
  writeStore(read.doc);
  return { ok: true, proposal: adminView(p, now.getTime()) };
}

/* ───────────────────────── Salud y recuperación del almacén ───────────────────────── */

const validDoc = (txt: string): StoreDoc | null => {
  try {
    const d = JSON.parse(txt);
    return d && d.schemaVersion === 1 && Array.isArray(d.proposals) && d.proposals.every((p: any) => p && typeof p.id === 'string' && typeof p.clientId === 'string' && typeof p.idempotencyKey === 'string') ? d : null;
  } catch { return null; }
};

export interface StoreHealth { state: 'ausente' | 'ok' | 'dañado'; backup: 'valida' | 'ausente' | 'dañada'; orphanTmp: number }
export function storeHealth(): StoreHealth {
  const file = storePath();
  const state = fs.existsSync(file) ? (validDoc(fs.readFileSync(file, 'utf8')) ? 'ok' : 'dañado') : 'ausente';
  const backup = fs.existsSync(`${file}.bak`) ? (validDoc(fs.readFileSync(`${file}.bak`, 'utf8')) ? 'valida' : 'dañada') : 'ausente';
  return { state, backup, orphanTmp: tmpFiles().length };
}

/**
 * Recupera el almacén DAÑADO desde su copia `.bak` si esta es válida: conserva el archivo dañado como `…corrupt-<fecha>` (nunca se destruye ni se sobrescribe una copia existente) y
 * restaura con escritura atómica. Con el almacén sano o sin copia válida no cambia nada. Las claves de idempotencia y las decisiones restauradas evitan duplicados al reanudar.
 */
export function restoreFromBackup(now: Date = new Date()): { ok: true; restored: number; corruptCopy: string } | Fail {
  const h = storeHealth();
  if (h.state !== 'dañado') return fail(409, 'sin_necesidad', 'El almacén de propuestas no está dañado: no hay nada que recuperar.');
  const file = storePath();
  const bak = h.backup === 'valida' ? validDoc(fs.readFileSync(`${file}.bak`, 'utf8')) : null;
  if (!bak) return fail(409, 'sin_copia_valida', 'No hay una copia de seguridad válida: no se ha cambiado nada. Revisa el archivo a mano.');
  const corrupt = `${file}.corrupt-${now.toISOString().replace(/[:.]/g, '-')}`;
  if (fs.existsSync(corrupt)) return fail(409, 'copia_danada_existente', 'Ya existe una copia del archivo dañado con esa fecha; reintenta.');
  fs.copyFileSync(file, corrupt);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(bak)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
  return { ok: true, restored: bak.proposals.length, corruptCopy: path.basename(corrupt) };
}
