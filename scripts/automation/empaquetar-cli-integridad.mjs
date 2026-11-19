#!/usr/bin/env node
/**
 * Treidilor AI · 3E.8.12 · EMPAQUETADO INDEPENDIENTE del CLI de integridad (el motor de verificación del prototipo). NO despliega nada y NO toca git, Docker ni la red.
 *   node scripts/automation/empaquetar-cli-integridad.mjs lista     [--prototipo <dir>]
 *   node scripts/automation/empaquetar-cli-integridad.mjs empaquetar --salida <dir FUERA del repositorio> [--version 0.1.0] [--prototipo <dir>]
 *   node scripts/automation/empaquetar-cli-integridad.mjs verificar <archivo.tar> <sha256>
 * REUTILIZA el código del prototipo tal cual (copia byte a byte del cierre de imports de `src/integridad-cli.mjs`; nada se duplica ni se modifica) y la maquinaria de TAR/lectura/secretos del empaquetador del Director.
 * Qué entra: solo `src/` alcanzado por imports estáticos desde el CLI, más un `package.json` generado. NUNCA entran pruebas, simulación, `autorizacionTest.mjs` (la vía de autorización «solo para tests»), datos, informes reales ni credenciales;
 * si el cierre alcanzara alguno de ellos, se ABORTA. Contrato: `MANIFIESTO.json` (formato `treidilor-integridad-cli-tar/1`) con contrato de salida `integridad-ejecucion/1`, versión del CLI, versión mínima del Director y el SHA-256 de cada archivo.
 * El prototipo se localiza con `--prototipo` o `TAI_PROTOTIPO_INCIDENCIAS`. El TAR es determinista.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cabecera, importsRelativos, leerArchivos, leerTar, RAIZ, rutaSegura, sha256Hex } from './empaquetar-director.mjs';
import { CONTRATO_CLI, FORMATO_MANIFIESTO_CLI } from '../../automation/director/integridad/cli-contrato.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const ENTRADA_CLI = 'src/integridad-cli.mjs';
export const DIRECTOR_MINIMO = '1.1.0';
export const VERSION_CLI = '0.1.0';
export const PROHIBIDOS = [/(^|\/)autorizacionTest\.mjs$/, /(^|\/)simulacion(\/|$)/, /(^|\/)test(s)?(\/|$)/, /\.test\.mjs$/, /(^|\/)fixtures(\/|$)/, /ex37/i, /informe-real/i, /(^|\/)\.env/];
export const PROTOTIPO_DEFECTO = path.resolve(AQUI, '..', '..', '..', 'treidilor-ai', 'prototipo-incidencias-director');
const rutaPermitidaCli = (r) => r === 'package.json' || r.startsWith('src/');

/** Cierre de imports relativos desde el CLI. Aborta ante un import irresoluble, no `.mjs`, fuera de `src/` o prohibido. */
export function calcularArchivosCli(prototipo = process.env.TAI_PROTOTIPO_INCIDENCIAS || PROTOTIPO_DEFECTO) {
  const raiz = path.resolve(prototipo); const set = new Set(); const cola = [ENTRADA_CLI];
  if (!fs.existsSync(path.join(raiz, ENTRADA_CLI))) throw new Error(`No existe ${ENTRADA_CLI} en el prototipo indicado`);
  while (cola.length) {
    const f = cola.pop(); if (set.has(f)) continue;
    if (PROHIBIDOS.some((rx) => rx.test(f))) throw new Error(`El cierre de imports alcanza un archivo prohibido: ${f}`);
    if (!rutaSegura(f) || !f.startsWith('src/') || !f.endsWith('.mjs')) throw new Error(`Ruta no permitida en el CLI: ${f}`);
    const st = fs.statSync(path.join(raiz, f), { throwIfNoEntry: false }); if (!st || !st.isFile() || fs.lstatSync(path.join(raiz, f)).isSymbolicLink()) throw new Error(`Import irresoluble o enlace: ${f}`);
    set.add(f);
    for (const spec of importsRelativos(fs.readFileSync(path.join(raiz, f), 'utf8'))) cola.push(path.posix.normalize(path.posix.join(path.posix.dirname(f), spec)));
  }
  return [...set].sort();
}

export function prepararPaqueteCli(prototipo = process.env.TAI_PROTOTIPO_INCIDENCIAS || PROTOTIPO_DEFECTO, version = VERSION_CLI) {
  const archivos = leerArchivos(path.resolve(prototipo), calcularArchivosCli(prototipo));
  archivos.push({ ruta: 'package.json', contenido: Buffer.from(`${JSON.stringify({ name: 'treidilor-integridad-cli', private: true, type: 'module', version }, null, 2)}\n`, 'utf8') });
  return archivos;
}
export function construirManifiestoCli(archivos, version = VERSION_CLI) {
  const ord = [...archivos].sort((a, b) => (a.ruta < b.ruta ? -1 : a.ruta > b.ruta ? 1 : 0));
  return { formato: FORMATO_MANIFIESTO_CLI, version, versionCli: version, contrato: CONTRATO_CLI, directorMinimo: DIRECTOR_MINIMO, nodeMinimo: '22', entrada: ENTRADA_CLI, archivos: ord.map((a) => ({ ruta: a.ruta, sha256: sha256Hex(a.contenido), bytes: a.contenido.length })) };
}
/** TAR determinista (misma cabecera ustar que el del Director): MANIFIESTO.json primero y los archivos por orden alfabético. */
export function construirTarCli(archivos, version = VERSION_CLI) {
  const ord = [...archivos].sort((a, b) => (a.ruta < b.ruta ? -1 : a.ruta > b.ruta ? 1 : 0));
  for (const a of ord) if (!rutaSegura(a.ruta) || !rutaPermitidaCli(a.ruta)) throw new Error(`Ruta no permitida en el paquete del CLI: ${a.ruta}`);
  const man = Buffer.from(`${JSON.stringify(construirManifiestoCli(ord, version), null, 1)}\n`, 'utf8'); const trozos = [];
  for (const { ruta, contenido } of [{ ruta: 'MANIFIESTO.json', contenido: man }, ...ord]) trozos.push(cabecera(ruta, contenido.length), contenido, Buffer.alloc((512 - (contenido.length % 512)) % 512, 0));
  trozos.push(Buffer.alloc(1024, 0)); return Buffer.concat(trozos);
}
/** Verifica un TAR de CLI contra su SHA-256 y su manifiesto (formato, contrato, entrada, rutas seguras, nada de más ni de menos, ningún archivo prohibido). */
export function verificarTarCli(buf, shaEsperado = null) {
  const errores = []; const sha = sha256Hex(buf); if (shaEsperado !== null && String(shaEsperado).trim().toLowerCase() !== sha) errores.push(`SHA-256 del TAR distinto del esperado (${sha})`);
  let entradas; try { entradas = leerTar(buf); } catch (e) { return { ok: false, errores: [...errores, e.message], sha256: sha, archivos: 0 }; }
  const rutas = entradas.map((e) => e.ruta); if (new Set(rutas).size !== rutas.length) errores.push('Rutas duplicadas en el TAR'); if (rutas[0] !== 'MANIFIESTO.json') errores.push('El manifiesto no es la primera entrada');
  for (const r of rutas) if (r !== 'MANIFIESTO.json' && (!rutaSegura(r) || !rutaPermitidaCli(r) || PROHIBIDOS.some((rx) => rx.test(r)))) errores.push(`Ruta no permitida: ${r}`);
  let man = null; try { man = JSON.parse(String(entradas.find((e) => e.ruta === 'MANIFIESTO.json')?.contenido ?? '')); } catch { errores.push('Manifiesto ilegible'); }
  if (man) {
    if (man.formato !== FORMATO_MANIFIESTO_CLI) errores.push(`Formato de manifiesto «${man.formato}»`); if (man.contrato !== CONTRATO_CLI) errores.push(`Contrato «${man.contrato}»`); if (man.entrada !== ENTRADA_CLI) errores.push('Entrada distinta de la prevista');
    const previstos = new Map((man.archivos ?? []).map((a) => [a.ruta, a])); if (previstos.size !== (man.archivos ?? []).length) errores.push('Rutas duplicadas en el manifiesto');
    for (const e of entradas) { if (e.ruta === 'MANIFIESTO.json') continue; const p = previstos.get(e.ruta); if (!p) { errores.push(`Archivo fuera del manifiesto: ${e.ruta}`); continue; } if (p.bytes !== e.contenido.length || p.sha256 !== sha256Hex(e.contenido)) errores.push(`Contenido distinto del manifiesto: ${e.ruta}`); }
    for (const r of previstos.keys()) if (!rutas.includes(r)) errores.push(`Falta un archivo del manifiesto: ${r}`);
  }
  return { ok: errores.length === 0, errores, sha256: sha, archivos: Math.max(rutas.length - 1, 0), version: man?.versionCli ?? null };
}

export function main(argv = process.argv.slice(2)) {
  const [orden, ...resto] = argv; const opc = (n) => { const i = resto.indexOf(`--${n}`); return i >= 0 ? resto[i + 1] : undefined; }; const proto = opc('prototipo') ?? (process.env.TAI_PROTOTIPO_INCIDENCIAS || PROTOTIPO_DEFECTO);
  if (orden === 'lista') { for (const r of calcularArchivosCli(proto)) console.log(r); return 0; }
  if (orden === 'empaquetar') {
    const salida = opc('salida'); const version = opc('version') ?? VERSION_CLI; if (!salida) { console.error('Falta --salida <directorio FUERA del repositorio>'); return 2; }
    const destino = path.resolve(salida); const rel = path.relative(RAIZ, destino); if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) { console.error('La salida debe estar FUERA del repositorio.'); return 2; }
    const tar = construirTarCli(prepararPaqueteCli(proto, version), version); const v = verificarTarCli(tar, null); if (!v.ok) { console.error(`El TAR recién construido NO verifica: ${v.errores.join('; ')}`); return 1; }
    fs.mkdirSync(destino, { recursive: true }); const nombre = `treidilor-integridad-cli-${version}.tar`;
    fs.writeFileSync(path.join(destino, nombre), tar, { flag: 'wx' }); fs.writeFileSync(path.join(destino, `${nombre}.sha256`), `${v.sha256}  ${nombre}\n`, { flag: 'wx' });
    console.log(`TAR: ${path.join(destino, nombre)}\nSHA-256: ${v.sha256}\nArchivos: ${v.archivos}`); return 0;
  }
  if (orden === 'verificar') { const [archivo, sha] = resto; if (!archivo || !sha) { console.error('Uso: verificar <archivo.tar> <sha256>'); return 2; } const v = verificarTarCli(fs.readFileSync(archivo), sha); console.log(v.ok ? `VERIFICADO: ${v.archivos} archivos, SHA-256 ${v.sha256}, CLI ${v.version}` : `NO VERIFICA:\n- ${v.errores.join('\n- ')}`); return v.ok ? 0 : 1; }
  console.error('Uso: empaquetar-cli-integridad.mjs lista | empaquetar --salida <dir> [--version v] | verificar <tar> <sha256>'); return 2;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
