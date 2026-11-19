# Agente 00 — F1.1 a F1.4: Director de consola (implementación local)

> **Estado (14/11/2026): implementado EN LOCAL, sin commit ni push, sin desplegar.** Alcance autorizado: `automation/` y `scripts/automation/`. **Sin LLM, sin red, sin ejecución real de agentes:** las aprobaciones L2–L4 son **simuladas** y el Director solo **lee** exportaciones de las instantáneas de los Agentes 04 y 12. No toca producción, VPS, catálogo, tablas ni workflows de n8n. Continúa `AGENTE-00-F0-CIERRE.md`; no sustituye al Plan Maestro.

## 1. Qué hay y dónde
| Bloque | Archivos | Qué hace |
|---|---|---|
| **F1.1 Núcleo** | `automation/director/protocolo.mjs`, `permisos.mjs`, `frescura.mjs`, `registro.mjs`, `registro-agentes.v1.json`, `config.mjs`; esquemas `automation/schemas/informe-agente.schema.json`, `evento-ledger.schema.json` | `tai-protocolo/1` (ids ordenables, estados y transiciones, errores, validadores de sobre/respuesta/informe); matriz L0–L4 y aprobaciones (A-03/A-04); frescura (A-01); idempotencia (A-02); registro de 14 agentes y 12 capacidades, **solo lectura** y con el nivel imposible de bajar |
| **F1.2 Ledger** | `ledger.mjs`, `proyecciones.mjs` | Ledger local **de solo adición**, fuera del repositorio (D3), con cadena de huellas, ancla anti-truncado, `fsync`, comparación de secuencia, bloqueo entre procesos, filtro de secretos, recuperación de escrituras interrumpidas, copia/restauración/exportación verificadas; proyecciones de tareas y aprobaciones reconstruibles |
| **F1.3 Lectores** | `lectores.mjs`, `fixtures/{04,12}.json` (sintéticos), `fixtures/construir.mjs`, `fixtures/generar.mjs` | Lee exportaciones de `calidad_catalogo_instantaneas` / `auditor_general_instantaneas` y construye `informe-agente/1`; reutiliza `automation/lib/seguimiento.mjs` (deduplicar, comparar). Solo `readFileSync` |
| **F1.4 Consola** | `intencion.mjs`, `director.mjs`, `scripts/automation/director.mjs` | Instrucciones en texto por reglas (sin LLM) → tareas asignadas por capacidad → informes con frescura, fuente y verificación → aprobaciones simuladas |
| **Pruebas** | `automation/director/tests/*.test.mjs` (94 casos) | `node --test "automation/director/tests/*.test.mjs"` |

## 2. Cómo se usa
```
node scripts/automation/director.mjs consola
node scripts/automation/director.mjs preguntar "dame el último informe de calidad"
node scripts/automation/director.mjs agentes | tareas | tarea ver <id> | tarea crear <capacidad> [k=v]
node scripts/automation/director.mjs aprobar <idAprobacion> --simulada | rechazar <id> | cancelar <idTarea>
node scripts/automation/director.mjs parada | reanudar | reconciliar
node scripts/automation/director.mjs informe 04 [--historial|--comparar] | informe 12 --id <idEjecucion>
node scripts/automation/director.mjs ledger verificar | recuperar | copia <dir> | exportar <dir> | restaurar <origen> <destino>
```
- **Ledger:** `TAI_DIRECTOR_DIR` (por defecto `~/.treidilor-director`). **Se niega a usar un directorio dentro del repositorio.** No se versiona.
- **Instantáneas:** `TAI_DIRECTOR_INSTANTANEAS` (por defecto `automation/director/fixtures`, datos **sintéticos** con ids `fx-…`). Para datos reales basta una exportación `04.json` / `12.json` (formato `instantaneas-exportadas/1` o la lista cruda de filas de la tabla, con las columnas `entorno, host, generadoEn, idEjecucion, origen, calidad, huella, payload`). **Nunca incluir credenciales.**
- `--ahora <ISO>` fija el reloj **solo para pruebas** (avisa por stderr).

## 3. Reglas que cumple (con su prueba)
- **Registro previo:** la solicitud, la tarea y la solicitud de aprobación se escriben en el ledger **antes** de mostrarse o actuar; si el ledger falla no se inicia ninguna acción nueva (I-3).
- **Una aprobación = una ejecución:** clave `hash(huella ‖ idAprobacion)` sin tiempo (A-02); misma huella pendiente → se reutiliza la solicitud; intervalo y cuota por capacidad → `limite_alcanzado`.
- **Aprobaciones simuladas:** tras aprobar se registra `delegacion_simulada` (nunca `delegacion_enviada`), la aprobación queda `consumida` y la tarea `cancelada («simulación F1»)`. El Director **rechaza** un despachador real en F1.
- **Caducidad L2/L3/L4 = 15/10/5 min; sin respuesta = caducada, nunca aprobada; L3 reautentica si > 30 min; L4 exige autenticación ≤ 5 min; la voz y la mensajería no confirman L2–L4.**
- **Honestidad:** «no consta» antes que inventar; lo comunicado se rotula; los datos de prueba se rotulan; un informe parcial nunca es vigente; los históricos se consultan siempre; lo que no está en la instantánea (certeza, prioridad) se declara `null`.
- **Verificación independiente de lecturas L0:** una segunda lectura relee la fuente y compara la huella; si difiere, la tarea queda `parcial` («terminó, pero no consta confirmación»).
- **Datos ≠ instrucciones:** los informes nunca pasan por el intérprete; el texto del propietario con una credencial no se registra ni se repite.
- **L4 y la ejecución autónoma o programada no son tareas delegables:** se rechazan con explicación.

## 4. Significado literal de I-1, I-3 e I-4 (de `AGENTE-00-F0-CIERRE.md` §2) y cómo se refleja
- **I-1 (A-02):** «He tratado el aviso informativo de repetición reciente (10 min) y el índice de respuesta rápida de 7 días como parte de A-02 y, por tanto, como valores iniciales configurables. La clave no vence.» → Implementado el **aviso de 10 min** (configurable en `permisos.mjs`). **El índice de respuesta rápida de 7 días NO está implementado** (el ledger es pequeño y se lee entero); queda para el almacén transaccional.
- **I-3 (condición 3):** «Con el ledger caído: no se inicia ninguna acción nueva que requiera autorización o trazabilidad (L2–L4 y toda delegación); las consultas L0 pueden atenderse avisando de que no quedan registradas; las propuestas L1 pueden comentarse pero no se convierten en tareas; las tareas ya iniciadas continúan y se reconcilian al recuperarse el ledger.» → Implementado y probado (`reconciliar` marca como `expirada` lo vencido; no recomienda repetir a ciegas). Aún no hay capacidades L1 disponibles, por lo que esa parte solo está en el diseño.
- **I-4 (A-03):** «“Provisional” significa que 15/10/5 min se usan ya en el diseño y en los casos, pero se revisan con las primeras pruebas con aprobaciones (el primer uso real es F3; en F1 solo se evalúan con aprobaciones simuladas).» → Los valores son configuración congelada en código; no se cambian en caliente.

## 5. Limitaciones conocidas (honestas)
1. **Sin LLM:** la interpretación es por palabras clave; frases fuera de lo previsto devuelven «no he entendido» o piden aclaración. F1.5 la sustituye por un modelo detrás del mismo contrato (`interpretar(texto) → intención`).
2. **Ledger = archivo local:** quien tenga acceso al disco puede reescribir archivo **y** ancla a la vez; la cadena detecta cambios parciales, no un atacante con acceso total. No hay control de acceso separado ni transacciones: **almacén transaccional obligatorio antes de F3.**
3. **La instantánea guardada solo conserva** clave, código y gravedad por incidencia; certeza, prioridad y evidencia por ficha constan solo en el informe completo de n8n (no se lee en F1).
4. **Lectura sobre exportaciones:** no hay lectura en vivo de n8n (D5 en vivo, D4, D7, D12 diferidas). El registro v1 es un **borrador pendiente de revisión del propietario**.
5. **No hay planes multi-paso** (grafo de tareas): solo tareas simples, con control de profundidad y ciclos.
6. **El estado `operativo` de los Agentes 04 y 12 sigue siendo comunicado**, no verificado; el Director lo rotula así en cada respuesta.
7. **No se han ejecutado los 68 casos de la batería** (requieren el modelo de F1.5); sí se cubren sus principios de permisos, frescura, idempotencia, caducidad, registro previo y fallo del ledger con 94 pruebas propias.
8. `AGENTS.md`, `PLAN-MAESTRO.md` y los archivos `estructura*.txt` **no se han actualizado** en esta entrega para no alterar los archivos pendientes protegidos; hay que reflejar los archivos nuevos cuando se autorice el commit.

## 6. Siguiente paso concreto hacia F1.5 (cerebro con LLM)
Requiere antes las decisiones **D6** (lista cerrada del contexto enviado al proveedor y revisión RGPD/LSSI), **D2** (proveedor y dónde se procesa) y **D9** (presupuesto, tope diario y corte). Con ellas aprobadas: (1) adaptador de proveedor detrás de `interpretar()` con salida validada por esquema y como máximo **1** reintento interno sin efecto; (2) el contexto enviado se limita a la lista cerrada y se registra por referencia (`consumo` en el ledger); (3) ejecutar los 68 casos como prueba de aceptación, empezando por los 43 críticos, con aprobaciones simuladas.
