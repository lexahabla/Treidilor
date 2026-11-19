// Agente 00 · 3E.8.8 · Integridad periódica supervisada + anclaje externo en el ledger. Datos SINTÉTICOS, ledger y almacenes en carpetas temporales, sin red, sin planificador.
// Integra con el comando del PROTOTIPO (treidilor-ai): si no está disponible en este equipo, las pruebas de integración se omiten (las puras se ejecutan siempre).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ErrorLedger, LedgerLocal } from '../ledger.mjs';
import { proyectar } from '../proyecciones.mjs';
import { validarEsquema } from '../../../scripts/automation/validate-schema.mjs';
import { CONFIG_INTEGRIDAD } from '../integridad/config.mjs';
import { anclar, decidirAnclaje, leerAncla } from '../integridad/ancla.mjs';
import { debeEjecutar, enVentanaProhibida, estadoIntegridad, validarPoliticaIntegridad } from '../integridad/estado.mjs';
import { ejecutarIntegridadSupervisada, interpretarSalida, lanzarComando, mapearCodigo, soltarBloqueo, tomarBloqueo } from '../integridad/ejecucion.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PROTO = path.resolve(process.env.TAI_PROTOTIPO_INCIDENCIAS || path.join(AQUI, '..', '..', '..', '..', 'treidilor-ai', 'prototipo-incidencias-director'));
const CLI = path.join(PROTO, 'src', 'integridad-cli.mjs');
const hay = fs.existsSync(CLI);
const ESQ = JSON.parse(fs.readFileSync(path.join(AQUI, '..', '..', 'schemas', 'evento-ledger.schema.json'), 'utf8'));
const dirs = []; const limpiar = () => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); }; after(limpiar);
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-int88-')); dirs.push(d); return d; };
const H = 3600000;
const T0 = Date.parse('2027-03-31T10:00:00.000Z'); // 12:00 en Madrid (fuera de la franja 08:50-10:05)
const I = test; // pruebas de integración: se omiten sin el prototipo
const itest = (n, f) => I(n, { skip: !hay && 'prototipo no disponible' }, f);

/* ───────── PURAS (siempre) ───────── */
test('POLITICA · validarPoliticaIntegridad y valores por defecto (6/12/24 h, cada hora, franja 08:50-10:05 Madrid, límites del proceso)', () => {
  assert.deepEqual(validarPoliticaIntegridad(), { ok: true }); assert.deepEqual([CONFIG_INTEGRIDAD.politica.intervaloMs, CONFIG_INTEGRIDAD.politica.avisoMs, CONFIG_INTEGRIDAD.politica.falloMs, CONFIG_INTEGRIDAD.comprobacionCadaMs], [6 * H, 12 * H, 24 * H, H]);
  for (const mal of [{ intervaloMs: 0, avisoMs: 2, falloMs: 3 }, { intervaloMs: 30000, avisoMs: H, falloMs: 2 * H }, { intervaloMs: H, avisoMs: H, falloMs: 2 * H }, { intervaloMs: H, avisoMs: 2 * H, falloMs: 2 * H }, { intervaloMs: 8 * 24 * H, avisoMs: 9 * 24 * H, falloMs: 10 * 24 * H }, null]) assert.equal(validarPoliticaIntegridad(mal).ok, false, JSON.stringify(mal));
  assert.ok(Object.isFrozen(CONFIG_INTEGRIDAD) && Object.isFrozen(CONFIG_INTEGRIDAD.politica));
  assert.ok(CONFIG_INTEGRIDAD.timeoutMs <= 300000 && CONFIG_INTEGRIDAD.maxOldSpaceMiB <= 200 && CONFIG_INTEGRIDAD.maxSalidaBytes <= 131072);
});

test('FRANJAS · enVentanaProhibida: 08:50 incluida, 10:05 excluida, hora de Madrid con horario de verano e invierno, y franjas que cruzan la medianoche', () => {
  const utc = (s) => Date.parse(s);
  const v = CONFIG_INTEGRIDAD.ventanasProhibidas;
  assert.deepEqual(['2027-01-15T07:49:00Z', '2027-01-15T07:50:00Z', '2027-01-15T09:04:00Z', '2027-01-15T09:05:00Z'].map((x) => enVentanaProhibida(utc(x), v)), [false, true, true, false], 'invierno (UTC+1)');
  assert.deepEqual(['2027-07-15T06:49:00Z', '2027-07-15T06:50:00Z', '2027-07-15T08:04:00Z', '2027-07-15T08:05:00Z'].map((x) => enVentanaProhibida(utc(x), v)), [false, true, true, false], 'verano (UTC+2)');
  const noche = [{ desde: '23:30', hasta: '00:30' }]; assert.deepEqual(['2027-01-15T22:29:00Z', '2027-01-15T22:30:00Z', '2027-01-15T23:29:00Z', '2027-01-15T23:30:00Z'].map((x) => enVentanaProhibida(utc(x), noche)), [false, true, true, false]);
});

const ejec = (instante, datos) => ({ tipo: 'integridad_ejecucion', instante: new Date(instante).toISOString(), secuencia: 1, datos: { resultado: 'ok', completa: true, codigoSalida: 0, ...datos }, refs: { idAlmacen: 'a' } });
test('TOCA · debeEjecutar (pura): primera obligatoria, tentativa no satisfactoria, vigente, intervalo exacto y marcas de tiempo inválidas; un resultado «omitido» o parcial nunca cuenta como satisfactorio', () => {
  const ahora = T0; const pol = CONFIG_INTEGRIDAD.politica;
  assert.deepEqual(debeEjecutar({ eventos: [], ahora }), { debe: true, motivo: 'primera_obligatoria', edadMs: null });
  assert.equal(debeEjecutar({ eventos: [ejec(ahora - H, { resultado: 'incompleta', completa: false, codigoSalida: 2 })], ahora }).motivo, 'primera_obligatoria', 'una incompleta no es satisfactoria');
  assert.equal(debeEjecutar({ eventos: [ejec(ahora - H, { codigoSalida: 3 })], ahora }).motivo, 'primera_obligatoria', 'ok con código 3 (evidencia no guardada) no cuenta');
  assert.equal(debeEjecutar({ eventos: [ejec(ahora - H, { completa: false })], ahora }).motivo, 'primera_obligatoria', 'ok no completa no cuenta');
  assert.deepEqual([debeEjecutar({ eventos: [ejec(ahora - H, {})], ahora }).debe, debeEjecutar({ eventos: [ejec(ahora - 6 * H + 1, {})], ahora }).debe, debeEjecutar({ eventos: [ejec(ahora - 6 * H, {})], ahora }).debe], [false, false, true]);
  assert.equal(debeEjecutar({ eventos: [ejec(ahora - 2 * H, {}), ejec(ahora - H, { resultado: 'alterada', codigoSalida: 1, completa: false })], ahora }).motivo, 'ultima_tentativa_no_satisfactoria');
  assert.equal(debeEjecutar({ eventos: [ejec(ahora + H, {})], ahora }).motivo, 'marca_de_tiempo_no_valida');
  assert.equal(debeEjecutar({ eventos: [ejec(ahora - H, {})], ahora, politica: { ...pol, intervaloMs: H } }).debe, true, 'intervalo configurable');
});

test('MAPA DE CODIGOS · 0 correcta · 1 alteración confirmada (no se reintenta) · 2 aviso · 3 error operativo; un código inesperado es error operativo', () => {
  assert.deepEqual([0, 1, 2, 3, 9].map((c) => mapearCodigo(c).significado), ['correcta', 'alteracion_confirmada', 'aviso', 'error_operativo', 'error_operativo']);
  assert.deepEqual([0, 1, 2, 3].map((c) => mapearCodigo(c).nivel), ['ok', 'fallo', 'aviso', 'aviso']); assert.deepEqual([0, 1, 2, 3].map((c) => mapearCodigo(c).reintentar), [false, false, true, true]);
});

const cabeza = (seq) => ({ seq, huella: `sha256:${String(seq).padStart(2, '0')}${'c'.repeat(62)}` });
const okCli = (extra = {}) => ({ omitida: false, resultado: 'ok', codigoSalida: 0, completa: true, cabeza: cabeza(10), anclaExterna: 'coincide', comparacionRegistro: 'coincide', referencia: 'valida', ...extra });
test('DECISION DE ANCLAJE (pura): cada protección aislada — omitida, no correcta, incompleta, sin cabeza, ancla no comprobada, ancla ausente con historial, retroceso, misma cabeza, avance, reanclaje sin y con autorización', () => {
  const d = (ancla, cli, reanclar) => decidirAnclaje({ ancla, resultadoCli: okCli(cli), reanclar });
  const A = cabeza(5);
  assert.deepEqual(d(A, { omitida: true }), { accion: 'no_anclar', motivo: 'omitida' }); assert.equal(decidirAnclaje({ ancla: A, resultadoCli: null }).motivo, 'omitida');
  for (const mal of [{ resultado: 'incompleta' }, { resultado: 'alterada', codigoSalida: 1 }, { resultado: 'retroceso', codigoSalida: 1 }, { resultado: 'error', codigoSalida: 3 }, { codigoSalida: 2 }, { completa: false }, { cabeza: null }, { cabeza: { seq: 3, huella: 'x' } }, { cabeza: { seq: -1, huella: cabeza(1).huella } }]) assert.deepEqual(d(A, mal), { accion: 'no_anclar', motivo: 'verificacion_no_correcta' }, JSON.stringify(mal));
  assert.equal(d(A, { anclaExterna: 'no_aplica' }).motivo, 'ancla_no_comprobada'); assert.equal(d(A, { anclaExterna: 'posterior' }).motivo, 'ancla_no_comprobada'); assert.equal(d(null, { anclaExterna: 'coincide' }).motivo, 'ancla_no_comprobada');
  assert.deepEqual(d(null, { anclaExterna: 'sin_ancla', comparacionRegistro: 'primera', referencia: 'ausente' }), { accion: 'anclar', motivo: 'primera_ancla' });
  assert.equal(d(null, { anclaExterna: 'sin_ancla', comparacionRegistro: 'coincide', referencia: 'valida' }).motivo, 'ancla_ausente_con_historial'); assert.equal(d(null, { anclaExterna: 'sin_ancla', comparacionRegistro: 'primera', referencia: 'ilegible' }).motivo, 'ancla_ausente_con_historial');
  assert.deepEqual(d(A, { cabeza: cabeza(4) }), { accion: 'discrepancia', motivo: 'cabeza_menor_que_ancla' }); assert.deepEqual(d(A, { cabeza: cabeza(5) }), { accion: 'sin_cambio', motivo: 'misma_cabeza' });
  assert.deepEqual(d(A, { cabeza: { seq: 5, huella: `sha256:${'f'.repeat(64)}` } }), { accion: 'discrepancia', motivo: 'misma_seq_distinta_huella' }); assert.deepEqual(d(A, { cabeza: cabeza(6) }), { accion: 'anclar', motivo: 'avance' });
  const aut = { confirmar: true, motivo: 'restauracion deliberada de la copia del 12/11', autorizadoPor: 'propietario' };
  assert.deepEqual(d(A, { cabeza: cabeza(2), anclaExterna: 'no_aplica' }, aut), { accion: 'anclar', motivo: 'reanclaje_explicito' });
  for (const mal of [{ ...aut, confirmar: false }, { ...aut, motivo: 'corto' }, { ...aut, autorizadoPor: 'sistema' }, { ...aut, autorizadoPor: undefined }]) assert.equal(d(A, { cabeza: cabeza(2) }, mal).motivo, 'reanclaje_sin_autorizacion', JSON.stringify(mal));
  assert.equal(d(A, { cabeza: cabeza(2), resultado: 'alterada', codigoSalida: 1 }, aut).motivo, 'verificacion_no_correcta', 'ni siquiera un reanclaje explícito se apoya en una verificación fallida');
});

/* ───────── ANCLA EN EL LEDGER ───────── */
let ahoraL = T0;
const crearLedger = (dir = tmp()) => new LedgerLocal({ dir, particion: 'integridad', reloj: () => new Date(ahoraL), raiz: '/__sin_raiz__' });
const evAnc = (l) => l.leer((x) => x.tipo === 'ancla_integridad');

test('ANCLA · anclar es MONÓTONO e IDEMPOTENTE: avanza, repite sin nuevo evento, rechaza una cabeza anterior y una misma seq con otra huella; reinicio (otra instancia del ledger) conserva el ancla; el evento valida el esquema y no activa el filtro de secretos', () => {
  const dir = tmp(); let l = crearLedger(dir);
  assert.deepEqual(leerAncla(l, 'gestor'), { estado: 'ausente' });
  const a1 = anclar(l, { idAlmacen: 'gestor', cabeza: cabeza(10), motivo: 'primera_ancla', segmentos: 3, eventosTotales: 10 }); assert.equal(a1.accion, 'anclado'); assert.equal(a1.evento.tipo, 'ancla_integridad');
  assert.equal(anclar(l, { idAlmacen: 'gestor', cabeza: cabeza(10), motivo: 'avance' }).accion, 'sin_cambio'); assert.equal(evAnc(l).length, 1, 'reintento: sin duplicados');
  assert.equal(anclar(l, { idAlmacen: 'gestor', cabeza: cabeza(12), motivo: 'avance' }).accion, 'anclado');
  assert.deepEqual(anclar(l, { idAlmacen: 'gestor', cabeza: cabeza(11), motivo: 'avance' }), { accion: 'rechazado', motivo: 'retroceso_rechazado' });
  assert.deepEqual(anclar(l, { idAlmacen: 'gestor', cabeza: { seq: 12, huella: `sha256:${'e'.repeat(64)}` }, motivo: 'avance' }), { accion: 'rechazado', motivo: 'misma_seq_distinta_huella' });
  assert.equal(evAnc(l).length, 2); l = crearLedger(dir); const v = leerAncla(l, 'gestor'); assert.deepEqual([v.estado, v.ancla.seq, v.ancla.huella], ['vigente', 12, cabeza(12).huella]);
  assert.equal(leerAncla(l, 'otro').estado, 'ausente', 'el ancla es por almacén');
  for (const e of evAnc(l)) { assert.deepEqual(validarEsquema(e, ESQ), []); assert.ok(e.datos.previa === null || e.datos.previa.seq < e.datos.seq); }
  assert.deepEqual(anclar(l, { idAlmacen: 'x', cabeza: cabeza(3), motivo: 'avance' }), { accion: 'rechazado', motivo: 'sin_ancla_previa_sin_primera' }); assert.equal(evAnc(l).length, 2);
  assert.throws(() => anclar(l, { idAlmacen: 'Mal Id!', cabeza: cabeza(3), motivo: 'primera_ancla' }), (e) => e.codigo === 'almacen_invalido'); assert.throws(() => anclar(l, { idAlmacen: 'ok', cabeza: { seq: 1, huella: 'x' }, motivo: 'primera_ancla' }), (e) => e.codigo === 'cabeza_invalida');
});

test('ANCLA · sin ancla previa solo se acepta la «primera_ancla»; el reanclaje explícito SÍ puede retroceder y lo deja registrado con la ancla previa, la autorización y el motivo; nunca se borra el ancla anterior', () => {
  const l = crearLedger(); assert.deepEqual(anclar(l, { idAlmacen: 'g', cabeza: cabeza(7), motivo: 'avance' }), { accion: 'rechazado', motivo: 'sin_ancla_previa_sin_primera' });
  anclar(l, { idAlmacen: 'g', cabeza: cabeza(20), motivo: 'primera_ancla' });
  const r = anclar(l, { idAlmacen: 'g', cabeza: cabeza(8), motivo: 'reanclaje_explicito', reanclar: { confirmar: true, motivo: 'restauracion deliberada de la copia del 12/11', autorizadoPor: 'propietario' } });
  assert.equal(r.accion, 'anclado'); assert.deepEqual([r.evento.datos.permiteRetroceso, r.evento.datos.previa.seq, r.evento.datos.autorizadoPor], [true, 20, 'propietario']); assert.equal(leerAncla(l, 'g').ancla.seq, 8); assert.equal(evAnc(l).length, 2, 'el ancla anterior queda como evidencia');
  const otra = anclar(l, { idAlmacen: 'g', cabeza: cabeza(20), motivo: 'reanclaje_explicito', reanclar: { confirmar: true, motivo: 'vuelta a la cabeza anterior autorizada', autorizadoPor: 'propietario' } }); assert.equal(otra.accion, 'anclado', 'volver a una cabeza ya anclada antes también cuenta como un reanclaje nuevo'); assert.equal(leerAncla(l, 'g').ancla.seq, 20);
});

test('ANCLA · conflicto de secuencia: otra escritura se adelanta, se relee y reevalúa; si entre medias alguien ancló una cabeza posterior, la nuestra se rechaza (no retrocede)', () => {
  const l = crearLedger(); anclar(l, { idAlmacen: 'g', cabeza: cabeza(5), motivo: 'primera_ancla' });
  const original = l.anadir.bind(l); let n = 0;
  l.anadir = (ev, esperada) => { if (n === 0 && ev.tipo === 'ancla_integridad') { n = 1; original({ tipo: 'ancla_integridad', actor: 'sistema', refs: { idAlmacen: 'g' }, datos: { esquema: 'ancla-integridad/1', seq: 30, huella: cabeza(30).huella, motivo: 'avance' } }); } return original(ev, esperada); };
  assert.deepEqual(anclar(l, { idAlmacen: 'g', cabeza: cabeza(10), motivo: 'avance' }), { accion: 'rechazado', motivo: 'retroceso_rechazado' }); assert.equal(leerAncla(l, 'g').ancla.seq, 30);
  const l2 = crearLedger(); anclar(l2, { idAlmacen: 'g', cabeza: cabeza(5), motivo: 'primera_ancla' }); const o2 = l2.anadir.bind(l2); l2.anadir = (ev, esp) => { if (ev.tipo === 'ancla_integridad') { o2({ tipo: 'lectura_estado', actor: 'sistema', datos: {} }); } return o2(ev, esp); };
  assert.throws(() => anclar(l2, { idAlmacen: 'g', cabeza: cabeza(9), motivo: 'avance', reintentos: 3 }), (e) => e.codigo === 'conflicto_persistente'); assert.equal(leerAncla(l2, 'g').ancla.seq, 5, 'un conflicto persistente no deja un ancla a medias');
});

test('LEDGER NO ÍNTEGRO · una línea alterada, el archivo truncado con el ancla propia del ledger o una cola incompleta → `ilegible` (nunca «ausente»); no se ancla ni se interpreta nada', () => {
  const dir = tmp(); const l = crearLedger(dir); anclar(l, { idAlmacen: 'g', cabeza: cabeza(5), motivo: 'primera_ancla' }); anclar(l, { idAlmacen: 'g', cabeza: cabeza(6), motivo: 'avance' }); const texto = fs.readFileSync(l.archivo, 'utf8'); const lineas = texto.split('\n').filter(Boolean);
  fs.writeFileSync(l.archivo, lineas.slice(0, 1).join('\n') + '\n'); assert.equal(leerAncla(crearLedger(dir), 'g').estado, 'ilegible', 'truncado (el ancla del ledger registra más)');
  fs.writeFileSync(l.archivo, texto.replace(`"seq":6`, `"seq":9`)); assert.equal(leerAncla(crearLedger(dir), 'g').estado, 'ilegible', 'alterado');
  fs.writeFileSync(l.archivo, texto + '{"incompleto'); assert.equal(leerAncla(crearLedger(dir), 'g').estado, 'ilegible', 'cola incompleta');
  assert.throws(() => anclar(crearLedger(dir), { idAlmacen: 'g', cabeza: cabeza(7), motivo: 'avance' }), (e) => e.codigo === 'ledger_no_integro'); fs.writeFileSync(l.archivo, texto); assert.equal(leerAncla(crearLedger(dir), 'g').ancla.seq, 6);
});

/* ───────── INTEGRACIÓN con el comando del prototipo ───────── */
let almacenMod = null; let util = null;
const cargar = async () => { if (almacenMod) return; const u = (p) => import(pathToFileURL(path.join(PROTO, p)).href); const [a, p, s, ad, ut] = await Promise.all([u('src/almacen/almacen.mjs'), u('src/almacen/politicaRutas.mjs'), u('src/simulacion/datos.mjs'), u('src/adaptador/instantanea.mjs'), u('test/util-integracion.mjs')]); almacenMod = { ...a, ...p, ...s, ...ad }; util = ut; };
const dia = (n) => Date.parse('2027-03-01T00:00:00.000Z') + n * 86400000; let cont = 0;
const nuevas = (n) => Array.from({ length: n }, () => { cont += 1; return { clave: `ficha:sin_imagen:z${String(cont).padStart(6, '0')}`, gravedad: 'media' }; });
async function almacen() { await cargar(); const raiz = tmp(); const g = path.join(raiz, 'g'); fs.mkdirSync(g); return { raiz, rG: g, dir: path.join(g, 'almacen'), aut: almacenMod.autorizarRaiz(g) }; }
const abrirA = (e, d) => almacenMod.abrirAlmacen({ dir: e.dir, autorizacion: e.aut, reloj: () => dia(d) + 12 * H, limites: { observacionMs: 20, esperaMs: 0, maxCopias: 4 } });
function obs(d, anadir = []) { const gen = new Date(dia(d) + 7 * H).toISOString(); const f = almacenMod.filaDeInstantanea(almacenMod.construirInstantanea(util.BASE, { generadoEn: gen, anadir }), { idEjecucion: `x${d}`, id: d + 1 }); const r = almacenMod.respuestaLector([f], { limite: 5, idSolicitud: 'lreq0000abcd', exportadoEn: gen }); return almacenMod.observacionDeRespuesta(r, { ahoraIso: new Date(dia(d) + 12 * H).toISOString(), esperada: { entorno: 'produccion' } }).datos; }
const dias = (e, desde, hasta) => { for (let d = desde; d <= hasta; d += 1) assert.ok(abrirA(e, d).procesarObservacion(obs(d, d === 0 ? [] : nuevas(4))).ok); };
const sha = (f) => fs.readFileSync(f);
const correr = (e, l, extra = {}) => ejecutarIntegridadSupervisada({ ledger: l, idAlmacen: 'gestor', almacenDir: e.dir, cli: CLI, reloj: () => ahoraL, config: { ...CONFIG_INTEGRIDAD, ...(extra.config ?? {}) }, ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'config')) });
const tipos = (l, t) => l.leer((x) => x.tipo === t);
const REG = (e) => path.join(e.dir, 'integridad-diario.json');

itest('PRIMERA EJECUCION OBLIGATORIA y no debida: el ledger vacío obliga a verificar (aunque el almacén ya tenga registro); correcta → ancla primera + evento; dentro de las 6 h «no toca» sin lanzar nada ni cambiar el ancla; a las 6 h verifica y avanza', async () => {
  const e = await almacen(); dias(e, 0, 6); const l = crearLedger(); ahoraL = T0;
  const r1 = await correr(e, l); assert.deepEqual([r1.estado, r1.resultado, r1.codigoSalida, r1.accionAncla, r1.motivoAncla], ['ejecutada', 'ok', 0, 'anclado', 'primera_ancla']); assert.ok(r1.recursos && r1.recursos.maxRssMiB > 0);
  assert.equal(tipos(l, 'ancla_integridad').length, 1); assert.equal(tipos(l, 'integridad_ejecucion').length, 1); assert.equal(r1.estadoIntegridad.nivel, 'ok'); assert.equal(r1.estadoIntegridad.ancla.estado, 'vigente'); assert.equal(r1.estadoIntegridad.siguienteComprobacion, new Date(T0 + 6 * H).toISOString());
  const antes = fs.readFileSync(l.archivo); ahoraL = T0 + 2 * H; const r2 = await correr(e, l); assert.deepEqual([r2.estado, r2.ejecutado, r2.motivo], ['no_toca', false, 'vigente']); assert.deepEqual(fs.readFileSync(l.archivo), antes, 'no toca: el ledger no cambia');
  dias(e, 7, 9); ahoraL = T0 + 6 * H; const r3 = await correr(e, l); assert.deepEqual([r3.estado, r3.accionAncla, r3.motivoAncla], ['ejecutada', 'anclado', 'avance']); assert.ok(leerAncla(l, 'gestor').ancla.seq > tipos(l, 'ancla_integridad')[0].datos.seq);
  ahoraL = T0 + 12 * H; const r4 = await correr(e, l); assert.deepEqual([r4.accionAncla, r4.motivoAncla], ['sin_cambio', 'misma_cabeza'], 'sin novedades en el almacén el ancla no cambia ni se duplica'); assert.equal(tipos(l, 'ancla_integridad').length, 2);
  const f = await correr(e, l, { forzar: true }); assert.equal(f.estado, 'ejecutada', 'forzar ignora «no toca»');
});

itest('RESTAURACION COMPLETA del almacén (el ledger conserva una cabeza posterior): retroceso confirmado (código 1) por el ANCLA y solo por ella; el ancla no cambia; queda evidencia sin duplicarla; el registro propio del almacén no se usa como referencia', async () => {
  const e = await almacen(); dias(e, 0, 5); const copia = path.join(e.raiz, 'copia'); fs.cpSync(e.dir, copia, { recursive: true }); dias(e, 6, 11); const l = crearLedger(); ahoraL = T0; assert.equal((await correr(e, l)).resultado, 'ok'); const ancla0 = leerAncla(l, 'gestor').ancla;
  for (const n of fs.readdirSync(e.dir)) fs.rmSync(path.join(e.dir, n), { recursive: true, force: true }); for (const n of fs.readdirSync(copia)) fs.cpSync(path.join(copia, n), path.join(e.dir, n), { recursive: true }); // restauración antigua: sin registro de integridad
  ahoraL = T0 + 6 * H; const r = await correr(e, l); assert.deepEqual([r.resultado, r.codigoSalida, r.nivel, r.accionAncla], ['retroceso', 1, 'fallo', 'no_anclar']); assert.ok(r.motivos.some((m) => m.startsWith('ancla_externa_posterior')), r.motivos.join()); assert.deepEqual(leerAncla(l, 'gestor').ancla.seq, ancla0.seq);
  assert.equal(tipos(l, 'integridad_discrepancia').length, 1); assert.equal(r.discrepancia, 'registrada'); const d = tipos(l, 'integridad_discrepancia')[0].datos; assert.deepEqual([d.resultado, d.anclaVigente.seq], ['retroceso', ancla0.seq]); assert.equal(typeof d.cabezaObservada.huella, 'string'); assert.ok(d.cabezaObservada.huella.length <= 16);
  ahoraL = T0 + 7 * H; const r2 = await correr(e, l); assert.deepEqual([r2.codigoSalida, r2.discrepancia], [1, 'ya_registrada']); assert.equal(tipos(l, 'integridad_discrepancia').length, 1, 'misma situación: no se duplica la alerta'); assert.equal(tipos(l, 'integridad_ejecucion').length, 3, 'cada tentativa sí deja su estado');
  const st = estadoIntegridad({ ledger: l, idAlmacen: 'gestor', ahora: ahoraL }); assert.deepEqual([st.nivel, st.alteracionConfirmada, st.ancla.estado], ['fallo', true, 'vigente']); assert.ok(st.motivos.includes('integridad_alteracion_confirmada'));
  assert.equal(st.ultimaSatisfactoria.instante, new Date(T0).toISOString(), 'la última satisfactoria no se pisa con un fallo');
});

itest('RESTAURACION SOLO DEL LEDGER: el archivo antiguo con el ancla propia del ledger más nueva se DETECTA (ilegible, sin escribir ni anclar); restaurar archivo y ancla JUNTOS no es observable y baja el ancla (limitación documentada)', async () => {
  const e = await almacen(); dias(e, 0, 5); const dirL = tmp(); const l = crearLedger(dirL); ahoraL = T0; await correr(e, l); const viejoJsonl = fs.readFileSync(l.archivo); const viejaAncla = fs.readFileSync(l.ancla);
  dias(e, 6, 10); ahoraL = T0 + 6 * H; await correr(e, l); const seqNueva = leerAncla(l, 'gestor').ancla.seq;
  // (a) solo el archivo del ledger vuelve atrás; su ancla propia no
  fs.writeFileSync(l.archivo, viejoJsonl); const l2 = crearLedger(dirL); ahoraL = T0 + 12 * H; const antes = fs.readFileSync(l.archivo); const r = await correr(e, l2, { forzar: true });
  assert.deepEqual([r.accionAncla, r.motivoAncla, r.anclaEstado, r.registrado], ['no_anclar', 'ledger_no_integro', 'ilegible', false]); assert.deepEqual(fs.readFileSync(l.archivo), antes, 'no se escribe en un ledger no íntegro'); const st = estadoIntegridad({ ledger: l2, idAlmacen: 'gestor', ahora: ahoraL }); assert.deepEqual([st.nivel, st.ancla.estado], ['fallo', 'ilegible']); assert.ok(st.motivos.includes('ancla_ilegible'));
  // (b) archivo y ancla restaurados juntos (copia coherente más antigua): indistinguible de un ledger legítimo
  fs.writeFileSync(l.ancla, viejaAncla); const l3 = crearLedger(dirL); assert.equal(leerAncla(l3, 'gestor').ancla.seq < seqNueva, true, 'el ancla ha retrocedido'); ahoraL = T0 + 18 * H; const r3 = await correr(e, l3, { forzar: true });
  assert.deepEqual([r3.resultado, r3.accionAncla], ['ok', 'anclado']); assert.equal(leerAncla(l3, 'gestor').ancla.seq, seqNueva, 'el almacén (correcto) vuelve a avanzar el ancla: la restauración conjunta del ledger NO se detecta');
});

itest('PERDIDA DEL LEDGER: con historial en el almacén NO se vuelve a anclar sola (aviso 2, «sin_ancla»); un reanclaje sin autorización se rechaza; con autorización explícita se ancla y queda constancia', async () => {
  const e = await almacen(); dias(e, 0, 5); ahoraL = T0; const l1 = crearLedger(); assert.equal((await correr(e, l1)).motivoAncla, 'primera_ancla'); // el almacén ya tiene su registro propio
  const nuevoLedger = crearLedger(tmp()); ahoraL = T0 + 6 * H; const r = await correr(e, nuevoLedger); assert.deepEqual([r.resultado, r.codigoSalida, r.accionAncla, r.motivoAncla], ['sin_ancla', 2, 'no_anclar', 'ancla_ausente_con_historial']); assert.equal(tipos(nuevoLedger, 'ancla_integridad').length, 0);
  const st = estadoIntegridad({ ledger: nuevoLedger, idAlmacen: 'gestor', ahora: ahoraL }); assert.equal(st.nivel, 'aviso'); assert.ok(st.motivos.includes('ancla_no_fiable') && st.motivos.includes('ancla_ausente'));
  ahoraL = T0 + 7 * H; const sin = await correr(e, nuevoLedger, { forzar: true, reanclar: { confirmar: true, motivo: 'corto', autorizadoPor: 'propietario' } }); assert.equal(sin.motivoAncla, 'reanclaje_sin_autorizacion'); assert.equal(tipos(nuevoLedger, 'ancla_integridad').length, 0);
  ahoraL = T0 + 8 * H; const ok = await correr(e, nuevoLedger, { forzar: true, reanclar: { confirmar: true, motivo: 'el ledger se perdio; el almacen se ha verificado a mano', autorizadoPor: 'propietario' } }); assert.deepEqual([ok.resultado, ok.accionAncla, ok.motivoAncla], ['ok', 'anclado', 'reanclaje_explicito']); assert.equal(estadoIntegridad({ ledger: nuevoLedger, idAlmacen: 'gestor', ahora: ahoraL }).nivel, 'ok');
});

itest('ALTERACION en el almacén (segmento): código 1, el ancla no avanza, la evidencia se registra una sola vez por situación y una nueva alteración tras una verificación correcta genera una alerta nueva', async () => {
  const e = await almacen(); dias(e, 0, 8); abrirA(e, 9).rotarDiario(); const l = crearLedger(); ahoraL = T0; assert.equal((await correr(e, l)).resultado, 'ok'); const seg = path.join(e.dir, 'diario-segmentos', 'seg-00000001.jsonl'); const orig = fs.readFileSync(seg);
  const alterar = () => { const m = Buffer.from(orig); m[50] ^= 1; fs.writeFileSync(seg, m); }; alterar(); ahoraL = T0 + H; const a = await correr(e, l, { forzar: true }); assert.deepEqual([a.resultado, a.codigoSalida, a.accionAncla, a.discrepancia], ['alterada', 1, 'no_anclar', 'registrada']); ahoraL = T0 + 2 * H; assert.equal((await correr(e, l, { forzar: true })).discrepancia, 'ya_registrada');
  fs.writeFileSync(seg, orig); ahoraL = T0 + 3 * H; assert.equal((await correr(e, l, { forzar: true })).resultado, 'ok'); alterar(); ahoraL = T0 + 4 * H; const b = await correr(e, l, { forzar: true }); assert.equal(b.discrepancia, 'registrada', 'tras una correcta intermedia, la misma alteración vuelve a ser una alerta nueva'); assert.equal(tipos(l, 'integridad_discrepancia').length, 2);
  const st = estadoIntegridad({ ledger: l, idAlmacen: 'gestor', ahora: ahoraL }); assert.deepEqual([st.nivel, st.alteracionConfirmada], ['fallo', true]); fs.writeFileSync(seg, orig); ahoraL = T0 + 5 * H; await correr(e, l, { forzar: true }); assert.equal(estadoIntegridad({ ledger: l, idAlmacen: 'gestor', ahora: ahoraL }).alteracionConfirmada, false, 'verificada de nuevo: ya no hay alteración vigente (la evidencia queda en el ledger)');
});

itest('SEGMENTO AUSENTE → código 2 (incompleta): no avanza el ancla ni cuenta como satisfactoria; estado de aviso', async () => {
  const e = await almacen(); dias(e, 0, 8); abrirA(e, 9).rotarDiario(); const l = crearLedger(); ahoraL = T0; await correr(e, l); const seg = path.join(e.dir, 'diario-segmentos', 'seg-00000001.jsonl'); const o = fs.readFileSync(seg); fs.rmSync(seg); ahoraL = T0 + H; dias(e, 10, 12);
  const r = await correr(e, l, { forzar: true }); assert.deepEqual([r.resultado, r.codigoSalida, r.accionAncla, r.nivel], ['incompleta', 2, 'no_anclar', 'aviso']); const st = estadoIntegridad({ ledger: l, idAlmacen: 'gestor', ahora: ahoraL }); assert.deepEqual([st.nivel, st.ultimaSatisfactoria.instante], ['aviso', new Date(T0).toISOString()]); assert.ok(st.motivos.includes('integridad_incompleta')); fs.writeFileSync(seg, o);
});

itest('DOS EJECUCIONES SIMULTANEAS del mismo trabajo: una ejecuta y la otra recibe `ya_en_ejecucion` (un único evento y un único ancla); un cerrojo huérfano antiguo se retoma; uno reciente se respeta', async () => {
  const e = await almacen(); dias(e, 0, 4); const l = crearLedger(); ahoraL = T0; const [a, b] = await Promise.all([correr(e, l), correr(e, l)]);
  assert.deepEqual([a.estado, b.estado].sort(), ['ejecutada', 'ya_en_ejecucion']); assert.equal(tipos(l, 'integridad_ejecucion').length, 1); assert.equal(tipos(l, 'ancla_integridad').length, 1); assert.equal(fs.existsSync(path.join(l.dir, 'integridad-gestor.lock')), false, 'el cerrojo se libera');
  const lock = path.join(l.dir, 'integridad-gestor.lock'); fs.writeFileSync(lock, '{}'); ahoraL = T0 + 6 * H; assert.equal((await correr(e, l)).estado, 'ya_en_ejecucion', 'cerrojo reciente: se respeta'); const viejo = new Date(Date.now() - 3600000); fs.utimesSync(lock, viejo, viejo); assert.equal((await correr(e, l)).estado, 'ejecutada', 'cerrojo huérfano caducado: se retoma');
  const b1 = tomarBloqueo({ dir: l.dir, idAlmacen: 'x1', caducaMs: 60000, ahora: Date.now() }); assert.equal(b1.ok, true); assert.equal(tomarBloqueo({ dir: l.dir, idAlmacen: 'x1', caducaMs: 60000, ahora: Date.now() }).ok, false); soltarBloqueo({ ...b1, token: 'otro' }); assert.equal(fs.existsSync(b1.ruta), true, 'solo libera quien lo tomó'); soltarBloqueo(b1); assert.equal(fs.existsSync(b1.ruta), false);
});

itest('FRANJA DEL GESTOR Y VIGILANTE: dentro de 08:50-10:05 (Madrid) se APLAZA sin lanzar nada ni cambiar el ledger; `forzar` la ignora', async () => {
  const e = await almacen(); dias(e, 0, 3); const l = crearLedger(); ahoraL = Date.parse('2027-03-31T07:30:00Z'); // 09:30 Madrid (verano)
  const r = await correr(e, l); assert.deepEqual([r.estado, r.ejecutado], ['aplazada_ventana', false]); assert.equal(l.estado().ultimaSecuencia, 0); assert.equal(fs.existsSync(REG(e)), false, 'ni siquiera se lanzó el comando');
  assert.equal((await correr(e, l, { forzar: true })).estado, 'ejecutada');
});

/* ── comandos falsos: terminaciones inesperadas, timeout, recursos y compatibilidad ── */
const falso = (cuerpo) => { const f = path.join(tmp(), 'cli-falso.mjs'); fs.writeFileSync(f, cuerpo); return f; };
const salidaOk = (extra = {}) => ({ formato: 'integridad-ejecucion/1', resultado: 'ok', nivel: 'ok', codigoSalida: 0, omitida: false, tentativa: { completa: true, cabeza: cabeza(9), segmentos: 1, eventosTotales: 9, comparacion: 'primera', referencia: 'ausente', anclaExterna: 'sin_ancla', reintento: false, motivos: [] }, registroEscrito: true, recursos: { cpuMs: 1, maxRssMiB: 40 }, ...extra });
const cliQue = (obj, codigo) => falso(`console.log(JSON.stringify(${JSON.stringify(obj)})); process.exitCode = ${codigo};`);
const dirAlm = () => { const d = tmp(); return path.join(d, 'almacen'); };
const sup = (l, cli, extra = {}) => ejecutarIntegridadSupervisada({ ledger: l, idAlmacen: 'gestor', almacenDir: dirAlm(), cli, reloj: () => ahoraL, config: { ...CONFIG_INTEGRIDAD, timeoutMs: 4000, ...(extra.config ?? {}) }, ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'config')) });

test('TERMINACIONES Y SALIDAS ANORMALES: señal, timeout, salida excesiva, ruido sin JSON, JSON con código de proceso distinto, resultado incoherente con el código y versión de formato desconocida → error operativo (3), sin ancla y con el comando muerto', async () => {
  const caso = async (nombre, cli, motivo, extra = {}) => { const l = crearLedger(); ahoraL = T0; const r = await sup(l, cli, extra); assert.deepEqual([r.resultado, r.codigoSalida, r.accionAncla], ['error', 3, 'no_anclar'], nombre); assert.ok(r.motivos.some((m) => m.startsWith(motivo)), `${nombre}: ${r.motivos.join()}`); assert.equal(tipos(l, 'ancla_integridad').length, 0, nombre); assert.equal(tipos(l, 'integridad_ejecucion')[0].datos.completa, false); assert.equal(fs.existsSync(path.join(l.dir, 'integridad-gestor.lock')), false, `${nombre}: cerrojo liberado`); return r; };
  await caso('terminación inesperada (en Windows no hay señales: sale con código 1 sin JSON)', falso('process.kill(process.pid, "SIGKILL");'), process.platform === 'win32' ? 'salida_no_valida' : 'terminacion_inesperada:SIGKILL');
  const t0 = Date.now(); await caso('timeout', falso('setTimeout(() => {}, 60000);'), 'timeout', { config: { timeoutMs: 600 } }); assert.ok(Date.now() - t0 < 5000, 'el timeout mata al hijo');
  await caso('salida excesiva', falso('process.stdout.write("x".repeat(300000));'), 'salida_excesiva', { config: { maxSalidaBytes: 4096 } });
  await caso('sin JSON', falso('console.log("hola"); process.exitCode = 0;'), 'salida_no_valida');
  await caso('código de proceso distinto', cliQue(salidaOk(), 1), 'codigo_de_proceso_distinto_del_declarado');
  await caso('resultado incoherente', cliQue(salidaOk({ resultado: 'alterada', codigoSalida: 0 }), 0), 'resultado_incoherente_con_el_codigo');
  await caso('formato de versión desconocida', cliQue(salidaOk({ formato: 'integridad-ejecucion/2' }), 0), 'salida_no_valida');
  await caso('resultado desconocido', cliQue(salidaOk({ resultado: 'rarisimo' }), 0), 'salida_no_valida');
  await caso('no se puede lanzar', path.join(tmp(), 'no-existe.mjs'), 'salida_no_valida');
});

test('AGOTAMIENTO DE RECURSOS: un hijo que supera el montón de V8 permitido muere sin JSON (error 3) y el Director sigue; el límite se pasa al hijo (`--max-old-space-size`) y el entorno se reduce al mínimo', async () => {
  const l = crearLedger(); ahoraL = T0; const cli = falso('const a = []; for (;;) a.push(new Array(1e6).fill(1));');
  const r = await sup(l, cli, { config: { maxOldSpaceMiB: 24, timeoutMs: 20000 } }); assert.deepEqual([r.resultado, r.codigoSalida], ['error', 3]); assert.ok(r.motivos.some((m) => m.startsWith('salida_no_valida') || m.startsWith('terminacion_inesperada')), r.motivos.join());
  const p = await lanzarComando({ cli: falso('import v8 from "node:v8"; console.log(JSON.stringify({ heap: Math.round(v8.getHeapStatistics().heap_size_limit / 1048576), env: Object.keys(process.env) }));'), args: [], timeoutMs: 5000, maxOldSpaceMiB: 64, maxSalidaBytes: 4096, env: { ...process.env, TAI_SECRETO_DE_PRUEBA: 'x', PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } });
  const j = JSON.parse(p.stdout.trim()); assert.ok(j.heap <= 64 + 200, `límite de montón aplicado: ${j.heap} MiB`); const sinLimite = await lanzarComando({ cli: falso('import v8 from "node:v8"; console.log(JSON.stringify({ heap: Math.round(v8.getHeapStatistics().heap_size_limit / 1048576) }));'), args: [], timeoutMs: 5000, maxOldSpaceMiB: 4096, maxSalidaBytes: 4096 }); assert.ok(JSON.parse(sinLimite.stdout.trim()).heap > j.heap + 1000, 'el límite pasado se refleja en el hijo (V8 suma ≈ 190 MiB de espacios auxiliares)'); assert.ok(!j.env.includes('TAI_SECRETO_DE_PRUEBA') && !j.env.includes('TRADYLOR_API_TOKEN'), 'el entorno del hijo es mínimo'); assert.ok(j.env.every((k) => /^(HOME|HOMEDRIVE|HOMEPATH|LOGONSERVER|PATH|SYSTEMDRIVE|SYSTEMROOT|TEMP|TMP|TMPDIR|USERDOMAIN|USERNAME|USERPROFILE|WINDIR|LANG)$/i.test(k)), j.env.join());
});

test('COMPATIBILIDAD DE VERSIONES: campos desconocidos en la salida se ignoran; un resultado «omitido» jamás avanza el ancla ni deja evento; los eventos nuevos validan el esquema y las proyecciones del Director los ignoran sin anomalías', async () => {
  const l = crearLedger(); ahoraL = T0; const ok = await sup(l, cliQue(salidaOk({ campoNuevo: { a: 1 }, tentativa: { ...salidaOk().tentativa, otroCampo: 7 } }), 0)); assert.deepEqual([ok.resultado, ok.accionAncla], ['ok', 'anclado']);
  const l2 = crearLedger(); const om = await sup(l2, cliQue(salidaOk({ omitida: true }), 0)); assert.deepEqual([om.accionAncla, om.motivoAncla], ['no_anclar', 'omitida']); assert.equal(l2.estado().ultimaSecuencia, 0, 'omitido: ni ancla ni evento');
  const l3 = crearLedger(); const par = await sup(l3, cliQue(salidaOk({ tentativa: { ...salidaOk().tentativa, completa: false } }), 0)); assert.equal(par.accionAncla, 'no_anclar'); assert.equal(tipos(l3, 'ancla_integridad').length, 0, 'parcial: no ancla');
  for (const ev of l.leer()) assert.deepEqual(validarEsquema(ev, ESQ), []); const pr = proyectar(l.leer()); assert.deepEqual(pr.anomalias, [], JSON.stringify(pr.anomalias));
});

test('INTERPRETACION DE LA SALIDA (pura): campos mínimos, recorte de motivos y coherencia código/resultado', () => {
  const proc = (obj, codigo, extra = {}) => ({ stdout: `${JSON.stringify(obj)}\n`, stderr: '', codigo, senal: null, timeout: false, salidaExcesiva: false, errorLanzamiento: null, duracionMs: 5, ...extra });
  const ok = interpretarSalida(proc(salidaOk({ tentativa: { ...salidaOk().tentativa, motivos: Array.from({ length: 20 }, (_, i) => `m${i}`) } }), 0)); assert.equal(ok.resultado, 'ok'); assert.equal(ok.motivos.length, 8);
  assert.equal(interpretarSalida(proc(salidaOk({ resultado: 'ok', codigoSalida: 3, registroEscrito: false }), 3)).codigoSalida, 3);
  for (const [r, c, bien] of [['ok', 0, true], ['ok', 2, true], ['ok', 1, false], ['incompleta', 2, true], ['incompleta', 0, false], ['alterada', 1, true], ['alterada', 3, false], ['retroceso', 1, true], ['error', 3, true], ['error', 0, false]]) assert.equal(!interpretarSalida(proc(salidaOk({ resultado: r, codigoSalida: c }), c)).motivos.includes('resultado_incoherente_con_el_codigo'), bien, `${r}/${c}`);
});

/* ───────── fallos de lectura y escritura ───────── */
itest('ERRORES DE ESCRITURA EN EL LEDGER (ENOSPC): un avance del ancla que no se puede escribir → error 3 «ancla_no_escrita», ejecución NO satisfactoria y ancla anterior intacta; al volver el espacio se reintenta y avanza; si falla el PRIMER anclaje, el almacén ya tiene historial y exige reanclaje explícito (limitación documentada)', async () => {
  const e = await almacen(); dias(e, 0, 4); class LedgerConFallo extends LedgerLocal { _escribirLinea(x) { if (this.sinEspacio) { const err = new Error('ENOSPC'); err.code = 'ENOSPC'; throw err; } return super._escribirLinea(x); } }
  const dir = tmp(); const l = new LedgerConFallo({ dir, particion: 'integridad', reloj: () => new Date(ahoraL), raiz: '/__sin_raiz__' }); ahoraL = T0; assert.equal((await correr(e, l)).accionAncla, 'anclado'); const ancla0 = leerAncla(l, 'gestor').ancla.seq; const antes = fs.readFileSync(l.archivo);
  dias(e, 5, 8); l.sinEspacio = true; ahoraL = T0 + 6 * H; const r = await correr(e, l); assert.deepEqual([r.resultado, r.codigoSalida, r.accionAncla, r.registrado], ['error', 3, 'fallida', false]); assert.ok(r.motivos.includes('ancla_no_escrita')); assert.deepEqual(fs.readFileSync(l.archivo), antes, 'nada escrito a medias'); assert.equal(leerAncla(l, 'gestor').ancla.seq, ancla0);
  l.sinEspacio = false; ahoraL = T0 + 7 * H; const r2 = await correr(e, l); assert.deepEqual([r2.resultado, r2.accionAncla, r2.motivoAncla], ['ok', 'anclado', 'avance']); assert.ok(leerAncla(l, 'gestor').ancla.seq > ancla0); assert.equal(estadoIntegridad({ ledger: l, idAlmacen: 'gestor', ahora: ahoraL }).nivel, 'ok');
  // primer anclaje fallido
  const e2 = await almacen(); dias(e2, 0, 4); const l2 = new LedgerConFallo({ dir: tmp(), particion: 'integridad', reloj: () => new Date(ahoraL), raiz: '/__sin_raiz__' }); l2.sinEspacio = true; ahoraL = T0; const p = await correr(e2, l2); assert.deepEqual([p.resultado, p.accionAncla], ['error', 'fallida']);
  l2.sinEspacio = false; ahoraL = T0 + H; const q = await correr(e2, l2, { forzar: true }); assert.deepEqual([q.resultado, q.motivoAncla], ['sin_ancla', 'ancla_ausente_con_historial'], 'el registro propio del almacén ya existe: no se acepta como primera ancla sin autorización');
  ahoraL = T0 + 2 * H; assert.equal((await correr(e2, l2, { forzar: true, reanclar: { confirmar: true, motivo: 'el primer anclaje fallo por falta de espacio', autorizadoPor: 'propietario' } })).accionAncla, 'anclado');
});

itest('ERRORES DE LECTURA: almacén inexistente o ilegible → error 3 operativo (sin ancla, nada creado); el estado pasa a aviso y 3 errores seguidos lo elevan a fallo', async () => {
  const l = crearLedger(); const inex = path.join(tmp(), 'no-existe'); const q = (t) => { ahoraL = t; return ejecutarIntegridadSupervisada({ ledger: l, idAlmacen: 'gestor', almacenDir: inex, cli: CLI, reloj: () => ahoraL, config: CONFIG_INTEGRIDAD, forzar: true }); };
  const r1 = await q(T0); assert.deepEqual([r1.resultado, r1.codigoSalida, r1.accionAncla], ['error', 3, 'no_anclar']); assert.equal(fs.existsSync(inex), false, 'no se crea nada');
  let st = estadoIntegridad({ ledger: l, idAlmacen: 'gestor', ahora: ahoraL }); assert.deepEqual([st.nivel, st.errorOperativo], ['aviso', true]); await q(T0 + H); assert.equal(estadoIntegridad({ ledger: l, idAlmacen: 'gestor', ahora: ahoraL }).nivel, 'aviso'); await q(T0 + 2 * H);
  st = estadoIntegridad({ ledger: l, idAlmacen: 'gestor', ahora: ahoraL }); assert.deepEqual([st.nivel, st.erroresSeguidos], ['fallo', 3]); assert.ok(st.motivos.includes('integridad_errores_repetidos'));
});

itest('REINICIO Y TERMINACION ABRUPTA DEL DIRECTOR (kill -9 con el comando en marcha): el ledger no cambia, queda un cerrojo huérfano que caduca y la siguiente pasada se completa', async () => {
  const e = await almacen(); dias(e, 0, 4); const dirL = tmp(); const lento = falso('await new Promise((r) => setTimeout(r, 4000)); console.log("{}");');
  const guion = `import { LedgerLocal } from ${JSON.stringify(pathToFileURL(path.join(AQUI, '..', 'ledger.mjs')).href)}; import { ejecutarIntegridadSupervisada } from ${JSON.stringify(pathToFileURL(path.join(AQUI, '..', 'integridad', 'ejecucion.mjs')).href)}; import { CONFIG_INTEGRIDAD } from ${JSON.stringify(pathToFileURL(path.join(AQUI, '..', 'integridad', 'config.mjs')).href)};
const l = new LedgerLocal({ dir: ${JSON.stringify(dirL)}, particion: 'integridad', raiz: '/__sin_raiz__' }); await ejecutarIntegridadSupervisada({ ledger: l, idAlmacen: 'gestor', almacenDir: ${JSON.stringify(e.dir)}, cli: ${JSON.stringify(lento)}, reloj: () => ${T0}, config: { ...CONFIG_INTEGRIDAD, timeoutMs: 20000 } });`;
  const hijo = spawn(process.execPath, ['--input-type=module', '-e', guion], { stdio: 'ignore' }); const lock = path.join(dirL, 'integridad-gestor.lock');
  for (let i = 0; i < 100 && !fs.existsSync(lock); i += 1) await new Promise((r) => setTimeout(r, 50)); assert.ok(fs.existsSync(lock), 'el cerrojo se tomó'); hijo.kill('SIGKILL'); await new Promise((r) => hijo.on('close', r));
  const l = crearLedger(dirL); assert.equal(l.estado().ultimaSecuencia, 0, 'nada escrito'); assert.equal(fs.existsSync(lock), true, 'cerrojo huérfano'); ahoraL = T0; assert.equal((await correr(e, l)).estado, 'ya_en_ejecucion', 'aún reciente'); const viejo = new Date(Date.now() - 3600000); fs.utimesSync(lock, viejo, viejo);
  await new Promise((r) => setTimeout(r, 4500)); const r = await correr(e, l); assert.deepEqual([r.estado, r.resultado, r.accionAncla], ['ejecutada', 'ok', 'anclado']);
});

itest('ALMACEN INDEPENDIENTE DEL LEDGER: el ancla NO se toma del registro del almacén aunque este diga otra cosa; si el almacén restaurado trae un registro «más reciente» sigue mandando el ledger', async () => {
  const e = await almacen(); dias(e, 0, 5); const copia = path.join(e.raiz, 'c'); fs.cpSync(e.dir, copia, { recursive: true }); dias(e, 6, 9); const l = crearLedger(); ahoraL = T0; await correr(e, l);
  const regNuevo = fs.readFileSync(REG(e)); for (const n of fs.readdirSync(e.dir)) fs.rmSync(path.join(e.dir, n), { recursive: true, force: true }); for (const n of fs.readdirSync(copia)) fs.cpSync(path.join(copia, n), path.join(e.dir, n), { recursive: true }); fs.writeFileSync(REG(e), regNuevo); // almacén antiguo + registro de integridad «reciente» que lo da por bueno
  ahoraL = T0 + 6 * H; const r = await correr(e, l); assert.equal(r.resultado, 'retroceso'); assert.ok(r.motivos.some((m) => m.startsWith('ancla_externa_posterior') || m.startsWith('cabeza_retrocede')));
  const solo = r.motivos.filter((m) => m.startsWith('ancla_externa')); assert.ok(solo.length >= 1, 'la evidencia del ancla externa está presente aunque el registro propio también se queje');
});

test('AISLAMIENTO ESTÁTICO: el supervisor no usa shell ni rutas relativas, no borra ni modifica el almacén (solo su cerrojo) y no abre red ni crea temporizadores o servicios', () => {
  const d = path.join(AQUI, '..', 'integridad'); const t = ['ejecucion.mjs', 'ancla.mjs', 'estado.mjs', 'config.mjs'].map((n) => fs.readFileSync(path.join(d, n), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')).join('\n');
  assert.ok(!/shell:\s*true|execSync|exec\(|execFile|node:(http|https|net|dgram|dns|tls)/.test(t)); assert.ok(!/setInterval|cron|schtasks|systemd|\.listen\(/.test(t));
  const borra = [...t.matchAll(/(unlinkSync|rmSync|rmdirSync|renameSync|truncateSync|writeFileSync|appendFileSync|copyFileSync)/g)].map((m) => m[1]); assert.deepEqual([...new Set(borra)].sort(), ['unlinkSync'], 'solo se retira el cerrojo propio'); assert.ok(/'integridad-\$\{idAlmacen\}\.lock'|integridad-\$\{idAlmacen\}\.lock/.test(t));
  assert.ok(!/process\.env\.(TRADYLOR|OPENAI|ANTHROPIC|GROQ|GEMINI)/.test(t));
});

/* ───────── protecciones que antes se tapaban entre sí (cada una, aislada) ───────── */
test('ANCLA · un ledger cuya LECTURA falla (aunque su estado parezca sano) no permite anclar: `leerAncla` lo declara ilegible y `anclar` se niega', () => {
  const l = crearLedger(); anclar(l, { idAlmacen: 'g', cabeza: cabeza(5), motivo: 'primera_ancla' }); const leerOriginal = l.leer.bind(l);
  l.leer = () => { throw new ErrorLedger('ledger_corrupto', 'lectura imposible'); };
  assert.equal(leerAncla(l, 'g').estado, 'ilegible'); assert.throws(() => anclar(l, { idAlmacen: 'g', cabeza: cabeza(9), motivo: 'avance' }), (e) => e.codigo === 'ledger_no_integro'); l.leer = leerOriginal; assert.equal(leerAncla(l, 'g').ancla.seq, 5);
});

test('ESTADO · límites exactos: a las 12 h exactas aviso, a las 24 h exactas fallo, 1 ms antes no; y el estado sobre un ledger no íntegro es «ancla_ilegible» (fallo), nunca vacío', () => {
  const l = crearLedger(); ahoraL = T0; l.anadir({ tipo: 'integridad_ejecucion', actor: 'sistema', refs: { idAlmacen: 'g' }, datos: { resultado: 'ok', completa: true, codigoSalida: 0, cabeza: cabeza(3), accionAncla: 'anclado' } }); anclar(l, { idAlmacen: 'g', cabeza: cabeza(3), motivo: 'primera_ancla' });
  const n = (ms) => estadoIntegridad({ ledger: l, idAlmacen: 'g', ahora: T0 + ms }).nivel;
  assert.deepEqual([n(12 * H - 1), n(12 * H), n(24 * H - 1), n(24 * H)], ['ok', 'aviso', 'aviso', 'fallo']);
  fs.writeFileSync(l.archivo, fs.readFileSync(l.archivo, 'utf8').replace('"resultado":"ok"', '"resultado":"zz"')); const roto = estadoIntegridad({ ledger: crearLedger(l.dir), idAlmacen: 'g', ahora: T0 }); assert.deepEqual([roto.nivel, roto.ancla.estado], ['fallo', 'ilegible']);
});

test('DISCREPANCIA DEL ANCLA (el comando declara «correcta» pero la cabeza no encaja con el ancla vigente): se eleva a retroceso (1), no avanza nada y deja evidencia; con la misma seq y otra huella también', async () => {
  for (const [nombre, cab, motivo] of [['cabeza anterior', cabeza(15), 'cabeza_menor_que_ancla'], ['misma seq, otra huella', { seq: 20, huella: `sha256:${'d'.repeat(64)}` }, 'misma_seq_distinta_huella']]) {
    const l = crearLedger(); anclar(l, { idAlmacen: 'gestor', cabeza: cabeza(20), motivo: 'primera_ancla' }); l.anadir({ tipo: 'integridad_ejecucion', actor: 'sistema', refs: { idAlmacen: 'gestor' }, datos: { resultado: 'ok', completa: true, codigoSalida: 0, cabeza: cabeza(20) } });
    ahoraL = T0 + 6 * H; const r = await sup(l, cliQue(salidaOk({ tentativa: { ...salidaOk().tentativa, cabeza: cab, anclaExterna: 'coincide', comparacion: 'coincide', referencia: 'valida' } }), 0), { forzar: true });
    assert.deepEqual([r.resultado, r.codigoSalida, r.accionAncla, r.discrepancia], ['retroceso', 1, 'discrepancia', 'registrada'], nombre); assert.ok(r.motivos.includes(`ancla_discrepancia:${motivo}`), nombre); assert.equal(leerAncla(l, 'gestor').ancla.seq, 20, `${nombre}: el ancla no se mueve`);
  }
});

/* ───────── 3E.8.9 · cada guarda de integridad del ledger, aislada y con su propio motivo (sin guardas redundantes sin verificar) ───────── */
test('LEDGER · cada causa tiene su motivo propio: `ledger_no_disponible` (estado() falla), `ledger_no_integro` (cadena rota), `ledger_cola_incompleta` y `ledger_lectura_fallida` (leer() falla con estado sano); y anclar se niega en todas', () => {
  const dir = tmp(); const l = crearLedger(dir); anclar(l, { idAlmacen: 'g', cabeza: cabeza(5), motivo: 'primera_ancla' }); const texto = fs.readFileSync(l.archivo, 'utf8');
  const motivo = (x) => leerAncla(x, 'g').motivo; assert.equal(leerAncla(l, 'g').estado, 'vigente');
  const sinEstado = crearLedger(dir); sinEstado.estado = () => { throw new Error('x'); }; assert.equal(motivo(sinEstado), 'ledger_no_disponible'); assert.throws(() => anclar(sinEstado, { idAlmacen: 'g', cabeza: cabeza(9), motivo: 'avance' }));
  const sinLeer = crearLedger(dir); sinLeer.leer = () => { throw new ErrorLedger('ledger_corrupto', 'x'); }; assert.equal(motivo(sinLeer), 'ledger_lectura_fallida'); assert.throws(() => anclar(sinLeer, { idAlmacen: 'g', cabeza: cabeza(9), motivo: 'avance' }), (e) => e.codigo === 'ledger_no_integro');
  fs.writeFileSync(l.archivo, texto.replace('"seq":5', '"seq":6')); const roto = crearLedger(dir); assert.equal(motivo(roto), 'ledger_no_integro'); assert.throws(() => anclar(roto, { idAlmacen: 'g', cabeza: cabeza(9), motivo: 'avance' }), (e) => e.codigo === 'ledger_no_integro');
  fs.writeFileSync(l.archivo, texto + '{"incompleto'); const cola = crearLedger(dir); assert.equal(motivo(cola), 'ledger_cola_incompleta'); assert.throws(() => anclar(cola, { idAlmacen: 'g', cabeza: cabeza(9), motivo: 'avance' }), (e) => e.codigo === 'ledger_no_integro');
  fs.writeFileSync(l.archivo, texto); assert.equal(estadoIntegridad({ ledger: crearLedger(dir), idAlmacen: 'g', ahora: T0 }).ancla.estado, 'vigente');
});
