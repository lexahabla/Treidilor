# Inspección automática del VPS — Validación LINUX de la ETAPA 0 (13/11/2026)

> **Estado: validación Linux realizada en local y REPETIDA tras corregir H1, H4 y H5 (§10: 149 de 149 por versión de Python); la etapa 1 NO ha comenzado y requiere autorización expresa.** Los apartados 1 a 9 describen la primera validación (con el fallo H1 abierto) y se conservan como histórico. Todo se ejecutó en contenedores efímeros **sin red**,
> con una copia del código montada en solo lectura y con usuarios y archivos **ficticios**. Sin conexión al VPS, sin credenciales reales, sin tocar los contenedores
> `tai-dt-*`, sin socket de Docker, sin cambios en el código de inspección, sin commits ni pushes. Resultado: **127 de 128 pruebas correctas por versión de Python;
> 1 falla y corresponde a un fallo REAL del colector (H1)**. Además se encontraron otros dos hallazgos de código (H4, H5) que no tenían prueba. **No se ha corregido nada del código sin tu aprobación** (§6).

## 1. Entorno Linux utilizado
| Elemento | Valor |
|---|---|
| Motor | Docker Desktop 29.9.2 (ya instalado y en marcha), `linux/amd64` |
| Imágenes (descargadas con una configuración de Docker **vacía**, de forma anónima) | `python:3.8-slim` (`sha256:1d52838a…613f`, ID `b5f62925bd0f`, 125 MB) · `python:3.12-slim` (`sha256:5e2bdb1b…fa5b`, ID `78976a69c067`, 119 MB). **Se conservan** para repetir las pruebas |
| Versiones reales | Python 3.8.x y 3.12.16 sobre Debian (imagen oficial), x86_64 |
| Aislamiento | `--network none` (solo `lo`; ni conexión externa ni DNS), raíz de solo lectura, `tmpfs` para lo temporal, `--cap-drop ALL`, `no-new-privileges`, límites de procesos/memoria/CPU, `--rm`, sin variables de entorno de mi sesión (solo las de la imagen: `GPG_KEY` es el identificador **público** de la clave de firma de Python, no una credencial), sin socket de Docker, sin `/home` ni `/root` legibles |
| Montajes | **Solo** la copia temporal del código (solo lectura) y `tmpfs` en las rutas fijas de prueba |
| Copia del código | Hecha fuera del repositorio; contiene `automation/inspeccion` + un `enabled.json` **solo de prueba** (comprobaciones de host y `docker-nodos`) que no está en el repositorio. Sin hallazgos en el escáner de secretos. El **manifiesto del producto coincide** con el de la etapa 0 (`69612c2e…b14b11a`) |

## 2. Resultados exactos
Cada versión de Python dio **exactamente los mismos resultados**.

| Ejecución | Python | Pruebas | Correctas | Fallidas | Omitidas |
|---|---|---|---|---|---|
| Referencia en Windows | 3.14 | 128 | 106 | 0 | 22 (las 4 POSIX + 18 solo Linux) |
| **A. Linux, usuario sin privilegios (uid 10001), rutas fijas montadas** — batería completa | **3.8** | **128** | **123** | **0** | **5** (las de separación de privilegios) |
| **A. Linux, usuario sin privilegios** — batería completa | **3.12** | **128** | **123** | **0** | **5** (ídem) |
| **C. Linux, contenedor con root y capacidades mínimas** (solo `test_linux_real`) | **3.8** | 18 | 11 | **1** | 6 (las del usuario sin privilegios, ya ejecutadas en A) |
| **C. Linux, contenedor con root** (solo `test_linux_real`) | **3.12** | 18 | 11 | **1** | 6 (ídem) |
| **Total combinado (cada prueba en el entorno donde puede ejecutarse)** | **3.8** | **128** | **127** | **1** | **0** |
| **Total combinado** | **3.12** | **128** | **127** | **1** | **0** |
La única fallida es `test_enlace_simbolico_plantado_por_el_usuario_no_filtra_el_secreto_ni_rompe_el_colector` (hallazgo **H1**, §6).
Un fallo adicional inicial (`test_colector_con_solo_dac_read_search`) era un error **de mi propia prueba** (un `chown` al mismo propietario, que Linux siempre permite); se corrigió en la prueba y ahora pasa en las dos versiones.

### 2.1 Las cuatro pruebas POSIX que Windows omitía
| Prueba | Python 3.8 | Python 3.12 |
|---|---|---|
| `test_lectura_no_sigue_enlaces_ni_lee_fuera_de_la_ruta` (enlace simbólico en informes) | **ok** | **ok** |
| `test_lectura_de_informe_enlazado_fuera_de_la_ruta` (el gate no sigue un informe enlazado) | **ok** | **ok** |
| `test_enlaces_simbolicos_se_marcan` (manifiesto detecta enlaces) | **ok** | **ok** |
| `test_ficheros_escribibles_por_otros` (manifiesto detecta permisos POSIX) | **ok** | **ok** |

## 3. Qué se ha validado sobre Linux real
| Prueba | Resultado |
|---|---|
| Humo con `/proc`, `statvfs` y herramientas **reales**: `host-recursos` coincide con `/proc/meminfo`; el resto da avisos (no errores) cuando faltan `ss`, `systemctl`, `apt`, `timedatectl`; ninguna IP en los informes | ✔ |
| Enlaces simbólicos, FIFO, `/dev/null` y `/proc/self/cwd` **no se leen**; escritura atómica con permisos `0640` y sin temporales residuales | ✔ |
| **Lanzador real** `bin/tai-gate` con `python -I` y rutas fijas: orden válida → informe; mismo comando de nuevo → `limite alcanzado` entre procesos reales; 6 órdenes manipuladas y una sesión sin orden → `orden no permitida`, sin salida por error estándar; interruptor `DISABLED` | ✔ |
| **`-I` frente a un entorno hostil:** un `PYTHONPATH` con un `json.py` que sustituye a la biblioteca estándar, más `PYTHONSTARTUP` y `PYTHONHOME`, **no se ejecuta** | ✔ |
| **Dos procesos reales** (gate y `bin/tai-collector`) intercambiando petición e informe por archivos; sin Docker en la imagen el informe lleva un aviso, no un error | ✔ |
| **Auditoría real** sin IP completa, sin el secreto ficticio de la orden rechazada y con una línea por evento | ✔ |
| **Separación de privilegios** (gate = uid 10001; colector = root con **solo `CAP_DAC_READ_SEARCH`**; confirmado `CapEff = 0x4` y que no puede cambiar el propietario de un archivo): el gate **no puede** modificar, borrar ni crear en la instalación, escribir en informes, crear enlaces en informes, leer un archivo de root `0600`, escribir en el registro del colector ni en el directorio de registros, listar las peticiones, cambiar permisos ni volver a root | ✔ |
| **Flujo completo con privilegios separados:** el colector (sin `DAC_OVERRIDE`) lee la petición del gate, la borra y deja el informe `root:tai-inspect 0640` (herencia de grupo por `setgid`), que el gate lee | ✔ |

## 4. Diferencias de compatibilidad entre Python 3.8 y 3.12
**Ninguna diferencia funcional.** Mismos resultados en ambas. Solo cambia el formato de salida de `unittest` (la forma de imprimir el nombre de cada prueba). El código se ejecuta con `-W error::SyntaxWarning` en las dos versiones, así que no hay construcciones sintácticas incompatibles con 3.8 ni avisos de obsolescencia. Queda sin probar 3.9–3.11 (rango intermedio, de bajo riesgo).

## 5. Verificación de que nada se modificó
| Comprobación | Resultado |
|---|---|
| Huella SHA-256 de la copia montada, antes y después de todas las ejecuciones | **Idéntica** (`11267607…a1129`) |
| Estado de Git del proyecto (`status` + `diff --stat`), antes y después | **Idéntico** |
| Contenedores existentes (10, incluidos los `tai-dt-*`), antes y después | **Sin diferencias**; ninguno se arrancó; 0 en ejecución |
| Imágenes | Solo se añadieron `python:3.8-slim` y `python:3.12-slim` |
| Configuración de Docker aislada | **0 archivos** creados (ninguna credencial usada ni escrita) |
| Producción / VPS | Sin red en ninguna ejecución; sin credenciales; sin conexión |

## 6. Hallazgos y soluciones propuestas (NINGUNA APLICADA: requieren tu aprobación)
| # | Hallazgo | Evidencia | Gravedad | Solución propuesta |
|---|---|---|---|---|
| **H1** | **Una petición hostil (enlace simbólico o nombre manipulado) detiene el colector.** `Colector._una()` llama a `safe_join()` **fuera** de su bloque `try`; al devolver `RutaNoPermitida` la excepción sale de `procesar()` y el proceso termina con código 1. La petición hostil **no se borra** y vuelve a detener el colector en **cada** ejecución | Prueba real `test_enlace_simbolico_plantado…` (falla en 3.8 y 3.12). No se llegó a leer el secreto (el fallo ocurre antes), así que **no hay fuga ni escalada: es una denegación de servicio** que un usuario con la clave del gate podría provocar | Media (disponibilidad de la inspección; sin impacto en producción) | (1) Mover `safe_join` **dentro** del `try` y tratar `RutaNoPermitida` como petición inválida (descartarla con `unlink`, que no sigue enlaces). (2) En `procesar()`, rodear cada `_una()` con `try/except Exception` que registre solo el **nombre de la excepción** y continúe con las demás. (3) Añadir una prueba unitaria independiente de Linux |
| **H4** | **Si el gate no puede escribir su registro de auditoría, termina con un `traceback` completo por el error estándar** (visible al cliente SSH): rutas de instalación y líneas de código. En el bloque `except` de `handle()` vuelve a llamar a `audit.log()`, que falla otra vez y no se captura | Ejecución real en contenedor con `/var/log/tai-inspect` no escribible: salida vacía, código 1 y traceback en `stderr` | Baja-media (divulgación de rutas, no de secretos; la comprobación se había ejecutado) | (1) Un método de auditoría del gate que **nunca** lance excepciones. (2) Un `try/except BaseException` en `main()` que responda `error interno` (código 8) **sin traceback**. (3) Prueba que lo reproduzca |
| **H5** | **La auditoría se escribe DESPUÉS de ejecutar la comprobación**, no antes. Esto contradice el principio de **registro previo (write-ahead)** aprobado en A-05: con el registro roto el gate ya ha actuado | Lectura del código, confirmada por H4 (la comprobación de `host-tiempo` se ejecutó y se consumió el cupo antes de fallar el registro) | Media en coherencia con el principio; baja en riesgo (solo lectura) | Anotar una entrada de **intención** antes de ejecutar y **rechazar** (`error interno`) si no se puede registrar; después, la entrada de resultado. Requiere tu decisión porque cambia el comportamiento aprobado |
| H2 | Error de mi prueba: `chown` al mismo propietario no prueba la falta de `CAP_CHOWN` | Prueba del colector | — | **Corregido en la prueba** (a un propietario distinto); ahora pasa |
| H3 | Requisitos de **instalación** que la validación ha hecho explícitos | Flujo con privilegios separados | — | Documentados abajo (no son cambios de código) |

### 6.1 Requisitos de instalación validados para las etapas 2 y 3
- `requests/`: propietario `root`, grupo `tai-inspect`, modo **`2730`** (el gate crea y borra su petición, no puede listarla; root la borra por ser propietario del directorio).
- `reports/`: propietario `root`, grupo `tai-inspect`, modo **`2750`** (el `setgid` hace que los informes hereden el grupo y sean legibles solo por el gate).
- `state/`: propietario `tai-inspect`, modo `0700`.
- **El archivo `gate-audit.log` debe crearse de antemano**, con propietario `tai-inspect` (el gate no puede crear archivos en un directorio de `root`); `collector-audit.log` es de `root` (`0640`). Sin esto se produce H4.
- El colector con **solo `CAP_DAC_READ_SEARCH`** basta para leer peticiones ajenas `0600`, borrarlas (por ser dueño del directorio) y escribir informes. No pudo comprobarse la lectura de `auth.log` ni el acceso al socket de Docker con ese conjunto de capacidades (no existen en el contenedor): se validará en la etapa 3.

## 7. Qué sigue SIN validar
1. `sshd -t` de la plantilla `Match` y `systemd-analyze verify/security` de las unidades (las imágenes no incluyen `sshd` ni `systemd`).
2. `MemoryDenyWriteExecute`, `PrivateDevices` y `CapabilityBoundingSet` **bajo `systemd` real**, y el acceso al socket de Docker con ese conjunto.
3. Salidas **reales** de `ss`, `apt`, `timedatectl`, `docker … --format`, `sshd -T`, `auth.log`, `journalctl` y `psql` (solo simuladas).
4. El entorno del VPS (existencia y versión de `python3`, rutas de los binarios).
5. El esquema real de n8n y los nombres de servicio de Swarm.
6. Las versiones 3.9–3.11 de Python.

## 8. Cómo repetir la validación (imágenes conservadas)
Desde PowerShell, con una configuración de Docker vacía y sin red:
```powershell
$env:DOCKER_CONFIG = "<carpeta vacía>"
# A. sin privilegios
docker run --rm --network none --read-only --tmpfs /tmp:rw,nosuid,size=128m `
  --tmpfs /var/lib/tai-inspect:rw,nosuid,uid=10001,gid=10001,mode=0755,size=16m `
  --tmpfs /var/log/tai-inspect:rw,nosuid,uid=10001,gid=10001,mode=0755,size=16m `
  --tmpfs /etc/tai-inspect:rw,nosuid,uid=10001,gid=10001,mode=0755,size=1m `
  --cap-drop ALL --security-opt no-new-privileges --pids-limit 256 --memory 512m --cpus 1 --user 10001:10001 `
  -e PYTHONDONTWRITEBYTECODE=1 -v "<copia>:/opt/tai-inspect:ro" -w /opt/tai-inspect `
  python:3.12-slim python -W error::SyntaxWarning -m unittest discover -s tests -v
# C. con root y capacidades mínimas (solo test_linux_real)
docker run --rm --network none --read-only --tmpfs /tmp:rw,nosuid,size=128m --tmpfs /opt/tai-inspect:rw,exec,mode=0755,size=16m `
  --tmpfs /var/lib/tai-inspect:rw,mode=0755,size=16m --tmpfs /var/log/tai-inspect:rw,mode=0755,size=16m --tmpfs /etc/tai-inspect:rw,mode=0755,size=1m `
  --cap-drop ALL --cap-add CHOWN --cap-add FOWNER --cap-add FSETID --cap-add SETUID --cap-add SETGID --cap-add DAC_READ_SEARCH `
  --security-opt no-new-privileges --pids-limit 256 --memory 512m --cpus 1 --user 0:0 -e PYTHONDONTWRITEBYTECODE=1 `
  -v "<copia>:/work:ro" -w /work python:3.12-slim python -W error::SyntaxWarning -m unittest discover -s tests -p "test_linux_real.py" -v
```
`<copia>` = copia del directorio `automation/inspeccion` fuera del repositorio, más un `enabled.json` solo de prueba. Ver también `automation/inspeccion/LEEME.md`.

## 9. Condiciones para autorizar la etapa 1
1. **Decidir sobre H1, H4 y H5** (recomiendo aprobar H1 y H4 como correcciones; H5 es una decisión de comportamiento). Tras aplicarlas habría que **repetir esta validación** (dos comandos) y **regenerar la huella** del código para tu revisión independiente.
2. **Revisión independiente del código** (pendiente por tu parte), idealmente sobre la versión ya corregida.
3. **Alcance de la etapa 1** (solo lectura con tu sesión): versión y ruta de `python3`, SO, versiones de `sshd`, Docker y `systemd`, disponibilidad de `ss/apt/timedatectl/journalctl`, existencia de `auth.log`, nombres de los servicios de Swarm y los cuatro comandos de privilegios de la conexión SSH actual.
4. Seguir **sin** generar claves, sin `ssh-agent` y sin instalar nada en producción (decisiones vigentes).
5. Decidir si se valida en el VPS lo que aquí no puede (§7.1–7.3) o se prepara una imagen con `openssh-server`/`systemd` (otra descarga, que pediría autorización).

## 10. Correcciones H1, H4 y H5 y revalidación completa (13/11/2026)
Autorizadas por el propietario; solo en `automation/inspeccion/`. Mismos contenedores e imágenes (**no se descargó nada**), mismo aislamiento (sin red, copia en solo lectura, sin socket de Docker, configuración de Docker vacía). Descripción de los cambios en `INSPECCION-ETAPA-0-INFORME.md` §8.

### 10.1 Resultados exactos (idénticos en Python 3.8 y 3.12)
| Ejecución | Pruebas | Correctas | Fallidas | Omitidas |
|---|---|---|---|---|
| Windows (referencia) | 149 | 124 | 0 | 25 (solo Linux) |
| **A. Linux, usuario sin privilegios** (batería completa) — **3.8** | 149 | **144** | **0** | 5 (separación de privilegios) |
| **A. Linux, usuario sin privilegios** — **3.12** | 149 | **144** | **0** | 5 |
| **C. Linux, root con capacidades mínimas** (`test_linux_real`) — **3.8** | 21 | **12** | **0** | 9 (las del usuario sin privilegios, ya ejecutadas en A) |
| **C. Linux, root con capacidades mínimas** — **3.12** | 21 | **12** | **0** | 9 |
| **Total combinado — Python 3.8** | **149** | **149** | **0** | **0** |
| **Total combinado — Python 3.12** | **149** | **149** | **0** | **0** |
La prueba que fallaba (`test_enlace_simbolico_plantado…`, H1) **pasa ahora en las dos versiones** y se ha reforzado: además de descartar las peticiones hostiles comprueba que una petición **legítima posterior** se atiende y que el colector termina con código 0.

### 10.2 Verificaciones obligatorias
| Verificación | Resultado |
|---|---|
| **Sin excepciones visibles** | Reproducción del escenario de H4 (registro de auditoría no escribible), en 3.8 y 3.12: código de salida **9**, salida `error interno`, **error estándar vacío**. Prueba real con el paquete dañado: código **8**, `error interno`, error estándar vacío. Las pruebas de regresión comprueban que `handle()` nunca lanza excepciones y que ninguna respuesta contiene `Traceback`, rutas, nombres de archivo ni el texto de una excepción (con mensajes de error que contienen una ruta y un secreto ficticio) |
| **Sin filtraciones** | Los registros de auditoría y las respuestas no contienen informes, secretos ficticios, la IP completa del cliente ni mensajes de excepciones (solo el **tipo**) |
| **Sin bloqueos por peticiones manipuladas** | Tres peticiones hostiles (dos enlaces simbólicos y un nombre con recorrido de directorios) → el colector termina con código 0, las retira y atiende la legítima; peticiones con rutas no permitidas simuladas y una excepción inesperada en una petición no detienen a las demás |
| **Auditoría previa** | Orden real verificada en Linux: `gate_intencion` → `gate_resultado` y `colector_intencion` → `colector_resultado`; sin poder registrar la intención no se ejecuta nada, no se consume cupo y la petición del colector se conserva |
| **Separación de privilegios repetida** | El usuario sin privilegios sigue sin poder modificar la instalación, escribir en informes, leer el secreto de root, listar peticiones ni volver a root; **y además no puede borrar ni renombrar** `gate-audit.log` ni `collector-audit.log`. Flujo completo con el colector con solo `CAP_DAC_READ_SEARCH`: correcto |
| **`build-workflows --check`** | En verde (8 de 8); `src/` y `automation/workflows` sin cambios |
| **Nada modificado fuera de lo previsto** | Huella de la copia montada **idéntica** antes y después; contenedores existentes (incluidos `tai-dt-*`) sin cambios y ninguno en ejecución; ninguna imagen nueva; configuración de Docker aislada con **0** archivos; sin conexión al VPS |

### 10.3 Archivos modificados o creados en esta corrección (todos en `automation/inspeccion/`)
`tai_inspect/collector.py` (H1, H5) · `tai_inspect/gate.py` (H4, H5) · `bin/tai-gate` (H4) · `tests/test_regresion_h1_h4_h5.py` (nuevo, 18 pruebas) · `tests/test_linux_real.py` (3 pruebas nuevas + comprobaciones ampliadas) · `tests/test_colector_y_flujo.py` (nombre del evento del colector). Además, documentación: este documento, `INSPECCION-ETAPA-0-INFORME.md`, `automation/inspeccion/LEEME.md`, `AGENTS.md` y `estructura*.txt`.
**Huella SHA-256 del manifiesto del producto:** `40f5a3f311baaa86a0263c0d298c14e7dc692f6e800bf83324f3637bd8522b56` · **huella del código y plantillas** (25 archivos de `tai_inspect/`, `bin/` y `deploy/`, los que se ejecutaron en la validación Linux): `023fef4ceff12da31a7069fa22e32133b64d74f36ae1b99670de9280dbdfa892` (28 archivos).

### 10.4 Lo que sigue sin validar y límites
Sin cambios respecto a §7, salvo: la **inmutabilidad** del registro del gate frente a su propio usuario no puede probarse en `tmpfs` (hará falta `chattr +a` y verificarlo en el VPS) y la copia en `syslog`/`journald` no se ha podido contrastar sin un demonio de registro en el contenedor.

## 11. Revisión independiente (R1–R5) y revalidación completa (13/11/2026)
Autorizada por el propietario; solo en `automation/inspeccion/`. Mismas imágenes (`python:3.8-slim`, `python:3.12-slim`; **no se descargó nada**), contenedores efímeros `--rm`, `--network none`, `--cap-drop ALL` (solo las capacidades indicadas), `no-new-privileges`, copia del producto montada en solo lectura, sin socket de Docker y con configuración de Docker vacía. Descripción de los cambios y decisiones en `INSPECCION-ETAPA-0-INFORME.md` §9.

### 11.1 Resultados exactos (idénticos en Python 3.8 y 3.12)
| Ejecución | Pruebas | Correctas | Fallidas | Omitidas |
|---|---|---|---|---|
| Windows (referencia) | 186 | 157 | 0 | 29 (solo Linux) |
| **A. Linux, usuario sin privilegios (uid 10001)** — **3.8** | 186 | **177** | **0** | 9 (8 de separación de privilegios + `chattr`) |
| **A.** — **3.12** | 186 | **177** | **0** | 9 |
| **C. Linux, root con solo `CHOWN`, `FOWNER`, `FSETID`, `SETUID`, `SETGID`, `DAC_READ_SEARCH`** — **3.8** | 186 | **176** | **0** | 10 (las 9 del usuario sin privilegios ya ejecutadas en A + `chattr`) |
| **C.** — **3.12** | 186 | **176** | **0** | 10 |
| **D. `chattr +a` real** (`CAP_LINUX_IMMUTABLE`): D1 volumen ext4, D2 overlayfs, D3 tmpfs — **3.8 y 3.12** | 1 en cada una | **1 en cada una (6 de 6)** | **0** | **0** (se habría omitido con el motivo si el sistema no lo admitiera) |
| **Total combinado — Python 3.8** | **186** | **186** | **0** | **0** |
| **Total combinado — Python 3.12** | **186** | **186** | **0** | **0** |
Entorno: kernel `6.18.33.2-microsoft-standard-WSL2` (Docker Desktop); `/chattr-test` en ext4 (volumen anónimo), `/` en overlay y `/chattr-tmp` en tmpfs.
Primera ejecución de esta revisión: **fallaron** 1 prueba (no hermética: leía el `validaciones.json` real de la copia) y 6 por una limpieza de la propia prueba (root sin `DAC_OVERRIDE` no puede borrar en el directorio del gate, lo cual es correcto). Se corrigieron las **pruebas**, no el producto; la segunda ejecución pasó completa.

### 11.2 Separación de privilegios repetida
Como uid 10001, **denegado**: modificar la instalación, escribir en `reports/`, leer el secreto de root, listar `requests/`, volver a root, borrar o renombrar los registros, y ahora además **listar o escribir `staging/`, listar o escribir `collector-state/` (cupo y ancla) y escribir `validaciones.json`**. Con procesos reales: el gate (uid 10001) y el colector (root con solo `CAP_DAC_READ_SEARCH`) completan el flujo; el informe llega como `root:tai-inspect` `0640`, `staging` queda vacío, el informe lleva `peticion` (32 hex) y el colector registra `colector_intencion` → `colector_resultado` → `colector_publicacion`. **El usuario sin privilegios reescribe su `gate-audit.log` (por permisos puede) y el colector, en la pasada siguiente, registra `historial_modificado` y conserva el ancla previa.** Cuatro peticiones creadas directamente sin pasar por el gate: una sola ejecución, tres `intervalo_minimo`. Un informe ajeno ya presente (`peticion` distinta) **no se entrega**.

### 11.3 Verificaciones obligatorias
| Verificación | Resultado |
|---|---|
| Código idéntico al validado | Huella de código y plantillas de la copia montada = la del repositorio: `da3b63cf8dab320a43514b24e94d05f165116ac386047ec7c3f701859c7af3d9` (28 archivos) |
| Nada modificado | Huella de toda la copia **idéntica** antes y después (`306665c2…ba1e`); imágenes y contenedores (incluidos `tai-dt-*`, sin ninguno en ejecución) **sin cambios**; ninguna imagen nueva; configuración de Docker aislada; sin conexión al VPS |
| `build-workflows --check` | En verde (8 de 8); `src/` y `automation/workflows` sin cambios; la lista de archivos modificados del repositorio es la misma que al empezar la sesión |
| Sin nuevos comandos ni permisos | `runner.SPECS` sigue con 17 especificaciones y los mismos 7 ejecutables; unidad `systemd` sin cambios de capacidades (solo `CAP_DAC_READ_SEARCH`) |

### 11.4 Lo que sigue sin validar y límites
Todo lo de §7, y además: `chattr +a` **en el VPS** (distinto kernel y sistema de archivos), la **copia en `syslog`/`journald`** (sin demonio de registro en el contenedor), el **temporizador** de anclaje (sin `systemd`), `staging` y `os.replace` sobre el sistema de archivos real del VPS y las 11 comprobaciones sensibles con **datos reales** (permanecen deshabilitadas).

### 11.5 Cómo repetirlo
`automation/inspeccion/tests/` se ejecuta como en §8; el procedimiento exacto de esta revisión (copia fresca, A, C, D1–D3, huellas y comprobaciones de no modificación) está en un script de trabajo fuera del repositorio; las órdenes son las de §8 más `--cap-add LINUX_IMMUTABLE --cap-add SETUID --cap-add SETGID -v /chattr-test ... python -m unittest -v test_linux_real.ChattrAppendReal`.

## 12. Plantillas SSH (P1–P5) y revalidación completa (14/11/2026)
Autorizada por el propietario; solo plantillas y pruebas locales en `automation/inspeccion/`. Imágenes **ya existentes** (`python:3.8-slim`, `python:3.12-slim` y, para OpenSSH, la imagen local de n8n basada en Alpine, que incluye `sshd`): **no se descargó ni se instaló nada**. Contenedores efímeros `--rm`, `--network none` (solo `127.0.0.1` dentro del contenedor), `no-new-privileges`, capacidades mínimas, copia del producto montada en solo lectura, sin socket de Docker y con configuración de Docker vacía. Descripción de los ajustes en `INSPECCION-ETAPA-0-INFORME.md` §10.

### 12.1 Resultados exactos (idénticos en Python 3.8 y 3.12)
| Ejecución | Pruebas | Correctas | Fallidas | Omitidas |
|---|---|---|---|---|
| Windows (referencia) | 190 | 159 | 0 | 31 (solo Linux) |
| **A. Linux, usuario sin privilegios (uid 10001)** — **3.8** | 190 | **179** | **0** | 11 (10 de separación de privilegios + `chattr`) |
| **A.** — **3.12** | 190 | **179** | **0** | 11 |
| **C. Linux, root con solo `CHOWN`, `FOWNER`, `FSETID`, `SETUID`, `SETGID`, `DAC_READ_SEARCH`** — **3.8** | 190 | **180** | **0** | 10 (9 del usuario sin privilegios + `chattr`) |
| **C.** — **3.12** | 190 | **180** | **0** | 10 |
| **D. `chattr +a` real** (`CAP_LINUX_IMMUTABLE`; ext4, overlayfs y tmpfs) — 3.8 y 3.12 | 1 en cada una | **6 de 6** | **0** | **0** |
| **Total combinado — Python 3.8** | **190** | **190** | **0** | **0** |
| **Total combinado — Python 3.12** | **190** | **190** | **0** | **0** |
| **Banco SSH real** (`tests/ssh/prueba_ssh.sh`, OpenSSH 10.3p1, `sshd` temporal en `127.0.0.1:2222`) | 64 comprobaciones | **64** | **0** | — |
Prueba de sensibilidad del banco SSH: 4 mutaciones de la plantilla → **las 4 detectadas** (15, 2, 2 y 2 comprobaciones fallidas).
Incidencias durante la preparación (pruebas, no producto): una directiva de la plantilla (`PermitUserEnvironment`) era inválida dentro de `Match` y se retiró; una prueba suponía lanzadores ejecutables en un `tmpfs` `noexec`; `ssh-add` reintentaba sin fin con una passphrase incorrecta; OpenSSH 10 cortó conexiones por penalización de origen (se desactiva solo en el `sshd` temporal de la prueba).

### 12.2 Pruebas nuevas de Linux real (como uid sin privilegios)
- `test_el_usuario_no_puede_cambiar_sus_claves_ni_su_directorio_de_inicio`: añadir, reescribir, borrar, renombrar y cambiar el modo de la clave autorizada de root; escribir, crear `.ssh` y cambiar el modo del directorio de inicio; crear archivos junto a la clave → **10 de 10 denegadas**; la clave y el home quedan intactos.
- `test_el_gate_invocado_como_lo_hace_sshd_no_da_shell_ni_ejecuta_nada`: el gate real invocado con `/bin/sh -c`, con 9 órdenes hostiles en `SSH_ORIGINAL_COMMAND` y **comandos por la entrada estándar** → código 2 `orden no permitida`, sin error estándar, sin contenido del archivo secreto; una sesión sin orden también se rechaza; `solicitar host-tiempo` sí funciona.

### 12.3 Verificaciones obligatorias
| Verificación | Resultado |
|---|---|
| Código idéntico al validado | Huella de código y plantillas de la copia montada = la del repositorio: `2096f3e6db13ea46182a92471671a923b18c9f788991cfe6cf61c3632ade30fb` (29 archivos) |
| Nada modificado | Huella de toda la copia **idéntica** antes y después (`44d96ef1…f71d`); imágenes **sin cambios**; los 10 contenedores previos (incluidos los de prueba del autor) intactos y **ninguno en ejecución**. Cuatro contenedores **propios** de esta validación quedaron en ejecución tras interrumpir ejecuciones de depuración con `timeout`; se detuvieron y se eliminaron (`--rm`) |
| `build-workflows --check` | En verde (8 de 8); `src/` y `automation/workflows` sin cambios; los archivos versionados modificados son los mismos 16 que al empezar la sesión |
| Sin nuevos comandos ni permisos | `runner.SPECS` sin cambios (17 especificaciones, 7 ejecutables); unidad `systemd` sin cambios de capacidades |
| Sin conexión al VPS ni credenciales reales | Claves, usuarios y passphrase **ficticios** creados dentro del contenedor |

### 12.4 Lo que sigue sin validar y límites
Todo lo de §7 y §11.4, y además: `sshd -t` y `sshd -T -C` con **OpenSSH 9.6p1 y la configuración real del VPS** (hay que repetirlos antes de recargar); ruta **PAM** (`UsePAM yes`) de Ubuntu; el encabezado `#!/usr/bin/python3 -I`; `systemd-analyze` de las tres unidades.

### 12.5 Cómo repetirlo
Como en §8 y §11.5, más el banco SSH: contenedor con `sshd` y capacidades `SETUID`, `SETGID`, `SYS_CHROOT`, `CHOWN`, `FOWNER`, `DAC_OVERRIDE`, `KILL`, `AUDIT_WRITE`, sin red, con el producto montado en `/work` (solo lectura) y `sh /work/tests/ssh/prueba_ssh.sh`.
