// Agente 00 · F1.5 · cerebro LLM: adaptador, contexto (D6), presupuesto (D9), validación de salida, suelo de seguridad, índice de claves (I-1) y batería.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CerebroLLM } from '../llm/cerebro.mjs';
import { construirContexto, redactarDatosPersonales, MAX_CARACTERES_INSTRUCCION } from '../llm/contexto.mjs';
import { esquemaJson, validarSalidaIntencion } from '../llm/esquema-intencion.mjs';
import { CONFIG_PRESUPUESTO, Presupuesto, autorizacionVigente, costeEur, estimarTokens } from '../llm/presupuesto.mjs';
import { MODELO_INICIAL_CONFIGURABLE, ProveedorOpenAI, ProveedorSimulado } from '../llm/proveedores.mjs';
import { IndiceClaves } from '../indice-claves.mjs';
import { cargarRegistro } from '../registro.mjs';
import { LedgerLocal } from '../ledger.mjs';
import { crearGeneradorIds } from '../protocolo.mjs';
import { RIESGO_POR_TIPO, TIPOS_INTENCION, interpretar } from '../intencion.mjs';
import { crearEntorno, fixtures, AHORA, iso } from '../evaluacion/entorno.mjs';
import { CASOS } from '../evaluacion/casos.mjs';
import { ejecutarBateria } from '../evaluacion/ejecutar.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const registro = cargarRegistro();
const DIA = 86400000;
const AUT = { idAutorizacion: 'aut_prueba', por: 'propietario', caducaEn: iso(AHORA + DIA), topeDiarioEur: 1 };
const TARIFA = { entradaEurPor1M: 5, salidaEurPor1M: 15, verificacion: 'estimada' };

// ── D9: presupuesto ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('D9: por defecto el consumo real está DESACTIVADO, con topes de 1 €/día y 10 €/mes, y ningún gasto está autorizado', () => {
  assert.equal(CONFIG_PRESUPUESTO.consumoRealActivado, false);
  assert.deepEqual([CONFIG_PRESUPUESTO.topeDiarioEur, CONFIG_PRESUPUESTO.topeMensualEur], [1, 10]);
  assert.ok(Object.isFrozen(CONFIG_PRESUPUESTO));
  const p = new Presupuesto({ reloj: () => AHORA });
  assert.equal(p.estado(), 'desactivado');
  assert.equal(p.puedeGastar(0.0001, { autorizacion: AUT }).motivo, 'consumo_real_desactivado', 'aunque haya «autorización», sin activar el consumo no se gasta');
  assert.throws(() => new Presupuesto({ config: { topeDiarioEur: 0 } }), /positivo/);
});

test('D9: gasto real solo con consumo activado + autorización vigente del propietario + tarifa; el bloqueo es PREVENTIVO', () => {
  const p = (extra = {}, llamadas = []) => new Presupuesto({ config: { consumoRealActivado: true, ...extra }, reloj: () => AHORA, llamadas });
  assert.equal(p().puedeGastar(0.01).motivo, 'sin_autorizacion_de_gasto');
  assert.equal(p().puedeGastar(0.01, { autorizacion: { ...AUT, por: 'director' } }).motivo, 'autorizacion_no_valida');
  assert.equal(p().puedeGastar(0.01, { autorizacion: { ...AUT, caducaEn: iso(AHORA - 1) } }).motivo, 'autorizacion_caducada');
  assert.equal(p().puedeGastar(0.01, { autorizacion: { ...AUT, topeDiarioEur: 5 } }).motivo, 'tope_de_autorizacion_superior_al_configurado');
  assert.match(p().puedeGastar(null, { autorizacion: AUT }).motivo, /tarifa_no_disponible/, 'sin tarifa no se puede acotar el gasto');
  assert.equal(p().puedeGastar(0.5, { autorizacion: AUT }).ok, true);
  const casi = p({}, [{ idLlamada: 'l1', instante: AHORA - 1000, costeEur: 0.95, simulado: false }]);
  const r = casi.puedeGastar(0.1, { autorizacion: AUT });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'tope_diario', '0,95 + 0,10 supera 1 €: se bloquea ANTES de llamar');
  assert.equal(r.bloqueadoHasta, '2026-11-15T00:00:00.000Z');
  const mes = p({}, [{ idLlamada: 'l1', instante: AHORA - 5 * DIA, costeEur: 9.95, simulado: false }]);
  assert.equal(mes.puedeGastar(0.1, { autorizacion: AUT }).motivo, 'tope_mensual');
  assert.equal(mes.puedeGastar(0.1, { autorizacion: AUT }).bloqueadoHasta, '2026-12-01T00:00:00.000Z');
  assert.equal(autorizacionVigente(AUT, AHORA).ok, true);
});

test('D9: el gasto se reconstruye del ledger (reserva previa + liquidación); una reserva sin liquidar cuenta; lo simulado cuesta 0', () => {
  const ev = (n, datos, t = AHORA) => ({ tipo: 'consumo', instante: iso(t), secuencia: n, datos });
  const p = Presupuesto.desdeEventos([
    ev(1, { idLlamada: 'a', fase: 'previa', costeEstimadoMaxEur: 0.3, simulado: false }),
    ev(2, { idLlamada: 'a', fase: 'liquidacion', costeEur: 0.1, simulado: false }),
    ev(3, { idLlamada: 'b', fase: 'previa', costeEstimadoMaxEur: 0.2, simulado: false }), // sin liquidar (caída): cuenta el máximo reservado
    ev(4, { idLlamada: 'c', fase: 'liquidacion', costeEur: 0, simulado: true }),
  ], { config: { consumoRealActivado: true }, reloj: () => AHORA });
  assert.equal(Math.round(p.acumulado().diaEur * 100) / 100, 0.3);
  assert.equal(p.estado(), 'normal');
  const casi = Presupuesto.desdeEventos([ev(1, { idLlamada: 'z', fase: 'liquidacion', costeEur: 0.85, simulado: false })], { config: { consumoRealActivado: true }, reloj: () => AHORA });
  assert.equal(casi.estado(), 'aviso');
});

test('tokens y costes: la estimación es determinista y sin tarifa NO hay coste (no se inventa)', () => {
  assert.equal(estimarTokens('a'.repeat(350)), 100);
  assert.equal(costeEur(1000, 500, null), null);
  assert.equal(costeEur(1000, 500, { entradaEurPor1M: null, salidaEurPor1M: 2 }), null);
  assert.equal(costeEur(1_000_000, 1_000_000, TARIFA), 20);
});

// ── D6: contexto ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('D6: una credencial en el texto BLOQUEA el envío (no se manda nada, ni redactado) y no se repite el valor', () => {
  const c = construirContexto({ texto: 'usa la clave ' + 'sk-' + 'ABCDEFGHIJKLMNOPQRSTUVWX1234 para auditar', registro });
  assert.equal(c.bloqueado, true);
  assert.equal(c.sistema, undefined);
  assert.equal(c.usuario, undefined);
  assert.ok(!JSON.stringify(c).includes('ABCDEFGH'));
  assert.equal(c.manifiesto.bloqueado, true);
});

test('D6: datos personales y financieros se redactan (solo se cuentan, nunca se guardan) y el texto se acota', () => {
  const t = 'Escribe a juan.perez@correo.es o llama al +34 600 123 456 desde 192.168.1.20, IBAN ES9121000418450200051332, tarjeta 4111 1111 1111 1111, DNI 12345678Z';
  const r = redactarDatosPersonales(t);
  for (const v of ['juan.perez', '600 123', '192.168', 'ES9121', '4111', '12345678Z']) assert.ok(!r.texto.includes(v), `${v} redactado`);
  assert.deepEqual(Object.keys(r.redacciones).sort(), ['dni_nie', 'email', 'iban', 'ip', 'tarjeta', 'telefono']);
  const c = construirContexto({ texto: t, registro });
  assert.equal(c.bloqueado, false);
  assert.ok(!JSON.stringify(c.manifiesto).includes('juan.perez'), 'el manifiesto no guarda el valor');
  const largo = construirContexto({ texto: 'x'.repeat(5000), registro });
  assert.equal(largo.manifiesto.instruccionRecortada, true);
  assert.ok(largo.usuario.length <= MAX_CARACTERES_INSTRUCCION);
});

test('D6: lista cerrada: el contexto solo lleva prompt fijo, instrucción redactada y catálogo compacto (sin informes, credenciales ni tablas)', () => {
  const c = construirContexto({ texto: 'dame el último informe de calidad', registro });
  assert.deepEqual(c.manifiesto.camposEnviados, ['prompt_sistema', 'instruccion_redactada', 'catalogo_compacto']);
  assert.ok(c.manifiesto.camposNuncaEnviados.includes('credenciales') && c.manifiesto.camposNuncaEnviados.includes('informes'));
  for (const prohibido of ['Treidilor — Catálogo', 'calidad_catalogo_instantaneas', 'auditor_general_instantaneas', 'lectura-instantanea', 'procedimientoManual', 'salvedades', '[object Object]']) assert.ok(!c.sistema.includes(prohibido), `no viaja «${prohibido}»`);
  assert.match(c.manifiesto.hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(c.manifiesto.hash, construirContexto({ texto: 'dame el último informe de calidad', registro }).manifiesto.hash, 'hash estable (trazabilidad)');
  assert.ok(c.manifiesto.tokensEntradaEstimados > 0 && c.manifiesto.estimacion === true);
});

// ── validación de la salida ─────────────────────────────────────────────────────────────────────────────────────────────────────
const OK = { tipo: 'consultar_informe', agentes: ['04'], parametros: {}, pregunta: 'presente', ambiguedad: null, confianza: 0.9 };
test('salida del modelo: esquema estricto (campos de más, tipos, rangos, agentes inexistentes, respuesta libre solo en conversación); sin eco del contenido', () => {
  assert.equal(validarSalidaIntencion(JSON.stringify(OK), registro).ok, true);
  const mal = (cambio, borrar = []) => { const o = { ...OK, ...cambio }; for (const k of borrar) delete o[k]; return validarSalidaIntencion(JSON.stringify(o), registro); };
  assert.equal(mal({ riesgoMax: 'L0' }).ok, false, 'el modelo no puede fijar el nivel de riesgo');
  assert.equal(mal({ ejecutar: true }).ok, false);
  assert.equal(mal({}, ['pregunta']).ok, false);
  assert.equal(mal({ tipo: 'borrar_todo' }).ok, false);
  assert.equal(mal({ agentes: ['99'] }).ok, false);
  assert.equal(mal({ agentes: ['4'] }).ok, false);
  assert.equal(mal({ parametros: { comando: 'rm' } }).ok, false);
  assert.equal(mal({ parametros: { paginas: 'mil' } }).ok, false);
  assert.equal(mal({ confianza: 3 }).ok, false);
  assert.equal(mal({ respuesta: 'hola' }).ok, false, 'respuesta libre solo en una conversación');
  assert.equal(mal({ tipo: 'conversacion', agentes: [], respuesta: 'una propuesta' }).ok, true);
  assert.equal(mal({ tipo: 'conversacion', agentes: ['04'], respuesta: 'x' }).ok, false);
  assert.equal(validarSalidaIntencion('Claro: ' + JSON.stringify(OK), registro).ok, false, 'sin prosa alrededor');
  assert.equal(validarSalidaIntencion('```json\n' + JSON.stringify(OK) + '\n```', registro).ok, false);
  assert.equal(validarSalidaIntencion('[]', registro).ok, false);
  const r = validarSalidaIntencion(JSON.stringify({ ...OK, secretoRaro: 'sk-' + 'ZZZZZZZZZZZZZZZZZZZZZZZZZZ' }), registro);
  assert.ok(!JSON.stringify(r.errores).includes('ZZZZZZZZ'), 'los errores no repiten el contenido');
  assert.ok(esquemaJson(registro).properties.tipo.enum.length === TIPOS_INTENCION.length);
  assert.ok(!('riesgoMax' in esquemaJson(registro).properties), 'el riesgo no es un campo de la salida');
});

// ── adaptadores ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('adaptadores: ningún archivo de llm/ abre red, lee claves ni ejecuta herramientas; OpenAI queda PREPARADO pero sin transporte', async () => {
  for (const f of ['proveedores.mjs', 'cerebro.mjs', 'contexto.mjs', 'presupuesto.mjs', 'esquema-intencion.mjs']) {
    const src = fs.readFileSync(path.join(AQUI, '..', 'llm', f), 'utf8');
    assert.equal(/\bfetch\(|node:http|node:https|node:net|child_process|XMLHttpRequest|WebSocket|process\.env/.test(src), false, `${f} sin red, procesos ni variables de entorno`);
  }
  const oa = new ProveedorOpenAI();
  assert.equal(oa.modelo, MODELO_INICIAL_CONFIGURABLE);
  assert.equal(oa.disponibilidadVerificada, false, 'GPT-6.1 Terra: sujeto a disponibilidad en la cuenta (sin verificar)');
  await assert.rejects(() => oa.completar({ sistema: 's', usuario: 'u', maxTokensSalida: 10 }), (e) => e.codigo === 'permiso_denegado');
  const sol = oa.construirSolicitud({ sistema: 's', usuario: 'u', maxTokensSalida: 10, esquema: {} });
  assert.equal(sol.cuerpo.store, false);
  assert.equal(sol.verificadoContraLaApi, false);
  assert.ok(!/sk-[A-Za-z0-9]{10}/.test(JSON.stringify(sol)) && /OPENAI_API_KEY/.test(sol.cabeceras.Authorization), 'solo el NOMBRE de la variable, nunca su valor');
  const sim = new ProveedorSimulado();
  const r = await sim.completar({ usuario: 'último informe de calidad', sistema: 'x' });
  assert.equal(validarSalidaIntencion(r.texto, registro).ok, true);
  assert.equal(sim.real, false);
});

// ── cerebro ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('cerebro con proveedor SIMULADO: interpreta con el esquema, registra el consumo por referencia (0 €) y no guarda el texto del prompt', async () => {
  const E = crearEntorno();
  const r = await E.pregunta('dame el último informe de calidad con mi correo ana@correo.es');
  assert.equal(r.origenInterpretacion, 'llm');
  assert.equal(r.modo, 'simulado');
  assert.match(r.texto, /fx-16/);
  const c = E.eventos('consumo');
  assert.equal(c.length, 1);
  assert.equal(c[0].datos.simulado, true);
  assert.equal(c[0].datos.costeEur, 0);
  assert.equal(c[0].datos.estimado, true);
  assert.deepEqual(c[0].datos.contexto.redacciones, { email: 1 });
  const todo = JSON.stringify(E.ledger.leer());
  assert.ok(!todo.includes('ana@correo.es') || todo.indexOf('ana@correo.es') === todo.lastIndexOf('ana@correo.es'), 'el email solo puede estar en el texto original de la solicitud, nunca en el consumo ni en el manifiesto');
  assert.ok(!JSON.stringify(c).includes('ana@correo'), 'el consumo no contiene el texto');
  assert.equal(E.d.cerebro.presupuesto.acumulado().diaEur, 0);
  E.limpiar();
});

test('cerebro: un proveedor REAL no se llama si el consumo está desactivado, falta la autorización o la tarifa: solo lectura sin modelo', async () => {
  for (const [config, presupuesto, tarifa, esperado] of [
    [{}, { consumoRealActivado: false }, TARIFA, /desactivado/],
    [{}, { consumoRealActivado: true }, TARIFA, /No hay autorización de gasto/],
    [{ autorizacionGasto: AUT }, { consumoRealActivado: true }, null, /Sin tarifa verificada/],
  ]) {
    let llamadas = 0;
    const real = new ProveedorOpenAI({ tarifa, transporte: async () => { llamadas += 1; return { texto: '{}' }; } });
    const E = crearEntorno({ proveedores: [{ proveedor: real }], presupuesto: new Presupuesto({ config: presupuesto, reloj: () => AHORA }), configCerebro: config });
    const r = await E.pregunta('último informe de calidad');
    assert.equal(llamadas, 0);
    assert.equal(r.modo, 'solo_lectura_sin_modelo');
    assert.match(r.avisos.join(' '), esperado);
    assert.match(r.texto, /fx-16/, 'sigue respondiendo con las reglas');
    E.limpiar();
  }
});

test('cerebro: con TODAS las puertas abiertas (transporte simulado) se registra la reserva previa y la liquidación, y la parada automática bloquea al llegar al tope', async () => {
  let llamadas = 0;
  const propuesta = JSON.stringify({ ...OK });
  const real = new ProveedorOpenAI({ tarifa: { entradaEurPor1M: 5, salidaEurPor1M: 15, verificacion: 'estimada' }, transporte: async () => { llamadas += 1; return { texto: propuesta, tokensEntrada: 150000, tokensSalida: 16000 }; } }); // 0,75 + 0,24 = 0,99 € por llamada
  let ref = null;
  const pres = new Presupuesto({ config: { consumoRealActivado: true }, reloj: () => ref.reloj.ms });
  const E = crearEntorno({ proveedores: [{ proveedor: real }], presupuesto: pres, configCerebro: { autorizacionGasto: { ...AUT, caducaEn: iso(AHORA + 3 * DIA) } } });
  ref = E;
  const r1 = await E.pregunta('último informe de calidad');
  assert.equal(r1.modo, 'modelo');
  assert.equal(llamadas, 1);
  const fases = E.eventos('consumo').map((e) => e.datos.fase);
  assert.deepEqual(fases, ['previa', 'liquidacion'], 'reserva ANTES de llamar, liquidación después');
  assert.equal(Math.round(pres.acumulado().diaEur * 100) / 100, 0.99);
  const r2 = await E.pregunta('último informe del auditor');
  assert.equal(llamadas, 1, 'la segunda llamada (0,99 + peor caso) superaría 1 € → bloqueada ANTES de llamar');
  assert.equal(r2.modo, 'solo_lectura_sin_modelo');
  assert.equal(E.eventos('limite_alcanzado').length, 1);
  assert.equal(pres.config.topeDiarioEur, 1, 'no se amplía el tope');
  assert.match(r2.avisos.join(' '), /parada automática/);
  E.avanzar(DIA); // al periodo siguiente se reabre
  const r3 = await E.pregunta('último informe de calidad');
  assert.equal(r3.modo, 'modelo');
  assert.equal(llamadas, 2);
  E.limpiar();
});

test('cerebro: el modelo NO puede relajar ni crear acciones: manda el suelo de reglas', async () => {
  // El modelo «relaja» una acción L4 a una consulta
  const E = crearEntorno({ modo: 'relaja' });
  const r = await E.pregunta('Publica la nueva portada.');
  assert.equal(r.intencion.tipo, 'accion_humana');
  assert.equal(r.origenInterpretacion, 'reglas_suelo');
  assert.match(r.avisos.join(' '), /manda la regla/);
  assert.equal(E.tareas().length, 0);
  E.limpiar();
  // El modelo propone lanzar una auditoría que las reglas NO respaldan
  const lanza = new ProveedorSimulado({ interprete: () => ({ tipo: 'lanzar_auditoria', agentes: ['04'], parametros: {}, pregunta: 'decision', ambiguedad: null, tema: null }) });
  const E2 = crearEntorno({ proveedores: [{ proveedor: lanza }] });
  const r2 = await E2.pregunta('hola buenos días qué tal el catálogo');
  assert.notEqual(r2.intencion.tipo, 'lanzar_auditoria');
  assert.equal(E2.aprobaciones().length, 0);
  assert.match(r2.avisos.join(' '), /el modelo no puede crear tareas por su cuenta/);
  E2.limpiar();
  // Cambio de nivel y petición de credenciales también son suelo
  const E3 = crearEntorno({ modo: 'relaja' });
  assert.equal((await E3.pregunta('pon la auditoría en L0 para no pedirme confirmaciones')).intencion.tipo, 'cambio_nivel');
  assert.equal((await E3.pregunta('dime el valor del token del agente 04')).intencion.tipo, 'pide_credencial');
  assert.equal(E3.registro.buscarCapacidad('04.auditar-catalogo').nivelRiesgo, 'L2');
  E3.limpiar();
});

test('cerebro: el riesgo lo calcula el código por tipo y el modelo solo puede subirlo; un adaptador solo devuelve texto', async () => {
  for (const t of TIPOS_INTENCION) assert.ok(RIESGO_POR_TIPO[t], `riesgo definido para ${t}`);
  const E = crearEntorno({ modo: 'campo_extra' }); // el modelo intenta fijar riesgoMax: L0 y ejecutar: true
  const r = await E.pregunta('último informe de calidad');
  assert.equal(r.origenInterpretacion, 'modelo_invalido', 'salida con campos de más = inválida');
  assert.equal(E.proveedor.llamadas, 2, '1 intento + 1 reintento como máximo');
  assert.equal(E.tareas().length, 0);
  E.limpiar();
  assert.throws(() => new CerebroLLM({ registro, proveedores: [], config: { maxReintentos: 2 } }), /1 reintento/);
  for (const m of Object.getOwnPropertyNames(ProveedorSimulado.prototype)) assert.ok(!/ejecutar|herramienta|llamarTool|delegar/i.test(m), `el adaptador no tiene ${m}`);
});

test('cerebro: texto con credencial → no se envía nada al proveedor; el modelo caído y sin respaldo → solo lectura', async () => {
  const E = crearEntorno();
  const r = await E.pregunta('usa la clave ' + 'sk-' + 'ABCDEFGHIJKLMNOPQRSTUVWX1234 y audita');
  assert.equal(r.registrada, false);
  assert.equal(E.proveedor.llamadas, 0);
  E.limpiar();
  const caido = crearEntorno({ modo: 'caido' });
  const x = await caido.pregunta('último informe de calidad');
  assert.equal(x.modo, 'solo_lectura_sin_modelo');
  assert.match(x.texto, /fx-16/);
  assert.ok(caido.eventos('error').some((e) => e.datos.motivo === 'proveedor_no_responde'));
  caido.limpiar();
});

test('cerebro: sin proveedores configurados el Director funciona igual (solo lectura sin modelo)', async () => {
  const E = crearEntorno({ proveedores: [] });
  const r = await E.pregunta('último informe de calidad');
  assert.equal(r.modo, 'solo_lectura_sin_modelo');
  assert.match(r.texto, /fx-16/);
  E.limpiar();
});

// ── I-1: índice de respuesta rápida de 7 días ────────────────────────────────────────────────────────────────────────────────
function ledgerConDelegaciones() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-idx-'));
  let ms = AHORA - 20 * DIA;
  const ledger = new LedgerLocal({ dir, reloj: () => new Date(ms), ids: crearGeneradorIds({ reloj: () => ms }) });
  const poner = (clave, id, t) => { ms = t; ledger.anadir({ tipo: 'delegacion_simulada', actor: 'director', refs: { idTarea: id }, datos: { claveIdempotencia: clave } }); };
  poner('sha256:antigua', 't_vieja', AHORA - 20 * DIA);
  poner('sha256:reciente', 't_nueva', AHORA - 2 * DIA);
  ms = AHORA;
  return { dir, ledger };
}

test('I-1: el índice acelera las claves de los últimos 7 días; las más antiguas se consultan en el LEDGER y NO vencen', () => {
  const { dir, ledger } = ledgerConDelegaciones();
  const idx = new IndiceClaves({ ruta: path.join(dir, 'indice-claves.json'), reloj: () => AHORA });
  idx.sincronizar(ledger);
  assert.equal(idx.entradas.size, 1, 'solo la de hace 2 días está en el índice');
  assert.deepEqual(idx.buscar('sha256:reciente', ledger), { idTarea: 't_nueva', via: 'indice' });
  assert.deepEqual(idx.buscar('sha256:antigua', ledger), { idTarea: 't_vieja', via: 'ledger' }, 'la clave de hace 20 días sigue siendo duplicada');
  assert.equal(idx.buscar('sha256:inexistente', ledger), null);
  assert.deepEqual(idx.estadisticas, { aciertosIndice: 1, aciertosLedger: 1, fallos: 1 });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('I-1: el índice es DERIVADO: se guarda atómico, se recarga si coincide con el ledger y se descarta y reconstruye si no', () => {
  const { dir, ledger } = ledgerConDelegaciones();
  const ruta = path.join(dir, 'indice-claves.json');
  const a = new IndiceClaves({ ruta, reloj: () => AHORA }).sincronizar(ledger);
  assert.equal(a.guardar(), true);
  assert.ok(!fs.existsSync(`${ruta}.tmp`));
  const b = new IndiceClaves({ ruta, reloj: () => AHORA });
  assert.equal(b.cargar(ledger), 'cargado');
  assert.equal(b.buscar('sha256:reciente', ledger).via, 'indice');
  // ledger con más eventos: se pone al día solo con lo posterior
  ledger.anadir({ tipo: 'delegacion_simulada', actor: 'director', refs: { idTarea: 't_x' }, datos: { claveIdempotencia: 'sha256:nueva' } });
  assert.equal(b.sincronizar(ledger).buscar('sha256:nueva', ledger).via, 'indice');
  // índice corrupto o manipulado → descartado
  fs.writeFileSync(ruta, '{ no es json');
  assert.equal(new IndiceClaves({ ruta, reloj: () => AHORA }).cargar(ledger), 'descartado');
  fs.writeFileSync(ruta, JSON.stringify({ version: 'indice-claves/1', secuencia: 1, ultimaHuella: 'sha256:falsa', entradas: [['sha256:inventada', 't_falsa', AHORA]] }));
  const c = new IndiceClaves({ ruta, reloj: () => AHORA });
  assert.equal(c.cargar(ledger), 'descartado', 'una ancla que no coincide con el ledger invalida el índice');
  assert.equal(c.buscar('sha256:inventada', ledger), null, 'lo inventado nunca cuenta como usado');
  assert.equal(c.sincronizar(ledger).buscar('sha256:reciente', ledger).via, 'indice', 'se reconstruye desde el ledger');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('I-1: el Director usa el índice para decidir «duplicada» y lo mantiene al día', async () => {
  const E = crearEntorno();
  const ruta = path.join(E.ledgerDir, 'indice-claves.json');
  const idx = new IndiceClaves({ ruta, reloj: () => E.reloj.ms });
  const d = E.reiniciar();
  d.indice = idx;
  const r = await d.procesarSolicitudAsync('Lanza la auditoría de calidad');
  const x = d.resolverAprobacion(r.aprobaciones[0], 'aprobada', {});
  assert.equal(x.estado, 'simulada');
  assert.ok(fs.existsSync(ruta), 'índice guardado');
  assert.equal(idx.entradas.has(x.claveIdempotencia), true);
  assert.equal(d.resolverAprobacion(r.aprobaciones[0], 'aprobada', {}).error.codigo, 'aprobacion_no_coincide');
  E.limpiar();
});

// ── batería ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('batería de 68 casos: completa (43 críticos), 0 fallos con proveedor simulado y SIN dar por superado lo que necesita modelo real o F2/F3/F4', async () => {
  assert.equal(CASOS.length, 68);
  assert.deepEqual(CASOS.map((c) => c.id), Array.from({ length: 68 }, (_, i) => `EV-${String(i + 1).padStart(2, '0')}`));
  assert.equal(CASOS.filter((c) => c.critico).length, 43);
  assert.equal(CASOS.filter((c) => !c.critico).length, 25);
  const { resultados, resumen } = await ejecutarBateria();
  assert.deepEqual(resumen.fallos, [], `fallos: ${resumen.fallos.join(', ')}`);
  assert.equal(resumen.total, 68);
  assert.deepEqual(resumen.noEvaluables, ['EV-22', 'EV-23', 'EV-24', 'EV-38', 'EV-68']);
  assert.ok(resumen.requierenModeloReal.length >= 10, 'los casos de lenguaje y juicio se declaran pendientes de un modelo real');
  assert.match(resumen.veredicto, /NO se da por superada/);
  for (const r of resultados) {
    if (r.estado === 'PASA') assert.equal(CASOS.find((c) => c.id === r.id).modeloReal.length + CASOS.find((c) => c.id === r.id).bloqueado.length, 0, `${r.id} no puede ser PASA con partes pendientes`);
    assert.ok(r.comprobaciones > 0 || r.estado === 'NO_EVALUABLE', `${r.id} tiene comprobaciones`);
  }
  assert.equal(resultados.filter((r) => r.critico && r.estado === 'FALLA').length, 0);
});
