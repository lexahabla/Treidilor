#!/usr/bin/env node
/**
 * Simulación de reparación del catálogo (NO escribe nada salvo con --out).
 *
 * Uso (siempre sobre una COPIA del products.json de producción):
 *   node --experimental-transform-types --import ./scripts/register-ts.mjs scripts/repair-catalog.mjs <products.json>
 *       -> informe en pantalla (dry-run); no escribe ficheros.
 *   ... <products.json> --find fineblue
 *       -> muestra marca de cabecera, «Marca» de specs y procedencia de los productos que contengan el texto.
 *   ... <products.json> --out reparado.json --rollback reversion.json
 *       -> escribe una COPIA reparada y el parche inverso. Nunca sobrescribe la entrada.
 *   ... reparado.json --undo reversion.json --out restaurado.json
 *       -> restaura los valores anteriores.
 *   ... <salida-terminal.txt> --c3 [--esperadas 6]
 *       -> VALIDACION C3 de una PROYECCION minima del catalogo real (docs/c3-validacion-copia-real.md): comprueba su integridad,
 *          simula SOLO `malformed-merchant` en memoria y evalua los criterios de aceptacion (informe agregado + cambios de `merchant`).
 *          No escribe nada. Sale con 0 si TODO se cumple («ACEPTADA») y con 1 si algo falla («DETENER»).
 *   ... <products.json> --solo malformed-merchant [--out ... --rollback ...]
 *       -> limita la simulación y la copia reparada a UN tipo de reparación (recomendado para C3: así la copia
 *          solo cambia el comercio «[object Object]» y no aplica ningún otro tipo de reparación).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { planRepairs, applyPlan, applyRollback } from '../src/lib/catalogRepair.ts';

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith('--') && fs.existsSync(a));
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!input) {
  console.error('Indica la ruta de un products.json (una copia, no el fichero vivo).');
  process.exit(1);
}
/* ── Validación C3 sobre la proyección mínima extraída del catálogo real (sin escribir nada) ───────────────────────────────── */
if (args.includes('--c3')) {
  const esperadas = Number(opt('esperadas') ?? 6);
  const texto = fs.readFileSync(input, 'utf8').replace(/\r/g, '');
  const criterios = [];
  const crit = (nombre, ok, detalle = '') => criterios.push({ nombre, ok: Boolean(ok), detalle });
  const mostrarCriterios = () => {
    console.log('== Criterios ==');
    for (const c of criterios) console.log(`${c.ok ? 'OK    ' : 'FALLA '} ${c.nombre}${c.detalle ? ' — ' + c.detalle : ''}`);
  };
  const detener = (motivo) => {
    mostrarCriterios();
    console.log(`\nRESULTADO: DETENER (${motivo}). No se autoriza ninguna reparación.`);
    process.exit(1);
  };
  // 1) Integridad de la proyección: cabecera, hash del bloque JSON y número de productos.
  const lineas = texto.split('\n').map((l) => l.trimEnd());
  const i0 = lineas.indexOf('-----JSON-----');
  const i1 = lineas.indexOf('-----FIN-----');
  if (i0 < 0 || i1 < i0) { crit('proyección con cabecera y marcadores', false, 'faltan -----JSON----- / -----FIN-----'); detener('entrada no válida'); }
  const cab = Object.fromEntries(lineas.slice(0, i0).filter((l) => /^#[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(1, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  const bloque = lineas.slice(i0 + 1, i1).join('\n');
  const hashBloque = crypto.createHash('sha256').update(bloque).digest('hex');
  crit('hash de la proyección coincide con el de la cabecera (copiado sin alteraciones)', cab.SHA256_PROYECCION === hashBloque, `cabecera ${cab.SHA256_PROYECCION ?? 'ausente'} · calculado ${hashBloque}`);
  let products = null;
  try { products = JSON.parse(bloque); } catch { /* se informa abajo */ }
  crit('la proyección es una lista JSON válida', Array.isArray(products));
  if (!criterios.every((c) => c.ok)) detener('integridad de la proyección');
  crit('número de productos coincide con la cabecera', String(products.length) === cab.TOTAL, `${products.length} frente a ${cab.TOTAL ?? 'ausente'}`);
  crit('el products.json original no cambió durante la extracción', cab.ORIGINAL_SIN_CAMBIOS === 'SI', `ORIGINAL_SIN_CAMBIOS=${cab.ORIGINAL_SIN_CAMBIOS ?? 'ausente'}`);
  const exactos = products.filter((p) => p.merchant === '[object Object]');
  crit('fichas con comercio exactamente «[object Object]» = esperadas', exactos.length === esperadas && String(exactos.length) === cab.MERCHANT_EXACTO, `${exactos.length} (cabecera ${cab.MERCHANT_EXACTO ?? 'ausente'}), esperadas ${esperadas}`);
  // 2) Simulación en memoria SOLO de `malformed-merchant`.
  const original = structuredClone(products);
  const plan = planRepairs(products);
  const items = plan.items.filter((i) => i.kind === 'malformed-merchant');
  const conParche = items.filter((i) => Object.keys(i.patch).length);
  const soloInforme = items.filter((i) => !Object.keys(i.patch).length);
  crit('todas las fichas «[object Object]» son reparables (ninguna queda solo en informe)', soloInforme.length === 0 && conParche.length === esperadas, `${conParche.length} con parche, ${soloInforme.length} solo informe`);
  crit('cada parche toca EXCLUSIVAMENTE `merchant` y es un texto no vacío', conParche.every((i) => Object.keys(i.patch).join() === 'merchant' && typeof i.patch.merchant === 'string' && i.patch.merchant.trim() !== '' && i.patch.merchant !== '[object Object]'));
  const mal = new Set(exactos.map((p) => String(p.id)));
  crit('los parches son exactamente de las fichas «[object Object]» (ninguna otra)', conParche.length === mal.size && conParche.every((i) => mal.has(i.id)));
  const { products: reparados, rollback } = applyPlan(products, { items, summary: plan.summary });
  // 3) Diferencias exactas entre la entrada y la copia reparada.
  const cambios = [];
  for (let k = 0; k < original.length; k++) {
    if (JSON.stringify(original[k]) !== JSON.stringify(reparados[k])) {
      const claves = [...new Set([...Object.keys(original[k]), ...Object.keys(reparados[k])])].filter((c) => JSON.stringify(original[k][c]) !== JSON.stringify(reparados[k][c]));
      cambios.push({ id: String(original[k].id), claves, antes: original[k].merchant, despues: reparados[k].merchant, red: original[k].network ?? null });
    }
  }
  crit('la copia reparada difiere del original SOLO en las fichas esperadas y SOLO en `merchant`', cambios.length === esperadas && cambios.every((c) => c.claves.join() === 'merchant' && mal.has(c.id)), `${cambios.length} fichas modificadas`);
  crit('la entrada no se modificó al simular', JSON.stringify(products) === JSON.stringify(original));
  crit('ya no queda ningún comercio «[object Object]» tras la reparación simulada', reparados.every((p) => p.merchant !== '[object Object]'));
  // 4) Reversibilidad e idempotencia (comparación exacta).
  const restaurados = applyRollback(reparados, rollback);
  crit('la reversión restaura el original EXACTO (comparación del JSON completo)', JSON.stringify(restaurados) === JSON.stringify(original));
  const segundo = planRepairs(reparados).items.filter((i) => i.kind === 'malformed-merchant');
  crit('idempotente: un segundo plan sobre la copia reparada no propone nada', segundo.length === 0, `${segundo.length} elementos`);
  // 5) Informe agregado (sin datos sensibles: solo id, red y comercio antes/después).
  console.log(`Proyección verificada: ${products.length} productos · SHA-256 del original ${cab.SHA256_ORIGINAL ?? 'ausente'}`);
  const porRed = {};
  for (const c of cambios) { const k = c.red ?? '(sin red)'; porRed[k] = (porRed[k] ?? 0) + 1; }
  const amazon = cambios.filter((c) => c.despues === 'Amazon').length;
  console.log(`Fichas a reparar: ${cambios.length} · por red declarada ${JSON.stringify(porRed)} · comercio resultante «Amazon»: ${amazon} · vendedor externo: ${cambios.length - amazon}`);
  console.log('== Cambios del campo merchant (únicos) ==');
  for (const c of cambios) console.log(`- ${c.id} [${c.red ?? '(sin red)'}]: «${c.antes}» → «${c.despues}»`);
  mostrarCriterios();
  if (criterios.every((c) => c.ok)) { console.log('\nRESULTADO: ACEPTADA (simulación sobre la proyección; no se ha modificado ningún dato).'); process.exit(0); }
  console.log('\nRESULTADO: DETENER (algún criterio falla). No se autoriza ninguna reparación.');
  process.exit(1);
}

const products = JSON.parse(fs.readFileSync(input, 'utf8'));
const out = opt('out');
if (out && path.resolve(out) === path.resolve(input)) {
  console.error('--out no puede ser el fichero de entrada.');
  process.exit(1);
}

if (opt('undo')) {
  const rollback = JSON.parse(fs.readFileSync(opt('undo'), 'utf8'));
  const restored = applyRollback(products, rollback);
  if (!out) { console.error('Falta --out para escribir el resultado.'); process.exit(1); }
  fs.writeFileSync(out, JSON.stringify(restored, null, 2));
  console.log(`Restaurados ${rollback.length} registros -> ${out}`);
  process.exit(0);
}

const find = opt('find');
if (find) {
  const needle = find.toLowerCase();
  const hits = products.filter((p) => JSON.stringify(p).toLowerCase().includes(needle));
  console.log(`${hits.length} producto(s) con «${find}»`);
  for (const p of hits) {
    const specs = p.specs ?? {};
    const specBrand = Object.entries(specs).find(([k]) => /^(marca|brand|fabricante)$/i.test(k.trim()));
    console.log(JSON.stringify({
      id: p.id, title: p.title, network: p.network, merchant: p.merchant,
      cabecera_brand: p.brand ?? null, specs_marca: specBrand ? specBrand[1] : null,
      fieldSources: p.extra?.fieldSources ?? null, lockedFields: p.extra?.lockedFields ?? null,
      importSource: p.extra?.importSource ?? null, sourceId: p.sourceId ?? p.asin ?? null,
    }, null, 2));
  }
  process.exit(0);
}

const fullPlan = planRepairs(products);
const solo = opt('solo');
const KINDS = Object.keys(fullPlan.summary);
if (solo && !KINDS.includes(solo)) {
  console.error(`--solo debe ser uno de: ${KINDS.join(', ')}`);
  process.exit(1);
}
const plan = solo
  ? { items: fullPlan.items.filter((item) => item.kind === solo), summary: Object.fromEntries(KINDS.map((k) => [k, k === solo ? fullPlan.summary[k] : 0])) }
  : fullPlan;
if (solo) console.log(`(solo «${solo}»: el resto de tipos de reparación NO se muestra ni se aplica)`);
console.log('Resumen de la simulación:', plan.summary);
for (const item of plan.items.slice(0, 200)) console.log(`- [${item.kind}] ${item.id}: ${item.detail}${Object.keys(item.patch).length ? '' : '  (sólo informe)'}`);

if (out) {
  const { products: repaired, rollback } = applyPlan(products, plan);
  const rollbackPath = opt('rollback') ?? out.replace(/\.json$/, '') + '.rollback.json';
  fs.writeFileSync(out, JSON.stringify(repaired, null, 2));
  fs.writeFileSync(rollbackPath, JSON.stringify(rollback, null, 2));
  console.log(`Copia reparada: ${out} · reversión: ${rollbackPath} (${rollback.length} registros tocados)`);
} else {
  console.log('\nDry-run: no se ha escrito nada. Usa --out para generar una copia reparada y su reversión.');
}
