/**
 * Agente 00 · F1.2 · PROYECCIONES: estado derivado del ledger (tareas, aprobaciones, claves de idempotencia, parada de emergencia).
 * El estado de una entidad es el ÚLTIMO EVENTO VÁLIDO que la modifica; al reiniciar el Director se reconstruye todo desde el ledger
 * (nunca se «recuerda» un estado). PURO: recibe eventos y un «ahora» inyectado.
 * Un evento que no encaja (transición imposible, tarea inexistente) NO se aplica y se anota en `anomalias`: nada se descarta en silencio.
 */
import { esTerminal, transicionValida } from './protocolo.mjs';

const nuevaTarea = (ev) => {
  const s = ev.datos.sobre || {};
  return {
    idTarea: ev.refs.idTarea,
    idCorrelacion: ev.refs.idCorrelacion || s.idCorrelacion || null,
    idSolicitud: ev.refs.idSolicitud || null,
    agente: s.agente || null,
    capacidad: s.capacidad || null,
    capacidadVersion: ev.datos.capacidadVersion || null,
    registroVersion: ev.datos.registroVersion || null,
    nivel: ev.datos.nivel || null,
    prioridad: s.prioridad || null,
    profundidad: s.profundidad ?? 0,
    parametros: s.parametros || {},
    sobre: s,
    estado: 'creada',
    creadaEn: ev.instante,
    actualizadaEn: ev.instante,
    historial: [{ estado: 'creada', en: ev.instante, secuencia: ev.secuencia, detalle: null }],
    idAprobacion: null,
    huella: ev.datos.huella || null,
    claveIdempotencia: null,
    delegaciones: [],
    evidencias: [],
    verificaciones: [],
    respuesta: null,
    error: null,
    detalle: null,
  };
};

/** Reconstruye las proyecciones. `ahora` (ms) solo sirve para calcular la caducidad de aprobaciones pendientes. */
export function proyectar(eventos, { ahora = Date.now() } = {}) {
  const p = { tareas: new Map(), aprobaciones: new Map(), solicitudes: new Map(), claves: new Map(), paradaActiva: false, anomalias: [], secuencia: 0, ultimaParada: null };
  const anomalia = (ev, motivo) => p.anomalias.push({ secuencia: ev.secuencia, tipo: ev.tipo, motivo });
  const cambiar = (ev, idTarea, estado, detalle = null, error = null) => {
    const t = p.tareas.get(idTarea);
    if (!t) return anomalia(ev, `tarea ${idTarea} inexistente`);
    if (!transicionValida(t.estado, estado)) return anomalia(ev, `transición ${t.estado} → ${estado} no permitida`);
    t.estado = estado;
    t.actualizadaEn = ev.instante;
    t.detalle = detalle;
    if (error) t.error = error;
    t.historial.push({ estado, en: ev.instante, secuencia: ev.secuencia, detalle });
    return undefined;
  };
  for (const ev of eventos) {
    p.secuencia = ev.secuencia;
    const r = ev.refs || {};
    const d = ev.datos || {};
    switch (ev.tipo) {
      case 'solicitud':
        if (r.idSolicitud) p.solicitudes.set(r.idSolicitud, { idSolicitud: r.idSolicitud, idCorrelacion: r.idCorrelacion || null, canal: d.canal || null, texto: d.texto || '', en: ev.instante, intencion: null, mensajes: [] });
        break;
      case 'intencion': {
        const s = p.solicitudes.get(r.idSolicitud);
        if (s) s.intencion = d;
        else anomalia(ev, 'intención sin solicitud');
        break;
      }
      case 'mensaje_al_propietario': {
        const s = p.solicitudes.get(r.idSolicitud);
        if (s) s.mensajes.push({ en: ev.instante, categoria: d.categoria, texto: d.texto, afirmaciones: d.afirmaciones || [] });
        break;
      }
      case 'tarea_creada':
        if (!r.idTarea || p.tareas.has(r.idTarea)) anomalia(ev, 'tarea duplicada o sin id');
        else p.tareas.set(r.idTarea, nuevaTarea(ev));
        break;
      case 'tarea_estado':
        cambiar(ev, r.idTarea, d.estado, d.detalle ?? null, d.error ?? null);
        break;
      case 'tarea_cancelada':
        cambiar(ev, r.idTarea, 'cancelada', d.motivo ?? null, d.error ?? null);
        break;
      case 'aprobacion_solicitada': {
        const a = d.aprobacion;
        if (!a || !r.idAprobacion || p.aprobaciones.has(r.idAprobacion)) { anomalia(ev, 'aprobación duplicada o sin datos'); break; }
        p.aprobaciones.set(r.idAprobacion, { ...a, historial: [{ estado: 'pendiente', en: ev.instante }] });
        const t = p.tareas.get(r.idTarea);
        if (t) t.idAprobacion = r.idAprobacion;
        break;
      }
      case 'aprobacion_resuelta': {
        const a = p.aprobaciones.get(r.idAprobacion);
        if (!a) { anomalia(ev, 'resolución de una aprobación inexistente'); break; }
        const permitido = { pendiente: ['aprobada', 'rechazada', 'caducada', 'revocada'], aprobada: ['consumida', 'revocada'] };
        if (!(permitido[a.estado] || []).includes(d.estado)) { anomalia(ev, `aprobación ${a.estado} → ${d.estado} no permitida`); break; }
        a.estado = d.estado;
        a.resueltaEn = ev.instante;
        if (d.por) a.por = d.por;
        if (d.canal) a.canal = d.canal;
        if (d.motivo !== undefined) a.motivo = d.motivo;
        a.historial.push({ estado: d.estado, en: ev.instante });
        break;
      }
      case 'delegacion_enviada':
      case 'delegacion_simulada': {
        const t = p.tareas.get(r.idTarea);
        if (!t) { anomalia(ev, 'delegación de una tarea inexistente'); break; }
        t.delegaciones.push({ en: ev.instante, simulada: ev.tipo === 'delegacion_simulada', secuencia: ev.secuencia });
        if (d.claveIdempotencia) {
          t.claveIdempotencia = d.claveIdempotencia;
          if (p.claves.has(d.claveIdempotencia)) anomalia(ev, 'clave de idempotencia repetida en dos delegaciones');
          else p.claves.set(d.claveIdempotencia, r.idTarea);
        }
        break;
      }
      case 'respuesta_recibida': {
        const t = p.tareas.get(r.idTarea);
        if (t) t.respuesta = d;
        else anomalia(ev, 'respuesta de una tarea inexistente');
        break;
      }
      case 'evidencia': {
        const t = p.tareas.get(r.idTarea);
        if (t) t.evidencias.push({ idEvidencia: r.idEvidencia, ...d });
        else anomalia(ev, 'evidencia de una tarea inexistente');
        break;
      }
      case 'verificacion': {
        const t = p.tareas.get(r.idTarea);
        if (t) t.verificaciones.push({ idEvidencia: r.idEvidencia, ...d });
        else anomalia(ev, 'verificación de una tarea inexistente');
        break;
      }
      case 'parada_emergencia':
        p.paradaActiva = true;
        p.ultimaParada = { en: ev.instante, motivo: d.motivo || null, secuencia: ev.secuencia };
        break;
      case 'parada_levantada':
        p.paradaActiva = false;
        break;
      default:
        break; // tipos informativos (lectura_estado, error, consumo…) no cambian proyecciones de F1
    }
  }
  // Caducidad por reloj (no escribe nada: el Director registra la caducidad con un evento cuando la detecta).
  for (const a of p.aprobaciones.values()) {
    if (a.estado === 'pendiente' && ahora > Date.parse(a.caduca)) a.caducadaPorReloj = true;
  }
  return p;
}

// ── selectores ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const aprobacionVigente = (a, ahora) => a && a.estado === 'pendiente' && !(ahora > Date.parse(a.caduca));

/** Aprobación pendiente y vigente para la MISMA huella (A-02, capa 1: se reutiliza, no se crea otra). */
export function aprobacionPendientePorHuella(p, huella, ahora) {
  for (const a of p.aprobaciones.values()) if (a.huella === huella && aprobacionVigente(a, ahora)) return a;
  return null;
}

/** Tarea no terminal con la misma capacidad (A-02, capa 3: concurrencia = 1 por capacidad). */
export function tareaActivaDeCapacidad(p, capacidad) {
  for (const t of p.tareas.values()) if (t.capacidad === capacidad && !esTerminal(t.estado) && ['aceptada', 'en_curso'].includes(t.estado)) return t;
  return null;
}
export function tareaActivaConHuella(p, huella) {
  for (const t of p.tareas.values()) if (t.huella === huella && !esTerminal(t.estado)) return t;
  return null;
}

/** Delegaciones (enviadas o simuladas) de una capacidad desde un instante: base de los límites por capacidad (A-02, capa 4). */
export function delegacionesDe(p, capacidad, desdeMs = 0) {
  const lista = [];
  for (const t of p.tareas.values()) {
    if (t.capacidad !== capacidad) continue;
    for (const dg of t.delegaciones) if (Date.parse(dg.en) >= desdeMs) lista.push({ idTarea: t.idTarea, ...dg });
  }
  return lista.sort((a, b) => a.secuencia - b.secuencia);
}

/** Tareas ordenadas por prioridad (P1 primero) y luego por creación. */
export function listarTareas(p, { estado = null, activas = false } = {}) {
  return [...p.tareas.values()]
    .filter((t) => (estado ? t.estado === estado : true) && (activas ? !esTerminal(t.estado) : true))
    .sort((a, b) => String(a.prioridad).localeCompare(String(b.prioridad)) || a.idTarea.localeCompare(b.idTarea));
}
