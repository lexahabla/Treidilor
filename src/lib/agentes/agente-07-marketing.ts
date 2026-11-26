/**
 * TREIDILOR — AGENTE 07: MARKETING Y SEO.
 *
 * Misión: diseñar estrategias de marketing y SEO para el portal de afiliación,
 * identificar palabras clave, optimizar fichas para conversión y planificar
 * campañas de captación.
 *
 * Especialidad: estrategia de marketing, SEO, embudos de conversión, campañas.
 *
 * Herramientas reales: resumen_catalogo, analisis_precios, listar_categorias,
 * buscar_productos (solo lectura).
 */

import { AgenteBase, type ContextoAgente, type ResultadoAgente } from './agente-base';
import { herramientaResumenCatalogo, herramientaAnalisisPrecios, herramientaListarCategorias, herramientaBuscarProductos } from './herramientas-catalogo';

const SYSTEM_PROMPT_07 = [
  'Eres el Agente 07 de Treidilor: Marketing y SEO.',
  'Tu misión es diseñar estrategias de marketing y optimización de conversión',
  'para el portal de afiliación Treidilor.',
  '',
  'Reglas:',
  '- Solo trabajas con datos reales del catálogo (solo lectura).',
  '- Nunca prometas posiciones de SEO ni resultados de ventas concretos.',
  '- No publique ni lance campañas sin autorización explícita.',
  '- Basate en productos, categorías y precios reales del catálogo.',
  '- Responde siempre en español, de forma profesional y concisa.',
].join('\n');

export const CFG_07 = {
  id: '07',
  nombre: 'Marketing multicanal y SEO',
  mision: 'Diseñar estrategias de marketing y SEO para el portal de afiliación.',
  especialidad: 'Estrategia de marketing, SEO, embudos de conversión, campañas.',
  systemPrompt: SYSTEM_PROMPT_07,
  herramientas: [
    herramientaResumenCatalogo,
    herramientaAnalisisPrecios,
    herramientaListarCategorias,
    herramientaBuscarProductos,
  ],
  permisos: ['catalog:read', 'marketing:proponer'],
  riesgo: 'medio' as const,
  permiteEfectos: false,
};

export class Agente07Marketing extends AgenteBase {
  constructor(conversacion?: string) {
    super(CFG_07, conversacion);
  }

  async ejecutar(ctx: ContextoAgente): Promise<ResultadoAgente> {
    const entrada = ctx.entrada;
    const evidencias: ResultadoAgente['evidencias'] = [];
    const herramientasUsadas: ResultadoAgente['herramientasUsadas'] = [];

    const resumen = await herramientaResumenCatalogo.ejecutar({});
    herramientasUsadas.push({ nombre: resumen.nombre, argumentos: resumen.argumentos, ok: resumen.ok, datos: resumen.datos, motivo: resumen.motivo });

    const analisis = await herramientaAnalisisPrecios.ejecutar({});
    herramientasUsadas.push({ nombre: analisis.nombre, argumentos: analisis.argumentos, ok: analisis.ok, datos: analisis.datos, motivo: analisis.motivo });

    const categorias = await herramientaListarCategorias.ejecutar({});
    herramientasUsadas.push({ nombre: categorias.nombre, argumentos: categorias.argumentos, ok: categorias.ok, datos: categorias.datos, motivo: categorias.motivo });

    const contextoDatos = JSON.stringify({
      resumen: resumen.ok ? resumen.datos : null,
      analisisPrecios: analisis.ok ? analisis.datos : null,
      categorias: categorias.ok ? categorias.datos : null,
      objetivo: entrada.objetivo ?? entrada.tarea ?? 'Estrategia de marketing y SEO general',
    }, null, 2);

    const resultadoIA = await this.inferirConMemoria(
      `Tarea de marketing y SEO: "${String(entrada.objetivo ?? entrada.tarea ?? 'Diseñar estrategia de marketing y SEO para el portal')}."\n\nDatos reales del catálogo (solo lectura):\n${contextoDatos}\n\nSintetiza en español: (1) oportunidades de SEO por categoría y producto, (2) estrategia de contenidos y palabras clave sugeridas, (3) embudo de conversión recomendado, (4) productos con mejor potencial de afiliación (por precio y descuento declarado), (5) campañas sugeridas (sin lanzar nada sin autorización), (6) limitaciones. No prometas posiciones de SEO ni resultados de ventas. No lances campañas sin autorización. Si algo no consta, dilo explícitamente.`,
      ctx,
      { usarHerramientas: false }
    );

    return {
      agente: this.cfg.id,
      trabajoId: ctx.trabajoId ?? `t-07-${Date.now()}`,
      estado: resumen.ok && analisis.ok && categorias.ok ? 'completada' : 'pendiente',
      respuesta: resultadoIA.texto,
      evidencias,
      herramientasUsadas,
      limitaciones: [
        ...(resumen.ok ? [] : ['No se pudo leer el resumen del catálogo.']),
        ...(analisis.ok ? [] : ['No se pudo realizar el análisis de precios.']),
        ...(categorias.ok ? [] : ['No se pudo leer el listado de categorías.']),
        'El lanzamiento de campañas y la publicación de contenido requieren autorización explícita del propietario.',
      ],
      avisos: [],
      proveedor: resultadoIA.proveedor,
      modelo: resultadoIA.modelo,
      duracionMs: resultadoIA.duracionMs,
      solicitudesAutorizacion: [],
    };
  }
}
