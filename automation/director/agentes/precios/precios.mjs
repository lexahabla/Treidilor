/**
 * Agente 05 · ANALISTA DE OFERTAS Y PRECIOS (ficha `automation/agents/05-analista-precios.md`; riesgo ALTO: «nunca escribe precios: solo propone»).
 * Capacidad registrada: `05.detectar-caidas-precio` (L1, propuesta). CAPA DE ANÁLISIS sobre las funciones de Treidilor que YA existen; no es un sistema paralelo:
 *   · `commercialClaims.verifiedDiscountOf` — un descuento solo existe con observación verificada (regla de la ficha);
 *   · `offerObservations` (`freshnessOf`, `evaluateDrop`, `contextKey`, `isValidPrice`, `DEFAULT_MAX_AGE_HOURS`) — vigencia y bajadas comparables;
 *   · `priceHistoryView.collectPoints` — lecturas reales (verificadas si hay ≥ 2);
 *   · `comparableOffers.getComparableOffers` — ofertas del MISMO producto entre comercios, sin mezclar variantes, condiciones ni vendedores dudosos.
 * Regla de honestidad: nunca se presenta como precio actual verificado un precio sin observación, desactualizado, en otra moneda, distinto del publicado o de datos de
 * prueba; los descuentos declarados sin verificación se cuentan («descuentos falsos evitados») pero NO se presentan. Todo es PROPUESTA informativa: ninguna función
 * escribe precios ni catálogo; el catálogo de entrada se compara por huella antes y después. Los módulos TypeScript se INYECTAN ya cargados (`cargarMotorPrecios`).
 */
import { createHash } from 'node:crypto';
import { ESQUEMA_INFORME_AGENTE, ErrorProtocolo, canonico, sha256 } from '../../protocolo.mjs';

/** Umbrales iniciales CONFIGURABLES (se declaran en el informe; no son verdades del mercado). */
export const UMBRALES = Object.freeze({ saltoBajadaPct: 40, saltoSubidaPct: 60, bajoMedianaPct: 50, anteriorInfladoVeces: 3, minLecturasVerificadas: 3, ahorroMinimoEur: 1, bajoMediaPct: 5 });

/** Carga las funciones existentes de Treidilor (requiere el cargador de TypeScript del proyecto). */
export async function cargarMotorPrecios() {
  if (!process.env.TRADYLOR_DATA_DIR) process.env.TRADYLOR_DATA_DIR = `${process.env.TEMP || process.env.TMPDIR || '/tmp'}/tai-precios-sin-datos`; // nunca datos reales
  const base = new URL('../../../../src/lib/', import.meta.url);
  try {
    const [comparable, claims, obs, history, engine] = await Promise.all(['comparableOffers.ts', 'commercialClaims.ts', 'offerObservations.ts', 'priceHistoryView.ts', 'jsonImport/engine.ts'].map((f) => import(new URL(f, base).href)));
    return { comparable, claims, obs, history, engine };
  } catch (e) {
    throw new ErrorProtocolo('origen_no_disponible', 'Las funciones existentes de precios no están disponibles (hace falta el cargador de TypeScript del proyecto).', { causa: String(e && e.code ? e.code : 'import') });
  }
}
const exigir = (m) => { if (!m || !m.comparable || !m.claims || !m.obs || !m.history) throw new ErrorProtocolo('origen_no_disponible', 'Las funciones existentes de precios no están cargadas: no se puede analizar.'); return m; };
const plano = (x) => JSON.parse(JSON.stringify(x));
const r2 = (n) => Math.round(n * 100) / 100;
const pct = (a, b) => (b ? r2(((a - b) / b) * 100) : null);
const mediana = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const PRI = { P1: 'P1', P2: 'P2', P3: 'P3', P4: 'P4' };
const h = (clave, regla, elemento, evidencia, { certeza = null, prioridad = null, accion = null } = {}) => ({ clave, regla, certeza, prioridad, gravedad: null, elemento, evidencia, accionSugerida: accion });

/** Estado del precio de una ficha según su ÚLTIMA observación (vigencia, moneda y coincidencia con el publicado). */
export function estadoDelPrecio(p, m, ahora, maxEdadH) {
  const obs = Array.isArray(p.extra && p.extra.observations) ? p.extra.observations : [];
  const ultima = obs[obs.length - 1];
  if (!ultima) return { estado: 'sin_verificar', motivo: 'sin_observaciones_verificadas', ultima: null };
  if (!ultima.verifiedAt) return { estado: 'sin_verificar', motivo: 'observacion_sin_fecha_de_verificacion', ultima };
  if (String((ultima.context && ultima.context.currency) || 'EUR').toUpperCase() !== 'EUR') return { estado: 'otra_moneda', motivo: 'observacion_en_otra_moneda', ultima };
  if (!m.obs.isValidPrice(ultima.price) || Math.abs(Number(ultima.price) - Number(p.price)) > 0.005) return { estado: 'no_coincide', motivo: 'la_observacion_no_corresponde_al_precio_publicado', ultima };
  const f = m.obs.freshnessOf(ultima.verifiedAt, maxEdadH, new Date(ahora));
  return { estado: f === 'fresh' ? 'verificado_vigente' : f === 'stale' ? 'verificado_desactualizado' : 'sin_verificar', motivo: f === 'fresh' ? null : f === 'stale' ? `verificado hace más de ${maxEdadH} h` : 'sin_fecha', ultima };
}

/** Analiza UNA ficha. Devuelve { hallazgos, contadores }. Puro: no modifica nada. */
function analizarFicha(p, m, catalogo, ahora, maxEdadH) {
  const out = [];
  const c = { verificadoVigente: 0, desactualizado: 0, sinVerificar: 0, descuentoVerificado: 0, descuentoNoVerificado: 0, caidaVerificada: 0, anomalias: 0, oportunidades: 0, comparaciones: 0, correcciones: 0 };
  const id = p.id;
  const titulo = p.title ?? id;
  const ahoraD = new Date(ahora);
  const est = estadoDelPrecio(p, m, ahora, maxEdadH);
  const ev = (extra = {}) => ({ producto: id, titulo, precioPublicado: p.price, ...extra });
  // 1) ¿El precio es un precio ACTUAL verificado?
  if (est.estado === 'verificado_vigente') { c.verificadoVigente += 1; out.push(h(`producto:${id}:precio`, 'precio_verificado_vigente', id, ev({ verificadoEn: est.ultima.verifiedAt, capturadoEn: est.ultima.capturedAt, fuente: est.ultima.source, mercado: est.ultima.context.destination, moneda: est.ultima.context.currency, maxEdadHoras: maxEdadH }), { certeza: 'confirmado', prioridad: PRI.P4 })); }
  else if (est.estado === 'verificado_desactualizado') { c.desactualizado += 1; out.push(h(`producto:${id}:precio`, 'precio_verificado_desactualizado', id, ev({ verificadoEn: est.ultima.verifiedAt, motivo: est.motivo, fuente: est.ultima.source }), { certeza: 'advertencia', prioridad: PRI.P3, accion: 'Tratar el precio como histórico: volver a verificarlo antes de presentarlo como actual' })); }
  else if (est.estado === 'sin_verificar') { c.sinVerificar += 1; out.push(h(`producto:${id}:precio`, 'precio_no_verificado', id, ev({ motivo: est.motivo }), { certeza: 'no_verificable', prioridad: PRI.P4, accion: 'Sin observación verificada no se afirma que sea el precio actual' })); }
  else { c.anomalias += 1; c.correcciones += 1; const regla = est.estado === 'otra_moneda' ? 'anomalia:moneda_no_eur' : 'anomalia:precio_publicado_no_coincide'; out.push(h(`producto:${id}:precio`, regla, id, ev({ motivo: est.motivo, observado: est.ultima.price, moneda: est.ultima.context && est.ultima.context.currency, verificadoEn: est.ultima.verifiedAt }), { certeza: 'confirmado', prioridad: PRI.P2, accion: est.estado === 'otra_moneda' ? 'La última lectura está en otra moneda: no es comparable; verificarla en EUR antes de usarla' : 'Revisar el precio publicado frente a la última lectura (corrección propuesta; la aplica una persona)' })); if (est.estado === 'no_coincide') { out.push(h(`propuesta:${id}:corregir_precio`, 'propuesta_correccion', id, ev({ precioObservado: est.ultima.price, precioPublicado: p.price, verificadoEn: est.ultima.verifiedAt, requiereAutorizacion: true, nivel: 'L4' }), { certeza: 'advertencia', prioridad: PRI.P2, accion: 'Propuesta con evidencia: la corrección de precios es L4 humano; este agente NO escribe precios' })); } }
  // 2) Descuento: solo existe con observación verificada
  const dv = m.claims.verifiedDiscountOf(p);
  const declarado = Number(p.originalPrice) > Number(p.price) && Number(p.price) > 0;
  if (dv.verified && est.estado === 'verificado_vigente') { c.descuentoVerificado += 1; out.push(h(`producto:${id}:descuento`, 'descuento_verificado', id, ev({ porcentaje: dv.pct, precioAnterior: dv.previousPrice, verificadoEn: dv.asOf }), { certeza: 'confirmado', prioridad: PRI.P3 })); }
  else if (dv.verified) out.push(h(`producto:${id}:descuento`, 'descuento_verificado_obsoleto', id, ev({ porcentaje: dv.pct, precioAnterior: dv.previousPrice, verificadoEn: dv.asOf, motivo: 'la verificación no es vigente' }), { certeza: 'advertencia', prioridad: PRI.P3, accion: 'No presentarlo como descuento actual hasta una nueva verificación' }));
  else if (declarado) { c.descuentoNoVerificado += 1; out.push(h(`producto:${id}:descuento`, 'descuento_declarado_no_verificado', id, ev({ precioAnteriorDeclarado: p.originalPrice, motivo: dv.reason }), { certeza: 'no_verificable', prioridad: PRI.P3, accion: 'Descuento declarado por el comercio: NO se presenta como descuento (descuento falso evitado)' })); }
  if (declarado && Number(p.originalPrice) > UMBRALES.anteriorInfladoVeces * Number(p.price)) { c.anomalias += 1; out.push(h(`producto:${id}:anterior_inflado`, 'anomalia:precio_anterior_inflado', id, ev({ precioAnteriorDeclarado: p.originalPrice, veces: r2(Number(p.originalPrice) / Number(p.price)) }), { certeza: 'advertencia', prioridad: PRI.P2, accion: 'El precio anterior declarado es varias veces el actual: sospechoso; no usarlo' })); }
  // 3) Bajadas y saltos entre lecturas comparables
  const obs = Array.isArray(p.extra && p.extra.observations) ? p.extra.observations : [];
  const ultima = obs[obs.length - 1];
  let brusco = false;
  if (ultima) {
    const previa = [...obs.slice(0, -1)].reverse().find((o) => o.contextKey === ultima.contextKey);
    if (previa && m.obs.isValidPrice(previa.price) && m.obs.isValidPrice(ultima.price)) {
      const variacion = pct(ultima.price, previa.price);
      if (variacion <= -UMBRALES.saltoBajadaPct || variacion >= UMBRALES.saltoSubidaPct) { brusco = true; c.anomalias += 1; out.push(h(`producto:${id}:salto`, 'anomalia:salto_brusco', id, ev({ de: previa.price, a: ultima.price, variacionPct: variacion, entre: [previa.capturedAt, ultima.capturedAt], umbralBajadaPct: UMBRALES.saltoBajadaPct, umbralSubidaPct: UMBRALES.saltoSubidaPct }), { certeza: 'advertencia', prioridad: PRI.P2, accion: 'Posible error de lectura, otra variante o precio de promoción relámpago: no tratarlo como oportunidad hasta comprobarlo' })); }
      const senal = m.obs.evaluateDrop(`${id}`, previa, ultima, ahoraD);
      if (senal && !brusco) {
        const verificada = Boolean(previa.verifiedAt && ultima.verifiedAt) && est.estado === 'verificado_vigente';
        if (verificada) { c.caidaVerificada += 1; out.push(h(`producto:${id}:caida`, 'caida_verificada', id, ev({ de: senal.previousPrice, a: senal.price, variacionPct: variacion, detectadaEn: senal.detectedAt, contexto: ultima.contextKey }), { certeza: 'confirmado', prioridad: PRI.P3 })); }
        else out.push(h(`producto:${id}:caida`, 'caida_no_verificada', id, ev({ de: senal.previousPrice, a: senal.price, variacionPct: variacion, motivo: est.estado !== 'verificado_vigente' ? 'la última lectura no es vigente' : 'falta verificación' }), { certeza: 'no_verificable', prioridad: PRI.P4, accion: 'No se anuncia como bajada hasta verificarla' }));
      }
    }
  }
  // 4) Historial real: precio sospechosamente bajo / por debajo de su media verificada
  const puntos = m.history.collectPoints(p).filter((x) => x.source === 'verificada');
  if (puntos.length >= UMBRALES.minLecturasVerificadas && est.estado === 'verificado_vigente') {
    const previos = puntos.slice(0, -1).map((x) => x.price);
    const med = mediana(previos);
    const media = previos.reduce((s, x) => s + x, 0) / previos.length;
    if (Number(p.price) < (med * UMBRALES.bajoMedianaPct) / 100 && !brusco) { c.anomalias += 1; out.push(h(`producto:${id}:muy_bajo`, 'anomalia:precio_sospechosamente_bajo', id, ev({ mediana: r2(med), lecturasVerificadas: puntos.length, umbralPct: UMBRALES.bajoMedianaPct }), { certeza: 'advertencia', prioridad: PRI.P2, accion: 'Por debajo de la mitad de su mediana verificada: comprobar variante, condición o error antes de proponerlo' })); }
    else if (!brusco && Number(p.price) < media * (1 - UMBRALES.bajoMediaPct / 100) && media - Number(p.price) >= UMBRALES.ahorroMinimoEur) { c.oportunidades += 1; out.push(h(`oportunidad:${id}:bajo_su_media`, 'oportunidad_ahorro', id, ev({ tipo: 'por_debajo_de_su_media_verificada', mediaVerificada: r2(media), ahorroEur: r2(media - Number(p.price)), ahorroPct: r2(((media - Number(p.price)) / media) * 100), lecturasVerificadas: puntos.length }), { certeza: 'confirmado', prioridad: PRI.P3, accion: 'Propuesta informativa: precio verificado vigente por debajo de su media verificada' })); }
  }
  if (ultima && ultima.inStock === false) out.push(h(`producto:${id}:stock`, 'sin_stock', id, ev({ verificadoEn: ultima.verifiedAt }), { certeza: 'confirmado', prioridad: PRI.P4, accion: 'Sin stock: un precio sin stock no es una oferta comprable' }));
  // 5) Comparación entre comercios del MISMO producto (controles existentes de identidad, variante, condición y vendedor)
  const cmp = m.comparable.getComparableOffers(p, { catalog: catalogo });
  if (cmp.offers.length >= 1) {
    c.comparaciones += cmp.state === 'multiple' ? 1 : 0;
    const frescas = (o) => o.verified && m.obs.freshnessOf(o.verifiedAt, maxEdadH, ahoraD) === 'fresh';
    const ofertas = cmp.offers.map((o) => ({ offerId: o.offerId, plataforma: o.platform, vendedor: o.sellerLabel, precio: o.price, envio: o.shipping.cost !== null ? o.shipping.cost : o.shipping.free === true ? 0 : null, total: o.totalPrice, condicion: o.condition, verificada: o.verified, verificadaVigente: frescas(o), verificadaEn: o.verifiedAt || null, descuentoVerificado: Boolean(o.discount && o.discount.verified) }));
    out.push(h(`producto:${id}:comparacion`, cmp.state === 'multiple' ? (cmp.comparisonReady ? 'comparacion_entre_comercios' : 'comparacion_no_concluyente') : 'oferta_unica', id, ev({ estado: cmp.state, ofertas, verificadas: cmp.verifiedCount, listaParaComparar: cmp.comparisonReady, otrasVersiones: cmp.otherVersions.length, aRevisarPorUnaPersona: cmp.needsReview.length, excluidas: cmp.excluded.map((x) => x.reason ?? x), motivoNoConcluyente: cmp.state === 'multiple' && !cmp.comparisonReady ? (cmp.verifiedCount < 2 ? 'menos_de_2_ofertas_verificadas' : 'totales_desconocidos') : null }), { certeza: cmp.comparisonReady ? 'confirmado' : 'no_verificable', prioridad: PRI.P3, accion: cmp.state === 'multiple' && !cmp.comparisonReady ? 'No se puede afirmar cuál es la más barata: faltan ofertas verificadas o totales con envío conocidos' : null }));
    if (cmp.comparisonReady && cmp.cheapest) {
      const comparables = cmp.offers.filter((o) => o.totalPrice !== null);
      const todasVigentes = comparables.every(frescas);
      const segunda = comparables.filter((o) => o.offerId !== cmp.cheapest.offerId).sort((a, b) => a.totalPrice - b.totalPrice)[0];
      const ahorro = segunda ? r2(segunda.totalPrice - cmp.cheapest.totalPrice) : 0;
      if (!todasVigentes) out.push(h(`producto:${id}:comparacion_vigencia`, 'comparacion_no_vigente', id, ev({ motivo: 'alguna oferta comparada no tiene verificación vigente', maxEdadHoras: maxEdadH }), { certeza: 'advertencia', prioridad: PRI.P3, accion: 'Volver a verificar las ofertas antes de afirmar cuál es la más barata' }));
      else if (ahorro >= UMBRALES.ahorroMinimoEur) { c.oportunidades += 1; out.push(h(`oportunidad:${id}:entre_comercios`, 'oportunidad_ahorro', id, ev({ tipo: 'mas_barata_entre_comercios', masBarata: { offerId: cmp.cheapest.offerId, plataforma: cmp.cheapest.platform, vendedor: cmp.cheapest.sellerLabel, total: cmp.cheapest.totalPrice }, frenteA: { offerId: segunda.offerId, plataforma: segunda.platform, total: segunda.totalPrice }, ahorroEur: ahorro, criterio: 'precio + envío; solo ofertas verificadas vigentes del mismo producto, condición y variante' }), { certeza: 'confirmado', prioridad: PRI.P3, accion: 'Propuesta informativa: la oferta más barata por total con envío, con lecturas vigentes' })); }
    }
  }
  return { hallazgos: out, contadores: c };
}

/**
 * Analiza el catálogo (o una ficha). Devuelve { informe, resumen, huellaCatalogo }. NO escribe nada. `catalogo`: fichas con la forma real de Treidilor.
 * `ahora` en ms; `maxEdadHoras` = vigencia de una lectura (por defecto la de Treidilor, 72 h).
 */
export function analizarPrecios({ motor, catalogo, ahora = Date.now(), productoId = null, maxEdadHoras = null, sintetico = true, capacidad = '05.detectar-caidas-precio' }) {
  const m = exigir(motor);
  if (!Array.isArray(catalogo)) throw new ErrorProtocolo('origen_no_disponible', 'No hay catálogo de referencia para analizar.');
  const maxEdadH = maxEdadHoras ?? m.obs.DEFAULT_MAX_AGE_HOURS;
  const antes = sha256(canonico(catalogo));
  const copia = plano(catalogo);
  const fichas = productoId ? copia.filter((p) => p.id === productoId) : copia;
  if (productoId && !fichas.length) return { informe: null, motivo: 'producto_no_encontrado', disponibles: copia.map((p) => p.id), huellaCatalogo: antes };
  const hallazgos = [];
  const total = { verificadoVigente: 0, desactualizado: 0, sinVerificar: 0, descuentoVerificado: 0, descuentoNoVerificado: 0, caidaVerificada: 0, anomalias: 0, oportunidades: 0, comparaciones: 0, correcciones: 0 };
  for (const p of fichas) {
    const r = analizarFicha(p, m, copia, ahora, maxEdadH);
    hallazgos.push(...r.hallazgos);
    for (const k of Object.keys(total)) total[k] += r.contadores[k];
  }
  if (sha256(canonico(catalogo)) !== antes) throw new ErrorProtocolo('interno', 'El catálogo de referencia cambió durante el análisis (no debe ocurrir).');
  const porCerteza = { confirmado: 0, advertencia: 0, no_verificable: 0 };
  const porPrioridad = { P1: 0, P2: 0, P3: 0, P4: 0 };
  for (const x of hallazgos) { if (x.certeza in porCerteza) porCerteza[x.certeza] += 1; if (x.prioridad in porPrioridad) porPrioridad[x.prioridad] += 1; }
  const sinVerificar = total.sinVerificar + total.desactualizado;
  const limitaciones = [
    `Vigencia de una lectura: ${maxEdadH} h (la de Treidilor); fuera de ella el precio se trata como histórico, nunca como actual.`,
    'Los umbrales de anomalía son valores iniciales configurables, no verdades del mercado: señalan qué conviene comprobar.',
    'Solo se compara el MISMO producto con los controles existentes (condición, variante, vendedor); las ofertas de otra versión o ambiguas no se mezclan y quedan para una persona.',
    'Este agente NO escribe precios ni catálogo: las correcciones son propuestas con evidencia y las aplica una persona (L4).',
    'No se consultan precios externos (sin red, sin créditos): solo se analizan las observaciones ya guardadas.',
  ];
  if (sintetico) limitaciones.push('DATOS DE PRUEBA: catálogo y observaciones sintéticos; no son precios reales.');
  const completo = sinVerificar === 0 && fichas.length > 0;
  const informe = {
    esquema: ESQUEMA_INFORME_AGENTE, agente: '05', capacidad, version: '0.1.0', entorno: 'local',
    idEjecucion: `pr-${createHash('sha256').update(canonico({ antes, productoId, maxEdadH })).digest('hex').slice(0, 10)}`,
    generadoEn: new Date(ahora).toISOString(), completo,
    fuente: { sistema: 'funciones_de_treidilor_de_precios', tabla: 'catalogo_de_referencia', host: null, registrosLeidos: fichas.length, origenDatos: sintetico ? 'datos_de_prueba' : 'exportacion', origenEjecucion: 'local', firma: antes },
    resumen: { estadoCalidad: completo ? 'completa' : 'incompleta', incidencias: total.anomalias, porGravedad: { critica: 0, alta: 0, media: 0, baja: 0, info: 0 }, porCerteza, porPrioridad, elementosAfectados: total.anomalias + total.descuentoNoVerificado + sinVerificar, elementosTotales: fichas.length, productos: fichas.length, verificadosVigentes: total.verificadoVigente, desactualizados: total.desactualizado, sinVerificar: total.sinVerificar, descuentosVerificados: total.descuentoVerificado, descuentosNoVerificados: total.descuentoNoVerificado, caidasVerificadas: total.caidaVerificada, anomalias: total.anomalias, oportunidades: total.oportunidades, comparaciones: total.comparaciones, correccionesPropuestas: total.correcciones },
    hallazgos, seguimiento: null, persistencia: { escritura: 'no_procede' }, limitaciones, honestidad: { datosAusentesDeclarados: true },
  };
  return { informe, huellaCatalogo: antes, umbrales: { ...UMBRALES, maxEdadHoras: maxEdadH } };
}
