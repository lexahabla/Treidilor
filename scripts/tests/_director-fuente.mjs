// Utilidad de pruebas (no es una prueba): localiza el código fuente del Director 00 para las pruebas
// de integración web ↔ Director, sin rutas absolutas (regla 4 de la norma de TREIDILOR).
//  1. TAI_DIRECTOR_FUENTE, si está definida;
//  2. el worktree `.worktrees/autonomia` del repositorio principal (rama del Director), localizado
//     con `git rev-parse --git-common-dir`, funcione la prueba desde `main` o desde otro worktree.
// Si no se encuentra, las pruebas que lo necesitan se OMITEN indicando el motivo (nunca se dan por superadas).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function candidata() {
  if (process.env.TAI_DIRECTOR_FUENTE) return path.resolve(process.env.TAI_DIRECTOR_FUENTE);
  try {
    const comun = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: import.meta.dirname, encoding: 'utf8' }).trim();
    return path.join(path.dirname(comun), '.worktrees', 'autonomia');
  } catch {
    return null;
  }
}

const dir = candidata();
/** Ruta del código del Director, o null si no está disponible. */
export const FUENTE_DIRECTOR = dir && fs.existsSync(path.join(dir, 'automation', 'autonomia', 'puente-chat.mjs')) ? dir : null;
/** Motivo de omisión (false si la fuente está disponible), para `test(nombre, { skip }, fn)`. */
export const OMITIR_SIN_DIRECTOR = FUENTE_DIRECTOR ? false
  : 'no se encontró el código del Director 00 (define TAI_DIRECTOR_FUENTE o crea el worktree .worktrees/autonomia)';
/** Importa un módulo del Director por ruta relativa a su raíz. */
export const importarDelDirector = (relativa) => import(pathToFileURL(path.join(FUENTE_DIRECTOR, relativa)).href);
