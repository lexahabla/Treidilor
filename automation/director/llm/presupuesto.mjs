/**
 * Agente 00 · F1.5 · PRESUPUESTO Y CONTROL DE CONSUMO DE IA (D9). PURO: sin red ni disco; el reloj se inyecta.
 *  · El consumo REAL está DESACTIVADO por defecto y NINGÚN gasto está autorizado todavía.
 *  · Límites configurables (por defecto 1 €/día y 10 €/mes) con BLOQUEO PREVENTIVO: se bloquea la llamada si el consumo acumulado
 *    más el peor caso de esa llamada (entrada estimada + salida máxima) superaría el tope. Parada automática hasta el siguiente periodo.
 *  · Los tokens se ESTIMAN (rotulado) y el coste solo se calcula con una tarifa declarada; sin tarifa verificada no se puede acotar el
 *    gasto, así que NO se permite una llamada real. Nunca se inventan tokens ni saldos.
 *  · El gasto se reconstruye del ledger (eventos `consumo`): reserva previa + liquidación; una reserva sin liquidar cuenta como gastada.
 */
import { ErrorProtocolo } from '../protocolo.mjs';

export const CONFIG_PRESUPUESTO = Object.freeze({
  consumoRealActivado: false, // interruptor general: nada real sin activarlo Y sin autorización de gasto
  topeDiarioEur: 1,
  topeMensualEur: 10,
  avisoFraccion: 0.8, // aviso al 80 %
  maxTokensSalida: 400,
});

/** Estimación conservadora de tokens para texto en español (≈ 3,5 caracteres por token). Es una ESTIMACIÓN, no una medición. */
export const estimarTokens = (texto) => Math.ceil(String(texto ?? '').length / 3.5);

/** Tarifa: { entradaEurPor1M, salidaEurPor1M, verificacion: 'verificada'|'estimada'|'no_disponible', fecha? }. null = no disponible. */
export function costeEur(tokensEntrada, tokensSalida, tarifa) {
  if (!tarifa || typeof tarifa.entradaEurPor1M !== 'number' || typeof tarifa.salidaEurPor1M !== 'number') return null;
  return (tokensEntrada * tarifa.entradaEurPor1M + tokensSalida * tarifa.salidaEurPor1M) / 1e6;
}

const inicioDiaUtc = (ms) => Date.parse(`${new Date(ms).toISOString().slice(0, 10)}T00:00:00.000Z`);
const inicioMesUtc = (ms) => Date.parse(`${new Date(ms).toISOString().slice(0, 7)}-01T00:00:00.000Z`);
const siguienteDia = (ms) => inicioDiaUtc(ms) + 86400000;
const siguienteMes = (ms) => { const d = new Date(inicioMesUtc(ms)); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); };

/** Autorización de gasto del propietario (hoy no existe ninguna). Debe ser expresa, con tope propio y caducidad. */
export function autorizacionVigente(aut, ahora, config = CONFIG_PRESUPUESTO) {
  if (!aut || typeof aut !== 'object') return { ok: false, motivo: 'sin_autorizacion_de_gasto' };
  if (aut.por !== 'propietario' || !aut.idAutorizacion) return { ok: false, motivo: 'autorizacion_no_valida' };
  if (!(Date.parse(aut.caducaEn) > ahora)) return { ok: false, motivo: 'autorizacion_caducada' };
  if (!(aut.topeDiarioEur > 0) || aut.topeDiarioEur > config.topeDiarioEur) return { ok: false, motivo: 'tope_de_autorizacion_superior_al_configurado' };
  return { ok: true, motivo: null };
}

export class Presupuesto {
  /** @param {{config?:object, reloj?:()=>number, llamadas?:Array}} o  llamadas: [{idLlamada, instante(ms), costeEur, simulado}] ya liquidadas o reservadas. */
  constructor({ config = {}, reloj = () => Date.now(), llamadas = [] } = {}) {
    this.config = { ...CONFIG_PRESUPUESTO, ...config };
    for (const k of ['topeDiarioEur', 'topeMensualEur']) if (!(this.config[k] > 0)) throw new ErrorProtocolo('solicitud_invalida', `${k} debe ser positivo.`);
    this.reloj = reloj;
    this.llamadas = [...llamadas];
  }

  /** Reconstruye el gasto desde eventos `consumo` del ledger (reserva `fase:'previa'`; liquidación `fase:'liquidacion'`). */
  static desdeEventos(eventos, opciones = {}) {
    const porLlamada = new Map();
    for (const e of eventos) {
      if (e.tipo !== 'consumo' || !e.datos || !e.datos.idLlamada) continue;
      const p = porLlamada.get(e.datos.idLlamada) || { idLlamada: e.datos.idLlamada, instante: Date.parse(e.instante), costeEur: 0, simulado: Boolean(e.datos.simulado) };
      if (e.datos.fase === 'previa' && !p.liquidada) p.costeEur = e.datos.costeEstimadoMaxEur ?? 0;
      if (e.datos.fase === 'liquidacion') { p.costeEur = e.datos.costeEur ?? p.costeEur; p.liquidada = true; }
      p.simulado = Boolean(e.datos.simulado);
      porLlamada.set(e.datos.idLlamada, p);
    }
    return new Presupuesto({ ...opciones, llamadas: [...porLlamada.values()] });
  }

  /** Gasto REAL acumulado (las llamadas simuladas cuestan 0 y no cuentan). */
  acumulado(ahora = this.reloj()) {
    const d0 = inicioDiaUtc(ahora);
    const m0 = inicioMesUtc(ahora);
    let dia = 0;
    let mes = 0;
    for (const l of this.llamadas) {
      if (l.simulado) continue;
      if (l.instante >= m0) mes += l.costeEur;
      if (l.instante >= d0) dia += l.costeEur;
    }
    return { diaEur: dia, mesEur: mes };
  }

  /** Estado: desactivado (consumo real apagado) | normal | aviso | agotado. */
  estado(ahora = this.reloj()) {
    if (!this.config.consumoRealActivado) return 'desactivado';
    const a = this.acumulado(ahora);
    if (a.diaEur >= this.config.topeDiarioEur || a.mesEur >= this.config.topeMensualEur) return 'agotado';
    if (a.diaEur >= this.config.topeDiarioEur * this.config.avisoFraccion || a.mesEur >= this.config.topeMensualEur * this.config.avisoFraccion) return 'aviso';
    return 'normal';
  }

  /**
   * Bloqueo PREVENTIVO de una llamada real. `costeMaxEur` = peor caso (entrada estimada + salida máxima). Devuelve { ok, motivo, bloqueadoHasta?, restante }.
   * Sin consumo activado, sin tarifa o sin autorización vigente: no.
   */
  puedeGastar(costeMaxEur, { autorizacion = null, ahora = this.reloj() } = {}) {
    const a = this.acumulado(ahora);
    const restante = { diaEur: Math.max(0, this.config.topeDiarioEur - a.diaEur), mesEur: Math.max(0, this.config.topeMensualEur - a.mesEur) };
    if (!this.config.consumoRealActivado) return { ok: false, motivo: 'consumo_real_desactivado', restante };
    const aut = autorizacionVigente(autorizacion, ahora, this.config);
    if (!aut.ok) return { ok: false, motivo: aut.motivo, restante };
    if (typeof costeMaxEur !== 'number' || !Number.isFinite(costeMaxEur)) return { ok: false, motivo: 'tarifa_no_disponible: sin tarifa no se puede acotar el gasto', restante };
    const topeDia = Math.min(this.config.topeDiarioEur, autorizacion.topeDiarioEur);
    if (a.diaEur + costeMaxEur > topeDia) return { ok: false, motivo: 'tope_diario', bloqueadoHasta: new Date(siguienteDia(ahora)).toISOString(), restante };
    if (a.mesEur + costeMaxEur > this.config.topeMensualEur) return { ok: false, motivo: 'tope_mensual', bloqueadoHasta: new Date(siguienteMes(ahora)).toISOString(), restante };
    return { ok: true, motivo: null, restante };
  }

  /** Anota una llamada (reserva o liquidación ya escrita en el ledger). */
  anotar({ idLlamada, instante, costeEur: c, simulado = false }) {
    const previa = this.llamadas.find((l) => l.idLlamada === idLlamada);
    if (previa) { previa.costeEur = c; previa.instante = instante; previa.simulado = simulado; } else this.llamadas.push({ idLlamada, instante, costeEur: c, simulado });
  }

  resumen(ahora = this.reloj()) {
    const a = this.acumulado(ahora);
    return { estado: this.estado(ahora), ...a, topeDiarioEur: this.config.topeDiarioEur, topeMensualEur: this.config.topeMensualEur, consumoRealActivado: this.config.consumoRealActivado, llamadasRegistradas: this.llamadas.length };
  }
}
