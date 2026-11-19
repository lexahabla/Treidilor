# Inspección automática del VPS — ETAPA 2: paquete de instalación, secuencia mínima y propuesta de ventana (14/11/2026)

**Estado: paquete PREPARADO en local; NO instalado, NO subido, NO programado.** No hay conexión al VPS, no se han creado usuarios ni claves, no hay commits ni pushes. Complementa a `INSPECCION-ETAPA-2-PLAN.md` (procedimiento completo y verificaciones); este documento resume el paquete, la secuencia con sus puntos de parada, lo que podría afectar al acceso y la ventana propuesta. **Espera autorización expresa.**

## 1. Paquete de instalación (solo en local)
Carpeta: `D:\AXEL\WEBS\TRADYLOR\paquete-instalacion-etapa2\` (fuera del repositorio; sin credenciales ni datos sensibles).
| Archivo | Contenido | SHA-256 |
|---|---|---|
| `treidilor-inspeccion.tar` | **Exactamente** los 29 archivos de `tai_inspect/`, `bin/` y `deploy/` aprobados (sin pruebas, sin archivos ocultos, sin enlaces); propietario 0/0, modos 0644 (lanzadores de `bin/` 0755), 133 120 bytes | **`88e2758d94c9d1793bd7530058880643df8d4058a0f869eed204dc110e703c3b`** |
| `SHA256SUMS-CODIGO.txt` | Huella de cada uno de los 29 archivos (`<hash>  <ruta>`) | (lista) |
| `SHA256SUMS-TAR.txt` | Huella del TAR | — |
**Huella global de código y plantillas** (la aprobada por la segunda revisión): `2096f3e6db13ea46182a92471671a923b18c9f788991cfe6cf61c3632ade30fb`. La huella del TAR **se entrega por un canal distinto** al de los archivos (esta respuesta) y el propietario la **teclea a mano** en la verificación de F2.

### 1.1 Comprobación de que el paquete es EXACTAMENTE lo aprobado
| Contraste | Resultado |
|---|---|
| Construcción **determinista** (dos construcciones seguidas) | TAR idéntico byte a byte |
| TAR releído miembro a miembro frente al repositorio | **Idéntico** (29 archivos) |
| Frente al `MANIFEST-PRODUCTO.json` de `treidilor-inspeccion-revision-2.zip` (lo que revisó el revisor independiente) | **Idéntico**, sin archivos de más ni de menos; huella declarada = `2096f3e6…ade30fb` |
| Frente a la copia validada en Linux (Python 3.8 y 3.12, OpenSSH real) | **Idéntico** |
| Bloque de verificación de F2 ejecutado sobre el TAR real | **`TAR_VERIFICADO`**; con una huella alterada → `TAR_RECHAZADO: NO EXTRAER` |
No se repitieron las 190 pruebas ni el banco SSH: **el código no ha cambiado** (mismas huellas).

## 2. Mecanismo de reversión (revisado)
Detalle en `INSPECCION-ETAPA-2-PLAN.md` §9.1. **Revisión y cambios:**
| Hallazgo en la versión anterior | Corrección |
|---|---|
| Borraba el archivo con un `rm -f` directo, **aunque otra persona lo hubiera cambiado** | Script `revertir.sh` que lo borra **solo si su SHA-256 es el de la plantilla instalada**; si no, no lo toca (`rc=3`) |
| Solo se ensayaba con `/bin/true` | F0 ensaya **el mismo script**: dispara solo, retira lo suyo, respeta lo ajeno y se cancela |
| Recargaba aunque `ssh` estuviera inactivo (SSH por socket) o la configuración quedara rota | Comprueba `sshd -t` y `ssh` activo antes de `reload`; si no, no recarga |
| Un fallo de `logger` o de `reload` podía contarse mal | **Defecto real detectado por las pruebas** (el script devolvía el código de `logger`): corregido con `if/else` explícito y `say` que siempre devuelve 0 |
| Disparaba a mitad de una prueba larga | Sin rearmado (decisión 14/11/2026): si no hay tiempo se revierte y F7 se repite desde una activación nueva |
**Qué ejecuta:** `/bin/sh /root/tai-etapa2/revertir.sh`. **Cómo se activa:** `systemd-run --unit=tai-reversion --on-active=10min …` en F7, tras validar el árbol real y antes de recargar. **Cómo se cancela:** `systemctl stop tai-reversion.timer` y comprobar que no queda temporizador ni servicio activos. **Qué no toca:** `sshd_config`, otros archivos de `sshd_config.d`, claves de root, `authorized_keys` de nadie, Docker, firewall. **Límites:** es transitorio (un reinicio lo elimina), no deshace el usuario ni `/opt` (inertes) y no sustituye al snapshot.
**Pruebas del script (8 escenarios, `sshd`/`systemctl` simulados) y 4 mutaciones:** retira lo suyo y recarga; **no borra un archivo ajeno** (`rc=3`) ni recarga; idempotente si no existe; no recarga si `sshd -t` falla; no recarga si `ssh` no está activo; notifica un fallo de recarga; **no toca otros archivos** de `sshd_config.d`; sin operaciones peligrosas (un único `rm`, sobre `$F`). Quitando la guarda de huella, el `sshd -t` o la comprobación de `ssh` activo, las pruebas **fallan**.

## 3. Secuencia mínima con puntos de parada
| Paso | Qué se hace | **PARAR si…** | Sistema en uso afectado |
|---|---|---|---|
| F0 | Crear `revertir.sh`, ensayarlo y copiar la configuración de `sshd` | falta la consola web, el temporizador no dispara/cancela, `ajeno rc≠3` o `sshd -t` base ≠ 0 | No |
| F1 | Línea base, versión **9.6p1**, `usepam yes`, `Include`=1, 2222 libre | cualquier puerta distinta de lo esperado | No |
| F2 | Subir y **verificar el TAR** (`TAR_VERIFICADO`); extraer; `sha256sum -c` | `TAR_RECHAZADO`, huella o enlaces distintos de lo esperado | No (directorio nuevo) |
| F3 | Usuario, grupo, directorios y registros | algún `rc≠0` o modos distintos de la matriz | No (cuenta nueva) |
| F4 | Configuración mínima, manifiesto y **prueba local del gate sin SSH** | `gate rc≠0`, hostil ≠ 2, registro sin `seq` | No |
| F5 | Configuración de prueba de `sshd` y comparación `sshd -t`/`-T -C` (root, global, `tai-inspect`) | cualquier diferencia o salida de `sshd -t` | Crea un archivo que nadie lee |
| F6 | `sshd` de prueba en `127.0.0.1:2222` con PAM real; huella de la clave real | error de PAM/cuenta bloqueada, resultado ≠ esperado, huella distinta | Solo un proceso en loopback |
| **F7** | Colocar `00-tai-inspect.conf`, validar el árbol real, **armar reversión**, `reload`, V1–V8, cancelar | `F7_VALIDADO` ausente (no se recarga); V1–V8 fallan (no se cancela: revierte sola) | **SÍ: único paso sobre SSH en uso** |
| F8 | Pausa ≥ 24 h solo con gate | invariantes distintos o incidencias | No |
| F9 | `systemd-analyze` → unidades → arranque único → habilitar (autorización propia) | `VERIFY_FALLA`/`SECURITY_FALLA`, `Result≠success` | Unidades nuevas |
Cada paso devuelve su salida al asistente en un punto de control (CP1–CP6); **no se avanza sin esa revisión**.

## 4. Operaciones que podrían afectar a SSH o al acceso administrativo
| Operación | Fase | Efecto posible | Mitigación |
|---|---|---|---|
| Colocar `/etc/ssh/sshd_config.d/00-tai-inspect.conf` | F7 | Única que cambia la configuración que leerá `sshd` | Validación previa con el árbol real (`sshd -t`, `-T -C` idéntico para root y global), prueba real en F6, reversión automática |
| `systemctl reload ssh` | F7 | Re-lectura de configuración; las sesiones abiertas **no** se cortan | Antes `sshd -t`; nunca `restart` |
| Un **reinicio** o **reinicio de `ssh`** con el archivo colocado | F7→cancelación | El `sshd` leería la nueva configuración | Ya validada con `sshd -t` y con una instancia real; no se reinicia durante la ventana |
| Crear `/etc/ssh/authorized_keys.tai-inspect` | F5 | Ninguno hasta F7 (nada lo referencia); no toca las claves de root | Archivo propio de root 0644; se vacía tras la prueba y se sustituye por la clave real |
| `sshd` de prueba en el puerto 2222 | F6 | Usa las claves de host y `/run/sshd`; si se mata mal, afectaría al `sshd` en uso | Escucha solo en loopback; se detiene **solo** con `kill "$(cat pidfile)"`, **nunca** `pkill sshd` |
| `groupadd`/`useradd`/`usermod` | F3 | Modifica `/etc/passwd`, `/etc/group` y `/etc/shadow` (sin relación con root ni con `sshd`) | Cuenta de sistema con contraseña `*` y shell `/bin/sh`; no pertenece a `sudo` ni `docker` |
| Temporizadores transitorios de `systemd-run` | F0, F7 | Ninguno sobre el servicio si no disparan; si disparan, el script es idempotente | Ensayado en F0 con rutas de prueba |
| `daemon-reload` y habilitar `path`/`timer` | F9 | Recarga de unidades de `systemd`; el colector corre como root aislado | Solo tras `verify`/`security`; fase separada; `reload` no reinicia servicios |
**Lo que NO se toca nunca:** `/root/.ssh/authorized_keys`, `/etc/ssh/sshd_config`, el usuario root, su clave y su contraseña, `PermitRootLogin`, Docker, n8n, EasyPanel, Traefik y el firewall. Los **invariantes** (§1.1 del plan) lo comprueban tras F7, F8 y F9.

## 5. Pruebas con SSH real: cuándo se hacen
- **Antes de recargar la configuración definitiva (F6):** todo lo que no necesita la clave del PC se prueba con un **`sshd` real de OpenSSH 9.6 y PAM real** en `127.0.0.1:2222` con la configuración real: autenticación por clave pública (con una clave temporal), contraseña inexistente, `ForceCommand`/gate real, órdenes hostiles, pseudoterminal, reenvío, cuenta no bloqueada por PAM. Además, `sshd -t` y `sshd -T -C` (root, global y `tai-inspect`) con la versión y el PAM del VPS en F5 y de nuevo con el árbol real en F7. La clave temporal se destruye y el archivo de claves se vacía antes de pegar la real.
- **Única prueba posterior a la recarga:** el acceso con **la clave dedicada del propietario por el puerto 22** (V1–V8). **No puede hacerse antes** porque el puerto 22 solo lo atiende el `sshd` en uso y el 2222 es solo de loopback (el firewall del proveedor no lo deja pasar). Se hace **dentro de la ventana de reversión automática de 10 minutos**, y su formato se coteja **antes** de recargar con `ssh-keygen -l -f` (huella idéntica a la del PC). Si falla, no se cancela nada y se revierte sola.

## 6. Propuesta de ventana de mantenimiento (NO programada)
| Concepto | Propuesta |
|---|---|
| **Ventana principal (F0–F7)** | **3 horas** (≈ 2 h 15 min de trabajo + margen y puntos de control) |
| Desglose estimado | F0 20 min · F1 10 · F2 25 (incluye la subida) · F3 10 · F4 15 · F5 20 · F6 20 · F7 30 (10 min de reversión armada) · puntos de control CP1–CP5 ≈ 25 |
| **Pausa de observación (F8)** | ≥ 24 h (mejor 48 h) solo con el gate y 5 comprobaciones del host |
| **Ventana de la fase B (F9)** | **1 hora 30 min**, con autorización propia, tras revisar F8 |
| **Cuándo** | Un **día laborable entre martes y jueves**, por la mañana (p. ej. **09:30–12:30**, hora local del propietario; confirmar zona horaria), con el propietario disponible todo el tiempo y sin la jornada previa a un festivo o a un fin de semana, para poder vigilar F8. **No** viernes ni víspera de festivo |
| Antes de la ventana (el propietario) | Clave dedicada con passphrase generada; snapshot tomado y visible; 2 archivos preparados en el PC; consola web abierta como root |
| Durante la ventana | **Sin `git push` a `main`** (cada push redespliega por webhook y reinicia servicios, y mezclaría señales); sin actualizaciones manuales de paquetes; sin reinicios; el asistente no ejecuta nada: solo revisa las salidas |
| Comprobaciones previas (solo lectura, en F1 o el día antes) | `systemctl list-timers 'apt-daily*' --no-pager` y `fuser /var/lib/dpkg/lock-frontend` (que no haya una actualización automática en curso); `/api/health` con el `sourceHash` conocido |
| Criterio de aplazar | Despliegue en curso, actualización automática en curso, consola web inestable, o cualquier puerta de F0/F1 en rojo |
| Cierre | Informe con salidas, huellas, invariantes y anotación de incidencias; el paquete queda archivado |
**Nada se programa ni se ejecuta**: es una propuesta para que el propietario elija fecha y hora.

## 7. Qué NO se ha repetido y qué cambió
- **No repetido** (el código no cambió): las 190 pruebas en Linux (Python 3.8 y 3.12), `chattr +a`, el banco SSH de OpenSSH 10.3p1.
- **Nuevo en esta entrega:** el paquete y su verificación contra tres fuentes; el script de reversión con su guarda de huella; **10 pruebas** más en `tests/test_plan_etapa2.py` (8 escenarios del script, la huella por defecto y la comprobación del armado); un **defecto real** del script corregido gracias a esas pruebas. Total: **221 pruebas** en Windows, todas correctas, 31 omitidas (solo Linux).
- **Pendiente de autorización:** repetir en un contenedor Linux los 31 casos de `test_plan_etapa2.py` (Docker Desktop está parado; no se arranca sin tu permiso).
- **No comprobable en local:** `systemd-analyze`, el PAM de Ubuntu y OpenSSH 9.6 y `ssh.socket`; el plan los trata como puertas de parada **en el VPS**.

## 8. Siguiente paso
El propietario revisa este documento y el plan, elige fecha y hora y da la **autorización expresa** para empezar (G2). Hasta entonces **no se sube nada y no se ejecuta nada**.
