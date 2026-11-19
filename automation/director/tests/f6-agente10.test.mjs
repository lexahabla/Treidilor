// Agente 10 · Analítica y conversión (capa de LECTURA y ANÁLISIS sobre la analítica EXISTENTE; fixtures sintéticos; solo datos agregados, sin datos personales ni escritura).
// Las funciones existentes son TypeScript: sin el cargador del proyecto, este archivo se relanza solo en un subproceso con él.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..', '..');
const conTS = process.execArgv.some((a) => a.includes('transform-types'));

if (!conTS) {
  test('Agente 10: las pruebas se ejecutan en un subproceso con el cargador de TypeScript del proyecto', () => {
    const r = spawnSync(process.execPath, ['--experimental-transform-types', '--import', './scripts/register-ts.mjs', '--test', fileURLToPath(import.meta.url)], { cwd: RAIZ, encoding: 'utf8', timeout: 240000, env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')) });
    const pasan = Number((/ℹ pass (\d+)/.exec(r.stdout) || [])[1] || 0);
    const fallan = Number((/ℹ fail (\d+)/.exec(r.stdout) || [])[1] || 0);
    assert.equal(r.status, 0, r.stdout.slice(-4000));
    assert.equal(fallan, 0);
    assert.ok(pasan >= 17, `se esperaban ≥ 17 pruebas del Agente 10 y pasaron ${pasan}`);
  });
} else {
  const { cargarMotorAnalitica, analizarAnalitica, sanear, senalesParaAgentes, UMBRALES } = await import('../agentes/analitica/analitica.mjs');
  const { construirAnaliticaSintetica } = await import('../agentes/analitica/fixtures.mjs');
  const { cargarMotorPortada, construirFuentes, proponerPortada } = await import('../agentes/portada/portada.mjs');
  const { construirDatosPortada } = await import('../agentes/portada/fixtures.mjs');
  const { validarInformeAgente } = await import('../protocolo.mjs');
  const { validarEsquema } = await import('../../../scripts/automation/validate-schema.mjs');
  const { cargarRegistro, crearRegistro } = await import('../registro.mjs');
  const { crearEntorno } = await import('../evaluacion/entorno.mjs');
  const { interpretar, RIESGO_POR_TIPO } = await import('../intencion.mjs');

  const motor = await cargarMotorAnalitica();
  const ESQ = JSON.parse(fs.readFileSync(path.join(AQUI, '..', '..', 'schemas', 'informe-agente.schema.json'), 'utf8'));
  const sint = (o) => construirAnaliticaSintetica(o);
  const analizar = (o = {}, extra = {}) => { const d = sint(o); return analizarAnalitica({ motor, datos: d, ahora: d.ahora, ...extra }); };
  const de = (informe, regla) => informe.hallazgos.filter((h) => h.regla === regla);
  const reglas = (informe) => informe.hallazgos.map((h) => h.regla);
  const tmp = (datos) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-ana-')); const f = path.join(dir, 'a.json'); fs.writeFileSync(f, JSON.stringify(datos)); return { dir, f }; };
  const entorno = (extra = {}) => { const c = tmp(extra.datos ?? sint()); const E = crearEntorno({ motorAnalitica: motor, rutaAnalitica: c.f, ...extra }); const l = E.limpiar; E.limpiar = () => { l(); fs.rmSync(c.dir, { recursive: true, force: true }); }; return E; };
  const hashWorkflows = () => { const d = path.join(RAIZ, 'automation', 'workflows'); return crypto.createHash('sha256').update(fs.readdirSync(d).sort().map((f) => `${f}:${fs.readFileSync(path.join(d, f), 'utf8')}`).join('|')).digest('hex'); };
  const PERSONALES = ['sesion-ficticia', 'visitante-ficticio', '203.0.113.7', 'NavegadorFicticio', 'search?q=privado'];

  test('reutiliza la analítica EXISTENTE (no hay sistema paralelo ni nuevo seguimiento) y no reimplementa sus cálculos; el módulo no escribe ni usa la red', () => {
    assert.ok(fs.existsSync(path.join(RAIZ, 'src', 'lib', 'analyticsMonths.ts')));
    for (const f of ['computeMetricas', 'computeFuentes', 'computeTopProductos', 'computeTopReferrers']) assert.equal(typeof motor.months[f], 'function', f);
    const src = fs.readFileSync(path.join(AQUI, '..', 'agentes', 'analitica', 'analitica.mjs'), 'utf8');
    for (const f of ['computeMetricas', 'computeFuentes', 'computeTopProductos', 'computeTopReferrers']) assert.ok(src.includes(f), `usa ${f}`);
    assert.equal(/\bfetch\(|node:http|node:https|node:net|child_process|writeFile|appendFile|unlink|rmSync|rename\(|trackEvent|sendBeacon/.test(src), false);
    assert.equal(/function\s+(computeMetricas|computeFuentes|computeTopProductos|clasificarFuente|computeEvolucion)/.test(src), false, 'no copia las funciones existentes');
    assert.equal(fs.existsSync(path.join(RAIZ, 'src', 'lib', 'analiticaAgente.ts')), false);
  });

  test('los números salen de las funciones existentes aplicadas a ventanas comparables (7 días frente a los 7 anteriores), no de cálculos propios', () => {
    const d = sint();
    const { informe } = analizarAnalitica({ motor, datos: d, ahora: d.ahora });
    const { eventos } = sanear(d.events);
    const ancla = Date.parse('2026-11-15T00:00:00Z');
    const act = eventos.filter((e) => Date.parse(e.createdAt) >= ancla - 7 * 86400000 && Date.parse(e.createdAt) < ancla);
    const ant = eventos.filter((e) => Date.parse(e.createdAt) >= ancla - 14 * 86400000 && Date.parse(e.createdAt) < ancla - 7 * 86400000);
    assert.equal(informe.resumen.sesionesActual, motor.months.computeMetricas(act).sesiones);
    assert.equal(informe.resumen.sesionesAnterior, motor.months.computeMetricas(ant).sesiones);
    assert.equal(informe.resumen.sesionesActual, 210);
    assert.equal(informe.resumen.sesionesAnterior, 126);
    assert.equal(informe.resumen.tasaClicSalidaActualPct, motor.months.computeMetricas(act.filter((e) => e.type !== 'purchase')).conversionPct);
    const t = de(informe, 'tendencia_sesiones_al_alza')[0];
    assert.equal(t.evidencia.variacionPct, 66.7);
    assert.match(t.evidencia.nota, /no establece su causa/);
    assert.equal(de(informe, 'tendencia_clic_salida_estable').length, 1);
  });

  test('informe-agente/1 válido; rotula los datos de prueba; con datos reales NO aparece ese rótulo y el origen es «exportacion»', () => {
    const { informe } = analizar();
    const v = validarInformeAgente(informe);
    assert.equal(v.ok, true, JSON.stringify(v.errores || v));
    assert.deepEqual(validarEsquema(ESQ, informe), []);
    assert.equal(informe.agente, '10');
    assert.equal(informe.fuente.origenDatos, 'datos_de_prueba');
    assert.ok(informe.limitaciones[0].startsWith('DATOS DE PRUEBA'));
    assert.equal(de(informe, 'origen_de_los_datos')[0].evidencia.clasificacion, 'datos_de_prueba');
    assert.equal(informe.persistencia.escritura, 'no_procede');
    const real = analizar({}, { sintetico: false }).informe;
    assert.equal(real.fuente.origenDatos, 'exportacion');
    assert.equal(real.limitaciones.some((x) => /DATOS DE PRUEBA/.test(x)), false);
    assert.equal(de(real, 'origen_de_los_datos')[0].evidencia.clasificacion, 'real');
  });

  test('cada cifra se rotula como medida, derivada, estimada o declarada; las métricas que no existen se declaran «no disponibles» y NO se calculan', () => {
    const { informe } = analizar();
    const tipo = (k) => informe.hallazgos.find((h) => h.clave === `metrica:${k}`).evidencia.tipoDato;
    assert.equal(tipo('sesiones'), 'medido');
    assert.equal(tipo('salidas_a_tienda'), 'medido');
    assert.equal(tipo('tasa_clic_salida_por_sesion_pct'), 'derivado');
    assert.equal(tipo('visitantes_estimados'), 'estimacion');
    assert.equal(tipo('compras_declaradas'), 'declarado');
    assert.match(informe.hallazgos.find((h) => h.clave === 'metrica:compras_declaradas').evidencia.nota, /sin confirmación de la red/);
    const nd = de(informe, 'metricas_no_disponibles')[0].evidencia.metricas.map((x) => x.metrica);
    for (const k of ['ventas_reales_verificadas', 'ingresos_y_comisiones', 'tasa_de_conversion_a_venta', 'coste_de_adquisicion_y_retorno', 'tasa_de_clic_por_fuente_o_dispositivo']) assert.ok(nd.includes(k), k);
    assert.equal(informe.hallazgos.some((h) => /ingreso|comision|venta/.test(h.clave) && h.regla === 'metrica'), false, 'no inventa ingresos ni ventas');
    assert.match(informe.limitaciones.join(' '), /una venta real no consta/);
  });

  test('privacidad: el informe no contiene identificadores de sesión o visitante, IP, agente de usuario ni parámetros del referente; del referente solo queda el dominio', () => {
    const d = sint();
    assert.ok(d.events.some((e) => e.ip) && d.events.some((e) => e.sessionId), 'los datos de entrada sí traen campos personales ficticios');
    const { informe } = analizarAnalitica({ motor, datos: d, ahora: d.ahora });
    const txt = JSON.stringify(informe);
    for (const p of PERSONALES) assert.equal(txt.includes(p), false, `no debe aparecer «${p}»`);
    assert.ok(informe.hallazgos.find((h) => h.regla === 'fuentes_de_trafico').evidencia.dominios.some((x) => x.host === 'google.com'));
    const { eventos } = sanear(d.events);
    assert.equal(eventos.some((e) => 'ip' in e || 'userAgent' in e || 'path' in e), false);
    assert.ok(eventos.every((e) => !e.referrer || /^https:\/\/[^/?]+\/$/.test(e.referrer)));
  });

  test('muestra insuficiente: NO se calcula ninguna tasa ni tendencia ni se señala ningún producto; se dice expresamente y el informe queda incompleto', () => {
    const { informe } = analizar({ sesionesAct: 3 });
    assert.equal(informe.completo, false);
    assert.equal(informe.resumen.estadoCalidad, 'datos_insuficientes');
    assert.equal(informe.resumen.tasaClicSalidaActualPct, null);
    const r = reglas(informe);
    assert.ok(r.includes('datos_insuficientes'));
    for (const x of ['tendencia_sesiones_al_alza', 'tendencia_sesiones_a_la_baja', 'tendencia_sesiones_estable', 'producto_alto_trafico_baja_salida', 'producto_alta_salida_poco_trafico', 'experimento_propuesto', 'fuentes_de_trafico']) assert.equal(r.includes(x), false, x);
    assert.equal(informe.hallazgos.some((h) => h.regla === 'metrica'), false);
    assert.ok(informe.limitaciones.some((x) => /Muestra insuficiente/.test(x)));
    const ev = de(informe, 'datos_insuficientes').find((h) => h.elemento === 'ventana_actual').evidencia;
    assert.equal(ev.sesiones, 21);
    assert.equal(ev.minimo, UMBRALES.minSesiones);
  });

  test('con la ventana anterior insuficiente hay métricas actuales pero NO comparación ni tendencia', () => {
    const { informe } = analizar({ sesionesAnt: 3 });
    assert.ok(informe.hallazgos.some((h) => h.clave === 'metrica:sesiones'));
    assert.ok(de(informe, 'datos_insuficientes').some((h) => h.elemento === 'tendencias'));
    assert.equal(reglas(informe).some((x) => x.startsWith('tendencia_')), false);
    assert.equal(informe.resumen.tasaClicSalidaAnteriorPct, null);
    assert.equal(informe.completo, false);
  });

  test('productos: señala alto tráfico con poca salida y alta salida con poco tráfico solo con visitas suficientes; las hipótesis no afirman causas y los experimentos son PROPUESTAS no ejecutables', () => {
    const { informe } = analizar();
    const bajo = de(informe, 'producto_alto_trafico_baja_salida');
    const alto = de(informe, 'producto_alta_salida_poco_trafico');
    assert.deepEqual(bajo.map((h) => h.elemento), ['p-portatil']);
    assert.deepEqual(alto.map((h) => h.elemento), ['p-raton']);
    assert.ok(bajo[0].evidencia.tasaSalidaPct < bajo[0].evidencia.tasaGlobalSalidaPct / 2);
    assert.ok(alto[0].evidencia.tasaSalidaPct > bajo[0].evidencia.tasaGlobalSalidaPct * 1.5);
    assert.match(bajo[0].accionSugerida, /causa NO está establecida/i);
    for (const x of [...bajo, ...alto]) assert.ok(x.evidencia.visitas >= UMBRALES.minVisitasProducto);
    const ex = de(informe, 'experimento_propuesto');
    assert.deepEqual(ex.map((h) => h.elemento).sort(), ['p-portatil', 'p-raton']);
    for (const x of ex) {
      assert.equal(x.evidencia.ejecutable, false);
      assert.equal(x.evidencia.requiereAprobacion, true);
      assert.match(x.evidencia.efectoEsperado, /no estimado/);
      assert.match(x.accionSugerida, /la aprueba y la ejecuta una persona/);
      assert.ok(x.evidencia.lineaBase.visitas >= UMBRALES.minVisitasProducto);
    }
    assert.equal(informe.resumen.experimentosPropuestos, 2);
    assert.equal(informe.resumen.oportunidadesOptimizacion, 2);
    const poco = analizar({}, { umbrales: { minVisitasProducto: 80 } }).informe;
    assert.equal(reglas(poco).includes('experimento_propuesto'), false);
    assert.ok(de(poco, 'datos_insuficientes').some((h) => h.elemento === 'productos'));
  });

  test('datos no actuales, ventana recortada, días sin datos y tráfico concentrado se declaran (y los días vacíos NO se interpretan como caída)', () => {
    const viejo = analizar({ antiguedadDias: 10 }).informe;
    assert.ok(reglas(viejo).includes('datos_no_actuales'));
    assert.equal(viejo.completo, false);
    assert.ok(viejo.limitaciones.some((x) => /día\(s\) de antigüedad/.test(x)));
    const tope = analizar({}, { umbrales: { maxEventosAlmacen: 800 } }).informe;
    assert.equal(de(tope, 'ventana_recortada')[0].evidencia.tope, 800);
    assert.equal(tope.completo, false);
    const hueco = analizar({ huecoDia: '2026-11-10' }).informe;
    const dsd = de(hueco, 'dias_sin_datos')[0];
    assert.deepEqual(dsd.evidencia.dias, ['2026-11-10']);
    assert.match(dsd.accionSugerida, /no se interpreta como caída/);
    const conc = analizar({ concentrado: true }).informe;
    assert.equal(de(conc, 'trafico_concentrado')[0].evidencia.fuente, 'organico');
    assert.equal(reglas(analizar().informe).includes('trafico_concentrado'), false);
  });

  test('entradas inválidas: se descartan y se cuentan (sin inventar nada); sin eventos válidos no hay informe', () => {
    const d = sint();
    const sucio = { ...d, events: [...d.events, null, 'texto', { type: 'tipo_raro', createdAt: '2026-11-14T10:00:00Z' }, { type: 'page_view', createdAt: 'no-es-fecha' }] };
    const { informe } = analizarAnalitica({ motor, datos: sucio, ahora: d.ahora });
    assert.equal(informe.resumen.eventosDescartados, 4);
    assert.equal(informe.resumen.eventos, d.events.length);
    const vacio = analizarAnalitica({ motor, datos: { events: [null, { type: 'x' }] }, ahora: d.ahora });
    assert.equal(vacio.informe, null);
    assert.equal(vacio.motivo, 'sin_eventos');
  });

  test('determinista y de solo lectura: misma entrada → mismo informe; los datos de entrada no se modifican; un cambio en los datos cambia la huella', () => {
    const d = sint();
    const antes = JSON.stringify(d);
    const a = analizarAnalitica({ motor, datos: d, ahora: d.ahora }).informe;
    const b = analizarAnalitica({ motor, datos: d, ahora: d.ahora }).informe;
    assert.deepEqual(a, b);
    assert.equal(JSON.stringify(d), antes);
    const d2 = sint({ sesionesAct: 40 });
    assert.notEqual(analizarAnalitica({ motor, datos: d2, ahora: d2.ahora }).informe.fuente.firma, a.fuente.firma);
  });

  test('estructura para otros agentes: las señales solo llevan ids de producto y la naturaleza de los datos (sin cifras de tráfico ni datos personales) y el 06 las recibe sin cambiar su propuesta', async () => {
    const { informe } = analizar();
    const s = senalesParaAgentes(informe);
    assert.deepEqual(s.altaSalidaPocoTrafico, ['p-raton']);
    assert.deepEqual(s.altoTraficoBajaSalida, ['p-portatil']);
    assert.equal(s.origenDatos, 'datos_de_prueba');
    assert.deepEqual(Object.keys(s).sort(), ['agente', 'altaSalidaPocoTrafico', 'altoTraficoBajaSalida', 'completo', 'generadoEn', 'huella', 'idEjecucion', 'origenDatos']);
    assert.equal(senalesParaAgentes({ agente: '05' }), null);
    const mp = await cargarMotorPortada();
    const dp = construirDatosPortada(Date.parse('2026-11-14T12:00:00Z'));
    const f = construirFuentes(mp, dp);
    const base = proponerPortada({ motor: mp, fuentes: f, productosBrutos: dp.productos, ahora: Date.parse('2026-11-14T12:00:00Z') });
    const con = proponerPortada({ motor: mp, fuentes: f, productosBrutos: dp.productos, ahora: Date.parse('2026-11-14T12:00:00Z'), informes: [informe] });
    assert.deepEqual(con.propuesta, base.propuesta, 'el informe del 10 aún no cambia la propuesta del 06');
    assert.ok(con.informe.limitaciones.some((x) => /Agente 10/.test(x) && /no se integra/.test(x)));
  });

  test('Director L0: «Analiza el tráfico y la conversión» crea una tarea verificada con la capacidad del registro, sin aprobación, y no deja datos personales en el ledger', async () => {
    const E = entorno();
    const wf = hashWorkflows();
    const r = await E.pregunta('Analiza el tráfico y la conversión de esta semana');
    assert.equal(r.categoria, 'consulta');
    assert.match(r.texto, /sin datos personales, no modifico nada/);
    assert.match(r.texto, /DATOS DE PRUEBA/);
    assert.match(r.texto, /NO disponible: ventas reales verificadas/);
    assert.match(r.texto, /EXPERIMENTO PROPUESTO \(lo aprueba y ejecuta una persona/);
    assert.match(r.texto, /Verificado/);
    assert.equal(r.aprobaciones.length, 0);
    assert.equal(E.tareas()[0].capacidad, '10.leer-analitica-agregada');
    assert.deepEqual(E.tareas()[0].historial.map((h) => h.estado), ['creada', 'aceptada', 'en_curso', 'completada']);
    assert.ok(E.d.senalesAnalitica().altoTraficoBajaSalida.includes('p-portatil'));
    const ledgerTxt = fs.readdirSync(E.ledgerDir).filter((f) => fs.statSync(path.join(E.ledgerDir, f)).isFile()).map((f) => fs.readFileSync(path.join(E.ledgerDir, f), 'utf8')).join('\n');
    for (const p of PERSONALES) assert.equal(ledgerTxt.includes(p), false, `el ledger no debe contener «${p}»`);
    assert.equal(E.ledger.verificarCadena().ok, true);
    assert.equal(hashWorkflows(), wf);
    E.limpiar();
  });

  test('Director: con muestra insuficiente lo dice y no cita ninguna tasa; sin exportación, sin funciones o con datos vacíos declara que no consta nada', async () => {
    const E = entorno({ datos: sint({ sesionesAct: 3, sesionesAnt: 3 }) });
    const r = await E.pregunta('Cómo van las visitas y los clics');
    assert.match(r.texto, /SIN CONCLUSIÓN/);
    assert.doesNotMatch(r.texto, /tasa de clic a salida \d/);
    E.limpiar();
    const A = crearEntorno({ motorAnalitica: motor, rutaAnalitica: null });
    const ra = await A.pregunta('Analiza el tráfico');
    assert.equal(A.tareas().at(-1).estado, 'fallida');
    assert.match(ra.texto, /No consta ninguna cifra|origen_no_disponible/);
    A.limpiar();
    const B = crearEntorno({ motorAnalitica: null });
    assert.match((await B.pregunta('Analiza el tráfico')).texto, /origen_no_disponible/);
    B.limpiar();
    const V = entorno({ datos: { sintetico: true, events: [] } });
    const rv = await V.pregunta('Analiza la analítica');
    assert.equal(rv.estado, 'sin_datos');
    assert.match(rv.texto, /No afirmo ninguna cifra/);
    V.limpiar();
  });

  test('cambiar, vaciar o borrar la analítica y publicar sus resultados son L4 humano: el agente solo LEE; el registro le da una única capacidad L0 con analytics:read', async () => {
    const reg = cargarRegistro();
    const caps = reg.capacidadesDe('10');
    assert.deepEqual(caps.map((c) => [c.id, c.nivelRiesgo, c.disponibilidad, c.alcances.join(',')]), [['10.leer-analitica-agregada', 'L0', 'lectura_f1', 'analytics:read']]);
    assert.equal(reg.agente('10').estado, 'construido_local');
    assert.equal(RIESGO_POR_TIPO.analizar_analitica, 'L0');
    const E = entorno();
    for (const t of ['Borra la analítica', 'Reinicia y elimina las estadísticas de visitas', 'Publica el informe de tráfico', 'Activa el seguimiento de clics']) {
      const r = await E.pregunta(t);
      assert.equal(r.categoria, 'consulta', t);
      assert.notEqual(r.intencion.tipo, 'analizar_analitica', t);
    }
    assert.equal(E.tareas().length, 0);
    assert.equal(interpretar('Analiza la conversión').tipo, 'analizar_analitica');
    assert.equal(interpretar('Analiza los precios').tipo, 'analizar_precios');
    E.limpiar();
  });

  test('parada de emergencia, ledger caído y agente no operativo: no se crea ninguna tarea ni se lee la analítica', async () => {
    const E = entorno();
    E.d.paradaEmergencia('prueba');
    assert.match((await E.pregunta('Analiza el tráfico y la conversión')).texto, /parada_emergencia/);
    E.d.reanudar();
    E.ledger._escribirLinea = () => { const e = new Error('x'); e.code = 'EIO'; throw e; };
    const r = await E.pregunta('Analiza el tráfico y la conversión');
    assert.equal(r.registrada, false);
    assert.doesNotMatch(r.texto, /tasa de clic a salida \d/);
    delete E.ledger._escribirLinea;
    E.limpiar();
    const d = JSON.parse(JSON.stringify(cargarRegistro().datos));
    d.agentes.find((a) => a.id === '10').estado = 'planificado';
    for (const c of d.capacidades) if (c.agente === '10') { c.disponibilidad = 'planificada'; c.motivoNoDisponible = 'planificado'; }
    const F = entorno({ registro: crearRegistro(d) });
    const n = await F.pregunta('Analiza el tráfico y la conversión');
    assert.match(n.texto, /agente_no_operativo|no está operativo|planificado/);
    assert.equal(F.tareas().filter((t) => t.estado === 'completada').length, 0);
    F.limpiar();
  });

  test('no se toca src/, workflows ni datos reales de analítica tras todo el flujo', async () => {
    const wf = hashWorkflows();
    const reales = ['analytics.json', 'analytics-months.json', 'analytics-ignored-ips.json', 'sales-ledger.json'].map((f) => path.join(RAIZ, 'src', 'data', f));
    const antes = reales.map((f) => (fs.existsSync(f) ? `${fs.statSync(f).mtimeMs}:${fs.statSync(f).size}` : null));
    const E = entorno();
    await E.pregunta('Analiza el tráfico y la conversión');
    await E.pregunta('Cómo van las visitas');
    assert.deepEqual(reales.map((f) => (fs.existsSync(f) ? `${fs.statSync(f).mtimeMs}:${fs.statSync(f).size}` : null)), antes);
    assert.equal(hashWorkflows(), wf);
    E.limpiar();
  });
}
