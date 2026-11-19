# Ensayo de instalación en un host Linux real de pruebas (preparación, 3E.8.16)

**Estado: preparado, NO ejecutado.** No se ha creado ninguna VM, no se ha modificado Windows ni Docker Desktop y no se ha tocado el VPS. Este documento es el contrato para cuando el propietario habilite un entorno. Objetivo: ejecutar `f36-instalacion-confianza.test.mjs` completo —incluida la prueba «PRODUCCIÓN COMPLETA COMO ROOT REAL», que se omite si el usuario no es UID 0— con **root real y un daemon Docker propio**, sin ningún acceso a los recursos del proyecto.

## 1. Qué hay hoy y por qué no sirve (comprobado en solo lectura)
WSL2 tiene una sola distribución, `docker-desktop`, que es la máquina virtual del Docker Desktop del equipo y aloja los 10 contenedores, 4 volúmenes e imágenes reales del proyecto. Usarla, montar `docker.sock` o recurrir a Docker-in-Docker (`--privileged`) daría control sobre ese daemon: **no está aislado**.

## 2. Criterios que debe cumplir el entorno (lista de aceptación)
| # | Criterio | Cómo se comprueba al empezar |
|---|---|---|
| 1 | Daemon Docker **propio**, distinto del de Docker Desktop | `docker info` muestra otro `Name` y `/var/lib/docker` vacío; `docker ps -a` y `docker volume ls` vacíos |
| 2 | Root real (UID 0) y sistema Linux completo | `id -u` = 0; `uname -a`; `systemctl is-system-running` |
| 3 | **Sin acceso** a las unidades de Windows, a `D:\AXEL`, a `secretos-e3`, a credenciales ni a `docker.sock` del host | `ls /mnt` vacío o inexistente; sin carpetas compartidas; sin claves SSH ni tokens |
| 4 | Sin ruta hacia el VPS ni producción (ninguna clave, ninguna entrada en `known_hosts`) | `ls ~/.ssh` vacío |
| 5 | Desechable: se borra al terminar sin dejar restos en el equipo | procedimiento de limpieza (§7) |
| 6 | Recursos limitados | §4 |
| 7 | Red solo para instalar Docker y la imagen base; **cortada** durante las pruebas | §5 |

## 3. Opciones (de mayor a menor aislamiento) — requieren AUTORIZACIÓN y acción del propietario
| Opción | Aislamiento | Qué modifica del equipo | Observaciones |
|---|---|---|---|
| **A. Máquina física o VM externa desechable** (otro PC, VM de un proveedor en un proyecto propio, Raspberry/mini-PC) | **Total** (otro kernel y otra red) | nada | **Recomendada.** Solo se le copian artefactos sintéticos |
| **B. VM local** (Hyper-V, VirtualBox, VMware) | Alto (kernel propio) | habilita/instala un hipervisor y crea una VM | Hoy hay un hipervisor activo (VBS) pero **no** se ha comprobado que Hyper-V esté disponible para VM; instalar o habilitarlo es un cambio del host |
| **C. Distribución WSL2 nueva** (`wsl --import`/`--install`) con `docker` propio | Medio: **comparte el kernel** de la VM de WSL2 con Docker Desktop, aunque con sistema de archivos y daemon distintos | añade una distribución a WSL | Solo con `automount` e `interop` desactivados (`/etc/wsl.conf`: `[automount] enabled=false`, `[interop] enabled=false`) para que no vea `D:\`; sin `docker.sock` de Docker Desktop (desactivar la integración WSL de esa distribución) |
**Recomendación:** A (o B si el propietario prefiere local). C solo como mínimo aceptable y declarando el límite del kernel compartido.

## 4. Requisitos mínimos de la máquina
| Recurso | Mínimo | Comentario |
|---|---|---|
| CPU | 2 vCPU | igual que el VPS (2 vCPU) |
| RAM | 4 GiB (ideal 8) | f36 construye varias imágenes y los contenedores usan 128–512 MiB; el VPS tiene 7,8 GiB |
| Disco | 30 GB libres | imágenes `node:22-bookworm-slim` + builds; el instalador exige ≥ 4×TAR+50 MB de temporal |
| Arquitectura | x86_64 | como el VPS |
| Kernel | ≥ 5.15, cgroup v2 | para reproducir los límites de memoria/PIDs de las pruebas |

## 5. Sistema y Docker
- **Distribución:** Ubuntu Server 24.04 LTS (o Debian 12 «bookworm», coherente con la imagen base). **Antes de fijarla, el propietario debe anotar la del VPS** (`cat /etc/os-release`, `docker version`, `systemd --version`) porque hoy no consta en la documentación (`INFRAESTRUCTURA-VPS-PRODUCCION.md` lo deja pendiente): el ensayo debe parecerse a ella.
- **Instalación de Docker Engine:** solo desde el repositorio apt oficial de Docker (clave GPG y repositorio documentados por Docker), paquetes `docker-ce docker-ce-cli containerd.io docker-buildx-plugin`; anotar la versión instalada. Sin rootless y sin `--privileged`.
- **Descarga de la imagen base una vez:** `docker pull node:22-bookworm-slim` y anotar su digest. Después **cortar la red** (política de salida denegada en el cortafuegos de la VM o desconectar el adaptador); f36 funciona sin red porque los contenedores usan `--network none`.
- Herramientas necesarias: `bash`, `tar` GNU, `coreutils`, `awk`, `git`, `node` 22 (para ejecutar las pruebas; instalar desde NodeSource/nvm o el paquete oficial de Node).

## 6. Transferencia segura de artefactos sintéticos
Copiar **solo** (sin claves privadas ni datos reales; todo lo siguiente ya está libre de secretos, comprobado en 3E.8.15):
1. `treidilor_web/automation/director/` y `treidilor_web/scripts/automation/` (código y pruebas), `treidilor_web/automation/config/local.json`.
2. `paquetes/director/candidato-1.1.0-rc2-pruebas/`, `paquetes/director/confianza-pruebas-3e8-14/`, `paquetes/director/director-paquete-prueba/` (contiene el TAR 1.0.0-f2).
3. `treidilor-ai/prototipo-incidencias-director/src/` (solo `src`; **no** el informe real ex-37 ni `test/`), para el CLI.
4. `treidilor-ai/director-dist/` como `git bundle` (o saltar la última prueba de f36, que comprueba que el repositorio no cambia).
Procedimiento: generar en Windows una lista `SHA256SUMS` de lo anterior, comprimir en un único `.tar`, transferirlo por un canal cifrado que el propietario controle (scp a la VM A, o carpeta compartida de solo lectura en B), **verificar `sha256sum -c`** en destino y descomprimir en `/srv/tai-ensayo/` respetando la estructura relativa (`treidilor_web/`, `paquetes/`, `treidilor-ai/`). No se envía nada a un servicio de terceros que no sea la propia VM.

## 7. Ejecución y limpieza
1. Comprobar los criterios de §2 y anotarlos (evidencia).
2. `cd /srv/tai-ensayo/treidilor_web/automation/director && sudo -i` (o ejecutar como root) y `node --test --test-timeout=900000 tests/f36-instalacion-confianza.test.mjs` y, aparte, `tests/f34-instalacion-scripts.test.mjs` y `f35`. Resultado esperado: f36 **12 pruebas** (la de «PRODUCCIÓN COMPLETA COMO ROOT REAL» ya no se omite), sin fallos.
3. Pruebas adicionales con el daemon real (manuales, sintéticas): interrupción (SIGKILL) durante `instalar.sh`, durante `revertir.sh` y durante la actualización de confianza; espacio agotado (`--tmpfs`/cuota); permisos denegados; Docker parado (`systemctl stop docker`) durante la instalación; segunda instalación concurrente.
4. Medir y anotar tiempos y consumo (`/usr/bin/time -v`, `docker stats --no-stream`).
5. Limpieza: `docker rm -f $(docker ps -aq)`; `docker rmi $(docker image ls -q)`; `docker volume prune -f` **solo dentro de la VM** (es desechable; en el equipo real esos comandos están prohibidos); apagar y **destruir** la VM (A/B) o `wsl --unregister` (C); borrar el `.tar` de transferencia y las copias intermedias del equipo de origen.

## 8. Qué NO demuestra este ensayo (límites a declarar en el informe)
Que el VPS real tenga el mismo kernel, versión de Docker, cortafuegos de Hostinger o permisos; el comportamiento con datos reales; y, en la opción C, aislamiento de kernel. Siguen pendientes: raíz y clave de paquete del propietario, y la instalación real como fase aparte con autorización expresa.
