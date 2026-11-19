#!/usr/bin/env node
/**
 * Treidilor AI · Agente 00 · EMPAQUETADO del Director (D-3 provisional: TAR verificado con SHA-256). 17/11/2026. NO despliega nada y NO toca git, Docker ni la red.
 *   node scripts/automation/empaquetar-director.mjs empaquetar --salida <dir FUERA del repositorio> [--version <v>]
 *   node scripts/automation/empaquetar-director.mjs verificar <archivo.tar> <sha256>
 *   node scripts/automation/empaquetar-director.mjs lista                      (qué entraría en el TAR, sin escribir nada)
 * Qué entra: la consola `scripts/automation/director.mjs`, TODO `automation/director/` (sin pruebas) y lo que esos módulos importan (p. ej. `automation/lib/*`), más `automation/config/local.json`
 * (que el Director lee por ruta, no por import). NUNCA entran `src/`, `public/`, datos, `.env`, credenciales ni `node_modules`; un archivo con forma de credencial ABORTA el empaquetado.
 * El TAR es DETERMINISTA (orden, fechas, propietarios y modos fijos): el mismo código da el mismo SHA-256. Lleva un `MANIFIESTO.json` con el hash de cada archivo y `verificar` rechaza cualquier diferencia.
 * Limitación conocida: los imports dinámicos con ruta calculada (los motores de los Agentes 03 y 05–11 cargan módulos de `src/lib` de la web) NO se siguen: esos motores no funcionan dentro de la imagen
 * y la imagen solo ofrece lo que no los necesita (lectura de informes de 04 y 12, registro, ledger, canal). Es intencionado: «L0 de solo lectura».
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectarSecreto } from '../../automation/director/ledger.mjs';
import { CONFIG_DEFECTO } from '../../automation/director/config.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const RAIZ = path.resolve(AQUI, '..', '..');
export const FORMATO = 'treidilor-director-tar/1';
export const ENTRADAS = ['scripts/automation/director.mjs'];
export const DIRECTORIOS = ['automation/director'];
export const EXTRAS = ['automation/config/local.json'];
export const EXCLUIDOS = [/(^|\/)tests(\/|$)/, /\.test\.mjs$/, /(^|\/)node_modules(\/|$)/, /(^|\/)\.git(\/|$)/, /\.(log|bak|tmp|tar|zip)$/i, /(^|\/)\.env/, /(^|\/)integridad-activacion[^/]*\.json$/];
export const PREFIJOS_PERMITIDOS = ['automation/', 'scripts/automation/'];
export const LIMITES = Object.freeze({ archivos: 600, bytesTotal: 24 * 1024 * 1024, bytesArchivo: 4 * 1024 * 1024 });
const EXTENSIONES_TEXTO = new Set(['.mjs', '.json', '.md', '.txt']);

export const sha256Hex = (b) => crypto.createHash('sha256').update(b).digest('hex');
const posix = (p) => p.split(path.sep).join('/');
const excluido = (rel) => EXCLUIDOS.some((rx) => rx.test(rel));

/** ¿Es una ruta relativa segura para guardar en el TAR? (sin absolutas, `..`, `\`, unidades ni NUL). */
export function rutaSegura(r) {
  if (typeof r !== 'string' || !r || r.length > 240) return false;
  if (r.includes('\\') || r.includes('\0') || r.startsWith('/') || /^[A-Za-z]:/.test(r)) return false;
  return r.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}
const rutaPermitida = (r) => r === 'package.json' || PREFIJOS_PERMITIDOS.some((p) => r.startsWith(p));

function listarDirectorio(raiz, rel, salida) {
  for (const e of fs.readdirSync(path.join(raiz, rel), { withFileTypes: true })) {
    const r = `${rel}/${e.name}`;
    if (excluido(r)) continue;
    if (e.isSymbolicLink()) throw new Error(`Enlace simbólico no permitido: ${r}`);
    if (e.isDirectory()) listarDirectorio(raiz, r, salida);
    else if (e.isFile()) salida.add(r);
  }
}
const RX_IMPORTS = [
  /(?:^|[\n;])\s*(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
  /(?:^|[\n;])\s*import\s*['"]([^'"]+)['"]/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
];
/** Imports RELATIVOS de un módulo (los `node:` y los paquetes se ignoran). */
export function importsRelativos(texto) {
  const s = new Set();
  for (const rx of RX_IMPORTS) { rx.lastIndex = 0; let m; while ((m = rx.exec(texto)) !== null) if (m[1].startsWith('.')) s.add(m[1]); }
  return [...s];
}
/** Conjunto ORDENADO de rutas (relativas, con `/`) que forman el paquete: entradas + directorios + extras + cierre de imports. Lanza ante un import no resoluble, fuera de lo permitido o hacia `.ts`. */
export function calcularArchivos(raiz = RAIZ) {
  const set = new Set();
  for (const d of DIRECTORIOS) listarDirectorio(raiz, d, set);
  for (const f of [...ENTRADAS, ...EXTRAS]) { if (!fs.existsSync(path.join(raiz, f))) throw new Error(`Falta ${f}`); set.add(f); }
  const cola = [...set].filter((f) => f.endsWith('.mjs'));
  const vistos = new Set();
  while (cola.length) {
    const f = cola.pop();
    if (vistos.has(f)) continue;
    vistos.add(f);
    for (const spec of importsRelativos(fs.readFileSync(path.join(raiz, f), 'utf8'))) {
      const dest = path.posix.normalize(path.posix.join(path.posix.dirname(f), spec));
      if (dest.endsWith('.ts')) throw new Error(`${f} importa TypeScript (${spec}): no cabe en el paquete`);
      if (!rutaSegura(dest) || !rutaPermitida(dest)) throw new Error(`${f} importa «${spec}», que queda fuera de lo permitido (${PREFIJOS_PERMITIDOS.join(', ')})`);
      if (excluido(dest)) throw new Error(`${f} importa «${spec}», que está excluido del paquete`);
      if (!fs.existsSync(path.join(raiz, dest)) || !fs.statSync(path.join(raiz, dest)).isFile()) throw new Error(`${f} importa «${spec}» y ${dest} no existe`);
      if (!set.has(dest)) { set.add(dest); if (dest.endsWith('.mjs')) cola.push(dest); }
    }
  }
  return [...set].sort();
}

/** Lee el contenido, comprueba límites y rechaza archivos de texto con forma de credencial. */
export function leerArchivos(raiz, rutas) {
  if (rutas.length > LIMITES.archivos) throw new Error(`Demasiados archivos (${rutas.length} > ${LIMITES.archivos})`);
  let total = 0;
  const salida = rutas.map((ruta) => {
    const contenido = fs.readFileSync(path.join(raiz, ruta));
    if (contenido.length > LIMITES.bytesArchivo) throw new Error(`${ruta} supera ${LIMITES.bytesArchivo} bytes`);
    total += contenido.length;
    if (EXTENSIONES_TEXTO.has(path.posix.extname(ruta))) {
      const patron = detectarSecreto(contenido.toString('utf8'));
      if (patron) throw new Error(`${ruta} contiene algo con forma de credencial (${patron}): se aborta el empaquetado`);
    }
    return { ruta, contenido };
  });
  if (total > LIMITES.bytesTotal) throw new Error(`El paquete supera ${LIMITES.bytesTotal} bytes`);
  return salida;
}

export function construirManifiesto(archivos, version) {
  return { formato: FORMATO, version, archivos: archivos.map((a) => ({ ruta: a.ruta, sha256: sha256Hex(a.contenido), bytes: a.contenido.length })) };
}

// ───────────── TAR (ustar) determinista, sin dependencias ─────────────
const octal = (n, len) => `${n.toString(8).padStart(len - 1, '0')}\0`;
export function cabecera(ruta, tamano) {
  const h = Buffer.alloc(512, 0);
  let nombre = ruta; let prefijo = '';
  if (Buffer.byteLength(ruta) > 100) {
    nombre = '';
    for (let k = ruta.indexOf('/'); k !== -1; k = ruta.indexOf('/', k + 1)) {
      const p = ruta.slice(0, k); const n = ruta.slice(k + 1);
      if (Buffer.byteLength(n) <= 100 && Buffer.byteLength(p) <= 155) { prefijo = p; nombre = n; break; }
    }
    if (!nombre) throw new Error(`Ruta demasiado larga para ustar: ${ruta}`);
  }
  h.write(nombre, 0, 100, 'utf8');
  h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
  h.write(octal(tamano, 12), 124); h.write(octal(0, 12), 136);
  h.fill(0x20, 148, 156);
  h.write('0', 156); h.write('ustar\0', 257); h.write('00', 263); h.write('root', 265); h.write('root', 297);
  h.write(prefijo, 345, 155, 'utf8');
  let suma = 0; for (const b of h) suma += b;
  h.write(`${suma.toString(8).padStart(6, '0')}\0 `, 148);
  return h;
}
/** TAR determinista: MANIFIESTO.json primero y luego los archivos por orden alfabético. Fechas 0, propietario root, modo 0644. */
export function construirTar(archivos, version = CONFIG_DEFECTO.version) {
  const ordenados = [...archivos].sort((a, b) => (a.ruta < b.ruta ? -1 : a.ruta > b.ruta ? 1 : 0));
  for (const a of ordenados) if (!rutaSegura(a.ruta) || !rutaPermitida(a.ruta)) throw new Error(`Ruta no permitida en el paquete: ${a.ruta}`);
  const manifiesto = Buffer.from(`${JSON.stringify(construirManifiesto(ordenados, version), null, 1)}\n`, 'utf8');
  const trozos = [];
  for (const { ruta, contenido } of [{ ruta: 'MANIFIESTO.json', contenido: manifiesto }, ...ordenados]) {
    trozos.push(cabecera(ruta, contenido.length), contenido, Buffer.alloc((512 - (contenido.length % 512)) % 512, 0));
  }
  trozos.push(Buffer.alloc(1024, 0));
  return Buffer.concat(trozos);
}
/** Lee un TAR ustar y lo VALIDA estrictamente: solo archivos regulares, suma de comprobación correcta, sin truncar y con terminador. */
export function leerTar(buf) {
  const salida = []; let pos = 0; let ceros = 0;
  while (pos + 512 <= buf.length) {
    const h = buf.subarray(pos, pos + 512);
    if (h.every((b) => b === 0)) { ceros += 1; pos += 512; if (ceros >= 2) break; continue; }
    ceros = 0;
    const guardada = parseInt(h.toString('ascii', 148, 156).replace(/[\0 ]+$/, '').trim(), 8);
    let suma = 0; for (let i = 0; i < 512; i++) suma += i >= 148 && i < 156 ? 0x20 : h[i];
    if (!Number.isFinite(guardada) || guardada !== suma) throw new Error('Suma de comprobación de una cabecera incorrecta');
    const tipo = String.fromCharCode(h[156]);
    if (tipo !== '0' && tipo !== '\0') throw new Error(`Tipo de entrada no permitido «${tipo}» (solo archivos regulares)`);
    if (h.toString('ascii', 257, 262) !== 'ustar') throw new Error('Formato distinto de ustar');
    const nombre = h.toString('utf8', 0, 100).split('\0')[0];
    const prefijo = h.toString('utf8', 345, 500).split('\0')[0];
    const tamano = parseInt(h.toString('ascii', 124, 135).trim(), 8);
    if (!Number.isFinite(tamano) || tamano < 0) throw new Error('Tamaño de entrada ilegible');
    const ini = pos + 512; const fin = ini + tamano;
    if (fin > buf.length) throw new Error('TAR truncado');
    salida.push({ ruta: prefijo ? `${prefijo}/${nombre}` : nombre, contenido: buf.subarray(ini, fin) });
    pos = ini + Math.ceil(tamano / 512) * 512;
  }
  if (ceros < 2) throw new Error('El TAR no termina con dos bloques vacíos');
  if (!buf.subarray(pos).every((b) => b === 0)) throw new Error('Datos tras el terminador del TAR');
  return salida;
}
/** Verifica un TAR contra su SHA-256 y contra su manifiesto: nada de más, nada de menos, nada distinto. */
export function verificarTar(buf, shaEsperado = null) {
  const errores = [];
  const sha = sha256Hex(buf);
  if (shaEsperado !== null && String(shaEsperado).trim().toLowerCase() !== sha) errores.push(`SHA-256 del TAR distinto del esperado (${sha})`);
  let entradas;
  try { entradas = leerTar(buf); } catch (e) { return { ok: false, errores: [...errores, e.message], sha256: sha, archivos: 0 }; }
  const rutas = entradas.map((e) => e.ruta);
  if (new Set(rutas).size !== rutas.length) errores.push('Rutas duplicadas en el TAR');
  for (const r of rutas) if (r !== 'MANIFIESTO.json' && (!rutaSegura(r) || !rutaPermitida(r))) errores.push(`Ruta no permitida: ${r}`);
  if (rutas[0] !== 'MANIFIESTO.json') errores.push('El manifiesto no es la primera entrada');
  let man = null;
  try { man = JSON.parse(String(entradas.find((e) => e.ruta === 'MANIFIESTO.json')?.contenido ?? '')); } catch { errores.push('Manifiesto ilegible'); }
  if (man) {
    if (man.formato !== FORMATO) errores.push(`Formato de manifiesto «${man.formato}»`);
    const previstos = new Map((man.archivos ?? []).map((a) => [a.ruta, a]));
    if (previstos.size !== (man.archivos ?? []).length) errores.push('Rutas duplicadas en el manifiesto');
    for (const e of entradas) {
      if (e.ruta === 'MANIFIESTO.json') continue;
      const p = previstos.get(e.ruta);
      if (!p) { errores.push(`Archivo fuera del manifiesto: ${e.ruta}`); continue; }
      if (p.bytes !== e.contenido.length || p.sha256 !== sha256Hex(e.contenido)) errores.push(`Contenido distinto del manifiesto: ${e.ruta}`);
    }
    for (const r of previstos.keys()) if (!rutas.includes(r)) errores.push(`Falta un archivo del manifiesto: ${r}`);
  }
  if (rutas.length > LIMITES.archivos + 1) errores.push('Demasiados archivos');
  return { ok: errores.length === 0, errores, sha256: sha, archivos: Math.max(rutas.length - 1, 0), version: man?.version ?? null };
}

/** Archivos del paquete (incluye `package.json` mínimo, generado, para que Node trate todo como ESM). */
export function prepararPaquete(raiz = RAIZ, version = CONFIG_DEFECTO.version) {
  const archivos = leerArchivos(raiz, calcularArchivos(raiz));
  archivos.push({ ruta: 'package.json', contenido: Buffer.from(`${JSON.stringify({ name: 'treidilor-director', private: true, type: 'module', version }, null, 2)}\n`, 'utf8') });
  return archivos;
}

export function main(argv = process.argv.slice(2)) {
  const [orden, ...resto] = argv;
  const opc = (n) => { const i = resto.indexOf(`--${n}`); return i >= 0 ? resto[i + 1] : undefined; };
  if (orden === 'lista') { for (const r of calcularArchivos()) console.log(r); return 0; }
  if (orden === 'empaquetar') {
    const salida = opc('salida');
    const version = opc('version') ?? CONFIG_DEFECTO.version;
    if (!salida) { console.error('Falta --salida <directorio FUERA del repositorio>'); return 2; }
    const destino = path.resolve(salida);
    const rel = path.relative(RAIZ, destino);
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) { console.error('La salida debe estar FUERA del repositorio (el TAR no se versiona).'); return 2; }
    const tar = construirTar(prepararPaquete(RAIZ, version), version);
    const v = verificarTar(tar, null);
    if (!v.ok) { console.error(`El TAR recién construido NO verifica: ${v.errores.join('; ')}`); return 1; }
    fs.mkdirSync(destino, { recursive: true });
    const nombre = `treidilor-director-${version}.tar`;
    fs.writeFileSync(path.join(destino, nombre), tar, { flag: 'wx' });
    fs.writeFileSync(path.join(destino, `${nombre}.sha256`), `${v.sha256}  ${nombre}\n`, { flag: 'wx' });
    console.log(`TAR: ${path.join(destino, nombre)}\nSHA-256: ${v.sha256}\nArchivos: ${v.archivos}`);
    return 0;
  }
  if (orden === 'verificar') {
    const [archivo, sha] = resto;
    if (!archivo || !sha) { console.error('Uso: verificar <archivo.tar> <sha256>'); return 2; }
    const v = verificarTar(fs.readFileSync(archivo), sha);
    console.log(v.ok ? `VERIFICADO: ${v.archivos} archivos, SHA-256 ${v.sha256}, versión ${v.version}` : `NO VERIFICA:\n- ${v.errores.join('\n- ')}`);
    return v.ok ? 0 : 1;
  }
  console.error('Uso: empaquetar-director.mjs lista | empaquetar --salida <dir> [--version v] | verificar <tar> <sha256>');
  return 2;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
