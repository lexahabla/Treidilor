/**
 * TREIDILOR — AGENTE 10: ANALÍTICA Y CONVERSIÓN.
 *
 * Misión: analizar métricas de conversión, embudos, comportamiento de usuario
 * y optimización del portal de afiliación.
 *
 * Especialidad: métricas de conversión, embudos, optimización, analítica.
 *
 * Herramientas reales: resumen_catalogo, analisis_precios, estado_stock
 * (solo lectura). Los datos de analítica real leen analytics.json si existe.
 */

import fs from 'node:fs';
import path from 'node:path';
import { AgenteBase, type ContextoAgente, type ResultadoAgente } from './agente-base';
import { herramientaResumenCatalogo, herramientaAnalisisPrecios, herramientaEstadoStock } from './herramientas-catalogo';

function rutaAnalytics(): string {
  const dataDir = process.env.TRADYLOR_DATA_DIR
    ? path.join(process.env.TRADYLOR_DATA_DIR)
    : path.join(process.cwd(), 'src', 'data');
  return path.join(dataDir, 'analytics.json');
}

function leerAnalytics(): any {
  try {
    const raw = fs.readFileSync(rutaAnalytics(), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const SYSTEM_PROMPT_10 = [
  'Eres el Agente 10 de Treidilor: Analítica y optimización de conversiones.',
  'Tu misión es analizar métricas de conversión, embudos y comportamiento de',
  'usuario para optimizar el portal de afiliación.',
  '',
  'Reglas:',
  '- Solo trabajas con datos reales de analítica y catálogo (solo lectura).',
  '- No inventes métricas, tasas de conversión ni volumen de ventas.',
  '- Si un dato de analítica no existe, di que no consta.',
  '- No realices cambios en el sitio ni en el catálogo sin autorización.',
  '- Responde siempre en español, de forma profesional y concisa.',
].join('\n');

export const CFG_10 = {
  id: '10',
  nombre: 'Analítica y optimización de conversiones',
  mision: 'Analizar métricas de conversión y optimizar el portal de afiliación.',
  especialidad: 'Métricas de conversión, embudos, optimización, analítica.',
  systemPrompt: SYSTEM_PROMPT_10,
  herramientas: [
    herramientaResumenCatalogo,
    herramientaAnalisisPrecios,
    herramientaEstadoStock,
  ],
  permisos: ['catalog:read', 'analytics:read'],
  riesgo: 'bajo' as const,
  permiteEfectos: false,
};

export class Agente10Analitica extends AgenteBase {
  constructor(conversacion?: string) {
    super(CFG_10, conversacion);
  }

  async ejecutar(ctx: ContextoAgente): Promise<ResultadoAgente> {
    const entrada = ctx.entrada;
    const evidencias: ResultadoAgente['evidencias'] = [];
    const herramientasUsadas: ResultadoAgente['herramientasUsadas'] = [];

    const analytics = leerAnalytics();
    if (analytics) {
      this.registrarEvidencia(evidencias, 'analytics', 'analitica', 'metricas', analytics);
    }

    const resumen = await herramientaResumenCatalogo.ejecutar({});
    herramientasUsadas.push({ nombre: resumen.nombre, argumentos: resumen.argumentos, ok: resumen.ok, datos: resumen.datos, motivo: resumen.motivo });

    const analisis = await herramientaAnalisisPrecios.ejecutar({});
    herramientasUsadas.push({ nombre: analisis.nombre, argumentos: analisis.argumentos, ok: analisis.ok, datos: analisis.datos, motivo: analisis.motivo });

    const stock = await herramientaEstadoStock.ejecutar({ soloAgotados: true });
    herramientasUsadas.push({ nombre: stock.nombre, argumentos: stock.argumentos, ok: stock.ok, datos: stock.datos, motivo: stock.motivo });

    const contextoDatos = JSON.stringify({
      analytics: analytics ?? null,
      resumenCatalogo: resumen.ok ? resumen.datos : null,
      analisisPrecios: analisis.ok ? analisis.datos : null,
      stockAgotado: stock.ok ? stock.datos : null,
      objetivo: entrada.objetivo ?? entrada.tarea ?? 'Analítica y conversión general',
    }, null, 2);

    const resultadoIA = await this.inferirConMemoria(
      `Tarea de analítica y conversión: "${String(entrada.objetivo ?? entrada.tarea ?? 'Analizar métricas de conversión y optimizar')}."\n\nDatos reales (solo lectura):\n${contextoDatos}\n\nSintetiza en español: (1) estado actual del catálogo (productos, precio medio, descuentos), (2) productos agotados o sin stock (oportunidad de conversión perdida), (3) métricas de analítica disponibles o indicación de que no constan, (4) áreas de optimización de conversión sugeridas, (5) limitaciones. No inventes métricas ni tasas de conversión. No realices cambios sin autorización. Si algo no consta, dilo explícitamente.`,
      ctx,
      { usarHerramientas: false }
    );

    return {
      agente: this.cfg.id,
      trabajoId: ctx.trabajoId ?? `t-10-${Date.now()}`,
      estado: resumen.ok ? 'completada' : 'pendiente',
      respuesta: resultadoIA.texto,
      evidencias,
      herramientasUsadas,
      limitaciones: [
        ...(resumen.ok ? [] : ['No se pudo leer el resumen del catálogo.']),
        ...(analytics ? [] : ['No hay datos de analítica disponibles (analytics.json no encontrado).']),
      ],
      avisos: [],
      proveedor: resultadoIA.proveedor,
      modelo: resultadoIA.modelo,
      duracionMs: resultadoIA.duracionMs,
      solicitudesAutorizacion: [],
    };
  }
}
