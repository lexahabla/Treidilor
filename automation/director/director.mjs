/**
 * Agente 00 · F1.4 · DIRECTOR DE CONSOLA (sin LLM, sin ejecución real).
 * Recibe instrucciones, las registra en el ledger ANTES de actuar, crea tareas, las asigna según el registro de capacidades, recoge
 * resultados (informes preparados de los Agentes 04 y 12) y gestiona aprobaciones L2–L4 en modo SIMULADO: se valida todo el flujo hasta
 * el punto de envío, pero no se envía nada a ningún agente (`DespachadorSimulado`; el Director rechaza un despachador real en F1).
 *   · L0 (consultas): se ejecutan y se verifican releyendo la fuente por un camino independiente.
 *   · L1: sin capacidades disponibles todavía (se explica, no se inventa).
 *   · L2–L4: tarea `esperando_aprobacion` → aprobación simulada → `delegacion_simulada` → tarea `cancelada` («simulación F1»).
 * Honestidad: sin dato «no consta»; lo comunicado se rotula; los datos de prueba se rotulan; nada de lo que dice el modelo (no hay) autoriza.
 */
import { LectorInstantaneas, TEXTO_SANEADO, TEXTO_PRODUCCION, textoCopia, huellaInforme, leerPropuestasReparacion } from './lectores.mjs';
import { ErrorLedger, detectarSecreto } from './ledger.mjs';
import { aprobacionPendientePorHuella, delegacionesDe, listarTareas, proyectar, tareaActivaConHuella, tareaActivaDeCapacidad } from './proyecciones.mjs';
import { PROTOCOLO, ErrorProtocolo, sha256, canonico, calcularHuella, claveIdempotencia, crearError, crearGeneradorIds, esTerminal, validarSobreTarea } from './protocolo.mjs';
import { CONFIG_APROBACIONES, canalPuedeSolicitar, crearSolicitudAprobacion, requiereAprobacion, resolverAprobacion, resumenParaAprobar } from './permisos.mjs';
import { aplicarPregunta, clasificarFrescura } from './frescura.mjs';
import { evaluarAsignacion } from './registro.mjs';
import { RIESGO_POR_TIPO, extraerEntradaImportacion, extraerTextoPublicitario, interpretar } from './intencion.mjs';
import { detectarInstruccionesEnDatos } from './saneado.mjs';
import { informeSuscripciones } from './suscripciones/aviso13.mjs';
import { cargarDatasetAfiliacion, compararProgramas, estudiarPrograma } from './agentes/afiliacion/afiliacion.mjs';
import { MAX_ENTRADA, analizarImportacion } from './agentes/importador/importador.mjs';
import { analizarPrecios } from './agentes/precios/precios.mjs';
import { analizarAnalitica, senalesParaAgentes } from './agentes/analitica/analitica.mjs';
import { borradorFicha, borradorHistoria, borradorPostsRedes, buscarProducto, informeContenido, piezaAportada, proponerRecursosVisuales } from './agentes/contenido/contenido.mjs';
import { informeCompetencia } from './agentes/competencia/competencia.mjs';
import { informeNichos } from './agentes/nichos/nichos.mjs';
import { investigarCandidatos } from './agentes/investigador/investigador.mjs';
import { auditarSEO, briefComoInforme, buscarCampana, planificarCampanas, redactarBrief, revisionComoInforme } from './agentes/marketing/marketing.mjs';
import { Presupuesto } from './llm/presupuesto.mjs';
import { construirFuentes as construirFuentesPortada, planDeshacerBorradorSimulado, planGuardarBorradorSimulado, proponerPortada } from './agentes/portada/portada.mjs';
import { borrarUndo, dirSandbox, escribirPlan, guardarUndo, leerEstado as leerEstadoSandbox, leerUndo } from './agentes/portada/sandbox.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_DEFECTO, directorioDatos } from './config.mjs';

/** En F1 la «delegación» es una simulación: no hay red ni llamada alguna. */
export class DespachadorSimulado {
  constructor() { this.real = false; this.enviados = 0; }
  enviar() { return { enviado: false, simulado: true, motivo: 'simulacion_f1: no se envió nada al agente' }; }
}

const CODIGOS_LEDGER_CAIDO = new Set(['ledger_no_disponible', 'ledger_corrupto', 'ledger_ocupado', 'ledger_cola_incompleta', 'ledger_truncado']);
const ETIQUETA_AGENTE = { '04': 'Calidad del catálogo (04)', '12': 'Auditor General (12)' };
const ISO = (ms) => new Date(ms).toISOString();

export class Director {
  constructor({ ledger, registro, lector, config = CONFIG_DEFECTO, reloj = () => Date.now(), ids = null, despachador = new DespachadorSimulado(), dirInstantaneas = null, dirDatos = null, cerebro = null, indice = null, inventarioIA = null, rutaAfiliacion = null, motorImportacion = null, rutaCatalogoImportacion = null, motorPrecios = null, rutaCatalogoPrecios = null, motorPortada = null, rutaDatosPortada = null, motorAnalitica = null, rutaAnalitica = null, motorMarketing = null, rutaFuentesMarketing = null, motorContenido = null, rutaFuentesContenido = null, motorCompetencia = null, rutaObservaciones = null, motorNichos = null, rutaNichos = null, rutaFeedInvestigador = null }) {
    if (despachador.real === true && config.permitirDespachoReal !== true) throw new ErrorProtocolo('permiso_denegado', 'F1 no admite un despachador real: las aprobaciones son simuladas.');
    this.ledger = ledger;
    this.registro = registro;
    this.lector = lector;
    this.dirInstantaneas = dirInstantaneas || (lector && lector.dir) || null;
    this.dirDatos = dirDatos || directorioDatos();
    this.config = config;
    this.reloj = reloj;
    this.ids = ids || crearGeneradorIds({ reloj });
    this.despachador = despachador;
    this.cerebro = cerebro;
    this.inventarioIA = inventarioIA;
    this.rutaAfiliacion = rutaAfiliacion;
    this.motorImportacion = motorImportacion;
    this.rutaCatalogoImportacion = rutaCatalogoImportacion;
    this._entradas = new Map();
    this.motorPrecios = motorPrecios;
    this.rutaCatalogoPrecios = rutaCatalogoPrecios;
    this.motorPortada = motorPortada;
    this.rutaDatosPortada = rutaDatosPortada;
    this._propuestas = new Map();
    this._ultimaPropuesta = null;
    this._ultimoInforme05 = null;
    this.motorAnalitica = motorAnalitica;
    this.rutaAnalitica = rutaAnalitica;
    this._ultimoInforme10 = null;
    this.motorMarketing = motorMarketing;
    this.rutaFuentesMarketing = rutaFuentesMarketing;
    this.motorContenido = motorContenido;
    this.rutaFuentesContenido = rutaFuentesContenido;
    this.motorCompetencia = motorCompetencia;
    this.rutaObservaciones = rutaObservaciones;
    this.motorNichos = motorNichos;
    this.rutaNichos = rutaNichos;
    this.rutaFeedInvestigador = rutaFeedInvestigador;
    this.indice = indice;
    this._paradaLocal = false;
  }

  // ── infraestructura ────────────────────────────────────────────────────────────────────────────────────────────────────────
  ahora() { return this.reloj(); }

  /** Escribe en el ledger. Un fallo del ledger se traduce a `ledger_no_disponible` (I-3: no se inicia ninguna acción nueva con trazabilidad). */
  _emitir(tipo, actor, refs, datos, version = {}) {
    try {
      return this.ledger.anadir({ tipo, actor, refs, datos, version: { registro: this.registro.version, ...version } }).evento;
    } catch (e) {
      if (e instanceof ErrorLedger && CODIGOS_LEDGER_CAIDO.has(e.codigo)) throw new ErrorProtocolo('ledger_no_disponible', 'El ledger no está disponible.', { causa: e.codigo });
      throw e;
    }
  }
  ledgerDisponible() {
    try { return this.ledger.estado().ok; } catch { return false; }
  }
  _proy() { return proyectar(this.ledger.leer(), { ahora: this.ahora() }); }
  _paradaActiva(p) { return this._paradaLocal || (p ? p.paradaActiva : this._proy().paradaActiva); }

  _sobre(cap, parametros, ctx) {
    return {
      protocolo: PROTOCOLO,
      tipo: 'solicitud',
      idTarea: this.ids.nuevo('t'),
      idCorrelacion: ctx.idCorrelacion,
      idPadre: ctx.idPadre ?? null,
      profundidad: ctx.profundidad ?? 0,
      origen: { actor: 'director', idSolicitud: ctx.idSolicitud ?? null, propietario: true },
      agente: cap.agente,
      capacidad: cap.id,
      modo: cap.modo,
      ejecutor: 'agente',
      prioridad: ctx.prioridad || 'P3',
      alcancesSolicitados: [...cap.alcances],
      parametros,
      plazoMs: cap.plazoMs,
      presupuesto: { maxCosteEur: 0, maxLlamadasApi: (cap.costeEstimado && cap.costeEstimado.llamadasApi) || 0 },
      creadaEn: ISO(this.ahora()),
    };
  }

  _validarParametros(cap, parametros) {
    const permitidos = Object.keys(cap.entrada || {});
    const sobrantes = Object.keys(parametros).filter((k) => !permitidos.includes(k));
    if (sobrantes.length) throw new ErrorProtocolo('solicitud_invalida', `Parámetros no admitidos por ${cap.id}: ${sobrantes.join(', ')}.`);
    for (const [k, v] of Object.entries(parametros)) if (typeof v !== 'string' && typeof v !== 'number') throw new ErrorProtocolo('solicitud_invalida', `El parámetro ${k} debe ser texto o número.`);
    // Restricciones de la ficha (esquema de la capacidad): se rechaza ANTES de pedir aprobación, señalando TODOS los campos y sin corregir en silencio.
    const defectos = [];
    for (const [k, r] of Object.entries(cap.restricciones || {})) {
      if (parametros[k] === undefined) continue;
      const v = parametros[k];
      if (r.enum && !r.enum.includes(v)) defectos.push({ campo: k, texto: `«${k}» inválido («${String(v).slice(0, 30)}»; válidos: ${r.enum.join(', ')})`, validos: r.enum });
      else if ((r.max !== undefined && !(Number(v) <= r.max)) || (r.min !== undefined && !(Number(v) >= r.min))) defectos.push({ campo: k, texto: `«${k}» fuera de rango (${String(v).slice(0, 30)}; rango válido ${r.min ?? '−∞'}–${r.max ?? '∞'})`, min: r.min, max: r.max });
    }
    if (defectos.length) throw new ErrorProtocolo('solicitud_invalida', `Solicitud fuera del esquema de ${cap.id}: ${defectos.map((d) => d.texto).join('; ')}. No se ha creado ninguna tarea ni se ha pedido aprobación; si quieres, puedo presentar una solicitud corregida como nueva.`, { defectos: defectos.map(({ campo, validos, min, max }) => ({ campo, validos, min, max })) });
  }

  // ── lecturas L0: tarea completa con evidencia y verificación independiente ────────────────────────────────────────────────────
  /**
   * Ejecuta una capacidad de CONSULTA. `leer(lector)` devuelve { datos, informe, ids } y se ejecuta dos veces con lectores distintos
   * (el segundo relee el archivo): solo si la huella coincide la verificación es `confirmada` (PROTOCOLO §13).
   */
  _consulta(cap, parametros, ctx, leer) {
    const ev0 = evaluarAsignacion(this.registro, cap.id);
    if (!ev0.ok) throw new ErrorProtocolo(ev0.codigo, ev0.motivo);
    if (this._paradaActiva()) throw new ErrorProtocolo('parada_emergencia', 'Parada de emergencia activa: no se crean tareas nuevas.');
    this._validarParametros(cap, parametros);
    const sobre = this._sobre(cap, parametros, ctx);
    const v = validarSobreTarea(sobre, { registro: this.registro, ahora: this.ahora(), exigirAprobacion: false });
    if (!v.ok) throw new ErrorProtocolo(v.errores[0].codigo, v.errores[0].mensaje);
    const huella = calcularHuella({ capacidad: cap.id, version: cap.version, parametros, entorno: parametros.entorno ?? '' });
    const refs = { idTarea: sobre.idTarea, idCorrelacion: sobre.idCorrelacion, idSolicitud: ctx.idSolicitud };
    const version = { capacidad: cap.version };
    this._emitir('tarea_creada', 'director', refs, { sobre, nivel: cap.nivelRiesgo, capacidadVersion: cap.version, registroVersion: this.registro.version, huella }, version);
    this._emitir('tarea_estado', 'director', { idTarea: sobre.idTarea }, { estado: 'aceptada' }, version);
    this._emitir('tarea_estado', 'director', { idTarea: sobre.idTarea }, { estado: 'en_curso' }, version);
    let lectura;
    try {
      lectura = leer(this.lector);
    } catch (e) {
      const error = e instanceof ErrorProtocolo ? e.error : crearError('interno', 'Fallo no clasificado al leer la fuente.');
      this._emitir('tarea_estado', 'director', { idTarea: sobre.idTarea }, { estado: 'fallida', detalle: error.mensaje, error }, version);
      return { idTarea: sobre.idTarea, estado: 'fallida', error, cap };
    }
    if (!lectura.informe) {
      this._emitir('respuesta_recibida', `agente:${cap.agente}`, { idTarea: sobre.idTarea }, { estado: 'completada', hayDatos: false, motivo: lectura.motivo || 'sin_instantaneas', carga: lectura.carga ? { leidas: lectura.carga.leidas, descartadas: lectura.carga.descartadas.length } : null }, version);
      this._emitir('tarea_estado', 'director', { idTarea: sobre.idTarea }, { estado: 'completada', detalle: 'sin_datos' }, version);
      return { idTarea: sobre.idTarea, estado: 'completada', sinDatos: true, motivo: lectura.motivo || 'sin_instantaneas', lectura, cap };
    }
    const hash = huellaInforme(lectura.datos);
    this._emitir('respuesta_recibida', `agente:${cap.agente}`, { idTarea: sobre.idTarea }, { estado: 'completada', hayDatos: true, referencias: lectura.ids, huella: hash, consumo: { llamadasApi: 0, ia: 0 } }, version);
    const idEvidencia = this.ids.nuevo('v');
    const refEv = { idTarea: sobre.idTarea, idEvidencia };
    this._emitir('evidencia', 'director', refEv, { tipo: 'informe', referencia: `${lectura.informe.fuente.tabla}#${lectura.informe.idEjecucion}`, hash, capturadaEn: lectura.informe.generadoEn, origen: lectura.informe.fuente.origenDatos }, version);
    // Verificación independiente: otra instancia del lector relee la fuente y se compara la huella.
    let segunda = null;
    try { segunda = leer(this.lector && typeof this.lector.independiente === 'function' ? this.lector.independiente() : new LectorInstantaneas({ dir: this.dirInstantaneas })); } catch { segunda = null; }
    const confirmada = Boolean(segunda && segunda.informe && huellaInforme(segunda.datos) === hash);
    this._emitir('verificacion', 'director', refEv, { metodo: 'releer_fila', resultado: confirmada ? 'confirmada' : 'no_confirmada', en: ISO(this.ahora()), por: 'director' }, version);
    if (confirmada) this._emitir('tarea_estado', 'director', { idTarea: sobre.idTarea }, { estado: 'completada' }, version);
    else {
      const error = crearError('resultado_no_confirmado', 'Terminó, pero no consta confirmación: la segunda lectura no coincide.');
      this._emitir('tarea_estado', 'director', { idTarea: sobre.idTarea }, { estado: 'parcial', detalle: error.mensaje, error }, version);
    }
    return { idTarea: sobre.idTarea, estado: confirmada ? 'completada' : 'parcial', confirmada, huella: hash, idEvidencia, lectura, cap };
  }

  /** API de bajo nivel: lectura L0 de una capacidad por id (usada por la consola y por `procesarSolicitud`). */
  leerCapacidad(capId, parametros = {}, ctx = {}) {
    const cap = this.registro.buscarCapacidad(capId);
    if (!cap) throw new ErrorProtocolo('capacidad_desconocida', `La capacidad «${capId}» no está en el registro.`);
    if (cap.nivelRiesgo !== 'L0' || cap.disponibilidad !== 'lectura_f1') throw new ErrorProtocolo('solicitud_invalida', `${capId} no es una consulta que F1 pueda ejecutar.`);
    const c = { idCorrelacion: this.ids.nuevo('c'), idSolicitud: null, ...ctx };
    const entorno = parametros.entorno ?? null;
    const sufijo = capId.split('.')[1];
    const ag = cap.agente;
    const leer = {
      'leer-ultimo-informe': (lector) => { const r = lector.ultima(ag, { entorno }); return { informe: r.informe, datos: r.informe, carga: r.carga, ids: r.informe ? [r.informe.idEjecucion] : [] }; },
      'leer-historial': (lector) => {
        if (parametros.idEjecucion) { const r = lector.obtener(ag, String(parametros.idEjecucion), { entorno }); return { informe: r.informe, datos: r.informe, carga: r.carga, ids: r.informe ? [r.informe.idEjecucion] : [], motivo: 'idEjecucion_no_encontrada' }; }
        const r = lector.listar(ag, { entorno, n: parametros.limite ? Number(parametros.limite) : 10 });
        return { informe: r.informes[0] || null, datos: r.informes, informes: r.informes, total: r.total, carga: r.carga, ids: r.informes.map((i) => i.idEjecucion) };
      },
      'leer-analitica-agregada': () => this._leerAnalitica(capId),
      'revisar-texto-publicitario': () => this._leerMarketing(capId, parametros),
      'revisar-pieza': () => this._leerContenido(capId, parametros),
      'validar-observaciones': () => this._leerCompetencia(capId, parametros),
      'comparar-informes': (lector) => {
        const r = lector.comparar(ag, { entorno, anterior: parametros.anterior ?? null, actual: parametros.actual ?? null });
        return { informe: r.informe, datos: { actual: r.informe, anterior: r.anterior }, carga: r.carga, ids: r.informe ? [r.informe.idEjecucion, r.informe.seguimiento.comparadoCon] : [], motivo: r.motivo };
      },
    }[sufijo];
    if (sufijo === 'leer-propuestas-reparacion') return this._leerPropuestasReparacion(capId, parametros, c);
    if (!leer) throw new ErrorProtocolo('capacidad_desconocida', `Sin lector para ${capId}.`);
    return this._consulta(cap, parametros, c, leer);
  }

  /** Lectura L0 de propuestas de reparación del Agente 04 (almacén automation-proposals.json).
   * Crea tarea en el ledger, lee las propuestas, verifica por relectura y retorna el resultado.
   * No modifica ningún dato comercial. */
  _leerPropuestasReparacion(capId, parametros, ctx) {
    const cap = this.registro.buscarCapacidad(capId);
    if (!cap) throw new ErrorProtocolo('capacidad_desconocida', `La capacidad «${capId}» no está en el registro.`);
    if (!this.dirDatos) throw new ErrorProtocolo('origen_no_disponible', 'No hay un directorio de datos del catálogo configurado (TAI_DIRECTOR_DATOS o <raiz>/src/data).');
    this._validarParametros(cap, parametros);
    const sobre = this._sobre(cap, parametros, ctx);
    const v = validarSobreTarea(sobre, { registro: this.registro, ahora: this.ahora(), exigirAprobacion: false });
    if (!v.ok) throw new ErrorProtocolo(v.errores[0].codigo, v.errores[0].mensaje);
    const huella = calcularHuella({ capacidad: cap.id, version: cap.version, parametros, entorno: (parametros.entorno ?? '') });
    const refs = { idTarea: sobre.idTarea, idCorrelacion: sobre.idCorrelacion, idSolicitud: ctx.idSolicitud };
    const version = { capacidad: cap.version };
    this._emitir('tarea_creada', 'director', refs, { sobre, nivel: cap.nivelRiesgo, capacidadVersion: cap.version, registroVersion: this.registro.version, huella }, version);
    this._emitir('tarea_estado', 'director', { idTarea: sobre.idTarea }, { estado: 'aceptada' }, version);
    this._emitir('tarea_estado', 'director', { idTarea: sobre.idTarea }, { estado: 'en_curso' }, version);
    const rutaPropuestas = path.join(this.dirDatos, 'automation-proposals.json');
    let lectura;
    try {
      lectura = leerPropuestasReparacion(rutaPropuestas, { estado: parametros.estado, limite: parametros.limite ? Number(parametros.limite) : 50 });
    } catch (e) {
      const error = e instanceof ErrorProtocolo ? e.error : crearError('interno', 'Fallo no clasificado al leer las propuestas de reparación.');
      this._emitir('tarea_estado', 'director', { idTarea: sobre.idTarea }, { estado: 'fallida', detalle: error.mensaje, error }, version);
      return { idTarea: sobre.idTarea, estado: 'fallida', error, cap };
    }
    if (lectura.mensaje) {
      this._emitir('respuesta_recibida', `agente:${cap.agente}`, { idTarea: sobre.idTarea }, { estado: 'completada', hayDatos: false, motivo: lectura.mensaje, carga: null }, version);
      this._emitir('tarea_estado', 'director', { idTarea: sobre.idTarea }, { estado: 'completada', detalle: 'sin_datos' }, version);
      return { idTarea: sobre.idTarea, estado: 'completada', sinDatos: true, motivo: lectura.mensaje, lectura, cap };
    }
    const hash = huellaInforme({ propuestas: lectura.propuestas, total: lectura.total });
    this._emitir('respuesta_recibida', `agente:${cap.agente}`, { idTarea: sobre.idTarea }, { estado: 'completada', hayDatos: true, referencias: lectura.ids, huella: hash, consumo: { llamadasApi: 0, ia: 0 } }, version);
    const idEvidencia = this.ids.nuevo('v');
    const refEv = { idTarea: sobre.idTarea, idEvidencia };
    this._emitir('evidencia', 'director', refEv, { tipo: 'informe', referencia: `automation-proposals.json#${cap.agente}`, hash, capturadaEn: new Date().toISOString(), origen: 'almacen_propuestas' }, version);
    // Verificación independiente: segunda lectura del mismo almacén.
    let segunda = null;
    try { segunda = leerPropuestasReparacion(this.dirDatos, { estado: parametros.estado, limite: parametros.limite ? Number(parametros.limite) : 50 }); } catch { segunda = null; }
    const confirmada = Boolean(segunda && !segunda.mensaje && segunda.total === lectura.total && segunda.propuestas.length === lectura.propuestas.length && segunda.propuestas.every((p, i) => p.id === lectura.propuestas[i].id));
    this._emitir('verificacion', 'director', refEv, { metodo: 'releer_fila', resultado: confirmada ? 'confirmada' : 'no_confirmada', en: new Date().toISOString(), por: 'director' }, version);
    if (confirmada) this._emitir('tarea_estado', 'director', { idTarea: sobre.idTarea }, { estado: 'completada' }, version);
    else {
      const error = crearError('resultado_no_confirmado', 'Terminó, pero no consta confirmación: la segunda lectura no coincide.');
      this._emitir('tarea_estado', 'director', { idTarea: sobre.idTarea }, { estado: 'parcial', detalle: error.mensaje, error }, version);
    }
    return { idTarea: sobre.idTarea, estado: confirmada ? 'completada' : 'parcial', confirmada, huella: hash, idEvidencia, lectura, cap };
  }

  // ── propuestas L1 (Agente 02): tarea registrada, informe del agente, evidencia y verificación por recálculo independiente ─────────────────────
  /** Lee el conjunto de datos de afiliación (cada llamada lo vuelve a leer del archivo: la segunda lectura de la verificación es independiente). */
  _leerAfiliacion(capId, parametros) {
    let ds;
    try { ds = cargarDatasetAfiliacion(this.rutaAfiliacion); } catch { throw new ErrorProtocolo('origen_no_disponible', 'No se pudo leer un conjunto de datos de afiliación válido.'); }
    const ahora = this.ahora();
    const r = capId === '02.comparar-programas' ? compararProgramas(ds, { categoria: parametros.categoria ?? null, ahora }) : estudiarPrograma(ds, parametros.programa, { ahora });
    if (!r.informe) return { informe: null, datos: null, motivo: r.motivo, extra: r, ds, carga: { sintetico: Boolean(ds.sintetico), descartadas: [], leidas: ds.programas.length }, ids: [] };
    return { informe: r.informe, datos: r.informe, extra: r, ds, carga: { sintetico: Boolean(ds.sintetico), descartadas: [], leidas: ds.programas.length }, ids: [r.informe.idEjecucion] };
  }

  /** Ejecuta una capacidad de PROPUESTA (L1) del Agente 02. No requiere aprobación porque no tiene efectos; lo que proponga se queda en propuesta. */
  ejecutarPropuesta(capId, parametros = {}, ctx = {}) {
    const cap = this.registro.buscarCapacidad(capId);
    if (!cap) throw new ErrorProtocolo('capacidad_desconocida', `La capacidad «${capId}» no está en el registro.`);
    const asign0 = evaluarAsignacion(this.registro, capId);
    if (!asign0.ok) throw new ErrorProtocolo(asign0.codigo, asign0.motivo);
    if (!['01', '02', '03', '05', '06', '07', '08', '09', '11'].includes(cap.agente) || cap.nivelRiesgo !== 'L1' || cap.disponibilidad !== 'propuesta_f1') throw new ErrorProtocolo('solicitud_invalida', `${capId} no es una propuesta L1 que pueda ejecutar el Director.`);
    const asign = evaluarAsignacion(this.registro, capId);
    if (!asign.ok) throw new ErrorProtocolo(asign.codigo, asign.motivo);
    if (cap.agente === '03' && !parametros.entradaRef) throw new ErrorProtocolo('solicitud_invalida', 'Falta la entrada de la importación (entradaRef).');
    if (cap.agente === '02' && !this.rutaAfiliacion) throw new ErrorProtocolo('origen_no_disponible', 'No hay un conjunto de datos de afiliación configurado: no consta ningún programa.');
    if (capId === '02.estudiar-programa-afiliacion' && !parametros.programa) throw new ErrorProtocolo('solicitud_invalida', 'Falta el parámetro «programa» (p. ej. awin).');
    const c = { idCorrelacion: this.ids.nuevo('c'), idSolicitud: null, ...ctx };
    return this._consulta(cap, parametros, c, () => (cap.agente === '03' ? this._leerImportador(capId, parametros) : cap.agente === '07' ? this._leerMarketing(capId, parametros) : cap.agente === '08' ? this._leerContenido(capId, parametros) : cap.agente === '09' ? this._leerCompetencia(capId, parametros) : cap.agente === '11' ? this._leerNichos(capId) : cap.agente === '01' ? this._leerInvestigador(capId) : cap.agente === '06' ? this._leerPortada(capId, parametros) : cap.agente === '05' ? this._leerPrecios(capId, parametros) : this._leerAfiliacion(capId, parametros)));
  }

  // ── Agente 05 (analista de precios): propuestas informativas L1 sobre las funciones existentes de Treidilor; nunca escribe precios ──────────────────
  _leerPrecios(capId, parametros) {
    const motor = this.motorPrecios;
    if (!motor) throw new ErrorProtocolo('origen_no_disponible', 'Las funciones existentes de precios no están cargadas: no se puede analizar.');
    if (!this.rutaCatalogoPrecios) throw new ErrorProtocolo('origen_no_disponible', 'No hay un catálogo de referencia con observaciones de precios: no consta ningún precio que analizar.');
    let datos;
    try { datos = JSON.parse(fs.readFileSync(this.rutaCatalogoPrecios, 'utf8')); } catch { throw new ErrorProtocolo('origen_no_disponible', 'No se pudo leer el catálogo de referencia de precios.'); }
    const catalogo = Array.isArray(datos) ? datos : Array.isArray(datos.productos) ? datos.productos : [];
    const sintetico = Array.isArray(datos) ? true : datos.sintetico !== false;
    const r = analizarPrecios({ motor, catalogo, ahora: this.ahora(), productoId: parametros.producto ?? null, sintetico, capacidad: capId });
    if (!r.informe) return { informe: null, datos: null, motivo: r.motivo, extra: r, carga: { sintetico, descartadas: [], leidas: catalogo.length }, ids: [] };
    this._ultimoInforme05 = r.informe;
    return { informe: r.informe, datos: r.informe, extra: r, carga: { sintetico, descartadas: [], leidas: catalogo.length }, ids: [r.informe.idEjecucion] };
  }

  _respPrecios(res) {
    const tareas = res.idTarea ? [res.idTarea] : [];
    if (res.estado === 'fallida') return { categoria: 'consulta', estado: 'fallida', texto: `No he podido analizar los precios: ${res.error.mensaje} [${res.error.codigo}] No consta el dato; no afirmo ningún precio.`, tareas, aprobaciones: [], avisos: [], afirmaciones: [] };
    if (res.sinDatos) return { categoria: 'consulta', estado: 'sin_datos', texto: `No consta el producto «${res.lectura.extra.productoId ?? ''}» en el catálogo de referencia.${res.lectura.extra.disponibles ? ` Disponibles: ${res.lectura.extra.disponibles.slice(0, 12).join(', ')}.` : ''}`, tareas, aprobaciones: [], avisos: [], afirmaciones: [] };
    const informe = res.lectura.informe;
    const R = informe.resumen;
    const por = (regla) => informe.hallazgos.filter((x) => x.regla === regla || (regla.endsWith('*') && x.regla.startsWith(regla.slice(0, -1))));
    const t = (x) => x.evidencia.titulo ?? x.elemento;
    const conAnomalia = new Set(por('anomalia:*').map((x) => x.elemento));
    const nota = (x) => (conAnomalia.has(x.elemento) ? ' ⚠ el producto tiene anomalías: no usarlo sin comprobarlo' : '');
    const l = [];
    l.push(`Análisis de ${R.productos} producto(s): ${R.verificadosVigentes} con precio VERIFICADO vigente · ${R.desactualizados} con lectura desactualizada · ${R.sinVerificar} sin verificar (su precio NO se presenta como actual).`);
    for (const x of por('descuento_verificado')) l.push(`· Descuento VERIFICADO: ${t(x)} −${x.evidencia.porcentaje} % (antes ${x.evidencia.precioAnterior} €, verificado ${x.evidencia.verificadoEn}).${nota(x)}`);
    for (const x of por('descuento_declarado_no_verificado')) l.push(`· Descuento DECLARADO sin verificar (no se presenta): ${t(x)} (precio anterior declarado ${x.evidencia.precioAnteriorDeclarado} €).`);
    for (const x of por('caida_verificada')) l.push(`· Bajada verificada: ${t(x)} ${x.evidencia.de} → ${x.evidencia.a} € (${x.evidencia.variacionPct} %).${nota(x)}`);
    for (const x of por('caida_no_verificada')) l.push(`· Bajada NO verificada (no se anuncia): ${t(x)} ${x.evidencia.de} → ${x.evidencia.a} €.`);
    for (const x of por('anomalia:*')) l.push(`· ANOMALÍA ${x.regla.slice(9)} [${x.prioridad}]: ${t(x)} — ${x.accionSugerida ?? ''}`.trim());
    for (const x of por('precio_verificado_desactualizado')) l.push(`· Lectura desactualizada: ${t(x)} (verificada ${x.evidencia.verificadoEn}); es histórico, no actual.`);
    for (const x of por('oportunidad_ahorro')) l.push(x.evidencia.tipo === 'mas_barata_entre_comercios' ? `· OPORTUNIDAD entre comercios: ${t(x)} más barato en ${x.evidencia.masBarata.plataforma} (${x.evidencia.masBarata.vendedor}) a ${x.evidencia.masBarata.total} € con envío, ahorro ${x.evidencia.ahorroEur} € frente a ${x.evidencia.frenteA.plataforma} (ofertas verificadas vigentes, mismo producto).` : `· OPORTUNIDAD: ${t(x)} a ${x.evidencia.precioPublicado} €, ${x.evidencia.ahorroEur} € (${x.evidencia.ahorroPct} %) por debajo de su media verificada (${x.evidencia.lecturasVerificadas} lecturas).`);
    for (const x of por('comparacion_no_concluyente')) l.push(`· No se puede afirmar cuál es la más barata de ${t(x)}: ${x.evidencia.motivoNoConcluyente === 'menos_de_2_ofertas_verificadas' ? 'faltan ofertas verificadas' : 'faltan totales con envío conocidos'}.`);
    for (const x of por('comparacion_no_vigente')) l.push(`· Comparación no vigente: ${t(x)} (alguna oferta no está verificada dentro de ${x.evidencia.maxEdadHoras} h).`);
    for (const x of por('propuesta_correccion')) l.push(`· PROPUESTA de corrección con evidencia: ${t(x)} publicado ${x.evidencia.precioPublicado} € frente a ${x.evidencia.precioObservado} € observado (${x.evidencia.verificadoEn}). La corrección es L4 humano.`);
    const avisos = [];
    if (res.lectura.carga.sintetico) avisos.push('DATOS DE PRUEBA (sintéticos): no son precios reales.');
    for (const x of informe.limitaciones.filter((y) => !y.startsWith('DATOS DE PRUEBA'))) avisos.push(x);
    avisos.push(`Descuentos declarados sin verificar que NO se presentan: ${R.descuentosNoVerificados}.`);
    const verif = res.idTarea ? (res.confirmada ? 'Verificado: el análisis se recalculó y coincide (huella).' : 'TERMINÓ, PERO NO CONSTA CONFIRMACIÓN: el recálculo no coincide.') : 'Sin verificación (no se registró tarea).';
    return { categoria: 'propuesta', estado: 'respondida', texto: `[propuesta informativa · no escribo ni cambio precios] ${l.join('\n')}\n${avisos.map((x) => `⚠ ${x}`).join('\n')}\n${verif}`, tareas, aprobaciones: [], avisos, afirmaciones: [{ texto: `Informe ${informe.idEjecucion}`, procedencia: `${res.lectura.carga.sintetico ? 'datos de prueba' : 'datos'} funciones_de_treidilor_de_precios ${informe.idEjecucion} ${informe.generadoEn}` }], confirmada: res.confirmada };
  }

  // ── Canal del propietario (Agente 13): lecturas estructuradas sobre el propio Director; no deciden nada ───────────────────────────────────────────────────
  /** ¿Hay una parada de emergencia activa? */
  paradaActiva() { return this._paradaActiva(); }

  /** Autorizaciones registradas en el ledger (por defecto, solo las pendientes y vigentes), con los datos de su capacidad en el registro. */
  listarAprobaciones({ pendientes = true } = {}) {
    const ahora = this.ahora();
    const p = this._proy();
    return [...p.aprobaciones.values()]
      .filter((a) => !pendientes || (a.estado === 'pendiente' && ahora <= Date.parse(a.caduca)))
      .map((a) => { const cap = this.registro.buscarCapacidad(a.capacidad); return { ...a, minutosRestantes: Math.max(0, Math.round((Date.parse(a.caduca) - ahora) / 60000)), vencida: a.estado === 'pendiente' && ahora > Date.parse(a.caduca), capacidadInfo: cap ? { id: cap.id, agente: cap.agente, descripcion: cap.descripcion, nivelRiesgo: cap.nivelRiesgo, efectos: cap.efectos, alcances: cap.alcances, costeEstimado: cap.costeEstimado || null, disponibilidad: cap.disponibilidad } : null }; });
  }

  _respAprobaciones() {
    const l = this.listarAprobaciones();
    if (!l.length) return { categoria: 'consulta', estado: 'respondida', texto: 'No consta ninguna autorización pendiente y vigente (consultado el ledger).', tareas: [], aprobaciones: [], avisos: [], afirmaciones: [{ texto: 'Autorizaciones pendientes', procedencia: 'ledger' }] };
    return { categoria: 'consulta', estado: 'respondida', texto: `Autorizaciones pendientes (${l.length}). Se confirman solo en la interfaz autenticada, nunca por texto ni por voz:\n${l.map((a) => `· ${a.idAprobacion} · ${a.capacidad} · ${a.nivel} · caduca en ${a.minutosRestantes} min · ${a.simulada ? 'SIMULADA' : 'real'} — ${a.resumen}`).join('\n')}`, tareas: l.map((a) => a.idTarea), aprobaciones: l.map((a) => a.idAprobacion), avisos: [], afirmaciones: [{ texto: 'Autorizaciones pendientes', procedencia: 'ledger' }] };
  }

  /** Consumo de IA del propio Director (las llamadas registradas en el ledger); el mismo cálculo que `consumo` de la consola. Nada se inventa: sin consumo real activado solo hay llamadas simuladas a coste 0. */
  consumoIA() {
    const eventos = this.ledger.leer({ tipo: 'consumo' });
    const p = Presupuesto.desdeEventos(eventos, { reloj: () => this.ahora() });
    const tokens = { simulados: { entrada: 0, salida: 0, llamadas: 0 }, reales: { entrada: 0, salida: 0, llamadas: 0 }, porProveedor: {} };
    for (const e of eventos) {
      const d = e.datos || {};
      if (d.fase !== 'liquidacion') continue;
      const g = d.simulado ? tokens.simulados : tokens.reales;
      g.entrada += Number(d.tokensEntrada) || 0; g.salida += Number(d.tokensSalida) || 0; g.llamadas += 1;
      const k = `${d.proveedor ?? 'desconocido'}${d.simulado ? ' (simulado)' : ''}`;
      tokens.porProveedor[k] = (tokens.porProveedor[k] || 0) + (Number(d.tokensEntrada) || 0) + (Number(d.tokensSalida) || 0);
    }
    return { ...p.resumen(this.ahora()), tokens };
  }

  /** Informe de suscripciones y API de IA (el del Agente 13 de F1.5), con o sin recomendaciones. */
  informeSuscripciones(recomendar = false) { return this._respSuscripciones(Boolean(recomendar)); }

  // ── Agente 07 (marketing y SEO): L1 de propuesta y L0 de revisión; fuentes de referencia POR PARÁMETRO (sin acceso al catálogo real); nada se publica, envía ni invierte ─────────
  _leerMarketing(capId, parametros) {
    const motor = this.motorMarketing;
    if (!motor) throw new ErrorProtocolo('origen_no_disponible', 'Las funciones existentes de marketing no están cargadas: no se puede analizar.');
    if (!this.rutaFuentesMarketing) throw new ErrorProtocolo('origen_no_disponible', 'No hay fuentes de referencia (catálogo y categorías) aportadas por parámetro: no consta nada sobre lo que proponer.');
    let datos;
    try { datos = JSON.parse(fs.readFileSync(this.rutaFuentesMarketing, 'utf8')); } catch { throw new ErrorProtocolo('origen_no_disponible', 'No se pudieron leer las fuentes de referencia de marketing.'); }
    const sintetico = datos.sintetico !== false;
    const fuentes = { productos: Array.isArray(datos.productos) ? datos.productos : [], categorias: Array.isArray(datos.categorias) ? datos.categorias : [], retiradas: Array.isArray(datos.retiradas) ? datos.retiradas : [] };
    const ahora = this.ahora();
    const carga = { sintetico, descartadas: [], leidas: fuentes.productos.length };
    const informes = [this._ultimoInforme05, this._ultimoInforme10].filter(Boolean);
    const sufijo = capId.split('.')[1];
    let r;
    if (sufijo === 'proponer-plan-campanas') { r = planificarCampanas({ motor, fuentes, informes, ahora, sintetico, capacidad: capId }); return { informe: r.informe, datos: r.informe, extra: r, carga, ids: [r.informe.idEjecucion] }; }
    if (sufijo === 'auditar-seo-contenido') { r = auditarSEO({ motor, fuentes, ahora, sintetico, capacidad: capId }); return { informe: r.informe, datos: r.informe, extra: r, carga, ids: [r.informe.idEjecucion] }; }
    if (sufijo === 'redactar-briefs') {
      const plan = planificarCampanas({ motor, fuentes, informes, ahora, sintetico, capacidad: capId });
      const b = buscarCampana(plan.campanas, parametros.campana);
      if (!b.campana) return { informe: null, datos: null, motivo: b.motivo, extra: { ...b, campanaPedida: String(parametros.campana ?? '') }, carga, ids: [] };
      const brief = redactarBrief({ motor, campana: b.campana, fuentes, ahora });
      r = briefComoInforme({ brief, campana: b.campana, ahora, sintetico, capacidad: capId });
      return { informe: r.informe, datos: r.informe, extra: { ...r, brief, campana: b.campana }, carga, ids: [r.informe.idEjecucion] };
    }
    if (sufijo === 'revisar-texto-publicitario') {
      const texto = this._leerEntrada(parametros.textoRef);
      r = revisionComoInforme({ motor, texto, fuentes, conEnlaces: /https?:\/\/|www\./i.test(texto), ahora, sintetico, capacidad: capId });
      return { informe: r.informe, datos: r.informe, extra: r, carga, ids: [r.informe.idEjecucion] };
    }
    throw new ErrorProtocolo('capacidad_desconocida', `Sin lector para ${capId}.`);
  }

  _respMarketing(res, capId) {
    const tareas = res.idTarea ? [res.idTarea] : [];
    if (res.estado === 'fallida') return { categoria: 'consulta', estado: 'fallida', texto: `No he podido completarlo: ${res.error.mensaje} [${res.error.codigo}] No consta ningún resultado; no afirmo nada.`, tareas, aprobaciones: [], avisos: [], afirmaciones: [] };
    if (res.sinDatos) {
      const ex = res.lectura.extra || {};
      return { categoria: 'consulta', estado: 'aclaracion', texto: `No encuentro una única campaña «${ex.campanaPedida ?? ''}» en el plan (${res.lectura.motivo}).${ex.disponibles && ex.disponibles.length ? ` Campañas disponibles: ${ex.disponibles.join(', ')}.` : ''}`, tareas, aprobaciones: [], avisos: [], afirmaciones: [] };
    }
    const informe = res.lectura.informe;
    const R = informe.resumen;
    const por = (regla) => informe.hallazgos.filter((x) => x.regla === regla);
    const l = [];
    if (capId === '07.proponer-plan-campanas') {
      l.push(`Plan de campañas propuesto: ${R.campanas} campaña(s), ${R.campanasEnPreparacion} con la preparación abierta, ${R.candidatosTotales} producto(s) candidato(s).`);
      for (const x of por('campana_propuesta')) l.push(`· ${x.evidencia.nombre} (${x.evidencia.estado}, ${x.evidencia.fecha}; preparar desde ${x.evidencia.preparacionDesde}): ${x.evidencia.candidatos} candidato(s) de ${x.evidencia.totalElegibles} elegibles.`);
      for (const x of por('campana_sin_candidatos').concat(por('campana_sin_categorias'))) l.push(`· ${x.elemento}: ${x.accionSugerida}`);
    } else if (capId === '07.redactar-briefs') {
      const b = res.lectura.extra.brief;
      l.push(`Brief BORRADOR de «${b.campana.nombre}» (${b.campana.estado}, ${b.campana.fecha}); no publicado, requiere tu aprobación.`);
      l.push(`· Ángulos: ${b.angulos.filter((a) => a.utilizable).length} utilizables de ${b.angulos.length}. Mensajes: ${b.mensajes.filter((x) => x.texto).length} redactados, ${b.mensajes.filter((x) => !x.texto).length} sin redactar por falta de fecha de captura del precio.`);
      for (const x of b.mensajes.filter((m) => m.texto).slice(0, 3)) l.push(`  – ${x.texto}`);
      l.push(`· Revisión de los mensajes: ${b.revisionDeMensajes.ok ? 'sin problemas' : `${b.revisionDeMensajes.problemas.length} problema(s)`}. Acciones en el calendario: ${b.calendarioAcciones.length} (publicar o enviar = decisión humana L4).`);
      l.push(`· Medición: ${b.medicion.principal}. Coste por visita: no disponible.`);
    } else if (capId === '07.auditar-seo-contenido') {
      l.push(`Auditoría SEO de contenido: ${R.elementosTotales} ficha(s), ${R.problemasSeo} problema(s) en ${R.elementosAfectados}.`);
      const cuenta = {};
      for (const x of informe.hallazgos.filter((y) => y.regla.startsWith('seo_'))) cuenta[x.regla] = (cuenta[x.regla] || 0) + 1;
      for (const [k, v] of Object.entries(cuenta).sort()) l.push(`· ${k.replace('seo_', '').replace(/_/g, ' ')}: ${v}`);
    } else {
      const probs = por('problema_texto');
      l.push(probs.length ? `Revisión del texto: ${probs.length} problema(s).` : 'Revisión del texto: no se detectan problemas con estas reglas (no sustituye a una revisión legal).');
      for (const x of probs) l.push(`· ${x.evidencia.regla.replace(/_/g, ' ')}: «${x.evidencia.fragmento}» → ${x.accionSugerida}`);
    }
    const avisos = [];
    if (res.lectura.carga.sintetico) avisos.push('DATOS DE PRUEBA (sintéticos): las fichas usadas como fuente no reflejan la producción.');
    for (const x of informe.limitaciones.filter((y) => !y.startsWith('DATOS DE PRUEBA'))) avisos.push(x);
    const verif = res.idTarea ? (res.confirmada ? 'Verificado: se recalculó y coincide (huella).' : 'TERMINÓ, PERO NO CONSTA CONFIRMACIÓN: el recálculo no coincide.') : 'Sin verificación (no se registró tarea).';
    return { categoria: capId === '07.revisar-texto-publicitario' ? 'consulta' : 'propuesta', estado: 'respondida', texto: `[${capId === '07.revisar-texto-publicitario' ? 'lectura' : 'propuesta'} · no publico, no envío nada, no invierto ni modifico contenido] ${l.join('\n')}\n${avisos.map((x) => `⚠ ${x}`).join('\n')}\n${verif}`, tareas, aprobaciones: [], avisos, afirmaciones: [{ texto: `Informe ${informe.idEjecucion}`, procedencia: `${informe.fuente.sistema} · ${informe.fuente.origenDatos}` }] };
  }

  // ── Agente 08 (contenido y recursos visuales): L1 de borradores y L0 de revisión; fuentes POR PARÁMETRO; nada se publica, genera, sube ni modifica ─────────────────────────────────
  _leerContenido(capId, parametros) {
    const motor = this.motorContenido;
    if (!motor) throw new ErrorProtocolo('origen_no_disponible', 'Las funciones existentes de contenido no están cargadas: no se puede proponer.');
    if (!this.rutaFuentesContenido) throw new ErrorProtocolo('origen_no_disponible', 'No hay fuentes de referencia (fichas y categorías) aportadas por parámetro: no consta nada sobre lo que redactar.');
    let datos;
    try { datos = JSON.parse(fs.readFileSync(this.rutaFuentesContenido, 'utf8')); } catch { throw new ErrorProtocolo('origen_no_disponible', 'No se pudieron leer las fuentes de referencia de contenido.'); }
    const sintetico = datos.sintetico !== false;
    const fuentes = { productos: Array.isArray(datos.productos) ? datos.productos : [], categorias: Array.isArray(datos.categorias) ? datos.categorias : [], retiradas: Array.isArray(datos.retiradas) ? datos.retiradas : [] };
    const ahora = this.ahora();
    const carga = { sintetico, descartadas: [], leidas: fuentes.productos.length };
    const sufijo = capId.split('.')[1];
    const envolver = (piezas, extra = {}) => { const { informe } = informeContenido({ piezas, ahora, sintetico, capacidad: capId }); return { informe, datos: informe, extra: { piezas, ...extra }, carga, ids: [informe.idEjecucion] }; };
    const sin = (motivo, extra) => ({ informe: null, datos: null, motivo, extra, carga, ids: [] });
    if (sufijo === 'proponer-borrador-ficha' || sufijo === 'proponer-recursos-visuales') {
      const b = buscarProducto(fuentes.productos, parametros.producto);
      if (!b.producto) return sin(b.motivo, { ...b, pedido: String(parametros.producto ?? ''), tipo: 'producto' });
      return envolver([sufijo === 'proponer-borrador-ficha' ? borradorFicha({ motor, producto: b.producto, sintetico, ahora }) : proponerRecursosVisuales({ motor, producto: b.producto, sintetico })]);
    }
    if (sufijo === 'proponer-borrador-historia' || sufijo === 'proponer-borrador-redes') {
      const informes = [this._ultimoInforme05, this._ultimoInforme10].filter(Boolean);
      const plan = planificarCampanas({ motor: motor.marketing, fuentes, informes, ahora, sintetico });
      const c = buscarCampana(plan.campanas, parametros.campana);
      if (!c.campana) return sin(c.motivo, { ...c, pedido: String(parametros.campana ?? ''), tipo: 'campana' });
      const brief = redactarBrief({ motor: motor.marketing, campana: c.campana, fuentes, ahora });
      return envolver([sufijo === 'proponer-borrador-historia' ? borradorHistoria({ motor, brief, fuentes, sintetico }) : borradorPostsRedes({ motor, brief, fuentes })], { campana: c.campana });
    }
    if (sufijo === 'revisar-pieza') {
      const texto = this._leerEntrada(parametros.textoRef);
      return envolver([piezaAportada({ motor, texto, imagenes: parametros.imagenUrl ? [String(parametros.imagenUrl).slice(0, 300)] : [], fuentes, sintetico })]);
    }
    throw new ErrorProtocolo('capacidad_desconocida', `Sin lector para ${capId}.`);
  }

  _respContenido(res, capId) {
    const tareas = res.idTarea ? [res.idTarea] : [];
    if (res.estado === 'fallida') return { categoria: 'consulta', estado: 'fallida', texto: `No he podido completarlo: ${res.error.mensaje} [${res.error.codigo}] No consta ningún resultado; no afirmo nada.`, tareas, aprobaciones: [], avisos: [], afirmaciones: [] };
    if (res.sinDatos) {
      const ex = res.lectura.extra || {};
      return { categoria: 'consulta', estado: 'aclaracion', texto: `No encuentro una única ${ex.tipo === 'campana' ? 'campaña' : 'ficha'} «${ex.pedido ?? ''}» (${res.lectura.motivo}).${ex.disponibles && ex.disponibles.length ? ` Disponibles: ${ex.disponibles.join(', ')}.` : ''}`, tareas, aprobaciones: [], avisos: [], afirmaciones: [] };
    }
    const informe = res.lectura.informe;
    const piezas = res.lectura.extra.piezas;
    const R = informe.resumen;
    const l = [];
    const lectura = capId === '08.revisar-pieza';
    for (const pz of piezas) {
      if (pz.tipo === 'ficha') {
        const d = pz.elementos.find((e) => e.campo === 'descripcion');
        l.push(pz.estado === 'no_redactable' ? `Ficha ${pz.producto}: no redactable (${pz.motivo}).` : `Borrador de ficha ${pz.producto} (no publicado; la revisa una persona): «${d ? d.valor : ''}»`);
        for (const x of pz.pendientes || []) l.push(`  · Pendiente: ${x}`);
      } else if (pz.tipo === 'recursos_visuales') {
        l.push(`Recursos visuales de ${pz.producto}: ${pz.imagenes.length} imagen(es).`);
        for (const i of pz.imagenes) l.push(`  · ${i.origen}${i.seguraParaWeb ? '' : ' (URL NO segura)'}: derechos ${i.derechos}`);
        if (pz.promptPropuesto) l.push('  · Prompt de imagen PROPUESTO (no generado; generar exige tu autorización y consume crédito de IA).');
        l.push('  · Vídeo: no disponible.');
      } else if (pz.tipo === 'historia') {
        l.push(pz.estado === 'no_redactable' ? `Historia: no redactable (${pz.motivo}).` : `Borrador de historia «${pz.historia.name}» (${pz.historia.screens.length} pantalla(s), estado borrador, no publicada).`);
        for (const o of pz.omitidas || []) l.push(`  · Omitido ${o.producto}: ${o.motivo}`);
      } else if (pz.tipo === 'posts_redes') {
        l.push(pz.posts.length ? `${pz.posts.length} borrador(es) de publicación para redes (no publicados; con divulgación de afiliación y enlace pendiente).` : 'No hay mensajes verificados para redactar publicaciones.');
        for (const x of pz.posts.slice(0, 2)) l.push(`  – ${x.texto}`);
        for (const o of pz.omitidos || []) l.push(`  · Omitido ${o.producto}: ${o.motivo}`);
      } else if (pz.tipo === 'pieza_aportada') {
        const probs = pz.revision.problemas;
        l.push(probs.length ? `Revisión de la pieza: ${probs.length} problema(s) de texto.` : 'Revisión de la pieza: sin problemas de texto con estas reglas (no sustituye a una revisión legal).');
        for (const x of probs) l.push(`  · ${x.regla.replace(/_/g, ' ')}: «${x.fragmento}» → ${x.accion}`);
        for (const i of pz.imagenes) l.push(`  · Imagen ${i.origen}${i.seguraParaWeb ? '' : ' (URL NO segura)'}: derechos ${i.derechos}`);
      }
    }
    l.push(`Resumen: ${R.piezas} pieza(s), ${R.piezasConProblemas} con problemas, ${R.imagenesDerechosPendientes} imagen(es) con derechos pendientes de verificar; aprobadas por una persona: no consta (0).`);
    const avisos = [];
    if (res.lectura.carga.sintetico) avisos.push('DATOS DE PRUEBA (sintéticos): fichas, imágenes y briefs no reflejan la producción.');
    for (const x of informe.limitaciones.filter((y) => !y.startsWith('DATOS DE PRUEBA'))) avisos.push(x);
    const verif = res.idTarea ? (res.confirmada ? 'Verificado: se recalculó y coincide (huella).' : 'TERMINÓ, PERO NO CONSTA CONFIRMACIÓN: el recálculo no coincide.') : 'Sin verificación (no se registró tarea).';
    return { categoria: lectura ? 'consulta' : 'propuesta', estado: 'respondida', texto: `[${lectura ? 'lectura' : 'propuesta'} · no publico, no genero imágenes, no subo nada ni modifico contenido real] ${l.join('\n')}\n${avisos.map((x) => `⚠ ${x}`).join('\n')}\n${verif}`, tareas, aprobaciones: [], avisos, afirmaciones: [{ texto: `Informe ${informe.idEjecucion}`, procedencia: `${informe.fuente.sistema} · ${informe.fuente.origenDatos}` }] };
  }

  // ── Agente 09 (competencia y expertos): L0 de validación y L1 de informes; las observaciones llegan POR PARÁMETRO; el agente no accede a webs ni a fuentes externas ────────────────────
  _leerCompetencia(capId, parametros) {
    const motor = this.motorCompetencia;
    if (!motor) throw new ErrorProtocolo('origen_no_disponible', 'Las funciones existentes de análisis comercial no están cargadas: no se puede analizar.');
    if (!this.rutaObservaciones) throw new ErrorProtocolo('origen_no_disponible', 'No hay observaciones aportadas por parámetro: no consta nada sobre competidores ni expertos y no consulto ninguna web.');
    let datos;
    try { datos = JSON.parse(fs.readFileSync(this.rutaObservaciones, 'utf8')); } catch { throw new ErrorProtocolo('origen_no_disponible', 'No se pudieron leer las observaciones aportadas.'); }
    let propias = { productos: [], categorias: [] };
    if (this.rutaFuentesMarketing) { try { const f = JSON.parse(fs.readFileSync(this.rutaFuentesMarketing, 'utf8')); propias = { productos: Array.isArray(f.productos) ? f.productos : [], categorias: Array.isArray(f.categorias) ? f.categorias : [] }; } catch { /* sin fuentes propias: las comparaciones de precio se declaran no comparables */ } }
    const sintetico = datos.sintetico !== false;
    const modo = { 'validar-observaciones': 'validacion', 'detectar-huecos': 'huecos', 'comparar-precios-observados': 'precios', 'proponer-informe-competencia': 'completo' }[capId.split('.')[1]];
    if (!modo) throw new ErrorProtocolo('capacidad_desconocida', `Sin lector para ${capId}.`);
    const r = informeCompetencia({ motor, datos, fuentes: propias, informes: [this._ultimoInforme10].filter(Boolean), modo, ahora: this.ahora(), sintetico, capacidad: capId });
    const carga = { sintetico, descartadas: [], leidas: r.validacion.observaciones.length };
    return { informe: r.informe, datos: r.informe, extra: r, carga, ids: [r.informe.idEjecucion] };
  }

  _respCompetencia(res, capId) {
    const tareas = res.idTarea ? [res.idTarea] : [];
    if (res.estado === 'fallida') return { categoria: 'consulta', estado: 'fallida', texto: `No he podido completarlo: ${res.error.mensaje} [${res.error.codigo}] No consta ningún resultado; no afirmo nada ni consulto ninguna web.`, tareas, aprobaciones: [], avisos: [], afirmaciones: [] };
    const informe = res.lectura.informe;
    const R = informe.resumen;
    const por = (regla) => informe.hallazgos.filter((x) => x.regla === regla);
    const l = [];
    const lectura = capId === '09.validar-observaciones';
    l.push(`Observaciones aportadas: ${R.fuentes} fuente(s) (${R.fuentesUtilizables} utilizables), ${R.observaciones} observación(es): ${R.hechosVerificados} hecho(s) verificado(s) por una persona, ${R.observacionesNoVerificadas} sin verificar, ${R.estimaciones} estimación(es), ${R.noDisponibles} no disponible(s); ${R.observacionesExcluidas} excluida(s) de las conclusiones y ${R.datosRechazados} dato(s) rechazado(s).`);
    if (['09.validar-observaciones', '09.proponer-informe-competencia'].includes(capId)) {
      for (const x of por('terminos_de_uso_pendientes')) l.push(`· Términos de uso SIN revisar (${x.evidencia.nombre}): sus observaciones no entran en ninguna conclusión.`);
      for (const x of por('fuente_caducada')) l.push(`· Fuente caducada (${x.evidencia.nombre}, ${x.evidencia.edadDias} días).`);
      for (const x of por('dato_rechazado')) l.push(`· Rechazado ${x.elemento}: ${x.evidencia.motivo}`);
      for (const x of por('contenido_anomalo')) l.push(`· Contenido anómalo en ${x.elemento}: se cita como dato, no se obedece.`);
    }
    if (['09.detectar-huecos', '09.proponer-informe-competencia'].includes(capId)) {
      for (const x of por('hueco_detectado')) l.push(`· HIPÓTESIS de hueco «${x.elemento}»: citado por ${x.evidencia.nFuentes} fuentes (${x.evidencia.fuentes.map((y) => `${y.fuente} ${y.observadaEn}`).join('; ')}); validar con una persona antes de planificar contenido.`);
      for (const x of por('hueco_senal_debil')) l.push(`· Señal débil «${x.elemento}»: ${x.accionSugerida}`);
      for (const x of por('practica_observada')) l.push(`· Práctica observada (${x.evidencia.fuente}, ${x.evidencia.observadaEn}): ${x.evidencia.resumen} — requiere validación.`);
    }
    if (['09.comparar-precios-observados', '09.proponer-informe-competencia'].includes(capId)) {
      for (const x of por('brecha_de_precio_observada')) l.push(`· ${x.evidencia.texto} Diferencia ${x.evidencia.diferenciaEur} € (${x.evidencia.diferenciaPct} %); es un dato fechado, no una conclusión sobre ventaja comercial.`);
      for (const x of por('precio_no_comparable')) l.push(`· Precio ${x.elemento} NO comparable: ${x.evidencia.razones.join(', ')}.`);
    }
    l.push('· NO disponible: huecos explotados, cuota de mercado o tráfico de competidores, y cualquier dato no aportado.');
    const avisos = [];
    if (res.lectura.carga.sintetico) avisos.push('DATOS DE PRUEBA (sintéticos): fuentes, competidores y observaciones no existen.');
    for (const x of informe.limitaciones.filter((y) => !y.startsWith('DATOS DE PRUEBA'))) avisos.push(x);
    const verif = res.idTarea ? (res.confirmada ? 'Verificado: se recalculó y coincide (huella).' : 'TERMINÓ, PERO NO CONSTA CONFIRMACIÓN: el recálculo no coincide.') : 'Sin verificación (no se registró tarea).';
    return { categoria: lectura ? 'consulta' : 'propuesta', estado: 'respondida', texto: `[${lectura ? 'lectura' : 'propuesta'} · solo informe: no accedo a ninguna web, no copio contenido y no cambio precios ni contenido] ${l.join('\n')}\n${avisos.map((x) => `⚠ ${x}`).join('\n')}\n${verif}`, tareas, aprobaciones: [], avisos, afirmaciones: [{ texto: `Informe ${informe.idEjecucion}`, procedencia: `${informe.fuente.sistema} · ${informe.fuente.origenDatos}` }] };
  }

  // ── Agente 01 (investigador): candidatos e hipótesis comerciales con la lógica EXISTENTE (researcher.mjs); feed del catálogo POR PARÁMETRO; solo propone ─────────────────────────────
  _leerInvestigador(capId) {
    if (!this.rutaFeedInvestigador) throw new ErrorProtocolo('origen_no_disponible', 'No hay un feed del catálogo aportado por parámetro: no consta ningún producto que analizar y no consulto el catálogo real.');
    let feed; let cfg;
    try { feed = JSON.parse(fs.readFileSync(this.rutaFeedInvestigador, 'utf8')); } catch { throw new ErrorProtocolo('origen_no_disponible', 'No se pudo leer el feed del catálogo aportado.'); }
    try { cfg = JSON.parse(fs.readFileSync(new URL('../config/local.json', import.meta.url), 'utf8')); } catch { throw new ErrorProtocolo('origen_no_disponible', 'No se pudo leer la configuración del investigador.'); }
    const sintetico = feed.sintetico !== false;
    const r = investigarCandidatos({ feed, cfg, ahora: this.ahora(), sintetico, capacidad: capId });
    return { informe: r.informe, datos: r.informe, extra: r, carga: { sintetico, descartadas: [], leidas: r.informe.resumen.productos }, ids: [r.informe.idEjecucion] };
  }

  _respInvestigador(res) {
    const tareas = res.idTarea ? [res.idTarea] : [];
    if (res.estado === 'fallida') return { categoria: 'consulta', estado: 'fallida', texto: `No he podido completarlo: ${res.error.mensaje} [${res.error.codigo}] No consta ningún resultado; no afirmo ninguna tendencia.`, tareas, aprobaciones: [], avisos: [], afirmaciones: [] };
    const informe = res.lectura.informe;
    const R = informe.resumen;
    const por = (regla) => informe.hallazgos.filter((x) => x.regla === regla);
    const l = [];
    l.push(`Candidatos e hipótesis comerciales (v0 de reglas sobre el feed aportado; NO son tendencias ni recomendaciones): ${R.candidatos} candidato(s) de ${R.candidatosElegibles} elegibles entre ${R.productos} producto(s).`);
    for (const x of por('candidato_comercial').slice(0, 5)) l.push(`· ${x.evidencia.titulo} (${x.evidencia.categoria}): descuento DECLARADO ${x.evidencia.descuentoDeclaradoPct} % (${x.evidencia.precioAnteriorDeclarado} → ${x.evidencia.precio} €), puntuación ${x.evidencia.puntuacion}, confianza ${x.evidencia.confianza}; NO verificado.`);
    for (const x of por('descuento_declarado_sospechoso')) l.push(`· Descuento poco creíble: ${x.evidencia.titulo} (${x.evidencia.descuentoDeclaradoPct} % declarado); no destacarlo sin verificarlo.`);
    if (R.fichasConDatosFaltantes) l.push(`· ${R.fichasConDatosFaltantes} ficha(s) con datos que faltan; ${R.categoriasConPocosProductos} categoría(s) con pocos productos; ${R.duplicadosProbables} posible(s) duplicado(s).`);
    l.push('· NO disponible: tendencias temporales, descuentos verificados, ventas, valoraciones, demanda. Un candidato lo decide una persona; importar es L4.');
    const avisos = [];
    if (res.lectura.carga.sintetico) avisos.push('DATOS DE PRUEBA (sintéticos): el feed no refleja la producción.');
    for (const x of informe.limitaciones.filter((y) => !y.startsWith('DATOS DE PRUEBA'))) avisos.push(x);
    const verif = res.idTarea ? (res.confirmada ? 'Verificado: se recalculó y coincide (huella).' : 'TERMINÓ, PERO NO CONSTA CONFIRMACIÓN: el recálculo no coincide.') : 'Sin verificación (no se registró tarea).';
    return { categoria: 'propuesta', estado: 'respondida', texto: `[propuesta · no importo nada, no cambio precios ni fichas] ${l.join('\n')}\n${avisos.map((x) => `⚠ ${x}`).join('\n')}\n${verif}`, tareas, aprobaciones: [], avisos, afirmaciones: [{ texto: `Informe ${informe.idEjecucion}`, procedencia: `${informe.fuente.sistema} · ${informe.fuente.origenDatos}` }] };
  }

  // ── Agente 11 (webs nicho): L1 de estudio en borrador; nichos, demanda y costes POR PARÁMETRO; usa los informes de los Agentes 02, 09 y 10; no crea webs ni compra dominios ─────────
  _leerNichos(capId) {
    const motor = this.motorNichos;
    if (!motor) throw new ErrorProtocolo('origen_no_disponible', 'Las funciones existentes no están cargadas: no se puede estudiar ningún nicho.');
    if (!this.rutaNichos) throw new ErrorProtocolo('origen_no_disponible', 'No hay nichos aportados por parámetro: no consta ningún nicho ni dato de demanda o coste, y no consulto ninguna fuente.');
    let datos;
    try { datos = JSON.parse(fs.readFileSync(this.rutaNichos, 'utf8')); } catch { throw new ErrorProtocolo('origen_no_disponible', 'No se pudieron leer los nichos aportados.'); }
    const nichos = Array.isArray(datos.nichos) ? datos.nichos : [];
    const sintetico = datos.sintetico !== false;
    const ahora = this.ahora();
    let propias = { productos: [], categorias: [] };
    if (this.rutaFuentesMarketing) { try { const f = JSON.parse(fs.readFileSync(this.rutaFuentesMarketing, 'utf8')); propias = { productos: Array.isArray(f.productos) ? f.productos : [], categorias: Array.isArray(f.categorias) ? f.categorias : [] }; } catch { /* sin catálogo de referencia */ } }
    // Informes de apoyo: se generan con los módulos EXISTENTES de los Agentes 02 y 09 (sin duplicar su lógica) y con el último informe del 10 ya registrado.
    const afiliacionPorNicho = {};
    if (this.rutaAfiliacion) {
      try {
        const ds = cargarDatasetAfiliacion(this.rutaAfiliacion);
        for (const n of nichos) { if (!n || !n.id || !n.categoriaAfiliacion) continue; const r = compararProgramas(ds, { categoria: n.categoriaAfiliacion, ahora }); if (r.ranking.length || r.sinComision.length) afiliacionPorNicho[n.id] = r.informe; }
      } catch { /* sin datos de afiliación: la dimensión se declara no disponible */ }
    }
    let competencia = null;
    if (this.motorCompetencia && this.rutaObservaciones) {
      try { const obs = JSON.parse(fs.readFileSync(this.rutaObservaciones, 'utf8')); competencia = informeCompetencia({ motor: this.motorCompetencia, datos: obs, fuentes: propias, informes: [this._ultimoInforme10].filter(Boolean), modo: 'completo', ahora, sintetico: obs.sintetico !== false }).informe; } catch { /* sin observaciones: la dimensión se declara no disponible */ }
    }
    const modo = capId === '11.analizar-oportunidades-nicho' ? 'oportunidades' : 'viabilidad';
    const r = informeNichos({ motor, nichos, fuentes: propias, informes: { afiliacionPorNicho, competencia, analitica: this._ultimoInforme10 }, modo, ahora, sintetico, capacidad: capId });
    const carga = { sintetico, descartadas: [], leidas: nichos.length };
    return { informe: r.informe, datos: r.informe, extra: r, carga, ids: [r.informe.idEjecucion] };
  }

  _respNichos(res, capId) {
    const tareas = res.idTarea ? [res.idTarea] : [];
    if (res.estado === 'fallida') return { categoria: 'consulta', estado: 'fallida', texto: `No he podido completarlo: ${res.error.mensaje} [${res.error.codigo}] No consta ningún resultado; no invento demanda, tráfico ni ingresos.`, tareas, aprobaciones: [], avisos: [], afirmaciones: [] };
    const informe = res.lectura.informe;
    const { estudios, ranking } = res.lectura.extra;
    const R = informe.resumen;
    const l = [];
    l.push(`${R.nichos} nicho(s) estudiado(s): evidencia razonable ${R.nichosEvidenciaRazonable}, parcial ${R.nichosEvidenciaParcial}, insuficiente ${R.nichosEvidenciaInsuficiente}. Estudios con decisión del propietario: ${R.estudiosConDecision} (no consta ninguna).`);
    l.push(`Orden por MADUREZ DE LA EVIDENCIA (no por beneficio previsto): ${ranking.map((x) => `${x.nombre} (${x.nivel})`).join(' › ') || 'sin nichos'}.`);
    for (const e of estudios) {
      l.push(`· ${e.nombre}: ${Object.entries(e.dimensiones).map(([k, v]) => `${k} ${v.estado}`).join(', ')}.`);
      if (capId === '11.estudiar-viabilidad-nicho') {
        l.push(`  Hipótesis (NO demostradas): ${e.hipotesis.map((x) => x.texto).join(' | ')}`);
        if (e.dimensiones.coste.totalAportadoEur !== null) l.push(`  Coste aportado: ${e.dimensiones.coste.totalAportadoEur} €${e.dimensiones.coste.totalCompleto ? '' : ' (PARCIAL: faltan datos; no es el coste del proyecto)'}.`);
      }
      const graves = e.riesgos.filter((x) => x.severidad !== 'info').slice(0, 3);
      if (graves.length) l.push(`  Riesgos: ${graves.map((x) => x.codigo.replace(/_/g, ' ')).join(', ')}.`);
    }
    l.push('· NO disponible: ingresos y rentabilidad, tráfico potencial y cualquier demanda no aportada por una persona. La decisión sobre cada nicho es del propietario.');
    const avisos = [];
    if (res.lectura.carga.sintetico) avisos.push('DATOS DE PRUEBA (sintéticos): nichos, demanda, costes y observaciones no existen.');
    for (const x of informe.limitaciones.filter((y) => !y.startsWith('DATOS DE PRUEBA'))) avisos.push(x);
    const verif = res.idTarea ? (res.confirmada ? 'Verificado: se recalculó y coincide (huella).' : 'TERMINÓ, PERO NO CONSTA CONFIRMACIÓN: el recálculo no coincide.') : 'Sin verificación (no se registró tarea).';
    return { categoria: 'propuesta', estado: 'respondida', texto: `[propuesta · estudio en borrador: no creo webs, no compro dominios, no publico ni activo campañas] ${l.join('\n')}\n${avisos.map((x) => `⚠ ${x}`).join('\n')}\n${verif}`, tareas, aprobaciones: [], avisos, afirmaciones: [{ texto: `Informe ${informe.idEjecucion}`, procedencia: `${informe.fuente.sistema} · ${informe.fuente.origenDatos}` }] };
  }

  // ── Agente 10 (analítica y conversión): lectura L0 de analítica AGREGADA con las funciones existentes; sin datos personales, sin escritura ───────────────
  _leerAnalitica(capId = '10.leer-analitica-agregada') {
    const motor = this.motorAnalitica;
    if (!motor) throw new ErrorProtocolo('origen_no_disponible', 'Las funciones existentes de analítica no están cargadas: no se puede analizar.');
    if (!this.rutaAnalitica) throw new ErrorProtocolo('origen_no_disponible', 'No hay una exportación de analítica agregada configurada: no consta ninguna visita ni clic que analizar.');
    let datos;
    try { datos = JSON.parse(fs.readFileSync(this.rutaAnalitica, 'utf8')); } catch { throw new ErrorProtocolo('origen_no_disponible', 'No se pudo leer la exportación de analítica.'); }
    const events = Array.isArray(datos) ? datos : Array.isArray(datos.events) ? datos.events : [];
    const sintetico = Array.isArray(datos) ? true : datos.sintetico !== false;
    const r = analizarAnalitica({ motor, datos: { events, productos: Array.isArray(datos) ? [] : datos.productos }, ahora: this.ahora(), sintetico, capacidad: capId });
    const carga = { sintetico, descartadas: [], leidas: events.length };
    if (!r.informe) return { informe: null, datos: null, motivo: r.motivo, extra: r, carga, ids: [] };
    this._ultimoInforme10 = r.informe;
    return { informe: r.informe, datos: r.informe, extra: r, carga, ids: [r.informe.idEjecucion] };
  }

  _respAnalitica(res) {
    const tareas = res.idTarea ? [res.idTarea] : [];
    if (res.estado === 'fallida') return { categoria: 'consulta', estado: 'fallida', texto: `No he podido leer la analítica: ${res.error.mensaje} [${res.error.codigo}] No consta ninguna cifra; no afirmo visitas, clics ni ventas.`, tareas, aprobaciones: [], avisos: [], afirmaciones: [] };
    if (res.sinDatos) return { categoria: 'consulta', estado: 'sin_datos', texto: 'La exportación de analítica no contiene eventos válidos: no consta ninguna visita, clic ni venta. No afirmo ninguna cifra.', tareas, aprobaciones: [], avisos: [], afirmaciones: [] };
    const informe = res.lectura.informe;
    const R = informe.resumen;
    const por = (regla) => informe.hallazgos.filter((x) => x.regla === regla || (regla.endsWith('*') && x.regla.startsWith(regla.slice(0, -1))));
    const o = por('origen_de_los_datos')[0].evidencia;
    const l = [];
    l.push(`Analítica agregada (${o.ventanaActual.desde} → ${o.ventanaActual.hasta} frente a ${o.ventanaAnterior.desde} → ${o.ventanaAnterior.hasta}); ${R.eventos} eventos leídos.`);
    if (R.tasaClicSalidaActualPct !== null) l.push(`· Sesiones ${R.sesionesActual} (antes ${R.sesionesAnterior}); tasa de clic a salida ${R.tasaClicSalidaActualPct} % de las sesiones${R.tasaClicSalidaAnteriorPct !== null ? ` (antes ${R.tasaClicSalidaAnteriorPct} %)` : ''}; salidas a tienda ${R.salidasActual}.`);
    for (const x of por('tendencia_*')) l.push(`· Tendencia (${x.evidencia.variacionPct !== undefined ? `${x.evidencia.variacionPct} %` : `${x.evidencia.variacionPuntos} puntos`}): ${x.regla.replace('tendencia_', '').replace(/_/g, ' ')} — describe el cambio medido, no su causa.`);
    for (const x of por('datos_insuficientes')) l.push(`· SIN CONCLUSIÓN (${x.elemento}): ${x.accionSugerida}`);
    for (const x of por('trafico_concentrado')) l.push(`· Tráfico concentrado: ${x.evidencia.porcentaje} % por ${x.evidencia.fuente}.`);
    for (const x of por('producto_alto_trafico_baja_salida')) l.push(`· ${x.evidencia.titulo}: ${x.evidencia.visitas} visitas y solo ${x.evidencia.tasaSalidaPct} % salen a tienda (media ${x.evidencia.tasaGlobalSalidaPct} %). Causa NO establecida.`);
    for (const x of por('producto_alta_salida_poco_trafico')) l.push(`· ${x.evidencia.titulo}: pocas visitas (${x.evidencia.visitas}) pero ${x.evidencia.tasaSalidaPct} % salen a tienda (media ${x.evidencia.tasaGlobalSalidaPct} %).`);
    for (const x of por('experimento_propuesto')) l.push(`· EXPERIMENTO PROPUESTO (lo aprueba y ejecuta una persona; sin efecto prometido): ${x.evidencia.titulo} — ${x.evidencia.hipotesis}; mide ${x.evidencia.metrica}.`);
    if (R.comprasDeclaradasActual > 0) l.push(`· Compras DECLARADAS por visitantes: ${R.comprasDeclaradasActual} (sin confirmación de la red; no son ventas verificadas).`);
    l.push('· NO disponible: ventas reales verificadas, ingresos y comisiones, conversión a venta, coste de adquisición, tasa por fuente o dispositivo.');
    const avisos = [];
    if (res.lectura.carga.sintetico) avisos.push('DATOS DE PRUEBA (sintéticos): no son visitas ni clics reales.');
    for (const x of informe.limitaciones.filter((y) => !y.startsWith('DATOS DE PRUEBA'))) avisos.push(x);
    const verif = res.idTarea ? (res.confirmada ? 'Verificado: el análisis se recalculó y coincide (huella).' : 'TERMINÓ, PERO NO CONSTA CONFIRMACIÓN: el recálculo no coincide.') : 'Sin verificación (no se registró tarea).';
    return { categoria: 'consulta', estado: 'respondida', texto: `[lectura de analítica agregada · sin datos personales, no modifico nada] ${l.join('\n')}\n${avisos.map((x) => `⚠ ${x}`).join('\n')}\n${verif}`, tareas, aprobaciones: [], avisos, afirmaciones: [{ texto: `Informe ${informe.idEjecucion}`, procedencia: `${informe.fuente.sistema} · ${informe.fuente.origenDatos}` }] };
  }

  /** Señales del último informe del Agente 10, sin datos personales, para que el Director las facilite a otros agentes (hoy solo se describen; no se integran en producción). */
  senalesAnalitica() { return senalesParaAgentes(this._ultimoInforme10); }

  // ── Agente 06 (portada, historias y categorías): propuesta L1 y guardado SIMULADO (L3 reversible) en un área privada; nunca publica ni toca la portada real ───────────────
  _guardarPropuesta(propuesta) {
    const ref = sha256(canonico(propuesta));
    this._propuestas.set(ref, propuesta);
    this._ultimaPropuesta = ref;
    try {
      if (this.ledger && this.ledger.dir) {
        const dir = path.join(this.ledger.dir, 'propuestas');
        fs.mkdirSync(dir, { recursive: true });
        const f = path.join(dir, `${ref.slice(7)}.json`);
        if (!fs.existsSync(f)) fs.writeFileSync(f, JSON.stringify(propuesta), 'utf8');
        fs.writeFileSync(path.join(dir, 'ultima.txt'), ref, 'utf8');
      }
    } catch { /* la copia en disco es una comodidad entre procesos */ }
    return ref;
  }

  _leerPropuesta(ref) {
    let p = this._propuestas.get(ref);
    if (p === undefined && this.ledger && this.ledger.dir && /^sha256:[0-9a-f]{64}$/.test(String(ref))) {
      try { p = JSON.parse(fs.readFileSync(path.join(this.ledger.dir, 'propuestas', `${String(ref).slice(7)}.json`), 'utf8')); } catch { p = undefined; }
    }
    if (p === undefined) throw new ErrorProtocolo('origen_no_disponible', 'No consta la propuesta de portada indicada (pide antes una propuesta).');
    if (sha256(canonico(p)) !== ref) throw new ErrorProtocolo('origen_no_disponible', 'La propuesta guardada no coincide con su huella (alterada).');
    return p;
  }

  _ultimaPropuestaRef() {
    if (this._ultimaPropuesta) return this._ultimaPropuesta;
    try { if (this.ledger && this.ledger.dir) return fs.readFileSync(path.join(this.ledger.dir, 'propuestas', 'ultima.txt'), 'utf8').trim() || null; } catch { /* sin propuesta previa */ }
    return null;
  }

  _datosPortada() {
    if (!this.motorPortada) throw new ErrorProtocolo('origen_no_disponible', 'Las funciones existentes de portada no están cargadas: no se puede proponer.');
    if (!this.rutaDatosPortada) throw new ErrorProtocolo('origen_no_disponible', 'No hay datos de referencia de catálogo y categorías: no consta nada sobre lo que proponer.');
    let datos;
    try { datos = JSON.parse(fs.readFileSync(this.rutaDatosPortada, 'utf8')); } catch { throw new ErrorProtocolo('origen_no_disponible', 'No se pudieron leer los datos de referencia de portada.'); }
    return datos;
  }

  _leerPortada(capId, parametros) {
    const datos = this._datosPortada();
    const sintetico = datos.sintetico !== false;
    const fuentes = construirFuentesPortada(this.motorPortada, datos);
    const informes = [this._ultimoInforme05, this._ultimoInforme10].filter(Boolean);
    const r = proponerPortada({ motor: this.motorPortada, fuentes, productosBrutos: datos.productos || [], informes, ahora: this.ahora(), sintetico, capacidad: capId });
    const ref = this._guardarPropuesta(r.propuesta);
    return { informe: r.informe, datos: r.informe, extra: { ...r, propuestaRef: ref }, carga: { sintetico, descartadas: [], leidas: fuentes.products.size }, ids: [r.informe.idEjecucion] };
  }

  _respPortada(res) {
    const tareas = res.idTarea ? [res.idTarea] : [];
    if (res.estado === 'fallida') return { categoria: 'consulta', estado: 'fallida', texto: `No he podido preparar la propuesta de portada: ${res.error.mensaje} [${res.error.codigo}] No consta ninguna propuesta.`, tareas, aprobaciones: [], avisos: [], afirmaciones: [] };
    const informe = res.lectura.informe;
    const R = informe.resumen;
    const por = (regla) => informe.hallazgos.filter((x) => x.regla === regla);
    const l = [];
    l.push(`Propuesta de portada: ${R.bloques} bloque(s) (${R.bloquesVisibles} se mostrarían, ${R.bloquesOcultos} no) y ${R.historias} historia(s) como BORRADOR; ${R.propuestasCategorias} propuesta(s) sobre categorías.`);
    for (const x of por('bloque_propuesto')) l.push(`· Bloque «${x.evidencia.titulo ?? x.evidencia.id}» (${x.evidencia.formato}, ${x.evidencia.elementos ?? 0} elemento[s], origen ${x.evidencia.origen})${x.evidencia.visible === false ? ' — NO se mostraría con los datos actuales' : ''}.`);
    for (const x of por('incidencia_bloque').concat(por('incidencia_historia'))) l.push(`· Incidencia [${x.evidencia.severidad}] en ${x.elemento}: ${x.evidencia.mensaje}`);
    for (const x of por('historia_omitida')) l.push(`· Historia «${x.evidencia.nombre}» omitida: ${x.evidencia.motivo}.`);
    for (const x of por('propuesta_categoria')) l.push(`· Categorías (propuesta informativa): ${x.evidencia.texto}`);
    const avisos = [];
    if (res.lectura.carga.sintetico) avisos.push('DATOS DE PRUEBA (sintéticos): el catálogo, las categorías y las imágenes no reflejan la producción.');
    for (const x of informe.limitaciones.filter((y) => !y.startsWith('DATOS DE PRUEBA'))) avisos.push(x);
    for (const x of por('suposicion')) avisos.push(`Suposición: ${x.evidencia.texto}`);
    const verif = res.idTarea ? (res.confirmada ? 'Verificado: la propuesta se recalculó y coincide (huella).' : 'TERMINÓ, PERO NO CONSTA CONFIRMACIÓN: el recálculo no coincide.') : 'Sin verificación (no se registró tarea).';
    return { categoria: 'propuesta', estado: 'respondida', texto: `[propuesta informativa · no guardo, no publico ni activo nada] ${l.join('\n')}\n${avisos.map((x) => `⚠ ${x}`).join('\n')}\n${verif}\nReferencia de la propuesta: ${res.lectura.extra.propuestaRef}. Para simular guardarla como borrador (con copia previa y deshacer): «guarda la propuesta como borrador» (L3, requiere aprobación). Publicar o activar es L4 humano.`, tareas, aprobaciones: [], avisos, afirmaciones: [{ texto: `Informe ${informe.idEjecucion}`, procedencia: `${informe.fuente.sistema} · ${informe.fuente.origenDatos}` }] };
  }

  _atenderPortada(intencion, ctx) {
    if (intencion.tipo === 'proponer_portada') return this._respPortada(this.ejecutarPropuesta('06.proponer-portada', {}, ctx));
    const ref = (intencion.parametros && intencion.parametros.propuestaRef) || this._ultimaPropuestaRef();
    if (!ref) return { categoria: 'consulta', estado: 'aclaracion', texto: 'No hay ninguna propuesta de portada que guardar: pide antes «propón una portada» y después «guarda la propuesta como borrador».', tareas: [], aprobaciones: [], avisos: [], afirmaciones: [] };
    this._leerPropuesta(ref); // falla si no consta o fue alterada
    const r = this.solicitarEjecucion('06.guardar-borrador-portada', { propuestaRef: ref }, ctx);
    const a = r.aprobacion;
    let vista = '';
    try {
      const prop = this._leerPropuesta(ref);
      const estado = leerEstadoSandbox(this.motorPortada, dirSandbox(this.ledger && this.ledger.dir));
      const plan = planGuardarBorradorSimulado({ motor: this.motorPortada, estado, propuesta: prop, ahora: this.ahora() });
      vista = plan.ok ? ` Vista previa: ${plan.diff.length} cambio(s) de bloques sobre el borrador de la copia privada${plan.idCopia ? `; se conserva una copia previa (${plan.idCopia})` : '; el borrador anterior está vacío'}.` : ` Aviso: con el estado actual del área privada no se podría guardar (${plan.razon}).`;
    } catch { vista = ' No se pudo calcular la vista previa.'; }
    const texto = `${r.reutilizada ? 'Ya existía una solicitud pendiente idéntica. ' : ''}Requiere tu aprobación (${a.nivel}). ${a.resumen}${vista}\nEl guardado es SIMULADO: escribe solo en un área privada del Director (nunca en home-layout.json), antes guarda una copia del borrador anterior y se puede DESHACER. Publicar o activar la portada es L4 humano y no lo hago.`;
    return { categoria: 'pendiente', estado: 'esperando_aprobacion', texto, tareas: [r.idTarea], aprobaciones: [a.idAprobacion], avisos: r.aviso ? [r.aviso] : [], afirmaciones: [{ texto: 'La capacidad y su nivel proceden del registro', procedencia: `registro ${this.registro.version}` }] };
  }

  /** Ejecución LOCAL del guardado simulado tras la aprobación (simulada en F1): escribe SOLO en el área privada, con copia previa, evidencia y verificación por relectura. */
  _ejecutarBorradorLocal({ cap, a, sobre, idAprobacion }) {
    const version = { capacidad: cap.version };
    const idTarea = a.idTarea;
    const dir = dirSandbox(this.ledger && this.ledger.dir);
    this._emitir('delegacion_simulada', 'director', { idTarea, idAprobacion }, { claveIdempotencia: sobre.claveIdempotencia, enviado: false, ejecutor: 'local', motivo: 'escritura SIMULADA en el área privada del Director; no toca la portada real' }, version);
    if (this.indice) { this.indice.sincronizar(this.ledger); this.indice.guardar(); }
    this._emitir('tarea_estado', 'director', { idTarea }, { estado: 'en_curso' }, version);
    const fallar = (e) => {
      const error = e instanceof ErrorProtocolo ? e.error : crearError('interno', 'Fallo no clasificado al guardar el borrador simulado.');
      this._emitir('aprobacion_resuelta', 'sistema', { idAprobacion, idTarea }, { estado: 'consumida' });
      this._emitir('tarea_estado', 'director', { idTarea }, { estado: 'fallida', detalle: error.mensaje, error }, version);
      return { estado: 'fallida', idTarea, error };
    };
    let propuesta; let plan; let estado;
    try {
      if (!dir) throw new ErrorProtocolo('origen_no_disponible', 'No hay un área privada donde guardar (el ledger no tiene directorio).');
      propuesta = this._leerPropuesta(sobre.parametros.propuestaRef);
      estado = leerEstadoSandbox(this.motorPortada, dir);
      if (!estado.backupsLegible) throw new ErrorProtocolo('origen_no_disponible', 'Las copias previas del área privada no son legibles: se conservan sin sobrescribir.');
      plan = planGuardarBorradorSimulado({ motor: this.motorPortada, estado, propuesta, ahora: this.ahora() });
      if (!plan.ok) throw new ErrorProtocolo('solicitud_invalida', `No se puede guardar el borrador simulado: ${plan.razon}${plan.errores && plan.errores.length ? ` (${plan.errores.slice(0, 2).join('; ')})` : ''}.`);
      escribirPlan(dir, plan);
      guardarUndo(dir, { idTarea, idCopia: plan.idCopia, anteriorVacio: plan.borradorAnteriorVacio, historiasAnteriores: estado.historias.doc, propuestaRef: sobre.parametros.propuestaRef, guardadoEn: ISO(this.ahora()) });
    } catch (e) { return fallar(e); }
    const hashBloques = sha256(canonico(plan.layout.draft.blocks));
    this._emitir('respuesta_recibida', 'agente:06', { idTarea }, { estado: 'completada', hayDatos: true, referencias: [sobre.parametros.propuestaRef], huella: hashBloques, consumo: { llamadasApi: 0, ia: 0 } }, version);
    const idEvidencia = this.ids.nuevo('v');
    this._emitir('evidencia', 'director', { idTarea, idEvidencia }, { tipo: 'informe', referencia: `sandbox-portada/layout.json#${plan.revision}`, hash: hashBloques, capturadaEn: ISO(this.ahora()), origen: 'area_privada_simulada' }, version);
    let confirmada = false;
    try {
      const otra = leerEstadoSandbox(this.motorPortada, dir);
      confirmada = otra.layout.status === 'ok' && sha256(canonico(otra.layout.doc.draft.blocks)) === hashBloques && sha256(canonico(otra.layout.doc.draft.blocks)) === sha256(canonico(propuesta.blocks));
    } catch { confirmada = false; }
    this._emitir('verificacion', 'director', { idTarea, idEvidencia }, { metodo: 'comparar_hash', resultado: confirmada ? 'confirmada' : 'no_confirmada', en: ISO(this.ahora()), por: 'director' }, version);
    this._emitir('aprobacion_resuelta', 'sistema', { idAprobacion, idTarea }, { estado: 'consumida' });
    if (confirmada) this._emitir('tarea_estado', 'director', { idTarea }, { estado: 'completada' }, version);
    else this._emitir('tarea_estado', 'director', { idTarea }, { estado: 'parcial', detalle: 'resultado_no_confirmado', error: crearError('resultado_no_confirmado', 'Terminó, pero no consta confirmación: la relectura no coincide.') }, version);
    const texto = `[guardado SIMULADO · solo en el área privada del Director; no se publica ni se activa nada] Borrador de ${propuesta.blocks.length} bloque(s) y ${propuesta.stories.length} historia(s) guardado (${plan.diff.length} cambio(s) de bloques; copia previa: ${plan.idCopia ?? 'ninguna, el borrador anterior estaba vacío'}). ${confirmada ? 'Verificado: se releyó y coincide con la propuesta.' : 'TERMINÓ, PERO NO CONSTA CONFIRMACIÓN: la relectura no coincide.'} Para deshacerlo: «deshaz el borrador de portada» (acción del propietario).`;
    return { estado: 'ejecutada_local', idTarea, confirmada, texto, claveIdempotencia: sobre.claveIdempotencia, idCopia: plan.idCopia, huellaBorrador: hashBloques };
  }

  /** DESHACER el último guardado simulado (acción del propietario, no de un agente): restaura la copia previa o deja el borrador vacío; queda en el ledger. */
  deshacerBorradorPortada(ctx = {}) {
    const dir = dirSandbox(this.ledger && this.ledger.dir);
    if (!this.motorPortada || !dir) throw new ErrorProtocolo('origen_no_disponible', 'No hay área privada de portada donde deshacer.');
    if (this._paradaActiva()) throw new ErrorProtocolo('parada_emergencia', 'Parada de emergencia activa: no se modifica nada hasta reanudar.');
    const undo = leerUndo(dir);
    if (!undo) throw new ErrorProtocolo('origen_no_disponible', 'No consta ningún guardado simulado que deshacer.');
    const estado = leerEstadoSandbox(this.motorPortada, dir);
    if (!estado.backupsLegible) throw new ErrorProtocolo('origen_no_disponible', 'Las copias previas no son legibles: se conservan sin sobrescribir.');
    const plan = planDeshacerBorradorSimulado({ motor: this.motorPortada, estado, idCopia: undo.idCopia, anteriorVacio: undo.anteriorVacio, historiasAnteriores: undo.historiasAnteriores, ahora: this.ahora(), por: ctx.por || this.config.propietario });
    if (!plan.ok) throw new ErrorProtocolo('solicitud_invalida', `No se puede deshacer: ${plan.razon}${plan.errores && plan.errores.length ? ` (${plan.errores.slice(0, 2).join('; ')})` : ''}.`);
    escribirPlan(dir, { backups: plan.backups, layout: plan.layout, historias: plan.historias });
    borrarUndo(dir);
    const hash = sha256(canonico(plan.layout.draft.blocks));
    const ev = this._emitir('ejecucion_humana_confirmada', 'propietario', { idTarea: undo.idTarea }, { accion: 'deshacer_borrador_portada_simulado', huellaBorrador: hash, restauraCopia: undo.idCopia ?? null, canal: ctx.canal || 'simulado' });
    return { ok: true, idTarea: undo.idTarea, huellaBorrador: hash, restauraCopia: undo.idCopia ?? null, evento: ev && ev.id ? ev.id : null };
  }

  // ── Agente 03 (importador): entradas por referencia, análisis L1 y simulación local L2 con el motor existente ──────────────────────────────────
  /**
   * Guarda la entrada (JSON, ASIN o URL) por CONTENIDO: en el ledger y en la aprobación solo viaja su huella (el ledger limita el tamaño de cada evento y no
   * debe guardar datos masivos). Devuelve { entradaRef, entradaBytes }. Una entrada con forma de credencial se rechaza.
   */
  _guardarEntrada(texto) {
    const t = String(texto);
    if (detectarSecreto(t)) throw new ErrorProtocolo('solicitud_invalida', 'La entrada contiene algo que parece una credencial: no se guarda ni se analiza.');
    if (t.length > MAX_ENTRADA) throw new ErrorProtocolo('solicitud_invalida', `La entrada supera ${MAX_ENTRADA} caracteres.`);
    const ref = sha256(t);
    this._entradas.set(ref, t);
    try {
      if (this.ledger && this.ledger.dir) {
        const dir = path.join(this.ledger.dir, 'entradas');
        fs.mkdirSync(dir, { recursive: true });
        const f = path.join(dir, `${ref.slice(7)}.txt`);
        if (!fs.existsSync(f)) fs.writeFileSync(f, t, 'utf8');
      }
    } catch { /* la copia en disco es una comodidad entre procesos; la de memoria basta dentro de la sesión */ }
    return { entradaRef: ref, entradaBytes: Buffer.byteLength(t) };
  }

  _leerEntrada(ref) {
    let t = this._entradas.get(ref);
    if (t === undefined && this.ledger && this.ledger.dir && /^sha256:[0-9a-f]{64}$/.test(String(ref))) {
      try { t = fs.readFileSync(path.join(this.ledger.dir, 'entradas', `${String(ref).slice(7)}.txt`), 'utf8'); } catch { t = undefined; }
    }
    if (t === undefined) throw new ErrorProtocolo('origen_no_disponible', 'No consta la entrada aportada (referencia desconocida).');
    if (sha256(t) !== ref) throw new ErrorProtocolo('origen_no_disponible', 'La entrada guardada no coincide con su huella (alterada).');
    return t;
  }

  /** Cambia `entrada` por su referencia en los parámetros de una intención de importación (la entrada original se toma del TEXTO del propietario, nunca del modelo). */
  _prepararEntradaImportacion(intencion, texto) {
    if (intencion.tipo === 'revisar_pieza') {
      const q = { ...(intencion.parametros || {}) };
      const bruto = extraerTextoPublicitario(texto) ?? (typeof q.entrada === 'string' ? q.entrada : null);
      delete q.entrada;
      if (bruto) Object.assign(q, { textoRef: this._guardarEntrada(bruto).entradaRef, textoBytes: Buffer.byteLength(bruto) });
      return { ...intencion, parametros: q };
    }
    if (intencion.tipo === 'revisar_texto_publicitario') {
      const q = { ...(intencion.parametros || {}) };
      const bruto = extraerTextoPublicitario(texto) ?? (typeof q.entrada === 'string' ? q.entrada : null); // el texto sale de lo que escribió el propietario, nunca del modelo
      delete q.entrada;
      if (bruto) Object.assign(q, { textoRef: this._guardarEntrada(bruto).entradaRef, textoBytes: Buffer.byteLength(bruto) });
      return { ...intencion, parametros: q };
    }
    if (!['analizar_importacion', 'simular_importacion'].includes(intencion.tipo)) return intencion;
    const p = { ...(intencion.parametros || {}) };
    const bruta = extraerEntradaImportacion(texto) ?? (typeof p.entrada === 'string' ? p.entrada : null);
    delete p.entrada;
    if (bruta) Object.assign(p, this._guardarEntrada(bruta));
    return { ...intencion, parametros: p };
  }

  _leerImportador(capId, parametros) {
    const motor = this.motorImportacion;
    if (!motor) throw new ErrorProtocolo('origen_no_disponible', 'El motor de importación existente no está cargado: no se puede analizar ni simular.');
    const entrada = this._leerEntrada(parametros.entradaRef);
    let catalogo = [];
    let sintetico = true;
    let descripcion = 'sin catálogo de referencia (no se pueden detectar duplicados)';
    if (this.rutaCatalogoImportacion) {
      let datos;
      try { datos = JSON.parse(fs.readFileSync(this.rutaCatalogoImportacion, 'utf8')); } catch { throw new ErrorProtocolo('origen_no_disponible', 'No se pudo leer el catálogo de referencia.'); }
      catalogo = Array.isArray(datos) ? datos : Array.isArray(datos.productos) ? datos.productos : [];
      sintetico = Array.isArray(datos) ? true : datos.sintetico !== false;
      descripcion = sintetico ? 'catálogo SINTÉTICO de referencia' : 'catálogo de referencia aportado';
    }
    const r = analizarImportacion({ motor, catalogo, entrada, ahora: this.ahora(), capacidad: capId, catalogoSintetico: sintetico, catalogoDescripcion: descripcion });
    return { informe: r.informe, datos: r.informe, extra: r, carga: { sintetico, descartadas: [], leidas: (r.sim && r.sim.resumen) ? r.sim.resumen.registros : 0 }, ids: [r.informe.idEjecucion], descripcionCatalogo: descripcion };
  }

  /** Ejecución LOCAL PURA tras la aprobación (simulada en F1): el análisis no tiene efectos ni consume nada; se registra como delegación local y se verifica recalculando. */
  _ejecutarLocal({ cap, a, sobre, idAprobacion }) {
    const version = { capacidad: cap.version };
    const idTarea = a.idTarea;
    this._emitir('delegacion_simulada', 'director', { idTarea, idAprobacion }, { claveIdempotencia: sobre.claveIdempotencia, enviado: false, ejecutor: 'local', motivo: 'ejecución local pura: sin efectos externos ni consumo' }, version);
    if (this.indice) { this.indice.sincronizar(this.ledger); this.indice.guardar(); }
    this._emitir('tarea_estado', 'director', { idTarea }, { estado: 'en_curso' }, version);
    let lectura;
    try {
      lectura = this._leerImportador(cap.id, sobre.parametros);
    } catch (e) {
      const error = e instanceof ErrorProtocolo ? e.error : crearError('interno', 'Fallo no clasificado en el análisis local.');
      this._emitir('aprobacion_resuelta', 'sistema', { idAprobacion, idTarea }, { estado: 'consumida' });
      this._emitir('tarea_estado', 'director', { idTarea }, { estado: 'fallida', detalle: error.mensaje, error }, version);
      return { estado: 'fallida', idTarea, error };
    }
    const hash = huellaInforme(lectura.datos);
    this._emitir('respuesta_recibida', 'agente:03', { idTarea }, { estado: 'completada', hayDatos: true, referencias: lectura.ids, huella: hash, consumo: { llamadasApi: 0, ia: 0 } }, version);
    const idEvidencia = this.ids.nuevo('v');
    this._emitir('evidencia', 'director', { idTarea, idEvidencia }, { tipo: 'informe', referencia: `${lectura.informe.fuente.tabla}#${lectura.informe.idEjecucion}`, hash, capturadaEn: lectura.informe.generadoEn, origen: 'motor_importacion_json' }, version);
    let confirmada = false;
    try { confirmada = huellaInforme(this._leerImportador(cap.id, sobre.parametros).datos) === hash; } catch { confirmada = false; }
    this._emitir('verificacion', 'director', { idTarea, idEvidencia }, { metodo: 'comparar_hash', resultado: confirmada ? 'confirmada' : 'no_confirmada', en: ISO(this.ahora()), por: 'director' }, version);
    this._emitir('aprobacion_resuelta', 'sistema', { idAprobacion, idTarea }, { estado: 'consumida' });
    if (confirmada) this._emitir('tarea_estado', 'director', { idTarea }, { estado: 'completada' }, version);
    else this._emitir('tarea_estado', 'director', { idTarea }, { estado: 'parcial', detalle: 'resultado_no_confirmado', error: crearError('resultado_no_confirmado', 'Terminó, pero no consta confirmación: el recálculo no coincide.') }, version);
    const resp = this._respImportador({ idTarea, estado: confirmada ? 'completada' : 'parcial', confirmada, lectura }, { tipo: 'simular_importacion' });
    return { estado: 'ejecutada_local', idTarea, confirmada, texto: resp.texto, informe: lectura.informe, claveIdempotencia: sobre.claveIdempotencia };
  }

  /** Respuesta del Agente 03: informe, duplicados, conflictos y solicitud de autorización PREPARADA (nunca enviada). */
  _respImportador(res, intencion) {
    const tareas = res.idTarea ? [res.idTarea] : [];
    if (res.estado === 'fallida') return { categoria: 'consulta', estado: 'fallida', texto: `No he podido analizar la importación: ${res.error.mensaje} [${res.error.codigo}] No consta el resultado.`, tareas, aprobaciones: [], avisos: [], afirmaciones: [] };
    const informe = res.lectura.informe;
    const { sim, solicitudAutorizacion } = res.lectura.extra;
    const id = sim.identificacion;
    const avisos = [];
    const l = [];
    l.push(`Entrada: ${id.tipo}${id.plataforma ? ` · plataforma ${id.plataforma}` : ''}${id.id ? ` · id ${id.id}` : ''}${id.registros !== undefined && id.registros !== null ? ` · ${id.registros} registro(s)` : ''}.`);
    if (!sim.simulado) {
      l.push(id.requiereFuenteExterna ? `No se puede simular sin obtener los datos de una fuente externa (${id.fuenteExterna}; coste: no disponible). No la consulto. Aporta el JSON de la extracción (Importar › JSON) o solicita la extracción como operación L2 con coste (no disponible en local).` : `No se pudo analizar la entrada (${sim.motivo}).`);
      for (const a of id.avisos || []) avisos.push(a);
    } else {
      const r = sim.resumen;
      l.push(`Simulación con el motor existente sobre ${res.lectura.descripcionCatalogo}: ${r.registros} registro(s) → ${r.nuevas} nueva(s), ${r.vinculadas} vinculada(s) a otro comercio, ${r.actualizadas} actualizada(s), ${r.sinCambios} sin cambios, ${r.revisiones} a revisión, ${r.rechazadas} rechazada(s), ${r.errores} error(es). Con «solo productos nuevos» se omitirían ${r.omitiriaConSoloNuevos}.`);
      for (const d of sim.duplicados) l.push(`· Posible duplicado [registro ${d.indice}] «${d.titulo ?? 'sin título'}»: ${d.tipo}${d.idFicha ? ` (ficha ${d.idFicha})` : ''}.`);
      for (const c of sim.conflictos) l.push(`· CONFLICTO [registro ${c.indice}] «${c.titulo ?? 'sin título'}»: ${c.textos.length ? c.textos.join('; ') : c.motivos.join(', ')} → decisión humana (el motor no fusiona ante la duda).`);
      for (const x of sim.incidencias) l.push(`· Incidencia [registro ${x.indice}] «${x.titulo ?? 'sin título'}»: ${x.textos.length ? x.textos.join('; ') : x.motivos.join(', ')}.`);
      for (const w of sim.advertencias) l.push(`· Aviso [registro ${w.indice}]: ${w.avisos.join('; ')}.`);
      if (solicitudAutorizacion) l.push(`Solicitud de autorización PREPARADA (no enviada): importación real = L4, la confirma una persona en el panel; huella del lote ${solicitudAutorizacion.huellaLote.slice(0, 19)}…; efectos previstos ${JSON.stringify(solicitudAutorizacion.efectosPrevistos)}; requisitos: ${solicitudAutorizacion.requisitosPrevios.join('; ')}.`);
    }
    if (res.lectura.carga.sintetico) avisos.push('DATOS DE PRUEBA (sintéticos): el catálogo y los registros no reflejan la producción.');
    for (const x of informe.limitaciones.filter((y) => !y.startsWith('DATOS DE PRUEBA'))) avisos.push(x);
    const verif = res.idTarea ? (res.confirmada ? 'Verificado: el análisis se recalculó y coincide (huella).' : 'TERMINÓ, PERO NO CONSTA CONFIRMACIÓN: el recálculo no coincide.') : 'Sin verificación (no se registró tarea).';
    const cab = intencion.tipo === 'simular_importacion' ? '[simulación local · sin efectos; no importo nada]' : '[propuesta · solo informe; no importo nada]';
    return { categoria: intencion.tipo === 'simular_importacion' ? 'ejecutada' : 'propuesta', estado: 'respondida', texto: `${cab} ${l.join('\n')}\n${avisos.map((x) => `⚠ ${x}`).join('\n')}\n${verif}`, tareas, aprobaciones: [], avisos, afirmaciones: [{ texto: `Informe ${informe.idEjecucion}`, procedencia: `${res.lectura.carga.sintetico ? 'datos de prueba' : 'datos'} motor_importacion_json ${informe.idEjecucion} ${informe.generadoEn}` }], confirmada: res.confirmada };
  }

  _atenderImportacion(intencion, ctx) {
    const p = intencion.parametros || {};
    if (!p.entradaRef) return { categoria: 'consulta', estado: 'aclaracion', texto: 'Necesito la entrada de la importación: pega el JSON, un ASIN o una URL (la analizo como texto; no la abro ni consulto ninguna fuente).', tareas: [], aprobaciones: [], avisos: [], afirmaciones: [] };
    const params = { entradaRef: p.entradaRef, entradaBytes: p.entradaBytes };
    if (intencion.tipo === 'analizar_importacion') {
      const res = this.ejecutarPropuesta('03.proponer-lote', params, ctx);
      return this._respImportador(res, intencion);
    }
    const r = this.solicitarEjecucion('03.simular-importacion', params, ctx);
    const a = r.aprobacion;
    const texto = `${r.reutilizada ? 'Ya existía una solicitud pendiente idéntica. ' : ''}Requiere tu aprobación (${a.nivel}). ${a.resumen}\nLa simulación se ejecuta LOCALMENTE con el motor existente (sin efectos, sin red, sin créditos) y NO escribe en el catálogo; la importación REAL es L4 y la hace una persona en el panel.\nEn F1 la aprobación es SIMULADA.\nAprobación ${a.idAprobacion} · huella ${a.huella.slice(0, 19)}… · caduca ${a.caduca}\nPara aprobar: aprobar ${a.idAprobacion} --simulada   (o rechazar ${a.idAprobacion})`;
    return { categoria: 'pendiente', estado: 'esperando_aprobacion', texto, tareas: [r.idTarea], aprobaciones: [a.idAprobacion], avisos: r.aviso ? [r.aviso] : [], afirmaciones: [{ texto: 'La capacidad y su nivel proceden del registro', procedencia: `registro ${this.registro.version}` }] };
  }

  // ── L2–L4: solicitud de ejecución con aprobación SIMULADA ──────────────────────────────────────────────────────────────────
  /** Crea la tarea y la solicitud de aprobación (registradas ANTES de mostrarse). Aplica las cuatro capas de idempotencia de A-02. */
  solicitarEjecucion(capId, parametros = {}, ctx = {}) {
    const cap = this.registro.buscarCapacidad(capId);
    if (!cap) throw new ErrorProtocolo('capacidad_desconocida', `La capacidad «${capId}» no está en el registro.`);
    const asign = evaluarAsignacion(this.registro, capId);
    if (!asign.ok) throw new ErrorProtocolo(asign.codigo, asign.motivo);
    if (!requiereAprobacion(cap.nivelRiesgo)) throw new ErrorProtocolo('solicitud_invalida', `${capId} es ${cap.nivelRiesgo}: no necesita aprobación.`);
    this._validarParametros(cap, parametros);
    const c = { idCorrelacion: this.ids.nuevo('c'), idSolicitud: null, ...ctx };
    const ahora = this.ahora();
    let proy = this._proy(); // si el ledger no se puede leer, falla aquí con ledger_no_disponible/ledger_corrupto (I-3)
    if (this._paradaActiva(proy)) throw new ErrorProtocolo('parada_emergencia', 'Parada de emergencia activa: no se crean tareas nuevas.');
    const huella = calcularHuella({ capacidad: cap.id, version: cap.version, parametros, entorno: parametros.entorno ?? '' });
    // Capa 1: misma solicitud pendiente y vigente → se reutiliza, no se crea otra.
    const pendiente = aprobacionPendientePorHuella(proy, huella, ahora);
    if (pendiente) {
      this._emitir('solicitud_duplicada', 'director', { idTarea: pendiente.idTarea, idAprobacion: pendiente.idAprobacion, idCorrelacion: c.idCorrelacion }, { motivo: 'aprobacion_pendiente_misma_huella' });
      return { reutilizada: true, aprobacion: pendiente, idTarea: pendiente.idTarea, cap, aviso: 'Ya había una solicitud pendiente idéntica; se reutiliza.' };
    }
    // Capa 3: concurrencia 1 por capacidad (tarea activa).
    const activa = tareaActivaConHuella(proy, huella);
    if (activa && ['aceptada', 'en_curso'].includes(activa.estado)) throw new ErrorProtocolo('duplicada', `Ya hay una tarea activa idéntica (${activa.idTarea}); no se crea otra.`, { idTarea: activa.idTarea });
    const otra = tareaActivaDeCapacidad(proy, cap.id);
    if (otra && (cap.limites.concurrencia || 1) <= 1) throw new ErrorProtocolo('limite_alcanzado', `Hay una tarea activa de ${cap.id} (${otra.idTarea}) y la concurrencia máxima es 1.`);
    // Capa 4: intervalo mínimo y cuota diaria de la capacidad (límite distinto de la idempotencia).
    const lim = cap.limites || {};
    const previas = delegacionesDe(proy, cap.id, 0);
    if (lim.intervaloMinimoSeg && previas.length) {
      const ultima = Date.parse(previas[previas.length - 1].en);
      const falta = Math.ceil((ultima + lim.intervaloMinimoSeg * 1000 - ahora) / 1000);
      if (falta > 0) throw new ErrorProtocolo('limite_alcanzado', `Hay que esperar ${falta} s entre ejecuciones de ${cap.id}.`, { reintentarDespuesDeSeg: falta });
    }
    if (lim.maxPorDia) {
      const inicioDia = Date.parse(`${ISO(ahora).slice(0, 10)}T00:00:00.000Z`);
      if (delegacionesDe(proy, cap.id, inicioDia).length >= lim.maxPorDia) throw new ErrorProtocolo('limite_alcanzado', `Cuota diaria de ${cap.id} alcanzada (${lim.maxPorDia}).`);
    }
    if (c.idPadre) this._comprobarCiclo(proy, c.idPadre, cap.id, huella);
    const sobre = this._sobre(cap, parametros, c);
    if (sobre.profundidad > CONFIG_APROBACIONES.profundidadMaxima) throw new ErrorProtocolo('profundidad_excedida', `Profundidad ${sobre.profundidad} > ${CONFIG_APROBACIONES.profundidadMaxima}.`);
    const v = validarSobreTarea(sobre, { registro: this.registro, ahora, exigirAprobacion: false });
    if (!v.ok && !v.errores.every((e) => e.codigo === 'permiso_denegado' && cap.nivelRiesgo === 'L4')) throw new ErrorProtocolo(v.errores[0].codigo, v.errores[0].mensaje);
    const repetida = previas.filter((d) => Date.parse(d.en) >= ahora - CONFIG_APROBACIONES.avisoRepeticionMin * 60000).length > 0;
    const idAprobacion = this.ids.nuevo('a');
    const resumen = resumenParaAprobar(cap, parametros) + (asign.ejecutableEnF1 ? '' : ` ATENCIÓN: ${asign.motivoNoEjecutable}`) + (repetida ? ' Aviso: esta capacidad se ejecutó hace menos de 10 min.' : '');
    const aprobacion = crearSolicitudAprobacion({ idAprobacion, idTarea: sobre.idTarea, capacidad: cap.id, nivel: cap.nivelRiesgo, huella, resumen, coste: cap.costeEstimado || null, ahora, simulada: true });
    const version = { capacidad: cap.version };
    // Registro previo (A-05): la tarea y la solicitud de aprobación quedan escritas ANTES de mostrarse.
    this._emitir('tarea_creada', 'director', { idTarea: sobre.idTarea, idCorrelacion: c.idCorrelacion, idSolicitud: c.idSolicitud }, { sobre, nivel: cap.nivelRiesgo, capacidadVersion: cap.version, registroVersion: this.registro.version, huella }, version);
    this._emitir('aprobacion_solicitada', 'director', { idTarea: sobre.idTarea, idAprobacion, idCorrelacion: c.idCorrelacion }, { aprobacion }, version);
    this._emitir('tarea_estado', 'director', { idTarea: sobre.idTarea }, { estado: 'esperando_aprobacion' }, version);
    proy = null;
    return { reutilizada: false, aprobacion, idTarea: sobre.idTarea, cap, huella, aviso: repetida ? 'Se ejecutó hace menos de 10 min.' : null, ejecutableEnF1: asign.ejecutableEnF1 };
  }

  _comprobarCiclo(proy, idPadre, capId, huella) {
    let id = idPadre;
    const vistos = new Set();
    while (id && !vistos.has(id)) {
      vistos.add(id);
      const t = proy.tareas.get(id);
      if (!t) break;
      if (t.capacidad === capId && t.huella === huella) throw new ErrorProtocolo('ciclo_detectado', 'La tarea repite a un antecesor (mismo capacidad y huella).');
      id = t.sobre.idPadre;
    }
  }

  /**
   * Resuelve una aprobación simulada. `decision`: 'aprobada' | 'rechazada'. `ctx`: { canal:'simulado'|'interfaz'|'voz', por, ultimaAutenticacion, reautenticadoEn, motivo }.
   * Aprobada → `delegacion_simulada` (nada se envía) y la tarea termina `cancelada` («simulación F1»); la aprobación queda consumida.
   */
  resolverAprobacion(idAprobacion, decision, ctx = {}) {
    const ahora = this.ahora();
    const proy = this._proy();
    const a = proy.aprobaciones.get(idAprobacion);
    if (!a) throw new ErrorProtocolo('solicitud_invalida', `No existe la aprobación ${idAprobacion}.`);
    const t = proy.tareas.get(a.idTarea);
    const version = {};
    if (a.estado === 'pendiente' && ahora > Date.parse(a.caduca)) {
      this._emitir('aprobacion_resuelta', 'sistema', { idAprobacion, idTarea: a.idTarea }, { estado: 'caducada' });
      if (t && !esTerminal(t.estado)) this._emitir('tarea_estado', 'director', { idTarea: a.idTarea }, { estado: 'expirada', detalle: 'aprobacion_caducada' });
      return { estado: 'caducada', error: crearError('aprobacion_caducada', 'La aprobación caducó (sin respuesta = caducada, nunca aprobada).'), idTarea: a.idTarea };
    }
    if (decision === 'aprobada' && this._paradaActiva(proy)) throw new ErrorProtocolo('parada_emergencia', 'Parada de emergencia activa: no se aprueba nada hasta reanudar.');
    const canal = ctx.canal || 'simulado';
    const r = resolverAprobacion(a, { decision, por: ctx.por || this.config.propietario, canal, ahora, ultimaAutenticacion: ctx.ultimaAutenticacion ?? ahora, reautenticadoEn: ctx.reautenticadoEn ?? null, motivo: ctx.motivo ?? null }, CONFIG_APROBACIONES);
    if (!r.ok) {
      this._emitir('error', 'director', { idAprobacion, idTarea: a.idTarea }, { codigo: r.error.codigo, mensaje: r.error.mensaje, canal });
      return { estado: a.estado, error: r.error, idTarea: a.idTarea };
    }
    if (decision === 'rechazada') {
      this._emitir('aprobacion_resuelta', 'propietario', { idAprobacion, idTarea: a.idTarea }, { estado: 'rechazada', por: 'propietario', canal, motivo: ctx.motivo ?? null, simulada: a.simulada });
      this._emitir('tarea_estado', 'director', { idTarea: a.idTarea }, { estado: 'rechazada', detalle: ctx.motivo || 'rechazada_por_el_propietario' });
      return { estado: 'rechazada', idTarea: a.idTarea };
    }
    const cap = this.registro.buscarCapacidad(a.capacidad);
    const sobre = { ...t.sobre, aprobacion: { nivel: a.nivel, ref: idAprobacion, huella: a.huella, expiraEn: a.caduca }, claveIdempotencia: claveIdempotencia(a.huella, idAprobacion), ejecutor: a.nivel === 'L4' ? 'humano' : 'agente' };
    const humano = a.nivel === 'L4';
    const val = validarSobreTarea(sobre, { registro: this.registro, ahora, exigirAprobacion: true });
    const erroresReales = val.errores.filter((e) => !(humano && e.codigo === 'permiso_denegado'));
    if (erroresReales.length) {
      this._emitir('error', 'director', { idAprobacion, idTarea: a.idTarea }, { codigo: erroresReales[0].codigo, mensaje: erroresReales[0].mensaje });
      return { estado: a.estado, error: crearError(erroresReales[0].codigo, erroresReales[0].mensaje), idTarea: a.idTarea };
    }
    if (this.indice) this.indice.sincronizar(this.ledger);
    const yaUsada = (this.indice && this.indice.buscar(sobre.claveIdempotencia, this.ledger)) || (proy.claves.has(sobre.claveIdempotencia) ? { idTarea: proy.claves.get(sobre.claveIdempotencia), via: 'proyeccion' } : null);
    if (yaUsada) {
      this._emitir('solicitud_duplicada', 'director', { idTarea: yaUsada.idTarea, idAprobacion }, { motivo: 'clave_de_idempotencia_repetida', claveIdempotencia: sobre.claveIdempotencia, via: yaUsada.via });
      return { estado: 'duplicada', error: crearError('duplicada', 'Esa aprobación ya se usó: una aprobación = una ejecución.'), idTarea: yaUsada.idTarea };
    }
    this._emitir('aprobacion_resuelta', 'propietario', { idAprobacion, idTarea: a.idTarea }, { estado: 'aprobada', por: 'propietario', canal, simulada: a.simulada }, version);
    this._emitir('tarea_estado', 'director', { idTarea: a.idTarea }, { estado: 'aceptada' }, version);
    if (cap.disponibilidad === 'simulacion_local' && cap.agente === '06') return this._ejecutarBorradorLocal({ cap, a, sobre, idAprobacion });
    if (cap.disponibilidad === 'simulacion_local') return this._ejecutarLocal({ cap, a, sobre, idAprobacion });
    // Registro previo de la delegación (simulada): nada se envía a ningún agente.
    this._emitir('delegacion_simulada', 'director', { idTarea: a.idTarea, idAprobacion }, { claveIdempotencia: sobre.claveIdempotencia, enviado: false, ejecutor: sobre.ejecutor, motivo: humano ? 'L4: la ejecuta una persona en el panel; no se envía a ningún agente' : 'simulacion_f1' });
    if (this.indice) { this.indice.sincronizar(this.ledger); this.indice.guardar(); }
    let envio;
    try {
      envio = this.despachador.enviar(sobre);
    } catch {
      // Fallo interno del orquestador: sin detalles internos, sin «completada»; el estado real se comprueba antes de proponer un reintento (que sería otra tarea con otra aprobación).
      const error = crearError('interno', 'Fallo interno del orquestador: no consta resultado. Se comprobará el estado real antes de proponer un reintento (que sería una tarea nueva con nueva aprobación).');
      this._emitir('aprobacion_resuelta', 'sistema', { idAprobacion, idTarea: a.idTarea }, { estado: 'consumida' });
      this._emitir('tarea_estado', 'director', { idTarea: a.idTarea }, { estado: 'en_curso' });
      this._emitir('tarea_estado', 'director', { idTarea: a.idTarea }, { estado: 'fallida', detalle: error.mensaje, error });
      return { estado: 'fallida', idTarea: a.idTarea, error };
    }
    this._emitir('aprobacion_resuelta', 'sistema', { idAprobacion, idTarea: a.idTarea }, { estado: 'consumida' });
    this._emitir('tarea_estado', 'director', { idTarea: a.idTarea }, { estado: 'cancelada', detalle: envio.motivo });
    return { estado: 'simulada', idTarea: a.idTarea, envio, cap: cap.id, claveIdempotencia: sobre.claveIdempotencia };
  }

  // ── cancelación, parada de emergencia, reconciliación ─────────────────────────────────────────────────────────────────────
  cancelarTarea(idTarea, motivo = 'cancelada_por_el_propietario') {
    const p = this._proy();
    const t = p.tareas.get(idTarea);
    if (!t) throw new ErrorProtocolo('solicitud_invalida', `No existe la tarea ${idTarea}.`);
    if (esTerminal(t.estado)) throw new ErrorProtocolo('solicitud_invalida', `La tarea ya terminó («${t.estado}»): una terminal no vuelve atrás.`);
    this._emitir('tarea_cancelada', 'propietario', { idTarea }, { motivo, por: 'propietario', error: crearError('cancelada_por_usuario', motivo) });
    const a = t.idAprobacion ? p.aprobaciones.get(t.idAprobacion) : null;
    if (a && a.estado === 'pendiente') this._emitir('aprobacion_resuelta', 'sistema', { idAprobacion: a.idAprobacion, idTarea }, { estado: 'revocada', motivo });
    return { idTarea, estado: 'cancelada' };
  }

  /** Siempre permitida, sin aprobación: cancela lo cancelable y bloquea tareas nuevas hasta `reanudar`. */
  paradaEmergencia(motivo = 'parada_de_emergencia') {
    this._paradaLocal = true; // aunque el ledger falle, el bloqueo local queda activo
    const canceladas = [];
    try {
      const p = this._proy();
      for (const t of listarTareas(p, { activas: true })) {
        this._emitir('tarea_cancelada', 'propietario', { idTarea: t.idTarea }, { motivo, por: 'propietario', error: crearError('parada_emergencia', motivo) });
        const a = t.idAprobacion ? p.aprobaciones.get(t.idAprobacion) : null;
        if (a && a.estado === 'pendiente') this._emitir('aprobacion_resuelta', 'sistema', { idAprobacion: a.idAprobacion, idTarea: t.idTarea }, { estado: 'revocada', motivo });
        canceladas.push(t.idTarea);
      }
      this._emitir('parada_emergencia', 'propietario', {}, { motivo, canceladas });
      return { registrada: true, canceladas };
    } catch (e) {
      if (e instanceof ErrorProtocolo && e.codigo === 'ledger_no_disponible') return { registrada: false, canceladas, aviso: 'Bloqueo local activo, pero el ledger no está disponible: no queda registrado.' };
      throw e;
    }
  }
  reanudar() {
    this._emitir('parada_levantada', 'propietario', {}, {});
    this._paradaLocal = false;
    return { reanudada: true };
  }

  /**
   * Reconciliación tras recuperar el ledger o reiniciar: las tareas ya iniciadas que superaron su plazo, y las que esperaban una aprobación caducada,
   * pasan a `expirada`. NO se recomienda repetir sin comprobar antes el estado real; un reintento es siempre una tarea nueva con su aprobación.
   */
  reconciliar() {
    const ahora = this.ahora();
    const p = this._proy();
    const cambios = [];
    for (const t of listarTareas(p, { activas: true })) {
      const a = t.idAprobacion ? p.aprobaciones.get(t.idAprobacion) : null;
      if (t.estado === 'esperando_aprobacion' && a && a.estado === 'pendiente' && ahora > Date.parse(a.caduca)) {
        this._emitir('aprobacion_resuelta', 'sistema', { idAprobacion: a.idAprobacion, idTarea: t.idTarea }, { estado: 'caducada' });
        this._emitir('tarea_estado', 'director', { idTarea: t.idTarea }, { estado: 'expirada', detalle: 'aprobacion_caducada' });
        cambios.push({ idTarea: t.idTarea, de: t.estado, a: 'expirada', motivo: 'aprobacion_caducada' });
      } else if (['aceptada', 'en_curso'].includes(t.estado) && ahora - Date.parse(t.actualizadaEn) > (t.sobre.plazoMs || 0)) {
        const error = crearError('tiempo_agotado', 'No consta resultado dentro del plazo; comprueba el estado real antes de repetir.');
        this._emitir('tarea_estado', 'director', { idTarea: t.idTarea }, { estado: 'expirada', detalle: error.mensaje, error });
        cambios.push({ idTarea: t.idTarea, de: t.estado, a: 'expirada', motivo: 'plazo_agotado' });
      }
    }
    return { cambios, anomalias: p.anomalias };
  }

  // ── consultas de estado ───────────────────────────────────────────────────────────────────────────────────────────────────
  listarTareas(filtro = {}) { return listarTareas(this._proy(), filtro); }

  /** Una tarea con su traza completa: quién pidió, qué se entendió, con qué versiones, quién aprobó, qué respondió, qué evidencia y cómo se verificó. */
  verTarea(idTarea) {
    const p = this._proy();
    const t = p.tareas.get(idTarea);
    if (!t) throw new ErrorProtocolo('solicitud_invalida', `No existe la tarea ${idTarea}.`);
    const sol = t.idSolicitud ? p.solicitudes.get(t.idSolicitud) : null;
    const aprobacion = t.idAprobacion ? p.aprobaciones.get(t.idAprobacion) : null;
    const eventos = this.ledger.leer((e) => (e.refs || {}).idTarea === idTarea || (t.idSolicitud && (e.refs || {}).idSolicitud === t.idSolicitud) || (aprobacion && (e.refs || {}).idAprobacion === aprobacion.idAprobacion));
    return { tarea: t, solicitud: sol, aprobacion, eventos, traza: { quienPidioYCuando: sol ? { canal: sol.canal, texto: sol.texto, en: sol.en } : 'no consta', queEntendio: sol ? sol.intencion || 'no consta' : 'no consta', versiones: { capacidad: t.capacidadVersion, registro: t.registroVersion }, aprobacion: aprobacion ? { nivel: aprobacion.nivel, huella: aprobacion.huella, canal: aprobacion.canal, caduca: aprobacion.caduca, estado: aprobacion.estado, simulada: aprobacion.simulada } : 'no requiere o no consta', respuesta: t.respuesta || 'no consta', evidencia: t.evidencias, verificacion: t.verificaciones, mensajes: sol ? sol.mensajes : [] } };
  }

  estadoAgentes() {
    return this.registro.agentes().map((a) => ({ id: a.id, nombre: a.nombre, estado: a.estado, origenEstado: a.origenEstado, capacidades: this.registro.capacidadesDe(a.id).map((c) => ({ id: c.id, nivel: c.nivelRiesgo, modo: c.modo, disponibilidad: c.disponibilidad })) }));
  }

  // ── conversación (texto o transcripción de voz) ─────────────────────────────────────────────────────────────────────────────
  /** Registro previo de la solicitud (write-ahead). Devuelve `{ fin }` si la solicitud no debe seguir (canal no válido, credencial) o el contexto de la sesión. */
  _abrir(texto, { canal = 'texto', confianza = null } = {}) {
    const idSolicitud = this.ids.nuevo('s');
    const idCorrelacion = this.ids.nuevo('c');
    const base = { idSolicitud, idCorrelacion, tareas: [], aprobaciones: [], avisos: [], afirmaciones: [], registrada: true };
    if (!canalPuedeSolicitar(canal)) return { fin: { ...base, categoria: 'consulta', estado: 'rechazada', texto: `El canal «${canal}» no puede enviar solicitudes.`, registrada: false } };
    let ledgerOk = true;
    try {
      this._emitir('solicitud', 'propietario', { idSolicitud, idCorrelacion }, { canal, texto: String(texto).slice(0, 2000), propietario: true, ...(confianza === null ? {} : { confianzaTranscripcion: confianza }) });
    } catch (e) {
      if (e instanceof ErrorProtocolo && e.codigo === 'ledger_no_disponible') ledgerOk = false;
      else if (e instanceof ErrorLedger && e.codigo === 'secreto_detectado') return { fin: { ...base, categoria: 'consulta', estado: 'rechazada', registrada: false, texto: 'El texto parece contener una credencial. No lo he registrado ni procesado: no pegues claves ni tokens aquí.' } };
      else throw e;
    }
    return { base, ledgerOk, idSolicitud, idCorrelacion, canal, confianza };
  }

  /**
   * Procesa una instrucción con el intérprete por REGLAS (sin modelo). Registra la solicitud ANTES de actuar. Con el ledger caído (I-3): las consultas L0 se
   * atienden avisando de que no quedan registradas; las propuestas L1 se comentan sin crear tareas; nada que requiera autorización o trazabilidad se inicia.
   */
  procesarSolicitud(texto, opciones = {}) {
    const s = this._abrir(texto, opciones);
    if (s.fin) return s.fin;
    return this._cerrar(s, interpretar(texto), texto, { origen: 'reglas', avisos: [] });
  }

  /** Igual, pero con el CEREBRO LLM (si hay) para interpretar; las reglas siguen siendo el suelo de seguridad. Sin cerebro o sin ledger, usa las reglas. */
  async procesarSolicitudAsync(texto, opciones = {}) {
    const s = this._abrir(texto, opciones);
    if (s.fin) return s.fin;
    if (!this.cerebro || !s.ledgerOk) return this._cerrar(s, interpretar(texto), texto, { origen: 'reglas', avisos: [] });
    const registrar = ({ tipo, datos }) => {
      try {
        this._emitir(tipo, 'director', { idSolicitud: s.idSolicitud, idCorrelacion: s.idCorrelacion }, datos);
      } catch (e) {
        if (tipo === 'consumo') throw e; // sin registro del consumo no se llama al modelo
      }
    };
    const r = await this.cerebro.interpretar(texto, { canal: s.canal, registrar });
    return this._cerrar(s, r.intencion, texto, { origen: r.origen, avisos: r.avisos, modo: r.modo });
  }

  _cerrar(s, intencion, texto, extra) {
    const { base, ledgerOk, idSolicitud, idCorrelacion, canal, confianza } = s;
    if (!ledgerOk) return this._sinLedger(intencion, base);
    try { intencion = this._prepararEntradaImportacion(intencion, texto); } catch (e) { if (!(e instanceof ErrorProtocolo)) throw e; intencion = { ...intencion, tipo: 'desconocida', parametros: {}, aclaracion: e.error.mensaje }; }
    this._emitir('intencion', 'director', { idSolicitud, idCorrelacion }, { tipo: intencion.tipo, agentes: intencion.agentes, parametros: intencion.parametros, tema: intencion.tema ?? null, pregunta: intencion.pregunta, riesgoMax: intencion.riesgoMax, ambiguedad: intencion.ambiguedad, origen: extra.origen, ...(extra.modo ? { modo: extra.modo } : {}) });
    let r = this._politicaVoz(intencion, canal, confianza, texto);
    if (!r) {
      try {
        r = this._atender(intencion, { idSolicitud, idCorrelacion, canal });
      } catch (e) {
        if (!(e instanceof ErrorProtocolo)) throw e;
        r = { categoria: 'consulta', estado: 'rechazada', texto: `No he podido hacerlo: ${e.error.mensaje} [${e.codigo}]`, error: e.error, tareas: [], aprobaciones: [], avisos: [], afirmaciones: [] };
        try { this._emitir('error', 'director', { idSolicitud, idCorrelacion }, { codigo: e.codigo, mensaje: e.error.mensaje }); } catch { r.registrada = false; }
      }
    }
    const res = { ...base, ...r, intencion };
    res.avisos = [...(r.avisos || []), ...(extra.avisos || [])];
    res.origenInterpretacion = extra.origen;
    if (extra.modo) res.modo = extra.modo;
    try {
      this._emitir('mensaje_al_propietario', 'director', { idSolicitud, idCorrelacion }, { categoria: res.categoria, texto: res.texto, afirmaciones: res.afirmaciones, tareas: res.tareas });
    } catch { res.registrada = false; res.avisos.push('El mensaje no pudo registrarse en el ledger.'); }
    return res;
  }

  /** Política de voz: con poca confianza no se actúa; antes se repite lo entendido (L2 o más) o se pide repetir. La voz solicita, nunca confirma. */
  _politicaVoz(intencion, canal, confianza, texto) {
    if (canal !== 'voz' || confianza === null || confianza === undefined) return null;
    if (intencion.tipo === 'accion_ambigua' && intencion.parametros && intencion.parametros.referencia && confianza >= (this.config.vozConfianzaRepetir ?? 0.5)) return null;
    const minima = this.config.vozConfianzaMinima ?? 0.8;
    const repetir = this.config.vozConfianzaRepetir ?? 0.5;
    if (confianza < repetir) return { categoria: 'consulta', estado: 'repetir', texto: `No te he entendido bien (confianza ${confianza}). ¿Puedes repetirlo? No hago nada hasta entenderte.`, tareas: [], aprobaciones: [], avisos: [], afirmaciones: [] };
    if (confianza < minima && Number(RIESGO_POR_TIPO[intencion.tipo].slice(1)) >= 2) {
      const sug = sugerirCorreccion(texto);
      const cand = sug.length ? ` ¿Querías decir ${sug.map((x) => `«${x}»`).join(' o ')}?` : '';
      return { categoria: 'consulta', estado: 'confirmar_interpretacion', texto: `He entendido: «${String(texto).slice(0, 200)}» (confianza ${confianza}).${cand} No actúo hasta que lo confirmes. Recuerda que las acciones L2 o superiores se confirman en la interfaz autenticada, nunca por voz.`, tareas: [], aprobaciones: [], avisos: [], afirmaciones: [] };
    }
    return null;
  }

  _sinLedger(intencion, base) {
    const aviso = 'El ledger no está disponible: esta respuesta NO queda registrada.';
    const l0 = ['ayuda', 'estado_agentes', 'estado_agente', 'agente_no_operativo', 'conversacion', 'estudiar_afiliacion', 'comparar_afiliacion', 'consultar_informe', 'listar_informes', 'comparar_informes'];
    if (l0.includes(intencion.tipo) && !intencion.ambiguedad && !intencion.tema) {
      try {
        const r = this._atender(intencion, { idSolicitud: null, idCorrelacion: null, canal: 'texto' }, { sinLedger: true });
        return { ...base, ...r, registrada: false, avisos: [aviso], texto: `${r.texto}\n(${aviso})` };
      } catch (e) {
        if (!(e instanceof ErrorProtocolo)) throw e;
      }
    }
    if (intencion.tipo === 'lanzar_auditoria') return { ...base, categoria: 'consulta', estado: 'rechazada', registrada: false, avisos: [aviso], texto: `No se inicia ninguna acción nueva: ${aviso} Una tarea que requiere aprobación o trazabilidad no puede empezar sin registro previo.` };
    return { ...base, categoria: 'consulta', estado: 'rechazada', registrada: false, avisos: [aviso], texto: `${aviso} Solo puedo atender consultas de lectura sin registro.` };
  }

  _salvedades(ag, tema) {
    const a = this.registro.agente(ag);
    return ((a && a.salvedades) || []).filter((x) => !tema || x.tema === tema).map((x) => x.texto);
  }

  _atender(intencion, ctx, { sinLedger = false } = {}) {
    const rechazo = (texto, extra = {}) => ({ categoria: 'consulta', estado: 'rechazada', texto, tareas: [], aprobaciones: [], avisos: [], afirmaciones: [], ...extra });
    const nombreAg = (id) => { const a = this.registro.agente(id); return a ? `${id} «${a.nombre}»` : id; };
    switch (intencion.tipo) {
      case 'ayuda': return { categoria: 'consulta', texto: AYUDA };
      case 'estado_agentes': return this._respEstadoAgentes();
      case 'listar_tareas': return this._respTareas();
      case 'ejecucion_autonoma': return rechazo('No: la ejecución autónoma o programada de agentes no está autorizada. Puedo consultar informes ya preparados y, con tu aprobación explícita en cada caso, simular el lanzamiento de una auditoría. Lo que ocurra de forma recurrente habría que decidirlo y autorizarlo aparte.');
      case 'accion_humana': {
        const partes = ['Esa acción (publicar, importar, corregir fichas, cambiar precios, activar o programar, borrar, credenciales…) es de nivel L4: no es una capacidad de ningún agente ni mía. La ejecuta una persona en el panel de administración. Puedo ayudarte a preparar la información o una propuesta.'];
        const t = intencion.textoPlano || '';
        if (intencion.tema === 'workflow') partes.push('No modifico workflows: los de los Agentes 04 y 12 no se tocan en esta fase; activarlos o programarlos es L4 humano, con autorización y la guía de despliegue. Puedo preparar una propuesta razonada (carga, cuota, riesgos).');
        if (/\b(token|clave|credencial)/.test(t)) partes.push('Nunca uso TRADYLOR_API_TOKEN ni credenciales de otros: no las conozco ni las pido.');
        if (intencion.agentes.length && /\b(dile|pidele|encarga)\b/.test(t)) partes.push(`[permiso_denegado] El agente ${nombreAg(intencion.agentes[0])} no tiene esa capacidad en el registro; no concedo ni amplío permisos ni se lo pido a otro agente.`);
        if (/\bpublic/.test(t)) partes.push('Una confirmación de L3/L4 nunca vale por voz ni de palabra: se da en la interfaz autenticada, ligada a la huella de la acción.');
        if (/\bpublica\w* (la )?(nueva )?portada\b/.test(t)) partes.push('Publicar o activar la portada es L4 humano: el agente de portada (06) solo propone y, con tu aprobación, SIMULA guardar un borrador en un área privada; la publicación y la activación las haces tú en el panel (con sus tres candados).');
        return rechazo(partes.join(' '));
      }
      case 'accion_ambigua': {
        const ref = intencion.parametros && intencion.parametros.referencia;
        if (ref !== undefined && ref !== null && ref !== '') {
          const c = sugerirAgentes(ref);
          return rechazo(`No existe un agente «${ref}» (los agentes son 00–13).${c.length ? ` ¿Querías decir ${c.map((x) => `${x}`).join(' o ')}?` : ''} Los operativos hoy son 04 y 12. Indica el número y no lanzo nada hasta confirmarlo.`, { estado: 'aclaracion' });
        }
        return rechazo('Necesito precisar antes de hacer nada: 1) ¿qué problema o qué ficha exactamente?; 2) ¿quieres que lo investigue/proponga o que se aplique?; 3) ¿lectura de datos o cambio? Recuerda que aplicar cambios al catálogo o a los precios es L4 y lo hace una persona en el panel; no es una capacidad mía ni de un agente. No he creado ninguna tarea.', { estado: 'aclaracion' });
      }
      case 'confirmacion_vaga': {
        const p = this._proy();
        const pend = [...p.tareas.values()].filter((t) => t.estado === 'esperando_aprobacion');
        if (!pend.length) return rechazo('No tengo nada pendiente de confirmar a lo que «hazlo» pueda referirse, y una propuesta no es una instrucción: dime qué acción exacta quieres. No ejecuto nada.', { estado: 'aclaracion' });
        return rechazo(`No ejecuto nada: ¿a cuál te refieres? Pendientes:\n${pend.map((t) => `· ${t.idTarea} · ${t.capacidad} · ${t.nivel} · aprobación ${t.idAprobacion}`).join('\n')}\nCada una requiere tu confirmación de la acción exacta en la interfaz autenticada; no elijo por defecto.`, { estado: 'aclaracion' });
      }
      case 'cambio_nivel': return rechazo('No puedo bajar el nivel de una capacidad: lo fija el registro y ni yo, ni el modelo, ni el agente podemos cambiarlo. Un cambio de registro es una versión nueva con tu aprobación expresa y, en cualquier caso, una acción L2 exige confirmación. Alternativa legítima: hacer más ágil la confirmación en el panel. No he cambiado nada.');
      case 'pide_credencial': {
        const nombres = this.registro.agentes().map((a) => a.credencial).filter(Boolean);
        return rechazo(`No conozco ni revelo el valor de ninguna credencial, y nunca las pido. Solo puedo nombrarlas: ${nombres.map((n) => `«${n}»`).join(', ') || 'ninguna registrada'}. Para consultarlas o rotarlas hay un procedimiento humano en el panel/n8n (L4).`);
      }
      case 'peticion_desproporcionada': return rechazo('Resumir todo el historial del proyecto es desproporcionado: no lo envío entero a ningún modelo. ¿Qué parte te interesa (decisiones, un agente, un periodo)? Trabajaría con resúmenes y te estimaría el coste antes. No he enviado nada.', { estado: 'aclaracion' });
      case 'conversacion': {
        const ap = ['01', '05', '10'].map((id) => { const a = this.registro.agente(id); return `${id} ${a.estado}`; }).join(', ');
        const cuerpo = intencion.respuesta ? `[propuesta, no verificada con datos] ${intencion.respuesta}` : 'Esto es una conversación de estrategia y sin modelo no puedo argumentar ni opinar. Puedo mostrarte lo que consta en los informes y en el registro.';
        return { categoria: 'propuesta', texto: `${cuerpo}\nEstado en el registro de los agentes que aportarían datos: ${ap}. No he creado ninguna tarea ni delegado nada.`, tareas: [], aprobaciones: [], avisos: [], afirmaciones: [{ texto: 'Estado de los agentes de apoyo', procedencia: `registro ${this.registro.version}` }] };
      }
      case 'agente_no_operativo': {
        const id = intencion.agentes[0];
        const a = this.registro.agente(id);
        if (!a) return rechazo('Ese agente no existe en el registro.');
        if (a.estado !== 'planificado') { const caps = this.registro.capacidadesDe(id); return rechazo(`El agente ${nombreAg(id)} existe en local («${a.estado}») pero no tengo una capacidad registrada que cubra esa petición.${caps.length ? ` Capacidades: ${caps.map((c) => `${c.id} (${c.nivelRiesgo})`).join(', ')}.` : ''} Publicar, enviar o invertir es siempre una acción humana (L4).`, { estado: 'sin_capacidad' }); }
        return rechazo(`[agente_no_operativo] El agente ${nombreAg(id)} está «${a.estado}» (${a.origenEstado}) y su etapa prevista es ${a.etapa}: no puedo asignarle tareas ni improviso con otro agente. Lo que sí puedo: consultar los informes de los agentes operativos (04, 12) y plantearlo como propuesta conversacional, sin datos externos.`, { estado: 'agente_no_operativo' });
      }
      case 'estado_agente': {
        const id = intencion.agentes[0];
        const a = this.registro.agente(id);
        if (!a) return rechazo(`No existe un agente ${id} en el registro (00–13).`);
        const caps = this.registro.capacidadesDe(id);
        const base = a.estado === 'operativo' ? `El agente ${nombreAg(id)} consta como operativo según lo ${a.origenEstado === 'comunicado' ? 'COMUNICADO por el propietario; no ha sido verificado de forma independiente' : a.origenEstado}.` : `El agente ${nombreAg(id)} está «${a.estado}» (${a.origenEstado}); no está operativo y no ofrezco capacidades que no tiene.`;
        const lista = caps.length ? ` Capacidades en el registro: ${caps.map((c) => `${c.id} (${c.nivelRiesgo}, ${c.disponibilidad})`).join(', ')}.` : ' No tiene capacidades registradas.';
        const verif = a.estado === 'operativo' ? ' Puedo comprobarlo en lectura (L0) leyendo su último informe guardado; eso verifica que existe una ejecución, no que esté desplegado.' : '';
        return { categoria: 'consulta', texto: `${base}${lista}${verif} Prioridad: el registro manda sobre cualquier documento que describa otras capacidades.`, tareas: [], aprobaciones: [], avisos: [], afirmaciones: [{ texto: `Estado del agente ${id}: ${a.estado}`, procedencia: `${a.origenEstado === 'comunicado' ? 'comunicado por el propietario' : 'registro'} (${this.registro.version})` }] };
      }
      case 'listar_aprobaciones': return this._respAprobaciones();
      case 'investigar_candidatos': return this._respInvestigador(this.ejecutarPropuesta('01.investigar-tendencias', {}, ctx));
      case 'analizar_oportunidades_nicho': return this._respNichos(this.ejecutarPropuesta('11.analizar-oportunidades-nicho', {}, ctx), '11.analizar-oportunidades-nicho');
      case 'estudiar_viabilidad_nicho': return this._respNichos(this.ejecutarPropuesta('11.estudiar-viabilidad-nicho', {}, ctx), '11.estudiar-viabilidad-nicho');
      case 'validar_observaciones': {
        const asign = evaluarAsignacion(this.registro, '09.validar-observaciones');
        if (!asign.ok) throw new ErrorProtocolo(asign.codigo, asign.motivo);
        return this._respCompetencia(this.leerCapacidad('09.validar-observaciones', {}, ctx), '09.validar-observaciones');
      }
      case 'detectar_huecos': return this._respCompetencia(this.ejecutarPropuesta('09.detectar-huecos', {}, ctx), '09.detectar-huecos');
      case 'comparar_precios_observados': return this._respCompetencia(this.ejecutarPropuesta('09.comparar-precios-observados', {}, ctx), '09.comparar-precios-observados');
      case 'informe_competencia': return this._respCompetencia(this.ejecutarPropuesta('09.proponer-informe-competencia', {}, ctx), '09.proponer-informe-competencia');
      case 'proponer_borrador_ficha':
      case 'proponer_recursos_visuales': {
        const nombre = intencion.parametros && intencion.parametros.producto;
        const capId = intencion.tipo === 'proponer_borrador_ficha' ? '08.proponer-borrador-ficha' : '08.proponer-recursos-visuales';
        if (!nombre) return { categoria: 'consulta', estado: 'aclaracion', texto: '¿De qué ficha? Indica su id o su título, por ejemplo: «redacta la descripción de la ficha del portátil».', tareas: [], aprobaciones: [], avisos: [], afirmaciones: [] };
        return this._respContenido(this.ejecutarPropuesta(capId, { producto: nombre }, ctx), capId);
      }
      case 'proponer_borrador_historia':
      case 'proponer_borrador_redes': {
        const nombre = intencion.parametros && intencion.parametros.campana;
        const capId = intencion.tipo === 'proponer_borrador_historia' ? '08.proponer-borrador-historia' : '08.proponer-borrador-redes';
        if (!nombre) return { categoria: 'consulta', estado: 'aclaracion', texto: '¿De qué campaña? Por ejemplo: «redacta la historia de la campaña de Black Friday».', tareas: [], aprobaciones: [], avisos: [], afirmaciones: [] };
        return this._respContenido(this.ejecutarPropuesta(capId, { campana: nombre }, ctx), capId);
      }
      case 'revisar_pieza': {
        const p = intencion.parametros || {};
        if (!p.textoRef) return { categoria: 'consulta', estado: 'aclaracion', texto: 'Necesito el texto de la pieza entre comillas (máx. 4000 caracteres); si tiene imagen, añade su URL fuera de las comillas. Solo la reviso: no la publico ni la modifico.', tareas: [], aprobaciones: [], avisos: [], afirmaciones: [] };
        if (p.textoBytes > 4000) return { categoria: 'consulta', estado: 'aclaracion', texto: 'El texto supera los 4000 caracteres: divídelo y revísalo por partes.', tareas: [], aprobaciones: [], avisos: [], afirmaciones: [] };
        const asign = evaluarAsignacion(this.registro, '08.revisar-pieza');
        if (!asign.ok) throw new ErrorProtocolo(asign.codigo, asign.motivo);
        return this._respContenido(this.leerCapacidad('08.revisar-pieza', { textoRef: p.textoRef, textoBytes: p.textoBytes, ...(p.imagenUrl ? { imagenUrl: p.imagenUrl } : {}) }, ctx), '08.revisar-pieza');
      }
      case 'proponer_plan_campanas': return this._respMarketing(this.ejecutarPropuesta('07.proponer-plan-campanas', {}, ctx), '07.proponer-plan-campanas');
      case 'auditar_seo': return this._respMarketing(this.ejecutarPropuesta('07.auditar-seo-contenido', {}, ctx), '07.auditar-seo-contenido');
      case 'redactar_brief': {
        const nombre = intencion.parametros && intencion.parametros.campana;
        if (!nombre) return { categoria: 'consulta', estado: 'aclaracion', texto: '¿De qué campaña quieres el brief? Por ejemplo: «redacta el brief de la campaña de Black Friday».', tareas: [], aprobaciones: [], avisos: [], afirmaciones: [] };
        return this._respMarketing(this.ejecutarPropuesta('07.redactar-briefs', { campana: nombre }, ctx), '07.redactar-briefs');
      }
      case 'revisar_texto_publicitario': {
        const p = intencion.parametros || {};
        if (!p.textoRef) return { categoria: 'consulta', estado: 'aclaracion', texto: 'Necesito el texto a revisar: pégalo entre comillas o después de dos puntos (máx. 4000 caracteres). Solo lo reviso; no lo publico ni lo modifico.', tareas: [], aprobaciones: [], avisos: [], afirmaciones: [] };
        if (p.textoBytes > 4000) return { categoria: 'consulta', estado: 'aclaracion', texto: 'El texto supera los 4000 caracteres: divídelo y revísalo por partes.', tareas: [], aprobaciones: [], avisos: [], afirmaciones: [] };
        const asign = evaluarAsignacion(this.registro, '07.revisar-texto-publicitario');
        if (!asign.ok) throw new ErrorProtocolo(asign.codigo, asign.motivo);
        return this._respMarketing(this.leerCapacidad('07.revisar-texto-publicitario', { textoRef: p.textoRef, textoBytes: p.textoBytes }, ctx), '07.revisar-texto-publicitario');
      }
      case 'analizar_analitica': {
        const asign = evaluarAsignacion(this.registro, '10.leer-analitica-agregada');
        if (!asign.ok) throw new ErrorProtocolo(asign.codigo, asign.motivo);
        return this._respAnalitica(this.leerCapacidad('10.leer-analitica-agregada', {}, ctx));
      }
      case 'proponer_portada':
      case 'guardar_borrador_portada': return this._atenderPortada(intencion, ctx);
      case 'analizar_precios': return this._respPrecios(this.ejecutarPropuesta('05.detectar-caidas-precio', {}, ctx));
      case 'analizar_importacion':
      case 'simular_importacion': return this._atenderImportacion(intencion, ctx);
      case 'estudiar_afiliacion':
      case 'comparar_afiliacion': return this._respAfiliacion(intencion, ctx, sinLedger);
      case 'consultar_suscripciones':
      case 'recomendar_suscripciones': return this._respSuscripciones(intencion.tipo === 'recomendar_suscripciones');
      case 'balance': return this._respBalance();
      case 'estado_tarea': return this._respEstadoTarea();
      case 'parada_total': {
        const p = this.paradaEmergencia('parada ordenada por el propietario');
        return { categoria: 'consulta', texto: `Parada de emergencia ${p.registrada ? 'registrada' : 'activa (sin registro: el ledger no está disponible)'}. Tareas canceladas: ${p.canceladas.length ? p.canceladas.join(', ') : 'ninguna'}. Las tareas nuevas quedan bloqueadas hasta reanudar. No hace falta aprobación.`, tareas: p.canceladas, aprobaciones: [], avisos: p.aviso ? [p.aviso] : [], afirmaciones: [] };
      }
      case 'detener': {
        const activas = this.listarTareas({ activas: true }).filter((t) => !intencion.agentes.length || intencion.agentes.includes(t.agente));
        if (!activas.length) return { categoria: 'consulta', texto: 'No consta ninguna tarea activa que detener (consultado el ledger).', tareas: [], aprobaciones: [], avisos: [], afirmaciones: [] };
        for (const t of activas) this.cancelarTarea(t.idTarea, 'detenida por el propietario');
        return { categoria: 'consulta', texto: `Canceladas (sin aprobación, constan en el ledger): ${activas.map((t) => t.idTarea).join(', ')}. En F1 no hay ejecuciones reales: no consta ningún efecto ya producido.`, tareas: activas.map((t) => t.idTarea), aprobaciones: [], avisos: [], afirmaciones: [] };
      }
      case 'resumen_general': return this._respResumenGeneral(ctx, sinLedger);
      case 'consultar_propuestas_reparacion': return this._respPropuestasReparacion(this._leerPropuestasReparacion('04.leer-propuestas-reparacion', intencion.parametros || {}, ctx), intencion);
      case 'desconocida': return { categoria: 'consulta', estado: 'sin_entender', texto: intencion.aclaracion || 'No he entendido la instrucción. Escribe «ayuda».' };
      default: break;
    }
    if (intencion.ambiguedad) return { categoria: 'consulta', estado: 'aclaracion', texto: intencion.ambiguedad };
    const ag = intencion.agentes[0];
    if (intencion.tipo === 'lanzar_auditoria') return this._respLanzar(intencion, ctx, sinLedger);
    if (intencion.tema === 'reparto_comercio') {
      const s = this._salvedades(ag, 'reparto_comercio');
      return { categoria: 'consulta', estado: 'respondida', texto: `No entrego un reparto por comercio como fiable. ${s.join(' ') || 'No consta una salvedad registrada, pero la instantánea no contiene el desglose por comercio.'}`, tareas: [], aprobaciones: [], avisos: s, afirmaciones: [{ texto: 'Incidencia abierta sobre el comercio', procedencia: `registro ${this.registro.version} (salvedad del agente ${ag})` }] };
    }
    const capSufijo = { consultar_informe: 'leer-ultimo-informe', listar_informes: 'leer-historial', comparar_informes: 'comparar-informes' }[intencion.tipo];
    const parametros = {};
    if (intencion.parametros.idEjecucion && intencion.tipo === 'consultar_informe') parametros.idEjecucion = intencion.parametros.idEjecucion;
    const capId = intencion.tipo === 'consultar_informe' && parametros.idEjecucion ? `${ag}.leer-historial` : `${ag}.${capSufijo}`;
    if (sinLedger) return this._consultaSinTarea(capId, parametros, intencion, ag);
    const res = this.leerCapacidad(capId, parametros, ctx);
    return this._respInforme(res, intencion, ag);
  }

  _respLanzar(intencion, ctx, sinLedger) {
    if (sinLedger) throw new ErrorProtocolo('ledger_no_disponible', 'Sin ledger no se inicia ninguna acción.');
    const capDe = (ag) => (ag === '04' ? '04.auditar-catalogo' : '12.auditar-salud');
    if (intencion.tema === 'plan') {
      const pasos = intencion.agentes.map((ag) => this.registro.buscarCapacidad(capDe(ag)));
      return { categoria: 'consulta', estado: 'sin_delegacion', texto: `No puedo encadenar ni lanzar auditorías todavía (la delegación llega en F3). No he creado ninguna tarea. Procedimiento manual, en este orden:\n${pasos.map((c, i) => `${i + 1}. ${c.id} (${c.nivelRiesgo}): ${c.procedimientoManual || c.motivoNoDisponible}`).join('\n')}\nEn F3 cada paso será una tarea L2 con su propia aprobación y el segundo solo arrancará con el primero completado y verificado.`, tareas: [], aprobaciones: [], avisos: [], afirmaciones: [{ texto: 'Los procedimientos proceden del registro', procedencia: `registro ${this.registro.version}` }] };
    }
    let capId;
    let parametros = {};
    if (intencion.tema === 'repetir') {
      const previas = [...this._proy().tareas.values()].filter((t) => ['L2', 'L3', 'L4'].includes(t.nivel)).sort((a, b) => a.idTarea.localeCompare(b.idTarea));
      const ultima = previas[previas.length - 1];
      if (!ultima) return { categoria: 'consulta', estado: 'aclaracion', texto: 'No consta ninguna ejecución anterior que repetir. ¿Qué auditoría quieres lanzar, 04 o 12?', tareas: [], aprobaciones: [], avisos: [], afirmaciones: [] };
      capId = ultima.capacidad;
      parametros = { ...ultima.parametros };
    } else {
      capId = capDe(intencion.agentes[0]);
    }
    for (const k of ['entorno', 'paginas']) if (intencion.parametros && intencion.parametros[k] !== undefined) parametros[k] = intencion.parametros[k];
    const r = this.solicitarEjecucion(capId, parametros, ctx);
    const a = r.aprobacion;
    const manual = r.cap.procedimientoManual && !r.ejecutableEnF1 ? `\nProcedimiento manual hoy: ${r.cap.procedimientoManual}` : '';
    const texto = `${r.reutilizada ? 'Ya existía una solicitud pendiente idéntica («ya está esperando tu confirmación»). ' : ''}Requiere tu aprobación (${a.nivel}). ${a.resumen}\nEn F1 la aprobación es SIMULADA: si apruebas, se valida todo el flujo pero NO se envía nada al agente.${manual}\nAprobación ${a.idAprobacion} · huella ${a.huella.slice(0, 19)}… · caduca ${a.caduca}\nPara simular: aprobar ${a.idAprobacion} --simulada   (o rechazar ${a.idAprobacion})`;
    return { categoria: 'pendiente', estado: 'esperando_aprobacion', texto, tareas: [r.idTarea], aprobaciones: [a.idAprobacion], avisos: r.aviso ? [r.aviso] : [], afirmaciones: [{ texto: 'La capacidad y su nivel proceden del registro', procedencia: `registro ${this.registro.version}` }] };
  }

  /** Respuesta del Agente 02 (propuesta L1, solo informes): programas de afiliación con procedencia; «no consta» lo que falta; nunca se da de alta ni cambia nada. */
  _respAfiliacion(intencion, ctx, sinLedger) {
    const estudiar = intencion.tipo === 'estudiar_afiliacion';
    const capId = estudiar ? '02.estudiar-programa-afiliacion' : '02.comparar-programas';
    const parametros = {};
    if (intencion.parametros.programa) parametros.programa = intencion.parametros.programa;
    if (intencion.parametros.categoria) parametros.categoria = intencion.parametros.categoria;
    if (estudiar && !parametros.programa) return { categoria: 'consulta', estado: 'aclaracion', texto: '¿Qué programa o red quieres estudiar? (amazon, aliexpress, ebay, awin, cj, admitad, tradedoubler, kwanko, etsy)', tareas: [], aprobaciones: [], avisos: [], afirmaciones: [] };
    let res;
    if (sinLedger) { const l = this._leerAfiliacion(capId, parametros); res = { idTarea: null, estado: 'completada', confirmada: false, sinDatos: !l.informe, lectura: l }; } else res = this.ejecutarPropuesta(capId, parametros, ctx);
    const tareas = res.idTarea ? [res.idTarea] : [];
    if (res.estado === 'fallida') return { categoria: 'consulta', estado: 'fallida', texto: `No he podido leer los datos de afiliación: ${res.error.mensaje} [${res.error.codigo}] No consta el dato.`, tareas, aprobaciones: [], avisos: [], afirmaciones: [] };
    if (res.sinDatos) {
      const disp = res.lectura && res.lectura.extra && res.lectura.extra.disponibles ? ` Programas disponibles: ${res.lectura.extra.disponibles.join(', ')}.` : '';
      return { categoria: 'consulta', estado: 'sin_datos', texto: `No consta el programa «${parametros.programa}» en los datos.${disp}`, tareas, aprobaciones: [], avisos: [], afirmaciones: [] };
    }
    const informe = res.lectura.informe;
    const extra = res.lectura.extra;
    const cap = this.registro.buscarCapacidad(capId);
    const clasif = clasificarFrescura(informe, cap.frescura, this.ahora());
    const regla = aplicarPregunta(clasif, 'presente');
    const avisos = [];
    const etiqueta = { comisionPct: ['comisión', '%'], cookieDias: ['cookie', 'días'], pagoMinimoEur: ['pago mínimo', '€'], periodoPagoDias: ['periodo de pago', 'días'], mercadoEspana: ['mercado España', ''] };
    const prov = (d) => `${d.verificacion}${d.fuente ? `, ${d.fuente}` : ''}${d.fecha ? `, ${String(d.fecha).slice(0, 10)}` : ''}`;
    let cuerpo;
    if (estudiar) {
      const p = extra.programa;
      const lineas = informe.hallazgos.filter((h) => h.regla === 'dato_declarado' || h.regla === 'dato_ausente').map((h) => {
        const e = etiqueta[h.evidencia.campo] || [h.evidencia.campo, ''];
        return h.regla === 'dato_declarado' ? `· ${e[0]}: ${typeof h.evidencia.valor === 'boolean' ? (h.evidencia.valor ? 'sí' : 'no') : `${h.evidencia.valor} ${e[1]}`.trim()} [${prov(h.evidencia)}]` : `· ${e[0]}: NO CONSTA`;
      });
      const cond = informe.hallazgos.filter((h) => h.regla === 'condicion_declarada' || h.regla === 'restriccion_declarada').map((h) => `· ${h.regla === 'condicion_declarada' ? 'condición' : 'restricción'}: ${h.evidencia.texto}`);
      cuerpo = `Programa ${p.nombre} (${p.tipo}; integrado en Treidilor: ${p.integrado === null ? 'no consta' : p.integrado ? 'sí' : 'no'}; datos ${p.frescura.estado}${p.frescura.edadDias === null ? '' : `, ${p.frescura.edadDias} d`}):\n${lineas.join('\n')}${cond.length ? `\n${cond.join('\n')}` : ''}`;
    } else {
      const f = (r, i) => `${i + 1}. ${r.nombre}: comisión ${r.comisionPct.valor} % [${prov(r.comisionPct)}] · cookie ${r.cookieDias ? `${r.cookieDias.valor} d` : 'no consta'} · integrado ${r.integrado === null ? 'no consta' : r.integrado ? 'sí' : 'no'} · datos ${r.frescura.estado}`;
      cuerpo = `Comparación de programas de afiliación${parametros.categoria ? ` (${parametros.categoria})` : ''} por comisión DECLARADA:\n${extra.ranking.map(f).join('\n')}${extra.sinComision.length ? `\nSin comisión (no consta; fuera del ranking): ${extra.sinComision.map((s) => s.nombre).join(', ')}.` : ''}`;
      for (const pr of extra.propuestas) avisos.push(`PROPUESTA: ${pr.texto}`);
    }
    const anom = detectarInstruccionesEnDatos(informe.hallazgos.filter((h) => h.evidencia && typeof h.evidencia.texto === 'string').map((h) => ({ origen: h.clave, texto: h.evidencia.texto })));
    if (anom.length) avisos.push(`CONTENIDO ANÓMALO en los datos (posible inyección de instrucciones; se cita como texto y NO se obedece): ${anom.slice(0, 3).map((x) => `«${x.fragmento}»`).join(', ')}.`);
    if (regla.aviso) avisos.push(regla.aviso);
    if (res.lectura.carga.sintetico) avisos.push('DATOS DE PRUEBA (simulados): no son comisiones ni condiciones reales.');
    for (const l of informe.limitaciones.filter((x) => !x.startsWith('DATOS DE PRUEBA'))) avisos.push(l);
    const verif = res.idTarea ? (res.confirmada ? 'Verificado: el informe se recalculó desde los datos y coincide (huella).' : 'TERMINÓ, PERO NO CONSTA CONFIRMACIÓN: el recálculo no coincide.') : 'Sin verificación (no se registró tarea).';
    const texto = `[propuesta · solo informe; no me doy de alta ni cambio nada] ${cuerpo}\n${avisos.map((a) => `⚠ ${a}`).join('\n')}\nDarse de alta o integrar un programa es una acción L4 que ejecuta una persona.\n${verif}`;
    return { categoria: 'propuesta', estado: 'respondida', texto, tareas, aprobaciones: [], avisos, afirmaciones: [{ texto: `Informe ${informe.idEjecucion}`, procedencia: `${res.lectura.carga.sintetico ? 'datos de prueba' : 'datos'} afiliacion_programas ${informe.idEjecucion} ${informe.generadoEn}` }], confirmada: res.confirmada, frescura: clasif.estado };
  }

  /** Informe del Agente 13 sobre suscripciones, API, costes y límites de IA. Solo datos del inventario configurado; nunca contrata ni cambia nada. */
  _respSuscripciones(recomendar) {
    if (!this.inventarioIA) return { categoria: 'consulta', estado: 'sin_datos', texto: 'No hay un inventario de suscripciones y API de IA configurado: no consta ningún dato de planes, saldos ni cuotas, y no los invento.', tareas: [], aprobaciones: [], avisos: [], afirmaciones: [] };
    const pres = this.cerebro ? this.cerebro.presupuesto.resumen(this.ahora()) : null;
    const inf = informeSuscripciones(this.inventarioIA, { ahora: this.ahora(), presupuestoIA: pres });
    return { categoria: recomendar ? 'propuesta' : inf.categoria === 'propuesta' ? 'consulta' : inf.categoria, estado: 'respondida', texto: `${inf.texto}\nNo he contratado, cambiado ni activado nada; cualquier cambio exige tu autorización expresa.`, tareas: [], aprobaciones: [], avisos: inf.avisos, afirmaciones: [{ texto: 'Inventario de planes y suscripciones de IA', procedencia: `${inf.simulado ? 'datos SIMULADOS' : 'inventario configurado'} (${this.inventarioIA.version || 's/v'})` }] };
  }

  _respBalance() {
    const p = this._proy();
    const t = [...p.tareas.values()];
    const ver = (x) => x.verificaciones.some((v) => v.resultado === 'confirmada');
    const ejec = t.filter((x) => x.estado === 'completada' && ver(x));
    const sinConf = t.filter((x) => (x.estado === 'parcial' || x.estado === 'completada') && !ver(x));
    const pend = t.filter((x) => ['creada', 'esperando_aprobacion', 'aceptada', 'en_curso'].includes(x.estado));
    const lista = (l) => (l.length ? l.map((x) => `· ${x.idTarea} · ${x.capacidad} · ${x.estado}`).join('\n') : '· (ninguna)');
    const texto = `Balance según el ledger (cuatro bloques separados):\nEJECUTADAS (evidencia verificada):\n${lista(ejec)}\nTERMINADAS SIN CONFIRMAR:\n${lista(sinConf)}\nPENDIENTES:\n${lista(pend)}\nPROPUESTAS: no consta: en F1 no hay almacén de propuestas.`;
    return { categoria: 'consulta', texto, tareas: t.map((x) => x.idTarea), aprobaciones: [], avisos: [], afirmaciones: [{ texto: 'Balance', procedencia: 'ledger' }] };
  }

  _respEstadoTarea() {
    const act = this.listarTareas({ activas: true });
    if (!act.length) return { categoria: 'consulta', texto: 'No consta ninguna tarea activa (consultado el ledger): no hay auditoría en marcha ni pendiente.', tareas: [], aprobaciones: [], avisos: [], afirmaciones: [] };
    return { categoria: 'consulta', texto: act.map((t) => `${t.idTarea} · ${t.capacidad} · estado real: ${t.estado.replace('_', ' ')} · plazo ${Math.round((t.sobre.plazoMs || 0) / 1000)} s${t.estado === 'en_curso' ? ' · NO está terminada: no anticipo su resultado' : ''}`).join('\n'), tareas: act.map((t) => t.idTarea), aprobaciones: [], avisos: [], afirmaciones: [{ texto: 'Estado de tareas', procedencia: 'ledger' }] };
  }

  _respResumenGeneral(ctx, sinLedger) {
    const secciones = [];
    const tareas = [];
    const afirm = [];
    const avisos = [];
    for (const ag of ['04', '12']) {
      try {
        const intencion = { tipo: 'consultar_informe', agentes: [ag], parametros: {}, pregunta: 'presente' };
        const res = sinLedger ? null : this.leerCapacidad(`${ag}.leer-ultimo-informe`, {}, ctx);
        const r = res ? this._respInforme(res, intencion, ag) : { texto: 'sin lectura registrada', tareas: [], afirmaciones: [], avisos: [] };
        secciones.push(`── ${ETIQUETA_AGENTE[ag]} ──\n${r.texto}`);
        tareas.push(...r.tareas);
        afirm.push(...r.afirmaciones);
      } catch (e) {
        if (!(e instanceof ErrorProtocolo)) throw e;
        secciones.push(`── ${ETIQUETA_AGENTE[ag]} ──\nNo consta: ${e.error.mensaje} [${e.codigo}]`);
      }
    }
    for (const s of this._salvedades('04')) avisos.push(`Incidencia abierta (agente 04): ${s}`);
    const texto = `Estado general (cada sección con su fuente y fecha; miden cosas distintas y las fechas pueden diferir; no emito un veredicto global):\n${secciones.join('\n')}\nEstado en vivo: no consta (en F1 no hay lectura en vivo).${avisos.length ? `\n⚠ ${avisos.join('\n⚠ ')}` : ''}`;
    return { categoria: 'consulta', estado: 'respondida', texto, tareas, aprobaciones: [], avisos, afirmaciones: afirm };
  }

  /** Con el ledger caído se lee la fuente sin crear tarea ni evidencia registrada. */
  _consultaSinTarea(capId, parametros, intencion, ag) {
    const cap = this.registro.buscarCapacidad(capId);
    const l = this.lector;
    const sufijo = capId.split('.')[1];
    const r = sufijo === 'leer-ultimo-informe' ? l.ultima(ag) : sufijo === 'comparar-informes' ? l.comparar(ag) : parametros.idEjecucion ? l.obtener(ag, String(parametros.idEjecucion)) : l.listar(ag, {});
    const informe = r.informe ?? (r.informes && r.informes[0]) ?? null;
    return this._respInforme({ estado: 'completada', confirmada: false, sinDatos: !informe, lectura: { informe, informes: r.informes, total: r.total, carga: r.carga, motivo: r.motivo }, cap, idTarea: null }, intencion, ag);
  }

  _respEstadoAgentes() {
    const lineas = this.estadoAgentes().map((a) => `${a.id} ${a.nombre}: ${a.estado} (estado ${a.origenEstado})${a.capacidades.length ? ' · ' + a.capacidades.map((c) => `${c.id} ${c.nivel}/${c.disponibilidad}`).join(', ') : ''}`);
    return { categoria: 'consulta', texto: `Registro ${this.registro.version} (borrador pendiente de revisión).\n${lineas.join('\n')}\n«comunicado» = lo afirma el propietario y nadie lo ha verificado. Capacidades «lectura_f1» = ejecutables ahora; «requiere_f3» = no invocable aún; «planificada» = no existe todavía.`, afirmaciones: [{ texto: 'Estado de los agentes', procedencia: `registro ${this.registro.version}` }] };
  }

  _respTareas() {
    const lista = this.listarTareas({ activas: true });
    if (!lista.length) return { categoria: 'consulta', texto: 'No hay tareas activas.' };
    return { categoria: 'consulta', texto: lista.map((t) => `${t.idTarea} · ${t.capacidad} · ${t.estado} · ${t.nivel}`).join('\n') };
  }

  /** Comunicados del propietario (p. ej. «he importado un lote») que invalidan un informe por EVENTO (A-01). */
  registrarComunicado(texto, { invalida = [] } = {}) {
    const ev = this._emitir('comunicado', 'propietario', {}, { texto: String(texto).slice(0, 2000), invalida, estado: 'sin_verificar' });
    return { idEvento: ev.idEvento, secuencia: ev.secuencia };
  }

  _comunicadosQueInvalidan(ag, desdeIso) {
    const tema = ag === '04' ? 'catalogo' : ag === '12' ? 'despliegue' : null;
    if (!tema) return [];
    try {
      return this.ledger.leer((e) => e.tipo === 'comunicado' && Array.isArray(e.datos.invalida) && e.datos.invalida.includes(tema) && Date.parse(e.instante) > Date.parse(desdeIso));
    } catch {
      return [];
    }
  }

  _respInforme(res, intencion, ag) {
    const nombre = ETIQUETA_AGENTE[ag] || ag;
    const agente = this.registro.agente(ag);
    const afirm = [];
    const avisos = [];
    const tareas = res.idTarea ? [res.idTarea] : [];
    if (res.estado === 'fallida') return { categoria: 'consulta', estado: 'fallida', texto: `No he podido leer los informes de ${nombre}: ${res.error.mensaje} [${res.error.codigo}] No consta el dato; no sé si la tabla existe en producción (el estado del agente es ${agente ? agente.origenEstado : 'desconocido'}) y habría que comprobarlo. No sustituyo el informe por otro.`, tareas, avisos, afirmaciones: afirm };
    if (res.sinDatos) {
      const motivo = res.lectura && res.lectura.motivo;
      if (motivo === 'no_hay_instantanea_anterior') {
        let unica = '';
        try { const u = this.lector.ultima(ag); unica = u.informe ? ` (${u.informe.idEjecucion}, ${u.informe.generadoEn})` : ''; } catch { unica = ''; }
        return { categoria: 'consulta', estado: 'linea_base', texto: `Solo consta una instantánea de ${nombre}${unica}: es la LÍNEA BASE y no hay una anterior con la que comparar. El seguimiento empieza con la siguiente ejecución. No invento cambios.`, tareas, avisos, afirmaciones: afirm };
      }
      return { categoria: 'consulta', estado: 'sin_datos', texto: `No consta ningún informe de ${nombre} en la exportación${motivo ? ` (${motivo})` : ''}.`, tareas, avisos, afirmaciones: afirm };
    }
    const lec = res.lectura;
    const cap = this.registro.buscarCapacidad(`${ag}.leer-ultimo-informe`);
    const informe = lec.informe;
    let clasif = clasificarFrescura(informe, cap.frescura, this.ahora());
    const invalidantes = this._comunicadosQueInvalidan(ag, informe.generadoEn);
    if (invalidantes.length && clasif.estado === 'vigente') { clasif = { ...clasif, estado: 'a_actualizar', motivos: [...clasif.motivos, 'invalidado_por_evento'] }; avisos.push(`Invalidado por EVENTO: el propietario comunicó después («${String(invalidantes[0].datos.texto).slice(0, 80)}», ${invalidantes[0].instante}): el informe puede no reflejar el estado actual.`); }
    else if (clasif.estado === 'vigente' && ag === '04') avisos.push('No consta si el catálogo cambió desde entonces fuera de lo registrado (importaciones o cambios que el Director no ve).');
    const regla = aplicarPregunta(clasif, intencion.pregunta);
    const proc = (i) => `${ag} · ${i.idEjecucion} · ${i.generadoEn} · ${i.fuente.origenDatos}`;
    let cuerpo;
    if (intencion.tema === 'numero_productos') {
      const n = informe.resumen.elementosTotales;
      cuerpo = n === null ? `No consta el número de productos en ${informe.idEjecucion}.` : `Lo último que CONSTA son ${n} productos leídos en ${informe.idEjecucion} (${informe.generadoEn}) [${clasif.estado === 'vigente' ? 'a esa fecha' : 'histórico'}]: NO es el valor actual ahora mismo; no hay lectura en vivo.`;
      afirm.push({ texto: `Productos leídos: ${n}`, procedencia: `${clasif.estado === 'vigente' ? 'informe' : 'histórico'} ${proc(informe)}` });
    } else if (intencion.tipo === 'listar_informes' && !intencion.parametros.idEjecucion) {
      cuerpo = `Informes de ${nombre} (más recientes primero; los históricos se conservan siempre):\n${(lec.informes || []).map((i) => `· ${i.idEjecucion} · ${i.generadoEn} · ${i.completo ? 'completo' : 'PARCIAL'} · ${i.resumen.incidencias} incidencias`).join('\n')}\nTotal en la exportación: ${lec.total}.`;
      for (const i of lec.informes || []) afirm.push({ texto: `Informe ${i.idEjecucion}`, procedencia: `histórico ${proc(i)}` });
    } else if (intencion.tipo === 'comparar_informes') {
      const s = informe.seguimiento;
      cuerpo = `Comparación en ${nombre}: ${s.comparadoCon} (${s.comparadoConGeneradoEn}) → ${informe.idEjecucion} (${informe.generadoEn}). Modo: ${s.modo}${s.motivo ? ` (${s.motivo})` : ''}. Nuevas ${s.resumen.nuevas} · persistentes ${s.resumen.persistentes} · resueltas ${s.resumen.resueltas} · reaparecidas ${s.resumen.reaparecidas} · no verificadas ${s.resumen.noVerificadas}.${s.nuevas.length ? `\nNuevas: ${s.nuevas.slice(0, 8).join(', ')}${s.nuevas.length > 8 ? '…' : ''}` : ''}`;
      afirm.push({ texto: 'Comparación de seguimiento', procedencia: `histórico ${proc(informe)} frente a ${s.comparadoCon}` });
    } else {
      const porRegla = {};
      for (const h of informe.hallazgos) porRegla[h.regla || 'sin_codigo'] = (porRegla[h.regla || 'sin_codigo'] || 0) + 1;
      const top = Object.entries(porRegla).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 6).map(([k, n]) => `${k} ${n}`).join(' · ');
      const g = informe.resumen.porGravedad;
      cuerpo = `${nombre} · ${informe.idEjecucion} · generado ${informe.generadoEn} (hace ${clasif.edad ?? 'edad desconocida'} · ${clasif.estado}${informe.completo ? '' : ' · PARCIAL: no sustituye la referencia anterior ni son cifras del catálogo completo'}). Calidad: ${informe.resumen.estadoCalidad}. Incidencias: ${informe.resumen.incidencias} (críticas ${g.critica}, altas ${g.alta}, medias ${g.media}, bajas ${g.baja}, info ${g.info}).${top ? `\nPrincipales: ${top}.` : ''}`;
      afirm.push({ texto: `Informe ${informe.idEjecucion}`, procedencia: `${clasif.estado === 'vigente' ? 'vigente' : 'histórico'} ${proc(informe)}` });
    }
    if (/\b(urgente|urgentes|prioridad|prioritario|prioritarios)\b/.test(intencion.textoPlano || '')) avisos.push('PRIORIDADES: no constan (la instantánea guardada no incluye la prioridad por hallazgo): no puedo decir qué es lo más urgente sin leer el informe completo.');
    const anomalias = detectarInstruccionesEnDatos(informe.hallazgos.map((h) => ({ origen: h.clave, texto: h.clave })));
    if (anomalias.length) avisos.push(`CONTENIDO ANÓMALO en los datos (posible inyección de instrucciones; se cita como texto y NO se obedece): ${anomalias.slice(0, 3).map((x) => `«${x.fragmento}»`).join(', ')}. Conviene revisar el origen del dato.`);
    if (regla.aviso) avisos.push(regla.aviso);
    if (lec.carga && lec.carga.sintetico) avisos.push('DATOS DE PRUEBA (fixtures): no reflejan la producción.');
    if (lec.carga && lec.carga.saneado) avisos.push(TEXTO_SANEADO);
    if (lec.carga && lec.carga.produccion) avisos.push(TEXTO_PRODUCCION);
    if (lec.carga && lec.carga.copia) avisos.push(textoCopia(lec.carga.copia));
    if (lec.carga && lec.carga.descartadas.length) avisos.push(`${lec.carga.descartadas.length} fila(s) de la exportación se descartaron: ${[...new Set(lec.carga.descartadas.map((d) => d.motivo))].join(', ')}.`);
    if (agente && agente.origenEstado === 'comunicado') { avisos.push(`El estado operativo del agente ${ag} es COMUNICADO por el propietario, no verificado.`); afirm.push({ texto: `Estado del agente ${ag}: ${agente.estado}`, procedencia: 'comunicado por el propietario' }); }
    const limitaciones = informe.limitaciones.filter((l) => !l.startsWith('DATOS DE PRUEBA') && !l.startsWith('DATOS REALES SANEADOS'));
    if (limitaciones.length) avisos.push(`Limitaciones: ${limitaciones.join(' ')}`);
    const verif = res.idTarea ? (res.confirmada ? 'Consistencia comprobada: una segunda lectura de la fuente coincide (huella). Eso no verifica que el dato de la fuente sea cierto.' : 'TERMINÓ, PERO NO CONSTA CONFIRMACIÓN: la segunda lectura no coincide.') : 'Sin verificación (no se registró tarea).';
    const ofrecer = regla.ofrecerActualizar ? `\nPuedo solicitar una auditoría nueva (L2, con tu aprobación; en F1 sería simulada).` : '';
    const texto = `${regla.tono === 'no_consta' ? `NO CONSTA un dato actual. ` : ''}${cuerpo}\n${avisos.map((a) => `⚠ ${a}`).join('\n')}\n${verif}${ofrecer}`.replace(/\n{2,}/g, '\n');
    return { categoria: 'consulta', estado: 'respondida', texto, tareas, avisos, afirmaciones: afirm, frescura: clasif.estado, confirmada: res.confirmada };
  }

  /** Presenta las propuestas de reparación del Agente 04 leídas del almacén de propuestas. */
  _respPropuestasReparacion(res, intencion) {
    const tareas = res.idTarea ? [res.idTarea] : [];
    const afirm = [];
    const avisos = [];
    if (res.estado === 'fallida') return { categoria: 'consulta', estado: 'fallida', texto: `No he podido leer las propuestas de reparación del Agente 04: ${res.error.mensaje} [${res.error.codigo}]. No consta el dato.`, tareas, avisos, afirmaciones: afirm };
    if (res.sinDatos) return { categoria: 'consulta', estado: 'sin_datos', texto: `No consta ninguna propuesta de reparación del Agente 04${res.motivo ? ` (${res.motivo})` : ''}.`, tareas, avisos, afirmaciones: afirm };
    const { propuestas, total } = res.lectura;
    if (!total) {
      return { categoria: 'consulta', estado: 'respondida', texto: 'No consta ninguna propuesta de reparación pendiente del Agente 04 en el almacén de propuestas. Todas las correcciones detectadas ya están aplicadas o no hay ninguna registrada.', tareas, avisos, afirmaciones: [{ texto: 'Propuestas de reparación del Agente 04', procedencia: 'almacén de propuestas (automation-proposals.json)' }] };
    }
    const l = [];
    l.push(`Propuestas de reparación del Agente 04 (calidad del catálogo): ${total} pendiente(s).`);
    for (const p of propuestas.slice(0, 10)) {
      l.push(`· ${p.id} · ${p.titulo} · producto ${p.productoId} · campo «${p.campo}» · ${p.valorAntes} → ${p.valorDespues} · riesgo ${p.riesgo} · creado ${p.creadoEn ? p.creadoEn.slice(0, 10) : '—'}`);
    }
    if (total > 10) l.push(`…y ${total - 10} más.`);
    l.push('Para aplicar una corrección es necesario tu aprobación en la interfaz autenticada (nivel L4, ejecuta una persona en el panel); el Director solo lee y propone, no modifica el catálogo.');
    afirm.push({ texto: `Propuestas de reparación pendientes: ${total}`, procedencia: `almacén de propuestas (automation-proposals.json) ${res.lectura.archivo}` });
    const verif = res.confirmada ? 'Consistencia comprobada: la segunda lectura del almacén coincide.' : 'TERMINÓ, PERO NO CONSTA CONFIRMACIÓN: la segunda lectura no coincide.';
    return { categoria: 'consulta', estado: res.estado, texto: `${l.join('\n')}\n${verif}`, tareas, avisos, afirmaciones: afirm, confirmada: res.confirmada };
  }
}

// ── apoyo para la voz: sugerencias por distancia de edición ──────────────────────────────────────────────────────────────────
function distancia(a, b) {
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return m[a.length][b.length];
}
const VOCABULARIO = ['temu', 'amazon', 'ebay', 'aliexpress', 'awin', 'etsy', 'catalogo', 'portada', 'auditoria'];
const NUMEROS = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece'];
const plano2 = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Palabras de la transcripción que se parecen (sin ser iguales) a términos conocidos: «tenu» → «temu». */
export function sugerirCorreccion(texto) {
  const out = [];
  for (const w of plano2(texto).match(/[a-z]{4,}/g) || []) {
    for (const v of VOCABULARIO) if (w !== v && distancia(w, v) <= (v.length <= 5 ? 1 : 2) && !out.includes(v)) out.push(v);
  }
  return out;
}
/** Ids de agente plausibles para una palabra de número mal reconocida («cuarenta» → 04). */
export function sugerirAgentes(palabra) {
  const w = plano2(palabra);
  return NUMEROS.map((n, i) => [n, i]).filter(([n]) => distancia(w, n) <= 4).sort((a, b) => distancia(w, a[0]) - distancia(w, b[0])).slice(0, 3).map(([, i]) => String(i).padStart(2, '0'));
}

const AYUDA = 'Puedo: consultar el último informe de calidad (04) o del auditor (12) · listar informes anteriores · compararlos · mostrar agentes y capacidades · mostrar tareas · y SIMULAR la aprobación para lanzar una auditoría (L2; en F1 no se envía nada). No ejecuto acciones sobre el sistema (L4: publicar, importar, corregir…: las hace una persona en el panel) ni nada de forma autónoma o programada.';
export { CONFIG_DEFECTO };
