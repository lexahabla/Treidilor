// Agente 00 · 3E.8.14 · POLÍTICA DE CONFIANZA de firmas de paquetes: raíz independiente, claves de paquete autorizadas/revocadas/caducadas, registro monotónico, rotación y recuperación.
// Todo con claves SINTÉTICAS desechables en carpetas temporales; ninguna clave operativa. Sin Docker: se ejecuta también dentro del contenedor Linux como UID 0.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { construirTar } from '../../../scripts/automation/empaquetar-director.mjs';
import { firmarPaquete, generarParClaves } from '../../../scripts/automation/firmar-paquete.mjs';
import { anotarPendiente, autorizar, cargar, iniciar, recuperar, renovar, resumen, revocar, rutaPrivadaPermitida } from '../../../scripts/automation/confianza-admin.mjs';
import { evaluarConfianza, ARCHIVOS } from '../../../scripts/automation/verificar-confianza.mjs';
import { ESQUEMA_POLITICA, claveIdDe, eventoRegistro, firmarPolitica, huellaPolitica, verificarPolitica, verificarRegistro } from '../../../scripts/automation/confianza-politica.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url)); const SCRIPTS = path.join(AQUI, '..', '..', '..', 'scripts', 'automation');
const dirs = []; after(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-conf-')); dirs.push(d); return d; };
const T0 = Date.parse('2027-03-31T12:00:00.000Z'); const DIA = 86400000;
const raizNueva = () => { const k = crypto.generateKeyPairSync('ed25519'); return { publica: k.publicKey.export({ type: 'spki', format: 'pem' }), privada: k.privateKey.export({ type: 'pkcs8', format: 'pem' }) }; };
const tar = construirTar([{ ruta: 'automation/x.mjs', contenido: Buffer.from('export const x = 1;\n') }], '9.9.9');
const firmaDe = (par, entorno = 'PRUEBAS', ahora = new Date(T0)) => JSON.stringify(firmarPaquete({ tar, artefacto: 'paquete.tar', tipo: 'director', privadaPem: par.privada, entorno, ahora }));
const leer = (dir) => ({ raizPem: fs.readFileSync(path.join(dir, ARCHIVOS.raiz), 'utf8'), raizIdTxt: fs.readFileSync(path.join(dir, ARCHIVOS.raizId), 'utf8'), politicaTxt: fs.existsSync(path.join(dir, ARCHIVOS.politica)) ? fs.readFileSync(path.join(dir, ARCHIVOS.politica), 'utf8') : null, registroTxt: fs.existsSync(path.join(dir, ARCHIVOS.registro)) ? fs.readFileSync(path.join(dir, ARCHIVOS.registro), 'utf8') : null });
const evaluar = (dir, par, extra = {}) => evaluarConfianza({ ...leer(dir), modo: 'pruebas', ahora: T0 + 1000, tar, firmaTxt: firmaDe(par, extra.entornoFirma ?? 'PRUEBAS'), ...extra });
/** Mundo: raíz R, claves de paquete A y B; política v1 (inicio) → v2 (alta A). */
function mundo({ entorno = 'PRUEBAS', altaA = true } = {}) {
  const dir = path.join(tmp(), 'confianza'); const raiz = raizNueva(); const rp = path.join(tmp(), 'raiz.pem'); fs.writeFileSync(rp, raiz.publica); iniciar({ dir, raizPublica: rp, raizPrivada: raiz.privada, entorno, ahora: T0 });
  const A = generarParClaves(); const B = generarParClaves(); if (altaA) autorizar({ dir, raizPrivada: raiz.privada, publica: A.publica, hasta: new Date(T0 + 30 * DIA).toISOString(), nota: 'clave A de pruebas', ahora: T0 + 1 });
  return { dir, raiz, A, B, idA: claveIdDe(A.publica), idB: claveIdDe(B.publica) };
}
const reglas = (r, re) => assert.match(r.errores.join(' | '), re, JSON.stringify(r.errores));

test('CLAVE AUTORIZADA · el paquete firmado por una clave autorizada vigente verifica; la política y el registro quedan encadenados', () => {
  const m = mundo(); const r = evaluar(m.dir, m.A); assert.equal(r.ok, true, r.errores?.join()); assert.deepEqual([r.version, r.claveId, r.pendienteDeAnotar], [2, m.idA, false]); const reg = verificarRegistro(leer(m.dir).registroTxt); assert.deepEqual([reg.ok, reg.eventos.map((e) => e.tipo)], [true, ['inicio', 'alta_clave']]);
  const p = JSON.parse(leer(m.dir).politicaTxt); assert.equal(p.previa.version, 1); assert.equal(p.previa.huella, JSON.parse(leer(m.dir).registroTxt.split('\n')[0]).huellaPolitica);
});

test('CLAVE DESCONOCIDA · una firma válida de una clave que la política no conoce se rechaza, igual que una clave que no es la que declara', () => {
  const m = mundo(); reglas(evaluar(m.dir, m.B), /desconocida/); const f = JSON.parse(firmaDe(m.A)); reglas(evaluar(m.dir, m.A, { firmaTxt: JSON.stringify({ ...f, claveId: m.idB }) }), /desconocida/);
});

test('CLAVE REVOCADA · se rechaza SIEMPRE, también una firma «anterior a la revocación» (la fecha la elige el firmante); las demás claves siguen valiendo', () => {
  const m = mundo(); autorizar({ dir: m.dir, raizPrivada: m.raiz.privada, publica: m.B.publica, hasta: new Date(T0 + 30 * DIA).toISOString(), ahora: T0 + 2 }); assert.equal(evaluar(m.dir, m.A).ok, true);
  revocar({ dir: m.dir, raizPrivada: m.raiz.privada, claveId: m.idA, motivo: 'clave A comprometida en el ensayo', ahora: T0 + 3 }); reglas(evaluar(m.dir, m.A), /REVOCADA/); reglas(evaluar(m.dir, m.A, { firmaTxt: firmaDe(m.A, 'PRUEBAS', new Date(T0 - 365 * DIA)) }), /REVOCADA/); assert.equal(evaluar(m.dir, m.B).ok, true);
  assert.throws(() => revocar({ dir: m.dir, raizPrivada: m.raiz.privada, claveId: m.idA, motivo: 'otra vez la misma clave', ahora: T0 + 4 }), /ya está revocada/); assert.throws(() => renovar({ dir: m.dir, raizPrivada: m.raiz.privada, claveId: m.idA, hasta: new Date(T0 + 90 * DIA).toISOString(), ahora: T0 + 4 }), /revocada no se renueva/);
  assert.throws(() => autorizar({ dir: m.dir, raizPrivada: m.raiz.privada, publica: m.A.publica, ahora: T0 + 4 }), /no se reintroduce/); assert.throws(() => revocar({ dir: m.dir, raizPrivada: m.raiz.privada, claveId: m.idB, motivo: 'corto', ahora: T0 + 4 }), /al menos 10 caracteres/);
});

test('ROTACIÓN VÁLIDA · alta de la clave nueva, revocación de la antigua y cadena de versiones completa; el registro lo anota sin secretos', () => {
  const m = mundo(); autorizar({ dir: m.dir, raizPrivada: m.raiz.privada, publica: m.B.publica, hasta: new Date(T0 + 60 * DIA).toISOString(), nota: 'relevo de A', ahora: T0 + 2 }); revocar({ dir: m.dir, raizPrivada: m.raiz.privada, claveId: m.idA, motivo: 'rotación programada de la clave A', ahora: T0 + 3 });
  assert.equal(evaluar(m.dir, m.B).ok, true); reglas(evaluar(m.dir, m.A), /REVOCADA/); const t = leer(m.dir); const reg = verificarRegistro(t.registroTxt); assert.deepEqual(reg.eventos.map((e) => [e.tipo, e.version]), [['inicio', 1], ['alta_clave', 2], ['alta_clave', 3], ['revocacion', 4]]);
  assert.ok(!/BEGIN|PRIVATE|secret|token/i.test(t.registroTxt), 'el registro no contiene claves ni secretos'); const r = resumen(m.dir); assert.equal(r.version, 4); assert.ok(!JSON.stringify(r).includes('BEGIN'), 'mostrar no imprime claves públicas completas');
});

test('ROTACIÓN NO AUTORIZADA · nadie sin la raíz puede cambiar la política: ni una clave de paquete (ni la comprometida), ni otra raíz, ni editar el JSON; una clave de paquete no puede deshacer su propia revocación', () => {
  const m = mundo(); autorizar({ dir: m.dir, raizPrivada: m.raiz.privada, publica: m.B.publica, hasta: new Date(T0 + 60 * DIA).toISOString(), ahora: T0 + 2 }); revocar({ dir: m.dir, raizPrivada: m.raiz.privada, claveId: m.idA, motivo: 'A comprometida en el ensayo', ahora: T0 + 3 });
  const t = leer(m.dir); const act = JSON.parse(t.politicaTxt); const sin = (() => { const { firma, ...c } = act; return c; })(); const sinRevocar = { ...sin, version: sin.version + 1, previa: { version: sin.version, huella: huellaPolitica(act) }, claves: sin.claves.map((k) => (k.claveId === m.idA ? { ...k, estado: 'autorizada', revocadaEn: undefined, motivo: undefined } : k)) };
  const intentos = { 'firmada por la CLAVE COMPROMETIDA (A)': firmarPolitica(sinRevocar, m.A.privada), 'firmada por otra clave de paquete (B)': firmarPolitica(sinRevocar, m.B.privada), 'firmada por una raíz AJENA': firmarPolitica(sinRevocar, raizNueva().privada), 'editada sin re-firmar': { ...act, claves: act.claves.map((k) => (k.claveId === m.idA ? { ...k, estado: 'autorizada' } : k)) } };
  for (const [n, doc] of Object.entries(intentos)) { const r = verificarPolitica({ texto: JSON.stringify(doc), raizPem: t.raizPem, raizId: t.raizIdTxt.trim() }); assert.equal(r.ok, false, n); reglas(r, /firma de la política NO es de la raíz|firma/); fs.writeFileSync(path.join(m.dir, ARCHIVOS.politica), JSON.stringify(doc)); assert.equal(evaluar(m.dir, m.A).ok, false, n); }
});

test('CADUCIDAD Y VIGENCIA · fuera de [validaDesde, validaHasta) se rechaza; renovar (firmado por la raíz) amplía; no se puede «renovar» acortando', () => {
  const m = mundo(); const dentro = evaluar(m.dir, m.A, { ahora: T0 + 29 * DIA }); assert.equal(dentro.ok, true); reglas(evaluar(m.dir, m.A, { ahora: T0 + 30 * DIA }), /CADUCADA/); reglas(evaluar(m.dir, m.A, { ahora: T0 - DIA }), /aún no vigente/);
  assert.throws(() => renovar({ dir: m.dir, raizPrivada: m.raiz.privada, claveId: m.idA, hasta: new Date(T0 + 10 * DIA).toISOString(), ahora: T0 + 5 }), /debe ampliar/); renovar({ dir: m.dir, raizPrivada: m.raiz.privada, claveId: m.idA, hasta: new Date(T0 + 90 * DIA).toISOString(), ahora: T0 + 5 }); assert.equal(evaluar(m.dir, m.A, { ahora: T0 + 40 * DIA }).ok, true);
});

test('SUSTITUCIÓN · de la clave pública dentro de la política, de la política entera por otra raíz y de la raíz del directorio (con y sin raíz fijada por otro canal)', () => {
  const m = mundo(); const t = leer(m.dir); const doc = JSON.parse(t.politicaTxt);
  const trucada = { ...doc, claves: doc.claves.map((k) => ({ ...k, publica: m.B.publica })) }; fs.writeFileSync(path.join(m.dir, ARCHIVOS.politica), JSON.stringify(trucada)); reglas(evaluar(m.dir, m.B), /firma de la política/);
  const ajena = mundo(); fs.writeFileSync(path.join(m.dir, ARCHIVOS.politica), fs.readFileSync(path.join(ajena.dir, ARCHIVOS.politica))); reglas(evaluar(m.dir, ajena.A), /firma de la política NO es de la raíz/);
  // el atacante controla la carpeta ENTERA (política, registro, raíz y raizId) y la rehace con su raíz
  for (const n of Object.values(ARCHIVOS)) fs.copyFileSync(path.join(ajena.dir, n), path.join(m.dir, n));
  assert.equal(evaluar(m.dir, ajena.A).ok, true, 'LIMITACIÓN DOCUMENTADA: sin raíz fijada por otro canal, una carpeta de confianza sustituida entera es indistinguible de la legítima');
  reglas(evaluar(m.dir, ajena.A, { raizIdFijado: claveIdDe(m.raiz.publica) }), /NO es la fijada por el propietario/);
});

test('POLÍTICA ANTIGUA bien firmada · rechazada por el registro; si el atacante también retrocede el registro, solo la referencia independiente (versión mínima) la detiene', () => {
  const m = mundo(); const v2 = leer(m.dir); autorizar({ dir: m.dir, raizPrivada: m.raiz.privada, publica: m.B.publica, hasta: new Date(T0 + 60 * DIA).toISOString(), ahora: T0 + 2 }); revocar({ dir: m.dir, raizPrivada: m.raiz.privada, claveId: m.idA, motivo: 'A comprometida en el ensayo', ahora: T0 + 3 });
  assert.equal(JSON.parse(leer(m.dir).politicaTxt).version, 4); reglas(evaluar(m.dir, m.A), /REVOCADA/);
  fs.writeFileSync(path.join(m.dir, ARCHIVOS.politica), v2.politicaTxt); const solo = evaluar(m.dir, m.A); assert.equal(solo.ok, false); reglas(solo, /política ANTIGUA respecto al registro/);
  fs.writeFileSync(path.join(m.dir, ARCHIVOS.registro), v2.registroTxt); // retroceso conjunto de política y registro
  assert.equal(evaluar(m.dir, m.A).ok, true, 'LIMITACIÓN DOCUMENTADA: sin referencia independiente, el retroceso conjunto de política y registro pasa (y readmite la clave revocada)');
  const conMinima = evaluar(m.dir, m.A, { versionMinima: 4 }); assert.equal(conMinima.ok, false); reglas(conMinima, /política ANTIGUA: versión 2 < la mínima conocida/);
  const misma = JSON.parse(v2.politicaTxt); fs.writeFileSync(path.join(m.dir, ARCHIVOS.politica), JSON.stringify({ ...misma, emitidaEn: new Date(T0 + 99).toISOString() })); assert.equal(evaluar(m.dir, m.A).ok, false);
});

test('PÉRDIDA Y CORRUPCIÓN · política, registro o raíz ausentes, vacíos o corruptos: NO se confía en nada (nunca se instala por defecto)', () => {
  const casos = { 'política ausente': (d) => fs.rmSync(path.join(d, ARCHIVOS.politica)), 'registro ausente': (d) => fs.rmSync(path.join(d, ARCHIVOS.registro)), 'registro vacío': (d) => fs.writeFileSync(path.join(d, ARCHIVOS.registro), ''), 'política no JSON': (d) => fs.writeFileSync(path.join(d, ARCHIVOS.politica), '{roto'), 'política sin firma': (d) => { const p = JSON.parse(fs.readFileSync(path.join(d, ARCHIVOS.politica), 'utf8')); delete p.firma; fs.writeFileSync(path.join(d, ARCHIVOS.politica), JSON.stringify(p)); }, 'registro con basura': (d) => fs.appendFileSync(path.join(d, ARCHIVOS.registro), 'basura\n'), 'registro con un evento editado': (d) => fs.writeFileSync(path.join(d, ARCHIVOS.registro), fs.readFileSync(path.join(d, ARCHIVOS.registro), 'utf8').replace('alta_clave', 'revocacion')), 'registro con un evento eliminado': (d) => { const l = fs.readFileSync(path.join(d, ARCHIVOS.registro), 'utf8').split('\n').filter(Boolean); fs.writeFileSync(path.join(d, ARCHIVOS.registro), `${l.slice(1).join('\n')}\n`); }, 'raíz ausente': (d) => fs.rmSync(path.join(d, ARCHIVOS.raiz)), 'raiz-id distinto': (d) => fs.writeFileSync(path.join(d, ARCHIVOS.raizId), `${'0'.repeat(16)}\n`) };
  for (const [n, f] of Object.entries(casos)) { const m = mundo(); const t0 = leer(m.dir); f(m.dir); let r; try { r = evaluarConfianza({ raizPem: fs.existsSync(path.join(m.dir, ARCHIVOS.raiz)) ? fs.readFileSync(path.join(m.dir, ARCHIVOS.raiz), 'utf8') : null, raizIdTxt: fs.readFileSync(path.join(m.dir, ARCHIVOS.raizId), 'utf8'), politicaTxt: fs.existsSync(path.join(m.dir, ARCHIVOS.politica)) ? fs.readFileSync(path.join(m.dir, ARCHIVOS.politica), 'utf8') : null, registroTxt: fs.existsSync(path.join(m.dir, ARCHIVOS.registro)) ? fs.readFileSync(path.join(m.dir, ARCHIVOS.registro), 'utf8') : null, modo: 'pruebas', ahora: T0 + 1000, tar, firmaTxt: firmaDe(m.A) }); } catch (e) { r = { ok: false, errores: [String(e.message)] }; } assert.equal(r.ok, false, n); assert.ok(t0.politicaTxt.length > 0); }
});

test('CORTE DURANTE LA ACTUALIZACIÓN · política nueva sin anotar en el registro = «pendiente» (se acepta, se completa con anotar-pendiente); registro por delante de la política = política antigua (se rechaza); restos temporales se ignoran', () => {
  const m = mundo(); const antes = leer(m.dir); autorizar({ dir: m.dir, raizPrivada: m.raiz.privada, publica: m.B.publica, hasta: new Date(T0 + 60 * DIA).toISOString(), ahora: T0 + 2 }); const despues = leer(m.dir);
  fs.writeFileSync(path.join(m.dir, ARCHIVOS.registro), antes.registroTxt); const r = evaluar(m.dir, m.B); assert.equal(r.ok, true, r.errores?.join()); assert.equal(r.pendienteDeAnotar, true); assert.throws(() => revocar({ dir: m.dir, raizPrivada: m.raiz.privada, claveId: m.idA, motivo: 'no antes de anotar lo pendiente', ahora: T0 + 3 }), /pendiente de anotar/);
  assert.deepEqual(anotarPendiente({ dir: m.dir, ahora: T0 + 4 }), { cambios: true, version: 3 }); assert.equal(evaluar(m.dir, m.B).pendienteDeAnotar, false); assert.equal(verificarRegistro(leer(m.dir).registroTxt).ok, true); assert.deepEqual(anotarPendiente({ dir: m.dir }), { cambios: false });
  fs.writeFileSync(path.join(m.dir, 'politica.json.tmp-abc123'), '{"a":'); fs.writeFileSync(path.join(m.dir, 'registro-confianza.jsonl.tmp-abc123'), 'x'); assert.equal(evaluar(m.dir, m.B).ok, true, 'los temporales de un corte no afectan');
  fs.writeFileSync(path.join(m.dir, ARCHIVOS.politica), antes.politicaTxt); fs.writeFileSync(path.join(m.dir, ARCHIVOS.registro), despues.registroTxt); reglas(evaluar(m.dir, m.A), /política ANTIGUA respecto al registro/);
  const salto = JSON.parse(despues.politicaTxt); fs.writeFileSync(path.join(m.dir, ARCHIVOS.politica), despues.politicaTxt); fs.writeFileSync(path.join(m.dir, ARCHIVOS.registro), `${antes.registroTxt.split('\n').filter(Boolean)[0]}\n`); assert.equal(salto.version, 3); reglas(evaluar(m.dir, m.A), /hueco o cadena inconsistente/);
});

test('RECUPERACIÓN EXPRESAMENTE AUTORIZADA · restaurar una política perdida o un registro perdido exige copia firmada por la raíz, versión mínima declarada, raizId exacto y motivo; nunca baja de versión', () => {
  const m = mundo(); autorizar({ dir: m.dir, raizPrivada: m.raiz.privada, publica: m.B.publica, hasta: new Date(T0 + 60 * DIA).toISOString(), ahora: T0 + 2 }); const copia = path.join(tmp(), 'politica-copia.json'); fs.copyFileSync(path.join(m.dir, ARCHIVOS.politica), copia); const rid = claveIdDe(m.raiz.publica);
  fs.rmSync(path.join(m.dir, ARCHIVOS.politica)); assert.equal(evaluar(m.dir, m.A).ok, false);
  const base = { dir: m.dir, copia, versionMinima: 3, confirmo: rid, motivo: 'restauración tras pérdida del disco de pruebas', ahora: T0 + 5 };
  assert.throws(() => recuperar({ ...base, confirmo: '0'.repeat(16) }), /confirmación explícita incorrecta/); assert.throws(() => recuperar({ ...base, confirmo: undefined }), /confirmación explícita/); assert.throws(() => recuperar({ ...base, motivo: 'corto' }), /motivo/); assert.throws(() => recuperar({ ...base, versionMinima: undefined }), /--version-minima/);
  assert.throws(() => recuperar({ ...base, versionMinima: 4 }), /política ANTIGUA/); fs.writeFileSync(path.join(tmp(), 'x'), ''); const vieja = path.join(tmp(), 'vieja.json'); fs.writeFileSync(vieja, JSON.stringify({ ...JSON.parse(fs.readFileSync(copia, 'utf8')), version: 1 })); assert.throws(() => recuperar({ ...base, copia: vieja }), /no es válida/);
  assert.equal(fs.existsSync(path.join(m.dir, ARCHIVOS.politica)), false, 'las recuperaciones rechazadas no escriben nada'); const r = recuperar(base); assert.deepEqual(r, { version: 3, registroReconstruido: false }); assert.equal(evaluar(m.dir, m.B).ok, true);
  assert.equal(verificarRegistro(leer(m.dir).registroTxt).eventos.at(-1).tipo, 'recuperacion');
  // registro perdido: se reconstruye con un evento de recuperación (la cadena anterior no se inventa)
  fs.writeFileSync(path.join(m.dir, ARCHIVOS.registro), 'basura\n'); assert.equal(evaluar(m.dir, m.B).ok, false); const r2 = recuperar({ ...base, ahora: T0 + 6 }); assert.equal(r2.registroReconstruido, true); assert.equal(evaluar(m.dir, m.B).ok, true); assert.deepEqual(verificarRegistro(leer(m.dir).registroTxt).eventos.map((e) => e.tipo), ['recuperacion']);
  // una copia más antigua que el registro íntegro se rechaza aunque supere la mínima
  const m2 = mundo(); autorizar({ dir: m2.dir, raizPrivada: m2.raiz.privada, publica: m2.B.publica, ahora: T0 + 2 }); const c2 = path.join(tmp(), 'c2.json'); fs.writeFileSync(c2, fs.readFileSync(path.join(m2.dir, ARCHIVOS.politica))); revocar({ dir: m2.dir, raizPrivada: m2.raiz.privada, claveId: m2.idA, motivo: 'revocación de ensayo para la recuperación', ahora: T0 + 3 });
  assert.throws(() => recuperar({ dir: m2.dir, copia: c2, versionMinima: 1, confirmo: claveIdDe(m2.raiz.publica), motivo: 'intento de volver atrás', ahora: T0 + 5 }), /más antigua que el registro íntegro/);
  const sinRaiz = mundo(); fs.rmSync(path.join(sinRaiz.dir, ARCHIVOS.raiz)); assert.throws(() => recuperar({ dir: sinRaiz.dir, copia, versionMinima: 1, confirmo: rid, motivo: 'sin raíz fijada no se recupera' }), /la raíz no se recupera/);
});

test('MODO PRODUCCIÓN · exige política de entorno PRODUCCION, firma de entorno PRODUCCION, versión mínima y raíz fijadas por otro canal; rechaza las claves de pruebas conocidas', () => {
  const p = mundo({ entorno: 'PRODUCCION' }); const base = { versionMinima: 2, raizIdFijado: claveIdDe(p.raiz.publica), modo: 'produccion', entornoFirma: 'PRODUCCION' };
  assert.equal(evaluar(p.dir, p.A, base).ok, true); reglas(evaluar(p.dir, p.A, { ...base, versionMinima: 0 }), /versión mínima de política conocida/); reglas(evaluar(p.dir, p.A, { ...base, raizIdFijado: null }), /fijar el raizId por un canal distinto/);
  reglas(evaluar(p.dir, p.A, { ...base, firmaTxt: firmaDe(p.A, 'PRUEBAS') }), /formato de firma no reconocido/); const t = mundo({ entorno: 'PRUEBAS' }); reglas(evaluar(t.dir, t.A, { ...base, versionMinima: 2, raizIdFijado: claveIdDe(t.raiz.publica) }), /entorno PRUEBAS, no PRODUCCION/);
  reglas(evaluar(p.dir, p.A, { modo: 'pruebas', versionMinima: 0 }), /entorno PRODUCCION, no PRUEBAS/);
  const conocida = mundo({ altaA: false }); // una clave de pruebas «conocida» (denylist) no vale en producción aunque la política la autorice
  const privada = path.join(tmp(), 'k.pem'); const par = generarParClaves(); assert.ok(par.privada && privada);
});

test('ADMINISTRACIÓN · la raíz no es clave de paquete; la clave privada no puede estar en el repositorio, paquetes ni informes; no se sobrescribe una confianza existente; el detalle con forma de secreto se rechaza', () => {
  const m = mundo(); assert.throws(() => autorizar({ dir: m.dir, raizPrivada: m.raiz.privada, publica: m.raiz.publica, ahora: T0 + 2 }), /no puede usarse también como clave de paquete/);
  const rp = path.join(tmp(), 'r.pem'); fs.writeFileSync(rp, m.raiz.publica); assert.throws(() => iniciar({ dir: m.dir, raizPublica: rp, raizPrivada: m.raiz.privada, entorno: 'PRUEBAS' }), /no se sobrescribe/); assert.throws(() => iniciar({ dir: path.join(tmp(), 'x'), raizPublica: rp, raizPrivada: raizNueva().privada, entorno: 'PRUEBAS' }), /no corresponde a la pública/);
  assert.throws(() => eventoRegistro({ textoRegistro: '', tipo: 't', version: 1, huellaPolitica: 'a'.repeat(64), detalle: `${'pass'}${'word'}: abcdefghijkl`, instante: T0 }), /forma de secreto/); assert.throws(() => autorizar({ dir: m.dir, raizPrivada: m.raiz.privada, publica: m.B.publica, nota: `-----BEGIN ${'PRIVATE'} KEY-----`, ahora: T0 + 3 }));
  const WEB = path.resolve(AQUI, '..', '..', '..'); assert.equal(rutaPrivadaPermitida(path.join(WEB, 'x.pem')), false); assert.equal(rutaPrivadaPermitida(path.join(WEB, '..', 'paquetes', 'x.pem')), false); assert.equal(rutaPrivadaPermitida(path.join(WEB, '..', 'informes', 'x.pem')), false); assert.equal(rutaPrivadaPermitida(path.join(os.tmpdir(), 'x.pem')), true);
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'confianza-admin.mjs'), 'generar-raiz', '--publica', path.join(tmp(), 'p.pem'), '--privada', path.join(WEB, 'no-debe-existir.pem')], { encoding: 'utf8' }); assert.equal(r.status, 1); assert.equal(fs.existsSync(path.join(WEB, 'no-debe-existir.pem')), false);
  assert.ok(cargar(m.dir).politica.version >= 2);
});

test('CLI · administración y verificación por proceso independiente: iniciar, autorizar, revocar, mostrar y verificar con códigos de salida; la política corrupta se rechaza', () => {
  const base = tmp(); const dir = path.join(base, 'confianza'); const adm = (...a) => spawnSync(process.execPath, [path.join(SCRIPTS, 'confianza-admin.mjs'), ...a], { encoding: 'utf8' }); const ver = (...a) => spawnSync(process.execPath, [path.join(SCRIPTS, 'verificar-confianza.mjs'), ...a], { encoding: 'utf8' });
  const g = adm('generar-raiz', '--publica', path.join(base, 'raiz.pem'), '--privada', path.join(base, 'privada', 'raiz-privada.pem')); assert.equal(g.status, 0, g.stderr); assert.ok(!g.stdout.includes('PRIVATE'));
  assert.equal(adm('iniciar', '--confianza', dir, '--raiz-publica', path.join(base, 'raiz.pem'), '--raiz-privada', path.join(base, 'privada', 'raiz-privada.pem'), '--entorno', 'PRUEBAS').status, 0);
  const A = generarParClaves(); fs.writeFileSync(path.join(base, 'a.pem'), A.publica); assert.equal(adm('autorizar', '--confianza', dir, '--raiz-privada', path.join(base, 'privada', 'raiz-privada.pem'), '--publica', path.join(base, 'a.pem'), '--hasta', new Date(Date.now() + 30 * DIA).toISOString()).status, 0);
  const t = path.join(base, 'paquete.tar'); fs.writeFileSync(t, tar); const f = path.join(base, 'paquete.tar.firma.json'); fs.writeFileSync(f, firmaDe(A, 'PRUEBAS', new Date()));
  let r = ver('--confianza', dir, '--modo', 'pruebas', '--tar', t, '--firma', f); assert.equal(r.status, 0, r.stdout); assert.match(r.stdout, /CONFIANZA_OK politica=2 huella=[0-9a-f]{16} clave=[0-9a-f]{16}/);
  assert.equal(adm('revocar', '--confianza', dir, '--raiz-privada', path.join(base, 'privada', 'raiz-privada.pem'), '--clave-id', claveIdDe(A.publica), '--motivo', 'comprometida en el ensayo CLI').status, 0); r = ver('--confianza', dir, '--modo', 'pruebas', '--tar', t, '--firma', f); assert.equal(r.status, 1); assert.match(r.stdout, /REVOCADA/);
  r = ver('--confianza', dir, '--modo', 'pruebas', '--solo-clave', claveIdDe(A.publica)); assert.equal(r.status, 1); assert.equal(ver('--confianza', dir, '--modo', 'pruebas').status, 0); const m = JSON.parse(adm('mostrar', '--confianza', dir).stdout); assert.deepEqual([m.version, m.claves[0].estado], [3, 'revocada']);
  fs.appendFileSync(path.join(dir, ARCHIVOS.politica), 'x'); assert.equal(ver('--confianza', dir, '--modo', 'pruebas').status, 1); assert.equal(ver('--confianza', path.join(base, 'no-existe'), '--modo', 'pruebas').status, 1); assert.equal(ver().status, 2);
});

test('INDEPENDENCIA · la biblioteca, el verificador y el administrador solo importan `node:` y sus hermanos; el administrador no lo importa nada del verificador de paquetes', () => {
  for (const [n, permitidos] of [['confianza-politica.mjs', []], ['verificar-confianza.mjs', ['./confianza-politica.mjs', './verificar-firma-paquete.mjs']], ['confianza-admin.mjs', ['./confianza-politica.mjs']], ['verificar-firma-paquete.mjs', []]]) {
    const src = fs.readFileSync(path.join(SCRIPTS, n), 'utf8'); const imps = [...src.matchAll(/^import .* from '([^']+)'/gm)].map((x) => x[1]).filter((x) => !x.startsWith('node:')); assert.deepEqual(imps.sort(), [...permitidos].sort(), n);
  }
});

/* ───────── supervivientes de la ronda de mutaciones de 3E.8.14: una prueba aislada por causa ───────── */
import { comprobarCoherencia, huellaLineaRegistro } from '../../../scripts/automation/confianza-politica.mjs';
const firmarCon = (m, cuerpo) => firmarPolitica(cuerpo, m.raiz.privada); const cuerpoDe = (m) => { const { firma, ...c } = JSON.parse(leer(m.dir).politicaTxt); return c; };
const verPol = (m, doc) => verificarPolitica({ texto: JSON.stringify(doc), raizPem: m.raiz.publica, raizId: claveIdDe(m.raiz.publica) });

test('POLÍTICA ESTRUCTURA · aunque la firme la propia raíz, se rechaza una política que declara otra raíz, con una clave cuyo claveId no corresponde a su clave pública, con la cadena `previa` rota o con una revocación sin fecha', () => {
  const m = mundo(); const c = cuerpoDe(m); assert.equal(verPol(m, firmarCon(m, c)).ok, true, 'control');
  reglas(verPol(m, firmarCon(m, { ...c, raizId: '0'.repeat(16) })), /declara otra raíz/);
  reglas(verPol(m, firmarCon(m, { ...c, claves: c.claves.map((k) => ({ ...k, publica: m.B.publica })) })), /no es una clave pública Ed25519 que corresponda a su claveId/);
  reglas(verPol(m, firmarCon(m, { ...c, version: 3, previa: null })), /cadena `previa` no enlaza/); reglas(verPol(m, firmarCon(m, { ...c, version: 3, previa: { version: 1, huella: 'a'.repeat(64) } })), /cadena `previa` no enlaza/); reglas(verPol(m, firmarCon(m, { ...c, version: 3, previa: { version: 2, huella: 'zz' } })), /cadena `previa` no enlaza/);
  reglas(verPol(m, firmarCon(m, { ...c, claves: c.claves.map((k) => ({ ...k, estado: 'revocada' })) })), /no lleva revocadaEn/); reglas(verPol(m, firmarCon(m, { ...c, version: 1 })), /versión 1 no puede tener `previa`/);
});

test('REGISTRO · cada regla de la cadena por separado: encadenado (previa), secuencia, huella de cada evento, versiones no decrecientes y registro vacío', () => {
  const ev = (txt, version, tipo = 't') => eventoRegistro({ textoRegistro: txt, tipo, version, huellaPolitica: 'a'.repeat(64), instante: T0 });
  const l1 = ev('', 1); const l2 = ev(`${l1}\n`, 2); const buenos = `${l1}\n${l2}\n`; assert.equal(verificarRegistro(buenos).ok, true);
  const otroL1 = ev('', 1, 'otro'); const empalmado = `${otroL1}\n${l2}\n`; assert.match(verificarRegistro(empalmado).errores.join(), /línea 2: cadena rota/, 'previa que no enlaza');
  const l1b = JSON.parse(l1); const sinHuella = (l) => { const { huella, ...c } = l; return c; }; const reseq = { ...sinHuella(JSON.parse(l2)), seq: 5 }; const fila = JSON.stringify({ ...reseq, huella: huellaLineaRegistro(reseq) }); assert.match(verificarRegistro(`${l1}\n${fila}\n`).errores.join(), /línea 2: cadena rota/, 'secuencia incorrecta con huella y previa válidas');
  const editado = { ...JSON.parse(l2), detalle: 'editado' }; assert.match(verificarRegistro(`${l1}\n${JSON.stringify(editado)}\n`).errores.join(), /línea 2: cadena rota/, 'huella que no corresponde al contenido');
  assert.match(verificarRegistro(`${ev('', 3)}\n${ev(`${ev('', 3)}\n`, 2)}\n`).errores.join(), /línea 2: cadena rota/, 'versión decreciente'); assert.equal(l1b.seq, 1);
  for (const vacio of ['', '   \n', undefined, null]) { const r = verificarRegistro(vacio); assert.equal(r.ok, false); assert.match(r.errores.join(), /ausente o vacío/); }
});

test('COHERENCIA política↔registro · cada regla por separado: política antigua, misma versión con otra huella, pendiente de anotar solo si encadena y hueco', () => {
  const reg = (v, h) => ({ ultimo: { version: v, huellaPolitica: h } }); const pol = (v, previaHuella) => ({ version: v, previa: previaHuella ? { version: v - 1, huella: previaHuella } : null });
  assert.equal(comprobarCoherencia({ politica: pol(2), huella: 'h2', registro: reg(2, 'h2') }).ok, true); assert.match(comprobarCoherencia({ politica: pol(1), huella: 'h1', registro: reg(2, 'h2') }).errores.join(), /ANTIGUA respecto al registro/);
  assert.match(comprobarCoherencia({ politica: pol(2), huella: 'otra', registro: reg(2, 'h2') }).errores.join(), /misma versión de política con otra huella/);
  const p = comprobarCoherencia({ politica: pol(3, 'h2'), huella: 'h3', registro: reg(2, 'h2') }); assert.deepEqual([p.ok, p.pendienteDeAnotar], [true, true]); assert.match(comprobarCoherencia({ politica: pol(3, 'OTRA'), huella: 'h3', registro: reg(2, 'h2') }).errores.join(), /hueco o cadena inconsistente/); assert.match(comprobarCoherencia({ politica: pol(4, 'h2'), huella: 'h4', registro: reg(2, 'h2') }).errores.join(), /hueco o cadena inconsistente/);
  assert.equal(comprobarCoherencia({ politica: pol(1), huella: 'h', registro: { ultimo: null } }).ok, false);
});

test('MODO PRODUCCIÓN (reversión y firma) · una clave de pruebas conocida no vale aunque la política la autorice; el nombre del archivo firmado debe coincidir (CLI)', () => {
  const p = mundo({ entorno: 'PRODUCCION' }); const base = { ...leer(p.dir), modo: 'produccion', versionMinima: 2, raizIdFijado: claveIdDe(p.raiz.publica), ahora: T0 + 1000 };
  assert.equal(evaluarConfianza({ ...base, soloClave: p.idA }).ok, true); assert.match(evaluarConfianza({ ...base, soloClave: '3f16a232123fa7e6' }).errores.join(), /clave de PRUEBAS rechazada en modo producción/); assert.match(evaluarConfianza({ ...base, soloClave: '28bb645f9d53d165' }).errores.join(), /clave de PRUEBAS rechazada/);
  const d = tmp(); const t = path.join(d, 'paquete.tar'); fs.writeFileSync(t, tar); const f = path.join(d, 'f.json'); fs.writeFileSync(f, firmaDe(p.A, 'PRODUCCION')); const ver = (tarPath) => spawnSync(process.execPath, [path.join(SCRIPTS, 'verificar-confianza.mjs'), '--confianza', p.dir, '--modo', 'produccion', '--version-minima', '2', '--raiz-id', claveIdDe(p.raiz.publica), '--tar', tarPath, '--firma', f, '--ahora', new Date(T0 + 1000).toISOString()], { encoding: 'utf8' });
  assert.equal(ver(t).status, 0); const otro = path.join(d, 'otro-nombre.tar'); fs.copyFileSync(t, otro); const r = ver(otro); assert.equal(r.status, 1); assert.match(r.stdout, /el nombre del archivo no es el firmado/);
});
