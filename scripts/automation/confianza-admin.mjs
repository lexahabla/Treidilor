#!/usr/bin/env node
/**
 * Treidilor AI · 3E.8.14 · ADMINISTRACIÓN de la política de confianza (acto del PROPIETARIO, fuera de línea). Solo `node:` + `./confianza-politica.mjs`.
 *   generar-raiz --publica <pem> --privada <pem>            SOLO claves de PRUEBAS (las operativas las genera el propietario con sus propios medios)
 *   iniciar --confianza <dir> --raiz-publica <pem> --raiz-privada <pem> --entorno PRUEBAS|PRODUCCION
 *   autorizar --confianza <dir> --raiz-privada <pem> --publica <pem> [--desde ISO] [--hasta ISO] [--nota texto]
 *   revocar   --confianza <dir> --raiz-privada <pem> --clave-id <id> --motivo <≥10 caracteres>
 *   renovar   --confianza <dir> --raiz-privada <pem> --clave-id <id> --hasta ISO
 *   mostrar   --confianza <dir>                              versión, huella y claves (sin claves públicas completas)
 *   anotar-pendiente --confianza <dir>                       completa el registro tras un corte entre la política y el registro
 *   recuperar --confianza <dir> --politica <copia> --version-minima N --confirmo <raizId> --motivo <≥10> [--instante ISO]   RECUPERACIÓN expresamente autorizada
 * CADA cambio: política nueva (versión+1, `previa` encadenada, firmada por la RAÍZ) escrita con tmp+renombrado y DESPUÉS anotada en el registro (cadena de hash, sin secretos). La clave privada de la raíz nunca se
 * imprime ni se guarda en la carpeta de confianza, y se rechaza si está dentro del repositorio, de `paquetes\` o de `informes\`. NO hay forma de bajar de versión: `recuperar` exige una copia firmada por la raíz con
 * versión ≥ la mínima que el propietario declara y la confirmación explícita del raizId.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENTORNOS, ESQUEMA_POLITICA, claveIdDe, comprobarCoherencia, eventoRegistro, firmarPolitica, huellaPolitica, verificarPolitica, verificarRegistro } from './confianza-politica.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url)); const RAIZ_WEB = path.resolve(AQUI, '..', '..'); const RAIZ_TREIDILOR = path.resolve(RAIZ_WEB, '..');
const F = Object.freeze({ raiz: 'raiz-publica.pem', raizId: 'raiz-id.txt', politica: 'politica.json', registro: 'registro-confianza.jsonl' });
const dentro = (h, p) => { const r = path.relative(p, h); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
export const rutaPrivadaPermitida = (p) => { const a = path.resolve(p); return !dentro(a, RAIZ_WEB) && !dentro(a, path.join(RAIZ_TREIDILOR, 'paquetes')) && !dentro(a, path.join(RAIZ_TREIDILOR, 'informes')); };
const iso = (t) => new Date(t).toISOString(); const leer = (dir, n) => { try { return fs.readFileSync(path.join(dir, n), 'utf8'); } catch { return null; } };
const escribirAtomico = (f, texto) => { const t = `${f}.tmp-${crypto.randomBytes(4).toString('hex')}`; fs.writeFileSync(t, texto, { flag: 'wx' }); fs.renameSync(t, f); };
const falla = (m) => { throw new Error(m); };

/** Carga y VERIFICA el estado actual (política + registro + coherencia) con la raíz fijada de la carpeta. */
export function cargar(dir, { permitirPendiente = true } = {}) {
  const raizPem = leer(dir, F.raiz); const raizId = (leer(dir, F.raizId) ?? '').trim(); if (!raizPem || !raizId) falla('falta la raíz de confianza fijada en la carpeta');
  const p = verificarPolitica({ texto: leer(dir, F.politica) ?? falla('falta la política'), raizPem, raizId }); if (!p.ok) falla(`política no válida: ${p.errores.join('; ')}`);
  const r = verificarRegistro(leer(dir, F.registro)); if (!r.ok) falla(`registro no válido: ${r.errores.join('; ')}`);
  const c = comprobarCoherencia({ politica: p.politica, huella: p.huella, registro: r }); if (!c.ok) falla(c.errores.join('; ')); if (c.pendienteDeAnotar && !permitirPendiente) falla('hay un cambio pendiente de anotar en el registro: ejecute anotar-pendiente');
  return { raizPem, raizId, politica: p.politica, huella: p.huella, registroTxt: leer(dir, F.registro), pendiente: c.pendienteDeAnotar };
}
function publicar(dir, cuerpo, raizPrivada, evento, ahora) {
  const nueva = firmarPolitica(cuerpo, raizPrivada); const reg = leer(dir, F.registro) ?? '';
  const fila = eventoRegistro({ textoRegistro: reg, tipo: evento.tipo, version: nueva.version, huellaPolitica: huellaPolitica(nueva), claveId: evento.claveId ?? null, detalle: evento.detalle ?? null, instante: ahora });
  escribirAtomico(path.join(dir, F.politica), `${JSON.stringify(nueva, null, 1)}\n`);        // 1.º la política…
  escribirAtomico(path.join(dir, F.registro), `${reg}${fila}\n`);                            // 2.º el registro (un corte entre ambos queda «pendiente de anotar», nunca inconsistente)
  return nueva;
}
const siguiente = (e, ahora) => ({ esquema: ESQUEMA_POLITICA, entorno: e.politica.entorno, version: e.politica.version + 1, raizId: e.raizId, emitidaEn: iso(ahora), previa: { version: e.politica.version, huella: e.huella }, claves: e.politica.claves.map((k) => ({ ...k })) });
const privada = (p) => { if (!p) falla('falta --raiz-privada'); if (!rutaPrivadaPermitida(p)) falla('la clave privada de la raíz no puede estar en el repositorio, en paquetes\\ ni en informes\\'); return fs.readFileSync(p, 'utf8'); };

export function iniciar({ dir, raizPublica, raizPrivada, entorno, ahora = Date.now() }) {
  if (!ENTORNOS.includes(entorno)) falla('entorno inválido'); const pub = fs.readFileSync(raizPublica, 'utf8'); const raizId = claveIdDe(pub);
  if (claveIdDe(crypto.createPublicKey(raizPrivada).export({ type: 'spki', format: 'pem' })) !== raizId) falla('la clave privada no corresponde a la pública de la raíz');
  fs.mkdirSync(dir, { recursive: true }); for (const n of Object.values(F)) if (fs.existsSync(path.join(dir, n))) falla(`ya existe ${n}: no se sobrescribe una confianza existente`);
  const cuerpo = { esquema: ESQUEMA_POLITICA, entorno, version: 1, raizId, emitidaEn: iso(ahora), previa: null, claves: [] }; const p = firmarPolitica(cuerpo, raizPrivada);
  fs.writeFileSync(path.join(dir, F.raiz), pub, { flag: 'wx' }); fs.writeFileSync(path.join(dir, F.raizId), `${raizId}\n`, { flag: 'wx' }); fs.writeFileSync(path.join(dir, F.politica), `${JSON.stringify(p, null, 1)}\n`, { flag: 'wx' });
  fs.writeFileSync(path.join(dir, F.registro), `${eventoRegistro({ textoRegistro: '', tipo: 'inicio', version: 1, huellaPolitica: huellaPolitica(p), detalle: `raíz ${raizId}`, instante: ahora })}\n`, { flag: 'wx' }); return { version: 1, raizId };
}
export function autorizar({ dir, raizPrivada, publica, desde, hasta, nota, ahora = Date.now() }) {
  const e = cargar(dir, { permitirPendiente: false }); const id = claveIdDe(publica); if (id === e.raizId) falla('la clave de la raíz no puede usarse también como clave de paquete'); if (e.politica.claves.some((k) => k.claveId === id)) falla('esa clave ya consta en la política (autorizada o revocada): no se reintroduce');
  const d = desde ?? iso(ahora); const h = hasta ?? iso(ahora + 365 * 86400000); const c = siguiente(e, ahora); c.claves.push({ claveId: id, publica, estado: 'autorizada', validaDesde: d, validaHasta: h, ...(nota ? { nota } : {}) });
  const v = verificarPolitica({ texto: JSON.stringify(firmarPolitica(c, raizPrivada)), raizPem: e.raizPem, raizId: e.raizId }); if (!v.ok) falla(`la política resultante no es válida: ${v.errores.join('; ')}`);
  return publicar(dir, c, raizPrivada, { tipo: 'alta_clave', claveId: id, detalle: nota ?? null }, ahora);
}
export function revocar({ dir, raizPrivada, claveId, motivo, ahora = Date.now() }) {
  if (typeof motivo !== 'string' || motivo.trim().length < 10) falla('el motivo de la revocación debe tener al menos 10 caracteres'); const e = cargar(dir, { permitirPendiente: false }); const c = siguiente(e, ahora); const k = c.claves.find((x) => x.claveId === claveId); if (!k) falla('clave desconocida'); if (k.estado === 'revocada') falla('la clave ya está revocada');
  k.estado = 'revocada'; k.revocadaEn = iso(ahora); k.motivo = motivo.trim(); return publicar(dir, c, raizPrivada, { tipo: 'revocacion', claveId, detalle: k.motivo }, ahora);
}
export function renovar({ dir, raizPrivada, claveId, hasta, ahora = Date.now() }) {
  const e = cargar(dir, { permitirPendiente: false }); const c = siguiente(e, ahora); const k = c.claves.find((x) => x.claveId === claveId); if (!k) falla('clave desconocida'); if (k.estado === 'revocada') falla('una clave revocada no se renueva');
  if (!(Date.parse(hasta) > Date.parse(k.validaHasta))) falla('la renovación debe ampliar la validez'); k.validaHasta = hasta; return publicar(dir, c, raizPrivada, { tipo: 'renovacion', claveId, detalle: `hasta ${hasta}` }, ahora);
}
export function anotarPendiente({ dir, ahora = Date.now() }) {
  const e = cargar(dir); if (!e.pendiente) return { cambios: false }; const fila = eventoRegistro({ textoRegistro: e.registroTxt, tipo: 'anotacion_pendiente', version: e.politica.version, huellaPolitica: e.huella, detalle: 'completado tras un corte', instante: ahora });
  escribirAtomico(path.join(dir, F.registro), `${e.registroTxt}${fila}\n`); return { cambios: true, version: e.politica.version };
}
/** Recuperación expresamente autorizada: política perdida/corrupta y/o registro perdido/corrupto. Nunca baja de la versión mínima declarada ni de la del registro íntegro. */
export function recuperar({ dir, copia, versionMinima, confirmo, motivo, ahora = Date.now() }) {
  if (typeof motivo !== 'string' || motivo.trim().length < 10) falla('la recuperación exige un motivo de al menos 10 caracteres'); if (!Number.isInteger(versionMinima) || versionMinima < 1) falla('la recuperación exige --version-minima (la que el propietario conoce por otra vía)');
  const raizPem = leer(dir, F.raiz); const raizId = (leer(dir, F.raizId) ?? '').trim(); if (!raizPem || !raizId) falla('falta la raíz fijada: la raíz no se recupera, se fija de nuevo por el canal externo'); if (confirmo !== raizId) falla('confirmación explícita incorrecta: debe pasar el raizId exacto');
  const texto = fs.readFileSync(copia, 'utf8'); const p = verificarPolitica({ texto, raizPem, raizId, versionMinima }); if (!p.ok) falla(`la copia no es válida: ${p.errores.join('; ')}`);
  const r = verificarRegistro(leer(dir, F.registro)); if (r.ok && r.ultimo && p.politica.version < r.ultimo.version) falla(`la copia (v${p.politica.version}) es más antigua que el registro íntegro (v${r.ultimo.version})`);
  const reg = r.ok ? leer(dir, F.registro) : ''; const fila = eventoRegistro({ textoRegistro: reg, tipo: 'recuperacion', version: p.politica.version, huellaPolitica: p.huella, detalle: motivo.trim().slice(0, 250), instante: ahora });
  escribirAtomico(path.join(dir, F.politica), texto.endsWith('\n') ? texto : `${texto}\n`); escribirAtomico(path.join(dir, F.registro), `${reg}${fila}\n`); return { version: p.politica.version, registroReconstruido: !r.ok };
}
export function resumen(dir) { const e = cargar(dir); return { version: e.politica.version, entorno: e.politica.entorno, huella: e.huella.slice(0, 16), raizId: e.raizId, pendienteDeAnotar: e.pendiente, claves: e.politica.claves.map((k) => ({ claveId: k.claveId, estado: k.estado, validaDesde: k.validaDesde, validaHasta: k.validaHasta, revocadaEn: k.revocadaEn ?? null })) }; }

function main(argv) {
  const [orden, ...r] = argv; const o = {}; for (let i = 0; i < r.length; i += 1) if (r[i].startsWith('--')) { o[r[i].slice(2)] = r[i + 1]; i += 1; }
  const dir = o.confianza ? path.resolve(o.confianza) : null; const ahora = o.instante ?? o.ahora ? Date.parse(o.instante ?? o.ahora) : Date.now();
  try {
    if (orden === 'generar-raiz') { if (!o.publica || !o.privada) falla('Uso: generar-raiz --publica <pem> --privada <pem>'); if (!rutaPrivadaPermitida(o.privada)) falla('la clave privada no puede guardarse en el repositorio, paquetes\\ ni informes\\'); const k = crypto.generateKeyPairSync('ed25519'); const priv = k.privateKey.export({ type: 'pkcs8', format: 'pem' }); const pub = k.publicKey.export({ type: 'spki', format: 'pem' }); fs.mkdirSync(path.dirname(path.resolve(o.privada)), { recursive: true }); fs.writeFileSync(o.privada, priv, { flag: 'wx', mode: 0o600 }); fs.writeFileSync(o.publica, pub, { flag: 'wx' }); console.log(`Raíz de PRUEBAS generada. raizId: ${claveIdDe(pub)} (la privada no se muestra)`); return 0; }
    if (!dir) falla('falta --confianza');
    if (orden === 'iniciar') { const x = iniciar({ dir, raizPublica: o['raiz-publica'], raizPrivada: privada(o['raiz-privada']), entorno: o.entorno, ahora }); console.log(`Confianza iniciada: política v${x.version}, raíz ${x.raizId}`); return 0; }
    if (orden === 'autorizar') { const p = autorizar({ dir, raizPrivada: privada(o['raiz-privada']), publica: fs.readFileSync(o.publica, 'utf8'), desde: o.desde, hasta: o.hasta, nota: o.nota, ahora }); console.log(`Clave autorizada. Política v${p.version}`); return 0; }
    if (orden === 'revocar') { const p = revocar({ dir, raizPrivada: privada(o['raiz-privada']), claveId: o['clave-id'], motivo: o.motivo, ahora }); console.log(`Clave revocada. Política v${p.version}`); return 0; }
    if (orden === 'renovar') { const p = renovar({ dir, raizPrivada: privada(o['raiz-privada']), claveId: o['clave-id'], hasta: o.hasta, ahora }); console.log(`Clave renovada. Política v${p.version}`); return 0; }
    if (orden === 'anotar-pendiente') { console.log(JSON.stringify(anotarPendiente({ dir, ahora }))); return 0; }
    if (orden === 'recuperar') { console.log(JSON.stringify(recuperar({ dir, copia: o.politica, versionMinima: Number(o['version-minima']), confirmo: o.confirmo, motivo: o.motivo, ahora }))); return 0; }
    if (orden === 'mostrar') { console.log(JSON.stringify(resumen(dir), null, 1)); return 0; }
    falla('Uso: confianza-admin.mjs generar-raiz|iniciar|autorizar|revocar|renovar|mostrar|anotar-pendiente|recuperar');
  } catch (e) { console.error(`ERROR: ${e.message}`); return 1; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
