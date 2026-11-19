// Sonda exterior de E3: lógica pura y servidor falso LOCAL (sin red externa, sin Docker). Comprueba que detecta bloqueos, fugas, centinelas caídos y que no envía credencial sin --cred-file.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { construirCeldas, ejecutar, esRespuestaTraefik, evaluarBloqueo, evaluarNegativo } from '../../../scripts/automation/sonda-exterior-e3.mjs';

const REGLA = /^(?:\/|%2f|%5c)+webhook.*tai-lector-prod-/i;
function servidor({ bloquea = true, caeHealthz = false, vistos = [] } = {}) {
  const s = http.createServer((req, res) => {
    // Traefik/Go decodifica los caracteres NO reservados (%74 → t, %2D → -) antes de enrutar y deja codificados los reservados (%2F, %5C, %25): el simulador hace lo mismo.
    const ruta = req.url.split('?')[0].replace(/%([0-9a-f]{2})/gi, (m, h) => { const c = String.fromCharCode(parseInt(h, 16)); return /[A-Za-z0-9\-._~]/.test(c) ? c : m; }); vistos.push({ url: req.url, cred: req.headers['x-treidilor-canario'] ?? null });
    if (bloquea && REGLA.test(ruta)) { res.writeHead(403, { 'content-type': 'text/plain' }); return res.end(req.method === 'HEAD' ? undefined : 'Forbidden'); }
    if (ruta === '/healthz') { res.writeHead(caeHealthz ? 503 : 200); return res.end('{"status":"ok"}'); }
    res.writeHead(404, { 'content-type': 'application/json', 'x-powered-by': 'Express' }); res.end('{"code":404,"message":"The requested webhook is not registered."}');
  });
  return new Promise((r) => s.listen(0, '127.0.0.1', () => r({ s, base: `http://127.0.0.1:${s.address().port}` })));
}
const salida = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tai-e3-'));

test('celdas: todas con identificador único, la misma matriz validada (31 variantes × https/http + 5 métodos) y sin credencial por defecto', () => {
  const c = construirCeldas('e3999');
  assert.equal(c.bloqueo.length, 31 * 2 + 5);
  const ids = [...c.bloqueo, ...c.centinelas, ...c.negativos].map((x) => x.ruta.match(/tai=(e3999-\d+)/)[1]);
  assert.equal(new Set(ids).size, ids.length);
});

test('evaluadores: 403 de Traefik OK; 404 de n8n = FUGA; 308 a https aceptado; ruta legítima con 403 Forbidden = sobre-bloqueo', () => {
  assert.equal(evaluarBloqueo({ id: 'a', entrada: 'https', metodo: 'POST' }, { estado: 403, cuerpo: 'Forbidden', cabeceras: {} }).ok, true);
  const f = evaluarBloqueo({ id: 'a', entrada: 'https', metodo: 'POST' }, { estado: 404, cuerpo: '{"message":"not registered"}', cabeceras: {} });
  assert.equal(f.ok, false); assert.equal(f.fuga, true);
  assert.equal(evaluarBloqueo({ id: 'h', entrada: 'http', metodo: 'POST' }, { estado: 308, cuerpo: '', cabeceras: { location: 'https://x/y' } }).ok, true);
  assert.equal(evaluarBloqueo({ id: 'h', entrada: 'http', metodo: 'POST' }, { estado: 308, cuerpo: '', cabeceras: { location: 'http://x/y' } }).ok, false);
  assert.equal(evaluarNegativo({ id: 'n' }, { estado: 403, cuerpo: 'Forbidden' }).ok, false);
  assert.equal(evaluarNegativo({ id: 'n' }, { estado: 404, cuerpo: 'x' }).ok, true);
  assert.equal(esRespuestaTraefik({ cuerpo: 'Forbidden', cabeceras: {} }), true);
  assert.equal(esRespuestaTraefik({ cuerpo: 'Forbidden', cabeceras: { 'x-powered-by': 'Express' } }), false);
});

test('servidor con bloqueo: E3_EXTERIOR_OK, informe escrito, sin credencial enviada y sin secretos en el informe', async () => {
  const vistos = []; const { s, base } = await servidor({ vistos }); const out = salida();
  try {
    const { informe, codigo } = await ejecutar({ host: 'n8n.ejemplo.test', salida: out, base });
    assert.equal(informe.veredicto, 'E3_EXTERIOR_OK', JSON.stringify(informe.fallos.slice(0, 3)));
    assert.equal(codigo, 0); assert.ok(vistos.every((v) => v.cred === null), 'sin --cred-file no se envía ninguna credencial');
    assert.equal(fs.readdirSync(out).length, 1);
  } finally { s.close(); fs.rmSync(out, { recursive: true, force: true }); }
});

test('servidor SIN bloqueo: E3_EXTERIOR_FUGA (código 2) y la lista de fallos lo dice', async () => {
  const { s, base } = await servidor({ bloquea: false });
  try {
    const { informe, codigo } = await ejecutar({ host: 'n8n.ejemplo.test', salida: null, base });
    assert.equal(informe.veredicto, 'E3_EXTERIOR_FUGA'); assert.equal(codigo, 2); assert.ok(informe.resumen.bloqueo.fugas > 0);
  } finally { s.close(); }
});

test('centinela caído (healthz 503): tanda ANULADA (código 3), no se da por buena', async () => {
  const { s, base } = await servidor({ caeHealthz: true });
  try { const { informe, codigo } = await ejecutar({ host: 'n8n.ejemplo.test', salida: null, base }); assert.equal(informe.veredicto, 'E3_EXTERIOR_ANULADA'); assert.equal(codigo, 3); } finally { s.close(); }
});

test('con --cred-file envía la credencial desechable y NO la guarda en el informe', async () => {
  const vistos = []; const { s, base } = await servidor({ vistos }); const out = salida(); const cf = path.join(out, 'cred.txt'); fs.writeFileSync(cf, 'valor-desechable-de-prueba-123456\n');
  try {
    const { informe } = await ejecutar({ host: 'n8n.ejemplo.test', salida: out, credFile: cf, base });
    assert.ok(vistos.some((v) => v.cred === 'valor-desechable-de-prueba-123456'));
    assert.equal(informe.conCredencialDesechable, true);
    for (const f of fs.readdirSync(out).filter((x) => x.endsWith('.json'))) assert.ok(!fs.readFileSync(path.join(out, f), 'utf8').includes('valor-desechable'));
  } finally { s.close(); fs.rmSync(out, { recursive: true, force: true }); }
});

test('evidencia-e3.sh: solo lectura (sin rm de archivos de Traefik, mv, cp, chmod, reinicios) y comprueba huellas', () => {
  const t = fs.readFileSync(new URL('../../dev/prueba-traefik/e2/evidencia-e3.sh', import.meta.url), 'utf8');
  const activo = t.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.ok(!/\b(mv|cp|chmod|chown|tee)\b|docker (service (update|rm|scale)|restart|rm|exec|stop)|systemctl|>\s*"?\$DIR/.test(activo), 'solo lectura');
  assert.ok(/rm -f "\$TMP"/.test(activo)); assert.equal((activo.match(/\brm\b/g) ?? []).length, 1, 'único rm: su temporal');
  assert.match(t, /75703a2ca62f4793203952e4fb4f7729acf23526eb4e8a62a2592a4c96e81746/); assert.match(t, /5a0113d86b3af7fd66afa027d59adb5d714a74c70fa346209f2374db307ab267/);
  assert.ok(!/\r/.test(t));
});
