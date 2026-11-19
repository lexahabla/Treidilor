#!/usr/bin/env node
// PUENTE Director ↔ n8n · lanzador LOCAL del servicio HTTP (Agente 00 + Canal 13). Sólo bucle local; no despliega nada y no toca producción.
//
//   node scripts/automation/puente.mjs servir [--puerto 4360] [--n8n http://127.0.0.1:5678/webhook-test] [--n8n-produccion http://<servicio-interno>:5678/webhook --hosts <servicio-interno>] [--instantaneas <dir>] [--ledger <dir>] [--firma] [--cerebro simulado]
//
// Variables de entorno (nunca por argumento ni en el repositorio):
//   TAI_LECTOR_TOKEN          valor de la credencial Header Auth «Treidilor — Lector puente (solo lectura)» de n8n (sólo con --n8n)
//   TAI_LECTOR_PROD_TOKEN     valor de la credencial Header Auth EXCLUSIVA «Treidilor — Lector puente PRODUCCIÓN (solo lectura)» (sólo con --n8n-produccion)
//   TAI_PUENTE_FIRMA_SECRETO  secreto HMAC (≥ 16 caracteres) si se usa --firma
// Al arrancar crea un token de cliente (en memoria, 30 días) y lo muestra UNA vez: no se guarda en ningún archivo.
import { construirDirector } from './director.mjs';
import { LectorN8n } from '../../automation/director/puente/lector-n8n.mjs';
import { crearLectorProduccion } from '../../automation/director/puente/lector-produccion.mjs';
import { AlmacenTokens } from '../../automation/director/puente/tokens.mjs';
import { VerificadorFirma } from '../../automation/director/puente/firma.mjs';
import { crearServicioPuente } from '../../automation/director/puente/servidor.mjs';

function opciones(argv) {
  const pos = [];
  const o = {};
  const conValor = new Set(['puerto', 'n8n', 'n8n-produccion', 'hosts', 'instantaneas', 'ledger', 'cerebro', 'ahora']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); o[k] = conValor.has(k) ? argv[++i] : true; } else pos.push(a);
  }
  return { pos, o };
}

const { pos, o } = opciones(process.argv.slice(2));
if (pos[0] !== 'servir') {
  console.error('Uso: puente.mjs servir [--puerto 4360] [--n8n <urlBase del webhook>] [--n8n-produccion <urlBase interna> --hosts <h1,h2>] [--instantaneas <dir>] [--ledger <dir>] [--firma] [--cerebro simulado]');
  process.exit(2);
}
try {
  const { director } = construirDirector({ ledger: o.ledger, instantaneas: o.instantaneas, cerebro: o.cerebro, ahora: o.ahora });
  if (o.n8n && o['n8n-produccion']) throw new Error('Usa --n8n (pruebas) o --n8n-produccion, no los dos.');
  if (o.n8n) director.lector = new LectorN8n({ urlBase: o.n8n, token: process.env.TAI_LECTOR_TOKEN || '' });
  // PRODUCCIÓN (sólo lectura): destino INTERNO y lista explícita de hosts; token exclusivo por variable de entorno (nunca por argumento ni en el repositorio)
  if (o['n8n-produccion']) director.lector = crearLectorProduccion({ urlBase: o['n8n-produccion'], token: process.env.TAI_LECTOR_PROD_TOKEN || '', hostsPermitidos: String(o.hosts || '').split(',').map((h) => h.trim()).filter(Boolean) });
  const tokens = new AlmacenTokens();
  const { token, caduca } = tokens.crear({ id: 'consola-local', dias: 30 });
  const verificador = o.firma ? new VerificadorFirma({ secreto: process.env.TAI_PUENTE_FIRMA_SECRETO || '' }) : null;
  const servicio = crearServicioPuente({ director, tokens, verificador });
  const { host, puerto } = await servicio.escuchar({ host: '127.0.0.1', puerto: Number(o.puerto || 4360) });
  console.log(`Servicio del Director en http://${host}:${puerto} (solo bucle local) · lector: ${o['n8n-produccion'] ? 'n8n PRODUCCIÓN solo lectura (' + o['n8n-produccion'] + ')' : o.n8n ? 'n8n (' + o.n8n + ')' : 'archivos'} · firma: ${verificador ? 'sí' : 'no'}`);
  console.log(`Token del cliente (se muestra una sola vez; caduca ${caduca}):\n${token}`);
} catch (e) {
  console.error(`No se pudo arrancar el servicio: ${(e && e.error && e.error.mensaje) || (e && e.message) || 'error'}`);
  process.exit(1);
}
