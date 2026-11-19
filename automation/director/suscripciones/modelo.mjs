/**
 * Agente 00 / 13 · F1.5 · GESTIÓN DE SUSCRIPCIONES Y API DE IA: MODELO DE DATOS (PURO; sin red, sin disco, sin conexión con ningún proveedor).
 * Inventario configurable de proveedores, planes y suscripciones. Principios:
 *  · Cada dato lleva su PROCEDENCIA: `verificado` (con fuente y fecha), `estimado` o `no_disponible` (valor null). NUNCA se inventan tokens, saldos
 *    ni precios: lo que no consta se declara y se excluye de los cálculos.
 *  · Se distinguen cuatro modalidades: suscripción interactiva, herramienta oficial, créditos de API incluidos y API de pago por uso.
 *  · El inventario NO admite credenciales, cookies, sesiones ni tokens OAuth (solo el NOMBRE de la credencial): rechaza cualquier campo o valor que lo parezca.
 *  · Aquí no existe ninguna operación de contratar, cambiar de plan ni activar consumo: solo datos y validación.
 */
import { detectarSecreto } from '../ledger.mjs';

export const TIPOS_PLAN = Object.freeze(['suscripcion_interactiva', 'herramienta_oficial', 'creditos_api_incluidos', 'api_pago_por_uso']);
export const VERIFICACIONES = Object.freeze(['verificado', 'estimado', 'no_disponible']);
export const UNIDADES_CUOTA = Object.freeze(['mensajes', 'tokens', 'peticiones', 'eur']);
export const VENTANAS = Object.freeze(['5h', 'dia', 'semana', 'mes']);
export const PERMISOS_AUTOMATIZACION = Object.freeze(['si', 'no', 'desconocido']);

/** Categorías de tarea con un perfil de tokens TÍPICO (ESTIMACIÓN, configurable) y la calidad mínima exigible (1–5). */
export const CATEGORIAS_TAREA = Object.freeze({
  clasificacion_intencion: Object.freeze({ descripcion: 'Interpretar una instrucción corta en una intención estructurada', tokensEntrada: 900, tokensSalida: 150, calidadMinima: 2, volumenMensualDefecto: 600 }),
  resumen_informes: Object.freeze({ descripcion: 'Resumir informes de los agentes con fuentes', tokensEntrada: 4000, tokensSalida: 500, calidadMinima: 3, volumenMensualDefecto: 120 }),
  razonamiento_planificacion: Object.freeze({ descripcion: 'Razonar y planificar con varios agentes y restricciones', tokensEntrada: 3000, tokensSalida: 1200, calidadMinima: 4, volumenMensualDefecto: 40 }),
  redaccion_larga: Object.freeze({ descripcion: 'Redactar propuestas o textos largos', tokensEntrada: 1500, tokensSalida: 2500, calidadMinima: 4, volumenMensualDefecto: 30 }),
});

const CAMPOS_PROHIBIDOS = /(cookie|sesion|session|oauth|refresh|access_?token|bearer|password|contrasena|secret|api_?key|clave_?api|authorization)/i;
const esObjeto = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const esFecha = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s));

/** Dato con procedencia. `valor` null si no está disponible. */
export const dato = (valor, verificacion = 'no_disponible', { fuente = null, fecha = null } = {}) => ({ valor: verificacion === 'no_disponible' ? null : valor, verificacion, fuente, fecha });
export const esDatoUtil = (d) => esObjeto(d) && d.verificacion !== 'no_disponible' && d.valor !== null && d.valor !== undefined;

function validarDato(d, ruta, errores, { numerico = false } = {}) {
  if (!esObjeto(d)) { errores.push(`${ruta}: debe ser un dato con procedencia {valor, verificacion, fuente, fecha}`); return; }
  if (!VERIFICACIONES.includes(d.verificacion)) errores.push(`${ruta}: verificacion inválida`);
  if (d.verificacion === 'no_disponible' && d.valor !== null) errores.push(`${ruta}: un dato «no_disponible» debe tener valor null (no se inventan datos)`);
  if (d.verificacion === 'verificado' && (!d.fuente || !esFecha(d.fecha))) errores.push(`${ruta}: un dato «verificado» exige fuente y fecha`);
  if (d.verificacion !== 'no_disponible' && numerico && !(typeof d.valor === 'number' && Number.isFinite(d.valor) && d.valor >= 0)) errores.push(`${ruta}: debe ser un número ≥ 0`);
}

function buscarCamposProhibidos(obj, ruta, errores) {
  if (Array.isArray(obj)) return obj.forEach((x, i) => buscarCamposProhibidos(x, `${ruta}[${i}]`, errores));
  if (!esObjeto(obj)) return undefined;
  for (const [k, v] of Object.entries(obj)) {
    if (CAMPOS_PROHIBIDOS.test(k) && k !== 'credencial') errores.push(`${ruta}.${k}: el inventario no admite credenciales, cookies, sesiones ni tokens (solo el NOMBRE de la credencial en «credencial»)`);
    buscarCamposProhibidos(v, `${ruta}.${k}`, errores);
  }
  return undefined;
}

/** Valida el inventario. Devuelve { ok, errores[] }. No corrige nada. */
export function validarInventario(inv) {
  const errores = [];
  if (!esObjeto(inv)) return { ok: false, errores: ['El inventario no es un objeto.'] };
  if (inv.esquema !== 'inventario-ia/1') errores.push('esquema debe ser inventario-ia/1');
  if (!Array.isArray(inv.proveedores) || !Array.isArray(inv.planes)) return { ok: false, errores: [...errores, 'Faltan proveedores o planes'] };
  buscarCamposProhibidos(inv, '$', errores);
  const secreto = detectarSecreto(JSON.stringify(inv));
  if (secreto) errores.push(`el inventario contiene algo que parece una credencial (${secreto})`);
  const provs = new Set();
  for (const p of inv.proveedores) {
    if (!/^[a-z0-9-]{2,30}$/.test(p.id || '')) errores.push(`proveedor con id inválido (${p.id})`);
    if (provs.has(p.id)) errores.push(`proveedor ${p.id} duplicado`);
    provs.add(p.id);
  }
  const ids = new Set();
  for (const pl of inv.planes) {
    const r = `plan ${pl.id}`;
    if (!/^[a-z0-9-]{2,50}$/.test(pl.id || '')) errores.push(`${r}: id inválido`);
    if (ids.has(pl.id)) errores.push(`${r}: duplicado`);
    ids.add(pl.id);
    if (!provs.has(pl.proveedor)) errores.push(`${r}: proveedor inexistente`);
    if (!TIPOS_PLAN.includes(pl.tipo)) errores.push(`${r}: tipo inválido (${pl.tipo})`);
    validarDato(pl.costeFijoMensualEur, `${r}.costeFijoMensualEur`, errores, { numerico: true });
    validarDato(pl.creditosDisponiblesEur, `${r}.creditosDisponiblesEur`, errores, { numerico: true });
    validarDato(pl.renovacion, `${r}.renovacion`, errores);
    if (pl.renovacion && pl.renovacion.verificacion !== 'no_disponible' && !esFecha(pl.renovacion.valor)) errores.push(`${r}.renovacion: fecha inválida`);
    if (!esObjeto(pl.usoAutomatizado) || !PERMISOS_AUTOMATIZACION.includes(pl.usoAutomatizado.permitido)) errores.push(`${r}.usoAutomatizado.permitido inválido`);
    for (const c of pl.cuotas || []) {
      const rc = `${r}.cuota ${c.id}`;
      if (!UNIDADES_CUOTA.includes(c.unidad)) errores.push(`${rc}: unidad inválida`);
      if (!VENTANAS.includes(c.ventana)) errores.push(`${rc}: ventana inválida`);
      validarDato(c.limite, `${rc}.limite`, errores, { numerico: true });
      validarDato(c.usado, `${rc}.usado`, errores, { numerico: true });
    }
    for (const m of pl.modelos || []) {
      const rm = `${r}.modelo ${m.id}`;
      if (!Array.isArray(m.categorias) || m.categorias.some((c) => !CATEGORIAS_TAREA[c])) errores.push(`${rm}: categorías inválidas`);
      validarDato(m.tarifa && m.tarifa.entradaEurPor1M, `${rm}.tarifa.entradaEurPor1M`, errores, { numerico: true });
      validarDato(m.tarifa && m.tarifa.salidaEurPor1M, `${rm}.tarifa.salidaEurPor1M`, errores, { numerico: true });
      validarDato(m.calidad, `${rm}.calidad`, errores, { numerico: true });
      if (m.calidad && m.calidad.verificacion !== 'no_disponible' && !(m.calidad.valor >= 1 && m.calidad.valor <= 5)) errores.push(`${rm}.calidad: debe estar entre 1 y 5`);
      if (['suscripcion_interactiva', 'herramienta_oficial'].includes(pl.tipo)) errores.push(`${rm}: una suscripción o herramienta oficial no tiene tarifa por token que los agentes puedan consumir; no se le asignan modelos`);
    }
  }
  return { ok: errores.length === 0, errores };
}

/**
 * ¿Puede un agente AUTOMATIZADO usar esta modalidad? Criterio técnico y CONSERVADOR (no es asesoría legal; los términos vigentes de cada proveedor
 * los verifica el propietario). Devuelve { permitido: 'si'|'no'|'no_como_backend', motivo, requisitos[], terminosVerificados:false }.
 *  · API de pago por uso y créditos de API: sí, con clave API PROPIA y dedicada, presupuesto y límites;
 *  · herramienta oficial: solo uso interactivo con la propia herramienta; NO como backend de los agentes;
 *  · suscripción interactiva: no; nunca se reutilizan cookies, sesiones ni tokens OAuth privados para eludir restricciones.
 * Si el plan declara algo más permisivo que su modalidad, se ignora y se avisa; si declara algo más restrictivo, manda lo restrictivo.
 */
export function elegibilidadAutomatizacion(plan) {
  const base = {
    api_pago_por_uso: { permitido: 'si', motivo: 'Acceso por API con clave propia y dedicada', requisitos: ['clave API propia (por nombre, nunca su valor)', 'presupuesto y topes (D9)', 'consumo real activado y autorizado por el propietario'] },
    creditos_api_incluidos: { permitido: 'si', motivo: 'Créditos consumibles por API con clave propia', requisitos: ['clave API propia', 'consumir solo créditos verificados', 'autorización del propietario'] },
    herramienta_oficial: { permitido: 'no_como_backend', motivo: 'La herramienta oficial es para uso interactivo de una persona; no puede ser el motor de agentes automáticos ni reutilizarse su sesión', requisitos: [] },
    suscripcion_interactiva: { permitido: 'no', motivo: 'Una suscripción interactiva es para uso personal en la interfaz del proveedor; no se automatiza ni se reutilizan cookies, sesiones o tokens OAuth', requisitos: [] },
  }[plan.tipo] || { permitido: 'no', motivo: 'Modalidad desconocida', requisitos: [] };
  const avisos = [];
  const declarado = plan.usoAutomatizado && plan.usoAutomatizado.permitido;
  if (declarado === 'si' && base.permitido !== 'si') avisos.push(`El plan declara uso automatizado «si», pero su modalidad (${plan.tipo}) no lo permite: se ignora; no se presume permiso.`);
  let permitido = base.permitido;
  if (declarado === 'no' && permitido === 'si') { permitido = 'no'; avisos.push('El plan declara que NO se puede automatizar: manda lo restrictivo.'); }
  if (declarado === 'desconocido' && permitido === 'si') avisos.push('Los términos de uso automatizado de este plan no están verificados: confírmalos antes de activarlo.');
  return { permitido, motivo: base.motivo, requisitos: base.requisitos, avisos, terminosVerificados: false };
}
