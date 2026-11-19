# Integridad periódica supervisada y anclaje externo (Director 00 · 3E.8.8)

Estado: **implementado en local con datos sintéticos; sin programar, sin activar canales, sin tocar el VPS.** Esta fase es una continuación propuesta; no figura en el Plan Maestro. Informe de la fase: `TREIDILOR\informes\2026-11-18\3E8-8-informe.md`. Motor y comando: `treidilor-ai\prototipo-incidencias-director` (`FASE-3E8-7`, `FASE-3E8-8`).

## Piezas (`automation/director/integridad/`)
| Archivo | Función |
|---|---|
| `config.mjs` | Política 6/12/24 h, comprobación prevista cada hora, franja prohibida 08:50–10:05 (Madrid), timeout 120 s, montón 160 MiB, salida ≤ 64 KiB, cerrojo 5 min |
| `estado.mjs` | Estado y alertas derivados del **ledger**: última satisfactoria, última tentativa, siguiente comprobación, vencida, alteración confirmada, error operativo, ancla. Funciones puras: `debeEjecutar`, `enVentanaProhibida`, `validarPoliticaIntegridad` |
| `ancla.mjs` | `leerAncla`, `decidirAnclaje` (pura), `anclar` (monótono, idempotente, con comparación de secuencia del ledger) |
| `ejecucion.mjs` | `ejecutarIntegridadSupervisada`: decide si toca, aplaza por franja, cerrojo, lanza el comando como proceso independiente con límites, interpreta 0/1/2/3 y escribe en el ledger |

Eventos nuevos del ledger (partición `integridad`, aditivos en `ledger.mjs`): `ancla_integridad`, `integridad_ejecucion`, `integridad_discrepancia`.

## Flujo de una pasada
1. **Toca o no toca** (por el ledger, no por el registro del almacén): primera verificación obligatoria; tras una tentativa no satisfactoria; al vencer el intervalo. «No toca» y «aplazada por franja» no lanzan nada ni cambian el ledger. `forzar` ignora ambas.
2. Cerrojo `integridad-<almacén>.lock` (una pasada por almacén; caduca a los 5 min si queda huérfano).
3. Lanza el comando con `--ancla-seq/--ancla-huella` (o `--sin-ancla`). Sin `--si-toca`: el Director decide.
4. **Decisión de anclaje** (`decidirAnclaje`): solo se ancla tras `resultado ok`, `código 0`, `completa` y contraste con el ancla vigente = `coincide`. Un resultado omitido, parcial, fallido o no contrastado **nunca** avanza.
5. Orden de escritura: primero el ancla, después el resumen `integridad_ejecucion`. Si el ancla no se escribe, la ejecución queda como `error` (no satisfactoria) y se reintenta.

## Códigos de salida (semántica del comando, sin cambios)
`0` correcta · `1` alteración o retroceso confirmados (no se reintenta ni se repara) · `2` aviso (incompleta o sin ancla fiable; se reintenta) · `3` error operativo (se reintenta; 3 seguidos → fallo). El Director contrasta el código del proceso con el declarado; cualquier incoherencia, salida inválida, timeout, terminación inesperada o salida excesiva es error operativo.

## Independencia del ancla (qué protege y qué no)
- **Protege:** una restauración antigua del almacén hecha sin el ledger (el ancla guarda una cabeza posterior que el almacén ya no contiene), la sustitución por otra historia, la alteración o truncado del ledger (el propio ledger lo detecta), reinicios y reintentos (idempotente).
- **No protege:** que quien controle el equipo restaure ledger y almacén **juntos** (la prueba lo documenta), ni la pérdida del disco. Un ledger restaurado a una versión antigua y coherente hace retroceder el ancla. Hace falta una copia fuera del equipo (p. ej. el comunicado al propietario) para cerrarlo.
- El ancla **no se toma nunca del registro del almacén**.

## Procedimientos
- **Pérdida del ledger / primer anclaje fallido con historial en el almacén:** no se reancla sola (`ancla_ausente_con_historial`, aviso). Reanclaje explícito: `reanclar: { confirmar: true, motivo (≥ 10 caracteres), autorizadoPor: 'propietario' }`; queda registrado con el ancla previa.
- **Restauración deliberada de un almacén antiguo:** además de reanclar, hay que apartar a mano `integridad-diario.json` del almacén (su registro propio se quejaría del retroceso).

## Requisitos antes de activar la programación (NO autorizada)
Decidir el disparador y el host (n8n, el propio Director o un planificador) y su cuenta; fijar `idAlmacen`, rutas y límites reales; ledger en un directorio/volumen distinto del almacén; copia externa verificada del almacén; ancla copiada fuera del equipo; primera ejecución manual supervisada sobre una **copia**; decidir si el aviso se incluye en el resumen diario y por qué canal; confirmar que la franja prohibida refleja las horas reales de gestor, vigilante y resumen; medir con datos reales en el Director estricto. Cualquier despliegue cambia el contenido del TAR del Director (la versión 1.0.0-f2 instalada ya no coincide con el árbol): hace falta una versión nueva y autorización.

## 3E.8.9 · Endurecimiento y copia externa firmada del ancla
**Guardas.** `anclar` tiene una sola guarda de integridad del ledger (vía `leerAncla`), con motivos propios: `ledger_no_disponible`, `ledger_no_integro`, `ledger_cola_incompleta`, `ledger_lectura_fallida`. La pasada se aplaza (`aplazada_escritura_en_curso`) si el almacén tiene un `bloqueo.json` tocado hace menos de `escrituraEnCursoMs` (120 s). `almacen_inestable_durante_la_verificacion` es un **error operativo (código 3)**, nunca una alteración: no abre discrepancia ni marca alteración confirmada.

**Copia externa firmada (`integridad/copia-ancla.mjs`).** Cada cambio de ancla emite `ancla-externa/1` (idAlmacen, contador, seq, huella, instante, huella del documento anterior) firmado con Ed25519, en un destino **independiente** (ni dentro ni alrededor del ledger o del almacén; por defecto otra unidad), con archivos `wx` y fsync. Es idempotente, nunca retrocede, aparta (no borra) lo inválido y no se escribe nunca con secretos reales: la clave privada la aporta quien ejecuta.
- **Garantiza:** integridad y autenticidad de cada copia, cadena de contadores (huecos, sustituciones de una copia intermedia y seq decreciente quedan en evidencia) y contraste con el ledger (coinciden · ledger atrasado · copia atrasada · distintas).
- **No garantiza por sí sola frescura.** Una copia de seguridad convencional, incluso autenticada, **no protege contra la sustitución por una versión antigua también válida**: hace falta una **referencia de frescura independiente** (`contadorMinimo`, el último contador que el propietario conoce por otra vía, p. ej. el `comunicado()`). Sin ella el estado declara `copia_externa_sin_referencia` (aviso); con ella, una copia anterior da `copia_externa_obsoleta` (fallo). Una prueba lo demuestra con restauración conjunta de almacén, ledger y carpeta de copias.
- **Nunca reancla sola.** Con el ledger perdido o atrasado la copia sirve de contraste (el almacén retrocedido se detecta); el reanclaje sigue exigiendo `reanclar` explícito del propietario (`proponerReanclaje` solo propone). Una copia obsoleta o con la cadena rota se informa pero no se usa como contraste. Si la copia discrepa del ledger (misma seq, otra huella) no se lanza nada y la situación queda registrada una sola vez (fallo `ancla_copia_discrepante`).
- **Interfaz:** `lineasEstadoIntegridad(estado)` entrega líneas de texto sin rutas, huellas completas ni secretos para el resumen y el estado existentes (Canal 13); no envía nada.

**Recursos medidos (Docker 256 MiB / 0,5 CPU, 30.000 tareas):** verificación sola ≈ 5,2 s y RSS ≈ 165–171 MiB; escritor solo ≈ 215–226 MiB. Simultáneos al límite de 256 MiB se alcanza el tope del cgroup (con swap prohibido, OOM del escritor); con 384/512 MiB no hay eventos de memoria (pico 344–378 MiB), pero la verificación termina en error 3 por inestabilidad. Recomendación: no solapar nunca (franja prohibida + guarda de escritura), ≥ 384 MiB si pudieran coincidir, y contar con que 0,5 CPU duplica la duración.

**Procedimientos nuevos.** *Primera verificación:* sobre una **copia** del almacén, con la ejecución manual `forzar`, sin copia externa activa hasta revisar el resultado; después activar la copia y anotar el contador como referencia. *Ledger perdido o restaurado:* la ejecución queda en `sin_ancla` (aviso, código 2) o se pone al día si el almacén contiene la cabeza de la copia; el propietario decide el reanclaje con la propuesta de la copia vigente.

## 3E.8.10 · Consola del Director (solo consulta, desactivada por defecto)
**Comandos** (`node scripts/automation/director.mjs …`, también dentro de `consola`): `integridad estado` (nivel, última verificación satisfactoria, última tentativa, próxima prevista, vencimiento `vigente|vencida|caducada|nunca_verificada`, alteración confirmada, errores operativos, alertas, ancla) · `integridad ancla` (ancla vigente y copia externa: frescura, anomalías, contraste y discrepancia) · `integridad ayuda`. **No existe ningún comando para ejecutar, anclar, reanclar ni exportar**: consultar nunca es autorizar. La ayuda general de la consola no cambia.

**Activación** (`integridad/consola.mjs`): archivo `integridad-activacion.json` junto al ledger del Director (o la ruta de `TAI_INTEGRIDAD_CONFIG`), con `esquema: "integridad-activacion/1"`, `habilitada: true` (booleano), `autorizadoPor: "propietario"` e `idAlmacen`; opcionales `ledgerDir`, `copiaExterna {destino, clavePublicaArchivo}` y `referenciaFrescura {contadorMinimo}`. Validación estricta: campo desconocido, JSON roto, archivo demasiado grande o con forma de credencial, permisos insuficientes o ausencia ⇒ **desactivada**. `TAI_INTEGRIDAD_DESACTIVAR=si` desactiva siempre. El archivo vive fuera del repositorio y **nunca entra en un paquete** (exclusión explícita en el empaquetador), así que actualizar el Director no activa nada.

**Garantías:** desactivada no se abre el ledger de integridad ni se crea ninguna carpeta; activada, la consulta no escribe nada (carpeta idéntica antes y después) ni lanza procesos; el módulo no importa `ejecucion.mjs` ni `child_process`; ninguna ruta absoluta, clave ni huella completa sale por pantalla (`sanear` como segunda barrera); una clave privada indicada como pública se rechaza; no se tocan los canales de alerta ni Canal13. Códigos: 0 consulta hecha (también «desactivada»), 1 uso, 2 activada pero sin ledger de integridad.

**Reversibilidad:** borrar el archivo de activación, o `TAI_INTEGRIDAD_DESACTIVAR=si`, vuelve al comportamiento anterior; quitar la integración son tres líneas en `scripts/automation/director.mjs` y el módulo nuevo.

## 3E.8.11 · Ejecución manual explícita (en dos etapas) y ensayo aislado
**Comando** (solo por línea de comandos; el modo interactivo y las consultas no lo ofrecen): `integridad ejecutar --preparar [--almacen <id>]` y `integridad ejecutar --confirmar <solicitud> [--almacen <id>]`. Sin banderas solo muestra el uso. Módulo: `integridad/ejecutar-manual.mjs`, cargado bajo demanda (la consulta nunca importa el supervisor ni `child_process`).

**Requisitos de la ejecución:** (1) activación válida con bloque `ejecucion` {almacenDir, cli, verificador, frioDir?, maxTareas?} (rutas absolutas, sin segmentos de producción o secretos; solo ese almacén es ejecutable); (2) solicitud de la etapa 1, de un solo uso, vinculada a la configuración y con caducidad de 5 minutos; (3) código del propietario en `TAI_INTEGRIDAD_CODIGO`, comparado con un verificador scrypt (`crearVerificador`) que es lo único que se guarda; un código incorrecto invalida la solicitud. El texto de la confirmación por sí solo no acredita a nadie: **límite real** — quien controle la cuenta del sistema y conozca el código puede ejecutar.

**Separación:** se respetan la franja del gestor/vigilante y la escritura en curso (no hay forma de forzarlas); el anclaje solo ocurre si el contrato existente lo decide tras una verificación completa, correcta y contrastada; `reanclar` va fijo a `null` (el reanclaje sigue siendo un acto aparte del propietario, fuera de este comando); la copia externa solo se exporta si el propietario aporta la clave privada (`TAI_INTEGRIDAD_CLAVE_PRIVADA_ARCHIVO`). No programa nada. Códigos de salida: 0 correcta · 1 alteración/retroceso · 2 aviso · 3 error operativo o aplazada · 4 denegada · 1 también para uso incorrecto sin ejecutar.

**Modo de pruebas sintéticas:** solo en `tests/_sintetico.mjs` (no viaja en el paquete; el código de producción no sabe de él). Crea su propio entorno bajo el directorio temporal, con marca (token, pid y ruta) y un código sintético, comprueba aislamiento físico y lógico y recorre las mismas dos etapas; fuera de ese entorno lanza y no ejecuta nada.

**Ensayo integral:** `tests/_ensayo-integral.mjs` (datos 100 % sintéticos; 15 pasos) en contenedor sin red, sin puertos, raíz de solo lectura, usuario 1000, sin capacidades, 384 MiB, 0,5 CPU y tmpfs en dos unidades. Evidencia: `informes/2026-11-18/3E8-11-ensayo-docker.json`.
Requisitos de la versión 1.1.0: ver `DIRECTOR-1.1.0-REQUISITOS.md`.

## 3E.8.12 · Paquete candidato, CLI independiente y firma de pruebas
`integridad/cli-contrato.mjs` valida el CLI instalado frente al Director (contrato `integridad-ejecucion/1`, versión mínima, entrada y hash de cada archivo) y se aplica en las dos etapas de `integridad ejecutar`; nuevo campo opcional `ejecucion.exigirManifiestoCli` (booleano) que obliga a que el CLI venga de un paquete con manifiesto. Empaquetadores: `scripts/automation/empaquetar-director.mjs` (sin cambios de formato), `empaquetar-cli-integridad.mjs` (nuevo), firma `firmar-paquete.mjs` + verificador independiente `verificar-firma-paquete.mjs` e instalador de ensayo. Detalle, hashes y limitaciones de confianza: `DIRECTOR-1.1.0-REQUISITOS.md` §10.

## 3E.8.13 · Instalación endurecida y manifiesto del CLI obligatorio
La ejecución manual exige siempre un manifiesto de CLI válido (`exigir: true` fijo); `exigirManifiestoCli` solo admite `true`. Scripts candidatos de instalación/reversión con verificación de firma (clave fijada fuera del paquete, modo producción que rechaza claves de pruebas), de estructura, de cada archivo antes y después de extraer y dentro de la imagen, copia privada, bloqueo con PID, espacio y permisos previos, y reversión que vuelve a verificar la imagen anterior: ver `DIRECTOR-1.1.0-INSTALACION.md`.

## 3E.8.14 · Política de confianza de firmas
Raíz independiente del propietario, claves de paquete autorizadas/revocadas/caducadas, registro monotónico y recuperación controlada; la instalación y la reversión exigen política válida. Ver `CONFIANZA-FIRMAS-PAQUETES.md`.
