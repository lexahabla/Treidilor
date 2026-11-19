// Agente 09 · Competencia y expertos: COMPONENTES PUROS (sin capacidades aprobadas, sin integrar en el registro); observaciones SINTÉTICAS aportadas por parámetro; sin web, sin scraping, sin gasto.
// Las funciones existentes son TypeScript: sin el cargador del proyecto, este archivo se relanza solo en un subproceso con él.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..', '..');
const conTS = process.execArgv.some((a) => a.includes('transform-types'));

if (!conTS) {
  test('Agente 09: las pruebas se ejecutan en un subproceso con el cargador de TypeScript del proyecto', () => {
    const r = spawnSync(process.execPath, ['--experimental-transform-types', '--import', './scripts/register-ts.mjs', '--test', fileURLToPath(import.meta.url)], { cwd: RAIZ, encoding: 'utf8', timeout: 240000, env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')) });
    const pasan = Number((/ℹ pass (\d+)/.exec(r.stdout) || [])[1] || 0);
    const fallan = Number((/ℹ fail (\d+)/.exec(r.stdout) || [])[1] || 0);
    assert.equal(r.status, 0, r.stdout.slice(-4000));
    assert.equal(fallan, 0);
    assert.ok(pasan >= 15, `se esperaban ≥ 15 pruebas del Agente 09 y pasaron ${pasan}`);
  });
} else {
  const { cargarMotorCompetencia, informeCompetencia, validarObservaciones, UMBRALES } = await import('../agentes/competencia/competencia.mjs');
  const { construirDatosCompetencia, AHORA_MK } = await import('../agentes/competencia/fixtures.mjs');
  const { cargarMotorMarketing } = await import('../agentes/marketing/marketing.mjs');
  const { construirFuentesMarketing, informe10Fx } = await import('../agentes/marketing/fixtures.mjs');
  const { validarInformeAgente, canonico, sha256 } = await import('../protocolo.mjs');
  const { validarEsquema } = await import('../../../scripts/automation/validate-schema.mjs');
  const { cargarRegistro } = await import('../registro.mjs');
  const { crearEntorno } = await import('../evaluacion/entorno.mjs');

  const motor = await cargarMotorCompetencia();
  const mkt = await cargarMotorMarketing();
  const ESQ = JSON.parse(fs.readFileSync(path.join(AQUI, '..', '..', 'schemas', 'informe-agente.schema.json'), 'utf8'));
  const propias = () => construirFuentesMarketing(mkt, AHORA_MK);
  const informe = (extra = {}) => informeCompetencia({ motor, datos: construirDatosCompetencia(), fuentes: propias(), ahora: AHORA_MK, ...extra });
  const de = (inf, regla) => inf.hallazgos.filter((x) => x.regla === regla);
  const hashWorkflows = () => { const d = path.join(RAIZ, 'automation', 'workflows'); return crypto.createHash('sha256').update(fs.readdirSync(d).sort().map((f) => `${f}:${fs.readFileSync(path.join(d, f), 'utf8')}`).join('|')).digest('hex'); };

  test('reutiliza lo EXISTENTE (vigencia, fecha de captura, URL segura, credenciales y órdenes en datos) y no duplica a los Agentes 02, 05 ni 10; el módulo no usa red, scraping ni escritura', () => {
    for (const f of ['offerObservations.ts', 'commercialClaims.ts']) assert.ok(fs.existsSync(path.join(RAIZ, 'src', 'lib', f)), f);
    assert.equal(typeof motor.obs.freshnessOf, 'function');
    assert.equal(typeof motor.claims.captureDateOf, 'function');
    assert.equal(typeof motor.seguridad.isPublicSafeExternalUrl, 'function');
    const src = fs.readFileSync(path.join(AQUI, '..', 'agentes', 'competencia', 'competencia.mjs'), 'utf8');
    for (const f of ['freshnessOf', 'captureDateOf', 'isPublicSafeExternalUrl', 'detectarSecreto', 'detectarInstruccionesEnDatos']) assert.ok(src.includes(f), `usa ${f}`);
    assert.equal(/\bfetch\(|node:http|node:https|node:net|node:dns|node:fs|child_process|writeFile|appendFile|unlink|rmSync|rename\(|puppeteer|playwright|cheerio|axios|XMLHttpRequest/.test(src), false);
    assert.equal(/agentes\/(precios|afiliacion|analitica)|comparableOffers|priceHistory|analyticsMonths/.test(src), false, 'no reimplementa ni importa a los agentes 02, 05 y 10');
    assert.equal(/function\s+(freshnessOf|captureDateOf|isPublicSafeExternalUrl|detectarSecreto)/.test(src), false, 'no copia las funciones existentes');
  });

  test('validación: cada fuente exige cita https segura, fecha, observador y términos revisados; lo inválido se rechaza con su motivo y NUNCA se repite la credencial ni el extracto en el informe', () => {
    const v = validarObservaciones({ motor, datos: construirDatosCompetencia(), ahora: AHORA_MK });
    assert.equal(v.fuentes.length, 6);
    assert.deepEqual(v.fuentes.filter((f) => f.utilizable).map((f) => f.id), ['f-comp-a', 'f-comp-b', 'f-exp-e', 'f-comp-f']);
    const motivo = (id) => v.rechazos.find((r) => r.id === id)?.motivo ?? '';
    assert.match(motivo('o-a5'), /extracto_largo/);
    assert.match(motivo('o-b3'), /estimacion_sin_metodo/);
    assert.match(motivo('o-f2'), /forma_de_credencial/);
    assert.match(motivo('o-f3'), /cita_literal_larga/);
    assert.match(motivo('f-mala'), /cita_url_no_segura_o_ausente/);
    const txt = JSON.stringify(informe().informe);
    assert.equal(txt.includes('sk-ant-api03'), false);
    assert.equal(txt.includes('cita literal de otra web'), false);
    assert.equal(txt.includes('xxxxxxxxxx'), false);
    assert.equal(validarObservaciones({ motor, datos: { fuentes: [{ id: 'z', nombre: 'Z', tipo: 'competidor', url: 'https://z.example.com/', observadaEn: '2027-01-01', observadoPor: 'p', terminos: { revisados: true, permiteCitar: true }, observaciones: [] }] }, ahora: AHORA_MK }).rechazos[0].motivo, 'fecha_de_observacion_ausente_o_futura');
  });

  test('cuatro clases de evidencia: un hecho es «verificado» solo con comprobación humana fechada; sin ella se degrada a observación; la estimación exige método; lo no disponible no se rellena', () => {
    const { informe: inf } = informe();
    const R = inf.resumen;
    assert.equal(R.hechosVerificados, 1);
    assert.equal(de(inf, 'hecho_verificado')[0].elemento, 'o-a1');
    assert.deepEqual(de(inf, 'hecho_verificado')[0].evidencia.verificacion, { verificadoPor: 'persona', verificadoEn: '2026-11-13' });
    const deg = de(inf, 'observacion_degradada')[0];
    assert.equal(deg.elemento, 'o-a4');
    assert.equal(deg.evidencia.claseDeclarada, 'hecho_verificado');
    assert.equal(deg.evidencia.claseEfectiva, 'observacion');
    assert.equal(R.estimaciones, 0, 'la única estimación no tenía método y se rechazó');
    assert.equal(R.noDisponibles, 1);
    assert.equal(de(inf, 'dato_no_disponible_en_fuente')[0].evidencia.texto, null);
    assert.equal(R.observacionesNoVerificadas, 11);
    const conMetodo = construirDatosCompetencia();
    conMetodo.fuentes[1].observaciones.find((o) => o.id === 'o-b3').metodo = 'extrapolación de visitas publicadas por la propia web';
    assert.equal(informe({ datos: conMetodo }).informe.resumen.estimaciones, 1);
  });

  test('términos de uso y caducidad: una fuente con términos sin revisar o caducada NO entra en ninguna conclusión; se declara por qué y qué debe hacer una persona', () => {
    const { informe: inf } = informe();
    assert.equal(de(inf, 'terminos_de_uso_pendientes')[0].elemento, 'f-exp-c');
    assert.match(de(inf, 'terminos_de_uso_pendientes')[0].accionSugerida, /Una persona debe revisar los términos de uso/);
    assert.equal(de(inf, 'fuente_caducada')[0].elemento, 'f-medio-d');
    const c1 = inf.hallazgos.find((x) => x.clave === 'obs:o-c1');
    assert.equal(c1.evidencia.utilizableParaConclusiones, false);
    assert.deepEqual(c1.evidencia.motivosExclusion, ['terminos_de_uso_sin_revisar_o_sin_permiso_de_cita']);
    const d1 = inf.hallazgos.find((x) => x.clave === 'obs:o-d1');
    assert.deepEqual(d1.evidencia.motivosExclusion, ['fuente_caducada']);
    assert.equal(inf.resumen.fuentesUtilizables, 4);
    assert.equal(inf.resumen.observacionesExcluidas, 3);
  });

  test('huecos: solo con ≥ 2 fuentes utilizables distintas y que no cubramos; con una sola es «señal débil»; lo ya cubierto no es un hueco; es una hipótesis con su evidencia y sin promesas', () => {
    const { informe: inf } = informe();
    const h1 = de(inf, 'hueco_detectado');
    assert.deepEqual(h1.map((x) => x.elemento), ['guia-portatiles-por-presupuesto']);
    const ev = h1[0].evidencia;
    assert.equal(ev.nFuentes, 2);
    assert.deepEqual(ev.fuentes.map((x) => x.fuente), ['Competidor Ficticio A', 'Competidor Ficticio B']);
    assert.ok(ev.fuentes.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.observadaEn)));
    assert.equal(ev.categoria, 'informatica');
    assert.ok(ev.productosPropiosEnLaCategoria > 0);
    assert.equal(ev.explotable, 'hay_productos_propios_en_la_categoria');
    assert.match(h1[0].evidencia.hipotesis, /no consta que lo cubramos/);
    assert.match(h1[0].accionSugerida, /Hipótesis de oportunidad editorial: validar con una persona/);
    assert.deepEqual(de(inf, 'hueco_senal_debil').map((x) => x.elemento).sort(), ['comparativa-auriculares-cancelacion-ruido', 'video-resenas-cortas']);
    assert.deepEqual(de(inf, 'tema_ya_cubierto').map((x) => x.elemento).sort(), ['guia-ofertas-black-friday', 'tabla-comparativa-con-fecha']);
    assert.equal(inf.resumen.huecos, 1);
    assert.equal(inf.resumen.huecosSenalDebil, 2);
    const ya = construirDatosCompetencia(); ya.nuestraCobertura.push('guia-portatiles-por-presupuesto');
    assert.equal(informe({ datos: ya }).informe.resumen.huecos, 0);
    const con10 = informe({ informes: [informe10Fx({ potencial: ['aud-altavoz'], revisar: ['inf-portatil'] })] }).informe;
    assert.deepEqual(de(con10, 'hueco_detectado')[0].evidencia.contextoPropio.sort(), ['aud-altavoz', 'inf-portatil']);
  });

  test('precios observados: solo se compara con equivalencia verificada por una persona, EUR, «nuevo», observación reciente y NUESTRO precio con fecha; el resultado es un dato fechado, no una ventaja', () => {
    const { informe: inf } = informe();
    const b = de(inf, 'brecha_de_precio_observada');
    assert.equal(b.length, 1);
    assert.equal(b[0].elemento, 'o-a1');
    const e = b[0].evidencia;
    assert.equal(e.producto, 'inf-portatil');
    assert.equal(e.nuestroPrecio, 799);
    assert.equal(e.precioObservado, 829);
    assert.equal(e.diferenciaEur, -30);
    assert.equal(e.diferenciaPct, -3.6);
    assert.equal(e.sentido, 'nuestro_precio_menor');
    assert.equal(e.claseDeObservacion, 'hecho_verificado');
    assert.match(e.texto, /Según Competidor Ficticio A \(2026-11-12\), 829,00 €; nuestra ficha 799,00 € \(captura 2026-11-15\)/);
    assert.match(e.nota, /no incluye envío, garantía ni condiciones/);
    assert.match(b[0].accionSugerida, /no es una conclusión sobre ventaja comercial ni una orden de cambiar precios \(L4 humano\)/);
    assert.doesNotMatch(JSON.stringify(inf), /ventaja competitiva|somos más baratos|mejor precio/i);
    const nc = Object.fromEntries(de(inf, 'precio_no_comparable').map((x) => [x.elemento, x.evidencia.razones]));
    assert.deepEqual(nc['o-b1'], ['observacion_de_hace_mas_de_14_dias']);
    assert.deepEqual(nc['o-b4'].sort(), ['condicion_no_es_nuevo', 'observacion_de_hace_mas_de_14_dias']);
    assert.equal(inf.resumen.brechasPrecio, 1);
    assert.equal(inf.resumen.preciosNoComparables, 2);
  });

  test('cada requisito de comparabilidad se aplica por separado: sin equivalencia verificada, en otra moneda, con nuestro precio sin fecha, con ficha inexistente o con la observación antigua NO se compara', () => {
    const caso = (mut, fuentes = propias(), ahora = AHORA_MK) => { const d = construirDatosCompetencia(); mut(d.fuentes[0].observaciones.find((o) => o.id === 'o-a1')); const r = informeCompetencia({ motor, datos: d, fuentes, ahora }).informe; return de(r, 'precio_no_comparable').find((x) => x.elemento === 'o-a1')?.evidencia.razones ?? null; };
    assert.deepEqual(caso((o) => { o.precio.equivalenciaVerificada = false; }), ['equivalencia_no_verificada_por_una_persona']);
    assert.deepEqual(caso((o) => { o.precio.moneda = 'USD'; }), ['moneda_distinta_de_eur']);
    assert.deepEqual(caso((o) => { o.precio.productoEquivalente = 'no-existe'; }), ['el_producto_equivalente_no_esta_en_nuestras_fuentes']);
    assert.deepEqual(caso((o) => { delete o.precio.productoEquivalente; }), ['sin_producto_equivalente']);
    const sinFecha = propias(); sinFecha.productos.find((p) => p.id === 'inf-portatil').extra = {};
    assert.deepEqual(caso(() => {}, sinFecha), ['nuestro_precio_sin_fecha_de_captura']);
    assert.deepEqual(caso(() => {}, propias(), AHORA_MK + 20 * 86400000), ['observacion_de_hace_mas_de_14_dias']);
    assert.equal(caso(() => {}), null, 'sin cambios sí se compara');
  });

  test('contenido anómalo: un texto con forma de ORDEN dentro de una observación se cita como dato, se avisa y no se usa; ningún texto de las fuentes se obedece', () => {
    const { informe: inf } = informe();
    const an = de(inf, 'contenido_anomalo');
    assert.equal(an.length, 1);
    assert.equal(an[0].elemento, 'o-f1');
    assert.match(an[0].accionSugerida, /se cita como dato, no se obedece/);
    const o = inf.hallazgos.find((x) => x.clave === 'obs:o-f1');
    assert.equal(o.evidencia.utilizableParaConclusiones, false);
    assert.equal(de(inf, 'hueco_detectado').concat(de(inf, 'hueco_senal_debil')).some((x) => x.elemento === 'seccion-ofertas'), false);
  });

  test('buenas prácticas: se declaran como práctica OBSERVADA en una fuente utilizable, con fuente y fecha, y exigen validación; nunca se recomienda adoptarlas ni se promete efecto', () => {
    const { informe: inf } = informe();
    const p = de(inf, 'practica_observada');
    assert.deepEqual(p.map((x) => x.elemento), ['o-a3']);
    assert.equal(p[0].evidencia.requiereValidacion, true);
    assert.equal(p[0].evidencia.observadaEn, '2026-11-12');
    assert.match(p[0].accionSugerida, /no implica que funcione ni que convenga adoptarla/);
  });

  test('informe normalizado: informe-agente/1 válido del agente 09, rotulado como datos de prueba, con «solo informes» y los datos no disponibles (huecos explotados, cuota, precios o expertos no aportados)', () => {
    const { informe: inf } = informe();
    const v = validarInformeAgente(inf);
    assert.equal(v.ok, true, JSON.stringify(v.errores || v));
    assert.deepEqual(validarEsquema(ESQ, inf), []);
    assert.equal(inf.agente, '09');
    assert.equal(inf.fuente.origenDatos, 'datos_de_prueba');
    assert.ok(inf.limitaciones[0].startsWith('DATOS DE PRUEBA'));
    assert.ok(inf.limitaciones.some((x) => /no accede a ninguna web, no hace scraping, no consulta APIs ni servicios de pago y no copia contenido/.test(x)));
    assert.ok(inf.limitaciones.some((x) => /No se infieren precios, resultados de competidores, opiniones de expertos ni ventajas comerciales/.test(x)));
    assert.equal(inf.persistencia.escritura, 'no_procede');
    assert.equal(inf.completo, false);
    const nd = de(inf, 'datos_no_disponibles')[0].evidencia.metricas.map((m) => m.metrica);
    for (const k of ['huecos_explotados', 'cuota_de_mercado_o_trafico_de_competidores', 'precios_de_competidores_no_aportados', 'opiniones_de_expertos_no_aportadas']) assert.ok(nd.includes(k), k);
  });

  test('modos: validación, huecos y precios producen cada uno su informe válido con SOLO lo suyo (cada uno equivale a una capacidad propuesta)', () => {
    const val = informe({ modo: 'validacion', capacidad: '09.validar-observaciones' }).informe;
    const hue = informe({ modo: 'huecos', capacidad: '09.detectar-huecos' }).informe;
    const pre = informe({ modo: 'precios', capacidad: '09.comparar-precios-observados' }).informe;
    for (const inf of [val, hue, pre]) { assert.equal(validarInformeAgente(inf).ok, true); assert.deepEqual(validarEsquema(ESQ, inf), []); }
    const reglas = (inf) => new Set(inf.hallazgos.map((x) => x.regla));
    assert.ok(reglas(val).has('fuente_citada') && reglas(val).has('dato_rechazado'));
    assert.equal(reglas(val).has('hueco_detectado') || reglas(val).has('brecha_de_precio_observada'), false);
    assert.ok(reglas(hue).has('hueco_detectado'));
    assert.equal(reglas(hue).has('brecha_de_precio_observada') || reglas(hue).has('fuente_citada'), false);
    assert.ok(reglas(pre).has('brecha_de_precio_observada') && reglas(pre).has('precio_no_comparable'));
    assert.equal(reglas(pre).has('hueco_detectado'), false);
    assert.equal(pre.capacidad, '09.comparar-precios-observados');
  });

  test('sin datos o con datos inválidos NO se inventa nada: sin fuentes válidas el informe queda incompleto y vacío de conclusiones', () => {
    const vacio = informeCompetencia({ motor, datos: { fuentes: [] }, fuentes: propias(), ahora: AHORA_MK }).informe;
    assert.equal(vacio.completo, false);
    assert.equal(vacio.resumen.fuentes, 0);
    assert.ok(vacio.limitaciones.some((x) => /No se aportó ninguna fuente válida/.test(x)));
    assert.equal(vacio.hallazgos.some((x) => ['hueco_detectado', 'brecha_de_precio_observada', 'hecho_verificado'].includes(x.regla)), false);
    const basura = informeCompetencia({ motor, datos: { fuentes: [null, 'x', { id: 'a' }] }, fuentes: propias(), ahora: AHORA_MK }).informe;
    assert.equal(basura.resumen.fuentes, 0);
    assert.ok(basura.resumen.datosRechazados >= 3);
    assert.equal(informeCompetencia({ motor, datos: undefined, fuentes: {}, ahora: AHORA_MK }).informe.resumen.fuentes, 0);
  });

  test('puro y determinista: mismas observaciones → mismo informe; los datos de entrada no se modifican; cambiar una observación cambia la firma', () => {
    const d = construirDatosCompetencia(); const f = propias();
    const antes = sha256(canonico({ d, f }));
    const a = informeCompetencia({ motor, datos: d, fuentes: f, ahora: AHORA_MK }).informe;
    const b = informeCompetencia({ motor, datos: d, fuentes: f, ahora: AHORA_MK }).informe;
    assert.deepEqual(a, b);
    assert.equal(sha256(canonico({ d, f })), antes);
    const d2 = construirDatosCompetencia(); d2.fuentes[0].observaciones[1].texto = 'Otra cosa distinta.';
    assert.notEqual(informeCompetencia({ motor, datos: d2, fuentes: f, ahora: AHORA_MK }).informe.fuente.firma, a.fuente.firma);
    assert.ok(UMBRALES.minFuentesHueco >= 2);
  });

  test('propuesta de capacidades del 09: archivo aparte NO aprobado con niveles, alcances, dependencias y requisitos; guardar observaciones y consultar webs externas BLOQUEADAS; cambiar precios o contactar competidores son L4 humano', () => {
    const prop = JSON.parse(fs.readFileSync(path.join(AQUI, '..', 'agentes', 'competencia', 'propuesta-capacidades-09.json'), 'utf8'));
    assert.equal(prop.estado, 'propuesta_no_aprobada');
    assert.match(prop.aviso, /NO forma parte del registro/);
    assert.deepEqual(prop.fichaOriginal.alcancesPrevistos, ['research:write']);
    const reg = cargarRegistro();
    for (const c of prop.capacidadesPropuestas) {
      if (c.nivel === 'L3') assert.ok(!reg.buscarCapacidad(c.id), `${c.id} (L3) sigue bloqueada: no debe estar en el registro`);
      else assert.equal(reg.buscarCapacidad(c.id).nivelRiesgo, c.nivel, `${c.id} autorizada con su nivel`);
      assert.match(c.nivel, /^L[0-3]$/);
      for (const k of ['alcances', 'dependencias', 'limites', 'requisitos']) assert.ok(Array.isArray(c[k]), `${c.id}.${k}`);
    }
    const por = Object.fromEntries(prop.capacidadesPropuestas.map((c) => [c.id, c]));
    assert.equal(por['09.validar-observaciones'].nivel, 'L0');
    for (const id of ['09.detectar-huecos', '09.comparar-precios-observados', '09.proponer-informe-competencia']) { assert.equal(por[id].nivel, 'L1'); assert.deepEqual(por[id].alcances, []); }
    assert.deepEqual(por['09.registrar-observacion'].alcances, ['research:write']);
    assert.match(por['09.consultar-fuente-externa'].alcances[0], /web:read.*NUEVO/);
    for (const id of ['09.registrar-observacion', '09.consultar-fuente-externa']) { assert.equal(por[id].requiereAprobacion, true); assert.match(por[id].nota, /BLOQUEADA/); }
    assert.deepEqual(prop.accionesQueNuncaSeranCapacidadDelAgente.map((a) => a.nivel), ['L4', 'L4', 'L4', 'L4']);
    assert.ok(prop.decisionesPendientes.length >= 4);
  });

  test('registro: el 09 tiene EXACTAMENTE las cuatro capacidades autorizadas (L0 + 3 × L1, sin alcances) y `09.registrar-observacion` y `09.consultar-fuente-externa` siguen bloqueadas; ninguna petición externa crea tareas', async () => {
    const reg = cargarRegistro();
    assert.equal(reg.agente('09').estado, 'construido_local');
    assert.deepEqual(reg.capacidadesDe('09').map((c) => [c.id, c.nivelRiesgo, c.disponibilidad, c.alcances.length, c.efectos]).sort(), [['09.comparar-precios-observados', 'L1', 'propuesta_f1', 0, 'ninguno'], ['09.detectar-huecos', 'L1', 'propuesta_f1', 0, 'ninguno'], ['09.proponer-informe-competencia', 'L1', 'propuesta_f1', 0, 'ninguno'], ['09.validar-observaciones', 'L0', 'lectura_f1', 0, 'ninguno']]);
    for (const bloqueada of ['09.registrar-observacion', '09.consultar-fuente-externa']) assert.ok(!reg.buscarCapacidad(bloqueada), bloqueada);
    assert.equal(new Set(reg.capacidades().flatMap((c) => c.alcances)).has('research:write'), false);
    assert.equal(new Set(reg.capacidades().flatMap((c) => c.alcances)).has('web:read'), false);
    const wf = hashWorkflows();
    const E = crearEntorno({});
    for (const t of ['Haz scraping de la web del competidor', 'Investiga a los competidores en su web', 'Consulta la web de los competidores']) {
      const r = await E.pregunta(t);
      assert.equal(r.categoria === 'pendiente', false, t);
      assert.equal(r.aprobaciones.length, 0, t);
    }
    assert.equal(E.tareas().length, 0);
    assert.equal(hashWorkflows(), wf);
    E.limpiar();
  });
}
