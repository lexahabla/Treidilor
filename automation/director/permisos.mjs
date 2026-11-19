/**
 * Agente 00 · F1.1 · MATRIZ DE PERMISOS L0–L4 y APROBACIONES (PURO; el modelo de lenguaje no interviene: el autorizador es código determinista).
 * Implementa automation/docs/MATRIZ-PERMISOS.md con los valores iniciales aprobados (A-03 provisional, A-04) como configuración.
 * En F1 las aprobaciones L2–L4 son SIMULADAS: se valida todo el flujo, pero no se envía nada a ningún agente.
 */
import { NIVELES, crearError } from './protocolo.mjs';

/** Valores iniciales CONFIGURABLES: no los cambia el modelo ni el agente; se cambian por versión con aprobación y constancia. */
export const CONFIG_APROBACIONES = Object.freeze({
  caducidadMin: Object.freeze({ L2: 15, L3: 10, L4: 5 }), // A-03 (provisional)
  reautenticacionL3Min: 30, // A-04: L3 exige reautenticar si la última autenticación fue hace más
  reautenticacionL4Min: 5, // A-04: L4 exige autenticación ≤ 5 min antes de confirmar
  renovacionesMax: 2, // A-03: renovación con contenido idéntico y nueva reautenticación
  sesion: Object.freeze({ inactividadMin: 30, maxHoras: 8 }), // A-04 (interfaz)
  avisoRepeticionMin: 10, // A-02 (aviso informativo, no bloquea)
  profundidadMaxima: 2,
});

export const nivelIndice = (n) => NIVELES.indexOf(n);
export const requiereAprobacion = (nivel) => nivelIndice(nivel) >= 2;

/**
 * Regla de asignación de la matriz (§2; de arriba abajo, gana el primero que se cumple; en la duda, el más alto).
 * `a`: { tocaPublicoCatalogoPreciosDineroAccesosOIrreversible, creaOCambiaAlgo, lanzaEjecucionConsumeOEscribeRegistro, generaPropuesta }
 */
export function asignarNivel(a = {}) {
  if (a.tocaPublicoCatalogoPreciosDineroAccesosOIrreversible) return 'L4';
  if (a.creaOCambiaAlgo) return 'L3';
  if (a.lanzaEjecucionConsumeOEscribeRegistro) return 'L2';
  if (a.generaPropuesta) return 'L1';
  return 'L0';
}

/** El nivel solo puede SUBIR (más cautela), nunca bajar. */
export function elevarNivel(fijado, solicitado) {
  return nivelIndice(solicitado) > nivelIndice(fijado) ? solicitado : fijado;
}

/** Nivel de un plan = el máximo de sus pasos (cada paso se aprueba por separado). */
export function nivelDePlan(niveles) {
  return niveles.reduce((m, n) => (nivelIndice(n) > nivelIndice(m) ? n : m), 'L0');
}

/** ¿Este canal puede CONFIRMAR una acción de este nivel? La voz y la mensajería externa nunca confirman L2–L4 (MATRIZ §3 y §5). */
export function canalPuedeConfirmar(nivel, canal) {
  if (!requiereAprobacion(nivel)) return true;
  return canal === 'interfaz' || canal === 'simulado';
}

/** Voz: ¿puede SOLICITAR la acción? Sí (solicitar y resumir); confirmar solo en la interfaz autenticada. */
export function canalPuedeSolicitar(canal) {
  return ['texto', 'voz', 'panel', 'consola', 'interfaz', 'simulado'].includes(canal);
}

/** Solicitud de aprobación `aprobacion/1`; el reloj de la caducidad empieza al MOSTRAR la solicitud. */
export function crearSolicitudAprobacion({ idAprobacion, idTarea, capacidad, nivel, huella, resumen, impacto = null, coste = null, ahora, config = CONFIG_APROBACIONES, canal = 'consola', solicitadaPor = 'director', simulada = false }) {
  if (!requiereAprobacion(nivel)) throw new Error('nivel_sin_aprobacion');
  const min = config.caducidadMin[nivel];
  return {
    esquema: 'aprobacion/1',
    idAprobacion,
    idTarea,
    capacidad,
    nivel,
    huella,
    resumen: String(resumen),
    impacto,
    coste,
    solicitadaEn: new Date(ahora).toISOString(),
    caduca: new Date(ahora + min * 60000).toISOString(),
    canal,
    solicitadaPor,
    estado: 'pendiente',
    simulada: Boolean(simulada),
    renovaciones: 0,
  };
}

/**
 * Resuelve una aprobación (solo la decide el propietario autenticado). Devuelve `{ ok, aprobacion }` o `{ ok:false, error, estadoNuevo? }`.
 * `ctx`: { decision:'aprobada'|'rechazada', por, canal, ahora, ultimaAutenticacion, reautenticadoEn, motivo? }
 *  · sin respuesta a tiempo = `caducada` (nunca aprobación por silencio);
 *  · L3 > 30 min desde la última autenticación → reautenticación; L4 → autenticación ≤ 5 min antes de confirmar (A-04);
 *  · la voz y la mensajería externa no confirman L2–L4.
 */
export function resolverAprobacion(aprobacion, ctx, config = CONFIG_APROBACIONES) {
  const { decision, por, canal, ahora, ultimaAutenticacion = null, reautenticadoEn = null, motivo = null } = ctx;
  if (aprobacion.estado !== 'pendiente') return { ok: false, error: crearError('aprobacion_no_coincide', `La aprobación ya está «${aprobacion.estado}»; una aprobación = una ejecución.`) };
  if (ahora > Date.parse(aprobacion.caduca)) return { ok: false, estadoNuevo: 'caducada', error: crearError('aprobacion_caducada', 'La aprobación ha caducado; se necesita una nueva.') };
  if (por !== 'propietario') return { ok: false, error: crearError('permiso_denegado', 'Solo el propietario autenticado puede resolver una aprobación.') };
  if (decision === 'rechazada') {
    return { ok: true, aprobacion: { ...aprobacion, estado: 'rechazada', resueltaEn: new Date(ahora).toISOString(), por, canal, motivo } };
  }
  if (decision !== 'aprobada') return { ok: false, error: crearError('solicitud_invalida', 'La decisión debe ser «aprobada» o «rechazada».') };
  if (!canalPuedeConfirmar(aprobacion.nivel, canal)) return { ok: false, error: crearError('canal_no_permitido', `El canal «${canal}» no puede confirmar acciones ${aprobacion.nivel}: se confirma en la interfaz autenticada.`) };
  if (aprobacion.nivel === 'L3') {
    const edad = ultimaAutenticacion === null ? Infinity : (ahora - ultimaAutenticacion) / 60000;
    if (edad > config.reautenticacionL3Min && !(reautenticadoEn !== null && (ahora - reautenticadoEn) / 60000 <= config.reautenticacionL4Min)) {
      return { ok: false, error: crearError('reautenticacion_requerida', `La última autenticación fue hace más de ${config.reautenticacionL3Min} min: reautentica para confirmar.`) };
    }
  }
  if (aprobacion.nivel === 'L4') {
    const edad = reautenticadoEn === null ? Infinity : (ahora - reautenticadoEn) / 60000;
    if (!(edad >= 0 && edad <= config.reautenticacionL4Min)) return { ok: false, error: crearError('reautenticacion_requerida', `L4 exige autenticación de hace como máximo ${config.reautenticacionL4Min} min.`) };
  }
  return { ok: true, aprobacion: { ...aprobacion, estado: 'aprobada', resueltaEn: new Date(ahora).toISOString(), por, canal, motivo } };
}

/** Renovación: ≤ 2 veces, contenido idéntico (misma huella) y nueva reautenticación; reinicia el reloj. */
export function renovarAprobacion(aprobacion, { huella, ahora, reautenticadoEn = null }, config = CONFIG_APROBACIONES) {
  if (aprobacion.estado !== 'pendiente' && aprobacion.estado !== 'caducada') return { ok: false, error: crearError('aprobacion_no_coincide', 'Solo se renueva una aprobación pendiente o caducada.') };
  if (aprobacion.renovaciones >= config.renovacionesMax) return { ok: false, error: crearError('limite_alcanzado', `Máximo ${config.renovacionesMax} renovaciones: crea una solicitud nueva.`) };
  if (huella !== aprobacion.huella) return { ok: false, error: crearError('aprobacion_no_coincide', 'El contenido cambió: no se puede renovar, hay que solicitar otra aprobación.') };
  if (reautenticadoEn === null || (ahora - reautenticadoEn) / 60000 > config.reautenticacionL4Min) return { ok: false, error: crearError('reautenticacion_requerida', 'La renovación exige una nueva reautenticación.') };
  return { ok: true, aprobacion: { ...aprobacion, estado: 'pendiente', renovaciones: aprobacion.renovaciones + 1, caduca: new Date(ahora + config.caducidadMin[aprobacion.nivel] * 60000).toISOString() } };
}

/** Texto literal mostrado al propietario antes de aprobar (qué se lanza, coste/cuota/carga, límites, plazo). */
export function resumenParaAprobar(cap, parametros) {
  const l = cap.limites || {};
  const partes = [`Se lanzaría «${cap.id}» (${cap.nivelRiesgo}): ${cap.descripcion}.`];
  if (parametros && Object.keys(parametros).length) partes.push(`Parámetros: ${JSON.stringify(parametros)}.`);
  if (cap.costeEstimado) partes.push(`Coste estimado: ${cap.costeEstimado.llamadasApi ?? 0} llamadas a la API, ${cap.costeEstimado.ia ?? 0} de IA.`);
  const lim = [];
  if (l.maxPorDia) lim.push(`≤ ${l.maxPorDia} al día`);
  if (l.intervaloMinimoSeg) lim.push(`≥ ${l.intervaloMinimoSeg} s entre ejecuciones`);
  if (l.concurrencia) lim.push(`concurrencia ${l.concurrencia}`);
  if (l.maxPaginas) lim.push(`≤ ${l.maxPaginas} páginas`);
  if (lim.length) partes.push(`Límites: ${lim.join(', ')}.`);
  partes.push(`Plazo máximo: ${Math.round(cap.plazoMs / 1000)} s. Efectos: ${cap.efectos}.`);
  return partes.join(' ');
}
