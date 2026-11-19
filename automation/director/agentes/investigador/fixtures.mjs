/**
 * FIXTURES SINTÉTICOS del Agente 01: un feed del catálogo (forma `automation-catalog/1`: id, title, description, price, originalPrice, category, merchant, image, stock) inventado.
 * Escenarios: tres candidatos con descuento DECLARADO razonable (distinta puntuación), un descuento poco creíble (> 70 %), un producto agotado con descuento (no es candidato), productos
 * sin descuento, fichas sin imagen o con descripción corta, dos títulos duplicados y una categoría con un solo producto. Ningún dato es real.
 */
const LARGA = 'Descripción completa y factual del producto de prueba, con uso habitual, características declaradas y contenido del paquete para que supere el mínimo de longitud exigido.';
const p = (o) => ({ description: LARGA, image: `https://img.example.com/inv/${o.id}.jpg`, merchant: 'Tienda Prueba', stock: 'in_stock', ...o });

export function construirFeedInvestigador() {
  return {
    sintetico: true,
    products: [
      p({ id: 'p1', title: 'Portátil 15 pulgadas Intel i5 16 GB', price: 600, originalPrice: 900, category: 'Informática' }),
      p({ id: 'p2', title: 'Monitor 27 pulgadas QHD 144 Hz', price: 100, originalPrice: 500, category: 'Informática' }),
      p({ id: 'p3', title: 'Teclado mecánico inalámbrico', price: 45, originalPrice: 60, category: 'Informática', merchant: 'Otra Tienda' }),
      p({ id: 'p4', title: 'Ratón ergonómico inalámbrico', price: 28, originalPrice: 30, category: 'Informática' }),
      p({ id: 'p5', title: 'Auriculares inalámbricos con cancelación de ruido', price: 89, originalPrice: 119, category: 'Sonido' }),
      p({ id: 'p6', title: 'Altavoz Bluetooth portátil', price: 39, category: 'Sonido' }),
      p({ id: 'p7', title: 'Barra de sonido compacta', price: 119, originalPrice: 200, category: 'Sonido', stock: 'out_of_stock' }),
      p({ id: 'p8', title: 'Robot aspirador con mapeo', price: 199, category: 'Hogar', image: '' }),
      p({ id: 'p9', title: 'Lámpara de escritorio LED regulable', price: 22, category: 'Hogar', description: 'Corta' }),
      p({ id: 'p10', title: 'Freidora de aire 5 litros', price: 69, originalPrice: 90, category: 'Hogar', merchant: '' }),
      p({ id: 'p11', title: 'Humidificador ultrasónico silencioso', price: 27, category: 'Hogar' }),
      p({ id: 'p12', title: 'Humidificador ultrasónico silencioso', price: 31, category: 'Hogar' }),
      p({ id: 'p13', title: 'Cortacésped eléctrico de jardín', price: 150, category: 'Jardín' }),
    ],
  };
}
