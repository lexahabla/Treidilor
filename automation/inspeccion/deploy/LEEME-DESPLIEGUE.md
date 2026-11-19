# Plantillas de despliegue (NO instaladas): usuario restringido, directorios y SSH

**Nada de esto está instalado ni se instala en la etapa 0.** Son las órdenes que ejecutaría el **propietario como root en la consola web** durante la etapa 2, tras la segunda revisión independiente y con autorización expresa. Plan completo en `automation/docs/INSPECCION-ETAPA-2-PLAN.md`.

## Usuario restringido (decisiones P2, P4 y P5)
```sh
groupadd --system tai-inspect
useradd --system --gid tai-inspect --no-create-home --home-dir /var/lib/tai-inspect/home --shell /bin/sh tai-inspect
usermod -p '*' tai-inspect
install -d -o root -g root -m 0555 /var/lib/tai-inspect/home
```
- **Shell `/bin/sh`**: `sshd` ejecuta `ForceCommand` con el shell de inicio de sesión (`shell -c orden`); con `nologin` el gate no arrancaría. No hay sesión interactiva porque `ForceCommand`, `restrict`, `PermitTTY no` y `DisableForwarding yes` la impiden (comprobado en `tests/ssh/`).
- **Contraseña `*`** (inutilizable pero **no bloqueada**): con `!` (cuenta bloqueada, lo que deja `useradd --system`) un `sshd` sin PAM rechaza incluso la clave pública (comprobado). Con `*` la clave pública funciona y la contraseña no existe.
- **Directorio de inicio `root:root` `0555`**: el usuario no puede escribir nada en él (ni claves ni archivos de configuración).

## Claves autorizadas (decisión P1)
`/etc/ssh/authorized_keys.tai-inspect`, `root:root` `0644`, con **una** línea: `restrict,command="/opt/tai-inspect/bin/tai-gate" ssh-ed25519 <clave PÚBLICA dedicada> tai-inspect-dedicada` (ver `authorized_keys.example`). El bloque `Match` apunta a ese archivo con `AuthorizedKeysFile`; una clave plantada en el home del usuario **se ignora** (comprobado).

## Configuración de `sshd` (decisión P3)
Instalar `sshd_config.d/00-tai-inspect.conf` como `/etc/ssh/sshd_config.d/00-tai-inspect.conf`. **El nombre no garantiza prioridad por sí solo**: para cada palabra clave gana el primer valor leído entre los bloques `Match` que coinciden con el usuario y los archivos se leen en orden alfabético; con `99-…` cualquier `Match` anterior ganaría (comprobado). Con `00-…` este bloque se lee primero. Verificación obligatoria antes de recargar:
```sh
sshd -t
sshd -T -C user=root,host=localhost,addr=127.0.0.1                 # debe ser IDÉNTICO a la línea base de root
sshd -T -C user=tai-inspect,host=localhost,addr=127.0.0.1          # debe mostrar las directivas de la plantilla
```
`PermitUserEnvironment` **no** puede ir dentro de un `Match` (lo rechaza `sshd -t`): es global y su valor por defecto es `no`; se anota en la línea base.
