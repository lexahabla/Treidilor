/**
 * Agente 13 (canal del Agente 00) · INFORME AL PROPIETARIO sobre utilización, coste, límites y alternativas de IA. PURO.
 * El Agente 13 no tiene lógica propia: este módulo produce el CONTENIDO (estructurado y en texto) a partir del inventario y de las recomendaciones;
 * el canal (texto/voz) solo lo presenta. Toda cifra lleva su procedencia (verificado / estimado / no disponible) y todo cambio es una PROPUESTA que exige
 * autorización expresa: este módulo no contrata, no cambia planes y no activa consumo.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validarInventario, elegibilidadAutomatizacion, esDatoUtil } from './modelo.mjs';
import { avisosDeUso, recomendar } from './recomendaciones.mjs';

export const RUTA_INVENTARIO_SIMULADO = path.join(path.dirname(fileURLToPath(import.meta.url)), 'inventario-ia.simulado.json');

/** Carga y valida un inventario. Lanza si es inválido (no se usa a medias). */
export function cargarInventario(ruta = RUTA_INVENTARIO_SIMULADO) {
  const inv = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  const v = validarInventario(inv);
  if (!v.ok) throw new Error(`Inventario inválido: ${v.errores.slice(0, 5).join(' | ')}`);
  return inv;
}

const eur = (n) => `${Number(n).toFixed(2)} €`;
const rotulo = (d) => (d ? `${String(d.verificacion).replace('_', ' ')}${d.fecha ? ` ${String(d.fecha).slice(0, 10)}` : ''}` : 'no disponible');

/**
 * Construye el informe para el Agente 13. `presupuestoIA`: resumen de Presupuesto (consumo real de IA del propio Director). `ahora` en ms.
 * Devuelve { categoria, titulo, texto, secciones, avisos, propuestas, fuentes, limitaciones, simulado }.
 */
export function informeSuscripciones(inv, { ahora, uso = {}, topeMensualEur = 10, presupuestoIA = null } = {}) {
  const planes = inv.planes.filter((p) => p.activo !== false).map((p) => {
    const el = elegibilidadAutomatizacion(p);
    return {
      id: p.id, nombre: p.nombre, tipo: p.tipo, proveedor: p.proveedor,
      costeFijoMensual: p.costeFijoMensualEur, creditos: p.creditosDisponiblesEur, renovacion: p.renovacion,
      utilizablePorAgentes: el.permitido, motivo: el.motivo, requisitos: el.requisitos, avisosElegibilidad: el.avisos,
      cuotas: (p.cuotas || []).map((c) => ({ nombre: c.nombre, unidad: c.unidad, ventana: c.ventana, limite: c.limite, usado: c.usado })),
    };
  });
  const rec = recomendar(inv, { uso, topeMensualEur });
  const avisosUso = avisosDeUso(inv, ahora);
  const fuentes = [];
  for (const p of inv.planes) for (const d of [p.costeFijoMensualEur, p.creditosDisponiblesEur, p.renovacion]) if (d && d.fuente) fuentes.push({ plan: p.id, fuente: d.fuente, verificacion: d.verificacion, fecha: d.fecha });
  const fijo = inv.planes.filter((p) => p.activo !== false && esDatoUtil(p.costeFijoMensualEur));
  const sinCoste = inv.planes.filter((p) => p.activo !== false && !esDatoUtil(p.costeFijoMensualEur)).map((p) => p.nombre);
  const totalFijo = fijo.reduce((s, p) => s + p.costeFijoMensualEur.valor, 0);
  const lineas = [];
  lineas.push(`${inv.sintetico ? 'DATOS SIMULADOS (ficticios, solo para probar la lógica; no son tus suscripciones ni tus saldos). ' : ''}Resumen de IA (inventario ${inv.version || 's/v'}):`);
  lineas.push(`Costes fijos mensuales conocidos: ${eur(totalFijo)}${fijo.length ? ` (${fijo.map((p) => `${p.nombre} ${eur(p.costeFijoMensualEur.valor)} [${p.costeFijoMensualEur.verificacion}]`).join(', ')})` : ''}.${sinCoste.length ? ` No consta el coste de: ${sinCoste.join(', ')}.` : ''}`);
  lineas.push('Qué puede usar cada agente automático:');
  for (const p of planes) lineas.push(`· ${p.nombre} [${p.tipo}] → ${p.utilizablePorAgentes === 'si' ? 'SÍ (con clave API propia, presupuesto y autorización)' : p.utilizablePorAgentes === 'no_como_backend' ? 'NO como backend (solo uso interactivo con la herramienta oficial)' : 'NO (uso personal interactivo)'}.`);
  if (presupuestoIA) lineas.push(`Consumo real de IA del Director: ${presupuestoIA.consumoRealActivado ? 'ACTIVADO' : 'DESACTIVADO'}; hoy ${eur(presupuestoIA.diaEur)} de ${eur(presupuestoIA.topeDiarioEur)}, mes ${eur(presupuestoIA.mesEur)} de ${eur(presupuestoIA.topeMensualEur)}.`);
  if (rec.asignaciones.length) {
    lineas.push(`Recomendación por tarea (estimación; coste mensual total ${eur(rec.totalMensualEur)} frente a un tope de ${eur(topeMensualEur)}${rec.dentroDePresupuesto ? '' : ' → SUPERA el tope'}):`);
    for (const a of rec.asignaciones) lineas.push(`· ${a.tarea}: ${a.modelo} (${a.plan}) ≈ ${eur(a.costeEfectivoEur)}/mes, calidad ${a.calidad}/5, confianza ${a.confianza} [coste ${a.verificacionCoste}${a.cubiertoPorCreditos ? '; cubierto por créditos' : ''}].`);
  }
  if (rec.sinOpcion.length) lineas.push(`Sin opción utilizable (faltan tarifas, calidad o planes aptos): ${rec.sinOpcion.map((s) => s.tarea).join(', ')}.`);
  if (avisosUso.length) { lineas.push('Avisos:'); for (const a of avisosUso) lineas.push(`${a.nivel === 'alto' ? '‼' : a.nivel === 'medio' ? '⚠' : 'ℹ'} ${a.texto}${a.alternativas.length ? ` Alternativas: ${a.alternativas.join('; ')}.` : ''}`); }
  for (const a of rec.avisos) lineas.push(`⚠ ${a}`);
  const propuestas = rec.propuestas;
  if (propuestas.some((p) => p.requiereAutorizacion)) lineas.push('Propuestas (ninguna se aplica sola; contratar, cambiar de plan o activar consumo exige tu autorización expresa):\n' + propuestas.filter((p) => p.requiereAutorizacion).map((p) => `· ${p.texto}`).join('\n'));
  lineas.push('Ningún cambio se aplica solo: contratar, cambiar de plan o activar consumo exige tu autorización expresa.');
  const limitaciones = [
    'Los tokens por tarea son una ESTIMACIÓN configurable; no hay mediciones reales de consumo.',
    'Lo marcado «no disponible» no se calcula ni se inventa; lo «estimado» no está contrastado con la facturación real.',
    'La elegibilidad para automatizar es un criterio técnico conservador, no asesoría legal: los términos vigentes de cada proveedor los verifica el propietario.',
  ];
  lineas.push(`Limitaciones: ${limitaciones.join(' ')}`);
  return { categoria: propuestas.some((p) => p.requiereAutorizacion) ? 'propuesta' : 'consulta', titulo: 'Utilización, costes y límites de IA', texto: lineas.join('\n'), secciones: { planes, recomendaciones: rec, avisosUso }, avisos: [...avisosUso.map((a) => a.texto), ...rec.avisos], propuestas, fuentes, limitaciones, simulado: Boolean(inv.sintetico), accionesAutomaticas: 0, procedenciaPlanes: planes.map((p) => ({ plan: p.id, coste: rotulo(p.costeFijoMensual), creditos: rotulo(p.creditos) })) };
}
