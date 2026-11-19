# Director 00 · instalación y reversión de 1.1.0 (scripts candidatos, 3E.8.13)

**Estado:** candidatos probados en local con Docker aislado; **no instalados en ningún servidor**. Los originales de `treidilor-ai/director-dist` (`instalar.sh`, `revertir.sh`, `Dockerfile`, `docker-compose.yml`, `VERSION`) **no se han modificado**. Los candidatos viven junto al paquete de pruebas: `TREIDILOR\paquetes\director\candidato-1.1.0-rc2-pruebas\instalacion\` (instalar.sh, revertir.sh, Dockerfile, verificar-firma-paquete.mjs, verificar-arbol-paquete.mjs, VERSION). Para pasarlos a `director-dist` hace falta una decisión y una autorización aparte.

## Contrato de `instalar.sh` (candidato)
`bash instalar.sh <SHA-256 del TAR> [--modo produccion|pruebas]` — entorno: `TAI_DIRECTOR_PAQUETE` (carpeta con `treidilor-director-<v>.tar`, `.sha256` y `.firma.json`; por defecto `./paquete`), `TAI_DIRECTOR_CONFIANZA` (carpeta con `clave-publica.pem` y `clave-id.txt`, **suministradas por el propietario fuera del paquete**; por defecto `$DIR_ESTADO/confianza`), `TAI_DIRECTOR_IMAGEN`, `TAI_DIRECTOR_ESTADO`.
1. **Antes de tocar nada:** modo válido, root (el modo `pruebas` solo existe para imágenes `tai-proto-test-*` y es el único que admite `TAI_INSTALAR_SIN_ROOT=si`), utilidades, SHA-256 y VERSION con formato, archivos del paquete, clave de confianza **fuera del paquete y de la carpeta del script**, directorio de estado escribible, espacio libre (≥ 4×TAR + 50 MB o `TAI_INSTALAR_MIN_LIBRE_MB`), bloqueo con PID.
2. **Copia privada** del paquete y de la clave; de aquí en adelante solo se usa la copia (lo verificado es lo instalado).
3. **Hash** del TAR y de su `.sha256`; **firma Ed25519** del TAR y de su manifiesto con la clave fijada y su claveId, en un contenedor sin red, de solo lectura, sin capacidades. Modo `produccion`: exige entorno de firma `PRODUCCION`, el claveId fijado y **rechaza las claves de pruebas conocidas**.
4. **Estructura del TAR:** primer elemento `MANIFIESTO.json`; solo archivos regulares; sin rutas absolutas, `..`, `\` ni `./`; ≤ 600 elementos.
5. **Extracción en preparación** y comprobación de **cada archivo contra el manifiesto** (nada de más, nada alterado, sin enlaces), formato y versión del manifiesto y punto de entrada.
6. **Build** desde un contexto con solo el Dockerfile, el TAR verificado y el verificador (el Dockerfile vuelve a comprobar el hash y el árbol dentro del build). Etiquetas: `tar-sha256`, `firma-claveid`, `firma-modo`.
7. **Dentro de la imagen:** comprobación de cada archivo contra el manifiesto; prueba de humo sin red (`agentes`); si la imagen trae integridad: `integridad estado` **debe** decir DESACTIVADA e `integridad ejecutar --preparar` **debe** ser denegado.
8. **Activación de etiquetas** al final: lo vigente pasa a `:anterior`, después la versión a `:actual`; registro en `instalaciones.log` (fecha, versión, hash, modo, claveId: sin secretos). Un corte antes del paso 8 deja `:actual` como estaba; el bloqueo huérfano se supera solo.
**Nunca** toca volúmenes, el ledger, el ancla, su copia externa ni la activación; no activa la integridad.

## Contrato de `revertir.sh` (candidato)
Sin argumentos: exige `:anterior`, distinto de `:actual`, con etiqueta de TAR verificado; **vuelve a comprobar** esa imagen (manifiesto dentro de la imagen y humo sin red) antes de activarla; mueve primero `:actual`→`:descartada` y después `:anterior`→`:actual` (un corte no deja `:actual` sin imagen). `retirar` quita imágenes; `retirar --con-ledger` exige `TAI_CONFIRMO_BORRAR_LEDGER=<nombre exacto del volumen>` y que el volumen lleve la etiqueta del Director. Los datos no se tocan: una versión anterior que no conoce la partición de integridad la ignora (no la lee ni la escribe).

## CLI de integridad (contrato operativo)
La ejecución manual **siempre** exige un `MANIFIESTO.json` de CLI válido (formato `treidilor-integridad-cli-tar/1`, contrato `integridad-ejecucion/1`, versión mínima del Director, entrada y SHA-256 de cada archivo, sin archivos de más ni enlaces). Sin CLI, sin manifiesto, incompatible o manipulado ⇒ denegado en las dos etapas sin lanzar nada; `exigirManifiestoCli: false` ya no existe (valor inválido ⇒ configuración inválida ⇒ desactivada). La consulta de estado sigue funcionando mientras la activación sea válida. Con la integridad desactivada, 1.1.0 se comporta como 1.0.0-f2 en sus comandos.

## Modo producción y claves
Las claves generadas en las fases 3E.8.12 y 3E.8.13 son **de pruebas** y sus claveId están en la lista de rechazo del verificador. Para producción: el propietario genera y custodia su propia clave Ed25519, fija su claveId en `clave-id.txt`, firma con `--entorno PRODUCCION` y distribuye la clave pública por un canal distinto del paquete. Rotación y revocación no están diseñadas todavía.

## 3E.8.14 · Scripts v2 con política de confianza (sustituyen la «clave única» del candidato 3E.8.13 en los ensayos)
Ubicación: `TREIDILOR\paquetes\director\confianza-pruebas-3e8-14\instalacion\` (instalar.sh, revertir.sh, Dockerfile, verificar-confianza.mjs, confianza-politica.mjs, verificar-firma-paquete.mjs, verificar-arbol-paquete.mjs, VERSION). El candidato 3E.8.13 y `1.1.0-rc2` no se han modificado. Diferencias: la carpeta `TAI_DIRECTOR_CONFIANZA` contiene **la política** (ver `CONFIANZA-FIRMAS-PAQUETES.md`) y no una clave suelta; `--solo-verificar` hace todas las comprobaciones y se detiene antes de construir/activar; en modo producción son obligatorias `TAI_CONFIANZA_RAIZ_ID` y `TAI_CONFIANZA_VERSION_MINIMA`; `revertir.sh` exige política válida y clave de la imagen anterior aún autorizada; se etiqueta y se registra la versión de política; `TAI_NODE_BIN` (ruta absoluta) permite ejecutar los verificadores sin docker para ensayos en un Linux sin daemon.

### Lista verificable de requisitos antes de una instalación real (sin ejecutar ninguno en esta fase)
| # | Requisito | Cómo se comprueba |
|---|---|---|
| 1 | Clave de la **raíz** generada por el propietario (no de pruebas), custodiada fuera de línea; `raiz-publica.pem` + `raizId` entregados por canal distinto del paquete | `confianza-admin mostrar` y comparación del raizId con el comunicado |
| 2 | Política inicial (`iniciar --entorno PRODUCCION`), alta de la clave de paquete de producción con su validez, y **registro** íntegro | `verificar-confianza --modo produccion` con `--raiz-id` y `--version-minima` |
| 3 | Clave privada de **paquete** de producción custodiada (nunca en el servidor, repositorio, `paquetes\` ni informes); paquetes firmados con `--entorno PRODUCCION` | `firmar-paquete firmar … --entorno PRODUCCION`; el verificador rechaza claves de pruebas |
| 4 | Copia de seguridad cifrada de la raíz privada y de la política/registro, y registro del **número de versión de política** fuera del servidor (referencia independiente) | restauración probada con `recuperar` en un entorno de pruebas |
| 5 | Director: TAR 1.1.0 definitivo firmado; `instalar.sh --solo-verificar` correcto antes de instalar | salida `DIRECTOR_VERIFICACION_COMPLETA` |
| 6 | CLI 0.1.0 (o posterior) en su carpeta con `MANIFIESTO.json` verificable y contrato `integridad-ejecucion/1` | consulta/ejecución manual deniegan si falta o no coincide |
| 7 | Ubicación de datos: ledger, ancla y su copia externa **fuera** de la imagen y en volúmenes/unidades distintos; la instalación y la reversión no los tocan | hashes de los datos antes/después |
| 8 | Docker del host Linux real con root real: ensayo de `instalar.sh` completo (build, etiquetas, humo) y `revertir.sh` | **PENDIENTE** (este entorno solo probó UID 0 en contenedor sin daemon) |
| 9 | Verificación posterior a la instalación: `ayuda` y `agentes` iguales, `integridad estado` = DESACTIVADA, `integridad ejecutar --preparar` = DENEGADA, árbol de la imagen = manifiesto | los incluye `instalar.sh` |
| 10 | Reversión segura: política válida y clave de la imagen anterior autorizada; decisión expresa para imágenes sin firma | `revertir.sh` |
| 11 | Activación **explícita** y posterior: archivo de activación del propietario + código del propietario; nunca por instalar o actualizar | f31–f32 |
| 12 | Rotación/revocación ensayadas con una clave de reserva antes de necesitarlas | f35–f36 |

### Protecciones que dependen de VARIAS capas (3E.8.15) — redundancia intencionada, no relajar
Quitar **una sola** de estas guardas no abre ninguna brecha (por eso las mutaciones individuales «sobreviven»); quitar **todas las de un grupo** sí (hay una prueba que lo demuestra). Si se simplifica una, hay que mantener al menos las demás y repetir esas pruebas.
| Protección | Capas | Qué cubre cada una | Prueba |
|---|---|---|---|
| Confianza del paquete en `instalar.sh` | (1) código de salida del verificador · (2) marcador `CONFIANZA_OK` en su salida · (3) lectura no vacía de versión de política y claveId | (1) falla normal; (2) un verificador que termina con código 0 sin haber verificado (envoltorio, `node` sustituido, caída silenciosa); (3) salida con el marcador pero sin los datos que se registran | f36 «TRES CAPAS DE LA CONFIANZA»: con las tres quitadas pasa una clave revocada |
| Árbol del paquete frente a su manifiesto | (1) árbol extraído, antes del build · (2) dentro del build (Dockerfile) · (3) dentro de la imagen construida | (1) lo detiene antes de gastar recursos; (2) alteración entre la comprobación y el build; (3) lo que realmente quedó en la imagen | f34 «CADA CAPA DE VERIFICACIÓN DEL ÁRBOL» |
| Primer elemento del TAR = `MANIFIESTO.json` | estructura en `instalar.sh` + verificador de firma | el segundo es inevitable: no se puede firmar un TAR con otro orden | f33 «PRIMER ELEMENTO» |
| Reversión: confianza | código de salida + marcador `CONFIANZA_OK` | igual que en la instalación (dos capas, sin la tercera porque no se registra) | f36 (reversión con política inválida) |
| Copia privada de la política | `cp` encadenado con `&&` + el propio verificador exige los cuatro archivos | un fallo de copia deja una carpeta incompleta que el verificador rechaza | f36 «POLÍTICA INVÁLIDA O AUSENTE» |
**Rama no ejercitable sin daemon:** la rama `TAI_NODE_BIN` de `revertir.sh` solo corre tras las comprobaciones de imagen, que necesitan el daemon Docker: queda pendiente de un host Linux real.

## Regla de construcción (obligatoria)
Los artefactos **Director 1.1.0** y **CLI de integridad 0.1.0** se construyen **solo desde clones limpios de commits identificados**, con las reglas LF de `.gitattributes` aplicadas (`automation/** text=auto eol=lf`, `scripts/** text=auto eol=lf`; en el prototipo, `* text=auto eol=lf`):
1. `git clone --no-hardlinks <repositorio> <temporal>` y `git checkout <commit>`; `git status --short` debe estar vacío. Anotar el commit del repositorio web **y** el del prototipo del CLI (commit inicial `5282ee0`).
2. Construir desde el clon: `empaquetar-director.mjs empaquetar --version 1.1.0` y `empaquetar-cli-integridad.mjs empaquetar --version 0.1.0 --prototipo <clon del prototipo>`. **Nunca** desde la carpeta de trabajo: puede conservar CRLF de un checkout anterior y daría otro SHA-256 (comprobado: 299 archivos CRLF dan `4c9d5a73…` en vez de `94844a1a…`).
3. Repetir con `core.autocrlf` verdadero y falso: los SHA-256 deben coincidir. Referencias sin firmar actuales: Director `94844a1a93a62e6fbab0ecba704208496b7acb619b9b8910ad42bd1cc6801fa5`, CLI `ce5866bf7c131defbde20ba380df94b745c17ef3a31a91b7c298dc23aa11f027` (solo cambian si cambia el contenido distribuido; la corrección del mensaje de `firmar-paquete` no los altera: ese archivo no entra en ningún TAR).
4. Registrar commits y SHA-256 junto a la firma; no sobrescribir candidatos históricos.
