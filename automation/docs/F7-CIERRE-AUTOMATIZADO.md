# F7 — Activación y cierre automatizados (versión simplificada; 14/11/2026)

**Estado: F7 EJECUTADA Y CERRADA en el VPS (14/11/2026, `F7_CERRADO_OK`, comunicado por el propietario; ver `F7-CIERRE-INFORME.md`). Este documento queda como procedimiento de referencia (probado además en local con programas simulados).**
Sustituye al manejo manual de los Pasos 1–5 del plan (`INSPECCION-ETAPA-2-PLAN.md`); el plan sigue siendo la referencia de las comprobaciones y de la reversión.
No se modifica ninguna restricción SSH, ni `tai-gate`, ni los colectores, ni la plantilla `00-tai-inspect.conf`.

## Por qué
En el último intento todo era correcto (20 pruebas, V13–V15, invariantes) pero la ventana de 10 minutos se agotó porque el cierre eran ~12 comandos manuales y el acceso administrativo independiente se abrió **dentro** de la ventana. Ahora el acceso administrativo se prepara **antes**, y dentro de la ventana solo hay **tres acciones**.

## Archivos (todos locales; nada se despliega solo)
| Archivo | Función |
|---|---|
| `automation/scripts/f7-vps.sh` | Script de la consola (root): `consola-b`, `preparar`, `activar`, `cerrar`, `revertir`, `estado`. SHA-256 `9a621654612e60679c1a11358d04862c730e119817cf78bfed6d5ebe2e22bbe2` |
| `automation/scripts/F7-VPS-pegar.txt` | Bloque para **pegar** en la consola de Hostinger: escribe `f7-vps.sh` en `/root/tai-etapa2` solo si su SHA-256 coincide con el de arriba (permisos root 0700; si no coincide lo descarta). Se regenera con `python automation/scripts/f7-generar-pegado.py` |
| `automation/scripts/F7-Validacion-Windows.ps1` | Script de Windows (V0–V8 sin cambios, más V7-admin opcional y la línea de resultado firmada). SHA-256 `bd6a7fae671972159e9e7a5a509be8440118257f3f64fa78632f527601b7a46e` |

## Instrucciones mínimas

### Antes de la ventana (sin prisa; nada de esto arma el temporizador)
1. **Windows:** `ssh-add -t 4h "$env:USERPROFILE\.ssh\tai-inspect_ed25519"` (y comprobar `ssh-add -l`).
2. **Consola A de Hostinger** (pestaña 1): abrir `F7-VPS-pegar.txt`, copiar **todo** y pegarlo. Debe terminar con `F7_SCRIPT_INSTALADO_OK <huella>` (el propio bloque compara el SHA-256 y descarta el script si no coincide: `F7_SCRIPT_CORRUPTO_NO_USAR` = **no continuar**). Huella esperada: `9a621654612e60679c1a11358d04862c730e119817cf78bfed6d5ebe2e22bbe2`.
3. **Consola B de Hostinger** (pestaña 2, **independiente** y que se deja **abierta** hasta el final): `sh /root/tai-etapa2/f7-vps.sh consola-b` → `CONSOLA_B_REGISTRADA`.
4. **Consola A:** `sh /root/tai-etapa2/f7-vps.sh preparar` → debe decir `F7_PREPARADO`. Comprueba lo que antes eran los Pasos 0 y el limitador (si `host-actualizaciones` se aceptó hace menos de 300 s, dice cuánto esperar, para que V8 no quede pendiente).

### En la ventana (tres acciones)
1. **Consola A:** `sh /root/tai-etapa2/f7-vps.sh activar`. Coloca y valida el archivo de `sshd` (antiguo Paso 1), arma **un único** temporizador de 10 min, comprueba precisión y vencimiento (Paso 2), recarga SSH (Paso 3) e imprime **una línea de PowerShell ya completa** (con `-VenceUtc`, `-IdActivacion`, `-SecretoActivacion`).
2. **Windows PowerShell 5.1:** pegar esa línea. Al terminar imprime `sh /root/tai-etapa2/f7-vps.sh cerrar 'F7R1 …'` (también si algo falló).
   - Opcional: añadir `-AliasAdmin '<alias SSH del administrador por clave>'` para que además se pruebe automáticamente que el acceso de administrador por SSH sigue entrando.
3. **Consola A (o B):** pegar esa orden `cerrar`. Resultado esperado: `F7_CERRADO_OK`.

Después, solo desde el PC: `https://treidilor.com/api/health` con `status=ok` y el mismo `sourceHash` (CP5).

### Si algo falla
No hay nada que decidir ni que re-armar: `cerrar` **revierte con seguridad** por sí mismo si cualquier condición falla (`F7_REVERTIDO`), y si nadie interviene la reversión automática de 10 min hace lo mismo. Cambiar de idea: `sh /root/tai-etapa2/f7-vps.sh revertir`. Estado: `... estado`. Para repetir F7: desde «Antes de la ventana», con una activación **nueva**.
Un error de **formato** al pegar la línea (`F7_ENTRADA_INVALIDA`) no cancela ni revierte: se vuelve a copiar entera mientras quede tiempo.

## Condiciones EXACTAS para cancelar el temporizador (todas obligatorias; `cerrar` las evalúa todas)
1. Existe una activación `ACTIVA` creada por **esta** ejecución de `activar` y el `id` de la línea es el suyo.
2. La firma **HMAC-SHA256** de la línea es válida con la **clave de esa activación** (clave aleatoria de un solo uso, impresa por `activar`, destruida al cerrar/revertir). Un resultado de otra activación no coincide en id, clave ni vencimiento.
3. `veredicto = AUTOMATICAS_OK`, `ko = 0`, `pend = 0`, `abortado = 0`, `fuera = 0` y **≥ 20** pruebas correctas; `admin ≠ FALLA`.
4. El `vence` de la línea es el de la activación; el temporizador está `active`/`waiting`, es **la misma instancia** que armó esta activación (`ActiveEnterTimestampMonotonic`), el servicio de reversión no está en marcha y quedan **≥ 90 s** verificables al empezar la evaluación (y ≥ 20 s justo antes de parar; los controles deben terminar en ≤ 45 s) (el menor de la hora calculada y la de systemd).
5. El archivo de `sshd` sigue colocado con la huella aprobada, `sshd -t` pasa y la configuración efectiva de `tai-inspect` es la esperada.
6. **Invariantes** idénticos a la línea base, **salvo el hash de `authorized_keys`** (el proveedor puede reescribirlo): su identidad se comprueba por **huella** (una única clave ED25519, huella del propietario, sin opciones, `root:root 600`); una clave añadida o sustituida, una opción o un permiso distinto bloquea. Se aplica igual en `preparar`, `activar`, `cerrar` (antes y después de cancelar) y en la reversión; no hace falta aprobar una nueva referencia por una reescritura con la misma clave.
7. **Consola B**: registrada **antes** de `activar`, distinta de la consola de activación y **viva** (mismo PID y mismo instante de arranque).
8. **V13, V14, V15** automatizados: sin permisos de escritura/lectura indebidos, sin `sudo` ni más grupos, y registro del gate con `seq` correlativo y journald con registros.
9. **Vigilancia de accesos de root durante la activación** (nuevo, 14/11/2026): en el registro de `sshd`, desde el instante de activación, solo se admiten accesos de root con la clave del propietario (`SHA256:zzEk73…`); cualquier otra huella o cualquier otro método (contraseña…) bloquea el cierre y revierte. Las claves temporales de una consola que se hayan usado ANTES de activar no cuentan; una consola que se abra o reconecte DENTRO de la ventana bloquea (y se repite).
10. **Corroboración independiente** en el registro del gate desde `T0`: peticiones aceptadas de `host-recursos` (≥ 2), `host-red`, `host-servicios`, `host-tiempo` y `host-actualizaciones`, con `seq` sin huecos.
11. Antes de parar el temporizador se vuelve a comprobar el margen; tras pararlo se verifica que no queda ni temporizador ni servicio y que los invariantes siguen iguales; si cualquiera de esas comprobaciones falla, se revierte.

Si **cualquiera** falla: no se cancela y se ejecuta la reversión segura (`revertir.sh`; el temporizador solo se detiene si termina con `rc=0`; si falla, el temporizador **se conserva** y la activación queda `REVERSION_FALLIDA`, que ya no puede cerrarse).
`preparar` y `activar` comprueban además, **antes de armar nada**, que los **invariantes coinciden con la referencia** (si el proveedor reescribe `authorized_keys` al abrir una consola, se detecta aquí, con la ventana aún sin abrir: esperar unos minutos y repetir `preparar`). `activar` además se **niega** (sin tocar nada) si: falta la consola B o es la misma, hay una activación anterior sin resolver, el archivo de `sshd` ya está colocado, el temporizador ya existe, `revertir.sh` o la plantilla no tienen la huella aprobada, `host-actualizaciones` se aceptó hace menos de 300 s o ya hay más de 30 peticiones aceptadas hoy.

## Qué hace y qué no hace cada script
- **No** edita `sshd_config` ni otros archivos de `sshd_config.d`, claves, usuarios, firewall ni Docker; solo coloca/retira **su** archivo (`00-tai-inspect.conf`, con comprobación de huella), arma/para **su** temporizador y recarga (`reload`, nunca `restart`) SSH.
- **Nunca re-arma**: hay un solo `systemd-run`. `systemctl stop tai-reversion.timer` aparece en **dos** sitios, ambos condicionados (cancelación tras todas las condiciones; reversión con `rc=0`). Una prueba lo comprueba.
- El script de Windows solo ejecuta `ssh` acotado en el tiempo (con `tai-inspect`, y opcionalmente `echo` con el alias de administrador), `ssh -G`, `ssh-add -l` y una consulta GET a `/api/health`. No autoriza nada por sí mismo: solo emite la línea firmada.

## Pruebas locales realizadas (14/11/2026, sin VPS, sin red, sin Docker)
`automation/inspeccion/tests/test_f7_cierre.py`: **76 pruebas** (bash `--posix` con `systemctl`, `systemd-run`, `sshd`, `su`, `sudo`… simulados, y el script real de Windows PowerShell 5.1 contra un `ssh` simulado): flujo completo; mismo resultado no cierra dos veces; resultado de una activación anterior rechazado en la nueva; clave/HMAC incorrectos; veredicto `V_FALLA`/`V_INCOMPLETO`/fuera de margen; vencimiento de otra tanda o no verificable; temporizador vencido o de otra instancia; margen < 30 s; invariantes distintos; consola B cerrada o con PID reutilizado; V13/V14/V15; auditoría sin evidencia; fallo de cancelación; reversión fallida (temporizador conservado y activación no cerrable); línea mal copiada (no cancela ni revierte); rechazos de `activar` sin tocar nada; armado impreciso/fallido y recarga fallida (revierte, sin recargar); y compatibilidad HMAC Windows↔VPS.
**Límites:** no se ha ejecutado contra el VPS, `systemd` ni el `ssh.exe` reales; los textos reales de `ActiveEnterTimestamp*`, `sudo -l` y del registro del gate se verán por primera vez en F7. La consola web de Hostinger podría tratar de forma distinta un pegado largo: por eso se imprime y se compara la huella.

> **Nota de cambio (cierre posterior a 3E.8.15):** `f7-vps.sh` pasó de SHA-256 `862edd34ff72e8047f4b496526bfcfea56c1958f79cfa6eba64b45b0f266fc5c` a `9a621654612e60679c1a11358d04862c730e119817cf78bfed6d5ebe2e22bbe2`. Único cambio funcional: la orden de Windows que imprime `activar` usa ahora una ruta **relativa a la raíz del repositorio** (`.\automation\scripts\F7-Validacion-Windows.ps1`, sustituible con `TAI_F7_WIN_PS`) en lugar de la ruta absoluta antigua `D:\AXEL\WEBS\TRADYLOR\tradylor_web\…` (carpeta que ya no existe), y el aviso indica ejecutarla desde esa raíz. `F7-VPS-pegar.txt` se regeneró con `f7-generar-pegado.py` (su huella embebida es la nueva); `F7-REFERENCIA-pegar.txt` no cambió. Los informes históricos de `INFORMES/` conservan la huella anterior. **Si algún bloque «pegar» antiguo estuviera ya en uso, debe sustituirse por el nuevo.**
