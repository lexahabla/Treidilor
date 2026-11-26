/**
 * TREIDILOR — HERRAMIENTAS DE SOLO LECTURA PARA AGENTES.
 *
 * Todas las herramientas leen datos existentes (catálogo, categorías, precios,
 * stock, historial) y nunca modifican nada. Son las herramientas reales que los
 * agentes 01-13 pueden ejecutar para completar sus tareas.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ResultadoHerramienta } from './agente-base';

/** Ruta del catálogo de productos (volumen en producción). */
function rutaCatalogo(): string {
  const dataDir = process.env.TRADYLOR_DATA_DIR
    ? path.join(process.env.TRADYLOR_DATA_DIR)
    : path.join(process.cwd(), 'src', 'data');
  return path.join(dataDir, 'products.json');
}

/** Ruta de categorías. */
function rutaCategorias(): string {
  const dataDir = process.env.TRADYLOR_DATA_DIR
    ? path.join(process.env.TRADYLOR_DATA_DIR)
    : path.join(process.cwd(), 'src', 'data');
  return path.join(dataDir, 'categories.json');
}

/** Lee el catálogo de productos. Devuelve [] si no existe o está dañado. */
export function leerProductos(): any[] {
  try {
    const raw = fs.readFileSync(rutaCatalogo(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).productos)) {
      return (parsed as any).productos;
    }
    return [];
  } catch {
    return [];
  }
}

/** Lee las categorías. */
export function leerCategorias(): any[] {
  try {
    const raw = fs.readFileSync(rutaCategorias(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).categorias)) {
      return (parsed as any).categorias;
    }
    return [parsed].filter(Boolean);
  } catch {
    return [];
  }
}

/** Envuelve un resultado de herramienta en la forma ResultadoHerramienta. */
function resultado(nombre: string, argumentos: Record<string, unknown>, ok: boolean, datos: unknown, motivo?: string): ResultadoHerramienta {
  return { nombre, argumentos, ok, datos, motivo };
}

/**
 * Herramienta: buscar productos por texto (título, marca, categoría).
 * Solo lectura.
 */
export const herramientaBuscarProductos = {
  nombre: 'buscar_productos',
  descripcion: 'Busca productos en el catálogo por texto (título, marca o categoría). Devuelve coincidencias con precio, comercio y categoría.',
  parametros: {
    type: 'object',
    properties: {
      q: { type: 'string', description: 'Texto de búsqueda (título, marca o categoría).' },
      categoria: { type: 'string', description: 'Categoría para filtrar.' },
      limite: { type: 'number', description: 'Número máximo de resultados (1-50, default 10).' },
    },
    required: [],
  },
  soloLectura: true,
  ejecutar: async (args: Record<string, unknown>): Promise<ResultadoHerramienta> => {
    const q = String(args.q ?? '').toLowerCase().trim();
    const categoria = String(args.categoria ?? '').toLowerCase().trim();
    const limite = Math.min(Math.max(Number(args.limite ?? 10), 1), 50);

    const productos = leerProductos();
    let resultados = productos.filter((p) => {
      const titulo = String(p.title ?? '').toLowerCase();
      const marca = String(p.brand ?? '').toLowerCase();
      const cat = String(p.category ?? '').toLowerCase();
      const coincideTexto = !q || titulo.includes(q) || marca.includes(q) || cat.includes(q);
      const coincideCat = !categoria || cat === categoria;
      return coincideTexto && coincideCat;
    });

    resultados = resultados.slice(0, limite);

    return resultado(
      herramientaBuscarProductos.nombre,
      args,
      true,
      { resultados: resultados.map((p) => ({
        id: p.id,
        title: p.title,
        brand: p.brand,
        category: p.category,
        price: p.price,
        originalPrice: p.originalPrice,
        merchant: p.merchant,
        rating: p.rating,
        reviewsCount: p.reviewsCount,
        inStock: p.inStock,
      })), total: resultados.length, consulta: { q, categoria, limite } },
    );
  },
};

/**
 * Herramienta: obtener detalles de un producto por ID.
 * Solo lectura.
 */
export const herramientaDetalleProducto = {
  nombre: 'detalle_producto',
  descripcion: 'Obtiene la ficha completa de un producto por su identificador (título, specs, precio, stock, valoración, observaciones).',
  parametros: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Identificador del producto.' },
    },
    required: ['id'],
  },
  soloLectura: true,
  ejecutar: async (args: Record<string, unknown>): Promise<ResultadoHerramienta> => {
    const id = String(args.id ?? '').trim();
    if (!id) return resultado(herramientaDetalleProducto.nombre, args, false, null, 'Se requiere el identificador del producto.');

    const productos = leerProductos();
    const p = productos.find((x) => String(x.id ?? '') === id);
    if (!p) return resultado(herramientaDetalleProducto.nombre, args, false, null, `Producto no encontrado: ${id}`);

    return resultado(
      herramientaDetalleProducto.nombre,
      args,
      true,
      {
        id: p.id,
        title: p.title,
        brand: p.brand,
        category: p.category,
        subcategory: p.subcategory,
        price: p.price,
        originalPrice: p.originalPrice,
        merchant: p.merchant,
        rating: p.rating,
        reviewsCount: p.reviewsCount,
        inStock: p.inStock,
        specs: p.specs ?? {},
        description: p.description,
        pros: p.pros ?? [],
        cons: p.cons ?? [],
        verdict: p.verdict,
        affiliateUrl: p.affiliateUrl,
        buyNowUrl: p.buyNowUrl,
        addedAt: p.addedAt,
        extra: p.extra ?? {},
      },
    );
  },
};

/**
 * Herramienta: listar categorías del catálogo.
 * Solo lectura.
 */
export const herramientaListarCategorias = {
  nombre: 'listar_categorias',
  descripcion: 'Lista todas las categorías del catálogo con el número de productos en cada una.',
  parametros: {
    type: 'object',
    properties: {},
    required: [],
  },
  soloLectura: true,
  ejecutar: async (_args: Record<string, unknown>): Promise<ResultadoHerramienta> => {
    const categorias = leerCategorias();
    const productos = leerProductos();
    const conteo: Record<string, number> = {};
    for (const p of productos) {
      const c = String(p.category ?? '');
      conteo[c] = (conteo[c] ?? 0) + 1;
    }
    return resultado(
      herramientaListarCategorias.nombre,
      _args,
      true,
      { categorias: categorias.map((c) => ({
        id: c.id,
        nombre: c.nombre,
        descripcion: c.descripcion,
        productos: conteo[c.nombre] ?? 0,
      })), total: categorias.length },
    );
  },
};

/**
 * Herramienta: analizar distribución de precios y descuentos del catálogo.
 * Solo lectura.
 */
export const herramientaAnalisisPrecios = {
  nombre: 'analisis_precios',
  descripcion: 'Analiza precios del catálogo: promedio, mínimo, máximo, descuentos declarados y productos con mejor relación calidad-precio.',
  parametros: {
    type: 'object',
    properties: {
      categoria: { type: 'string', description: 'Categoría para filtrar (opcional).' },
    },
    required: [],
  },
  soloLectura: true,
  ejecutar: async (args: Record<string, unknown>): Promise<ResultadoHerramienta> => {
    const categoria = String(args.categoria ?? '').toLowerCase().trim();
    const productos = leerProductos().filter((p) =>
      !categoria || String(p.category ?? '').toLowerCase() === categoria
    );

    const conPrecio = productos.filter((p) => Number(p.price) > 0);
    const precios = conPrecio.map((p) => Number(p.price));
    const promedio = precios.length
      ? precios.reduce((a, b) => a + b, 0) / precios.length
      : 0;
    const minimo = precios.length ? Math.min(...precios) : 0;
    const maximo = precios.length ? Math.max(...precios) : 0;

    const conDescuento = conPrecio.filter((p) => Number(p.originalPrice) > Number(p.price));
    const descuentos = conDescuento.map((p) =>
      Math.round(((Number(p.originalPrice) - Number(p.price)) / Number(p.originalPrice)) * 100)
    );
    const descuentoPromedio = descuentos.length
      ? descuentos.reduce((a, b) => a + b, 0) / descuentos.length
      : 0;

    const topOfertas = conDescuento
      .map((p) => ({
        id: p.id,
        title: p.title,
        price: p.price,
        originalPrice: p.originalPrice,
        descuentoPct: Math.round(((Number(p.originalPrice) - Number(p.price)) / Number(p.originalPrice)) * 100),
      }))
      .sort((a, b) => b.descuentoPct - a.descuentoPct)
      .slice(0, 10);

    return resultado(
      herramientaAnalisisPrecios.nombre,
      args,
      true,
      {
        productosAnalizados: productos.length,
        conPrecio: conPrecio.length,
        precioPromedio: Math.round(promedio * 100) / 100,
        precioMinimo: minimo,
        precioMaximo: maximo,
        productosConDescuento: conDescuento.length,
        descuentoPromedioPct: Math.round(descuentoPromedio * 100) / 100,
        topOfertas,
      },
    );
  },
};

/**
 * Herramienta: verificar stock de productos.
 * Solo lectura.
 */
export const herramientaEstadoStock = {
  nombre: 'estado_stock',
  descripcion: 'Consulta el estado de disponibilidad (inStock) de uno o varios productos del catálogo.',
  parametros: {
    type: 'object',
    properties: {
      ids: { type: 'array', items: { type: 'string' }, description: 'Lista de IDs de productos.' },
      soloAgotados: { type: 'boolean', description: 'Si es true, devuelve solo productos agotados o sin stock indicado.' },
    },
    required: [],
  },
  soloLectura: true,
  ejecutar: async (args: Record<string, unknown>): Promise<ResultadoHerramienta> => {
    const ids = Array.isArray(args.ids) ? args.ids.map(String) : [];
    const soloAgotados = Boolean(args.soloAgotados);
    const productos = leerProductos();

    let filtrados = productos;
    if (ids.length) {
      filtrados = filtrados.filter((p) => ids.includes(String(p.id ?? '')));
    }
    if (soloAgotados) {
      filtrados = filtrados.filter((p) => p.inStock === false || p.inStock === undefined);
    }

    return resultado(
      herramientaEstadoStock.nombre,
      args,
      true,
      {
        productos: filtrados.map((p) => ({
          id: p.id,
          title: p.title,
          inStock: p.inStock ?? null,
          merchant: p.merchant,
        })),
        total: filtrados.length,
        agotados: filtrados.filter((p) => p.inStock === false || p.inStock === undefined).length,
      },
    );
  },
};

/**
 * Herramienta: obtener resumen general del catálogo.
 * Solo lectura.
 */
export const herramientaResumenCatalogo = {
  nombre: 'resumen_catalogo',
  descripcion: 'Devuelve un resumen general del catálogo: total de productos, comercios, categorías, precio medio y productos sin datos clave.',
  parametros: {
    type: 'object',
    properties: {},
    required: [],
  },
  soloLectura: true,
  ejecutar: async (_args: Record<string, unknown>): Promise<ResultadoHerramienta> => {
    const productos = leerProductos();
    const categorias = leerCategorias();

    const comercios = new Set(productos.map((p) => String(p.merchant ?? '')).filter(Boolean));
    const sinPrecio = productos.filter((p) => !Number(p.price) || Number(p.price) <= 0).length;
    const sinImagen = productos.filter((p) => !p.image && !p.extra?.image).length;
    const sinDescripcion = productos.filter((p) => !p.description || String(p.description).trim().length < 40).length;

    return resultado(
      herramientaResumenCatalogo.nombre,
      _args,
      true,
      {
        totalProductos: productos.length,
        totalCategorias: categorias.length,
        comerciosUnicos: comercios.size,
        productosConPrecio: productos.filter((p) => Number(p.price) > 0).length,
        productosSinPrecio: sinPrecio,
        productosSinImagen: sinImagen,
        productosSinDescripcion: sinDescripcion,
        fechaConsulta: new Date().toISOString(),
      },
    );
  },
};

/** Todas las herramientas de solo lectura disponibles para los agentes. */
export const TODAS_LAS_HERRAMIENTAS = [
  herramientaBuscarProductos,
  herramientaDetalleProducto,
  herramientaListarCategorias,
  herramientaAnalisisPrecios,
  herramientaEstadoStock,
  herramientaResumenCatalogo,
];

/** Obtiene una herramienta por nombre. */
export function obtenerHerramienta(nombre: string) {
  return TODAS_LAS_HERRAMIENTAS.find((h) => h.nombre === nombre) ?? null;
}
