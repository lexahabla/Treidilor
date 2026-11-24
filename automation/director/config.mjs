/**
 * Agente 00 · F1 · CONFIGURACIÓN. Parámetros iniciales (A-01…A-04) y ubicación del ledger FUERA del repositorio (D3).
 * Ningún valor se escribe «en código» dentro de los módulos de decisión: viven aquí y se cambian por versión, con constancia
 * (nunca los cambia el modelo ni el propio agente; relajar un parámetro de seguridad exige autorización expresa, G-01).
 */
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_APROBACIONES } from './permisos.mjs';
import { FRESCURA_DEFECTO } from './frescura.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const RAIZ_REPOSITORIO = path.resolve(AQUI, '..', '..');

export const CONFIG_DEFECTO = Object.freeze({
  version: '1.0.0-f1',
  aprobaciones: CONFIG_APROBACIONES,
  frescura: FRESCURA_DEFECTO,
  ledger: Object.freeze({ maxBytesEvento: 16384, particion: 'principal', esperaBloqueoMs: 2500, bloqueoCaducaMs: 30000 }),
  propietario: 'propietario',
});

/** Directorio del ledger: variable `TAI_DIRECTOR_DIR` o `~/.treidilor-director`. Nunca dentro del repositorio (lo comprueba el ledger). */
export function directorioLedger(env = process.env) {
  return env.TAI_DIRECTOR_DIR && env.TAI_DIRECTOR_DIR.trim() ? path.resolve(env.TAI_DIRECTOR_DIR) : path.join(os.homedir(), '.treidilor-director');
}

/** Directorio de las instantáneas exportadas (D5: en F1 se leen exportaciones, nunca n8n en vivo). */
export function directorioInstantaneas(env = process.env) {
  return env.TAI_DIRECTOR_INSTANTANEAS && env.TAI_DIRECTOR_INSTANTANEAS.trim() ? path.resolve(env.TAI_DIRECTOR_INSTANTANEAS) : path.join(AQUI, 'fixtures');
}

/** Directorio con los datos del catálogo web (automation-proposals.json, products.json, etc.).
 * Variable `TAI_DIRECTOR_DATOS` o, por defecto, <raiz>/src/data. */
export function directorioDatos(env = process.env) {
  if (env.TAI_DIRECTOR_DATOS && env.TAI_DIRECTOR_DATOS.trim()) return path.resolve(env.TAI_DIRECTOR_DATOS);
  return path.resolve(RAIZ_REPOSITORIO, 'src', 'data');
}
