// Agente 00 · 3E.8.11 · MODO SINTÉTICO para pruebas automatizadas (solo tests; la carpeta `tests/` no entra en ningún paquete).
// No es un atajo en el código de producción: `ejecutar-manual.mjs` no sabe nada de él. Este ayudante crea un entorno propio, comprueba que es físicamente y lógicamente sintético y, solo entonces,
// recorre las MISMAS dos etapas y el MISMO código del propietario (un código sintético generado aquí) que recorrería una persona. Si algo no cuadra, lanza y no ejecuta nada.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ARCHIVO_ACTIVACION, ESQUEMA_ACTIVACION, SEGMENTOS_NO_AUTORIZADOS } from '../integridad/consola.mjs';
import { confirmarEjecucion, crearVerificador, prepararEjecucion, VAR_CODIGO } from '../integridad/ejecutar-manual.mjs';

export const MARCA = '.tai-sintetico.json';
export const ESQUEMA_MARCA = 'tai-entorno-sintetico/1';
const dentro = (hijo, padre) => { const r = path.relative(padre, hijo); return r !== '' && !r.startsWith('..') && !path.isAbsolute(r); };

/** Crea un entorno sintético NUEVO bajo el directorio temporal, con marca, código y verificador propios. Nunca reutiliza carpetas existentes. */
export function crearEntornoSintetico({ cli, extraEjecucion = {}, extraActivacion = {} } = {}) {
  const raiz = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tai-sint-')));
  const token = crypto.randomBytes(16).toString('hex'); const codigo = `sint-${crypto.randomBytes(12).toString('hex')}`;
  fs.writeFileSync(path.join(raiz, MARCA), JSON.stringify({ esquema: ESQUEMA_MARCA, token: crypto.createHash('sha256').update(token).digest('hex'), pid: process.pid, raiz }));
  const ledgerDir = path.join(raiz, 'ledger'); const almacenDir = path.join(raiz, 'almacen'); fs.mkdirSync(ledgerDir); fs.mkdirSync(almacenDir);
  const activacion = { esquema: ESQUEMA_ACTIVACION, habilitada: true, autorizadoPor: 'propietario', idAlmacen: 'g', ejecucion: { almacenDir, cli, verificador: crearVerificador(codigo), ...extraEjecucion }, ...extraActivacion };
  fs.writeFileSync(path.join(ledgerDir, ARCHIVO_ACTIVACION), JSON.stringify(activacion));
  return { raiz, ledgerDir, almacenDir, codigo, token, activacion, limpiar: () => fs.rmSync(raiz, { recursive: true, force: true }) };
}

/** Escribe (o reescribe) un CLI de prueba como PAQUETE válido: `<raiz>/src/integridad-cli.mjs` + `package.json` + `MANIFIESTO.json` con el hash de cada archivo. Solo para tests (la carpeta no viaja en ningún paquete). */
export function sellarCliPaquete(cli, { contrato = 'integridad-ejecucion/1', directorMinimo = '1.1.0' } = {}) {
  const raiz = path.dirname(path.dirname(cli)); if (!fs.existsSync(path.join(raiz, 'package.json'))) fs.writeFileSync(path.join(raiz, 'package.json'), '{"type":"module"}\n');
  const archivos = []; const pila = ['']; while (pila.length) { const rel = pila.pop(); for (const e of fs.readdirSync(path.join(raiz, rel), { withFileTypes: true })) { const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) pila.push(r); else if (r !== 'MANIFIESTO.json') { const b = fs.readFileSync(path.join(raiz, r)); archivos.push({ ruta: r, sha256: crypto.createHash('sha256').update(b).digest('hex'), bytes: b.length }); } } }
  archivos.sort((x, y) => (x.ruta < y.ruta ? -1 : 1)); fs.writeFileSync(path.join(raiz, 'MANIFIESTO.json'), JSON.stringify({ formato: 'treidilor-integridad-cli-tar/1', version: '0.0.1', versionCli: '0.0.1', contrato, directorMinimo, nodeMinimo: '22', entrada: 'src/integridad-cli.mjs', archivos }, null, 1));
  return cli;
}
export function crearCliPaquete(carpeta, cuerpo, opciones = {}) { const cli = path.join(carpeta, 'cli', 'src', 'integridad-cli.mjs'); fs.mkdirSync(path.dirname(cli), { recursive: true }); fs.writeFileSync(cli, cuerpo); return sellarCliPaquete(cli, opciones); }

/** Comprobaciones de aislamiento. Lanza si el entorno no es el sintético que ESTE proceso acaba de crear. */
export function exigirSintetico(e) {
  const tmp = fs.realpathSync(os.tmpdir()); const fallo = (m) => { throw new Error(`entorno_no_sintetico:${m}`); };
  if (!e || typeof e.raiz !== 'string' || typeof e.token !== 'string') fallo('sin_entorno');
  let real; try { real = fs.realpathSync(e.raiz); } catch { fallo('inexistente'); }
  if (!dentro(real, tmp)) fallo('fuera_del_directorio_temporal');
  if (real.split(path.sep).some((s) => SEGMENTOS_NO_AUTORIZADOS.includes(s.toLowerCase()))) fallo('segmento_protegido');
  let marca; try { marca = JSON.parse(fs.readFileSync(path.join(real, MARCA), 'utf8')); } catch { fallo('sin_marca'); }
  if (marca.esquema !== ESQUEMA_MARCA || marca.pid !== process.pid || marca.raiz !== real || marca.token !== crypto.createHash('sha256').update(e.token).digest('hex')) fallo('marca_no_coincide');
  for (const d of [e.ledgerDir, e.almacenDir]) { let r; try { r = fs.realpathSync(d); } catch { fallo('subcarpeta_inexistente'); } if (!dentro(r, real)) fallo('subcarpeta_fuera_del_entorno'); }
  const act = JSON.parse(fs.readFileSync(path.join(e.ledgerDir, ARCHIVO_ACTIVACION), 'utf8')); if (!act.ejecucion || fs.realpathSync(act.ejecucion.almacenDir) !== fs.realpathSync(e.almacenDir)) fallo('la_activacion_apunta_a_otro_almacen');
  return true;
}

/** Recorre las dos etapas con el código sintético. No acepta nada que no sea un entorno creado por `crearEntornoSintetico` en este proceso. */
export async function ejecutarAutomatico(e, { ahora = Date.now(), reloj = null, envExtra = {} } = {}) {
  exigirSintetico(e); const env = { ...envExtra, [VAR_CODIGO]: e.codigo };
  const p = prepararEjecucion({ ledgerDir: e.ledgerDir, env, ahora }); if (p.codigo !== 0) return p;
  return confirmarEjecucion({ ledgerDir: e.ledgerDir, env, ahora, solicitud: p.datos.solicitud, reloj });
}
