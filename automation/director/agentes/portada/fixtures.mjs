/**
 * FIXTURES SINTÉTICOS del Agente 06 (portada/categorías/historias): categorías, productos, imágenes y secciones inventados; nada procede de producción.
 * Escenarios: informática (14 productos, SIN subcategorías → propuesta de dividir), portabilidad, sonido, hogar, categoría vacía «jardin», subcategoría con un
 * único producto, categoría con padre inexistente, productos sin precio / agotado / retirado y descuentos verificados (observación reciente) y solo declarados.
 */
const horas = (n, ahora) => new Date(ahora - n * 3600000).toISOString();
const img = (n) => `https://img.example.com/portada/${n}.jpg`;

export function construirDatosPortada(ahora = Date.parse('2026-11-14T12:00:00Z')) {
  const categorias = [
    { id: 'informatica', name: 'Informática', slug: 'informatica', parentId: null, icon: '💻' },
    { id: 'portabilidad', name: 'Portabilidad', slug: 'portabilidad', parentId: null, icon: '🎒' },
    { id: 'portabilidad--powerbanks', name: 'Powerbanks', slug: 'powerbanks', parentId: 'portabilidad' },
    { id: 'sonido', name: 'Sonido', slug: 'sonido', parentId: null, icon: '🎧' },
    { id: 'hogar', name: 'Hogar', slug: 'hogar', parentId: null, icon: '🏠' },
    { id: 'jardin', name: 'Jardín', slug: 'jardin', parentId: null, icon: '🌱' },
    { id: 'huerfana', name: 'Huérfana', slug: 'huerfana', parentId: 'no-existe' },
  ];
  const productos = [];
  const add = (p) => productos.push({ currency: 'EUR', inStock: true, network: 'amazon', ...p, image: p.image ?? img(p.id) });
  const verif = (price, previo) => ({ observations: [{ price, originalPrice: previo, verifiedAt: horas(6, ahora), context: { currency: 'EUR' } }] });
  const infos = ['Portátil 15 pulgadas Intel i5 16 GB', 'Portátil 14 pulgadas Ryzen 7 512 GB', 'Monitor 27 pulgadas QHD 144 Hz', 'Monitor 24 pulgadas Full HD', 'Teclado mecánico inalámbrico', 'Teclado compacto Bluetooth', 'Ratón ergonómico inalámbrico', 'Ratón gaming RGB', 'Webcam Full HD', 'Disco SSD 1 TB portátil', 'Disco SSD 500 GB', 'Hub USB-C 7 puertos', 'Soporte portátil aluminio', 'Alfombrilla XXL'];
  infos.forEach((t, i) => add({ id: `inf-${i + 1}`, title: t, price: 30 + i * 17.5, category: 'Informática', category_id: 'informatica', extra: i === 0 ? verif(30, 45) : i === 2 ? verif(79.9 - 79.9 + 30 + 2 * 17.5, 90) : {} }));
  add({ id: 'por-1', title: 'Powerbank 20000 mAh carga rápida', price: 29.9, category: 'Portabilidad', category_id: 'portabilidad', subcategory_id: 'portabilidad--powerbanks' });
  add({ id: 'por-2', title: 'Mochila antirrobo 15 pulgadas', price: 39.9, category: 'Portabilidad', category_id: 'portabilidad' });
  add({ id: 'por-3', title: 'Funda portátil neopreno', price: 14.5, category: 'Portabilidad', category_id: 'portabilidad' });
  add({ id: 'por-4', title: 'Cable multiusos 3 en 1', price: 9.9, category: 'Portabilidad', category_id: 'portabilidad' });
  add({ id: 'son-1', title: 'Auriculares inalámbricos cancelación de ruido', price: 89, category: 'Sonido', category_id: 'sonido', extra: verif(89, 129) });
  add({ id: 'son-2', title: 'Altavoz Bluetooth resistente al agua', price: 45, category: 'Sonido', category_id: 'sonido' });
  add({ id: 'son-3', title: 'Auriculares in-ear deportivos', price: 25, category: 'Sonido', category_id: 'sonido', inStock: false });
  add({ id: 'son-4', title: 'Barra de sonido compacta', price: 119, category: 'Sonido', category_id: 'sonido', extra: { observations: [] }, originalPrice: 200 });
  add({ id: 'hog-1', title: 'Robot aspirador con mapeo', price: 199, category: 'Hogar', category_id: 'hogar' });
  add({ id: 'hog-2', title: 'Lámpara de escritorio LED regulable', price: 22, category: 'Hogar', category_id: 'hogar' });
  add({ id: 'hog-3', title: 'Freidora de aire 5 litros', price: 69, category: 'Hogar', category_id: 'hogar' });
  add({ id: 'hog-4', title: 'Humidificador ultrasónico', price: 27, category: 'Hogar', category_id: 'hogar' });
  add({ id: 'sin-precio', title: 'Producto sin precio disponible', price: null, category: 'Hogar', category_id: 'hogar' });
  add({ id: 'retirado-1', title: 'Producto retirado del catálogo', price: 10, category: 'Hogar', category_id: 'hogar' });
  add({ id: 'cat-rota', title: 'Producto con categoría inexistente', price: 15, category: 'Otra', category_id: 'categoria-fantasma' });
  return {
    categorias,
    productos,
    retiradas: ['retirado-1'],
    secciones: [{ id: 'destacados', title: 'Destacados', published: true, order: 1, position: 'below', speed: 'normal', productIds: ['inf-1', 'son-1'] }],
  };
}
