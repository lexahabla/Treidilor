// Agente 00 / 13 · F1.5 · gestión de suscripciones y API de IA: modelo de datos, elegibilidad, comparación de costes, recomendaciones y avisos (datos SIMULADOS).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIAS_TAREA, dato, elegibilidadAutomatizacion, validarInventario } from '../suscripciones/modelo.mjs';
import { avisosDeUso, candidatosDeTarea, compararModelos, costeLlamada, recomendar } from '../suscripciones/recomendaciones.mjs';
import { RUTA_INVENTARIO_SIMULADO, cargarInventario, informeSuscripciones } from '../suscripciones/aviso13.mjs';
import { crearEntorno, AHORA } from '../evaluacion/entorno.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const inv0 = () => cargarInventario();
const plano = (x) => JSON.parse(JSON.stringify(x));
const AHORA_INV = Date.parse('2026-11-14T12:00:00.000Z');

test('el inventario simulado es válido, está rotulado como SINTÉTICO y no contiene credenciales', () => {
  const inv = inv0();
  assert.equal(inv.sintetico, true);
  assert.deepEqual(validarInventario(inv), { ok: true, errores: [] });
  const txt = fs.readFileSync(RUTA_INVENTARIO_SIMULADO, 'utf8');
  assert.equal(/sk-[A-Za-z0-9]{15}|Bearer\s+[A-Za-z0-9]{16}|eyJ[A-Za-z0-9_-]{15}/.test(txt), false);
  assert.deepEqual(inv.proveedores.map((p) => p.id), ['anthropic', 'openai', 'futuro-x'], 'Claude, OpenAI y un proveedor futuro');
  assert.equal(new Set(inv.planes.map((p) => p.tipo)).size, 4, 'las cuatro modalidades están representadas');
});

test('rechaza cookies, tokens OAuth, sesiones y secretos (solo se admite el NOMBRE de la credencial)', () => {
  for (const campo of ['cookie', 'sessionToken', 'oauth_refresh', 'accessToken', 'password', 'apiKey', 'authorization']) {
    const inv = plano(inv0());
    inv.planes[0][campo] = 'algo';
    const v = validarInventario(inv);
    assert.equal(v.ok, false, campo);
    assert.match(v.errores.join(' '), /no admite credenciales, cookies, sesiones ni tokens/);
  }
  const conSecreto = plano(inv0());
  conSecreto.planes[2].credencial = 'sk-' + 'ABCDEFGHIJKLMNOPQRSTUVWX1234';
  assert.equal(validarInventario(conSecreto).ok, false);
  assert.ok(!JSON.stringify(validarInventario(conSecreto).errores).includes('ABCDEFGH'), 'no repite el valor');
  assert.equal(validarInventario(inv0()).ok, true, 'el campo «credencial» con un nombre sí es válido');
});

test('procedencia de los datos: verificado exige fuente y fecha; no_disponible exige valor null; nunca se inventan saldos ni tokens', () => {
  const casos = [
    (i) => { i.planes[2].costeFijoMensualEur = { valor: 5, verificacion: 'verificado', fuente: null, fecha: null }; },
    (i) => { i.planes[2].creditosDisponiblesEur = { valor: 7, verificacion: 'no_disponible', fuente: null, fecha: null }; },
    (i) => { i.planes[2].cuotas[0].usado = { valor: -3, verificacion: 'estimado', fuente: 'x', fecha: null }; },
    (i) => { i.planes[2].cuotas[0].limite = 1000; },
    (i) => { i.planes[0].tipo = 'regalo'; },
    (i) => { i.planes[2].modelos[0].calidad = { valor: 9, verificacion: 'estimado', fuente: 'x', fecha: null }; },
    (i) => { i.planes[0].modelos = [{ id: 'm', categorias: ['resumen_informes'], tarifa: {}, calidad: dato(3) }]; },
    (i) => { i.planes[1].proveedor = 'inexistente'; },
  ];
  for (const [n, c] of casos.entries()) { const i = plano(inv0()); c(i); assert.equal(validarInventario(i).ok, false, `caso ${n}`); }
  assert.deepEqual(dato(5, 'no_disponible'), { valor: null, verificacion: 'no_disponible', fuente: null, fecha: null }, 'dato() no deja un valor en un dato no disponible');
});

test('elegibilidad de automatización: solo API y créditos de API; suscripción y herramienta oficial NO son backend de agentes; lo declarado más permisivo se ignora', () => {
  const inv = inv0();
  const e = (id) => elegibilidadAutomatizacion(inv.planes.find((p) => p.id === id));
  assert.equal(e('claude-suscripcion').permitido, 'no');
  assert.equal(e('claude-herramienta').permitido, 'no_como_backend');
  assert.ok(e('claude-herramienta').avisos.some((a) => /se ignora/.test(a)), 'el plan declara «si» pero se ignora y se avisa');
  assert.equal(e('anthropic-api').permitido, 'si');
  assert.equal(e('openai-creditos').permitido, 'si');
  assert.ok(e('openai-api').avisos.some((a) => /no están verificados/.test(a)), 'términos desconocidos: se avisa');
  assert.equal(e('anthropic-api').terminosVerificados, false, 'los términos legales los verifica el propietario');
  assert.match(e('claude-suscripcion').motivo, /cookies, sesiones o tokens OAuth/);
  const p = plano(inv.planes.find((x) => x.id === 'anthropic-api')); p.usoAutomatizado.permitido = 'no';
  assert.equal(elegibilidadAutomatizacion(p).permitido, 'no', 'lo restrictivo manda');
});

test('comparación de costes: solo modelos utilizables por agentes, con tarifa y calidad suficiente; sin tarifa NO se inventa el precio', () => {
  const inv = inv0();
  const c = compararModelos(inv, 'clasificacion_intencion', { volumenMensual: 600 });
  assert.ok(c.ranking.length >= 3);
  assert.ok(c.ranking.every((r, i, a) => i === 0 || a[i - 1].costeEfectivoEur <= r.costeEfectivoEur), 'ordenado por coste');
  assert.ok(!c.ranking.some((r) => r.modelo === 'gpt-6.1-terra'), 'sin tarifa disponible no entra en el ranking');
  assert.ok(c.excluidos.some((x) => x.modelo === 'gpt-6.1-terra' && /sin tarifa disponible/.test(x.motivo)));
  assert.ok(c.excluidos.some((x) => x.plan === 'claude-suscripcion' || x.plan === 'claude-herramienta') || !c.ranking.some((r) => /suscripcion|herramienta/.test(r.plan)));
  assert.ok(!c.ranking.some((r) => /suscripcion|herramienta/.test(r.plan)), 'una suscripción nunca aparece como backend');
  assert.ok(c.estimacionDeTokens);
  const cat = CATEGORIAS_TAREA.clasificacion_intencion;
  assert.equal(candidatosDeTarea(inv, 'razonamiento_planificacion').candidatos.every((x) => x.calidad >= 4), true, 'respeta la calidad mínima de la tarea');
  assert.ok(candidatosDeTarea(inv, 'resumen_informes', { calidadMinima: 4 }).excluidos.some((x) => /calidad 3 < mínima 4/.test(x.motivo)), 'excluye por calidad insuficiente');
  assert.equal(costeLlamada({ tarifa: {} }, cat), null);
});

test('créditos incluidos: si cubren el coste mensual, el coste EFECTIVO es 0 y pasan primero; si no alcanzan, no', () => {
  const inv = inv0();
  const c = compararModelos(inv, 'clasificacion_intencion', { volumenMensual: 600 });
  const cred = c.ranking.find((r) => r.plan === 'openai-creditos');
  assert.equal(cred.cubiertoPorCreditos, true);
  assert.equal(cred.costeEfectivoEur, 0);
  assert.equal(c.ranking[0].plan, 'openai-creditos');
  const caro = compararModelos(inv, 'clasificacion_intencion', { volumenMensual: 5_000_000 });
  assert.equal(caro.ranking.find((r) => r.plan === 'openai-creditos').cubiertoPorCreditos, false);
});

test('recomendación: mejor combinación por tarea con confianza según la procedencia; fuera de presupuesto → aviso y propuestas SIN acción automática', () => {
  const inv = inv0();
  const r = recomendar(inv, { uso: { clasificacion_intencion: 600, resumen_informes: 120, razonamiento_planificacion: 40 }, topeMensualEur: 10 });
  assert.equal(r.asignaciones.length, 3);
  const razon = r.asignaciones.find((a) => a.tarea === 'razonamiento_planificacion');
  assert.equal(razon.modelo, 'modelo-grande-sim', 'la única opción con calidad ≥ 4 y tarifa disponible');
  assert.equal(razon.confianza, 'baja', 'tarifa solo estimada');
  const resumen = r.asignaciones.find((a) => a.tarea === 'resumen_informes');
  assert.equal(resumen.modelo, 'modelo-mini-sim', 'el más barato que cumple la calidad (tarifa solo estimada)');
  assert.equal(resumen.confianza, 'baja');
  assert.ok(resumen.alternativas.some((a) => a.modelo === 'modelo-pequeno-sim'), 'la alternativa de tarifa verificada se ofrece');
  const soloVerificado = plano(inv); soloVerificado.planes.find((p) => p.id === 'openai-api').activo = false; soloVerificado.planes.find((p) => p.id === 'openai-creditos').activo = false;
  const v = recomendar(soloVerificado, { uso: { resumen_informes: 120 } }).asignaciones[0];
  assert.equal(v.modelo, 'modelo-pequeno-sim');
  assert.equal(v.confianza, 'alta', 'tarifa verificada y volumen medido');
  assert.equal(r.dentroDePresupuesto, true);
  const apretado = recomendar(inv, { uso: { razonamiento_planificacion: 4000 }, topeMensualEur: 10 });
  assert.equal(apretado.dentroDePresupuesto, false);
  assert.match(apretado.avisos.join(' '), /supera el tope/);
  assert.ok(apretado.propuestas.filter((p) => p.requiereAutorizacion).every((p) => p.accionAutomatica === false));
  assert.ok(r.propuestas.some((p) => p.informativa && /uso interactivo del propietario; NO puede ser el backend/.test(p.texto)));
  const sinNada = recomendar({ ...plano(inv), planes: plano(inv).planes.filter((p) => p.tipo === 'suscripcion_interactiva') }, { uso: { resumen_informes: 10 } });
  assert.equal(sinNada.sinOpcion.length, 1, 'sin planes utilizables no se recomienda nada ni se inventa');
  assert.deepEqual(recomendar(inv, { uso: { resumen_informes: 120 } }), recomendar(inv, { uso: { resumen_informes: 120 } }), 'determinista');
});

test('avisos de utilización: cuota al 85 % (con alternativas), agotada, renovación próxima, créditos bajos y «no consta» sin inventar', () => {
  const inv = plano(inv0());
  const api = inv.planes.find((p) => p.id === 'anthropic-api');
  const av = avisosDeUso(inv, AHORA_INV);
  const cuota = av.find((a) => a.cuota === 'tokens-mes');
  assert.equal(cuota.nivel, 'medio');
  assert.match(cuota.texto, /85 %/);
  assert.match(cuota.texto, /estimado/);
  assert.ok(cuota.alternativas.some((x) => /OpenAI/.test(x)) && cuota.alternativas.some((x) => /más barato/.test(x)), 'propone alternativas ante el límite');
  assert.ok(av.some((a) => a.plan === 'claude-suscripcion' && a.cuota === 'mensajes-5h' && /No consta el uso o el límite/.test(a.texto)), 'sin datos no se estima');
  assert.ok(av.some((a) => a.plan === 'claude-suscripcion' && /se renueva en 6 día/.test(a.texto)), 'renovación a 6 días: dentro del umbral de 7');
  assert.equal(avisosDeUso(inv, Date.parse('2026-11-05T12:00:00.000Z')).some((a) => /se renueva en/.test(a.texto)), false, 'a 15 días no avisa');
  api.cuotas[0].usado = { valor: 2000000, verificacion: 'verificado', fuente: 'panel', fecha: '2026-11-13' };
  const agotada = avisosDeUso(inv, AHORA_INV).find((a) => a.cuota === 'tokens-mes');
  assert.equal(agotada.nivel, 'alto');
  assert.match(agotada.texto, /Cuota agotada/);
  const cred = inv.planes.find((p) => p.id === 'openai-creditos'); cred.creditosDisponiblesEur = { valor: 0.5, verificacion: 'estimado', fuente: 'x', fecha: null };
  assert.ok(avisosDeUso(inv, AHORA_INV).some((a) => /pocos créditos/.test(a.texto)));
  api.cuotas[0].usado = { valor: 1, verificacion: 'verificado', fuente: 'panel', fecha: '2026-09-01' };
  assert.ok(avisosDeUso(inv, AHORA_INV).some((a) => /verificó hace más de 30 días/.test(a.texto)), 'una verificación antigua se señala');
  assert.ok(avisosDeUso(inv, AHORA_INV).every((a, i, l) => i === 0 || ['alto', 'medio', 'info'].indexOf(l[i - 1].nivel) <= ['alto', 'medio', 'info'].indexOf(a.nivel)), 'lo más grave primero');
});

test('informe para el Agente 13: rotulado SIMULADO, separa verificado/estimado/no disponible, explica qué puede usar cada agente y NO ejecuta ninguna acción', () => {
  const inf = informeSuscripciones(inv0(), { ahora: AHORA_INV, presupuestoIA: { consumoRealActivado: false, diaEur: 0, topeDiarioEur: 1, mesEur: 0, topeMensualEur: 10 }, topeMensualEur: 10 });
  assert.equal(inf.simulado, true);
  assert.match(inf.texto, /^DATOS SIMULADOS/);
  assert.match(inf.texto, /Consumo real de IA del Director: DESACTIVADO/);
  assert.match(inf.texto, /NO como backend/);
  assert.match(inf.texto, /estimado\]/);
  assert.match(inf.texto, /No consta/);
  assert.match(inf.texto, /ninguna se aplica sola|exige tu autorización expresa/);
  assert.match(inf.texto, /Limitaciones:/);
  assert.equal(inf.accionesAutomaticas, 0);
  assert.ok(!/he contratado|he cambiado|he activado/.test(inf.texto));
  assert.ok(inf.limitaciones.some((l) => /no es asesoría legal|no asesoría legal|asesoría legal/.test(l)));
  assert.ok(inf.secciones.planes.every((p) => ['si', 'no', 'no_como_backend'].includes(p.utilizablePorAgentes)));
  assert.deepEqual(inf.procedenciaPlanes.find((p) => p.plan === 'openai-api').creditos, 'no disponible', 'un saldo desconocido figura como no disponible');
});

test('el módulo no tiene operaciones de contratar, cambiar de plan ni activar consumo, ni abre red, ni lee credenciales', () => {
  for (const f of ['modelo.mjs', 'recomendaciones.mjs', 'aviso13.mjs']) {
    const src = fs.readFileSync(path.join(AQUI, '..', 'suscripciones', f), 'utf8');
    assert.equal(/\bfetch\(|node:http|node:https|node:net|child_process|process\.env|cookie\s*[:=]|localStorage/.test(src), false, `${f} sin red, entorno ni cookies`);
    assert.equal(/\b(function|const)\s+(contratar|comprar|suscribir|cambiarPlan|activarConsumo|renovarPlan|pagar)\w*/i.test(src), false, `${f} sin operaciones de contratación`);
  }
});

test('el Director informa por el canal del Agente 13: consulta (L0) y recomendación (L1, propuesta) sin crear tareas, y sin inventario dice «no consta»', async () => {
  const E = crearEntorno({});
  E.d.inventarioIA = inv0();
  const c = await E.pregunta('¿Cuánto llevo gastado en IA y cómo van mis suscripciones?');
  assert.equal(c.intencion.tipo, 'consultar_suscripciones');
  assert.equal(c.categoria, 'consulta');
  assert.match(c.texto, /DATOS SIMULADOS/);
  assert.match(c.texto, /No he contratado, cambiado ni activado nada/);
  const r = await E.pregunta('Recomiéndame la mejor combinación de suscripciones y API de IA');
  assert.equal(r.intencion.tipo, 'recomendar_suscripciones');
  assert.equal(r.categoria, 'propuesta');
  assert.equal(E.tareas().length, 0, 'ni tareas ni delegaciones');
  assert.ok(E.tipos().every((t) => !['delegacion_enviada', 'delegacion_simulada', 'aprobacion_solicitada'].includes(t)));
  E.limpiar();
  const E2 = crearEntorno({});
  const s = await E2.pregunta('¿Cómo van mis suscripciones de IA?');
  assert.match(s.texto, /No hay un inventario/);
  assert.match(s.texto, /no los invento/);
  E2.limpiar();
});

test('las peticiones de contratar o cambiar planes siguen siendo acciones L4 humanas, no suscripciones', async () => {
  const E = crearEntorno({});
  E.d.inventarioIA = inv0();
  for (const t of ['Activa el plan de pago de OpenAI', 'Programa una renovación del plan', 'Crea un token para la API de OpenAI']) {
    const r = await E.pregunta(t);
    assert.ok(['accion_humana', 'ejecucion_autonoma'].includes(r.intencion.tipo), `${t} → ${r.intencion.tipo}`);
    assert.equal(E.tareas().length, 0);
  }
  E.limpiar();
});
