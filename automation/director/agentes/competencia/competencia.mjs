/**
 * Agente 09 · COMPETENCIA Y EXPERTOS (ficha `automation/agents/09-competencia-expertos.md`; riesgo bajo; «solo informes»; alcance previsto `research:write`; honestidad: «respetar términos
 * de uso de cada fuente; sin copiar contenido»; medición: «huecos explotados»). COMPONENTES PUROS: validan y analizan OBSERVACIONES sobre competidores y fuentes expertas que se APORTAN por
 * parámetro (ya citadas, con fecha y con sus términos de uso revisados por una persona) y producen informes `informe-agente/1`. NO están registrados como capacidades (el 09 no tiene
 * ninguna aprobada: ver `propuesta-capacidades-09.json`, NO aprobada). El agente NO accede a ninguna web, NO hace scraping, NO consulta APIs ni servicios de pago, NO copia contenido y NO
 * escribe nada: una URL es solo una CITA.
 * Evidencia en cuatro clases: `hecho_verificado` (una persona lo comprobó y lo dejó firmado con fecha), `observacion` (visto en una fuente citada, sin verificar), `estimacion` (con método
 * explícito) y `no_disponible`. Una «ventaja comercial», un precio o la opinión de un experto NUNCA se infieren: solo se citan lo observado, con su fuente y fecha, y una comparación solo se
 * hace con equivalencia de producto verificada por una persona, condición «nuevo», EUR y observación reciente.
 * Reutiliza lo que YA existe: `offerObservations.freshnessOf` (vigencia), `commercialClaims.captureDateOf` (fecha de captura de NUESTRO precio), `publicSafety.isPublicSafeExternalUrl` (citas
 * seguras), `ledger.detectarSecreto` y `saneado.detectarInstruccionesEnDatos` (credenciales e «instrucciones» dentro de datos), y los informes de los Agentes 05 y 10 como contexto (solo
 * ids). No duplica al 02 (afiliación), al 05 (precios propios y ofertas) ni al 10 (analítica propia).
 */
import { createHash } from 'node:crypto';
import { ESQUEMA_INFORME_AGENTE, ErrorProtocolo, canonico, sha256 } from '../../protocolo.mjs';
import { detectarSecreto } from '../../ledger.mjs';
import { detectarInstruccionesEnDatos } from '../../saneado.mjs';

/** Umbrales iniciales CONFIGURABLES (se declaran en el informe; no son verdades del mercado). */
export const UMBRALES = Object.freeze({ maxEdadPrecioDias: 14, maxEdadFuenteDias: 180, minFuentesHueco: 2, maxTexto: 280, maxCitaLiteral: 120, maxFuentes: 50, maxObservacionesPorFuente: 60 });
const DIA = 86400000;
const CLASES = ['hecho_verificado', 'observacion', 'estimacion', 'no_disponible'];
const TEMAS = ['precio', 'cobertura', 'practica', 'formato'];
const TIPOS_FUENTE = ['competidor', 'experto', 'medio', 'comparador'];

/** Carga las funciones existentes (requiere el cargador de TypeScript del proyecto). */
export async function cargarMotorCompetencia() {
  if (!process.env.TRADYLOR_DATA_DIR) process.env.TRADYLOR_DATA_DIR = `${process.env.TEMP || process.env.TMPDIR || '/tmp'}/tai-competencia-sin-datos`; // nunca datos reales
  const base = new URL('../../../../src/lib/', import.meta.url);
  try {
    const [obs, claims, seguridad] = await Promise.all(['offerObservations.ts', 'commercialClaims.ts', 'homeLayout/publicSafety.ts'].map((f) => import(new URL(f, base).href)));
    return { obs, claims, seguridad };
  } catch (e) {
    throw new ErrorProtocolo('origen_no_disponible', 'Las funciones existentes de análisis comercial no están disponibles (hace falta el cargador de TypeScript del proyecto).', { causa: String(e && e.code ? e.code : 'import') });
  }
}
const exigir = (m) => { if (!m || !m.obs || !m.claims || !m.seguridad) throw new ErrorProtocolo('origen_no_disponible', 'Las funciones existentes de análisis comercial no están cargadas.'); return m; };
const h = (clave, regla, elemento, evidencia, { certeza = null, prioridad = null, accion = null } = {}) => ({ clave, regla, certeza, prioridad, gravedad: null, elemento, evidencia, accionSugerida: accion });
const esFecha = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s) && Number.isFinite(Date.parse(s));
const dias = (desde, hasta) => Math.floor((hasta - Date.parse(desde)) / DIA);
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const eur = (n) => `${Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/**
 * Valida y normaliza las observaciones aportadas. NO accede a ninguna fuente. Devuelve { fuentes, observaciones, rechazos }: cada observación lleva su clase efectiva, su fuente citada y
 * si es utilizable para conclusiones (términos de uso revisados, fuente no caducada, sin contenido anómalo). PURO.
 */
export function validarObservaciones({ motor, datos, ahora = Date.now(), umbrales = {} }) {
  const m = exigir(motor);
  const u = { ...UMBRALES, ...umbrales };
  const rechazos = [];
  const fuentes = [];
  const observaciones = [];
  const lista = Array.isArray(datos && datos.fuentes) ? datos.fuentes.slice(0, u.maxFuentes) : [];
  if (Array.isArray(datos && datos.fuentes) && datos.fuentes.length > u.maxFuentes) rechazos.push({ ambito: 'datos', motivo: `se admiten como máximo ${u.maxFuentes} fuentes` });
  for (const [i, f] of lista.entries()) {
    const idF = typeof (f && f.id) === 'string' && f.id ? f.id.slice(0, 40) : `fuente-${i + 1}`;
    if (!f || typeof f !== 'object') { rechazos.push({ ambito: 'fuente', id: idF, motivo: 'no es un objeto' }); continue; }
    const problemas = [];
    if (!TIPOS_FUENTE.includes(f.tipo)) problemas.push('tipo_de_fuente_invalido');
    if (typeof f.nombre !== 'string' || !f.nombre.trim()) problemas.push('sin_nombre');
    if (!m.seguridad.isPublicSafeExternalUrl(f.url)) problemas.push('cita_url_no_segura_o_ausente');
    if (!esFecha(f.observadaEn) || Date.parse(f.observadaEn) > ahora) problemas.push('fecha_de_observacion_ausente_o_futura');
    if (typeof f.observadoPor !== 'string' || !f.observadoPor.trim()) problemas.push('sin_observador');
    if (problemas.length) { rechazos.push({ ambito: 'fuente', id: idF, motivo: problemas.join(', ') }); continue; }
    const terminosRevisados = Boolean(f.terminos && f.terminos.revisados === true && f.terminos.permiteCitar === true);
    const edad = dias(f.observadaEn, ahora);
    const caducada = edad > u.maxEdadFuenteDias;
    const fuente = { id: idF, nombre: f.nombre.trim().slice(0, 80), tipo: f.tipo, url: f.url, observadaEn: f.observadaEn.slice(0, 10), observadoPor: f.observadoPor.trim().slice(0, 60), terminosRevisados, caducada, edadDias: edad, utilizable: terminosRevisados && !caducada };
    fuentes.push(fuente);
    for (const [j, o] of (Array.isArray(f.observaciones) ? f.observaciones : []).slice(0, u.maxObservacionesPorFuente).entries()) {
      const idO = typeof (o && o.id) === 'string' && o.id ? o.id.slice(0, 40) : `${idF}:o${j + 1}`;
      const rech = (motivo) => rechazos.push({ ambito: 'observacion', id: idO, fuente: idF, motivo });
      if (!o || typeof o !== 'object') { rech('no es un objeto'); continue; }
      if (!CLASES.includes(o.clase)) { rech('clase_invalida'); continue; }
      if (!TEMAS.includes(o.tema)) { rech('tema_invalido'); continue; }
      const texto = typeof o.texto === 'string' ? o.texto.trim() : '';
      if (o.clase !== 'no_disponible' && !texto) { rech('sin_texto'); continue; }
      if (texto.length > u.maxTexto) { rech(`extracto_largo (${texto.length} > ${u.maxTexto}): resumir con palabras propias, sin copiar contenido`); continue; }
      const citas = [...texto.matchAll(/[«"“]([^»"”]{1,400})[»"”]/g)].filter((x) => x[1].length > u.maxCitaLiteral);
      if (citas.length) { rech('cita_literal_larga: no se copia contenido de la fuente'); continue; }
      if (detectarSecreto(texto)) { rech('contiene_algo_con_forma_de_credencial'); continue; }
      const sospechoso = detectarInstruccionesEnDatos([{ origen: idO, texto }]).length > 0;
      let clase = o.clase;
      const avisos = [];
      if (clase === 'hecho_verificado') {
        const ev = o.evidencia;
        if (!(ev && ev.verificadoPor === 'persona' && esFecha(ev.verificadoEn) && Date.parse(ev.verificadoEn) <= ahora)) { clase = 'observacion'; avisos.push('hecho_sin_evidencia_de_verificacion_humana: se trata como observación'); }
      }
      if (clase === 'estimacion' && !(typeof o.metodo === 'string' && o.metodo.trim())) { rech('estimacion_sin_metodo'); continue; }
      let precio = null;
      if (o.precio !== undefined && o.precio !== null) {
        const p = o.precio;
        if (!(p && typeof p === 'object' && Number(p.valor) > 0 && typeof p.moneda === 'string')) { rech('precio_invalido'); continue; }
        precio = { valor: Number(p.valor), moneda: String(p.moneda).toUpperCase().slice(0, 3), condicion: String(p.condicion ?? 'desconocida').toLowerCase().slice(0, 20), productoEquivalente: typeof p.productoEquivalente === 'string' ? p.productoEquivalente.slice(0, 80) : null, equivalenciaVerificada: p.equivalenciaVerificada === true };
      }
      const motivosExclusion = [];
      if (!terminosRevisados) motivosExclusion.push('terminos_de_uso_sin_revisar_o_sin_permiso_de_cita');
      if (caducada) motivosExclusion.push('fuente_caducada');
      if (sospechoso) motivosExclusion.push('contenido_anomalo_con_forma_de_orden');
      observaciones.push({ id: idO, fuente: idF, clase, claseDeclarada: o.clase, tema: o.tema, clave: typeof o.clave === 'string' && o.clave ? fold(o.clave).slice(0, 60) : null, categoria: typeof o.categoria === 'string' ? o.categoria.slice(0, 40) : null, texto: texto || null, metodo: typeof o.metodo === 'string' ? o.metodo.slice(0, 120) : null, precio, evidencia: clase === 'hecho_verificado' ? { verificadoPor: 'persona', verificadoEn: o.evidencia.verificadoEn.slice(0, 10) } : null, avisos, motivosExclusion, utilizable: motivosExclusion.length === 0 });
    }
  }
  return { fuentes, observaciones, rechazos };
}

/**
 * Informe de competencia. `modo`: `completo` | `huecos` | `precios` | `validacion` (cada uno corresponde a una capacidad PROPUESTA; ninguna está registrada). `fuentes` = { productos, categorias }
 * de NUESTRO catálogo de referencia (aportado por parámetro). `datos.nuestraCobertura` = claves de temas que ya cubrimos. PURO: no accede a nada ni escribe.
 */
export function informeCompetencia({ motor, datos, fuentes = {}, informes = [], modo = 'completo', ahora = Date.now(), sintetico = true, capacidad = '09.proponer-informe-competencia', umbrales = {} }) {
  const m = exigir(motor);
  const u = { ...UMBRALES, ...umbrales };
  const v = validarObservaciones({ motor: m, datos, ahora, umbrales: u });
  const H = [];
  const productos = fuentes.productos || [];
  const categorias = fuentes.categorias || [];
  const cobertura = new Set((Array.isArray(datos && datos.nuestraCobertura) ? datos.nuestraCobertura : []).map(fold));
  const por = new Map(v.fuentes.map((f) => [f.id, f]));
  const util = v.observaciones.filter((o) => o.utilizable);
  const suposiciones = [
    'Las observaciones las aporta una persona con su fuente citada, fecha y términos de uso revisados; el agente no accede a ninguna web ni verifica nada por sí mismo.',
    'Un hecho solo es «verificado» si una persona lo dejó firmado con fecha; el resto son observaciones o estimaciones con método.',
    `Una comparación de precio exige equivalencia de producto verificada por una persona, condición «nuevo», EUR y observación de menos de ${u.maxEdadPrecioDias} días; no incluye envío ni condiciones.`,
    `Un hueco exige que lo citen al menos ${u.minFuentesHueco} fuentes distintas y utilizables; con una sola es solo una señal débil.`,
  ];
  suposiciones.forEach((t, i) => H.push(h(`suposicion:${i + 1}`, 'suposicion', null, { texto: t })));

  if (['completo', 'validacion'].includes(modo)) {
    for (const f of v.fuentes) {
      H.push(h(`fuente:${f.id}`, 'fuente_citada', f.id, { nombre: f.nombre, tipo: f.tipo, url: f.url, observadaEn: f.observadaEn, observadoPor: f.observadoPor, edadDias: f.edadDias, terminosRevisados: f.terminosRevisados, utilizable: f.utilizable }, { certeza: 'confirmado', prioridad: 'P4' }));
      if (!f.terminosRevisados) H.push(h(`fuente:${f.id}:terminos`, 'terminos_de_uso_pendientes', f.id, { nombre: f.nombre }, { certeza: 'no_verificable', prioridad: 'P3', accion: 'Una persona debe revisar los términos de uso de la fuente y si permite citarla; hasta entonces sus observaciones no entran en ninguna conclusión.' }));
      if (f.caducada) H.push(h(`fuente:${f.id}:caducada`, 'fuente_caducada', f.id, { nombre: f.nombre, edadDias: f.edadDias, maximo: u.maxEdadFuenteDias }, { certeza: 'confirmado', prioridad: 'P4', accion: 'La observación es demasiado antigua: volver a observar la fuente antes de usarla.' }));
    }
    for (const r of v.rechazos) H.push(h(`rechazo:${r.ambito}:${r.id ?? 'datos'}`, 'dato_rechazado', r.id ?? null, { ambito: r.ambito, fuente: r.fuente ?? null, motivo: r.motivo }, { certeza: 'confirmado', prioridad: 'P3', accion: 'No se usa: corregir el dato en la fuente aportada.' }));
    for (const o of v.observaciones) {
      if (o.avisos.length) H.push(h(`obs:${o.id}:aviso`, 'observacion_degradada', o.id, { claseDeclarada: o.claseDeclarada, claseEfectiva: o.clase, avisos: o.avisos }, { certeza: 'advertencia', prioridad: 'P3' }));
      if (o.motivosExclusion.includes('contenido_anomalo_con_forma_de_orden')) H.push(h(`obs:${o.id}:anomalo`, 'contenido_anomalo', o.id, { fuente: o.fuente }, { certeza: 'advertencia', prioridad: 'P2', accion: 'El texto de la observación parece una orden: se cita como dato, no se obedece ni se usa.' }));
    }
  }
  if (modo === 'completo') {
    for (const o of v.observaciones) {
      const f = por.get(o.fuente);
      H.push(h(`obs:${o.id}`, o.clase === 'hecho_verificado' ? 'hecho_verificado' : o.clase === 'estimacion' ? 'estimacion' : o.clase === 'no_disponible' ? 'dato_no_disponible_en_fuente' : 'observacion', o.id, { fuente: f ? f.nombre : o.fuente, observadaEn: f ? f.observadaEn : null, tema: o.tema, categoria: o.categoria, texto: o.texto, metodo: o.metodo, verificacion: o.evidencia, utilizableParaConclusiones: o.utilizable, motivosExclusion: o.motivosExclusion }, { certeza: o.clase === 'hecho_verificado' ? 'confirmado' : o.clase === 'observacion' ? 'advertencia' : 'no_verificable', prioridad: 'P4' }));
    }
  }

  // ── huecos ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  let huecos = 0; let senales = 0;
  if (['completo', 'huecos'].includes(modo)) {
    const porClave = new Map();
    for (const o of util) if (['cobertura', 'practica', 'formato'].includes(o.tema) && o.clave && o.clase !== 'no_disponible') porClave.set(o.clave, [...(porClave.get(o.clave) || []), o]);
    const idsPropios = new Set();
    for (const inf of informes) {
      if (inf && inf.agente === '10') for (const x of inf.hallazgos || []) if (['producto_alto_trafico_baja_salida', 'producto_alta_salida_poco_trafico'].includes(x.regla)) idsPropios.add(x.elemento);
    }
    for (const [clave, obs] of [...porClave.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const fuentesDist = [...new Set(obs.map((o) => o.fuente))].sort();
      const nombres = fuentesDist.map((id) => ({ fuente: por.get(id).nombre, observadaEn: por.get(id).observadaEn }));
      const cat = obs.find((o) => o.categoria)?.categoria ?? null;
      const prodsCat = cat ? productos.filter((p) => (p.category_id === cat || p.subcategory_id === cat) && Number(p.price) > 0).length : null;
      const ev = { clave, fuentes: nombres, nFuentes: fuentesDist.length, categoria: cat, productosPropiosEnLaCategoria: prodsCat, temas: [...new Set(obs.map((o) => o.tema))], contextoPropio: [...idsPropios].slice(0, 5) };
      if (cobertura.has(clave)) { H.push(h(`hueco:${clave}`, 'tema_ya_cubierto', clave, ev, { certeza: 'confirmado', prioridad: 'P4' })); continue; }
      if (fuentesDist.length >= u.minFuentesHueco) {
        huecos += 1;
        H.push(h(`hueco:${clave}`, 'hueco_detectado', clave, { ...ev, hipotesis: 'varias fuentes citan este tema y no consta que lo cubramos', explotable: prodsCat === null ? 'sin_categoria_indicada' : prodsCat > 0 ? 'hay_productos_propios_en_la_categoria' : 'la_categoria_no_tiene_productos_propios' }, { certeza: 'advertencia', prioridad: 'P3', accion: 'Hipótesis de oportunidad editorial: validar con una persona antes de planificar contenido (Agentes 07 y 08). No se promete ningún resultado.' }));
      } else { senales += 1; H.push(h(`hueco:${clave}`, 'hueco_senal_debil', clave, ev, { certeza: 'no_verificable', prioridad: 'P4', accion: `Solo una fuente lo cita: no se considera un hueco (mínimo ${u.minFuentesHueco}).` })); }
    }
    for (const o of util.filter((x) => x.tema === 'practica' && x.clave)) H.push(h(`practica:${o.id}`, 'practica_observada', o.id, { fuente: por.get(o.fuente).nombre, observadaEn: por.get(o.fuente).observadaEn, clase: o.clase, resumen: o.texto, requiereValidacion: true }, { certeza: 'advertencia', prioridad: 'P4', accion: 'Práctica OBSERVADA en una fuente: no implica que funcione ni que convenga adoptarla.' }));
  }

  // ── precios observados de competidores frente a nuestras fichas ─────────────────────────────────────────────────────────────────────
  let brechas = 0; let noComparables = 0;
  if (['completo', 'precios'].includes(modo)) {
    for (const o of v.observaciones.filter((x) => x.precio)) {
      const f = por.get(o.fuente);
      const razones = [];
      if (!o.utilizable) razones.push(...o.motivosExclusion);
      if (o.precio.moneda !== 'EUR') razones.push('moneda_distinta_de_eur');
      if (o.precio.condicion !== 'nuevo') razones.push('condicion_no_es_nuevo');
      if (!o.precio.productoEquivalente) razones.push('sin_producto_equivalente');
      else if (!o.precio.equivalenciaVerificada) razones.push('equivalencia_no_verificada_por_una_persona');
      if (m.obs.freshnessOf(f.observadaEn, u.maxEdadPrecioDias * 24, new Date(ahora)) !== 'fresh') razones.push(`observacion_de_hace_mas_de_${u.maxEdadPrecioDias}_dias`);
      const propio = o.precio.productoEquivalente ? productos.find((p) => p.id === o.precio.productoEquivalente) : null;
      if (o.precio.productoEquivalente && !propio) razones.push('el_producto_equivalente_no_esta_en_nuestras_fuentes');
      const captura = propio ? m.claims.captureDateOf(propio) : null;
      if (propio && !(Number(propio.price) > 0)) razones.push('nuestra_ficha_sin_precio');
      if (propio && Number(propio.price) > 0 && !captura) razones.push('nuestro_precio_sin_fecha_de_captura');
      if (propio && String(propio.currency ?? 'EUR').toUpperCase() !== 'EUR') razones.push('nuestra_ficha_en_otra_moneda');
      if (razones.length) { noComparables += 1; H.push(h(`precio:${o.id}`, 'precio_no_comparable', o.id, { fuente: f.nombre, observadaEn: f.observadaEn, precioObservado: o.precio.valor, moneda: o.precio.moneda, razones: [...new Set(razones)] }, { certeza: 'no_verificable', prioridad: 'P4', accion: 'No se compara: no se afirma ninguna diferencia de precio.' })); continue; }
      const dif = Math.round((Number(propio.price) - o.precio.valor) * 100) / 100;
      const pct = Math.round((dif / o.precio.valor) * 1000) / 10;
      brechas += 1;
      H.push(h(`precio:${o.id}`, 'brecha_de_precio_observada', o.id, { producto: propio.id, nuestroPrecio: Number(propio.price), nuestraFechaDeCaptura: captura, precioObservado: o.precio.valor, fuente: f.nombre, observadaEn: f.observadaEn, claseDeObservacion: o.clase, diferenciaEur: dif, diferenciaPct: pct, sentido: dif > 0 ? 'nuestro_precio_mayor' : dif < 0 ? 'nuestro_precio_menor' : 'igual', texto: `Según ${f.nombre} (${f.observadaEn}), ${eur(o.precio.valor)}; nuestra ficha ${eur(propio.price)} (captura ${String(captura).slice(0, 10)}).`, nota: 'observación puntual de la fuente citada; no incluye envío, garantía ni condiciones' }, { certeza: o.clase === 'hecho_verificado' ? 'confirmado' : 'advertencia', prioridad: 'P3', accion: 'Dato para decidir; no es una conclusión sobre ventaja comercial ni una orden de cambiar precios (L4 humano).' }));
    }
  }

  H.push(h('no_disponible', 'datos_no_disponibles', null, { metricas: [
    { metrica: 'huecos_explotados', motivo: 'no existe registro de huecos que se hayan trabajado ni de su resultado' },
    { metrica: 'cuota_de_mercado_o_trafico_de_competidores', motivo: 'no hay ninguna fuente de esos datos' },
    { metrica: 'precios_de_competidores_no_aportados', motivo: 'solo se analizan observaciones aportadas con fuente y fecha; el agente no consulta ninguna web' },
    { metrica: 'opiniones_de_expertos_no_aportadas', motivo: 'no se infieren ni se resumen fuentes que no se hayan aportado' },
  ] }, { certeza: 'no_verificable', prioridad: 'P4' }));

  const cuenta = (c) => v.observaciones.filter((o) => o.clase === c).length;
  const excl = v.observaciones.filter((o) => !o.utilizable).length;
  const limitaciones = [
    'Solo informes: el agente no accede a ninguna web, no hace scraping, no consulta APIs ni servicios de pago y no copia contenido; las URL son únicamente citas.',
    'Todo procede de observaciones aportadas por una persona; el agente no las verifica. No se infieren precios, resultados de competidores, opiniones de expertos ni ventajas comerciales.',
    'Un hueco es una hipótesis de oportunidad (≥ 2 fuentes utilizables), no una conclusión; «huecos explotados» no es medible hoy.',
    'Cambiar precios, contenido o la web a partir de este informe es una decisión humana (L4).',
  ];
  if (sintetico) limitaciones.unshift('DATOS DE PRUEBA: fuentes, competidores y observaciones sintéticos; no existen.');
  if (!v.fuentes.length) limitaciones.push('No se aportó ninguna fuente válida: no hay nada que analizar.');
  const incidencias = H.filter((x) => ['dato_rechazado', 'terminos_de_uso_pendientes', 'fuente_caducada', 'contenido_anomalo', 'observacion_degradada'].includes(x.regla)).length;
  const informe = {
    esquema: ESQUEMA_INFORME_AGENTE, agente: '09', capacidad, version: '0.1.0', entorno: 'local',
    idEjecucion: `cp-${createHash('sha256').update(canonico({ modo, f: v.fuentes.map((f) => [f.id, f.observadaEn, f.terminosRevisados]), o: v.observaciones.map((o) => [o.id, o.clase, o.clave, o.precio]), c: [...cobertura].sort(), p: productos.map((p) => [p.id, p.price]) })).digest('hex').slice(0, 10)}`,
    generadoEn: new Date(Math.floor(ahora / 60000) * 60000).toISOString(), completo: v.fuentes.length > 0 && v.rechazos.length === 0 && excl === 0,
    fuente: { sistema: 'observaciones_aportadas', tabla: 'fuentes_citadas', host: null, registrosLeidos: v.observaciones.length + v.rechazos.filter((r) => r.ambito === 'observacion').length, origenDatos: sintetico ? 'datos_de_prueba' : 'exportacion', origenEjecucion: 'local', firma: sha256(canonico({ f: v.fuentes.map((f) => [f.id, f.url, f.observadaEn]), o: v.observaciones.map((o) => [o.id, o.texto]) })) },
    resumen: { estadoCalidad: v.fuentes.length && !v.rechazos.length && !excl ? 'completa' : 'incompleta', incidencias, porGravedad: { critica: 0, alta: 0, media: 0, baja: 0, info: 0 }, porCerteza: null, porPrioridad: null, elementosAfectados: excl + v.rechazos.length, elementosTotales: v.observaciones.length, fuentes: v.fuentes.length, fuentesUtilizables: v.fuentes.filter((f) => f.utilizable).length, observaciones: v.observaciones.length, hechosVerificados: cuenta('hecho_verificado'), observacionesNoVerificadas: cuenta('observacion'), estimaciones: cuenta('estimacion'), noDisponibles: cuenta('no_disponible'), observacionesExcluidas: excl, datosRechazados: v.rechazos.length, huecos, huecosSenalDebil: senales, brechasPrecio: brechas, preciosNoComparables: noComparables },
    hallazgos: H, seguimiento: null, persistencia: { escritura: 'no_procede' }, limitaciones, honestidad: { datosAusentesDeclarados: true },
  };
  return { informe, validacion: v };
}
