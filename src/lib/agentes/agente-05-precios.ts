/**
 * TREIDILOR — AGENTE 05: OFERTAS Y PRECIOS.
 *
 * Misión: analizar ofertas, precios y descuentos del catálogo, identificar
 * las mejores oportunidades y comparar precios entre comercios.
 *
 * Especialidad: análisis de ofertas, comparativa de precios, descuentos
 * declarados vs verificados, historial de precios.
 *
 * Herramientas reales: analisis_precios, buscar_productos, detalle_producto,
 * resumen_catalogo (solo lectura).
 */

import { AgenteBase, type ContextoAgente, type ResultadoAgente } from './agente-base';
import { herramientaAnalisisPrecios, herramientaBuscarProductos, herramientaDetalleProducto, herramientaResumenCatalogo } from './herramientas-catalogo';

const SYSTEM_PROMPT_05 = [
  'Eres el Agente 05 de Treidilor: Analista de ofertas y precios.',
  'Tu misión es analizar ofertas, precios y descuentos del catálogo,',
  'identificando las mejores oportunidades y comparando entre comercios.',
  '',
  'Reglas:',
  '- Solo trabajas con datos reales del catálogo (solo lectura).',
  '- Nunca inventes precios, descuentos ni valoraciones.',
  '- Distingue claramente descuentos DECLARADOS por la fuente de descuentos VERIFICADOS.',
  '- Un descuento solo es verificado si consta una observación con verifiedAt vigente.',
  '- No presentes precios de lista del proveedor como descuento verificado.',
  '- Responde siempre en español, de forma profesional y concisa.',
].join('\n');

export const CFG_05 = {
  id: '05',
  nombre: 'Analista de ofertas y precios',
  mision: 'Analizar ofertas, precios y descuentos; identificar mejores oportunidades.',
  especialidad: 'Análisis de ofertas, comparativa de precios, descuentos declarados vs verificados.',
  systemPrompt: SYSTEM_PROMPT_05,
  herramientas: [
    herramientaAnalisisPrecios,
    herramientaBuscarProductos,
    herramientaDetalleProducto,
    herramientaResumenCatalogo,
  ],
  permisos: ['catalog:read', 'precios:read'],
  riesgo: 'bajo' as const,
  permiteEfectos: false,
};

export class Agente05Precios extends AgenteBase {
  constructor(conversacion?: string) {
    super(CFG_05, conversacion);
  }

  async ejecutar(ctx: ContextoAgente): Promise<ResultadoAgente> {
    const entrada = ctx.entrada;
    const evidencias: ResultadoAgente['evidencias'] = [];
    const herramientasUsadas: ResultadoAgente['herramientasUsadas'] = [];

    const categoria = String(entrada.categoria ?? '').trim();
    const q = String(entrada.q ?? '').trim();

    const analisis = await herramientaAnalisisPrecios.ejecutar({ categoria: categoria || undefined });
    herramientasUsadas.push({ nombre: analisis.nombre, argumentos: analisis.argumentos, ok: analisis.ok, datos: analisis.datos, motivo: analisis.motivo });
    this.registrarEvidencia(evidencias, 'analisis-precios', 'precios', `categoria:${categoria || 'general'}`, analisis.datos);

    let busqueda: any = null;
    if (q) {
      const r = await herramientaBuscarProductos.ejecutar({ q, categoria: categoria || undefined, limite: 15 });
      busqueda = r.ok ? r.datos : null;
      herramientasUsadas.push({ nombre: r.nombre, argumentos: r.argumentos, ok: r.ok, datos: r.datos, motivo: r.motivo });
      this.registrarEvidencia(evidencias, 'busqueda-ofertas', 'busqueda', `q:${q}`, r.datos);
    }

    const resumen = await herramientaResumenCatalogo.ejecutar({});
    herramientasUsadas.push({ nombre: resumen.nombre, argumentos: resumen.argumentos, ok: resumen.ok, datos: resumen.datos, motivo: resumen.motivo });

    const contextoDatos = JSON.stringify({
      analisisPrecios: analisis.ok ? analisis.datos : null,
      busqueda: busqueda?.ok ? busqueda.datos : null,
      resumen: resumen.ok ? resumen.datos : null,
      entrada: { categoria, q },
    }, null, 2);

    const resultadoIA = await this.inferirConMemoria(
      `Tarea de precios: "${String(entrada.objetivo ?? entrada.tarea ?? 'Analizar ofertas y precios del catálogo')}."\n\nCategoría: ${categoria || '(todas)'}\nBúsqueda: ${q || '(ninguna)'}\n\nDatos reales (solo lectura):\n${contextoDatos}\n\nSintetiza en español: (1) rango de precios y precio medio, (2) productos con mejor descuento declarado (marcados como NO verificados salvo que conste verificación), (3) comparativa entre comercios si aplica, (4) ofertas destacadas, (5) limitaciones y datos que no constan. No inventes precios ni descuentos. Si algo no consta, dilo explícitamente.`,
      ctx,
      { usarHerramientas: false }
    );

    return {
      agente: this.cfg.id,
      trabajoId: ctx.trabajoId ?? `t-05-${Date.now()}`,
      estado: analisis.ok ? 'completada' : 'pendiente',
      respuesta: resultadoIA.texto,
      evidencias,
      herramientasUsadas,
      limitaciones: [
        ...(analisis.ok ? [] : ['No se pudo realizar el análisis de precios.']),
        'Los descuentos mostrados son declarados por la fuente; no están verificados salvo que conste una observación con verifiedAt vigente.',
      ],
      avisos: [],
      proveedor: resultadoIA.proveedor,
      modelo: resultadoIA.modelo,
      duracionMs: resultadoIA.duracionMs,
      solicitudesAutorizacion: [],
    };
  }
}
