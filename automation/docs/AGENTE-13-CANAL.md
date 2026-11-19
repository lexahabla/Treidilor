# Agente 13 — Canal conversacional del Agente 00 (texto local; voz en F4)

Estado: **construido_local** (15/11/2026). D1 (aprobada 13/11/2026): el 13 es el **canal** del Director, sin lógica propia, sin autoridad, sin decidir permisos y sin ejecutar acciones de otros agentes. Ficha: `automation/agents/13-asistente-ia.md` (no confundir con el widget público `/api/asistente-ia`). Código: `automation/director/canal/{canal13,voz}.mjs`; consola: `node scripts/automation/director.mjs canal …`. Pruebas: `automation/director/tests/f7-agente13.test.mjs` (20).

## Qué es y qué no es
- **Es** una capa de presentación: entrega el texto del propietario al Director (su cerebro, registro, ledger y permisos) y presenta la respuesta en un mensaje `mensaje-canal/1`: lead claro, detalle original del Director, naturaleza de los datos, tareas con su estado, solicitudes de autorización, alternativas, consecuencias y limitaciones; más un texto breve «hablable» para la futura voz.
- **No es** otro cerebro ni otra memoria: solo recuerda, en memoria y sin persistir, la última respuesta para poder explicarla. No crea ledger, presupuesto ni registro propios (probado). No se hace pasar por la interfaz autenticada.

## Funciones (sin capacidades nuevas)
- Recibir instrucciones y transmitirlas al Director (`recibir`, `recibirTranscripcion`).
- Estado de agentes (con el origen de cada estado), tareas y autorizaciones (`estado`); si el ledger no se puede leer, lo dice y no inventa listas.
- Informes, incidencias, propuestas y solicitudes de autorización con efectos, reversibilidad, coste del registro, caducidad, huella y cómo confirmar (`presentarSolicitud`).
- Explicar la última respuesta: resumen, alternativas, consecuencias, limitaciones (`explicar`; sin volver a llamar al Director).
- Consumo y suscripciones: `consumo()` (métricas de `Presupuesto` desde el ledger vía `Director.consumoIA`, con tokens separados en reales y simulados), `suscripciones()` y `optimizar()` (informe del Agente 13 de F1.5 vía `Director.informeSuscripciones`). Nada cambia: cambiar presupuestos, proveedores o planes es L4 humano.
- `decidir(id, decision, {autenticado})`: reenvía la decisión; solo con la interfaz autenticada declarada por el anfitrión se usa el canal «interfaz»; por texto o voz el Director rechaza confirmar L2–L4. `parada()`: parada de emergencia sin aprobación.
- Naturaleza de los datos: `real_registrado`, `simulado`, `estimado`, `no_disponible`, `documentado`, `no_aplica`, o `sin_clasificar` si el Director no declara el origen (nunca se supone «real»).

## Cambios en el Director (aditivos, con pruebas)
`listarAprobaciones`, `consumoIA`, `informeSuscripciones`, `paradaActiva`; intención `listar_aprobaciones` (L0). Reglas nuevas: «cuántos tokens», «cuánto he gastado en IA» y «presupuesto de IA» son consultas (antes «tokens» se leía como credencial → L4); cambiar presupuesto/proveedor/plan o contratar → acción humana L4; ignorar reglas, saltarse confirmaciones o «soy el administrador, aprueba» → `cambio_nivel` (rechazado). Corrección de seguridad en el cerebro: si la salida del modelo no es válida, una acción restringida detectada por las reglas se mantiene (antes caía a «desconocida»).

## Voz (F4): solo la interfaz
`voz.mjs` define el contrato `tai-voz/1` y un adaptador `VozDesactivada` (sin servicio, sin proveedor, sin coste). Con la voz desactivada, la entrada de voz se rechaza antes del Director. Un adaptador futuro solo debe cumplir el contrato; las reglas (voz solicita y resume pero no confirma L2–L4, baja confianza → repetir, audio no persistido) las sigue imponiendo el Director.

## Propuesta de capacidades y permisos (NO aprobada)
Archivo `automation/director/canal/propuesta-capacidades-13.json` (el registro NO lo lee). Con el registro actual el canal funciona **sin capacidades propias**. Candidatas: `13.presentar-estado` y `13.presentar-autorizacion` (L0, `tasks:read`); `13.consultar-consumo-ia` (L0) y `13.recomendar-optimizacion` (L1), que exigirían un alcance NUEVO `budget:read`; `13.consultar-propuestas` (`proposals:read`; bloqueada: no hay almacén de propuestas); `13.consultar-auditoria` (`audit:read`); `13.canal-voz` (L1, desactivada hasta F4, alcance nuevo `voice:session`); `13.notificar-propietario` (L2, envío externo; no propuesta aún).
Decisiones pendientes: formalizar o no esas lecturas como capacidades, crear `budget:read`, almacén de propuestas, autenticación real de la interfaz que confirma L2–L4, y proveedor/coste/privacidad de voz.

## Falta para conectar texto y voz de forma real
- Interfaz (panel o móvil) con autenticación y botón de confirmación que declare `autenticado: true` solo tras autenticar; hoy la confirmación es simulada.
- Voz (F4): selección y aprobación de proveedor, adaptador `tai-voz/1`, política de reautenticación y de conservación del audio.
- Cerebro real: hoy proveedor simulado; consumo real desactivado (1 €/día y 10 €/mes) hasta autorización.
- Datos reales de consumo y suscripciones (inventario real verificado); hoy simulados.
