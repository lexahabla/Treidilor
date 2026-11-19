/**
 * FIXTURES SINTÉTICOS del Agente 08 (contenido y recursos visuales): extienden los del Agente 07 (mismo catálogo de referencia y misma fecha) con marca, características e imágenes de
 * distinto origen. Ninguna imagen, marca o característica es real. Escenarios:
 *   · inf-portatil: marca y características; imagen de PRUEBA y descuento VERIFICADO;
 *   · aud-auriculares: imagen «de tienda» (CDN de Amazon, derechos pendientes) y descuento verificado;
 *   · aud-barra: imagen GENERADA por IA ya existente (`/images/products/…`), sin marca ni características (datos insuficientes);
 *   · aud-altavoz: SIN fecha de captura del precio y con una URL de imagen NO segura (http a una IP);
 *   · inf-raton: sin imagen.
 */
import { construirFuentesMarketing } from '../marketing/fixtures.mjs';

export { AHORA_MK } from '../marketing/fixtures.mjs';

export function construirFuentesContenido(motorMarketing, ahora) {
  const f = construirFuentesMarketing(motorMarketing, ahora);
  const por = (id) => f.productos.find((p) => p.id === id);
  Object.assign(por('inf-portatil'), { brand: 'MarcaPrueba', specs: { Procesador: 'Intel Core i5', RAM: '16 GB', Almacenamiento: '512 GB SSD', Pantalla: '15,6 pulgadas' } });
  Object.assign(por('aud-auriculares'), { brand: 'SonidoPrueba', image: 'https://m.media-amazon.com/images/I/61abc123._AC_SX679_.jpg', specs: { Conectividad: 'Bluetooth 5.2', Autonomía: '30 horas' } });
  Object.assign(por('aud-barra'), { image: '/images/products/barra-de-sonido-compacta-abc123.png' });
  Object.assign(por('aud-altavoz'), { image: 'http://127.0.0.1/altavoz.jpg' });
  return f;
}
