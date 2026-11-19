// Ayudante de pruebas: un PROCESO que añade N eventos a un ledger compartido (para probar el bloqueo entre procesos).
import { LedgerLocal } from '../ledger.mjs';

const [, , dir, prefijo, n] = process.argv;
const l = new LedgerLocal({ dir, raiz: '/__sin_raiz__', limites: { esperaBloqueoMs: 15000 } });
let errores = 0;
const codigos = []; // diagnóstico: qué fallo concreto ocurre (no cambia el comportamiento de la prueba)
for (let i = 0; i < Number(n); i++) {
  try {
    l.anadir({ tipo: 'lectura_estado', actor: 'sistema', datos: { escritor: prefijo, n: i } });
  } catch (e) {
    errores += 1;
    codigos.push(`${(e && (e.codigo || e.code)) || 'desconocido'}: ${(e && e.message) || ''}`.slice(0, 160));
  }
}
process.stdout.write(JSON.stringify({ prefijo, errores, codigos }));
