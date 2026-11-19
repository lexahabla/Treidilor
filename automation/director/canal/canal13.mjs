/**
 * Agente 13 · CANAL CONVERSACIONAL del Agente 00 (D1 aprobada: el 13 es el canal, «sin lógica propia»; ficha `automation/agents/13-asistente-ia.md`).
 * Este módulo NO interpreta, NO decide permisos, NO ejecuta acciones de otros agentes y NO tiene memoria propia: recibe el texto del propietario, lo entrega al Director
 * (su cerebro, su registro, su ledger, sus permisos) y PRESENTA lo que el Director responde en un mensaje estructurado y comprensible (`mensaje-canal/1`): qué consta, de qué
 * naturaleza son los datos (real registrado, simulado, estimado, no disponible), qué autorización se pide y cómo confirmarla, qué alternativas y consecuencias hay y qué no
 * se puede comprobar. Lo único que recuerda es la ÚLTIMA respuesta, en memoria y sin persistir, para poder explicarla («¿qué alternativas tengo?»).
 * Consumo y suscripciones: se leen del Director (`consumoIA`, `informeSuscripciones`: las métricas y el inventario de F1.5); aquí no se contabiliza nada.
 * Seguridad: el canal nunca se hace pasar por la interfaz autenticada (solo la reenvía si el anfitrión la declara); texto y voz nunca confirman L2–L4 (lo impone el Director);
 * el texto del propietario no se repite en las respuestas; un intento de saltarse permisos lo clasifica el Director (`cambio_nivel`) y el canal lo explica.
 */
import { ErrorProtocolo } from '../protocolo.mjs';
import { ErrorLedger } from '../ledger.mjs';
import { detectarInstruccionesEnDatos } from '../saneado.mjs';
import { VozDesactivada } from './voz.mjs';

export const ESQUEMA_MENSAJE = 'mensaje-canal/1';
export const LIMITE_ENTRADA = 2000;
const CANALES_DE_ENTRADA = new Set(['texto', 'voz']);
const TIPOS_DE_CONTROL = {
  cambio_nivel: 'Intento de cambiar niveles, saltarse permisos, confirmaciones o el registro: no se puede; los permisos los decide el Agente 00 y las confirmaciones las das tú en la interfaz.',
  pide_credencial: 'Petición de una credencial: nunca se revelan ni se piden.',
  accion_humana: 'Acción sobre el sistema (nivel L4): la hace una persona en el panel; ningún agente ni este canal la ejecuta.',
  ejecucion_autonoma: 'Ejecución autónoma o programada: no está autorizada.',
  accion_ambigua: 'Instrucción ambigua que podría tener efectos: no se actúa sin precisarla.',
  confirmacion_vaga: 'Confirmación sin una acción concreta: no sirve para aprobar nada.',
};
const EFECTOS = {
  ninguno: 'No cambia nada: solo lee o propone.',
  lectura_con_carga: 'Solo lee, pero consume capacidad (cuota o carga) del sistema consultado.',
  escritura_reversible: 'Escribe, pero se puede deshacer.',
};
const REVERSIBLES = new Set(['ninguno', 'lectura_con_carga', 'escritura_reversible']);
const HUMANO = new Set(['accion_humana', 'ejecucion_autonoma']);

const sinControl = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ');
const plano = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const eur = (n) => `${Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} €`;
const corta = (t, n) => { const x = String(t).replace(/\s+/g, ' ').trim(); return x.length <= n ? x : `${x.slice(0, n - 1).replace(/[\s,.;:–—-]+$/, '')}…`; };

/** Texto hablable: sin ids, huellas ni marcas; breve. */
export function textoParaVoz(texto, max = 400) {
  const limpio = String(texto)
    .replace(/sha256:[0-9a-f]{8,64}/g, '').replace(/\b(?:[a-z]{1,3}-[0-9a-z]{6,}|[0-9a-f]{12,})\b/gi, '')
    .replace(/\[[^\]]*\]/g, '').replace(/[·─│•⚠‼ℹ]/g, ' ').replace(/\s+/g, ' ').trim();
  const frases = limpio.split(/(?<=[.!?])\s+/);
  let out = '';
  for (const f of frases) { if ((`${out} ${f}`).trim().length > max) break; out = `${out} ${f}`.trim(); }
  return out || corta(limpio, max);
}

export class Canal13 {
  /**
   * @param {{director: object, canal?: 'texto'|'voz', voz?: object, reloj?: ()=>number}} o   `director` = instancia del Director (Agente 00).
   */
  constructor({ director, canal = 'texto', voz = null, reloj = null } = {}) {
    if (!director || typeof director.procesarSolicitudAsync !== 'function') throw new ErrorProtocolo('solicitud_invalida', 'El canal necesita un Director (Agente 00): no tiene lógica propia.');
    if (!CANALES_DE_ENTRADA.has(canal)) throw new ErrorProtocolo('solicitud_invalida', 'Canal de entrada no válido (texto o voz).');
    this.director = director;
    this.canal = canal;
    this.voz = voz || new VozDesactivada();
    this.reloj = reloj || (() => director.ahora());
    this._n = 0;
    this._ultimo = null; // solo la última respuesta, en memoria: NO es un sistema de memoria
  }

  // ── recepción: instrucciones del propietario → Director ─────────────────────────────────────────────────────────────────────────────────────────────
  /** Recibe una instrucción (texto, o transcripción de voz con `confianza`) y la entrega al Director. Devuelve un `mensaje-canal/1`. */
  async recibir(texto, { canal = this.canal, confianza = null } = {}) {
    if (typeof texto !== 'string') return this._cerrar(this._rechazo('entrada_no_valida', 'La instrucción debe ser un texto.'));
    const limpio = sinControl(texto).trim();
    if (!limpio) return this._cerrar(this._rechazo('entrada_vacia', 'La instrucción está vacía: no he hecho nada.'));
    if (limpio.length > LIMITE_ENTRADA) return this._cerrar(this._rechazo('entrada_demasiado_larga', `La instrucción supera ${LIMITE_ENTRADA} caracteres: no la he enviado al Director. Resúmela o divídela.`));
    if (!CANALES_DE_ENTRADA.has(canal)) return this._cerrar(this._rechazo('canal_no_valido', 'Solo se aceptan instrucciones por texto o por voz; este canal nunca se hace pasar por la interfaz autenticada.'));
    if (canal === 'voz' && !this.voz.habilitada) return this._cerrar(this._rechazo('voz_desactivada', 'La voz está desactivada: planificada para F4, sin proveedor ni servicio contratado. Escríbeme la instrucción.'));
    const local = this._seguimiento(limpio);
    if (local) return local;
    const sospechas = detectarInstruccionesEnDatos([{ origen: 'propietario', texto: limpio }]);
    let res;
    try {
      res = await this.director.procesarSolicitudAsync(limpio, { canal, confianza });
    } catch (e) {
      if (e instanceof ErrorProtocolo || e instanceof ErrorLedger) return this._cerrar(this._fallo(e));
      throw e;
    }
    return this._cerrar(this.presentar(res, { entradaChars: limpio.length, canal, sospechas }));
  }

  /** Entrada de voz YA transcrita (el servicio de voz no existe todavía; un adaptador futuro la producirá). Rechazada mientras la voz esté desactivada. */
  async recibirTranscripcion({ transcripcion, confianza = null }) { return this.recibir(transcripcion, { canal: 'voz', confianza }); }

  // ── respuestas del propio canal sobre la última respuesta del Director (sin llamar al Director) ──────────────────────────────────────────────────────────────
  _seguimiento(limpio) {
    const t = plano(limpio).replace(/^[¿¡\s]+/, '').replace(/[?!.\s]+$/, '');
    if (t.length > 80 || /\b(ia|api|suscripci|plan|presupuesto|token|credito)/.test(t)) return null;
    let tema = null;
    if (/^(explica\w*|resume\w*|en pocas palabras|que significa( eso)?|no entiendo)\b/.test(t)) tema = 'resumen';
    else if (/^(que |cuales )?alternativas\b/.test(t)) tema = 'alternativas';
    else if (/^(que |cuales )?consecuencias\b|^que pasa si (apruebo|rechazo|no (hago|apruebo|decido))/.test(t)) tema = 'consecuencias';
    else if (/^(que )?limitaciones\b|^que no (sabes|puedes comprobar)/.test(t)) tema = 'limitaciones';
    if (!tema) return null;
    return this.explicar(tema); // una explicación no sustituye a la respuesta que explica
  }

  /** Explica en lenguaje claro la ÚLTIMA respuesta del Director: `resumen` | `alternativas` | `consecuencias` | `limitaciones`. Sin respuesta previa: «no puedo comprobarlo». */
  explicar(tema = 'resumen') {
    const u = this._ultimo;
    const base = this._base('explicacion');
    if (!u) return { ...base, categoria: 'consulta', estado: 'sin_datos', textoClaro: 'No tengo ninguna respuesta previa que explicar: no puedo comprobarlo. Pídeme algo primero.', detalle: '', tema };
    const cuerpo = {
      resumen: `En pocas palabras: ${u.textoClaro}${u.solicitudesAutorizacion.length ? ` Hay ${u.solicitudesAutorizacion.length} autorización(es) pendiente(s); nada se ejecuta hasta que la confirmes en la interfaz.` : ''}`,
      alternativas: u.alternativas.length ? `Alternativas:\n${u.alternativas.map((a) => `· ${a.texto}`).join('\n')}` : 'No hay alternativas que ofrecer sobre esa respuesta.',
      consecuencias: u.consecuencias.length ? `Consecuencias:\n${u.consecuencias.map((c) => `· ${c}`).join('\n')}` : 'Esa respuesta no tiene consecuencias: no cambia nada.',
      limitaciones: u.limitaciones.length ? `Qué no se puede afirmar:\n${u.limitaciones.map((c) => `· ${c}`).join('\n')}` : 'El Director no declaró limitaciones para esa respuesta (eso no garantiza que no existan).',
    }[tema] || 'Tema no reconocido.';
    return { ...base, categoria: 'consulta', estado: 'respondida', textoClaro: cuerpo, detalle: '', tema, naturalezaDatos: u.naturalezaDatos, tareas: u.tareas, solicitudesAutorizacion: u.solicitudesAutorizacion, alternativas: tema === 'alternativas' ? u.alternativas : [], consecuencias: u.consecuencias, limitaciones: u.limitaciones, resumenHablado: textoParaVoz(cuerpo) };
  }

  // ── estado de agentes, tareas y autorizaciones ──────────────────────────────────────────────────────────────────────────────────────────────────────
  /** Estado actual: agentes (con el origen de su estado), tareas y autorizaciones pendientes. Si el ledger no se puede leer, lo dice y no inventa tareas. */
  estado() {
    const base = this._base('estado');
    const agentes = this.director.estadoAgentes().map((a) => ({ id: a.id, nombre: a.nombre, estado: a.estado, origenEstado: a.origenEstado, capacidades: a.capacidades.map((c) => ({ id: c.id, nivel: c.nivel, disponibilidad: c.disponibilidad })) }));
    const porEstado = {};
    for (const a of agentes) porEstado[a.estado] = (porEstado[a.estado] || 0) + 1;
    let tareas = null; let autorizaciones = null; let parada = null; let motivoLedger = null;
    try {
      tareas = this.director.listarTareas({}).map((t) => ({ idTarea: t.idTarea, capacidad: t.capacidad, estado: t.estado, nivel: t.nivel, detalle: t.detalle ?? null }));
      autorizaciones = this.director.listarAprobaciones().map((a) => this.presentarSolicitud(a));
      parada = this.director.paradaActiva();
    } catch (e) {
      if (!(e instanceof ErrorProtocolo || e instanceof ErrorLedger)) throw e;
      motivoLedger = e.error ? e.error.mensaje : e.message;
    }
    const l = [];
    l.push(`Hay ${agentes.length} agentes en el registro: ${Object.entries(porEstado).map(([k, v]) => `${v} ${k.replace('_', ' ')}`).join(', ')}. «construido local» = existe en este ordenador, sin desplegar; «operativo» consta como comunicado por ti y nadie lo ha verificado.`);
    if (tareas === null) l.push(`No puedo comprobar las tareas ni las autorizaciones: el ledger no está disponible (${motivoLedger}). No te doy ninguna lista porque no la he podido comprobar.`);
    else {
      const activas = tareas.filter((t) => !['completada', 'fallida', 'rechazada', 'cancelada', 'expirada'].includes(t.estado));
      l.push(`Tareas: ${tareas.length} en total, ${activas.length} activas.${parada ? ' PARADA DE EMERGENCIA ACTIVA: no se crean tareas nuevas.' : ''}`);
      l.push(autorizaciones.length ? `Autorizaciones pendientes: ${autorizaciones.length} (se confirman solo en la interfaz autenticada).` : 'No hay autorizaciones pendientes y vigentes.');
    }
    return { ...base, categoria: 'consulta', estado: tareas === null ? 'parcial' : 'respondida', textoClaro: l.join('\n'), detalle: '', agentes, tareas: tareas ?? [], autorizacionesPendientes: autorizaciones ?? [], paradaActiva: parada, ledgerDisponible: tareas !== null,
      naturalezaDatos: [{ etiqueta: 'documentado', detalle: 'Agentes y capacidades: registro de capacidades (el origen de cada estado va en `origenEstado`).' }, tareas === null ? { etiqueta: 'no_disponible', detalle: 'Tareas y autorizaciones: ledger no disponible.' } : { etiqueta: 'real_registrado', detalle: 'Tareas y autorizaciones: leídas del ledger.' }],
      resumenHablado: textoParaVoz(l.join(' ')) };
  }

  // ── consumo, presupuestos, costes y suscripciones de IA (F1.5; no se duplica la contabilidad) ──────────────────────────────────────────────────────────────
  /** Consumo de IA del Director desde su ledger: lo REAL (gasto registrado) separado de lo SIMULADO (llamadas de prueba a coste 0). */
  consumo() {
    const base = this._base('consumo');
    let r;
    try { r = this.director.consumoIA(); } catch (e) {
      if (!(e instanceof ErrorProtocolo || e instanceof ErrorLedger)) throw e;
      return { ...base, categoria: 'consulta', estado: 'sin_datos', textoClaro: 'No puedo comprobar el consumo de IA: el ledger no está disponible. No te doy ninguna cifra.', detalle: '', naturalezaDatos: [{ etiqueta: 'no_disponible', detalle: 'ledger no disponible' }] };
    }
    const T = r.tokens;
    const l = [];
    l.push(`Consumo REAL de IA: ${r.consumoRealActivado ? 'ACTIVADO' : 'DESACTIVADO (por defecto); no se ha gastado nada real'}. Hoy ${eur(r.diaEur)} de ${eur(r.topeDiarioEur)}; mes ${eur(r.mesEur)} de ${eur(r.topeMensualEur)}.`);
    l.push(`Llamadas registradas: ${r.llamadasRegistradas} (${T.simulados.llamadas} simuladas a coste 0 y ${T.reales.llamadas} reales).`);
    l.push(`Tokens: ${T.simulados.entrada + T.simulados.salida} simulados (estimación de prueba, sin facturación) y ${T.reales.entrada + T.reales.salida} reales registrados.`);
    if (!r.consumoRealActivado) l.push('Ningún gasto está autorizado; activar el consumo real o subir los topes es una acción tuya (L4), no mía.');
    return { ...base, categoria: 'consulta', estado: 'respondida', textoClaro: l.join('\n'), detalle: '', consumo: { real: { activado: r.consumoRealActivado, hoyEur: r.diaEur, mesEur: r.mesEur, topeDiarioEur: r.topeDiarioEur, topeMensualEur: r.topeMensualEur, tokens: T.reales }, simulado: { llamadas: T.simulados.llamadas, tokens: T.simulados }, estado: r.estado, porProveedor: T.porProveedor },
      naturalezaDatos: [{ etiqueta: 'real_registrado', detalle: 'Gasto real: el que consta en el ledger (cero si el consumo real está desactivado).' }, { etiqueta: 'simulado', detalle: 'Llamadas y tokens del proveedor simulado: no son consumo real.' }, { etiqueta: 'no_disponible', detalle: 'Saldos y facturación de los proveedores: no se leen de ningún servicio externo.' }],
      limitaciones: ['Los tokens de las llamadas simuladas son una estimación de la longitud del texto; no hay medición de ningún proveedor.', 'No consta ningún saldo ni factura real: no se consultan servicios externos.'], resumenHablado: textoParaVoz(l.join(' ')) };
  }

  /** Suscripciones, planes y API de IA (informe del Agente 13 de F1.5) con el desglose de qué datos son verificados, estimados o no disponibles. Nunca contrata ni cambia nada. */
  suscripciones({ recomendar = false } = {}) {
    const res = this.director.informeSuscripciones(recomendar);
    const m = this.presentar(res, { canal: this.canal });
    const inv = this.director.inventarioIA;
    if (inv && Array.isArray(inv.planes)) {
      const c = { verificado: 0, estimado: 0, no_disponible: 0 };
      for (const p of inv.planes) for (const d of [p.costeFijoMensualEur, p.creditosDisponiblesEur, p.renovacion]) if (d && c[d.verificacion] !== undefined) c[d.verificacion] += 1;
      m.naturalezaDatos = [inv.sintetico ? { etiqueta: 'simulado', detalle: 'Inventario SIMULADO: no son tus suscripciones ni tus saldos reales.' } : { etiqueta: 'inventario_aportado', detalle: 'Inventario aportado por el propietario.' }, { etiqueta: 'verificacion_por_dato', detalle: `Datos del inventario: ${c.verificado} verificados, ${c.estimado} estimados, ${c.no_disponible} no disponibles.`, ...c }];
    }
    m.consecuencias = ['Nada cambia: este informe no contrata, no cambia de plan ni toca presupuestos.', 'Cambiar presupuestos, proveedores o planes es una decisión tuya (L4); el Director no la toma solo.'];
    return this._cerrar(m);
  }

  /** Recomendaciones de optimización de recursos de IA (sin cambiar presupuestos ni proveedores). */
  optimizar() {
    const m = this.suscripciones({ recomendar: true });
    m.alternativas = [{ id: 'mantener', texto: 'Mantener el uso actual: no cambia nada.' }, { id: 'aplicar_tu', texto: 'Aplicar una recomendación tú mismo en el panel o con el proveedor (acción L4): este canal no cambia presupuestos ni proveedores.' }, { id: 'pedir_mas', texto: 'Pedir más detalle de una tarea o de un plan antes de decidir.' }];
    return this._cerrar(m);
  }

  // ── autorizaciones ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  /** Presenta una autorización pendiente con lo que necesitas para decidir: qué es, qué efectos tiene, si se deshace, cuánto cuesta, cuándo caduca y cómo se confirma. */
  presentarSolicitud(a) {
    const info = a.capacidadInfo || {};
    const reversible = info.efectos ? REVERSIBLES.has(info.efectos) : null;
    const caduca = a.minutosRestantes !== undefined ? `Caduca en ${a.minutosRestantes} min (sin respuesta = caducada, nunca aprobada).` : `Caduca el ${a.caduca}.`;
    return {
      idAprobacion: a.idAprobacion, idTarea: a.idTarea, capacidad: a.capacidad, agente: info.agente ?? null, nivel: a.nivel, estado: a.estado, simulada: Boolean(a.simulada),
      que: a.resumen, descripcion: info.descripcion ?? null, efectos: info.efectos ? (EFECTOS[info.efectos] || `Efecto declarado en el registro: ${info.efectos}.`) : 'El registro no declara el efecto: no puedo afirmarlo.',
      reversible, costeEstimado: info.costeEstimado ?? null, caduca: a.caduca, minutosRestantes: a.minutosRestantes ?? null, huellaCorta: String(a.huella || '').replace('sha256:', '').slice(0, 12),
      comoConfirmar: 'Solo en la interfaz autenticada, con botón y ligada a esta huella. Ni por texto ni por voz se puede confirmar una acción L2 o superior.',
      alternativas: [
        { id: 'aprobar', texto: 'Aprobar en la interfaz autenticada.', requiere: 'interfaz_autenticada' },
        { id: 'rechazar', texto: 'Rechazar: la tarea queda rechazada y no se ejecuta nada.', requiere: 'cualquier_canal' },
        { id: 'esperar', texto: `No decidir: ${caduca}`, requiere: null },
        { id: 'pedir_mas_informacion', texto: 'Pedirme más detalle (huella, alcance, tarea) antes de decidir.', requiere: null },
      ],
      consecuencias: [
        `Si apruebas: se ejecuta solo lo descrito (${a.resumen ? corta(a.resumen, 160) : 'sin descripción'}) con nivel ${a.nivel}; la aprobación vale una sola vez.`,
        'Si rechazas o la dejas caducar: no se ejecuta nada y no se cambia ningún dato.',
        ...(a.simulada ? ['La aprobación es SIMULADA (F1): al aprobar no se envía nada a ningún agente real; solo se ejecuta, si procede, la parte local simulada.'] : []),
        ...(reversible === false ? ['El registro indica un efecto NO reversible: léelo con especial cuidado.'] : []),
      ],
    };
  }

  /**
   * Reenvía al Director la decisión del propietario sobre una autorización. El canal NO decide ni se hace pasar por la interfaz: solo si el anfitrión (la interfaz real, autenticada)
   * declara `autenticado: true` se usa el canal «interfaz»; si no, se envía como texto/voz y el Director rechaza confirmar L2–L4 (rechazar sí se admite).
   */
  decidir(idAprobacion, decision, { autenticado = false, reautenticadoEn = null, motivo = null } = {}) {
    const base = this._base('decision');
    if (!['aprobada', 'rechazada'].includes(decision)) return this._cerrar({ ...base, categoria: 'consulta', estado: 'rechazada', textoClaro: 'La decisión debe ser «aprobada» o «rechazada».', detalle: '' });
    const canal = autenticado === true ? 'interfaz' : this.canal;
    let r;
    try {
      r = this.director.resolverAprobacion(idAprobacion, decision, { canal, ultimaAutenticacion: autenticado === true ? this.reloj() : null, reautenticadoEn, motivo });
    } catch (e) {
      if (e instanceof ErrorProtocolo || e instanceof ErrorLedger) return this._cerrar(this._fallo(e));
      throw e;
    }
    if (r.error) return this._cerrar({ ...base, categoria: 'consulta', estado: 'rechazada', textoClaro: `No se ha ${decision === 'aprobada' ? 'aprobado' : 'rechazado'}: ${r.error.mensaje} [${r.error.codigo}]. ${decision === 'aprobada' ? 'Confirma en la interfaz autenticada.' : ''}`.trim(), detalle: '', error: r.error, tareas: r.idTarea ? [r.idTarea] : [] });
    const texto = decision === 'rechazada' ? `Autorización rechazada: la tarea ${r.idTarea} queda rechazada y no se ha ejecutado nada.` : `Autorización aprobada y registrada para la tarea ${r.idTarea}. ${r.texto ? corta(r.texto, 400) : 'En F1 la aprobación es simulada: no se envió nada a ningún agente real.'}`;
    return this._cerrar({ ...base, categoria: 'consulta', estado: 'respondida', textoClaro: texto, detalle: r.texto ?? '', tareas: r.idTarea ? [r.idTarea] : [], resumenHablado: textoParaVoz(texto) });
  }

  /** Parada de emergencia (siempre permitida, sin aprobación). */
  parada(motivo) {
    const base = this._base('parada');
    const r = this.director.paradaEmergencia(motivo || 'parada pedida desde el canal');
    const texto = `Parada de emergencia ${r.registrada ? 'registrada' : 'activa (sin registro: el ledger no está disponible)'}. Tareas canceladas: ${r.canceladas.length ? r.canceladas.join(', ') : 'ninguna'}. No se crean tareas nuevas hasta reanudar.`;
    return this._cerrar({ ...base, categoria: 'consulta', estado: 'respondida', textoClaro: texto, detalle: '', registrada: r.registrada !== false, tareas: r.canceladas, resumenHablado: textoParaVoz(texto) });
  }

  // ── presentación de la respuesta del Director ───────────────────────────────────────────────────────────────────────────────────────────────────────────
  presentar(res, { entradaChars = null, canal = this.canal, sospechas = [] } = {}) {
    const base = this._base('respuesta');
    const tipo = res.intencion && res.intencion.tipo;
    const texto = String(res.texto ?? '');
    const avisos = [...(res.avisos || [])];
    const tareas = this._tareas(res.tareas || []);
    const solicitudes = this._solicitudes(res.aprobaciones || []);
    const registrada = res.registrada !== false;
    const controles = { registrada, paradaActiva: this._parada(), secretoDetectado: /credencial/i.test(texto) && /no (lo )?he (registrado|procesado)|parece contener/i.test(texto), tipoDeControl: TIPOS_DE_CONTROL[tipo] ? { tipo, explicacion: TIPOS_DE_CONTROL[tipo] } : null, instruccionesSospechosas: sospechas.length, confirmaPorEsteCanal: false, canal };
    const limitaciones = [...avisos.filter((a) => /prueba|simulad|estim|no consta|no disponible|sin datos|no verificad|no puedo/i.test(a))];
    if (!registrada) limitaciones.unshift('Esta conversación NO queda registrada en el ledger (no disponible): no se ha creado ninguna tarea.');
    const lead = this._lead(res, controles, solicitudes);
    const partes = [lead];
    if (controles.tipoDeControl) partes.push(controles.tipoDeControl.explicacion);
    if (!registrada) partes.push('⚠ El ledger no está disponible: nada de esto queda registrado ni trazado.');
    if (controles.paradaActiva) partes.push('⚠ Hay una parada de emergencia activa: no se crean tareas nuevas ni se aprueba nada hasta reanudar.');
    const alternativas = this._alternativas(res, tipo, solicitudes);
    const consecuencias = this._consecuencias(res, tipo, solicitudes);
    return { ...base, canal, entradaChars, categoria: res.categoria ?? 'consulta', estado: res.estado ?? null, idSolicitud: res.idSolicitud ?? null, textoClaro: partes.join('\n'), detalle: texto, tareas, solicitudesAutorizacion: solicitudes, alternativas, consecuencias, limitaciones,
      naturalezaDatos: this._naturaleza(res), fuentes: (res.afirmaciones || []).map((a) => ({ texto: a.texto, procedencia: a.procedencia ?? null })), avisos, controles, registrada, tipoIntencion: tipo ?? null, resumenHablado: textoParaVoz(`${lead} ${texto}`) };
  }

  _lead(res, c, solicitudes) {
    if (c.tipoDeControl) return 'No he hecho nada con esa instrucción.';
    if (res.categoria === 'pendiente' || solicitudes.length) return `Necesito tu autorización antes de hacer nada (${solicitudes.length || 1} pendiente${solicitudes.length === 1 ? '' : 's'}).`;
    const e = res.estado;
    if (e === 'fallida') return 'No he podido completarlo.';
    if (e === 'rechazada') return 'No lo he hecho.';
    if (e === 'sin_datos') return 'No consta ningún dato sobre eso: no puedo comprobarlo.';
    if (e === 'aclaracion' || e === 'confirmar_interpretacion') return 'Necesito que me lo aclares.';
    if (e === 'sin_entender') return 'No he entendido la instrucción.';
    if (res.categoria === 'propuesta') return 'Esto es una propuesta: no he cambiado nada.';
    if (res.categoria === 'ejecutada') return 'Esto es el resultado de una simulación local: no ha cambiado nada real.';
    return 'Esto es lo que consta:';
  }

  _alternativas(res, tipo, solicitudes) {
    if (solicitudes.length) return solicitudes.flatMap((s) => s.alternativas.map((a) => ({ ...a, idAprobacion: s.idAprobacion })));
    if (TIPOS_DE_CONTROL[tipo]) return [{ id: 'reformular', texto: 'Reformular la petición con una acción que sí esté permitida.' }, { id: 'hacerlo_tu', texto: HUMANO.has(tipo) ? 'Hacerlo tú en el panel de administración (acción L4).' : 'Si quieres cambiar una regla, es una versión nueva del registro con tu aprobación expresa.' }];
    if (res.estado === 'fallida') return [{ id: 'reintentar', texto: 'Reintentarlo como una tarea nueva (con nueva aprobación si procede).' }, { id: 'ver_motivo', texto: 'Revisar el motivo del fallo antes de reintentar.' }];
    if (res.estado === 'sin_datos') return [{ id: 'aportar_datos', texto: 'Aportar o exportar los datos que faltan y volver a preguntar.' }];
    if (res.tareas && res.tareas.length) return [{ id: 'ver_tarea', texto: 'Ver el detalle y la traza de la tarea (comando «tarea ver <id>»).' }];
    return [];
  }

  _consecuencias(res, tipo, solicitudes) {
    if (solicitudes.length) return solicitudes[0].consecuencias;
    if (TIPOS_DE_CONTROL[tipo]) return ['No se ha creado ninguna tarea ni se ha cambiado ningún dato o permiso.'];
    if (res.categoria === 'propuesta') return ['Una propuesta no cambia nada; para aplicarla hace falta tu decisión.'];
    return [];
  }

  /** Naturaleza de los datos de una respuesta, a partir de lo que el Director DECLARA (nunca se supone «real» sin declarar). */
  _naturaleza(res) {
    const t = `${res.texto ?? ''}\n${(res.avisos || []).join('\n')}`;
    const out = [];
    // Los OFRECIMIENTOS de acciones futuras («Puedo solicitar una auditoría nueva (L2…; en F1 sería simulada)») hablan de la acción, no de los datos mostrados: no cuentan.
    const datosMostrados = t.split('\n').filter((l) => !/^\s*Puedo solicitar\b/i.test(l)).join('\n');
    if (/DATOS (DE PRUEBA|SIMULADOS)|\bSIMULAD[OA]S?\b/i.test(datosMostrados)) out.push({ etiqueta: 'simulado', detalle: 'La respuesta incluye datos o ejecuciones SIMULADAS: no son datos reales.' });
    if (/LECTURA DE PRODUCCIÓN/.test(t)) out.push({ etiqueta: 'real_produccion', detalle: 'Información REAL de un momento pasado, leída de n8n de producción en solo lectura: no describe el estado actual del sitio.' });
    if (/DATOS REALES SANEADOS/.test(t)) out.push({ etiqueta: 'real_saneado', detalle: 'Información REAL de un momento pasado, en una copia saneada: no describe el estado actual del sitio.' });
    if (/\bestimaci[oó]n|estimad[oa]s?\b/i.test(t)) out.push({ etiqueta: 'estimado', detalle: 'Hay cifras estimadas, no medidas ni facturadas.' });
    if (/no consta|no puedo comprobar|sin datos|no disponible/i.test(t)) out.push({ etiqueta: 'no_disponible', detalle: 'Hay datos que no constan: no se calculan ni se inventan.' });
    const proc = (res.afirmaciones || []).map((a) => String(a.procedencia ?? ''));
    if (proc.some((p) => /ledger|tarea|registro/i.test(p))) out.push({ etiqueta: 'real_registrado', detalle: 'Hechos leídos del ledger o del registro de agentes.' });
    if (!out.length && TIPOS_DE_CONTROL[res.intencion && res.intencion.tipo]) out.push({ etiqueta: 'no_aplica', detalle: 'Respuesta sin datos de negocio: solo explica un límite o una regla.' });
    if (!out.length) out.push({ etiqueta: 'sin_clasificar', detalle: 'El Director no declaró el origen de los datos de esta respuesta: léelo en el detalle.' });
    return out;
  }

  _tareas(ids) {
    if (!ids.length) return [];
    let todas = [];
    try { todas = this.director.listarTareas({}); } catch (e) { if (!(e instanceof ErrorProtocolo || e instanceof ErrorLedger)) throw e; }
    const por = new Map(todas.map((t) => [t.idTarea, t]));
    return ids.map((id) => { const t = por.get(id); return t ? { idTarea: id, capacidad: t.capacidad, estado: t.estado, nivel: t.nivel } : { idTarea: id, estado: 'no_comprobado' }; });
  }

  _solicitudes(ids) {
    if (!ids.length) return [];
    let todas = [];
    try { todas = this.director.listarAprobaciones({ pendientes: false }); } catch (e) { if (!(e instanceof ErrorProtocolo || e instanceof ErrorLedger)) throw e; }
    const por = new Map(todas.map((a) => [a.idAprobacion, a]));
    return ids.map((id) => por.get(id)).filter(Boolean).map((a) => this.presentarSolicitud(a));
  }

  _parada() { try { return this.director.paradaActiva(); } catch { return null; } }

  _base(tipo) { return { esquema: ESQUEMA_MENSAJE, tipo, idMensaje: `m-${Math.floor(this.reloj()).toString(36)}-${(this._n += 1).toString(36)}`, generadoEn: new Date(this.reloj()).toISOString(), origen: 'canal_13', canal: this.canal, categoria: 'consulta', estado: null, textoClaro: '', detalle: '', tareas: [], solicitudesAutorizacion: [], alternativas: [], consecuencias: [], limitaciones: [], naturalezaDatos: [], fuentes: [], avisos: [], controles: { confirmaPorEsteCanal: false, canal: this.canal }, registrada: true, resumenHablado: '' }; }

  _rechazo(codigo, texto) { return { ...this._base('rechazo'), estado: 'rechazada', textoClaro: texto, detalle: '', error: { codigo }, registrada: false, resumenHablado: textoParaVoz(texto), naturalezaDatos: [{ etiqueta: 'no_disponible', detalle: 'La instrucción no llegó al Director.' }] }; }

  _fallo(e) {
    const err = e.error || { codigo: e.codigo || 'interno', mensaje: e.message };
    const ledger = err.codigo === 'ledger_no_disponible' || err.codigo === 'ledger_corrupto';
    return { ...this._base('respuesta'), estado: 'fallida', textoClaro: `No he podido hacerlo: ${err.mensaje} [${err.codigo}]. ${ledger ? 'Sin ledger no inicio ninguna acción ni afirmo nada que no pueda comprobar.' : 'No consta ningún resultado.'}`, detalle: '', error: err, registrada: !ledger ? true : false, naturalezaDatos: [{ etiqueta: 'no_disponible', detalle: 'No consta ningún resultado.' }], resumenHablado: textoParaVoz(`No he podido hacerlo: ${err.mensaje}`) };
  }

  _cerrar(m) { this._ultimo = m; return m; }
}

/** Mensaje → texto para la consola (reutiliza el formato de la consola del Director; solo añade las secciones del canal). */
export function renderTexto(m) {
  const l = [m.textoClaro];
  if (m.detalle && m.detalle !== m.textoClaro) l.push('', 'Detalle del Director:', m.detalle);
  if (m.naturalezaDatos && m.naturalezaDatos.length) l.push('', `Naturaleza de los datos: ${m.naturalezaDatos.map((n) => n.etiqueta).join(', ')}`);
  for (const s of m.solicitudesAutorizacion || []) l.push('', `AUTORIZACIÓN ${s.idAprobacion} (${s.nivel}${s.simulada ? ', SIMULADA' : ''}): ${s.que}`, `  Efectos: ${s.efectos}${s.reversible === true ? ' Se puede deshacer.' : s.reversible === false ? ' NO se puede deshacer.' : ''}`, `  ${s.minutosRestantes !== null ? `Caduca en ${s.minutosRestantes} min.` : `Caduca ${s.caduca}.`} ${s.comoConfirmar}`, `  Alternativas: ${s.alternativas.map((a) => a.texto).join(' | ')}`);
  if (m.limitaciones && m.limitaciones.length) l.push('', `Limitaciones: ${m.limitaciones.join(' · ')}`);
  return l.join('\n');
}
