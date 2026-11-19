/**
 * Agente 00 · F1.5 · CEREBRO LLM: conecta un adaptador de proveedor con `interpretar()` SIN ceder control al modelo.
 *   1. Contexto mínimo (D6): lista cerrada, credenciales bloqueadas, datos personales redactados.
 *   2. Puerta de gasto (D9): consumo real desactivado por defecto; sin autorización, tarifa verificada y presupuesto no se llama a un proveedor real.
 *   3. Salida validada con esquema estricto; como máximo 1 reintento interno sin efecto; si persiste, NO se actúa y se pide reformular.
 *   4. El modelo solo PROPONE una intención: el nivel de riesgo lo calcula el código; las intenciones que las reglas detectan como L4, cambio de
 *      nivel, petición de credenciales o ejecución autónoma NO se pueden relajar; el modelo no puede crear tareas, aprobaciones ni cancelaciones
 *      por su cuenta (solo si las reglas ven la misma petición); nunca ejecuta herramientas (un adaptador solo devuelve texto).
 *   5. Consumo registrado por REFERENCIA (hash y tamaños, nunca el contenido) con reserva previa; parada automática al llegar al tope.
 */
import { interpretar as interpretarReglas, RIESGO_POR_TIPO, TIPOS_SUELO } from '../intencion.mjs';
import { ErrorProtocolo, crearGeneradorIds } from '../protocolo.mjs';
import { detectarSecreto } from '../ledger.mjs';
import { construirContexto } from './contexto.mjs';
import { esquemaJson, validarSalidaIntencion } from './esquema-intencion.mjs';
import { CONFIG_PRESUPUESTO, Presupuesto, costeEur, estimarTokens } from './presupuesto.mjs';

const TIPOS_QUE_CREAN_ACCION = new Set(['lanzar_auditoria', 'detener', 'parada_total']);
const MENSAJES_PUERTA = {
  consumo_real_desactivado: 'El consumo real de IA está desactivado: trabajo en modo SOLO LECTURA SIN MODELO (reglas deterministas).',
  sin_autorizacion_de_gasto: 'No hay autorización de gasto del propietario: modo SOLO LECTURA SIN MODELO.',
  autorizacion_no_valida: 'La autorización de gasto no es válida: modo SOLO LECTURA SIN MODELO.',
  autorizacion_caducada: 'La autorización de gasto ha caducado: modo SOLO LECTURA SIN MODELO.',
  tope_de_autorizacion_superior_al_configurado: 'La autorización pide un tope superior al configurado: modo SOLO LECTURA SIN MODELO.',
  tope_diario: 'Tope diario de IA alcanzado: parada automática del uso del modelo; modo SOLO LECTURA SIN MODELO.',
  tope_mensual: 'Tope mensual de IA alcanzado: parada automática del uso del modelo; modo SOLO LECTURA SIN MODELO.',
};

export class CerebroLLM {
  /**
   * @param {{registro, proveedores:Array<{proveedor, respaldo?:boolean}>, presupuesto?:Presupuesto, config?:object, reloj?:()=>number, ids?, reglas?:Function}} o
   * config: { permitirRespaldo:false, maxReintentos:1, maxTokensSalida, autorizacionGasto:null }
   */
  constructor({ registro, proveedores = [], presupuesto = null, config = {}, reloj = () => Date.now(), ids = null, reglas = interpretarReglas } = {}) {
    this.registro = registro;
    this.proveedores = proveedores;
    this.config = { permitirRespaldo: false, maxReintentos: 1, maxTokensSalida: CONFIG_PRESUPUESTO.maxTokensSalida, autorizacionGasto: null, ...config };
    if (this.config.maxReintentos > 1) throw new ErrorProtocolo('solicitud_invalida', 'Como máximo 1 reintento interno sin efecto (A-07).');
    this.reloj = reloj;
    this.presupuesto = presupuesto || new Presupuesto({ reloj });
    this.ids = ids || crearGeneradorIds({ reloj });
    this.reglas = reglas;
    this.esquema = esquemaJson(registro);
  }

  _puerta(prov, ctx, ahora) {
    if (!prov.real) return { ok: true };
    const costeMax = costeEur(ctx.manifiesto.tokensEntradaEstimados, this.config.maxTokensSalida, prov.tarifa);
    const r = this.presupuesto.puedeGastar(costeMax, { autorizacion: this.config.autorizacionGasto, ahora });
    if (r.ok) return { ok: true, costeMax };
    const motivo = String(r.motivo).startsWith('tarifa_no_disponible') ? 'tarifa_no_disponible' : r.motivo;
    return { ok: false, motivo, bloqueadoHasta: r.bloqueadoHasta, mensaje: MENSAJES_PUERTA[motivo] || `Sin tarifa verificada no se puede acotar el gasto: modo SOLO LECTURA SIN MODELO.` };
  }

  /** Interpreta con el modelo bajo todas las salvaguardas. `registrar({tipo, datos})` escribe en el ledger (el Director lo inyecta). */
  async interpretar(texto, { canal = 'texto', registrar = () => {} } = {}) {
    const avisos = [];
    const llamadas = [];
    const piso = this.reglas(texto);
    const soloReglas = (modo, aviso) => ({ intencion: piso, origen: 'reglas', modo, avisos: aviso ? [...avisos, aviso] : avisos, llamadas });
    const ctx = construirContexto({ texto, registro: this.registro, canal });
    if (ctx.bloqueado) {
      registrar({ tipo: 'lectura_estado', datos: { fuente: 'contexto_llm', bloqueado: true, motivo: ctx.manifiesto.motivo, categoria: ctx.manifiesto.categoria } });
      return { intencion: { ...piso, tipo: 'desconocida', agentes: [], aclaracion: ctx.motivo, riesgoMax: 'L0' }, origen: 'bloqueo', modo: 'bloqueado', avisos: [ctx.motivo], llamadas };
    }
    if (!this.proveedores.length) return soloReglas('solo_lectura_sin_modelo', 'No hay proveedor de IA configurado: modo SOLO LECTURA SIN MODELO.');
    const primarios = this.proveedores.filter((p) => !p.respaldo);
    const respaldos = this.proveedores.filter((p) => p.respaldo);
    const orden = [...primarios, ...respaldos];
    let intentoRespaldo = false;
    for (const [n, { proveedor }] of orden.entries()) {
      const esRespaldo = respaldos.some((r) => r.proveedor === proveedor);
      if (esRespaldo && !this.config.permitirRespaldo) {
        avisos.push(`El proveedor principal falló y el uso del respaldo «${proveedor.id}» no está autorizado: modo SOLO LECTURA SIN MODELO.`);
        break;
      }
      const ahora = this.reloj();
      const puerta = this._puerta(proveedor, ctx, ahora);
      if (!puerta.ok) {
        if (puerta.motivo === 'tope_diario' || puerta.motivo === 'tope_mensual') registrar({ tipo: 'limite_alcanzado', datos: { ambito: 'presupuesto_ia', motivo: puerta.motivo, bloqueadoHasta: puerta.bloqueadoHasta, proveedor: proveedor.id } });
        return soloReglas('solo_lectura_sin_modelo', puerta.mensaje); // sin cambiar de proveedor ni ampliar el tope
      }
      if (esRespaldo) { intentoRespaldo = true; avisos.push(`Se usa el proveedor de respaldo «${proveedor.id}» (mismo contexto cerrado).`); registrar({ tipo: 'lectura_estado', datos: { fuente: 'cambio_de_proveedor', a: proveedor.id, contexto: ctx.manifiesto.hash } }); }
      const resultado = await this._llamarConValidacion(proveedor, ctx, puerta, { registrar, llamadas, avisos });
      if (resultado.fallo === 'proveedor') {
        registrar({ tipo: 'error', datos: { codigo: 'origen_no_disponible', proveedor: proveedor.id, motivo: 'proveedor_no_responde' } });
        avisos.push(`El proveedor «${proveedor.id}» no responde.`);
        continue;
      }
      if (resultado.fallo === 'invalida') {
        if (TIPOS_SUELO.includes(piso.tipo)) { avisos.push('La salida del modelo no era válida, pero las reglas de seguridad detectan una acción restringida: manda la regla.'); return { intencion: piso, origen: 'reglas_suelo', modo: 'modelo', avisos, llamadas }; }
        return { intencion: { ...piso, tipo: 'desconocida', agentes: [], parametros: {}, tema: null, ambiguedad: null, aclaracion: 'No he podido interpretar tu instrucción de forma segura. ¿Puedes reformularla con otras palabras?', riesgoMax: 'L0' }, origen: 'modelo_invalido', modo: 'modelo', avisos, llamadas };
      }
      return { ...this._combinar(resultado.propuesta, piso, texto, avisos), modo: proveedor.real ? 'modelo' : 'simulado', llamadas, respaldo: intentoRespaldo };
    }
    return soloReglas('solo_lectura_sin_modelo', 'No hay proveedor de IA disponible: modo SOLO LECTURA SIN MODELO.');
  }

  async _llamarConValidacion(prov, ctx, puerta, { registrar, llamadas, avisos }) {
    let reintento = false;
    for (let intento = 0; intento <= this.config.maxReintentos; intento++) {
      const ahora = this.reloj();
      const idLlamada = this.ids.nuevo('l');
      const sistema = reintento ? `${ctx.sistema}\nLa respuesta anterior no cumplía el esquema. Responde SOLO con el objeto JSON pedido.` : ctx.sistema;
      const tokensEntrada = estimarTokens(sistema) + estimarTokens(ctx.usuario);
      const base = { idLlamada, proveedor: prov.id, modelo: prov.modelo, simulado: !prov.real, estimado: true, contexto: { hash: ctx.manifiesto.hash, bytes: ctx.manifiesto.bytes, redacciones: ctx.manifiesto.redacciones, camposEnviados: ctx.manifiesto.camposEnviados }, reintento };
      // Reserva previa (solo reales): si no queda registrada, NO se llama.
      if (prov.real) {
        try { registrar({ tipo: 'consumo', datos: { ...base, fase: 'previa', tokensEntradaEstimados: tokensEntrada, costeEstimadoMaxEur: puerta.costeMax } }); } catch { avisos.push('No se pudo registrar la reserva de consumo: no se llama al modelo.'); return { fallo: 'proveedor' }; }
        this.presupuesto.anotar({ idLlamada, instante: ahora, costeEur: puerta.costeMax, simulado: false });
      }
      let r;
      try {
        r = await prov.completar({ sistema, usuario: ctx.usuario, maxTokensSalida: this.config.maxTokensSalida, esquema: this.esquema });
      } catch {
        llamadas.push({ idLlamada, proveedor: prov.id, error: true });
        return { fallo: 'proveedor' };
      }
      const coste = prov.real ? costeEur(r.tokensEntrada, r.tokensSalida, prov.tarifa) : 0;
      const liquidacion = { ...base, fase: 'liquidacion', tokensEntrada: r.tokensEntrada, tokensSalida: r.tokensSalida, costeEur: coste ?? 0 };
      try { registrar({ tipo: 'consumo', datos: liquidacion }); } catch { avisos.push('No se pudo registrar el consumo del modelo.'); }
      this.presupuesto.anotar({ idLlamada, instante: ahora, costeEur: coste ?? 0, simulado: !prov.real });
      llamadas.push({ idLlamada, proveedor: prov.id, tokensEntrada: r.tokensEntrada, tokensSalida: r.tokensSalida, costeEur: coste ?? 0, simulado: !prov.real, reintento });
      const v = validarSalidaIntencion(r.texto, this.registro);
      if (v.ok) return { propuesta: v.intencion };
      registrar({ tipo: 'error', datos: { codigo: 'solicitud_invalida', origen: 'salida_del_modelo', proveedor: prov.id, defectos: v.errores.length, intento } }); // NO se vuelca la salida rota
      reintento = true;
    }
    return { fallo: 'invalida' };
  }

  /** Mezcla la propuesta del modelo con el SUELO de reglas: el modelo nunca relaja ni crea acciones por su cuenta. */
  _combinar(propuesta, piso, texto, avisos) {
    const discrepa = propuesta.tipo !== piso.tipo;
    if (TIPOS_SUELO.includes(piso.tipo)) {
      if (discrepa) avisos.push('El modelo propuso otra cosa, pero las reglas de seguridad detectan una acción restringida: manda la regla.');
      return { intencion: piso, origen: 'reglas_suelo', avisos };
    }
    if (TIPOS_QUE_CREAN_ACCION.has(propuesta.tipo) && piso.tipo !== propuesta.tipo) {
      avisos.push('El modelo propuso una acción que las reglas no respaldan: se ignora (el modelo no puede crear tareas por su cuenta).');
      return { intencion: piso, origen: 'reglas_suelo', avisos };
    }
    const nivel = RIESGO_POR_TIPO[propuesta.tipo];
    if (Number(RIESGO_POR_TIPO[piso.tipo].slice(1)) > Number(nivel.slice(1))) {
      avisos.push('El modelo propuso un nivel de riesgo inferior al que detectan las reglas: manda la regla.');
      return { intencion: piso, origen: 'reglas_suelo', avisos };
    }
    let respuesta = propuesta.respuesta;
    if (respuesta && detectarSecreto(respuesta)) { respuesta = null; avisos.push('La respuesta libre del modelo contenía algo parecido a una credencial y se descartó.'); }
    return {
      intencion: { tipo: propuesta.tipo, agentes: propuesta.agentes, parametros: propuesta.parametros, tema: propuesta.tema, pregunta: propuesta.pregunta, ambiguedad: propuesta.ambiguedad, aclaracion: propuesta.tipo === 'desconocida' ? (propuesta.ambiguedad || 'No he entendido la instrucción.') : null, riesgoMax: nivel, confianza: propuesta.confianza, respuesta, textoPlano: piso.textoPlano },
      origen: 'llm',
      avisos,
    };
  }
}
