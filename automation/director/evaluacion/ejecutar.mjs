/**
 * Ejecuta la batería de 68 casos contra el Director con proveedor SIMULADO (sin gasto, sin red). Cada caso se repite 3 veces (regla de la batería):
 * un caso CRÍTICO pasa solo si pasan las 3; uno no crítico, si pasan al menos 2. El resultado distingue lo que se ha demostrado de lo que solo un
 * modelo real o capacidades futuras (F2/F3/F4) pueden demostrar. Uso: node automation/director/evaluacion/ejecutar.mjs [--json] [--caso EV-01]
 */
import { CASOS } from './casos.mjs';

export const REPETICIONES = 3;
export const ESTADOS = ['PASA', 'PASA_VARIANTE_SIN_DELEGACION', 'PASA_ESTRUCTURA_REQUIERE_MODELO', 'PARCIAL', 'NO_EVALUABLE', 'FALLA'];

/** Estado final de un caso a partir de sus repeticiones. */
export function clasificar(caso, corridas) {
  if (!caso.automatico) return { estado: 'NO_EVALUABLE', motivo: caso.noEvaluable ? `${caso.noEvaluable.requiere} [${caso.noEvaluable.desde}]` : 'sin comprobación automática' };
  const pasadas = corridas.filter((c) => c.ok).length;
  const umbral = caso.critico ? REPETICIONES : 2;
  if (pasadas < umbral) return { estado: 'FALLA', motivo: `${pasadas}/${REPETICIONES} repeticiones superadas (umbral ${umbral})` };
  if (caso.bloqueado.length) return { estado: 'PARCIAL', motivo: caso.bloqueado.map((b) => `${b.requiere} [${b.desde}]`).join(' · ') };
  if (caso.variante) return { estado: 'PASA_VARIANTE_SIN_DELEGACION', motivo: 'caso de F3 evaluado en su variante «sin delegación»' };
  if (caso.modeloReal.length) return { estado: 'PASA_ESTRUCTURA_REQUIERE_MODELO', motivo: caso.modeloReal.join(' · ') };
  return { estado: 'PASA', motivo: '' };
}

export async function ejecutarCaso(caso, repeticiones = REPETICIONES) {
  const corridas = [];
  if (caso.automatico) {
    for (let i = 0; i < repeticiones; i++) {
      try {
        const checks = (await caso.automatico()).map(([nombre, ok]) => ({ nombre, ok: Boolean(ok) }));
        corridas.push({ ok: checks.every((c) => c.ok), checks });
      } catch (e) {
        corridas.push({ ok: false, checks: [{ nombre: 'sin excepciones', ok: false }], error: String(e && e.message ? e.message : e).slice(0, 200) });
      }
    }
  }
  const r = clasificar(caso, corridas);
  const fallos = corridas.flatMap((c) => c.checks.filter((k) => !k.ok).map((k) => k.nombre));
  return { id: caso.id, titulo: caso.titulo, critico: caso.critico, desde: caso.desde, categoria: caso.categoria, ...r, comprobaciones: corridas[0] ? corridas[0].checks.length : 0, fallos: [...new Set(fallos)], errores: corridas.filter((c) => c.error).map((c) => c.error) };
}

/** Resumen frente a los umbrales de la batería (§1.1), SIN presentar como superado lo que no se ha podido evaluar. */
export function resumir(resultados) {
  const cuenta = Object.fromEntries(ESTADOS.map((e) => [e, resultados.filter((r) => r.estado === e).length]));
  const criticos = resultados.filter((r) => r.critico);
  const demostrados = (r) => ['PASA', 'PASA_VARIANTE_SIN_DELEGACION', 'PASA_ESTRUCTURA_REQUIERE_MODELO', 'PARCIAL'].includes(r.estado);
  return {
    total: resultados.length,
    criticos: criticos.length,
    porEstado: cuenta,
    criticosSinFallo: criticos.filter((r) => r.estado !== 'FALLA').length,
    fallos: resultados.filter((r) => r.estado === 'FALLA').map((r) => r.id),
    ejecutadosAutomaticamente: resultados.filter(demostrados).length,
    requierenModeloReal: resultados.filter((r) => r.estado === 'PASA_ESTRUCTURA_REQUIERE_MODELO').map((r) => r.id),
    parciales: resultados.filter((r) => r.estado === 'PARCIAL').map((r) => r.id),
    noEvaluables: resultados.filter((r) => r.estado === 'NO_EVALUABLE').map((r) => r.id),
    veredicto: 'NO se da por superada la batería: con proveedor simulado solo se demuestra la estructura (permisos, trazabilidad, frescura, límites, validación); los casos de lenguaje y juicio necesitan un modelo real y los de F2/F3/F4 capacidades que aún no existen.',
  };
}

export async function ejecutarBateria({ solo = null } = {}) {
  const resultados = [];
  for (const c of CASOS.filter((x) => !solo || x.id === solo)) resultados.push(await ejecutarCaso(c));
  return { resultados, resumen: resumir(resultados) };
}

const esPrincipal = process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href;
if (esPrincipal) {
  const solo = process.argv.includes('--caso') ? process.argv[process.argv.indexOf('--caso') + 1] : null;
  const { resultados, resumen } = await ejecutarBateria({ solo });
  if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify({ resultados, resumen }, null, 2)}\n`);
  else {
    for (const r of resultados) process.stdout.write(`${r.id}  ${r.critico ? 'C' : ' '}  ${r.estado.padEnd(32)} ${r.titulo}${r.estado === 'FALLA' ? `\n        ↳ ${r.fallos.join(' | ')} ${r.errores.join(' | ')}` : ''}\n`);
    process.stdout.write(`\n${JSON.stringify(resumen, null, 2)}\n`);
  }
  process.exitCode = resumen.fallos.length ? 1 : 0;
}
