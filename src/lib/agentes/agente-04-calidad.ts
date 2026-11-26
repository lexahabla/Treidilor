/**
 * TREIDILOR — AGENTE 04: CALIDAD DE PRODUCTOS Y DATOS.
 *
 * Misión: detectar fichas incompletas, incoherencias y problemas de calidad
 * en el catálogo, proponiendo correcciones sin modificar nada sin autorización.
 *
 * Especialidad: integridad de datos, completitud de fichas, detección de
 * anomalías, calidad de descripciones y especificaciones.
 *
 * Herramientas reales: buscar_productos, detalle_producto, resumen_catalogo,
 * estado_stock (solo lectura).
 */

import { AgenteBase, type ContextoAgente, type ResultadoAgente } from './agente-base';
import { herramientaResumenCatalogo, herramientaBuscarProductos, herramientaDetalleProducto, herramientaEstadoStock } from './herramientas-catalogo';

const SYSTEM_PROMPT_04 = [
  'Eres el Agente 04 de Treidilor: Calidad e integridad del catálogo.',
  'Tu misión es detectar fichas incompletas, incoherencias y problemas de calidad',
  'en los datos de productos, proponiendo correcciones sin modificar nada.',
  '',
  'Reglas:',
  '- Solo lees el catálogo (herramientas de solo lectura).',
  '- Nunca modifiques productos sin autorización explícita.',
  '- Identifica: falta de imagen, descripción corta, sin categoría, sin precio, sin comercio.',
  '- Detecta incoherencias: precio sin original, descuentos absurdos, valoraciones por defecto.',
  '- Clasifica problemas por esfuerzo (fácil/medio/difícil) para priorizar correcciones.',
  '- Responde siempre en español, de forma profesional y concisa.',
].join('\n');

export const CFG_04 = {
  id: '04',
  nombre: 'Calidad e integridad del catálogo',
  mision: 'Detectar fichas incompletas e incoherentes, proponiendo correcciones.',
  especialidad: 'Integridad de datos, completitud de fichas, detección de anomalías.',
  systemPrompt: SYSTEM_PROMPT_04,
  herramientas: [
    herramientaResumenCatalogo,
    herramientaBuscarProductos,
    herramientaDetalleProducto,
    herramientaEstadoStock,
  ],
  permisos: ['catalog:read'],
  riesgo: 'bajo' as const,
  permiteEfectos: false,
};

export class Agente04Calidad extends AgenteBase {
  constructor(conversacion?: string) {
    super(CFG_04, conversacion);
  }

  async ejecutar(ctx: ContextoAgente): Promise<ResultadoAgente> {
    const entrada = ctx.entrada;
    const evidencias: ResultadoAgente['evidencias'] = [];
    const herramientasUsadas: ResultadoAgente['herramientasUsadas'] = [];

    const categoria = String(entrada.categoria ?? '').trim();

    const resumen = await herramientaResumenCatalogo.ejecutar({});
    herramientasUsadas.push({ nombre: resumen.nombre, argumentos: resumen.argumentos, ok: resumen.ok, datos: resumen.datos, motivo: resumen.motivo });
    this.registrarEvidencia(evidencias, 'resumen-calidad', 'catalogo', 'resumen_general', resumen.datos);

    const stock = await herramientaEstadoStock.ejecutar({ soloAgotados: true });
    herramientasUsadas.push({ nombre: stock.nombre, argumentos: stock.argumentos, ok: stock.ok, datos: stock.datos, motivo: stock.motivo });
    this.registrarEvidencia(evidencias, 'stock-agotado', 'stock', 'productos_sin_disponibilidad', stock.datos);

    let busqueda: any = null;
    if (categoria) {
      const r = await herramientaBuscarProductos.ejecutar({ q: '', categoria, limite: 20 });
      busqueda = r.ok ? r.datos : null;
      herramientasUsadas.push({ nombre: r.nombre, argumentos: r.argumentos, ok: r.ok, datos: r.datos, motivo: r.motivo });
      this.registrarEvidencia(evidencias, 'productos-categoria', 'busqueda', `categoria:${categoria}`, r.datos);
    }

    const contextoDatos = JSON.stringify({
      resumen: resumen.ok ? resumen.datos : null,
      stockAgotado: stock.ok ? stock.datos : null,
      productosCategoria: busqueda?.ok ? busqueda.datos : null,
      categoriaSolicitada: categoria || '(todas)',
    }, null, 2);

    const resultadoIA = await this.inferirConMemoria(
      `Tarea de calidad: "${String(entrada.objetivo ?? entrada.tarea ?? 'Analizar calidad del catálogo y detectar problemas')}."\n\nCategoría: ${categoria || '(todas)'}\n\nDatos reales (solo lectura):\n${contextoDatos}\n\nSintetiza en español: (1) productos con datos faltantes (imagen, descripción, categoría, precio), (2) productos agotados o sin stock indicado, (3) incoherencias detectadas, (4) clasificación por esfuerzo de corrección, (5) productos prioritarios a corregir. No modifiques nada sin autorización. No inventes datos. Si algo no consta, dilo explícitamente.`,
      ctx,
      { usarHerramientas: false }
    );

    return {
      agente: this.cfg.id,
      trabajoId: ctx.trabajoId ?? `t-04-${Date.now()}`,
      estado: resumen.ok && stock.ok ? 'completada' : 'pendiente',
      respuesta: resultadoIA.texto,
      evidencias,
      herramientasUsadas,
      limitaciones: [
        ...(resumen.ok ? [] : ['No se pudo leer el resumen del catálogo.']),
        ...(stock.ok ? [] : ['No se pudo consultar el estado de stock.']),
      ],
      avisos: [],
      proveedor: resultadoIA.proveedor,
      modelo: resultadoIA.modelo,
      duracionMs: resultadoIA.duracionMs,
      solicitudesAutorizacion: [],
    };
  }
}
