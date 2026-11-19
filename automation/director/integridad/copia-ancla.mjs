/**
 * Agente 00 · 3E.8.9 · COPIA EXTERNA FIRMADA DEL ANCLA (protección contra la restauración CONJUNTA de almacén y ledger).
 *
 * QUÉ ES: cada vez que el ancla del ledger cambia se emite un documento `ancla-externa/1` (idAlmacen, contador, seq, huella, instante, huella del documento anterior) firmado con Ed25519 y se guarda,
 * sin sobrescribir nada, en un destino INDEPENDIENTE del ledger y del almacén (otra carpeta/unidad que el propietario elige). Se verifica con la CLAVE PÚBLICA, que no está en el destino.
 *
 * QUÉ GARANTIZA: integridad y autenticidad (un documento alterado o firmado por otro no se acepta); cadena de contadores (una copia sustituida o un hueco quedan en evidencia); operación idempotente (mismo ancla = misma copia);
 * monotonía (no se exporta un ancla anterior a la última copia). Con una copia VÁLIDA y MÁS NUEVA que el ledger, una restauración conjunta de ledger y almacén a una versión antigua se detecta.
 *
 * LO QUE NO GARANTIZA (y no se disimula): una copia de seguridad convencional, aunque esté firmada, NO impide que alguien la SUSTITUYA por una versión ANTIGUA también válida: la firma prueba quién la emitió, no cuándo es la última.
 * Hace falta una REFERENCIA DE FRESCURA independiente (`contadorMinimo`: el último contador que el propietario conoce por otra vía, p. ej. el comunicado `comunicado()`); sin ella se declara `sin_referencia_de_frescura` y
 * la copia solo puede avisar, no concluir. Tampoco protege si el atacante controla además la clave privada o el canal del propietario.
 * NUNCA reancla nada por sí sola: solo propone (`proponerReanclaje`) y el propietario ejecuta el reanclaje explícito.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign as firmarEd, verify as verificarEd } from 'node:crypto';
import { canonico, sha256 } from '../protocolo.mjs';
import { corta } from './estado.mjs';
import { ID_ALMACEN, leerAncla } from './ancla.mjs';

export const ESQUEMA_COPIA = 'ancla-externa/1';
const NOMBRE = /^ancla-([a-z0-9_-]{1,40})-(\d{8})\.json$/;
const HUELLA = /^[A-Za-z0-9:_-]{8,100}$/;
const dentro = (hijo, padre) => { const r = path.relative(path.resolve(padre), path.resolve(hijo)); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };

/** Solo para pruebas y para que el propietario cree su par de claves. La privada NUNCA se guarda en el destino. */
export function generarParClaves() { const { publicKey, privateKey } = generarEd(); return { publica: publicKey.export({ type: 'spki', format: 'pem' }), privada: privateKey.export({ type: 'pkcs8', format: 'pem' }) }; }
const generarEd = () => generateKeyPairSync('ed25519');

const sinFirma = ({ firma, ...r }) => r;
export const huellaDocumento = (doc) => sha256(canonico(sinFirma(doc)));
export function firmarDocumento(doc, privadaPem) { return { ...doc, firma: firmarEd(null, Buffer.from(canonico(sinFirma(doc))), createPrivateKey(privadaPem)).toString('base64') }; }
export function verificarDocumento(doc, publicaPem) {
  try {
    if (!doc || doc.esquema !== ESQUEMA_COPIA || typeof doc.firma !== 'string' || !ID_ALMACEN.test(String(doc.idAlmacen)) || !Number.isInteger(doc.contador) || doc.contador < 1 || !Number.isInteger(doc.seq) || doc.seq < 0 || typeof doc.huella !== 'string' || !HUELLA.test(doc.huella)) return { ok: false, motivo: 'formato_no_valido' };
    return verificarEd(null, Buffer.from(canonico(sinFirma(doc))), createPublicKey(publicaPem), Buffer.from(doc.firma, 'base64')) ? { ok: true } : { ok: false, motivo: 'firma_no_valida' };
  } catch { return { ok: false, motivo: 'firma_no_verificable' }; }
}

/** Lee TODAS las copias del destino: válidas (ordenadas), inválidas con su motivo, huecos y rotura de cadena. Nunca lanza ni modifica nada. */
export function leerCopias({ destino, publica, idAlmacen }) {
  const r = { ok: true, validas: [], invalidas: [], huecos: [], cadenaOk: true, mejor: null };
  let nombres; try { nombres = fs.readdirSync(destino); } catch (e) { return { ...r, ok: false, motivo: e && e.code === 'ENOENT' ? 'destino_inexistente' : 'destino_ilegible' }; }
  for (const n of nombres.sort()) {
    const m = NOMBRE.exec(n); if (!m || m[1] !== idAlmacen) continue;
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(destino, n), 'utf8')); const v = verificarDocumento(doc, publica);
      if (!v.ok) r.invalidas.push({ archivo: n, motivo: v.motivo }); else if (doc.idAlmacen !== idAlmacen || doc.contador !== Number(m[2])) r.invalidas.push({ archivo: n, motivo: 'nombre_distinto_del_contenido' }); else r.validas.push(doc);
    } catch { r.invalidas.push({ archivo: n, motivo: 'ilegible' }); }
  }
  r.validas.sort((a, b) => a.contador - b.contador);
  let prev = null; for (const d of r.validas) { if (prev) { if (d.contador !== prev.contador + 1) for (let c = prev.contador + 1; c < d.contador; c += 1) r.huecos.push(c); if (!d.previa || d.previa.contador !== prev.contador || d.previa.huellaDoc !== huellaDocumento(prev)) r.cadenaOk = false; if (d.seq < prev.seq) r.cadenaOk = false; } else if (d.previa !== null && d.contador === 1) r.cadenaOk = false; prev = d; }
  r.mejor = r.validas.length ? r.validas[r.validas.length - 1] : null; return r;
}

/**
 * FUNCIÓN PURA. Frescura de la mejor copia frente a la referencia independiente del propietario. `referencia = { contadorMinimo }`.
 * @returns {{estado:'vigente'|'obsoleta'|'sin_referencia_de_frescura'|'sin_copias', mensaje:string}}
 */
export function evaluarFrescura({ mejor, referencia }) {
  if (!mejor) return { estado: 'sin_copias', mensaje: 'No hay ninguna copia externa válida.' };
  if (!referencia || !Number.isInteger(referencia.contadorMinimo)) return { estado: 'sin_referencia_de_frescura', mensaje: 'Sin referencia de frescura independiente: una copia ANTIGUA también válida no se distinguiría de la última.' };
  return mejor.contador >= referencia.contadorMinimo ? { estado: 'vigente', mensaje: 'La copia es al menos tan reciente como la referencia del propietario.' } : { estado: 'obsoleta', mensaje: `La mejor copia es la #${mejor.contador} y el propietario conoce al menos la #${referencia.contadorMinimo}: posible sustitución por una versión antigua.` };
}

/** FUNCIÓN PURA. Contrasta el ancla del ledger con la mejor copia: coinciden · ledger_atrasado (la copia es posterior) · copia_atrasada (aún sin exportar) · distintas (misma seq, otra huella: grave) · sin_ledger · sin_copia. */
export function contrastarAncla({ ledgerAncla, copia }) {
  if (!copia) return { estado: 'sin_copia', efectiva: ledgerAncla ?? null };
  const c = { seq: copia.seq, huella: copia.huella };
  if (!ledgerAncla) return { estado: 'sin_ledger', efectiva: c };
  if (ledgerAncla.seq === copia.seq) return ledgerAncla.huella === copia.huella ? { estado: 'coinciden', efectiva: c } : { estado: 'distintas', efectiva: null };
  return copia.seq > ledgerAncla.seq ? { estado: 'ledger_atrasado', efectiva: c } : { estado: 'copia_atrasada', efectiva: { seq: ledgerAncla.seq, huella: ledgerAncla.huella } };
}

/** Texto corto SIN secretos que el propietario guarda fuera del sistema: su «referencia de frescura». */
export const comunicado = (doc) => `Ancla de integridad «${doc.idAlmacen}» #${doc.contador}: seq ${doc.seq}, huella ${corta(doc.huella)}…, emitida ${doc.emitidoEn}. Guarde este contador como referencia de frescura.`;

/**
 * Exporta la copia correspondiente al ancla vigente del ledger. Idempotente (mismo ancla = mismo documento); monótona; sin sobrescribir; el destino debe ser independiente.
 * @returns {{estado:'exportada'|'sin_cambio'|'sin_ancla'|'rechazada', ...}} (nunca lanza)
 */
export function exportarAncla({ ledger, idAlmacen, destino, privada, publica, reloj = () => Date.now(), almacenDir = null, exigirOtraUnidad = true }) {
  try {
    if (!ID_ALMACEN.test(String(idAlmacen)) || typeof destino !== 'string' || !path.isAbsolute(destino) || !privada || !publica) return { estado: 'rechazada', motivo: 'parametros_no_validos' };
    if (dentro(destino, ledger.dir) || dentro(ledger.dir, destino) || (almacenDir && (dentro(destino, almacenDir) || dentro(almacenDir, destino)))) return { estado: 'rechazada', motivo: 'destino_no_independiente' };
    fs.mkdirSync(destino, { recursive: true, mode: 0o700 });
    const misma = fs.statSync(destino).dev === fs.statSync(ledger.dir).dev;
    if (misma && exigirOtraUnidad) return { estado: 'rechazada', motivo: 'misma_unidad_que_el_ledger' };
    const a = leerAncla(ledger, idAlmacen); if (a.estado !== 'vigente') return { estado: 'sin_ancla', motivo: a.estado };
    const lec = leerCopias({ destino, publica, idAlmacen }); if (!lec.ok) return { estado: 'rechazada', motivo: lec.motivo };
    const ultima = lec.mejor;
    if (ultima && ultima.seq === a.ancla.seq && ultima.huella === a.ancla.huella) return { estado: 'sin_cambio', contador: ultima.contador, copia: ultima };
    if (ultima && a.ancla.seq < ultima.seq) return { estado: 'rechazada', motivo: 'retroceso_respecto_a_la_ultima_copia' };
    if (ultima && a.ancla.seq === ultima.seq) return { estado: 'rechazada', motivo: 'misma_seq_distinta_huella' };
    const contador = ultima ? ultima.contador + 1 : 1;
    const doc = firmarDocumento({ esquema: ESQUEMA_COPIA, idAlmacen, contador, seq: a.ancla.seq, huella: a.ancla.huella, emitidoEn: new Date(reloj()).toISOString(), ledgerSecuencia: ledger.estado().ultimaSecuencia, previa: ultima ? { contador: ultima.contador, huellaDoc: huellaDocumento(ultima) } : null }, privada);
    const nombre = `ancla-${idAlmacen}-${String(contador).padStart(8, '0')}.json`; const ruta = path.join(destino, nombre);
    if (fs.existsSync(ruta)) { fs.renameSync(ruta, `${ruta}.invalida-${Date.now()}`); } // un archivo con ese nombre que no es una copia válida se aparta, no se borra ni se pisa
    const fd = fs.openSync(ruta, 'wx', 0o600); try { fs.writeSync(fd, `${JSON.stringify(doc)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    const comprobacion = verificarDocumento(JSON.parse(fs.readFileSync(ruta, 'utf8')), publica); if (!comprobacion.ok) return { estado: 'rechazada', motivo: 'la_copia_escrita_no_verifica' };
    return { estado: 'exportada', contador, copia: doc, independenciaFisica: misma ? 'misma_unidad' : 'otra_unidad' };
  } catch (e) { return { estado: 'rechazada', motivo: e && e.code ? String(e.code) : 'error_inesperado' }; }
}

/**
 * Propuesta de recuperación para el PROPIETARIO (no escribe nada): cómo restablecer el ancla del ledger a partir de una copia válida y fresca, y qué comprobar antes.
 * El reanclaje real es siempre explícito (`reanclar` de la ejecución supervisada) y sigue exigiendo verificación completa y correcta del almacén.
 */
export function proponerReanclaje({ copia, frescura, contraste }) {
  if (!copia) return { puede: false, motivo: 'sin_copia_valida' };
  if (frescura.estado === 'obsoleta') return { puede: false, motivo: 'copia_obsoleta' };
  const avisos = frescura.estado === 'sin_referencia_de_frescura' ? ['sin referencia de frescura: confirmar a mano que esta es la última copia emitida'] : [];
  return { puede: true, cabeza: { seq: copia.seq, huella: copia.huella }, contraste: contraste?.estado ?? null, avisos, reanclar: { confirmar: true, autorizadoPor: 'propietario', motivo: `reanclaje desde la copia externa #${copia.contador} (seq ${copia.seq})` }, pasos: ['Verificar que el almacén contiene la cabeza de la copia (la ejecución supervisada con ancla = copia debe devolver «coincide»).', 'Comprobar el contador contra su referencia de frescura.', 'Ejecutar el reanclaje explícito con la autorización del propietario.'] };
}
