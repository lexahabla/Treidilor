# Infraestructura del VPS de producción (Hostinger) — seguridad y despliegue

> **DOCUMENTO SENSIBLE.** Describe la superficie de exposición del servidor. **No incluye** IPs, nombres de usuario, tokens, claves ni valores de variables de entorno, y debe seguir así. **Antes de cualquier commit hay que comprobar si el repositorio de GitHub es público o privado** (no consta en local); si fuera público, este archivo no debería publicarse tal cual.
>
> **Estado (13/11/2026, actualizado por la noche): solo documentación y análisis local.** El propietario ha realizado ese día dos cambios en producción (webhook de despliegue a HTTPS y activación del firewall de Hostinger); este documento los **registra**. El asistente **no se ha conectado al VPS**, no ha modificado código, workflows, servicios, usuarios ni credenciales, y no hay commits, merge ni push. Los cambios que siguen **no están autorizados**.

## 0. Cómo leer los orígenes
| Etiqueta | Significado |
|---|---|
| **[Comprobado manual 13/11]** | Lo comprobó el propietario ese día en el VPS, GitHub, EasyPanel u Hostinger y lo comunicó; el asistente **no** lo ha verificado de forma independiente |
| **[Verificado local]** | Lo comprobó el asistente leyendo archivos locales, Git o la documentación del repositorio |
| **[Verificado público]** | Lo comprobó el asistente con peticiones públicas de solo lectura (HTTPS, DNS, cabeceras) |
| **[Documentado]** | Consta en documentación del repositorio o del proveedor, sin comprobación actual |
| **[Inferido]** | Deducción razonable, sin comprobar |
| **[Pendiente]** | No se sabe; requiere comprobación (§8) |

## 1. Resumen
- Un solo VPS (2 vCPU, 7,8 GiB de RAM, 96 GB de disco) con **Docker Swarm de un único nodo** aloja Treidilor (web SSR), n8n, PostgreSQL, el runner de n8n, EasyPanel y Traefik. Hay holgura de recursos (§2).
- **Despliegue:** Git HTTPS → GitHub → webhook **HTTPS** → EasyPanel → build Docker; **sin SSH** (§5). El cambio de HTTP a HTTPS se probó el 13/11 con éxito.
- **Exposición actual:** firewall de Hostinger **activo**; solo entran TCP **22, 80 y 443**. El panel de EasyPanel funciona por HTTPS y el puerto **3000 está cerrado** (§4).
- **Lo que sigue abierto:** el **token del webhook no se ha rotado** (estuvo en una URL HTTP); el **SSH (22) está abierto a cualquier origen** y sus privilegios no están verificados; no hay 2FA/protección de rama comprobados; las copias de seguridad siguen siendo insuficientes; y falta un acceso de inspección que no dependa de ti (diseño en `INSPECCION-AUTOMATICA-VPS-DISENO.md`).

## 2. Recursos del VPS
| Recurso | Valor | Origen |
|---|---|---|
| CPU | 2 vCPU | [Comprobado manual 13/11] |
| RAM total | 7,8 GiB | [Comprobado manual 13/11] |
| RAM disponible | 6,3 GiB (≈ 1,5 GiB en uso, ≈ 19 %) | [Comprobado manual 13/11]; el uso es **cálculo** (7,8 − 6,3) |
| Disco total | 96 GB | [Comprobado manual 13/11] |
| Disco disponible | 83 GB (≈ 13 GB en uso, ≈ 14 %) | [Comprobado manual 13/11]; el uso es **cálculo** (96 − 83) |
| Carga media, swap, uso por contenedor, espacio de Docker | — | [Pendiente] |
**Lectura:** hay margen para un servicio pequeño; con 2 vCPU el límite es la concurrencia, no la RAM ni el disco. Un colector de inspección debe ser de muy bajo consumo y ejecutarse bajo demanda.

## 3. Servicios y versiones
| Servicio | Estado | Origen |
|---|---|---|
| n8n **2.38.6** | Activo y funcionando | [Comprobado manual 13/11] |
| PostgreSQL **17** | Activo; **acepta conexiones** | [Comprobado manual 13/11] |
| Runner de n8n **2.38.6** | Activo | [Comprobado manual 13/11] |
| **Docker Swarm de un único nodo** (Ready/Active/Leader) | Sí | [Comprobado manual 13/11] |
| Modo del runner (externo, `N8N_RUNNERS_MODE=external`) y un solo runner | — | [Documentado] (`F2C-ROTACION-TOKEN-RUNNER.md`); no comprobado hoy |
| Proyecto de EasyPanel `practice_project_n8n` con los servicios `n8n`, `n8n-runner` y PostgreSQL | — | [Documentado] |
| Treidilor (web SSR, Astro/Node, puerto interno 4321) | En servicio; `status: ok`, `sourceHash` de `affa3de` | [Verificado público] 13/11 21:22 UTC |
| EasyPanel por HTTPS (`https://<dominio-HTTPS-del-panel>`): respuesta `200`, certificado Let's Encrypt válido hasta 06/02/2027, el puerto 80 redirige a HTTPS; **sin cabeceras de seguridad ni HSTS** | Sí | [Verificado público] |
| EasyPanel: versión, 2FA, método de autenticación | — | [Pendiente] |
| Traefik (proxy inverso y TLS) | Activo | [Comprobado manual 13/11]; configuración [Pendiente] |

### 3.1 Datos de n8n
- Se localizaron **dos tablas físicas** de datos de n8n **cuyo nombre lógico no está identificado** [Comprobado manual 13/11].
- **No se debe asumir** que son `calidad_catalogo_instantaneas` y `auditor_general_instantaneas`: el estado de producción del Agente 04 es **comunicado** y el del Agente 12 también (14/11/2026: tabla `auditor_general_instantaneas` con 2 filas, `ex-13` y `ex-17`; **no verificado por el asistente**).
- La identificación se hará con los metadatos de las Data Tables (comprobación `n8n-tablas-metadatos`, etapa 4 del diseño de inspección), sin leer contenido.

## 4. Red y exposición
| Elemento | Estado | Origen |
|---|---|---|
| Redes **overlay** diferenciadas para n8n y para Treidilor | Sí; nombres y pertenencia de cada contenedor: [Pendiente] | [Comprobado manual 13/11] |
| **Firewall de Hostinger `Treidilor-VPS-Seguridad` ACTIVO**: acepta TCP **22, 80 y 443** y descarta el resto | Sí | [Comprobado manual 13/11] |
| **Puerto 3000 (EasyPanel): bloqueado** al acceso HTTP directo; el panel solo por HTTPS (443) | Sí | [Comprobado manual 13/11]. Mi sondeo anterior (antes de activar) lo vio abierto; **no lo he repetido** |
| Puertos 80 y 443 (Traefik) | Publicados y funcionando | [Comprobado manual 13/11]; [Verificado público] |
| PostgreSQL 5432, n8n 5678, runner 5680: sin publicación directa | Sí | [Comprobado manual 13/11] |
| Treidilor, n8n y EasyPanel funcionan tras activar el firewall; **el servicio no se reinició** al activarlo | Sí | [Comprobado manual 13/11]; [Verificado público] (`startedAt` 20:47:29 UTC sin cambios a las 21:22) |
| El VPS **mantiene la conexión saliente con GitHub** | Sí | [Comprobado manual 13/11] |
| Puertos de Swarm **2377, 7946 y 4789**: **no necesarios** con un solo nodo, y ahora cerrados desde fuera | — | Un nodo: [Comprobado manual 13/11]; «no necesarios» [Inferido] (el tráfico entre contenedores no pasa por la interfaz del VPS) |
| El firewall filtra el tráfico **entrante** y por defecto descarta; si hace seguimiento de conexiones no consta | — | [Documentado] (Hostinger); la conexión saliente a GitHub **sugiere** que no impide las respuestas [Inferido] |
| **ICMP** no está entre las reglas aceptadas | Probablemente descartado (el `ping` no responderá) | [Inferido]; efecto sobre la detección de MTU sin comprobar |
| **IPv6:** `treidilor.com` y el panel **no tienen registro AAAA** | Web solo por IPv4 | [Verificado público] |
| **SSH (22) abierto a «Any»** | Sí | [Comprobado manual 13/11] |
| Task broker de n8n (5679) solo en red interna | — | [Documentado]; no comprobado hoy |

**Consecuencias técnicas:**
- El firewall de Hostinger actúa **antes** de Docker, así que **no sufre** la limitación de UFW (Docker se salta UFW) [Inferido: es un firewall de red del proveedor].
- Los servicios internos (PostgreSQL, n8n, runner) no están publicados y las redes *overlay* los aíslan; el firewall añade una segunda barrera a los puertos de Swarm.
- La **única superficie inicial** hacia Internet es 22, 80 y 443. El SSH es ahora el punto más delicado.
- El futuro Director o colector debería correr en una red propia, sin acceso a PostgreSQL salvo lo estrictamente necesario (decisiones D4/D7).

## 5. Mecanismo de despliegue: Git HTTPS → GitHub → EasyPanel
**Cadena:** `git push origin main` (HTTPS) → GitHub → **webhook** (evento `push`) → «Deployment Trigger» de EasyPanel **por HTTPS** (`https://<dominio-HTTPS-del-panel>/api/deploy/<token>`) → build del `Dockerfile` → reemplazo del servicio. La imagen estampa una huella del código (`BUILD_INFO.json`) que `/api/health` muestra como `sourceHash`.

| Aspecto | Estado | Origen |
|---|---|---|
| Remoto `origin` = GitHub por **HTTPS** (sin SSH); 369 pushes registrados desde este PC; última el 13/11 14:34:15 (`affa3de`); `HEAD` = `origin/main` | Comprobado | [Verificado local] |
| Sin hooks de Git, CI/CD, scripts de despliegue ni acciones de GitHub en el repositorio | Comprobado | [Verificado local] |
| **El webhook de GitHub apuntaba a `http://<IP>:3000/…`** (confirmado) y **se cambió a HTTPS** (`https://<dominio-HTTPS-del-panel>/…`), conservando ruta y token | Hecho | [Comprobado manual 13/11] |
| **Redelivery de `affa3de`** tras el cambio: entrega en verde y Request URL con `https://<dominio-HTTPS-del-panel>` | Hecho | [Comprobado manual 13/11] |
| Tras la prueba: `status: ok`; **mismo `sourceHash`** (`0885734050b5…`); **reinicio del servicio** (`startedAt` 20:47:29 UTC; antes 13:44:24); `builtAt` sin cambios (la imagen o su capa se reutilizó de la caché) | Comprobado | [Verificado público] 20:49 y 21:22 UTC |
| La ruta HTTPS de despliegue existe y rechaza un token inválido (`404 Invalid Token`) | Comprobado | [Verificado público] |
| La repetición confirma que **el token actual vale por HTTPS** | Comprobado | [Verificado público] + [Comprobado manual 13/11] |
| EasyPanel despliega `main` con compilación por Dockerfile desde `lexahabla/TRADYLOR` | Sí | [Comprobado manual 13/11] |
| **Token del webhook NO rotado:** estuvo configurado en una URL **HTTP** | Pendiente | **[Pendiente]** |
| Secreto de firma del webhook y verificación en EasyPanel | No consta | **[Pendiente]** |
| ¿Despliega solo `main` o cualquier rama? ¿Qué es `origin/Master`? | — | **[Pendiente]** |
| Visibilidad del repositorio, protección de `main`, 2FA en GitHub y EasyPanel | — | **[Pendiente]** |
| Alcance de los tokens de GitHub (el conectado a EasyPanel y el usado para `push`) | — | **[Pendiente]** |
| Reversión probada tras un despliegue defectuoso (el botón *Deploy* de EasyPanel no depende del webhook) | No documentada | **[Pendiente]** |
| Credencial del `push` (`credential.helper = manager`) | No visible | [Verificado local] (parcial) |

**Implicación:** quien pueda hacer `push` a `main` ejecuta código en producción sin otro control. La seguridad de la cuenta de GitHub, del PC y de la rama `main` forma parte de la seguridad del servidor.

## 6. Acceso SSH restringido para la inspección (arquitectura D) — diseño en documento aparte
**Estado:** arquitectura **D (colector de diagnósticos y visor restringido)** aceptada provisionalmente; **implementación NO autorizada.** El diseño completo (componentes, catálogo de comprobaciones, permisos mínimos, límites, auditoría y etapas) está en **`INSPECCION-AUTOMATICA-VPS-DISENO.md`**.

**Punto de partida local [Verificado local]:** `~/.ssh/config` solo contiene una plantilla; la extensión de Antigravity (`jajera.vsx-remote-ssh`) guarda su propio perfil (no inspeccionado); `known_hosts` prueba una conexión a la IP del VPS el 09/10/2026; la clave `id_ed25519` **no tiene passphrase**. **Usuario remoto, pertenencia a `root`/`docker`/`sudo` y restricciones: [Pendiente]** (4 comandos preparados, sin ejecutar).

**Resumen:** usuario `tai-inspect` sin privilegios; clave dedicada con `restrict,command=`; un *gate* que solo acepta nombres de una lista cerrada; un colector `systemd` propiedad de `root` que ejecuta scripts fijos de solo lectura, filtra secretos y deja informes que el usuario solo puede leer; auditoría en servidor y en local; interruptor de parada. Alternativas descartadas o secundarias: `sudo` a scripts fijos (A), proxy del socket de Docker (B, filtra variables de entorno), grupo `docker` (C, prohibido), certificados SSH de vida corta (E, opcional), inspección manual (F, contingencia).

## 7. Análisis de riesgos (estado tras los cambios del 13/11)
Probabilidad e impacto **cualitativos y provisionales**.

| # | Riesgo | Prob. | Impacto | Estado | Pendiente / mitigación |
|---|---|---|---|---|---|
| R1 | Panel de EasyPanel expuesto a Internet por el 3000 (HTTP) | — | Muy alto | **Mitigado**: 3000 cerrado; el panel va por HTTPS | Falta comprobar 2FA y política de contraseñas; el panel sigue siendo accesible por 443 |
| R2 | Webhook de despliegue en HTTP con token en la URL | Media | Alto | **Parcialmente mitigado**: ya va por HTTPS | **Rotar el token** (estuvo en HTTP); valorar firma y rama |
| R3 | Un `push` a `main` llega directo a producción; el PC o la cuenta de GitHub comprometidos = ejecución de código | Baja-media | Muy alto | **Abierto** | Protección de rama, 2FA, token fino, entorno de pruebas |
| R4 | Sin firewall | — | Alto | **Mitigado** (firewall activo) | Defensa en profundidad: no hay firewall del propio sistema; revisar ICMP |
| R5 | Privilegios de la conexión SSH desconocidos; clave **sin passphrase**; **22 abierto a «Any»** | Media | Alto si es `root`/`docker`/`sudo` | **Abierto** | Verificar privilegios; acceso restringido (etapas 1-2 del diseño); restringir el 22 |
| R6 | Copias insuficientes: solo *snapshots* semanales; sin volcado independiente de PostgreSQL ni restauración probada | Media | Alto | **Abierto** | Copia de PostgreSQL y restauración probada **antes** de F3 |
| R7 | Un único VPS y nodo (2 vCPU): un servicio nuevo o un pico degrada la web | Media | Medio | Abierto | Límites de recursos; colector bajo demanda |
| R8 | Clave de cifrado de n8n y credenciales en el mismo servidor | Baja | Alto | Abierto [Documentado] | Copia cifrada de la clave fuera del VPS |
| R9 | Tablas de datos sin identificar; nombres físicos internos de n8n | Media | Medio | Abierto | Identificar por metadatos |
| R10 | Sin plan de reversión documentado para un despliegue defectuoso | Media | Medio-alto | Abierto | Documentar (botón *Deploy*, imagen anterior, `git revert`) |
| R11 | `origin/Master` y ramas de funcionalidad no publicadas: confusión sobre qué rama despliega | Baja | Medio | Abierto | Aclarar |
| R12 | Repositorio posiblemente público y este documento sensible | Desconocida | Medio | Abierto | Comprobar visibilidad antes de versionar |
| R13 | Parches del sistema y de EasyPanel sin verificar | Media | Medio-alto | Abierto | Política de actualizaciones (`host-actualizaciones`) |
| R14 | **ICMP descartado** y firewall del proveedor como única barrera | Baja | Bajo-medio | Nuevo | Valorar aceptar ICMP; defensa en profundidad |
| R15 | Datos personales o secretos en los registros al inspeccionarlos | Media | Medio | Nuevo (diseño de inspección) | Solo recuentos y mensajes normalizados; excluir registros de acceso |

## 8. Comprobaciones pendientes (sin repetir las ya hechas)
**Ya realizadas, no repetir:** recursos, versiones de n8n/PostgreSQL/runner, un solo nodo Swarm, puertos publicados, reglas del firewall y su activación, 3000 cerrado, funcionamiento de Treidilor/n8n/EasyPanel por HTTPS, conexión saliente a GitHub, webhook en HTTPS probado con el `sourceHash` idéntico.

| # | Pendiente | Cómo (solo lectura) | Prioridad |
|---|---|---|---|
| 1 | Privilegios de la conexión SSH (usuario, `root`, `docker`, `sudo`, restricciones) | Los 4 comandos preparados (etapa 1 del diseño) | **Alta** |
| 2 | Directivas de `sshd` y bloqueo de fuerza bruta; versión de Docker y de `systemd` | Terminal con tu sesión | **Alta** |
| 3 | 2FA en GitHub y EasyPanel; visibilidad del repositorio; protección de `main`; `origin/Master` | GitHub y panel | **Alta** |
| 4 | **Rotación del token del webhook** | Procedimiento aparte | **Alta** |
| 5 | Secreto de firma del webhook; qué ramas dispara; alcance de los tokens de GitHub | GitHub/EasyPanel | Media |
| 6 | Carga media, swap, uso por contenedor, espacio de Docker | Comprobaciones `host-*` y `docker-*` | Media |
| 7 | Nombres de las redes *overlay* y qué contenedor está en cada una | `docker-redes` | Media |
| 8 | Identificar las dos tablas físicas; existencia de la tabla del Auditor | `n8n-tablas-metadatos` | Media |
| 9 | Variables no secretas de n8n y registro del runner | `n8n-estado` | Media |
| 10 | Copias: calendario real de *snapshots*, volcado de PostgreSQL y restauración probada | Hostinger y procedimiento | Media |
| 11 | Actualizaciones del sistema y de EasyPanel/Traefik | `host-actualizaciones` | Media |
| 12 | Plan de reversión de despliegues, probado | Procedimiento | Media |
| 13 | ICMP: ¿aceptarlo? | Decisión en el firewall | Baja |
**Regla:** nada de esto se ejecuta sin autorización; las comprobaciones por SSH requieren el acceso restringido del diseño o tu sesión.

## 9. Cambios: hechos y pendientes de autorización
**Hechos por el propietario el 13/11/2026:** webhook migrado a HTTPS y probado; firewall de Hostinger activado (22/80/443); 3000 cerrado; Swarm verificado como un solo nodo.

**Pendientes (ninguno ejecutado):**
1. **Rotar el token** del webhook y repetir una entrega controlada.
2. Verificar los privilegios de la conexión SSH actual (lectura) y decidir su destino.
3. Implementar el acceso de inspección **por etapas** (`INSPECCION-AUTOMATICA-VPS-DISENO.md` §9): etapa 0 local, etapa 1 verificaciones, etapa 2 acceso mínimo, etc.
4. Restringir el SSH (22) por origen o VPN y endurecer `sshd`.
5. Protección de `main` y 2FA donde falte.
6. Copia independiente de PostgreSQL con restauración probada (antes de F3).
7. Valorar aceptar ICMP en el firewall.
8. Comprobar la visibilidad del repositorio y decidir si este documento puede versionarse.

## 10. Relación con el Agente 00
Este documento aporta los hechos de la **inspección previa a F1** (paso 0 de `AGENTE-00-F0-CIERRE.md` §6): recursos para **D7**, red y aislamiento para **D4/D7**, tablas e instantáneas para **D5** y copias para **D3**. El acceso de inspección restringido es el medio para obtener esos hechos sin intervención manual. Mientras no se complete, el estado de producción de los Agentes 04 y 12 sigue siendo **comunicado**.

## 11. Qué no se ha hecho
El asistente no se ha conectado al VPS; no ha ejecutado comandos remotos; no ha creado usuarios, claves ni credenciales; no ha modificado el firewall, el webhook, EasyPanel, servicios, código de producción ni workflows; no ha desplegado; sin commits, merge ni push. Los cambios del 13/11 los hizo el propietario.
