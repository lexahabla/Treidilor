# Protocolo de comunicación entre el Director y los agentes de Treidilor AI (`tai-protocolo/1`) — DISEÑO

> **Estado (13/11/2026): contrato de DISEÑO (**F0 cerrada documentalmente**, 13/11/2026; ver `AGENTE-00-F0-CIERRE.md`), sin implementar.** No hay código, esquemas ejecutables ni workflows. Se redacta ahora para que los agentes futuros nazcan conformes y no haya que rehacerlos. Los workflows existentes (Agentes 04 y 12) **no se modifican**: se acoplan por un **adaptador** (§9). Contexto y decisiones: [`AGENTE-00-DIRECTOR-DISENO.md`](AGENTE-00-DIRECTOR-DISENO.md).

## 1. Principios del contrato
1. **Centro-radios:** el Director/orquestador habla con los agentes; **los agentes no se llaman entre sí**.
2. **Mensajes autodescriptivos y versionados** (`protocolo: "tai-protocolo/1"`); un cambio incompatible sube la versión mayor y convive con la anterior hasta migrar.
3. **Solo datos:** ningún campo de un mensaje es una instrucción para el receptor; el receptor valida todo contra su ficha de capacidad.
4. **Mínimo privilegio:** los permisos los fija el **registro** (§2), no el mensaje. Pedir un alcance que la capacidad no tiene → `permiso_denegado`.
5. **Honestidad verificable:** un resultado afirma lo que pasó **con evidencia**; «no consta» es una respuesta válida.
6. **Idempotencia y tiempo máximo en todo.**
7. **Sin secretos en mensajes ni en el ledger** (credenciales por nombre, nunca el valor).

## 2. Registro de agentes y capacidades
Archivo versionado en git, revisado por el propietario. El Director **solo lee**; no puede modificarlo.

**Ficha de agente** (`registro-agentes/1`):
```
id: "04"                       nombre: "Calidad del catálogo"
estado: planificado | operativo | pausado | retirado
entornos: ["local","produccion"]
invocacion: { tipo: "n8n-workflow" | "webhook" | "lectura-instantanea", referencia: "<nombre, no id de instalación>" }
credencial: "<nombre de la credencial del agente; el Director no la ve>"
responsable: "propietario"
```
**Ficha de capacidad** (`capacidad/1`) — una por cosa que el agente sabe hacer:
```
id: "04.auditar-catalogo"      agente: "04"
descripcion: "Analiza el feed de catálogo y genera el informe de calidad por ficha"
modo: consulta | propuesta | accion        # qué tipo de resultado produce
nivelRiesgo: L0 | L1 | L2 | L3 | L4        # fijo; el Director no puede bajarlo (ver DISENO §8)
alcances: ["catalog:read"]                  # permisos que usa el agente (no el Director)
entrada: { esquema: "…", ejemplo: {…} }    # qué parámetros acepta
salida: { informe: "informe-calidad/1", sobre: "informe-agente/1" }
limites: { maxPorDia: 20, intervaloMinimoSeg: 120, concurrencia: 1, maxPaginas: 8 }
plazoMs: 120000                             # tiempo máximo antes de «expirada»
frescura: { vigenteHasta: "7d", actualizarHasta: "30d", invalidadoPor: ["importacion","publicacion"] }   # A-01: valores iniciales configurables; solo para capacidades que producen datos de estado
costeEstimado: { llamadasApi: 8, ia: 0 }
requiereAprobacion: true
efectos: ninguno | lectura_con_carga | escritura_reversible | irreversible
verificacion: "releer fila guardada"        # cómo se confirma el resultado (§5)
```
Ejemplos ya reales: `12.*` (salud del sistema, solo lectura pública, riesgo L0/L2 según si lanza), `04.auditar-catalogo` (L2: consume cuota de la API y carga el VPS). Estado y límites coinciden con lo documentado en `AGENTE-04-CALIDAD.md` y en la guía del Auditor.

## 3. Sobre de tarea (solicitud)
```json
{
  "protocolo": "tai-protocolo/1",
  "tipo": "solicitud",
  "idTarea": "t_01JC…",              // identificador único (ordenable), generado por el Director
  "idCorrelacion": "c_01JC…",        // agrupa todas las tareas de una petición del propietario
  "idPadre": null,                   // tarea que la originó (planes)
  "profundidad": 0,                  // máx. 2; 0 = pedida directamente
  "origen": { "actor": "director", "idSolicitud": "s_…", "propietario": true },
  "agente": "04",
  "capacidad": "04.auditar-catalogo",
  "modo": "accion",
  "ejecutor": "agente",               // "humano" en L4: el Director NO la envía; la ejecuta una persona en el panel (MATRIZ-PERMISOS §3)
  "prioridad": "P3",                 // P1 crítica · P2 alta · P3 normal · P4 baja (misma escala que el Agente 04)
  "alcancesSolicitados": ["catalog:read"],   // debe ser ⊆ alcances de la capacidad
  "aprobacion": { "nivel": "L2", "ref": "a_…", "huella": "sha256:…", "expiraEn": "2026-11-14T11:15:00Z" },
  "parametros": { "entorno": "produccion" },
  "plazoMs": 120000,
  "presupuesto": { "maxCosteEur": 0, "maxLlamadasApi": 8 },
  "claveIdempotencia": "sha256:…",   // derivada de huella + idAprobacion (regla aprobada A-02; sin hora ni ventana de tiempo)
  "creadaEn": "2026-11-14T11:00:00Z"
}
```
Reglas: `huella` es el hash de capacidad+parámetros+entorno aprobados (si algo cambia, la aprobación no vale); `claveIdempotencia` repetida devuelve la **misma tarea**, no una nueva ejecución (regla **aprobada** (A-02): `claveIdempotencia = hash(huella ‖ idAprobacion)`, ver `AGENTE-00-F0-AJUSTES-PROPUESTOS.md` §2); `profundidad > 2`, un `alcancesSolicitados` fuera de la capacidad, o una aprobación ausente/caducada/de otro nivel → rechazo antes de ejecutar.

## 4. Estados de una tarea
```
creada ──► esperando_aprobacion ──► aceptada ──► en_curso ──► completada
   │   (solo L2–L4; L0/L1 la omiten)       │             │  ├────► parcial
   │                                        │             │  └────► fallida
   └────────────────────┴───────────────────┴─────────────┴──► cancelada | expirada | rechazada
```
- **Terminales:** `completada`, `parcial`, `fallida`, `cancelada`, `expirada`, `rechazada` (aprobación rechazada o solicitud rechazada por la validación del receptor). Una terminal **no vuelve atrás**: un reintento es una tarea nueva (con nueva aprobación si tiene efecto).
- `esperando_aprobacion` es un estado **del lado del Director**: la aprobación (D10) se obtiene **antes** de enviar la tarea; lo que requiera otro efecto durante la ejecución es **otra tarea** con su propia aprobación. En L4 (`ejecutor: humano`) la tarea permanece en `esperando_aprobacion` hasta que una persona la confirma y la ejecuta en el panel.
- `parcial`: datos útiles pero incompletos (p. ej. una página del catálogo sin leer). **Nunca** se presenta como completada ni sustituye la referencia anterior (mismo criterio que el seguimiento del Auditor).
- `expirada`: no hubo respuesta en `plazoMs`. El Director dice «no consta resultado» y consulta el estado real.
- **Evento de estado** (`tipo:"estado"`): `{idTarea, estado, en, detalle?, progreso?}`; los eventos son de solo añadir.

## 5. Respuesta y confirmación de resultado
```json
{
  "protocolo": "tai-protocolo/1",
  "tipo": "respuesta",
  "idTarea": "t_01JC…",
  "estado": "completada",
  "iniciadaEn": "…", "terminadaEn": "…",
  "informe": { "…": "informe-agente/1 (§6)" },
  "efectos": { "declarados": ["escritura:calidad_catalogo_instantaneas"], "evidencia": [ { "tipo": "fila", "tabla": "calidad_catalogo_instantaneas", "id": 42 } ] },
  "consumo": { "llamadasApi": 2, "ia": 0, "duracionMs": 8300 },
  "error": null
}
```
**Cuándo el Director dice «ejecutada»:** solo si (1) `estado = completada`, (2) `efectos.evidencia` no está vacía **o** la capacidad es de modo consulta sin efectos, y (3) la **verificación independiente** definida en la ficha (`verificacion`) confirma la evidencia (p. ej. releer la fila). Si falta cualquiera: «terminó, pero **no consta confirmación**» (equivale al `pendiente` del Agente 04).

## 6. Informe normalizado (`informe-agente/1`)
Sobre común que **envuelve** el informe propio de cada agente (que conserva su esquema, p. ej. `informe-calidad/1`, `informe-auditor`) para que el Director lea cualquiera de la misma manera:
```
esquema: "informe-agente/1"
agente: "04"   capacidad: "04.auditar-catalogo"   version: "<versión del agente>"
entorno: "produccion"
idEjecucion: "ex-16"          # id propio del agente; trazable
generadoEn: ISO-8601          # momento de captura de los datos (no de la lectura del informe)
completo: true|false          # false = parcial; nunca sustituye la referencia
fuente: { sistema, host, paginasLeidas, registrosLeidos, firma? }
resumen: {
  porCerteza: { confirmado, advertencia, no_verificable },
  porPrioridad: { P1, P2, P3, P4 },
  elementosAfectados, elementosTotales
}
hallazgos: [ { clave /*estable entre ejecuciones*/, regla, certeza, prioridad, elemento, evidencia /*dato literal del origen*/, accionSugerida } ]   # acotado en número/tamaño
seguimiento: { modo: "linea_base|comparado|indeterminado", nuevas, persistentes, resueltas, reaparecidas, noVerificadas }
persistencia: { escritura: "no_procede|pendiente|guardada|fallida", idFila? }
limitaciones: [ "texto: qué no se pudo verificar" ]
honestidad: { datosAusentesDeclarados: true }
```
Reglas: cada `hallazgo.evidencia` es **un dato del origen**, no una conclusión del modelo; la `clave` es estable (permite seguimiento); `limitaciones` obligatorio (puede ser vacío, pero presente); los textos libres no contienen instrucciones ni secretos; tamaño máximo por informe y por hallazgo definido en la ficha. **Compatibilidad con lo existente:** los informes del Agente 04 (`informe-calidad/1`: `entorno`, `generadoEn`, `completo`, `fuente`, `seguimiento`, `persistencia`) y del Auditor ya contienen casi todos esos campos; el sobre se construye con un **adaptador de lectura** (§9), sin cambiar sus workflows.

## 7. Errores
Todo error es un objeto `{ codigo, mensaje, reintentable, detalle? }` (sin secretos, sin trazas internas). Catálogo mínimo:

| Código | Significa | ¿Reintentable? |
|---|---|---|
| `solicitud_invalida` | No cumple el esquema | No (corregir) |
| `capacidad_desconocida` / `agente_no_operativo` | No existe en el registro o está pausado/planificado | No |
| `permiso_denegado` | Alcance fuera de la capacidad | No |
| `aprobacion_requerida` / `aprobacion_caducada` / `aprobacion_no_coincide` | Falta, venció o la huella no coincide | Tras nueva aprobación |
| `limite_alcanzado` | Cuota/ritmo/presupuesto/concurrencia | Tras la espera indicada (`reintentarDespuesDeSeg`) |
| `duplicada` | Misma `claveIdempotencia` | No (devuelve la tarea original) |
| `profundidad_excedida` / `ciclo_detectado` | Plan hostil o erróneo | No |
| `origen_no_disponible` | Dependencia caída (API, tabla) | Una vez, con pausa |
| `tiempo_agotado` | Pasó `plazoMs` | Nueva tarea |
| `resultado_no_confirmado` | Terminó pero la verificación falló | No ciego: investigar |
| `cancelada_por_usuario` / `parada_emergencia` | Cancelación | No |
| `interno` | Fallo no clasificado | Una vez, con pausa |
Política (A-07): **sin reintentos automáticos de tareas**. Ante un fallo o una pérdida de comunicación, el Director **comprueba primero el estado real** (lectura del sistema o de la instantánea guardada) y solo después **recomienda** repetir; con **incertidumbre sobre los efectos** no se repite sin nueva autorización. Todo reintento es una **tarea nueva** con su aprobación y su clave (A-02) y se registra en el ledger **antes** de ejecutarse. Solo se admiten reintentos internos **sin efecto**: máximo 1 de una salida del modelo no válida o de una lectura L0.

## 8. Coordinación: prioridades, concurrencia, cancelación, planes
- **Prioridad** `P1–P4`: ordena la cola; `P1` no salta aprobaciones ni límites.
- **Concurrencia:** una tarea activa por capacidad; global acotado por el límite de carga del VPS.
- **Cancelación:** `{tipo:"cancelar", idTarea, motivo}`; el agente debe parar en cuanto pueda y responder `cancelada`; si no puede revertir un efecto ya hecho, lo declara en `efectos`. Parada de emergencia = cancelar todo lo cancelable y bloquear nuevas.
- **Planes (varios pasos):** el plan es un **grafo acíclico** `{pasos:[{idTarea, depende:[…], condicion?}]}` validado antes de ejecutar (sin ciclos, `profundidad` ≤ 2, presupuesto total ≤ tope, aprobación por paso con efecto; la aprobación de cada paso se solicita **cuando ese paso queda listo**, nunca por adelantado). Un paso solo arranca con sus dependencias en `completada` verificada; si una falla, los dependientes quedan `cancelada` con motivo y el Director informa.
- **Entre agentes:** cuando B necesita lo de A, el **Director** lee el informe de A (lectura) y se lo pasa a B como **dato en `parametros`**, nunca como orden; B no accede a las credenciales ni a los permisos de A.
- **Mensajes del Director al propietario:** cada mensaje lleva categoría (consulta/propuesta/pendiente/ejecutada) y la fuente de cada afirmación (DISENO §1 y §6).

## 9. Cómo se acoplan los agentes existentes sin modificarlos
- **Lectura (F1):** un **adaptador de solo lectura** lee las tablas de instantáneas inmutables (`calidad_catalogo_instantaneas`, `auditor_general_instantaneas`) y construye `informe-agente/1`. No ejecuta nada ni cambia los workflows. Requiere decidir el camino de lectura (D5).
- **Ejecución (F3):** los workflows de producción de ambos agentes tienen hoy **solo disparador manual** y el linter lo exige. Para que el Director los lance habría que crear un **workflow envoltorio nuevo** (con su propia aprobación y límites) que invoque al original y devuelva `respuesta`. Eso es una decisión aparte y requiere autorización expresa; no se hace en esta fase.
- **Mientras tanto** las auditorías las sigue lanzando el propietario a mano; el Director solo las **lee**.

## 10. Lista de conformidad para cualquier agente nuevo
**La lista completa, con identificadores `C-01…C-25` y cómo se comprueba cada punto, está en [`CONFORMIDAD-AGENTES.md`](CONFORMIDAD-AGENTES.md).** Resumen:
Un agente no se puede dar de alta en el registro sin cumplir:
1. Ficha de agente y fichas de capacidad completas, con nivel de riesgo, alcances, límites, plazo, verificación y efectos declarados.
2. Informe en `informe-agente/1` (o adaptador de lectura equivalente) con `clave` estable, `completo`, `limitaciones` y evidencia literal.
3. Credencial **propia**, mínima y por nombre; ningún uso de `TRADYLOR_API_TOKEN`; ningún acceso a las credenciales de otro agente.
4. Respeto de sus límites y del `plazoMs`; respuesta a `cancelar`; idempotencia.
5. Política de URLs/destinos propia (como `urlPolicy` y `urlPolicyCalidad`) y pruebas de seguridad (no sale de su destino, no tiene efectos no declarados).
6. Memoria propia inmutable (instantáneas) si hace seguimiento; «guardada» solo con confirmación.
7. Estados terminales honestos (`parcial`/`expirada` nunca como `completada`).
8. Documentación y huella del workflow versionadas; despliegue por la guía supervisada.
9. Ningún agente puede pedir a otro que haga algo que él mismo no puede (sin elusión de restricciones).

## 11. Versionado y evolución
- `tai-protocolo/1`: campos obligatorios estables; los campos nuevos son **opcionales** y los receptores ignoran los desconocidos.
- Cambio incompatible → `tai-protocolo/2` con periodo de convivencia y adaptadores; nunca editar `1` retroactivamente.
- Las fichas de capacidad llevan versión; el Director registra en el ledger con qué versión se hizo cada tarea.

## 12. Pendiente (no definido todavía)
- Transporte concreto (ejecución de workflow de n8n, webhook firmado o API de n8n) y autenticación entre Director y orquestador: depende de D4/D5/D12 y de inspeccionar el n8n de producción.
- Esquemas JSON ejecutables: se derivarán de este documento tras autorización (hoy solo existen `informe-auditor`, `informe-investigador`, `informe-calidad`, `estado-auditor`, `seguimiento-auditor`).
- Formato exacto del ledger: **definido como modelo lógico** en `MEMORIA-LEDGER-DISENO.md` (la tecnología de almacenamiento sigue pendiente, D3).

## 13. Evidencias y verificación (`evidencia/1`, `verificacion/1`)
Una **evidencia** es un dato del sistema que prueba que algo ocurrió; **no es una afirmación del agente ni del modelo**.
```
evidencia/1: { idEvidencia, idTarea, tipo, referencia, hash?, capturadaEn, origen /*sistema que la produjo*/ }
  tipo: fila_guardada | respuesta_http | metrica | informe | archivo_hash | ack_sistema | captura_humana
  referencia: nombre de tabla/ruta + id (nunca valores secretos ni contenidos completos); hash = sha256 del contenido canónico cuando aplique
verificacion/1: { idEvidencia, metodo, resultado, en, por }
  metodo: releer_fila | releer_endpoint | comparar_hash | ack_sistema | revision_humana
  resultado: confirmada | no_confirmada | no_verificable
```
Reglas:
1. **Verificación independiente:** la verifica un camino distinto del que produjo la evidencia (p. ej. el Director relee la fila guardada, no se fía del mensaje del agente).
2. Solo `confirmada` permite decir «ejecutada». `no_confirmada` → «terminó, pero no consta confirmación» (el `pendiente` del Agente 04). `no_verificable` → se declara y se cita como tal.
3. Una evidencia **no se reutiliza** para otra tarea ni se edita; una nueva verificación es un evento nuevo.
4. Las capacidades de nivel L2–L4 **declaran** en su ficha qué evidencia producen y cómo se verifica; sin eso no se dan de alta (C-12).
5. En capacidades de solo consulta (L0), la «evidencia» es la **fuente con su fecha** (`generadoEn`, `idEjecucion`).
**Ejemplo real (Agente 04):** evidencia `fila_guardada` (tabla `calidad_catalogo_instantaneas`, id numérico, `idEjecucion` propio) → verificación `releer_fila` → `confirmada`.

## 14. Trazabilidad
Toda tarea y todo mensaje del Director enlazan la **cadena completa**:
`solicitud → intención → plan → aprobación → tarea → delegación → respuesta → evidencia → verificación → mensaje al propietario`.
- Cada eslabón lleva su identificador (`idSolicitud`, `idIntencion`, `idPlan`, `idAprobacion`, `idTarea`, `idEvidencia`) y el `idCorrelacion` común; cada mensaje y respuesta indica con qué **versión** de capacidad, registro y prompt se produjo.
- Cada afirmación factual de un mensaje referencia su procedencia (`[doc…]`, `[registro…]`, `[en vivo…]`, `[histórico…]`, `[decisión…]`, `[comunicado…]`).
- Una traza **incompleta** se declara («la fuente no consta»); nunca se rellena.
- El registro (ledger) de estos eslabones y sus garantías están en `MEMORIA-LEDGER-DISENO.md` §4 y §6. Las preguntas que la traza debe poder contestar son un criterio de aceptación de F1.
