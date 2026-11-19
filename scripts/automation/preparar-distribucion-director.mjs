#!/usr/bin/env node
/**
 * Treidilor AI · Agente 00 · PREPARA la distribución PRIVADA del Director (carpeta lista para un repositorio INDEPENDIENTE; no es el repositorio de la web: ningún push a él redespliega nada).
 *   node scripts/automation/preparar-distribucion-director.mjs --tar <treidilor-director-<v>.tar> --salida <carpeta NUEVA fuera del repositorio> [--repo <propietario/nombre>]
 * NO publica, NO hace git, NO toca el VPS ni Docker. Verifica el TAR (manifiesto, rutas, hashes) con su `.sha256` y copia: paquete/, Dockerfile, compose, instalar/revertir/consultar-real.sh, VERSION, .gitattributes, .gitignore y LEEME.md.
 * Imprime el SHA-256 (ancla de confianza que pasa el propietario a `instalar.sh`) y, con `--repo`, la ÚNICA orden que se pega en la consola del VPS (solo curl + tar; sin git; el token de solo lectura se pide sin mostrarse y no se guarda).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectarSecreto } from '../../automation/director/ledger.mjs';
import { RAIZ, leerTar, sha256Hex, verificarTar } from './empaquetar-director.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PLANTILLAS = path.join(RAIZ, 'automation', 'dev', 'director-distribucion');
const IMAGEN = path.join(RAIZ, 'automation', 'dev', 'director-imagen');
const SCRIPTS = ['instalar.sh', 'revertir.sh', 'consultar-real.sh'];
const E2 = path.join(RAIZ, 'automation', 'dev', 'prueba-traefik', 'e2'); // comprobaciones de E3 de solo lectura: viajan en el mismo paquete (sin pegar scripts a mano)
const COPIAS = [[path.join(IMAGEN, 'Dockerfile'), 'Dockerfile'], [path.join(IMAGEN, 'docker-compose.yml'), 'docker-compose.yml'], [path.join(IMAGEN, 'docker-compose.real.yml'), 'docker-compose.real.yml'], [path.join(PLANTILLAS, 'gitattributes.plantilla'), '.gitattributes'], [path.join(PLANTILLAS, 'gitignore.plantilla'), '.gitignore'], ...SCRIPTS.map((s) => [path.join(PLANTILLAS, s), s]), [path.join(E2, 'verificar-canario.sh'), 'verificar-canario.sh'], [path.join(E2, 'evidencia-e3.sh'), 'evidencia-e3.sh']];
const REPO_VALIDO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;

const dentro = (hijo, padre) => { const r = path.relative(path.resolve(padre), path.resolve(hijo)); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };

/** Orden única para la consola del VPS (descarga el tarball del repositorio privado con un token de SOLO LECTURA y ejecuta el instalador con el SHA-256 de la ancla). */
export function ordenVps({ repo, sha256, rama = 'main' }) {
  if (!REPO_VALIDO.test(repo)) throw new Error('--repo debe ser «propietario/nombre» (letras, cifras, «-», «.», «_»).');
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('SHA-256 no válido.');
  return `D=/root/tai-director-dist; ( set -o pipefail; read -rsp 'Token de solo lectura: ' T; echo; rm -rf "$D.nuevo"; mkdir -p "$D.nuevo" && curl -fsSL -H "Authorization: Bearer $T" https://api.github.com/repos/${repo}/tarball/${rama} | tar -xz --strip-components=1 -C "$D.nuevo"; R=$?; unset T; [ $R = 0 ] && bash "$D.nuevo/instalar.sh" ${sha256} && rm -rf "$D" && mv "$D.nuevo" "$D" || echo DIRECTOR_DESCARGA_O_INSTALACION_FALLIDA )`;
}

export function preparar({ tar, salida, repo = null }) {
  if (!tar || !salida) throw new Error('Uso: --tar <archivo.tar> --salida <carpeta nueva fuera del repositorio> [--repo propietario/nombre]');
  if (dentro(salida, RAIZ)) throw new Error('La carpeta de salida debe estar FUERA del repositorio.');
  if (fs.existsSync(salida) && fs.readdirSync(salida).length) throw new Error('La carpeta de salida ya existe y no está vacía: se usa una NUEVA.');
  const buf = fs.readFileSync(tar);
  const shaArchivo = fs.existsSync(`${tar}.sha256`) ? fs.readFileSync(`${tar}.sha256`, 'utf8').trim().split(/\s+/)[0] : null;
  const sha256 = sha256Hex(buf);
  if (!shaArchivo || shaArchivo !== sha256) throw new Error('El TAR no coincide con su .sha256 (o falta el .sha256).');
  const v = verificarTar(buf, sha256);
  if (!v.ok) throw new Error(`El TAR no pasa la verificación: ${v.errores.join('; ')}`);
  if (!/^[0-9A-Za-z._-]{1,40}$/.test(v.version)) throw new Error('Versión del manifiesto no válida.');
  const nombre = `treidilor-director-${v.version}.tar`;
  if (path.basename(tar) !== nombre) throw new Error(`El nombre del TAR debe ser ${nombre}.`);
  // los archivos de texto del TAR no pueden contener credenciales (el empaquetador ya lo comprueba; aquí se repite sobre lo que se va a publicar)
  for (const e of leerTar(buf)) if (/\.(mjs|json|md|txt)$/.test(e.ruta)) { const s = detectarSecreto?.(String(e.contenido)); if (s) throw new Error(`«${e.ruta}» tiene forma de credencial (${s}).`); }
  fs.mkdirSync(path.join(salida, 'paquete'), { recursive: true });
  fs.copyFileSync(tar, path.join(salida, 'paquete', nombre));
  fs.writeFileSync(path.join(salida, 'paquete', `${nombre}.sha256`), `${sha256}  ${nombre}\n`);
  for (const [origen, destino] of COPIAS) {
    const t = fs.readFileSync(origen, 'utf8').replace(/\r\n/g, '\n');
    const s = detectarSecreto?.(t); if (s) throw new Error(`«${destino}» tiene forma de credencial (${s}).`);
    fs.writeFileSync(path.join(salida, destino), t, { mode: destino.endsWith('.sh') ? 0o755 : 0o644 });
  }
  fs.writeFileSync(path.join(salida, 'VERSION'), `${v.version}\n`);
  const orden = repo ? ordenVps({ repo, sha256 }) : null;
  fs.writeFileSync(path.join(salida, 'LEEME.md'), leeme({ version: v.version, sha256, archivos: v.archivos, repo, orden }));
  return { version: v.version, sha256, archivos: v.archivos, orden, salida: path.resolve(salida) };
}

const leeme = ({ version, sha256, archivos, repo, orden }) => `# Treidilor Director 00 · distribución privada (solo lectura)

Repositorio PRIVADO e independiente (no es el de la web: un push aquí no redespliega nada). Contiene el TAR verificado del Director ${version} (${archivos} archivos) y los scripts para instalarlo en el VPS.

- TAR SHA-256 (ancla de confianza; se pasa a \`instalar.sh\`): \`${sha256}\`
- \`instalar.sh <sha256>\`: verifica el TAR contra el SHA-256 que tú indicas, construye la imagen (el build lo comprueba otra vez), prueba de humo sin red y deja la anterior como \`:anterior\` (rollback).
- \`revertir.sh\`: vuelve a la versión anterior; \`revertir.sh retirar [--con-ledger]\` quita las imágenes.
- \`verificar-canario.sh\` y \`evidencia-e3.sh\`: comprobaciones de solo lectura del canario E3 (no forman parte del Director).
- \`consultar-real.sh [token]\`: consulta de solo lectura de los informes de 04 y 12 por la red interna de n8n (sin puertos, sin catálogo, sin L2/L4, sin IA).
${repo ? `\n## Una sola orden en la consola del VPS (root)\n\`\`\`bash\n${orden}\n\`\`\`\nEl token es un token de acceso fino de GitHub con **solo lectura de contenidos de este repositorio**; se pide sin mostrarse, no se guarda y se borra de la variable al terminar.\n` : ''}
## Qué NO contiene
Ningún secreto, credencial, dato de producción, catálogo ni código de la web.
`;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2); const val = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  try {
    const r = preparar({ tar: val('--tar'), salida: val('--salida'), repo: val('--repo') });
    console.log(`Distribución preparada en ${r.salida}\nVersión ${r.version} · ${r.archivos} archivos en el TAR\nSHA-256 (ancla): ${r.sha256}`);
    if (r.orden) console.log(`\nOrden única para la consola del VPS:\n${r.orden}`);
    console.log('\nNO se ha publicado nada. Para publicar (decisión tuya): crear el repositorio PRIVADO, y desde esa carpeta: git init -b main; git add -A; git commit -m "Director <versión>"; git remote add origin <url>; git push -u origin main');
  } catch (e) { console.error(`No se pudo preparar: ${e.message}`); process.exit(1); }
}
