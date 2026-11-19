// Genera catalogo-precios.sintetico.json (datos FICTICIOS) con el motor existente. Uso:
//   node --experimental-transform-types --import ./scripts/register-ts.mjs automation/director/agentes/precios/generar-fixtures.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cargarMotorPrecios } from './precios.mjs';
import { construirCatalogoPrecios } from './fixtures.mjs';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const motor = await cargarMotorPrecios();
const productos = construirCatalogoPrecios(motor);
fs.writeFileSync(path.join(aqui, 'catalogo-precios.sintetico.json'), `${JSON.stringify({ sintetico: true, nota: 'Catálogo FICTICIO con observaciones de precios para probar el Agente 05; generado con el motor existente. Fechas relativas a 2026-11-14T12:00Z.', productos }, null, 2)}\n`);
console.log(`escrito catalogo-precios.sintetico.json (${productos.length} fichas)`);
