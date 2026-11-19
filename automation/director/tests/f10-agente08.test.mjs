// Agente 08 · Contenido y recursos visuales: COMPONENTES PUROS (sin capacidades aprobadas, sin integrar en el registro); fixtures sintéticos; nada se publica, genera ni sube.
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
  test('Agente 08: las pruebas se ejecutan en un subproceso con el cargador de TypeScript del proyecto', () => {
    const r = spawnSync(process.execPath, ['--experimental-transform-types', '--import', './scripts/register-ts.mjs', '--test', fileURLToPath(import.meta.url)], { cwd: RAIZ, encoding: 'utf8', timeout: 240000, env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')) });
    const pasan = Number((/ℹ pass (\d+)/.exec(r.stdout) || [])[1] || 0);
    const fallan = Number((/ℹ fail (\d+)/.exec(r.stdout) || [])[1] || 0);
    assert.equal(r.status, 0, r.stdout.slice(-4000));
    assert.equal(fallan, 0);
    assert.ok(pasan >= 14, `se esperaban ≥ 14 pruebas del Agente 08 y pasaron ${pasan}`);
  });
} else {
  const C = await import('../agentes/contenido/contenido.mjs');
  const { construirFuentesContenido, AHORA_MK } = await import('../agentes/contenido/fixtures.mjs');
  const { validarInformeAgente, canonico, sha256 } = await import('../protocolo.mjs');
  const { validarEsquema } = await import('../../../scripts/automation/validate-schema.mjs');
  const { cargarRegistro } = await import('../registro.mjs');
  const { crearEntorno } = await import('../evaluacion/entorno.mjs');
  const { redactarBrief, planificarCampanas, buscarCampana } = await import('../agentes/marketing/marketing.mjs');

  const motor = await C.cargarMotorContenido();
  const ESQ = JSON.parse(fs.readFileSync(path.join(AQUI, '..', '..', 'schemas', 'informe-agente.schema.json'), 'utf8'));
  const fx = () => construirFuentesContenido(motor.marketing, AHORA_MK);
  const prod = (f, id) => f.productos.find((p) => p.id === id);
  const hashWorkflows = () => { const d = path.join(RAIZ, 'automation', 'workflows'); return crypto.createHash('sha256').update(fs.readdirSync(d).sort().map((f) => `${f}:${fs.readFileSync(path.join(d, f), 'utf8')}`).join('|')).digest('hex'); };
  const paquete = (extra = {}) => C.prepararContenidoCampana({ motor, fuentes: fx(), campana: 'black friday', ahora: AHORA_MK, ...extra });
  const brief = (f = fx()) => { const plan = planificarCampanas({ motor: motor.marketing, fuentes: f, ahora: AHORA_MK }); return redactarBrief({ motor: motor.marketing, campana: buscarCampana(plan.campanas, 'black friday').campana, fuentes: f, ahora: AHORA_MK }); };

  test('reutiliza lo EXISTENTE (funciones locales de ai.ts, imageQuality, publicSafety, historias del 06 y reglas del 07) sin copiarlo; no llama a ninguna IA, no genera imágenes, no escribe ni usa la red', () => {
    for (const f of ['ai.ts', 'imageQuality.ts']) assert.ok(fs.existsSync(path.join(RAIZ, 'src', 'lib', f)), f);
    for (const f of ['publicSafety.ts', 'stories.ts']) assert.ok(fs.existsSync(path.join(RAIZ, 'src', 'lib', 'homeLayout', f)), f);
    assert.equal(typeof motor.ai.synthesizeTitleLocally, 'function');
    assert.equal(typeof motor.imagenes.toHiResImageUrl, 'function');
    assert.equal(typeof motor.seguridad.isPublicSafeImage, 'function');
    assert.equal(typeof motor.historias.validateStories, 'function');
    const src = fs.readFileSync(path.join(AQUI, '..', 'agentes', 'contenido', 'contenido.mjs'), 'utf8');
    for (const f of ['synthesizeTitleLocally', 'buildProductImagePrompt', 'toHiResImageUrl', 'isPublicSafeImage', 'validateStories', 'checkStories', 'construirFuentesPortada', 'planificarCampanas', 'redactarBrief', 'revisarTextoPublicitario']) assert.ok(src.includes(f), `usa ${f}`);
    assert.equal(/\bfetch\(|node:http|node:https|node:net|node:fs|child_process|writeFile|appendFile|unlink|rmSync|rename\(/.test(src), false);
    assert.equal(/chatComplete|enrichProductText|extractProductPageFields|synthesizeProductTitle|generateProductImage|persistImage|downloadBytes/.test(src), false, 'no usa ninguna función que llame a una IA o guarde imágenes');
    assert.equal(/function\s+(synthesizeTitleLocally|buildProductImagePrompt|toHiResImageUrl|isPublicSafeImage|validateStories|checkStories|revisarTextoPublicitario)/.test(src), false, 'no copia las funciones existentes');
    assert.equal(/marketingEmail|marketingLeads|radarAuth|mailer/.test(src), false);
  });

  test('borrador de ficha: sale solo de datos de la ficha, cada elemento rotulado (simulado/generado) y el precio y el descuento solo si tienen su fecha y su verificación', () => {
    const f = fx();
    const b = C.borradorFicha({ motor, producto: prod(f, 'inf-portatil'), ahora: AHORA_MK });
    assert.equal(b.estado, 'borrador_no_publicado');
    assert.equal(b.requiereRevisionHumana, true);
    const campo = (c) => b.elementos.find((e) => e.campo === c);
    assert.equal(campo('marca').naturaleza, 'simulado');
    assert.equal(campo('caracteristica:ram').valor, 'RAM: 16 GB');
    assert.equal(campo('descripcion').naturaleza, 'generado');
    assert.equal(campo('precio').naturaleza, 'simulado');
    assert.ok(campo('precio').fechaCaptura);
    assert.equal(campo('descuento_verificado').valor, 20);
    const d = campo('descripcion').valor;
    assert.match(d, /Características declaradas en la ficha: Procesador: Intel Core i5; RAM: 16 GB; Almacenamiento: 512 GB SSD; Pantalla: 15,6 pulgadas\./);
    assert.match(d, /Precio de 799,00 € registrado el 15\/11\/2026; puede haber cambiado en la tienda\./);
    assert.match(d, /Descuento verificado del 20 % \(antes 999,00 €, lectura del 15\/11\/2026\)\./);
    assert.equal(b.revision.ok, true, JSON.stringify(b.revision));
    assert.deepEqual(campo('puntos_clave').valor, ['Procesador: Intel Core i5', 'RAM: 16 GB', 'Almacenamiento: 512 GB SSD', 'Pantalla: 15,6 pulgadas']);
    const real = C.borradorFicha({ motor, producto: prod(f, 'inf-portatil'), sintetico: false, ahora: AHORA_MK });
    assert.equal(real.elementos.find((e) => e.campo === 'marca').naturaleza, 'real');
    assert.equal(real.elementos.find((e) => e.campo === 'descripcion').naturaleza, 'generado');
  });

  test('sin datos suficientes NO se inventa: sin marca ni características solo el título; sin fecha de captura no hay precio; un descuento solo declarado no se cita; sin título no se redacta', () => {
    const f = fx();
    const barra = C.borradorFicha({ motor, producto: prod(f, 'aud-barra'), ahora: AHORA_MK });
    assert.ok(barra.pendientes.some((x) => /no trae marca ni características/.test(x)));
    assert.doesNotMatch(barra.elementos.find((e) => e.campo === 'descripcion').valor, /Características declaradas/);
    const altavoz = C.borradorFicha({ motor, producto: prod(f, 'aud-altavoz'), ahora: AHORA_MK });
    assert.ok(altavoz.pendientes.some((x) => /No consta la fecha de captura del precio: el borrador no cita ningún precio/.test(x)));
    assert.equal(altavoz.elementos.some((e) => e.campo === 'precio'), false);
    assert.doesNotMatch(altavoz.elementos.find((e) => e.campo === 'descripcion').valor, /€/);
    const teclado = C.borradorFicha({ motor, producto: prod(f, 'inf-teclado'), ahora: AHORA_MK });
    assert.equal(teclado.elementos.some((e) => e.campo === 'descuento_verificado'), false);
    assert.doesNotMatch(teclado.elementos.find((e) => e.campo === 'descripcion').valor, /descuento|99/i);
    const sinTitulo = C.borradorFicha({ motor, producto: { id: 'x', title: '' }, ahora: AHORA_MK });
    assert.equal(sinTitulo.estado, 'no_redactable');
    assert.deepEqual(sinTitulo.elementos, []);
  });

  test('recursos visuales: cada imagen se clasifica por origen y derechos (prueba, tienda, generada ya existente, desconocida, no segura, ausente); los derechos de tienda y desconocidos quedan PENDIENTES', () => {
    const f = fx();
    const r = (id) => C.proponerRecursosVisuales({ motor, producto: prod(f, id) });
    assert.equal(r('inf-portatil').imagenes[0].origen, 'simulada');
    const tienda = r('aud-auriculares').imagenes[0];
    assert.equal(tienda.origen, 'imagen_de_tienda');
    assert.equal(tienda.naturaleza, 'pendiente_verificacion');
    assert.match(tienda.derechos, /pendiente_de_verificacion/);
    assert.equal(tienda.urlAltaResolucion, 'https://m.media-amazon.com/images/I/61abc123.jpg');
    const ia = r('aud-barra').imagenes[0];
    assert.equal(ia.origen, 'generada_ia_existente');
    assert.equal(ia.naturaleza, 'generado');
    assert.equal(r('aud-altavoz').imagenes[0].seguraParaWeb, false);
    assert.equal(r('inf-raton').imagenes[0].origen, 'ausente');
    assert.ok(r('inf-raton').pendientes.some((x) => /no tiene imagen/.test(x)));
    const otra = C.proponerRecursosVisuales({ motor, producto: { id: 'z', title: 'Algo', image: 'https://cdn.otro.test/x.jpg' } }).imagenes[0];
    assert.equal(otra.origen, 'origen_desconocido');
    assert.equal(otra.naturaleza, 'pendiente_verificacion');
    assert.ok(r('aud-auriculares').pendientes.some((x) => /Verificar los derechos/.test(x)));
  });

  test('el prompt de imagen es solo TEXTO propuesto (no se genera nada ni se gasta) y el vídeo se declara no disponible; el texto alternativo es generado y descriptivo', () => {
    const rv = C.proponerRecursosVisuales({ motor, producto: prod(fx(), 'inf-portatil') });
    assert.equal(rv.promptPropuesto.generada, false);
    assert.match(rv.promptPropuesto.texto, /product photography of Portátil/);
    assert.match(rv.promptPropuesto.coste, /exige autorización; aquí NO se genera/);
    assert.equal(rv.video.estado, 'no_disponible');
    assert.equal(rv.textoAlternativo.naturaleza, 'generado');
    assert.match(rv.textoAlternativo.valor, /^Imagen de Portátil/);
    assert.equal(rv.estado, 'propuesta_no_publicada');
  });

  test('historia: usa el MODELO del Agente 06 (siempre borrador, validado), una pantalla por mensaje verificado con imagen segura, sin recortar textos y explicando lo omitido', () => {
    const f = fx();
    const b = brief(f);
    const h = C.borradorHistoria({ motor, brief: b, fuentes: f });
    assert.equal(h.estado, 'borrador_no_publicado');
    assert.equal(h.historia.status, 'borrador');
    assert.ok(h.historia.screens.length >= 2 && h.historia.screens.length <= C.UMBRALES.maxPantallasHistoria);
    assert.equal(motor.historias.validateStories([h.historia]).ok, true);
    for (const s of h.historia.screens) { assert.equal(s.link.type, 'product'); assert.equal(s.duration, 7); assert.match(s.text, /precio del \d{2}\/\d{2}\/\d{4}/); assert.ok(s.text.length <= C.UMBRALES.maxTextoPantalla); }
    assert.ok(h.omitidas.some((x) => x.producto === 'aud-altavoz' && /fecha de captura/.test(x.motivo)));
    assert.deepEqual(h.incidencias, []);
    assert.equal(h.revision.ok, true);
    assert.equal(h.naturaleza, 'simulado');
    assert.ok(h.pendientes.some((x) => /L4/.test(x)));
    const solo = fx();
    for (const p of solo.productos) p.extra = {};
    const nada = C.borradorHistoria({ motor, brief: brief(solo), fuentes: solo });
    assert.equal(nada.estado, 'no_redactable');
    assert.deepEqual(nada.pantallas, []);
  });

  test('publicaciones para redes: texto verificado del brief + marcador de enlace pendiente + divulgación de afiliación, ≤ 280 caracteres, sin URLs reales y revisadas con las reglas del 07', () => {
    const f = fx();
    const p = C.borradorPostsRedes({ motor, brief: brief(f), fuentes: f });
    assert.equal(p.estado, 'borrador_no_publicado');
    assert.ok(p.posts.length >= 2);
    for (const x of p.posts) {
      assert.ok(x.caracteres <= C.UMBRALES.maxPost, `${x.producto}: ${x.caracteres}`);
      assert.match(x.texto, /\[enlace pendiente\]/);
      assert.match(x.texto, /Contiene enlaces de afiliado: podemos recibir una comisión sin coste para ti\./);
      assert.doesNotMatch(x.texto, /https?:\/\//);
      assert.equal(x.revision.ok, true, JSON.stringify(x.revision));
      assert.equal(x.naturaleza, 'generado');
      assert.equal(x.canal, 'sin_asignar');
    }
    assert.ok(p.omitidos.some((o) => o.producto === 'aud-altavoz'));
    assert.ok(p.pendientes.some((t) => /decisión y acción humana \(L4\)/.test(t)));
    const largo = fx(); prod(largo, 'inf-portatil').title = `${'Portátil '.repeat(30)}`;
    assert.ok(C.borradorPostsRedes({ motor, brief: brief(largo), fuentes: largo }).omitidos.some((o) => /supera 280/.test(o.motivo)));
  });

  test('revisión de piezas: detecta textos con afirmaciones no demostrables, imágenes no seguras, sin imagen y con derechos pendientes; una pieza correcta pasa', () => {
    const f = fx();
    assert.equal(C.revisarPieza(C.borradorFicha({ motor, producto: prod(f, 'inf-portatil'), ahora: AHORA_MK })).ok, true);
    const mala = { tipo: 'posts_redes', posts: [{ revision: { ok: false, problemas: [{ regla: 'urgencia_no_demostrable', fragmento: 'Solo hoy', accion: 'quitar' }] } }], imagenes: [{ origen: 'imagen_de_tienda', url: 'https://m.media-amazon.com/x.jpg', seguraParaWeb: true, naturaleza: 'pendiente_verificacion' }, { origen: 'origen_desconocido', url: 'http://127.0.0.1/a.jpg', seguraParaWeb: false, naturaleza: 'pendiente_verificacion' }, { origen: 'ausente', url: '', seguraParaWeb: false }] };
    const r = C.revisarPieza(mala);
    assert.equal(r.ok, false);
    const reglas = new Set(r.problemas.map((p) => p.regla));
    for (const x of ['urgencia_no_demostrable', 'derechos_pendientes_de_verificar', 'imagen_no_segura', 'sin_imagen']) assert.ok(reglas.has(x), x);
    const conIncidencia = C.revisarPieza({ tipo: 'historia', incidencias: [{ severidad: 'error', codigo: 'product_missing', mensaje: 'producto inexistente' }] });
    assert.equal(conIncidencia.problemas[0].regla, 'product_missing');
  });

  test('informe normalizado: informe-agente/1 válido, rotula datos de prueba, cuenta imágenes con derechos pendientes, declara «aprobadas/generadas» NO disponible y que nada se publica ni se genera', () => {
    const { informe } = paquete();
    const v = validarInformeAgente(informe);
    assert.equal(v.ok, true, JSON.stringify(v.errores || v));
    assert.deepEqual(validarEsquema(ESQ, informe), []);
    assert.equal(informe.agente, '08');
    assert.equal(informe.fuente.origenDatos, 'datos_de_prueba');
    assert.ok(informe.limitaciones[0].startsWith('DATOS DE PRUEBA'));
    assert.ok(informe.limitaciones.some((x) => /nada se publica en la web ni en canales externos, no se generan imágenes ni se llama a ninguna IA/.test(x)));
    assert.equal(informe.resumen.piezas, 6);
    assert.equal(informe.resumen.imagenes, 2);
    assert.equal(informe.resumen.imagenesDerechosPendientes, 1);
    assert.equal(informe.resumen.piezasAprobadas, 0);
    const nd = informe.hallazgos.find((x) => x.regla === 'datos_no_disponibles').evidencia.metricas.map((m) => m.metrica);
    for (const k of ['piezas_aprobadas_sobre_generadas', 'video', 'derechos_de_imagen']) assert.ok(nd.includes(k), k);
    assert.equal(informe.completo, false, 'hay derechos de imagen pendientes');
    assert.ok(informe.hallazgos.some((x) => x.regla === 'imagen_derechos_pendientes'));
    assert.ok(informe.hallazgos.filter((x) => x.regla === 'prompt_propuesto_no_generado').every((x) => x.evidencia.generada === false));
    assert.ok(informe.hallazgos.filter((x) => x.regla === 'pieza_propuesta').every((x) => x.evidencia.requiereRevisionHumana === true));
  });

  test('paquete de una campaña: una campaña inexistente se aclara con las disponibles; la existente da fichas, recursos, historia y publicaciones; es determinista y no modifica las fuentes', () => {
    const no = C.prepararContenidoCampana({ motor, fuentes: fx(), campana: 'pascua marciana', ahora: AHORA_MK });
    assert.equal(no.informe, null);
    assert.equal(no.motivo, 'no_encontrada');
    assert.ok(no.disponibles.includes('Black Friday'));
    const f = fx();
    const antes = sha256(canonico(f));
    const a = C.prepararContenidoCampana({ motor, fuentes: f, campana: 'black friday', ahora: AHORA_MK });
    const b = C.prepararContenidoCampana({ motor, fuentes: f, campana: 'black friday', ahora: AHORA_MK });
    assert.deepEqual(a.piezas.map((p) => p.tipo), ['ficha', 'recursos_visuales', 'ficha', 'recursos_visuales', 'historia', 'posts_redes']);
    assert.deepEqual(a.informe, b.informe);
    assert.equal(sha256(canonico(f)), antes);
  });

  test('derechos, publicidad y afiliación: ningún texto generado contiene precios sin fecha, descuentos no verificados, superlativos ni urgencia, y todo texto con enlaces lleva la divulgación; no hay URLs en los textos', () => {
    const { piezas } = paquete();
    const textos = [];
    for (const p of piezas) {
      if (p.tipo === 'ficha') textos.push(p.elementos.find((e) => e.campo === 'descripcion').valor);
      if (p.tipo === 'historia') for (const s of p.historia.screens) textos.push(s.text);
      if (p.tipo === 'posts_redes') for (const x of p.posts) textos.push(x.texto);
    }
    assert.ok(textos.length >= 6);
    for (const t of textos) {
      const r = motor.marketing.publicClaims.claimProblem(t, '', {});
      assert.ok(r === null || r === 'dato_interno' || r === 'descuento_no_verificado', `${r}: ${t.slice(0, 60)}`);
      assert.doesNotMatch(t, /\bel mejor\b|garantizad|solo hoy|últimas unidades|https?:\/\//i);
    }
    for (const p of piezas) assert.equal(C.revisarPieza(p).problemas.some((x) => x.tipo === 'texto'), false, `${p.tipo} sin problemas de texto`);
    for (const p of piezas) if (p.tipo === 'posts_redes') assert.ok(p.posts.every((x) => /enlaces de afiliado/.test(x.texto)));
  });

  test('propuesta de capacidades del 08: archivo aparte NO aprobado con niveles, alcances, dependencias y límites; las L3 (guardar y generar imagen con coste) bloqueadas; publicar y modificar contenido real son L4 humano', () => {
    const prop = JSON.parse(fs.readFileSync(path.join(AQUI, '..', 'agentes', 'contenido', 'propuesta-capacidades-08.json'), 'utf8'));
    assert.equal(prop.estado, 'propuesta_no_aprobada');
    assert.match(prop.aviso, /NO forma parte del registro/);
    assert.deepEqual(prop.fichaOriginal.alcancesPrevistos, ['drafts:write']);
    const reg = cargarRegistro();
    for (const c of prop.capacidadesPropuestas) {
      if (c.nivel === 'L3') assert.ok(!reg.buscarCapacidad(c.id), `${c.id} (L3) sigue bloqueada: no debe estar en el registro`);
      else assert.equal(reg.buscarCapacidad(c.id).nivelRiesgo, c.nivel, `${c.id} autorizada con su nivel`);
      assert.match(c.nivel, /^L[0-3]$/);
      assert.ok(Array.isArray(c.alcances) && Array.isArray(c.dependencias) && Array.isArray(c.limites), c.id);
    }
    const l3 = prop.capacidadesPropuestas.filter((c) => c.nivel === 'L3');
    assert.deepEqual(l3.map((c) => c.id).sort(), ['08.generar-imagen-ia', '08.guardar-borrador-contenido']);
    assert.ok(l3.every((c) => c.requiereAprobacion === true && /BLOQUEADA/.test(c.nota)));
    assert.ok(prop.capacidadesPropuestas.find((c) => c.id === '08.generar-imagen-ia').alcances.some((a) => /NUEVO/.test(a)));
    assert.deepEqual(prop.accionesQueNuncaSeranCapacidadDelAgente.map((a) => a.nivel), ['L4', 'L4', 'L4', 'L4']);
    assert.ok(prop.decisionesPendientes.length >= 4);
  });

  test('registro: el 08 tiene EXACTAMENTE las cinco capacidades autorizadas (4 × L1 y 1 × L0, sin alcances) y las dos L3 siguen bloqueadas sin drafts:write ni images:generate', () => {
    const reg = cargarRegistro();
    assert.equal(reg.agente('08').estado, 'construido_local');
    assert.deepEqual(reg.capacidadesDe('08').map((c) => [c.id, c.nivelRiesgo, c.disponibilidad, c.alcances.length, c.efectos]).sort(), [['08.proponer-borrador-ficha', 'L1', 'propuesta_f1', 0, 'ninguno'], ['08.proponer-borrador-historia', 'L1', 'propuesta_f1', 0, 'ninguno'], ['08.proponer-borrador-redes', 'L1', 'propuesta_f1', 0, 'ninguno'], ['08.proponer-recursos-visuales', 'L1', 'propuesta_f1', 0, 'ninguno'], ['08.revisar-pieza', 'L0', 'lectura_f1', 0, 'ninguno']]);
    for (const bloqueada of ['08.guardar-borrador-contenido', '08.generar-imagen-ia']) assert.ok(!reg.buscarCapacidad(bloqueada), bloqueada);
    const alcances = new Set(reg.capacidades().flatMap((c) => c.alcances));
    assert.equal(alcances.has('drafts:write'), false);
    assert.equal(alcances.has('images:generate'), false);
  });

  test('no se toca nada real: ni imágenes del proyecto, ni catálogo, ni fichas, ni workflows; todo el trabajo queda en memoria', () => {
    const wf = hashWorkflows();
    const dirImg = path.join(RAIZ, 'public', 'images', 'products');
    const contar = () => (fs.existsSync(dirImg) ? fs.readdirSync(dirImg).length : 0);
    const reales = ['products.json', 'categories.json'].map((f) => path.join(RAIZ, 'src', 'data', f));
    const antesImg = contar();
    const antes = reales.map((f) => (fs.existsSync(f) ? `${fs.statSync(f).mtimeMs}:${fs.statSync(f).size}` : null));
    paquete();
    assert.equal(contar(), antesImg);
    assert.deepEqual(reales.map((f) => (fs.existsSync(f) ? `${fs.statSync(f).mtimeMs}:${fs.statSync(f).size}` : null)), antes);
    assert.equal(hashWorkflows(), wf);
  });
}
