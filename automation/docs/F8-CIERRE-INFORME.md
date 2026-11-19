# F8 — Informe de cierre (pausa con solo el gate; 16/11/2026)

**Estado: F8 SUPERADA CON RIESGOS RESIDUALES DOCUMENTADOS (aprobada por el propietario el 16/11/2026).** Todos los resultados son los **comunicados por el propietario**; el asistente no tiene acceso al VPS y no ha reproducido ninguna comprobación. **La atribución individual de los accesos históricos de root con clave RSA NO está demostrada** (§3.B) y queda como riesgo residual. **F9 (colector) NO queda autorizada**: requiere autorización propia.

## 1. Observación
| Dato | Valor |
|---|---|
| Inicio (T0) | Cierre de F7: 14/11/2026 17:59:18 UTC (`F7_CERRADO_OK`, ver `F7-CIERRE-INFORME.md`) |
| Duración comprobada | **45 h** (mínimo del plan: ≥ 24 h; «mejor 48 h» no alcanzado, no exigido) |
| Reinicios del VPS / recargas de `sshd` | Ninguno detectado |
| Configuración | Solo el gate con las 5 comprobaciones del host; sin colector ni unidades `systemd` |

## 2. Comprobaciones superadas
| Comprobación | Resultado comunicado |
|---|---|
| `gate-audit.log` | 105 registros JSON, 0 inválidos, 0 saltos de `seq`, **0 posteriores a F7** (el gate no se invocó durante F8) |
| `journalctl -t tai-gate` | 105 registros históricos (coincide con la auditoría), 0 posteriores a F7 |
| Invariantes | Iguales a la referencia vigente, salvo el hash de `authorized_keys` (que se verifica por huella desde F7) |
| `authorized_keys` | `root:root`, `600`, **una** clave ED25519 con la huella aprobada `SHA256:zzEk73jAM3o9yO0f7uBlYhu2gZhxRWbpTrL0RzKIlfE`. Hash actual `611d3737…bba5` frente a la referencia `41bf9b3a…3ad1d`; última modificación 16/11/2026 13:18:04 UTC (reescritura por el proveedor al abrir la consola: comportamiento ya previsto en F7) |
| Gate | Hash del archivo de configuración correcto; `sshd -t` OK; integridad del código OK; restricciones efectivas de `tai-inspect` correctas; huella de la clave del gate correcta; `revertir.sh` `192264110ba3d7d2184df0713e098209e35172463e784881bd4a542746ed012e`; 0 enlaces simbólicos; **ningún archivo protegido modificado desde F7** |
| Unidades, servicios | Ninguna unidad ni temporizador `tai` instalados; ningún servicio fallido |
| Accesos por contraseña | 0 aceptadas; 1 fallida; 1 usuario inválido (sin patrón de fuerza bruta) |

## 3. Accesos de root por clave pública RSA (lo que hay y lo que NO hay demostrado)
### A. Patrón de acceso de la consola web: **REPRODUCIDO Y CONFIRMADO mediante una prueba controlada**
- **Prueba (16/11/2026).** El propietario abrió **deliberadamente** una sesión nueva de la consola web de Hostinger (hPanel) hacia las 17:15 (hora de España = 16:15 UTC). El registro de `sshd` mostró:
  - Fecha: `2026-11-16T16:16:05+00:00`
  - Usuario: `root` · Método: `publickey` (clave **RSA**) · Origen: `169.254.0.1`
  - Huella: `SHA256:bHwnO2e918JUtDpyoAxRyeNQOmhY7g0DyD3u7G2tFTM`
- **Qué demuestra.** Que abrir la consola web produce un acceso de root por clave pública RSA desde `169.254.0.1` con una huella propia: **el mismo patrón** (método, tipo de clave, origen) que el de los accesos investigados (7 en F7 y 4 en la ventana de F8). La hipótesis «la consola web usa claves RSA temporales» pasa de compatible a **reproducida para este mecanismo**.
- **Qué NO demuestra.** (1) Que Hostinger lo describa así: **el soporte humano de Hostinger no pudo atribuir individualmente los 14 accesos históricos** (si confirmó o no el mecanismo por escrito, no consta). (2) Que ese patrón sea exclusivo de las sesiones del propietario: cualquier sesión del mismo mecanismo (otro operador autorizado, automatización del proveedor) produciría el mismo registro. (3) Nada sobre la reescritura de `authorized_keys` en esta prueba concreta: **no consta** si el archivo se reescribió después (en F7 y el 16/11 13:17:05 → 13:18:04 el desfase fue de 59 s).

### B. Atribución individual de los accesos históricos: **NO DEMOSTRADA**
- **Cifra.** El propietario cuenta **14** accesos históricos. El inventario que consta en la documentación es de **11** (7 de F7 hasta el 14/11 15:36:33 UTC, una vez cada uno desde `169.254.0.1`, y 4 en la ventana de F8: 15/11 21:08:21, 16/11 09:36:19, 16/11 10:22:53 y 16/11 13:17:05 UTC). **La composición de los 14 no está documentada**: queda pendiente que el propietario aporte el desglose; hasta entonces el número 14 es una cifra comunicada.
- **Por qué no se demuestra.** Reproducir el patrón con una apertura conocida **no identifica quién abrió cada acceso histórico**: solo prueba que el patrón es el de la consola. Atribuir cada uno exigiría cruzar su hora con las aperturas de consola del propietario (no registradas) o una fuente independiente. **El soporte humano de Hostinger tampoco pudo atribuirlos individualmente**, así que esa fuente no existe por ahora.
- **Efecto sobre el cierre.** Es una limitación **aceptada** para cerrar F8, no una resolución. Lo coherente con los datos —el mecanismo de la consola— no equivale a haberlo comprobado acceso por acceso.

### C. Riesgos residuales (permanecen documentados)
1. **Claves RSA temporales: patrón confirmado con una apertura propia, pero el origen individual de los accesos históricos no es atribuible (ni siquiera por el soporte de Hostinger)** y reescritura de `authorized_keys` en cada apertura de consola. El hash de ese archivo ha cambiado varias veces (`b6844f77…`, `41bf9b3a…`, `611d3737…`): por eso se verifica por huella.
2. **Quien pueda generar ese mecanismo tiene control equivalente a root** sobre el VPS (reescribe `authorized_keys`). Es un límite de confianza en el proveedor: el gate no lo cambia.
3. **Acceso administrativo por SSH no probado** (`NO_PROBADO`); la única vía de recuperación verificada es la consola web.
4. **Exposición de root:** SSH con contraseña habilitada, puerto 22 abierto en el cortafuegos, `fail2ban` inactivo y clave del propietario sin passphrase (etapa 7, sin autorizar). La presión observada es baja (1 contraseña fallida y 1 usuario inválido en 45 h).
5. **Auditoría sin protección de inmutabilidad en el VPS** (`chattr +a` solo probado en contenedores); `seq` detecta huecos pero no impide ediciones.
6. **F8 fue una fase pasiva:** el gate no se usó durante la pausa (0 entradas nuevas); su comportamiento bajo uso lo cubrió F7.
7. **Todo lo anterior es comunicado, no verificado por el asistente.**

## 4. Contraste con los criterios de cierre
| Criterio | Resultado |
|---|---|
| ≥ 24 h sin reinicios ni recargas de `sshd` | **Cumplido** (45 h) |
| Auditoría y journald coherentes | **Cumplido** |
| Invariantes iguales (salvo el hash de `authorized_keys`, verificado por huella) | **Cumplido** |
| Gate, código, configuración efectiva, restricciones y `revertir.sh` íntegros | **Cumplido** |
| Sin unidades, usuarios, puertos ni servicios nuevos o fallidos; sin accesos por contraseña | **Cumplido** |
| Accesos de root con clave distinta de la del propietario **explicados** | **Parcial:** el patrón está reproducido y confirmado (§3.A); la atribución individual **no** (§3.B) |
**Decisión documentada:** F8 se cierra **con riesgos residuales**, tomando como aceptada por el propietario la limitación de §3.B. Esto **no** equivale a haber atribuido cada acceso ni a una atribución por parte de Hostinger (su soporte humano no pudo hacerla). Aprobada por el propietario como **SUPERADA CON RIESGOS RESIDUALES DOCUMENTADOS**.

## 5. Qué podría cerrar la atribución (no bloqueante; sin autorizar nada nuevo)
1. El soporte humano de Hostinger **ya respondió sin poder atribuir** los accesos individuales. Una confirmación técnica **por escrito** del mecanismo (claves RSA temporales, origen `169.254.x.x`, reescritura de `authorized_keys`) seguiría siendo útil, pero no cerraría la atribución por sí sola.
2. El **desglose de los 14 accesos** (hora UTC y huella) y la lista de aperturas de consola del propietario con su hora, para cruzarlos.
3. Si el propietario dispone de ello, el momento de la reescritura de `authorized_keys` tras el acceso de la prueba controlada (16:16:05 UTC).

## 6. Referencias
`F7-CIERRE-INFORME.md` (T0, clave de root y las 7 claves de F7) · `F7-APROBAR-REFERENCIA-INVARIANTES.md` (huella en lugar de hash, clasificación de temporales) · `INSPECCION-ETAPA-2-PLAN.md` §F8 · `INSPECCION-ETAPA-0-INFORME.md`. **Ninguna fase posterior (F9, etapas 3–7) está autorizada.**
