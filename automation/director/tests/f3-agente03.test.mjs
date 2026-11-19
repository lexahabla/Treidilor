// Agente 03 · Importador (capa de inteligencia y coordinación sobre el MOTOR EXISTENTE; fixtures sintéticos, sin red, sin escribir el catálogo).
// El motor (TypeScript) necesita el cargador del proyecto: si no está activo, este archivo se vuelve a ejecutar solo en un subproceso con él.
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
  test('Agente 03: las pruebas se ejecutan en un subproceso con el cargador de TypeScript del proyecto (el motor de importación es TS)', () => {
    const r = spawnSync(process.execPath, ['--experimental-transform-types', '--import', './scripts/register-ts.mjs', '--test', fileURLToPath(import.meta.url)], { cwd: RAIZ, encoding: 'utf8', timeout: 240000, env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')) });
    const pasan = Number((/ℹ pass (\d+)/.exec(r.stdout) || [])[1] || 0);
    const fallan = Number((/ℹ fail (\d+)/.exec(r.stdout) || [])[1] || 0);
    assert.equal(r.status, 0, r.stdout.slice(-4000));
    assert.equal(fallan, 0);
    assert.ok(pasan >= 18, `se esperaban ≥ 18 pruebas del Agente 03 y pasaron ${pasan}`);
  });
} else {
  const { cargarMotor, identificarEntrada, simularImportacion, construirInforme, analizarImportacion, prepararSolicitudAutorizacion } = await import('../agentes/importador/importador.mjs');
  const { LOTE_EJEMPLO, amazon, temu, ebay, aliexpress, construirCatalogoSintetico } = await import('../agentes/importador/fixtures.mjs');
  const { validarInformeAgente } = await import('../protocolo.mjs');
  const { validarEsquema } = await import('../../../scripts/automation/validate-schema.mjs');
  const { cargarRegistro, evaluarAsignacion } = await import('../registro.mjs');
  const { crearEntorno, AHORA } = await import('../evaluacion/entorno.mjs');
  const { interpretar, extraerEntradaImportacion } = await import('../intencion.mjs');

  const motor = await cargarMotor();
  const ESQ = JSON.parse(fs.readFileSync(path.join(AQUI, '..', '..', 'schemas', 'informe-agente.schema.json'), 'utf8'));
  const huella = (x) => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
  const catalogo = () => construirCatalogoSintetico(motor);
  const lote = () => JSON.stringify(LOTE_EJEMPLO());
  const tmpCat = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-imp-')); const f = path.join(d, 'cat.json'); fs.writeFileSync(f, JSON.stringify({ sintetico: true, productos: catalogo() })); return { d, f }; };
  const entornoImp = (extra = {}) => { const c = tmpCat(); const E = crearEntorno({ motorImportacion: motor, rutaCatalogoImportacion: c.f, ...extra }); const limpiar = E.limpiar; E.limpiar = () => { limpiar(); fs.rmSync(c.d, { recursive: true, force: true }); }; return E; };

  test('el motor existente se carga (no hay un segundo sistema de importación) y el módulo no reimplementa identidad, normalización ni escritura', () => {
    assert.equal(typeof motor.engine.runImport, 'function');
    assert.equal(typeof motor.normalize.extractRecords, 'function');
    const src = fs.readFileSync(path.join(AQUI, '..', 'agentes', 'importador', 'importador.mjs'), 'utf8');
    assert.match(src, /runImport\(/);
    assert.equal(/\bfetch\(|node:http|node:https|node:net|child_process|writeFile|appendFile|unlink|rmSync|rename\(/.test(src), false, 'sin red ni escritura');
    assert.equal(/validGtin|computeOfferKey|mergeReimport|normalizeBrand|function\s+(normalizar|fusionar|importar|mergeProducto)/i.test(src), false, 'no reimplementa la lógica del motor');
    for (const f of ['jsonImport/engine.ts', 'jsonImport/normalize.ts']) assert.ok(fs.existsSync(path.join(RAIZ, 'src', 'lib', f)), `${f} existe y no se ha duplicado`);
    assert.equal(fs.existsSync(path.join(RAIZ, 'src', 'lib', 'importador.ts')), false);
  });

  test('identificar plataforma y tipo de entrada: ASIN, URL de producto y de categoría por plataforma, enlace corto de Temu, JSON y entradas no reconocidas', () => {
    const t = (e) => identificarEntrada(e, motor);
    assert.deepEqual([t('B09XS7JWHH').tipo, t('b09xs7jwhh').id], ['asin', 'B09XS7JWHH']);
    assert.deepEqual([t('https://www.amazon.es/dp/B09XS7JWHH?tag=x').tipo, t('https://www.amazon.es/dp/B09XS7JWHH?tag=x').id], ['url_producto', 'B09XS7JWHH']);
    assert.equal(t('https://www.amazon.es/s?k=teclado&node=937912031').tipo, 'url_categoria');
    assert.deepEqual([t('https://es.aliexpress.com/item/1005006123456789.html').tipo, t('https://es.aliexpress.com/item/1005006123456789.html').id], ['url_producto', '1005006123456789']);
    assert.equal(t('https://es.aliexpress.com/category/100003109/computer.html').tipo, 'url_categoria');
    assert.equal(t('https://www.ebay.es/itm/305123456789').id, '305123456789');
    assert.equal(t('https://www.ebay.es/sch/i.html?_nkw=teclado').tipo, 'url_categoria');
    assert.equal(t('https://www.temu.com/es/x-g-601099512345.html').tipo, 'url_producto');
    assert.equal(t('https://www.temu.com/es/algo-o3-1893.html').tipo, 'url_categoria');
    assert.equal(t('https://temu.to/k/abc123').tipo, 'enlace_corto');
    assert.equal(t('https://tienda.example.com/p/1').tipo, 'url_desconocida');
    for (const e of ['B09XS7JWHH', 'https://www.amazon.es/dp/B09XS7JWHH', 'https://temu.to/k/abc']) assert.equal(t(e).requiereFuenteExterna, true, e);
    const j = t(lote());
    assert.deepEqual([j.tipo, j.registros, j.plataforma, j.requiereFuenteExterna], ['json', 5, 'varias', false]);
    assert.equal(t('[{"platform":"amazon","title":"x"}]').plataforma, 'amazon');
    assert.equal(t('{ roto').tipo, 'desconocido');
    assert.equal(t('hola').tipo, 'desconocido');
    assert.equal(t('x'.repeat(20001)).tipo, 'desconocido');
    assert.equal(t(null).tipo, 'desconocido');
    assert.match(t('[]').avisos.join(' '), /no contiene registros/);
  });

  test('simulación con el motor existente: crea, vincula entre comercios, detecta duplicados, rechaza lo inválido y manda a revisión los conflictos', () => {
    const sim = simularImportacion({ motor, catalogo: catalogo(), entrada: lote(), ahora: AHORA });
    assert.equal(sim.simulado, true);
    assert.deepEqual(sim.resultados.map((r) => r.resultado), ['sin_cambios', 'vinculada', 'creada', 'rechazada', 'revision']);
    assert.deepEqual(sim.resumen, { registros: 5, nuevas: 1, vinculadas: 1, actualizadas: 0, sinCambios: 1, revisiones: 1, rechazadas: 1, errores: 0, omitiriaConSoloNuevos: 2 });
    assert.deepEqual(sim.duplicados.map((d) => d.indice), [0, 1]);
    assert.match(sim.duplicados[1].tipo, /otro comercio/, 'mismo GTIN en Temu: vínculo entre comercios');
    assert.deepEqual(sim.conflictos.map((c) => c.indice), [4]);
    assert.ok(sim.conflictos[0].motivos.includes('identificadores_contradictorios'));
    assert.ok(sim.conflictos[0].textos.length > 0, 'motivos en español del motor');
    assert.deepEqual(sim.incidencias.map((i) => i.indice), [3]);
    assert.ok(sim.incidencias[0].motivos.includes('falta_titulo'));
  });

  test('la simulación NO modifica el catálogo de referencia y es determinista; un lote distinto cambia la huella', () => {
    const c = catalogo();
    const antes = huella(c);
    const a = simularImportacion({ motor, catalogo: c, entrada: lote(), ahora: AHORA });
    assert.equal(huella(c), antes, 'el catálogo de entrada no cambió');
    const b = simularImportacion({ motor, catalogo: catalogo(), entrada: lote(), ahora: AHORA });
    assert.equal(a.huellaLote, b.huellaLote);
    assert.equal(a.huellaCatalogo, b.huellaCatalogo);
    assert.deepEqual(a.resumen, b.resumen);
    const otro = simularImportacion({ motor, catalogo: catalogo(), entrada: JSON.stringify([ebay({ price: 91 })]), ahora: AHORA });
    assert.notEqual(otro.huellaLote, a.huellaLote);
    assert.equal(otro.resultados[0].resultado, 'actualizada', 'misma oferta con otro precio: el motor la actualizaría');
    const nuevo = simularImportacion({ motor, catalogo: [], entrada: JSON.stringify({ defaults: { category: 'Prueba' }, products: [aliexpress(), temu()] }), ahora: AHORA });
    assert.equal(nuevo.resumen.nuevas, 2);
    const sinCategoria = simularImportacion({ motor, catalogo: [], entrada: JSON.stringify([aliexpress()]), ahora: AHORA });
    assert.equal(sinCategoria.resumen.revisiones, 1, 'una ficha NUEVA sin categoría queda en revisión (regla del motor existente)');
    const mismoTitulo = simularImportacion({ motor, catalogo: catalogo(), entrada: JSON.stringify([amazon({ asin: 'B0ABCDE123', url: 'https://www.amazon.es/dp/B0ABCDE123', gtin: undefined })]), ahora: AHORA });
    assert.equal(mismoTitulo.simulado, true);
  });

  test('entradas que exigen una fuente EXTERNA (ASIN, URL, categoría, enlace corto): no se simulan ni se consultan; se declara y se propone el camino', () => {
    let llamadas = 0;
    const f = globalThis.fetch;
    globalThis.fetch = () => { llamadas += 1; throw new Error('red prohibida'); };
    try {
      for (const e of ['B09XS7JWHH', 'https://www.amazon.es/dp/B09XS7JWHH', 'https://www.temu.com/es/algo-o3-1893.html', 'https://temu.to/k/abc']) {
        const { sim, informe } = analizarImportacion({ motor, catalogo: catalogo(), entrada: e, ahora: AHORA, capacidad: '03.proponer-lote' });
        assert.equal(sim.simulado, false, e);
        assert.equal(sim.motivo, 'requiere_fuente_externa');
        assert.equal(informe.completo, false);
        const h = informe.hallazgos.find((x) => x.regla === 'entrada_requiere_fuente_externa');
        assert.ok(h && /JSON de la extracción/.test(h.accionSugerida));
        assert.ok(informe.limitaciones.some((l) => /coste: no disponible/.test(l)));
        assert.ok(!informe.hallazgos.some((x) => x.regla === 'solicitud_autorizacion'), 'sin simulación no hay solicitud de importación');
      }
    } finally { globalThis.fetch = f; }
    assert.equal(llamadas, 0, 'ni una llamada de red');
  });

  test('informe normalizado: válido por validador y por esquema, claves estables, evidencia literal, limitaciones, rótulo de datos de prueba y sin escritura', () => {
    const { informe } = analizarImportacion({ motor, catalogo: catalogo(), entrada: lote(), ahora: AHORA, capacidad: '03.simular-importacion' });
    assert.deepEqual(validarInformeAgente(informe), { ok: true, errores: [] });
    assert.deepEqual(validarEsquema(informe, ESQ), []);
    assert.equal(informe.agente, '03');
    assert.match(informe.idEjecucion, /^im-[0-9a-f]{10}$/);
    assert.equal(informe.fuente.origenDatos, 'datos_de_prueba');
    assert.equal(informe.persistencia.escritura, 'no_procede');
    const claves = informe.hallazgos.map((h) => h.clave);
    assert.equal(new Set(claves).size, claves.length);
    assert.ok(['registro:0', 'registro:4', 'duplicado:1', 'conflicto:4', 'propuesta:solicitud_autorizacion'].every((k) => claves.includes(k)));
    assert.ok(informe.limitaciones.some((l) => /única fuente de decisión/.test(l)) && informe.limitaciones.some((l) => /DATOS DE PRUEBA/.test(l)));
    assert.equal(informe.resumen.revisiones, 1);
    assert.equal(informe.completo, true);
    assert.deepEqual(analizarImportacion({ motor, catalogo: catalogo(), entrada: lote(), ahora: AHORA, capacidad: '03.simular-importacion' }).informe, informe, 'determinista');
  });

  test('solicitud de autorización de la importación REAL: se PREPARA como L4 humano, no se envía, lleva huellas y requisitos, y cambia si cambia el lote', () => {
    const sim = simularImportacion({ motor, catalogo: catalogo(), entrada: lote(), ahora: AHORA });
    const s = prepararSolicitudAutorizacion(sim);
    assert.deepEqual([s.nivelRiesgo, s.ejecutor, s.estado, s.accionAutomatica], ['L4', 'humano', 'no_enviada', false]);
    assert.equal(s.huellaLote, sim.huellaLote);
    assert.equal(s.efectosPrevistos.fichasNuevas, 1);
    assert.ok(s.requisitosPrevios.some((r) => /copia de seguridad/.test(r)) && s.requisitosPrevios.some((r) => /1 revisión/.test(r)));
    assert.ok(s.advertencias.some((a) => /no se puede deshacer/.test(a)));
    assert.match(s.canal, /interfaz autenticada/);
    const otra = prepararSolicitudAutorizacion(simularImportacion({ motor, catalogo: catalogo(), entrada: JSON.stringify([aliexpress()]), ahora: AHORA }));
    assert.notEqual(otra.huellaLote, s.huellaLote);
  });

  test('una entrada con forma de credencial se rechaza antes de analizarla', () => {
    assert.throws(() => analizarImportacion({ motor, catalogo: [], entrada: `[{"title":"x","note":"${'sk-' + 'ABCDEFGHIJKLMNOPQRSTUVWX1234'}"}]`, ahora: AHORA, capacidad: '03.proponer-lote' }), (e) => e.codigo === 'solicitud_invalida');
  });

  test('registro: el 03 pasa a «construido_local» con 03.proponer-lote (L1) y 03.simular-importacion (L2, aprobación, ejecución local pura); los niveles no cambian y los Agentes 04 y 12 siguen igual', () => {
    const r = cargarRegistro();
    assert.equal(r.agente('03').estado, 'construido_local');
    assert.deepEqual(r.capacidadesDe('03').map((c) => `${c.id}:${c.nivelRiesgo}:${c.modo}:${c.disponibilidad}`).sort(), ['03.proponer-lote:L1:propuesta:propuesta_f1', '03.simular-importacion:L2:accion:simulacion_local']);
    const sim = r.buscarCapacidad('03.simular-importacion');
    assert.equal(sim.requiereAprobacion, true);
    assert.deepEqual(sim.alcances, []);
    assert.equal(evaluarAsignacion(r, '03.simular-importacion').ejecutableEnF1, true);
    assert.ok(!r.capacidadesDe('03').some((c) => /importar|aplicar|publicar/.test(c.id)), 'la importación real NO es una capacidad del agente (L4 humano)');
    assert.equal(r.capacidadesDe('04').length, 5);
    assert.equal(r.capacidadesDe('12').length, 4);
  });

  test('interpretación: analizar/preparar/simular una importación son L1/L2 del 03; «importa…» a secas sigue siendo L4 humano', () => {
    assert.equal(interpretar('Analiza este lote de importación').tipo, 'analizar_importacion');
    assert.equal(interpretar('Prepara una propuesta de importación de estos productos').tipo, 'analizar_importacion');
    assert.equal(interpretar('Simula la importación de este JSON').tipo, 'simular_importacion');
    assert.equal(interpretar('Simula la importación de este JSON').riesgoMax, 'L2');
    assert.equal(interpretar('Importa estos 50 productos de Temu').tipo, 'accion_humana');
    assert.equal(interpretar('Importa el lote y publícalo').tipo, 'accion_humana');
    assert.equal(extraerEntradaImportacion('mira B09XS7JWHH por favor'), 'B09XS7JWHH');
    assert.equal(extraerEntradaImportacion('analiza https://www.amazon.es/dp/B09XS7JWHH?tag=x ok'), 'https://www.amazon.es/dp/B09XS7JWHH?tag=x');
    assert.equal(extraerEntradaImportacion(`analiza ${lote()} gracias`), lote());
    assert.equal(extraerEntradaImportacion('nada que importar'), null);
  });

  test('Director L1: «analizar» crea una tarea registrada con evidencia y verificación, sin aprobaciones, y el ledger guarda la entrada por REFERENCIA', async () => {
    const E = entornoImp();
    const r = await E.pregunta(`Analiza este lote de importación ${lote()}`);
    assert.equal(r.categoria, 'propuesta');
    assert.match(r.texto, /1 nueva\(s\), 1 vinculada\(s\) a otro comercio/);
    assert.match(r.texto, /CONFLICTO \[registro 4\]/);
    assert.match(r.texto, /Solicitud de autorización PREPARADA \(no enviada\)/);
    assert.match(r.texto, /Verificado: el análisis se recalculó/);
    const t = E.tareas()[0];
    assert.equal(t.capacidad, '03.proponer-lote');
    assert.deepEqual(t.historial.map((h) => h.estado), ['creada', 'aceptada', 'en_curso', 'completada']);
    assert.equal(t.verificaciones[0].resultado, 'confirmada');
    assert.match(t.parametros.entradaRef, /^sha256:/);
    assert.equal(t.parametros.entrada, undefined, 'la entrada completa no viaja en la tarea');
    assert.equal(E.aprobaciones().length, 0);
    const ev = E.eventos('intencion')[0];
    assert.match(ev.datos.parametros.entradaRef, /^sha256:/);
    assert.equal(ev.datos.parametros.entrada, undefined);
    assert.ok(E.ledger.leer().every((e) => Buffer.byteLength(JSON.stringify(e)) < 16384));
    assert.ok(!E.tipos().some((x) => ['delegacion_enviada', 'delegacion_simulada', 'aprobacion_solicitada'].includes(x)));
    E.limpiar();
  });

  test('Director L2: simular pide aprobación (huella ligada a la entrada exacta), ejecuta LOCALMENTE tras la aprobación simulada, se verifica y la aprobación no se reutiliza', async () => {
    const E = entornoImp();
    const r = await E.pregunta(`Simula la importación ${lote()}`);
    assert.equal(r.categoria, 'pendiente');
    assert.match(r.texto, /LOCALMENTE con el motor existente/);
    assert.match(r.texto, /importación REAL es L4/);
    const a = E.aprobaciones()[0];
    assert.equal(a.nivel, 'L2');
    assert.equal(sinTarea(E), false);
    assert.equal(E.tareas()[0].estado, 'esperando_aprobacion');
    assert.equal(E.tipos().filter((x) => x === 'delegacion_simulada').length, 0, 'nada se ejecuta antes de aprobar');
    const x = E.d.resolverAprobacion(a.idAprobacion, 'aprobada', {});
    assert.equal(x.estado, 'ejecutada_local');
    assert.equal(x.confirmada, true);
    assert.match(x.texto, /simulación local · sin efectos; no importo nada/);
    assert.match(x.texto, /Verificado/);
    const t = E.tareas()[0];
    assert.deepEqual(t.historial.map((h) => h.estado), ['creada', 'esperando_aprobacion', 'aceptada', 'en_curso', 'completada']);
    assert.equal(E.proy().aprobaciones.get(a.idAprobacion).estado, 'consumida');
    const dg = E.eventos('delegacion_simulada')[0];
    assert.equal(dg.datos.ejecutor, 'local');
    assert.equal(dg.datos.enviado, false);
    assert.ok(!E.tipos().includes('delegacion_enviada'));
    assert.equal(E.d.resolverAprobacion(a.idAprobacion, 'aprobada', {}).error.codigo, 'aprobacion_no_coincide');
    assert.equal(E.ledger.verificarCadena().ok, true);
    E.limpiar();
  });
  const sinTarea = (E) => E.tareas().length === 0;

  test('Director L2: otra entrada = otra huella y otra aprobación; la misma entrada pendiente se reutiliza; caducada nunca se aprueba; la voz no confirma', async () => {
    const E = entornoImp();
    const a = await E.pregunta(`Simula la importación ${lote()}`);
    const b = await E.pregunta(`Simula la importación ${lote()}`);
    assert.equal(a.aprobaciones[0], b.aprobaciones[0], 'misma entrada → se reutiliza');
    const c = await E.pregunta(`Simula la importación ${JSON.stringify([aliexpress()])}`);
    assert.notEqual(c.aprobaciones[0], a.aprobaciones[0]);
    assert.notEqual(E.proy().aprobaciones.get(c.aprobaciones[0]).huella, E.proy().aprobaciones.get(a.aprobaciones[0]).huella);
    assert.equal(E.d.resolverAprobacion(a.aprobaciones[0], 'aprobada', { canal: 'voz' }).error.codigo, 'canal_no_permitido');
    E.avanzar(16 * 60000);
    const x = E.d.resolverAprobacion(a.aprobaciones[0], 'aprobada', {});
    assert.equal(x.error.codigo, 'aprobacion_caducada');
    assert.ok(!E.tipos().includes('delegacion_simulada'));
    E.limpiar();
  });

  test('Director: «importa…» a secas sigue siendo L4 humano (sin tarea ni aprobación); parada de emergencia y ledger caído bloquean al 03', async () => {
    const E = entornoImp();
    const l4 = await E.pregunta('Importa estos 50 productos de Temu');
    assert.equal(l4.intencion.tipo, 'accion_humana');
    assert.match(l4.texto, /L4/);
    assert.equal(sinTarea(E), true);
    E.d.paradaEmergencia('prueba');
    assert.match((await E.pregunta(`Analiza este lote de importación ${lote()}`)).texto, /parada_emergencia/);
    E.d.reanudar();
    E.ledger._escribirLinea = () => { const e = new Error('x'); e.code = 'EIO'; throw e; };
    const r = await E.pregunta(`Simula la importación ${lote()}`);
    assert.equal(r.registrada, false);
    assert.match(r.texto, /No se inicia ninguna acción nueva|NO queda registrada|no queda registrada/i);
    delete E.ledger._escribirLinea;
    E.limpiar();
  });

  test('Director: sin motor de importación o sin entrada, el agente lo DECLARA y no finge; una entrada con credencial no se registra', async () => {
    const E = crearEntorno({ motorImportacion: null });
    const sin = await E.pregunta(`Analiza este lote de importación ${lote()}`);
    assert.match(sin.texto, /motor de importación existente no está cargado|origen_no_disponible/);
    assert.equal(E.tareas().at(-1).estado, 'fallida');
    E.limpiar();
    const F = entornoImp();
    const falta = await F.pregunta('Analiza esta importación por favor');
    assert.equal(falta.estado, 'aclaracion');
    assert.match(falta.texto, /Necesito la entrada/);
    const cred = await F.pregunta(`Analiza el lote de importación [{"title":"x","k":"${'sk-' + 'ABCDEFGHIJKLMNOPQRSTUVWX1234'}"}]`);
    assert.equal(cred.registrada, false);
    assert.equal(F.tareas().length, 0);
    F.limpiar();
  });

  test('Director sin catálogo de referencia: lo advierte (no se detectan duplicados) y con un ASIN/URL no abre nada ni gasta', async () => {
    const E = crearEntorno({ motorImportacion: motor });
    const r = await E.pregunta(`Analiza el lote de importación ${JSON.stringify([aliexpress()])}`);
    assert.match(r.texto, /sin catálogo de referencia \(no se pueden detectar duplicados\)/);
    const u = await E.pregunta('Prepara la propuesta de importación de https://www.amazon.es/dp/B09XS7JWHH');
    assert.match(u.texto, /No se puede simular sin obtener los datos de una fuente externa/);
    assert.match(u.texto, /No la consulto/);
    assert.equal(E.eventos('consumo').filter((c) => !c.datos.simulado).length, 0);
    E.limpiar();
  });

  test('con el cerebro simulado las intenciones del 03 funcionan y el modelo no puede convertir una importación en una acción', async () => {
    const E = entornoImp();
    const a = await E.pregunta(`Analiza este lote de importación ${lote()}`);
    assert.equal(a.origenInterpretacion, 'llm');
    assert.equal(a.intencion.riesgoMax, 'L1');
    assert.match(a.texto, /Verificado/);
    const L4 = await E.pregunta('Importa y publica el lote de Temu ya');
    assert.equal(L4.origenInterpretacion, 'reglas_suelo');
    assert.equal(E.aprobaciones().length, 0);
    E.limpiar();
  });

  test('los importadores actuales y el catálogo no se tocan: ni el módulo ni las pruebas escriben en src/, en los datos ni en los workflows', () => {
    const wf = (d) => crypto.createHash('sha256').update(fs.readdirSync(d).sort().map((f) => `${f}:${fs.readFileSync(path.join(d, f), 'utf8')}`).join('|')).digest('hex');
    const antesWf = wf(path.join(RAIZ, 'automation', 'workflows'));
    simularImportacion({ motor, catalogo: catalogo(), entrada: lote(), ahora: AHORA });
    assert.equal(wf(path.join(RAIZ, 'automation', 'workflows')), antesWf);
    const datos = path.join(RAIZ, 'src', 'data');
    const antes = fs.existsSync(datos) ? fs.readdirSync(datos).sort().join('|') : '';
    analizarImportacion({ motor, catalogo: catalogo(), entrada: lote(), ahora: AHORA, capacidad: '03.proponer-lote' });
    assert.equal(fs.existsSync(datos) ? fs.readdirSync(datos).sort().join('|') : '', antes, 'src/data sin cambios');
  });
}
