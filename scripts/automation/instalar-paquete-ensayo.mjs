#!/usr/bin/env node
/**
 * Treidilor AI · 3E.8.12 · INSTALADOR DE ENSAYO (solo pruebas locales; NO sustituye a `instalar.sh` de director-dist, que construye una imagen Docker en el servidor y no se ha ejecutado).
 * Simula el contrato de instalación sobre una carpeta de pruebas: verifica (firma en PROCESO INDEPENDIENTE + SHA-256 + manifiesto), extrae a `<base>/versiones/<version>` sin sobrescribir nada, y mueve los punteros
 * `actual`/`anterior` (archivos de texto, escritura atómica). `revertir` intercambia los punteros. NUNCA toca el directorio de DATOS (ledger, activación, solicitudes): vive aparte y nada de aquí lo conoce.
 *   node instalar-paquete-ensayo.mjs instalar --base <dir> --tar <t> --firma <f> --publica <pem> --tipo director|cli [--sha256 <hex>]
 *   node instalar-paquete-ensayo.mjs revertir --base <dir>
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { leerTar, verificarTar } from './empaquetar-director.mjs';
import { verificarTarCli } from './empaquetar-cli-integridad.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url)); const VERIFICADOR = path.join(AQUI, 'verificar-firma-paquete.mjs');
const RX_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;
const escribirAtomico = (f, texto) => { const t = `${f}.tmp-${crypto.randomBytes(4).toString('hex')}`; fs.writeFileSync(t, texto, { flag: 'wx' }); fs.renameSync(t, f); };
const leerPuntero = (f) => { try { const v = fs.readFileSync(f, 'utf8').trim(); return RX_VERSION.test(v) ? v : null; } catch { return null; } };

/** @returns {{ok:boolean, motivo?:string, detalle?:string[], version?:string, destino?:string}} Nunca lanza para errores esperados. */
export function instalarEnsayo({ base, tar, firma, publica, tipo, sha256 = null, verificador = VERIFICADOR }) {
  if (!['director', 'cli'].includes(tipo)) return { ok: false, motivo: 'tipo_invalido' };
  let buf; try { buf = fs.readFileSync(tar); } catch { return { ok: false, motivo: 'paquete_ilegible' }; }
  const f = spawnSync(process.execPath, [verificador, tar, firma, publica], { encoding: 'utf8', timeout: 60000 }); // proceso independiente, sin importar nada de este código
  if (f.status !== 0) return { ok: false, motivo: 'firma_no_verifica', detalle: String(f.stdout).split('\n').filter(Boolean).slice(0, 6) };
  const esperado = sha256 ?? (() => { try { return fs.readFileSync(`${tar}.sha256`, 'utf8').trim().split(/\s+/)[0]; } catch { return null; } })(); if (!esperado) return { ok: false, motivo: 'sin_sha256_esperado' };
  const v = tipo === 'director' ? verificarTar(buf, esperado) : verificarTarCli(buf, esperado); if (!v.ok) return { ok: false, motivo: 'paquete_no_verifica', detalle: v.errores.slice(0, 6) };
  const version = tipo === 'director' ? v.version : v.version; if (!version || !RX_VERSION.test(version)) return { ok: false, motivo: 'version_invalida' };
  const dirVersiones = path.join(base, 'versiones'); const destino = path.join(dirVersiones, version); if (fs.existsSync(destino)) return { ok: false, motivo: 'version_ya_instalada' }; // no se sobrescribe nada
  fs.mkdirSync(dirVersiones, { recursive: true }); const tmp = path.join(dirVersiones, `.tmp-${version}-${crypto.randomBytes(4).toString('hex')}`);
  try {
    for (const e of leerTar(buf)) { const d = path.join(tmp, ...e.ruta.split('/')); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, e.contenido, { flag: 'wx' }); }
    fs.renameSync(tmp, destino);
  } catch (e) { fs.rmSync(tmp, { recursive: true, force: true }); return { ok: false, motivo: 'extraccion_fallida' }; }
  const actual = leerPuntero(path.join(base, 'actual')); if (actual) escribirAtomico(path.join(base, 'anterior'), `${actual}\n`); escribirAtomico(path.join(base, 'actual'), `${version}\n`);
  return { ok: true, version, destino, anterior: actual };
}
/** Intercambia `actual` y `anterior`. No borra versiones ni toca datos. */
export function revertirEnsayo({ base }) {
  const actual = leerPuntero(path.join(base, 'actual')); const anterior = leerPuntero(path.join(base, 'anterior')); if (!actual || !anterior) return { ok: false, motivo: 'sin_version_anterior' };
  if (!fs.existsSync(path.join(base, 'versiones', anterior))) return { ok: false, motivo: 'version_anterior_ausente' };
  escribirAtomico(path.join(base, 'actual'), `${anterior}\n`); escribirAtomico(path.join(base, 'anterior'), `${actual}\n`); return { ok: true, actual: anterior, descartada: actual };
}
/** Compara los archivos de una versión instalada con su MANIFIESTO.json (hash de cada uno, ni de más ni de menos). Solo lee. */
export function verificarInstalada({ base, version }) {
  const raiz = path.join(base, 'versiones', version); let man; try { man = JSON.parse(fs.readFileSync(path.join(raiz, 'MANIFIESTO.json'), 'utf8')); } catch { return { ok: false, errores: ['manifiesto ausente o ilegible'] }; }
  const errores = []; const previstos = new Map((man.archivos ?? []).map((x) => [x.ruta, x]));
  const reales = []; const pila = ['']; while (pila.length) { const rel = pila.pop(); for (const e of fs.readdirSync(path.join(raiz, rel), { withFileTypes: true })) { const r = rel ? `${rel}/${e.name}` : e.name; if (e.isSymbolicLink()) errores.push(`enlace: ${r}`); else if (e.isDirectory()) pila.push(r); else reales.push(r); } }
  for (const r of reales) if (r !== 'MANIFIESTO.json' && !previstos.has(r)) errores.push(`archivo de más: ${r}`);
  for (const [r, x] of previstos) { let b; try { b = fs.readFileSync(path.join(raiz, r)); } catch { errores.push(`falta: ${r}`); continue; } if (crypto.createHash('sha256').update(b).digest('hex') !== x.sha256) errores.push(`alterado: ${r}`); }
  return { ok: errores.length === 0, errores: errores.slice(0, 10) };
}
export const rutaActual = (base) => { const v = leerPuntero(path.join(base, 'actual')); return v ? path.join(base, 'versiones', v) : null; };

function main(argv) {
  const [orden, ...r] = argv; const opc = (n) => { const i = r.indexOf(`--${n}`); return i >= 0 ? r[i + 1] : undefined; }; const base = opc('base'); if (!base) { console.error('Falta --base'); return 2; }
  if (orden === 'instalar') { const x = instalarEnsayo({ base: path.resolve(base), tar: opc('tar'), firma: opc('firma'), publica: opc('publica'), tipo: opc('tipo'), sha256: opc('sha256') ?? null }); console.log(JSON.stringify(x)); return x.ok ? 0 : 1; }
  if (orden === 'revertir') { const x = revertirEnsayo({ base: path.resolve(base) }); console.log(JSON.stringify(x)); return x.ok ? 0 : 1; }
  console.error('Uso: instalar-paquete-ensayo.mjs instalar|revertir --base <dir> ...'); return 2;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
