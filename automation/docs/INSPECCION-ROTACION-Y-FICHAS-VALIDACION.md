# Inspección automática del VPS — Rotación de registros (DISEÑO) y fichas de validación (13/11/2026)

**Solo diseño y plantillas. No se implementa la rotación, no se instala nada y no se habilita ninguna comprobación sensible.** Decisiones del propietario (13/11/2026): anclaje cada 15 min como configuración inicial (D1), rotación ejecutada solo por un administrador autorizado que preserve historial, anclas y evidencia (D2), las 11 comprobaciones sensibles siguen deshabilitadas con una ficha individual cada una (D3), `chattr +a` en el VPS pospuesto a la etapa 2 con autorización específica y archivo temporal (D4), se conservan límites y separación de privilegios (D5) y el código debe superar una **segunda revisión independiente antes de instalarse** (D6).

## 1. Riesgo residual entre anclajes (D1)
Configuración inicial: `tai-collector.timer` cada **15 min** (`OnUnitActiveSec=15min`). Entre dos anclas, el usuario restringido —propietario de `gate-audit.log`— puede alterar **solo lo escrito después de la última ancla** (como máximo ~15 min de historial) sin que el colector lo detecte hasta el pase siguiente, salvo huecos o repeticiones de `seq`. Si además recalcula la secuencia, queda únicamente la copia en `syslog`/`journald` (no contrastada todavía). Lo ya anclado no es alterable sin detección. Reducir el intervalo reduce la ventana pero aumenta el ruido en el registro: se revisará con datos reales tras la etapa 2.

## 2. Diseño de la rotación (NO implementada)
**Quién:** únicamente un administrador autorizado, con sesión de root propia, bajo aprobación registrada del propietario. Ni el usuario restringido ni el gate ni el colector pueden iniciarla. No es automática.
**Cuándo:** el registro se verifica hasta 4 MiB (`MAX_AUDIT_BYTES`). Estimación: ≈ 220 líneas/día (60 peticiones × 2 eventos del gate + 96 anclas) ≈ 55 KB/día → 4 MiB en ~70 días. **Rotar al llegar a 2 MiB (~mensual)**; un aviso de la comprobación `integridad-inspeccion` se añadirá en la implementación.
**Garantías buscadas:** (1) ningún segmento se borra ni se sobrescribe; (2) la cadena de `seq` continúa sin hueco; (3) cada segmento archivado queda ligado por su SHA-256 a una ancla y a un evento del segmento siguiente; (4) un fallo en cualquier paso **aborta sin dejar el sistema degradado**.

| Paso | Acción (futura herramienta de root `tai-rotate`, revisable y con manifiesto) | Si falla |
|---|---|---|
| 0 | Precondiciones: aprobación del propietario anotada; espacio libre ≥ 3× el tamaño del registro; sin alarma abierta de anclas | Abortar |
| 1 | Crear `DISABLED` (el gate rechaza todo) y parar `tai-collector.timer`; esperar a que el colector no esté en ejecución | Quitar `DISABLED`, abortar |
| 2 | Pase de anclaje final: debe terminar **`ok`**. Si hay alarma (`historial_modificado`, etc.) **no se rota**: se investiga primero (la rotación no puede «lavar» una alteración) | Abortar y conservar todo |
| 3 | Copiar el registro a `/var/log/tai-inspect/archivo/gate-audit.<UTC>.<seq_inicial>-<seq_final>.log` (`root:root` `0400`, directorio `0700`) y calcular su SHA-256; archivar también el ancla y `collector-audit.log` del mismo periodo | Abortar |
| 4 | Verificar la copia byte a byte contra el original; si `chattr +a` está activo: `chattr -a`, mover el original, crear el nuevo (propietario `tai-inspect`, `0640`) y volver a activar `+a` | Restaurar el original |
| 5 | Primera línea del nuevo registro: evento `rotacion` con `seq = último+1`, `ref_seq`, `sha256` del segmento archivado (continuidad sin hueco). El colector registra `colector_rotacion` con el mismo hash | Restaurar el original |
| 6 | Sustituir el ancla por la del nuevo registro conservando la anterior (`ancla-gate.<UTC>.json`) | Restaurar |
| 7 | Pase del colector: debe dar `ok`; quitar `DISABLED`; arrancar el temporizador; prueba de lectura | Dejar `DISABLED` y avisar |
| 8 | Informe de rotación (qué segmento, hashes, quién aprobó, cuándo) enviado al propietario | — |

**Evidencia preservada:** segmentos archivados inmutables (con `chattr +i` cuando se valide en la etapa 2), hashes anotados en el registro nuevo y en `syslog`, retención mínima propuesta de 12 meses con borrado **solo manual y aprobado**.
**Requiere antes de implementarse:** cambio en `audit.py` para admitir un `seq` inicial (hoy un archivo vacío reinicia en 1), la herramienta `tai-rotate`, sus pruebas y la segunda revisión independiente (D6).

## 3. Fichas de validación de las comprobaciones sensibles (D3)
**Regla general.** Una comprobación sensible se habilita solo con (a) su entrada en `enabled.json`, (b) su entrada en `validaciones.json` con `muestra_sha256` y (c) la ficha firmada. **Ninguna muestra contiene secretos reales.**
**Origen permitido de una muestra** (en orden de preferencia): 1) **sintética**, escrita a mano a partir del formato documentado del comando; 2) **capturada en un entorno de pruebas aislado** (sin red, datos ficticios, p. ej. contenedores locales); 3) real del VPS **solo** con autorización expresa, tras redacción manual y revisada línea a línea. Toda muestra incluye **señuelos ficticios** (token con forma de `ghp_…`, correo, IP, nombre de persona) para probar que el filtro los elimina o descarta el informe.
**Ficha (campos obligatorios):** comprobación · comandos (`runner.SPECS`) · versión del comando (de la etapa 1) · origen de la muestra · formato esperado · saneamiento aplicado y qué se publica · revisión (autor + propietario + revisor independiente, fecha) · huella SHA-256 de la muestra · resultado de la prueba (informe obtenido, ≤ 64 KiB, sin hallazgos del filtro) · decisión (habilitar/mantener cerrada).
`validaciones.json` solo lee `muestra_sha256`; el resto de campos puede guardarse junto a él sin efecto.

| # | Comprobación | Comandos (`SPECS`) | Versión del comando | Formato esperado de la muestra | Saneamiento / qué se publica | Riesgo específico a revisar |
|---|---|---|---|---|---|---|
| 1 | `docker-nodos` | `docker_node_ls` | Docker (etapa 1, A3) | Líneas `Estado\|Disponibilidad\|Gestor\|VersionMotor` | Solo recuentos y estados; sin nombres ni ID | Nombre de host si el formato cambiara |
| 2 | `docker-servicios` | `docker_service_ls`, `docker_service_ps` | Docker | `Nombre\|Modo\|Réplicas\|Imagen\|Puertos` y `Estado\|error` | Nombre, réplicas, imagen sin credenciales ni resumen hash, puertos publicados | Credenciales incrustadas en el nombre de imagen |
| 3 | `docker-recursos` | `docker_stats` | Docker | `Nombre\|CPU%\|Mem\|Mem%\|PIDs` | Uso por servicio; sin ID de contenedor | Identificadores en el nombre del contenedor |
| 4 | `docker-redes` | `docker_network_ls`, `docker_network_inspect` | Docker | `Nombre\|Driver\|Alcance\|Interna\|Adjuntable\|N` | Solo esos campos; **sin IP, subredes ni ID** (nunca `inspect` completo) | Que el formato fijo incluya direcciones |
| 5 | `docker-disco` | `docker_system_df`, `docker_volume_count` | Docker | `Tipo\|Total\|Activos\|Tamaño\|Recuperable` y lista de volúmenes | Tamaños y **solo el número** de volúmenes | Nombres de volúmenes (no se publican) |
| 6 | `seguridad-ssh` | `sshd_t`, `journal_ssh` / `auth.log` | OpenSSH (etapa 1, A3) | `clave valor` de `sshd -T`; líneas de registro | Solo directivas de la lista permitida; listas como recuento; intentos fallidos **solo por día**, sin IP ni usuario | Usuarios e IP en los registros |
| 7 | `n8n-estado` | `docker_service_ls`, `docker_service_logs` | Docker | Igual que 2 y registros del servicio | Réplicas y versión; registros solo como recuentos por nivel | Datos de clientes en los registros |
| 8 | `postgres-estado` | `docker_ps_by_service`, `pg_query` (`version`, `tam_bd`, `conexiones`, `max_conexiones`, `tablas_grandes`) | PostgreSQL 17 (etapa 4) | Una fila por consulta, `\|` como separador | Versión, tamaño, conexiones; tablas grandes solo de la lista permitida | Nombres de tablas de negocio |
| 9 | `n8n-tablas-metadatos` | `pg_query` (`data_tables`, `filas_tabla`, `ultima_fila_tabla`) | PostgreSQL 17 | `id\|nombre`, recuento, `idEjecucion\|generadoEn` | **Solo metadatos** de las tablas de `tablas_agentes`; ninguna celda de contenido | Que una columna contenga datos de clientes |
| 10 | `n8n-workflows-estado` | `pg_query` (`workflows`, `ejecuciones_24h`) | PostgreSQL 17 | `nombre\|activo`, `estado\|n` | Nombre y activo/inactivo; ejecuciones por estado | Nombres de workflows con información interna |
| 11 | `registros-resumen` | `docker_service_logs` | Docker | Líneas de registro de los servicios autorizados | Recuentos por nivel; mensajes **solo** de plantillas permitidas; se excluyen proxy/acceso | Correos, IP, tokens, nombres en los mensajes |

**Procedimiento por ficha:** (1) preparar la muestra con señuelos; (2) calcular su SHA-256 y registrarlo en la ficha; (3) pasar la muestra por el colector real **en el contenedor de pruebas** y comprobar que el informe publicado no contiene señuelos y respeta el límite; (4) revisión del propietario y del revisor independiente; (5) solo entonces añadir la entrada en `validaciones.json` **en la fase de instalación autorizada**. Las 11 fichas están **abiertas** (sin muestra ni huella): ninguna comprobación se habilita en esta etapa.
