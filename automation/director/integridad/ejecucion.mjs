/**
 * Agente 00 · 3E.8.8 · EJECUCIÓN SUPERVISADA de la verificación de integridad (una sola pasada del comando del prototipo, en un proceso independiente).
 * SIN planificador: esta función la invoca quien decida (n8n, el Director, un planificador externo); este módulo no crea temporizadores ni servicios.
 *
 *  · Decide si toca (primera obligatoria, intervalo de 6 h) a partir del LEDGER, no del registro del almacén; «no toca» y «aplazada» NO lanzan nada ni avanzan el ancla.
 *  · Evita solaparse con el gestor/vigilante (franjas prohibidas en hora de Madrid) y con otra ejecución del mismo trabajo (cerrojo con caducidad).
 *  · Lanza el comando con límites (reloj, montón de V8, salida acotada, entorno mínimo, sin shell) y trata la terminación inesperada como error operativo.
 *  · Mapea la salida 0/1/2/3 sin cambiar su semántica y SOLO avanza el ancla tras una verificación completa y correcta contrastada con el ancla vigente.
 *  · Deja constancia en el ledger (`integridad_ejecucion`, `ancla_integridad`, `integridad_discrepancia` sin duplicar). No repara, no mueve, no elimina nada.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { sha256 } from '../protocolo.mjs';
import { CONFIG_INTEGRIDAD } from './config.mjs';
import { anclar, decidirAnclaje, leerAncla, ID_ALMACEN } from './ancla.mjs';
import { contrastarAncla, evaluarFrescura, exportarAncla, leerCopias } from './copia-ancla.mjs';
import { anclaDe, corta, debeEjecutar, enVentanaProhibida, estadoIntegridad, leerEventosIntegridad, validarPoliticaIntegridad } from './estado.mjs';

/** Semántica de los códigos de salida del comando (no se reinterpretan). */
export function mapearCodigo(codigo) {
  switch (codigo) {
    case 0: return { nivel: 'ok', significado: 'correcta', reintentar: false };
    case 1: return { nivel: 'fallo', significado: 'alteracion_confirmada', reintentar: false };
    case 2: return { nivel: 'aviso', significado: 'aviso', reintentar: true };
    case 3: return { nivel: 'aviso', significado: 'error_operativo', reintentar: true };
    default: return { nivel: 'aviso', significado: 'error_operativo', reintentar: true };
  }
}

// ── cerrojo del trabajo (un solo proceso por almacén) ─────────────────────────
export function tomarBloqueo({ dir, idAlmacen, caducaMs, ahora }) {
  const ruta = path.join(dir, `integridad-${idAlmacen}.lock`); const token = randomBytes(8).toString('hex');
  for (let i = 0; i < 2; i += 1) {
    try { const fd = fs.openSync(ruta, 'wx'); try { fs.writeSync(fd, JSON.stringify({ pid: process.pid, en: ahora, token })); } finally { fs.closeSync(fd); } return { ok: true, ruta, token }; } catch (e) {
      const contencion = e.code === 'EEXIST' || (process.platform === 'win32' && ['EPERM', 'EBUSY', 'EACCES'].includes(e.code));
      if (!contencion) return { ok: false, motivo: `bloqueo_no_disponible:${e.code}` };
      const st = fs.statSync(ruta, { throwIfNoEntry: false });
      if (st && Date.now() - st.mtimeMs > caducaMs) { try { fs.unlinkSync(ruta); } catch { /* otro proceso lo retiró */ } continue; } // cerrojo huérfano (proceso muerto)
      return { ok: false, motivo: 'ya_en_ejecucion' };
    }
  }
  return { ok: false, motivo: 'ya_en_ejecucion' };
}
/** ¿El almacén tiene un cerrojo de escritura reciente? (solo lectura de su metadato; el reloj es el real porque se compara con la fecha del archivo). */
export function almacenOcupado(almacenDir, escrituraEnCursoMs) { try { return Date.now() - fs.statSync(path.join(almacenDir, 'bloqueo.json')).mtimeMs < escrituraEnCursoMs; } catch { return false; } }
export function soltarBloqueo(b) { try { if (JSON.parse(fs.readFileSync(b.ruta, 'utf8')).token === b.token) fs.unlinkSync(b.ruta); } catch { /* ya retirado */ } }

// ── proceso hijo con límites ──────────────────────────────────────────────────
const ENV_PERMITIDO = ['SystemRoot', 'TEMP', 'TMP', 'TMPDIR', 'PATH', 'HOME', 'USERPROFILE', 'LANG'];
export function lanzarComando({ nodo = process.execPath, cli, args, timeoutMs, maxOldSpaceMiB, maxSalidaBytes, env = process.env }) {
  return new Promise((resolve) => {
    const t0 = Date.now(); let out = ''; let err = ''; let bytes = 0; let timeout = false; let excesiva = false; let fin = false;
    const entorno = Object.fromEntries(ENV_PERMITIDO.filter((k) => env[k] !== undefined).map((k) => [k, env[k]]));
    let hijo;
    try { hijo = spawn(nodo, [`--max-old-space-size=${maxOldSpaceMiB}`, cli, ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false, env: entorno }); } catch (e) { return resolve({ codigo: null, senal: null, stdout: '', stderr: '', duracionMs: 0, timeout: false, salidaExcesiva: false, errorLanzamiento: e && e.code ? String(e.code) : 'spawn' }); }
    const matar = () => { try { hijo.kill('SIGKILL'); } catch { /* ya terminó */ } };
    const reloj = setTimeout(() => { timeout = true; matar(); }, timeoutMs);
    hijo.stdout.on('data', (d) => { bytes += d.length; if (bytes > maxSalidaBytes) { if (!excesiva) { excesiva = true; matar(); } return; } out += d; });
    hijo.stderr.on('data', (d) => { if (err.length < 2000) err += d; });
    const terminar = (codigo, senal, errorLanzamiento = null) => { if (fin) return; fin = true; clearTimeout(reloj); resolve({ codigo, senal, stdout: out, stderr: err.slice(0, 500), duracionMs: Date.now() - t0, timeout, salidaExcesiva: excesiva, errorLanzamiento }); };
    hijo.on('error', (e) => terminar(null, null, e && e.code ? String(e.code) : 'spawn'));
    hijo.on('close', (codigo, senal) => terminar(codigo, senal));
  });
}

/** Interpreta la salida del comando y la contrasta con su código de proceso. Cualquier incoherencia es un error operativo (nunca «correcta»). */
export function interpretarSalida(proc) {
  const err = (motivo) => ({ resultado: 'error', codigoSalida: 3, omitida: false, completa: false, cabeza: null, anclaExterna: null, comparacionRegistro: null, referencia: null, segmentos: null, eventosTotales: null, reintento: false, recursos: null, motivos: [motivo], procesoCodigo: proc.codigo });
  if (proc.errorLanzamiento) return err(`no_se_pudo_lanzar:${proc.errorLanzamiento}`);
  if (proc.timeout) return err('timeout');
  if (proc.salidaExcesiva) return err('salida_excesiva');
  if (proc.senal) return err(`terminacion_inesperada:${proc.senal}`);
  const linea = proc.stdout.trim().split('\n').filter(Boolean).pop();
  let j; try { j = JSON.parse(linea); } catch { return err('salida_no_valida'); }
  if (!j || j.formato !== 'integridad-ejecucion/1' || !Number.isInteger(j.codigoSalida) || j.codigoSalida < 0 || j.codigoSalida > 3 || typeof j.resultado !== 'string') return err('salida_no_valida');
  if (proc.codigo !== j.codigoSalida) return err('codigo_de_proceso_distinto_del_declarado');
  const permitidos = { ok: [0, 2, 3], incompleta: [2, 3], error: [3], alterada: [1], retroceso: [1] }[j.resultado];
  if (!permitidos) return err('salida_no_valida');
  if (!j.omitida && !permitidos.includes(j.codigoSalida)) return err('resultado_incoherente_con_el_codigo');
  const t = j.tentativa ?? {};
  return { resultado: j.resultado, codigoSalida: j.codigoSalida, omitida: Boolean(j.omitida), completa: t.completa === true, cabeza: t.cabeza ?? null, anclaExterna: t.anclaExterna ?? null, comparacionRegistro: t.comparacion ?? null, referencia: t.referencia ?? null, segmentos: t.segmentos ?? null, eventosTotales: t.eventosTotales ?? null, reintento: Boolean(t.reintento), recursos: j.recursos ?? null, duracionMs: t.duracionMs ?? null, motivos: Array.isArray(t.motivos) ? t.motivos.slice(0, 8).map((m) => String(m).slice(0, 80)) : (j.motivos ?? []), registroEscrito: j.registroEscrito, procesoCodigo: proc.codigo };
}

/**
 * Una pasada supervisada. Devuelve siempre un objeto (nunca lanza por el comando). `estado`: no_toca | aplazada_ventana | ya_en_ejecucion | configuracion_invalida | ejecutada.
 * @param {object} o  ledger (LedgerLocal de la partición `integridad`) · idAlmacen · almacenDir · cli (ruta absoluta al comando) · frioDir? · maxTareas? · maxTareasTotales? · reloj()→ms · config · forzar · reanclar
 */
export async function ejecutarIntegridadSupervisada({ ledger, idAlmacen, almacenDir, cli, frioDir = null, maxTareas = null, maxTareasTotales = null, techoExperimental = false, reloj = () => Date.now(), config = CONFIG_INTEGRIDAD, forzar = false, reanclar = null, copiaExterna = null, dirBloqueo = null, env = process.env } = {}) {
  const ahora = reloj();
  const pol = validarPoliticaIntegridad(config.politica);
  if (!ID_ALMACEN.test(String(idAlmacen)) || !path.isAbsolute(String(almacenDir)) || !path.isAbsolute(String(cli)) || (frioDir && !path.isAbsolute(frioDir)) || !pol.ok) return { estado: 'configuracion_invalida', ejecutado: false, motivos: pol.ok ? ['parametros_no_validos'] : pol.errores };
  const lec = leerEventosIntegridad(ledger, idAlmacen);
  if (!forzar) {
    if (enVentanaProhibida(ahora, config.ventanasProhibidas, config.zonaHoraria)) return { estado: 'aplazada_ventana', ejecutado: false, motivos: ['franja_del_gestor_y_vigilante'] };
    if (almacenOcupado(almacenDir, config.escrituraEnCursoMs ?? 120000)) return { estado: 'aplazada_escritura_en_curso', ejecutado: false, motivos: ['almacen_escribiendose'] };
    if (lec.ok) { const d = debeEjecutar({ eventos: lec.eventos, ahora, politica: config.politica }); if (!d.debe) return { estado: 'no_toca', ejecutado: false, motivo: d.motivo, edadMs: d.edadMs, estadoIntegridad: estadoIntegridad({ ledger, idAlmacen, ahora, config }) }; }
  }
  const b = tomarBloqueo({ dir: dirBloqueo ?? ledger.dir, idAlmacen, caducaMs: config.bloqueoCaducaMs, ahora });
  if (!b.ok) return { estado: b.motivo === 'ya_en_ejecucion' ? 'ya_en_ejecucion' : 'bloqueo_no_disponible', ejecutado: false, motivos: [b.motivo] };
  try {
    const ancla = lec.ok ? anclaDe(lec.eventos) : null;
    // COPIA EXTERNA FIRMADA (opcional): si es válida, íntegra y fresca y más nueva que el ledger (o el ledger no existe), el contraste se hace con ELLA; nunca reancla nada por sí sola
    let anclaContraste = ancla; let infoCopia = null;
    if (copiaExterna && !reanclar) {
      const c = leerCopias({ destino: copiaExterna.destino, publica: copiaExterna.publica, idAlmacen }); const fr = evaluarFrescura({ mejor: c.mejor, referencia: copiaExterna.referencia });
      infoCopia = { estado: c.ok ? fr.estado : c.motivo, contador: c.mejor ? c.mejor.contador : null, invalidas: c.invalidas.length, huecos: c.huecos.length, cadenaOk: c.cadenaOk, contraste: null };
      if (c.ok && c.mejor && fr.estado !== 'obsoleta' && c.cadenaOk) {
        const cmp = contrastarAncla({ ledgerAncla: lec.ok ? ancla : null, copia: c.mejor }); infoCopia.contraste = cmp.estado;
        if (cmp.estado === 'distintas') {
          // se aplaza sin lanzar nada, pero la situación QUEDA REGISTRADA (una vez por situación) para que el estado la muestre como fallo
          const l2 = leerEventosIntegridad(ledger, idAlmacen); const ultSat = l2.ok ? l2.eventos.filter((x) => x.tipo === 'integridad_ejecucion' && x.datos.resultado === 'ok' && x.datos.completa === true).pop() : null;
          const idEvento = `int-cdisc-${idAlmacen}-${ultSat ? ultSat.secuencia : 0}-${sha256(`${ancla ? ancla.seq : 'sin'}|${c.mejor.contador}|${c.mejor.huella}`).replace(/^sha256:/, '').slice(0, 16)}`;
          let registrada = 'ya_registrada';
          try { if (!(l2.ok && l2.eventos.some((x) => x.idEvento === idEvento))) { ledger.anadir({ tipo: 'integridad_ejecucion', actor: 'sistema', refs: { idAlmacen }, datos: { esquema: 'integridad-ejecucion-director/1', idEjecucion: `${idAlmacen}-cdisc`, resultado: 'error', codigoSalida: 3, nivel: 'aviso', completa: false, cabeza: null, accionAncla: 'no_anclar', motivoAncla: 'ancla_copia_distinta_del_ledger', motivos: ['ancla_copia_distinta_del_ledger'], motivoEjecucion: forzar ? 'forzada' : 'programada_por_politica', copiaExterna: infoCopia }, idEvento }); registrada = 'registrada'; } } catch { registrada = 'no_registrada'; }
          return { estado: 'discrepancia_ancla_externa', ejecutado: false, motivos: ['ancla_copia_distinta_del_ledger'], copiaExterna: infoCopia, discrepancia: registrada };
        }
        if (cmp.estado === 'ledger_atrasado' || cmp.estado === 'sin_ledger') anclaContraste = cmp.efectiva;
      }
    }
    const args = ['--almacen', almacenDir, ...(frioDir ? ['--frio', frioDir] : []), ...(maxTareas ? ['--max-tareas', String(maxTareas)] : []), ...(maxTareasTotales ? ['--max-tareas-totales', String(maxTareasTotales)] : []), ...(techoExperimental ? ['--techo-experimental'] : [])];
    // con el ledger íntegro y sin reanclaje se contrasta con el ancla (o se declara que no hay); en cualquier otro caso no se compara nada
    if (!reanclar && (lec.ok || anclaContraste)) { if (anclaContraste) args.push('--ancla-seq', String(anclaContraste.seq), '--ancla-huella', anclaContraste.huella); else args.push('--sin-ancla'); }
    const proc = await lanzarComando({ cli, args, timeoutMs: config.timeoutMs, maxOldSpaceMiB: config.maxOldSpaceMiB, maxSalidaBytes: config.maxSalidaBytes, env });
    const r = interpretarSalida(proc); const idEjecucion = `${idAlmacen}-${ahora.toString(36)}-${randomBytes(3).toString('hex')}`;
    const mapa = mapearCodigo(r.codigoSalida);
    const salida = { estado: 'ejecutada', ejecutado: true, idEjecucion, resultado: r.resultado, codigoSalida: r.codigoSalida, significado: mapa.significado, nivel: mapa.nivel, omitida: r.omitida, cabeza: r.cabeza, duracionMs: proc.duracionMs, recursos: r.recursos, motivos: r.motivos };
    if (r.omitida) return { ...salida, accionAncla: 'no_anclar', motivoAncla: 'omitida', anclaEstado: lec.ok ? 'vigente_o_ausente' : 'ilegible' }; // un resultado omitido no deja huella ni avanza nada
    if (!lec.ok) return { ...salida, accionAncla: 'no_anclar', motivoAncla: 'ledger_no_integro', anclaEstado: 'ilegible', registrado: false };
    // decisión de anclaje y escritura (primero el ancla, después el resumen de la ejecución)
    const dec = decidirAnclaje({ ancla, resultadoCli: r, reanclar });
    let accionAncla = dec.accion; let motivoAncla = dec.motivo; let resultado = r.resultado; let codigoSalida = r.codigoSalida; let motivos = [...r.motivos];
    if (dec.accion === 'anclar') {
      try { const a = anclar(ledger, { idAlmacen, cabeza: r.cabeza, motivo: dec.motivo, idEjecucion, segmentos: r.segmentos, eventosTotales: r.eventosTotales, reanclar }); accionAncla = a.accion; motivoAncla = a.motivo ?? dec.motivo; if (a.accion === 'rechazado') { resultado = 'error'; codigoSalida = 3; motivos.push(`ancla_rechazada:${a.motivo}`); } } catch (e) { accionAncla = 'fallida'; motivoAncla = e && e.codigo ? String(e.codigo) : 'ancla_no_escrita'; resultado = 'error'; codigoSalida = 3; motivos.push('ancla_no_escrita'); }
    } else if (dec.accion === 'discrepancia') { resultado = 'retroceso'; codigoSalida = 1; motivos.push(`ancla_discrepancia:${dec.motivo}`); }
    else if (dec.accion === 'no_anclar' && r.codigoSalida === 0 && r.resultado === 'ok' && ['ancla_ausente_con_historial', 'ancla_no_comprobada', 'reanclaje_sin_autorizacion'].includes(dec.motivo)) { resultado = 'sin_ancla'; codigoSalida = 2; motivos.push(dec.motivo); } // correcta en el almacén pero SIN ancla fiable: aviso, no «satisfactoria»
    const nivel = mapearCodigo(codigoSalida).nivel;
    if (copiaExterna && copiaExterna.privada && ['anclado', 'sin_cambio'].includes(accionAncla)) { const x = exportarAncla({ ledger, idAlmacen, destino: copiaExterna.destino, privada: copiaExterna.privada, publica: copiaExterna.publica, reloj, almacenDir, exigirOtraUnidad: copiaExterna.exigirOtraUnidad !== false }); infoCopia = { ...(infoCopia ?? {}), exportacion: x.estado, exportacionMotivo: x.motivo ?? null, contadorExportado: x.contador ?? null }; }
    const datos = { esquema: 'integridad-ejecucion-director/1', idEjecucion, resultado, codigoSalida, nivel, completa: r.completa === true && resultado === 'ok', cabeza: r.cabeza, segmentos: r.segmentos, eventosTotales: r.eventosTotales, anclaExterna: r.anclaExterna, comparacionRegistro: r.comparacionRegistro, accionAncla, motivoAncla, duracionMs: proc.duracionMs, recursos: r.recursos, reintento: r.reintento, motivos: motivos.slice(0, 8), motivoEjecucion: forzar ? 'forzada' : 'programada_por_politica', procesoCodigo: r.procesoCodigo ?? null, ...(infoCopia ? { copiaExterna: infoCopia } : {}) };
    let registrado = true; let discrepancia = null;
    try {
      ledger.anadir({ tipo: 'integridad_ejecucion', actor: 'sistema', refs: { idAlmacen }, datos, idEvento: `int-${idEjecucion}` });
      if (['alterada', 'retroceso'].includes(resultado) || accionAncla === 'discrepancia') {
        const l2 = leerEventosIntegridad(ledger, idAlmacen); const ultSat = l2.ok ? l2.eventos.filter((x) => x.tipo === 'integridad_ejecucion' && x.datos.resultado === 'ok' && x.datos.completa === true).pop() : null;
        const clave = `${resultado}|${[...motivos].sort().join(',')}|${ancla ? ancla.seq : 'sin'}|${r.cabeza ? r.cabeza.seq : 'x'}`; const h = sha256(clave).replace(/^sha256:/, '').slice(0, 16);
        const idDisc = `disc-${idAlmacen}-${ultSat ? ultSat.secuencia : 0}-${h}`;
        if (l2.ok && l2.eventos.some((x) => x.idEvento === idDisc)) discrepancia = 'ya_registrada'; // alertas duplicadas: misma situación, sin una nueva verificación correcta entre medias
        else { const d = ledger.anadir({ tipo: 'integridad_discrepancia', actor: 'sistema', refs: { idAlmacen }, datos: { esquema: 'integridad-discrepancia/1', resultado, motivos: motivos.slice(0, 8), cabezaObservada: r.cabeza ? { seq: r.cabeza.seq, huella: corta(r.cabeza.huella) } : null, anclaVigente: ancla ? { seq: ancla.seq, huella: corta(ancla.huella) } : null, idEjecucion, desdeSecuenciaCorrecta: ultSat ? ultSat.secuencia : 0 }, idEvento: idDisc });
        discrepancia = d.duplicado ? 'ya_registrada' : 'registrada'; }
      }
    } catch { registrado = false; }
    return { ...salida, resultado, codigoSalida, significado: mapearCodigo(codigoSalida).significado, nivel, accionAncla, motivoAncla, anclaEstado: accionAncla === 'anclado' || accionAncla === 'sin_cambio' ? 'vigente' : (ancla ? 'vigente' : 'ausente'), discrepancia, registrado, motivos, ...(infoCopia ? { copiaExterna: infoCopia } : {}), estadoIntegridad: estadoIntegridad({ ledger, idAlmacen, ahora: reloj(), config }) };
  } finally { soltarBloqueo(b); }
}
export { leerAncla, estadoIntegridad };
