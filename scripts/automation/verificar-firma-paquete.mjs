#!/usr/bin/env node
/**
 * Treidilor AI · 3E.8.12 · VERIFICADOR INDEPENDIENTE de la firma de un paquete. No importa NADA del repositorio (solo `node:`): así no depende del código que empaqueta ni del que firma.
 *   node verificar-firma-paquete.mjs <paquete.tar> <firma.json> <clave-publica.pem> [--clave-id <esperado>] [--modo pruebas|produccion]
 * MODO `pruebas` (por defecto): exige entorno PRUEBAS. MODO `produccion`: exige entorno PRODUCCION, EXIGE `--clave-id` (la clave debe estar fijada de antemano por el propietario, fuera del paquete) y RECHAZA las claves de pruebas conocidas.
 * Comprueba: formato de la firma, firma Ed25519 válida con ESA clave pública, que la clave coincide con `claveId`, que el SHA-256 del TAR es el firmado, que el SHA-256 de su MANIFIESTO.json
 * (la primera entrada del TAR) es el firmado y que el nombre del archivo es el firmado. Salida 0 = verifica · 1 = NO verifica (con los motivos) · 2 = uso.
 * LÍMITE: verifica que el artefacto es el que firmó esa clave; QUIÉN controla la clave y cómo llegó la clave pública hasta aquí es una cuestión de confianza que este script no resuelve.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const canonico = (v) => (Array.isArray(v) ? `[${v.map(canonico).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonico(v[k])}`).join(',')}}` : JSON.stringify(v));
export const ESQUEMA_FIRMA = 'treidilor-firma-paquete/1';
/** claveId de las claves de PRUEBAS generadas en las fases 3E.8.x: jamás valen en modo producción (aunque el documento afirme otra cosa). */
export const CLAVES_DE_PRUEBAS_CONOCIDAS = Object.freeze(['28bb645f9d53d165', '3f16a232123fa7e6']);

/** Primera entrada de un TAR ustar → { nombre, contenido } o null. */
function primeraEntrada(buf) {
  if (buf.length < 1024) return null; const h = buf.subarray(0, 512); const nombre = h.toString('utf8', 0, 100).split('\0')[0]; const tam = parseInt(h.toString('ascii', 124, 135).trim(), 8);
  if (!Number.isFinite(tam) || tam < 0 || 512 + tam > buf.length) return null; return { nombre, contenido: buf.subarray(512, 512 + tam) };
}
export const claveIdDe = (pem) => sha(crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' })).slice(0, 16);

/** → { ok, errores[] }. Nunca lanza. */
export function verificarFirmaPaquete({ tar, firma, publicaPem, claveIdEsperada = null, modo = 'pruebas' }) {
  if (!['pruebas', 'produccion'].includes(modo)) return { ok: false, errores: ['modo desconocido'] }; const entornoEsperado = modo === 'produccion' ? 'PRODUCCION' : 'PRUEBAS';
  const errores = []; let doc;
  try { doc = JSON.parse(firma); } catch { return { ok: false, errores: ['la firma no es JSON'] }; }
  if (!doc || doc.esquema !== ESQUEMA_FIRMA || typeof doc.firma !== 'string' || typeof doc.sha256Tar !== 'string' || typeof doc.sha256Manifiesto !== 'string' || typeof doc.claveId !== 'string' || doc.entorno !== entornoEsperado) return { ok: false, errores: [`formato de firma no reconocido (se exige entorno ${entornoEsperado} en modo ${modo})`] };
  let pub; try { pub = crypto.createPublicKey(publicaPem); if (pub.asymmetricKeyType !== 'ed25519') throw new Error('no ed25519'); } catch { return { ok: false, errores: ['la clave pública no es una clave Ed25519 válida'] }; }
  const { firma: f, ...sinFirma } = doc; let valida = false; try { valida = crypto.verify(null, Buffer.from(canonico(sinFirma)), pub, Buffer.from(f, 'base64')); } catch { valida = false; }
  if (!valida) errores.push('la firma Ed25519 NO es válida para esa clave pública');
  if (doc.claveId !== claveIdDe(publicaPem)) errores.push('claveId distinto de la clave pública indicada'); if (claveIdEsperada && doc.claveId !== claveIdEsperada) errores.push('claveId distinto del esperado');
  if (modo === 'produccion') { if (!claveIdEsperada) errores.push('en modo producción es obligatorio indicar el claveId fijado de antemano por el propietario'); if (CLAVES_DE_PRUEBAS_CONOCIDAS.includes(doc.claveId) || CLAVES_DE_PRUEBAS_CONOCIDAS.includes(claveIdDe(publicaPem))) errores.push('clave de PRUEBAS rechazada en modo producción'); }
  if (sha(tar) !== doc.sha256Tar) errores.push('el SHA-256 del paquete NO es el firmado');
  const p = primeraEntrada(tar); if (!p || p.nombre !== 'MANIFIESTO.json') errores.push('el paquete no empieza por MANIFIESTO.json'); else if (sha(p.contenido) !== doc.sha256Manifiesto) errores.push('el MANIFIESTO.json del paquete NO es el firmado');
  return { ok: errores.length === 0, errores, tipo: doc.tipo ?? null, version: doc.version ?? null, claveId: doc.claveId, artefacto: doc.artefacto ?? null };
}

function main(argv) {
  const [tarF, firmaF, pubF, ...resto] = argv; if (!tarF || !firmaF || !pubF) { console.error('Uso: verificar-firma-paquete.mjs <paquete.tar> <firma.json> <clave-publica.pem> [--clave-id <id>]'); return 2; }
  let tar; let firma; let pem; try { tar = fs.readFileSync(tarF); firma = fs.readFileSync(firmaF, 'utf8'); pem = fs.readFileSync(pubF, 'utf8'); } catch (e) { console.log(`NO VERIFICA:\n- no se pudo leer un archivo (${e.code ?? 'error'})`); return 1; }
  const i = resto.indexOf('--clave-id'); const k = resto.indexOf('--modo'); const modo = k >= 0 ? resto[k + 1] : 'pruebas'; const r = verificarFirmaPaquete({ tar, firma, publicaPem: pem, claveIdEsperada: i >= 0 ? resto[i + 1] : null, modo });
  if (r.ok && JSON.parse(firma).artefacto !== path.basename(tarF)) { console.log('NO VERIFICA:\n- el nombre del archivo no es el firmado'); return 1; }
  console.log(r.ok ? (modo === 'produccion' ? `FIRMA DE PRODUCCIÓN VÁLIDA: ${r.tipo} ${r.version} (clave ${r.claveId}, fijada de antemano).` : `FIRMA DE PRUEBAS VÁLIDA: ${r.tipo} ${r.version} (clave ${r.claveId}). Esto NO es una firma de producción.`) : `NO VERIFICA:\n- ${r.errores.join('\n- ')}`); return r.ok ? 0 : 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
