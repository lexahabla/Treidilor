// Agente 07 · Marketing multicanal y SEO: COMPONENTES PUROS (sin capacidades aprobadas, sin integrar en el registro); fixtures sintéticos; no publica, no envía, no invierte.
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
  test('Agente 07: las pruebas se ejecutan en un subproceso con el cargador de TypeScript del proyecto', () => {
    const r = spawnSync(process.execPath, ['--experimental-transform-types', '--import', './scripts/register-ts.mjs', '--test', fileURLToPath(import.meta.url)], { cwd: RAIZ, encoding: 'utf8', timeout: 240000, env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')) });
    const pasan = Number((/ℹ pass (\d+)/.exec(r.stdout) || [])[1] || 0);
    const fallan = Number((/ℹ fail (\d+)/.exec(r.stdout) || [])[1] || 0);
    assert.equal(r.status, 0, r.stdout.slice(-4000));
    assert.equal(fallan, 0);
    assert.ok(pasan >= 16, `se esperaban ≥ 16 pruebas del Agente 07 y pasaron ${pasan}`);
  });
} else {
  const { cargarMotorMarketing, planificarCampanas, redactarBrief, revisarTextoPublicitario, auditarSEO, momentosEnHorizonte, UMBRALES } = await import('../agentes/marketing/marketing.mjs');
  const { construirFuentesMarketing, AHORA_MK, informe05Fx, informe10Fx } = await import('../agentes/marketing/fixtures.mjs');
  const { validarInformeAgente, canonico, sha256 } = await import('../protocolo.mjs');
  const { validarEsquema } = await import('../../../scripts/automation/validate-schema.mjs');
  const { cargarRegistro } = await import('../registro.mjs');
  const { crearEntorno } = await import('../evaluacion/entorno.mjs');
  const { interpretar } = await import('../intencion.mjs');

  const motor = await cargarMotorMarketing();
  const ESQ = JSON.parse(fs.readFileSync(path.join(AQUI, '..', '..', 'schemas', 'informe-agente.schema.json'), 'utf8'));
  const fx = () => construirFuentesMarketing(motor);
  const plan = (extra = {}) => planificarCampanas({ motor, fuentes: fx(), ahora: AHORA_MK, ...extra });
  const de = (informe, regla) => informe.hallazgos.filter((h) => h.regla === regla);
  const hashWorkflows = () => { const d = path.join(RAIZ, 'automation', 'workflows'); return crypto.createHash('sha256').update(fs.readdirSync(d).sort().map((f) => `${f}:${fs.readFileSync(path.join(d, f), 'utf8')}`).join('|')).digest('hex'); };
  const campana = (id) => plan().campanas.find((c) => c.id === id);

  test('reutiliza lo EXISTENTE de marketing (calendario, afirmaciones verificadas y reglas de texto) sin copiarlo; el módulo no escribe, no usa la red y no toca usuarios ni correo', () => {
    for (const f of ['marketingCalendar.ts', 'commercialClaims.ts', 'publicClaims.ts', 'categories.ts']) assert.ok(fs.existsSync(path.join(RAIZ, 'src', 'lib', f)), f);
    assert.equal(typeof motor.calendar.getMomentosComerciales, 'function');
    assert.equal(typeof motor.claims.shownDiscount, 'function');
    assert.equal(typeof motor.publicClaims.claimProblem, 'function');
    const src = fs.readFileSync(path.join(AQUI, '..', 'agentes', 'marketing', 'marketing.mjs'), 'utf8');
    for (const f of ['getMomentosComerciales', 'shownDiscount', 'captureDateOf', 'claimProblem']) assert.ok(src.includes(f), `usa ${f}`);
    assert.equal(/\bfetch\(|node:http|node:https|node:net|node:fs|child_process|writeFile|appendFile|unlink|rmSync|rename\(/.test(src), false);
    assert.equal(/marketingEmail|marketingLeads|marketingAudience|radarAuth|radarStore|mailer|sendMail/.test(src), false, 'no toca correo, leads ni usuarios');
    assert.equal(/function\s+(getMomentosComerciales|shownDiscount|claimProblem|verifiedDiscountOf|resolverFecha)/.test(src), false, 'no copia las funciones existentes');
    assert.equal(fs.existsSync(path.join(RAIZ, 'src', 'lib', 'marketingAgente.ts')), false);
  });

  test('calendario: los momentos del horizonte salen del calendario existente y su ESTADO se calcula respecto a la fecha dada (no al reloj del sistema)', () => {
    const hoy = momentosEnHorizonte(motor, AHORA_MK);
    const por = Object.fromEntries(hoy.map((x) => [x.id, x]));
    assert.equal(por['black-friday'].fecha, '2026-11-27');
    assert.equal(por['black-friday'].estado, 'preparacion');
    assert.equal(por['black-friday'].diasHasta, 12);
    assert.equal(por.navidad.estado, 'programada');
    assert.equal(por['singles-day'], undefined, 'el 11/11 ya pasó');
    const dia = momentosEnHorizonte(motor, Date.parse('2026-11-27T09:00:00Z'));
    assert.equal(dia.find((x) => x.id === 'black-friday').estado, 'en_curso');
    assert.equal(momentosEnHorizonte(motor, Date.parse('2026-11-28T09:00:00Z')).some((x) => x.id === 'black-friday'), false, 'pasado el día ya no está en el horizonte');
    assert.equal(momentosEnHorizonte(motor, AHORA_MK, 0).every((x) => x.estado !== 'programada'), true);
  });

  test('plan de campañas: informe-agente/1 válido, rotulado como datos de prueba, con campañas en preparación, categorías que encajan y limitaciones (no publica, sin coste por visita)', () => {
    const { informe, campanas } = plan();
    const v = validarInformeAgente(informe);
    assert.equal(v.ok, true, JSON.stringify(v.errores || v));
    assert.deepEqual(validarEsquema(ESQ, informe), []);
    assert.equal(informe.agente, '07');
    assert.equal(informe.fuente.origenDatos, 'datos_de_prueba');
    assert.ok(informe.limitaciones[0].startsWith('DATOS DE PRUEBA'));
    assert.ok(informe.limitaciones.some((x) => /no se publica, no se envía ningún mensaje, no se invierte en publicidad y no se modifica contenido real/.test(x)));
    assert.equal(informe.persistencia.escritura, 'no_procede');
    assert.equal(informe.resumen.campanasEnPreparacion, 3);
    assert.deepEqual(campanas.map((c) => c.id), ['cyber-week', 'black-friday', 'cyber-monday', 'navidad', 'nochevieja', 'reyes']);
    const bf = campana('black-friday');
    assert.deepEqual(bf.categorias.map((c) => c.id).sort(), ['audio-sonido', 'gaming', 'hogar-inteligencia', 'informatica']);
    assert.equal(bf.preparacionDesde, '2026-10-30');
    assert.ok(bf.canales.every((c) => /_L4$|es_L4$/.test(c.accionHumana)), 'publicar o enviar siempre es L4 humano');
    const nd = de(informe, 'datos_no_disponibles')[0].evidencia.metricas.map((x) => x.metrica);
    for (const k of ['coste_por_visita', 'trafico_cualificado_por_campana', 'consentimiento_para_email', 'ventas_o_comisiones_atribuidas']) assert.ok(nd.includes(k), k);
  });

  test('candidatos: solo productos con precio, imagen y sin agotar; los retirados y sin precio no entran; el descuento solo cuenta si está VERIFICADO y el orden es determinista', () => {
    const bf = campana('black-friday');
    const ids = bf.candidatos.map((c) => c.producto);
    assert.deepEqual(ids.slice(0, 2), ['inf-portatil', 'aud-auriculares'], 'primero los descuentos verificados, de mayor a menor');
    for (const excluido of ['inf-monitor', 'inf-raton', 'hog-sin-precio', 'gam-retirado']) assert.ok(!bf.candidatos.some((c) => c.producto === excluido), `${excluido} no es elegible`);
    assert.equal(bf.candidatos[0].descuentoVerificado.porcentaje, 20);
    const teclado = campana('cyber-monday').candidatos.find((c) => c.producto === 'inf-teclado');
    assert.equal(teclado.descuentoVerificado, null, 'originalPrice solo declarado: no es descuento');
    assert.deepEqual(plan().campanas.map((c) => c.candidatos.map((p) => p.producto)), plan().campanas.map((c) => c.candidatos.map((p) => p.producto)));
    assert.ok(bf.candidatos.length <= UMBRALES.maxCandidatosPorCampana);
    const altavoz = bf.candidatos.find((c) => c.producto === 'aud-altavoz');
    assert.equal(altavoz.fechaCapturaPrecio, null);
    assert.ok(altavoz.avisos.includes('sin_fecha_de_captura_del_precio'));
  });

  test('señales de otros agentes: solo se usan ids que existen y son elegibles; se declara de qué informe y con qué datos; sin informes se dice que no se usan', () => {
    const base = plan();
    assert.ok(base.informe.limitaciones.some((x) => /No se aportó informe de los Agentes 05 ni 10/.test(x)));
    const con = plan({ informes: [informe05Fx(['aud-barra', 'no-existe', 'inf-monitor']), informe10Fx({ potencial: ['aud-altavoz'], revisar: ['inf-portatil'] })] });
    const bf = con.campanas.find((c) => c.id === 'black-friday');
    assert.ok(bf.candidatos.find((c) => c.producto === 'aud-barra').señales.includes('informe_05_precio_confirmado'));
    assert.ok(bf.candidatos.find((c) => c.producto === 'aud-altavoz').señales.includes('informe_10_alta_salida_poco_trafico'));
    assert.ok(bf.candidatos.find((c) => c.producto === 'inf-portatil').avisos.some((a) => /revisar la ficha antes de promocionar/.test(a)));
    assert.ok(!bf.candidatos.some((c) => ['no-existe', 'inf-monitor'].includes(c.producto)));
    assert.ok(con.informe.limitaciones.some((x) => /informes de otros agentes aportados son de DATOS DE PRUEBA/.test(x)));
    assert.deepEqual(con.senales.usados.map((u) => u.agente).sort(), ['05', '10']);
    assert.equal(con.informe.limitaciones.some((x) => /No se aportó informe/.test(x)), false);
  });

  test('sin fuentes o fuera de temporada el agente lo dice: sin categorías/candidatos queda incompleto y sin campañas no inventa ninguna', () => {
    const vacio = planificarCampanas({ motor, fuentes: { productos: [], categorias: fx().categorias }, ahora: AHORA_MK });
    assert.equal(vacio.informe.completo, false);
    assert.ok(de(vacio.informe, 'campana_sin_candidatos').length > 0);
    const sinCat = planificarCampanas({ motor, fuentes: { productos: [], categorias: [] }, ahora: AHORA_MK });
    assert.ok(de(sinCat.informe, 'campana_sin_categorias').length > 0);
    const ninguna = planificarCampanas({ motor, fuentes: fx(), ahora: AHORA_MK, umbrales: { horizonteDias: -400 } });
    assert.equal(ninguna.campanas.length, 0);
    assert.equal(ninguna.informe.completo, false);
    assert.equal(ninguna.informe.resumen.campanas, 0);
  });

  test('brief: borrador NO publicado con objetivo sin promesas, ángulos evaluados, mensajes factuales con fecha, cumplimiento, medición y lo que no hace; sin datos personales', () => {
    const f = fx();
    const b = redactarBrief({ motor, campana: campana('black-friday'), fuentes: f, ahora: AHORA_MK });
    assert.equal(b.esquema, 'brief-campana/1');
    assert.equal(b.estado, 'borrador_no_publicado');
    assert.equal(b.requiereAprobacion, true);
    assert.equal(b.audiencia.datosPersonales, false);
    assert.match(b.objetivo, /No se promete ningún resultado numérico/);
    assert.ok(b.angulos.length > 0 && b.angulos.every((a) => typeof a.utilizable === 'boolean'));
    const m0 = b.mensajes.find((x) => x.producto === 'inf-portatil');
    assert.match(m0.texto, /799,00 € \(precio del 15\/11\/2026\)\. Descuento verificado del 20 % \(antes 999,00 €, lectura del 15\/11\/2026\)/);
    const sinFecha = b.mensajes.find((x) => x.producto === 'aud-altavoz');
    assert.equal(sinFecha.texto, null);
    assert.match(sinFecha.motivo, /No consta la fecha de captura/);
    assert.deepEqual(b.noHace, ['publicar', 'enviar mensajes', 'invertir en publicidad', 'modificar contenido real']);
    assert.match(b.medicion.costePorVisita, /no disponible/);
    assert.ok(b.cumplimiento.some((c) => /enlaces de afiliado/.test(c)) && b.cumplimiento.some((c) => /RGPD\/LSSI/.test(c)));
    assert.equal(b.revisionDeMensajes.ok, true, JSON.stringify(b.revisionDeMensajes));
    assert.equal(JSON.stringify(b).includes('@'), false, 'sin correos ni datos personales');
  });

  test('calendario de acciones del brief: la preparación cae entre el inicio de preparación y la fecha; publicar o enviar aparece solo como DECISIÓN HUMANA el día de la campaña', () => {
    const c = campana('black-friday');
    const b = redactarBrief({ motor, campana: c, fuentes: fx(), ahora: AHORA_MK });
    const prep = b.calendarioAcciones.filter((a) => a.tipo === 'preparacion');
    assert.equal(prep.length, c.preparacion.length);
    for (const a of prep) assert.ok(a.fecha >= c.preparacionDesde && a.fecha <= c.fecha, a.fecha);
    const hum = b.calendarioAcciones.filter((a) => a.tipo === 'decision_humana');
    assert.equal(hum.length, c.canales.length);
    assert.ok(hum.every((a) => a.fecha === c.fecha && /\(L4\)/.test(a.accion)));
    assert.deepEqual(b.calendarioAcciones.map((a) => a.fecha), [...b.calendarioAcciones.map((a) => a.fecha)].sort());
  });

  test('revisión de textos: detecta superlativos, garantías, urgencia, descuentos no verificados, precio sin fecha, cifras de comisión y falta de divulgación; acepta un texto correcto', () => {
    const mal = revisarTextoPublicitario({ motor, texto: 'El mejor portátil, garantizado. Solo hoy 799 € con 50 % de descuento. Comisión del 5 % para nosotros. Últimas unidades.', conEnlaces: true });
    const reglas = new Set(mal.problemas.map((p) => p.regla));
    for (const r of ['afirmacion_absoluta_no_demostrable', 'urgencia_no_demostrable', 'descuento_no_verificado', 'cifra_interna_de_comision', 'precio_sin_fecha', 'falta_divulgacion_afiliacion']) assert.ok(reglas.has(r), r);
    assert.equal(mal.ok, false);
    const bien = revisarTextoPublicitario({ motor, texto: 'Esta página contiene enlaces de afiliado: podemos recibir una comisión sin coste para ti. Portátil: 799,00 € (precio del 15/11/2026).', conEnlaces: true });
    assert.deepEqual(bien, { ok: true, problemas: [] });
    assert.equal(revisarTextoPublicitario({ motor, texto: 'Nuestro laboratorio lo probó y 4,5 horas de batería.', productos: [{ title: 'Portátil' }] }).problemas.map((p) => p.regla).includes('analisis_inexistente'), true);
  });

  test('un descuento solo se puede citar si es el VERIFICADO de la ficha: el mismo porcentaje sin verificación se rechaza', () => {
    const f = fx();
    const portatil = f.productos.find((p) => p.id === 'inf-portatil');
    const teclado = f.productos.find((p) => p.id === 'inf-teclado');
    const ok = revisarTextoPublicitario({ motor, texto: 'Descuento verificado del 20 % (antes 999,00 €, lectura del 15/11/2026).', productos: [portatil] });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.equal(revisarTextoPublicitario({ motor, texto: 'Descuento verificado del 20 % (antes 999,00 €, lectura del 15/11/2026).', productos: [teclado] }).ok, false);
    assert.equal(revisarTextoPublicitario({ motor, texto: 'Descuento del 20 % en este portátil.', productos: [portatil] }).ok, false, 'sin la palabra «verificado» y su lectura no vale');
  });

  test('auditoría SEO de contenido: detecta títulos largos, cortos y duplicados, descripciones ausentes, cortas y duplicadas, sin imagen, sin precio, disponibilidad desconocida y categorías finas', () => {
    const { informe } = auditarSEO({ motor, fuentes: fx(), ahora: AHORA_MK });
    const v = validarInformeAgente(informe);
    assert.equal(v.ok, true, JSON.stringify(v.errores || v));
    assert.deepEqual(validarEsquema(ESQ, informe), []);
    const pares = informe.hallazgos.filter((x) => x.regla.startsWith('seo_')).map((x) => `${x.regla}:${x.elemento}`);
    for (const k of ['seo_titulo_largo:gam-titulo-largo', 'seo_titulo_corto:gam-titulo-corto', 'seo_titulo_duplicado:gam-dup-1', 'seo_sin_descripcion:aud-barra', 'seo_descripcion_corta:gam-titulo-corto', 'seo_descripcion_duplicada:gam-dup-1', 'seo_sin_imagen:inf-raton', 'seo_sin_precio:hog-sin-precio', 'seo_disponibilidad_desconocida:hog-robot', 'seo_categoria_fina:hogar-inteligencia']) assert.ok(pares.includes(k), k);
    assert.ok(!pares.some((x) => x.endsWith(':gam-retirado')), 'un producto retirado no se audita');
    assert.equal(informe.hallazgos.find((x) => x.regla === 'seo_disponibilidad_desconocida').certeza, 'no_verificable');
    assert.equal(informe.resumen.problemasSeo, pares.length);
    assert.equal(informe.fuente.origenDatos, 'datos_de_prueba');
  });

  test('SEO honesto: sin datos de buscador ni de tráfico orgánico no estima mejoras; los umbrales son configurables y no es un rastreo (eso es del Agente 12)', () => {
    const { informe } = auditarSEO({ motor, fuentes: fx(), ahora: AHORA_MK });
    const nd = informe.hallazgos.find((x) => x.regla === 'datos_no_disponibles').evidencia.metricas.map((x) => x.metrica);
    for (const k of ['posiciones_impresiones_y_clics_en_buscadores', 'trafico_organico_real', 'estado_tecnico_de_las_paginas_publicadas']) assert.ok(nd.includes(k), k);
    assert.ok(informe.limitaciones.some((x) => /no rastrea páginas ni consulta buscadores/.test(x)));
    assert.ok(informe.limitaciones.some((x) => /no estima ninguna mejora de tráfico|no se estima ninguna mejora de tráfico/.test(x)));
    const laxo = auditarSEO({ motor, fuentes: fx(), ahora: AHORA_MK, umbrales: { titulo: { min: 5, max: 200 } } }).informe;
    assert.equal(laxo.hallazgos.some((x) => x.regla === 'seo_titulo_largo' || x.regla === 'seo_titulo_corto'), false);
    const vacio = auditarSEO({ motor, fuentes: { productos: [], categorias: [] }, ahora: AHORA_MK }).informe;
    assert.equal(vacio.completo, false);
    assert.equal(vacio.resumen.estadoCalidad, 'sin_datos');
  });

  test('puro y determinista: las mismas fuentes dan el mismo informe y las fuentes no se modifican', () => {
    const f = fx();
    const antes = sha256(canonico(f));
    const a = planificarCampanas({ motor, fuentes: f, ahora: AHORA_MK });
    const b = planificarCampanas({ motor, fuentes: f, ahora: AHORA_MK });
    assert.deepEqual(a.informe, b.informe);
    const s1 = auditarSEO({ motor, fuentes: f, ahora: AHORA_MK });
    const s2 = auditarSEO({ motor, fuentes: f, ahora: AHORA_MK });
    assert.deepEqual(s1.informe, s2.informe);
    const br = redactarBrief({ motor, campana: a.campanas[1], fuentes: f, ahora: AHORA_MK });
    assert.deepEqual(br, redactarBrief({ motor, campana: a.campanas[1], fuentes: f, ahora: AHORA_MK }));
    assert.equal(sha256(canonico(f)), antes);
    const g = fx(); g.productos.find((p) => p.id === 'inf-portatil').price = 700;
    assert.notEqual(planificarCampanas({ motor, fuentes: g, ahora: AHORA_MK }).informe.fuente.firma, a.informe.fuente.firma);
  });

  test('propuesta de capacidades del 07: archivo aparte NO aprobado con niveles, alcances, dependencias y límites; el registro no la conoce y publicar, enviar e invertir son L4 humano', () => {
    const prop = JSON.parse(fs.readFileSync(path.join(AQUI, '..', 'agentes', 'marketing', 'propuesta-capacidades-07.json'), 'utf8'));
    assert.equal(prop.estado, 'propuesta_no_aprobada');
    assert.match(prop.aviso, /NO forma parte del registro/);
    assert.deepEqual(prop.fichaOriginal.alcancesPrevistos, ['research:write', 'drafts:write']);
    const reg = cargarRegistro();
    for (const c of prop.capacidadesPropuestas) {
      if (c.nivel === 'L3') assert.ok(!reg.buscarCapacidad(c.id), `${c.id} (L3) sigue bloqueada: no debe estar en el registro`);
      else assert.equal(reg.buscarCapacidad(c.id).nivelRiesgo, c.nivel, `${c.id} autorizada con el nivel propuesto`);
      assert.match(c.nivel, /^L[0-4]$/);
      assert.ok(Array.isArray(c.alcances) && Array.isArray(c.dependencias) && Array.isArray(c.limites), c.id);
      assert.ok(!['L4'].includes(c.nivel), 'ninguna capacidad del agente es L4');
    }
    const escritura = prop.capacidadesPropuestas.filter((c) => c.alcances.length);
    assert.deepEqual(escritura.map((c) => c.alcances[0]).sort(), ['drafts:write', 'research:write']);
    assert.ok(escritura.every((c) => c.nivel === 'L3' && c.requiereAprobacion === true));
    assert.deepEqual(prop.accionesQueNuncaSeranCapacidadDelAgente.map((a) => a.nivel), ['L4', 'L4', 'L4', 'L4']);
    assert.ok(prop.accionesQueNuncaSeranCapacidadDelAgente.some((a) => /enviar emails/.test(a.accion) && /RGPD\/LSSI/.test(a.nota)));
    assert.ok(prop.decisionesPendientes.length >= 4);
  });

  test('registro: el 07 tiene EXACTAMENTE las cuatro capacidades autorizadas (L1, L1, L1, L0, sin alcances) y las dos L3 siguen bloqueadas; publicar, enviar e invertir son L4 humano', async () => {
    const reg = cargarRegistro();
    assert.equal(reg.agente('07').estado, 'construido_local');
    assert.deepEqual(reg.capacidadesDe('07').map((c) => [c.id, c.nivelRiesgo, c.disponibilidad, c.alcances.length, c.efectos]).sort(), [['07.auditar-seo-contenido', 'L1', 'propuesta_f1', 0, 'ninguno'], ['07.proponer-plan-campanas', 'L1', 'propuesta_f1', 0, 'ninguno'], ['07.redactar-briefs', 'L1', 'propuesta_f1', 0, 'ninguno'], ['07.revisar-texto-publicitario', 'L0', 'lectura_f1', 0, 'ninguno']]);
    for (const bloqueada of ['07.guardar-borrador-campana', '07.registrar-investigacion']) assert.ok(!reg.buscarCapacidad(bloqueada), bloqueada);
    for (const t of ['Envía el email de Black Friday a los usuarios', 'Publica la campaña de Black Friday', 'Lanza la campaña de Black Friday', 'Invierte 500 euros en anuncios']) assert.equal(interpretar(t).tipo, 'accion_humana', t);
  });

  test('no se toca nada real: ni src/, ni archivos de marketing o usuarios, ni workflows; todo el trabajo queda en memoria', () => {
    const wf = hashWorkflows();
    const reales = ['marketing-email-config.json', 'marketing-leads.json', 'radar-users.json', 'products.json', 'categories.json'].map((f) => path.join(RAIZ, 'src', 'data', f));
    const antes = reales.map((f) => (fs.existsSync(f) ? `${fs.statSync(f).mtimeMs}:${fs.statSync(f).size}` : null));
    const p = plan(); redactarBrief({ motor, campana: p.campanas[1], fuentes: fx(), ahora: AHORA_MK }); auditarSEO({ motor, fuentes: fx(), ahora: AHORA_MK });
    assert.deepEqual(reales.map((f) => (fs.existsSync(f) ? `${fs.statSync(f).mtimeMs}:${fs.statSync(f).size}` : null)), antes);
    assert.equal(hashWorkflows(), wf);
  });
}
