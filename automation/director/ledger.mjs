/**
 * Agente 00 · F1.2 · LEDGER LOCAL de solo adición (D3 mínimo de F1; el almacén transaccional llega antes de F3).
 * Implementa la interfaz lógica AlmacénLedger de MEMORIA-LEDGER-DISENO.md §7:
 *   añadir(evento, secuenciaEsperada) · leer(filtro) · ultimaSecuencia() · verificarCadena() · exportar() + copia de seguridad y restauración.
 * Propiedades: solo añadir; secuencia sin huecos; instante asignado por el ledger; cadena de huellas (alterar un evento rompe la cadena);
 * escritura con fsync; comparación de secuencia (compare-and-set) y bloqueo de proceso; filtro de secretos; tamaño acotado; idempotencia por idEvento.
 * INTEGRIDAD Y RECUPERACIÓN: una escritura interrumpida deja una «cola incompleta» que se DETECTA y se aparta SIN borrarla
 * (`recuperarColaIncompleta`, acción explícita); un truncado de líneas completas se detecta con el archivo ancla; nada se repara en silencio.
 * Limitación honesta: es un archivo local; quien tenga acceso al disco puede reescribir archivo Y ancla a la vez. No sustituye a un almacén
 * con control de acceso (requisito antes de F3).
 */
import fs from 'node:fs';
import path from 'node:path';
import { canonico, sha256, crearGeneradorIds } from './protocolo.mjs';
import { CONFIG_DEFECTO, RAIZ_REPOSITORIO } from './config.mjs';

export const ESQUEMA_EVENTO = 'evento-ledger/1';
export const GENESIS = `sha256:${'0'.repeat(64)}`;
export const TIPOS_EVENTO = Object.freeze([
  'solicitud', 'intencion', 'plan', 'plan_modificado', 'tarea_creada', 'tarea_estado', 'tarea_cancelada', 'aprobacion_solicitada', 'aprobacion_resuelta',
  'delegacion_enviada', 'solicitud_duplicada', 'ejecucion_humana_confirmada', 'respuesta_recibida', 'evidencia', 'verificacion', 'mensaje_al_propietario',
  'decision_propuesta', 'decision_resuelta', 'propuesta_abierta', 'propuesta_resuelta', 'comunicado', 'comunicado_verificado', 'consumo', 'limite_alcanzado',
  'parada_emergencia', 'registro_cambiado', 'lectura_estado', 'resumen', 'corrige', 'error',
  // Aditivos de F1 (tipos nuevos, sin tocar los anteriores): simulación de la delegación y reanudación tras una parada.
  'delegacion_simulada', 'parada_levantada',
  // Aditivos de 3E.8.8 (anclaje externo de la integridad del diario y su ejecucion supervisada; particion `integridad`, ver integridad/).
  'ancla_integridad', 'integridad_ejecucion', 'integridad_discrepancia',
]);

export class ErrorLedger extends Error {
  constructor(codigo, mensaje, detalle) {
    super(mensaje);
    this.name = 'ErrorLedger';
    this.codigo = codigo;
    this.detalle = detalle;
  }
}

// ── filtro de secretos (el mensaje de error NUNCA incluye el valor detectado) ────────────────────────────────────────────────
const PATRONES_SECRETO = [
  ['clave_api', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['clave_anthropic', /\bsk-ant-[A-Za-z0-9_-]{10,}/],
  ['bearer', /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/],
  ['token_automatizacion', /\btai_[0-9a-f]{8,}_[A-Za-z0-9_-]{20,}/],
  ['clave_privada', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\./],
  ['token_github', /\b(ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}/],
  ['asignacion_secreta', /\b(password|passwd|secret|token|api[_-]?key)\b\s*[:=]\s*['"]?[A-Za-z0-9/+_-]{12,}/i],
];
/** Nombre del patrón de credencial detectado en un texto, o null. */
export function detectarSecreto(texto) {
  for (const [nombre, rx] of PATRONES_SECRETO) if (rx.test(texto)) return nombre;
  return null;
}

const esperarMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const dentroDe = (hijo, padre) => {
  const rel = path.relative(path.resolve(padre), path.resolve(hijo));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};
const huellaDe = (ev) => {
  const { huella, ...resto } = ev;
  return sha256(canonico(resto));
};
const esActorValido = (a) => ['propietario', 'director', 'sistema', 'orquestador'].includes(a) || /^agente:\d{2}$/.test(a);

export class LedgerLocal {
  /**
   * @param {object} o  dir (obligatorio, fuera del repositorio) · particion · reloj() → Date · ids · limites · raiz (repositorio a evitar)
   */
  constructor({ dir, particion = CONFIG_DEFECTO.ledger.particion, reloj = () => new Date(), ids = crearGeneradorIds(), limites = {}, raiz = RAIZ_REPOSITORIO } = {}) {
    if (!dir) throw new ErrorLedger('ledger_sin_directorio', 'Falta el directorio del ledger.');
    if (dentroDe(dir, raiz)) throw new ErrorLedger('ledger_dentro_del_repositorio', 'El ledger debe estar FUERA del repositorio (D3).');
    if (!/^[a-z0-9_-]{1,40}$/i.test(particion)) throw new ErrorLedger('particion_invalida', 'Nombre de partición inválido.');
    this.dir = path.resolve(dir);
    this.raiz = raiz;
    this.particion = particion;
    this.reloj = reloj;
    this.ids = ids;
    this.limites = { ...CONFIG_DEFECTO.ledger, ...limites };
    this.archivo = path.join(this.dir, `ledger-${particion}.jsonl`);
    this.ancla = path.join(this.dir, `ledger-${particion}.ancla.json`);
    this.cerrojo = path.join(this.dir, `ledger-${particion}.lock`);
    fs.mkdirSync(this.dir, { recursive: true });
    this._cache = null;
  }

  // ── lectura y verificación ──────────────────────────────────────────────────────────────────────────────────────────────────
  /** Lee el archivo completo y verifica la cadena. No modifica nada. */
  _leer() {
    const st = fs.statSync(this.archivo, { throwIfNoEntry: false });
    if (!st) return { eventos: [], cola: null, errores: [], bytesBuenos: 0, sinSalto: false };
    if (this._cache && this._cache.size === st.size && this._cache.mtimeMs === st.mtimeMs) return this._cache.lectura;
    const buf = fs.readFileSync(this.archivo);
    const texto = buf.toString('utf8');
    const trozos = texto.split('\n');
    const terminaEnSalto = texto.endsWith('\n') || texto.length === 0;
    const ultimo = trozos.pop(); // '' si termina en salto; si no, posible cola incompleta
    const errores = [];
    const eventos = [];
    let prev = GENESIS;
    let bytesBuenos = 0;
    const comprobar = (ev, n) => {
      if (!ev || typeof ev !== 'object') return `línea ${n}: no es un objeto`;
      if (ev.secuencia !== eventos.length + 1) return `línea ${n}: secuencia ${ev.secuencia} (se esperaba ${eventos.length + 1})`;
      if (ev.huellaPrevia !== prev) return `línea ${n}: la huella previa no encadena`;
      if (huellaDe(ev) !== ev.huella) return `línea ${n}: la huella no coincide con el contenido (evento alterado)`;
      return null;
    };
    for (const [i, linea] of trozos.entries()) {
      let ev = null;
      try { ev = JSON.parse(linea); } catch { ev = null; }
      const fallo = comprobar(ev, i + 1);
      if (fallo) {
        errores.push(fallo);
        break;
      }
      eventos.push(ev);
      prev = ev.huella;
      bytesBuenos += Buffer.byteLength(linea) + 1;
    }
    let cola = null;
    let sinSalto = false;
    if (!errores.length && ultimo !== '' && !terminaEnSalto) {
      let ev = null;
      try { ev = JSON.parse(ultimo); } catch { ev = null; }
      if (ev && !comprobar(ev, trozos.length + 1)) {
        eventos.push(ev); // evento completo al que solo le falta el salto de línea
        sinSalto = true;
        bytesBuenos += Buffer.byteLength(ultimo);
      } else cola = { bytes: Buffer.byteLength(ultimo), desdeByte: bytesBuenos };
    }
    const lectura = { eventos, cola, errores, bytesBuenos, sinSalto };
    this._cache = { size: st.size, mtimeMs: st.mtimeMs, lectura };
    return lectura;
  }

  _leerAncla() {
    try { return JSON.parse(fs.readFileSync(this.ancla, 'utf8')); } catch { return null; }
  }

  /** Estado sin lanzar: { ok, ultimaSecuencia, ultimaHuella, colaIncompleta, errores, anclaRegenerable }. */
  estado() {
    const l = this._leer();
    const ultimo = l.eventos[l.eventos.length - 1] || null;
    const errores = [...l.errores];
    const ancla = this._leerAncla();
    const ultimaSecuencia = ultimo ? ultimo.secuencia : 0;
    let anclaAusente = false;
    if (ancla) {
      if (ancla.ultimaSecuencia > ultimaSecuencia) errores.push(`ledger truncado: el ancla registra la secuencia ${ancla.ultimaSecuencia} y el archivo llega a ${ultimaSecuencia}`);
      else {
        const e = l.eventos[ancla.ultimaSecuencia - 1];
        if (ancla.ultimaSecuencia > 0 && (!e || e.huella !== ancla.ultimaHuella)) errores.push('el ancla no coincide con el evento que referencia (archivo reescrito)');
      }
    } else if (ultimaSecuencia > 0) anclaAusente = true;
    return { ok: errores.length === 0 && !l.cola, ultimaSecuencia, ultimaHuella: ultimo ? ultimo.huella : GENESIS, colaIncompleta: l.cola, errores, anclaAusente };
  }

  ultimaSecuencia() {
    const e = this.estado();
    if (e.errores.length) throw new ErrorLedger('ledger_corrupto', `Ledger no íntegro: ${e.errores[0]}`);
    return e.ultimaSecuencia;
  }

  /** Verifica la cadena completa (o un rango). */
  verificarCadena({ desde = 1, hasta = Infinity } = {}) {
    this._cache = null; // una verificación explícita nunca se apoya en la caché
    const l = this._leer();
    const e = this.estado();
    const verificados = l.eventos.filter((x) => x.secuencia >= desde && x.secuencia <= hasta).length;
    return { ok: e.ok, verificados, ultimaSecuencia: e.ultimaSecuencia, errores: e.errores, colaIncompleta: e.colaIncompleta, anclaAusente: e.anclaAusente };
  }

  /** Eventos (copias) en orden. `filtro`: función o { tipo, actor, idTarea, idCorrelacion, idSolicitud, idAprobacion, desde, hasta }. */
  leer(filtro = null) {
    const e = this.estado();
    if (e.errores.length) throw new ErrorLedger('ledger_corrupto', `Ledger no íntegro: ${e.errores[0]}`);
    let lista = this._leer().eventos;
    if (typeof filtro === 'function') lista = lista.filter(filtro);
    else if (filtro && typeof filtro === 'object') {
      lista = lista.filter((ev) => {
        if (filtro.desde && ev.secuencia < filtro.desde) return false;
        if (filtro.hasta && ev.secuencia > filtro.hasta) return false;
        if (filtro.tipo && (Array.isArray(filtro.tipo) ? !filtro.tipo.includes(ev.tipo) : ev.tipo !== filtro.tipo)) return false;
        if (filtro.actor && ev.actor !== filtro.actor) return false;
        for (const r of ['idTarea', 'idCorrelacion', 'idSolicitud', 'idAprobacion', 'idPlan', 'idDecision']) if (filtro[r] && (ev.refs || {})[r] !== filtro[r]) return false;
        return true;
      });
    }
    return JSON.parse(JSON.stringify(lista));
  }

  // ── escritura ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
  _bloquear() {
    const t0 = Date.now();
    for (;;) {
      try {
        const fd = fs.openSync(this.cerrojo, 'wx');
        fs.writeSync(fd, JSON.stringify({ pid: process.pid, en: t0 }));
        fs.closeSync(fd);
        return;
      } catch (e) {
        // En Windows, abrir con «wx» un cerrojo que otro proceso está borrando en ese instante da EPERM/EBUSY/EACCES en lugar de EEXIST: es contención (se reintenta hasta `esperaBloqueoMs`), no un ledger caído.
        const contencion = e.code === 'EEXIST' || (process.platform === 'win32' && ['EPERM', 'EBUSY', 'EACCES'].includes(e.code));
        if (!contencion) throw new ErrorLedger('ledger_no_disponible', `No se pudo bloquear el ledger (${e.code || 'error'}).`);
        const st = fs.statSync(this.cerrojo, { throwIfNoEntry: false });
        if (st && Date.now() - st.mtimeMs > this.limites.bloqueoCaducaMs) {
          try { fs.unlinkSync(this.cerrojo); } catch { /* otro proceso lo retiró */ }
          continue;
        }
        if (Date.now() - t0 > this.limites.esperaBloqueoMs) throw new ErrorLedger('ledger_ocupado', 'El ledger está ocupado por otro proceso.');
        esperarMs(25);
      }
    }
  }
  _desbloquear() {
    try { fs.unlinkSync(this.cerrojo); } catch { /* ya liberado */ }
  }

  /** Escritura de una línea con fsync. Sustituible en pruebas para simular fallos. */
  _escribirLinea(linea) {
    const fd = fs.openSync(this.archivo, 'a');
    try {
      fs.writeSync(fd, linea);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }
  _escribirAncla(ancla) {
    const tmp = `${this.ancla}.tmp`;
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, JSON.stringify(ancla));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, this.ancla);
  }

  _validarEntrada(ev) {
    if (!ev || typeof ev !== 'object') throw new ErrorLedger('evento_invalido', 'El evento no es un objeto.');
    if (!TIPOS_EVENTO.includes(ev.tipo)) throw new ErrorLedger('evento_invalido', `Tipo de evento desconocido («${String(ev.tipo)}»).`);
    if (!esActorValido(ev.actor)) throw new ErrorLedger('evento_invalido', 'Actor no válido.');
    if (ev.refs !== undefined && (typeof ev.refs !== 'object' || ev.refs === null || Array.isArray(ev.refs))) throw new ErrorLedger('evento_invalido', 'refs debe ser un objeto.');
    if (ev.datos !== undefined && (typeof ev.datos !== 'object' || ev.datos === null || Array.isArray(ev.datos))) throw new ErrorLedger('evento_invalido', 'datos debe ser un objeto.');
    const texto = JSON.stringify({ refs: ev.refs ?? {}, datos: ev.datos ?? {}, version: ev.version ?? {} });
    const secreto = detectarSecreto(texto);
    if (secreto) throw new ErrorLedger('secreto_detectado', `El evento contiene algo que parece una credencial (${secreto}); no se registra.`);
  }

  /**
   * Añade un evento. `secuenciaEsperada` (opcional): comparación atómica; si otra escritura se coló → `conflicto_secuencia`.
   * Si `ev.idEvento` ya existe con el MISMO contenido, no duplica y devuelve el original (`duplicado: true`).
   * Devuelve { evento, duplicado }.
   */
  anadir(ev, secuenciaEsperada) {
    this._validarEntrada(ev);
    this._bloquear();
    try {
      this._cache = null;
      const est = this.estado();
      if (est.errores.length) throw new ErrorLedger('ledger_corrupto', `Ledger no íntegro: ${est.errores[0]}`);
      if (est.colaIncompleta) throw new ErrorLedger('ledger_cola_incompleta', 'Hay una escritura interrumpida en la cola del ledger: ejecuta la recuperación explícita antes de añadir.');
      const lectura = this._leer();
      if (ev.idEvento) {
        const previo = lectura.eventos.find((x) => x.idEvento === ev.idEvento);
        if (previo) {
          const mismo = canonico({ tipo: previo.tipo, actor: previo.actor, refs: previo.refs, datos: previo.datos }) === canonico({ tipo: ev.tipo, actor: ev.actor, refs: ev.refs ?? {}, datos: ev.datos ?? {} });
          if (!mismo) throw new ErrorLedger('idEvento_duplicado_distinto', 'Ese idEvento ya existe con otro contenido.');
          return { evento: JSON.parse(JSON.stringify(previo)), duplicado: true };
        }
      }
      if (secuenciaEsperada !== undefined && secuenciaEsperada !== est.ultimaSecuencia) {
        throw new ErrorLedger('conflicto_secuencia', `Otra escritura se adelantó (esperada ${secuenciaEsperada}, actual ${est.ultimaSecuencia}).`, { esperada: secuenciaEsperada, actual: est.ultimaSecuencia });
      }
      const completo = {
        idEvento: ev.idEvento || this.ids.nuevo('e'),
        secuencia: est.ultimaSecuencia + 1,
        instante: this.reloj().toISOString(),
        tipo: ev.tipo,
        actor: ev.actor,
        refs: ev.refs ?? {},
        version: { esquema: ESQUEMA_EVENTO, ...(ev.version ?? {}) },
        datos: ev.datos ?? {},
        huellaPrevia: est.ultimaHuella,
      };
      completo.huella = huellaDe(completo);
      let linea = JSON.stringify(completo) + '\n';
      if (Buffer.byteLength(linea) > this.limites.maxBytesEvento) throw new ErrorLedger('evento_demasiado_grande', `El evento supera ${this.limites.maxBytesEvento} bytes.`);
      if (lectura.sinSalto) linea = '\n' + linea; // repara el salto que faltaba, sin tocar nada anterior
      try {
        this._escribirLinea(linea);
      } catch (e) {
        this._cache = null;
        throw new ErrorLedger('ledger_no_disponible', `No se pudo escribir en el ledger (${(e && e.code) || 'error'}).`);
      }
      this._cache = null;
      try {
        this._escribirAncla({ particion: this.particion, ultimaSecuencia: completo.secuencia, ultimaHuella: completo.huella, en: completo.instante });
      } catch { /* el evento ya está escrito y encadenado; el ancla se regenerará en la siguiente escritura */ }
      return { evento: completo, duplicado: false };
    } finally {
      this._desbloquear();
    }
  }

  // ── recuperación, exportación y copias ──────────────────────────────────────────────────────────────────────────────────────
  /**
   * Acción EXPLÍCITA: aparta los bytes de una escritura interrumpida (no los borra: quedan en un archivo «huerfano-…»), deja el ledger en el
   * último evento íntegro y registra un evento `error` con el motivo. No repara corrupción en mitad de la cadena.
   */
  recuperarColaIncompleta() {
    let info;
    this._bloquear();
    try {
      this._cache = null;
      const l = this._leer();
      if (l.errores.length) throw new ErrorLedger('ledger_corrupto', `Hay corrupción en mitad de la cadena: no se repara automáticamente (${l.errores[0]}).`);
      if (!l.cola) return { recuperado: false, motivo: 'no_hay_cola_incompleta' };
      const buf = fs.readFileSync(this.archivo);
      const huerfano = path.join(this.dir, `huerfano-${this.particion}-${Date.now()}.bin`);
      fs.writeFileSync(huerfano, buf.subarray(l.cola.desdeByte));
      fs.truncateSync(this.archivo, l.cola.desdeByte);
      this._cache = null;
      info = { recuperado: true, bytesApartados: l.cola.bytes, archivoHuerfano: path.basename(huerfano), ultimaSecuenciaIntegra: l.eventos.length };
    } finally {
      this._desbloquear();
    }
    // Con el cerrojo ya liberado, deja constancia de la recuperación en el propio ledger.
    this.anadir({ tipo: 'error', actor: 'sistema', datos: { motivo: 'cola_incompleta_recuperada', bytesApartados: info.bytesApartados, archivoHuerfano: info.archivoHuerfano } });
    return info;
  }

  /** Exportación íntegra: copia verificada + manifiesto con la huella del archivo. */
  exportar(destinoDir) {
    const v = this.verificarCadena();
    if (!v.ok) throw new ErrorLedger('ledger_corrupto', 'No se exporta un ledger que no supera la verificación.');
    if (dentroDe(destinoDir, this.raiz)) throw new ErrorLedger('ledger_dentro_del_repositorio', 'La exportación debe estar FUERA del repositorio.');
    fs.mkdirSync(destinoDir, { recursive: true });
    const copia = path.join(destinoDir, path.basename(this.archivo));
    fs.copyFileSync(this.archivo, copia);
    const hash = sha256(fs.readFileSync(copia).toString('utf8'));
    const manifiesto = { particion: this.particion, eventos: v.ultimaSecuencia, sha256Archivo: hash, ultimaHuella: this.estado().ultimaHuella };
    fs.writeFileSync(path.join(destinoDir, `${path.basename(this.archivo)}.manifiesto.json`), JSON.stringify(manifiesto, null, 2));
    return manifiesto;
  }

  /** Copia de seguridad (archivo + ancla), comprobada al terminar abriéndola como un ledger independiente. */
  copiaSeguridad(destinoDir) {
    const v = this.verificarCadena();
    if (!v.ok) throw new ErrorLedger('ledger_corrupto', 'No se hace copia de un ledger que no supera la verificación.');
    if (dentroDe(destinoDir, this.raiz)) throw new ErrorLedger('ledger_dentro_del_repositorio', 'La copia de seguridad debe estar FUERA del repositorio.');
    fs.mkdirSync(destinoDir, { recursive: true });
    for (const f of [this.archivo, this.ancla]) if (fs.existsSync(f)) fs.copyFileSync(f, path.join(destinoDir, path.basename(f)));
    const prueba = new LedgerLocal({ dir: destinoDir, particion: this.particion, raiz: '/__sin_raiz__' });
    const r = prueba.verificarCadena();
    if (!r.ok || r.ultimaSecuencia !== v.ultimaSecuencia) throw new ErrorLedger('copia_no_verificada', 'La copia no supera la verificación.');
    return { eventos: r.ultimaSecuencia, destino: destinoDir };
  }

  /** Restaura una copia en un directorio VACÍO (no pisa un ledger existente) y la verifica. */
  static restaurar(origenDir, destinoDir, { particion = CONFIG_DEFECTO.ledger.particion, raiz = RAIZ_REPOSITORIO } = {}) {
    const origen = new LedgerLocal({ dir: origenDir, particion, raiz: '/__sin_raiz__' });
    const v = origen.verificarCadena();
    if (!v.ok) throw new ErrorLedger('copia_corrupta', 'La copia de origen no supera la verificación.');
    const destino = new LedgerLocal({ dir: destinoDir, particion, raiz });
    if (fs.existsSync(destino.archivo) && fs.statSync(destino.archivo).size > 0) throw new ErrorLedger('destino_no_vacio', 'El destino ya contiene un ledger: no se sobrescribe.');
    for (const f of [origen.archivo, origen.ancla]) if (fs.existsSync(f)) fs.copyFileSync(f, path.join(destino.dir, path.basename(f)));
    const r = new LedgerLocal({ dir: destinoDir, particion, raiz }).verificarCadena();
    if (!r.ok || r.ultimaSecuencia !== v.ultimaSecuencia) throw new ErrorLedger('restauracion_no_verificada', 'La restauración no supera la verificación.');
    return { eventos: r.ultimaSecuencia };
  }
}
