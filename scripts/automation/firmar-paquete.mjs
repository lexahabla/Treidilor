#!/usr/bin/env node
/**
 * Treidilor AI · 3E.8.12 · FIRMA DE PRUEBAS de paquetes con Ed25519. NO es una firma de producción: el documento lleva `entorno: "PRUEBAS"` y el verificador independiente lo exige.
 *   node scripts/automation/firmar-paquete.mjs generar-claves --publica <pem> --privada <pem FUERA del repositorio y de paquetes\>
 *   node scripts/automation/firmar-paquete.mjs firmar <paquete.tar> --tipo director|cli --clave-privada <pem> --salida <firma.json>
 * Se firma el documento canónico { esquema, entorno, tipo, artefacto, version, sha256Tar, sha256Manifiesto, archivos, firmadoEn, claveId }: queda vinculado el paquete entero (SHA-256 del TAR) y su manifiesto (hash de cada archivo).
 * La clave privada: se crea con `wx` y modo 0600, se rechaza guardarla dentro del repositorio o de `paquetes\`, y jamás se imprime. Verificación: `verificar-firma-paquete.mjs` (proceso independiente).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESQUEMA_FIRMA, claveIdDe } from './verificar-firma-paquete.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url)); const RAIZ_WEB = path.resolve(AQUI, '..', '..'); const RAIZ_TREIDILOR = path.resolve(RAIZ_WEB, '..');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
export const canonico = (v) => (Array.isArray(v) ? `[${v.map(canonico).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonico(v[k])}`).join(',')}}` : JSON.stringify(v));
const dentro = (hijo, padre) => { const r = path.relative(padre, hijo); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };

export function generarParClaves() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return { publica: publicKey.export({ type: 'spki', format: 'pem' }), privada: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}
/** La clave privada NO puede quedar en el repositorio de la web ni dentro de `paquetes\` (se empaquetaría o se versionaría). */
export function rutaPrivadaPermitida(p) { const a = path.resolve(p); return !dentro(a, RAIZ_WEB) && !dentro(a, path.join(RAIZ_TREIDILOR, 'paquetes')) && !dentro(a, path.join(RAIZ_TREIDILOR, 'informes')); }

/** Documento firmado. `privadaPem` solo se usa para firmar; no se devuelve ni se escribe. */
export function firmarPaquete({ tar, artefacto, tipo, privadaPem, ahora = new Date(), entorno = 'PRUEBAS' }) {
  if (!['PRUEBAS', 'PRODUCCION'].includes(entorno)) throw new Error('entorno debe ser PRUEBAS o PRODUCCION');
  if (!['director', 'cli'].includes(tipo)) throw new Error('tipo debe ser director o cli');
  const priv = crypto.createPrivateKey(privadaPem); if (priv.asymmetricKeyType !== 'ed25519') throw new Error('la clave privada no es Ed25519');
  const pem = crypto.createPublicKey(priv).export({ type: 'spki', format: 'pem' });
  if (tar.length < 1024 || tar.toString('utf8', 0, 100).split('\0')[0] !== 'MANIFIESTO.json') throw new Error('el paquete no empieza por MANIFIESTO.json');
  const tam = parseInt(tar.toString('ascii', 124, 135).trim(), 8); const man = tar.subarray(512, 512 + tam); const m = JSON.parse(man.toString('utf8'));
  const doc = { esquema: ESQUEMA_FIRMA, entorno, aviso: entorno === 'PRUEBAS' ? 'FIRMA DE PRUEBAS: no es una firma de produccion' : 'Firma de produccion: valida solo con una clave fijada de antemano por el propietario', tipo, artefacto, version: m.version, sha256Tar: sha(tar), sha256Manifiesto: sha(man), archivos: (m.archivos ?? []).length, firmadoEn: ahora.toISOString(), claveId: claveIdDe(pem) };
  return { ...doc, firma: crypto.sign(null, Buffer.from(canonico(doc)), priv).toString('base64') };
}

function main(argv) {
  const [orden, ...r] = argv; const opc = (n) => { const i = r.indexOf(`--${n}`); return i >= 0 ? r[i + 1] : undefined; };
  if (orden === 'generar-claves') {
    const pub = opc('publica'); const priv = opc('privada'); if (!pub || !priv) { console.error('Uso: generar-claves --publica <pem> --privada <pem>'); return 2; }
    if (!rutaPrivadaPermitida(priv)) { console.error('La clave privada NO puede guardarse dentro del repositorio, de paquetes\\ ni de informes\\.'); return 2; }
    const k = generarParClaves(); fs.mkdirSync(path.dirname(path.resolve(priv)), { recursive: true }); fs.writeFileSync(priv, k.privada, { flag: 'wx', mode: 0o600 }); fs.writeFileSync(pub, k.publica, { flag: 'wx' });
    console.log(`Clave de PRUEBAS generada. claveId: ${claveIdDe(k.publica)} (la privada no se muestra)`); return 0;
  }
  if (orden === 'firmar') {
    const tarF = r[0]; const tipo = opc('tipo'); const kp = opc('clave-privada'); const salida = opc('salida'); if (!tarF || !tipo || !kp || !salida) { console.error('Uso: firmar <paquete.tar> --tipo director|cli --clave-privada <pem> --salida <firma.json>'); return 2; }
    if (!rutaPrivadaPermitida(kp)) { console.error('La clave privada está en una ubicación no permitida (repositorio, paquetes\\ o informes\\).'); return 2; }
    const doc = firmarPaquete({ tar: fs.readFileSync(tarF), artefacto: path.basename(tarF), tipo, privadaPem: fs.readFileSync(kp, 'utf8'), entorno: opc('entorno') ?? 'PRUEBAS' }); fs.writeFileSync(salida, `${JSON.stringify(doc, null, 1)}\n`, { flag: 'wx' });
    console.log(`Firma de PRUEBAS escrita (${doc.tipo} ${doc.version}, claveId ${doc.claveId}, SHA-256 ${doc.sha256Tar})`); return 0;
  }
  console.error('Uso: firmar-paquete.mjs generar-claves | firmar'); return 2;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
