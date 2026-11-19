# Imagen del Director 00 (L0, solo lectura) — construida y probada en local; sin desplegar

**Estado (17/11/2026):** imagen `treidilor-director:1.0.0-f1` CONSTRUIDA y probada en local (TAR SHA-256 `f2cacbea4fcda78196baa5570cbfa5e8683be7b69c4b9530ea32245b5c2f98f6`, 80 archivos; sin red, solo lectura). No hay despliegue, no hay conexión con producción, PostgreSQL, API reales ni proveedor LLM comercial. Todo lo de aquí es **provisional** hasta que el propietario apruebe D-2, D-3, D-4, D3 y D6.

## Qué contiene
| Archivo | Función |
|---|---|
| `../../../scripts/automation/empaquetar-director.mjs` | Empaqueta (`empaquetar`), lista (`lista`) y verifica (`verificar`) el TAR determinista con `MANIFIESTO.json` y SHA-256 |
| `Dockerfile` | Construye la imagen SOLO desde el TAR (comprueba el hash dentro del build) y hace un arranque de humo (`ayuda`, `agentes`) |
| `docker-compose.yml` | Perfil `cli` (nunca `up`), sin red, sistema de ficheros de solo lectura, sin capacidades, un único volumen para el ledger |

## Procedimiento previsto (cuando se autorice, en este orden)
1. `node scripts/automation/empaquetar-director.mjs empaquetar --salida <dir fuera del repositorio>` → TAR + `.sha256`. Falla si algo con forma de credencial entra en el paquete o si un import queda fuera de lo permitido.
2. `node scripts/automation/empaquetar-director.mjs verificar <tar> <sha256>` en otra sesión (comparación del hash con el anotado).
3. Copiar `Dockerfile` y el TAR a un directorio vacío y `docker build … --build-arg TAR_SHA256=…` (ver cabecera del Dockerfile). El build falla si el hash no coincide o si el arranque de humo falla.
4. `docker compose run --rm director agentes` y `informe 04 --comparar` / `informe 12 --comparar` sobre los fixtures sintéticos.

## Qué ofrece y qué no
- Ofrece: lectura de informes de los Agentes 04 y 12, comparación entre informes, registro de agentes y capacidades, ledger de operaciones (cada consulta crea su tarea con traza), canal de texto y cerebro **simulado**.
- No ofrece (a propósito): los motores de los Agentes 03 y 05–11 (cargan módulos de `src/lib` de la web, que no entra en la imagen), la batería `evaluar` (necesita `automation/workflows`) ni ninguna operación que modifique el catálogo o la web.

## Limitaciones conocidas
- No se ha ejecutado `empaquetar` contra el árbol real: la primera ejecución puede avisar de un import fuera de lo permitido (se falla en voz alta, no se omite).
- El ledger exige que su carpeta no esté dentro del repositorio; en la imagen es `/var/lib/tai-director` y el «repositorio» es `/opt/tai`.

## Modo lector real (17/11/2026; implementado y probado en local con un n8n falso; NO conectado a producción)
`--lector real` (explícito en cada orden) + `TAI_DIRECTOR_LECTOR_REAL=si` + URL interna + hosts + credencial por archivo (`docker-compose.real.yml`). Por defecto: sintético. Código en `automation/director/puente/lector-real.mjs`, pruebas `f26-consola-lector-real.test.mjs`, procedimiento en `automation/docs/E3-CANARIO-Y-CONEXION-DIRECTOR.md`. Imagen actual `treidilor-director:1.0.0-f2` (TAR SHA-256 `95afd73764f00c247fe03736e432bcb2ced7f9d71c92a1a3c2b131d0df86bf9a`, 81 archivos).
