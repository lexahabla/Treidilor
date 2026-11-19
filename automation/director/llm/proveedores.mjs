/**
 * Agente 00 · F1.5 · ADAPTADORES DE PROVEEDOR LLM (D2: arquitectura multimodelo, intercambiables).
 * Interfaz común: `async completar({ sistema, usuario, maxTokensSalida }) → { texto, tokensEntrada, tokensSalida, modelo }`
 * y metadatos `{ id, modelo, real, tarifa }`. NINGÚN adaptador de este archivo abre red:
 *   · `ProveedorSimulado`: sin consumo; determinista; con modos de FALLO para pruebas (JSON roto, proveedor caído, modelo que intenta relajar permisos…).
 *   · `ProveedorOpenAI`: PREPARADO (construye la petición y mide) pero NO llama a nada: necesita un `transporte` inyectado que HOY no existe
 *     (no hay módulo de transporte ni lectura de claves en el repositorio). La clave se referencia por NOMBRE de variable, nunca por valor.
 * Un adaptador solo devuelve TEXTO: no tiene acceso a herramientas, al registro ni al ledger.
 */
import { interpretar } from '../intencion.mjs';
import { ErrorProtocolo } from '../protocolo.mjs';
import { estimarTokens } from './presupuesto.mjs';

export const MODELO_INICIAL_CONFIGURABLE = 'gpt-6.1-terra'; // indicado por el propietario; SIN verificar disponibilidad en su cuenta

const RESPUESTAS_SIMULADAS = {
  conversacion: 'Propuesta (no verificada con datos): puede tener sentido, pero faltan datos de mercado y de rendimiento propios; los agentes de investigación, precios y analítica aún no están operativos. Antes de decidir convendría validar la idea con datos reales.',
};

export class ProveedorSimulado {
  /** @param {{id?:string, modelo?:string, modo?:string, interprete?:Function}} o  modos: normal | json_roto | campo_faltante | caido | una_vez_roto | siempre_roto | relaja | campo_extra | json_con_prosa */
  constructor({ id = 'simulado', modelo = 'simulado-1', modo = 'normal', interprete = interpretar } = {}) {
    this.id = id;
    this.modelo = modelo;
    this.real = false;
    this.tarifa = null;
    this.modo = modo;
    this.interprete = interprete;
    this.llamadas = 0;
  }

  async completar({ usuario, sistema = '', maxTokensSalida = 400 }) {
    this.llamadas += 1;
    const tokensEntrada = estimarTokens(sistema) + estimarTokens(usuario);
    if (this.modo === 'caido') throw new ErrorProtocolo('origen_no_disponible', 'El proveedor no responde.');
    const i = this.interprete(usuario);
    const propuesta = { tipo: i.tipo, agentes: i.agentes, parametros: i.parametros, tema: i.tema, pregunta: i.pregunta, ambiguedad: i.ambiguedad ?? (i.aclaracion && i.tipo === 'desconocida' ? i.aclaracion : null), confianza: i.tipo === 'desconocida' ? 0.3 : 0.9 };
    if (i.tipo === 'conversacion') propuesta.respuesta = RESPUESTAS_SIMULADAS.conversacion;
    let texto = JSON.stringify(propuesta);
    if (this.modo === 'json_roto' || (this.modo === 'una_vez_roto' && this.llamadas === 1) || this.modo === 'siempre_roto') texto = texto.slice(0, Math.floor(texto.length / 2));
    if (this.modo === 'campo_faltante') { const { pregunta, ...resto } = propuesta; texto = JSON.stringify(resto); }
    if (this.modo === 'campo_extra') texto = JSON.stringify({ ...propuesta, riesgoMax: 'L0', ejecutar: true });
    if (this.modo === 'json_con_prosa') texto = `Claro, aquí tienes: ${texto}`;
    if (this.modo === 'relaja') texto = JSON.stringify({ ...propuesta, tipo: 'consultar_informe', agentes: ['04'], parametros: {}, tema: null, pregunta: 'presente', ambiguedad: null, confianza: 0.99 });
    return { texto, tokensEntrada, tokensSalida: Math.min(maxTokensSalida, estimarTokens(texto)), modelo: this.modelo };
  }
}

export class ProveedorOpenAI {
  /**
   * @param {{modelo?:string, tarifa?:object|null, transporte?:Function|null, variableClave?:string, region?:string|null}} o
   * `tarifa` (EUR por millón de tokens) la declara el propietario; sin tarifa verificada no se puede acotar el gasto y no se permite llamada real.
   */
  constructor({ modelo = MODELO_INICIAL_CONFIGURABLE, tarifa = null, transporte = null, variableClave = 'OPENAI_API_KEY', region = null } = {}) {
    this.id = 'openai';
    this.modelo = modelo;
    this.real = true;
    this.tarifa = tarifa;
    this.transporte = transporte;
    this.variableClave = variableClave; // solo el NOMBRE; el valor lo resolvería el transporte al activarse (no existe aún)
    this.region = region;
    this.disponibilidadVerificada = false; // «sujeto a disponibilidad en la cuenta»: nadie lo ha comprobado
  }

  /** Construye la petición (sin enviarla): permite revisar exactamente qué saldría. Formato SIN verificar contra la cuenta real. */
  construirSolicitud({ sistema, usuario, maxTokensSalida, esquema }) {
    return {
      metodo: 'POST',
      url: 'https://api.openai.com/v1/responses',
      cabeceras: { 'Content-Type': 'application/json', Authorization: `Bearer <valor de ${this.variableClave} (lo inyecta el transporte)>` },
      cuerpo: {
        model: this.modelo,
        instructions: sistema,
        input: usuario,
        max_output_tokens: maxTokensSalida,
        store: false,
        text: { format: { type: 'json_schema', name: 'intencion', strict: true, schema: esquema ?? null } },
      },
      verificadoContraLaApi: false,
    };
  }

  async completar({ sistema, usuario, maxTokensSalida, esquema }) {
    if (typeof this.transporte !== 'function') throw new ErrorProtocolo('permiso_denegado', 'No hay transporte configurado: en F1.5 no se hace ninguna llamada real.');
    const solicitud = this.construirSolicitud({ sistema, usuario, maxTokensSalida, esquema });
    const r = await this.transporte(solicitud);
    if (!r || typeof r.texto !== 'string') throw new ErrorProtocolo('origen_no_disponible', 'Respuesta del proveedor sin texto.');
    return { texto: r.texto, tokensEntrada: Number.isInteger(r.tokensEntrada) ? r.tokensEntrada : estimarTokens(sistema) + estimarTokens(usuario), tokensSalida: Number.isInteger(r.tokensSalida) ? r.tokensSalida : estimarTokens(r.texto), modelo: r.modelo || this.modelo };
  }
}
