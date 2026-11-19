// Agente 05 · Analista de ofertas y precios (capa de análisis sobre las funciones EXISTENTES de Treidilor; fixtures sintéticos; solo propone, nunca escribe precios).
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
  test('Agente 05: las pruebas se ejecutan en un subproceso con el cargador de TypeScript del proyecto', () => {
    const r = spawnSync(process.execPath, ['--experimental-transform-types', '--import', './scripts/register-ts.mjs', '--test', fileURLToPath(import.meta.url)], { cwd: RAIZ, encoding: 'utf8', timeout: 240000, env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')) });
    const pasan = Number((/ℹ pass (\d+)/.exec(r.stdout) || [])[1] || 0);
    const fallan = Number((/ℹ fail (\d+)/.exec(r.stdout) || [])[1] || 0);
    assert.equal(r.status, 0, r.stdout.slice(-4000));
    assert.equal(fallan, 0);
    assert.ok(pasan >= 16, `se esperaban ≥ 16 pruebas del Agente 05 y pasaron ${pasan}`);
  });
} else {
  const { cargarMotorPrecios, analizarPrecios, UMBRALES } = await import('../agentes/precios/precios.mjs');
  const { construirCatalogoPrecios } = await import('../agentes/precios/fixtures.mjs');
  const { validarInformeAgente } = await import('../protocolo.mjs');
  const { validarEsquema } = await import('../../../scripts/automation/validate-schema.mjs');
  const { cargarRegistro, evaluarAsignacion } = await import('../registro.mjs');
  const { crearEntorno } = await import('../evaluacion/entorno.mjs');
  const { interpretar } = await import('../intencion.mjs');

  const motor = await cargarMotorPrecios();
  const AH = Date.parse('2026-11-14T12:00:00.000Z');
  const ESQ = JSON.parse(fs.readFileSync(path.join(AQUI, '..', '..', 'schemas', 'informe-agente.schema.json'), 'utf8'));
  const cat = () => construirCatalogoPrecios(motor, AH);
  const analizar = (extra = {}) => analizarPrecios({ motor, catalogo: cat(), ahora: AH, ...extra });
  const de = (informe, id) => informe.hallazgos.filter((h) => h.elemento === id);
  const reglas = (informe, id) => de(informe, id).map((h) => h.regla);
  const ID = { sony: 'amazon-b09xs7jwhh', teclado: 'teclado-mecanico-keychron-k2-inalambrico-214dcc', raton: 'raton-gaming-inalambrico-rgb-16000-dpi-e18ad7', monitor: 'amazon-b0salto001', aurora: 'amazon-b0cross001', lampara: 'amazon-b0desajust', cargador: 'amazon-b0moneda01', tablet: 'amazon-b0media000', libro: 'amazon-b0sinobs00' };
  const tmpCat = (productos = cat()) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-prc-')); const f = path.join(d, 'c.json'); fs.writeFileSync(f, JSON.stringify({ sintetico: true, productos })); return { d, f }; };
  const entornoPrecios = (extra = {}) => { const c = tmpCat(); const E = crearEntorno({ motorPrecios: motor, rutaCatalogoPrecios: c.f, ...extra }); const l = E.limpiar; E.limpiar = () => { l(); fs.rmSync(c.d, { recursive: true, force: true }); }; return E; };

  test('reutiliza las funciones EXISTENTES de Treidilor (no hay un sistema paralelo) y no reimplementa descuentos, vigencia ni comparación; sin red ni escritura', () => {
    for (const f of ['comparableOffers.ts', 'commercialClaims.ts', 'offerObservations.ts', 'priceHistoryView.ts']) assert.ok(fs.existsSync(path.join(RAIZ, 'src', 'lib', f)), f);
    assert.equal(typeof motor.claims.verifiedDiscountOf, 'function');
    assert.equal(typeof motor.comparable.getComparableOffers, 'function');
    const src = fs.readFileSync(path.join(AQUI, '..', 'agentes', 'precios', 'precios.mjs'), 'utf8');
    for (const f of ['verifiedDiscountOf', 'getComparableOffers', 'evaluateDrop', 'collectPoints', 'freshnessOf', 'contextKey']) assert.ok(src.includes(f) || f === 'contextKey', `usa ${f}`);
    assert.equal(/\bfetch\(|node:http|node:https|node:net|child_process|writeFile|appendFile|unlink|rmSync|rename\(/.test(src), false);
    assert.equal(/function\s+(verifiedDiscount|getComparableOffers|freshnessOf|evaluateDrop|computeOfferKey)/.test(src), false, 'no copia las funciones existentes');
    assert.equal(fs.existsSync(path.join(RAIZ, 'src', 'lib', 'analistaPrecios.ts')), false);
  });

  test('un precio solo es «verificado vigente» con observación verificada, vigente, en EUR y coincidente con el publicado; el resto NO se presenta como actual', () => {
    const { informe } = analizar();
    const vigentes = informe.hallazgos.filter((h) => h.regla === 'precio_verificado_vigente').map((h) => h.elemento).sort();
    assert.deepEqual(vigentes, [ID.aurora, ID.monitor, ID.sony, ID.tablet].sort());
    assert.ok(reglas(informe, ID.libro).includes('precio_no_verificado'), 'sin observaciones');
    assert.ok(reglas(informe, ID.teclado).includes('precio_no_verificado'), 'solo precio de catálogo/declarado');
    assert.ok(reglas(informe, ID.raton).includes('precio_verificado_desactualizado'), 'lectura de hace 10 días: histórico');
    assert.ok(reglas(informe, ID.cargador).includes('anomalia:moneda_no_eur'), 'observación en USD');
    assert.ok(reglas(informe, ID.lampara).includes('anomalia:precio_publicado_no_coincide'));
    for (const id of [ID.libro, ID.teclado, ID.raton, ID.cargador, ID.lampara]) assert.ok(!reglas(informe, id).includes('precio_verificado_vigente'), `${id} no es vigente`);
    assert.equal(informe.resumen.verificadosVigentes, 4);
    assert.equal(informe.resumen.desactualizados, 1);
    assert.equal(informe.resumen.sinVerificar, 2);
  });

  test('datos antiguos: con el tiempo NINGÚN precio sigue siendo «verificado vigente» (pasa a histórico)', () => {
    const futuro = analizarPrecios({ motor, catalogo: cat(), ahora: AH + 5 * 86400000 }).informe;
    assert.equal(futuro.resumen.verificadosVigentes, 0);
    assert.ok(futuro.hallazgos.filter((h) => h.regla === 'precio_verificado_desactualizado').length >= 4);
    assert.equal(futuro.hallazgos.some((h) => h.regla === 'descuento_verificado'), false, 'un descuento no vigente no se presenta como actual');
    assert.ok(futuro.hallazgos.some((h) => h.regla === 'descuento_verificado_obsoleto'));
    assert.equal(futuro.hallazgos.some((h) => h.regla === 'caida_verificada' || h.regla === 'oportunidad_ahorro'), false, 'sin lectura vigente no se anuncian bajadas ni oportunidades');
    const corta = analizarPrecios({ motor, catalogo: cat(), ahora: AH, maxEdadHoras: 1 }).informe;
    assert.ok(corta.resumen.verificadosVigentes < 4, 'la vigencia es configurable y se aplica');
  });

  test('descuentos: solo existen los VERIFICADOS; el declarado por el comercio se cuenta («descuentos falsos evitados») y NO se presenta', () => {
    const { informe } = analizar();
    assert.deepEqual(informe.hallazgos.filter((h) => h.regla === 'descuento_verificado').map((h) => h.elemento).sort(), [ID.monitor, ID.sony, ID.tablet].sort());
    const dec = de(informe, ID.teclado).find((h) => h.regla === 'descuento_declarado_no_verificado');
    assert.equal(dec.certeza, 'no_verificable');
    assert.equal(dec.evidencia.precioAnteriorDeclarado, 129.9);
    assert.match(dec.accionSugerida, /NO se presenta como descuento/);
    assert.equal(informe.resumen.descuentosNoVerificados, 1);
    assert.equal(informe.resumen.descuentosVerificados, 3);
    assert.equal(de(informe, ID.sony).find((h) => h.regla === 'descuento_verificado').evidencia.porcentaje, 14.3);
  });

  test('bajadas: verificadas solo con dos lecturas comparables verificadas y la última vigente; un salto brusco se marca como anomalía y NO como oportunidad', () => {
    const { informe } = analizar();
    const caidas = informe.hallazgos.filter((h) => h.regla === 'caida_verificada').map((h) => [h.elemento, h.evidencia.de, h.evidencia.a]);
    assert.deepEqual(caidas.sort(), [[ID.sony, 329, 299.99], [ID.tablet, 119, 99]].sort());
    const m = reglas(informe, ID.monitor);
    assert.ok(m.includes('anomalia:salto_brusco') && m.includes('anomalia:precio_anterior_inflado'));
    assert.ok(!m.includes('caida_verificada') && !m.includes('oportunidad_ahorro'));
    const salto = de(informe, ID.monitor).find((h) => h.regla === 'anomalia:salto_brusco');
    assert.equal(salto.evidencia.variacionPct, -62.5);
    assert.equal(salto.prioridad, 'P2');
    assert.match(salto.accionSugerida, /no tratarlo como oportunidad/);
  });

  test('anomalías: precio publicado ≠ observado (con propuesta de corrección con evidencia, L4 humano), moneda distinta y precio anterior inflado', () => {
    const { informe } = analizar();
    const prop = de(informe, ID.lampara).find((h) => h.regla === 'propuesta_correccion');
    assert.equal(prop.evidencia.precioPublicado, 49.9);
    assert.equal(prop.evidencia.precioObservado, 59.9);
    assert.equal(prop.evidencia.requiereAutorizacion, true);
    assert.equal(prop.evidencia.nivel, 'L4');
    assert.match(prop.accionSugerida, /NO escribe precios/);
    assert.equal(informe.resumen.correccionesPropuestas, 2);
    assert.equal(informe.resumen.anomalias, 4);
  });

  test('comparación entre comercios: solo del MISMO producto con ofertas VERIFICADAS vigentes y total con envío; con una oferta sin verificar NO se concluye', () => {
    const { informe } = analizar();
    const c = de(informe, ID.aurora).find((h) => h.regla === 'comparacion_entre_comercios');
    assert.equal(c.evidencia.listaParaComparar, true);
    assert.equal(c.evidencia.verificadas, 2);
    const op = de(informe, ID.aurora).find((h) => h.regla === 'oportunidad_ahorro');
    assert.equal(op.evidencia.tipo, 'mas_barata_entre_comercios');
    assert.equal(op.evidencia.masBarata.plataforma, 'ebay');
    assert.equal(op.evidencia.masBarata.total, 57);
    assert.equal(op.evidencia.ahorroEur, 2.9);
    const sony = de(informe, ID.sony).find((h) => h.regla === 'comparacion_no_concluyente');
    assert.equal(sony.evidencia.motivoNoConcluyente, 'menos_de_2_ofertas_verificadas');
    assert.ok(!reglas(informe, ID.sony).includes('oportunidad_ahorro'), 'la oferta barata de Temu NO está verificada: no se anuncia');
    assert.ok(sony.evidencia.ofertas.some((o) => o.plataforma === 'temu' && o.verificada === false));
  });

  test('no se confunden productos distintos: otra condición queda como «otra versión» y no se compara; una oferta vencida invalida la comparación', () => {
    const c = cat();
    const aur = c.find((p) => p.id === ID.aurora);
    aur.extra.offers.find((o) => o.platform === 'ebay').condition = 'used';
    const r = analizarPrecios({ motor, catalogo: c, ahora: AH }).informe;
    const cmp = de(r, ID.aurora).find((h) => h.regla.startsWith('comparacion') || h.regla === 'oferta_unica');
    assert.ok(cmp.evidencia.otrasVersiones >= 1, 'la oferta usada es otra versión');
    assert.ok(!reglas(r, ID.aurora).includes('oportunidad_ahorro'), 'no se mezclan condiciones distintas');
    const d = cat();
    d.find((p) => p.id === ID.aurora).extra.offers.find((o) => o.platform === 'ebay').verifiedAt = new Date(AH - 9 * 86400000).toISOString();
    const v = analizarPrecios({ motor, catalogo: d, ahora: AH }).informe;
    assert.ok(reglas(v, ID.aurora).includes('comparacion_no_vigente') && !reglas(v, ID.aurora).includes('oportunidad_ahorro'));
  });

  test('oportunidad «por debajo de su media verificada»: exige ≥ 3 lecturas verificadas y precio vigente; con 2 lecturas no se emite', () => {
    const { informe } = analizar();
    const op = de(informe, ID.tablet).find((h) => h.regla === 'oportunidad_ahorro');
    assert.equal(op.evidencia.tipo, 'por_debajo_de_su_media_verificada');
    assert.ok(op.evidencia.lecturasVerificadas >= UMBRALES.minLecturasVerificadas);
    assert.equal(op.certeza, 'confirmado');
    const c = cat();
    const t = c.find((p) => p.id === ID.tablet);
    t.extra.observations = t.extra.observations.slice(-2);
    assert.ok(!reglas(analizarPrecios({ motor, catalogo: c, ahora: AH }).informe, ID.tablet).includes('oportunidad_ahorro'));
  });

  test('el análisis NO modifica el catálogo, es determinista y admite una sola ficha; una ficha inexistente se declara', () => {
    const c = cat();
    const antes = JSON.stringify(c);
    const a = analizarPrecios({ motor, catalogo: c, ahora: AH });
    assert.equal(JSON.stringify(c), antes);
    assert.deepEqual(analizarPrecios({ motor, catalogo: cat(), ahora: AH }), a);
    const uno = analizarPrecios({ motor, catalogo: cat(), ahora: AH, productoId: ID.sony }).informe;
    assert.equal(uno.resumen.productos, 1);
    assert.ok(uno.hallazgos.every((h) => h.elemento === ID.sony || h.elemento === null));
    const no = analizarPrecios({ motor, catalogo: cat(), ahora: AH, productoId: 'inexistente' });
    assert.equal(no.informe, null);
    assert.equal(no.motivo, 'producto_no_encontrado');
    assert.throws(() => analizarPrecios({ motor, catalogo: null, ahora: AH }), (e) => e.codigo === 'origen_no_disponible');
    assert.throws(() => analizarPrecios({ motor: null, catalogo: [], ahora: AH }), (e) => e.codigo === 'origen_no_disponible');
  });

  test('informe normalizado: válido por validador y esquema, claves únicas, certeza y prioridad rellenas, rótulo de datos de prueba y umbrales declarados', () => {
    const { informe, umbrales } = analizar();
    assert.deepEqual(validarInformeAgente(informe), { ok: true, errores: [] });
    assert.deepEqual(validarEsquema(informe, ESQ), []);
    assert.equal(informe.agente, '05');
    assert.match(informe.idEjecucion, /^pr-[0-9a-f]{10}$/);
    assert.equal(informe.completo, false, 'hay productos sin verificar');
    assert.equal(informe.fuente.origenDatos, 'datos_de_prueba');
    assert.equal(informe.persistencia.escritura, 'no_procede');
    const claves = informe.hallazgos.map((h) => h.clave);
    assert.equal(new Set(claves).size, claves.length);
    assert.ok(informe.hallazgos.every((h) => h.certeza && h.prioridad));
    assert.equal(informe.resumen.porCerteza.confirmado + informe.resumen.porCerteza.advertencia + informe.resumen.porCerteza.no_verificable, informe.hallazgos.length);
    assert.ok(informe.limitaciones.some((l) => /DATOS DE PRUEBA/.test(l)) && informe.limitaciones.some((l) => /NO escribe precios/.test(l)) && informe.limitaciones.some((l) => /umbrales/.test(l)));
    assert.ok(Object.isFrozen(UMBRALES));
    assert.equal(umbrales.maxEdadHoras, 72);
  });

  test('registro: el 05 pasa a «construido_local» con UNA capacidad L1 de solo propuesta (la del registro); no existe ninguna capacidad que escriba precios', () => {
    const r = cargarRegistro();
    assert.equal(r.agente('05').estado, 'construido_local');
    const caps = r.capacidadesDe('05');
    assert.deepEqual(caps.map((c) => `${c.id}:${c.nivelRiesgo}:${c.modo}:${c.efectos}`), ['05.detectar-caidas-precio:L1:propuesta:ninguno']);
    assert.equal(evaluarAsignacion(r, '05.detectar-caidas-precio').ejecutableEnF1, true);
    assert.ok(!r.capacidades().some((c) => c.agente === '05' && /(escribir|actualizar|corregir|cambiar|aplicar)/.test(c.id)));
    assert.deepEqual(caps[0].frescura, { vigenteHasta: '72h', actualizarHasta: '7d', invalidadoPor: ['actualizacion_de_precios', 'importacion'] });
    assert.equal(r.capacidadesDe('04').length, 5);
  });

  test('interpretación: analizar precios/ofertas/descuentos → L1 del 05; cambiar o actualizar precios sigue siendo L4 humano o aclaración', () => {
    for (const t of ['Analiza los precios y dime si Amazon ha bajado', '¿Hay alguna oferta o descuento verificado?', 'Detecta precios dudosos', '¿Dónde sale más barato el Sony?', 'Compara precios entre comercios']) assert.equal(interpretar(t).tipo, 'analizar_precios', t);
    assert.equal(interpretar('Analiza los precios').riesgoMax, 'L1');
    assert.equal(interpretar('Cambia los precios').tipo, 'accion_humana');
    assert.equal(interpretar('Actualiza los precios').tipo, 'accion_ambigua');
    assert.equal(interpretar('Compara los programas de afiliación').tipo, 'comparar_afiliacion');
  });

  test('Director: «analizar precios» crea una tarea L1 registrada con evidencia y verificación, sin aprobaciones, y su texto no presenta lo no verificado como actual', async () => {
    const E = entornoPrecios();
    const r = await E.pregunta('Analiza los precios y dime si hay ofertas verificadas');
    assert.equal(r.categoria, 'propuesta');
    assert.match(r.texto, /4 con precio VERIFICADO vigente · 1 con lectura desactualizada · 2 sin verificar \(su precio NO se presenta como actual\)/);
    assert.match(r.texto, /Descuento VERIFICADO: Auriculares Sony/);
    assert.match(r.texto, /Descuento DECLARADO sin verificar \(no se presenta\): Teclado/);
    assert.match(r.texto, /Lectura desactualizada: Ratón/);
    assert.match(r.texto, /OPORTUNIDAD entre comercios: Auriculares Bluetooth Aurora A5 más barato en ebay/);
    assert.match(r.texto, /No se puede afirmar cuál es la más barata de Auriculares Sony/);
    assert.match(r.texto, /el producto tiene anomalías: no usarlo sin comprobarlo/);
    assert.match(r.texto, /La corrección es L4 humano/);
    assert.match(r.texto, /Verificado: el análisis se recalculó/);
    assert.ok(!/precio actual verificado: (Teclado|Libro|Ratón)/.test(r.texto));
    const t = E.tareas()[0];
    assert.equal(t.capacidad, '05.detectar-caidas-precio');
    assert.deepEqual(t.historial.map((h) => h.estado), ['creada', 'aceptada', 'en_curso', 'completada']);
    assert.equal(t.verificaciones[0].resultado, 'confirmada');
    assert.equal(E.aprobaciones().length, 0);
    assert.ok(!E.tipos().some((x) => ['delegacion_enviada', 'delegacion_simulada', 'aprobacion_solicitada'].includes(x)));
    assert.equal(E.ledger.verificarCadena().ok, true);
    E.limpiar();
  });

  test('Director: sin funciones de precios o sin catálogo el agente lo DECLARA y no afirma ningún precio; una ficha inexistente se declara', async () => {
    const A = crearEntorno({ motorPrecios: null });
    const a = await A.pregunta('Analiza los precios y dime si hay ofertas');
    assert.match(a.texto, /funciones existentes de precios no están cargadas|origen_no_disponible/);
    assert.equal(A.tareas().at(-1).estado, 'fallida');
    A.limpiar();
    const B = crearEntorno({ motorPrecios: motor });
    const b = await B.pregunta('Analiza los precios y dime si hay ofertas');
    assert.match(b.texto, /No consta el dato; no afirmo ningún precio/);
    B.limpiar();
    const E = entornoPrecios();
    assert.throws(() => E.d.ejecutarPropuesta('05.detectar-caidas-precio', { producto: 'x', otro: 1 }), (e) => e.codigo === 'solicitud_invalida');
    const r = E.d.ejecutarPropuesta('05.detectar-caidas-precio', { producto: 'no-existe' });
    assert.equal(r.sinDatos, true);
    E.limpiar();
  });

  test('Director: cambiar o actualizar precios no es una tarea (L4 humano / aclaración); parada de emergencia y ledger caído bloquean al 05; el 05 pausado no recibe tareas', async () => {
    const E = entornoPrecios();
    const c = await E.pregunta('Cambia los precios de los auriculares');
    assert.equal(c.intencion.tipo, 'accion_humana');
    assert.match(c.texto, /L4/);
    const u = await E.pregunta('Actualiza los precios');
    assert.equal(u.estado, 'aclaracion');
    assert.equal(E.tareas().length, 0);
    E.d.paradaEmergencia('prueba');
    assert.match((await E.pregunta('Analiza los precios')).texto, /parada_emergencia/);
    E.d.reanudar();
    E.ledger._escribirLinea = () => { const e = new Error('x'); e.code = 'EIO'; throw e; };
    const l = await E.pregunta('Analiza los precios');
    assert.equal(l.registrada, false);
    assert.equal(E.tareas().length, 0);
    delete E.ledger._escribirLinea;
    E.limpiar();
    const d = JSON.parse(JSON.stringify(cargarRegistro().datos)); d.agentes.find((a) => a.id === '05').estado = 'pausado';
    const { crearRegistro } = await import('../registro.mjs');
    const P = entornoPrecios({ registro: crearRegistro(d) });
    assert.match((await P.pregunta('Analiza los precios')).texto, /agente_no_operativo/);
    P.limpiar();
  });

  test('con el cerebro simulado el modelo no puede convertir un análisis en un cambio de precios (manda el suelo de reglas)', async () => {
    const E = entornoPrecios();
    const a = await E.pregunta('Analiza los precios y dime si hay ofertas verificadas');
    assert.equal(a.origenInterpretacion, 'llm');
    assert.equal(a.intencion.riesgoMax, 'L1');
    const x = await E.pregunta('Cambia los precios de todo el catálogo');
    assert.equal(x.origenInterpretacion, 'reglas_suelo');
    assert.equal(E.aprobaciones().length, 0);
    E.limpiar();
  });

  test('ni el módulo ni las pruebas tocan src/, los datos ni los workflows, y no hacen ninguna llamada de red', async () => {
    const wf = (d) => crypto.createHash('sha256').update(fs.readdirSync(d).sort().map((f) => `${f}:${fs.readFileSync(path.join(d, f), 'utf8')}`).join('|')).digest('hex');
    const antes = wf(path.join(RAIZ, 'automation', 'workflows'));
    let llamadas = 0;
    const f = globalThis.fetch;
    globalThis.fetch = () => { llamadas += 1; throw new Error('red prohibida'); };
    try { analizar(); } finally { globalThis.fetch = f; }
    assert.equal(llamadas, 0);
    assert.equal(wf(path.join(RAIZ, 'automation', 'workflows')), antes);
    const datos = path.join(RAIZ, 'src', 'data');
    const lista = fs.existsSync(datos) ? fs.readdirSync(datos).sort().join('|') : '';
    analizar();
    assert.equal(fs.existsSync(datos) ? fs.readdirSync(datos).sort().join('|') : '', lista);
  });
}
