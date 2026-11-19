#!/usr/bin/env node
/**
 * Treidilor AI · 3E.8.14 · VERIFICADOR INDEPENDIENTE de confianza para la instalación (solo `node:` + `./confianza-politica.mjs` y `./verificar-firma-paquete.mjs`, que viajan juntos; nada del repositorio).
 *   node verificar-confianza.mjs --confianza <carpeta> --modo pruebas|produccion [--version-minima N] [--raiz-id <id>] [--ahora ISO]
 *        [--tar <paquete.tar> --firma <firma.json>]      verifica además la firma del paquete con la clave AUTORIZADA por la política
 *        [--solo-clave <claveId>]                         (reversión) verifica la política y que esa clave siga autorizada, sin paquete
 * La carpeta de confianza debe contener `raiz-publica.pem` y `raiz-id.txt` (fijados por el propietario por OTRO canal), `politica.json` (firmada por la raíz) y `registro-confianza.jsonl`.
 * Política o registro ausentes, corruptos, antiguos o incoherentes ⇒ salida 1 y NO se confía en nada. Solo LEE. Salida 0 = confianza válida · 1 = no · 2 = uso.
 * `--version-minima` es la REFERENCIA INDEPENDIENTE de versión (la conoce el propietario por otra vía) y `--raiz-id` fija la raíz por un canal distinto de la carpeta: en modo producción son OBLIGATORIAS.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { claveIdDe, comprobarCoherencia, evaluarClave, verificarPolitica, verificarRegistro } from './confianza-politica.mjs';
import { CLAVES_DE_PRUEBAS_CONOCIDAS, verificarFirmaPaquete } from './verificar-firma-paquete.mjs';

export const ARCHIVOS = Object.freeze({ raiz: 'raiz-publica.pem', raizId: 'raiz-id.txt', politica: 'politica.json', registro: 'registro-confianza.jsonl' });
const leer = (dir, n) => { try { return fs.readFileSync(path.join(dir, n), 'utf8'); } catch { return null; } };

/** Evaluación pura (sin tocar el disco). Nunca lanza. → { ok, errores[], version?, huella?, claveId?, pendienteDeAnotar? } */
export function evaluarConfianza({ raizPem, raizIdTxt, politicaTxt, registroTxt, modo = 'pruebas', versionMinima = 0, raizIdFijado = null, ahora = Date.now(), tar = null, firmaTxt = null, soloClave = null }) {
  if (!['pruebas', 'produccion'].includes(modo)) return { ok: false, errores: ['modo desconocido'] };
  if (raizPem === null || raizIdTxt === null) return { ok: false, errores: ['falta la raíz de confianza fijada (raiz-publica.pem / raiz-id.txt)'] };
  if (modo === 'produccion' && !raizIdFijado) return { ok: false, errores: ['en modo producción es obligatorio fijar el raizId por un canal distinto de la carpeta de confianza (--raiz-id)'] };
  if (raizIdFijado && raizIdFijado !== raizIdTxt.trim()) return { ok: false, errores: ['la raíz de la carpeta de confianza NO es la fijada por el propietario'] };
  if (politicaTxt === null) return { ok: false, errores: ['falta la política de confianza (politica.json): no se instala nada por defecto'] };
  if (registroTxt === null) return { ok: false, errores: ['falta el registro de confianza (registro-confianza.jsonl)'] };
  if (modo === 'produccion' && !(Number.isInteger(versionMinima) && versionMinima >= 1)) return { ok: false, errores: ['en modo producción es obligatoria la versión mínima de política conocida por el propietario (referencia independiente)'] };
  const p = verificarPolitica({ texto: politicaTxt, raizPem, raizId: raizIdTxt.trim(), versionMinima, entornoEsperado: modo === 'produccion' ? 'PRODUCCION' : 'PRUEBAS' }); if (!p.ok) return { ok: false, errores: p.errores };
  const r = verificarRegistro(registroTxt); if (!r.ok) return { ok: false, errores: r.errores };
  const c = comprobarCoherencia({ politica: p.politica, huella: p.huella, registro: r }); if (!c.ok) return { ok: false, errores: c.errores };
  const base = { ok: true, errores: [], version: p.politica.version, huella: p.huella, pendienteDeAnotar: c.pendienteDeAnotar };
  if (modo === 'produccion' && soloClave && CLAVES_DE_PRUEBAS_CONOCIDAS.includes(soloClave)) return { ok: false, errores: ['clave de PRUEBAS rechazada en modo producción'] };
  if (soloClave) { const k = evaluarClave(p.politica, soloClave, ahora); return k.ok ? { ...base, claveId: soloClave } : { ok: false, errores: [k.motivo] }; }
  if (tar === null) return base;
  let doc; try { doc = JSON.parse(firmaTxt); } catch { return { ok: false, errores: ['la firma no es JSON'] }; }
  const claveId = doc && typeof doc.claveId === 'string' ? doc.claveId : '';
  const k = evaluarClave(p.politica, claveId, ahora); if (!k.ok) return { ok: false, errores: [k.motivo] };
  const f = verificarFirmaPaquete({ tar, firma: firmaTxt, publicaPem: k.publica, claveIdEsperada: claveId, modo }); if (!f.ok) return { ok: false, errores: f.errores };
  return { ...base, claveId, tipo: f.tipo, versionPaquete: f.version, artefacto: f.artefacto };
}

function main(argv) {
  const o = {}; for (let i = 0; i < argv.length; i += 1) if (argv[i].startsWith('--')) { o[argv[i].slice(2)] = argv[i + 1]; i += 1; }
  if (!o.confianza) { console.error('Uso: verificar-confianza.mjs --confianza <carpeta> --modo pruebas|produccion [--version-minima N] [--tar t --firma f] [--solo-clave id]'); return 2; }
  const dir = path.resolve(o.confianza); let tar = null; let firmaTxt = null;
  if (o.tar !== undefined || o.firma !== undefined) { try { tar = fs.readFileSync(o.tar); firmaTxt = fs.readFileSync(o.firma, 'utf8'); } catch { console.log('CONFIANZA_NO:\n- no se pudo leer el paquete o su firma'); return 1; } }
  const ahora = o.ahora ? Date.parse(o.ahora) : Date.now(); if (Number.isNaN(ahora)) { console.log('CONFIANZA_NO:\n- fecha --ahora inválida'); return 1; }
  const vm = o['version-minima'] === undefined ? 0 : Number(o['version-minima']); if (!Number.isInteger(vm) || vm < 0) { console.log('CONFIANZA_NO:\n- --version-minima inválida'); return 1; }
  const r = evaluarConfianza({ raizPem: leer(dir, ARCHIVOS.raiz), raizIdTxt: leer(dir, ARCHIVOS.raizId), politicaTxt: leer(dir, ARCHIVOS.politica), registroTxt: leer(dir, ARCHIVOS.registro), modo: o.modo ?? 'pruebas', versionMinima: vm, raizIdFijado: o['raiz-id'] ?? null, ahora, tar, firmaTxt, soloClave: o['solo-clave'] ?? null });
  if (r.ok && tar !== null && JSON.parse(firmaTxt).artefacto !== path.basename(o.tar)) { console.log('CONFIANZA_NO:\n- el nombre del archivo no es el firmado'); return 1; }
  console.log(r.ok ? `CONFIANZA_OK politica=${r.version} huella=${r.huella.slice(0, 16)}${r.claveId ? ` clave=${r.claveId}` : ''}${r.pendienteDeAnotar ? ' pendiente_de_anotar_en_el_registro' : ''}` : `CONFIANZA_NO:\n- ${r.errores.join('\n- ')}`);
  return r.ok ? 0 : 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
export { claveIdDe };
