# Matriz de permisos L0–L4 (F0) — DOCUMENTO DE DISEÑO

> **Estado (13/11/2026): F0 documental; nada implementado.** Consolida la **decisión D10 (aprobada)**: las acciones de nivel L3 y L4 exigen interfaz autenticada y confirmación de la **acción exacta**. Complementa `AGENTE-00-DIRECTOR-DISENO.md` §8. Las caducidades (15/10/5 min) están **aprobadas provisionalmente** (A-03) y la reautenticación y la sesión **aprobadas** (A-04), todas **configurables** y a revisar durante las pruebas (`AGENTE-00-F0-CIERRE.md` §4). **Ninguna decisión autoriza la ejecución autónoma de agentes.**

## 1. Principios
1. **El nivel lo fija la capacidad (registro), no la conversación.** Ni el Director, ni el modelo, ni el agente pueden bajarlo; solo se puede **subir** (más cautela).
2. **La aprobación es de una acción concreta:** está ligada a la `huella` (hash de capacidad + parámetros + entorno + versión de la capacidad). Si algo cambia, no vale.
3. **El modelo de lenguaje no autoriza nada.** El Autorizador es código determinista **fuera** del modelo; el modelo solo propone.
4. **Sin aprobaciones permanentes ni heredadas:** una aprobación no se reutiliza, no se infiere de otra y caduca.
5. **El Director no tiene permisos de acción sobre Treidilor.** Publicar, importar, cambiar catálogo o precios, gastar, activar programaciones, borrar y crear/rotar credenciales son operaciones **humanas** en el panel (L4); un agente puede **proponerlas**, nunca ejecutarlas.
6. **Parada de emergencia** siempre disponible, sin aprobación, y deja constancia.
7. **Mínimo privilegio y separación:** cada capacidad usa los alcances de **su** agente; el Director no almacena sus credenciales.

## 2. Definición de niveles
| Nivel | Nombre | Definición | Ejemplos |
|---|---|---|---|
| **L0** | Consulta | Leer información que ya existe (informes, estados, documentos, registro). Sin efecto ni consumo relevante | `04.leer-ultimo-informe`, `12.leer-historial`, preguntar por una decisión anterior |
| **L1** | Propuesta | Producir un plan, idea, borrador o propuesta **sin efecto externo**; no se aplica nada | `04.proponer-correcciones`, propuesta de mejora estratégica |
| **L2** | Ejecución de lectura con carga o coste | Lanza una tarea que **solo lee** pero consume cuota, dinero, tiempo o carga del servidor, o escribe un registro inmutable propio del agente | `04.auditar-catalogo`, `12.auditar-salud`, `03.simular-importacion` |
| **L3** | Acción de efecto reversible | Crea o modifica algo **recuperable** (borrador, copia, tarea programada pausada) con vista previa y vía de deshacer | `06.guardar-borrador-portada` |
| **L4** | Acción sensible o irreversible | Cambia lo público, el catálogo, los precios, el dinero, los accesos o lo que no se puede deshacer | Publicar, importar al catálogo, aplicar correcciones de fichas, activar programaciones, gasto, credenciales, borrar |

**Regla de asignación (de arriba abajo; gana el primero que se cumple):**
1. ¿Toca lo público, el catálogo, los precios, dinero, accesos/credenciales o no se puede deshacer? → **L4**.
2. ¿Crea o cambia algo, aunque sea recuperable? → **L3**.
3. ¿Lanza una ejecución (aunque solo lea) o consume cuota/coste/carga, o escribe su propio registro? → **L2**.
4. ¿Genera una propuesta sin efecto? → **L1**.
5. En otro caso → **L0**.
En la duda entre dos niveles, **se asigna el más alto**. El nivel de un **plan** es el máximo de sus pasos, pero cada paso se aprueba por separado.

## 3. Matriz de requisitos
| Requisito | L0 | L1 | L2 | L3 | L4 |
|---|---|---|---|---|---|
| ¿Aprobación humana? | No | No | **Sí** (confirmación) | **Sí** | **Sí, reforzada** |
| Qué se muestra antes | — | — | Resumen: qué se lanza, coste/cuota/carga, límites, plazo | L2 + **vista previa** del resultado y vía de deshacer | L3 + impacto, alcance exacto y consecuencias irreversibles |
| Canal de aprobación | — | — | **Interfaz autenticada** (voz solo solicita; ver §5) | **Interfaz autenticada** | **Interfaz autenticada** + reautenticación reciente |
| Ligada a `huella` de la acción | — | — | Sí | Sí | Sí |
| Caducidad de la aprobación (provisional, A-03) | — | — | 15 min | 10 min | 5 min |
| Reautenticación (A-04) | No | No | No | **Obligatoria si la última autenticación fue hace > 30 min** | **Obligatoria** (≤ 5 min antes de confirmar) |
| ¿Por voz? | Sí | Sí | Solo **solicitar y resumir**; confirmar en pantalla | Solo solicitar; confirmar en pantalla | **Nunca confirmar**; solo solicitar |
| ¿Por mensajería externa? | Avisos | Avisos | No | No | **Nunca** |
| ¿Evidencia verificada del resultado? | Fuente y fecha | — | **Sí** (`PROTOCOLO-AGENTES.md` §5 y §13) | Sí | Sí, **por un segundo sistema** |
| ¿Vía de deshacer? | — | — | No aplica (solo lee) | **Obligatoria** | La describe; si no existe se declara **irreversible** y se pide doble confirmación |
| Quién ejecuta | Director/agente | Director/agente | Agente (vía orquestador) | Agente, con aprobación | **Una persona en el panel** (el agente solo propone) |
| Registro en el ledger | Sí (resumido) | Sí | Sí, completo | Sí, completo | Sí, completo con antes/después |
| Reintento | Lectura sin tarea: libre dentro del volumen | Libre | **Tarea nueva** con nueva aprobación si hay efecto | Nueva aprobación | Nueva aprobación |
| Límites propios | Volumen | — | Cuota, ritmo, concurrencia, presupuesto | Idem + tope de elementos | Idem + ventanas y topes definidos por el propietario |

## 4. Reglas de aprobación
1. **Solicitud de aprobación** (`aprobacion/1`): `idAprobacion`, `idTarea`, `nivel`, `huella`, `resumen` (texto mostrado literalmente), `impacto`, `coste`, `caduca`, `canal` y `solicitadaPor` (Director). Todo se escribe en el ledger **antes** de mostrarse.
2. **Respuesta:** `aprobada | rechazada | caducada`, con `en` (instante), `por` (identidad autenticada) y `canal`. Solo el propietario autenticado puede aprobar.
3. **Coincidencia exacta:** el agente comprueba la `huella` antes de ejecutar; si no coincide → `aprobacion_no_coincide` (sin ejecución).
4. **Una aprobación = una ejecución.** Un reintento o una segunda ejecución requieren otra.
5. **Sin aprobación por silencio:** la falta de respuesta es `caducada`, nunca aprobación.
6. **Aprobación en lote:** solo si los elementos están **enumerados** en el resumen y la `huella` los incluye; si se añade uno, no vale. Para L4 se recomienda ítem a ítem o lotes pequeños con tope.
7. **Rechazo:** se registra con motivo opcional y puede alimentar la propuesta siguiente; no se reintenta solo.
8. **Revocación y parada:** el propietario puede cancelar cualquier tarea en cualquier momento; la parada de emergencia cancela lo cancelable y bloquea nuevas tareas hasta reactivarla.

9. **Reloj y renovación (A-03):** el reloj de la caducidad empieza al **mostrar** la solicitud; una tarea ya iniciada no se cancela por caducar su aprobación; en un plan, cada paso se aprueba **cuando queda listo**; la renovación admite como máximo 2 veces con contenido idéntico y **nueva reautenticación**.
10. **Registro previo (A-05):** toda solicitud de aprobación y toda delegación se registran en el ledger **antes** de mostrarse o enviarse; si el ledger falla, **no se inicia ninguna acción nueva** que requiera autorización o trazabilidad.
11. **Sin reintentos automáticos de tareas (A-07):** con incertidumbre sobre los efectos no se repite sin nueva autorización; antes de recomendar repetir, el Director comprueba el estado real.

## 5. Voz (objetivo funcional prioritario del Director)
La conversación por voz es un **objetivo funcional prioritario** (su selección tecnológica y su implementación son de F4). Para no comprometer la seguridad:
- Por voz se puede **consultar (L0), proponer (L1), solicitar** una acción y **oír el resumen** de lo que se aprobaría.
- La **confirmación** de L2, L3 y L4 se hace en la **interfaz autenticada** (pantalla). En F4a se mantiene así también para **L2**; se podrá estudiar confirmar L2 por voz **solo** tras medir la tasa de errores de reconocimiento y con una frase de confirmación que incluya el nombre de la acción y su huella corta. **Nunca** L3/L4 por voz.
- La voz **no autentica** al propietario; la sesión la autentica la interfaz.
- Todo lo dicho por voz que dispare una solicitud se escribe en el ledger con la transcripción y la confianza del reconocimiento.

## 6. Clasificación de acciones frecuentes (referencia)
| Acción | Nivel | Observaciones |
|---|---|---|
| Consultar informe, estado, decisión, documento | L0 | Con fuente y fecha |
| Resumir o comparar informes | L0 | Si se hace en lectura sobre instantáneas |
| Proponer una mejora, un plan o un texto | L1 | Marcado «propuesta» |
| Lanzar `04.auditar-catalogo` o `12.auditar-salud` | L2 | Mostrar cuota, límites y plazo |
| Simular una importación (con coste en créditos) | L2 | Mostrar coste previo |
| Guardar un borrador (portada, texto) | L3 | Reversible |
| Cambiar la configuración de un agente | L3 | Cambio de registro: versión nueva |
| **Publicar**, **activar**, programar o quitar candados | L4 | Humano en el panel |
| **Importar al catálogo**, aplicar correcciones, cambiar precios o categorías | L4 | Humano en el panel |
| **Gasto** (APIs de pago, contratación) | L4 | Humano |
| Crear, rotar o revocar credenciales o tokens | L4 | Humano; el Director **nunca** lo hace |
| Borrar datos, instantáneas o ledger | L4 | El ledger **no se borra** (§MEMORIA) |
| Parar tareas / parada de emergencia | — | Siempre permitido, sin aprobación |

## 7. Control sobre los agentes y anti-elusión
- Un agente **no puede pedir a otro** que haga lo que él no puede; el Director no puede pedir a un agente una capacidad que no tiene en el registro.
- El Director **no concede ni amplía** alcances; un `alcancesSolicitados` fuera de la capacidad se rechaza (`permiso_denegado`).
- Los **textos de datos** (informes, páginas, fichas) no cambian niveles ni disparan acciones (defensa contra inyección de instrucciones).
- Un cambio en esta matriz es un **cambio de versión** con aprobación expresa del propietario.

## 8. Pendiente de validar con uso real
> Los valores de caducidad (provisionales, A-03), reautenticación y sesión (A-04), idempotencia (A-02) y frescura (A-01) están **aprobados como iniciales y configurables**: detalle en `AGENTE-00-F0-AJUSTES-PROPUESTOS.md` y lista en `AGENTE-00-F0-CIERRE.md` §4.

Revisar durante las pruebas: caducidades (provisionales) y sesión; si L2 puede confirmarse por voz (F4); topes de lote en L4; cómo se muestra la `huella` al propietario.
