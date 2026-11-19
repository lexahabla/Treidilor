#!/usr/bin/env node
/**
 * Treidilor AI · 3E.8.13 · VERIFICADOR INDEPENDIENTE de un ÁRBOL extraído frente a su MANIFIESTO.json. Solo `node:` (no importa nada del repositorio) para poder ejecutarse en una imagen mínima.
 *   node verificar-arbol-paquete.mjs <carpeta>
 * Comprueba: manifiesto legible (formato `treidilor-director-tar/1` o `treidilor-integridad-cli-tar/1`); TODOS los archivos listados existen con su SHA-256 y tamaño; NO hay archivos de más; ningún enlace simbólico ni
 * entrada que no sea archivo o carpeta; rutas del manifiesto seguras (sin absolutas, `..`, `\`, NUL, unidades). Solo LEE. Salida 0 = íntegro · 1 = no íntegro (con los motivos) · 2 = uso.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FORMATOS = new Set(['treidilor-director-tar/1', 'treidilor-integridad-cli-tar/1']);
const segura = (r) => typeof r === 'string' && r.length > 0 && r.length <= 240 && !r.includes('\\') && !r.includes('\0') && !r.startsWith('/') && !/^[A-Za-z]:/.test(r) && r.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
export function verificarArbol(raiz) {
  const errores = []; let man; try { man = JSON.parse(fs.readFileSync(path.join(raiz, 'MANIFIESTO.json'), 'utf8')); } catch { return { ok: false, errores: ['manifiesto ausente o ilegible'] }; }
  if (!man || !FORMATOS.has(man.formato) || !Array.isArray(man.archivos)) return { ok: false, errores: ['formato de manifiesto no reconocido'] };
  const previstos = new Map(); for (const a of man.archivos) { if (!a || !segura(a.ruta) || !/^[0-9a-f]{64}$/.test(a.sha256) || !Number.isInteger(a.bytes) || previstos.has(a.ruta)) return { ok: false, errores: ['manifiesto con rutas o hashes inválidos o duplicados'] }; previstos.set(a.ruta, a); }
  const reales = []; const pila = [''];
  while (pila.length) { const rel = pila.pop(); for (const e of fs.readdirSync(path.join(raiz, rel), { withFileTypes: true })) { const r = rel ? `${rel}/${e.name}` : e.name; if (e.isSymbolicLink()) errores.push(`enlace simbólico: ${r}`); else if (e.isDirectory()) pila.push(r); else if (e.isFile()) reales.push(r); else errores.push(`entrada no permitida: ${r}`); } }
  for (const r of reales) if (r !== 'MANIFIESTO.json' && !previstos.has(r)) errores.push(`archivo de más: ${r}`);
  for (const [r, a] of previstos) { let b; try { b = fs.readFileSync(path.join(raiz, r)); } catch { errores.push(`falta: ${r}`); continue; } if (b.length !== a.bytes || crypto.createHash('sha256').update(b).digest('hex') !== a.sha256) errores.push(`alterado: ${r}`); }
  return { ok: errores.length === 0, errores: errores.slice(0, 20), version: man.version ?? null, formato: man.formato, archivos: previstos.size };
}
function main(argv) {
  if (!argv[0]) { console.error('Uso: verificar-arbol-paquete.mjs <carpeta>'); return 2; }
  let r; try { r = verificarArbol(path.resolve(argv[0])); } catch (e) { r = { ok: false, errores: [`no se pudo leer (${e.code ?? 'error'})`] }; }
  console.log(r.ok ? `ARBOL_INTEGRO version=${r.version} archivos=${r.archivos}` : `ARBOL_NO_INTEGRO:\n- ${r.errores.join('\n- ')}`); return r.ok ? 0 : 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
