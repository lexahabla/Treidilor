/**
 * Treidilor AI · 3E.8.14 · POLÍTICA DE CONFIANZA de firmas de paquetes (solo `node:`; viaja junto a los scripts de instalación y no importa nada del repositorio).
 *
 * MODELO. Hay DOS niveles de clave, con papeles distintos:
 *   · RAÍZ DE CONFIANZA (una clave Ed25519 del propietario, fuera de línea, cuya clave pública se FIJA por otro canal: `raiz-publica.pem` + `raiz-id.txt`). Solo ella firma la POLÍTICA.
 *   · CLAVES DE PAQUETE (varias, con claveId): firman paquetes. NO pueden firmar ni modificar la política: una clave de paquete comprometida no puede borrar su propia revocación.
 * POLÍTICA (`politica.json`, `treidilor-politica-confianza/1`), firmada por la raíz: `version` ENTERA creciente, `previa` ({version, huella} de la anterior: cadena), `entorno` (PRUEBAS|PRODUCCION),
 * y la lista de claves de paquete con su clave pública, `estado` (autorizada|revocada), `validaDesde`/`validaHasta` y, si procede, `revocadaEn` y motivo. Sin secretos.
 * REGISTRO (`registro-confianza.jsonl`): cadena de eventos con hash (alta, revocación, renovación, recuperación…), sin secretos. Es la referencia de versión monotónica LOCAL: una política con versión inferior a la del
 * registro es una política ANTIGUA (aunque esté bien firmada) y se rechaza; la versión igual con otra huella, también; un hueco de más de una versión, también.
 * LÍMITE REAL (documentado): quien pueda reescribir A LA VEZ la política y el registro puede volver a una versión antigua; lo impide la REFERENCIA INDEPENDIENTE `versionMinima` que el propietario conoce por otra vía
 * (como el contador de frescura del ancla). Si pierde la raíz privada no hay forma de emitir políticas nuevas: hay que fijar otra raíz por el canal externo (cambio de raíz = acto manual, no automático).
 * REGLAS: política o registro ausentes, ilegibles, corruptos o incoherentes ⇒ NO se confía en nada (nunca se instala «por defecto»). Una clave revocada se rechaza SIEMPRE, también para firmas «anteriores a la
 * revocación» (la fecha de la firma la elige quien firma, y si la clave está comprometida no es fiable). Una clave desconocida, caducada o aún no vigente se rechaza.
 */
import crypto from 'node:crypto';

export const ESQUEMA_POLITICA = 'treidilor-politica-confianza/1';
export const ESQUEMA_REGISTRO = 'treidilor-registro-confianza/1';
export const ENTORNOS = Object.freeze(['PRUEBAS', 'PRODUCCION']);
export const sha256Hex = (b) => crypto.createHash('sha256').update(b).digest('hex');
export const canonico = (v) => (Array.isArray(v) ? `[${v.map(canonico).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonico(v[k])}`).join(',')}}` : JSON.stringify(v));
export const claveIdDe = (pem) => sha256Hex(crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' })).slice(0, 16);
const RX_ID = /^[0-9a-f]{16}$/; const RX_FECHA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const fecha = (s) => (typeof s === 'string' && RX_FECHA.test(s) && !Number.isNaN(Date.parse(s)) ? Date.parse(s) : null);
const textoSeguro = (t, max = 200) => typeof t === 'string' && t.length <= max && !/-----BEGIN|PRIVATE KEY|Bearer\s|password\s*[:=]|secret\s*[:=]|token\s*[:=]/i.test(t);
const esEd25519 = (pem) => { try { return crypto.createPublicKey(pem).asymmetricKeyType === 'ed25519'; } catch { return false; } };

/** Huella de una política: SHA-256 del cuerpo canónico SIN la firma (la cadena `previa` no depende de la firma). */
export const huellaPolitica = (doc) => { const { firma, ...cuerpo } = doc; return sha256Hex(canonico(cuerpo)); };

/** Firma el cuerpo de una política con la clave privada de la RAÍZ. Devuelve el documento completo. */
export function firmarPolitica(cuerpo, raizPrivadaPem) { return { ...cuerpo, firma: crypto.sign(null, Buffer.from(canonico(cuerpo)), crypto.createPrivateKey(raizPrivadaPem)).toString('base64') }; }

/** Valida la ESTRUCTURA de una política (sin firma). → string[] de errores. */
function estructura(d) {
  const e = [];
  if (!d || typeof d !== 'object' || Array.isArray(d)) return ['la política no es un objeto'];
  if (d.esquema !== ESQUEMA_POLITICA) e.push('esquema de política no reconocido');
  if (!ENTORNOS.includes(d.entorno)) e.push('entorno de política inválido');
  if (!Number.isInteger(d.version) || d.version < 1) e.push('versión de política inválida');
  if (!RX_ID.test(String(d.raizId))) e.push('raizId inválido');
  if (fecha(d.emitidaEn) === null) e.push('emitidaEn inválida');
  if (d.version > 1 && !(d.previa && d.previa.version === d.version - 1 && /^[0-9a-f]{64}$/.test(String(d.previa.huella)))) e.push('la cadena `previa` no enlaza con la versión anterior');
  if (d.version === 1 && d.previa !== null && d.previa !== undefined) e.push('la versión 1 no puede tener `previa`');
  if (!Array.isArray(d.claves) || d.claves.length > 64) return [...e, 'lista de claves inválida'];
  const vistos = new Set();
  for (const k of d.claves) {
    if (!k || typeof k !== 'object' || !RX_ID.test(String(k.claveId)) || vistos.has(k.claveId)) { e.push('clave con claveId inválido o repetido'); continue; } vistos.add(k.claveId);
    if (!esEd25519(k.publica) || claveIdDe(k.publica) !== k.claveId) e.push(`la clave ${k.claveId} no es una clave pública Ed25519 que corresponda a su claveId`);
    if (!['autorizada', 'revocada'].includes(k.estado)) e.push(`estado inválido en ${k.claveId}`);
    const d1 = fecha(k.validaDesde); const d2 = fecha(k.validaHasta); if (d1 === null || d2 === null || d2 <= d1) e.push(`periodo de validez inválido en ${k.claveId}`);
    if (k.estado === 'revocada' && fecha(k.revocadaEn) === null) e.push(`la clave revocada ${k.claveId} no lleva revocadaEn`);
    if (k.motivo !== undefined && !textoSeguro(k.motivo)) e.push(`motivo inválido o con forma de secreto en ${k.claveId}`);
    if (k.nota !== undefined && !textoSeguro(k.nota)) e.push(`nota inválida en ${k.claveId}`);
  }
  return e;
}

/**
 * Verifica una política (texto JSON) con la raíz FIJADA. No mira el registro (ver `comprobarCoherencia`).
 * @param {{texto:string, raizPem:string, raizId:string, versionMinima?:number, entornoEsperado?:string|null}} p
 * @returns {{ok:boolean, errores:string[], politica?:object, huella?:string}}
 */
export function verificarPolitica({ texto, raizPem, raizId, versionMinima = 0, entornoEsperado = null }) {
  let doc; try { doc = JSON.parse(texto); } catch { return { ok: false, errores: ['la política no es JSON válido'] }; }
  if (!esEd25519(raizPem)) return { ok: false, errores: ['la clave pública de la raíz no es Ed25519 válida'] };
  if (!RX_ID.test(String(raizId)) || claveIdDe(raizPem) !== raizId) return { ok: false, errores: ['raiz-id.txt no corresponde a la clave pública de la raíz fijada'] };
  const { firma, ...cuerpo } = doc ?? {}; if (typeof firma !== 'string') return { ok: false, errores: ['la política no está firmada'] };
  let valida = false; try { valida = crypto.verify(null, Buffer.from(canonico(cuerpo)), crypto.createPublicKey(raizPem), Buffer.from(firma, 'base64')); } catch { valida = false; }
  if (!valida) return { ok: false, errores: ['la firma de la política NO es de la raíz de confianza fijada'] };
  const errores = estructura(doc);
  if (doc.raizId !== raizId) errores.push('la política declara otra raíz');
  if (Number.isInteger(versionMinima) && versionMinima > 0 && doc.version < versionMinima) errores.push(`política ANTIGUA: versión ${doc.version} < la mínima conocida por el propietario (${versionMinima})`);
  if (entornoEsperado && doc.entorno !== entornoEsperado) errores.push(`la política es de entorno ${doc.entorno}, no ${entornoEsperado}`);
  return errores.length ? { ok: false, errores } : { ok: true, errores: [], politica: doc, huella: huellaPolitica(doc) };
}

/** ¿Vale esta clave de paquete AHORA según la política? → { ok, motivo? , publica? }. */
export function evaluarClave(politica, claveId, ahora = Date.now()) {
  const k = (politica.claves ?? []).find((x) => x.claveId === claveId);
  if (!k) return { ok: false, motivo: 'clave desconocida para la política de confianza' };
  if (k.estado === 'revocada') return { ok: false, motivo: `clave REVOCADA (${k.revocadaEn})` };
  if (ahora < Date.parse(k.validaDesde)) return { ok: false, motivo: `clave aún no vigente (desde ${k.validaDesde})` };
  if (ahora >= Date.parse(k.validaHasta)) return { ok: false, motivo: `clave CADUCADA (hasta ${k.validaHasta})` };
  return { ok: true, publica: k.publica };
}

// ───────────────────────────── registro ─────────────────────────────
const huellaLinea = (l) => { const { huella, ...c } = l; return sha256Hex(canonico(c)); };
/** Construye un evento encadenado sobre el registro (texto) existente. Devuelve la línea JSON (sin salto). */
export function eventoRegistro({ textoRegistro, tipo, version, huellaPolitica: hp, claveId = null, detalle = null, instante }) {
  const lineas = textoRegistro ? textoRegistro.split('\n').filter(Boolean) : []; const ult = lineas.length ? JSON.parse(lineas[lineas.length - 1]) : null;
  if (detalle !== null && !textoSeguro(detalle, 300)) throw new Error('el detalle del registro contiene algo con forma de secreto o es demasiado largo');
  const l = { esquema: ESQUEMA_REGISTRO, seq: ult ? ult.seq + 1 : 1, instante: new Date(instante).toISOString(), tipo, version, huellaPolitica: hp, claveId, detalle, previa: ult ? ult.huella : null };
  return JSON.stringify({ ...l, huella: huellaLinea(l) });
}
/** Verifica la cadena del registro. → { ok, errores, ultimo, eventos }. Un registro vacío o ausente NO es válido. */
export function verificarRegistro(texto) {
  if (typeof texto !== 'string' || !texto.trim()) return { ok: false, errores: ['registro de confianza ausente o vacío'], eventos: [] };
  const errores = []; const eventos = []; const ls = texto.split('\n'); if (ls[ls.length - 1] === '') ls.pop();
  let prev = null; ls.forEach((t, i) => {
    let l; try { l = JSON.parse(t); } catch { errores.push(`línea ${i + 1} ilegible`); return; }
    if (!l || l.esquema !== ESQUEMA_REGISTRO || l.seq !== i + 1 || l.previa !== (prev ? prev.huella : null) || l.huella !== huellaLinea(l) || !Number.isInteger(l.version) || (prev && l.version < prev.version)) errores.push(`línea ${i + 1}: cadena rota o evento inválido`);
    else if (!/^[0-9a-f]{64}$/.test(String(l.huellaPolitica))) errores.push(`línea ${i + 1}: huella de política inválida`);
    eventos.push(l); prev = l;
  });
  return { ok: errores.length === 0, errores, ultimo: eventos.length ? eventos[eventos.length - 1] : null, eventos };
}
/**
 * Coherencia política ↔ registro (referencia de versión monotónica local). Aceptado: misma versión y huella; o la política es UNA versión más nueva que el último evento y su `previa` es ese evento
 * (corte entre la escritura de la política y la del registro: «pendiente de anotar»). Rechazado: política más antigua, misma versión con otra huella, hueco o cadena distinta.
 * → { ok, errores, pendienteDeAnotar }
 */
export function comprobarCoherencia({ politica, huella, registro }) {
  const u = registro.ultimo; if (!u) return { ok: false, errores: ['registro sin eventos'], pendienteDeAnotar: false };
  if (politica.version < u.version) return { ok: false, errores: [`política ANTIGUA respecto al registro (política v${politica.version} < registro v${u.version})`], pendienteDeAnotar: false };
  if (politica.version === u.version) return huella === u.huellaPolitica ? { ok: true, errores: [], pendienteDeAnotar: false } : { ok: false, errores: ['misma versión de política con otra huella que la registrada'], pendienteDeAnotar: false };
  if (politica.version === u.version + 1 && politica.previa && politica.previa.huella === u.huellaPolitica) return { ok: true, errores: [], pendienteDeAnotar: true };
  return { ok: false, errores: [`hueco o cadena inconsistente entre la política v${politica.version} y el registro v${u.version}`], pendienteDeAnotar: false };
}
/** Huella de una línea del registro (para construir/verificar registros en pruebas y herramientas). */
export const huellaLineaRegistro = huellaLinea;
