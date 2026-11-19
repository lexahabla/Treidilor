# Agente 02 — Investigador de programas de afiliación (implementación local, datos SIMULADOS)

> **Estado (14/11/2026): construido EN LOCAL, sin commit, sin red, sin gasto, sin workflows nuevos.** Sigue la ficha aprobada `automation/agents/02-investigador-afiliacion.md` (riesgo bajo, solo informes/propuestas L1, etapa 2.5) y el registro `REGISTRO-AGENTES.md`. **Aclaración:** «Automatizaciones y Autorizaciones» no es un agente del diseño aprobado; la autorización (matriz L0–L4, aprobaciones, idempotencia) ya es código determinista del Agente 00 y se **reutiliza sin duplicarla**. Decisión del propietario: construir el 02 del diseño.

## 1. Qué estaba construido antes
Solo la ficha (`planificado`, sin código). Existían, y se reutilizan tal cual: protocolo `tai-protocolo/1`, registro de capacidades, matriz L0–L4, ledger de solo adición, tareas con evidencia y verificación independiente, frescura A-01, parada de emergencia, filtro de secretos, detección de instrucciones en datos y el modelo de **procedencia de datos** (`verificado`/`estimado`/`no_disponible`) de la gestión de suscripciones.

## 2. Qué se ha construido (todo en `automation/director/`)
| Pieza | Archivo | Función |
|---|---|---|
| Lógica del agente (PURA) | `agentes/afiliacion/afiliacion.mjs` | Valida los datos; `compararProgramas` y `estudiarPrograma` devuelven el informe normalizado `informe-agente/1` |
| Datos | `agentes/afiliacion/programas.simulado.json` | 9 programas/redes (Amazon, AliExpress, eBay, Awin, CJ, Admitad, Tradedoubler, Kwanko, Etsy) con datos **FICTICIOS** y procedencia por dato |
| Registro | `registro-agentes.v1.json` | 02 → `construido_local`; capacidades `02.comparar-programas` y `02.estudiar-programa-afiliacion` (**L1, propuesta, sin efectos, sin alcances**); nueva disponibilidad `propuesta_f1` |
| Director | `director.mjs` (`ejecutarPropuesta`, `_respAfiliacion`) | Tarea L1 registrada en el ledger con evidencia y **verificación por recálculo independiente**; sin aprobaciones ni delegaciones |
| Intención | `intencion.mjs` + esquema del cerebro | `estudiar_afiliacion`/`comparar_afiliacion` (L1); «regístrame / date de alta / afíliate» → **L4 humano**; «programas de afiliación» ya no se confunde con «programar» |

## 3. Cumplimiento de la ficha y de las reglas
- **«Toda cifra de comisión lleva fuente y fecha; sin datos → “no consta”.»** Las cifras sin fecha se declaran («SIN FECHA: tómalas como orientativas»); lo que falta figura como `dato_ausente` y **no entra en el ranking**; nunca se inventa una comisión, cookie o condición.
- **Criterio explícito y limitado:** el ranking ordena por la comisión **declarada** (desempate por cookie); **no** incluye conversión, ticket medio ni fiabilidad del pago (no constan) y lo dice.
- **Solo propuestas:** darse de alta, integrar un conector o cambiar la configuración de Treidilor es **L4 humano**; el agente no tiene ninguna operación para ello (comprobado por prueba).
- **Seguridad:** los datos no admiten credenciales ni identificadores de afiliado (`publisherId`, `tracking_id`…); un texto con forma de orden dentro de los datos se cita, se avisa («contenido anómalo») y no dispara nada.
- **Honestidad del informe:** `completo=false` si faltan datos básicos; frescura de los datos (vigente ≤ 90 d, a actualizar ≤ 180 d; valores iniciales configurables en la ficha de capacidad).
- **Reutilización:** no hay workflow, ni sistema de tareas, aprobaciones, ledger o registro nuevos. Los Agentes 04 y 12 y sus workflows **no se han tocado** (`build-workflows --check` sin cambios).

## 4. Pruebas locales
`node --test "automation/director/tests/*.test.mjs"` → **145 pruebas** (F1.1–F1.5: 129; Agente 02: 16). La batería de 68 casos del Agente 00 sigue **sin fallos** (EV-35 se evalúa con el registro FX-REG de la batería, donde el 02 está `planificado`, como describe el caso). Pruebas existentes de automatización en verde.
Uso: `node scripts/automation/director.mjs preguntar "Compara los programas de afiliación de informática"` · `… "Estudia Awin"` · `… "Regístrame en Awin"` (rechazado: L4).

## 5. Qué queda pendiente
- **Datos reales:** sustituir los datos simulados por datos con fuente y fecha reales. Son **revisión humana de la documentación pública** de cada red (el agente no navega ni consulta APIs: sin red, sin gasto). Qué datos y con qué frecuencia es una decisión tuya.
- **Fuentes externas automáticas** (documentación pública de las redes): requieren la etapa 2.5, `research:write` (alcance **previsto, no existente**) y una política de URLs propia (como `urlPolicy`); **no autorizado**.
- **Datos de comisión ya configurados en Treidilor** (entrada de la ficha): no se leen todavía (no hay API/exportación para ello); decisión pendiente de la vía de lectura (D5).
- **Medición de la ficha** («programas evaluados; decisiones tomadas»): requiere memoria de decisiones (F2).
- **Integración en producción** del Agente 00 y de este agente: fases posteriores (no operativo).

## 6. Siguiente paso
Pasar al siguiente agente del equipo con el mismo patrón (datos locales/simulados, capacidades L0/L1 en el registro, tarea registrada con verificación, pruebas). Los candidatos independientes de decisiones pendientes son el **03 Importador** (solo simulación L2, la importación es L4 humana) y el **05 Analista de precios** (riesgo alto: solo observaciones verificadas); elige el orden.
