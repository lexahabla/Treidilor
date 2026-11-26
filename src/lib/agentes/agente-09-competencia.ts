/**
 * TREIDILOR — AGENTE 09: COMPETENCIA Y EXPERTOS.
 *
 * Misión: investigar la competencia, precios de mercado, expertos del sector
 * y oportunidades de diferenciación para el portal de afiliación.
 *
 * Especialidad: análisis competitivo, precios de mercado, expertos,
 * diferenciación.
 *
 * Herramientas reales: analisis_precios, buscar_productos, resumen_catalogo,
 * listar_categorias (solo lectura).
 */

import { AgenteBase, type ContextoAgente, type ResultadoAgente } from './agente-base';
import { herramientaAnalisisPrecios, herramientaBuscarProductos, herramientaResumenCatalogo, herramientaListarCategorias } from './herramientas-catalogo';

const SYSTEM_PROMPT_09 = [
  'Eres el Agente 09 de Treidilor: Investigación de competencia y expertos.',
  'Tu misión es investigar la competencia, precios de mercado, expertos del',
  'sector y oportunidades de diferenciación.',
  '',
  'Reglas:',
  '- Solo trabajas con datos reales del catálogo (solo lectura).',
  '- No accedas a sitios web de la competencia ni realices scraping.',
  '- No inventes precios de la competencia ni datos de mercado externos.',
  '- Basate únicamente en los precios y productos del catálogo de Treidilor.',
  '- Identifica oportunidades de diferenciación, no emitas juicios de valor.',
  '- Responde siempre en español, de forma profesional y concisa.',
].join('\n');

export const CFG_09 = {
  id: '09',
  nombre: 'Investigación de competencia y expertos',
  mision: 'Analizar competencia, precios de mercado y oportunidades de diferenciación.',
  especialidad: 'Análisis competitivo, precios de mercado, expertos, diferenciación.',
  systemPrompt: SYSTEM_PROMPT_09,
  herramientas: [
    herramientaAnalisisPrecios,
    herramientaBuscarProductos,
    herramientaResumenCatalogo,
    herramientaListarCategorias,
  ],
  permisos: ['catalog:read', 'competencia:read'],
  riesgo: 'bajo' as const,
  permiteEfectos: false,
};

export class Agente09Competencia extends AgenteBase {
  constructor(conversacion?: string) {
    super(CFG_09, conversacion);
  }

  async ejecutar(ctx: ContextoAgente): Promise<ResultadoAgente> {
    const entrada = ctx.entrada;
    const evidencias: ResultadoAgente['evidencias'] = [];
    const herramientasUsadas: ResultadoAgente['herramientasUsadas'] = [];

    const categoria = String(entrada.categoria ?? '').trim();

    const analisis = await herramientaAnalisisPrecios.ejecutar({ categoria: categoria || undefined });
    herramientasUsadas.push({ nombre: analisis.nombre, argumentos: analisis.argumentos, ok: analisis.ok, datos: analisis.datos, motivo: analisis.motivo });

    const resumen = await herramientaResumenCatalogo.ejecutar({});
    herramientasUsadas.push({ nombre: resumen.nombre, argumentos: resumen.argumentos, ok: resumen.ok, datos: resumen.datos, motivo: resumen.motivo });

    const categorias = await herramientaListarCategorias.ejecutar({});
    herramientasUsadas.push({ nombre: categorias.nombre, argumentos: categorias.argumentos, ok: categorias.ok, datos: categorias.datos, motivo: categorias.motivo });

    const q = String(entrada.q ?? '').trim();
    let busqueda: any = null;
    if (q) {
      const r = await herramientaBuscarProductos.ejecutar({ q, limite: 10 });
      busqueda = r.ok ? r.datos : null;
      herramientasUsadas.push({ nombre: r.nombre, argumentos: r.argumentos, ok: r.ok, datos: r.datos, motivo: r.motivo });
      this.registrarEvidencia(evidencias, 'busqueda-competencia', 'busqueda', `q:${q}`, r.datos);
    }

    const contextoDatos = JSON.stringify({
      analisisPrecios: analisis.ok ? analisis.datos : null,
      resumen: resumen.ok ? resumen.datos : null,
      categorias: categorias.ok ? categorias.datos : null,
      busqueda: busqueda?.ok ? busqueda.datos : null,
      categoriaSolicitada: categoria || '(todas)',
      productoBuscado: q || '(ninguno)',
    }, null, 2);

    const resultadoIA = await this.inferirConMemoria(
      `Tarea de competencia: "${String(entrada.objetivo ?? entrada.tarea ?? 'Analizar competencia y oportunidades de diferenciación')}."\n\nCategoría: ${categoria || '(todas)'}\nBúsqueda: ${q || '(ninguna)'}\n\nDatos reales del catálogo de Treidilor (solo lectura):\n${contextoDatos}\n\nSintetiza en español: (1) posicionamiento de precios del catálogo (promedio, mínimo, máximo), (2) productos con mejor precio relativo en su categoría, (3) categorías con mayor densidad de productos (mayor competencia interna), (4) oportunidades de diferenciación basada en datos reales, (5) limitaciones: solo se dispone de datos internos, no de precios de competencia externa. No accedas a sitios externos. No inventes precios de mercado. Si algo no consta, dilo explícitamente.`,
      ctx,
      { usarHerramientas: false }
    );

    return {
      agente: this.cfg.id,
      trabajoId: ctx.trabajoId ?? `t-09-${Date.now()}`,
      estado: analisis.ok && resumen.ok ? 'completada' : 'pendiente',
      respuesta: resultadoIA.texto,
      evidencias,
      herramientasUsadas,
      limitaciones: [
        ...(analisis.ok ? [] : ['No se pudo realizar el análisis de precios.']),
        ...(resumen.ok ? [] : ['No se pudo leer el resumen del catálogo.']),
        ...(categorias.ok ? [] : ['No se pudo leer el listado de categorías.']),
        'Este agente solo dispone de datos internos del catálogo; no accede a precios ni datos de competencia externa.',
      ],
      avisos: [],
      proveedor: resultadoIA.proveedor,
      modelo: resultadoIA.modelo,
      duracionMs: resultadoIA.duracionMs,
      solicitudesAutorizacion: [],
    };
  }
}
