// Agente 00 · 3E.8.11 · ENSAYO INTEGRAL de la integridad (consola + ejecución manual + ancla + copia externa) con el motor real del prototipo y datos 100 % sintéticos.
// Pensado para ejecutarse DENTRO de un contenedor aislado (sin red, sin puertos, raíz de solo lectura, tmpfs) o en local. Escribe un único JSON en la salida estándar. No toca nada fuera de su carpeta temporal.
//   TAI_PROTOTIPO_INCIDENCIAS  ruta del prototipo (solo lectura) · TAI_ENSAYO_DIR_COPIAS  carpeta en OTRA unidad para la copia externa (si no, la copia debe RECHAZARSE por misma unidad)
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { LedgerLocal } from '../ledger.mjs';
import { comandoIntegridad } from '../integridad/consola.mjs';
import { generarParClaves } from '../integridad/copia-ancla.mjs';
import { ejecutarIntegridadSupervisada } from '../integridad/ejecucion.mjs';
import { VAR_CLAVE_PRIVADA } from '../integridad/ejecutar-manual.mjs';
import { CONFIG_INTEGRIDAD } from '../integridad/config.mjs';
import { ARCHIVO_ACTIVACION } from '../integridad/consola.mjs';
import { crearEntornoSintetico, ejecutarAutomatico } from './_sintetico.mjs';
import { construirTarCli, prepararPaqueteCli } from '../../../scripts/automation/empaquetar-cli-integridad.mjs';
import { leerTar } from '../../../scripts/automation/empaquetar-director.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PROTO = path.resolve(process.env.TAI_PROTOTIPO_INCIDENCIAS || path.join(AQUI, '..', '..', '..', '..', 'treidilor-ai', 'prototipo-incidencias-director'));
const CLI = path.join(PROTO, 'src', 'integridad-cli.mjs'); const H = 3600000;
const u = (p) => import(pathToFileURL(path.join(PROTO, p)).href);
const [a, p, s, ad] = await Promise.all([u('src/almacen/almacen.mjs'), u('src/almacen/politicaRutas.mjs'), u('src/simulacion/datos.mjs'), u('src/adaptador/instantanea.mjs')]); const M = { ...a, ...p, ...s, ...ad };
// BASE 100 % SINTÉTICA (ni una clave, URL ni cifra de producción): 20 incidencias inventadas y un host reservado `.invalid`
const BASE = { esquema: 1, agente: 'calidad-catalogo', version: '0.1.0', entorno: 'produccion', host: 'ejemplo.invalid', generadoEn: '2027-02-28T00:00:00.000Z', calidad: { estado: 'completa', motivos: [] }, alcance: { host: 'ejemplo.invalid', salud: true, rutas: [], enlaces: [], fichas: Array.from({ length: 5 }, (_, i) => `ficha-sintetica-${i + 1}`), catalogo: { leido: true, completo: true } }, incidencias: Array.from({ length: 20 }, (_, i) => ({ clave: `ficha:sin_imagen:z${String(i).padStart(6, '0')}`, area: 'ficha', codigo: 'sin_imagen', gravedad: 'media', cantidad: null, ocurrencias: 1 })) };
const dia = (n) => Date.parse('2027-03-01T00:00:00.000Z') + n * 86400000; let cont = 0; const nuevas = (n) => Array.from({ length: n }, () => { cont += 1; return { clave: `ficha:sin_imagen:y${String(cont).padStart(6, '0')}`, gravedad: 'media' }; });
function obs(d, anadir = []) { const gen = new Date(dia(d) + 7 * H).toISOString(); const f = M.filaDeInstantanea(M.construirInstantanea(BASE, { generadoEn: gen, anadir }), { idEjecucion: `x${d}`, id: d + 1 }); const r = M.respuestaLector([f], { limite: 5, idSolicitud: 'lreq0000abcd', exportadoEn: gen }); return M.observacionDeRespuesta(r, { ahoraIso: new Date(dia(d) + 12 * H).toISOString(), esperada: { entorno: 'produccion' } }).datos; }

const e = crearEntornoSintetico({ cli: CLI });
// el CLI se instala desde SU PAQUETE (con manifiesto verificado): la ejecución manual exige siempre un manifiesto válido
const cliPaquete = path.join(e.raiz, 'cli'); for (const x of leerTar(construirTarCli(prepararPaqueteCli(PROTO)))) { const d = path.join(cliPaquete, ...x.ruta.split('/')); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, x.contenido); }
e.activacion = { ...e.activacion, ejecucion: { ...e.activacion.ejecucion, cli: path.join(cliPaquete, 'src', 'integridad-cli.mjs') } }; fs.writeFileSync(path.join(e.ledgerDir, ARCHIVO_ACTIVACION), JSON.stringify(e.activacion)); const aut = M.autorizarRaiz(e.raiz); const pasos = []; let T = Date.parse('2027-03-31T12:00:00.000Z');
const abrir = (d) => M.abrirAlmacen({ dir: e.almacenDir, autorizacion: aut, reloj: () => dia(d) + 12 * H, limites: { observacionMs: 20, esperaMs: 0, maxCopias: 4 } });
const dias = (x, y) => { for (let d = x; d <= y; d += 1) if (!abrir(d).procesarObservacion(obs(d, d === 0 ? [] : nuevas(4))).ok) { const rr = abrir(d).procesarObservacion(obs(d, d === 0 ? [] : nuevas(4))); throw new Error(`no se pudo escribir el día ${d}: ${JSON.stringify(rr).slice(0, 300)}`); }; };
const paso = (n, nombre, ok, detalle = {}) => pasos.push({ n, nombre, ok: Boolean(ok), detalle });
const estado = (ahora) => comandoIntegridad({ sub: 'estado', ledgerDir: e.ledgerDir, env: {}, ahora }).datos;
const libLedger = () => new LedgerLocal({ dir: e.ledgerDir, particion: 'integridad', reloj: () => new Date(T), raiz: '/__sin_raiz__' });
const evs = () => libLedger().leer((x) => x.refs && x.refs.idAlmacen === 'g');
const claves = generarParClaves(); const dirClaves = path.join(e.raiz, 'claves'); fs.mkdirSync(dirClaves); fs.writeFileSync(path.join(dirClaves, 'publica.pem'), claves.publica); fs.writeFileSync(path.join(dirClaves, 'privada.pem'), claves.privada, { mode: 0o600 });
const dirCopias = process.env.TAI_ENSAYO_DIR_COPIAS ? path.join(process.env.TAI_ENSAYO_DIR_COPIAS, `copias-${process.pid}`) : path.join(e.raiz, 'copias'); fs.mkdirSync(dirCopias, { recursive: true });
const otraUnidad = fs.statSync(dirCopias).dev !== fs.statSync(e.ledgerDir).dev;
const activar = (extra = {}) => { const act = { ...e.activacion, copiaExterna: { destino: dirCopias, clavePublicaArchivo: path.join(dirClaves, 'publica.pem') }, referenciaFrescura: { contadorMinimo: 1 }, ...extra }; fs.writeFileSync(path.join(e.ledgerDir, ARCHIVO_ACTIVACION), JSON.stringify(act)); e.activacion = act; };
const manual = (extra = {}) => { T += H; return ejecutarAutomatico(e, { ahora: T, reloj: () => T, envExtra: { [VAR_CLAVE_PRIVADA]: path.join(dirClaves, 'privada.pem') }, ...extra }); };

try {
  // 0 · aislamiento observado desde dentro
  const red = await new Promise((res) => { const sk = net.connect({ host: '1.1.1.1', port: 53, timeout: 1500 }); sk.on('connect', () => { sk.destroy(); res('CONECTA'); }); sk.on('timeout', () => { sk.destroy(); res('sin_red'); }); sk.on('error', () => res('sin_red')); });
  paso(0, 'entorno aislado', true, { node: process.version, plataforma: process.platform, uid: process.getuid ? process.getuid() : null, red, rootSoloLectura: (() => { try { fs.writeFileSync('/__prueba_ro', 'x'); fs.rmSync('/__prueba_ro'); return false; } catch { return true; } })(), otraUnidadParaCopias: otraUnidad, tmpDentro: e.raiz.startsWith(fs.realpathSync(os.tmpdir())) });
  // 1 · primera verificación obligatoria: antes de nada «nunca verificada»; el almacén tiene historial
  dias(0, 5); activar(); let st = estado(T);
  paso(1, 'primera verificación obligatoria (antes de verificar, el estado es «nunca verificada» y toca verificar)', st.vencimiento === 'nunca_verificada' && st.tocaVerificar.debe === true && st.nivel === 'aviso', { vencimiento: st.vencimiento, toca: st.tocaVerificar });
  let r = await manual(); st = estado(T + 1000);
  paso(2, 'ejecución manual autorizada (dos etapas, código sintético): ok, anclada, copia externa', r.codigo === 0 && r.datos.resultado === 'ok' && r.datos.accionAncla === 'anclado', { codigo: r.codigo, accion: r.datos.accionAncla, motivoAncla: r.datos.motivoAncla, copia: r.datos.copiaExterna && { exportacion: r.datos.copiaExterna.exportacion, motivo: r.datos.copiaExterna.exportacionMotivo } });
  paso(3, 'ledger actualizado (ejecución + ancla) y consulta desde la consola', st.vencimiento === 'vigente' && st.ancla.estado === 'vigente' && evs().some((x) => x.tipo === 'ancla_integridad') && evs().some((x) => x.tipo === 'integridad_ejecucion'), { nivel: st.nivel, vencimiento: st.vencimiento, eventos: evs().length });
  // 4 · copia externa con claves sintéticas
  dias(6, 9); r = await manual(); const an = comandoIntegridad({ sub: 'ancla', ledgerDir: e.ledgerDir, env: {}, ahora: T + 1000 }).datos; const ce = an.copiaExterna;
  paso(4, otraUnidad ? 'copia externa firmada en otra unidad: exportada y contrastada' : 'copia externa en la MISMA unidad: rechazada por independencia (control negativo)', otraUnidad ? (ce.estado === 'vigente' && ce.contraste === 'coinciden' && ce.contador >= 2) : (r.datos.copiaExterna && r.datos.copiaExterna.exportacion === 'rechazada'), { copia: ce, exportacion: r.datos.copiaExterna && r.datos.copiaExterna.exportacion });
  // 5 · alteración y retroceso
  const snap = path.join(e.raiz, 'snap'); fs.cpSync(e.almacenDir, snap, { recursive: true }); dias(10, 12); r = await manual(); const okAvance = r.codigo === 0;
  fs.rmSync(e.almacenDir, { recursive: true }); fs.cpSync(snap, e.almacenDir, { recursive: true }); r = await manual(); st = estado(T + 1000);
  paso(5, 'retroceso (almacén restaurado a una versión anterior) detectado: código 1, alteración confirmada, sin reanclaje', okAvance && r.codigo === 1 && r.datos.resultado === 'retroceso' && st.alteracionConfirmada === true && st.nivel === 'fallo', { codigo: r.codigo, resultado: r.datos.resultado, accion: r.datos.accionAncla, alertas: st.alertas.map((x) => x.codigo) });
  const ancla1 = evs().filter((x) => x.tipo === 'ancla_integridad').length; fs.rmSync(e.almacenDir, { recursive: true }); fs.cpSync(snap, e.almacenDir, { recursive: true }); dias(10, 14); r = await manual();
  const diario = path.join(e.almacenDir, 'eventos.jsonl'); let alterada = null;
  { const b = fs.readFileSync(diario); const mal = Buffer.from(b); mal[Math.min(60, mal.length - 1)] ^= 0x01; fs.writeFileSync(diario, mal); const r2 = await manual(); alterada = { codigo: r2.codigo, resultado: r2.datos.resultado, accion: r2.datos.accionAncla }; fs.writeFileSync(diario, b); }
  paso(6, 'alteración de un byte del diario: nunca «correcta» (código distinto de 0) y sin avanzar el ancla', alterada.codigo !== 0 && alterada.accion !== 'anclado', { alterada });
  // 7 · fallos
  const estadoJson = path.join(e.almacenDir, 'estado.json'); const l0 = evs().filter((x) => x.tipo === 'ancla_integridad').length; fs.renameSync(estadoJson, `${estadoJson}.fuera`); r = await manual(); fs.renameSync(`${estadoJson}.fuera`, estadoJson);
  paso(7, 'fallo de lectura (falta el estado del almacén): nunca «correcta» y el ancla no avanza', r.codigo !== 0 && evs().filter((x) => x.tipo === 'ancla_integridad').length === l0, { codigo: r.codigo, resultado: r.datos.resultado, motivos: r.datos.motivos });
  const sinPermiso = process.getuid && process.getuid() !== 0; fs.chmodSync(e.almacenDir, 0o000); let rl = null; if (sinPermiso) { rl = await manual(); } fs.chmodSync(e.almacenDir, 0o700);
  paso(8, 'fallo de lectura por permisos del almacén: error operativo (3), nunca «correcta», no alteración', !sinPermiso || (rl.codigo === 3 && rl.datos.resultado === 'error'), { aplicable: sinPermiso, codigo: rl && rl.codigo, motivos: rl && rl.datos.motivos });
  const antes = fs.readFileSync(libLedger().archivo); fs.chmodSync(libLedger().archivo, 0o444); fs.chmodSync(e.ledgerDir, 0o555); let rw = null; if (sinPermiso) rw = await manual(); fs.chmodSync(e.ledgerDir, 0o700); fs.chmodSync(libLedger().archivo, 0o644);
  const despues = fs.readFileSync(libLedger().archivo);
  paso(9, 'ledger no escribible: la ejecución se deniega o falla sin lanzar nada y el ledger queda intacto', !sinPermiso || (Buffer.compare(antes, despues) === 0 && rw.datos.ejecutado !== true && rw.codigo >= 3), { aplicable: sinPermiso, codigo: rw && rw.codigo, registrado: rw && rw.datos.registrado });
  // 10 · concurrencia
  const lanzar = () => ejecutarAutomatico(e, { ahora: (T += H), reloj: () => T, envExtra: { [VAR_CLAVE_PRIVADA]: path.join(dirClaves, 'privada.pem') } }); const [c1, c2] = await Promise.all([lanzar(), lanzar()]);
  paso(10, 'concurrencia: dos ejecuciones simultáneas, a lo sumo una verifica (la otra: ya en ejecución/solicitud perdida)', [c1, c2].filter((x) => x.datos.ejecutado === true).length <= 1 && [c1, c2].some((x) => x.datos.ejecutado === true || x.codigo === 4), { codigos: [c1.codigo, c2.codigo], estados: [c1.datos.estado ?? c1.datos.motivo, c2.datos.estado ?? c2.datos.motivo] });
  // 11 · pérdida del ledger, restauración y recuperación controlada
  const copiaLedger = path.join(e.raiz, 'ledger-copia'); libLedger().copiaSeguridad(copiaLedger); const archivoL = libLedger().archivo; const ancl = libLedger().ancla; fs.rmSync(archivoL); fs.rmSync(ancl, { force: true });
  r = await manual(); const sinAncla = ['sin_ancla', 'retroceso'].includes(r.datos.resultado) && [1, 2].includes(r.codigo) && !evs().some((x) => x.tipo === 'ancla_integridad') && (otraUnidad ? true : r.datos.resultado === 'sin_ancla');
  paso(11, 'ledger perdido: NO se reancla solo (sin copia externa: sin_ancla/2; con copia externa válida: además la copia delata el almacén retrocedido → retroceso/1)', sinAncla, { codigo: r.codigo, resultado: r.datos.resultado, motivo: r.datos.motivoAncla });
  fs.rmSync(archivoL, { force: true }); fs.rmSync(ancl, { force: true }); const lo = libLedger(); const restaurado = LedgerLocal.restaurar(copiaLedger, path.join(e.raiz, 'ledger-restaurado'), { particion: 'integridad', raiz: '/__sin_raiz__' }); for (const n of fs.readdirSync(path.join(e.raiz, 'ledger-restaurado')).filter((x) => x.startsWith('ledger-integridad'))) fs.copyFileSync(path.join(e.raiz, 'ledger-restaurado', n), path.join(e.ledgerDir, n)); const v = libLedger().verificarCadena();
  paso(12, 'restauración controlada del ledger desde una copia verificada: cadena íntegra', v.ok === true && restaurado.eventos > 0 && lo.dir === e.ledgerDir, { eventos: restaurado.eventos, ok: v.ok });
  fs.rmSync(archivoL); fs.rmSync(ancl, { force: true }); const reanclado = await ejecutarIntegridadSupervisada({ ledger: libLedger(), idAlmacen: 'g', almacenDir: e.almacenDir, cli: CLI, reloj: () => (T += H), config: CONFIG_INTEGRIDAD, forzar: true, reanclar: { confirmar: true, motivo: 'ensayo: reanclaje explícito del propietario sintético', autorizadoPor: 'propietario' } });
  paso(13, 'reanclaje SOLO por acto explícito del propietario (API separada, no por «ejecutar»)', reanclado.resultado === 'ok' && reanclado.accionAncla === 'anclado' && reanclado.motivoAncla === 'reanclaje_explicito', { resultado: reanclado.resultado, accion: reanclado.accionAncla, motivo: reanclado.motivoAncla });
  paso(14, 'estado final consultable y sin rutas ni secretos', (() => { const t = JSON.stringify(comandoIntegridad({ sub: 'estado', ledgerDir: e.ledgerDir, env: {}, ahora: T + 1000 })); return !t.includes(e.raiz) && !t.includes(e.codigo) && !/PRIVATE KEY/.test(t); })(), {});
} catch (err) { paso(99, 'error inesperado del ensayo', false, { mensaje: String(err && err.message).slice(0, 200) }); } finally { try { e.limpiar(); } catch { /* temporal */ } }
const resumen = { ensayo: '3E.8.11', ok: pasos.every((x) => x.ok), pasos: pasos.length, falla: pasos.filter((x) => !x.ok).map((x) => x.n) };
process.stdout.write(`${JSON.stringify({ resumen, pasos }, null, 2)}\n`); process.exitCode = resumen.ok ? 0 : 1;
