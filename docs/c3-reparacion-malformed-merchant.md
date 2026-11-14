# C3 — Reparación `malformed-merchant` (fichas antiguas con comercio «[object Object]»)

**Estado (14/11/2026): IMPLEMENTADA Y PROBADA SOLO EN LOCAL. No se ha ejecutado ninguna reparación, no se ha tocado ningún dato real y nada está desplegado.** Es independiente de la corrección del importador (`src/lib/amazonImport.ts`, función `rawText`), que solo evita fichas **nuevas** malformadas. Medición de producción comunicada por el propietario: 136 productos, 6 con `merchant` exactamente «[object Object]» (todas de Amazon, 2 vendidas por Amazon y 4 por vendedores externos, con el JSON crudo guardado y sin bloqueos).

## 1. Qué hace (y qué no)
- Repara **únicamente** `merchant === "[object Object]"` (valor exacto; variantes de mayúsculas o espacios se ignoran).
- Cambia **solo** el campo `merchant`; `extra.scraperApiSource`, `fulfillmentProvider`, marca, precios y el resto quedan intactos.
- **No** sustituye a los vendedores externos por «Amazon» y **no inventa** ningún nombre.

## 2. Reglas (en `src/lib/catalogRepair.ts`)
1. **Procedencia Amazon demostrada** (`amazonProvenance`): evidencia positiva (basta una) = `network` explícito `amazon`; URL de afiliado o de compra de Amazon; o `extra.importSource` que empieza por `scraperapi-amazon`. **Cualquier señal contraria anula la reparación:** `network` explícito distinto, URL de otra red (incluidos marcadores de red como `awc=` en dominios no Amazon) o `extra.crossMerchant.networks` con otra red. El ASIN solo no cuenta.
2. **Nombre original** (`recoverVendorName`): `extra.scraperApiSource.seller.name` (objeto) o `seller` como cadena; se normalizan los espacios. No es utilizable (→ solo informe) si falta, está vacío, no es texto, es de nuevo «[object Object]», contiene `<` o `>`, o supera 120 caracteres.
3. **Bloqueos:** `extra.lockedFields` con `merchant` o `extra.fieldSources.merchant = "manual"` → solo informe. Otros campos bloqueados no impiden la reparación.
4. Cada ficha genera un elemento del tipo `malformed-merchant` con su detalle: **parche** `{ merchant: <vendedor> }` solo si todo se cumple; en cualquier otro caso **parche vacío** («solo informe») con el motivo (bloqueada, señales contrarias, sin evidencia positiva, sin nombre original).

## 3. Idempotencia y reversión (mecanismos existentes)
`planRepairs` no muta la entrada; `applyPlan` devuelve una **copia** y el parche inverso; tras reparar, un segundo plan no propone nada; `applyRollback` restaura exactamente la entrada original. Las fichas «solo informe» no se tocan ni entran en el parche inverso.

## 4. Simulación segura sobre una COPIA (script `scripts/repair-catalog.mjs`)
Nunca sobre el `products.json` vivo. Con una copia (`copia.json`):
```sh
# 1) Vista previa: no escribe nada
node --experimental-transform-types --import ./scripts/register-ts.mjs scripts/repair-catalog.mjs copia.json --solo malformed-merchant
# 2) Copia reparada + parche inverso (nunca sobrescribe la entrada)
... copia.json --solo malformed-merchant --out reparado.json --rollback reversion.json
# 3) Comprobar la reversión
... reparado.json --undo reversion.json --out restaurado.json     # restaurado.json debe ser idéntico a copia.json
```
**`--solo malformed-merchant` es imprescindible:** sin él, `--out` aplicaría TAMBIÉN los otros tipos de reparación antiguos (`brand-is-merchant`, `fabricated-rating`). La opción `--solo` es nueva (valida el nombre del tipo y sale con error si no existe). Se esperan **6** elementos con parche: 2 → `Amazon` y 4 → el nombre original de cada vendedor externo.

## 5. Pruebas locales
`scripts/tests/repair-malformed-merchant.test.mjs` (12): las seis fichas con sus vendedores; solo el valor exacto; cada señal positiva por separado; ASIN solo y falta de evidencia; seis tipos de señal contraria; recuperación del nombre y todos los casos sin nombre; bloqueos; que ningún otro campo cambie; idempotencia y reversión; que los demás tipos de reparación no cambien; el script sobre una copia (vista previa sin escritura, `--solo`, `--out`/`--rollback`, `--undo`, entrada intacta); y el flujo del **Agente 04** (`comercio_malformado` detecta las seis antes y ninguna después de la reparación simulada, y sigue detectando una ficha no reparable). Suite completa: 1303 correctas.

**Validación con el catálogo real sin copiarlo entero:** `docs/c3-validacion-copia-real.md` (proyección mínima extraída en solo lectura + `repair-catalog.mjs --c3` con criterios de aceptación; probada solo en local).

## 6. Procedimiento real (cada paso requiere autorización; nada de esto se ha hecho)
1. Copia del `products.json` de producción (no se trabaja sobre el vivo).
2. Vista previa con `--solo malformed-merchant` y comprobar que salen exactamente las 6 fichas con el vendedor esperado.
3. Generar la copia reparada y su reversión; revisar el `diff` (solo `merchant` en 6 fichas) y probar `--undo`.
4. Decisión del propietario de sustituir el original (con copia de seguridad del volumen y la reversión guardada).
5. Verificar con el Agente 04 (el feed no debe contener «[object Object]») y la ficha pública.

## 7. Decisiones pendientes
- `brand` y `fulfillmentProvider` con «[object Object]»: la medición no encontró otros campos malformados, así que no se amplía.
- Para el JSON crudo, la reparación toma solo `seller`; si algún día hiciera falta, `raw.merchant` (que el normalizador antiguo priorizaba) sería una fuente adicional.
