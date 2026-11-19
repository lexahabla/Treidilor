# Director 00 · versión 1.1.0 (futura) — requisitos del distribuible (18/11/2026)

**Estado: solo requisitos.** No se ha generado ningún TAR, no se ha instalado nada y la versión instalada (1.0.0-f2, `director-dist` `f4e5946`) no se ha tocado. Generar el paquete exige autorización específica; desplegarlo, otra aparte.

## 1. Inventario de archivos (árbol de desarrollo frente a 1.0.0-f2)
- **1.0.0-f2:** 81 entradas (80 archivos + `package.json` generado). **Árbol actual:** `empaquetar-director.mjs lista` devuelve 87 archivos (+ `package.json` generado = 88).
- **Nuevos (7), todos en `automation/director/integridad/`:** `ancla.mjs`, `config.mjs`, `consola.mjs`, `copia-ancla.mjs`, `ejecucion.mjs`, `ejecutar-manual.mjs`, `estado.mjs`.
- **Modificados (2):** `automation/director/ledger.mjs` (tres tipos de evento aditivos) y `scripts/automation/director.mjs` (rama `integridad` de consulta, rama `integridad ejecutar` cargada bajo demanda y ruteo del modo interactivo). El resto es idéntico salvo finales de línea (comprobado con normalización CRLF/LF).
- **No viajan:** `tests/` (incluidos `_sintetico.mjs` y `_ensayo-integral.mjs`), documentación, `integridad-activacion*.json` (exclusión explícita en el empaquetador), solicitudes, claves.

## 2. Dependencias
- Solo módulos `node:` (`crypto`, `fs`, `path`, `child_process`, `os`, `url`); sin paquetes npm nuevos y sin red. Todos los imports son relativos y están dentro de `automation/` y `scripts/automation/` (el empaquetador los resuelve y aborta ante uno que no se resuelva).
- **Dependencia externa que NO viaja:** el comando de verificación (`integridad-cli.mjs` del prototipo `treidilor-ai`). La consulta funciona sin él; `integridad ejecutar` necesita su ruta en el bloque `ejecucion.cli`. Decisión pendiente: incluirlo en el paquete (nuevo origen de código en el TAR) o instalarlo aparte con su propio hash. Mientras no se decida, 1.1.0 solo ofrece la consulta útil.
- Node ≥ 22 (el de la imagen actual).

## 3. Manifiesto
`treidilor-director-tar/1` sin cambios: `MANIFIESTO.json` primero, hash por archivo, TAR determinista (orden, fechas y modos fijos), `package.json` mínimo generado. `verificar` sigue rechazando cualquier diferencia. Los 7 módulos nuevos entran por el cierre de imports; no hace falta tocar `ENTRADAS`, `DIRECTORIOS` ni `EXTRAS`.

## 4. Compatibilidad con 1.0.0-f2
- Con la funcionalidad desactivada (estado de fábrica) el comportamiento de la consola es el mismo: la ayuda general no cambia, los comandos previos no cambian y consultar no crea ni toca ficheros. Verificado por pruebas (f31) y en contenedor aislado.
- Los eventos nuevos son aditivos y viven en una **partición propia** (`ledger-integridad.jsonl`, con su ancla y cerrojo), distinta del ledger principal: un ledger escrito por 1.0.0-f2 se lee con 1.1.0 y, al volver a 1.0.0-f2, la partición de integridad queda como archivo inerte que esa versión ni lee ni valida (solo rechazaría *añadir* esos tipos, y no lo hace nadie). Aun así, antes de activar la integridad conviene una copia del ledger (`ledger copia <dir>`).
- Contrato de instalación (`instalar.sh`, `revertir.sh`, `VERSION`, `paquete/*.tar` + `.sha256`) sin cambios: se necesitará `VERSION` = `1.1.0` y el hash que el propietario obtiene en su PC como ancla de confianza.

## 5. Protección de configuraciones
- `integridad-activacion.json` vive en el directorio de datos del Director (volumen del ledger), nunca en la imagen ni en el TAR. Instalar o actualizar **no lo crea, no lo modifica y no lo borra**; sin él todo queda desactivado.
- El código del propietario nunca se guarda (solo su verificador scrypt en la activación) y se pasa por `TAI_INTEGRIDAD_CODIGO`; la clave privada de firma, solo por `TAI_INTEGRIDAD_CLAVE_PRIVADA_ARCHIVO`. Ninguno de los dos se imprime ni se registra.
- Las solicitudes de ejecución (`integridad-solicitud-<id>.json`) guardan solo la huella de la solicitud y caducan a los 5 minutos.

## 6. Procedimiento de instalación (propuesto, sin ejecutar)
1. En el PC: `empaquetar-director.mjs empaquetar --salida <fuera del repositorio> --version 1.1.0` y anotar el SHA-256 (con autorización).
2. Probar el TAR en el ensayo aislado (Docker local, sin red) antes de llevarlo a ningún sitio.
3. Subir al repositorio de distribución (`VERSION`, TAR y `.sha256`) sin sobrescribir 1.0.0-f2.
4. En el servidor: `bash instalar.sh <SHA-256 del PC>` (comprueba hash, rutas del TAR y manifiesto; `:actual` pasa a `:anterior`).
5. Primera verificación de integridad: solo tras una decisión expresa del propietario, sobre una copia del almacén, con la activación creada a mano y el código del propietario.

## 7. Reversión
- `revertir.sh` intercambia `:anterior` y `:actual` sin tocar el volumen del ledger. Para volver a 1.0.0-f2 tras haber activado la integridad: copia previa del ledger y retirada del archivo de activación (basta borrarlo o `TAI_INTEGRIDAD_DESACTIVAR=si`); la partición de integridad queda como archivo inerte (ver §4).
- Sin la activación, volver atrás no requiere ninguna otra acción.

## 8. Verificación de firmas y hashes
Hoy la confianza descansa en el SHA-256 del TAR que el propietario obtiene en su PC y en el hash por archivo del manifiesto; **no hay firma criptográfica del paquete**. Para 1.1.0 se recomienda (decisión pendiente) firmar el SHA-256 del TAR con Ed25519 usando las mismas primitivas de `copia-ancla.mjs`, con la clave privada solo en el PC del propietario y la pública en el servidor; la ausencia de firma no bloquea 1.1.0, pero debe constar.

## 9. Pruebas posteriores a la instalación (a ejecutar contra el contenedor instalado, sin datos reales)
`director.mjs ayuda` y `agentes` iguales a 1.0.0-f2 · `integridad estado` responde «DESACTIVADA (sin configuración)» · `integridad ejecutar --preparar` responde «DENEGADA … desactivada» y no crea ficheros · el volumen del ledger no cambia de contenido tras instalar · `verificar` del manifiesto OK · tamaño y número de archivos esperados (88).

## 10. Actualización 3E.8.12 — candidato de PRUEBAS generado (no es un paquete de producción)
**Estado:** existe un candidato en `TREIDILOR\paquetes\director\candidato-1.1.0-pruebas\`, firmado con una clave Ed25519 **de pruebas**. No se ha desplegado ni instalado en el servidor y no sustituye a 1.0.0-f2 (intacto, SHA-256 `95afd737…`). Las cifras de §1 pasan a ser: **88 archivos autorizados** (+ `package.json` generado = 89); el inventario autorizado queda fijado en `automation/director/tests/inventario-1.1.0.json` (un cambio exige actualizarlo a propósito).

| Artefacto | SHA-256 |
|---|---|
| `treidilor-director-1.1.0.tar` (89 entradas) | `0cd1b212…a4f7b3` |
| `treidilor-integridad-cli-0.1.0.tar` (19 entradas) | `ce5866bf…1f027` |
Hash completo en cada `.sha256` y firma `*.firma.json` (esquema `treidilor-firma-paquete/1`, `entorno: "PRUEBAS"`). Reproducible: reconstruir desde el mismo árbol da el mismo SHA-256.

**Contrato Director ↔ CLI** (`integridad/cli-contrato.mjs`): el CLI vive en `<raiz>/src/integridad-cli.mjs` con `MANIFIESTO.json` (`treidilor-integridad-cli-tar/1`: `contrato` `integridad-ejecucion/1`, `versionCli`, `directorMinimo`, `entrada`, SHA-256 de cada archivo). `VERSION_DIRECTOR` = 1.1.0 (versión del conjunto de integridad). Sin CLI → «comando_inexistente»; sin manifiesto → permitido solo si la activación no pone `exigirManifiestoCli: true` (en un paquete instalado debe ponerse); contrato distinto, versión mínima superior, entrada distinta, archivo alterado, ausente o de más → denegado en ambas etapas, sin lanzar nada. Integridad desactivada → consultas informan «desactivada» y `ejecutar` se deniega sin tocar datos. El CLI empaquetado es el cierre de imports del prototipo (18 archivos, copiados byte a byte, sin `autorizacionTest.mjs`, simulación, pruebas ni datos); no se modificó ninguna interfaz del prototipo.
**Compatibilidad:** Director 1.1.0 ↔ CLI ≥ 0.1.0 con el mismo contrato de salida; un CLI futuro con contrato `/2` exigirá un Director que lo declare. Con 1.0.0-f2 (que no conoce la integridad) no hay interacción.

**Cadena de confianza (de pruebas):** la firma vincula el SHA-256 del TAR y el del manifiesto (hash de cada archivo) a la clave pública `clave-publica-PRUEBAS.pem` (claveId `28bb645f9d53d165`); se verifica en un proceso independiente (`verificar-firma-paquete.mjs`, solo `node:`). **No acredita quién es el firmante** ni cómo llegó la clave pública (aquí, la misma carpeta): para producción hace falta una clave nueva generada y custodiada por el propietario, distribuida por un canal distinto del paquete, y procedimiento de rotación y revocación. La clave privada de pruebas se guardó fuera de repositorios, paquetes e informes y se destruyó al cerrar la fase.
**Instalador de ensayo** (`scripts/automation/instalar-paquete-ensayo.mjs`): verifica firma (proceso independiente), SHA-256 y manifiesto, extrae a `versiones/<v>` sin sobrescribir y mueve `actual`/`anterior`; `revertir` los intercambia. No sustituye a `instalar.sh` (que construye la imagen Docker del servidor y NO se ejecutó).

## 11. Actualización 3E.8.13 — candidato rc2 y scripts de instalación
El candidato de 3E.8.12 (`candidato-1.1.0-pruebas`, SHA-256 `0cd1b212…`) queda **superado**: contenía una ejecución manual que aceptaba un CLI sin manifiesto si la activación no lo exigía. Sustituto de pruebas: `TREIDILOR\paquetes\director\candidato-1.1.0-rc2-pruebas\` — `treidilor-director-1.1.0-rc2.tar` (SHA-256 `8dacad109eb77a5d6f3e9cda44429ddcea1f6587a8719cfa69ad0456a463bc05`, 89 entradas) y el CLI 0.1.0 (sin cambios, `ce5866bf…`), firmados con una clave **nueva de pruebas** (claveId `3f16a232123fa7e6`, privada destruida) y, en `instalacion\`, los scripts candidatos. El historial de la carpeta anterior se conserva. Contrato de instalación y reversión: `DIRECTOR-1.1.0-INSTALACION.md`. Cambios de comportamiento del Director desde 3E.8.12: el manifiesto del CLI es siempre obligatorio para ejecutar y `exigirManifiestoCli: false` ya no es válido.

## 12. Actualización 3E.8.14 — confianza con raíz independiente
La confianza de las firmas ya no es una clave suelta fijada junto al instalador sino una **política firmada por una raíz del propietario** (rotación, revocación, caducidad, versión monotónica y registro). `1.1.0-rc2` y sus firmas **no cambian**. Diseño, reglas y límites: `CONFIANZA-FIRMAS-PAQUETES.md`; scripts v2 y lista verificable de requisitos de despliegue: `DIRECTOR-1.1.0-INSTALACION.md` (sección 3E.8.14).

## 13. Actualización post-3E.8.15 — el hash del paquete NO debe depender del fin de línea del equipo
Hallazgo de la validación en un **clon Git real** (con `core.autocrlf=true`, como el equipo del propietario): reconstruir el Director desde lo commiteado daba un SHA-256 distinto según `core.autocrlf` (`4142fa0c…` con `true`, `757acdb1…` con `false`) y distinto del de `1.1.0-rc2` (`8dacad10…`, construido sobre un árbol de trabajo con fines de línea mixtos: 21 de los 88 archivos tenían CRLF). Causa: el empaquetador lee los bytes del árbol de trabajo. Corrección aplicada en `.gitattributes` (aditiva): `automation/** text=auto eol=lf` y `scripts/** text=auto eol=lf`. Verificado en un clon aislado: con las reglas, el paquete sale **idéntico (`757acdb1850f506c…`) con `autocrlf` verdadero o falso** y las pruebas dependientes de bytes (f28 y Traefik, antes 10 fallos) pasan 60/60. **Consecuencia:** `1.1.0-rc2` es un candidato de pruebas **no reproducible desde el repositorio**; el candidato definitivo debe construirse desde un clon con estas reglas (hash esperado del árbol actual: el de la reconstrucción, a confirmar al generarlo) y firmarse entonces. No se ha generado ningún paquete nuevo ni se ha tocado `1.1.0-rc2`.
