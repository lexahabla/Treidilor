# Inspección automática del VPS de producción — diseño de la arquitectura D (acceso SSH restringido por colector)

> **Arquitectura D aprobada provisionalmente. ETAPA 0 (desarrollo y pruebas LOCALES) completada el 13/11/2026** (código en `automation/inspeccion/`, informe en `INSPECCION-ETAPA-0-INFORME.md`, validación Linux en `INSPECCION-ETAPA-0-VALIDACION-LINUX.md`). **Nada está instalado en producción**: no se han creado usuarios, claves, servicios ni conexiones, y no se ha accedido al VPS. Las etapas 1 a 7 siguen pendientes de autorización independiente. Todo lo marcado «propuesto» requiere autorización expresa por etapa. Complementa `INFRAESTRUCTURA-VPS-PRODUCCION.md` (hechos y riesgos) y reutiliza lo aceptado provisionalmente el 13/11/2026: **arquitectura D (colector de diagnósticos y visor restringido)**.
>
> **Objetivo:** que Claude Code pueda consultar de forma **automática, de solo lectura, acotada y auditada** el estado de Docker, n8n, PostgreSQL, recursos y registros técnicos del VPS, sin acceso general, sin `root`, sin grupo `docker` y sin posibilidad de modificar producción. **No** autoriza ejecución autónoma de agentes ni ejecuciones programadas sin supervisión.

## 1. Hechos de partida (13/11/2026)
| Hecho | Origen |
|---|---|
| Docker Swarm con **un único nodo** (Ready/Active/Leader); n8n, PostgreSQL, runner y Treidilor son **servicios de Swarm** | [Comprobado manual] |
| Firewall de Hostinger activo: acepta TCP **22, 80 y 443**, descarta el resto; el 3000 queda cerrado | [Comprobado manual] |
| SSH (22) sigue **abierto a cualquier origen**; usuario y privilegios de la conexión de Antigravity **sin verificar** | [Comprobado manual] / [Pendiente] |
| La clave `id_ed25519` local **no tiene passphrase** y su comentario indica que se creó para esa conexión | [Verificado local] |
| `automation/reports/` está **ignorada por git** (sitio seguro para guardar informes locales) | [Verificado local] |
| Los hosts públicos (`treidilor.com`, panel HTTPS) responden y el servicio no se reinició con el firewall | [Verificado público] 21:22 UTC |

## 2. Requisitos
1. Usuario dedicado, **sin root, sin `sudo`, fuera del grupo `docker`**, sin acceso al socket de Docker.
2. Solo comprobaciones **previamente autorizadas** y de **solo lectura**, de una **lista cerrada**; sin argumentos libres.
3. Sin secretos en los informes (variables de entorno, credenciales, tokens, datos personales).
4. Registro auditable de cada consulta; límites de frecuencia, tamaño y tiempo.
5. Desactivable al instante y sin tocar `sshd` ni reiniciar servicios.
6. Etapas pequeñas, cada una verificable y reversible.

## 3. Arquitectura
```
 PC (Claude Code/Antigravity)                           VPS (Hostinger, un solo nodo Swarm)
┌───────────────────────────────┐   SSH, clave dedicada  ┌────────────────────────────────────────────────────┐
│ tai-inspect (envoltorio local)│ ─────────────────────► │ sshd  Match User tai-inspect → ForceCommand tai-gate│
│  · valida nombre de check     │   `solicitar <check>`  │            (sin TTY, sin reenvíos, sin contraseña)  │
│  · guarda informe + auditoría │   `leer <check>`       │ tai-gate (usuario sin privilegios)                  │
│    en automation/reports/     │ ◄───────────────────── │  · lista cerrada · cuotas · escribe PETICIÓN        │
└───────────────────────────────┘     informe saneado    │  · devuelve el último INFORME ya generado           │
                                                          │                  │ petición (archivo)               │
                                                          │ systemd .path → tai-collector.service (root, sandbox)│
                                                          │  · ejecuta SOLO scripts fijos y de solo lectura      │
                                                          │  · docker/psql con plantillas fijas; filtro de       │
                                                          │    secretos; escribe INFORME + registro de auditoría │
                                                          └────────────────────────────────────────────────────┘
```
**Principio:** el usuario SSH **no ejecuta nada privilegiado ni pasa argumentos**: solo deja un archivo de petición con un nombre de la lista y lee informes ya saneados. El único componente privilegiado, el colector, pertenece a `root`, no es modificable por el usuario SSH y no recibe entrada libre.

### 3.1 Componentes (propuestos)
| Componente | Propietario y permisos | Función |
|---|---|---|
| Usuario `tai-inspect` | Cuenta de sistema, sin contraseña, sin `sudo`, sin `docker`, shell mínima | Identidad de la conexión SSH |
| `authorized_keys` de `tai-inspect` | Una sola clave **dedicada** con `restrict,command="/opt/tai-inspect/tai-gate"` (+ `from=` si hay IP fija) | La clave solo puede ejecutar el gate |
| Bloque `sshd` `Match User tai-inspect` | `PermitTTY no`, `AllowTcpForwarding no`, `AllowAgentForwarding no`, `X11Forwarding no`, `PermitTunnel no`, `PasswordAuthentication no`, `AuthenticationMethods publickey`, `MaxSessions 1`, `ForceCommand` | Refuerzo en el servidor |
| `/opt/tai-inspect/` | `root:root`, `0755`, archivos `0644/0755`, **no escribible** por nadie salvo `root` | Gate, colector, scripts de comprobación, lista cerrada, filtro de redacción, manifiesto de huellas |
| `/var/lib/tai-inspect/requests/` | `root:tai-inspect` `2730`: el gate crea, no lista | Peticiones (identificador único de 32 hexadecimales) |
| `/var/lib/tai-inspect/staging/` | `root:tai-inspect` `2700`; el gate **no** lo ve | Borradores de informe: solo se publican tras registrar su resultado |
| `/var/lib/tai-inspect/reports/` | `root:tai-inspect`, `2750`; el usuario **solo lee** | Informes saneados (cada uno lleva el identificador de su petición) |
| `/var/lib/tai-inspect/collector-state/` | `root:root` `0700` | Cupo propio del colector y anclas del registro del gate |
| `/var/log/tai-inspect/` | `root`; `gate-audit.log` de `tai-inspect` (solo añade por diseño) | Registros de auditoría. `chattr +a` **solo** si se prueba en el VPS (ver INFORME §9.3) |
| `tai-collector.path` + `.service` | `root`, con aislamiento de `systemd` | Ejecuta la comprobación pedida |
| Interruptor `/etc/tai-inspect/DISABLED` | `root` | Si existe, el gate rechaza todo (desactivación sin tocar `sshd`) |
| `tai-gate` | Lo ejecuta `tai-inspect` | Valida la orden, aplica cuotas, crea la petición, espera el informe (≤ 20 s) y lo devuelve |

### 3.2 Aislamiento del colector (propuesto, a validar en pruebas locales)
`NoNewPrivileges=yes`, `ProtectSystem=strict`, `ProtectHome=yes`, `PrivateTmp=yes`, `ReadWritePaths=` solo `/var/lib/tai-inspect /var/log/tai-inspect`, `RestrictAddressFamilies=AF_UNIX` (**sin red**), `IPAddressDeny=any`, `CapabilityBoundingSet=` mínimo, `MemoryMax`, `CPUQuota`, `TasksMax`, `TimeoutStartSec=60`, prioridad baja de CPU y E/S. **Salvedad honesta:** hablar con Docker exige acceso al socket de Docker, que **equivale a `root`**; por eso el colector es la pieza de confianza y debe ser mínima, auditada y con huella.

## 4. Catálogo de comprobaciones (lista cerrada) y permisos mínimos
Cada comprobación es un script fijo, sin argumentos, que devuelve un JSON con **campos permitidos**. «Sin colector» significa que **no necesita ningún privilegio** y el gate puede ejecutarla directamente como `tai-inspect`.

| Id | Qué devuelve | Fuente de solo lectura | ¿Privilegio? | Datos sensibles posibles | Control | Etapa |
|---|---|---|---|---|---|---|
| `host-recursos` | CPU, carga, RAM, swap, disco, inodos | `/proc`, `df` | Sin colector | Ninguno | Campos fijos | 2 |
| `host-red` | Puertos en escucha (sin procesos) | `ss -tuln` | Sin colector | Puertos | Campos fijos | 2 |
| `host-servicios` | Servicios de `systemd` activos | `systemctl list-units` | Sin colector | Nombres | Campos fijos | 2 |
| `host-actualizaciones` | Nº de paquetes actualizables, reinicio pendiente | `apt list --upgradable`, `/var/run/reboot-required` | Sin colector | Ninguno | Solo recuentos | 2 |
| `host-tiempo` | Sincronización horaria | `timedatectl` | Sin colector | Ninguno | Campos fijos | 2 |
| `docker-nodos` | Nodos Swarm y estado | `docker node ls --format` | Colector | Ninguno | Plantilla fija | 3 |
| `docker-servicios` | Servicios, imagen/versión, réplicas, reinicios, estado de actualización, puertos publicados | `docker service ls --format` y `docker service ps --format` | Colector | Ninguno (sin `inspect` completo, que incluye variables de entorno) | Plantilla fija | 3 |
| `docker-recursos` | CPU y memoria por contenedor | `docker stats --no-stream --format` | Colector | Ninguno | Plantilla fija | 3 |
| `docker-redes` | Redes, driver, `internal`, nº de contenedores | `docker network ls/inspect --format` | Colector | Subredes | Plantilla fija | 3 |
| `docker-disco` | Uso de disco de Docker, volúmenes | `docker system df`, `docker volume ls --format` | Colector | Ninguno | Plantilla fija | 3 |
| `seguridad-ssh` | Directivas de `sshd` relevantes (sin claves) y **recuento** de intentos fallidos por día | `sshd -T` filtrado; `auth.log` solo en recuentos | Colector | IPs de atacantes (solo recuentos o top 5 truncados) | Lista blanca de directivas | 3 |
| `integridad-inspeccion` | Huellas de los archivos de `/opt/tai-inspect` frente al manifiesto | `sha256sum` | Colector | Ninguno | Compara con el manifiesto | 3 |
| `n8n-estado` | Versión (de la imagen), réplicas, estado, **registro del runner** (recuento de «Registered runner») | Servicios de Swarm; recuento en logs | Colector | Ninguno | Solo recuentos | 4 |
| `postgres-estado` | Versión, tamaño, conexiones, `max_connections`, tablas más grandes (solo nombres y tamaño) | `psql` con sesión **de solo lectura** y consultas fijas | Colector con `exec` | Nombres de tablas | `default_transaction_read_only=on`, `statement_timeout`, **sin `SELECT *`** | 4 |
| `n8n-tablas-metadatos` | Nombres lógicos de las Data Tables, filas y fecha/`idEjecucion` de la última fila | Consultas fijas a metadatos; **sin `payload`** | Colector con `exec` | Nombres | Columnas fijas | 4 |
| `n8n-workflows-estado` | Nombre y estado activo/inactivo de los workflows | Consulta fija | Colector con `exec` | Nombres | Sin contenido de workflows | 4 |
| `registros-resumen` | **Recuentos** por nivel y por tipo de mensaje de n8n, runner y servicios; errores del sistema | Logs con filtro y normalización | Colector | **Datos personales o secretos en las líneas** | Solo recuentos y mensajes **normalizados** (números e identificadores enmascarados); sin líneas crudas; **sin registros de acceso de Traefik** (contienen IP de visitantes) | 5 |
| `auditoria-resumen` | Peticiones por comprobación, rechazadas, errores | Registro de auditoría | Colector | Ninguno | Recuentos | 5 |

**Lo que no se podrá hacer nunca por este canal:** `docker exec` libre, `docker inspect` completo, volcados de variables de entorno, lectura de `credentials_entity.data` o de `payload`, reinicios, despliegues, cambios de firewall, escrituras en bases de datos, lectura de archivos fuera de la lista, ni cualquier comando que no esté en el catálogo.

## 5. Controles de seguridad
1. **Clave dedicada** (ed25519), distinta de `id_ed25519`; con passphrase o clave FIDO2 (`ed25519-sk`); si se decide una clave **sin** passphrase, solo con las restricciones del servidor. Guardada fuera del repositorio con ACL de usuario.
2. **Servidor verificado:** fijar la huella del servidor contrastándola **por otro canal** (terminal web de Hostinger) y usar `StrictHostKeyChecking yes`.
3. **Alias local propio** (`tai-inspect`) con `IdentitiesOnly yes`, `ForwardAgent no` y `RequestTTY no`, sin tocar el alias ni la clave actuales.
4. **Permisos de Claude Code** limitados a ese alias y a los verbos `solicitar` y `leer`; cualquier otro `ssh` queda denegado.
5. **Validación en dos puntos:** el envoltorio local rechaza nombres no listados; el gate vuelve a validar con una expresión estricta (`^(solicitar|leer) [a-z0-9-]{1,40}$`) y contra la lista cerrada.
6. **Filtro de secretos antes de guardar el informe** (patrones de tokens, claves, `Bearer`, URL con credenciales, correos, cabeceras de autenticación); si detecta uno, **descarta el informe** y lo registra.
7. **Inmutabilidad:** `/opt/tai-inspect` solo lo cambia `root`; el manifiesto de huellas vive también en este repositorio y `integridad-inspeccion` detecta cualquier deriva.
8. **Interruptor de parada** (`DISABLED`), bloqueo del usuario y retirada de la clave, sin tocar `sshd`.
9. **Cambios de `sshd`:** siempre con `sshd -t` y con una sesión abierta de respaldo (terminal web de Hostinger).

## 6. Límites de lectura (valores iniciales propuestos, configurables)
| Límite | Valor inicial |
|---|---|
| Tamaño máximo de un informe | 64 KiB (truncado con marca) |
| Líneas de registro consideradas por comprobación | ≤ 500, ventana ≤ 24 h |
| Longitud de línea normalizada | ≤ 200 caracteres |
| Peticiones simultáneas | 1 |
| Intervalo mínimo por comprobación | 30 s (las de Docker/PostgreSQL, 5 min) |
| Peticiones diarias | 60 |
| Tiempo máximo de una comprobación | 10 s (`psql`: `statement_timeout` 5 s) |
| Memoria / CPU del colector | `MemoryMax` ≈ 128 MiB, `CPUQuota` ≈ 20 % |
| Reintentos | Ninguno automático |

## 7. Auditoría
1. **Servidor:** `sshd` en `LogLevel VERBOSE` (registra la huella de la clave) + registro del gate y del colector en `journald` y en un archivo solo-añadir: instante, origen, comprobación, id de petición, resultado, duración, tamaño y **huella del informe**. Las órdenes rechazadas quedan registradas con el texto recortado y saneado.
2. **Local:** el envoltorio guarda cada informe en `automation/reports/inspeccion/` (ignorada por git) con su huella, y añade una línea a un registro local (`auditoria.jsonl`): instante, comprobación, huella, tamaño y resultado.
3. **Contraste:** `auditoria-resumen` permite comparar lo que el servidor registró con lo que el cliente pidió; una diferencia es una alerta.
4. **Revisión periódica** del propietario del resumen y de las órdenes rechazadas.
5. **Integridad del historial del gate (revisión independiente, 13/11/2026):** el usuario restringido es propietario de `gate-audit.log` y por permisos podría reescribirlo; por eso cada línea lleva `seq` correlativo, el colector ancla tamaño, último `seq` y SHA-256 del prefijo verificado en un directorio que ese usuario no ve (pase cada 15 min), y se conserva la copia en `syslog`/`journald`. Detalle, ventana y límites en `INSPECCION-ETAPA-0-INFORME.md` §9.2.
6. **Publicación de informes:** nada se publica sin que su resultado conste en la auditoría (`colector_intencion` → `colector_resultado` → publicación atómica → `colector_publicacion`).

## 8. Qué se puede automatizar sin comprometer producción
**Ya, sin SSH ni cambios** (peticiones públicas de solo lectura; ya las hago): `/api/health` (estado, `sourceHash` frente a `HEAD`, `startedAt`), códigos HTTP de los sitios y del panel, caducidad del certificado TLS, y huella del código desplegado. *Alcanzar puertos concretos se hará solo si lo autorizas puntualmente.*

**Tras las etapas 2 y 3** (solo lectura, sin datos sensibles): recursos del host, puertos en escucha, servicios, actualizaciones pendientes, nodos, servicios y estado de Swarm, uso de recursos por contenedor, redes y disco de Docker, seguridad de SSH (directivas y recuentos) e integridad del propio sistema de inspección.

**Tras la etapa 4** (con ejecución en contenedores): estado y tamaño de PostgreSQL, metadatos de Data Tables y estado de workflows.

**Tras la etapa 5:** resúmenes de registros. Requiere decidir qué se considera dato personal en los registros.

**No automatizable por diseño:** cualquier modificación, la lectura de contenido (`payload`, credenciales, variables de entorno) y los registros de acceso con IP de visitantes.

## 9. Etapas pequeñas y verificables
Cada etapa necesita **tu autorización** y termina con una verificación; ninguna avanza sola.

| Etapa | Contenido | ¿Toca producción? | Verificación | Reversión |
|---|---|---|---|---|
| **0 · Local, sin producción — COMPLETADA (13/11/2026)** | Escribir y probar en un contenedor Linux **local aislado** el gate, el colector, las comprobaciones, el filtro de secretos y el manifiesto; pruebas negativas: inyección en la orden, orden no listada, informe demasiado grande, **secreto sembrado** en una variable de entorno de un contenedor de prueba que **no** debe salir, cuotas | **No** (requiere autorizar escribir código) | Batería local en verde y revisión tuya del código con su SHA-256 | Borrar los archivos locales |
| **1 · Verificaciones previas** | Con tu sesión actual (lectura): usuario y privilegios de la conexión existente (4 comandos ya preparados); versión y directivas de `sshd`; huella del servidor por el terminal web; versión de Docker y de `systemd` | No | Resultados registrados en `INFRAESTRUCTURA-VPS-PRODUCCION.md` | — |
| **2 · Acceso mínimo, solo host** | Crear `tai-inspect`, clave dedicada, `authorized_keys` restringido, bloque `Match` y el gate **con las comprobaciones sin privilegios** (`host-*`), **sin colector ni Docker**; alias local y reglas de Claude Code | **Sí** (usuario, clave, `sshd`) | Autenticación correcta; una orden no listada es rechazada; sin TTY; el rechazo y los aciertos aparecen en la auditoría; informe de `host-recursos` coincide con tus medidas manuales | Quitar la clave y el bloque `Match`, bloquear el usuario, `DISABLED`; sesión de respaldo abierta |
| **3 · Colector y Docker (solo lectura)** | Instalar el colector con aislamiento de `systemd` y las comprobaciones `docker-*`, `seguridad-ssh`, `integridad-inspeccion` | **Sí** (servicio nuevo) | Informes sin secretos (búsqueda automática); coincide con tus resultados manuales (1 nodo, servicios, recursos); `integridad` limpia | Parar y deshabilitar `tai-collector`, eliminar unidades; el gate sigue limitado a `host-*` |
| **4 · PostgreSQL y Data Tables** | `exec` con plantillas fijas: `postgres-estado`, `n8n-tablas-metadatos`, `n8n-workflows-estado` | **Sí** (habilita `exec` fijo) | Sesión de solo lectura demostrada; **ninguna** columna `payload`; nombres lógicos de las dos tablas identificados | Deshabilitar esas comprobaciones en la lista cerrada |
| **5 · Registros** | `registros-resumen` y `auditoria-resumen` | Sí (lista cerrada) | Solo recuentos y mensajes normalizados; sin IP de visitantes ni datos personales | Deshabilitar la comprobación |
| **6 · Automatización local** | Envoltorio local que valida, guarda el informe, mantiene el registro local y actualiza la línea base; reglas de permisos de Claude Code | No (solo local) | Una consulta de cada tipo con su auditoría y huella | Quitar las reglas y el alias |
| **7 · Cierre** | Generar la línea base real en `INFRAESTRUCTURA-VPS-PRODUCCION.md`; retirar o restringir la clave antigua; decidir restringir el 22 (IP, VPN o *knock*) y revisar rotación de claves | Sí | Documento actualizado y revisado | — |

**No hay ejecución programada ni desatendida en ninguna etapa**: cada consulta la lanza una sesión supervisada. Una programación sería una decisión distinta.

## 10. Riesgos de este diseño
| Riesgo | Mitigación |
|---|---|
| El colector es privilegiado (socket de Docker ≈ `root`) | Código mínimo y revisado, propiedad de `root`, sin entrada libre, sin red, aislamiento de `systemd`, manifiesto y comprobación de integridad |
| Fuga de secretos en un informe | Plantillas con campos permitidos, filtro de patrones que **descarta el informe**, pruebas con secretos sembrados, sin `inspect` completo ni `env` |
| Error en `sshd` que te bloquee | `sshd -t`, sesión de respaldo y terminal web de Hostinger |
| Clave comprometida | Solo ejecuta el gate (lista cerrada, solo lectura); desactivación inmediata; passphrase o FIDO2 |
| Datos personales en los registros | Solo recuentos y mensajes normalizados; Traefik excluido |
| Complejidad del canal por archivos (`systemd.path`) | Variante más simple y aceptable si fallara: `sudo` a scripts fijos sin argumentos (alternativa A) |
| Deriva de formato de `docker`/`n8n` tras una actualización | Pruebas de cada comprobación tras cada actualización |
| El SSH sigue abierto a Internet (22) | Restringirlo en la etapa 7 o antes |
| Latencia de unos segundos y límite de uso | Aceptable; límites configurables |

## 11. Decisiones que necesitan autorización
1. Confirmar la arquitectura D y el catálogo de comprobaciones (§4), o recortarlo.
2. Autorizar la **etapa 0** (escribir y probar código en local; sin producción).
3. Método de la clave dedicada: passphrase con `ssh-agent`, FIDO2, o restringida sin passphrase.
4. Valores de §6 (límites) y si el colector corre con `root` aislado (propuesto) o con la variante `sudo`.
5. Si se incluyen los **registros** (etapa 5) y con qué nivel de detalle.
6. Cuándo ejecutar la etapa 1 (verificaciones de solo lectura con tu sesión).
7. Qué hacer con la conexión SSH actual (restringirla o retirarla) y con el acceso del puerto 22 a «Any».

## 12. Qué no se ha hecho
No se ha conectado al VPS ni se han ejecutado comandos remotos; no se han creado usuarios, claves, scripts ni servicios; no se ha modificado el firewall, EasyPanel, servicios, código de producción ni workflows; no hay commits ni pushes.
