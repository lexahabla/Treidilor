# Requisitos de conformidad para agentes de Treidilor AI (F0) — DOCUMENTO DE DISEÑO

> **Estado (13/11/2026): F0 documental.** Lista que **todo agente** (existente o futuro) debe cumplir para darse de alta en el registro (`REGISTRO-AGENTES.md`). Sustituye y amplía la lista corta de `PROTOCOLO-AGENTES.md` §10. Cada requisito lleva un identificador (`C-nn`), cómo se **comprueba** y qué **evidencia** se adjunta al alta. Los Agentes 04 y 12 se evalúan abajo **sin modificarlos**.

## 1. Requisitos
**A. Identidad y registro**
| Id | Requisito | Se comprueba con |
|---|---|---|
| C-01 | Ficha de agente completa (id, nombre, estado + origen, entornos, invocación por **nombre**, credencial por **nombre**, responsable) | Revisión del registro |
| C-02 | Una ficha de capacidad por cosa que hace: modo, **nivel L0–L4** acorde con `MATRIZ-PERMISOS.md`, alcances, entrada/salida, límites, plazo, coste, efectos, verificación | Revisión + matriz |
| C-03 | Las capacidades con efecto declaran su **vía de deshacer** o se declaran irreversibles | Ficha |

**B. Permisos y seguridad**
| Id | Requisito | Se comprueba con |
|---|---|---|
| C-04 | Credencial **propia, mínima y por nombre**; jamás `TRADYLOR_API_TOKEN`; sin acceso a las credenciales de otro agente | Revisión de workflows/config |
| C-05 | Política de destinos propia (lista de hosts/rutas/métodos) y pruebas de que **no puede salir** de ella (ni redirecciones, ni salida de afiliado, ni APIs con efectos) | Pruebas automáticas |
| C-06 | Ningún secreto en repositorio, informes, ledger ni mensajes | Prueba de búsqueda de secretos |
| C-07 | El agente **valida** cada solicitud contra su ficha (alcances, parámetros, `huella` de la aprobación) y rechaza lo que no cumple | Pruebas negativas |
| C-08 | No acepta como orden nada que venga **dentro de datos** (informes, páginas, textos) | Pruebas de inyección |
| C-09 | No pide ni obtiene a otro agente nada que él mismo no podría hacer (**sin elusión**) | Revisión de diseño |
| C-10 | Sin datos de usuarios finales; los datos analíticos, solo agregados | Revisión de entradas/salidas |

**C. Comportamiento y honestidad**
| Id | Requisito | Se comprueba con |
|---|---|---|
| C-11 | **Estados terminales honestos:** `parcial`, `expirada`, `fallida` nunca se presentan como `completada`; los parciales no sustituyen la referencia anterior | Pruebas con fallos simulados |
| C-12 | «Guardado» o «ejecutado» **solo con evidencia** devuelta por el sistema (p. ej. el Insert devuelve la fila); si no, «no confirmado» | Pruebas de escritura fallida |
| C-13 | Sin datos inventados: lo que no consta se declara («no consta»), con `limitaciones` explícitas | Pruebas con datos ausentes |
| C-14 | **Idempotencia** por `claveIdempotencia` y tope de concurrencia (una tarea activa por capacidad) | Pruebas de duplicado |
| C-15 | Respeto de `plazoMs`, de sus límites de ritmo/cuota y respuesta a `cancelar` | Pruebas de tiempo y cancelación |
| C-16 | Sin reintentos ciegos; un reintento es una tarea nueva | Revisión |
| C-17 | Informe en `informe-agente/1` (o adaptador de lectura): `clave` estable por hallazgo, `completo`, `limitaciones`, evidencia **literal** del origen, tamaños acotados | Validación de esquema |

**D. Memoria y trazabilidad**
| Id | Requisito | Se comprueba con |
|---|---|---|
| C-18 | Memoria propia **inmutable** (instantáneas) si hace seguimiento; reconstruible; sin duplicar con la misma ejecución | Pruebas de persistencia |
| C-19 | Cada resultado lleva `idEjecucion`, versión del agente y de la capacidad, `generadoEn` y entorno | Validación de esquema |
| C-20 | Toda decisión relevante del agente es trazable hasta su dato de origen (`MEMORIA-LEDGER-DISENO.md` §6) | Prueba de traza |

**E. Operación y calidad**
| Id | Requisito | Se comprueba con |
|---|---|---|
| C-21 | Pruebas automáticas (unidad, seguridad, simulación de fallos y comparación simulador/real) y regresión | Suite de pruebas |
| C-22 | Workflow **generado** desde código con huella versionada (SHA-256) y comprobación de sincronía; inactivo por defecto y sin programación hasta autorización | `--check` + linter |
| C-23 | **Guía de despliegue supervisada** con pasos, autorizaciones, retirada y qué verificar | Documento |
| C-24 | Límites de coste/consumo declarados y **medidos**; sin APIs de pago ni IA sin autorización expresa | Ficha + pruebas |
| C-25 | Documentación del estado real separando **documentado / verificado / comunicado** | Documento |

## 2. Cómo se da de alta
1. El agente prepara la **evidencia** de cada `C-nn` aplicable (`N/A` solo con motivo escrito).
2. Revisión del propietario (acta en el ledger).
3. Alta en el registro con versión y fecha; estado `construido_local` o `operativo` según el despliegue.
4. Un **cambio relevante** (nueva capacidad, otro nivel, otro alcance, otro destino) reabre los puntos afectados.

## 3. Evaluación inicial de los agentes existentes (solo lectura; sin modificarlos)
Evaluación **documental** hecha sobre el repositorio; no se ha comprobado producción.

| Requisito | Agente 04 | Agente 12 |
|---|---|---|
| C-01/C-02 | Parcial: ficha de capacidad definida en `REGISTRO-AGENTES.md`; falta versionarla en el registro real | Idem |
| C-04 | Cumple (credencial propia por nombre; no usa `TRADYLOR_API_TOKEN`) | Cumple (solo GET públicos; sin credencial de API) |
| C-05 | Cumple (`urlPolicyCalidad`: un host, ruta única, GET, sin redirecciones) | Cumple (`urlPolicy` modo `publico`) |
| C-11/C-12 | Cumple (incompletas no se guardan; «guardada» solo si el Insert devuelve la fila; `pendiente` = no confirmada) | Cumple (misma lógica de persistencia 2c) |
| C-14 | Parcial: manual, sin clave de idempotencia de protocolo; basta mientras no lo lance el Director | Idem |
| C-15 | Parcial: respeta pausa y límites; **no hay cancelación por protocolo** | Idem |
| C-17 | **Parcial:** informe propio (`informe-calidad/1`, informe del Auditor) con casi todos los campos; falta el sobre `informe-agente/1` (adaptador de lectura previsto) | Idem |
| C-18/C-19 | Cumple (instantáneas inmutables con `idEjecucion` y `generadoEn`) | Cumple |
| C-21/C-22 | Cumple (pruebas y huellas; inactivo, sin programación) | Cumple |
| C-23 | Cumple (guía de despliegue) | Cumple (guía de despliegue) |
| C-25 | Cumple con salvedad: el despliegue de 04 y el estado de 12 en producción son **comunicados**, no verificados | Idem |
Los huecos (`C-14`, `C-15`, `C-17`) **no** se corrigen modificando sus workflows: se cubren con el adaptador de lectura y, en F3 y con autorización, con un workflow envoltorio.
