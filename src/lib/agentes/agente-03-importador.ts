/**
 * TREIDILOR — AGENTE 03: IMPORTACIÓN Y CATÁLOGO.
 *
 * Misión: gestionar la importación de productos desde redes de afiliación
 * (Amazon, Temu, AliExpress, eBay), verificar datos de fichas, detectar
 * duplicados y preparar el alta en el catálogo.
 *
 * Especialidad: extracción de ofertas, validación de identidades (ASIN, GTIN,
 * marca+MPN), detección de duplicados, preparación de fichas.
 *
 * Herramientas reales: buscar_productos, detalle_producto, resumen_catalogo
 * (solo lectura). La importación con efectos requiere autorización.
 */

import { AgenteBase, type ContextoAgente, type ResultadoAgente } from './agente-base';
import { herramientaBuscarProductos, herramientaDetalleProducto, herramientaResumenCatalogo } from './herramientas-catalogo';

const SYSTEM_PROMPT_03 = [
  'Eres el Agente 03 de Treidilor: Importación y catálogo.',
  'Tu misión es gestionar la importación de productos desde redes de afiliación',
  'y preparar su alta en el catálogo, verificando identidades y detectando duplicados.',
  '',
  'Reglas:',
  '- Solo lees el catálogo existente (herramientas de solo lectura).',
  '- No creas ni modificas productos sin autorización explícita del propietario.',
  '- Un identificador fuerte (anuncio/ASIN, GTIN, marca+MPN) identifica el anuncio, no la variante.',
  '- Detecta duplicados: mismo anuncio + mismo vendedor = misma oferta.',
  '- Si hay contradicciones (marca/GTIN/MPN contradictorios, título incompatible), marca como REVISIÓN.',
  '- Nunca inventes precios, existencias ni especificaciones.',
  '- Responde siempre en español, de forma profesional y concisa.',
].join('\n');

export const CFG_03 = {
  id: '03',
  nombre: 'Importador de productos y catálogo',
  mision: 'Gestionar importación de productos, verificar fichas y detectar duplicados.',
  especialidad: 'Extracción de ofertas, validación de identidades, detección de duplicados.',
  systemPrompt: SYSTEM_PROMPT_03,
  herramientas: [
    herramientaBuscarProductos,
    herramientaDetalleProducto,
    herramientaResumenCatalogo,
  ],
  permisos: ['catalog:read', 'import:proponer'],
  riesgo: 'medio' as const,
  permiteEfectos: false,
};

export class Agente03Importador extends AgenteBase {
  constructor(conversacion?: string) {
    super(CFG_03, conversacion);
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
      const r = await herramientaBuscarProductos.ejecutar({ q, limite: 10 });
      busqueda = r.ok ? r.datos : null;
      herramientasUsadas.push({ nombre: r.nombre, argumentos: r.argumentos, ok: r.ok, datos: r.datos, motivo: r.motivo });
      this.registrarEvidencia(evidencias, 'busqueda-duplicados', 'busqueda', `q:${q}`, r.datos);
    }

    const resumen = await herramientaResumenCatalogo.ejecutar({});
    herramientasUsadas.push({ nombre: resumen.nombre, argumentos: resumen.argumentos, ok: resumen.ok, datos: resumen.datos, motivo: resumen.motivo });
    this.registrarEvidencia(evidencias, 'resumen-catalogo', 'catalogo', 'resumen_general', resumen.datos);

    const contextoDatos = JSON.stringify({
      detalleProducto: detalle,
      busqueda: busqueda?.ok ? busqueda.datos : null,
      resumen: resumen.ok ? resumen.datos : null,
      entrada: { idProducto, q },
    }, null, 2);

    const resultadoIA = await this.inferirConMemoria(
      `Tarea de importación: "${String(entrada.objetivo ?? entrada.tarea ?? 'Analizar importación y detectar duplicados')}."\n\nDatos reales del catálogo (solo lectura):\n${contextoDatos}\n\nSintetiza en español: (1) si el producto ya existe en el catálogo (posible duplicado), (2) qué datos faltan o son incoherentes en la ficha, (3) si hay contradicciones de identidad (marca, GTIN, MPN, vendedor), (4) si la oferta requiere REVISIÓN antes de importar, (5) pasos recomendados para la alta. No crees ni modifiques productos sin autorización. No inventes datos. Si algo no consta, dilo explícitamente.`,
      ctx,
      { usarHerramientas: false }
    );

    return {
      agente: this.cfg.id,
      trabajoId: ctx.trabajoId ?? `t-03-${Date.now()}`,
      estado: resumen.ok ? 'completada' : 'pendiente',
      respuesta: resultadoIA.texto,
      evidencias,
      herramientasUsadas,
      limitaciones: [
        ...(detalle === null && idProducto ? [`Producto no encontrado: ${idProducto}`] : []),
        ...(resumen.ok ? [] : ['No se pudo leer el catálogo.']),
      ],
      avisos: ['La importación con efectos (alta/actualización de producto) requiere autorización explícita del propietario.'],
      proveedor: resultadoIA.proveedor,
      modelo: resultadoIA.modelo,
      duracionMs: resultadoIA.duracionMs,
      solicitudesAutorizacion: [],
    };
  }
}
