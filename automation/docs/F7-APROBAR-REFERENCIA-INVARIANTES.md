# F7 — Clave de root, `authorized_keys` reescrito por el proveedor y referencia de invariantes (14/11/2026)

**Estado (14/11/2026): la nueva referencia fue aprobada en el VPS (`REFERENCIA_APROBADA_Y_VERIFICADA`; original conservada en `invariantes-base.original-b6844f77fc79.txt`) y F7 quedó cerrada (`F7-CIERRE-INFORME.md`). Después, el hash de `authorized_keys` dejó de compararse y se verifica la clave por huella, de modo que una reescritura con la misma clave ya no exige aprobar otra referencia.**

## Hechos (según la investigación forense del propietario) y límites
- El cierre se rechazó solo porque cambió el SHA-256 de `/root/.ssh/authorized_keys` (`b6844f77…9757` → `41bf9b3a…3ad1d`). El cambio es anterior a la activación.
- El archivo actual tiene **una** clave ED25519, `SHA256:zzEk73jAM3o9yO0f7uBlYhu2gZhxRWbpTrL0RzKIlfE` = `~/.ssh/id_ed25519.pub` del PC del propietario (accesos desde `176.84.216.197`).
- Siete claves RSA distintas accedieron **una vez cada una desde `169.254.0.1`** (dirección link-local: no enrutable desde Internet); el último acceso fue el 14/11 a las 15:36:33 UTC y el archivo se recreó a las 15:37:32 UTC. Patrón **compatible** con claves temporales de una consola de administración (posiblemente la de Hostinger); **no confirmado por el proveedor**. No hay accesos de root por otros métodos.

## Decisión técnica
El control de invariantes **no puede basarse en el hash de un archivo que el proveedor puede reescribir**, pero tampoco se desactiva. Se separan tres controles, todos más estrictos o iguales que antes:
1. **Identidad por huella, no por hash.** El archivo solo se verifica si tiene exactamente **una** clave ED25519, sin opciones, `root:root 600`, con la huella del propietario. Una reescritura con la misma clave (otro comentario, otro orden) sigue verificándose; una clave distinta, una segunda clave o una opción (`command=`…) **nunca**.
2. **La referencia de invariantes solo se actualiza con aprobación explícita y atada al hash revisado** (`APRUEBO=SI SHA_APROBADO=<hash que mostró verificar>`), conservando la original (`invariantes-base.original-<sha12>.txt` + `.sha256`, nunca se sobrescribe), con `diff` exactamente igual a la línea de `authorized_keys` y acta. Ya no hay hashes fijos en el script: sirve para la próxima reescritura sin editar código.
3. **Vigilancia de accesos desconocidos, más fuerte.**
   - `verificar`: cualquier acceso de root con una huella desconocida **bloquea**, salvo que se haya **clasificado** (`clasificar`) como temporal de consola. Clasificar **no autoriza** la clave: solo registra un acceso antiguo y exige un único origen link-local `169.254.x.x`, una sola vez, una huella que NO esté ahora en `authorized_keys` y ningún acceso de root por otro método. Si una huella clasificada se reutiliza, cambia de origen o aparece una nueva, vuelve a bloquear.
   - `f7-vps.sh cerrar`: desde el instante de activación **solo** se admiten accesos de root con la clave del propietario; cualquier otra huella u otro método bloquea el cierre y revierte.
   - `f7-vps.sh preparar/activar`: comprueban los **invariantes antes de armar nada**, para detectar una reescritura transitoria del proveedor con la ventana aún cerrada.

## Archivos
Los SHA-256 vigentes están en la respuesta de la sesión y en `F7-CIERRE-AUTOMATIZADO.md`; los bloques de pegado (`F7-VPS-pegar.txt`, `F7-REFERENCIA-pegar.txt`) se regeneran con `python automation/scripts/f7-generar-pegado.py` y comprueban el SHA-256 antes de instalar (root, 0700). Pruebas: `test_f7_referencia.py` (45) y `test_f7_cierre.py` (62).

## Procedimiento
1. **Reinstalar los dos scripts** (consola A; Windows: `Get-Content -Raw -LiteralPath "<ruta>\F7-REFERENCIA-pegar.txt" | Set-Clipboard`, pegar; igual con `F7-VPS-pegar.txt`). Cada uno debe terminar en `F7_SCRIPT_INSTALADO_OK <huella>`.
2. `sh /root/tai-etapa2/f7-referencia.sh verificar` → `CLAVE_ROOT_NO_VERIFICADA` con las 7 huellas como «NO clasificada» (esperado).
3. `APRUEBO=SI sh /root/tai-etapa2/f7-referencia.sh clasificar` → «CLASIFICADAS (como temporales de consola; NO autorizadas)». Se niega si alguna no cumple las condiciones.
4. `sh /root/tai-etapa2/f7-referencia.sh verificar` → `CLAVE_ROOT_VERIFICADA` y `SHA_PARA_APROBAR=<hash>`; debe ser `41bf9b3a…3ad1d` (el revisado).
5. `APRUEBO=SI SHA_APROBADO=<ese hash> sh /root/tai-etapa2/f7-referencia.sh aprobar` → `REFERENCIA_APROBADA_Y_VERIFICADA`.
6. F7 de nuevo: `consola-b`, `preparar`, `activar`, script de Windows, `cerrar`.

## Riesgo residual (documentado, no eliminado)
`clasificar` descansa en que `169.254.0.1` es un origen link-local (solo alcanzable desde el mismo segmento de red virtual). Eso no prueba que sea Hostinger: un atacante en ese segmento o un compromiso del proveedor tendría el mismo origen. Por eso las siete claves quedan **registradas, no autorizadas**, la vigilancia durante la activación es estricta y la confirmación del proveedor sigue pendiente (preguntar a Hostinger si su consola web autoriza claves temporales por sesión).
