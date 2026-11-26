/**
 * Preludio común de las rutas de automatización NUEVAS (propuestas, simulación de importación, lecturas v2): interruptor de la capacidad (404 si está apagada,
 * indistinguible de una ruta inexistente), autenticación por alcance (401/403/429 con auditoría) y lectura acotada del cuerpo JSON. No escribe nada por sí mismo.
 */
import { audit, authenticate, authFailureResponse, automationEnabled, automationJson, clientIpOf, disabledResponse, featureEnabled, type AutomationClient, type AutomationFeature, type AutomationScope } from './automationApi';

export interface AuditBase { clientId: string; scope: string; method: string; path: string; query: string; ip: string }
export type Gate = { ok: true; client: AutomationClient; base: AuditBase } | { ok: false; response: Response };

export function gate(request: Request, scope: AutomationScope, feature: AutomationFeature): Gate {
  if (!automationEnabled() || !featureEnabled(feature)) return { ok: false, response: disabledResponse() };
  const auth = authenticate(request, scope);
  if (!auth.ok) return { ok: false, response: authFailureResponse(auth) };
  const url = new URL(request.url);
  return { ok: true, client: auth.client, base: { clientId: auth.client.id, scope, method: request.method, path: url.pathname, query: url.search.slice(0, 120), ip: clientIpOf(request) } };
}

export const methodNotAllowed = (feature: AutomationFeature, allow: string): Response => (!automationEnabled() || !featureEnabled(feature) ? disabledResponse() : automationJson(405, { success: false, code: 'metodo_no_permitido', message: `Sólo ${allow}.` }, { Allow: allow }));

export function audited(base: AuditBase, status: number, extra: { reason?: string; items?: number; detail?: string } = {}): void {
  audit({ event: 'peticion', ...base, status, ...extra });
}

/** Lee un cuerpo JSON de hasta `maxBytes`: sin `Content-Length` fiable también se limita lo realmente leído. */
export async function readJsonBody(request: Request, maxBytes: number): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const bad = (status: number, code: string, message: string) => ({ ok: false as const, response: automationJson(status, { success: false, code, message }) });
  if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) return bad(415, 'tipo_no_soportado', 'El cuerpo debe ser application/json.');
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) return bad(413, 'cuerpo_demasiado_grande', `El cuerpo supera ${maxBytes} bytes.`);
  let text = '';
  try { text = await request.text(); } catch { return bad(400, 'cuerpo_ilegible', 'No se pudo leer el cuerpo.'); }
  if (Buffer.byteLength(text, 'utf8') > maxBytes) return bad(413, 'cuerpo_demasiado_grande', `El cuerpo supera ${maxBytes} bytes.`);
  try { return { ok: true, value: JSON.parse(text) }; } catch { return bad(400, 'json_no_valido', 'El cuerpo no es JSON válido.'); }
}
