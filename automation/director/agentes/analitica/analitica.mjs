/**
 * Agente 10 · ANALÍTICA Y CONVERSIÓN (ficha `automation/agents/10-analitica-conversion.md`; riesgo bajo; alcance previsto `analytics:read`; «solo datos agregados, sin datos
 * personales de usuarios»). Capacidad registrada: `10.leer-analitica-agregada` (L0, consulta). CAPA DE LECTURA Y ANÁLISIS sobre la analítica que YA existe; no instala
 * seguimiento ni crea un sistema paralelo. Reutiliza las funciones puras de `src/lib/analyticsMonths.ts` (`computeMetricas`, `computeFuentes`, `computeEvolucion`,
 * `computeTopProductos`, `computeTopReferrers`): el agente no reimplementa sesiones, rebote, conversión ni fuentes; solo las aplica a ventanas comparables y añade las
 * reglas de HONESTIDAD (muestra mínima, datos no actuales, recorte de la ventana, métricas no disponibles).
 * Rigor de los datos: cada cifra va rotulada como `medido` (registrado por el propio sitio), `declarado` (lo comunica el visitante: compras del Return Flow), `derivado`
 * (cálculo sobre lo medido), `estimacion` (p. ej. visitantes por identificador de navegador) o `no_disponible`. Con datos de prueba el informe lo dice. Nada se inventa:
 * sin muestra suficiente NO se calcula la tasa ni se saca conclusión. «Conversión» aquí = clic de salida a tienda (la métrica de la ficha: «tasa de clic a salida»); una
 * venta real no consta en ningún dato disponible. Los experimentos son PROPUESTAS que aprueba una persona; el agente no los ejecuta ni los lanza.
 * Privacidad: se descartan al entrar todos los campos que no sean los de analítica agregada y del referente solo se conserva el dominio; el informe no contiene
 * identificadores de sesión ni de visitante. Los módulos TypeScript se INYECTAN ya cargados (`cargarMotorAnalitica`).
 */
import { createHash } from 'node:crypto';
import { ESQUEMA_INFORME_AGENTE, ErrorProtocolo, canonico, sha256 } from '../../protocolo.mjs';

/** Umbrales iniciales CONFIGURABLES (se declaran en el informe; no son verdades del mercado). */
export const UMBRALES = Object.freeze({ ventanaDias: 7, minSesiones: 30, minVisitasProducto: 20, minProductosConMuestra: 3, variacionRelevantePct: 20, variacionTasaPp: 2, tasaBajaFraccion: 0.5, tasaAltaFraccion: 1.5, maxEventosAlmacen: 10000, maxProductosPorRegla: 5, edadMaxDatosDias: 1 });
const DIA = 86400000;
const TIPOS = new Set(['page_view', 'page_duration', 'product_click', 'cart_add', 'outbound_click', 'purchase', 'contact_click']);
const r1 = (n) => Math.round(n * 10) / 10;

/** Carga las funciones existentes de analítica (requiere el cargador de TypeScript del proyecto). */
export async function cargarMotorAnalitica() {
  if (!process.env.TRADYLOR_DATA_DIR) process.env.TRADYLOR_DATA_DIR = `${process.env.TEMP || process.env.TMPDIR || '/tmp'}/tai-analitica-sin-datos`; // nunca datos reales
  const base = new URL('../../../../src/lib/', import.meta.url);
  try {
    const months = await import(new URL('analyticsMonths.ts', base).href);
    return { months };
  } catch (e) {
    throw new ErrorProtocolo('origen_no_disponible', 'Las funciones existentes de analítica no están disponibles (hace falta el cargador de TypeScript del proyecto).', { causa: String(e && e.code ? e.code : 'import') });
  }
}
const exigir = (m) => { if (!m || !m.months || typeof m.months.computeMetricas !== 'function') throw new ErrorProtocolo('origen_no_disponible', 'Las funciones existentes de analítica no están cargadas: no se puede analizar.'); return m; };

function hostDe(ref) {
  if (typeof ref !== 'string' || !ref) return undefined;
  try { return new URL(ref).host.replace(/^www\./, '').toLowerCase().slice(0, 80) || undefined; } catch { return undefined; }
}

/** Privacidad: solo pasan los campos de analítica agregada; el referente se reduce a su dominio. Devuelve { eventos, descartados }. */
export function sanear(brutos) {
  const eventos = [];
  const descartados = { noObjeto: 0, tipoInvalido: 0, fechaInvalida: 0 };
  for (const e of Array.isArray(brutos) ? brutos : []) {
    if (!e || typeof e !== 'object') { descartados.noObjeto += 1; continue; }
    if (!TIPOS.has(e.type)) { descartados.tipoInvalido += 1; continue; }
    const t = Date.parse(e.createdAt);
    if (!Number.isFinite(t)) { descartados.fechaInvalida += 1; continue; }
    const o = { type: e.type, createdAt: new Date(t).toISOString() };
    if (typeof e.productId === 'string' && e.productId) o.productId = e.productId.slice(0, 120);
    if (typeof e.sessionId === 'string' && e.sessionId) o.sessionId = e.sessionId.slice(0, 80);
    if (typeof e.visitorId === 'string' && e.visitorId) o.visitorId = e.visitorId.slice(0, 80);
    const host = hostDe(e.referrer);
    if (host) o.referrer = `https://${host}/`;
    if (typeof e.network === 'string' && e.network) o.network = e.network.slice(0, 40);
    if (Number.isFinite(e.durationMs) && e.durationMs >= 0) o.durationMs = e.durationMs;
    if (Number.isFinite(e.amount) && e.amount > 0) o.amount = e.amount;
    eventos.push(o);
  }
  return { eventos, descartados };
}

const h = (clave, regla, elemento, evidencia, { certeza = null, prioridad = null, accion = null } = {}) => ({ clave, regla, certeza, prioridad, gravedad: null, elemento, evidencia, accionSugerida: accion });
const enRango = (evs, desde, hasta) => evs.filter((e) => { const t = Date.parse(e.createdAt); return t >= desde && t < hasta; });

function periodo(m, evs, u) {
  const k = m.months;
  const metricas = k.computeMetricas(evs);
  const salida = k.computeMetricas(evs.filter((e) => e.type !== 'purchase')); // conversionPct = sesiones con clic de salida ÷ sesiones
  const suficiente = metricas.sesiones >= u.minSesiones;
  return { evs, metricas, tasaSalidaSesionPct: salida.conversionPct, suficiente, fuentes: k.computeFuentes(evs), refs: k.computeTopReferrers(evs, 5), productos: k.computeTopProductos(evs, 100000) };
}

/**
 * Analiza la analítica agregada. PURO: no escribe nada. `datos` = { events, productos?:[{id,title}], sintetico }. La ventana se ancla al FINAL DEL DÍA UTC del último evento (no al reloj),
 * para que el resultado sea reproducible; la antigüedad de los datos respecto a `ahora` se declara aparte.
 */
export function analizarAnalitica({ motor, datos, ahora = Date.now(), sintetico = true, capacidad = '10.leer-analitica-agregada', umbrales = {} }) {
  const m = exigir(motor);
  const u = { ...UMBRALES, ...umbrales };
  const { eventos, descartados } = sanear(datos && datos.events);
  if (!eventos.length) return { informe: null, motivo: 'sin_eventos', descartados };
  eventos.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  const ultimo = Date.parse(eventos[eventos.length - 1].createdAt);
  const primero = Date.parse(eventos[0].createdAt);
  const ancla = Math.floor(ultimo / DIA) * DIA + DIA;
  const vent = u.ventanaDias * DIA;
  const act = periodo(m, enRango(eventos, ancla - vent, ancla), u);
  const ant = periodo(m, enRango(eventos, ancla - 2 * vent, ancla - vent), u);
  const titulos = new Map(((datos && datos.productos) || []).filter((p) => p && p.id).map((p) => [p.id, String(p.title ?? p.id).slice(0, 120)]));
  const H = [];
  const edadDias = Math.max(0, Math.floor((ahora - ultimo) / DIA));
  const rotulo = sintetico ? 'datos_de_prueba' : 'real';

  H.push(h('origen', 'origen_de_los_datos', null, { clasificacion: rotulo, eventosLeidos: eventos.length, descartados, primerEvento: new Date(primero).toISOString().slice(0, 10), ultimoEvento: new Date(ultimo).toISOString().slice(0, 10), ventanaActual: { desde: new Date(ancla - vent).toISOString().slice(0, 10), hasta: new Date(ancla - 1).toISOString().slice(0, 10) }, ventanaAnterior: { desde: new Date(ancla - 2 * vent).toISOString().slice(0, 10), hasta: new Date(ancla - vent - 1).toISOString().slice(0, 10) }, tipoDato: sintetico ? 'sintetico' : 'medido' }, { certeza: 'confirmado', prioridad: 'P4' }));
  if (edadDias > u.edadMaxDatosDias) H.push(h('datos_no_actuales', 'datos_no_actuales', null, { ultimoEvento: new Date(ultimo).toISOString().slice(0, 10), edadDias }, { certeza: 'confirmado', prioridad: 'P3', accion: 'Los resultados describen un periodo pasado: no son la situación de hoy. Actualiza la exportación de analítica antes de decidir.' }));
  if (eventos.length >= u.maxEventosAlmacen) H.push(h('ventana_recortada', 'ventana_recortada', null, { eventos: eventos.length, tope: u.maxEventosAlmacen }, { certeza: 'advertencia', prioridad: 'P3', accion: 'El almacén de analítica conserva como máximo ese número de eventos: los más antiguos se han perdido y el periodo anterior puede estar incompleto. No comparar sin cautela.' }));
  const diasConDatos = new Set(act.evs.map((e) => e.createdAt.slice(0, 10)));
  const sinDatos = [];
  for (let i = 0; i < u.ventanaDias; i += 1) { const d = new Date(ancla - vent + i * DIA).toISOString().slice(0, 10); if (!diasConDatos.has(d)) sinDatos.push(d); }
  if (sinDatos.length) H.push(h('dias_sin_datos', 'dias_sin_datos', null, { dias: sinDatos }, { certeza: 'advertencia', prioridad: 'P4', accion: 'No se puede distinguir un día sin visitas de un fallo de medición: no se interpreta como caída.' }));

  // Métricas del periodo actual (cada una con su tipo de dato)
  const M = act.metricas;
  const medida = (clave, valor, tipoDato, extra = {}) => H.push(h(`metrica:${clave}`, 'metrica', clave, { valor, tipoDato, periodo: 'ventana_actual', ...extra }, { certeza: 'confirmado', prioridad: 'P4' }));
  if (act.suficiente) {
    medida('sesiones', M.sesiones, 'medido'); medida('visitas', M.visitas, 'medido'); medida('salidas_a_tienda', M.salidas, 'medido');
    medida('tasa_clic_salida_por_sesion_pct', act.tasaSalidaSesionPct, 'derivado', { definicion: 'sesiones con clic de salida ÷ sesiones' });
    medida('visitantes_estimados', M.usuariosUnicos, 'estimacion', { nota: 'identificadores de navegador, no personas' });
    if (M.compras > 0) medida('compras_declaradas', M.compras, 'declarado', { nota: 'declaradas por el visitante (Return Flow); sin confirmación de la red de afiliación' });
  } else H.push(h('datos_insuficientes:ventana_actual', 'datos_insuficientes', 'ventana_actual', { sesiones: M.sesiones, minimo: u.minSesiones, metricas: ['tasa_clic_salida', 'tendencias', 'productos', 'fuentes'] }, { certeza: 'no_verificable', prioridad: 'P3', accion: 'Muestra insuficiente: no se calcula ninguna tasa ni se saca conclusión. Hacen falta más sesiones.' }));

  // Tendencias (solo con muestra suficiente en AMBAS ventanas)
  if (act.suficiente && ant.suficiente) {
    const vs = ant.metricas.sesiones ? r1(((M.sesiones - ant.metricas.sesiones) / ant.metricas.sesiones) * 100) : null;
    const relevante = vs !== null && Math.abs(vs) >= u.variacionRelevantePct;
    H.push(h('tendencia:sesiones', relevante ? (vs > 0 ? 'tendencia_sesiones_al_alza' : 'tendencia_sesiones_a_la_baja') : 'tendencia_sesiones_estable', 'sesiones', { actual: M.sesiones, anterior: ant.metricas.sesiones, variacionPct: vs, umbralPct: u.variacionRelevantePct, nota: 'describe el cambio medido; no establece su causa' }, { certeza: 'confirmado', prioridad: relevante ? 'P3' : 'P4' }));
    const pp = r1(act.tasaSalidaSesionPct - ant.tasaSalidaSesionPct);
    const relT = Math.abs(pp) >= u.variacionTasaPp;
    H.push(h('tendencia:tasa_clic_salida', relT ? (pp > 0 ? 'tendencia_clic_salida_al_alza' : 'tendencia_clic_salida_a_la_baja') : 'tendencia_clic_salida_estable', 'tasa_clic_salida', { actualPct: act.tasaSalidaSesionPct, anteriorPct: ant.tasaSalidaSesionPct, variacionPuntos: pp, umbralPuntos: u.variacionTasaPp, nota: 'describe el cambio medido; no establece su causa' }, { certeza: 'confirmado', prioridad: relT ? 'P3' : 'P4' }));
  } else H.push(h('datos_insuficientes:tendencias', 'datos_insuficientes', 'tendencias', { sesionesActual: M.sesiones, sesionesAnterior: ant.metricas.sesiones, minimo: u.minSesiones }, { certeza: 'no_verificable', prioridad: 'P3', accion: 'Sin muestra suficiente en las dos ventanas no se comparan periodos ni se declara ninguna tendencia.' }));

  // Fuentes de tráfico
  if (act.suficiente) {
    const f = act.fuentes.filter((x) => x.sesiones > 0).sort((a, b) => b.sesiones - a.sesiones || a.id.localeCompare(b.id));
    H.push(h('fuentes', 'fuentes_de_trafico', null, { fuentes: f.map((x) => ({ id: x.id, sesiones: x.sesiones, porcentaje: x.porcentaje })), dominios: act.refs.filter((x) => x.host !== '(directo)').map((x) => ({ host: x.host, sesiones: x.sesiones })) }, { certeza: 'confirmado', prioridad: 'P4' }));
    if (f[0] && f[0].porcentaje >= 70) H.push(h('fuentes:concentracion', 'trafico_concentrado', f[0].id, { fuente: f[0].id, porcentaje: f[0].porcentaje }, { certeza: 'advertencia', prioridad: 'P3', accion: `Más del 70 % de las sesiones llega por una sola fuente (${f[0].id}): cualquier cambio en ella afecta a todo.` }));
  }

  // Productos: solo con muestra mínima de visitas
  const totVis = act.productos.reduce((s, p) => s + p.visitas, 0);
  const totSal = act.productos.reduce((s, p) => s + p.salidas, 0);
  const conMuestra = act.productos.filter((p) => p.visitas >= u.minVisitasProducto);
  const sinMuestra = act.productos.length - conMuestra.length;
  const oportunidades = [];
  const experimentos = [];
  if (act.suficiente && conMuestra.length >= u.minProductosConMuestra && totVis > 0) {
    const media = totSal / totVis; // tasa global del periodo (salidas ÷ visitas de ficha)
    const visMediana = [...conMuestra].map((p) => p.visitas).sort((a, b) => a - b)[Math.floor(conMuestra.length / 2)];
    const nombre = (p) => titulos.get(p.productId) ?? p.productId;
    const fila = (p) => ({ producto: p.productId, titulo: nombre(p), visitas: p.visitas, salidas: p.salidas, tasaSalidaPct: r1((p.salidas / p.visitas) * 100) });
    const bajos = conMuestra.filter((p) => p.salidas / p.visitas < media * u.tasaBajaFraccion && p.visitas >= visMediana).sort((a, b) => b.visitas - a.visitas || a.productId.localeCompare(b.productId)).slice(0, u.maxProductosPorRegla);
    const altos = conMuestra.filter((p) => p.salidas / p.visitas > media * u.tasaAltaFraccion && p.visitas < visMediana).sort((a, b) => b.salidas / b.visitas - a.salidas / a.visitas || a.productId.localeCompare(b.productId)).slice(0, u.maxProductosPorRegla);
    H.push(h('productos:referencia', 'productos_referencia', null, { tasaGlobalSalidaPct: r1(media * 100), visitasMediana: visMediana, productosConMuestra: conMuestra.length, minVisitasPorProducto: u.minVisitasProducto }, { certeza: 'confirmado', prioridad: 'P4' }));
    for (const p of bajos) { oportunidades.push(p.productId); H.push(h(`producto:${p.productId}:alto_trafico_baja_salida`, 'producto_alto_trafico_baja_salida', p.productId, { ...fila(p), tasaGlobalSalidaPct: r1(media * 100), hipotesis: 'recibe visitas pero pocas terminan en clic a tienda' }, { certeza: 'confirmado', prioridad: 'P3', accion: 'Candidato a revisar su ficha (precio visible, botón, información). La causa NO está establecida.' })); }
    for (const p of altos) { oportunidades.push(p.productId); H.push(h(`producto:${p.productId}:alta_salida_poco_trafico`, 'producto_alta_salida_poco_trafico', p.productId, { ...fila(p), tasaGlobalSalidaPct: r1(media * 100), hipotesis: 'las pocas visitas que recibe convierten bien en clic a tienda' }, { certeza: 'confirmado', prioridad: 'P3', accion: 'Candidato a darle más visibilidad (p. ej. en portada: decisión del Agente 06 y del propietario). No implica que más tráfico mantenga la tasa.' })); }
    for (const p of [...bajos.slice(0, 2), ...altos.slice(0, 1)]) {
      const bajo = bajos.includes(p);
      experimentos.push(p.productId);
      H.push(h(`experimento:${p.productId}`, 'experimento_propuesto', p.productId, { producto: p.productId, titulo: nombre(p), hipotesis: bajo ? 'Mejorar la información o el botón de la ficha aumentará el clic de salida' : 'Mostrar el producto en un lugar de más visibilidad aumentará sus visitas con una tasa de clic similar', metrica: 'tasa de clic a salida de la ficha (salidas ÷ visitas)', lineaBase: { visitas: p.visitas, salidas: p.salidas, tasaSalidaPct: r1((p.salidas / p.visitas) * 100) }, muestraMinimaPorVariante: u.minVisitasProducto * 2, efectoEsperado: 'no estimado: no hay datos para prometer una mejora', ejecutable: false, requiereAprobacion: true }, { certeza: 'no_verificable', prioridad: 'P4', accion: 'PROPUESTA: la aprueba y la ejecuta una persona; este agente no lanza experimentos.' }));
    }
  } else if (act.suficiente) H.push(h('datos_insuficientes:productos', 'datos_insuficientes', 'productos', { productosConMuestra: conMuestra.length, minimoProductos: u.minProductosConMuestra, minVisitasPorProducto: u.minVisitasProducto }, { certeza: 'no_verificable', prioridad: 'P4', accion: 'Hay pocos productos con visitas suficientes para comparar sus tasas: no se señala ninguno.' }));
  if (sinMuestra > 0) H.push(h('productos:sin_muestra', 'productos_sin_muestra', null, { productos: sinMuestra, minVisitasPorProducto: u.minVisitasProducto }, { certeza: 'no_verificable', prioridad: 'P4' }));

  H.push(h('no_disponible', 'metricas_no_disponibles', null, { metricas: [
    { metrica: 'ventas_reales_verificadas', motivo: 'las redes de afiliación no comunican las ventas a esta analítica; las «compras» son declaradas por el visitante' },
    { metrica: 'ingresos_y_comisiones', motivo: 'no constan en la analítica; el libro de ventas es otro sistema y no se lee aquí' },
    { metrica: 'tasa_de_conversion_a_venta', motivo: 'faltan ventas verificadas' },
    { metrica: 'coste_de_adquisicion_y_retorno', motivo: 'no hay datos de gasto' },
    { metrica: 'tasa_de_clic_por_fuente_o_dispositivo', motivo: 'la analítica agregada existente no las separa' },
  ] }, { certeza: 'no_verificable', prioridad: 'P4' }));

  const suficientes = act.suficiente;
  const limitaciones = [
    'Datos agregados: sin IP, sin agente de usuario y sin identificadores de sesión o visitante en este informe.',
    'La «conversión» es el clic de salida a la tienda (tasa de clic a salida); una venta real no consta en ningún dato disponible.',
    'Las tendencias describen cambios medidos; no establecen su causa ni predicen el futuro.',
    'Los experimentos son propuestas que debe aprobar y ejecutar una persona; ninguna capacidad del agente los lanza.',
    'No se consultan fuentes externas (sin red, sin créditos) ni se modifica la analítica.',
  ];
  if (sintetico) limitaciones.unshift('DATOS DE PRUEBA: eventos sintéticos; no reflejan el tráfico real.');
  if (!suficientes) limitaciones.push(`Muestra insuficiente (menos de ${u.minSesiones} sesiones en la ventana actual): no hay tasas ni conclusiones.`);
  else if (!ant.suficiente) limitaciones.push(`Muestra insuficiente en la ventana anterior (menos de ${u.minSesiones} sesiones): no hay comparación.`);
  if (edadDias > u.edadMaxDatosDias) limitaciones.push(`Los datos tienen ${edadDias} día(s) de antigüedad: no describen la situación actual.`);

  const afectados = new Set(H.filter((x) => ['producto_alto_trafico_baja_salida', 'producto_alta_salida_poco_trafico'].includes(x.regla)).map((x) => x.elemento)).size;
  const incidencias = H.filter((x) => x.certeza === 'advertencia').length;
  const informe = {
    esquema: ESQUEMA_INFORME_AGENTE, agente: '10', capacidad, version: '0.1.0', entorno: 'local',
    idEjecucion: `an-${createHash('sha256').update(canonico({ e: eventos, u })).digest('hex').slice(0, 10)}`,
    generadoEn: new Date(Math.floor(ahora / 60000) * 60000).toISOString(),
    completo: suficientes && ant.suficiente && eventos.length < u.maxEventosAlmacen && edadDias <= u.edadMaxDatosDias,
    fuente: { sistema: 'analitica_existente', tabla: 'eventos_agregados', host: null, registrosLeidos: eventos.length, origenDatos: sintetico ? 'datos_de_prueba' : 'exportacion', origenEjecucion: 'local', firma: sha256(canonico(eventos)) },
    resumen: { estadoCalidad: suficientes && ant.suficiente ? 'completa' : 'datos_insuficientes', incidencias, porGravedad: { critica: 0, alta: 0, media: 0, baja: 0, info: 0 }, porCerteza: null, porPrioridad: null, elementosAfectados: afectados, elementosTotales: act.productos.length, eventos: eventos.length, eventosDescartados: descartados.noObjeto + descartados.tipoInvalido + descartados.fechaInvalida, sesionesActual: M.sesiones, sesionesAnterior: ant.metricas.sesiones, tasaClicSalidaActualPct: suficientes ? act.tasaSalidaSesionPct : null, tasaClicSalidaAnteriorPct: ant.suficiente ? ant.tasaSalidaSesionPct : null, salidasActual: M.salidas, comprasDeclaradasActual: M.compras, productosAnalizados: conMuestra.length, productosSinMuestra: sinMuestra, oportunidadesOptimizacion: new Set(oportunidades).size, experimentosPropuestos: experimentos.length },
    hallazgos: H, seguimiento: null, persistencia: { escritura: 'no_procede' }, limitaciones, honestidad: { datosAusentesDeclarados: true },
  };
  return { informe, umbrales: u, descartados };
}

/**
 * Señales mínimas y SIN datos personales del informe del Agente 10, pensadas para que el Director las facilite a otros agentes (p. ej. el 06) sin duplicar el informe.
 * Solo ids de producto y la naturaleza de los datos; nunca cifras de tráfico individuales.
 */
export function senalesParaAgentes(informe) {
  if (!informe || informe.agente !== '10') return null;
  const ids = (regla) => informe.hallazgos.filter((x) => x.regla === regla).map((x) => x.elemento);
  return { agente: '10', idEjecucion: informe.idEjecucion, generadoEn: informe.generadoEn, origenDatos: informe.fuente.origenDatos, completo: informe.completo, altaSalidaPocoTrafico: ids('producto_alta_salida_poco_trafico'), altoTraficoBajaSalida: ids('producto_alto_trafico_baja_salida'), huella: sha256(canonico(informe)) };
}
