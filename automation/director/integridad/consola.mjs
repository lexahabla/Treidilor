/**
 * Agente 00 · 3E.8.10 · CONSOLA de la integridad periódica: SOLO CONSULTA y desactivada por defecto.
 *
 * Qué es: la capa que deja ver, desde `scripts/automation/director.mjs`, lo que ya producen 3E.8.7–3E.8.9 (estado de integridad, última verificación, próxima prevista,
 * vencimiento, alteración, errores operativos, ancla y copia externa). NO duplica lógica: llama a `estadoIntegridad`, `leerAncla`, `leerCopias`, `evaluarFrescura` y `contrastarAncla`.
 * Qué NO es: no lanza verificaciones, no ancla, no reancla, no exporta copias, no escribe en ningún ledger, no crea carpetas, temporizadores ni servicios y no envía alertas.
 * Consultar el estado NUNCA es autorización para ejecutar: la ejecución sigue en `ejecucion.mjs` (disparador externo autorizado) y este módulo NO lo importa.
 *
 * ACTIVACIÓN (explícita; la ausencia de configuración equivale a desactivado). Archivo `integridad-activacion.json` en el directorio del ledger del Director (fuera del repositorio y del paquete)
 * o en la ruta de `TAI_INTEGRIDAD_CONFIG`; debe decir `habilitada: true` (booleano) y `autorizadoPor: 'propietario'`. Un paquete o una actualización jamás lo traen. Interruptor de seguridad:
 * `TAI_INTEGRIDAD_DESACTIVAR=si` desactiva siempre. Cualquier error (ilegible, inválido, con secretos, campos desconocidos) equivale a DESACTIVADO. Activar no relaja ninguna protección existente.
 * Nada de lo que se muestra incluye rutas, claves ni huellas completas.
 */
import fs from 'node:fs';
import path from 'node:path';
import { LedgerLocal, detectarSecreto } from '../ledger.mjs';
import { CONFIG_INTEGRIDAD } from './config.mjs';
import { ID_ALMACEN, leerAncla } from './ancla.mjs';
import { contrastarAncla, evaluarFrescura, leerCopias } from './copia-ancla.mjs';
import { corta, estadoIntegridad, lineasEstadoIntegridad } from './estado.mjs';

export const ARCHIVO_ACTIVACION = 'integridad-activacion.json';
export const ESQUEMA_ACTIVACION = 'integridad-activacion/1';
export const SUBCOMANDOS = Object.freeze(['estado', 'ancla', 'ayuda']);
const CAMPOS = new Set(['esquema', 'habilitada', 'autorizadoPor', 'idAlmacen', 'ledgerDir', 'copiaExterna', 'referenciaFrescura', 'ejecucion']);
const CAMPOS_EJECUCION = new Set(['almacenDir', 'cli', 'verificador', 'frioDir', 'maxTareas', 'exigirManifiestoCli']);
export const SEGMENTOS_NO_AUTORIZADOS = Object.freeze(['tradylor_web', 'treidilor_web', 'secretos-e3']);
export const RX_VERIFICADOR = /^scrypt1\$[0-9a-f]{32}\$[0-9a-f]{128}$/;
const rutaAbsoluta = (x) => ruta(x) && path.isAbsolute(x) && !x.split(/[\\/]/).some((p) => SEGMENTOS_NO_AUTORIZADOS.includes(p.toLowerCase()));
const MAX_BYTES_CONFIG = 16384;
const CAMPOS_COPIA = new Set(['destino', 'clavePublicaArchivo']);
const ruta = (x) => typeof x === 'string' && x.trim() !== '' && x.length <= 400 && !x.includes('\0');

export const USO_INTEGRIDAD = `Integridad periódica del diario (solo consulta; desactivada por defecto)
  integridad estado      Estado: última verificación satisfactoria, última tentativa, próxima prevista, vencimiento, alteración, errores operativos y alertas
  integridad ancla       Ancla vigente y copia externa firmada (frescura, anomalías, discrepancia con el ledger)
Activación: archivo «${ARCHIVO_ACTIVACION}» (esquema ${ESQUEMA_ACTIVACION}, habilitada: true, autorizadoPor: "propietario", idAlmacen) junto al ledger del Director. Sin él, o con cualquier error, queda DESACTIVADA.
Consultar NO ejecuta ninguna verificación.
Ejecución manual (otro comando, solo por línea de comandos, exige el bloque «ejecucion» en la activación y el código del propietario en TAI_INTEGRIDAD_CODIGO):
  integridad ejecutar --preparar [--almacen <id>]     Etapa 1: valida y emite una solicitud de un solo uso (caduca en 5 min). No ejecuta nada.
  integridad ejecutar --confirmar <solicitud> [--almacen <id>]   Etapa 2: ejecuta UNA verificación. Nunca reancla.`;

/** Dónde se busca la configuración de activación. */
export function rutaActivacion({ ledgerDir, env = process.env }) {
  return env.TAI_INTEGRIDAD_CONFIG && env.TAI_INTEGRIDAD_CONFIG.trim() ? path.resolve(env.TAI_INTEGRIDAD_CONFIG) : path.join(ledgerDir, ARCHIVO_ACTIVACION);
}

/** FUNCIÓN PURA. Valida el documento de activación ya leído. → { ok, config } | { ok:false, motivo }. Estricta: un campo desconocido invalida. */
export function validarActivacion(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, motivo: 'configuracion_invalida:formato' };
  for (const k of Object.keys(doc)) if (!CAMPOS.has(k)) return { ok: false, motivo: 'configuracion_invalida:campo_desconocido' };
  if (doc.esquema !== ESQUEMA_ACTIVACION) return { ok: false, motivo: 'configuracion_invalida:esquema' };
  if (doc.habilitada !== true) return { ok: false, motivo: 'habilitada_no_es_true' };
  if (doc.autorizadoPor !== 'propietario') return { ok: false, motivo: 'configuracion_invalida:autorizacion' };
  if (typeof doc.idAlmacen !== 'string' || !ID_ALMACEN.test(doc.idAlmacen)) return { ok: false, motivo: 'configuracion_invalida:idAlmacen' };
  if (doc.ledgerDir !== undefined && !ruta(doc.ledgerDir)) return { ok: false, motivo: 'configuracion_invalida:ledgerDir' };
  if (doc.copiaExterna !== undefined) {
    const c = doc.copiaExterna;
    if (!c || typeof c !== 'object' || Array.isArray(c) || Object.keys(c).some((k) => !CAMPOS_COPIA.has(k)) || !ruta(c.destino) || !ruta(c.clavePublicaArchivo)) return { ok: false, motivo: 'configuracion_invalida:copiaExterna' };
  }
  if (doc.referenciaFrescura !== undefined) {
    const r = doc.referenciaFrescura;
    if (!r || typeof r !== 'object' || Array.isArray(r) || Object.keys(r).some((k) => k !== 'contadorMinimo') || !Number.isInteger(r.contadorMinimo) || r.contadorMinimo < 0) return { ok: false, motivo: 'configuracion_invalida:referenciaFrescura' };
  }
  if (doc.ejecucion !== undefined) {
    const x = doc.ejecucion;
    if (!x || typeof x !== 'object' || Array.isArray(x) || Object.keys(x).some((k) => !CAMPOS_EJECUCION.has(k)) || !rutaAbsoluta(x.almacenDir) || !rutaAbsoluta(x.cli) || typeof x.verificador !== 'string' || !RX_VERIFICADOR.test(x.verificador) || (x.frioDir !== undefined && !rutaAbsoluta(x.frioDir)) || (x.maxTareas !== undefined && !(Number.isInteger(x.maxTareas) && x.maxTareas >= 1 && x.maxTareas <= 12000)) || (x.exigirManifiestoCli !== undefined && x.exigirManifiestoCli !== true)) return { ok: false, motivo: 'configuracion_invalida:ejecucion' };
  }
  return { ok: true, config: { idAlmacen: doc.idAlmacen, ledgerDir: doc.ledgerDir ?? null, copiaExterna: doc.copiaExterna ?? null, referenciaFrescura: doc.referenciaFrescura ?? null, ejecucion: doc.ejecucion ?? null } };
}

/** Lee la activación SIN escribir nada. Nunca lanza. → { activa:boolean, motivo, config? }. Ausente, ilegible o inválida = desactivada. */
export function leerActivacion({ ledgerDir, env = process.env }) {
  if (String(env.TAI_INTEGRIDAD_DESACTIVAR ?? '').trim().toLowerCase() === 'si') return { activa: false, motivo: 'desactivada_por_variable' };
  let texto;
  try {
    const f = rutaActivacion({ ledgerDir, env }); const st = fs.statSync(f, { throwIfNoEntry: false });
    if (!st) return { activa: false, motivo: 'sin_configuracion' };
    if (!st.isFile() || st.size > MAX_BYTES_CONFIG) return { activa: false, motivo: 'configuracion_invalida:tamano_o_tipo' };
    texto = fs.readFileSync(f, 'utf8');
  } catch (e) { return { activa: false, motivo: e && e.code === 'EACCES' ? 'configuracion_sin_permiso' : 'configuracion_ilegible' }; }
  if (detectarSecreto(texto)) return { activa: false, motivo: 'configuracion_con_secretos' };
  let doc; try { doc = JSON.parse(texto); } catch { return { activa: false, motivo: 'configuracion_ilegible' }; }
  const v = validarActivacion(doc);
  return v.ok ? { activa: true, motivo: 'habilitada_por_el_propietario', config: v.config } : { activa: false, motivo: v.motivo };
}

const MENSAJES_DESACTIVADA = {
  sin_configuracion: 'no hay configuración de activación',
  desactivada_por_variable: 'desactivada por TAI_INTEGRIDAD_DESACTIVAR',
  habilitada_no_es_true: 'la configuración no la habilita',
  configuracion_sin_permiso: 'sin permiso para leer la configuración',
  configuracion_ilegible: 'configuración ilegible',
  configuracion_con_secretos: 'la configuración contiene algo con forma de credencial (se ignora)',
};
const textoMotivo = (m) => MENSAJES_DESACTIVADA[m] ?? (String(m).startsWith('configuracion_invalida') ? 'configuración inválida (se ignora)' : 'no activada');

/** Defensa en profundidad: ningún texto con forma de ruta absoluta ni de credencial sale por la consola. */
export function sanear(v) {
  if (typeof v === 'string') return detectarSecreto(v) ? '[oculto]' : /^[A-Za-z]:[\\/]|^\/[^\s]*\/|\\\\/.test(v) ? '[ruta oculta]' : v;
  if (Array.isArray(v)) return v.map(sanear);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sanear(x)]));
  return v;
}

const vencimiento = (e) => (e.motivos.includes('integridad_caducada') ? 'caducada' : e.motivos.includes('integridad_vencida') ? 'vencida' : e.motivos.includes('integridad_nunca_verificada') ? 'nunca_verificada' : 'vigente');
const ahoraMs = (a) => (a instanceof Date ? a.getTime() : typeof a === 'string' ? Date.parse(a) : Number(a));

function abrirLedgerLectura({ activacion, ledgerDirDirector, reloj }) {
  const dir = activacion.config.ledgerDir ? path.resolve(activacion.config.ledgerDir) : ledgerDirDirector;
  const st = fs.statSync(dir, { throwIfNoEntry: false }); // el constructor del ledger crearía la carpeta: solo se abre si existe
  if (!st || !st.isDirectory()) return { ok: false, motivo: 'ledger_integridad_inexistente' };
  try { return { ok: true, ledger: new LedgerLocal({ dir, particion: CONFIG_INTEGRIDAD.particion, reloj: () => new Date(reloj()) }) }; } catch { return { ok: false, motivo: 'ledger_integridad_no_abierto' }; }
}

const RESPUESTA_DESACTIVADA = (a) => ({ codigo: 0, texto: `Integridad periódica: DESACTIVADA (${textoMotivo(a.motivo)}). Nada se consulta ni se ejecuta. «integridad ayuda» explica cómo activarla.`, datos: { activa: false, motivo: a.motivo } });

/**
 * Comando `integridad <estado|ancla|ayuda>`. Solo lectura; sin efectos en disco. Nunca lanza.
 * @param {{sub?:string, ledgerDir:string, env?:object, ahora:Date|number|string}} p  ledgerDir = directorio del ledger del Director (donde se busca la activación y, por defecto, la partición `integridad`).
 * @returns {{codigo:number, texto:string, datos:object|null}}  0 consulta hecha (también «desactivada») · 1 uso · 2 activada pero el ledger de integridad no se pudo abrir.
 */
export function comandoIntegridad({ sub, ledgerDir, env = process.env, ahora }) {
  const orden = sub ?? 'estado';
  if (!SUBCOMANDOS.includes(orden)) return { codigo: 1, texto: `Subcomando «${sanear(String(orden)).slice(0, 40)}» desconocido. Este subcomando es de solo CONSULTA; la ejecución manual es otro comando, en dos etapas (ver «integridad ayuda»).\n${USO_INTEGRIDAD}`, datos: null };
  if (orden === 'ayuda') return { codigo: 0, texto: USO_INTEGRIDAD, datos: null };
  const activacion = leerActivacion({ ledgerDir, env });
  if (!activacion.activa) return RESPUESTA_DESACTIVADA(activacion);
  const ms = ahoraMs(ahora); const reloj = () => ms;
  const ab = abrirLedgerLectura({ activacion, ledgerDirDirector: ledgerDir, reloj });
  if (!ab.ok) return { codigo: 2, texto: `Integridad periódica: ACTIVADA, pero ${ab.motivo === 'ledger_integridad_inexistente' ? 'el ledger de integridad no existe' : 'no se pudo abrir el ledger de integridad'}. No se ha escrito nada.`, datos: { activa: true, motivo: ab.motivo } };
  const { idAlmacen } = activacion.config; const e = estadoIntegridad({ ledger: ab.ledger, idAlmacen, ahora: ms });
  if (orden === 'estado') {
    const datos = sanear({ activa: true, idAlmacen, nivel: e.nivel, vencimiento: vencimiento(e), alteracionConfirmada: e.alteracionConfirmada, errorOperativo: e.errorOperativo, erroresSeguidos: e.erroresSeguidos, ultimaSatisfactoria: e.ultimaSatisfactoria, ultimaTentativa: e.ultimaTentativa, siguienteComprobacion: e.siguienteComprobacion, tocaVerificar: e.toca ? { debe: e.toca.debe, motivo: e.toca.motivo } : null, ancla: e.ancla, motivos: e.motivos, alertas: e.alertas.map((a) => ({ codigo: a.codigo, nivel: a.nivel, mensaje: a.mensaje })) });
    return { codigo: 0, texto: sanear([...lineasEstadoIntegridad(e), `Vencimiento: ${datos.vencimiento} · alteración confirmada: ${e.alteracionConfirmada ? 'SÍ' : 'no'} · error operativo: ${e.errorOperativo ? 'sí' : 'no'}`, 'Consulta de solo lectura: no se ha ejecutado ninguna verificación.'].join('\n')), datos };
  }
  // ancla: ancla vigente del ledger + copia externa firmada (si está configurada)
  const a = leerAncla(ab.ledger, idAlmacen); const lineas = [`Ancla del ledger: ${a.estado === 'vigente' ? `#${a.ancla.seq} (${corta(a.ancla.huella)})` : a.estado}`];
  const datos = { activa: true, idAlmacen, ancla: a.estado === 'vigente' ? { estado: 'vigente', seq: a.ancla.seq, cabeza: corta(a.ancla.huella) } : { estado: a.estado }, copiaExterna: { configurada: false } };
  const cfg = activacion.config.copiaExterna;
  if (cfg) {
    let publica = null; try { const t = fs.readFileSync(path.resolve(cfg.clavePublicaArchivo), 'utf8'); if (!/PRIVATE KEY/.test(t) && t.length < 4096) publica = t; } catch { /* se informa abajo */ }
    if (!publica) { datos.copiaExterna = { configurada: true, estado: 'clave_publica_no_disponible' }; lineas.push('Copia externa: clave pública no disponible (o la indicada no es una clave pública).'); }
    else {
      const c = leerCopias({ destino: path.resolve(cfg.destino), publica, idAlmacen }); const fr = c.ok ? evaluarFrescura({ mejor: c.mejor, referencia: activacion.config.referenciaFrescura }) : null;
      const cmp = c.ok && c.mejor && a.estado === 'vigente' ? contrastarAncla({ ledgerAncla: a.ancla, copia: c.mejor }).estado : null;
      datos.copiaExterna = c.ok ? { configurada: true, estado: fr.estado, contador: c.mejor ? c.mejor.contador : null, copiasValidas: c.validas.length, invalidas: c.invalidas.length, huecos: c.huecos.length, cadenaOk: c.cadenaOk, contraste: cmp, discrepante: cmp === 'distintas' } : { configurada: true, estado: c.motivo };
      lineas.push(c.ok ? `Copia externa: ${fr.estado}${c.mejor ? ` · mejor copia #${c.mejor.contador}` : ''} · válidas ${c.validas.length} · inválidas ${c.invalidas.length} · huecos ${c.huecos.length} · cadena ${c.cadenaOk ? 'íntegra' : 'ROTA'}${cmp ? ` · contraste con el ledger: ${cmp}` : ''}` : `Copia externa: ${c.motivo}`);
      if (cmp === 'distintas') lineas.push('⚠ La copia externa y el ledger discrepan en la misma secuencia: no se ancla nada hasta aclararlo.');
      if (fr && fr.estado === 'obsoleta') lineas.push('⚠ La copia externa es más antigua que la referencia de frescura del propietario.');
      if (fr && fr.estado === 'sin_referencia_de_frescura') lineas.push('• Sin referencia de frescura independiente: una copia antigua también válida no se distinguiría de la última.');
    }
  } else lineas.push('Copia externa: no configurada.');
  lineas.push('Consulta de solo lectura: no se ha anclado ni exportado nada.');
  return { codigo: 0, texto: sanear(lineas.join('\n')), datos: sanear(datos) };
}
