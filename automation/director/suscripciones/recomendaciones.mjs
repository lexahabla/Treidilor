/**
 * Agente 00 / 13 · F1.5 · COMPARACIÓN DE COSTES Y RECOMENDACIONES (PURO, determinista, con datos del inventario; sin red).
 *  · Solo compara modelos de modalidades que los agentes pueden usar (API de pago por uso y créditos de API) y con TARIFA DISPONIBLE: un modelo sin
 *    tarifa no entra en el ranking (se lista aparte): no se inventan precios.
 *  · Las suscripciones interactivas y herramientas oficiales se valoran SOLO para uso humano interactivo; nunca como backend de agentes.
 *  · La confianza de cada cifra depende de la procedencia de sus datos (alta: todo verificado; media: tarifas verificadas y volumen estimado; baja: estimaciones).
 *  · Las recomendaciones son PROPUESTAS (L1): ninguna contrata, cambia de plan ni activa consumo; todas exigen autorización expresa del propietario.
 */
import { CATEGORIAS_TAREA, elegibilidadAutomatizacion, esDatoUtil } from './modelo.mjs';

const DIA = 86400000;
const orden = { verificado: 0, estimado: 1, no_disponible: 2 };
const peor = (...v) => v.reduce((a, b) => (orden[b] > orden[a] ? b : a), 'verificado');

/** Coste de UNA llamada: { eur, verificacion } o null si falta la tarifa. */
export function costeLlamada(modelo, perfil) {
  const e = modelo.tarifa && modelo.tarifa.entradaEurPor1M;
  const s = modelo.tarifa && modelo.tarifa.salidaEurPor1M;
  if (!esDatoUtil(e) || !esDatoUtil(s)) return null;
  return { eur: (perfil.tokensEntrada * e.valor + perfil.tokensSalida * s.valor) / 1e6, verificacion: peor(e.verificacion, s.verificacion) };
}

/** Modelos candidatos (API/créditos, plan activo, tarifa disponible, calidad suficiente) y los excluidos con su motivo. */
export function candidatosDeTarea(inv, tarea, { calidadMinima = null } = {}) {
  const cat = CATEGORIAS_TAREA[tarea];
  if (!cat) throw new Error('tarea_desconocida');
  const minima = calidadMinima ?? cat.calidadMinima;
  const candidatos = [];
  const excluidos = [];
  for (const pl of inv.planes) {
    if (pl.activo === false) continue;
    const el = elegibilidadAutomatizacion(pl);
    if (el.permitido !== 'si') { if ((pl.modelos || []).length) excluidos.push({ plan: pl.id, motivo: `modalidad no utilizable por agentes automáticos (${pl.tipo})` }); continue; }
    for (const m of pl.modelos || []) {
      if (!m.categorias.includes(tarea)) continue;
      const c = costeLlamada(m, cat);
      if (!c) { excluidos.push({ plan: pl.id, modelo: m.id, motivo: 'sin tarifa disponible: no se estima su coste (no se inventa)' }); continue; }
      if (!esDatoUtil(m.calidad) || m.calidad.valor < minima) { excluidos.push({ plan: pl.id, modelo: m.id, motivo: esDatoUtil(m.calidad) ? `calidad ${m.calidad.valor} < mínima ${minima}` : 'calidad no disponible: no se puede garantizar el mínimo' }); continue; }
      candidatos.push({ plan: pl, modelo: m, costeLlamadaEur: c.eur, verificacionCoste: c.verificacion, calidad: m.calidad.valor, avisosElegibilidad: el.avisos });
    }
  }
  return { candidatos, excluidos, calidadMinima: minima };
}

/** Compara el coste mensual de los candidatos de una tarea para un volumen dado. Ordenado por coste, desempate por calidad y por id. */
export function compararModelos(inv, tarea, { volumenMensual = null, calidadMinima = null } = {}) {
  const cat = CATEGORIAS_TAREA[tarea];
  const volumen = volumenMensual ?? cat.volumenMensualDefecto;
  const { candidatos, excluidos, calidadMinima: minima } = candidatosDeTarea(inv, tarea, { calidadMinima });
  const lista = candidatos.map((c) => {
    const bruto = c.costeLlamadaEur * volumen;
    const creditos = c.plan.tipo === 'creditos_api_incluidos' && esDatoUtil(c.plan.creditosDisponiblesEur) ? c.plan.creditosDisponiblesEur : null;
    const cubierto = creditos !== null && creditos.valor >= bruto;
    return { plan: c.plan.id, tipoPlan: c.plan.tipo, modelo: c.modelo.id, calidad: c.calidad, costeLlamadaEur: c.costeLlamadaEur, costeMensualEur: bruto, cubiertoPorCreditos: cubierto, costeEfectivoEur: cubierto ? 0 : bruto, verificacionCoste: c.verificacionCoste, verificacionCreditos: creditos ? creditos.verificacion : null, volumenMensual: volumen, avisos: c.avisosElegibilidad };
  }).sort((a, b) => a.costeEfectivoEur - b.costeEfectivoEur || b.calidad - a.calidad || a.modelo.localeCompare(b.modelo));
  return { tarea, calidadMinima: minima, volumenMensual: volumen, ranking: lista, excluidos, estimacionDeTokens: true };
}

/**
 * Mejor combinación para un conjunto de tareas. `uso`: { tarea: volumenMensual } (estimación del propietario o medida). `topeMensualEur` (D9, 10 por defecto).
 * Devuelve asignaciones, total, si cabe en el presupuesto, avisos y PROPUESTAS (siempre con requiereAutorizacion y sin acción automática).
 */
export function recomendar(inv, { uso = {}, topeMensualEur = 10 } = {}) {
  const tareas = Object.keys(uso).length ? Object.keys(uso) : Object.keys(CATEGORIAS_TAREA);
  const asignaciones = [];
  const sinOpcion = [];
  let total = 0;
  for (const t of tareas) {
    const cmp = compararModelos(inv, t, { volumenMensual: uso[t] ?? null });
    if (!cmp.ranking.length) { sinOpcion.push({ tarea: t, motivo: cmp.excluidos.length ? 'ningún modelo con tarifa y calidad disponibles' : 'ningún plan utilizable por agentes', excluidos: cmp.excluidos }); continue; }
    const mejor = cmp.ranking[0];
    total += mejor.costeEfectivoEur;
    const usoMedido = uso[t] !== undefined;
    const confianza = mejor.verificacionCoste === 'verificado' && usoMedido ? 'alta' : mejor.verificacionCoste === 'verificado' ? 'media' : 'baja';
    asignaciones.push({ tarea: t, ...mejor, confianza, alternativas: cmp.ranking.slice(1, 3).map((a) => ({ plan: a.plan, modelo: a.modelo, costeEfectivoEur: a.costeEfectivoEur, calidad: a.calidad })), excluidos: cmp.excluidos });
  }
  const avisos = [];
  const propuestas = [];
  if (sinOpcion.length) avisos.push(`Sin opción utilizable para: ${sinOpcion.map((s) => s.tarea).join(', ')} (faltan tarifas, calidad o planes que los agentes puedan usar).`);
  const dentro = total <= topeMensualEur;
  if (!dentro) {
    avisos.push(`El coste mensual estimado (${total.toFixed(2)} €) supera el tope configurado (${topeMensualEur} €).`);
    propuestas.push({ texto: 'Reducir el volumen de las tareas más caras, o usar el modelo más barato que cumpla la calidad mínima en las tareas de menor exigencia.', requiereAutorizacion: true, accionAutomatica: false });
  }
  if (asignaciones.some((a) => a.confianza === 'baja')) avisos.push('Hay cifras ESTIMADAS (tarifas sin verificar): contrástalas con la facturación real antes de decidir.');
  // Alternativa humana: valorar suscripciones/herramientas oficiales SOLO para uso interactivo.
  for (const pl of inv.planes.filter((p) => ['suscripcion_interactiva', 'herramienta_oficial'].includes(p.tipo) && p.activo !== false)) {
    propuestas.push({ texto: `«${pl.nombre}» (${pl.tipo}) sirve para el uso interactivo del propietario; NO puede ser el backend de los agentes (${elegibilidadAutomatizacion(pl).motivo}).`, requiereAutorizacion: false, accionAutomatica: false, informativa: true });
  }
  return { asignaciones, sinOpcion, totalMensualEur: total, topeMensualEur, dentroDePresupuesto: dentro, avisos, propuestas, estimacionDeTokens: true };
}

const fracc = (c) => (esDatoUtil(c.limite) && esDatoUtil(c.usado) && c.limite.valor > 0 ? c.usado.valor / c.limite.valor : null);

/**
 * Avisos de utilización, límites y renovación con ALTERNATIVAS. No inventa: si el uso o el límite no constan, lo dice. `ahora` en ms.
 * Umbrales configurables: avisoCuota (0,8), renovacionDias (7), verificacionAntiguaDias (30).
 */
export function avisosDeUso(inv, ahora, { avisoCuota = 0.8, renovacionDias = 7, verificacionAntiguaDias = 30 } = {}) {
  const avisos = [];
  const alternativasPara = (plan) => {
    const alt = [];
    const otros = inv.planes.filter((p) => p.id !== plan.id && p.activo !== false && p.proveedor !== plan.proveedor && ['api_pago_por_uso', 'creditos_api_incluidos'].includes(p.tipo) && (p.modelos || []).length);
    if (esDatoUtil(plan.renovacion)) alt.push(`esperar a la renovación (${plan.renovacion.valor})`);
    if (otros.length) alt.push(`derivar las tareas de los agentes a ${otros.map((o) => o.nombre).join(' o ')} (solo si el propietario lo autoriza)`);
    alt.push('usar un modelo más barato que cumpla la calidad mínima, o reducir el volumen');
    return alt;
  };
  for (const pl of inv.planes.filter((p) => p.activo !== false)) {
    for (const c of pl.cuotas || []) {
      const f = fracc(c);
      const rotulo = `${pl.nombre} · ${c.nombre}`;
      if (f === null) { avisos.push({ nivel: 'info', plan: pl.id, cuota: c.id, texto: `No consta el uso o el límite de «${rotulo}» (${!esDatoUtil(c.limite) ? 'límite' : 'uso'} no disponible): no se estima.`, alternativas: [] }); continue; }
      const dato = peor(c.limite.verificacion, c.usado.verificacion);
      if (f >= 1) avisos.push({ nivel: 'alto', plan: pl.id, cuota: c.id, texto: `Cuota agotada: «${rotulo}» (${c.usado.valor}/${c.limite.valor} ${c.unidad}, ${dato}).`, alternativas: alternativasPara(pl) });
      else if (f >= avisoCuota) avisos.push({ nivel: 'medio', plan: pl.id, cuota: c.id, texto: `«${rotulo}» al ${Math.round(f * 100)} % (${c.usado.valor}/${c.limite.valor} ${c.unidad}, ${dato}).`, alternativas: alternativasPara(pl) });
      if (c.usado.verificacion === 'verificado' && esFecha(c.usado.fecha) && ahora - Date.parse(c.usado.fecha) > verificacionAntiguaDias * DIA) avisos.push({ nivel: 'info', plan: pl.id, cuota: c.id, texto: `El uso de «${rotulo}» se verificó hace más de ${verificacionAntiguaDias} días: puede estar desfasado.`, alternativas: [] });
    }
    if (esDatoUtil(pl.renovacion)) {
      const dias = (Date.parse(pl.renovacion.valor) - ahora) / DIA;
      if (dias >= 0 && dias <= renovacionDias) avisos.push({ nivel: 'medio', plan: pl.id, texto: `«${pl.nombre}» se renueva en ${Math.ceil(dias)} día(s) (${pl.renovacion.valor}${pl.costeFijoMensualEur && esDatoUtil(pl.costeFijoMensualEur) ? `, ${pl.costeFijoMensualEur.valor} €` : ''}). Revisar si interesa mantenerlo (no se cambia nada sin tu autorización).`, alternativas: [] });
    } else avisos.push({ nivel: 'info', plan: pl.id, texto: `No consta la fecha de renovación de «${pl.nombre}».`, alternativas: [] });
    if (esDatoUtil(pl.creditosDisponiblesEur) && pl.creditosDisponiblesEur.valor <= 1) avisos.push({ nivel: 'medio', plan: pl.id, texto: `Quedan pocos créditos en «${pl.nombre}» (${pl.creditosDisponiblesEur.valor} €, ${pl.creditosDisponiblesEur.verificacion}).`, alternativas: alternativasPara(pl) });
  }
  const orden2 = { alto: 0, medio: 1, info: 2 };
  return avisos.sort((a, b) => orden2[a.nivel] - orden2[b.nivel] || a.plan.localeCompare(b.plan));
}
function esFecha(s) { return typeof s === 'string' && !Number.isNaN(Date.parse(s)); }
