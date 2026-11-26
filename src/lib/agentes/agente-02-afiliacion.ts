/**
 * TREIDILOR — AGENTE 02: PROGRAMAS DE AFILIACIÓN.
 *
 * Misión: informar sobre los programas de afiliación disponibles (Amazon,
 * AliExpress, eBay, Awin, CJ, Admitad, Tradedoubler, Kwanko, Etsy), sus
 * comisiones, requisitos y estado de configuración en Treidilor.
 *
 * Especialidad: redes de afiliación, comisiones, conectores, credenciales.
 *
 * Herramientas reales: solo lectura del catálogo y configuración de redes.
 */

import { AgenteBase, type ContextoAgente, type ResultadoAgente } from './agente-base';
import { herramientaResumenCatalogo, herramientaBuscarProductos } from './herramientas-catalogo';

const SYSTEM_PROMPT_02 = [
  'Eres el Agente 02 de Treidilor: Investigador de programas de afiliación.',
  'Tu misión es informar sobre los programas de afiliación disponibles en',
  'Treidilor (Amazon, AliExpress, eBay, Awin, CJ, Admitad, Tradedoubler,',
  'Kwanko, Etsy), sus comisiones, requisitos y estado de configuración.',
  '',
  'Reglas:',
  '- Solo trabajas con datos reales y configuración existente (solo lectura).',
  '- Nunca inventes tasas de comisión, requisitos ni credenciales.',
  '- Si un conector no tiene credenciales configuradas, di que no está activo.',
  '- Distingue entre programas disponibles y programas configurados.',
  '- Responde siempre en español, de forma profesional y concisa.',
].join('\n');

export const CFG_02 = {
  id: '02',
  nombre: 'Investigador de programas de afiliación',
  mision: 'Informar sobre programas de afiliación, comisiones y estado de conectores.',
  especialidad: 'Redes de afiliación, comisiones, conectores, credenciales.',
  systemPrompt: SYSTEM_PROMPT_02,
  herramientas: [
    herramientaResumenCatalogo,
    herramientaBuscarProductos,
  ],
  permisos: ['catalog:read', 'networks:read'],
  riesgo: 'bajo' as const,
  permiteEfectos: false,
};

export class Agente02Afiliacion extends AgenteBase {
  constructor(conversacion?: string) {
    super(CFG_02, conversacion);
  }

  async ejecutar(ctx: ContextoAgente): Promise<ResultadoAgente> {
    const entrada = ctx.entrada;
    const evidencias: ResultadoAgente['evidencias'] = [];

    const redes = [
      { nombre: 'Amazon', conector: 'amazon', credencial: 'SCRAPER_API_KEY / APIFY_TOKEN', estado: 'configurable' },
      { nombre: 'AliExpress', conector: 'aliexpress', credencial: 'ALIEXPRESS_API_KEY', estado: 'configurable' },
      { nombre: 'eBay', conector: 'ebay', credencial: 'EBAY_APP_ID / EBAY_CERT_ID', estado: 'configurable' },
      { nombre: 'Awin', conector: 'awin', credencial: 'AWIN_API_KEY', estado: 'configurable' },
      { nombre: 'CJ (Commission Junction)', conector: 'cj', credencial: 'CJ_API_KEY', estado: 'configurable' },
      { nombre: 'Admitad', conector: 'admitad', credencial: 'ADMITAD_API_KEY', estado: 'configurable' },
      { nombre: 'Tradedoubler', conector: 'tradedoubler', credencial: 'TRADEDOUBLER_API_KEY', estado: 'configurable' },
      { nombre: 'Kwanko', conector: 'kwanko', credencial: 'KWANKO_API_KEY', estado: 'configurable' },
      { nombre: 'Etsy', conector: 'etsy', credencial: 'ETSY_API_KEY', estado: 'configurable' },
    ];

    const resumen = await herramientaResumenCatalogo.ejecutar({});
    const productosConComercio = resumen.ok ? (resumen.datos as any).comerciosUnicos : 0;

    const contextoDatos = JSON.stringify({
      redes,
      comerciosConProductosEnCatalogo: productosConComercio,
      resumenCatalogo: resumen.ok ? resumen.datos : null,
    }, null, 2);

    const resultadoIA = await this.inferirConMemoria(
      `Tarea de afiliación: "${String(entrada.objetivo ?? entrada.tarea ?? 'Informar sobre programas de afiliación disponibles')}."\n\nDatos reales (solo lectura):\n${contextoDatos}\n\nSintetiza en español: (1) lista los programas de afiliación disponibles con su estado, (2) indica cuáles tienen credenciales configuradas y cuáles no, (3) explica qué se necesita para activar cada uno, (4) menciona los comercios ya representados en el catálogo, (5) limitaciones. No inventes comisiones ni credenciales. Si algo no consta, dilo explícitamente.`,
      ctx,
      { usarHerramientas: false }
    );

    return {
      agente: this.cfg.id,
      trabajoId: ctx.trabajoId ?? `t-02-${Date.now()}`,
      estado: resumen.ok ? 'completada' : 'pendiente',
      respuesta: resultadoIA.texto,
      evidencias,
      herramientasUsadas: [{
        nombre: herramientaResumenCatalogo.nombre,
        argumentos: {},
        ok: resumen.ok,
        datos: resumen.datos,
        motivo: resumen.motivo,
      }],
      limitaciones: resumen.ok ? [] : ['No se pudo leer el catálogo para verificar comercios representados.'],
      avisos: [],
      proveedor: resultadoIA.proveedor,
      modelo: resultadoIA.modelo,
      duracionMs: resultadoIA.duracionMs,
      solicitudesAutorizacion: [],
    };
  }
}
