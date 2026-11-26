/**
 * TREIDILOR — AGENTE 08: CONTENIDOS Y RECURSOS VISUALES.
 *
 * Misión: generar descripciones de productos, pros/contras, veredictos y
 * preparar recursos visuales para las fichas y la web, usando IA real.
 *
 * Especialidad: redacción de fichas, pros/contras, veredictos, recursos
 * visuales, enriquecimiento de contenido.
 *
 * Herramientas reales: detalle_producto, buscar_productos, resumen_catalogo
 * (solo lectura). El enriquecimiento con IA usa iaMotor.
 */

import { AgenteBase, type ContextoAgente, type ResultadoAgente } from './agente-base';
import { herramientaDetalleProducto, herramientaBuscarProductos, herramientaResumenCatalogo } from './herramientas-catalogo';

const SYSTEM_PROMPT_08 = [
  'Eres el Agente 08 de Treidilor: Contenidos y recursos visuales.',
  'Tu misión es generar descripciones de productos, pros/contras, veredictos',
  'y preparar recursos visuales para las fichas y la web.',
  '',
  'Reglas:',
  '- Solo trabajas con datos reales del catálogo (solo lectura para consultar).',
  '- Nunca inventes especificaciones, precios ni valoraciones.',
  '- Los pros deben ser más numerosos que los contras (regla de venta).',
  '- Los contras deben ser matices menores, constructivos y poco disuasorios.',
  '- No generes imágenes ni recursos de pago sin autorización.',
  '- Responde siempre en español, de forma profesional y concisa.',
].join('\n');

export const CFG_08 = {
  id: '08',
  nombre: 'Creación de contenido y recursos visuales',
  mision: 'Generar descripciones, pros/contras, veredictos y recursos visuales.',
  especialidad: 'Redacción de fichas, pros/contras, veredictos, recursos visuales.',
  systemPrompt: SYSTEM_PROMPT_08,
  herramientas: [
    herramientaDetalleProducto,
    herramientaBuscarProductos,
    herramientaResumenCatalogo,
  ],
  permisos: ['catalog:read', 'contenido:proponer'],
  riesgo: 'medio' as const,
  permiteEfectos: false,
};

export class Agente08Contenido extends AgenteBase {
  constructor(conversacion?: string) {
    super(CFG_08, conversacion);
  }

  async ejecutar(ctx: ContextoAgente): Promise<ResultadoAgente> {
    const entrada = ctx.entrada;
    const evidencias: ResultadoAgente['evidencias'] = [];
    const herramientasUsadas: ResultadoAgente['herramientasUsadas'] = [];

    const idProducto = String(entrada.id ?? '').trim();
    const q = String(entrada.q ?? '').trim();

    let detalle: any = null;
    if (idProducto) {
      const r = await herramientaDetalleProducto.ejecutar({ id: idProducto });
      detalle = r.ok ? r.datos : null;
      herramientasUsadas.push({ nombre: r.nombre, argumentos: r.argumentos, ok: r.ok, datos: r.datos, motivo: r.motivo });
      this.registrarEvidencia(evidencias, 'detalle-producto', 'catalogo', `id:${idProducto}`, r.datos);
    }

    let busqueda: any = null;
    if (q) {
      const r = await herramientaBuscarProductos.ejecutar({ q, limite: 5 });
      herramientasUsadas.push({ nombre: r.nombre, argumentos: r.argumentos, ok: r.ok, datos: r.datos, motivo: r.motivo });
      this.registrarEvidencia(evidencias, 'busqueda-contenido', 'busqueda', `q:${q}`, r.datos);
    }

    const producto = detalle?.ok ? detalle.datos : (busqueda?.ok && busqueda.datos?.length ? busqueda.datos[0] : null);

    const contextoDatos = JSON.stringify({
      producto,
      busqueda: busqueda?.ok ? busqueda.datos : null,
      tituloProducto: entrada.titulo ?? '',
      categoriaProducto: entrada.categoria ?? '',
    }, null, 2);

    const resultadoIA = await this.inferirConMemoria(
      `Tarea de contenido: "${String(entrada.objetivo ?? entrada.tarea ?? 'Generar contenido para una ficha de producto')}."\n\nDatos reales del catálogo (solo lectura):\n${contextoDatos}\n\nSintetiza en español: (1) título sintetizado (categoría + marca/modelo + característica clave, 35-70 chars), (2) descripción técnica concisa (2-3 frases), (3) 3-5 pros concretos y verificables, (4) 1-3 contras menores y constructivos (menos que pros), (5) veredicto en 1-2 frases, (6) specs sugeridas (4-8 pares clave/valor), (7) categoría y marca si se pueden deducir. No inventes especificaciones ni precios. Si un dato no consta, di "no consta". No generes recursos visuales de pago sin autorización.`,
      ctx,
      { usarHerramientas: false }
    );

    return {
      agente: this.cfg.id,
      trabajoId: ctx.trabajoId ?? `t-08-${Date.now()}`,
      estado: detalle?.ok || busqueda?.ok ? 'completada' : 'pendiente',
      respuesta: resultadoIA.texto,
      evidencias,
      herramientasUsadas,
      limitaciones: [
        ...(!detalle?.ok && !busqueda?.ok ? ['No se encontró el producto en el catálogo.'] : []),
        'El contenido generado es una propuesta; la publicación en la ficha requiere autorización del propietario.',
      ],
      avisos: [],
      proveedor: resultadoIA.proveedor,
      modelo: resultadoIA.modelo,
      duracionMs: resultadoIA.duracionMs,
      solicitudesAutorizacion: [],
    };
  }
}
