// Agente 00 · F1.1 · núcleo: protocolo, permisos L0–L4, aprobaciones, frescura y registro. Sin red, sin ledger, sin disco (salvo el registro).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from '../protocolo.mjs';
import * as M from '../permisos.mjs';
import * as F from '../frescura.mjs';
import * as R from '../registro.mjs';
import { validarEsquema } from '../../../scripts/automation/validate-schema.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const J = (r) => JSON.parse(fs.readFileSync(path.resolve(AQUI, '..', '..', '..', r), 'utf8'));
const registro = R.cargarRegistro();
const T0 = Date.parse('2026-11-14T12:00:00.000Z');
const plano = (x) => JSON.parse(JSON.stringify(x));

// ── identificadores ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const regConPlanificado = (reg, id) => { const d = JSON.parse(JSON.stringify(reg.datos)); d.agentes.find((a) => a.id === id).estado = 'planificado'; for (const c of d.capacidades) if (c.agente === id) { c.disponibilidad = 'planificada'; c.motivoNoDisponible = 'planificado'; } return R.crearRegistro(d); };
test('ids: formato, orden monótono en el mismo milisegundo y azar inyectable', () => {
  const g = P.crearGeneradorIds({ reloj: () => T0, aleatorio: () => Buffer.alloc(10, 7) });
  const a = g.nuevo('t');
  const b = g.nuevo('t');
  const c = g.nuevo('t');
  assert.match(a, P.PATRON_ID('t'));
  assert.ok(a < b && b < c, 'monótonos aunque el reloj no avance');
  const g2 = P.crearGeneradorIds({ reloj: () => T0 + 5000, aleatorio: () => Buffer.alloc(10, 7) });
  assert.ok(c < g2.nuevo('t'), 'un instante posterior ordena después');
  assert.throws(() => g.nuevo('MAL'), /prefijo_invalido/);
});

// ── estados ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('estados: una terminal no vuelve atrás y solo valen las transiciones del protocolo', () => {
  for (const t of P.TERMINALES) for (const e of P.ESTADOS_TAREA) assert.equal(P.transicionValida(t, e), false, `${t} → ${e}`);
  assert.ok(P.transicionValida('esperando_aprobacion', 'aceptada'));
  assert.ok(P.transicionValida('en_curso', 'parcial'));
  assert.equal(P.transicionValida('esperando_aprobacion', 'en_curso'), false, 'no se salta la aceptación');
  assert.equal(P.transicionValida('creada', 'inventado'), false);
});

test('errores: catálogo cerrado; un código desconocido se degrada a «interno» y no se filtran trazas', () => {
  assert.equal(P.crearError('duplicada', 'x').reintentable, false);
  assert.equal(P.crearError('aprobacion_caducada', 'x').reintentable, 'tras_nueva_aprobacion');
  assert.equal(P.crearError('cualquier_cosa', 'x').codigo, 'interno');
  assert.deepEqual(Object.keys(P.crearError('interno', 'm')), ['codigo', 'mensaje', 'reintentable']);
});

// ── huella e idempotencia (A-02) ─────────────────────────────────────────────────────────────────────────────────────────────────
test('A-02: la clave de idempotencia no depende del tiempo y cambia con la aprobación o con cualquier cambio de la huella', () => {
  const h = P.calcularHuella({ capacidad: '04.auditar-catalogo', version: '1.0.0', parametros: { entorno: 'produccion' }, entorno: 'produccion' });
  assert.equal(h, P.calcularHuella({ capacidad: '04.auditar-catalogo', version: '1.0.0', parametros: { entorno: 'produccion' }, entorno: 'produccion' }));
  assert.notEqual(h, P.calcularHuella({ capacidad: '04.auditar-catalogo', version: '1.0.1', parametros: { entorno: 'produccion' }, entorno: 'produccion' }), 'otra versión de capacidad');
  assert.notEqual(h, P.calcularHuella({ capacidad: '04.auditar-catalogo', version: '1.0.0', parametros: { entorno: 'local' }, entorno: 'local' }), 'otros parámetros');
  assert.notEqual(P.claveIdempotencia(h, 'a_1'), P.claveIdempotencia(h, 'a_2'), 'cada aprobación es otra ejecución');
  assert.equal(P.claveIdempotencia(h, 'a_1'), P.claveIdempotencia(h, 'a_1'));
  assert.equal(P.canonico({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}', 'claves ordenadas');
});

// ── sobre de tarea ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
function sobreL2(over = {}) {
  const cap = registro.buscarCapacidad('04.auditar-catalogo');
  const parametros = { entorno: 'produccion' };
  const huella = P.calcularHuella({ capacidad: cap.id, version: cap.version, parametros, entorno: 'produccion' });
  const g = P.crearGeneradorIds({ reloj: () => T0 });
  return {
    protocolo: P.PROTOCOLO, tipo: 'solicitud', idTarea: g.nuevo('t'), idCorrelacion: g.nuevo('c'), idPadre: null, profundidad: 0,
    origen: { actor: 'director', idSolicitud: g.nuevo('s'), propietario: true }, agente: '04', capacidad: cap.id, modo: 'accion', ejecutor: 'agente', prioridad: 'P3',
    alcancesSolicitados: ['catalog:read'], aprobacion: { nivel: 'L2', ref: 'a_1', huella, expiraEn: new Date(T0 + 600000).toISOString() },
    parametros, plazoMs: 120000, presupuesto: { maxCosteEur: 0, maxLlamadasApi: 8 }, claveIdempotencia: P.claveIdempotencia(huella, 'a_1'), creadaEn: new Date(T0).toISOString(), ...over,
  };
}
const codigos = (r) => r.errores.map((e) => e.codigo);

test('sobre: uno correcto pasa; cada defecto se rechaza ANTES de ejecutar con su código', () => {
  assert.deepEqual(P.validarSobreTarea(sobreL2(), { registro, ahora: T0 }), { ok: true, errores: [] });
  const caso = (over, esperado, opciones = {}) => assert.ok(codigos(P.validarSobreTarea(sobreL2(over), { registro, ahora: T0, ...opciones })).includes(esperado), `${JSON.stringify(Object.keys(over))} → ${esperado}`);
  caso({ capacidad: '99.nada' }, 'capacidad_desconocida');
  caso({ profundidad: 3 }, 'profundidad_excedida');
  caso({ alcancesSolicitados: ['catalog:read', 'proposals:create'] }, 'permiso_denegado');
  caso({ aprobacion: undefined }, 'aprobacion_requerida');
  caso({ aprobacion: { ...sobreL2().aprobacion, nivel: 'L3' } }, 'aprobacion_no_coincide');
  caso({ parametros: { entorno: 'local' } }, 'aprobacion_no_coincide'); // cambia la huella
  caso({ aprobacion: { ...sobreL2().aprobacion, expiraEn: new Date(T0 - 1000).toISOString() } }, 'aprobacion_caducada');
  caso({ claveIdempotencia: P.sha256('otra') }, 'aprobacion_no_coincide');
  caso({ protocolo: 'tai-protocolo/9' }, 'solicitud_invalida');
  caso({ prioridad: 'P9' }, 'solicitud_invalida');
  caso({ modo: 'consulta' }, 'solicitud_invalida');
  caso({ agente: '12' }, 'solicitud_invalida');
  assert.deepEqual(codigos(P.validarSobreTarea(sobreL2({ agente: '10', capacidad: '10.leer-analitica-agregada' }), { registro: regConPlanificado(registro, '10'), ahora: T0 })).includes('agente_no_operativo'), true, 'agente planificado no se invoca');
  assert.equal(P.validarSobreTarea(null, { registro }).ok, false);
});

test('sobre: una acción L4 no se envía nunca a un agente (la ejecuta una persona)', () => {
  const reg = R.crearRegistro({ ...plano(registro.datos), capacidades: [...plano(registro.datos).capacidades, { id: '04.publicar-x', agente: '04', version: '1.0.0', descripcion: 'x', modo: 'accion', nivelRiesgo: 'L4', alcances: [], efectos: 'irreversible', requiereAprobacion: true, disponibilidad: 'requiere_f3', plazoMs: 1000, entrada: {}, salida: {}, limites: {}, verificacion: 'por un segundo sistema' }] });
  const s = sobreL2({ capacidad: '04.publicar-x', aprobacion: undefined });
  assert.ok(codigos(P.validarSobreTarea(s, { registro: reg, ahora: T0, exigirAprobacion: false })).includes('permiso_denegado'));
  assert.ok(codigos(P.validarSobreTarea({ ...s, ejecutor: 'humano' }, { registro: reg, ahora: T0, exigirAprobacion: false })).includes('permiso_denegado'));
});

test('respuesta: «ejecutada» exige completada + evidencia; sin evidencia solo «terminó, no consta confirmación»', () => {
  const g = P.crearGeneradorIds({ reloj: () => T0 });
  const r = { protocolo: P.PROTOCOLO, tipo: 'respuesta', idTarea: g.nuevo('t'), estado: 'completada', efectos: { declarados: [], evidencia: [] } };
  assert.equal(P.validarRespuesta(r).confirmada, false);
  assert.equal(P.validarRespuesta({ ...r, efectos: { evidencia: [{ tipo: 'fila' }] } }).confirmada, true);
  assert.equal(P.validarRespuesta({ ...r, estado: 'parcial', efectos: { evidencia: [{ tipo: 'fila' }] } }).confirmada, false, 'parcial nunca es completada');
  assert.equal(P.validarRespuesta({ ...r, protocolo: 'x' }).ok, false);
});

// ── informe normalizado y esquemas ─────────────────────────────────────────────────────────────────────────────────────────────
test('informe-agente/1: el validador exige clave estable, evidencia literal, limitaciones y honestidad', () => {
  const ok = { esquema: 'informe-agente/1', agente: '04', capacidad: '04.leer-ultimo-informe', version: '1', entorno: 'produccion', idEjecucion: 'fx-1', generadoEn: '2026-11-14T09:00:00.000Z', completo: true, fuente: {}, resumen: {}, hallazgos: [{ clave: 'ficha:x:1', evidencia: {} }], limitaciones: [], honestidad: { datosAusentesDeclarados: true } };
  assert.deepEqual(P.validarInformeAgente(ok), { ok: true, errores: [] });
  assert.equal(P.validarInformeAgente({ ...ok, hallazgos: [{ evidencia: {} }] }).ok, false, 'sin clave estable');
  assert.equal(P.validarInformeAgente({ ...ok, hallazgos: [{ clave: 'a' }] }).ok, false, 'sin evidencia');
  assert.equal(P.validarInformeAgente({ ...ok, limitaciones: undefined }).ok, false);
  assert.equal(P.validarInformeAgente({ ...ok, honestidad: { datosAusentesDeclarados: false } }).ok, false);
});

test('esquemas JSON de informe-agente/1 y evento-ledger/1 existen y rechazan estructuras erróneas', () => {
  const e = J('automation/schemas/informe-agente.schema.json');
  assert.ok(validarEsquema({}, e).length > 5, 'un objeto vacío no es un informe');
  const ev = J('automation/schemas/evento-ledger.schema.json');
  assert.ok(validarEsquema({ idEvento: 'x', secuencia: 0 }, ev).length > 0);
});

// ── matriz de permisos ───────────────────────────────────────────────────────────────────────────────────────────────────────────
test('matriz: la regla de asignación (de arriba abajo, el más alto en la duda) y el nivel solo sube', () => {
  assert.equal(M.asignarNivel({ tocaPublicoCatalogoPreciosDineroAccesosOIrreversible: true, creaOCambiaAlgo: true }), 'L4');
  assert.equal(M.asignarNivel({ creaOCambiaAlgo: true, lanzaEjecucionConsumeOEscribeRegistro: true }), 'L3');
  assert.equal(M.asignarNivel({ lanzaEjecucionConsumeOEscribeRegistro: true }), 'L2');
  assert.equal(M.asignarNivel({ generaPropuesta: true }), 'L1');
  assert.equal(M.asignarNivel({}), 'L0');
  assert.equal(M.elevarNivel('L2', 'L0'), 'L2', 'nunca baja');
  assert.equal(M.elevarNivel('L2', 'L4'), 'L4', 'puede subir');
  assert.equal(M.nivelDePlan(['L0', 'L3', 'L2']), 'L3');
  assert.deepEqual(['L0', 'L1', 'L2', 'L3', 'L4'].map(M.requiereAprobacion), [false, false, true, true, true]);
});

test('matriz: la voz y la mensajería no confirman L2–L4; solo la interfaz (o la simulación de F1)', () => {
  for (const n of ['L2', 'L3', 'L4']) {
    assert.equal(M.canalPuedeConfirmar(n, 'voz'), false, `voz ${n}`);
    assert.equal(M.canalPuedeConfirmar(n, 'mensajeria'), false, `mensajería ${n}`);
    assert.equal(M.canalPuedeConfirmar(n, 'interfaz'), true);
  }
  assert.equal(M.canalPuedeConfirmar('L0', 'voz'), true);
  assert.equal(M.canalPuedeSolicitar('voz'), true, 'la voz puede SOLICITAR');
});

function aprob(nivel) {
  return M.crearSolicitudAprobacion({ idAprobacion: 'a_1', idTarea: 't_1', capacidad: 'x.y', nivel, huella: P.sha256('h'), resumen: 'r', ahora: T0 });
}

test('A-03: caducidad 15/10/5 min desde que se MUESTRA; sin respuesta = caducada, nunca aprobada', () => {
  assert.equal(Date.parse(aprob('L2').caduca) - T0, 15 * 60000);
  assert.equal(Date.parse(aprob('L3').caduca) - T0, 10 * 60000);
  assert.equal(Date.parse(aprob('L4').caduca) - T0, 5 * 60000);
  assert.throws(() => aprob('L1'), /nivel_sin_aprobacion/);
  const tarde = M.resolverAprobacion(aprob('L2'), { decision: 'aprobada', por: 'propietario', canal: 'interfaz', ahora: T0 + 15 * 60000 + 1 });
  assert.equal(tarde.ok, false);
  assert.equal(tarde.estadoNuevo, 'caducada');
  assert.equal(tarde.error.codigo, 'aprobacion_caducada');
  assert.equal(M.resolverAprobacion(aprob('L2'), { decision: 'aprobada', por: 'propietario', canal: 'interfaz', ahora: T0 + 15 * 60000 }).ok, true, 'justo en el límite todavía vale');
});

test('aprobación: solo el propietario, solo canales válidos, una aprobación = una resolución', () => {
  const base = { decision: 'aprobada', por: 'propietario', canal: 'interfaz', ahora: T0 + 1000 };
  assert.equal(M.resolverAprobacion(aprob('L2'), { ...base, por: 'agente:04' }).error.codigo, 'permiso_denegado');
  assert.equal(M.resolverAprobacion(aprob('L2'), { ...base, canal: 'voz' }).error.codigo, 'canal_no_permitido');
  assert.equal(M.resolverAprobacion(aprob('L2'), { ...base, decision: 'quizas' }).error.codigo, 'solicitud_invalida');
  const r = M.resolverAprobacion(aprob('L2'), base);
  assert.equal(r.aprobacion.estado, 'aprobada');
  assert.equal(M.resolverAprobacion(r.aprobacion, base).error.codigo, 'aprobacion_no_coincide', 'ya resuelta: no se reutiliza');
  assert.equal(M.resolverAprobacion(aprob('L2'), { ...base, decision: 'rechazada', motivo: 'no' }).aprobacion.estado, 'rechazada');
});

test('A-04: L3 exige reautenticar si la última autenticación fue hace > 30 min; L4 exige autenticación de ≤ 5 min', () => {
  const ahora = T0 + 1000;
  const L3 = (extra) => M.resolverAprobacion(aprob('L3'), { decision: 'aprobada', por: 'propietario', canal: 'interfaz', ahora, ...extra });
  assert.equal(L3({ ultimaAutenticacion: ahora - 29 * 60000 }).ok, true);
  assert.equal(L3({ ultimaAutenticacion: ahora - 31 * 60000 }).error.codigo, 'reautenticacion_requerida');
  assert.equal(L3({ ultimaAutenticacion: ahora - 31 * 60000, reautenticadoEn: ahora - 60000 }).ok, true);
  assert.equal(L3({ ultimaAutenticacion: null }).error.codigo, 'reautenticacion_requerida', 'sin dato de autenticación no se presume');
  const L4 = (extra) => M.resolverAprobacion(aprob('L4'), { decision: 'aprobada', por: 'propietario', canal: 'interfaz', ahora, ...extra });
  assert.equal(L4({ reautenticadoEn: ahora - 4 * 60000 }).ok, true);
  assert.equal(L4({ reautenticadoEn: ahora - 6 * 60000 }).error.codigo, 'reautenticacion_requerida');
  assert.equal(L4({ ultimaAutenticacion: ahora }).error.codigo, 'reautenticacion_requerida', 'la sesión reciente no basta: L4 exige reautenticación');
});

test('A-03: renovación ≤ 2, con contenido idéntico y nueva reautenticación', () => {
  let a = aprob('L3');
  const ctx = (h = a.huella, extra = {}) => ({ huella: h, ahora: T0 + 9 * 60000, reautenticadoEn: T0 + 9 * 60000 - 1000, ...extra });
  let r = M.renovarAprobacion(a, ctx());
  assert.equal(r.ok, true);
  assert.equal(r.aprobacion.renovaciones, 1);
  assert.equal(Date.parse(r.aprobacion.caduca), T0 + 9 * 60000 + 10 * 60000, 'el reloj se reinicia');
  assert.equal(M.renovarAprobacion(a, ctx(P.sha256('otra'))).error.codigo, 'aprobacion_no_coincide', 'contenido distinto: nueva solicitud');
  assert.equal(M.renovarAprobacion(a, ctx(a.huella, { reautenticadoEn: null })).error.codigo, 'reautenticacion_requerida');
  a = r.aprobacion;
  a = M.renovarAprobacion(a, ctx()).aprobacion;
  assert.equal(a.renovaciones, 2);
  assert.equal(M.renovarAprobacion(a, ctx()).error.codigo, 'limite_alcanzado', 'máximo 2 renovaciones');
});

test('la configuración de aprobaciones está CONGELADA: ni el modelo ni un módulo la cambian en caliente', () => {
  assert.ok(Object.isFrozen(M.CONFIG_APROBACIONES) && Object.isFrozen(M.CONFIG_APROBACIONES.caducidadMin));
  assert.throws(() => { 'use strict'; M.CONFIG_APROBACIONES.caducidadMin.L4 = 999; }, TypeError);
});

// ── frescura (A-01) ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const ahoraF = Date.parse('2026-11-20T12:00:00.000Z');
const hace = (ms) => new Date(ahoraF - ms).toISOString();
const D = 86400000;

test('A-01: umbrales del Auditor (24 h / 7 d) y de Calidad (7 d / 30 d); un informe parcial nunca es vigente', () => {
  const aud = { vigenteHasta: '24h', actualizarHasta: '7d' };
  const cal = { vigenteHasta: '7d', actualizarHasta: '30d' };
  assert.equal(F.clasificarFrescura({ generadoEn: hace(23 * 3600000), completo: true }, aud, ahoraF).estado, 'vigente');
  assert.equal(F.clasificarFrescura({ generadoEn: hace(25 * 3600000), completo: true }, aud, ahoraF).estado, 'a_actualizar');
  assert.equal(F.clasificarFrescura({ generadoEn: hace(8 * D), completo: true }, aud, ahoraF).estado, 'solo_historico');
  assert.equal(F.clasificarFrescura({ generadoEn: hace(6 * D), completo: true }, cal, ahoraF).estado, 'vigente');
  assert.equal(F.clasificarFrescura({ generadoEn: hace(29 * D), completo: true }, cal, ahoraF).estado, 'a_actualizar');
  assert.equal(F.clasificarFrescura({ generadoEn: hace(31 * D), completo: true }, cal, ahoraF).estado, 'solo_historico');
  const parcial = F.clasificarFrescura({ generadoEn: hace(3600000), completo: false }, aud, ahoraF);
  assert.equal(parcial.estado, 'a_actualizar');
  assert.ok(parcial.motivos.includes('informe_parcial'));
  assert.equal(F.clasificarFrescura({ generadoEn: 'no-es-fecha', completo: true }, aud, ahoraF).estado, 'desconocida');
  assert.equal(F.clasificarFrescura({ generadoEn: new Date(ahoraF + 3600000).toISOString(), completo: true }, aud, ahoraF).estado, 'desconocida', 'fecha futura: no se afirma nada');
  assert.equal(F.clasificarFrescura({ generadoEn: hace(1000), completo: true }, { vigenteHasta: 'x', actualizarHasta: '7d' }, ahoraF).estado, 'desconocida');
});

test('A-01: la frescura depende de la PREGUNTA; los históricos siempre se pueden consultar', () => {
  const cl = (ms, completo = true) => F.clasificarFrescura({ generadoEn: hace(ms), completo }, { vigenteHasta: '24h', actualizarHasta: '7d' }, ahoraF);
  assert.equal(F.aplicarPregunta(cl(3600000), 'presente').tono, 'responder');
  assert.equal(F.aplicarPregunta(cl(3 * D), 'presente').tono, 'responder_con_aviso');
  const viejo = F.aplicarPregunta(cl(20 * D), 'presente');
  assert.equal(viejo.tono, 'no_consta');
  assert.equal(viejo.ofrecerActualizar, true);
  assert.equal(F.aplicarPregunta(cl(20 * D), 'historica').tono, 'responder', 'histórica: cualquier edad con su fecha');
  assert.equal(F.aplicarPregunta(cl(3600000, false), 'decision').puedeAfirmarComoActual, false, 'decisión exige vigente Y completo');
  assert.equal(F.aplicarPregunta(cl(3600000), 'decision').puedeAfirmarComoActual, true);
  assert.equal(F.aplicarPregunta(cl(3 * D), 'decision').tono, 'no_consta');
});

test('duraciones y aviso de comunicado sin verificar (30 d)', () => {
  assert.deepEqual(['60s', '5min', '24h', '7d'].map(F.parseDuracion), [60000, 300000, 86400000, 604800000]);
  assert.equal(F.parseDuracion('7 dias'), null);
  assert.equal(F.avisoComunicado(hace(29 * D), ahoraF), null);
  assert.match(F.avisoComunicado(hace(31 * D), ahoraF), /comunicado hace 31 días, sin verificar/);
});

// ── registro ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('registro: 14 agentes, coherencia de niveles y solo lectura', () => {
  assert.equal(registro.agentes().length, 14);
  assert.deepEqual(registro.agentes().map((a) => a.id), ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13']);
  assert.equal(registro.buscarCapacidad('04.auditar-catalogo').nivelRiesgo, 'L2');
  assert.equal(registro.agente('04').origenEstado, 'comunicado', 'lo comunicado se rotula como tal');
  assert.ok(Object.isFrozen(registro.buscarCapacidad('04.auditar-catalogo')) && Object.isFrozen(registro.agente('04')), 'el Director no puede modificar el registro');
  assert.throws(() => { 'use strict'; registro.buscarCapacidad('04.auditar-catalogo').nivelRiesgo = 'L0'; }, TypeError);
  assert.match(registro.huella, /^sha256:[0-9a-f]{64}$/);
});

test('registro: el nivel de una capacidad no se puede bajar ni dejar incoherente con su modo y efectos', () => {
  const d = () => plano(registro.datos);
  const con = (id, cambio) => { const x = d(); Object.assign(x.capacidades.find((c) => c.id === id), cambio); return R.validarRegistro(x); };
  assert.equal(con('04.auditar-catalogo', { nivelRiesgo: 'L0', requiereAprobacion: false }).ok, false, 'una acción con efectos no puede ser L0');
  assert.equal(con('04.auditar-catalogo', { requiereAprobacion: false }).ok, false);
  assert.equal(con('04.auditar-catalogo', { verificacion: '—' }).ok, false, 'L2+ debe declarar cómo se verifica');
  assert.equal(con('04.leer-ultimo-informe', { frescura: undefined }).ok, false, 'una consulta de estado declara su frescura');
  assert.equal(con('06.guardar-borrador-portada', { nivelRiesgo: 'L2' }).ok, false, 'L3 reversible no baja a L2');
  const dup = d(); dup.capacidades.push(dup.capacidades[0]);
  assert.equal(R.validarRegistro(dup).ok, false);
  const cred = d(); cred.agentes[4].credencial = ['Bear', 'er ', 'abcdefghijklmnopqrstuvwxyz'].join('');
  assert.equal(R.validarRegistro(cred).ok, false, 'credenciales por nombre, nunca por valor');
  assert.throws(() => R.crearRegistro({ registro: 'otro' }), /Registro inválido/);
});

test('asignación: solo agentes operativos/construidos y capacidades existentes; F1 ejecuta solo lectura', () => {
  assert.equal(R.evaluarAsignacion(registro, '04.leer-ultimo-informe').ejecutableEnF1, true);
  const aud = R.evaluarAsignacion(registro, '04.auditar-catalogo');
  assert.equal(aud.ok, true);
  assert.equal(aud.ejecutableEnF1, false, 'lanzar la auditoría requiere F3');
  assert.equal(R.evaluarAsignacion(regConPlanificado(registro, '10'), '10.leer-analitica-agregada').codigo, 'agente_no_operativo');
  assert.equal(R.evaluarAsignacion(registro, '04.proponer-correcciones').codigo, 'agente_no_operativo', 'planificada');
  assert.equal(R.evaluarAsignacion(registro, '77.x').codigo, 'capacidad_desconocida');
  const ids = R.candidatas(registro, { agente: '04', soloEjecutablesF1: true }).map((c) => c.id);
  assert.deepEqual(ids, ['04.comparar-informes', '04.leer-historial', '04.leer-ultimo-informe']);
});
