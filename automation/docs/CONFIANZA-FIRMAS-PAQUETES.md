# Confianza de firmas de paquetes del Director: raíz, política, rotación y revocación (3E.8.14)

**Estado:** implementado y probado en local con claves **sintéticas**. No hay ninguna clave operativa, ni se ha tocado `director-dist`, el VPS ni el candidato `1.1.0-rc2` (ni sus firmas). Los scripts de instalación v2 están en `TREIDILOR\paquetes\director\confianza-pruebas-3e8-14\instalacion\`.

## Modelo
| Pieza | Qué es | Quién la controla |
|---|---|---|
| **Raíz de confianza** | clave Ed25519 del propietario, fuera de línea; su clave pública y su `raizId` se **fijan por otro canal** | propietario |
| **Política** (`politica.json`) | lista firmada **por la raíz**: claves de paquete (`claveId`, clave pública, `autorizada`/`revocada`, `validaDesde`, `validaHasta`, `revocadaEn`, motivo), `version` entera creciente, `previa` (versión y huella de la anterior), `entorno` | la raíz |
| **Claves de paquete** | firman TAR; **no pueden firmar ni cambiar la política** | propietario / quien empaqueta |
| **Registro** (`registro-confianza.jsonl`) | cadena de eventos con hash (inicio, alta, revocación, renovación, anotación, recuperación), **sin secretos** | administración de confianza |
La política vive **fuera de los paquetes** (carpeta de confianza `TAI_DIRECTOR_CONFIANZA`: `raiz-publica.pem`, `raiz-id.txt`, `politica.json`, `registro-confianza.jsonl`). Una clave de paquete comprometida no puede borrar su propia revocación: el archivo de revocaciones **no lo firma ella** sino la raíz.

## Reglas de verificación (`verificar-confianza.mjs`, solo `node:`)
1. Política ausente, ilegible, sin firma, firmada por otra clave, con estructura inválida, con claves cuyo claveId no corresponde a su clave pública, con la cadena `previa` rota o con otra raíz declarada ⇒ **no se confía en nada** (no se instala por defecto).
2. Registro ausente, vacío o con la cadena rota (evento editado, borrado, reordenado, seq/versión/huella incorrectas) ⇒ no se confía.
3. **Monotonía:** política más antigua que el último evento del registro ⇒ rechazada; misma versión con otra huella ⇒ rechazada; hueco o cadena distinta ⇒ rechazada; una versión nueva aún sin anotar en el registro (corte entre ambos pasos) ⇒ aceptada como «pendiente de anotar» y completable con `anotar-pendiente`. **Referencia independiente** `--version-minima` (la conoce el propietario por otra vía): rechaza una política más antigua aunque estén retrocedidos a la vez política y registro. En producción es obligatoria, igual que `--raiz-id` (fijar la raíz fuera de la carpeta).
4. Clave del paquete: debe constar, estar `autorizada` y vigente (`validaDesde ≤ ahora < validaHasta`). **Una clave revocada se rechaza siempre**, también para firmas «anteriores a la revocación» (la fecha la elige el firmante). Clave desconocida, caducada o aún no vigente ⇒ rechazo.
5. Modo producción: política y firma de entorno `PRODUCCION`, raíz y versión mínima fijadas, y rechazo de las claves de pruebas conocidas (incluida la reversión).
6. La firma del paquete se verifica con la clave **que la política autoriza** (no con una clave suministrada junto al paquete).

## Administración (`confianza-admin.mjs`, acto del propietario fuera de línea)
`generar-raiz` (solo pruebas) · `iniciar` · `autorizar` (alta con periodo de validez) · `revocar` (motivo ≥ 10 caracteres) · `renovar` (solo amplía; una revocada no se renueva; no se reintroduce una clave ya conocida) · `mostrar` (sin claves públicas completas) · `anotar-pendiente` · `recuperar`. Cada cambio escribe la política nueva (tmp + renombrado) y **después** anota el registro. La clave privada de la raíz se rechaza si está en el repositorio, `paquetes\` o `informes\` y nunca se imprime ni se guarda en la carpeta de confianza.

## Rotación
Alta de la clave nueva (política v+1) → firmar con ella → revocar la antigua (política v+2). Lo firmado con la antigua deja de valer; lo instalado no cambia (reinstalarlo exige volver a firmarlo con una clave vigente).

## Recuperación controlada
`recuperar` restaura una política perdida/corrupta o reconstruye un registro perdido **solo** con: copia firmada por la raíz, `--version-minima` declarada por el propietario (la copia no puede ser inferior), `--confirmo <raizId>` exacto, motivo y que la copia no sea más antigua que un registro íntegro. Queda un evento `recuperacion`. **La raíz no se recupera**: si se pierde la clave privada de la raíz hay que fijar otra por el canal externo (cambio de raíz = acto manual, no diseñado como automático).

## Instalación y reversión con política (scripts v2)
`instalar.sh <sha256> [--modo produccion|pruebas] [--solo-verificar]` exige la política antes de nada; `revertir.sh` **también** exige una política válida y que la clave con la que se instaló la imagen anterior siga autorizada (una imagen sin etiqueta de firma solo se acepta con `TAI_REVERTIR_ACEPTA_SIN_FIRMA=si`, decisión expresa). Ver `DIRECTOR-1.1.0-INSTALACION.md`.

## Límites reales (no se presentan como solucionados)
- Quien pueda reescribir **a la vez** política, registro, raíz y `raiz-id.txt` sustituye la confianza entera; solo lo impiden `--raiz-id` y `--version-minima` obtenidos por otro canal. Sin ellos, la prueba correspondiente documenta que pasa.
- Root dentro de un contenedor no equivale a root en el VPS; el daemon Docker del host no se ha ejercitado en Linux (ver el informe).
- Sin segundo factor ni custodia hardware de la raíz; sin rotación de la propia raíz.
- Las firmas de las fases 3E.8.12–13 son de pruebas y sus claveId están en la lista de rechazo del modo producción.
