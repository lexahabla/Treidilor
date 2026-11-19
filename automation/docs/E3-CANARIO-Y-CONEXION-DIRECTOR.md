# E3 (canario) y conexión del Director 00 con el lector real — procedimiento mínimo (17/11/2026, v2)

**Estado: PREPARADO Y PROBADO EN LOCAL (316 pruebas). NO ejecutado en el VPS ni en n8n de producción; nada publicado.** Cada paso: **[AUTO]** = un comando, **[MANUAL]** = interfaz o decisión.

## 0. Qué cambió respecto a la v1
- El canario ahora **guarda sus ejecuciones** (`saveData*Execution = all`; antes `none`, con lo que «0 ejecuciones» no probaba nada). El linter lo exige.
- `verificar-canario.sh` (VPS, solo lectura) automatiza el contador de ejecuciones, la prueba positiva interior y la negativa; la sonda exterior del PC no cambia.
- Distribución privada del Director sin Base64: repositorio PRIVADO independiente + una orden de consola (`preparar-distribucion-director.mjs`).
- `consultar-real.sh` descubre sola la red y el servicio de n8n.

## A. Canario E3 (3 intervenciones manuales mínimas en n8n; el resto automático)
1. **[AUTO, PC]** Credencial desechable (fuera del repositorio): `New-Item -ItemType Directory -Force D:\AXEL\WEBS\TRADYLOR\secretos-e3 | Out-Null; $b=New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [IO.File]::WriteAllText('D:\AXEL\WEBS\TRADYLOR\secretos-e3\canario.token', (($b|%{$_.ToString('x2')}) -join ''))`
2. **[MANUAL, n8n]** (a) Credencial *Header Auth* «Treidilor — Canario aislamiento (desechable)», cabecera `x-treidilor-canario`, valor = contenido de `canario.token`; (b) importar `canario-aislamiento.produccion.json` (workflow NUEVO; ya trae «guardar ejecuciones»), asignar la credencial y **activarlo**.
3. **[MANUAL, VPS]** (los scripts viajan en el paquete de la sección B, en `/root/tai-director-dist/`; por eso B.1-B.3 va antes) Una vez: `bash verificar-canario.sh token` (pega el valor sin eco). Se guarda en `/root/tai-secretos/canario.token` (modo 600).
4. **[AUTO, VPS]** `bash verificar-canario.sh antes` → contador inicial; **prueba positiva** interior con credencial (200 `{"canario":true}` y +1 ejecución visible); **prueba negativa** interior sin credencial (403, +0). Si el canario no está publicado (404) o no guarda ejecuciones, **falla y lo dice**.
5. **[AUTO, PC]** `node scripts/automation/sonda-exterior-e3.mjs --host <dominio-n8n> --salida D:\AXEL\WEBS\TRADYLOR\informes-e3 --cred-file D:\AXEL\WEBS\TRADYLOR\secretos-e3\canario.token` → `E3_EXTERIOR_OK` (67 celdas con id único `tai=<prefijo>-NNN`); imprime el prefijo.
6. **[AUTO, VPS]** `bash verificar-canario.sh despues <prefijo>` → `E3_CANARIO_OK`: el contador **no ha cambiado** por la sonda exterior (0 ejecuciones adicionales), la prueba interior **no figura** en el registro de Traefik (no pasó por el proxy) y se cuentan las líneas de la sonda exterior. Fuga = `E3_CANARIO_FUGA` (código 2): desactivar el canario en el acto.
7. **[MANUAL, n8n]** Desactivar y borrar el canario y su credencial (E5); borrar `canario.token` y `/root/tai-e3/canario-estado.env`. El bloqueo de Traefik se conserva.
Límites honestos: `verificar-canario.sh` lee el contador con una consulta **SELECT** a la base de n8n por `docker exec` (descubre el contenedor de PostgreSQL y la tabla `execution_entity`); **no se ha probado contra el n8n 2.38.6 real** (solo con un docker falso). Si no puede leerlo, devuelve `E3_CANARIO_NO_COMPROBABLE` (código 3) y se mira *Executions* en la interfaz. La credencial desechable queda en los registros de ejecución del canario y se borra con él.

## B. Distribución privada del Director (sin Base64, sin tocar el repositorio de la web)
**Método recomendado:** repositorio PRIVADO e independiente en GitHub (p. ej. `<usuario>/treidilor-director-dist`) con una carpeta que genera `scripts/automation/preparar-distribucion-director.mjs`. Un push ahí **no redespliega nada** (EasyPanel solo vigila el repositorio de la web). El VPS lo descarga con `curl` + `tar` (sin git) usando un **token de acceso fino de solo lectura de ese repositorio**, y `instalar.sh` exige el SHA-256 que tú le pasas (ancla: no basta con el del repositorio).
1. **[AUTO, PC]** (ya generada de ejemplo en `D:\AXEL\WEBS\TRADYLOR\director-dist`, SHA-256 `95afd737…bf9a`) `node scripts/automation/preparar-distribucion-director.mjs --tar <treidilor-director-<v>.tar> --salida <carpeta nueva fuera del repo> --repo <usuario>/treidilor-director-dist` → carpeta + la orden de consola.
2. **[MANUAL, decisión y credenciales NUEVAS]** Crear el repositorio **privado** y un **token de acceso fino** (Repository → Contents: **Read-only**, solo ese repositorio, caducidad corta). Publicar la carpeta (`git init -b main; git add -A; git commit; git remote add; git push`). *Solo esto requiere credenciales nuevas.*
3. **[AUTO, VPS]** Pegar la orden impresa por el generador (una línea): pide el token sin eco, descarga, verifica el SHA-256, construye la imagen, prueba de humo sin red, deja `:anterior` para el rollback y activa `:actual`. No abre puertos, no toca servicios, redes, Traefik, n8n ni credenciales/permisos SSH.
4. **Rollback [AUTO, VPS]:** `bash /root/tai-director-dist/revertir.sh` (vuelve a `:anterior`); `revertir.sh retirar [--con-ledger]` quita las imágenes (el volumen del ledger se conserva salvo `--con-ledger`). Actualizar = repetir el paso 1-3 con la versión nueva.
Alternativas descartadas: Base64 por consola (inviable), repositorio principal (redespliega la web), registro de imágenes (servicio extra), `scp` (requiere tocar/usar SSH, que no se amplía).

## C. Conexión real con 04 y 12 (tras A y tras importar el lector)
1. **[MANUAL, n8n]** Credencial EXCLUSIVA del lector (`x-treidilor-lector-prod`, valor aleatorio distinto del canario) e importar `lector-instantaneas.produccion.json` como workflow NUEVO **inactivo** (tablas `calidad_catalogo_instantaneas` y `auditor_general_instantaneas` ya existen). Activar solo con el bloqueo verificado el mismo día (repetir la sonda exterior antes y después: `E3_EXTERIOR_OK`).
2. **[MANUAL, VPS]** `bash consultar-real.sh token` (pega el valor del lector sin eco).
3. **[AUTO, VPS]** `bash consultar-real.sh` → descubre el servicio y la red de n8n, y ejecuta: informe 04, informe 12, comparación de ambos, `ledger verificar` (fecha y frescura incluidas en cada informe). El contenedor: sin puertos, solo lectura, `--cap-drop ALL`, sin acceso al catálogo (la imagen no lo contiene), único volumen escribible = el ledger, credencial montada en solo lectura, solo L0 (L2/L4 solo aprobación simulada), sin proveedor de IA.
Se detiene con mensaje claro si hay 0 o varios servicios de n8n, la red no es única o **no es «attachable»** (en ese caso hace falta decidir una alternativa; ver riesgos).

## D. Intervenciones imprescindibles que quedan
| Manual | Motivo |
|---|---|
| Credenciales e importar/activar/desactivar workflows en la interfaz de n8n | El MCP/API de n8n de producción no está autorizado |
| Crear el repositorio privado y el token de solo lectura | Credenciales nuevas, decisión del propietario |
| Pegar 3 valores secretos sin eco (canario, lector, token de GitHub) y 1 orden de consola por paso | No se escriben secretos en archivos del repositorio ni en el historial |

## E. Instrucciones cortas (18/11/2026) — el secreto nunca se muestra
- Canario: `automation/workflows-puente/produccion/canario-aislamiento.produccion.json` (sha256 `c5636943…`; inactivo; webhook POST `tai-lector-prod-canario`; Header Auth `x-treidilor-canario`; credencial «Treidilor — Canario aislamiento (desechable)»; guarda ejecuciones; responde 200 `{"canario":true}`). Compatible con `verificar-canario.sh` (misma ruta, cabecera y nombre; el nombre del workflow contiene «Canario de aislamiento»).
- El valor se genera en el PC y va al portapapeles (`… | Set-Clipboard`), se pega en n8n y en el prompt sin eco del VPS (`bash /root/tai-director-dist/verificar-canario.sh token`); no se imprime en ninguna parte.
- Lector real (después): `lector-instantaneas.produccion.json` (webhooks `tai-lector-prod-04` y `-12`, Header Auth `x-treidilor-lector-prod`, credencial «Treidilor — Lector puente PRODUCCIÓN (solo lectura)», tablas por nombre `calidad_catalogo_instantaneas` y `auditor_general_instantaneas`, solo `get`, límite 200). Importar inactivo; activar solo tras `E3_CANARIO_OK` y con la sonda exterior repetida el mismo día.
