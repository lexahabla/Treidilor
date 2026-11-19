/**
 * Agente 00 · 3E.8.12 · CONTRATO entre el Director y el CLI de integridad INDEPENDIENTE (paquete aparte).
 *
 * Versiones: `VERSION_DIRECTOR` es la versión del conjunto de integridad que ofrece ESTE Director; `CONTRATO_CLI` es la salida que sabe interpretar (`integridad-ejecucion/1`).
 * Un paquete de CLI lleva `MANIFIESTO.json` en su raíz (formato `treidilor-integridad-cli-tar/1`) con: `contrato` (debe ser el mismo), `versionCli`, `directorMinimo` (≤ VERSION_DIRECTOR),
 * `entrada` (la ruta relativa del comando dentro del paquete) y el SHA-256 de CADA archivo. El CLI vive en `<raiz>/src/integridad-cli.mjs`; la raíz es dos niveles por encima.
 *
 * Comportamiento: sin manifiesto → permitido solo si la activación no exige manifiesto (desarrollo/pruebas); con manifiesto, TODO debe cuadrar: contrato, versión, entrada, hash de cada archivo y ningún archivo de más.
 * Cualquier otra cosa → `{ ok:false, motivo }` y el Director no lanza nada. No ejecuta, no escribe y no sigue enlaces fuera de la raíz.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const VERSION_DIRECTOR = '1.1.0';
export const CONTRATO_CLI = 'integridad-ejecucion/1';
export const FORMATO_MANIFIESTO_CLI = 'treidilor-integridad-cli-tar/1';
const MAX_ARCHIVOS = 500; const MAX_MANIFIESTO = 1048576;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const rutaSegura = (r) => typeof r === 'string' && r.length > 0 && r.length <= 240 && !r.includes('\\') && !r.includes('\0') && !r.startsWith('/') && !/^[A-Za-z]:/.test(r) && r.split('/').every((s) => s !== '' && s !== '.' && s !== '..');

/** Compara versiones «a.b.c» (solo numéricas). → -1 | 0 | 1 | null si alguna no es válida. */
export function compararVersiones(a, b) {
  const p = (v) => (/^\d+\.\d+\.\d+$/.test(String(v)) ? String(v).split('.').map(Number) : null); const x = p(a); const y = p(b); if (!x || !y) return null;
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1; return 0;
}

function listar(raiz) {
  const salida = []; const pila = [''];
  while (pila.length) {
    const rel = pila.pop(); let ents; try { ents = fs.readdirSync(path.join(raiz, rel), { withFileTypes: true }); } catch { return null; }
    for (const e of ents) { const r = rel ? `${rel}/${e.name}` : e.name; if (e.isSymbolicLink()) return null; if (e.isDirectory()) pila.push(r); else if (e.isFile()) salida.push(r); else return null; if (salida.length > MAX_ARCHIVOS) return null; }
  }
  return salida;
}

/** @returns {{ok:boolean, verificado:boolean, motivo?:string, versionCli?:string}} */
export function comprobarCli({ cli, exigir = false, versionDirector = VERSION_DIRECTOR, contrato = CONTRATO_CLI }) {
  if (typeof cli !== 'string' || !path.isAbsolute(cli)) return { ok: false, verificado: false, motivo: 'cli_ruta_invalida' };
  const raiz = path.dirname(path.dirname(cli)); const fm = path.join(raiz, 'MANIFIESTO.json'); const st = fs.statSync(fm, { throwIfNoEntry: false });
  if (!st) return exigir ? { ok: false, verificado: false, motivo: 'cli_sin_manifiesto' } : { ok: true, verificado: false };
  if (!st.isFile() || st.size > MAX_MANIFIESTO) return { ok: false, verificado: false, motivo: 'cli_manifiesto_ilegible' };
  let m; try { m = JSON.parse(fs.readFileSync(fm, 'utf8')); } catch { return { ok: false, verificado: false, motivo: 'cli_manifiesto_ilegible' }; }
  if (!m || m.formato !== FORMATO_MANIFIESTO_CLI || !Array.isArray(m.archivos) || typeof m.entrada !== 'string') return { ok: false, verificado: false, motivo: 'cli_manifiesto_invalido' };
  if (m.contrato !== contrato) return { ok: false, verificado: false, motivo: 'cli_incompatible:contrato' };
  const c = compararVersiones(m.directorMinimo, versionDirector); if (c === null || c > 0) return { ok: false, verificado: false, motivo: 'cli_incompatible:version_del_director' };
  if (compararVersiones(m.versionCli, '0.0.0') === null) return { ok: false, verificado: false, motivo: 'cli_manifiesto_invalido' };
  if (path.relative(raiz, cli).split(path.sep).join('/') !== m.entrada) return { ok: false, verificado: false, motivo: 'cli_no_es_la_entrada_del_paquete' };
  const previstos = new Map(); for (const a of m.archivos) { if (!a || !rutaSegura(a.ruta) || !/^[0-9a-f]{64}$/.test(a.sha256) || previstos.has(a.ruta)) return { ok: false, verificado: false, motivo: 'cli_manifiesto_invalido' }; previstos.set(a.ruta, a); }
  if (!previstos.has(m.entrada)) return { ok: false, verificado: false, motivo: 'cli_manifiesto_invalido' };
  const reales = listar(raiz); if (!reales) return { ok: false, verificado: false, motivo: 'cli_estructura_no_permitida' };
  const presentes = new Set(reales.filter((r) => r !== 'MANIFIESTO.json'));
  for (const r of presentes) if (!previstos.has(r)) return { ok: false, verificado: false, motivo: 'cli_archivos_inesperados' };
  for (const [r, a] of previstos) { if (!presentes.has(r)) return { ok: false, verificado: false, motivo: 'cli_archivo_ausente' }; let b; try { b = fs.readFileSync(path.join(raiz, r)); } catch { return { ok: false, verificado: false, motivo: 'cli_archivo_ilegible' }; } if (sha(b) !== a.sha256 || b.length !== a.bytes) return { ok: false, verificado: false, motivo: 'cli_archivo_alterado' }; }
  return { ok: true, verificado: true, versionCli: m.versionCli };
}
