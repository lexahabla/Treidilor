# Inspección automática del VPS — Informe de la ETAPA 0 (desarrollo y pruebas locales)

> **Estado (13/11/2026): ETAPA 0 COMPLETADA, VALIDADA EN LINUX y con los hallazgos H1, H4 y H5 CORREGIDOS** (ver §8 y `INSPECCION-ETAPA-0-VALIDACION-LINUX.md` §10: **149 de 149 pruebas** en Python 3.8 y en 3.12). **La etapa 1 NO ha comenzado y requiere autorización expresa.** Las cifras de los apartados 1 a 7 son las de la primera entrega (110 pruebas) y se conservan como histórico.
> Todo se ha hecho **solo en local con datos simulados**: sin conexión al VPS, sin usuarios ni claves, sin servicios instalados, sin tocar el
> firewall ni EasyPanel, sin credenciales reales, sin red, sin Docker, sin instalar dependencias (solo biblioteca estándar de Python 3.14 ya
> instalada), sin commits ni pushes. Código en `automation/inspeccion/` (nuevo; ningún otro módulo del producto se ha modificado).

## 1. Qué se ha construido
| Componente | Archivo | Función |
|---|---|---|
| Gate | `tai_inspect/gate.py` | Única orden de la clave SSH: solo `solicitar <nombre>` / `leer <nombre>` de una lista cerrada y habilitada |
| Colector | `tai_inspect/collector.py` | Único componente privilegiado (futuro): procesa peticiones y deja informes saneados |
| Ejecutor | `tai_inspect/runner.py` | Tabla cerrada de comandos fijos de solo lectura; `shell=False`; entorno mínimo; límites de tiempo y tamaño |
| Filtro de secretos | `tai_inspect/redact.py` | 14 familias de patrones + claves sensibles + entropía + IP pública; descarta el informe entero |
| Auditoría | `tai_inspect/audit.py` | Solo campos permitidos, saneados, IP enmascarada, sin contenido |
| Límites | `tai_inspect/limits.py`, `config.py` | Cupo diario (60), intervalo mínimo, 1 simultánea, tiempos, 64 KiB |
| Rutas seguras | `tai_inspect/pathsafe.py` | Sin recorrido de directorios, sin enlaces simbólicos, tamaño máximo, escritura atómica |
| Integridad | `tai_inspect/manifest.py` | Manifiesto SHA-256 del propio sistema |
| Comprobaciones | `tai_inspect/checks/` | Las 18 de la lista cerrada (host, Docker, SSH, integridad, n8n/PostgreSQL, registros, auditoría) |
| Lanzadores y plantillas | `bin/`, `deploy/` | `tai-gate`, `tai-collector`, `tai-manifest`; `sshd Match`, `authorized_keys` (marcador), unidades `systemd` |
32 archivos de producto, 12 archivos de prueba (190 pruebas, más el banco SSH `tests/ssh/prueba_ssh.sh`). Huella SHA-256 del manifiesto del producto (sin pruebas), **vigente tras los ajustes P1–P5 (§10)**:
`29377eb4432fa30223315344a4408114b3f8308c263c45759f9ff187ac6bcae6` · **huella del código y plantillas** (29 archivos de `tai_inspect/`, `bin/` y `deploy/`, los que se ejecutaron en la validación Linux): `2096f3e6db13ea46182a92471671a923b18c9f788991cfe6cf61c3632ade30fb`. Anteriores: tras R1–R5 `be31280b…a45f9` / `da3b63cf…af3d9`; tras H1/H4/H5 `40f5a3f3…2b56` / `023fef4c…a892`; primera entrega `69612c2e…4b11a` (código) (a contrastar al revisar).

## 2. Resultados de las pruebas
**110 pruebas, todas correctas; 4 omitidas** (no se pueden ejecutar en Windows, ver §4). Comando: `python -W error::SyntaxWarning -m unittest discover -s tests` desde `automation/inspeccion`.

| Requisito de la etapa 0 | Pruebas | Resultado |
|---|---|---|
| **Lista cerrada de comandos, sin argumentos arbitrarios** | 18 comprobaciones; solo 2 verbos; nombres de lista; comprobaciones deshabilitadas o inexistentes rechazadas; ningún comando fuera de la tabla del ejecutor | ✔ |
| **Rechazo de comandos desconocidos o manipulados** | 81 órdenes manipuladas (metacaracteres, saltos de línea, Unicode, mayúsculas, `-h`, `scp`, `sftp`, `rsync`, `sh -c`, `docker …`, 10 000 caracteres…) → todas `orden no permitida`, **sin ejecutar nada, sin crear peticiones, sin repetir la entrada**; fuzz de 4 000 cadenas + mutaciones de órdenes válidas | ✔ |
| **Protección contra inyección** | Argumentos del ejecutor validados con expresión estricta y pasados como un solo elemento de `argv`; prueba real de que `a;b&&c\|$HOME` se trata como texto; identificadores SQL con prefijo fijo (`data_table_user_…`) y consultas fijas; ningún intérprete de órdenes (análisis estático del código con `ast`) | ✔ |
| **Sin lectura de archivos fuera de las rutas autorizadas** | Recorrido de directorios (`../`, `\`, `%2e%2e`, nulo), nombres de petición inválidos, ficheros grandes o no regulares, el contexto solo lee 5 archivos y 2 discos de una lista (cualquier otra clave → error) | ✔ (enlaces simbólicos: ver §4) |
| **Filtrado de secretos con credenciales ficticias** | 14 tipos (Bearer, token propio, JWT, GitHub, `sk-`, AWS, Slack, clave privada, URL con credenciales, asignaciones, correo, hash largo, alta entropía, IP pública) detectados en valores, anidados, claves y texto; los hallazgos **nunca contienen el secreto**; el informe con secreto se **descarta entero** y el informe de error resultante está limpio; secretos sembrados en salidas de Docker simuladas no llegan al informe; contenido legítimo (versiones, imágenes, hashes en campos de huella, IP privadas) **no** se marca | ✔ |
| **Límites de tiempo, tamaño, frecuencia y concurrencia** | Proceso real que se pasa de tiempo → muerto; salida infinita → cortada a 5 000 B; 64 KiB; cupo diario exacto de 60 y renovación a medianoche UTC; intervalo mínimo por comprobación; las rechazadas no consumen cupo; 15 hilos simultáneos → exactamente el cupo; una sola petición simultánea; bloqueo huérfano caduca; tiempo total del colector | ✔ |
| **Auditoría sin información sensible** | Campos no permitidos descartados; saltos de línea y secretos neutralizados; IP del cliente enmascarada (`a.b.c.x`); sin contenido de informes; solo-añadir; líneas acotadas | ✔ |
| **Pruebas negativas y comportamiento ante errores** | Archivos de ajustes dañados (falla cerrado: nada habilitado); servicios con nombres peligrosos ignorados; excepciones sin filtrar mensajes ni trazas; directorios ilegibles; escritura fallida; comando que falla → aviso, no caída; informe enlazado/manipulado/enorme/no JSON no se imprime; colector parado → `sin respuesta` y retirada de la petición; un informe antiguo no se toma por la respuesta a una petición nueva | ✔ |
| **Ausencia de modificaciones sobre producción** | Análisis estático: sin módulos de red, sin ejecución dinámica, sin `shell=True`, `subprocess` solo en el ejecutor, `open(…,'w')` solo en la utilidad de manifiesto, borrado solo donde corresponde, sin `mkdir/chmod/chown/rename/symlink`, sin variables de entorno leídas salvo las dos de `sshd`; **todos** los comandos Docker de lectura con `--format` fijo y ninguno es `inspect`; único `docker exec` = PostgreSQL con `default_transaction_read_only=on` y `statement_timeout`; consultas SQL sin `SELECT *`, sin `payload` ni credenciales, sin escrituras | ✔ |
| **Plantillas de despliegue** | `sshd Match` con solo directivas válidas, sin TTY/reenvíos/contraseña; `authorized_keys` con `restrict`+`command=` y clave **marcador**; unidad `systemd` con aislamiento (`NoNewPrivileges`, `ProtectSystem=strict`, `AF_UNIX`, `IPAddressDeny=any`, …) | ✔ (validación sintáctica real pendiente, §4) |
| **Integridad** | Manifiesto SHA-256: detecta modificado, añadido, borrado, enlace simbólico (omitida), permisos (omitida) | ✔ |

### 2.1 Prueba de sensibilidad de las pruebas (mutaciones)
Para saber si las pruebas **detectan** fallos, se introdujeron **18 defectos deliberados** en una copia temporal (p. ej. aceptar cualquier orden, desactivar el filtro de secretos, `shell=True`, quitar el cupo, permitir `docker inspect`, quitar la sesión de solo lectura, no enmascarar IP, imprimir sin refiltrar). **Las 18 se detectan** tras corregir dos debilidades propias (§3).

## 3. Problemas encontrados y resueltos
| # | Problema | Cómo se encontró | Solución |
|---|---|---|---|
| P1 | Las expresiones con `^…$` y `match` **aceptaban un salto de línea final** (`x.json\n`): nombres y orden podían colarse con un `\n` | Prueba de nombres manipulados | Todas las validaciones usan `fullmatch` |
| P2 | Una prueba de «comprobación no habilitada» **no habría detectado** que se ejecutara (la comprobación elegida no hace llamadas sin configuración) | Prueba de mutaciones | La prueba usa una comprobación que sí llamaría al ejecutor y comprueba que no hay llamadas ni informe |
| P3 | Una de las mutaciones caía en un docstring y no en el código | Prueba de mutaciones | Mutación reubicada en la llamada real |
| P4 | Las direcciones de documentación (TEST-NET) se clasifican como privadas en Python: una prueba esperaba «pública» | Prueba de red | Datos de prueba con una dirección realmente global |
| P5 | Falso positivo del análisis estático (`re.compile` confundido con `compile()`) | Prueba estática | Se distingue la función integrada de `re.compile` |
| P6 | Una mutación con `shell=True` dejó un proceso hijo de prueba huérfano (30 s) | Revisión de procesos | Se detuvo ese proceso (propio) y las rutas temporales se aíslan por mutación |

## 4. Limitaciones y lo que NO se ha verificado
**No verificado (requiere Linux real o el propio VPS):**
1. **Salidas reales de los comandos.** Los analizadores se prueban con salidas **simuladas** del formato esperado (`ss -H -tuln`, `systemctl`, `apt list`, `timedatectl`, `docker … --format`, `sshd -T`, `auth.log`, `journalctl`, `psql -At -F|`). Los formatos reales pueden diferir; el diseño falla de forma segura (ignora lo que no encaja), pero habrá que validarlo en la etapa 3.
2. **Enlaces simbólicos, `O_NOFOLLOW` y permisos POSIX:** 4 pruebas **omitidas** en Windows (sin privilegio para enlaces simbólicos; sin permisos POSIX). Hay que repetirlas en Linux.
3. **Plantillas `sshd` y `systemd`:** solo se comprueban como texto. No se ha ejecutado `sshd -t` ni `systemd-analyze verify/security`; en particular: la compatibilidad de `MemoryDenyWriteExecute`, `PrivateDevices` y `CapabilityBoundingSet=CAP_DAC_READ_SEARCH` con el acceso al socket de Docker y la lectura de `auth.log`, y el comportamiento de `DirectoryNotEmpty` con los temporales.
4. **Entorno del VPS:** no se sabe si hay `python3` (versión ≥ 3.8), ni las rutas de `ss`, `apt`, `timedatectl`, `journalctl`, `sshd`, ni la versión de Docker/Swarm/systemd.
5. **Esquema de n8n** (`data_table`, `workflow_entity`, `execution_entity` y sus columnas) **supuesto** a partir de pruebas locales anteriores; las consultas están aisladas y fallan con aviso, pero no se han contrastado con n8n 2.38.6 de producción.
6. **Nombres de servicios** de Swarm (n8n, runner, PostgreSQL): no se conocen; se leerán de `ajustes.json` tras identificarlos.
7. **Normalización de registros:** es heurística (enmascara correos, IP, tokens, números, identificadores y textos entre comillas); nombres propios sin comillas podrían sobrevivir. Por eso `registros-resumen` es la última etapa y se validará con muestras reales **bajo supervisión**.
8. **Filtro de secretos:** falla **hacia el descarte**; puede producir falsos positivos (p. ej. alta entropía en nombres largos) que habrá que afinar con salidas reales sin bajar la seguridad.
9. **No hay cliente local** (envoltorio, alias SSH, reglas de permisos de Claude Code, `ssh-agent`): es la etapa 6.

**Observaciones de diseño (para decidir):**
- Cada llamada al gate (incluida `leer`) cuenta para el cupo de 60/día; una consulta típica `solicitar`+`leer` consume 2. Propuesta: que `leer` no cuente para el cupo diario o subir el cupo; no se ha cambiado el valor aprobado.
- El estado de cupos y el registro del gate pertenecen al usuario restringido: una clave comprometida podría reiniciarlos, pero solo puede invocar el gate (sin privilegios). El registro del sistema (`syslog`) es la copia no manipulable por ese usuario.
- La unidad `.path` se dispara también con los temporales de escritura atómica; el colector los ignora (nombres que empiezan por `.`). Hay que confirmar en etapa 3 que no provoca ráfagas (se limita con `TriggerLimitBurst`).

## 5. Qué se ha comprobado que NO ha ocurrido
Sin conexiones a ningún servidor; sin red; sin Docker; sin instalaciones; sin credenciales reales (solo cadenas ficticias construidas en las pruebas); sin cambios en
`src/`, workflows, `scripts/`, firewall, EasyPanel, usuarios, claves ni servicios; sin commits ni pushes. `build-workflows --check` sigue en verde y los workflows
de los Agentes 04 y 12 no cambian.

## 6. Condiciones para autorizar la etapa 1
La etapa 1 son **verificaciones de solo lectura en el VPS con tu sesión** (sin crear nada). Antes de lanzarla conviene decidir:
1. **Revisión del código** por tu parte (hay un manifiesto con su huella) y, si procede, cambios.
2. **Cómo validar lo que Windows no permite** (§4.2 y §4.3). Opciones: (a) **contenedor Linux local aislado** (requiere tu autorización para arrancar Docker local y descargar una imagen pequeña; permite repetir las 4 pruebas omitidas y ejecutar los analizadores con salidas reales de herramientas Linux, aunque no un Swarm real); (b) validar directamente en el VPS durante las etapas 1-3; (c) ambas. **No he hecho nada de esto sin consultarte.**
3. **Alcance de la etapa 1** (lista de comprobaciones de lectura): versión y ruta de `python3`, SO, versión de `sshd` y `PermitUserEnvironment`, disponibilidad de `ss/apt/timedatectl/journalctl`, existencia de `auth.log`, versión de Docker y de `systemd`, nombres de los servicios de Swarm, y los **cuatro comandos de privilegios** de la conexión SSH actual. Ninguna requiere cambios.
4. **Política de cupo** (si `leer` cuenta o no) y confirmación de los límites aprobados.
5. **Ubicación local** de los informes (`automation/reports/inspeccion/`, ya ignorada por git).
6. **Método de la clave**: está decidido (passphrase + `ssh-agent`), pero **no se genera nada** hasta la etapa 2; el servicio `ssh-agent` de Windows sigue deshabilitado y habilitarlo será un cambio local que pediré autorizar entonces.

## 7. Cómo reproducir
`cd automation/inspeccion && python -W error::SyntaxWarning -m unittest discover -s tests` → `Ran 110 tests … OK (skipped=4)`. Más detalle en `automation/inspeccion/LEEME.md`.

## 8. Correcciones posteriores a la validación Linux (H1, H4, H5) — 13/11/2026
Autorizadas por el propietario y aplicadas **solo** en `automation/inspeccion/` (sin tocar `src/`, workflows ni otros módulos). Detalle de la revalidación en `INSPECCION-ETAPA-0-VALIDACION-LINUX.md` §10.

| Hallazgo | Cambio | Archivos |
|---|---|---|
| **H1** — una petición hostil (enlace simbólico) detenía el colector | `safe_join` pasa **dentro** del `try` y la petición inválida se descarta (borrado sin seguir enlaces) y se registra solo como `peticion_invalida`; además cada petición se **aísla**: una excepción inesperada se registra solo con el **tipo** de la excepción, se descarta esa petición y la pasada continúa con las demás | `tai_inspect/collector.py` |
| **H4** — traceback visible para el cliente SSH si falla la auditoría | `Gate.handle()` **nunca lanza excepciones**; todo fallo devuelve únicamente `error interno` con un código definido (8 = error interno, 9 = auditoría obligatoria no disponible); el punto de entrada descarta el error estándar (`dup2` a `/dev/null`), usa `os._exit` y el lanzador responde `error interno` (8) incluso si el paquete no se puede importar | `tai_inspect/gate.py`, `bin/tai-gate` |
| **H5** — auditoría previa obligatoria | El gate registra la **intención** (`gate_intencion`) **antes** de tocar cupo, bloqueo, petición o comprobación; si no puede registrarla **no ejecuta nada** (código 9, sin consumir cupo). Después registra el **resultado** (`gate_resultado`), tanto si termina bien como si falla; si falla el registro del resultado de una comprobación correcta, **no se entrega el informe**. El colector hace lo mismo (`colector_intencion` / `colector_resultado`): sin auditoría no ejecuta y **conserva** las peticiones | `tai_inspect/gate.py`, `tai_inspect/collector.py` |

**Decisiones de detalle que he tomado (revísalas):** (1) las órdenes rechazadas, el interruptor `DISABLED` y las no habilitadas se auditan «en el mejor esfuerzo» (no ejecutan nada, así que un fallo de registro no las bloquea); (2) un fallo al registrar el resultado de una comprobación correcta **retiene el informe** (cierra hacia el lado seguro); (3) los eventos de auditoría cambian de nombre (`gate_intencion`, `gate_resultado`, `colector_intencion`, `colector_resultado`, `peticion_descartada`, `error_peticion`).

**Pruebas añadidas:** 18 de regresión (`tests/test_regresion_h1_h4_h5.py`) y 3 de Linux real para H4 y la secuencia de auditoría; la prueba de enlaces simbólicos hostiles ahora comprueba además que una petición **legítima posterior** se atiende. Total: **149 pruebas**.

**Resultado:** 149 de 149 en Python 3.8 y 3.12 (ver la validación Linux). **Nueva huella SHA-256 del manifiesto del producto:** `40f5a3f311baaa86a0263c0d298c14e7dc692f6e800bf83324f3637bd8522b56` (28 archivos; la anterior era `69612c2e3d0ec77aaafb182e6129152ab8a52822868dd5999d18672fca14b11a`). `build-workflows --check` en verde; sin cambios en `src/` ni en los workflows.

**Sobre «registros no manipulables desde el usuario restringido»:** verificado que ese usuario **no puede** borrar, renombrar ni crear registros en `/var/log/tai-inspect`, ni modificar el registro del colector, ni escribir en la instalación o en los informes. **Limitación honesta:** `gate-audit.log` pertenece al propio usuario restringido (necesita añadir líneas), de modo que ese usuario **podría truncarlo o reescribirlo**; el sistema de archivos del contenedor (`tmpfs`) no admite el atributo de solo-añadir. Mitigaciones previstas para la etapa 2: `chattr +a` sobre ese archivo (a verificar en el VPS), la copia en `syslog`/`journald` que el usuario no puede alterar (ya se escribe) y, como mejora opcional, encadenar con hash las líneas. Hoy el único código que escribe en ese archivo es el gate, que solo añade líneas saneadas (comprobado por análisis estático: una sola apertura con `O_APPEND` y sin `O_TRUNC`).

## 9. Correcciones de la revisión independiente (R1–R5) — 13/11/2026
La revisión independiente (ChatGPT) mantuvo la arquitectura D y señaló cinco problemas a resolver **antes** de instalar nada. El propietario autorizó **exclusivamente** correcciones locales en `automation/inspeccion/`. No se ha conectado al VPS, no se han creado usuarios ni claves, no se ha tocado SSH, el cortafuegos, EasyPanel, `src/`, los workflows ni otros módulos, no se ha descargado ni instalado nada y no se han hecho commits ni pushes. **No se avanza a la etapa 1.**

| # | Problema señalado | Corrección | Archivos |
|---|---|---|---|
| **R1** | Un informe podía quedar disponible sin que su resultado estuviera registrado | El informe se prepara en `staging` (`root:tai-inspect` `2700`, ilegible para el gate), se registra `colector_resultado` y **solo entonces** se publica con `os.replace` (atómico, mismo sistema de archivos); después se registra `colector_publicacion`. Si el resultado no se puede registrar (disco lleno, permisos…): no se publica, se borra el borrador y **la petición se conserva**. Si falla la escritura del borrador o el renombrado: nada visible, resultado `escritura_fallida` / publicación `fallida`. Los restos en `staging` tras una interrupción se retiran en la pasada siguiente y **nunca se publican** | `collector.py`, `pathsafe.py` (`write_exclusive`, `O_EXCL`+`O_NOFOLLOW`+`fsync`) |
| **R2** | La petición y el informe se emparejaban por fecha | Cada petición lleva un identificador único (nombre del archivo, **32 hexadecimales aleatorios** que genera el gate). El informe incluye `peticion` y el gate solo entrega el informe con **su** identificador **y** su comprobación. Un informe anterior, ajeno, de otra petición concurrente o de otra comprobación no se entrega. Se mantiene la validación estricta (`fullmatch` + `realpath`) de nombres y rutas. Se eliminó el emparejamiento por fecha (`calendar`, `_epoch`) | `gate.py`, `informe.py`, `collector.py` |
| **R3** | `Cuota`/`Bloqueo` viven en un directorio del usuario restringido | Ver análisis siguiente. El colector aplica **sus propios** cupo diario, intervalo mínimo (la mitad del del gate) y tope de pendientes con estado en `collector-state` (`root:root` `0700`), sin dar privilegios nuevos al gate | `collector.py`, `limits.py`, `config.py` |
| **R4** | El usuario restringido podría reescribir su propio historial | `seq` correlativo asignado solo por el módulo de auditoría; **anclas** (tamaño, último `seq`, SHA-256 del prefijo verificado) guardadas por el colector en `collector-state`; detección de modificación, truncado, borrado y huecos. `chattr +a` se **prueba de verdad** (§9.3) y no se presupone. Copia en `syslog`/`journald` como evidencia complementaria | `audit.py`, `ancla.py` (nuevo), `fsattr.py` (nuevo, solo lectura), `checks/sistema.py`, `deploy/systemd/tai-collector.timer` (nuevo) |
| **R5** | Salidas de Docker, PostgreSQL y registros | 11 comprobaciones marcadas `sensible` siguen **deshabilitadas** aunque estén en `enabled.json` hasta que exista su entrada (con la huella de la muestra validada) en `validaciones.json`; el resumen de registros solo **muestra** plantillas de una lista permitida (el resto solo se **cuenta**). No se añadió ningún comando ni permiso | `config.py`, `checks/logs.py` |

### 9.1 Análisis R3: qué podría manipular quien comprometa al usuario restringido
| Superficie | Qué puede hacer | Protección |
|---|---|---|
| `state/` (cupo y bloqueo del gate) | Borrarlos o reiniciarlos: saltarse los límites **del gate** | El colector tiene los **suyos** en `collector-state`, ilegible e intocable para ese usuario; las peticiones creadas sin pasar por el gate cuentan igual |
| `requests/` (puede crear archivos) | Inundar con peticiones, enlaces simbólicos, nombres malformados | Nombres validados con `fullmatch`; enlaces y entradas inválidas descartados sin seguirlos; a partir de **200** pendientes el exceso se descarta; máximo 5 por pasada; cupo e intervalo propios |
| `reports/` | Nada (no escribe) | `root:tai-inspect` `2750` |
| `staging/`, `collector-state/` | Nada (no los ve) | `2700` y `0700` (probado como uid sin privilegios en Linux) |
| `gate-audit.log` (es su propietario) | Reescribirlo o truncarlo | Anclas + `seq` + copia en `syslog` + `chattr +a` si se prueba (R4) |
| Informes ajenos o antiguos | Colocarlos para que el gate los entregue | Imposible escribir en `reports/`; además el gate exige el identificador de **su** petición |

**Riesgo residual aceptado y declarado:** quien tenga la clave puede **agotar el cupo diario del colector** (60) con peticiones directas, impidiendo inspecciones legítimas ese día. Es denegación de servicio sobre la propia inspección, queda **auditada** (`limite_diario`/`intervalo_minimo`) y no abre acceso a nada; se acepta porque la alternativa (ceder privilegios al gate) es peor.

### 9.2 Límites de la integridad del historial (R4)
- Lo **anclado** no se puede alterar sin que el colector lo detecte (`historial_modificado`, `registro_truncado`, `registro_ausente`). Al detectar una alteración **se conserva el ancla anterior**: la alarma persiste y no se «normaliza» el historial alterado.
- Lo escrito **después** del último ancla puede alterarse hasta el siguiente pase: ventana = intervalo entre pases (el temporizador propuesto es de **15 min**), salvo huecos o repeticiones de `seq`.
- Un atacante que **reescriba y recalcule** todo antes del siguiente ancla no se detecta por el ancla: queda la copia en `syslog`/`journald` (no contrastada en el contenedor por no haber demonio de registro).
- La rotación del registro es una **acción deliberada de root** que debe retirar también el ancla (`collector-state/ancla-gate.json`); si no, el colector avisará de truncado. Con `chattr +a` activo, rotar exige `chattr -a` previo. Pendiente de documentar en el procedimiento de la etapa 2.
- El registro se verifica hasta **4 MiB** (`MAX_AUDIT_BYTES`); más allá avisa `registro_no_verificable`.

### 9.3 `chattr +a`: resultado de la prueba real (no presupuesto)
Con `FS_IOC_SETFLAGS` y `CAP_LINUX_IMMUTABLE` en contenedores efímeros (kernel **6.18.33.2-microsoft-standard-WSL2**, Python 3.8 y 3.12): **funcionó en ext4 (volumen), overlayfs (sistema de archivos del contenedor) y tmpfs**. Con el atributo activo: añadir líneas sigue funcionando; **truncar, reescribir, borrar y renombrar fallan incluso para root** (EPERM); el usuario sin `CAP_LINUX_IMMUTABLE` no puede quitarlo; `fsattr.solo_anadir()` lo detecta. **Límite:** esto prueba el comportamiento del kernel de Docker Desktop, **no el del VPS**. Antes de confiar en él en producción hay que repetir la prueba en el VPS con un **archivo de muestra** (sistema de archivos, kernel y rotación de registros distintos). Mientras no se pruebe allí, la comprobación `integridad-inspeccion` avisa `registro_gate_sin_solo_anadir`.

### 9.4 Pruebas
33 de regresión nuevas (`tests/test_revision_independiente.py`: R1 ×7, R2 ×8, R3 ×5, R4 ×9, R5 ×4) y 4 nuevas en Linux real (reescritura del historial detectada por el colector con procesos y privilegios reales; peticiones directas sin evadir el cupo; informe ajeno no entregado; `chattr +a` real); la prueba de separación de privilegios amplía a 6 operaciones nuevas denegadas (`staging`, `collector-state`, `validaciones.json`). Se actualizaron 8 pruebas anteriores al nuevo comportamiento (eventos del colector, `seq`, comprobaciones sensibles, plantillas de registros). **Total: 186 pruebas.** Prueba de sensibilidad: 8 mutaciones deliberadas (publicar antes de auditar, emparejar sin identificador o sin comprobación, quitar el cupo propio, no verificar el prefijo anclado, habilitar sensibles sin validar, no limpiar `staging`, fijar `seq`) → **las 8 detectadas**.

**Resultado:** 186 de 186 en Python 3.8 y 3.12 (Linux: sin privilegios + root con capacidades mínimas + `chattr`; ver `INSPECCION-ETAPA-0-VALIDACION-LINUX.md` §11). `build-workflows --check` en verde (8 de 8). **Huellas SHA-256:** producto (31 archivos, sin pruebas) `be31280be832042c0f64f5e528ddee0b87169810933fe8b5961670c9b2aa45f9`; código y plantillas (28 archivos de `tai_inspect/`, `bin/` y `deploy/`, los ejecutados en Linux) `da3b63cf8dab320a43514b24e94d05f165116ac386047ec7c3f701859c7af3d9`. Anteriores: `40f5a3f3…2b56` y `023fef4c…a892`.

### 9.5 Decisiones que quedan para el propietario
1. Aprobar o ajustar la política de **anclaje cada 15 min** y la rotación de registros (§9.2).
2. Decidir el **procedimiento de validación con muestras controladas** de las 11 comprobaciones sensibles (qué muestra, quién la revisa, cómo se registra su huella en `validaciones.json`). Hasta entonces permanecen cerradas.
3. Confirmar que se probará `chattr +a` **en el VPS con un archivo de muestra** durante la etapa 1/2, no antes.
4. Autorizar (o no) la etapa 1. **No se ha avanzado.**

## 10. Ajustes de las plantillas aprobados para la etapa 2 (P1–P5) — 14/11/2026
El propietario aprobó **exclusivamente** estos cinco ajustes en las **plantillas y pruebas locales**. No se ha conectado al VPS, no se han creado usuarios ni claves reales, no se ha modificado SSH, `systemd`, Docker, el cortafuegos ni producción, no se descargó ni instaló nada y no hay commits ni pushes. **No se ha comenzado la instalación de la etapa 2.** El código y las plantillas deben superar una **segunda revisión independiente** antes de instalarse.

| # | Ajuste | Cambio | Evidencia (OpenSSH real en contenedor aislado, `tests/ssh/prueba_ssh.sh`) |
|---|---|---|---|
| 1 | `AuthorizedKeysFile` de root | El `Match` apunta a `/etc/ssh/authorized_keys.tai-inspect` (`root:root` `0644`), con `AuthorizedKeysCommand none` y `AuthorizedPrincipalsFile none`; la plantilla de claves lo documenta | Una clave **plantada en el home** del usuario se **ignora**; `tai-inspect` no puede escribir, añadir, borrar ni renombrar la clave ni `sshd_config`/`sshd_config.d` (comprobado con `[ -w ]` y con intentos reales) |
| 2 | Shell compatible con `ForceCommand` sin sesión interactiva | Shell `/bin/sh` (`ForceCommand` se ejecuta con el shell del usuario); la restricción la dan `ForceCommand` + `restrict` + `PermitTTY no` + `DisableForwarding yes` + `PermitOpen none` | 7 órdenes hostiles (`id`, `id; cat /etc/passwd`, `sh -i`, `bash`, `$(id)`, …) llegan al gate **solo como texto**; comandos por la entrada estándar **no se ejecutan**; `-tt` rechazado; reenvío `-W` y agente `-A` denegados; con el **gate real** (Python) invocado como `/bin/sh -c`: 9 órdenes hostiles → código 2 `orden no permitida`, sin salida de comandos |
| 3 | `99-tai-inspect.conf` y precedencia | **Verificado, no supuesto:** el nombre **no** da prioridad. Para cada palabra clave gana el primer valor leído entre los `Match` que coinciden con el usuario y los archivos se leen en orden alfabético: con `99-…`, un `Match` anterior que permita reenvíos **gana** (reproducido); con `00-…` prevalece este bloque. La plantilla pasa a llamarse **`00-tai-inspect.conf`** | `sshd -T -C user=root` **idéntico** a la base, `sshd -T` global **idéntico**, usuario normal **idéntico**; sin fugas de ámbito (un global posterior, otro `Match` posterior y una directiva tras el `Include` siguen valiendo); `tai-inspect` muestra las 15 directivas esperadas |
| 4 | Contraseña inutilizable | `usermod -p '*'` (no `!`) | Con `!` (lo que deja `useradd --system`) un `sshd` **sin PAM rechaza** la clave pública; con `*` la clave **funciona**; la contraseña **no se ofrece** (`Authentications that can continue: publickey`). Con la passphrase: sin cargar en el agente no entra, una passphrase incorrecta no carga, la correcta sí (con caducidad `-t`), y tras caducar la clave deja de ser utilizable |
| 5 | Directorio de inicio | `/var/lib/tai-inspect/home`, `root:root` `0555` | `tai-inspect` no puede escribir, crear `.ssh` ni cambiar el modo (Linux real, uid sin privilegios) |

**Hallazgos adicionales de las pruebas:** (a) **`PermitUserEnvironment` no es válida dentro de un `Match`** (la rechaza `sshd -t`): se retiró de la plantilla; es global y su valor por defecto es `no`; sin la prueba habría roto la recarga en el VPS. (b) `ssh-add` con una passphrase incorrecta y `SSH_ASKPASS` **reintenta sin fin**: la prueba lo limita con `timeout`. (c) OpenSSH ≥ 9.8 aplica **penalizaciones por origen** tras varios fallos (`PerSourcePenalties`); el VPS tiene 9.6p1 y no las tiene, pero pruebas repetidas contra un servidor más nuevo pueden verse cortadas. (d) Los lanzadores deben ser **0755**; el `tmpfs` de Docker es `noexec`.

### 10.1 Validaciones obligatorias y resultado
| Validación pedida | Resultado |
|---|---|
| El usuario no puede modificar sus claves, la instalación ni la configuración SSH | **Sí** (SSH real y Linux real con uid sin privilegios; 10 operaciones denegadas sobre clave y home) |
| `ForceCommand` no da shell interactiva | **Sí** (ver ajuste 2) |
| Directivas efectivas con `sshd -T -C` para `tai-inspect` y para root | **Sí**; root, global y usuario normal **idénticos** a la línea base |
| La autenticación por contraseña no funciona | **Sí** |
| La autenticación por clave pública funciona | **Sí**, con clave con passphrase vía agente |
| Las reglas de root permanecen intactas | **Sí** (sigue entrando por su clave con shell completa, conserva reenvíos y contraseña globales; la clave dedicada **no** abre root) |
| Repetir las pruebas de seguridad en Python 3.8 y 3.12 | **Sí**: 190 de 190 por versión (ver `INSPECCION-ETAPA-0-VALIDACION-LINUX.md` §12) |
| Documentación, manifiestos y huellas | Actualizados |
| Prueba de sensibilidad | 4 mutaciones de la plantilla (clave en el home, contraseña activa, TTY permitido, sin `ForceCommand`) → **las 4 detectadas** |

### 10.2 Límites de esta validación (declarados)
- Las pruebas SSH usan **OpenSSH 10.3p1** (imagen local); el VPS tiene **9.6p1**. La precedencia de `Match` e `Include` es estable desde 8.2, pero `sshd -t` y `sshd -T -C` **deben repetirse en el VPS** antes de recargar (plan, §5.6).
- Esa imagen no tiene **PAM**; Ubuntu usa `UsePAM yes`. Con `*` la cuenta no queda bloqueada en ninguno de los dos casos, pero la ruta PAM **no se ha ejercitado**.
- El gate de la prueba SSH es un **simulador de shell**; el gate real (Python) se prueba aparte con la misma invocación `sh -c`. No hay una imagen local con `sshd` y Python a la vez; tampoco se ha probado el encabezado `#!/usr/bin/python3 -I` (se comprueba en V1 de la etapa 2).
- Claves, usuarios, passphrase y host ficticios, solo en el contenedor y en `127.0.0.1`.

**Huellas SHA-256 vigentes:** producto (32 archivos, sin pruebas) `29377eb4432fa30223315344a4408114b3f8308c263c45759f9ff187ac6bcae6`; código y plantillas (29 archivos de `tai_inspect/`, `bin/` y `deploy/`, los validados en Linux) `2096f3e6db13ea46182a92471671a923b18c9f788991cfe6cf61c3632ade30fb`. Anteriores: `be31280b…a45f9` / `da3b63cf…af3d9`.
## 11. Segunda revisión independiente: APROBADA CON CONDICIONES sobre el plan de la etapa 2 — 14/11/2026
La segunda revisión del paquete `treidilor-inspeccion-revision-2.zip` aprobó la arquitectura D, las correcciones R1–R5 y los ajustes SSH P1–P5, y pidió corregir **solo el procedimiento** de la etapa 2. **No se ha cambiado el código ni las plantillas** (huellas idénticas: producto `29377eb4…bcae6`, código y plantillas `2096f3e6…ade30fb`). No se ha conectado al VPS, no se han creado usuarios ni claves, no se ha instalado ni modificado nada, no hay commits ni pushes y **no se ha ejecutado la etapa 2**. El plan definitivo es `INSPECCION-ETAPA-2-PLAN.md`.

| Condición | Resolución en el plan |
|---|---|
| C1 No presuponer una sesión SSH existente | Consola web de Hostinger como vía de recuperación, **ensayada en F0** junto con un temporizador de reversión que se arma y se cancela; reversión automática a los 10 min (`systemd-run`) que no depende de ninguna sesión; snapshot solo como último recurso (su restauración no se puede ensayar) |
| C2 Orden de `systemd-analyze` y tuberías | `verify` y `security --offline=true` **antes** de copiar las unidades; salida a archivo y `rc=$?` leído antes de mostrarla; una salida no vacía de `verify` es fallo; sin tuberías (comprobado por una prueba) |
| C3 Verificar el TAR antes de extraerlo | Bloque único: huella del TAR, tipos, rutas, permisos, propietario, duplicados, conjunto exacto de archivos y huella de **cada** archivo sin extraer |
| C4 `sshd -t` / `sshd -T -C` con OpenSSH 9.6 y PAM del VPS | Puerta de versión (`1:9.6p1`) y de `usepam yes`; configuración de prueba fuera de `/etc/ssh/sshd_config.d`; **instancia de `sshd` en `127.0.0.1:2222`** con PAM real y el gate real **antes** de colocar el archivo y recargar; validación repetida con el árbol real justo antes de recargar |
| C5 Separar host y colector | Fase A (F0–F8): solo gate con 5 comprobaciones del host, sin colector ni unidades; pausa ≥ 24 h; Fase B (F9): colector con `integridad-inspeccion` y `auditoria-resumen`, con autorización propia |
| C6 Mantener intacto lo existente | Invariantes (`sshd` de root y global, huellas de `authorized_keys` de root y `sshd_config`, servicios Swarm, puertos, estado de `ssh` y `docker`) medidos antes y después de cada fase |

### 11.1 Pruebas añadidas (solo las directamente afectadas)
`tests/test_plan_etapa2.py`: **5** pruebas estáticas del plan (sin tuberías en `systemd-analyze`, código de salida comprobado, orden verify → security → copia, condiciones presentes, `sshd` real no tocado antes del puerto de prueba) y **16** de la verificación del TAR, que **extraen el bloque del propio documento** y lo ejecutan contra un paquete legítimo y **21 manipulados**: huella del TAR equivocada, enlace simbólico (añadido y sustituyendo a un archivo revisado), enlace duro, ruta absoluta, `..` (inicial e intermedio), espacios y punto inicial, tubería y dispositivo, setuid, escribible por todos y por el grupo, ejecutable fuera de `bin/`, lanzador sin ejecución, directorio 0777, propietario ajeno, archivo de más, archivo de menos, contenido modificado y entrada duplicada. **Todos se rechazan; el legítimo se acepta y el bloque no extrae nada.**
- **Hallazgo de la propia prueba:** un lanzador de `bin/` con modo 0644 **pasaba**; se endureció la regla (los lanzadores solo 0755 y nada más en `bin/`).
- **Sensibilidad:** quitando a propósito el control de huellas por archivo, el de permisos o el de la huella del TAR, las pruebas fallan; quitar el control de tipos no se detecta porque la regla de permisos lo cubre (defensa en profundidad).
- **Resultado:** 211 pruebas en Windows (las 190 anteriores más estas 21), todas correctas, con 31 omitidas (solo Linux). No se repitieron las 190 en Linux ni el banco SSH: el código no ha cambiado.

### 11.2 Límites declarados
- Los 16 casos del TAR se ejecutaron con **`bash` y `tar` GNU de Git for Windows**, porque Docker Desktop estaba **parado** y arrancarlo requiere autorización. Repetirlos en un contenedor Linux (Python 3.8 y 3.12) queda pendiente de esa autorización; la prueba ya está preparada (`python -m unittest discover -s tests -p test_plan_etapa2.py` con el directorio `docs` accesible).
- No se pueden probar localmente: `systemd-analyze` (no hay `systemd`), la instancia de `sshd` con **PAM de Ubuntu** y OpenSSH 9.6 y el comportamiento de `ssh.socket`. Son precisamente lo que el plan exige verificar **en el VPS** antes de recargar (F1, F5, F6, F7); el plan los trata como puertas de parada.
- La restauración del snapshot de Hostinger no se ha ensayado ni puede ensayarse sin riesgo.
