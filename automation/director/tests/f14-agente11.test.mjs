// Agente 11 · Webs nicho: COMPONENTES PUROS (sin capacidades aprobadas, sin integrar en el registro); datos y informes SINTÉTICOS aportados por parámetro; no crea webs, no compra dominios, no publica.
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
  test('Agente 11: las pruebas se ejecutan en un subproceso con el cargador de TypeScript del proyecto', () => {
    const r = spawnSync(process.execPath, ['--experimental-transform-types', '--import', './scripts/register-ts.mjs', '--test', fileURLToPath(import.meta.url)], { cwd: RAIZ, encoding: 'utf8', timeout: 240000, env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')) });
    const pasan = Number((/ℹ pass (\d+)/.exec(r.stdout) || [])[1] || 0);
    const fallan = Number((/ℹ fail (\d+)/.exec(r.stdout) || [])[1] || 0);
    assert.equal(r.status, 0, r.stdout.slice(-4000));
    assert.equal(fallan, 0);
    assert.ok(pasan >= 14, `se esperaban ≥ 14 pruebas del Agente 11 y pasaron ${pasan}`);
  });
} else {
  const N = await import('../agentes/nichos/nichos.mjs');
  const { construirNichos, construirInformesApoyo, AHORA_MK } = await import('../agentes/nichos/fixtures.mjs');
  const { cargarMotorCompetencia } = await import('../agentes/competencia/competencia.mjs');
  const { validarInformeAgente, canonico, sha256 } = await import('../protocolo.mjs');
  const { validarEsquema } = await import('../../../scripts/automation/validate-schema.mjs');
  const { cargarRegistro } = await import('../registro.mjs');
  const { crearEntorno } = await import('../evaluacion/entorno.mjs');

  const motor = await N.cargarMotorNichos();
  const mcomp = await cargarMotorCompetencia();
  const ESQ = JSON.parse(fs.readFileSync(path.join(AQUI, '..', '..', 'schemas', 'informe-agente.schema.json'), 'utf8'));
  const apoyo = () => construirInformesApoyo({ motorCompetencia: mcomp, motorMarketing: motor.marketing });
  const estudiar = (id, extra = {}) => { const { informes, fuentes } = apoyo(); return N.estudiarNicho({ motor, nicho: construirNichos().find((n) => n.id === id), fuentes, informes, ...extra }); };
  const informe = (extra = {}) => { const { informes, fuentes } = apoyo(); return N.informeNichos({ motor, nichos: construirNichos(), fuentes, informes, ahora: AHORA_MK, ...extra }); };
  const de = (inf, regla) => inf.hallazgos.filter((x) => x.regla === regla);
  const hashWorkflows = () => { const d = path.join(RAIZ, 'automation', 'workflows'); return crypto.createHash('sha256').update(fs.readdirSync(d).sort().map((f) => `${f}:${fs.readFileSync(path.join(d, f), 'utf8')}`).join('|')).digest('hex'); };

  test('reutiliza lo EXISTENTE (informes de los Agentes 02, 09 y 10 y el calendario del 07) sin recalcular su lógica ni crear otro sistema de SEO, marketing o investigación; el módulo no usa red ni escritura', () => {
    const src = fs.readFileSync(path.join(AQUI, '..', 'agentes', 'nichos', 'nichos.mjs'), 'utf8');
    assert.ok(src.includes('momentosEnHorizonte'));
    for (const rx of ['\\bfetch\\(', 'node:http', 'node:https', 'node:net', 'node:fs', 'child_process', 'writeFile', 'appendFile', 'unlink', 'rmSync', 'rename\\(']) assert.equal(new RegExp(rx).test(src), false, rx);
    assert.equal(/agentes\/(afiliacion|competencia|analitica|precios|contenido)\/[a-z]+\.mjs|comparableOffers|priceHistory|analyticsMonths|marketingInsights/.test(src), false, 'consume informes, no importa ni recalcula la lógica de otros agentes');
    assert.equal(/function\s+(compararProgramas|informeCompetencia|analizarAnalitica|planificarCampanas|auditarSEO|validarObservaciones)/.test(src), false);
    const { informes } = apoyo();
    assert.equal(informes.competencia.agente, '09');
    assert.equal(informes.analitica.agente, '10');
    assert.ok(Object.values(informes.afiliacionPorNicho).every((i) => i.agente === '02'));
  });

  test('estudio de un nicho con datos: cada dimensión con su estado y evidencia; la demanda y los costes son cifras APORTADAS (no se suman ni se proyectan) y el coste incompleto se rotula «parcial»', () => {
    const e = estudiar('n-portatiles');
    const d = e.dimensiones;
    assert.equal(e.estado, 'estudio_borrador');
    assert.equal(e.requiereDecisionDelPropietario, true);
    assert.equal(d.demanda.estado, 'estimacion');
    assert.equal(d.demanda.items[0].origen, 'aportado_por_el_propietario');
    assert.equal(d.demanda.items[0].valor, 2400);
    assert.equal(d.demanda.items[0].metodo.length > 0, true);
    assert.match(d.demanda.nota, /no la calcula ningún agente/);
    assert.equal(d.coste.estado, 'parcial');
    assert.equal(d.coste.totalAportadoEur, 472);
    assert.equal(d.coste.totalCompleto, false);
    assert.deepEqual(d.coste.conceptosSinDato, ['herramientas']);
    assert.match(d.coste.nota, /Suma PARCIAL/);
    assert.equal(d.afiliacion.estado, 'observacion');
    assert.ok(d.afiliacion.programas.some((p) => p.id === 'amazon' && p.comisionPct === 4 && p.verificacion === 'verificado'));
    assert.match(d.afiliacion.nota, /no incluyen conversión ni ticket medio/);
    assert.equal(d.competencia.estado, 'observacion');
    assert.deepEqual(d.competencia.huecos.map((x) => x.clave), ['guia-portatiles-por-presupuesto']);
    assert.equal(d.catalogoPropio.productosConPrecio, 3);
    assert.equal(d.catalogoPropio.estado, 'verificado');
  });

  test('datos aportados mal etiquetados NUNCA se elevan: una estimación sin método, un «verificado» sin fuente y fecha, una clase inválida o un valor no numérico se degradan', () => {
    const base = construirNichos().find((n) => n.id === 'n-portatiles');
    const con = (demanda) => { const { informes, fuentes } = apoyo(); return N.estudiarNicho({ motor, nicho: { ...base, datosAportados: { demanda, costes: [] } }, fuentes, informes }).dimensiones.demanda.items; };
    const [a, b, c, d, e] = con([
      { id: 'a', valor: 100, clase: 'estimacion', fuente: 'f', fecha: '2026-11-01' },
      { id: 'b', valor: 100, clase: 'hecho_verificado' },
      { id: 'c', valor: 100, clase: 'inventada' },
      { id: 'd', valor: 'mucha', clase: 'estimacion', metodo: 'x' },
      { id: 'e', valor: 100, clase: 'hecho_verificado', fuente: 'albarán firmado', fecha: '2026-11-02' },
    ]);
    assert.equal(a.estado, 'hipotesis'); assert.match(a.avisos[0], /estimacion_sin_metodo/);
    assert.equal(b.estado, 'hipotesis'); assert.match(b.avisos[0], /verificado_sin_fuente_y_fecha/);
    assert.equal(c.estado, 'hipotesis'); assert.match(c.avisos[0], /clase_invalida/);
    assert.equal(d.estado, 'no_disponible'); assert.equal(d.valor, null);
    assert.equal(e.estado, 'verificado');
    const base2 = estudiar('n-portatiles').dimensiones.demanda.items.find((x) => x.id === 'interes-estable');
    assert.equal(base2.estado, 'hipotesis');
  });

  test('un nicho SIN datos no inventa nada: todas las dimensiones «no disponible», evidencia insuficiente, hipótesis sin base y los riesgos que lo explican', () => {
    const e = estudiar('n-jardin');
    for (const k of ['demanda', 'competencia', 'afiliacion', 'coste']) assert.equal(e.dimensiones[k].estado, 'no_disponible', k);
    assert.equal(e.dimensiones.catalogoPropio.productosConPrecio, 0);
    assert.equal(e.dimensiones.catalogoPropio.existeEnElCatalogo, false);
    assert.equal(e.madurezDeLaEvidencia.nivel, 'insuficiente');
    assert.deepEqual(e.madurezDeLaEvidencia.dimensionesConEvidencia, []);
    const codigos = e.riesgos.map((r) => r.codigo);
    for (const c of ['demanda_no_demostrada', 'competencia_sin_datos', 'afiliacion_sin_datos', 'coste_incompleto', 'catalogo_propio_escaso']) assert.ok(codigos.includes(c), c);
    assert.deepEqual(e.hipotesis.find((h) => h.id === 'H2').base, []);
    assert.deepEqual(e.hipotesis.find((h) => h.id === 'H3').base, []);
    assert.ok(e.noDisponible.includes('demanda') && e.noDisponible.includes('ingresos_y_rentabilidad') && e.noDisponible.includes('trafico_potencial'));
  });

  test('madurez de la evidencia: solo cuentan demanda, competencia, afiliación y coste con evidencia real (un coste parcial no cuenta); ordenar NO es pronosticar beneficio y el criterio se declara', () => {
    assert.equal(estudiar('n-portatiles').madurezDeLaEvidencia.nivel, 'razonable');
    assert.deepEqual(estudiar('n-portatiles').madurezDeLaEvidencia.dimensionesConEvidencia, ['demanda', 'competencia', 'afiliacion']);
    const s = estudiar('n-sonido');
    assert.equal(s.dimensiones.coste.estado, 'parcial');
    assert.equal(s.madurezDeLaEvidencia.nivel, 'parcial');
    assert.match(s.madurezDeLaEvidencia.nota, /NO si el nicho es rentable ni viable/);
    const { informes, fuentes } = apoyo();
    const { ranking } = N.analizarOportunidades({ motor, nichos: construirNichos(), fuentes, informes });
    assert.deepEqual(ranking.map((r) => r.id), ['n-portatiles', 'n-sonido', 'n-jardin']);
    const empate = N.analizarOportunidades({ motor, nichos: [{ id: 'b', categoria: 'x' }, { id: 'a', categoria: 'x' }], fuentes, informes }).ranking.map((r) => r.id);
    assert.deepEqual(empate, ['a', 'b'], 'desempate por id');
    const { informe: inf } = informe();
    assert.ok(de(inf, 'oportunidad_ordenada').every((x) => x.evidencia.criterio === 'madurez de la evidencia, no beneficio previsto'));
  });

  test('hipótesis: cuatro por nicho, siempre marcadas como tales, con su base y cómo validarlas (por una persona); nunca con certeza «confirmado»', () => {
    const { informe: inf } = informe();
    const hs = de(inf, 'hipotesis');
    assert.equal(hs.length, 12);
    for (const x of hs) {
      assert.equal(x.evidencia.estado, 'hipotesis');
      assert.equal(x.certeza, 'no_verificable');
      assert.match(x.accionSugerida, /HIPÓTESIS: no está demostrada/);
      assert.ok(x.evidencia.comoValidar.length > 20);
    }
    assert.match(estudiar('n-portatiles').hipotesis.find((h) => h.id === 'H3').comoValidar, /solicita el alta \(L4\)/);
  });

  test('riesgos: se derivan de lo que falta (demanda, competencia, afiliación, costes, catálogo) y de que el alta en programas no está garantizada (riesgo general, no un dato); los datos de prueba se declaran', () => {
    const p = estudiar('n-portatiles').riesgos.map((r) => r.codigo);
    for (const c of ['comisiones_no_vigentes_o_sin_verificar', 'alta_en_programas_no_garantizada', 'coste_incompleto', 'catalogo_propio_escaso', 'datos_de_prueba']) assert.ok(p.includes(c), c);
    assert.equal(p.includes('demanda_no_demostrada'), false, 'hay una estimación con método');
    const s = estudiar('n-sonido').riesgos.map((r) => r.codigo);
    assert.ok(s.includes('demanda_no_demostrada'));
    const alta = estudiar('n-portatiles').riesgos.find((r) => r.codigo === 'alta_en_programas_no_garantizada');
    assert.match(alta.texto, /Riesgo general \(no es un dato\)/);
    assert.equal(estudiar('n-portatiles', { sintetico: false }).riesgos.some((r) => r.codigo === 'datos_de_prueba'), false);
    const unico = estudiar('n-sonido').riesgos.map((r) => r.codigo);
    assert.ok(unico.includes('comisiones_no_vigentes_o_sin_verificar'));
  });

  test('informe normalizado: informe-agente/1 válido del agente 11, de datos de prueba, con las limitaciones (no crea webs ni compra dominios ni publica) y los datos no disponibles (ingresos, tráfico, demanda no aportada, decisiones)', () => {
    const { informe: inf } = informe();
    const v = validarInformeAgente(inf);
    assert.equal(v.ok, true, JSON.stringify(v.errores || v));
    assert.deepEqual(validarEsquema(ESQ, inf), []);
    assert.equal(inf.agente, '11');
    assert.equal(inf.fuente.origenDatos, 'datos_de_prueba');
    assert.ok(inf.limitaciones[0].startsWith('DATOS DE PRUEBA'));
    assert.ok(inf.limitaciones.some((x) => /no se crea ninguna web, no se compra ningún dominio, no se contrata alojamiento, no se publica contenido ni se activa ninguna campaña/.test(x)));
    assert.ok(inf.limitaciones.some((x) => /No se inventan demanda, tráfico, ingresos ni rentabilidad/.test(x)));
    assert.equal(inf.persistencia.escritura, 'no_procede');
    assert.equal(inf.completo, false);
    assert.equal(inf.resumen.nichos, 3);
    assert.equal(inf.resumen.estudiosConDecision, 0);
    assert.equal(inf.resumen.nichosEvidenciaInsuficiente, 1);
    const nd = de(inf, 'datos_no_disponibles')[0].evidencia.metricas.map((m) => m.metrica);
    for (const k of ['ingresos_y_rentabilidad', 'trafico_potencial', 'demanda_no_aportada', 'estudios_con_decision']) assert.ok(nd.includes(k), k);
    const texto = JSON.stringify(inf);
    assert.doesNotMatch(texto, /ingresos estimados|rentabilidad de \d|euros al mes|beneficio esperado de/i);
  });

  test('modos: «oportunidades» solo trae el orden y los riesgos; «viabilidad» añade dimensiones, hipótesis e indicios; ambos son informes válidos y sin las funciones fuera de la ficha', () => {
    const opo = informe({ modo: 'oportunidades', capacidad: '11.analizar-oportunidades-nicho' }).informe;
    const via = informe({ modo: 'viabilidad' }).informe;
    for (const inf of [opo, via]) { assert.equal(validarInformeAgente(inf).ok, true); assert.deepEqual(validarEsquema(ESQ, inf), []); }
    const reglas = (inf) => new Set(inf.hallazgos.map((x) => x.regla));
    assert.ok(reglas(opo).has('oportunidad_ordenada') && reglas(opo).has('riesgo'));
    assert.equal(reglas(opo).has('dimension_del_estudio') || reglas(opo).has('hipotesis'), false);
    assert.ok(reglas(via).has('dimension_del_estudio') && reglas(via).has('hipotesis') && reglas(via).has('nicho_estudiado'));
    assert.equal(opo.capacidad, '11.analizar-oportunidades-nicho');
    for (const inf of [opo, via]) assert.equal(JSON.stringify(inf).includes('estructura_de_sitio') || JSON.stringify(inf).includes('estrategia_de_contenido'), false);
  });

  test('indicio propio (Agente 10): solo ids de NUESTRAS fichas del nicho y rotulado como indicio sobre nuestro tráfico, no como demanda del nicho', () => {
    const e = estudiar('n-portatiles');
    assert.deepEqual(e.indicioPropio.altoTraficoBajaSalida, ['inf-portatil']);
    assert.deepEqual(e.indicioPropio.altaSalidaPocoTrafico, []);
    assert.match(e.indicioPropio.nota, /NUESTRO tráfico, no demanda del nicho/);
    const s = estudiar('n-sonido');
    assert.deepEqual(s.indicioPropio.altaSalidaPocoTrafico, ['aud-altavoz']);
    const { informe: inf } = informe();
    assert.equal(de(inf, 'indicio_propio').length, 2);
  });

  test('FUERA DE LA FICHA: estructura de sitio y estrategia de contenido existen solo como propuestas pendientes de autorización; no crean nada (ni nombre, ni dominio, ni textos, ni tráfico) y usan lo existente', () => {
    const { informes, fuentes } = apoyo();
    const nicho = construirNichos()[0];
    const est = N.proponerEstructuraSitio({ motor, nicho, fuentes, informes });
    assert.equal(est.fueraDeFicha, true);
    assert.equal(est.estado, 'propuesta_pendiente_de_autorizacion');
    assert.deepEqual(est.secciones.map((s) => s.id), ['inicio', 'categoria:informatica', 'guia:guia-portatiles-por-presupuesto', 'comparativas', 'afiliacion', 'privacidad']);
    assert.ok(est.secciones.find((s) => s.tipo === 'guia').origen === 'hueco_hipotetico_del_agente_09');
    assert.ok(est.noIncluye.includes('nombre ni dominio del sitio') && est.noIncluye.includes('contenido redactado'));
    assert.ok(est.pendientes.some((x) => /la ficha del Agente 11 no incluye proponer estructuras de sitios/.test(x)));
    assert.ok(est.pendientes.some((x) => /L4 humano/.test(x)));
    const str = N.proponerEstrategiaContenido({ motor, nicho, fuentes, informes, ahora: AHORA_MK });
    assert.equal(str.fueraDeFicha, true);
    assert.equal(str.estado, 'propuesta_pendiente_de_autorizacion');
    const tipos = new Set(str.piezas.map((p) => p.tipo));
    assert.deepEqual([...tipos].sort(), ['campana_estacional', 'ficha', 'guia']);
    assert.ok(str.piezas.filter((p) => p.tipo === 'ficha').every((p) => p.producePara === '08.proponer-borrador-ficha'));
    assert.ok(str.piezas.filter((p) => p.tipo === 'campana_estacional').every((p) => p.producePara === '07.proponer-plan-campanas' && /^\d{4}-\d{2}-\d{2}$/.test(p.fecha)));
    assert.ok(str.noIncluye.includes('volumen de tráfico esperado') && str.noIncluye.includes('ingresos esperados'));
    assert.ok(str.pendientes.some((x) => /no incluye proponer estrategias de contenido/.test(x)));
  });

  test('puro y determinista: mismas entradas → mismo informe; las entradas no se modifican; el máximo de nichos se respeta', () => {
    const { informes, fuentes } = apoyo();
    const nichos = construirNichos();
    const antes = sha256(canonico({ informes, fuentes, nichos }));
    const a = N.informeNichos({ motor, nichos, fuentes, informes, ahora: AHORA_MK }).informe;
    const b = N.informeNichos({ motor, nichos, fuentes, informes, ahora: AHORA_MK }).informe;
    assert.deepEqual(a, b);
    assert.equal(sha256(canonico({ informes, fuentes, nichos })), antes);
    const muchos = Array.from({ length: 30 }, (_, i) => ({ id: `n${String(i).padStart(2, '0')}`, categoria: 'x' }));
    assert.equal(N.analizarOportunidades({ motor, nichos: muchos, fuentes, informes }).estudios.length, N.UMBRALES.maxNichos);
    assert.equal(N.analizarOportunidades({ motor, nichos: 'no es una lista', fuentes, informes }).estudios.length, 0);
    const otro = construirNichos(); otro[0].datosAportados.demanda[0].valor = 3000;
    assert.notEqual(N.informeNichos({ motor, nichos: otro, fuentes, informes, ahora: AHORA_MK }).informe.fuente.firma, a.fuente.firma);
  });

  test('propuesta de capacidades del 11: NO aprobada; las de la ficha (L1, L1 y L3 bloqueada) separadas de las dos que NO figuran en la ficha; ninguna en el registro; L4 humano para crear webs, dominios, publicar y decidir', () => {
    const prop = JSON.parse(fs.readFileSync(path.join(AQUI, '..', 'agentes', 'nichos', 'propuesta-capacidades-11.json'), 'utf8'));
    assert.equal(prop.estado, 'propuesta_no_aprobada');
    assert.match(prop.aviso, /NO forma parte del registro/);
    assert.deepEqual(prop.fichaOriginal.alcancesPrevistos, ['research:write']);
    const reg = cargarRegistro();
    const todas = [...prop.dentroDeLaFicha, ...prop.fueraDeLaFichaPendientesDeAutorizacion];
    for (const c of todas) { if (['11.analizar-oportunidades-nicho', '11.estudiar-viabilidad-nicho'].includes(c.id)) assert.equal(reg.buscarCapacidad(c.id).nivelRiesgo, 'L1', `${c.id} autorizada`); else assert.ok(!reg.buscarCapacidad(c.id), `${c.id} sigue bloqueada o pendiente: no debe estar en el registro`); for (const k of ['alcances', 'dependencias', 'limites']) assert.ok(Array.isArray(c[k]), `${c.id}.${k}`); }
    assert.deepEqual(prop.dentroDeLaFicha.map((c) => [c.id, c.nivel]), [['11.analizar-oportunidades-nicho', 'L1'], ['11.estudiar-viabilidad-nicho', 'L1'], ['11.registrar-estudio', 'L3']]);
    assert.deepEqual(prop.dentroDeLaFicha[2].alcances, ['research:write']);
    assert.match(prop.dentroDeLaFicha[2].nota, /BLOQUEADA/);
    assert.ok(prop.fueraDeLaFichaPendientesDeAutorizacion.every((c) => /La ficha NO incluye/.test(c.nota) && /requiere autorización expresa/.test(c.nota)));
    assert.deepEqual(prop.accionesQueNuncaSeranCapacidadDelAgente.map((a) => a.nivel), ['L4', 'L4', 'L4', 'L4']);
    assert.ok(prop.decisionesPendientes.length >= 4);
  });

  test('registro: el 11 tiene EXACTAMENTE las dos capacidades autorizadas (L1, sin alcances); `11.registrar-estudio` y las dos funciones fuera de la ficha siguen fuera del registro; crear webs, comprar dominios o contratar alojamiento son L4 humano', async () => {
    const reg = cargarRegistro();
    assert.equal(reg.agente('11').estado, 'construido_local');
    assert.deepEqual(reg.capacidadesDe('11').map((c) => [c.id, c.nivelRiesgo, c.disponibilidad, c.alcances.length, c.efectos]).sort(), [['11.analizar-oportunidades-nicho', 'L1', 'propuesta_f1', 0, 'ninguno'], ['11.estudiar-viabilidad-nicho', 'L1', 'propuesta_f1', 0, 'ninguno']]);
    for (const no of ['11.registrar-estudio', '11.proponer-estructura-sitio', '11.proponer-estrategia-contenido']) assert.ok(!reg.buscarCapacidad(no), no);
    assert.equal(new Set(reg.capacidades().flatMap((c) => c.alcances)).has('research:write'), false);
    const wf = hashWorkflows();
    const E = crearEntorno({});
    for (const t of ['Crea una web de nicho', 'Compra el dominio del nicho', 'Contrata alojamiento para la web']) {
      const r = await E.pregunta(t);
      assert.equal(r.intencion.tipo, 'accion_humana', t);
      assert.equal(r.categoria, 'consulta', t);
    }
    for (const t of ['Propón la estructura del sitio del nicho', 'Define la estrategia de contenido del nicho']) {
      const r = await E.pregunta(t);
      assert.equal(r.intencion.tipo, 'agente_no_operativo', t);
      assert.match(r.texto, /no tengo una capacidad registrada que cubra esa petición/, t);
    }
    assert.equal(E.tareas().length, 0);
    assert.equal(E.aprobaciones().length, 0);
    assert.equal(hashWorkflows(), wf);
    E.limpiar();
  });
}
