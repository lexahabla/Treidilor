/**
 * TREIDILOR — AGENTE 11: WEBS NICHO.
 *
 * Misión: identificar oportunidades de mercado para sitios web nicho,
 * evaluar viabilidad de categorías y planificar expansión mediante sitios
 * especializados.
 *
 * Especialidad: oportunidades de nicho, viabilidad de categorías,
 * expansión de sitios especializados.
 *
 * Herramientas reales: resumen_catalogo, listar_categorias, analisis_precios,
 * buscar_productos (solo lectura).
 */

import { AgenteBase, type ContextoAgente, type ResultadoAgente } from './agente-base';
import { herramientaResumenCatalogo, herramientaListarCategorias, herramientaAnalisisPrecios, herramientaBuscarProductos } from './herramientas-catalogo';

const SYSTEM_PROMPT_11 = [
  'Eres el Agente 11 de Treidilor: Expansión mediante webs nicho.',
  'Tu misión es identificar oportunidades de mercado para sitios web nicho y',
  'evaluar la viabilidad de categorías para sitios especializados.',
  '',
  'Reglas:',
  '- Solo trabajas con datos reales del catálogo (solo lectura).',
  '- No compres dominios, hosting ni servicios sin autorización.',
  '- No prometas tráfico ni ingresos para sitios nicho.',
  '- Basate en huecos de catálogo y categorías con pocos productos.',
  '- Responde siempre en español, de forma profesional y concisa.',
].join('\n');

export const CFG_11 = {
  id: '11',
  nombre: 'Expansión mediante webs nicho',
  mision: 'Identificar oportunidades de nicho y evaluar viabilidad de sitios especializados.',
  especialidad: 'Oportunidades de nicho, viabilidad de categorías, expansión.',
  systemPrompt: SYSTEM_PROMPT_11,
  herramientas: [
    herramientaResumenCatalogo,
    herramientaListarCategorias,
    herramientaAnalisisPrecios,
    herramientaBuscarProductos,
  ],
  permisos: ['catalog:read', 'nicho:proponer'],
  riesgo: 'bajo' as const,
  permiteEfectos: false,
};

export class Agente11WebsNicho extends AgenteBase {
  constructor(conversacion?: string) {
    super(CFG_11, conversacion);
  }

  async ejecutar(ctx: ContextoAgente): Promise<ResultadoAgente> {
    const entrada = ctx.entrada;
    const evidencias: ResultadoAgente['evidencias'] = [];
    const herramientasUsadas: ResultadoAgente['herramientasUsadas'] = [];

    const resumen = await herramientaResumenCatalogo.ejecutar({});
    herramientasUsadas.push({ nombre: resumen.nombre, argumentos: resumen.argumentos, ok: resumen.ok, datos: resumen.datos, motivo: resumen.motivo });

    const categorias = await herramientaListarCategorias.ejecutar({});
    herramientasUsadas.push({ nombre: categorias.nombre, argumentos: categorias.argumentos, ok: categorias.ok, datos: categorias.datos, motivo: categorias.motivo });

    const analisis = await herramientaAnalisisPrecios.ejecutar({});
    herramientasUsadas.push({ nombre: analisis.nombre, argumentos: analisis.argumentos, ok: analisis.ok, datos: analisis.datos, motivo: analisis.motivo });

    const contextoDatos = JSON.stringify({
      resumen: resumen.ok ? resumen.datos : null,
      categorias: categorias.ok ? categorias.datos : null,
      analisisPrecios: analisis.ok ? analisis.datos : null,
      objetivo: entrada.objetivo ?? entrada.tarea ?? 'Oportunidades de webs nicho',
    }, null, 2);

    const resultadoIA = await this.inferirConMemoria(
      `Tarea de webs nicho: "${String(entrada.objetivo ?? entrada.tarea ?? 'Identificar oportunidades de nicho')}."\n\nDatos reales del catálogo (solo lectura):\n${contextoDatos}\n\nSintetiza en español: (1) categorías con pocos productos (huecos de mercado potencial), (2) categorías con buena densidad de productos (mercado maduro), (3) oportunidades de sitios nicho basadas en datos reales, (4) factores de viabilidad a considerar, (5) limitaciones. No compres dominios ni servicios sin autorización. No prometas tráfico ni ingresos. Si algo no consta, dilo explícitamente.`,
      ctx,
      { usarHerramientas: false }
    );

    return {
      agente: this.cfg.id,
      trabajoId: ctx.trabajoId ?? `t-11-${Date.now()}`,
      estado: resumen.ok && categorias.ok ? 'completada' : 'pendiente',
      respuesta: resultadoIA.texto,
      evidencias,
      herramientasUsadas,
      limitaciones: [
        ...(resumen.ok ? [] : ['No se pudo leer el resumen del catálogo.']),
        ...(categorias.ok ? [] : ['No se pudo leer el listado de categorías.']),
        'La creación de sitios nicho y la compra de dominios/hosting requieren autorización explícita del propietario.',
      ],
      avisos: [],
      proveedor: resultadoIA.proveedor,
      modelo: resultadoIA.modelo,
      duracionMs: resultadoIA.duracionMs,
      solicitudesAutorizacion: [],
    };
  }
}
