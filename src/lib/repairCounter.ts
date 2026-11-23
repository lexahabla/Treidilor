/**
 * ==============================================================================
 * TREIDILOR - CONTADOR PERSISTENTE DE REPARACIONES DEL CATÁLOGO
 * ==============================================================================
 * Lleva el número de reparaciones aplicadas al catálogo (defectos detectados
 * por `catalogRepair.ts`). Es un fichero independiente de la rotación de
 * auditoría (`automation-audit.jsonl`): no comparte fichero, ni formato, ni
 * lógica de rotación.
 *
 * Modelo de fallo seguro (fail-secure):
 *   - Fichero ausente → las reparaciones se BLOQUEAN. No se inicializa en cero
 *     implícitamente: eso reiniciaría un presupuesto ya iniciado.
 *   - Fichero corrupto o ilegible → las reparaciones se BLOQUEAN.
 *   - Estado válido → el consumo persiste y se conserva.
 *   - Escritura atómica (temporal + `rename`): si falla, el fichero previo queda intacto.
 *   - Reserva antes de escritura: `reserveAndRecord` lee, valida, incrementa en memoria
 *     y sólo entonces persiste. Si la persistencia falla, la reserva se descarta.
 *   - Inicialización explícita: solo `initRepairCounter()` puede crear el contador
 *     en cero, y solo si no existe ya uno.
 * Todo es síncrono: dentro de un mismo proceso no hay interleaving entre lecturas y escrituras.
 */

import fs from 'node:fs';
import path from 'node:path';
import { dataFile } from './paths';
import type { RepairKind } from './catalogRepair';

const COUNTER_FILE = dataFile('repair-counter.json');

export interface RepairCounter {
  /** Número total de reparaciones aplicadas. */
  count: number;
  /** Conteo por tipo de reparación. */
  byKind: Record<RepairKind, number>;
  /** Fecha y hora de la última reparación registrada. */
  lastRepairAt?: string;
  /** Fecha y hora de la última actualización del contador. */
  updatedAt: string;
}

export type CounterStatus = 'valido' | 'ausente' | 'corrupto';

export interface CounterReadResult {
  status: CounterStatus;
  counter?: RepairCounter;
}

const EMPTY_KINDS: Record<RepairKind, number> = {
  'brand-is-merchant': 0,
  'fabricated-rating': 0,
  'duplicate-offer': 0,
  'brand-spec-mismatch': 0,
  'malformed-merchant': 0,
};

function emptyCounter(): RepairCounter {
  return {
    count: 0,
    byKind: { ...EMPTY_KINDS },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Valida que un objeto parseado tenga la forma de un contador de reparaciones.
 */
function isValidCounterShape(value: unknown): value is RepairCounter {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const c = value as RepairCounter;
  return (
    typeof c.count === 'number' &&
    Number.isFinite(c.count) &&
    c.count >= 0 &&
    c.byKind &&
    typeof c.byKind === 'object' &&
    !Array.isArray(c.byKind)
  );
}

/**
 * Lee el contador de reparaciones distinguiendo los tres estados posibles.
 *
 * - `valido`: el fichero existe y tiene JSON válido. Devuelve el contador.
 * - `ausente`: el fichero no existe. BLOQUEA: no se devuelve cero en silencio.
 * - `corrupto`: el fichero existe pero no se puede leer o parsear. BLOQUEA.
 */
export function readRepairCounterSafe(): CounterReadResult {
  try {
    if (!fs.existsSync(COUNTER_FILE)) return { status: 'ausente' };
    const raw = fs.readFileSync(COUNTER_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!isValidCounterShape(parsed)) return { status: 'corrupto' };
    const byKind = { ...EMPTY_KINDS, ...parsed.byKind };
    return {
      status: 'valido',
      counter: {
        count: Math.max(0, Math.floor(parsed.count)),
        byKind,
        lastRepairAt: typeof parsed.lastRepairAt === 'string' ? parsed.lastRepairAt : undefined,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      },
    };
  } catch {
    return { status: 'corrupto' };
  }
}

/**
 * Lee el contador para consumo de solo lectura.
 * - Si el estado es `ausente` o `corrupto`, lanza (bloquea reparaciones).
 * - Si el estado es `valido`, devuelve el contador persistido.
 */
export function readRepairCounter(): RepairCounter {
  const result = readRepairCounterSafe();
  if (result.status !== 'valido' || !result.counter) {
    throw new Error(
      `repair-counter.json no está disponible (${result.status}): reparaciones bloqueadas`,
    );
  }
  return result.counter;
}

/**
 * Inicialización explícita y controlada del contador.
 * Solo crea el fichero si no existe ya uno. Nunca sobrescribe un contador existente,
 * por tanto nunca reinicia un presupuesto ya iniciado.
 * Devuelve `true` si se inicializó, `false` si ya existía.
 */
export function initRepairCounter(): boolean {
  if (fs.existsSync(COUNTER_FILE)) return false;
  const counter = emptyCounter();
  return writeRepairCounter(counter);
}

/**
 * Escribe el contador de forma atómica.
 * Devuelve `false` si no se pudo escribir (el fichero previo queda intacto).
 * Nunca lanza: un error de escritura no puede tumbar quien llama.
 */
export function writeRepairCounter(counter: RepairCounter): boolean {
  try {
    fs.mkdirSync(path.dirname(COUNTER_FILE), { recursive: true });
    const tmpFile = `${COUNTER_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(counter, null, 2), 'utf-8');
    fs.renameSync(tmpFile, COUNTER_FILE);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reserva una operación de reparación y la persiste.
 *
 * Flujo (reserva antes de escritura):
 *   1. Lee el contador. Si está `ausente` o `corrupto` → se rechaza (reparaciones bloqueadas).
 *   2. Incrementa en memoria (reserva).
 *   3. Persiste de forma atómica.
 *   4. Si la persistencia falla → la reserva se descarta (no se consumió nada).
 *
 * Devuelve `{ ok: true, counter }` si se registró, o `{ ok: false, reason }`
 * si no se pudo (contador ausente/corrupto o error de escritura).
 */
export function reserveAndRecord(kind: RepairKind): {
  ok: boolean;
  counter?: RepairCounter;
  reason?: string;
} {
  const read = readRepairCounterSafe();
  if (read.status !== 'valido' || !read.counter) {
    return { ok: false, reason: `contador_${read.status}: reparaciones bloqueadas` };
  }
  const counter = read.counter;
  counter.count += 1;
  counter.byKind[kind] = (counter.byKind[kind] ?? 0) + 1;
  const now = new Date().toISOString();
  counter.lastRepairAt = now;
  counter.updatedAt = now;
  const written = writeRepairCounter(counter);
  if (!written) {
    return { ok: false, reason: 'no_se_pudo_persistir_el_contador' };
  }
  return { ok: true, counter };
}

/**
 * Registra una reparación aplicada (alias de `reserveAndRecord` para compatibilidad).
 * Si el contador no está disponible, no registra nada y devuelve `ok: false`.
 */
export function recordRepair(kind: RepairKind): { ok: boolean; counter?: RepairCounter; reason?: string } {
  return reserveAndRecord(kind);
}

/** Número total de reparaciones registradas (o de un tipo concreto).
 * Lanza si el contador no está disponible (no devuelve 0 silenciosamente). */
export function getRepairCount(kind?: RepairKind): number {
  const result = readRepairCounterSafe();
  if (result.status !== 'valido' || !result.counter) {
    throw new Error(
      `repair-counter.json no está disponible (${result.status}): no se puede leer el consumo`,
    );
  }
  return kind ? result.counter.byKind[kind] ?? 0 : result.counter.count;
}

/**
 * Comprueba si se puede realizar al menos una reparación más (contador válido).
 * No modifica el estado.
 */
export function canPerformRepair(): boolean {
  return readRepairCounterSafe().status === 'valido';
}
