// Arnés de ESTRÉS del ledger entre PROCESOS (no es una prueba de la suite: se lanza a mano para validar E-1 en otra plataforma).
//   node automation/director/tests/_estres-ledger.mjs [rondas=30] [escritores=8] [eventos=20]
// Cada ronda: ledger nuevo en un directorio temporal propio; `escritores` procesos añaden `eventos` cada uno a la vez; después se comprueba
// integridad de la cadena, secuencias consecutivas, ningún evento perdido ni duplicado, orden interno de cada escritor, ausencia de cerrojo huérfano
// y, aparte, idempotencia entre procesos (el mismo idEvento escrito por varios procesos a la vez deja UN solo evento).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LedgerLocal } from '../ledger.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const [rondas = 30, escritores = 8, eventos = 20] = process.argv.slice(2).map(Number);
const lanzar = (script, args) => new Promise((resolve, reject) => {
  const p = spawn(process.execPath, [script, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; let err = '';
  p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
  p.on('close', (c) => (c === 0 ? resolve(JSON.parse(out)) : reject(new Error(`salida ${c}: ${err.slice(0, 200)}`))));
});

// escritor idempotente: todos escriben el MISMO evento con el MISMO idEvento
const idem = path.join(os.tmpdir(), `tai-idem-${process.pid}.mjs`);
fs.writeFileSync(idem, `import { LedgerLocal } from ${JSON.stringify(new URL('../ledger.mjs', import.meta.url).href)};
const [, , dir] = process.argv; const l = new LedgerLocal({ dir, raiz: '/__sin_raiz__', limites: { esperaBloqueoMs: 15000 } });
try { const r = l.anadir({ idEvento: 'evento-idempotente-0001', tipo: 'lectura_estado', actor: 'sistema', datos: { x: 1 } }); process.stdout.write(JSON.stringify({ ok: true, duplicado: r.duplicado === true })); } catch (e) { process.stdout.write(JSON.stringify({ ok: false, codigo: e.codigo || 'desconocido' })); }`);

const resumen = { plataforma: `${process.platform} ${os.release()}`, node: process.version, rondas, escritores, eventos, fallos: [], errores: 0, ms: 0 };
const t0 = Date.now();
for (let r = 1; r <= rondas; r++) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-estres-'));
  try {
    const res = await Promise.all(Array.from({ length: escritores }, (_, i) => lanzar(path.join(AQUI, '_escritor-ledger.mjs'), [dir, `W${i}`, String(eventos)])));
    const errs = res.reduce((a, x) => a + x.errores, 0);
    resumen.errores += errs;
    const l = new LedgerLocal({ dir, raiz: '/__sin_raiz__' });
    const v = l.verificarCadena();
    const evs = l.leer();
    const esperado = escritores * eventos;
    const problemas = [];
    if (errs) problemas.push(`${errs} errores de escritura: ${[...new Set(res.flatMap((x) => x.codigos))].slice(0, 3).join(' | ')}`);
    if (!v.ok) problemas.push(`cadena no íntegra: ${JSON.stringify(v).slice(0, 160)}`);
    if (evs.length !== esperado) problemas.push(`eventos ${evs.length} ≠ ${esperado}`);
    if (!evs.every((e, i) => e.secuencia === i + 1)) problemas.push('secuencias no consecutivas');
    const vistos = new Map();
    for (const e of evs) { const w = e.datos.escritor; if ((vistos.get(w) ?? -1) + 1 !== e.datos.n) { problemas.push(`orden roto en ${w}`); break; } vistos.set(w, e.datos.n); }
    if (new Set(evs.map((e) => e.idEvento)).size !== evs.length) problemas.push('idEvento repetido');
    if (fs.existsSync(l.cerrojo)) problemas.push('cerrojo huérfano');
    if (problemas.length) resumen.fallos.push({ ronda: r, problemas });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
// idempotencia entre procesos
let idemFallos = 0;
for (let r = 0; r < Math.max(5, Math.floor(rondas / 3)); r++) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-idem-'));
  try {
    const res = await Promise.all(Array.from({ length: 6 }, () => lanzar(idem, [dir])));
    const l = new LedgerLocal({ dir, raiz: '/__sin_raiz__' });
    const n = l.leer().filter((e) => e.idEvento === 'evento-idempotente-0001').length;
    if (n !== 1 || !res.every((x) => x.ok) || res.filter((x) => !x.duplicado).length !== 1 || !l.verificarCadena().ok) idemFallos++;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
fs.rmSync(idem, { force: true });
resumen.idempotenciaFallos = idemFallos;
resumen.ms = Date.now() - t0;
console.log(JSON.stringify(resumen, null, 1));
process.exit(resumen.fallos.length || idemFallos ? 1 : 0);
