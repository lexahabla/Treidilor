// Genera catalogo.sintetico.json y lote.sintetico.json (datos FICTICIOS) con el motor existente. Uso:
//   node --experimental-transform-types --import ./scripts/register-ts.mjs automation/director/agentes/importador/generar-fixtures.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cargarMotor } from './importador.mjs';
import { LOTE_EJEMPLO, construirCatalogoSintetico } from './fixtures.mjs';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const motor = await cargarMotor();
const catalogo = { sintetico: true, nota: 'Catálogo FICTICIO de referencia para simular importaciones; generado con el motor existente. No es el catálogo de producción.', productos: construirCatalogoSintetico(motor) };
fs.writeFileSync(path.join(aqui, 'catalogo.sintetico.json'), `${JSON.stringify(catalogo, null, 2)}\n`);
fs.writeFileSync(path.join(aqui, 'lote.sintetico.json'), `${JSON.stringify(LOTE_EJEMPLO(), null, 2)}\n`);
console.log(`escritos catalogo.sintetico.json (${catalogo.productos.length} fichas) y lote.sintetico.json`);
