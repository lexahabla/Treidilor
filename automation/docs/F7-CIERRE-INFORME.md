# F7 — Informe de cierre (acceso SSH restringido `tai-inspect` activado en el VPS)

**Estado: F7 COMPLETADA (14/11/2026, comunicado por el propietario; el asistente no tiene acceso al VPS y no ha reproducido ninguna comprobación).** **F8** (pausa ≥ 24 h con solo el gate): **SUPERADA CON RIESGOS RESIDUALES DOCUMENTADOS el 16/11/2026** (`F8-CIERRE-INFORME.md`). F9 (colector) requiere autorización propia; las etapas 3–7 del diseño siguen sin autorizar.

## 1. Resultado confirmado (comunicado por el propietario)
| Control | Resultado |
|---|---|
| Cierre automatizado (`f7-vps.sh cerrar`) | `F7_CERRADO_OK` |
| Pruebas automáticas desde Windows (V0–V8) | 20 superadas, 0 errores |
| Invariantes tras cancelar el temporizador | `INVARIANTES_IGUALES` |
| Temporizador `tai-reversion` y servicio de reversión | Inactivos (sin rearmado: hubo un único `systemd-run`) |
| CP5 desde Windows: `https://treidilor.com/api/health` | `status: ok`, `sourceHash 0885734050b5c946c3eb22e328120eea080d7a68adb17a1c10816da0f15c7487` (el mismo de antes de F7) |
| Referencia original de invariantes | Conservada y verificada: `/root/tai-etapa2/invariantes-base.original-b6844f77fc79.txt` (+ `.sha256`) |
| Acceso administrativo por SSH (`-AliasAdmin`) | **NO_PROBADO** (opcional; no hay un alias de administrador por clave configurado). El acceso administrativo independiente que se verificó es la **consola web B de Hostinger** (viva y registrada antes de activar) |

Qué quedó instalado y activo: `/etc/ssh/sshd_config.d/00-tai-inspect.conf` (usuario `tai-inspect`, `ForceCommand` al gate, sin PTY, sin reenvíos, solo clave dedicada `tai-inspect_ed25519`, huella `SHA256:OW0d/GCWjasNxmoh7RWafXSFQZvvYt7nNIgtHXVpQtU`) con las **5 comprobaciones del host**. No hay colector ni unidades `systemd`; las **11 comprobaciones sensibles siguen cerradas**.

## 2. Cómo se llegó (14/11/2026) — hechos y correcciones
| # | Intento / hallazgo | Naturaleza | Resolución |
|---|---|---|---|
| 1 | Primer F7 manual: aplicado y revertido (`REVERSION_RC=0`, invariantes idénticos); V2 dio `RC=0` en vez de `RC=7` | **No era defecto**: la secuencia manual superó los 30 s del limitador | Script único de Windows que encadena V1/V2/V2b |
| 2 | Segundo intento: 20 automáticas, V13–V15 e invariantes correctos, pero la puerta estaba cerrada (`V_ADMIN=NO`) y la ventana de 10 min se agotó | Procedimiento manual demasiado largo; acceso administrativo abierto **dentro** de la ventana | Reversión automática y manual correctas (`REVERSION_RC=0`). Se eliminó el rearmado y se automatizó el cierre (`f7-vps.sh`, 3 acciones) con la consola B preparada **antes** |
| 3 | V5 `-tt` marcado `FALLA` con `RC=255` y solo `PTY allocation request failed on channel 0` | **Falso negativo de la prueba** (con `-t/-tt` OpenSSH trata el rechazo del PTY como fatal antes del `exec`); no un defecto del servidor | Se exige: `-v`, `Authenticated to`, el mensaje con `channel N`, `RC=255` y salida vacía |
| 4 | El cierre se rechazó por una única diferencia de invariantes: SHA-256 de `/root/.ssh/authorized_keys` (`b6844f77…` → `41bf9b3a…`) | El cambio era **anterior** a la activación (igual antes y después de la reversión) | Investigación forense (ver §3) y aprobación explícita de la nueva referencia conservando la original |
| 5 | Tras reabrir la consola B, `preparar` falló otra vez solo por el hash de `authorized_keys` (`c03dd6cc…`) con la misma huella | El proveedor reescribe el archivo al abrir una consola | Corrección definitiva: el hash de `authorized_keys` se excluye de la comparación y se sustituye por una comprobación por **huella** (una única clave ED25519, huella del propietario, sin opciones, `root:root 600`) en `preparar`, `activar`, `cerrar` y la reversión; el resto de invariantes sigue estricto |

## 3. Hallazgo sobre `authorized_keys` (límites)
- El archivo actual contiene **una** clave ED25519, `SHA256:zzEk73jAM3o9yO0f7uBlYhu2gZhxRWbpTrL0RzKIlfE`, que es la de `~/.ssh/id_ed25519.pub` del PC del propietario (6 accesos desde `176.84.216.197`). Recreado el 14/11/2026 a las 15:37:32 UTC.
- **Siete claves RSA distintas** accedieron como root **una vez cada una desde `169.254.0.1`** (dirección link-local); el último acceso fue a las 15:36:33 UTC. No hay accesos de root por otros métodos en el registro analizado.
- Patrón **compatible** con claves temporales de una consola de administración (posiblemente Hostinger), **no confirmado por el proveedor**. Esas siete huellas quedan **registradas como temporales (`f7-huellas-temporales.txt`), no autorizadas**; el origen link-local no se toma como prueba de legitimidad.
- Cualquier acceso de root con otra huella durante una activación bloquea el cierre y revierte.

## 4. Controles de seguridad vigentes tras F7
Reversión automática de 10 min con `AccuracySec=1s` y vencimiento verificado; reversión manual segura (el temporizador solo se detiene si `revertir.sh` termina con `rc=0`); firma HMAC del resultado de Windows atada al id y a la clave de cada activación (un resultado antiguo no sirve); consola B independiente comprobada por PID e instante de arranque; vigilancia de accesos de root con huella desconocida; corroboración del registro del gate; V13–V15 automatizados; referencia de invariantes solo con aprobación explícita atada al hash revisado.

## 5. Archivos de F7 (versiones entregadas el 14/11/2026; el propietario comunica que están instaladas, pero no se ha re-confirmado el SHA-256 instalado en este cierre)
| Archivo | SHA-256 |
|---|---|
| `automation/scripts/f7-vps.sh` | `9a621654612e60679c1a11358d04862c730e119817cf78bfed6d5ebe2e22bbe2` |
| `automation/scripts/f7-referencia.sh` | `d4eeca66f0ebbca50a013287469bcf73fa4a87391f546749d071ff080431603e` |
| `automation/scripts/F7-Validacion-Windows.ps1` | `bd6a7fae671972159e9e7a5a509be8440118257f3f64fa78632f527601b7a46e` |
| `F7-VPS-pegar.txt` / `F7-REFERENCIA-pegar.txt` | `d92d44d8ee1fd1e0ef9afbd8201439396bacdf86fc4516415e277f17415587e9` / `d4cdb5b6b9580efe42b5f4ac2598de49653cde4b3dca74f2255a434e8e34c094` |
Pruebas locales (simuladas, sin VPS): 157 (76 del cierre, 45 de la referencia, 36 del plan). Procedimiento: `F7-CIERRE-AUTOMATIZADO.md`; referencia y `authorized_keys`: `F7-APROBAR-REFERENCIA-INVARIANTES.md`; plan: `INSPECCION-ETAPA-2-PLAN.md`.

## 6. Limitaciones y pendientes
1. **Acceso administrativo por SSH no probado** (`NO_PROBADO`); solo se verificó la consola web B.
2. **Origen de las claves temporales:** el patrón se reprodujo con una apertura deliberada de la consola web de hPanel (16/11/2026, 16:16:05 UTC, huella `SHA256:bHwnO2e918JUtDpyoAxRyeNQOmhY7g0DyD3u7G2tFTM`), pero el soporte humano de Hostinger **no pudo atribuir individualmente** los 14 accesos históricos (`F8-CIERRE-INFORME.md`).
3. **Nada de F7 fue verificado por el asistente** (sin acceso al VPS); los resultados son los comunicados.
4. **Riesgos de la etapa 1 sin cambios** (F7 no los toca): root permitido por SSH con contraseña habilitada, puerto 22 abierto a Internet, `fail2ban` inactivo, clave de root sin passphrase y sin restricciones, reenvío TCP/agente permitidos globalmente. Su tratamiento corresponde a la etapa 7 del diseño y requiere autorización aparte.
5. **F8 (pausa ≥ 24 h): SUPERADA CON RIESGOS RESIDUALES DOCUMENTADOS (aprobada por el propietario el 16/11/2026)** (45 h de observación; patrón de la consola web reproducido en una prueba controlada; atribución individual de los accesos históricos NO demostrada): ver `F8-CIERRE-INFORME.md`. **F9 (colector)**, autorización propia, **sin autorizar**.
6. **No confundir con el «F7» del Auditor General**: en `AGENTE-12-VALIDACION-PRODUCCION.md` y el Plan Maestro, «F7» es la **programación** del Auditor (sigue **no autorizada**); no tiene relación con esta F7 de la inspección SSH.
7. La documentación (`AGENTS.md`, `estructura*.txt`) se actualizó solo con texto; los archivos de estructura no se han regenerado y nada de este trabajo está commiteado.
