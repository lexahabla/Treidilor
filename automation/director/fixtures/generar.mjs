// Regenera los fixtures sintéticos 04.json y 12.json de esta carpeta (determinista). Uso: node automation/director/fixtures/generar.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixturesPorDefecto } from './construir.mjs';

const aqui = path.dirname(fileURLToPath(import.meta.url));
for (const [agente, datos] of Object.entries(fixturesPorDefecto())) {
  fs.writeFileSync(path.join(aqui, `${agente}.json`), `${JSON.stringify(datos, null, 2)}\n`, 'utf8');
  console.log(`escrito ${agente}.json (${datos.filas.length} filas, sintético)`);
}
