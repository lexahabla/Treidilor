// Agente 00 · 3E.8.9 · Copia externa FIRMADA del ancla (protección contra la restauración conjunta), guarda de escritura en curso y estado para las interfaces.
// Todo con claves, destinos, almacenes y ledgers SINTÉTICOS en carpetas temporales. Las pruebas de integración usan el comando del prototipo (se omiten si no está).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LedgerLocal } from '../ledger.mjs';
import { CONFIG_INTEGRIDAD } from '../integridad/config.mjs';
import { anclar, leerAncla } from '../integridad/ancla.mjs';
import { estadoIntegridad, lineasEstadoIntegridad } from '../integridad/estado.mjs';
import { almacenOcupado, ejecutarIntegridadSupervisada } from '../integridad/ejecucion.mjs';
import { comunicado, contrastarAncla, evaluarFrescura, exportarAncla, firmarDocumento, generarParClaves, huellaDocumento, leerCopias, proponerReanclaje, verificarDocumento } from '../integridad/copia-ancla.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PROTO = path.resolve(process.env.TAI_PROTOTIPO_INCIDENCIAS || path.join(AQUI, '..', '..', '..', '..', 'treidilor-ai', 'prototipo-incidencias-director'));
const CLI = path.join(PROTO, 'src', 'integridad-cli.mjs'); const hay = fs.existsSync(CLI);
const itest = (n, f) => test(n, { skip: !hay && 'prototipo no disponible' }, f);
const dirs = []; const limpiar = () => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); }; after(limpiar);
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-int89-')); dirs.push(d); return d; };
const H = 3600000; const T0 = Date.parse('2027-03-31T10:00:00.000Z'); let ahoraL = T0;
const crearLedger = (dir = tmp()) => new LedgerLocal({ dir, particion: 'integridad', reloj: () => new Date(ahoraL), raiz: '/__sin_raiz__' });
const cab = (seq, c = 'c') => ({ seq, huella: `sha256:${String(seq).padStart(2, '0')}${c.repeat(62)}` });
const claves = generarParClaves(); const otras = generarParClaves();
const COPIA = (extra = {}) => ({ destino: tmp(), publica: claves.publica, privada: claves.privada, exigirOtraUnidad: false, ...extra });
const exportar = (l, c, extra = {}) => exportarAncla({ ledger: l, idAlmacen: 'g', destino: c.destino, privada: c.privada, publica: c.publica, reloj: () => ahoraL, exigirOtraUnidad: false, ...extra });
const nombresCopias = (d) => fs.readdirSync(d).filter((n) => /^ancla-g-\d{8}\.json$/.test(n)).sort();

/* ───────── FIRMA ───────── */
test('FIRMA · Ed25519: un documento válido verifica; alterar cualquier campo, firmar con otra clave o un formato incorrecto se rechaza', () => {
  const doc = firmarDocumento({ esquema: 'ancla-externa/1', idAlmacen: 'g', contador: 1, seq: 7, huella: cab(7).huella, emitidoEn: '2027-03-31T10:00:00.000Z', ledgerSecuencia: 3, previa: null }, claves.privada);
  assert.deepEqual(verificarDocumento(doc, claves.publica), { ok: true });
  for (const [campo, valor] of [['seq', 8], ['huella', cab(9).huella], ['contador', 2], ['idAlmacen', 'h'], ['emitidoEn', '2027-04-01T00:00:00.000Z'], ['previa', { contador: 1, huellaDoc: 'x' }], ['ledgerSecuencia', 4]]) assert.equal(verificarDocumento({ ...doc, [campo]: valor }, claves.publica).ok, false, campo);
  assert.deepEqual(verificarDocumento(doc, otras.publica), { ok: false, motivo: 'firma_no_valida' }); assert.equal(verificarDocumento({ ...doc, firma: 'AAAA' }, claves.publica).ok, false);
  for (const mal of [null, {}, { ...doc, esquema: 'otro/9' }, { ...doc, contador: 0 }, { ...doc, seq: -1 }, { ...doc, huella: 'x' }, { ...doc, firma: undefined }]) assert.equal(verificarDocumento(mal, claves.publica).motivo === 'formato_no_valido', true, JSON.stringify(mal)?.slice(0, 40));
  assert.equal(verificarDocumento(doc, 'no es una clave').ok, false);
});

/* ───────── EXPORTAR ───────── */
test('EXPORTAR · sin ancla no hay nada que copiar; con ancla se emite #1 firmada; repetir es idempotente (sin archivo nuevo); un avance emite #2 encadenada a #1; un retroceso del ledger se rechaza', () => {
  const l = crearLedger(); const c = COPIA(); assert.deepEqual(exportar(l, c), { estado: 'sin_ancla', motivo: 'ausente' });
  anclar(l, { idAlmacen: 'g', cabeza: cab(10), motivo: 'primera_ancla' }); const e1 = exportar(l, c); assert.deepEqual([e1.estado, e1.contador], ['exportada', 1]); assert.deepEqual(nombresCopias(c.destino), ['ancla-g-00000001.json']);
  const antes = fs.readFileSync(path.join(c.destino, 'ancla-g-00000001.json')); const e1b = exportar(l, c); assert.deepEqual([e1b.estado, e1b.contador], ['sin_cambio', 1]); assert.deepEqual(nombresCopias(c.destino), ['ancla-g-00000001.json']); assert.deepEqual(fs.readFileSync(path.join(c.destino, 'ancla-g-00000001.json')), antes);
  anclar(l, { idAlmacen: 'g', cabeza: cab(20), motivo: 'avance' }); const e2 = exportar(l, c); assert.deepEqual([e2.estado, e2.contador], ['exportada', 2]); const lec = leerCopias({ destino: c.destino, publica: claves.publica, idAlmacen: 'g' });
  assert.deepEqual([lec.validas.length, lec.cadenaOk, lec.huecos.length, lec.invalidas.length, lec.mejor.seq], [2, true, 0, 0, 20]); assert.equal(lec.mejor.previa.huellaDoc, huellaDocumento(lec.validas[0]));
  // un ledger que retrocede (restaurado a una versión anterior) no puede emitir una copia más antigua
  const viejo = crearLedger(); anclar(viejo, { idAlmacen: 'g', cabeza: cab(12), motivo: 'primera_ancla' }); assert.deepEqual(exportar(viejo, c), { estado: 'rechazada', motivo: 'retroceso_respecto_a_la_ultima_copia' });
  const bifurcado = crearLedger(); anclar(bifurcado, { idAlmacen: 'g', cabeza: cab(20, 'd'), motivo: 'primera_ancla' }); assert.deepEqual(exportar(bifurcado, c), { estado: 'rechazada', motivo: 'misma_seq_distinta_huella' }); assert.deepEqual(nombresCopias(c.destino).length, 2);
});

test('EXPORTAR · el destino debe ser INDEPENDIENTE (no dentro ni alrededor del ledger o del almacén, y otra unidad por defecto); un archivo con el nombre ocupado e inválido se aparta, no se pisa ni se borra; los documentos no contienen secretos', () => {
  const l = crearLedger(); anclar(l, { idAlmacen: 'g', cabeza: cab(5), motivo: 'primera_ancla' }); const c = COPIA();
  assert.equal(exportar(l, { ...c, destino: path.join(l.dir, 'copias') }).motivo, 'destino_no_independiente'); assert.equal(exportar(l, { ...c, destino: path.dirname(l.dir) }).motivo, 'destino_no_independiente');
  const alm = tmp(); assert.equal(exportar(l, { ...c, destino: path.join(alm, 'c') }, { almacenDir: alm }).motivo, 'destino_no_independiente');
  assert.equal(exportar(l, c, { exigirOtraUnidad: true }).motivo, 'misma_unidad_que_el_ledger', 'en estas pruebas todo está en la misma unidad: con la exigencia por defecto se rechaza'); assert.equal(exportar(l, { ...c, destino: 'relativa' }).motivo, 'parametros_no_validos'); assert.equal(exportar(l, { ...c, privada: null }).motivo, 'parametros_no_validos');
  fs.writeFileSync(path.join(c.destino, 'ancla-g-00000001.json'), 'a medias'); const e = exportar(l, c); assert.deepEqual([e.estado, e.contador], ['exportada', 1]); assert.ok(fs.readdirSync(c.destino).some((n) => n.includes('.invalida-')), 'el archivo inválido se conserva apartado');
  const texto = fs.readFileSync(path.join(c.destino, 'ancla-g-00000001.json'), 'utf8'); assert.ok(!/PRIVATE KEY|BEGIN|privada/i.test(texto)); assert.equal(e.independenciaFisica, 'misma_unidad');
  const cm = comunicado(e.copia); assert.ok(!/[A-Za-z]:\\|\/Users|PRIVATE|sha256:[0-9a-f]{64}/.test(cm)); assert.match(cm, /#1/);
});

/* ───────── LEER, CADENA Y FRESCURA ───────── */
const tresCopias = (x = 'c') => { const l = crearLedger(); const c = COPIA(); anclar(l, { idAlmacen: 'g', cabeza: cab(10, x), motivo: 'primera_ancla' }); exportar(l, c); anclar(l, { idAlmacen: 'g', cabeza: cab(20, x), motivo: 'avance' }); exportar(l, c); anclar(l, { idAlmacen: 'g', cabeza: cab(30, x), motivo: 'avance' }); exportar(l, c); return { l, c }; };
const leer = (c) => leerCopias({ destino: c.destino, publica: claves.publica, idAlmacen: 'g' });
test('LEER COPIAS · cada anomalía con su evidencia: alterada, truncada, nombre que no coincide con el contenido, hueco de contador, cadena rota por sustitución y destino inexistente', () => {
  const { c } = tresCopias(); const f = (n) => path.join(c.destino, `ancla-g-0000000${n}.json`); const o = [1, 2, 3].map((n) => fs.readFileSync(f(n), 'utf8')); const restaurar = () => [1, 2, 3].forEach((n) => fs.writeFileSync(f(n), o[n - 1]));
  assert.deepEqual([leer(c).validas.length, leer(c).cadenaOk, leer(c).invalidas.length], [3, true, 0]);
  fs.writeFileSync(f(3), o[2].replace('"seq":30', '"seq":31')); let r = leer(c); assert.deepEqual([r.validas.length, r.invalidas[0].motivo, r.mejor.contador], [2, 'firma_no_valida', 2]); restaurar();
  fs.writeFileSync(f(3), o[2].slice(0, 40)); r = leer(c); assert.deepEqual([r.validas.length, r.invalidas[0].motivo], [2, 'ilegible']); restaurar();
  fs.writeFileSync(path.join(c.destino, 'ancla-g-00000009.json'), o[2]); r = leer(c); assert.equal(r.invalidas[0].motivo, 'nombre_distinto_del_contenido'); fs.rmSync(path.join(c.destino, 'ancla-g-00000009.json'));
  fs.rmSync(f(2)); r = leer(c); assert.deepEqual([r.huecos, r.cadenaOk], [[2], false]); restaurar();
  const otro = tresCopias('z'); fs.writeFileSync(f(2), fs.readFileSync(path.join(otro.c.destino, 'ancla-g-00000002.json'), 'utf8')); r = leer(c); assert.equal(r.cadenaOk, false, 'una copia #2 válida pero de OTRA historia rompe la cadena (huellaDoc previa distinta)'); restaurar();
  assert.deepEqual([leerCopias({ destino: path.join(c.destino, 'no-existe'), publica: claves.publica, idAlmacen: 'g' }).ok, leerCopias({ destino: path.join(c.destino, 'no-existe'), publica: claves.publica, idAlmacen: 'g' }).motivo], [false, 'destino_inexistente']);
  assert.equal(leerCopias({ destino: c.destino, publica: otras.publica, idAlmacen: 'g' }).validas.length, 0, 'con otra clave pública ninguna copia es válida');
});

test('FRESCURA · una copia ANTIGUA también VÁLIDA no se distingue de la última sin referencia independiente; con la referencia del propietario sí', () => {
  const { c } = tresCopias(); fs.rmSync(path.join(c.destino, 'ancla-g-00000003.json')); fs.rmSync(path.join(c.destino, 'ancla-g-00000002.json')); // el atacante deja solo la #1, perfectamente firmada y encadenada
  const r = leer(c); assert.deepEqual([r.validas.length, r.cadenaOk, r.huecos.length, r.invalidas.length, r.mejor.contador], [1, true, 0, 0, 1], 'todo parece íntegro y auténtico');
  assert.equal(evaluarFrescura({ mejor: r.mejor, referencia: null }).estado, 'sin_referencia_de_frescura'); assert.equal(evaluarFrescura({ mejor: r.mejor, referencia: { contadorMinimo: 3 } }).estado, 'obsoleta'); assert.equal(evaluarFrescura({ mejor: r.mejor, referencia: { contadorMinimo: 1 } }).estado, 'vigente');
  assert.equal(evaluarFrescura({ mejor: null, referencia: { contadorMinimo: 1 } }).estado, 'sin_copias'); assert.equal(evaluarFrescura({ mejor: r.mejor, referencia: { contadorMinimo: 'x' } }).estado, 'sin_referencia_de_frescura');
  assert.match(evaluarFrescura({ mejor: r.mejor, referencia: null }).mensaje, /ANTIGUA/);
});

test('CONTRASTE y RECUPERACIÓN (puras): coinciden · ledger_atrasado · copia_atrasada · distintas · sin_ledger · sin_copia; la propuesta de reanclaje exige copia fresca, no escribe nada y deja la autorización en manos del propietario', () => {
  const L = cab(20); const C = (seq, c = 'c') => ({ ...cab(seq, c), contador: 4 });
  assert.equal(contrastarAncla({ ledgerAncla: L, copia: C(20) }).estado, 'coinciden'); assert.deepEqual(contrastarAncla({ ledgerAncla: L, copia: C(25) }), { estado: 'ledger_atrasado', efectiva: { seq: 25, huella: cab(25).huella } });
  assert.equal(contrastarAncla({ ledgerAncla: L, copia: C(15) }).estado, 'copia_atrasada'); assert.deepEqual(contrastarAncla({ ledgerAncla: L, copia: C(20, 'd') }), { estado: 'distintas', efectiva: null });
  assert.equal(contrastarAncla({ ledgerAncla: null, copia: C(7) }).estado, 'sin_ledger'); assert.equal(contrastarAncla({ ledgerAncla: L, copia: null }).estado, 'sin_copia');
  assert.deepEqual(proponerReanclaje({ copia: null, frescura: { estado: 'sin_copias' } }), { puede: false, motivo: 'sin_copia_valida' }); assert.equal(proponerReanclaje({ copia: C(9), frescura: { estado: 'obsoleta' } }).motivo, 'copia_obsoleta');
  const p = proponerReanclaje({ copia: C(9), frescura: { estado: 'sin_referencia_de_frescura' }, contraste: { estado: 'sin_ledger' } }); assert.equal(p.puede, true); assert.ok(p.avisos.length === 1 && p.pasos.length === 3); assert.equal(p.reanclar.autorizadoPor, 'propietario'); assert.ok(p.reanclar.motivo.length >= 10);
});

/* ───────── GUARDA DE ESCRITURA EN CURSO y ERROR ≠ ALTERACIÓN ───────── */
const falso = (cuerpo) => { const f = path.join(tmp(), 'cli-falso.mjs'); fs.writeFileSync(f, cuerpo); return f; };
const salidaOk = (extra = {}) => ({ formato: 'integridad-ejecucion/1', resultado: 'ok', nivel: 'ok', codigoSalida: 0, omitida: false, tentativa: { completa: true, cabeza: cab(9), segmentos: 1, eventosTotales: 9, comparacion: 'primera', referencia: 'ausente', anclaExterna: 'sin_ancla', reintento: false, motivos: [] }, registroEscrito: true, recursos: { cpuMs: 1, maxRssMiB: 40 }, ...extra });
const cliQue = (obj, codigo) => falso(`console.log(JSON.stringify(${JSON.stringify(obj)})); process.exitCode = ${codigo};`);
const sup = (l, cli, almacenDir, extra = {}) => ejecutarIntegridadSupervisada({ ledger: l, idAlmacen: 'g', almacenDir, cli, reloj: () => ahoraL, config: { ...CONFIG_INTEGRIDAD, timeoutMs: 8000 }, ...extra });

test('ESCRITURA EN CURSO · un cerrojo reciente del almacén (`bloqueo.json`) aplaza la pasada sin lanzar nada; uno antiguo o la ausencia no; `forzar` lo ignora; la guarda es solo de lectura', async () => {
  const alm = path.join(tmp(), 'almacen'); fs.mkdirSync(alm); const l = crearLedger(); const cli = cliQue(salidaOk(), 0); ahoraL = T0;
  assert.equal(almacenOcupado(alm, 120000), false); fs.writeFileSync(path.join(alm, 'bloqueo.json'), '{}'); assert.equal(almacenOcupado(alm, 120000), true);
  const r = await sup(l, cli, alm); assert.deepEqual([r.estado, r.ejecutado, r.motivos], ['aplazada_escritura_en_curso', false, ['almacen_escribiendose']]); assert.equal(l.estado().ultimaSecuencia, 0);
  assert.deepEqual(fs.readFileSync(path.join(alm, 'bloqueo.json'), 'utf8'), '{}', 'no se toca el cerrojo del almacén'); assert.equal((await sup(l, cli, alm, { forzar: true })).estado, 'ejecutada');
  const viejo = new Date(Date.now() - 3600000); fs.utimesSync(path.join(alm, 'bloqueo.json'), viejo, viejo); assert.equal(almacenOcupado(alm, 120000), false); ahoraL = T0 + 7 * H; assert.equal((await sup(l, cli, alm)).estado, 'ejecutada');
});

test('ERROR OPERATIVO ≠ ALTERACIÓN · «almacén inestable» es un error 3 (aviso): no marca alteración confirmada, no abre discrepancia ni toca el ancla; una alteración real sí', async () => {
  const alm = path.join(tmp(), 'almacen'); fs.mkdirSync(alm); const l = crearLedger(); ahoraL = T0; anclar(l, { idAlmacen: 'g', cabeza: cab(5), motivo: 'primera_ancla' });
  const inestable = cliQue(salidaOk({ resultado: 'error', nivel: 'aviso', codigoSalida: 3, tentativa: { ...salidaOk().tentativa, completa: false, motivos: ['almacen_inestable_durante_la_verificacion'] } }), 3);
  const r = await sup(l, inestable, alm, { forzar: true }); assert.deepEqual([r.resultado, r.codigoSalida, r.significado, r.nivel], ['error', 3, 'error_operativo', 'aviso']); assert.ok(r.motivos.includes('almacen_inestable_durante_la_verificacion'));
  const st = estadoIntegridad({ ledger: l, idAlmacen: 'g', ahora: ahoraL }); assert.deepEqual([st.alteracionConfirmada, st.errorOperativo, st.nivel], [false, true, 'aviso']); assert.ok(!st.motivos.includes('integridad_alteracion_confirmada'));
  assert.equal(l.leer((x) => x.tipo === 'integridad_discrepancia').length, 0); assert.equal(leerAncla(l, 'g').ancla.seq, 5);
  const real = cliQue(salidaOk({ resultado: 'alterada', nivel: 'fallo', codigoSalida: 1, tentativa: { ...salidaOk().tentativa, completa: false, comparacion: 'primera', motivos: ['segmento_alterado:00000001'] } }), 1); ahoraL = T0 + H;
  const a = await sup(l, real, alm, { forzar: true }); assert.deepEqual([a.resultado, a.codigoSalida, a.significado], ['alterada', 1, 'alteracion_confirmada']); const st2 = estadoIntegridad({ ledger: l, idAlmacen: 'g', ahora: ahoraL }); assert.deepEqual([st2.alteracionConfirmada, st2.nivel], [true, 'fallo']);
});

test('INTERFAZ · `lineasEstadoIntegridad` ofrece el estado a las interfaces existentes sin rutas, sin huellas completas y sin secretos; no envía nada', async () => {
  const alm = path.join(tmp(), 'almacen'); fs.mkdirSync(alm); const l = crearLedger(); ahoraL = T0; await sup(l, cliQue(salidaOk(), 0), alm, { forzar: true }); await sup(l, cliQue(salidaOk({ resultado: 'alterada', nivel: 'fallo', codigoSalida: 1 }), 1), alm, { forzar: true });
  const lineas = lineasEstadoIntegridad(estadoIntegridad({ ledger: l, idAlmacen: 'g', ahora: ahoraL })); const t = lineas.join('\n');
  assert.ok(lineas.length >= 4 && /FALLO/.test(t) && /Siguiente comprobación prevista/.test(t) && /Última verificación satisfactoria/.test(t)); assert.ok(!/[A-Za-z]:\\|\/Users|\.json|PRIVATE|sha256:[0-9a-f]{64}|token|Bearer/i.test(t), t);
});

/* ───────── INTEGRACIÓN con el comando del prototipo: restauración CONJUNTA, ledger perdido o atrasado ───────── */
let M = null; let U = null;
const cargar = async () => { if (M) return; const u = (p) => import(pathToFileURL(path.join(PROTO, p)).href); const [a, p, s, ad, ut] = await Promise.all([u('src/almacen/almacen.mjs'), u('src/almacen/politicaRutas.mjs'), u('src/simulacion/datos.mjs'), u('src/adaptador/instantanea.mjs'), u('test/util-integracion.mjs')]); M = { ...a, ...p, ...s, ...ad }; U = ut; };
const dia = (n) => Date.parse('2027-03-01T00:00:00.000Z') + n * 86400000; let cont = 0; const nuevas = (n) => Array.from({ length: n }, () => { cont += 1; return { clave: `ficha:sin_imagen:y${String(cont).padStart(6, '0')}`, gravedad: 'media' }; });
async function almacen() { await cargar(); const raiz = tmp(); const g = path.join(raiz, 'g'); fs.mkdirSync(g); return { raiz, dir: path.join(g, 'almacen'), aut: M.autorizarRaiz(g) }; }
const abrirA = (e, d) => M.abrirAlmacen({ dir: e.dir, autorizacion: e.aut, reloj: () => dia(d) + 12 * H, limites: { observacionMs: 20, esperaMs: 0, maxCopias: 4 } });
function obs(d, anadir = []) { const gen = new Date(dia(d) + 7 * H).toISOString(); const f = M.filaDeInstantanea(M.construirInstantanea(U.BASE, { generadoEn: gen, anadir }), { idEjecucion: `x${d}`, id: d + 1 }); const r = M.respuestaLector([f], { limite: 5, idSolicitud: 'lreq0000abcd', exportadoEn: gen }); return M.observacionDeRespuesta(r, { ahoraIso: new Date(dia(d) + 12 * H).toISOString(), esperada: { entorno: 'produccion' } }).datos; }
const dias = (e, a, b) => { for (let d = a; d <= b; d += 1) assert.ok(abrirA(e, d).procesarObservacion(obs(d, d === 0 ? [] : nuevas(4))).ok); };
const correr = (e, l, extra = {}) => ejecutarIntegridadSupervisada({ ledger: l, idAlmacen: 'g', almacenDir: e.dir, cli: CLI, reloj: () => ahoraL, config: CONFIG_INTEGRIDAD, forzar: true, ...extra });
const poner = (destino, origen) => { for (const n of fs.readdirSync(destino)) fs.rmSync(path.join(destino, n), { recursive: true, force: true }); for (const n of fs.readdirSync(origen)) fs.cpSync(path.join(origen, n), path.join(destino, n), { recursive: true }); };

itest('RESTAURACION CONJUNTA de almacén y ledger a una versión antigua: SIN copia externa NO se detecta (control); CON copia externa firmada y más nueva → retroceso (1), evidencia y ancla intacta', async () => {
  for (const conCopia of [false, true]) {
    const e = await almacen(); dias(e, 0, 5); const dirL = tmp(); const l = crearLedger(dirL); const c = COPIA(); const opc = conCopia ? { copiaExterna: c } : {}; ahoraL = T0; assert.equal((await correr(e, l, opc)).resultado, 'ok');
    const snapA = tmp(); fs.cpSync(e.dir, path.join(snapA, 'a'), { recursive: true }); fs.cpSync(dirL, path.join(snapA, 'l'), { recursive: true }); // estado «antiguo» de ambos
    dias(e, 6, 11); ahoraL = T0 + 6 * H; const r2 = await correr(e, l, opc); assert.equal(r2.accionAncla, 'anclado'); const seqNueva = leerAncla(l, 'g').ancla.seq; if (conCopia) assert.equal(nombresCopias(c.destino).length, 2);
    // el atacante restaura AMBOS a la versión antigua; la copia externa (en otro sitio) no la toca
    poner(e.dir, path.join(snapA, 'a')); poner(dirL, path.join(snapA, 'l')); const l2 = crearLedger(dirL); ahoraL = T0 + 12 * H; const r = await correr(e, l2, opc);
    if (!conCopia) { assert.deepEqual([r.resultado, r.codigoSalida], ['ok', 0], 'control: sin copia externa la restauración conjunta pasa inadvertida'); assert.ok(leerAncla(l2, 'g').ancla.seq < seqNueva); }
    else { assert.deepEqual([r.resultado, r.codigoSalida, r.accionAncla], ['retroceso', 1, 'no_anclar']); assert.ok(r.motivos.some((m) => m.startsWith('ancla_externa_posterior')), r.motivos.join()); assert.ok(leerAncla(l2, 'g').ancla.seq < seqNueva, 'el ledger restaurado NO se corrige solo'); assert.equal(l2.leer((x) => x.tipo === 'integridad_discrepancia').length, 1); assert.equal(nombresCopias(c.destino).length, 2, 'la copia externa no se toca'); }
  }
});

itest('COPIA ANTIGUA SUSTITUIDA: sin referencia de frescura la restauración conjunta con la copia #1 vuelve a pasar inadvertida (aviso de «sin referencia»); con la referencia del propietario el sistema marca FALLO `copia_externa_obsoleta`', async () => {
  const e = await almacen(); dias(e, 0, 5); const dirL = tmp(); const l = crearLedger(dirL); const c = COPIA(); ahoraL = T0; await correr(e, l, { copiaExterna: c });
  const snap = tmp(); fs.cpSync(e.dir, path.join(snap, 'a'), { recursive: true }); fs.cpSync(dirL, path.join(snap, 'l'), { recursive: true }); fs.cpSync(c.destino, path.join(snap, 'c'), { recursive: true });
  dias(e, 6, 11); ahoraL = T0 + 6 * H; await correr(e, l, { copiaExterna: c }); assert.equal(nombresCopias(c.destino).length, 2);
  poner(e.dir, path.join(snap, 'a')); poner(dirL, path.join(snap, 'l')); poner(c.destino, path.join(snap, 'c')); // restauración conjunta de TODO, también de la carpeta de copias (que estaba en un sitio accesible)
  const l2 = crearLedger(dirL); ahoraL = T0 + 12 * H; const sinRef = await correr(e, l2, { copiaExterna: c }); assert.equal(sinRef.resultado, 'ok', 'con una copia antigua válida y sin referencia no hay forma de saberlo');
  assert.equal(estadoIntegridad({ ledger: l2, idAlmacen: 'g', ahora: ahoraL }).motivos.includes('copia_externa_sin_referencia'), true);
  ahoraL = T0 + 13 * H; const conRef = await correr(e, l2, { copiaExterna: { ...c, referencia: { contadorMinimo: 2 } } }); const st = estadoIntegridad({ ledger: l2, idAlmacen: 'g', ahora: ahoraL });
  assert.ok(st.motivos.includes('copia_externa_obsoleta')); assert.equal(st.nivel, 'fallo'); assert.equal(conRef.copiaExterna.estado, 'obsoleta' ?? 'obsoleta'); assert.ok(st.alertas.some((a) => a.codigo === 'copia_externa_obsoleta' && a.nivel === 'fallo'));
});

itest('LEDGER PERDIDO con copia externa válida: el contraste se hace con la copia (un almacén retrocedido se detecta), pero NO se reancla solo: queda `sin_ancla` (aviso 2) hasta el reanclaje explícito del propietario', async () => {
  const e = await almacen(); dias(e, 0, 5); const snap = tmp(); const l = crearLedger(); const c = COPIA(); ahoraL = T0; await correr(e, l, { copiaExterna: c }); fs.cpSync(e.dir, path.join(snap, 'a'), { recursive: true }); dias(e, 6, 10); ahoraL = T0 + 6 * H; await correr(e, l, { copiaExterna: c });
  const sinLedger = crearLedger(tmp()); ahoraL = T0 + 12 * H; const r = await correr(e, sinLedger, { copiaExterna: c }); assert.deepEqual([r.resultado, r.codigoSalida, r.accionAncla, r.motivoAncla], ['sin_ancla', 2, 'no_anclar', 'ancla_no_comprobada'], 'con la copia como contraste y sin ancla en el ledger: no se reancla'); assert.equal(sinLedger.leer((x) => x.tipo === 'ancla_integridad').length, 0, 'ni un ancla escrita sola');
  poner(e.dir, path.join(snap, 'a')); const sinLedger2 = crearLedger(tmp()); ahoraL = T0 + 13 * H; const r2 = await correr(e, sinLedger2, { copiaExterna: c }); assert.deepEqual([r2.resultado, r2.codigoSalida], ['retroceso', 1], 'almacén retrocedido + ledger perdido: la copia lo delata');
  const p = proponerReanclaje({ copia: leerCopias({ destino: c.destino, publica: claves.publica, idAlmacen: 'g' }).mejor, frescura: { estado: 'vigente' } }); assert.equal(p.puede, true);
  poner(e.dir, path.join(snap, 'a')); dias(e, 6, 10); ahoraL = T0 + 14 * H; const ok = await correr(e, crearLedger(tmp()), { copiaExterna: undefined, reanclar: { ...p.reanclar } }); assert.deepEqual([ok.resultado, ok.accionAncla, ok.motivoAncla], ['ok', 'anclado', 'reanclaje_explicito']);
});

itest('LEDGER ATRASADO (restaurado a una versión anterior) con el almacén al día y una copia posterior: el ancla del ledger se pone al día porque el almacén CONTIENE la cabeza atestiguada por la copia (no es un reanclaje a ciegas)', async () => {
  const e = await almacen(); dias(e, 0, 5); const dirL = tmp(); const l = crearLedger(dirL); const c = COPIA(); ahoraL = T0; await correr(e, l, { copiaExterna: c }); const snapL = tmp(); fs.cpSync(dirL, path.join(snapL, 'l'), { recursive: true });
  dias(e, 6, 10); ahoraL = T0 + 6 * H; await correr(e, l, { copiaExterna: c }); const seqCopia = leerCopias({ destino: c.destino, publica: claves.publica, idAlmacen: 'g' }).mejor.seq; poner(dirL, path.join(snapL, 'l')); const l2 = crearLedger(dirL); assert.ok(leerAncla(l2, 'g').ancla.seq < seqCopia);
  ahoraL = T0 + 12 * H; const r = await correr(e, l2, { copiaExterna: c }); assert.deepEqual([r.resultado, r.accionAncla, r.motivoAncla, r.copiaExterna.contraste], ['ok', 'anclado', 'avance', 'ledger_atrasado']); assert.ok(leerAncla(l2, 'g').ancla.seq >= seqCopia);
});

test('COPIA DISCREPANTE y COPIA NO ESCRITA: misma secuencia con otra huella → discrepancia SIN lanzar nada; si la copia externa no se puede escribir, la ejecución sigue siendo satisfactoria (el ancla está en el ledger) y se avisa', async () => {
  const alm = path.join(tmp(), 'almacen'); fs.mkdirSync(alm); const l = crearLedger(); const c = COPIA(); ahoraL = T0; anclar(l, { idAlmacen: 'g', cabeza: cab(9), motivo: 'primera_ancla' });
  fs.writeFileSync(path.join(c.destino, 'ancla-g-00000001.json'), `${JSON.stringify(firmarDocumento({ esquema: 'ancla-externa/1', idAlmacen: 'g', contador: 1, seq: 9, huella: cab(9, 'e').huella, emitidoEn: new Date(T0).toISOString(), ledgerSecuencia: 1, previa: null }, claves.privada))}\n`);
  const cli = cliQue(salidaOk({ tentativa: { ...salidaOk().tentativa, anclaExterna: 'coincide', comparacion: 'coincide', referencia: 'valida' } }), 0); const d = await sup(l, cli, alm, { forzar: true, copiaExterna: c }); assert.deepEqual([d.estado, d.ejecutado], ['discrepancia_ancla_externa', false]); const cli2 = cliQue(salidaOk(), 0);
  const l2 = crearLedger(); const c2 = COPIA({ destino: path.join(tmp(), 'archivo-no-carpeta') }); fs.writeFileSync(c2.destino, 'soy un archivo'); ahoraL = T0; const r = await sup(l2, cli2, alm, { forzar: true, copiaExterna: c2 });
  assert.deepEqual([r.resultado, r.codigoSalida, r.accionAncla], ['ok', 0, 'anclado']); const st = estadoIntegridad({ ledger: l2, idAlmacen: 'g', ahora: ahoraL }); assert.ok(st.motivos.includes('copia_externa_no_escrita')); assert.equal(st.nivel, 'aviso');
});

itest('GUARDA DE ESCRITURA REAL: mientras el almacén del prototipo está escribiendo (en mitad de una transacción) existe su cerrojo `bloqueo.json` y la guarda lo ve; al terminar desaparece', async () => {
  const e = await almacen(); dias(e, 0, 2); let vistoDentro = null; let existe = null;
  const al = M.abrirAlmacen({ dir: e.dir, autorizacion: e.aut, reloj: () => dia(5) + 12 * H, limites: { observacionMs: 20, esperaMs: 0, maxCopias: 4 }, hooks: { punto: (p) => { if (p === 'pendiente_tmp' && vistoDentro === null) { vistoDentro = almacenOcupado(e.dir, 120000); existe = fs.existsSync(path.join(e.dir, 'bloqueo.json')); } } } });
  assert.ok(al.procesarObservacion(obs(5, nuevas(2))).ok); assert.deepEqual([vistoDentro, existe], [true, true], 'en mitad de la transacción el almacén está marcado como ocupado'); assert.equal(fs.existsSync(path.join(e.dir, 'bloqueo.json')), false); assert.equal(almacenOcupado(e.dir, 120000), false);
});

/* ───────── 3E.8.9 · supervivientes de la ronda de mutaciones: una prueba aislada por causa ───────── */
const docFirmado = (contador, seq, previa, x = 'c') => firmarDocumento({ esquema: 'ancla-externa/1', idAlmacen: 'g', contador, seq, huella: cab(seq, x).huella, emitidoEn: new Date(T0).toISOString(), ledgerSecuencia: 1, previa }, claves.privada);
const escribirDoc = (c, d) => fs.writeFileSync(path.join(c.destino, `ancla-g-${String(d.contador).padStart(8, '0')}.json`), `${JSON.stringify(d)}\n`);

test('CADENA · una copia con SEQ MENOR que la anterior rompe la cadena aunque esté bien firmada y encadenada por huella (un ancla nunca retrocede)', () => {
  const c = COPIA(); const d1 = docFirmado(1, 20, null); const d2 = docFirmado(2, 10, { contador: 1, huellaDoc: huellaDocumento(d1) }); escribirDoc(c, d1); escribirDoc(c, d2);
  const r = leer(c); assert.deepEqual([r.validas.length, r.invalidas.length, r.huecos.length, r.cadenaOk], [2, 0, 0, false], 'solo la regla de seq creciente la delata');
  const d3 = docFirmado(2, 30, { contador: 1, huellaDoc: huellaDocumento(d1) }); fs.rmSync(path.join(c.destino, 'ancla-g-00000002.json')); escribirDoc(c, d3); assert.equal(leer(c).cadenaOk, true, 'control: con seq creciente la misma cadena es válida');
});

test('ESCRITURA EXCLUSIVA · aunque la comprobación previa de existencia falle (carrera), la copia NUNCA pisa un archivo que ya existe con su nombre (`wx`)', () => {
  const l = crearLedger(); const c = COPIA(); anclar(l, { idAlmacen: 'g', cabeza: cab(10), motivo: 'primera_ancla' }); assert.equal(exportar(l, c).estado, 'exportada');
  anclar(l, { idAlmacen: 'g', cabeza: cab(20), motivo: 'avance' }); const objetivo = path.join(c.destino, 'ancla-g-00000002.json'); fs.writeFileSync(objetivo, 'CONTENIDO AJENO');
  const orig = fs.existsSync; fs.existsSync = (p) => (String(p) === objetivo ? false : orig(p)); let r; try { r = exportar(l, c); } finally { fs.existsSync = orig; }
  assert.equal(fs.readFileSync(objetivo, 'utf8'), 'CONTENIDO AJENO', 'no se pisa'); assert.equal(r.estado, 'rechazada'); assert.equal(r.motivo, 'EEXIST');
});

test('CONTRASTE · una copia OBSOLETA (frente a la referencia del propietario) o con la CADENA ROTA se informa pero NO se usa como contraste', async () => {
  const alm = path.join(tmp(), 'almacen'); fs.mkdirSync(alm); const cli = cliQue(salidaOk(), 0);
  // obsoleta: la copia #1 está por delante del ledger pero el propietario sabe que ya van por la #5
  let l = crearLedger(); anclar(l, { idAlmacen: 'g', cabeza: cab(9), motivo: 'primera_ancla' }); let c = COPIA(); escribirDoc(c, docFirmado(1, 20, null)); ahoraL = T0;
  let r = await sup(l, cli, alm, { forzar: true, copiaExterna: { ...c, referencia: { contadorMinimo: 5 } } }); assert.deepEqual([r.copiaExterna.estado, r.copiaExterna.contraste], ['obsoleta', null]);
  // cadena rota: copias #1 y #3 (hueco) con la #3 por delante del ledger
  l = crearLedger(); anclar(l, { idAlmacen: 'g', cabeza: cab(9), motivo: 'primera_ancla' }); c = COPIA(); const d1 = docFirmado(1, 12, null); escribirDoc(c, d1); escribirDoc(c, docFirmado(3, 20, { contador: 2, huellaDoc: 'sha256:x' }));
  r = await sup(l, cli, alm, { forzar: true, copiaExterna: { ...c, referencia: { contadorMinimo: 1 } } }); assert.deepEqual([r.copiaExterna.cadenaOk, r.copiaExterna.huecos, r.copiaExterna.contraste], [false, 1, null]);
});

itest('LEDGER NO ÍNTEGRO con copia externa válida: el contraste con la copia sigue funcionando (un almacén retrocedido se detecta) aunque el ledger no se pueda leer ni escribir', async () => {
  const e = await almacen(); dias(e, 0, 5); const snap = tmp(); const l = crearLedger(); const c = COPIA(); ahoraL = T0; await correr(e, l, { copiaExterna: c }); fs.cpSync(e.dir, path.join(snap, 'a'), { recursive: true });
  dias(e, 6, 10); ahoraL = T0 + 6 * H; await correr(e, l, { copiaExterna: c }); poner(e.dir, path.join(snap, 'a')); fs.appendFileSync(l.archivo, '{"incompleto');
  const l2 = crearLedger(l.dir); assert.equal(leerAncla(l2, 'g').estado, 'ilegible'); const antes = fs.readFileSync(l.archivo);
  ahoraL = T0 + 12 * H; const r = await correr(e, l2, { copiaExterna: c }); assert.deepEqual([r.resultado, r.codigoSalida, r.accionAncla, r.motivoAncla], ['retroceso', 1, 'no_anclar', 'ledger_no_integro']); assert.deepEqual(fs.readFileSync(l.archivo), antes, 'no se escribe en un ledger no íntegro');
});

test('DISCREPANCIA CON LA COPIA · queda REGISTRADA una sola vez por situación y el estado la muestra como FALLO `ancla_copia_discrepante` (antes solo se devolvía al llamador y se perdía)', async () => {
  const alm = path.join(tmp(), 'almacen'); fs.mkdirSync(alm); const l = crearLedger(); const c = COPIA(); ahoraL = T0; anclar(l, { idAlmacen: 'g', cabeza: cab(9), motivo: 'primera_ancla' }); escribirDoc(c, docFirmado(1, 9, null, 'e'));
  const cli = cliQue(salidaOk(), 0); const n0 = l.estado().ultimaSecuencia; const d = await sup(l, cli, alm, { forzar: true, copiaExterna: c });
  assert.deepEqual([d.estado, d.ejecutado, d.discrepancia], ['discrepancia_ancla_externa', false, 'registrada']); const st = estadoIntegridad({ ledger: l, idAlmacen: 'g', ahora: ahoraL });
  assert.ok(st.motivos.includes('ancla_copia_discrepante')); assert.equal(st.nivel, 'fallo'); assert.ok(st.alertas.some((a) => a.codigo === 'ancla_copia_discrepante' && a.nivel === 'fallo'));
  const d2 = await sup(l, cli, alm, { forzar: true, copiaExterna: c }); assert.equal(d2.discrepancia, 'ya_registrada'); assert.equal(l.estado().ultimaSecuencia, n0 + 1, 'una sola anotación por situación');
});
