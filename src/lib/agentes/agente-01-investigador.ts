/**
 * TREIDILOR — AGENTE 01: INVESTIGACIÓN DE TENDENCIAS Y PRODUCTOS.
 *
 * Misión: analizar el catálogo y el mercado para identificar productos con
 * potencial, tendencias de demanda y oportunidades de selección para el
 * portal de afiliación.
 *
 * Especialidad: detección de candidatos, análisis de categorías, distribución
 * de precios y productos con descuento.
 *
 * Herramientas reales: buscar_productos, detalle_producto, listar_categorias,
 * analisis_precios, resumen_catalogo (todas solo lectura).
 */

import { AgenteBase, type ContextoAgente, type ResultadoAgente } from './agente-base';
import {
  herramientaBuscarProductos,
  herramientaAnalisisPrecios,
  herramientaListarCategorias,
  herramientaResumenCatalogo,
} from './herramientas-catalogo';

const SYSTEM_PROMPT_01 = [
  'Eres el Agente 01 de Treidilor: Investigador de tendencias y productos.',
  'Tu misión es analizar el catálogo existente y el comportamiento del mercado',
  'para identificar productos con potencial de recomendación y afiliación.',
  '',
  'Reglas:',
  '- Solo trabajas con datos reales del catálogo (herramientas de solo lectura).',
  '- Nunca inventes precios, descuentos, valoraciones ni ventas.',
  '- Si un dato no consta, di explícitamente "no consta".',
  '- Diferencia entre descuentos DECLARADOS por la fuente y descuentos VERIFICADOS.',
  '- Identifica oportunidades, no emitas recomendaciones de compra definitivas.',
  '- Responde siempre en español, de forma profesional y concisa.',
  '',
  'Herramientas disponibles: buscar_productos, detalle_producto, listar_categorias,',
  'analisis_precios, resumen_catalogo. Úsalas para fundamentar cada conclusión.',
].join('\n');

export const CFG_01 = {
  id: '01',
  nombre: 'Investigador de tendencias y productos',
  mision: 'Identificar productos con potencial, tendencias y oportunidades del catálogo.',
  especialidad: 'Detección de candidatos, análisis de categorías, distribución de precios.',
  systemPrompt: SYSTEM_PROMPT_01,
  herramientas: [
    herramientaBuscarProductos,
    herramientaAnalisisPrecios,
    herramientaListarCategorias,
    herramientaResumenCatalogo,
  ],
  permisos: ['catalog:read'],
  riesgo: 'bajo',
  permiteEfectos: false,
};

export class Agente01Investigador extends AgenteBase {
  constructor(conversacion?: string) {
    super(CFG_01 as any, conversacion);
  }

  async ejecutar(ctx: ContextoAgente): Promise<ResultadoAgente> {
    const entrada = ctx.entrada;
    const evidencias: ResultadoAgente['evidencias'] = [];
    const limitaciones: string[] = [];
    const herramientasUsadas: ResultadoAgente['herramientasUsadas'] = [];

    // Paso 1: resumen general del catálogo (contexto).
    const resumen = await herramientaResumenCatalogo.ejecutar({});
    herramientasUsadas.push({
      nombre: resumen.nombre,
      argumentos: resumen.argumentos,
      ok: resumen.ok,
      datos: resumen.datos,
      motivo: resumen.motivo,
    });
    this.registrarEvidencia(evidencias, 'resumen-catalogo', 'catalogo', 'resumen_general', resumen.datos);

    // Paso 2: análisis de precios (si se pidió categoría o general).
    const categoria = String(entrada.categoria ?? '').trim();
    const analisis = await herramientaAnalisisPrecios.ejecutar({ categoria: categoria || undefined });
    herramientasUsadas.push({
      nombre: analisis.nombre,
      argumentos: analisis.argumentos,
      ok: analisis.ok,
      datos: analisis.datos,
      motivo: analisis.motivo,
    });
    this.registrarEvidencia(evidencias, 'analisis-precios', 'precios', `categoria:${categoria || 'general'}`, analisis.datos);

    // Paso 3: buscar productos candidatos si hay texto de búsqueda.
    const q = String(entrada.q ?? '').trim();
    let busqueda: any = null;
    if (q) {
      busqueda = await herramientaBuscarProductos.ejecutar({ q, categoria: categoria || undefined, limite: 10 });
      herramientasUsadas.push({
        nombre: busqueda.nombre,
        argumentos: busqueda.argumentos,
        ok: busqueda.ok,
        datos: busqueda.datos,
        motivo: busqueda.motivo,
      });
      this.registrarEvidencia(evidencias, 'busqueda-productos', 'busqueda', `q:${q}`, busqueda.datos);
    }

    // Paso 4: listar categorías para contexto de mercado.
    const categorias = await herramientaListarCategorias.ejecutar({});
    herramientasUsadas.push({
      nombre: categorias.nombre,
      argumentos: categorias.argumentos,
      ok: categorias.ok,
      datos: categorias.datos,
      motivo: categorias.motivo,
    });
    this.registrarEvidencia(evidencias, 'categorias', 'catalogo', 'listado_categorias', categorias.datos);

    // Paso 5: inferencia LLM para sintetizar conclusiones.
    const contextoDatos = JSON.stringify({
      resumen: resumen.ok ? resumen.datos : null,
      analisisPrecios: analisis.ok ? analisis.datos : null,
      busqueda: busqueda?.ok ? busqueda.datos : null,
      categorias: categorias.ok ? categorias.datos : null,
    }, null, 2);

    const resultadoIA = await this.inferirConMemoria(
      `Tarea de investigación: "${String(entrada.objetivo ?? entrada.tarea ?? 'Analizar el catálogo y detectar oportunidades')}."\n\nCategoría solicitada: ${categoria || '(ninguna)'}\nBúsqueda: ${q || '(ninguna)'}\n\nDatos reales del catálogo (solo lectura):\n${contextoDatos}\n\nSintetiza en español: (1) qué oportunidades detectas, (2) qué categorías tienen más productos, (3) el rango de precios y descuentos declarados, (4) productos destacados si aplica, (5) limitaciones y datos que no constan. No inventes precios ni descuentos. Si algo no consta, dilo explícitamente.`,
      ctx,
      { usarHerramientas: false }
    );

    return {
      agente: this.cfg.id,
      trabajoId: ctx.trabajoId ?? `t-01-${Date.now()}`,
      estado: resumen.ok && analisis.ok ? 'completada' : 'pendiente',
      respuesta: resultadoIA.texto,
      evidencias,
      herramientasUsadas,
      limitaciones: [
        ...limitaciones,
        ...(resumen.ok ? [] : ['No se pudo leer el catálogo de productos.']),
        ...(analisis.ok ? [] : ['No se pudo realizar el análisis de precios.']),
      ],
      avisos: [],
      proveedor: resultadoIA.proveedor,
      modelo: resultadoIA.modelo,
      duracionMs: resultadoIA.duracionMs,
      solicitudesAutorizacion: [],
    };
  }
}
