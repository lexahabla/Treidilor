/**
 * TREIDILOR — AGENTE 12: AUDITORÍA GENERAL.
 *
 * Misión: supervisar la salud del sistema, verificar integridad de rutas,
 * enlaces, fichas de producto y datos, e informar de anomalías.
 *
 * Especialidad: auditoría de integridad, salud del sistema, verificación de
 * enlaces y rutas, detección de anomalías.
 *
 * Herramientas reales: resumen_catalogo, estado_stock, listar_categorias,
 * buscar_productos (solo lectura). Auditoría determinista, sin efectos.
 */

import { AgenteBase, type ContextoAgente, type ResultadoAgente } from './agente-base';
import { herramientaResumenCatalogo, herramientaEstadoStock, herramientaListarCategorias, herramientaBuscarProductos } from './herramientas-catalogo';

const SYSTEM_PROMPT_12 = [
  'Eres el Agente 12 de Treidilor: Auditor General.',
  'Tu misión es supervisar la salud del sistema, verificar integridad de rutas,',
  'enlaces, fichas de producto y datos, e informar de anomalías.',
  '',
  'Reglas:',
  '- Solo realizas lecturas (solo lectura). No modificas nada.',
  '- No accedas a sistemas externos ni ejecutes comandos arbitrarios.',
  '- Reporta anomalías con datos concretos, no suposiciones.',
  '- Distingue entre datos confirmados y hipótesis.',
  '- Responde siempre en español, de forma profesional y concisa.',
].join('\n');

export const CFG_12 = {
  id: '12',
  nombre: 'Auditor General',
  mision: 'Supervisar la salud del sistema y verificar integridad de datos y rutas.',
  especialidad: 'Auditoría de integridad, salud del sistema, verificación de enlaces.',
  systemPrompt: SYSTEM_PROMPT_12,
  herramientas: [
    herramientaResumenCatalogo,
    herramientaEstadoStock,
    herramientaListarCategorias,
    herramientaBuscarProductos,
  ],
  permisos: ['catalog:read', 'auditoria:read'],
  riesgo: 'bajo' as const,
  permiteEfectos: false,
};

export class Agente12Auditor extends AgenteBase {
  constructor(conversacion?: string) {
    super(CFG_12, conversacion);
  }

  async ejecutar(ctx: ContextoAgente): Promise<ResultadoAgente> {
    const entrada = ctx.entrada;
    const evidencias: ResultadoAgente['evidencias'] = [];
    const herramientasUsadas: ResultadoAgente['herramientasUsadas'] = [];

    const resumen = await herramientaResumenCatalogo.ejecutar({});
    herramientasUsadas.push({ nombre: resumen.nombre, argumentos: resumen.argumentos, ok: resumen.ok, datos: resumen.datos, motivo: resumen.motivo });
    this.registrarEvidencia(evidencias, 'resumen-auditoria', 'catalogo', 'resumen_general', resumen.datos);

    const stock = await herramientaEstadoStock.ejecutar({ soloAgotados: true });
    herramientasUsadas.push({ nombre: stock.nombre, argumentos: stock.argumentos, ok: stock.ok, datos: stock.datos, motivo: stock.motivo });
    this.registrarEvidencia(evidencias, 'stock-auditoria', 'stock', 'productos_sin_disponibilidad', stock.datos);

    const categorias = await herramientaListarCategorias.ejecutar({});
    herramientasUsadas.push({ nombre: categorias.nombre, argumentos: categorias.argumentos, ok: categorias.ok, datos: categorias.datos, motivo: categorias.motivo });

    const contextoDatos = JSON.stringify({
      resumen: resumen.ok ? resumen.datos : null,
      stockAgotado: stock.ok ? stock.datos : null,
      categorias: categorias.ok ? categorias.datos : null,
      objetivo: entrada.objetivo ?? entrada.tarea ?? 'Auditoría general del sistema',
    }, null, 2);

    const resultadoIA = await this.inferirConMemoria(
      `Tarea de auditoría: "${String(entrada.objetivo ?? entrada.tarea ?? 'Auditoría general de salud e integridad del sistema')}."\n\nDatos reales (solo lectura):\n${contextoDatos}\n\nSintetiza en español: (1) estado general del catálogo (productos, precio medio, descuentos), (2) productos agotados o sin stock, (3) categorías vacías o con pocos productos, (4) posibles anomalías de datos (precios sin original, descuentos absurdos), (5) estado de integridad: confirmado o con observaciones, (6) recomendaciones de revisión. No modifiques nada. No accedas a sistemas externos. Si algo no consta, dilo explícitamente. Distingue entre datos confirmados e hipótesis.`,
      ctx,
      { usarHerramientas: false }
    );

    return {
      agente: this.cfg.id,
      trabajoId: ctx.trabajoId ?? `t-12-${Date.now()}`,
      estado: resumen.ok ? 'completada' : 'pendiente',
      respuesta: resultadoIA.texto,
      evidencias,
      herramientasUsadas,
      limitaciones: [
        ...(resumen.ok ? [] : ['No se pudo leer el resumen del catálogo.']),
        ...(stock.ok ? [] : ['No se pudo consultar el estado de stock.']),
        ...(categorias.ok ? [] : ['No se pudo leer el listado de categorías.']),
        'Esta auditoría es de solo lectura sobre datos internos; no verifica sistemas externos ni enlaces de afiliado activos.',
      ],
      avisos: [],
      proveedor: resultadoIA.proveedor,
      modelo: resultadoIA.modelo,
      duracionMs: resultadoIA.duracionMs,
      solicitudesAutorizacion: [],
    };
  }
}
