/**
 * TREIDILOR — AGENTE 06: CATEGORÍAS, DISEÑO Y PRESENTACIÓN.
 *
 * Misión: organizar categorías del catálogo, sugerir presentaciones de
 * productos, diseñar la estructura de la portada y gestionar historias
 * visuales para la navegación.
 *
 * Especialidad: taxonomía de categorías, presentación visual, estructura de
 * portada, historias (stories).
 *
 * Herramientas reales: listar_categorias, resumen_catalogo, buscar_productos
 * (solo lectura).
 */

import { AgenteBase, type ContextoAgente, type ResultadoAgente } from './agente-base';
import { herramientaListarCategorias, herramientaResumenCatalogo, herramientaBuscarProductos } from './herramientas-catalogo';

const SYSTEM_PROMPT_06 = [
  'Eres el Agente 06 de Treidilor: Categorías, diseño y presentación.',
  'Tu misión es organizar las categorías del catálogo, sugerir presentaciones',
  'de productos y diseñar la estructura de la portada e historias visuales.',
  '',
  'Reglas:',
  '- Solo lees el catálogo y las categorías existentes (solo lectura).',
  '- No crees, modifiques ni elimines categorías sin autorización.',
  '- Sugiere agrupaciones lógicas basadas en los datos reales del catálogo.',
  '- No ocultes productos por falta de stock; el stock nunca oculta.',
  '- Responde siempre en español, de forma profesional y concisa.',
].join('\n');

export const CFG_06 = {
  id: '06',
  nombre: 'Categorías, diseño y presentación',
  mision: 'Organizar categorías y diseñar presentaciones del catálogo.',
  especialidad: 'Taxonomía de categorías, presentación visual, estructura de portada.',
  systemPrompt: SYSTEM_PROMPT_06,
  herramientas: [
    herramientaListarCategorias,
    herramientaResumenCatalogo,
    herramientaBuscarProductos,
  ],
  permisos: ['catalog:read', 'categorias:read'],
  riesgo: 'medio' as const,
  permiteEfectos: false,
};

export class Agente06Categorias extends AgenteBase {
  constructor(conversacion?: string) {
    super(CFG_06, conversacion);
  }

  async ejecutar(ctx: ContextoAgente): Promise<ResultadoAgente> {
    const entrada = ctx.entrada;
    const evidencias: ResultadoAgente['evidencias'] = [];
    const herramientasUsadas: ResultadoAgente['herramientasUsadas'] = [];

    const categorias = await herramientaListarCategorias.ejecutar({});
    herramientasUsadas.push({ nombre: categorias.nombre, argumentos: categorias.argumentos, ok: categorias.ok, datos: categorias.datos, motivo: categorias.motivo });
    this.registrarEvidencia(evidencias, 'categorias', 'catalogo', 'listado_categorias', categorias.datos);

    const resumen = await herramientaResumenCatalogo.ejecutar({});
    herramientasUsadas.push({ nombre: resumen.nombre, argumentos: resumen.argumentos, ok: resumen.ok, datos: resumen.datos, motivo: resumen.motivo });

    let productosCat: any = null;
    const cat = String(entrada.categoria ?? '').trim();
    if (cat) {
      const r = await herramientaBuscarProductos.ejecutar({ q: '', categoria: cat, limite: 20 });
      productosCat = r.ok ? r.datos : null;
      herramientasUsadas.push({ nombre: r.nombre, argumentos: r.argumentos, ok: r.ok, datos: r.datos, motivo: r.motivo });
      this.registrarEvidencia(evidencias, `productos-${cat}`, 'busqueda', `categoria:${cat}`, r.datos);
    }

    const contextoDatos = JSON.stringify({
      categorias: categorias.ok ? categorias.datos : null,
      resumen: resumen.ok ? resumen.datos : null,
      productosCategoria: productosCat?.ok ? productosCat.datos : null,
      categoriaSolicitada: cat || '(ninguna)',
    }, null, 2);

    const resultadoIA = await this.inferirConMemoria(
      `Tarea de categorías y presentación: "${String(entrada.objetivo ?? entrada.tarea ?? 'Organizar categorías y diseñar presentación del catálogo')}."\n\nCategoría solicitada: ${cat || '(ninguna)'}\n\nDatos reales (solo lectura):\n${contextoDatos}\n\nSintetiza en español: (1) estructura sugerida de categorías con número de productos, (2) categorías con pocos productos (huecos de catálogo), (3) propuesta de presentación para la portada (banners, cuadrículas, carruseles), (4) productos destacados por categoría, (5) limitaciones. No crees ni modifiques categorías sin autorización. No inventes datos. Si algo no consta, dilo explícitamente.`,
      ctx,
      { usarHerramientas: false }
    );

    return {
      agente: this.cfg.id,
      trabajoId: ctx.trabajoId ?? `t-06-${Date.now()}`,
      estado: categorias.ok && resumen.ok ? 'completada' : 'pendiente',
      respuesta: resultadoIA.texto,
      evidencias,
      herramientasUsadas,
      limitaciones: [
        ...(categorias.ok ? [] : ['No se pudo leer el listado de categorías.']),
        ...(resumen.ok ? [] : ['No se pudo leer el resumen del catálogo.']),
        'La creación, modificación o eliminación de categorías requiere autorización explícita del propietario.',
      ],
      avisos: [],
      proveedor: resultadoIA.proveedor,
      modelo: resultadoIA.modelo,
      duracionMs: resultadoIA.duracionMs,
      solicitudesAutorizacion: [],
    };
  }
}
