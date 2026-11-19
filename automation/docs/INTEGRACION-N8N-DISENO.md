# Integración del Director con n8n — arquitectura recomendada y primer circuito (15/11/2026)

> Estado: **DISEÑO. Nada desplegado ni creado en n8n.** Parte de lo ya aprobado en `AGENTE-00-DIRECTOR-DISENO.md` («n8n para ejecutar agentes; el cerebro del Director como servicio aparte con su propio ledger») y en `PROTOCOLO-AGENTES.md` §9 (lectura primero; ejecutar solo en F3). No es un plan maestro: fija una arquitectura, un primer circuito y las decisiones para empezar.
> Lo que NO está verificado (hay que comprobarlo en la inspección de solo lectura antes de construir): que el n8n de producción admita nodos Webhook (`NODES_EXCLUDE`), el nombre/puerto internos del n8n y la red Docker que comparte con el resto de servicios.

## 1. Opciones comparadas
| Opción | Cómo | A favor | En contra |
|---|---|---|---|
| **A. Exportaciones a archivos** (hoy) | El propietario exporta las tablas y el Director las lee | Ya funciona; sin red | Manual; no hay coordinación ni «estado en vivo» |
| **B. Director como servicio interno + webhooks firmados con n8n** | El Director llama a webhooks de n8n (y n8n le devuelve el resultado); ambos en la red interna | Respeta lo aprobado; n8n sigue ejecutando lo que toca red/tablas; el Director conserva cerebro, permisos, aprobaciones y ledger; sin puertos públicos | Obliga a ampliar el comprobador de workflows (hoy solo admite disparador manual) y a construir el puente |
| **C. Director dentro de n8n** (nodos Code) | La lógica del Director incrustada en workflows | Un solo sistema | El ledger y las aprobaciones tienen estado y ficheros; el nodo Code ya está al límite de tamaño (Informe ≈ 69 kB de 80 kB); mezcla permisos con ejecución |
| **D. Bus por base de datos** (tabla de tareas que n8n consulta) | El Director escribe tareas y n8n las recoge por programación | Máximo aislamiento; sin puertos de entrada en n8n | Necesita disparadores programados (F7, no autorizada), latencia y más piezas |

**Recomendación: B**, con A como alternativa de pruebas y D descartada por ahora (se revisa si no se autoriza ningún webhook en producción).

## 2. Arquitectura recomendada (B)
```
Propietario ─texto→ [Agente 13: Canal13] ─→ [Agente 00: Director] ─→ capacidades puras (02,03,05,06,07,08,09,10,11, 01)   (dentro del Director)
                                                 │  ledger propio (volumen del servicio)
                                                 └─ sobre tai-protocolo/1 firmado ─→ [n8n: workflows de agentes y compartidos] ─→ Data Tables / API de solo lectura
                                                                         ◀─ respuesta (informe-agente/1 + evidencia) ─┘
```
- **Servicio `tai-puente`** (el Director + el canal 13 con una cáscara HTTP mínima, JSON, `tai-protocolo/1`): contenedor propio, red interna con n8n, **sin puerto publicado**; volumen propio para el ledger y su copia de seguridad. Dos caras: conversación (`POST /tai/v1/mensajes`, solo propietario autenticado) y agentes (`POST /tai/v1/respuestas`, solo n8n).
- **Director → n8n:** llamadas a webhooks de producción con tres defensas: credencial de cabecera de n8n (por nombre), **firma HMAC** del cuerpo con marca de tiempo (ventana de 5 min, anti-repetición) y `claveIdempotencia` (una misma clave devuelve la misma tarea). Solo se envían L0 y, tras aprobación, L2+; **nunca** L4.
- **n8n → Director:** solo la devolución de resultados. Las programaciones (cron) siguen sin autorizar (F7).
- **Autenticación:** patrón que ya existe en la API de automatización (`tai_<id>_<secreto>`, solo se guarda el hash, alcance único, caducidad ≤ 90 días, revocación, auditoría). **No** se usa `TRADYLOR_API_TOKEN` ni credenciales de otros.
- **Aprobaciones:** siguen en el Director y en la interfaz autenticada; n8n recibe la referencia y la huella aprobadas, pero no decide nada.
- **Los agentes puros no necesitan n8n:** el 13 y los que ya son lógica pura (02, 03, 05, 06, 07, 08, 09, 10, 11, y el 01 cuando se integre) corren dentro del Director con datos por parámetro. n8n entra para **leer o escribir tablas, llamar a la API de solo lectura del catálogo y, más adelante, programar**.

## 3. Quién necesita workflow
| Agente | Workflow propio | Compartido | Nada de n8n (por ahora) |
|---|---|---|---|
| 04 Calidad | **Existe** (`calidad-catalogo.produccion.json` + creación de tabla) | lector | |
| 12 Auditor | **Existe** (`auditor-general.produccion.json` + creación de tabla) | lector | |
| 01 Investigador | Existe solo el **local**; faltaría variante de producción + tabla (si se ejecuta en n8n) | lector | Integrable en local sin n8n |
| 02, 03, 05, 06, 07, 08, 09, 10, 11 | | exportador de datos reales (más adelante) | Sí: lógica pura en el Director |
| 00 Director, 13 Interlocutor | | | Sí: son el servicio |

**Workflows nuevos necesarios (ninguno se crea ahora):**
1. **Lector de instantáneas (solo lectura), compartido por 04, 12 y más adelante 01**: entrada `{agente, modo: ultimo|historial|id}`, lee la Data Table por nombre y devuelve la fila; sin escritura. *Es el primero y el único del primer circuito.*
2. **Estado de n8n** (opcional): salud para el «estado en vivo».
3. **Exportador de datos** compartido (catálogo por la API 2.2 de solo lectura, analítica agregada, observaciones): cuando haya datos reales para los agentes puros.
4. **Envoltorios de lanzamiento** (04, 12, 01) y **programador**: solo con F3 y F7 autorizadas. Los workflows actuales solo tienen disparador manual, de modo que un envoltorio exige añadirles un disparador de «ejecutar otro workflow» o duplicarlos; ambas cosas requieren autorización expresa (no se hace).

**Reutilización de 04 y 12:** no se modifican ni sus identificadores, ni sus credenciales, ni sus tablas (`calidad_catalogo_instantaneas`, `auditor_general_instantaneas`), ni su historial. El lector los lee tal cual.

## 4. Cómo circulan tareas, informes, autorizaciones y resultados (`tai-protocolo/1`)
- **Tarea:** el Director crea el sobre (`tipo: solicitud`; `idTarea`, `idCorrelacion`, `capacidad`, `parametros`, `plazoMs`, `claveIdempotencia`, `aprobacion` si procede) y lo registra en el ledger **antes** de enviarlo. Hoy `DespachadorSimulado` no envía nada: el despachador real sería lo nuevo.
- **Resultado:** `tipo: respuesta` con `estado`, `informe` (`informe-agente/1`), `efectos.evidencia` (p. ej. `{tipo:'fila', tabla, id}`), `consumo` y `error` (códigos de §7). El adaptador que convierte la fila de la tabla en `informe-agente/1` **ya existe** en el Director (`aInformeAgente`).
- **«Ejecutada»:** solo con `completada` + evidencia + **segunda lectura independiente** que coincida en huella (el mecanismo actual de `_consulta`, con el lector de n8n en lugar del de archivos).
- **Autorizaciones:** nacen y se resuelven en el Director; por texto o voz no se confirma L2–L4. Hacia n8n solo viaja la referencia y la huella.
- **Fallos:** `origen_no_disponible`, `tiempo_agotado`, `resultado_no_confirmado`, `duplicada`… con los mismos códigos; sin reintentos ciegos; la parada de emergencia cancela y bloquea los envíos.

## 5. Primer circuito mínimo (sin escrituras reales)
**Agente 13 → Agente 00 → lectura del último informe del Auditor (12) → Agente 13**, p. ej. «¿cómo está el sitio?».
1. `Canal13.recibir(texto)` en el servicio (entrada por consola/HTTP local autenticado).
2. El Director interpreta (reglas; cerebro simulado) y crea la tarea `12.leer-ultimo-informe` (L0, ya en el registro) registrándola en el ledger.
3. **Lector de n8n** (en lugar del lector de archivos): `POST` firmado al webhook del lector compartido; n8n lee la última fila de `auditor_general_instantaneas` y la devuelve.
4. El Director la convierte con el adaptador existente, hace la segunda lectura, compara huellas y escribe evidencia y verificación.
5. El 13 presenta la respuesta (naturaleza de los datos, frescura A-01, limitaciones).
- **Única escritura:** el ledger del propio Director (su traza de auditoría). No se toca ninguna tabla, ficha, precio, web ni workflow existente.
- **Qué hay que construir:** la cáscara HTTP del servicio; el cliente `LectorN8n` (misma interfaz que `LectorInstantaneas`); el firmado HMAC; **un** workflow (el lector); y una prueba de extremo a extremo.
- **Cómo se prueba:** primero contra el **n8n de pruebas aislado** (`tai-prueba-dt`, con Data Table sembrada con filas sintéticas); solo después, contra producción en solo lectura.
- **Segundo circuito (mismo workflow, otro parámetro):** `04.leer-ultimo-informe`.

## 6. Decisiones imprescindibles antes de construirlo
Ver la lista final de la entrega: dónde corre el servicio y su ledger, autorización para crear el lector y para ampliar el comprobador de workflows (archivos protegidos), patrón de autenticación del puente, vía de lectura D5, interfaz del propietario del primer circuito y respaldo del código nuevo.

## 7. Estabilidad (E-1) como requisito
Antes de cualquier delegación real en producción: ejecutar en **Linux** (contenedor del servicio, Node 22) la prueba de concurrencia del ledger y la suite del Director, con carga y repeticiones suficientes, y registrar el resultado en `PENDIENTES-ESTABILIDAD.md`. La mitigación de `EPERM` es específica de Windows y no sustituye esa validación. El primer circuito (solo lectura) puede probarse antes en local.

## 8. Respaldo del código nuevo (no está en el manifiesto de los 467)
Medido hoy: **151 archivos** fuera del manifiesto original (Director y agentes: 85 entre núcleo, agentes y pruebas, documentación 15, esquemas 2, `README` de workflows, la consola, `.gitignore` y 46 informes copiados a `INFORMES/`). Estrategia en tres capas, de menos a más compromiso:
1. **Manifiesto SHA-256 del código nuevo** (ya generado, solo lectura): `D:\AXEL\WEBS\TRADYLOR\respaldo-director-2026-11-15\MANIFIESTO-SHA256.txt`, con categoría por archivo. Permite comprobar integridad y detectar cambios.
2. **Copia local verificada** fuera del repositorio (como la del 14/11): mismo formato (`archivos/` + manifiesto + parche de los modificados). Pendiente de tu autorización.
3. **Control de versiones en una rama aparte**, **sin push y sin tocar `main`**: un push a `main` despliega y, aunque `automation/` no entra en la imagen, `scripts/` sí cuenta en el `sourceHash`. Un commit local en una rama dedicada protege el historial; publicarla en el remoto (repositorio privado) es otra decisión.
Hasta que decidas, el código nuevo sigue **sin versionar**: es el mayor riesgo de pérdida actual.

## 9. Bloqueos concretos conocidos
- El comprobador de workflows (`lint-workflows.mjs`) y el constructor (`build-workflows.mjs`), ambos protegidos, solo admiten disparador manual (y programación desactivada): un workflow con Webhook exige ampliarlos. Es la misma barrera que bloquea reorganizar `automation/workflows/` por agente.
- Hay que confirmar en n8n real que los webhooks no están excluidos y cuál es la dirección interna.
- La API de automatización está desactivada en producción (necesaria solo para el 01 y para el exportador de catálogo).
