# Aislamiento de los webhooks del lector en el VPS: procedimiento (PREPARADO, NO EJECUTADO)

> **ACTUALIZACIÓN 17/11/2026 (leer antes que el resto): E2 con la regla original FALLÓ en el VPS y está sustituida por un candidato corregido.** Las diez sondas https de E2-bis llegaron al router de n8n (`https-practice_project_n8n_n8n-0@file`): un router SIN `tls` no atiende conexiones TLS y las pruebas locales (E0/E0b) usaban un entrypoint https SIN TLS, así que no podían verlo. El §3 y las pruebas «a, b, c» de E2 que dicen `custom.yaml` quedan **superados** por `E2-TLS-PROCEDIMIENTO.md` (candidato `tai-bloqueo-lector-tls.yaml`, router http + router https con `tls: {}`). **`custom.yaml` NO se modifica** (517 bytes, SHA-256 `2f9c5b1b…af39`) y sigue retirado. Lo demás de este documento (E0, E0b, hallazgos de `insecure=true`, capa 2) no cambia.

**Estado (16/11/2026): documentación y validación LOCAL; el asistente no ha ejecutado nada en el VPS. E0 CERRADA** (bloques 8 y 9 ejecutados por el propietario en modo lectura; sin copia externa de `main.yaml` por decisión del propietario, §9; `encodedCharacters` descartado también en los argumentos del servicio: `ENCODEDCHARACTERS_EN_ARGS=NO`, comunicado). **E0b SUPERADA y aceptada por el propietario (§1h):** con `forwardedHeaders.insecure=true` y registro CLF, **132/132 rutas y 104/104 suplantaciones de cabeceras bloqueadas**, y la verificación complementaria `verificar-clf` supera el criterio corregido (el `informe.json` original se conserva intacto, con su indicador «no validada» por un defecto del evaluador, §1h.2). Hallazgo de seguridad: `forwardedHeaders.insecure=true` en los dos entrypoints (§1b); la lista de IP de n8n **no cuenta como barrera** (§1c, §1h.1, §7). El registro de acceso es **CLF, no JSON** (§1f, §4b). La validación local **no sustituye** a las pruebas reales en Swarm y modo `host` (§1h.6). Secuencia E1-E5 revisada (§2). **E1, E2, E3 y F9 siguen SIN autorizar; condiciones para E1 en §9.6.**

## 0. Referencia inmutable (no se modifica)
| Elemento | Valor |
|---|---|
| Regla validada | `automation/dev/prueba-traefik/config-candidata/custom.yaml` (517 bytes, UTF-8, saltos `LF`) |
| **SHA-256 de la regla** | `2f9c5b1b5bcba1b64683559f1b6e4be6a0c9caa52af1a7c038765d1f6113af39` (coincide con el hash de `custom.yaml` registrado en la configuración activa de la 5.ª ejecución) |
| Regla (línea clave) | ``PathRegexp(`(?i)^(?:/|%2f|%5c)+webhook.*tai-lector-prod-`)`` · `entryPoints: [http, https]` · `priority: 10000000` · middleware `ipAllowList` con `192.0.2.1/32` (deniega a todos) · `service: noop@internal` |
| 5.ª ejecución (VALIDADA LOCALMENTE) | `D:/treidilor-pruebas/prueba-traefik/resultados-1794785149334/`: `informe.json` SHA-256 `c9182fe6099428d87633ff455184ca0e26ed3599161e97f2d2087e1d6f2ad545`; `traefik.log` `7312b2bf…08ec`; `n8n.log` `e9329bfa…bc6e`; `docker-despues.json` `fc390f73…2712` |
| Resultados | 68/68 originales + 64/64 codificadas bloqueadas (0 con línea de enrutamiento a n8n; 67+56 respuestas `Forbidden` de Traefik, 8 con 400 de Traefik, 1 HEAD atribuido por su GET gemelo); canario abierto 2/2 bloqueado con 0 ejecuciones en n8n; 4 rutas legítimas, 20 controles negativos y 2 interiores correctos; creación 3,3 s, modificación 3,8/1,6 s, regeneración de `main.yaml` 0,8 s con bloqueo intacto, carga inicial 1 s, eliminación 1,7 s y reversión idéntica a la fase A |
| Anotación del campo agregado `null` | `D:/treidilor-pruebas/prueba-traefik/anotacion-informe-1794785149334.json`: el valor correcto es **0** ejecuciones tras regenerar (también está en `vigilancia.regeneracion.canarioAbiertoTrasRegenerar.ejecucionesN8nGeneradas`). Era un defecto de ámbito de variables del lanzador, ya corregido en el código; **`informe.json` no se ha tocado** y la matriz no se ha repetido (el hash del informe se verificó antes y después) |

## 1. Lo que ya sabemos y lo que hay que comprobar (solo lo imprescindible)
> **Actualización:** las filas «supuesto» de esta tabla (entrypoints, prioridades, registro de acceso, permisos) quedaron **cerradas por el bloque 8** (§1b); el digest, `encodedCharacters` y la IP que ve Traefik, por el **bloque 9** (§1f). Sigue abierto lo del §1c (capa 2). **Corrección:** la fila «Registro de acceso» (JSON con `X-Prueba-Id`) describe el entorno LOCAL; en el VPS es **CLF** (§1f, §4b).

| Punto | Qué dicen los resultados | Situación |
|---|---|---|
| Proveedor de archivos | `TRAEFIK_PROVIDERS_FILE_DIRECTORY=/data/config`, `WATCH=true`; `/etc/easypanel/traefik` montado como `/data` | **[Comunicado]**: suficiente. La configuración estática parece venir de **variables `TRAEFIK_*`**, no de un `traefik.yaml` |
| Versión | Imagen `traefik` 3.6.7. Localmente: `traefik@sha256:a9890c898f379c1905ee5b28342f6b408dc863f08db2dab20e46c267d1ff463a` | Falta comparar el *digest* con el del VPS (**check 1**) |
| Entrypoints `http` y `https` | Es un **supuesto** de la prueba; la regla los nombra. Con otro nombre, el router no se aplicaría a ningún puerto y **fallaría abierto** | **Check 2 imprescindible** |
| Prioridades | La regla usa 10 000 000. Los routers de EasyPanel (16 en `main.yaml`) **no tienen la prioridad listada** en los resultados | **Check 3 imprescindible**: ningún router puede tener prioridad ≥ 10 000 000 ni una regla que case antes |
| `encodedCharacters` (todos `true` por defecto en 3.6.7) | La regla cubre `%2F`, `%5C` y doble codificación; si el VPS cambió estos valores, la matriz podría cambiar | **Check 2** (mismas variables `TRAEFIK_ENTRYPOINTS_*`) |
| `forwardedHeaders` / IP del cliente | La regla deniega a todos, no depende de la IP | No imprescindible (solo importa para la capa 2 de n8n) |
| Registro de acceso | Local: JSON con cabecera `X-Prueba-Id`. En el VPS **no consta** que esté activo | **Check 4**: define si hay evidencia en Traefik o solo la respuesta + las ejecuciones de n8n |
| `custom.yaml` | No consta que exista ni qué propietario/modo tiene `main.yaml` | **Check 5** |

**Bloque 8 (solo lectura; sin crear archivos, sin secretos, sin reiniciar):**
```sh
T=$(docker service ls --format '{{.Name}}' | grep -i traefik | head -1)
# check 1 y 2: imagen/digest y configuración estática por variables y argumentos (se oculta cualquier email)
docker service inspect "$T" --format 'imagen={{.Spec.TaskTemplate.ContainerSpec.Image}}'; docker image inspect "$(docker service inspect "$T" --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}')" --format 'digests={{.RepoDigests}}' 2>&1 | head -2
docker service inspect "$T" --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}' | grep -E '^TRAEFIK_(ENTRYPOINTS|PROVIDERS|LOG|ACCESSLOG|API|GLOBAL)' | sed -E 's/(mail|MAIL)=.*/\1=<oculto>/'
docker service inspect "$T" --format '{{json .Spec.TaskTemplate.ContainerSpec.Args}}' | sed -E 's/email=[^",]*/email=<oculto>/g'
# check 3: prioridades y reglas de los routers de EasyPanel
grep -oE '"(priority)": *[0-9]+' /etc/easypanel/traefik/config/main.yaml | sort | uniq -c | sort -rn | head; grep -c '"rule"' /etc/easypanel/traefik/config/main.yaml
# check 5: propietario/modo de la carpeta y sus archivos; hash de main.yaml (referencia «antes»)
ls -la --time-style=full-iso /etc/easypanel/traefik/config; stat -c '%U:%G %a %s %n' /etc/easypanel/traefik/config/*; sha256sum /etc/easypanel/traefik/config/main.yaml
```
Criterios: entrypoints llamados exactamente `http` y `https`; **ninguna prioridad ≥ 10 000 000**; los routers de n8n no son más específicos con prioridad explícita alta; `encodedCharacters` sin valores `false`; el *digest* coincide o se documenta la diferencia; la carpeta es de `root` y admite un archivo nuevo. **Si alguno falla, se para y se replantea (no se improvisa en el VPS).**

## 1b. Resultados de E0 (bloque 8, comunicados por el propietario; el asistente no ha ejecutado nada en el VPS)
| Comprobación | Resultado | Valoración |
|---|---|---|
| Imagen | `traefik:3.6.7` | Versión correcta; **digest sin comunicar** (pendiente, bloque 9) |
| Proveedor de archivos | `DIRECTORY=/data/config`, `WATCH=true` | Correcto |
| Entrypoints | `HTTP_ADDRESS=:80`, `HTTPS_ADDRESS=:443` | **Cerrado**: los nombres `http` y `https` de la regla son los reales |
| Registro de acceso | `TRAEFIK_ACCESSLOG=true` | **Cerrado**: habrá evidencia de Traefik (y sirve para el diagnóstico del §1c) |
| Routers | 16, sin prioridades explícitas elevadas | **Cerrado**: la prioridad 10 000 000 de la regla prevalece |
| Carpeta de configuración | `root:root 755`; `main.yaml` `root:root 644`, 8033 bytes | **Cerrado**: el archivo nuevo copiará `root:root 644` |
| **SHA-256 de `main.yaml` («antes»)** | `5a0113d86b3af7fd66afa027d59adb5d714a74c70fa346209f2374db307ab267` | Referencia para comprobar que no se altera |
| `encodedCharacters` | No comunicado (sin variables `*ENCODEDCHARACTERS*` comunicadas) | **Pendiente**: si no existe ninguna, rige el valor por defecto `true` de 3.6.7 (validado localmente) |
| **`FORWARDEDHEADERS_INSECURE=true` (http y https)** | Comunicado | **HALLAZGO**: ver §1c |
| n8n | `N8N_PROXY_HOPS=1` | Relevante para §1c |

## 1c. Hallazgo: `forwardedHeaders.insecure=true` con `N8N_PROXY_HOPS=1`
**Qué hace cada pieza.** Con `insecure=true` Traefik **acepta las cabeceras `X-Forwarded-*` que traiga el cliente** (la documentación lo desaconseja fuera de pruebas). Con `N8N_PROXY_HOPS=1`, n8n (Express, `trust proxy = 1`) toma como IP del cliente la **última** entrada de `X-Forwarded-For`, y su lista de IP del nodo Webhook acepta una petición si coincide `req.ip` **o** alguna de `req.ips`.

**Capa 1 (bloqueo de Traefik): NO afectada.** El `ipAllowList` de la regla usa, por defecto, la **dirección remota** de la conexión y solo lee `X-Forwarded-For` si se configuran `depth` o `excludedIPs` (documentación de Traefik 3.6), y la regla no configura ninguno; además deniega a todos. Una cabecera falsa `X-Forwarded-For: 192.0.2.1` no debería cambiarlo. **No se ha probado con `insecure=true`**: la prueba local usó la configuración por defecto (`insecure=false`), así que falta ese caso (§1d).

**Capa 2 (lista de IP de n8n): riesgo REAL pero acotado; no se considera barrera hasta validarla.**
- *Suplantación desde Internet:* con un solo proxy delante, Traefik **añade** la IP real del par al final de la cabecera y n8n solo usa esa última entrada; las entradas falsas de la izquierda no entran en `req.ip` ni en `req.ips` (con `trust proxy = 1`, `proxy-addr` corta en la primera dirección no confiable). **[Inferido del comportamiento de Express/proxy-addr y de Traefik; la documentación de Traefik no dice si conserva o sustituye los valores del cliente; no verificado en esta instalación]**. Si Traefik *sustituyera* la cabecera con el valor del cliente, la suplantación **sí** sería posible.
- *IP «real» que ve Traefik:* con Swarm en modo *ingress*, la IP del par suele ser la del *gateway* de `ingress` (todos los clientes externos parecen la misma). La lista de IP **no puede incluir** esa dirección ni su subred; si la subred de `easypanel` solapara con la de `ingress`, cualquier petición externa pasaría. **Sin comprobar** (bloque 9).
- *Llamadas internas directas a n8n* (sin pasar por Traefik): con `trust proxy = 1`, n8n confía en el llamante como «proxy» y toma como cliente lo que ponga en `X-Forwarded-For`: **cualquier contenedor de la red `easypanel` puede hacerse pasar por el Director**. La lista de IP no protege frente a servicios internos comprometidos (la credencial Header Auth sí).
- Local: en las pruebas con n8n 2.38.6 la lista aceptó una subred (CIDR) y rechazó los accesos exteriores con `insecure=false`; no se probó suplantación.

**Impacto adicional (no relacionado con el lector):** la web usa «el primer valor» de `X-Forwarded-For` para sus límites por IP cuando `TRUSTED_PROXY_HOPS` no está definida; con `insecure=true` ese primer valor lo controla el cliente (falsificable). Es un motivo más para estudiar el ajuste, pero es **otra decisión**.

**¿Modificar `insecure` o mantenerlo?** **Mantenerlo por ahora y compensar.** Cambiarlo exige modificar la configuración estática (variables del servicio de Traefik gestionadas por EasyPanel): implica **reiniciar Traefik** (corte breve de todos los sitios), puede ser **revertido por EasyPanel** en una actualización y hay dependencias desconocidas (¿hay un CDN o proxy delante que deba ser de confianza?, ¿qué servicios usan la IP de cliente o `X-Forwarded-Proto`?). Cualquier cambio requiere un estudio de impacto propio: comprobar en DNS público que los dominios apuntan **directamente** al VPS (sin CDN), qué servicios leen `X-Forwarded-*`, y la alternativa de `insecure=false` + `trustedIPs` con lo mínimo necesario. **No se propone ningún cambio directo en la configuración estática.**

**Controles compensatorios (sin tocar la configuración estática):** (1) la capa 1 es la **barrera principal** y no depende de IP; (2) la **credencial Header Auth** exclusiva sigue siendo obligatoria; (3) la **lista de IP queda como señal informativa**, nunca como condición para publicar el lector; (4) el cliente del Director se niega a leer producción sin una comprobación exterior reciente (§6); (5) el lector solo se publica con el bloqueo verificado el mismo día.

> **Actualización 16/11/2026 (E0b, §1h):** la capa 1 **sí** se probó con `insecure=true` y spoofing de cabeceras: 104/104 suplantaciones bloqueadas con la misma regla (hash `2f9c5b1b…af39`). La capa 2 sigue sin contar como barrera: los externos no pasan, pero un llamante interno elige la IP que n8n ve.

## 1d. Cómo se verificará (sin datos reales), una vez instalado el bloqueo principal
**Canario de IP** (workflow aparte, sin datos, credencial desechable propia, **fuera del prefijo bloqueado**, p. ej. `/webhook/tai-ip-canario`, con la lista de IP configurada a mano igual que tendría el lector): responde un JSON fijo y, **solo para esta prueba**, devuelve también las cabeceras `x-forwarded-for` y `x-real-ip` **que recibió**. Es alcanzable desde fuera (no está bajo el bloqueo) pero inofensivo y exige credencial.
| Prueba | Cómo | Criterio |
|---|---|---|
| IP que ve Traefik | **Resuelto en parte (§1f):** con puertos en modo `host` Traefik ve la IP pública real (primer campo del CLF). Queda por comprobar qué recibe **n8n**: la cabecera `x-forwarded-for` devuelta por el canario de IP frente a la IP real | Se sabe qué entra en `req.ip`/`req.ips` de n8n; la lista **no contiene** ninguna IP pública |
| Suplantación | Peticiones exteriores con credencial y cabeceras `X-Forwarded-For: <IP o subred permitida>`, listas con varias entradas, `X-Real-IP`, `Forwarded:` | Respuesta de n8n «IP is not allowed» en todas; la cabecera devuelta termina en la IP real del par, nunca en la inventada |
| Camino interno | Desde un contenedor de la red `easypanel` (el de la web) con y sin cabecera falsa | Se documenta (esperado: la falsificación interna **sí** funciona) |
| Local previo (**HECHO el 16/11/2026, §1h**) | Repetido en local con `insecure=true` y `N8N_PROXY_HOPS=1`: suplantación contra el canario y contra el bloqueo de la capa 1 | **Capa 1 conserva su comportamiento** (104/104 bloqueadas). Capa 2: 0/27 externos pasan, pero un llamante interno elige su IP (§1h.1) |
Hasta cerrar esta tabla, **la lista de IP no figura como barrera en ningún criterio de éxito**.

## 1e. E0 pendiente (bloque 9, solo lectura; sin secretos)
```sh
T=$(docker service ls --format '{{.Name}}' | grep -i traefik | head -1)
# digest de la imagen (para compararlo con el local a9890c898f379c1905ee5b28342f6b408dc863f08db2dab20e46c267d1ff463a) y modo de publicación de puertos
docker image inspect "$(docker service inspect "$T" --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}')" --format 'digests={{.RepoDigests}}' 2>&1 | head -2
docker service inspect "$T" --format '{{json .Endpoint.Spec.Ports}}'
# encodedCharacters y demás opciones HTTP de los entrypoints (solo nombres/valores TRAEFIK_ de entrypoints)
docker service inspect "$T" --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}' | grep -E '^TRAEFIK_ENTRYPOINTS_' | sed -E 's/(mail|MAIL)=.*/\1=<oculto>/'
# redes: subredes de easypanel e ingress (la lista de IP no debe incluir la del ingress)
docker network inspect easypanel ingress --format '{{.Name}} subred={{range .IPAM.Config}}{{.Subnet}} {{.Gateway}} {{end}}'
# qué IP ve Traefik para un acceso externo conocido: 3 líneas del registro de acceso (sin cabeceras ni cuerpos)
docker service logs "$T" --tail 400 2>&1 | grep -E '"ClientHost"' | tail -3 | sed -E 's/.*("ClientHost":"[^"]*").*("RequestPath":"[^"]*").*/\1 \2/'
```
Criterios: sin variables `*ENCODEDCHARACTERS*` en `false`; digest coincidente (o diferencia documentada); `ClientHost` de una petición externa conocida (la del propietario) indica **si Traefik ve la IP pública o la del *gateway* de `ingress`**.

> **Nota (16/11/2026):** el bloque se ejecutó. Su última orden (`grep "ClientHost"` + `sed`) está escrita para registro **JSON**; el registro real es **CLF**, así que esa orden no habría extraído nada y el propietario clasificó la IP a mano. **No se reutiliza.** Resultados en §1f; las comprobaciones futuras, en formato CLF (§4b).

## 1f. Resultados de E0 (bloque 9, comunicados por el propietario; el asistente no ha ejecutado nada en el VPS)
| Comprobación | Resultado comunicado | Valoración |
|---|---|---|
| Digest de Traefik | `sha256:a9890c898f379c1905ee5b28342f6b408dc863f08db2dab20e46c267d1ff463a` | **Cerrado**: idéntico al de la imagen validada localmente (la misma imagen, no solo la misma versión) |
| Puertos 80 y 443 | TCP, **modo `host`** | **Cerrado y relevante**: sin NAT de Swarm (*ingress*) en la entrada; Traefik recibe la IP real del cliente |
| Entrypoints | `:80` y `:443`; `forwardedHeaders.insecure=true` en ambos | Confirma el hallazgo del §1c |
| `encodedCharacters` | Ninguna variable explícita entre las `TRAEFIK_ENTRYPOINTS_*`; tampoco en los *argumentos* del servicio (`ENCODEDCHARACTERS_EN_ARGS=NO`, 16/11/2026, comunicado por el propietario; no verificado por el asistente) | **Cerrado**: rige el valor por defecto de 3.6.7 (`true`), el validado localmente |
| Redes | `easypanel` 10.11.0.0/16; `ingress` 10.0.0.0/24 | **Cerrado**: no se solapan |
| Registro de acceso | Formato **CLF**; una petición ficticia desde Windows quedó registrada; la IP observada se clasificó `IP_PUBLICA` (no pertenece a `easypanel` ni a `ingress`) | **Cerrado** (la IP concreta no se anota aquí). Obliga a adaptar toda comprobación al CLF (§4b) |

**Qué implica y qué NO implica:**
1. La preocupación del §1c «todos los clientes parecen el *gateway* de `ingress`» **desaparece para Traefik**: con puertos en modo `host` ve la IP pública real.
2. Eso **no demuestra** que `X-Forwarded-For` sea resistente a suplantación: Traefik ve el par TCP real, pero con `insecure=true` **acepta** la cabecera del cliente y la reenvía a n8n. Que añada la IP real al final (y n8n use solo esa) sigue siendo una **inferencia no verificada**. **La lista de IP de n8n sigue siendo protección secundaria NO validada y no cuenta como barrera** (criterio de §7).
3. Para la lista de IP de n8n, la lista admitida sería de IP **internas** (llamadas directas del Director, desde `10.11.0.0/16`), nunca públicas: ningún cliente externo legítimo debería coincidir con ella. Cualquier valor interno amplio (p. ej. toda la subred) admite a cualquier contenedor de la red (§1c).

**Cierre formal de E0 — qué falta:**
| # | Elemento | Estado |
|---|---|---|
| 1 | Bloque 8 (imagen, proveedor, entrypoints, registro, routers, permisos, hash de `main.yaml`) | Hecho |
| 2 | Bloque 9 (digest, puertos, entrypoints, redes, IP vista por Traefik, formato del registro) | Hecho |
| 3 | ~~Copia externa de `main.yaml`~~ **DESCARTADA por decisión del propietario (16/11/2026)**: la reversión de E2 no depende de ella y copiar el contenido (potencialmente sensible) por pantalla y portapapeles se considera un riesgo mayor que el beneficio. Se conservan su **SHA-256 `5a0113d8…ab267`, 8033 bytes y permisos `root:root 644`** (carpeta `root:root 755`). Análisis y riesgo residual aceptado en §9 | **Cerrado sin copia** |
| 4 | ~~Tratamiento de la copia como material sensible~~ | No procede (no hay copia) |
| 5 | Un **ejemplo real de línea CLF** de una petición que llega a n8n (nombre real del router y del servicio de n8n), para fijar la comprobación «no llega a n8n» | Pasa a **E1** (sin crear nada); no bloquea E0 |
| 6 | Salvedad de `encodedCharacters` (argumentos del servicio) | **Resuelta (16/11/2026)**: `ENCODEDCHARACTERS_EN_ARGS=NO` (comunicado por el propietario). No queda ninguna salvedad abierta |
| 7 | E0b (prueba local con `insecure=true`) | **Hecha y SUPERADA (16/11/2026, §1h)** |
| 8 | Herramienta para la sonda exterior por HTTPS: el lanzador local no tiene variante TLS con SNI (diseño en §4). Mínimo viable: `curl --path-as-is` (conserva `%2F`/`%5C`) con ID único en la consulta | Requisito de E2, no de E0 |
| 9 | Copia de la regla (`custom.yaml`) fuera del VPS: ya existe en el repositorio (hash `2f9c5b1b…af39`) | Hecho |
**E0 CERRADA (16/11/2026): criterio de §9.4 cumplido por completo. 5 y 8 pertenecen a E1/E2.**

## 1g. ¿Repetir localmente con `forwardedHeaders.insecure=true` antes de producción?
> **EJECUTADA el 16/11/2026: resultados y cierre en §1h (E0b SUPERADA). El texto siguiente es el plan original.**
**Sí, recomendado, y antes de E2 (primera escritura en producción).** Motivo: la regla se validó con `insecure=false`; el VPS usa `true`, justo el parámetro que decide cómo se interpretan `X-Forwarded-*`. Lo esperado (la capa 1 usa la dirección remota) está **inferido de la documentación, no probado** con este valor, y el coste de comprobarlo es bajo (mismas imágenes locales, sin descargas). Alcance mínimo propuesto, **con autorización propia** (Docker Desktop está detenido; solo recursos del proyecto `tai-prueba-tf`, los tres contenedores existentes intactos):
1. Misma configuración que la 5.ª ejecución, cambiando **solo** `forwardedHeaders.insecure: true` en los dos entrypoints y `accessLog.format: common` (para ensayar el CLF de §4b).
2. Matriz completa de la regla (132 celdas) **más** variantes de suplantación sobre la ruta bloqueada: `X-Forwarded-For: 192.0.2.1` / lista con varias entradas / `X-Real-IP` / `Forwarded: for=…`, y cabeceras con la IP del propio cliente de pruebas.
3. Canario de IP (§1d) con lista de IP: ver qué entra en `req.ip`/`req.ips` con y sin suplantación, desde el exterior y desde un contenedor interno.
4. **Criterio:** la capa 1 sigue devolviendo `Forbidden` en todas; la capa 2 queda documentada tal cual salga (no se corrige ninguna regla sin autorización).
**Si no se hiciera:** E2 sería viable igualmente (la barrera principal no depende de la IP), pero el primer ensayo con `insecure=true` ocurriría en producción. Riesgo residual del local: el entorno de pruebas (red de Docker Desktop, sin Swarm ni modo `host`) no reproduce la entrada real; por eso no sustituye a E3.

## 1h. E0b: resultados y cierre documental (16/11/2026) — **SUPERADA** (aceptada por el propietario)
**Qué es.** Repetición **local** de la validación de la regla con la configuración real del VPS que la prueba anterior no tenía: `forwardedHeaders.insecure=true` en los dos entrypoints (§1c) y registro de acceso en formato **CLF** (§1f). Docker Desktop local (contexto `desktop-linux`, endpoint `npipe:////./pipe/dockerDesktopLinuxEngine`, Swarm inactivo), con las imágenes ya descargadas (`traefik:v3.6.7` digest `a9890c898f379c1905ee5b28342f6b408dc863f08db2dab20e46c267d1ff463a`, el mismo del VPS; n8n 2.38.6; PostgreSQL 17), sin descargas, sin `prune` y sin tocar el VPS. La regla es la misma de siempre: **no se modificó**.

### 1h.1 Validación original (orden `e0b`; informe `resultados-1794840770557`)
| Comprobación | Resultado |
|---|---|
| Matriz exterior (68 celdas, con la regla activa) | **68/68 bloqueadas** |
| Variantes codificadas (`%2F`, `%5C`, doble codificación…) | **64/64 bloqueadas** → **132/132** rutas bloqueadas |
| Canario abierto (http y https) | 2/2 bloqueadas; **0 ejecuciones** en n8n |
| **Suplantación de cabeceras (nueva)** | **104/104 bloqueadas** (13 variantes × 3 rutas × http/https, más GET en la ruta exacta), con `Forbidden` de Traefik y **0 ejecuciones**. Incluye `X-Forwarded-For: 192.0.2.1` (la única IP que admitiría el filtro si leyera la cabecera) |
| Rutas legítimas / controles negativos / interior | 4/4 · 20/20 · 2/2 |
| Modificación, regeneración de `main.yaml`, reinicio y eliminación de la regla | Correcto: la regla vuelve a cargarse (1–4 s), el bloqueo persiste tras regenerar `main.yaml` y, al eliminarla, el comportamiento vuelve exactamente al de la fase sin regla |
| Fase sin regla (línea base) | 66/68 llegan a n8n; las 2 restantes son `Host` sin router (Traefik responde 404), |

**Comportamiento de las cabeceras con `insecure=true`** (medido con un servidor «eco» que devuelve lo que recibe del proxy):
- `X-Forwarded-For`: Traefik **conserva** el valor del cliente y **añade la IP real del par al final** (`192.0.2.1, <ip real>`); lo mismo con listas, IPv6 mapeada y puerto.
- `X-Real-IP`, `Forwarded`, `X-Forwarded-Proto` y `X-Forwarded-Host` pasan **tal como los manda el cliente** (con `X-Forwarded-Host: evil.example` el origen recibió `evil.example`). Consecuencia confirmada: el «primer valor» de `X-Forwarded-For` lo controla el cliente (límites por IP de la web si `TRUSTED_PROXY_HOPS` no está definida).
- **Capa 1 (bloqueo de Traefik): no afectada.** El `ipAllowList` usa la dirección remota.
- **Capa 2 (lista de IP de n8n):** 0 de 27 intentos externos con credencial correcta y cabeceras falsas pasaron (n8n usa la **última** entrada, la que añade Traefik). Pero un contenedor **interno** elige la IP que n8n ve (con `X-Forwarded-For: 10.99.99.99` n8n la denegó): la lista **no protege frente a servicios internos** y **sigue sin contar como barrera**.

**Registro CLF** (formato real del VPS): `IP - - [fecha] "MÉTODO ruta?tai=<id> HTTP/1.1" estado bytes "-" "-" contador "router" "http://n8n-interno:5678/" duración`. El identificador en la consulta (`?tai=`) correlaciona cada petición. Las rutas que llegan a n8n dejan línea con router `n8n-http@file`/`n8n-https@file`; **las peticiones bloqueadas por Traefik no dejan ninguna línea** (igual que en JSON): la prueba de bloqueo es la **respuesta** (`Forbidden` de Traefik), y las líneas de los centinelas demuestran que el registro funciona.

### 1h.2 El defecto del evaluador original y cómo se resolvió
- **Defecto.** El criterio de la fase CLF exigía **0 ejecuciones nuevas en n8n en toda la fase**. Pero las rutas **públicas legítimas** (`/webhook/tai-publico-prueba`) **ejecutan su workflow** y es normal que dejen ejecuciones: en la fase había 2 sondas públicas y, por tanto, 2 ejecuciones. El criterio daba un **falso negativo**: el indicador global del `informe.json` quedó en **«REGLA NO VALIDADA»** aunque todas las comprobaciones de seguridad (132/132, 104/104, controles) estaban correctas. No era un fallo de seguridad ni una fuga.
- **Corrección.** El «0 ejecuciones» se exige **solo alrededor de las sondas bloqueadas**; las públicas deben dejar **exactamente 1** cada una (`ejecucionesDeLasRutasPublicasLegitimas`). La decisión agregada es una función pura probada (`decidirClf`).
- **Conservación.** El `informe.json` original **se conserva intacto**, **incluido su indicador «no validada»**: es la evidencia del defecto. El cierre se apoya en la verificación complementaria (§1h.3), no en reescribir ese informe.

### 1h.3 Verificación complementaria (orden `verificar-clf`; informe `resultados-clf-1794845045681`) — **SUPERADA**
Una sola ejecución, con comprobaciones previas (destino Docker, sin recursos ni marca previos) y la variable de autorización limitada al proceso.
| Fase | Esperado | Observado |
|---|---|---|
| V0 · **control positivo del contador** (sin regla) | 1 ejecución del canario abierto y 1 del webhook público | **1 / 1**, atribuidas por nodo (`abierto` y `publico`) |
| V1 · carga de la regla | Cargada; hash en el volumen = validado | Cargada en 3,3 s; `2f9c5b1b…af39` |
| V2 · **9 sondas bloqueadas** (exacta, https sin credencial, canario abierto http/https, `%2F`, `//`, GET, suplantación con la IP del bloqueo y con la interna) | 0 ejecuciones, `Forbidden` de Traefik | **9/9, 0 ejecuciones**, ninguna con línea CLF de n8n |
| V3 · rutas legítimas | 2 ejecuciones del webhook público (http y https); 0 de `healthz`, interfaz y ruta ajena | **2** (ambas `publico`) y **0** |
| Centinelas (GET y HEAD, antes y después de las bloqueadas) | Presentes en el CLF | **4/4**, router `n8n-http@file`, estado 200 |
| V4 · secuencia original con el evaluador corregido (`faseClf`) | ok; 0 ejecuciones tras las bloqueadas; 2 de rutas públicas | **ok / 0 / 2**, 15/15 sondas ok; la regla sigue cargada tras volver a registro JSON |
Las **2 ejecuciones** de la primera ejecución eran, por tanto, las del **webhook público legítimo**. La atribución por nodo (consulta a `execution_data` de n8n) funcionó en las 4 ejecuciones.

### 1h.4 Endurecimiento del lanzador previo a esa ejecución (16/11/2026)
`scripts/automation/prueba-traefik.mjs`: autorización a nivel de `docker()` (solo lectura sin ella); verificación del destino antes de cualquier efecto (sin `DOCKER_HOST`/`DOCKER_CONTEXT`/`DOCKER_TLS_VERIFY`/`DOCKER_CERT_PATH`, contexto `desktop-linux`, endpoint local, Swarm inactivo, Docker Desktop) en `ejecutar`, `e0b`, `verificar-clf`, `limpiar` y `descargar`; marca atómica de ejecución en curso; limpieza **única** solo de lo que creó la propia ejecución (también ante SIGINT/SIGTERM/SIGHUP/SIGBREAK y en `exit`); la orden `limpiar` se niega ante una ejecución viva o recursos `tai-tf` sin la etiqueta de la prueba; credencial temporal borrada siempre. Pruebas **sin Docker**: F21 (13) y F22 (17) = **30/30 superadas**; `node --check` correcto.
**Incidente registrado (honestidad de la trazabilidad):** durante la preparación, una guarda de autorización mal colocada hizo que un test arrancara por error parte del entorno `tai-prueba-tf`. Se limpió solo ese proyecto (sin `prune`), se corrigió la guarda (también en `e0b`) y se añadió un test que fija el orden. Los tres contenedores preexistentes, la regla y el `informe.json` original no se vieron afectados (hashes comprobados).

### 1h.5 Evidencias y SHA-256 (fuera del repositorio salvo `custom.yaml`; no se modifican)
| Evidencia | Ruta | SHA-256 |
|---|---|---|
| Regla validada (517 bytes) | `automation/dev/prueba-traefik/config-candidata/custom.yaml` | `2f9c5b1b5bcba1b64683559f1b6e4be6a0c9caa52af1a7c038765d1f6113af39` |
| **`informe.json` original de E0b** (conserva «no validada») | `D:/treidilor-pruebas/prueba-traefik/resultados-1794840770557/informe.json` | `453b771ac30fc0e1554d49a580bc1808c21da431394c80c2052201c6df49c048` |
| `traefik.log` · `n8n.log` · `docker-despues.json` (E0b) | misma carpeta | `29178f94…96e0` · `90eee26d…4326` · `54ccd25a…0400` |
| **`informe-clf.json`** (verificación complementaria) | `D:/treidilor-pruebas/prueba-traefik/resultados-clf-1794845045681/informe-clf.json` | `a63ff9d25072c6256743a9e2e7303f2b8f26a43d66bee2a09a1cfc394a3b5dff` |
| `traefik.log` · `n8n.log` (complementaria) | misma carpeta | `2e65311e…2209` · `539fd42b…3d2e` |
| 5.ª ejecución (validación original de la regla) | `D:/treidilor-pruebas/prueba-traefik/resultados-1794785149334/informe.json` | `c9182fe6099428d87633ff455184ca0e26ed3599161e97f2d2087e1d6f2ad545` |

### 1h.6 Estado final y límites
- **Recursos:** los recursos temporales de `tai-prueba-tf` (contenedores, redes, volúmenes, marca y credenciales temporales) **quedaron eliminados** tras cada ejecución; sin `prune`.
- **Contenedores preexistentes** (`treidilor-puente-entrada`, `treidilor-n8n-pruebas`, `treidilor-puente-salida`): **intactos** (mismos identificadores, fechas de arranque y estado `exited`; no se arrancaron ni se detuvieron). La regla (`custom.yaml`) y el `informe.json` original conservan su SHA-256.
- **La validación local NO sustituye a las pruebas reales** en el VPS: el entorno de pruebas (Docker Desktop con red *bridge*) **no reproduce Docker Swarm, la red `ingress` ni la publicación de puertos en modo `host`**, ni el router real de EasyPanel/Traefik, ni el valor real de `encodedCharacters` (cerrado aparte, §1f.6) ni el CLF con los nombres reales de router. Eso se comprobará **solo** en las etapas E1–E3 del VPS, cada una con su autorización.
- La capa 2 sigue sin contar como barrera (§1c, §1h.1).


## 2. Implantación por etapas (secuencia REVISADA el 16/11/2026; pendiente de aprobación)
**Qué cambia y por qué.** La secuencia anterior publicaba los canarios **sin bloqueo** durante hasta 10 min (línea base) y después creaba la regla. La línea base **no necesita ningún webhook publicado**: el propietario ya observó que `/webhook/tai-lector-prod-zz` (**sin publicar**) llega a n8n y responde su **404 JSON** de «not registered»; tras la regla la misma petición debe devolver **`Forbidden` de Traefik**. Esa diferencia detecta tanto la carga de la regla como un fallo en abierto, **sin exponer nada**. Los canarios pasan a publicarse **solo con el bloqueo ya verificado**, y únicamente para lo que no se puede ver sin webhook publicado (que una fuga ejecutaría algo, y el camino interno).
| Etapa | Qué se hace | Puerta de salida |
|---|---|---|
| **E0** | Bloques 8 y 9 **ejecutados** (§1b, §1f). Sin copia externa de `main.yaml` (decisión de 16/11/2026, §9): se conservan hash, tamaño y permisos | **CERRADA (16/11/2026)**: criterio de §9.4 cumplido |
| **E0b · antes de E2** | Prueba local con `insecure=true` y CLF (§1g, §1h) | **SUPERADA (16/11/2026)**: capa 1 conserva el bloqueo (132/132 + 104/104) y la verificación CLF complementaria supera el criterio corregido. Capa 2 sin valor como barrera |
| **E1 · línea base SIN publicar nada** | Desde fuera, 3 sondas con ID único en la consulta: (a) `POST /webhook/tai-lector-prod-zz` (sin publicar): debe dar el 404 JSON de **n8n**; (b) `POST /webhook/tai-publico-zz` (control, sin publicar): igual; (c) `GET /healthz`: 200. Guardar el cuerpo y la línea CLF de cada una (nombre real del router y servicio de n8n: da la referencia para §4b). **No se importa ni se publica ningún workflow** | Línea base y ejemplo CLF registrados |
| **E2 · crear `custom.yaml`** | §3. La verificación por comportamiento usa las MISMAS sondas de E1: (a) pasa a `Forbidden` de Traefik; (b) y (c) siguen igual | Hash coincide; (a) bloqueada y (b)(c) intactas, 3 veces seguidas |
| **E2b · matriz exterior sin publicar** | La matriz de §4 (variantes, HTTP/HTTPS, métodos, `Host`) sobre rutas **sin publicar**: el cuerpo distingue Traefik de n8n y el CLF confirma el router | Todas bloqueadas por Traefik; controles negativos sin bloquear |
| **E3 · canario CON el bloqueo vigente** | Solo ahora: importar el canario **inactivo**, repetir la sonda (a'), **publicarlo**, repetir de inmediato la matriz reducida (ruta exacta, `%2F`, `%5C`, HTTP y HTTPS, con y sin credencial) y la prueba interior (§4); **despublicar** al terminar. Si CUALQUIER sonda exterior da algo distinto de `Forbidden` → despublicar en el acto y parar. El canario no contiene datos y exige credencial desechable; su ventana de exposición posible es de segundos, solo si el bloqueo fallara | Fuga = 0 ejecuciones del canario en n8n; interior funciona |
| **E4 · persistencia** | Observación ≥ 24 h con la supervisión de §6 y repetición tras cualquier reinicio/actualización | Regla cargada; `main.yaml` sin alterar por nosotros |
| **E5 · retirada del canario** | Borrar el canario y la credencial desechable. **`custom.yaml` se conserva** | Sin canario ni credencial; bloqueo operativo |
| (Posterior, otra autorización) | Importar el lector real **inactivo**, credencial exclusiva, publicar solo con el bloqueo verificado el mismo día | — |
**Qué se pierde frente a la secuencia anterior y cómo se compensa:** (i) ya no se demuestra «con un webhook *publicado* y sin bloqueo, el exterior lo alcanza»: se sustituye por el 404 de n8n sin publicar (prueba que la ruta llega a n8n; que un publicado respondería es comportamiento documentado de n8n y se constata en E3 con el bloqueo, donde Traefik responde y n8n ejecuta 0 veces); (ii) la prueba «detecta fugas» queda garantizada por tres detectores independientes: **cuerpo** (`Forbidden` vs JSON de n8n), **línea CLF** (router de n8n frente al de bloqueo) y **ejecuciones del canario** (con *Save successful production executions* solo en E3).
**Para que una prueba sea capaz de detectar un fallo (no solo confirmar éxitos):** cada tanda lleva centinelas positivos (`/healthz` y la ruta pública de control, que deben llegar a n8n) y la sonda de línea base de E1 como referencia del aspecto de «sin bloqueo»; una tanda sin centinelas correctos se **anula**, no cuenta como éxito.

**Regla de oro:** el lector real no se importa ni se publica mientras el bloqueo no haya superado E3 y E4, y el bloqueo **nunca se retira mientras exista un lector publicado**.

## 3. Crear `custom.yaml`, verificar su carga y su persistencia sin tocar `main.yaml`
1. **Referencia «antes»** (E0, §9): `sha256sum`, propietario/modo/tamaño de `main.yaml` y listado de la carpeta, **justo antes de empezar**; deben ser `5a0113d8…ab267`, `root:root 644`, 8033 bytes, y **no debe existir ya `custom.yaml`** (ni `.nuevo` ni `.retirado`). Si algo difiere, **no se interviene** (§9).
2. **Escribir con un nombre que Traefik ignora** (`.nuevo` no es `.yaml`) y **comprobar el hash antes de activarlo**:
<!-- INICIO-BLOQUE-CUSTOM -->
```sh
D=/etc/easypanel/traefik/config
cat > $D/custom.yaml.nuevo <<'TAI_EOF'
# REGLA CANDIDATA de bloqueo (la misma de automation/docs/AISLAMIENTO-WEBHOOKS-LECTOR.md §B). Archivo PROPIO: en producción iría en /etc/easypanel/traefik/config/custom.yaml.
http:
  routers:
    tai-bloquear-lector-prod:
      rule: "PathRegexp(`(?i)^(?:/|%2f|%5c)+webhook.*tai-lector-prod-`)"
      entryPoints: [http, https]
      priority: 10000000
      middlewares: [tai-denegar-todo]
      service: noop@internal
  middlewares:
    tai-denegar-todo:
      ipAllowList:
        sourceRange: ["192.0.2.1/32"]
TAI_EOF
sha256sum $D/custom.yaml.nuevo; wc -c $D/custom.yaml.nuevo
```
<!-- FIN-BLOQUE-CUSTOM -->
   **Debe salir `2f9c5b1b5bcba1b64683559f1b6e4be6a0c9caa52af1a7c038765d1f6113af39` y `517`.** Si no, `rm $D/custom.yaml.nuevo` y **parar** (pegado corrupto de la consola).
3. **Activar de forma atómica**, con el mismo propietario y modo que `main.yaml`: `chown --reference=$D/main.yaml $D/custom.yaml.nuevo; chmod --reference=$D/main.yaml $D/custom.yaml.nuevo; mv $D/custom.yaml.nuevo $D/custom.yaml`. Hay **un solo `mv`** y nunca se edita `main.yaml`.
4. **Verificar la carga por comportamiento, no por el 403** (el 403 también lo devuelve n8n): sondas desde fuera con el dominio público de n8n (las MISMAS de E1, §2, sobre rutas **sin publicar**): (a) `POST /webhook/tai-lector-prod-zz` sin credencial debe devolver el cuerpo **`Forbidden`** de Traefik (en E1 devolvía el 404 JSON de n8n); (b) `GET /healthz` debe seguir en 200; (c) `POST /webhook/tai-publico-zz` debe seguir dando el 404 JSON de n8n (llega a n8n). Las tres condiciones, **tres veces seguidas**, equivalen a «cargada y estable» (localmente 3,3 s). Si en 60 s no se cumple: `rm $D/custom.yaml` y parar.
5. **`main.yaml` intacto (inmediatamente después del `mv`):** el mismo bloque de verificación de §9 (hash, `root:root 644`, 8033 bytes, listado). Si EasyPanel lo hubiera reescrito por su cuenta, se anota (y se comprueba que el bloqueo sigue); **no se restaura ni se edita**.
6. **Persistencia:** repetir las sondas a los 5 min, a las 24 h y tras cualquier reinicio de Traefik, actualización de EasyPanel o despliegue; comprobar `ls -la --time-style=full-iso` (el archivo sigue ahí con el mismo hash).

## 4. Canario en el VPS (sin datos reales ni credenciales de producción)
**Workflow** `automation/workflows-puente/produccion/canario-aislamiento.produccion.json` (inactivo al importar; sin Code, sin tablas, sin HTTP; guarda datos de ejecución `none` según su linter). Para la prueba se añaden **a mano** dos cosas y se revierten al terminar: (1) una segunda ruta de **control público** `tai-publico-canario` que responde `{"publico":true}` (no coincide con el prefijo bloqueado) y (2) *Save successful production executions = Save* **solo para el canario**, de modo que cualquier fuga quede registrada en n8n. **Sin lista de IP** en el canario (es inofensivo: así una fuga se vería como JSON y como ejecución; la lista de IP se prueba después con el lector real).
**Credencial:** Header Auth **desechable** `Treidilor — Canario aislamiento (desechable)` (cabecera `x-treidilor-canario`, valor aleatorio generado en el momento, **distinto** de cualquier credencial de producción y del futuro lector; se borra en E5).

**Pruebas (todas con datos ficticios; resultados guardados con fecha, código, cuerpo y huella):**
| Prueba | Cómo | Criterio de éxito |
|---|---|---|
| Línea base (E1, sin bloqueo, **nada publicado**) | Exterior, sin credencial, ruta exacta sin publicar | Responde el 404 JSON de **n8n** («not registered»): el proxy entrega la ruta y queda el aspecto de «sin bloqueo» |
| Exterior con bloqueo | Variantes de `matriz.mjs`: 15 base + 16 codificadas, ×{https, http}, ×{con, sin credencial}; métodos GET/HEAD/OPTIONS/PUT/DELETE en la ruta exacta; otros `Host` | **Todas** responden con la respuesta de **Traefik** (`Forbidden` 403 o 400/404 de Traefik); ninguna con cuerpo/cabeceras de n8n ni con `{"canario":true}`; HEAD atribuido por su GET gemelo |
| No llega a n8n | (a) **0 ejecuciones nuevas** del canario en n8n durante la tanda; (b) en el registro de acceso **CLF** (§4b), para cada petición con su ID único: ninguna línea con el router/servicio de n8n y **centinelas positivos** (`GET/HEAD /healthz`) sí presentes | (a) solo existe con el canario publicado (E3); (b) en todas las tandas |
| Rutas públicas legítimas | `/healthz`, la interfaz de n8n, `/webhook/tai-publico-canario` y un webhook público real **ya existente** (p. ej. el de clics de la web, solo si el propietario lo indica y sin enviar datos) | Siguen llegando a n8n con su respuesta habitual; los **20 controles negativos** (`lector-local-04/12`, `tai-lector-produccion`, `webhook-test` ajeno, `/assets/webhook-icon.svg`…) no se bloquean |
| Interior | Desde un contenedor de la red `easypanel` (p. ej. el de la web, con `node -e fetch(...)`) a `http://<servicio-n8n>:5678/webhook/tai-lector-prod-canario` con la credencial desechable; sin credencial | Con credencial: 200 `{"canario":true}`; sin credencial: 403 de n8n. Demuestra que el camino del futuro Director **no pasa por el proxy y funciona** |
| Persistencia | §3.6 | Igual resultado tras ≥ 24 h y tras reinicios/actualizaciones |
Para HTTPS desde fuera hace falta una variante de `peticionCruda` con `tls.connect` y SNI (diseño; no implementada); mientras tanto, `curl --path-as-is` conserva `%2F`/`%5C` sin normalizar. **Ninguna petición exterior usa credenciales reales ni datos.**
**Secuencia:** la tabla se aplica según la secuencia revisada de §2 (la matriz se ejecuta primero sobre rutas SIN publicar y el canario solo se publica con el bloqueo vigente).

## 4b. Evidencia en el registro de acceso REAL (formato CLF; no se presupone ningún campo JSON)
**Lo que NO se puede usar** (era del entorno local en JSON): `ClientHost`, `RouterName`, `ServiceName`, `OriginStatus`, `DownstreamStatus`, la cabecera `X-Prueba-Id`. **El CLF no lleva cabeceras ni estado del origen.**
**Formato de Traefik (documentación 3.x):** `IP - usuario [fecha] "MÉTODO ruta PROTOCOLO" estado bytes "referer" "user-agent" contador "router" "URL-del-servidor" duración`. Los dos campos entre comillas finales son el **router** y el **servidor** que atendió la petición. *Esta descripción sale de la documentación: el orden y los valores exactos (p. ej. qué aparece en esos campos cuando responde `noop@internal` o cuando Traefik contesta 400/404 sin router) se fijan con las líneas reales de E1 y E2, no antes.*
**Cómo se correlaciona:** cada petición de prueba lleva una **consulta con ID único** (p. ej. `?tai=<id>`; no afecta a `PathRegexp`, que solo mira la ruta), que aparece en la ruta del CLF. Se localiza con `docker service logs "$T" 2>&1 | grep -F '<id>'` (desde la consola web, solo lectura) y **antes de copiar o pegar nada se sustituye la IP del primer campo por `<ip>`** (el registro contiene IP públicas y *user-agent*). Sin cabeceras, no hay forma de distinguir pruebas por origen: el ID único y la hora son los únicos nexos.
**Criterios (cualquiera que no se cumpla ANULA la tanda):**
| Situación | Evidencia CLF esperada | Veredicto |
|---|---|---|
| Centinela `GET /healthz` y ruta pública de control | Línea con estado 200 / 404 y el **router y servidor de n8n** (nombres tomados de E1) | Positivos: prueban que el registro funciona y que el origen se alcanza |
| Petición a la ruta bloqueada, regla cargada | Respuesta `Forbidden`; si hay línea, su router es el de bloqueo y **no** el de n8n | Bloqueada |
| Petición bloqueada con línea que muestra el router de n8n | — | **FUGA (alarma)** |
| Petición bloqueada sin ninguna línea | Localmente (JSON) las bloqueadas **no dejaron línea**; en CLF **no se presupone igual** | No es prueba por sí sola: se exige el cuerpo `Forbidden` **y** que los centinelas del mismo lote sí aparezcan |
| Petición con cuerpo de n8n | — | **FUGA**, haya o no línea |
La **fuente principal sigue siendo la respuesta** (cuerpo/estado); el CLF es evidencia **corroborante**. Los centinelas positivos de cada tanda protegen contra un registro que no escribe, rotado o con retraso (el registro del servicio puede tardar unos segundos y tener límites de tamaño por el *driver* de registros; no consta cuáles).

## 5. Reversión (no deja ningún lector real expuesto)
**Orden obligatorio; cada paso tiene una puerta y, si falla, NO se avanza al siguiente:**
1. **Puerta A · el lector real está INACTIVO o no existe.** En n8n, los workflows del lector (04 y 12) figuran *Inactive*, **y** una petición interna (desde la red `easypanel`) a `/webhook/tai-lector-prod-04` y `-12` devuelve el **404 «not registered» de n8n** (webhook no registrado = no publicado). Si cualquiera responde otra cosa → **no se toca el bloqueo**; se despublica primero.
2. **Despublicar y borrar los canarios** y borrar la credencial desechable.
3. **Puerta B** (misma comprobación que A, repetida tras el paso 2).
4. **Solo entonces**, si de verdad hay que retirar el bloqueo: `mv /etc/easypanel/traefik/config/custom.yaml /etc/easypanel/traefik/config/custom.yaml.retirado` (renombrar es reversible; la extensión `.retirado` hace que Traefik lo ignore).
5. **Verificación:** sonda exterior a `/webhook/tai-lector-prod-04` → ahora responde n8n «not registered» (confirma la retirada) y **nunca** datos; `main.yaml` con el mismo hash que antes (bloque de verificación de §9) y la carpeta con solo los archivos esperados. **La reversión no necesita ninguna copia de `main.yaml`**: solo renombra `custom.yaml`.
**Recomendación:** no retirar nunca el bloqueo salvo que el lector real se elimine; el bloqueo es inofensivo para el resto de rutas (20 controles negativos). Si el bloqueo rompiera algo legítimo antes de importar el lector, retirarlo es seguro (paso 4) porque aún no hay lector.

## 6. Supervisión para detectar la desaparición del router de bloqueo (diseño; NO implementada)
- **Comprobación exterior sin credenciales** (la clave): `POST` a `/webhook/tai-lector-prod-04` y `-12` (y alguna variante `%2F`) por HTTPS **sin cabecera de credencial**: con el bloqueo, **`Forbidden`** de Traefik; sin él, n8n responde «not registered» (lector inactivo) o «Authorization data is wrong» (lector activo). Cualquier cuerpo que no sea `Forbidden` = **ALARMA**. Más un control `GET /healthz` = 200. Se ejecuta desde **fuera del VPS** (PC del propietario o servicio externo) cada 15 min y **inmediatamente** tras reinicios, actualizaciones de EasyPanel/Traefik o despliegues.
- **Desde el VPS (lectura, a mano o con el colector cuando se autorice F9):** `sha256sum` y fecha de `custom.yaml` frente a la referencia (`2f9c5b1b…af39`) y de `main.yaml`; presencia del router en la configuración que Traefik recibió (si el registro está en DEBUG).
- **Cierre en falso del lector:** el cliente `crearLectorProduccion` del Director **se negaría a leer producción** si no existe una comprobación exterior correcta **reciente** (p. ej. ≤ 30 min). Así, un bloqueo perdido deja de exponer el lector aunque nadie mire.
- **Qué alerta y a quién:** pendiente de la decisión D3 (canal y responsable). Hasta entonces, comprobación manual tras cada evento.

## 7. Riesgos pendientes y prevención de exposición accidental
1. **Prevención:** el lector real (importación y publicación) tiene **puerta propia**: se exige el informe del E3/E4 y la sonda exterior correcta **el mismo día**; el archivo se importa **inactivo**; se publica solo desde la interfaz, nunca por un procedimiento que reinicie n8n sin vigilancia; la credencial del lector es exclusiva y distinta de la del canario.
2. **La lista de IP NO se cuenta como barrera** hasta validarla con el canario de IP (§1d): `forwardedHeaders.insecure=true` y `N8N_PROXY_HOPS=1` la hacen inferior a lo previsto (falsificación posible desde la red interna; con Swarm *ingress* todos los clientes pueden parecer la misma IP). Seguirá configurándose a mano al importar el lector como señal adicional, pero **nunca como condición** para publicarlo; las barreras son el bloqueo de Traefik, la credencial exclusiva y el cierre en falso del Director.
3. **EasyPanel/Traefik pueden cambiar** (actualización, regeneración, borrado de `custom.yaml`): mitigación = supervisión de §6 y la copia de `custom.yaml` que ya existe en el repositorio (hash `2f9c5b1b…af39`). **`main.yaml` NO tiene copia externa por decisión del propietario** (§9): su hash detecta cambios pero no permite ver qué cambió ni restaurarlo (riesgo residual aceptado, §9).
4. **Supuestos que el local no reproduce:** nombres de entrypoints, `ingress` de Swarm, `encodedCharacters` real, registro de acceso, y que un cambio de versión de Traefik/n8n altere la interpretación de rutas codificadas.
5. **Sobre-bloqueo accidental** de rutas públicas: 20 controles negativos locales; en el VPS se repiten con el webhook público real que el propietario indique.
6. **Consola web (pegado):** riesgo de corrupción: el hash lo detecta antes de activar.
7. **E-1** (ledger en el VPS) y **F9** siguen abiertos (**F8** superada con riesgos residuales documentados, 16/11/2026); **nada de esto autoriza el Director**.

## 8. PostgreSQL y el Director (decisión D-4 PENDIENTE)
PostgreSQL y el runner comparten la red `easypanel` con n8n: **un Director en esa red NO está aislado de PostgreSQL a nivel de red** (ni en otro proyecto de EasyPanel). Hay dos opciones sin decidir: (1) Director gestionado por EasyPanel con controles compensatorios (sin credenciales de PostgreSQL, contraseña remota obligatoria comprobada en solo lectura, contenedor sin privilegios) y aceptación expresa del riesgo; (2) red dedicada solo con n8n y el Director (fuera de EasyPanel; reinicia n8n y puede perderse en un despliegue). Este documento **no** da por aislado al Director en ningún caso.

## 9. Decisión de cierre de E0 SIN copia externa de `main.yaml` (16/11/2026), E0b y condiciones para E1
**Decisión del propietario (16/11/2026):** no se hace copia externa de `main.yaml`, para no modificar configuraciones de Windows ni transferir por pantalla y portapapeles un contenido potencialmente sensible. **El «Bloque 10b» (Base64 + PowerShell) queda RETIRADO y no se ejecuta.** (Constancia: no hay en Hostinger un método de descarga de archivos del VPS confirmado, y las vías de EasyPanel —SFTP/SSH o la plantilla FileBrowser— exigen SSH o instalar un servicio; por eso la única vía posible era el portapapeles.)

### 9.1 ¿Es indispensable la copia para revertir nuestra intervención? No
- **Lo que hacemos:** E2 crea **un archivo nuevo** (`custom.yaml`, vía `custom.yaml.nuevo` + un solo `mv`). **`main.yaml` no se abre, no se edita y no se mueve** en ninguna etapa.
- **Cómo se revierte:** `mv custom.yaml custom.yaml.retirado` (o `rm` del archivo nuevo si falla antes de activarlo; §3.4, §5.4). La reversión **solo toca `custom.yaml`** y su corrección se comprueba por comportamiento (sonda a `Forbidden` → 404 de n8n) y por hash de `main.yaml` (§9.3). No lee ni necesita el contenido de `main.yaml`.
- **Qué NO haría la copia:** `main.yaml` lo regenera EasyPanel desde su propio estado. Restaurar a mano una versión antigua sobre un archivo gestionado podría deshacer cambios legítimos o ser sobrescrito. La copia habría servido solo para **diagnosticar** (ver qué cambió si el hash cambiara), no para revertir nuestra intervención.
- **Precondición:** antes de E2 se comprueba que **no existe ya `custom.yaml`** (§3.1); en el bloque 8 la carpeta solo constaba con `main.yaml`.

### 9.2 Riesgo residual aceptado
Si `main.yaml` cambia por una causa ajena (EasyPanel, actualización, otro operador), **se sabrá que cambió (hash, tamaño, fecha) pero no qué cambió, y no habrá contenido anterior con el que comparar ni restaurar.** Se diagnostica leyendo el archivo vigente y comprobando el bloqueo **por comportamiento** (§3.4); el bloqueo vive en `custom.yaml`, independiente de `main.yaml`. No se verificó que Hostinger conserve copias o *snapshots* utilizables a nivel de archivo: **no se cuenta con ellos**. Aceptado por el propietario el 16/11/2026; se revisa si cambia la forma de gestionar Traefik/EasyPanel.

### 9.3 Referencia y verificación del hash antes y después (solo lectura)
| Elemento | Valor de referencia (comprobado en el bloque 8) |
|---|---|
| SHA-256 de `main.yaml` | `5a0113d86b3af7fd66afa027d59adb5d714a74c70fa346209f2374db307ab267` |
| Tamaño | 8033 bytes |
| Propietario y modo | `main.yaml` `root:root 644`; carpeta `/etc/easypanel/traefik/config` `root:root 755` |
```sh
D=/etc/easypanel/traefik/config
sha256sum $D/main.yaml
stat -c '%U:%G %a %s %n' $D $D/main.yaml
ls -la --time-style=full-iso $D
```
**Cuándo se ejecuta:** (1) **inmediatamente antes** de cualquier intervención autorizada (E2: antes del `mv`; también antes de E1 como línea base); (2) **inmediatamente después** (tras el `mv` y, de nuevo, tras la reversión si se hace); (3) en la persistencia de E4 (5 min, 24 h y tras cualquier reinicio, actualización o despliegue).
**Reglas:**
- **Antes de intervenir**, si el hash, el tamaño o el modo **no coinciden**, **no se interviene**: se comunica el hash y el tamaño nuevos (nunca el contenido) y el propietario decide si el nuevo estado pasa a ser la referencia. Una referencia nueva se registra aquí con fecha y motivo.
- **Después de intervenir**, si difieren, se anota el momento y si coincide con algún evento de EasyPanel; se comprueba el bloqueo por comportamiento; **no se edita ni se restaura `main.yaml`** y, ante duda, se retira solo `custom.yaml` por renombrado.
- La carpeta solo debe contener `main.yaml` antes de E2 y `main.yaml` + `custom.yaml` después; cualquier otro archivo se anota.

### 9.4 Criterio de cierre de E0 (sin copia externa)
E0 queda **CERRADO** cuando se cumplen **todos** (**cumplidos el 16/11/2026: E0 CERRADA**):
1. Bloques 8 y 9 ejecutados y registrados (§1b, §1f) — **hecho**.
2. Referencia registrada: SHA-256, tamaño y permisos de `main.yaml` (§9.3) — **hecho**.
3. Decisión de prescindir de la copia, con su análisis y riesgo residual (§9.1-9.2) — **hecho** (16/11/2026).
4. Protocolo de verificación del hash antes y después definido (§9.3) — **hecho**.
5. **Salvedad `encodedCharacters`** (§1f.6): los *argumentos* del servicio no contienen ninguna opción `encodedCharacters` — **hecho** (16/11/2026, `ENCODEDCHARACTERS_EN_ARGS=NO`, comunicado por el propietario).
Lo demás (línea CLF de n8n, sonda HTTPS, etc.) pertenece a E1/E2 y **no** bloquea E0. **Nada de esto autoriza E1, E2, el Director ni F9.**

### 9.5 E0b: ejecutada y SUPERADA (resumen; detalle en §1h)
Se ejecutó el 16/11/2026 en local (Docker Desktop, contexto `desktop-linux`, imágenes ya descargadas, sin descargas ni `prune`): validación original (132/132 y 104/104) y verificación complementaria `verificar-clf` (9/9 bloqueadas, 0 ejecuciones indebidas, controles positivos y CLF correctos). La regla (`2f9c5b1b…af39`) y el `informe.json` original (`453b771a…c048`, que conserva su «no validada») no se modificaron; los recursos de `tai-prueba-tf` se eliminaron y los tres contenedores preexistentes quedaron intactos. La autorización de esa etapa **no se extiende** a ninguna otra.

### 9.6 Condiciones pendientes para avanzar a E1 (NINGUNA fase posterior está autorizada)
E1 = sondas exteriores **sin publicar nada** (§2). Para poder proponerla hace falta:
1. **Autorización expresa del propietario para E1**, con ventana. El asistente no ejecuta nada en el VPS: las sondas las lanza el propietario desde su PC y lee los registros y el hash desde la consola web.
2. **Herramienta de sondas exteriores por HTTPS** definida: `curl --path-as-is` (conserva `%2F`/`%5C`) con ID único en la consulta, o una variante TLS con SNI del lanzador (diseño en §4, **no implementada**); y el procedimiento para recoger las líneas CLF (§4b) con la IP enmascarada.
3. **Línea base de `main.yaml`** justo antes de empezar (§9.3: `5a0113d8…ab267`, `root:root 644`, 8033 bytes) y comprobación de que **no existe** `custom.yaml`.
4. **Estado de partida sin bloqueo** confirmado: `/webhook/tai-lector-prod-zz` y `/webhook/tai-publico-zz` (sin publicar) devuelven el 404 JSON de n8n y `/healthz` 200 (§2, E1).
5. **Consola web de Hostinger operativa** (vía de lectura del hash y del CLF).
6. **Sin despliegues durante la ventana** (un `git push` a `main` reinicia servicios y mezcla señales); en E1 no se importa ni publica ningún workflow.
7. Para **E2** (primera escritura en el VPS), además: autorización propia; reversión (§3, §5) preparada; hash de `custom.yaml` verificable (`2f9c5b1b…af39`, 517 bytes); no empieza si el hash de `main.yaml` difiere de la referencia. **E3** (matriz exterior completa y canario) y la importación del lector real requieren **sus propias autorizaciones**.
8. Pendientes **no bloqueantes** para E1–E3 pero previos al Director y al lector real: D-4 (PostgreSQL y la red `easypanel`, §8), D-2/D-3 (acceso al Director y su entrega), D3 (canal de alertas), **F8** (SSH; **SUPERADA con riesgos residuales documentados el 16/11/2026**, `F8-CIERRE-INFORME.md`: patrón de la consola reproducido; atribución individual de los 14 accesos históricos no demostrada) y **F9 sin autorizar**.
9. **Riesgos que persisten:** la capa 2 no es barrera; la web usa un `X-Forwarded-For` falsificable (otra decisión); `main.yaml` sin copia externa (riesgo aceptado, §9.2); el entorno local no reproduce Swarm, `ingress` ni el modo `host` (§1h.6), así que **E1–E3 siguen siendo imprescindibles**.
