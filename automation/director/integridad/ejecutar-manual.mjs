/**
 * Agente 00 · 3E.8.11 · EJECUCIÓN MANUAL de UNA verificación de integridad. Comando distinto de las consultas (`consola.mjs`), desactivado por defecto y en DOS etapas.
 *
 *   integridad ejecutar --preparar [--almacen <id>]            Etapa 1: valida todo y emite una SOLICITUD de un solo uso (caduca a los 5 min). No ejecuta nada.
 *   integridad ejecutar --confirmar <solicitud> [--almacen <id>]  Etapa 2: con la solicitud vigente Y el código del propietario, ejecuta UNA pasada supervisada.
 *
 * QUÉ ACREDITA LA AUTORIZACIÓN (y qué no): un texto de confirmación no acredita a nadie. La etapa 2 exige (1) activación válida con bloque `ejecucion` (la escribe el propietario),
 * (2) una solicitud emitida por la etapa 1, vinculada a esa configuración, de un solo uso y vigente, y (3) el CÓDIGO DEL PROPIETARIO en la variable de entorno `TAI_INTEGRIDAD_CODIGO`
 * (nunca en un argumento ni en pantalla), comparado con un verificador scrypt guardado en la activación (el código no se guarda). Un código incorrecto invalida la solicitud.
 * LÍMITE REAL: quien ya controle la cuenta del sistema y conozca el código puede ejecutar; el código frena la ejecución accidental, el automatismo y la suplantación trivial, no a un atacante con la cuenta.
 *
 * SEPARACIÓN: aquí solo se ejecuta una pasada (franja prohibida y escritura en curso se respetan; no se fuerza ninguna guarda). El anclaje ocurre solo si el contrato existente lo decide tras una verificación completa y correcta
 * contrastada; el REANCLAJE no existe aquí (`reanclar` va fijo a null) y la exportación de la copia externa solo se hace si el propietario aporta la clave privada de firma por `TAI_INTEGRIDAD_CLAVE_PRIVADA_ARCHIVO`.
 * No programa nada, no abre canales de alerta y no ejecuta almacenes distintos del configurado.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { LedgerLocal } from '../ledger.mjs';
import { CONFIG_INTEGRIDAD } from './config.mjs';
import { almacenOcupado, ejecutarIntegridadSupervisada } from './ejecucion.mjs';
import { enVentanaProhibida, lineasEstadoIntegridad } from './estado.mjs';
import { leerActivacion, RX_VERIFICADOR, sanear } from './consola.mjs';
import { comprobarCli } from './cli-contrato.mjs';

export const ESQUEMA_SOLICITUD = 'integridad-solicitud/1';
export const CADUCA_SOLICITUD_MS = 300000;
export const MIN_LONGITUD_CODIGO = 16;
export const VAR_CODIGO = 'TAI_INTEGRIDAD_CODIGO';
export const VAR_CLAVE_PRIVADA = 'TAI_INTEGRIDAD_CLAVE_PRIVADA_ARCHIVO';
const sha = (x) => crypto.createHash('sha256').update(x).digest('hex');
const iguales = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

/** Crea el verificador (scrypt) de un código del propietario. El código NO se guarda: solo este valor va en la activación. */
export function crearVerificador(codigo, { sal = crypto.randomBytes(16) } = {}) {
  if (typeof codigo !== 'string' || codigo.length < MIN_LONGITUD_CODIGO) throw new Error(`El código debe tener al menos ${MIN_LONGITUD_CODIGO} caracteres.`);
  return `scrypt1$${sal.toString('hex')}$${crypto.scryptSync(codigo.normalize('NFKC'), sal, 64).toString('hex')}`;
}
/** ¿Corresponde el código al verificador? Tiempo constante; formato inválido = falso. */
export function comprobarCodigo(codigo, verificador) {
  if (typeof codigo !== 'string' || codigo.length < MIN_LONGITUD_CODIGO || typeof verificador !== 'string' || !RX_VERIFICADOR.test(verificador)) return false;
  const [, sal, hash] = verificador.split('$'); return iguales(crypto.scryptSync(codigo.normalize('NFKC'), Buffer.from(sal, 'hex'), 64).toString('hex'), hash);
}

const denegada = (motivo, texto, extra = {}) => ({ codigo: 4, texto: `DENEGADA: ${texto}`, datos: { ejecutado: false, autorizada: false, motivo, ...extra } });
const archivoSolicitud = (ledgerDir, id) => path.join(ledgerDir, `integridad-solicitud-${id}.json`);
const vinculo = (c) => sha(JSON.stringify([c.idAlmacen, c.ejecucion.almacenDir, c.ejecucion.cli, c.ejecucion.verificador, c.ejecucion.frioDir ?? null, c.ejecucion.maxTareas ?? null]));
const ahoraMs = (a) => (a instanceof Date ? a.getTime() : typeof a === 'string' ? Date.parse(a) : Number(a));

/** Valida el contexto común. → { ok, config } | { ok:false, respuesta }. Ningún almacén distinto del configurado; ninguna ruta que no exista. */
function contexto({ ledgerDir, env, almacenSolicitado }) {
  const act = leerActivacion({ ledgerDir, env });
  if (!act.activa) return { ok: false, respuesta: denegada('integridad_desactivada', `la integridad periódica está desactivada (${act.motivo}).`) };
  const c = act.config; if (!c.ejecucion) return { ok: false, respuesta: denegada('ejecucion_no_habilitada', 'la activación no incluye el bloque «ejecucion» del propietario.') };
  if (almacenSolicitado !== undefined && almacenSolicitado !== null && almacenSolicitado !== c.idAlmacen) return { ok: false, respuesta: denegada('almacen_no_autorizado', 'el almacén indicado no es el autorizado en la activación.') };
  const esDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } }; const esArchivo = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
  if (!esDir(c.ejecucion.almacenDir)) return { ok: false, respuesta: denegada('almacen_inexistente', 'el almacén autorizado no existe o no es una carpeta.') };
  if (!esArchivo(c.ejecucion.cli)) return { ok: false, respuesta: denegada('comando_inexistente', 'el comando de verificación autorizado no existe.') };
  // la falta de manifiesto NUNCA es una autorización: sin manifiesto verificado no se ejecuta
  const cliOk = comprobarCli({ cli: c.ejecucion.cli, exigir: true }); if (!cliOk.ok) return { ok: false, respuesta: denegada(cliOk.motivo, `el comando de verificación no es utilizable (${cliOk.motivo}).`) };
  const dirLedger = c.ledgerDir ? path.resolve(c.ledgerDir) : ledgerDir; if (!esDir(dirLedger)) return { ok: false, respuesta: denegada('ledger_inexistente', 'el ledger de integridad no existe (no se crea desde aquí).') };
  return { ok: true, config: c, dirLedger };
}

/** ETAPA 1. Escribe SOLO la solicitud (un archivo); no ejecuta ni ancla nada. */
export function prepararEjecucion({ ledgerDir, env = process.env, ahora = Date.now(), almacenSolicitado } = {}) {
  const k = contexto({ ledgerDir, env, almacenSolicitado }); if (!k.ok) return k.respuesta; const { config: c, dirLedger } = k;
  const t = ahoraMs(ahora); const nonce = crypto.randomBytes(16).toString('hex');
  const doc = { esquema: ESQUEMA_SOLICITUD, idAlmacen: c.idAlmacen, nonceHash: sha(nonce), creada: new Date(t).toISOString(), caduca: new Date(t + CADUCA_SOLICITUD_MS).toISOString(), vinculo: vinculo(c) };
  try { fs.writeFileSync(archivoSolicitud(dirLedger, c.idAlmacen), `${JSON.stringify(doc)}\n`, { mode: 0o600 }); } catch { return denegada('solicitud_no_escrita', 'no se pudo escribir la solicitud; no se ha ejecutado nada.'); }
  const avisos = []; if (enVentanaProhibida(t, CONFIG_INTEGRIDAD.ventanasProhibidas, CONFIG_INTEGRIDAD.zonaHoraria)) avisos.push('ahora es la franja del gestor/vigilante: la confirmación se aplazará');
  if (almacenOcupado(c.ejecucion.almacenDir, CONFIG_INTEGRIDAD.escrituraEnCursoMs)) avisos.push('el almacén se está escribiendo: la confirmación se aplazará');
  return { codigo: 0, texto: [`Solicitud de ejecución preparada para el almacén «${c.idAlmacen}». NO se ha ejecutado nada.`, `Solicitud: ${nonce} (de un solo uso; caduca ${doc.caduca.slice(0, 16).replace('T', ' ')} UTC).`, `Para ejecutar UNA verificación: defina ${VAR_CODIGO} (código del propietario) y lance «integridad ejecutar --confirmar ${nonce}».`, ...avisos.map((a) => `• ${a}`)].join('\n'), datos: { ejecutado: false, preparada: true, idAlmacen: c.idAlmacen, solicitud: nonce, caduca: doc.caduca, avisos } };
}

/** ETAPA 2. Verifica solicitud + código, consume la solicitud y ejecuta UNA pasada supervisada. Nunca lanza. */
export async function confirmarEjecucion({ ledgerDir, env = process.env, ahora = Date.now(), solicitud, almacenSolicitado, reloj = null, envHijo, configIntegridad = CONFIG_INTEGRIDAD } = {}) {
  const k = contexto({ ledgerDir, env, almacenSolicitado }); if (!k.ok) return k.respuesta; const { config: c, dirLedger } = k; const t = ahoraMs(ahora);
  const f = archivoSolicitud(dirLedger, c.idAlmacen); const borrar = () => { try { fs.rmSync(f, { force: true }); } catch { /* la comprobación de abajo lo detecta */ } };
  if (typeof solicitud !== 'string' || !/^[0-9a-f]{32}$/.test(solicitud)) return denegada('solicitud_ausente_o_invalida', 'falta la solicitud de la etapa 1 (o no tiene el formato esperado).');
  let doc; try { doc = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return denegada('sin_solicitud_preparada', 'no hay una solicitud preparada: ejecute primero «integridad ejecutar --preparar».'); }
  if (!doc || doc.esquema !== ESQUEMA_SOLICITUD || doc.idAlmacen !== c.idAlmacen) { borrar(); return denegada('solicitud_invalida', 'la solicitud preparada no es válida; se ha descartado.'); }
  if (!iguales(doc.nonceHash, sha(solicitud))) return denegada('solicitud_distinta', 'la solicitud indicada no corresponde a la preparada.'); // no se borra: un tercero no puede invalidar la del propietario adivinando
  if (!(Date.parse(doc.caduca) > t)) { borrar(); return denegada('solicitud_caducada', 'la solicitud caducó; prepare otra.'); }
  if (!iguales(doc.vinculo, vinculo(c))) { borrar(); return denegada('configuracion_cambiada', 'la activación cambió después de preparar la solicitud; se ha descartado.'); }
  const codigo = env[VAR_CODIGO]; if (typeof codigo !== 'string' || codigo === '') return denegada('codigo_ausente', `falta el código del propietario (${VAR_CODIGO}).`);
  if (!comprobarCodigo(codigo, c.ejecucion.verificador)) { borrar(); return denegada('codigo_incorrecto', 'el código del propietario no es correcto; la solicitud se ha invalidado.'); }
  borrar(); if (fs.existsSync(f)) return denegada('solicitud_no_consumida', 'no se pudo consumir la solicitud; no se ejecuta nada.'); // un solo uso: si no se puede retirar, no se ejecuta
  if (enVentanaProhibida(t, configIntegridad.ventanasProhibidas, configIntegridad.zonaHoraria)) return { codigo: 3, texto: 'Aplazada: es la franja del gestor y el vigilante. No se ha ejecutado nada.', datos: { ejecutado: false, autorizada: true, estado: 'aplazada_ventana' } };
  if (almacenOcupado(c.ejecucion.almacenDir, configIntegridad.escrituraEnCursoMs)) return { codigo: 3, texto: 'Aplazada: el almacén se está escribiendo. No se ha ejecutado nada.', datos: { ejecutado: false, autorizada: true, estado: 'aplazada_escritura_en_curso' } };
  let copiaExterna = null;
  if (c.copiaExterna) { try { const publica = fs.readFileSync(path.resolve(c.copiaExterna.clavePublicaArchivo), 'utf8'); if (!/PRIVATE KEY/.test(publica)) { copiaExterna = { destino: path.resolve(c.copiaExterna.destino), publica, referencia: c.referenciaFrescura ?? null }; const pr = env[VAR_CLAVE_PRIVADA]; if (pr) { const privada = fs.readFileSync(path.resolve(pr), 'utf8'); if (/PRIVATE KEY/.test(privada)) copiaExterna.privada = privada; } } } catch { copiaExterna = null; } }
  let r;
  try {
    const ledger = new LedgerLocal({ dir: dirLedger, particion: configIntegridad.particion, reloj: () => new Date(reloj ? reloj() : t) });
    r = await ejecutarIntegridadSupervisada({ ledger, idAlmacen: c.idAlmacen, almacenDir: c.ejecucion.almacenDir, cli: c.ejecucion.cli, frioDir: c.ejecucion.frioDir ?? null, maxTareas: c.ejecucion.maxTareas ?? null, reloj: reloj ?? (() => t), config: configIntegridad, forzar: true, reanclar: null, copiaExterna, ...(envHijo ? { env: envHijo } : {}) });
  } catch { return { codigo: 3, texto: 'Error operativo al ejecutar; no se ha anclado nada nuevo.', datos: { ejecutado: false, autorizada: true, estado: 'error_inesperado' } }; }
  const resumen = { ejecutado: r.ejecutado === true, autorizada: true, estado: r.estado, resultado: r.resultado ?? null, codigoSalida: r.codigoSalida ?? null, accionAncla: r.accionAncla ?? null, motivoAncla: r.motivoAncla ?? null, discrepancia: r.discrepancia ?? null, registrado: r.registrado ?? null, motivos: r.motivos ?? [], copiaExterna: r.copiaExterna ?? null };
  const lineas = r.estadoIntegridad ? lineasEstadoIntegridad(r.estadoIntegridad) : [];
  const cod = r.ejecutado ? Number(r.codigoSalida) : 3;
  return { codigo: cod, texto: sanear([`Ejecución manual: ${r.ejecutado ? `resultado «${r.resultado}» (código ${r.codigoSalida})` : `no ejecutada (${r.estado})`} · ancla: ${r.accionAncla ?? 'sin cambios'}${r.motivoAncla ? ` (${r.motivoAncla})` : ''}`, ...lineas, 'No se ha reanclado nada: el reanclaje es un acto aparte del propietario.'].join('\n')), datos: sanear(resumen) };
}

/** Punto de entrada de la consola (línea de comandos). Sin `--preparar` ni `--confirmar` solo muestra el uso: nunca ejecuta. */
export async function ejecutarManualConsola({ o = {}, ledgerDir, env = process.env, ahora = Date.now() }) {
  const almacenSolicitado = typeof o.almacen === 'string' ? o.almacen : undefined;
  if (o.preparar === true && o.confirmar === undefined) return prepararEjecucion({ ledgerDir, env, ahora, almacenSolicitado });
  if (typeof o.confirmar === 'string' && !o.preparar) return confirmarEjecucion({ ledgerDir, env, ahora, solicitud: o.confirmar, almacenSolicitado });
  return { codigo: 1, texto: 'Uso: integridad ejecutar --preparar  |  integridad ejecutar --confirmar <solicitud>   (dos etapas; no se ejecuta nada sin ambas). Detalle en «integridad ayuda».', datos: { ejecutado: false } };
}
