# C3 — Validación de la reparación `malformed-merchant` con el catálogo real (procedimiento)

**Estado: preparado y probado solo en local con datos sintéticos. No se ha ejecutado contra el catálogo real. Nada se modifica en producción.**
Objetivo: obtener una **simulación verificable** de las seis reparaciones C3 antes de autorizar su aplicación, **sin copiar el catálogo completo**.

## Idea
El código de reparación nuevo (`catalogRepair.ts`) **no está desplegado**, así que no se puede ejecutar en el contenedor de producción; y el `products.json` real puede llevar datos privados en `extra` (JSON crudo de ScraperAPI con teléfonos y direcciones de vendedores, claves, etc.). Por eso:
1. **En el contenedor (solo lectura):** un fragmento de Node extrae una **proyección mínima** (no una copia): de las ~136 fichas solo `id`, `merchant` y `network`; y, **solo de las fichas cuyo comercio es exactamente «[object Object]»**, además lo que el planificador necesita (URLs sin ancla, `importSource`, bloqueos del comercio, `crossMerchant.networks` y **solo el nombre** del vendedor). Nunca descripciones, precios, `extra` completo, credenciales, teléfonos ni direcciones.
2. **En local:** `scripts/repair-catalog.mjs --c3` comprueba la integridad de la proyección, simula **solo** `malformed-merchant` en memoria y evalúa los criterios de aceptación.

La equivalencia (el plan sobre la proyección = el plan sobre las fichas completas) está probada en `scripts/tests/repair-c3-validacion.test.mjs`.

## Criterios de aceptación (todos obligatorios; si falla uno, **DETENER**)
1. El hash SHA-256 de la proyección coincide con el de su cabecera (copiada sin alteraciones) y es una lista JSON válida.
2. El número de productos coincide con el declarado (136).
3. `products.json` **no cambió** durante la extracción (hash antes = hash después).
4. Exactamente **6** fichas con `merchant === "[object Object]"`.
5. Las 6 son reparables (ninguna queda «solo informe»): cada parche es `{ merchant: <texto no vacío> }`.
6. La copia reparada difiere del original **solo en esas 6 fichas y solo en `merchant`**.
7. Ya no queda ningún «[object Object]» tras la reparación simulada.
8. La **reversión restaura el original exacto** (comparación del JSON completo) y un segundo plan no propone nada (idempotente).
Salida: `RESULTADO: ACEPTADA` (código 0) o `RESULTADO: DETENER` (código 1).

## Lo que tienes que hacer (terminal de EasyPanel del servicio de la app; solo lectura)
1. **Antes**, por si quieres comprobarlo tú: `sha256sum /app/data/products.json` (anota la huella).
2. **Pega el fragmento de abajo** (no escribe nada: lee el archivo y escribe en pantalla).
3. Copia **toda la salida** (desde `#C3-PROYECCION` hasta `-----FIN-----`) y pégala en un archivo local, p. ej. `c3-salida.txt` (no hace falta limpiarla; la integridad se comprueba con el hash).
4. **Después**: `sha256sum /app/data/products.json` debe dar la misma huella que antes y que `SHA256_ORIGINAL` de la salida.

```js
node - <<'JS'
// C3-EXTRACTOR v1 (solo lectura)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dir = (process.env.TRADYLOR_DATA_DIR || '/app/data').trim();
const file = path.join(dir, 'products.json');
const hashArchivo = () => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const antes = hashArchivo();
const lista = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!Array.isArray(lista)) { console.log('#ERROR=products.json no es una lista'); process.exit(1); }
const EXACTO = '[object Object]';
const esObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const nombreVendedor = (s) => (typeof s === 'string' ? s : esObj(s) && typeof s.name === 'string' ? s.name : null);
const sinAncla = (u) => (typeof u === 'string' && u.trim() ? u.trim().split('#')[0] : undefined);
const proy = lista.map((p) => {
  const o = { id: String(p.id), merchant: typeof p.merchant === 'string' ? p.merchant : null, network: p.network == null ? null : String(p.network) };
  if (p.merchant === EXACTO) {
    const e = esObj(p.extra) ? p.extra : {};
    o.affiliateUrl = sinAncla(p.affiliateUrl);
    o.buyNowUrl = sinAncla(p.buyNowUrl);
    o.extra = {};
    if (typeof e.importSource === 'string') o.extra.importSource = e.importSource;
    if (Array.isArray(e.lockedFields)) o.extra.lockedFields = e.lockedFields.filter((x) => typeof x === 'string');
    if (esObj(e.fieldSources) && typeof e.fieldSources.merchant === 'string') o.extra.fieldSources = { merchant: e.fieldSources.merchant };
    if (esObj(e.crossMerchant) && Array.isArray(e.crossMerchant.networks)) o.extra.crossMerchant = { networks: e.crossMerchant.networks.map((x) => (x == null ? '' : String(x))) };
    if (esObj(e.scraperApiSource)) o.extra.scraperApiSource = { seller: nombreVendedor(e.scraperApiSource.seller) };
  }
  return o;
});
const bloque = '[\n' + proy.map((x) => JSON.stringify(x)).join(',\n') + '\n]';
const despues = hashArchivo();
console.log('#C3-PROYECCION=1');
console.log('#TOTAL=' + lista.length);
console.log('#MERCHANT_EXACTO=' + proy.filter((x) => x.merchant === EXACTO).length);
console.log('#SHA256_ORIGINAL=' + antes);
console.log('#ORIGINAL_SIN_CAMBIOS=' + (antes === despues ? 'SI' : 'NO'));
console.log('#SHA256_PROYECCION=' + crypto.createHash('sha256').update(bloque).digest('hex'));
console.log('-----JSON-----');
console.log(bloque);
console.log('-----FIN-----');
JS
```

## Lo que hago yo, en local
Con el archivo que me pases (o que ejecutes tú en tu PC, desde la carpeta del proyecto):
```sh
node --experimental-transform-types --import ./scripts/register-ts.mjs scripts/repair-catalog.mjs c3-salida.txt --c3
```
El informe contiene **solo**: total, huella del original, reparto por red, y por cada una de las 6 fichas `id [red]: «antes» → «después»`, más la lista de criterios (`OK` / `FALLA`). No escribe nada. Si `RESULTADO` es `DETENER`, no se avanza.

## Después (solo con autorización aparte; nada de esto se hace aquí)
La aplicación real necesita una vía autorizada (desplegar el código con la reparación y ejecutarla sobre una copia con `--solo malformed-merchant`, o aplicar exclusivamente los seis parches verificados), con copia de seguridad del volumen y la reversión guardada.
