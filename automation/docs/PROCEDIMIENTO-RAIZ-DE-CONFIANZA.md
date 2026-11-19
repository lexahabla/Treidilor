# Procedimiento: creación y custodia de la RAÍZ DE CONFIANZA del propietario (3E.8.15)

**Estado: procedimiento documentado, NO ejecutado.** No existe ninguna raíz ni clave operativa. Todos los ejemplos son sintéticos y se ejecutaron en carpetas temporales (ya eliminadas). Complementa `CONFIANZA-FIRMAS-PAQUETES.md` (modelo y reglas) y `DIRECTOR-1.1.0-INSTALACION.md` (requisitos de despliegue).

## 0. Principios
- Hay **tres** clases de clave y no se mezclan: la **raíz** (firma solo la política; fuera de línea), las **claves de paquete** (firman TAR; una o varias, con validez limitada) y las claves de pruebas (rechazadas en producción). La raíz **no** puede ser clave de paquete (la herramienta lo impide).
- La raíz privada **nunca** está en el VPS, en el repositorio, en `paquetes\`, en `informes\`, en variables de entorno ni en el historial de la shell. Las herramientas rechazan rutas dentro del repositorio, `paquetes\` o `informes\`.
- Lo que se entrega al servidor es la **pública**, el `raizId` (16 hex), la **política** firmada y el **registro**. Lo que se fija **por otro canal** (no en la carpeta de confianza) es el `raizId` y la **versión mínima de política**.

## 1. Preparación del equipo de generación
1. Equipo limpio **sin conexión** (o con red desactivada durante el acto), distinto del VPS y del servidor; sistema actualizado; Node ≥ 22 y OpenSSL.
2. Copiar `confianza-admin.mjs` y `confianza-politica.mjs` desde una copia verificada (comparar SHA-256 con el anotado en el informe de la fase) a una carpeta de trabajo **sin sincronización** (sin nube, sin copia de seguridad automática).
3. Soportes cifrados para la privada (dos), un lugar físico distinto para cada uno.

## 2. Generación de la raíz Ed25519 (operativa)
```
umask 077
openssl genpkey -algorithm ED25519 -out raiz-privada.pem
openssl pkey -in raiz-privada.pem -pubout -out raiz-publica.pem
```
(La orden `confianza-admin generar-raiz` existe **solo** para pruebas y lo dice en su salida; no se usa para claves operativas.) La privada queda con permisos 0600 en el equipo aislado; se cifra (p. ej. con una frase de paso larga guardada aparte) y se copia a los dos soportes. Se borra de cualquier ubicación temporal.

## 3. Identificación de la raíz
El **raizId** (16 hex) lo calcula la herramienta: aparece al iniciar la confianza («raíz `xxxxxxxxxxxxxxxx`») y en `confianza-admin mostrar`. Se anota en papel y se comunica al servidor **por un canal distinto de la carpeta de confianza** (lectura directa, mensaje firmado o impreso). A partir de aquí `TAI_CONFIANZA_RAIZ_ID` lo fija en cada instalación (obligatorio en producción).

## 4. Política inicial firmada y claves de paquete
```
node confianza-admin.mjs iniciar --confianza ./confianza --raiz-publica raiz-publica.pem --raiz-privada raiz-privada.pem --entorno PRODUCCION
# la clave de paquete se genera en el equipo de firma de paquetes (otro equipo/otro usuario); solo su PÚBLICA viaja aquí
node confianza-admin.mjs autorizar --confianza ./confianza --raiz-privada raiz-privada.pem --publica paquete-publica.pem --hasta <ISO, ≤ 12 meses> --nota "firma de Director 1.1.x"
node confianza-admin.mjs mostrar --confianza ./confianza
node verificar-confianza.mjs --confianza ./confianza --modo produccion --raiz-id <raizId> --version-minima <N>
```
Salida de ejemplo (sintética): `Confianza iniciada: política v1, raíz 7fb3cc61ca851572` · `Clave autorizada. Política v2` · `CONFIANZA_OK politica=2 huella=a7a4f0d0187e9aff`. Se entrega al servidor la carpeta de confianza (**sin** la privada) y se copia el registro a un sitio externo.

## 5. Versión mínima fijada y registro independiente
Tras **cada** cambio, el propietario anota la versión de política resultante (`mostrar`) en un registro propio fuera del servidor y la pasa como `TAI_CONFIANZA_VERSION_MINIMA` en las instalaciones y reversiones: es la referencia que impide volver a una política antigua aunque alguien retroceda a la vez política y registro. Conviene guardar además una copia periódica del `registro-confianza.jsonl` y comparar su último evento con el del servidor (el registro no lleva secretos).

## 6. Custodia y recuperación de la raíz
| Situación | Qué hacer |
|---|---|
| Uso normal | Sacar un soporte, trabajar en el equipo aislado, devolverlo; registrar fecha y motivo en el cuaderno de custodia |
| Se estropea un soporte | Restaurar desde el otro y crear una copia nueva; probar el descifrado |
| Simulacro | Una vez al año (y antes de usarla en producción): restaurar en el equipo aislado, firmar una política de pruebas y verificarla |
| **Política o registro perdidos en el servidor** | `confianza-admin recuperar --politica <copia> --version-minima <N> --confirmo <raizId> --motivo "…"` con una copia firmada por la raíz con versión ≥ la mínima que el propietario conoce; nunca baja de la versión del registro íntegro |
| **Raíz privada perdida, sin sospecha de compromiso** | no se puede emitir política nueva con ella: ver §8 (nueva raíz); mientras tanto lo ya instalado sigue funcionando y se puede revertir con la política vigente |

## 7. Revocación y rotación de claves de paquete
- Alta de la nueva → firmar con ella → `revocar --clave-id <id> --motivo "…≥ 10 caracteres"` de la antigua. La revocación es inmediata y **definitiva** (no se reintroduce ni se renueva) y vale también para firmas «anteriores» a ella (la fecha la elige el firmante).
- Después: actualizar la versión mínima anotada, comprobar con `verificar-confianza --solo-clave <id>` (debe fallar la revocada) y reinstalar/revertir solo con paquetes firmados por claves vigentes.
- Si una clave de paquete se compromete: revocar **antes** de nada más; revisar qué paquetes firmó y qué instalaciones los usan.

## 8. Sustitución de una raíz comprometida o perdida (acto manual, no automático)
1. Declarar el incidente; asumir que quien tuvo la privada pudo emitir políticas (mirar el registro y cualquier instalación hecha desde entonces).
2. En un equipo limpio y aislado, generar una **raíz nueva** (§2) y una política inicial nueva con las claves de paquete **estrictamente necesarias** (claves nuevas; no se reutilizan las antiguas).
3. En cada servidor (acceso root del propietario): sustituir `raiz-publica.pem`, `raiz-id.txt`, `politica.json` y `registro-confianza.jsonl`; fijar `TAI_CONFIANZA_RAIZ_ID` con el **nuevo** raizId y anotar la nueva versión mínima. El servidor deja de aceptar cualquier política de la raíz antigua porque el raizId fijado no coincide.
4. Volver a firmar los paquetes que se quieran seguir instalando; los firmados con claves de la raíz antigua dejan de valer (también para revertir, salvo decisión expresa y explícita del propietario).
5. Destruir la privada antigua (o conservarla cifrada como prueba del incidente), documentar fechas y motivos. **No hay cambio de raíz «automático»**: ninguna política puede designar a la siguiente raíz.

## 9. Lista de comprobación antes de dar por creada la raíz
- [ ] Privada solo en los dos soportes cifrados; ninguna copia en el servidor, el repositorio, `paquetes\`, `informes\`, nube o historial.
- [ ] raizId anotado y entregado por canal externo; `TAI_CONFIANZA_RAIZ_ID` fijado en el procedimiento de instalación.
- [ ] Política inicial verificada con `--modo produccion --raiz-id --version-minima`; versión mínima anotada fuera del servidor.
- [ ] Copia del registro fuera del servidor; simulacro de recuperación hecho.
- [ ] Claves de pruebas (3E.8.12–14) ausentes de la política (el verificador las rechaza en producción).
- [ ] Procedimiento de revocación y de sustitución de raíz leído y entendido por quien custodie la clave.
