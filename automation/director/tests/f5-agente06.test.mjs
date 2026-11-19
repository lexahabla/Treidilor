// Agente 06 · Diseñador de categorías, portada e historias (capa de PROPUESTA sobre la portada editable EXISTENTE; fixtures sintéticos; nunca publica ni toca la portada real).
// Los módulos existentes son TypeScript: sin el cargador del proyecto, este archivo se relanza solo en un subproceso con él.
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
  test('Agente 06: las pruebas se ejecutan en un subproceso con el cargador de TypeScript del proyecto', () => {
    const r = spawnSync(process.execPath, ['--experimental-transform-types', '--import', './scripts/register-ts.mjs', '--test', fileURLToPath(import.meta.url)], { cwd: RAIZ, encoding: 'utf8', timeout: 240000, env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')) });
    const pasan = Number((/ℹ pass (\d+)/.exec(r.stdout) || [])[1] || 0);
    const fallan = Number((/ℹ fail (\d+)/.exec(r.stdout) || [])[1] || 0);
    assert.equal(r.status, 0, r.stdout.slice(-4000));
    assert.equal(fallan, 0);
    assert.ok(pasan >= 16, `se esperaban ≥ 16 pruebas del Agente 06 y pasaron ${pasan}`);
  });
} else {
  const { cargarMotorPortada, construirFuentes, proponerPortada, analizarCategorias } = await import('../agentes/portada/portada.mjs');
  const { construirDatosPortada } = await import('../agentes/portada/fixtures.mjs');
  const { validarInformeAgente, canonico, sha256 } = await import('../protocolo.mjs');
  const { validarEsquema } = await import('../../../scripts/automation/validate-schema.mjs');
  const { cargarRegistro, crearRegistro, evaluarAsignacion } = await import('../registro.mjs');
  const { crearEntorno } = await import('../evaluacion/entorno.mjs');
  const { interpretar, RIESGO_POR_TIPO, TIPOS_SUELO } = await import('../intencion.mjs');
  const { PARAMETROS_ADMITIDOS } = await import('../llm/esquema-intencion.mjs');

  const motor = await cargarMotorPortada();
  const AH = Date.parse('2026-11-14T12:00:00.000Z');
  const ESQ = JSON.parse(fs.readFileSync(path.join(AQUI, '..', '..', 'schemas', 'informe-agente.schema.json'), 'utf8'));
  const datos = (mut) => { const d = construirDatosPortada(AH); if (mut) mut(d); return d; };
  const proponer = (d = datos(), extra = {}) => proponerPortada({ motor, fuentes: construirFuentes(motor, d), productosBrutos: d.productos, ahora: AH, ...extra });
  const de = (informe, regla) => informe.hallazgos.filter((h) => h.regla === regla);
  const tmpDatos = (d = datos()) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-por-')); const f = path.join(dir, 'd.json'); fs.writeFileSync(f, JSON.stringify({ sintetico: true, ...d })); return { dir, f }; };
  const entorno = (extra = {}) => { const c = tmpDatos(extra.datos); const E = crearEntorno({ motorPortada: motor, rutaDatosPortada: c.f, ...extra }); const l = E.limpiar; E.limpiar = () => { l(); fs.rmSync(c.dir, { recursive: true, force: true }); }; return E; };
  const sandbox = (E, f) => path.join(E.ledgerDir, 'sandbox-portada', f);
  const hashWorkflows = () => { const d = path.join(RAIZ, 'automation', 'workflows'); return crypto.createHash('sha256').update(fs.readdirSync(d).sort().map((f) => `${f}:${fs.readFileSync(path.join(d, f), 'utf8')}`).join('|')).digest('hex'); };
  const informe05 = (ids) => ({ esquema: 'informe-agente/1', agente: '05', idEjecucion: 'pr-prueba01', fuente: { origenDatos: 'datos_de_prueba' }, hallazgos: ids.map((e, i) => ({ clave: `k${i}`, regla: 'oportunidad_ahorro', certeza: 'confirmado', elemento: e, evidencia: {} })) });

  test('reutiliza los módulos EXISTENTES de portada editable (no hay otro editor ni otro sistema de categorías) y no reimplementa sus funciones; el módulo de propuesta no escribe ni usa la red', () => {
    for (const f of ['initialLayout.ts', 'validate.ts', 'resolve.ts', 'initialStories.ts', 'stories.ts', 'draft.ts', 'draftBackups.ts', 'publish.ts']) assert.ok(fs.existsSync(path.join(RAIZ, 'src', 'lib', 'homeLayout', f)), f);
    for (const k of ['initial', 'validate', 'resolve', 'initStories', 'stories', 'draft', 'backups', 'publish', 'claims']) assert.ok(motor[k], k);
    assert.equal(typeof motor.initial.buildInitialBlocks, 'function');
    const src = fs.readFileSync(path.join(AQUI, '..', 'agentes', 'portada', 'portada.mjs'), 'utf8');
    for (const f of ['buildInitialBlocks', 'deriveInitialContext', 'validateBlocks', 'resolveBlocks', 'buildInitialStories', 'checkStories', 'prepareDraftSave', 'protectDraft', 'planRestoreBackup', 'diffBlocks', 'prepareStoriesSave']) assert.ok(src.includes(f), `usa ${f}`);
    assert.equal(/\bfetch\(|node:http|node:https|node:net|child_process|writeFile|appendFile|unlink|rmSync|rename\(/.test(src), false);
    assert.equal(/function\s+(buildInitialBlocks|deriveInitialContext|validateBlocks|resolveBlocks|buildInitialStories|checkStories|prepareDraftSave|protectDraft|planRestoreBackup|diffBlocks)/.test(src), false, 'no copia las funciones existentes');
    assert.equal(fs.existsSync(path.join(RAIZ, 'src', 'lib', 'disenadorPortada.ts')), false);
  });

  test('la propuesta de bloques supera la validación EXISTENTE, se resuelve contra las fuentes y se muestra con los datos disponibles (nada se publica)', () => {
    const { informe, propuesta } = proponer();
    assert.equal(propuesta.esquema, 'propuesta-portada/1');
    const v = motor.validate.validateBlocks(propuesta.blocks);
    assert.equal(v.ok, true);
    assert.equal(propuesta.blocks.length, 10);
    assert.equal(informe.resumen.bloques, 10);
    assert.equal(informe.resumen.bloquesVisibles, 10);
    assert.equal(informe.completo, true);
    for (const b of de(informe, 'bloque_propuesto')) assert.equal(b.evidencia.visible, true);
    assert.ok(de(informe, 'bloque_propuesto').every((b) => b.evidencia.origen === 'diseno_existente_maqueta_v4'));
    assert.equal(informe.persistencia.escritura, 'no_procede');
  });

  test('honestidad: el informe cumple informe-agente/1, rotula los datos de prueba y declara suposiciones y limitaciones (no es una predicción ni una publicación)', () => {
    const { informe } = proponer();
    const v = validarInformeAgente(informe);
    assert.equal(v.ok, true, JSON.stringify(v.errores || v));
    assert.deepEqual(validarEsquema(ESQ, informe), []);
    assert.equal(informe.fuente.origenDatos, 'datos_de_prueba');
    assert.ok(informe.limitaciones.some((x) => /DATOS DE PRUEBA/.test(x)));
    assert.ok(informe.limitaciones.some((x) => /no se guarda, no se publica ni se activa/.test(x)));
    assert.ok(informe.limitaciones.some((x) => /L4 humano/.test(x)));
    assert.ok(de(informe, 'suposicion').length >= 3);
    assert.match(informe.hallazgos.find((h) => h.regla === 'propuesta_categoria').accionSugerida, /L4 humano/);
    const real = proponer(datos(), { sintetico: false }).informe;
    assert.equal(real.fuente.origenDatos, 'exportacion');
    assert.equal(real.limitaciones.some((x) => /DATOS DE PRUEBA/.test(x)), false);
  });

  test('visibilidad: con pocos productos presentables los bloques NO se muestran y se avisa (no se fuerza ninguno); la falta de stock nunca oculta', () => {
    const poca = datos((d) => { d.productos = d.productos.filter((p) => ['son-1', 'son-3'].includes(p.id)); d.categorias = d.categorias.filter((c) => ['sonido'].includes(c.id)); });
    const { informe } = proponer(poca);
    assert.ok(informe.resumen.bloquesOcultos > 0);
    assert.ok(de(informe, 'bloque_propuesto').some((b) => b.evidencia.visible === false && b.certeza === 'advertencia'));
    const conAgotado = proponer(datos((d) => { for (const p of d.productos) p.inStock = false; })).informe;
    assert.equal(conAgotado.resumen.bloquesVisibles, 10, 'sin stock sigue visible');
  });

  test('historias: las del generador existente, SIEMPRE como borrador, sin errores de referencias y la de «Bajadas» solo con descuentos VERIFICADOS', () => {
    const { informe, propuesta } = proponer();
    assert.equal(propuesta.stories.length, 6);
    assert.ok(propuesta.stories.every((s) => s.status === 'borrador'));
    assert.equal(de(informe, 'incidencia_historia').filter((h) => h.certeza === 'confirmado').length, 0);
    const bajadas = de(informe, 'historia_propuesta').find((h) => h.elemento === 'bajadas');
    assert.deepEqual([...bajadas.evidencia.productos].sort(), ['inf-1', 'inf-3', 'son-1'].sort());
    assert.ok(!bajadas.evidencia.productos.includes('son-4'), 'un descuento solo declarado no se presenta');
    assert.equal(motor.stories.validateStories(propuesta.stories).ok, true);
  });

  test('categorías: detecta categoría vacía, sin subcategorías, subcategoría con un producto, padre inexistente y producto con categoría inválida (todo informativo, L4 humano)', () => {
    const { informe } = proponer();
    const reglas = de(informe, 'propuesta_categoria').map((h) => `${h.evidencia.texto.slice(0, 0)}${h.clave}`);
    for (const k of ['categoria:categoria_vacia:jardin', 'categoria:categoria_sin_subcategorias:informatica', 'categoria:subcategoria_con_un_producto:portabilidad--powerbanks', 'categoria:categoria_huerfana:huerfana']) assert.ok(reglas.includes(k), k);
    assert.ok(reglas.some((k) => k.startsWith('categoria:producto_con_categoria_invalida')));
    for (const h of de(informe, 'propuesta_categoria')) { assert.equal(h.evidencia.requiereAutorizacion, true); assert.equal(h.evidencia.nivel, 'L4'); }
    assert.equal(informe.resumen.propuestasCategorias, de(informe, 'propuesta_categoria').length);
    const inf = de(informe, 'propuesta_categoria').find((h) => h.clave.includes('sin_subcategorias'));
    assert.equal(inf.evidencia.productos, 14);
  });

  test('integración con el Agente 05: solo entran productos con oportunidad CONFIRMADA que existan y sean presentables; ids inexistentes, retirados o sin precio se descartan', () => {
    const sin = proponer().propuesta.blocks;
    assert.equal(sin.some((b) => b.id === 'oportunidades'), false, 'sin informe del 05 no hay bloque');
    const ok = proponer(datos(), { informes: [informe05(['inf-1', 'son-1', 'hog-1', 'no-existe', 'retirado-1', 'sin-precio'])] });
    const b = ok.propuesta.blocks.find((x) => x.id === 'oportunidades');
    assert.deepEqual(b.refs.map((r) => r.id), ['inf-1', 'son-1', 'hog-1']);
    assert.ok(ok.informe.hallazgos.some((h) => h.regla === 'suposicion' && /Agente 05/.test(h.evidencia.texto) && /datos de prueba/.test(h.evidencia.texto)));
    const pocos = proponer(datos(), { informes: [informe05(['inf-1'])] });
    assert.equal(pocos.propuesta.blocks.some((x) => x.id === 'oportunidades'), false);
    assert.ok(pocos.informe.hallazgos.some((h) => /no aporta al menos 2/.test(h.evidencia.texto || '')));
    const noConf = informe05(['inf-1', 'son-1']); noConf.hallazgos.forEach((h) => { h.certeza = 'advertencia'; });
    assert.equal(proponer(datos(), { informes: [noConf] }).propuesta.blocks.some((x) => x.id === 'oportunidades'), false);
  });

  test('determinista y de solo lectura: misma entrada → misma huella; las fuentes no se modifican', () => {
    const d = datos();
    const f = construirFuentes(motor, d);
    const antes = sha256(canonico({ p: [...f.products.values()], c: [...f.categories.values()] }));
    const a = proponerPortada({ motor, fuentes: f, productosBrutos: d.productos, ahora: AH });
    const b = proponerPortada({ motor, fuentes: f, productosBrutos: d.productos, ahora: AH });
    assert.equal(a.huellaPropuesta, b.huellaPropuesta);
    assert.equal(sha256(canonico({ p: [...f.products.values()], c: [...f.categories.values()] })), antes);
    const cambiada = proponer(datos((x) => { x.productos.find((p) => p.id === 'hog-1').price = 5; }));
    assert.notEqual(cambiada.huellaPropuesta, a.huellaPropuesta);
    assert.deepEqual(analizarCategorias(f).map((x) => x.regla), analizarCategorias(f).map((x) => x.regla));
  });

  test('Director L1: «Propón una portada» crea una tarea verificada (huella), guarda la propuesta por referencia y NO guarda, publica ni activa nada', async () => {
    const E = entorno();
    const wf = hashWorkflows();
    const r = await E.pregunta('Propón una portada nueva con historias');
    assert.equal(r.categoria, 'propuesta');
    assert.match(r.texto, /no guardo, no publico ni activo nada/);
    assert.match(r.texto, /Referencia de la propuesta: sha256:[0-9a-f]{64}/);
    assert.match(r.texto, /DATOS DE PRUEBA/);
    assert.match(r.texto, /Verificado/);
    assert.equal(r.aprobaciones.length, 0);
    assert.deepEqual(E.tareas()[0].historial.map((h) => h.estado), ['creada', 'aceptada', 'en_curso', 'completada']);
    assert.equal(E.tareas()[0].capacidad, '06.proponer-portada');
    assert.equal(fs.existsSync(path.join(E.ledgerDir, 'sandbox-portada')), false, 'ningún borrador guardado');
    assert.equal(fs.existsSync(path.join(RAIZ, 'src', 'data', 'home-layout.json')), false);
    assert.equal(hashWorkflows(), wf);
    assert.equal(E.ledger.verificarCadena().ok, true);
    E.limpiar();
  });

  test('Director L3 simulado: pide aprobación ligada a la propuesta, no escribe antes de aprobar, guarda solo en el área privada, con evidencia y verificación; la aprobación no se reutiliza', async () => {
    const E = entorno();
    assert.match((await E.pregunta('Prepara una propuesta de portada')).texto, /sha256:/);
    const r = await E.pregunta('Guarda la propuesta como borrador');
    assert.equal(r.categoria, 'pendiente');
    assert.match(r.texto, /SIMULADO/);
    assert.match(r.texto, /Vista previa: \d+ cambio\(s\)/);
    assert.match(r.texto, /L4 humano/);
    const a = E.aprobaciones()[0];
    assert.equal(a.nivel, 'L3');
    assert.equal(fs.existsSync(path.join(E.ledgerDir, 'sandbox-portada')), false, 'nada se escribe antes de aprobar');
    assert.equal(E.tipos().filter((x) => x === 'delegacion_simulada').length, 0);
    const x = E.d.resolverAprobacion(a.idAprobacion, 'aprobada', {});
    assert.equal(x.estado, 'ejecutada_local');
    assert.equal(x.confirmada, true);
    assert.match(x.texto, /guardado SIMULADO/);
    const layout = JSON.parse(fs.readFileSync(sandbox(E, 'layout.json'), 'utf8'));
    assert.equal(motor.validate.validateDocument(layout).ok, true);
    assert.equal(layout.draft.blocks.length, 10);
    assert.equal(layout.published, null, 'nunca publicado');
    assert.equal(layout.activation && layout.activation.enabled, false);
    assert.deepEqual(E.tareas().find((t) => t.capacidad === '06.guardar-borrador-portada').historial.map((h) => h.estado), ['creada', 'esperando_aprobacion', 'aceptada', 'en_curso', 'completada']);
    assert.equal(E.eventos('delegacion_simulada')[0].datos.enviado, false);
    assert.equal(E.proy().aprobaciones.get(a.idAprobacion).estado, 'consumida');
    assert.equal(E.d.resolverAprobacion(a.idAprobacion, 'aprobada', {}).error.codigo, 'aprobacion_no_coincide');
    assert.equal(E.ledger.verificarCadena().ok, true);
    E.limpiar();
  });

  test('copia previa y DESHACER: un segundo guardado conserva el borrador anterior como copia y deshacer lo restaura; el primero deshace a «vacío»', async () => {
    const E = entorno();
    await E.pregunta('Propón una portada');
    const a1 = (await E.pregunta('Guarda la propuesta como borrador')).aprobaciones[0];
    const g1 = E.d.resolverAprobacion(a1, 'aprobada', {});
    assert.equal(g1.idCopia, null, 'el borrador anterior estaba vacío');
    const bloques1 = JSON.parse(fs.readFileSync(sandbox(E, 'layout.json'), 'utf8')).draft.blocks;
    // segunda propuesta distinta (otras fuentes) → otro borrador
    E.d.rutaDatosPortada = (() => { const c = tmpDatos(datos((d) => { d.productos = d.productos.filter((p) => !p.id.startsWith('hog-')); d.categorias = d.categorias.filter((c) => c.id !== 'hogar'); })); return c.f; })();
    await E.pregunta('Propón una portada');
    const a2 = (await E.pregunta('Guarda la propuesta como borrador')).aprobaciones[0];
    const g2 = E.d.resolverAprobacion(a2, 'aprobada', {});
    assert.equal(g2.estado, 'ejecutada_local');
    assert.ok(g2.idCopia, 'copia previa creada');
    const respaldo = JSON.parse(fs.readFileSync(sandbox(E, 'backups.json'), 'utf8'));
    assert.equal(respaldo.backups.length, 1);
    assert.deepEqual(respaldo.backups[0].blocks, bloques1);
    const u = E.d.deshacerBorradorPortada({});
    assert.equal(u.ok, true);
    assert.equal(u.restauraCopia, g2.idCopia);
    assert.deepEqual(JSON.parse(fs.readFileSync(sandbox(E, 'layout.json'), 'utf8')).draft.blocks, bloques1);
    assert.equal(E.eventos('ejecucion_humana_confirmada').length, 1);
    assert.throws(() => E.d.deshacerBorradorPortada({}), (e) => e.error.codigo === 'origen_no_disponible', 'no se deshace dos veces');
    E.limpiar();
    const F = entorno();
    await F.pregunta('Propón una portada');
    F.d.resolverAprobacion((await F.pregunta('Guarda la propuesta como borrador')).aprobaciones[0], 'aprobada', {});
    F.d.deshacerBorradorPortada({});
    assert.deepEqual(JSON.parse(fs.readFileSync(sandbox(F, 'layout.json'), 'utf8')).draft.blocks, []);
    F.limpiar();
  });

  test('la huella de la aprobación queda ligada a la propuesta exacta; sin propuesta previa no hay solicitud y una propuesta alterada se rechaza', async () => {
    const E = entorno();
    const sin = await E.pregunta('Guarda la propuesta como borrador');
    assert.equal(sin.estado, 'aclaracion');
    assert.equal(E.tareas().length, 0);
    const p1 = (await E.pregunta('Propón una portada')).texto.match(/sha256:[0-9a-f]{64}/)[0];
    const s1 = await E.pregunta('Guarda la propuesta como borrador');
    const h1 = E.aprobaciones()[0].huella;
    E.d.resolverAprobacion(s1.aprobaciones[0], 'rechazada', { motivo: 'prueba' });
    assert.equal(E.proy().aprobaciones.get(s1.aprobaciones[0]).estado, 'rechazada');
    assert.equal(fs.existsSync(path.join(E.ledgerDir, 'sandbox-portada')), false, 'rechazar no escribe');
    const dir = path.join(E.ledgerDir, 'propuestas');
    const f = path.join(dir, `${p1.slice(7)}.json`);
    E.d._propuestas.clear();
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('"borrador"', '"publicada"'));
    assert.throws(() => E.d._leerPropuesta(p1), (e) => e.error.codigo === 'origen_no_disponible');
    assert.ok(h1);
    E.limpiar();
  });

  test('publicar, activar o reorganizar categorías NUNCA es una capacidad del agente: es L4 humano; el registro solo le da L1 y un L3 reversible sin alcances de escritura', async () => {
    const reg = cargarRegistro();
    const caps = reg.capacidadesDe('06');
    assert.deepEqual(caps.map((c) => [c.id, c.nivelRiesgo, c.disponibilidad]).sort(), [['06.guardar-borrador-portada', 'L3', 'simulacion_local'], ['06.proponer-portada', 'L1', 'propuesta_f1']]);
    assert.ok(caps.every((c) => c.alcances.length === 0));
    assert.equal(reg.agente('06').estado, 'construido_local');
    const E = entorno();
    for (const t of ['Publica la portada', 'Activa la portada nueva', 'Reorganiza las categorías y publícalo', 'Borra la portada']) {
      const r = await E.pregunta(t);
      assert.equal(r.categoria, 'consulta');
      assert.match(r.texto, /L4/);
    }
    assert.equal(E.tareas().length, 0);
    assert.match((await E.pregunta('Publica la portada')).texto, /publicación y la activación las haces tú en el panel/);
    assert.equal(RIESGO_POR_TIPO.proponer_portada, 'L1');
    assert.equal(RIESGO_POR_TIPO.guardar_borrador_portada, 'L3');
    assert.equal(RIESGO_POR_TIPO.accion_humana, 'L4');
    assert.ok(TIPOS_SUELO.includes('accion_humana'));
    assert.equal(PARAMETROS_ADMITIDOS.propuestaRef, 'ref');
    assert.equal(interpretar('Publica el borrador de portada').tipo, 'accion_humana');
    assert.equal(interpretar('Guarda la propuesta de portada como borrador').tipo, 'guardar_borrador_portada');
    E.limpiar();
  });

  test('parada de emergencia, ledger caído y agente no operativo: no se crea ninguna tarea ni se escribe nada', async () => {
    const E = entorno();
    E.d.paradaEmergencia('prueba');
    assert.match((await E.pregunta('Propón una portada')).texto, /parada_emergencia/);
    E.d.reanudar();
    await E.pregunta('Propón una portada');
    const ap = (await E.pregunta('Guarda la propuesta como borrador')).aprobaciones[0];
    E.d.paradaEmergencia('prueba2');
    assert.throws(() => E.d.resolverAprobacion(ap, 'aprobada', {}), (e) => e.error.codigo === 'parada_emergencia');
    assert.equal(fs.existsSync(path.join(E.ledgerDir, 'sandbox-portada')), false);
    E.d.reanudar();
    E.ledger._escribirLinea = () => { const e = new Error('x'); e.code = 'EIO'; throw e; };
    const r = await E.pregunta('Propón una portada');
    assert.equal(r.registrada, false);
    delete E.ledger._escribirLinea;
    E.limpiar();
    const d = JSON.parse(JSON.stringify(cargarRegistro().datos));
    d.agentes.find((a) => a.id === '06').estado = 'planificado';
    for (const c of d.capacidades) if (c.agente === '06') { c.disponibilidad = 'planificada'; c.motivoNoDisponible = 'planificado'; }
    const F = entorno({ registro: crearRegistro(d) });
    const n = await F.pregunta('Propón una portada');
    assert.match(n.texto, /agente_no_operativo/);
    assert.equal(F.tareas().length, 0);
    F.limpiar();
  });

  test('sin datos de referencia o sin los módulos existentes el agente lo DECLARA y no finge; un borrador corrupto del área privada NO se sobrescribe', async () => {
    const A = crearEntorno({ motorPortada: motor, rutaDatosPortada: null });
    await A.pregunta('Propón una portada');
    assert.equal(A.tareas().at(-1).estado, 'fallida');
    assert.match(A.eventos('tarea_estado').at(-1).datos.detalle, /No hay datos de referencia/);
    A.limpiar();
    const B = crearEntorno({ motorPortada: null });
    const rb = await B.pregunta('Propón una portada');
    assert.match(rb.texto, /origen_no_disponible/);
    B.limpiar();
    const E = entorno();
    await E.pregunta('Propón una portada');
    const ap = (await E.pregunta('Guarda la propuesta como borrador')).aprobaciones[0];
    fs.mkdirSync(path.join(E.ledgerDir, 'sandbox-portada'), { recursive: true });
    fs.writeFileSync(sandbox(E, 'layout.json'), '{no es json');
    const x = E.d.resolverAprobacion(ap, 'aprobada', {});
    assert.equal(x.estado, 'fallida');
    assert.equal(fs.readFileSync(sandbox(E, 'layout.json'), 'utf8'), '{no es json', 'se conserva sin sobrescribir');
    assert.equal(E.tareas().find((t) => t.capacidad === '06.guardar-borrador-portada').estado, 'fallida');
    E.limpiar();
  });

  test('el cerebro (proveedor simulado) no relaja L4 ni salta la aprobación: «publica la portada» sigue siendo acción humana y «guarda como borrador» exige aprobación', async () => {
    const E = entorno();
    const r = await E.pregunta('Publica la portada ahora mismo');
    assert.equal(r.categoria, 'consulta');
    assert.equal(E.aprobaciones().length, 0);
    await E.pregunta('Propón una portada');
    const g = await E.pregunta('Deja un borrador de portada');
    assert.equal(g.categoria, 'pendiente');
    assert.equal(E.aprobaciones()[0].estado, 'pendiente');
    assert.equal(fs.existsSync(path.join(E.ledgerDir, 'sandbox-portada')), false);
    E.limpiar();
  });

  test('no se tocan src/, workflows ni datos reales: los archivos de la portada real no existen ni cambian tras todo el flujo', async () => {
    const wf = hashWorkflows();
    const reales = ['home-layout.json', 'home-stories.json', 'home-layout-activation.json', 'home-layout-draft-backups.json', 'categories.json'].map((f) => path.join(RAIZ, 'src', 'data', f));
    const antes = reales.map((f) => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : null));
    const E = entorno();
    await E.pregunta('Propón una portada');
    E.d.resolverAprobacion((await E.pregunta('Guarda la propuesta como borrador')).aprobaciones[0], 'aprobada', {});
    E.d.deshacerBorradorPortada({});
    assert.deepEqual(reales.map((f) => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : null)), antes);
    assert.equal(hashWorkflows(), wf);
    E.limpiar();
  });
}
