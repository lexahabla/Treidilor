/**
 * Área PRIVADA del Agente 06 dentro del directorio del ledger del Director: `<ledger>/sandbox-portada/{layout,backups,stories,undo}.json`.
 * Es la única ubicación donde se «guarda» un borrador simulado: NUNCA se toca `home-layout.json`, `home-stories.json` ni nada de `src/` ni del volumen de producción.
 * Escritura atómica (temporal + renombrado) y lectura tolerante: un archivo ilegible se informa como `corrupt` y NO se sobrescribe.
 */
import fs from 'node:fs';
import path from 'node:path';

const NOMBRES = { layout: 'layout.json', backups: 'backups.json', historias: 'stories.json', undo: 'undo.json' };

export function dirSandbox(dirLedger) {
  if (!dirLedger) return null;
  return path.join(dirLedger, 'sandbox-portada');
}

function leer(dir, nombre) {
  const f = path.join(dir, NOMBRES[nombre]);
  if (!fs.existsSync(f)) return { status: 'missing', raw: null };
  try { return { status: 'ok', raw: JSON.parse(fs.readFileSync(f, 'utf8')) }; } catch { return { status: 'corrupt', raw: null }; }
}

/** Estado actual del área privada con la forma que esperan las decisiones existentes (`{status, doc}`); lo ausente = documento vacío. */
export function leerEstado(motor, dir) {
  const l = leer(dir, 'layout');
  const b = leer(dir, 'backups');
  const s = leer(dir, 'historias');
  const layout = l.status === 'ok' ? (() => { const v = motor.validate.validateDocument(l.raw); return v.ok ? { status: 'ok', doc: v.value } : { status: 'invalid', doc: motor.validate.emptyDocument() }; })() : { status: l.status, doc: motor.validate.emptyDocument() };
  const backups = b.status === 'ok' ? (() => { const v = motor.backups.validateBackupsDocument(b.raw); return v.ok ? v.value : null; })() : motor.backups.emptyBackupsDocument();
  const historias = s.status === 'ok' ? (() => { const v = motor.stories.validateStoriesDocument(s.raw); return v.ok ? { status: 'ok', doc: v.value } : { status: 'invalid', doc: motor.stories.emptyStoriesDocument() }; })() : { status: s.status, doc: motor.stories.emptyStoriesDocument() };
  return { layout, backups: backups ?? motor.backups.emptyBackupsDocument(), backupsLegible: backups !== null && b.status !== 'corrupt', historias };
}

function escribir(dir, nombre, valor) {
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, NOMBRES[nombre]);
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(valor, null, 2), 'utf8');
  fs.renameSync(tmp, f);
}

/** Escribe en el ORDEN seguro: primero la copia previa, luego el borrador y las historias. */
export function escribirPlan(dir, plan) {
  escribir(dir, 'backups', plan.backups);
  escribir(dir, 'layout', plan.layout);
  if (plan.historias) escribir(dir, 'historias', plan.historias);
}

export const guardarUndo = (dir, undo) => escribir(dir, 'undo', undo);
export function leerUndo(dir) { const u = leer(dir, 'undo'); return u.status === 'ok' ? u.raw : null; }
export function borrarUndo(dir) { try { fs.unlinkSync(path.join(dir, NOMBRES.undo)); } catch { /* ya no existe */ } }

/** Relee lo escrito desde el disco (lector independiente de quien escribió). */
export function releer(motor, dir) { return leerEstado(motor, dir); }
