# Inspección automática del VPS — ETAPA 1 (versión MÍNIMA): comprobaciones de solo lectura (13/11/2026)

**Estado: preparada, NO ejecutada. Ningún comando se ha lanzado contra el VPS.** Esta versión sustituye a la primera hoja (más larga): se eliminó todo lo ya comprobado y lo que no es imprescindible para preparar el acceso SSH restringido.

## 1. Alcance y reglas
Autorizado (13/11/2026): inspección de **solo lectura**, sin instalar ni cambiar nada. Prohibido: instalar, crear usuarios/claves/conexiones SSH, modificar archivos/permisos/servicios/firewall, usar root para una conexión SSH automatizada, mostrar secretos, variables de entorno o claves, etapas 2–7.
**Conexión:** no hay mecanismo confirmado (`~/.ssh/config` solo plantilla; perfil de Antigravity no verificable; usar tu clave sin passphrase desde aquí sería una conexión nueva). **No me conecto:** los ejecutas tú y yo analizo lo que pegues.

## 2. Qué ya está comprobado (NO se repite)
| Dato | Fuente |
|---|---|
| 2 vCPU, 7,8 GiB RAM, 96 GB disco (83 GB libres) | Comprobado manual 13/11 (`INFRAESTRUCTURA` §2) |
| n8n 2.38.6, runner 2.38.6, PostgreSQL 17 activos | Comprobado manual 13/11 (§3) |
| Swarm de **un solo nodo** Ready/Active/Leader | Comprobado manual 13/11 (§3) |
| Puertos publicados: solo 22/80/443 (Traefik en 80/443); PostgreSQL 5432, n8n 5678 y runner 5680 sin publicar; 3000 cerrado | Comprobado manual 13/11 (§4) |
| Firewall de Hostinger activo (TCP 22/80/443); SSH abierto a «Any» | Comprobado manual 13/11 (§4) |
| Treidilor, n8n y EasyPanel funcionan por HTTPS; webhook en HTTPS probado | Verificado público + manual (§3, §5) |
| Conexión saliente a GitHub; despliegue sin SSH | Comprobado manual (§4, §5) |
| `~/.ssh/config` solo plantilla; `known_hosts` con conexión del 09/10/2026; clave sin passphrase | Verificado local (§6) |

## 3. Qué falta de verdad y por qué es imprescindible
| # | Falta | Para qué sirve en el acceso restringido |
|---|---|---|
| 1 | Usuario real y privilegios (`root`/`sudo`/`docker`) de la conexión SSH existente | Decide si la clave actual debe retirarse/limitarse (riesgo R5) |
| 2 | Directivas **efectivas** de `sshd` (root, contraseñas, `AllowUsers`, bloques `Match`, fail2ban) | Diseñar el bloque `Match User tai-inspect` sin romper el acceso actual |
| 3 | Existencia del usuario/grupo `tai-inspect` y de las rutas de instalación | Evitar choques en la etapa 2 |
| 4 | Python 3 (versión y ruta) y presencia de los 7 ejecutables absolutos que usa el colector | El producto exige `/usr/bin/python3` ≥ 3.8 y rutas fijas; si falta algo, es bloqueante |
| 5 | Sistema operativo, kernel, versiones de SSH, Docker y systemd; sistema de archivos de `/var` | Compatibilidad y preparar la prueba de `chattr +a` (etapa 2) |
| 6 | Nombres **exactos** de los servicios Swarm | Rellenar `ajustes.json` (`servicio_n8n`, `servicio_runner`, `servicio_postgres`) |
| 7 | Cuentas con shell, pertenencia a `sudo`/`docker` y **número** de claves autorizadas (sin contenido) | Saber quién puede entrar hoy |

## 4. Comandos eliminados por redundantes o no esenciales
Nodos y servicios con imagen/puertos (ya consta), puertos a la escucha, lista de servicios `systemd`, historial de accesos, estado de UFW y actualizaciones pendientes, carga/swap/uso por contenedor (comprobaciones `host-*`/`docker-*` de la etapa 2+), `python` del usuario por separado. Quedan **2 bloques** en total.

## 5. Bloque A — consola web de Hostinger (1 pegado; solo lectura)
```sh
echo "## A1 sistema"; uname -sr; grep -E '^(PRETTY_NAME|VERSION_ID)=' /etc/os-release; findmnt -no FSTYPE -T /var/log
echo "## A2 python y ejecutables del colector"; command -v python3; readlink -f "$(command -v python3)"; python3 --version; ls -l /usr/bin/ss /usr/bin/systemctl /usr/bin/apt /usr/bin/timedatectl /usr/bin/docker /usr/sbin/sshd /usr/bin/journalctl 2>&1 | awk '{print $1, $NF}'
echo "## A3 versiones"; ssh -V 2>&1; docker version --format 'cliente={{.Client.Version}} servidor={{.Server.Version}}' 2>&1; systemctl --version | head -1
echo "## A4 servicios Swarm (nombre y replicas)"; docker service ls --format '{{.Name}}|{{.Replicas}}'
echo "## A5 sshd efectivo"; sshd -T 2>&1 | grep -E '^(port|permitrootlogin|passwordauthentication|pubkeyauthentication|kbdinteractiveauthentication|authenticationmethods|maxauthtries|allowtcpforwarding|allowagentforwarding|x11forwarding|permittty|permituserenvironment|usepam|authorizedkeyscommand|loglevel) '; sshd -T 2>&1 | grep -E '^(allowusers|allowgroups|denyusers|denygroups) ' | awk '{print $1, NF-1 " elementos"}'
echo "## A5b sshd: drop-ins, bloques Match (solo recuento) y fail2ban"; ls -1 /etc/ssh/sshd_config.d/ 2>&1; cat /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null | grep -ciE '^[[:space:]]*Match[[:space:]]'; systemctl is-active ssh sshd fail2ban 2>&1
echo "## A6 usuario tai-inspect y rutas"; getent passwd tai-inspect | cut -d: -f1,3,7; getent group tai-inspect | cut -d: -f1,3; ls -ld /opt/tai-inspect /var/lib/tai-inspect /var/log/tai-inspect /etc/tai-inspect 2>&1 | awk '{print $1, $3, $4, $NF}'
echo "## A7 cuentas, grupos y claves (solo recuentos)"; awk -F: '$7 !~ /(nologin|false)$/ {print $1":uid="$3":"$7}' /etc/passwd; getent group sudo docker | awk -F: '{print $1":miembros="$4}'; for f in /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys; do [ -f "$f" ] && echo "$f lineas=$(grep -cEv '^[[:space:]]*(#|$)' "$f") con_command=$(grep -c 'command=' "$f") con_restrict=$(grep -c 'restrict' "$f") $(stat -c '%U:%G %a' "$f")"; done
```
Notas de seguridad: `docker service ls` con `--format` solo muestra nombre y réplicas; las líneas de `authorized_keys` **se cuentan, no se muestran**; `sshd -T` se filtra para no mostrar rutas de claves de host; ningún comando lee `env`, tokens ni contraseñas.

## 6. Bloque B — desde una sesión SSH (la conexión de Antigravity; 1 pegado)
**Debe ejecutarse desde esa sesión**, porque determina qué privilegios tiene *esa* identidad; la consola web (otra sesión, normalmente root) no lo puede responder.
```sh
echo "## B1 identidad"; whoami; id; echo "servidor=$(echo "$SSH_CONNECTION" | awk '{print $3":"$4}') orden_forzada=${SSH_ORIGINAL_COMMAND:-(vacia)}"
echo "## B2 privilegios (no interactivo)"; sudo -n -l 2>&1 | head -15; docker version --format 'docker_servidor={{.Server.Version}}' 2>&1 | head -2; [ -w /etc/ssh/sshd_config ] && echo "escribe_sshd_config=si" || echo "escribe_sshd_config=no"
```
`sudo -n -l` no pide contraseña y solo lista permisos (deja una línea en el registro de autenticación). Si `docker version` responde con un número, esa identidad **controla Docker** (equivale a root).

## 7. Criterios de lectura (fijados antes de ver datos)
| Resultado | Consecuencia |
|---|---|
| B1 = `root`, o B2 muestra `sudo` sin restricciones o acceso a Docker | La clave actual es equivalente a root → riesgo R5 **confirmado**; propuesta de limitarla en la etapa 2 |
| A5: `permitrootlogin yes` o `passwordauthentication yes` | Riesgo de fuerza bruta con 22 abierto a «Any» → endurecer en etapa posterior (sin tocarlo ahora) |
| A5b: sin `fail2ban`/equivalente | Registrar como carencia |
| A2: falta `python3` ≥ 3.8 o algún ejecutable | **Bloqueante** para la etapa 2 |
| A6: `tai-inspect` ya existe o hay rutas ocupadas | Revisar antes de instalar |
| A4: nombres de servicios | Se anotan para `ajustes.json` (sin secretos) |

## 8. Fuera de la etapa 1 (se mantienen pendientes en `INFRAESTRUCTURA` §8)
2FA de GitHub/EasyPanel, visibilidad del repositorio y protección de `main`, rotación del token del webhook, copias de seguridad, ICMP, plan de reversión y comprobaciones de recursos/redes/tablas (requieren el acceso restringido de la etapa 2). **No se inicia la etapa 2** sin autorización expresa; `chattr +a` queda en ella.

## 9. Resultados del Bloque A (ejecutado por el propietario en la consola web de Hostinger, 13/11/2026)
**Origen: [Comprobado manual 13/11, consola web]**; el asistente no los ha verificado de forma independiente. No se mostró ningún secreto ni el contenido de ninguna clave.

| Dato | Resultado | Lectura |
|---|---|---|
| Sistema | Ubuntu **24.04.4 LTS**, kernel **6.8.0-147**, `/var/log` en **ext4** | Compatible con el producto; `chattr +a` es técnicamente posible en ext4 (a probar en la etapa 2) |
| Python | **3.12.3** en `/usr/bin/python3` | Cumple ≥ 3.8; el producto se validó en 3.8 y 3.12 |
| Versiones | Docker **29.7.2**, OpenSSH **9.6p1**, systemd **255** | **Docker 29 es posterior a lo probado en local**: el formato de `--format` de las órdenes fijas debe validarse con muestra (fichas 1–5) |
| Ejecutables | Los **7** presentes | Sin bloqueo |
| Swarm | **6 servicios 1/1** y **1 antiguo 0/0** | El servicio 0/0 es un residuo a identificar (nombres exactos aún sin anotar: necesarios para `ajustes.json`) |
| `sshd` | Permite **root**, **autenticación por contraseña**, reenvío **TCP** y de **agente**; **sin bloques `Match`** | Ver riesgos; el valor exacto de `permitrootlogin` (`yes` o `prohibit-password`) conviene anotarlo |
| `fail2ban` | **Inactivo** | Sin freno a la fuerza bruta |
| `tai-inspect` y rutas | **No existen** | Sin choques para la etapa 2 |
| Claves autorizadas | **root: 1 clave sin restricciones** (sin `command=` ni `restrict`) | Una sola clave de acceso total |

### 9.1 Riesgos que confirman estos datos
| Riesgo | Gravedad | Detalle |
|---|---|---|
| **R5 reforzado:** SSH (22) abierto a «Any» + root permitido + **contraseña habilitada** + **fail2ban inactivo** | **Alta** | Es exactamente la combinación que expone a fuerza bruta y relleno de credenciales; la protección actual es la fortaleza de la contraseña de root, que no se ha verificado |
| Clave de root sin restricciones y sin passphrase en el PC | **Alta** | Quien tenga el PC o la clave tiene root en el VPS, incluido Docker y todos los datos |
| Reenvío TCP y de agente permitidos | Media | Facilitan el movimiento lateral si una sesión se compromete |
| Docker 29 más nuevo que lo validado | Media | Riesgo de formato distinto en las órdenes de solo lectura; las comprobaciones sensibles siguen cerradas hasta validarlas |
| Servicio 0/0 antiguo | Baja | Residuo sin identificar |
**No se ha modificado nada** (y no se debe, en la etapa 1): estos hallazgos pasan al informe como **requisitos de endurecimiento** para etapas posteriores y requieren autorización expresa.

### 9.2 Bloque B (privilegios de la conexión de Antigravity): cómo completarlo sin inventar una sesión
- **No existe una sesión SSH establecida que el asistente pueda usar** y no se ha confirmado ninguna. No se abre ninguna conexión nueva.
- **Vía recomendada (la más simple y segura):** el propietario abre el **terminal integrado de Antigravity**, que ya está conectado al VPS por su conexión existente, y pega el Bloque B de §6 (2 líneas, solo lectura). Si ese terminal no está conectado, **no se conecta para esto**: se usa la vía alternativa.
- **Vía alternativa sin sesión (consola web de Hostinger, solo lectura, solo recuentos):**
```sh
echo "## B-alt accesos aceptados por usuario y metodo (sin IP)"; journalctl -u ssh -u sshd --no-pager -o cat 2>/dev/null | grep -oE 'Accepted [a-z-]+ for [A-Za-z0-9_-]+' | sort | uniq -c; last -w -n 15 | awk 'NF>=2 {print $1, $2}'
```
  Muestra con qué usuario y método se han aceptado accesos recientes, sin direcciones IP. Como **la única clave autorizada es la de root**, lo esperable es `Accepted publickey for root` (**[Inferido]**: la conexión de Antigravity entra como root); esta línea lo **confirma o desmiente** sin tocar nada.
- Hasta tener B o B-alt, el estado de R5 es «**probablemente root, sin verificar**».

### 9.3 Resultado de B-alt (consola web, 13/11/2026) — **[Comprobado manual]**
`7 Accepted publickey for root`: **siete accesos SSH aceptados como `root` mediante clave pública** en el periodo que cubre el registro de `journald`.
**Qué demuestra:** que root **sí** entra por SSH con su única clave autorizada y que hoy **no hay accesos SSH recientes con otro usuario ni por contraseña** (en ese registro).
**Qué NO demuestra:** quién ni desde dónde se hicieron esas conexiones. **No se atribuyen a Antigravity, a Claude ni a ningún cliente concreto** sin evidencia adicional (el registro no incluye origen en este recuento; no consta qué cliente usó la clave). El estado de R5 pasa a: «**root con clave pública utilizable por SSH — confirmado; cliente que la usa — sin atribuir**». El Bloque B (desde el terminal de Antigravity) sigue siendo la única forma de saber qué identidad usa *esa* conexión; no es imprescindible para la etapa 2, porque la clave actual **no se toca**.

## 10. Informe final de la etapa 1
**Datos comprobados** (propietario, consola web de Hostinger; ninguno verificado de forma independiente por el asistente): §9 (Bloque A) y §9.3 (B-alt), más lo ya comprobado el 13/11 (§2).
**Riesgos confirmados:** (1) root permitido por SSH + contraseña habilitada + 22 abierto a «Any» + `fail2ban` inactivo; (2) **una sola clave de root, sin restricciones y sin passphrase**, con siete accesos recientes de origen sin atribuir; (3) reenvío TCP y de agente permitidos; (4) Docker 29.7.2 posterior a lo validado en local; (5) un servicio Swarm 0/0 sin identificar.
**Requisitos para la etapa 2** (detalle y procedimiento en `INSPECCION-ETAPA-2-PLAN.md`): segunda revisión independiente aprobada y código fijado por huella; autorización expresa y ventana de trabajo; snapshot previo y consola web verificada; clave dedicada con passphrase generada por el propietario; **no tocar** la clave de root ni la configuración global de `sshd`; todas las comprobaciones sensibles cerradas.
**Pendiente de anotar:** valor exacto de `permitrootlogin` y nombres de los siete servicios Swarm (para `ajustes.json`).
**No se ha avanzado a la etapa 2.**
