/**
 * Agente 00 · I-1 (A-02) · ÍNDICE DE RESPUESTA RÁPIDA de claves de idempotencia (ventana inicial de 7 días, configurable).
 *  · La clave NO vence: existe mientras exista el ledger. El índice solo ACELERA la respuesta para las de los últimos 7 días; pasado ese
 *    plazo (o si el índice falta, se corrompe o va por detrás) se consulta el ledger, que es la FUENTE DE VERDAD.
 *  · Es DERIVADO y RECONSTRUIBLE: nunca decide nada que el ledger no confirme; si su ancla (secuencia + huella del último evento indexado)
 *    no coincide con el ledger, se descarta y se reconstruye.
 *  · Escritura atómica (archivo temporal + renombrado). Solo contiene claves (hash) e ids; sin secretos ni contenido.
 */
import fs from 'node:fs';
import path from 'node:path';

export const VENTANA_INDICE_MS = 7 * 86400000;
const VERSION = 'indice-claves/1';

export class IndiceClaves {
  /** @param {{ruta?:string|null, reloj?:()=>number, ventanaMs?:number}} o  ruta: archivo JSON junto al ledger (null = solo memoria). */
  constructor({ ruta = null, reloj = () => Date.now(), ventanaMs = VENTANA_INDICE_MS } = {}) {
    this.ruta = ruta;
    this.reloj = reloj;
    this.ventanaMs = ventanaMs;
    this.entradas = new Map(); // clave → { idTarea, instante(ms) }
    this.secuencia = 0;
    this.ultimaHuella = null;
    this.reconstrucciones = 0;
    this.estadisticas = { aciertosIndice: 0, aciertosLedger: 0, fallos: 0 };
  }

  _aplicar(ev) {
    if ((ev.tipo === 'delegacion_enviada' || ev.tipo === 'delegacion_simulada') && ev.datos && ev.datos.claveIdempotencia) {
      this.entradas.set(ev.datos.claveIdempotencia, { idTarea: (ev.refs || {}).idTarea || null, instante: Date.parse(ev.instante) });
    }
    this.secuencia = ev.secuencia;
    this.ultimaHuella = ev.huella;
  }

  _podar(ahora) {
    for (const [k, v] of this.entradas) if (ahora - v.instante > this.ventanaMs) this.entradas.delete(k);
  }

  /** Carga el índice guardado si es coherente con el ledger; si no, lo descarta. Devuelve 'cargado' | 'descartado' | 'ausente'. */
  cargar(ledger) {
    if (!this.ruta || !fs.existsSync(this.ruta)) return 'ausente';
    try {
      const d = JSON.parse(fs.readFileSync(this.ruta, 'utf8'));
      if (d.version !== VERSION || !Array.isArray(d.entradas) || !Number.isInteger(d.secuencia)) return this._descartar();
      const ev = d.secuencia === 0 ? null : ledger.leer({ desde: d.secuencia, hasta: d.secuencia })[0];
      if (d.secuencia > 0 && (!ev || ev.huella !== d.ultimaHuella)) return this._descartar();
      this.entradas = new Map(d.entradas.map(([k, id, t]) => [k, { idTarea: id, instante: t }]));
      this.secuencia = d.secuencia;
      this.ultimaHuella = d.ultimaHuella;
      return 'cargado';
    } catch {
      return this._descartar();
    }
  }
  _descartar() {
    this.entradas = new Map();
    this.secuencia = 0;
    this.ultimaHuella = null;
    return 'descartado';
  }

  /** Pone el índice al día con el ledger (solo lo posterior a su ancla). Si el ledger no encaja con el ancla, reconstruye entero. */
  sincronizar(ledger) {
    if (this.secuencia > 0) {
      const ev = ledger.leer({ desde: this.secuencia, hasta: this.secuencia })[0];
      if (!ev || ev.huella !== this.ultimaHuella) { this._descartar(); this.reconstrucciones += 1; }
    }
    for (const ev of ledger.leer({ desde: this.secuencia + 1 })) this._aplicar(ev);
    this._podar(this.reloj());
    return this;
  }

  /**
   * ¿Ya se usó esta clave? Primero el índice (rápido, últimos 7 días); si no está, se CONSULTA EL LEDGER (la clave no vence).
   * Devuelve { idTarea, via:'indice'|'ledger' } o null.
   */
  buscar(clave, ledger) {
    const e = this.entradas.get(clave);
    if (e && this.reloj() - e.instante <= this.ventanaMs) { this.estadisticas.aciertosIndice += 1; return { idTarea: e.idTarea, via: 'indice' }; }
    for (const ev of ledger.leer((x) => (x.tipo === 'delegacion_enviada' || x.tipo === 'delegacion_simulada') && x.datos && x.datos.claveIdempotencia === clave)) {
      this.estadisticas.aciertosLedger += 1;
      return { idTarea: (ev.refs || {}).idTarea || null, via: 'ledger' };
    }
    this.estadisticas.fallos += 1;
    return null;
  }

  /** Guardado atómico (índice derivado: perderlo no pierde nada). */
  guardar() {
    if (!this.ruta) return false;
    const tmp = `${this.ruta}.tmp`;
    fs.mkdirSync(path.dirname(this.ruta), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify({ version: VERSION, secuencia: this.secuencia, ultimaHuella: this.ultimaHuella, entradas: [...this.entradas].map(([k, v]) => [k, v.idTarea, v.instante]) }));
    fs.renameSync(tmp, this.ruta);
    return true;
  }
}
