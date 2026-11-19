/**
 * FIXTURES SINTÉTICOS del Agente 10 (analítica): ningún evento, producto ni visitante es real. Se generan de forma determinista (sin azar) con el tipo de eventos de la analítica
 * existente (`page_view`, `outbound_click`, `purchase`…). Los ids de sesión y de visitante son inventados; algunos eventos llevan campos personales FICTICIOS (ip, userAgent) para
 * comprobar que el agente los descarta. Escenarios por opciones:
 *   · por defecto: 14 días terminados el 14/11/2026, 30 sesiones/día en la ventana actual y 18 en la anterior; «portátil» = mucho tráfico y poca salida, «ratón» = poco tráfico y
 *     mucha salida; 3 productos intermedios; 2 compras declaradas; tráfico repartido (≈ 60 % orgánico);
 *   · `sesionesAct`/`sesionesAnt` bajos → muestra insuficiente; `huecoDia` → un día sin eventos; `concentrado` → 85 % orgánico; `antiguedadDias` → datos antiguos.
 */
const DIA = 86400000;
export const PRODUCTOS_ANALITICA = [
  { id: 'p-portatil', title: 'Portátil 15 pulgadas (prueba)', cuota: 35, salida: 0.04, red: 'amazon' },
  { id: 'p-auriculares', title: 'Auriculares inalámbricos (prueba)', cuota: 25, salida: 0.10, red: 'amazon' },
  { id: 'p-teclado', title: 'Teclado mecánico (prueba)', cuota: 20, salida: 0.12, red: 'ebay' },
  { id: 'p-lampara', title: 'Lámpara de escritorio (prueba)', cuota: 12, salida: 0.10, red: 'aliexpress' },
  { id: 'p-raton', title: 'Ratón ergonómico (prueba)', cuota: 8, salida: 0.30, red: 'amazon' },
];

export function construirAnaliticaSintetica({ ahora = Date.parse('2026-11-15T09:00:00Z'), sesionesAct = 30, sesionesAnt = 18, huecoDia = null, concentrado = false, antiguedadDias = 0, ultimoDia = '2026-11-14', extraPersonales = true } = {}) {
  const fin = Date.parse(`${ultimoDia}T00:00:00Z`) - antiguedadDias * DIA;
  const perm = []; // 100 casillas repartidas por cuota, en orden mezclado y determinista
  for (const p of PRODUCTOS_ANALITICA) for (let i = 0; i < p.cuota; i += 1) perm.push(p);
  const orden = perm.map((_, i) => (i * 37) % 100);
  const cola = orden.map((i) => perm[i]);
  const visitasDe = new Map(PRODUCTOS_ANALITICA.map((p) => [p.id, 0]));
  const salidasDe = new Map(PRODUCTOS_ANALITICA.map((p) => [p.id, 0]));
  const eventos = [];
  let n = 0; let pv = 0; let ses = 0;
  const referente = (i) => { const r = i % 100; const lim = concentrado ? 85 : 60; if (r < lim) return i % 2 ? 'https://www.google.com/search?q=privado' : 'https://www.bing.com/search?q=privado'; if (r < lim + 25) return undefined; return r % 2 ? 'https://www.instagram.com/' : 'https://blog.ejemplo.test/resena'; };
  for (let d = 13; d >= 0; d -= 1) {
    const fecha = new Date(fin - d * DIA);
    const dia = fecha.toISOString().slice(0, 10);
    if (huecoDia && dia === huecoDia) continue;
    const sesiones = d >= 7 ? sesionesAnt : sesionesAct;
    for (let s = 0; s < sesiones; s += 1) {
      ses += 1;
      const sid = `sesion-ficticia-${ses}`;
      const vid = `visitante-ficticio-${(ses * 7) % 97}`;
      const t0 = fecha.getTime() + (s * 40 + 5) * 60000 % DIA;
      const vistas = 1 + (ses % 5 === 0 ? 1 : 0) + (ses % 7 === 0 ? 1 : 0);
      const ref = referente(ses);
      for (let v = 0; v < vistas; v += 1) {
        const p = cola[pv % 100]; pv += 1;
        visitasDe.set(p.id, visitasDe.get(p.id) + 1);
        const base = { sessionId: sid, visitorId: vid, productId: p.id, path: `/producto/${p.id}`, source: 'middleware' };
        eventos.push({ ...base, type: 'page_view', referrer: v === 0 ? ref : undefined, createdAt: new Date(t0 + v * 90000).toISOString(), ...(extraPersonales && n % 11 === 0 ? { ip: '203.0.113.7', userAgent: 'NavegadorFicticio/1.0' } : {}) });
        n += 1;
        const objetivo = Math.floor(visitasDe.get(p.id) * p.salida + 1e-9);
        if (objetivo > salidasDe.get(p.id)) {
          salidasDe.set(p.id, objetivo);
          eventos.push({ ...base, type: 'outbound_click', network: p.red, source: 'redirect', createdAt: new Date(t0 + v * 90000 + 30000).toISOString() });
        }
      }
      if (d < 7 && ses % 53 === 0) eventos.push({ type: 'purchase', sessionId: sid, visitorId: vid, productId: 'p-auriculares', amount: 89.9, source: 'cliente', createdAt: new Date(t0 + 600000).toISOString() });
      eventos.push({ type: 'page_duration', sessionId: sid, visitorId: vid, durationMs: 20000 + (ses % 9) * 15000, source: 'cliente', createdAt: new Date(t0 + 700000).toISOString() });
    }
  }
  return { sintetico: true, ahora, events: eventos, productos: PRODUCTOS_ANALITICA.map((p) => ({ id: p.id, title: p.title })) };
}
