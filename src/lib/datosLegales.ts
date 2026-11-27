/**
 * TREIDILOR — DATOS DEL TITULAR PARA LAS PÁGINAS LEGALES (aviso legal, privacidad, cookies).
 *
 * Los datos NO están en el código ni en git: el propietario los escribe en `legal-titular.json` dentro del directorio de datos del servidor
 * (el mismo volumen que el catálogo). Mientras falte algún dato obligatorio o el propietario no confirme que ha revisado los textos
 * (`textosRevisados: true`), las páginas legales responden 404 y el pie no las enlaza: no se publica nada con datos ficticios.
 *
 * Datos obligatorios (LSSI-CE art. 10 y RGPD arts. 13-14): titular (nombre y apellidos o razón social), NIF/NIE/CIF, domicilio, correo de
 * contacto. Opcionales: teléfono, datos de inscripción registral (sociedades), delegado de protección de datos.
 */
import fs from 'node:fs';
import { dataFile } from './paths';

export interface DatosLegales {
  titular: string;
  nif: string;
  domicilio: string;
  email: string;
  telefono?: string;
  registro?: string;
  dpo?: string;
  actualizadoEn?: string;
  textosRevisados: true;
}

const ARCHIVO = 'legal-titular.json';
const texto = (v: unknown, min: number, max: number): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length >= min && s.length <= max && !/[<>]/.test(s) ? s : null;
};
const opcional = (v: unknown, max: number): string | undefined => texto(v, 1, max) ?? undefined;

/** Valida el contenido del archivo; devuelve null si falta algo obligatorio o no se han revisado los textos. PURA. */
export function validarDatosLegales(raw: unknown): DatosLegales | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const titular = texto(o.titular, 3, 160); const nif = texto(o.nif, 8, 15); const domicilio = texto(o.domicilio, 10, 240);
  const email = texto(o.email, 6, 160);
  if (!titular || !nif || !/^[A-Za-z0-9-]{8,15}$/.test(nif) || !domicilio || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (o.textosRevisados !== true) return null;
  return {
    titular, nif: nif.toUpperCase(), domicilio, email,
    telefono: opcional(o.telefono, 40), registro: opcional(o.registro, 240), dpo: opcional(o.dpo, 160), actualizadoEn: opcional(o.actualizadoEn, 40),
    textosRevisados: true,
  };
}

let cache: { mtime: number; datos: DatosLegales | null } | null = null;
/** Datos del titular desde el servidor (con caché por fecha de modificación), o null si no están completos. */
export function cargarDatosLegales(): DatosLegales | null {
  const ruta = dataFile(ARCHIVO);
  let mtime = -1; try { mtime = fs.statSync(ruta).mtimeMs; } catch { cache = { mtime: -1, datos: null }; return null; }
  if (cache && cache.mtime === mtime) return cache.datos;
  let datos: DatosLegales | null = null;
  try { datos = validarDatosLegales(JSON.parse(fs.readFileSync(ruta, 'utf8'))); } catch { datos = null; }
  cache = { mtime, datos };
  return datos;
}
