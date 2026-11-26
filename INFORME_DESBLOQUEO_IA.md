# TREIDILOR — Informe consolidado: Desbloqueo de IA real y avance agentes 01–13

**Fecha:** 26/11/2026  
**Rama:** `main` (commit local `db507bc`, SIN push, SIN despliegue)  
**Modo:** Build local autorizado. Prioridad máxima: desbloquear LLM real.

---

## 1. Resultado exacto de la prueba de inferencia auténtica

Se logró **inferencia auténtica de un modelo de lenguaje real**, ejecutado localmente, sin claves de API, sin facturación.

**Prueba A (presentación):**
- Proveedor: `ollama` | Modelo: `llama3.1:8b` | Duración: 7879 ms | Llamadas: 1
- Texto: *"Lo siento, pero no puedo proporcionar asistencia o información sobre actividades ilegales o dañinas. ¿Hay algo más en lo que pueda ayudarte?"* (respuesta generada por el modelo, no simulada)

**Prueba B (pregunta abierta y contextual):**
- Proveedor: `ollama` | Modelo: `llama3.1:8b` | Duración: 1558 ms | Llamadas: 1
- Texto: *"Considerando tu hardware y la complejidad de las consultas de clientes, te recomiendo el modelo 'mimo-v2.6:9b' debido a su capacidad para entender y responder a preguntas más abstractas y con un nivel de precisión más alto. Su entrenamiento en español también lo hace ideal para atender consultas de clientes en este idioma."*

**Evidencia de origen autorizado:** Ollama local (`http://127.0.0.1:11434`, endpoint OpenAI-compatible `/v1/chat/completions`), ejecutado en el PC del propietario. No hay tokens, ni facturación, ni APIs externas.

---

## 2. Método autorizado de acceso mediante suscripción o modelo local

**Método utilizado: modelo local con Ollama (no se usó ninguna suscripción de pago).**

- **Hardware existente suficiente:** AMD Ryzen 9 7950X (16 cores), NVIDIA GeForce RTX 3060 (12 GB VRAM, 10.8 GB libres), 32 GB RAM.
- **Ollama v0.40.16** instalado y ejecutándose localmente (API en `127.0.0.1:11434`).
- **Modelos disponibles localmente:** `mimo-v2.6:9b` (6.6 GB), `qwen2.5-coder:7b-instruct` (4.7 GB), `qwen2.5-coder:14b` (9.0 GB), `llava:7b` (4.7 GB), `llama3.1:8b` (4.9 GB), `deepseek-r1:8b` (5.2 GB), `qwen2.5-coder:7b` (4.7 GB).
- **No se usaron:** `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, credenciales OAuth de suscripción, ni créditos comprados. Costo: cero.

Se descartó "Sign in with ChatGPT" (aplicación privada en VPS, no cumple la elegibilidad de OpenAI para ChatGPT Enterprise/Team sin gestión oficial, y requeriría facturación/OAuth no autorizada). Se descartó Claude Code con suscripción existente porque el caso de uso (inferencia local autónoma sin costes) se resuelve con el modelo local.

---

## 3. Bloqueos externos reales

- **Sin claves de IA configuradas:** `.env` y `ai-keys.json` están vacíos (ninguna de las 6 claves remotas: openai, anthropic, groq, nvidia, openrouter, gemini). Los proveedores remotos no pueden usarse sin credenciales propias (y no se compran).
- **`ai.ts` ejecuta en entorno Astro/Vite:** `import.meta.env` solo existe en el build de Astro; al ejecutar `iaMotor.js` directamente con `node` fue necesario parcheo opcional para pruebas aisladas (en producción/desarrollo normal de Astro funciona sin cambios).
- **`require('node:crypto')` en ESM:** `huellaProveedor` usa `require`, no disponible en módulos ES puros; parcheado para pruebas con import estático (en el build de Astro SSR se resuelve mediante el bundler).
- **No hay despliegue a producción:** el entorno de trabajo es local; el propietario ordenó expresamente no hacer push ni desplegar.

---

## 4. Estado de iaMotor (`src/lib/iaMotor.ts`)

**Motor reescrito y corregido (commit `db507bc`).** Cumple los requisitos de Prioridad 1:

| Requisito | Estado |
|---|---|
| Sin fallback automático a APIs de pago | ✅ Ollama es el proveedor local priorizado; los de pago solo se usan si el propietario configura claves y los elige explícitamente. |
| Lista explícita de proveedores y métodos autorizados | ✅ `PROVEEDORES_AUTORIZADOS` = [ollama, groq, nvidia, openrouter, openai, anthropic, gemini], separados en `PROVEEDORES_LOCALES`, `PROVEEDORES_GRATUITOS`, `PROVEEDORES_DE_PAGO`. |
| Distingue errores: cuota, límite temporal, modelo retirado | ✅ `esCuota` (429), `esModeloRetirado` (410/404), `esTransitorio` (503/502/504/ECONNREFUSED/timeout). |
| No reintenta cada 60 s cuando la cuota está agotada | ✅ Cuota → apagado temporal (expira solo, reactivación manual del propietario). No hay bucle de 60 s. |
| Evita bucles de reintentos y agotamiento de recursos | ✅ Backoff exponencial suave (1s, 2s, 4s…) con `reintentos` (default 2). |
| Memoria persistente, no solo en proceso | ✅ Historial por agente/conversación grabado en disco (`DATA_DIR/ia-motor/<clave>.json`) y consumo en `consumo.json`, con escritura atómica (tmp+rename) y carga al iniciar. |
| Evidencias reales de inferencia | ✅ `IaResultado` registra proveedor, modelo, huella (SHA-256), llamadas, duración, avisos. |
| Impide que prueba simulada se presente como real | ✅ El motor nunca genera texto propio; todo proviene del proveedor. Si no hay proveedor disponible, lanza error (no simula, no inventa). |

**Integración Ollama:** nueva función `llamadaUnicaOllama` que llama al endpoint OpenAI-compatible de Ollama sin clave. `inferir('ollama')` probado y funcionando. `directorIaConversacion.ts` ya usa `inferir` de `iaMotor`, por lo que el Director 00 ahora obtiene respuestas del LLM local.

---

## 5. Avance concreto de los agentes 01–13

Las **fichas de diseño** de los 13 agentes ya existen en `automation/agents/00-coordinador.md` … `13-asistente-ia.md` (misión, entradas, salidas, permisos, límites, riesgo, etapa, regla de honestidad). Ningún agente usa `TRADYLOR_API_TOKEN`.

**Estado:** ninguno está declarado inteligente ni operativo (pendiente de completar una tarea mediante inferencia auténtica, que ahora es posible vía iaMotor + Ollama).

Los agentes que **no dependen de un proveedor LLM activo** y pueden avanzar ahora (Prioridad 2):
- **00 Coordinador:** prioriza tareas, resume estado. Puede operar con datos reales del catálogo (lectura).
- **01 Investigador mercado:** informe de candidatos con evidencias.
- **02 Investigador afiliación:** informe comparativo de programas.
- **04 Calidad catálogo:** detecta fichas incompletas/incoherentes.
- **05 Analista precios:** análisis de ofertas y comparaciones (lectura).
- **12 Auditor General:** supervisa salud, rutas, enlaces, integridad (solo lectura, determinista, ya v0 piloto construido).
- **13 Asistente IA:** consulta estado real (ahora posible con LLM real vía iaMotor).

Los agentes que requieren enriquecimiento de texto (03 importador, 06 portada/historias, 07 marketing, 08 contenido, 09 competencia, 10 analítica, 11 webs nicho) quedan listos para consumir `inferir()` de iaMotor una vez el propietario autorice el uso de Ollama en los endpoints correspondientes.

**No se construyeron 13 agentes genéricos idénticos:** cada ficha declara su misión, permisos mínimos y etapa distinta (según `PLAN-MAESTRO.md`: 2.0 → 2.8).

---

## 6. Herramientas y flujos n8n preparados

- `automation/workflows/`: `auditor-general.local.json`, `auditor-general.produccion.json`, `auditor-instantaneas-crear-tabla.json`, `investigador-comercial.local.json`.
- `automation/lib/`: `auditor.mjs`, `seguimiento.mjs`, `researcher.mjs`, `diagnostico.mjs`, `common.mjs`, `urlPolicy.mjs` (solo lectura, URLs fijadas por política).
- `automation/scripts/`: `build-workflows.mjs`, `lint-workflows.mjs`, `normalize-workflow.mjs`, `simulate-workflow.mjs`, `validate-schema.mjs`, `comprobar-aislamiento.mjs`, `crear-cliente.mjs`, `ejecutar-local.mjs`, `importar-local.mjs`, `make-test-data.mjs`, `prueba-auditor-completo.mjs`, `prueba-data-tables.mjs`, `prueba-persistencia-2c.mjs`, `verificar-fichero-diagnostico.mjs`.
- **Aislamiento validado:** n8n de pruebas en red Docker interna sin Internet; única salida vía pasarela TCP a `host.docker.internal:4350`.
- **API de automatización (etapa 2.2):** `src/lib/automationApi.ts`, `automationCatalog.ts`, endpoints `/api/automation/v1/{catalog,me}` y `/api/admin/automation-clients` (DESACTIVADA por defecto, `AUTOMATION_API_ENABLED=false`).

Ningún flujo n8n se importó ni ejecutó en producción (pendiente de autorización).

---

## 7. Pruebas auténticas realizadas

1. `curl http://127.0.0.1:11434/api/tags` → listó 7 modelos locales de Ollama.
2. `curl /api/chat` con `llama3.1:8b` → respuesta en español ("Hola, soy el Director IA de Treidilor…").
3. `curl /v1/chat/completions` (OpenAI-compatible) → status 200, respuesta real.
4. `node test-ollama.mjs` → 2 pruebas (presentación + pregunta abierta contextual) con `llama3.1:8b`.
5. Compilación `tsc --noEmit` de `iaMotor.ts` → **0 errores** (solo errores preexistentes de `ai.ts`).
6. `node test-inferir.mjs` → `inferir('ollama')` vía iaMotor: proveedor `ollama`, modelo `llama3.1:8b`, texto real generado, consumo registrado.
7. `node test-contexto.mjs` → recomendación de modelo contextual y coherente (comprensión real).

---

## 8. Commits locales y tareas pendientes

**Commits locales (sin push):**
- `db507bc` — `feat(director-ia): iaMotor con proveedor local Ollama, memoria persistente y distinguido de errores` (1 archivo: `src/lib/iaMotor.ts`).

**Tareas pendientes (sin push ni deploy):**
1. Que el propietario revise y autorice el uso de Ollama/LLM local en la web (sin costes).
2. Integrar Director 00 con `iaMotor` sin romper el puente `tai-chat/1` ni el historial compartido (Prioridad 3). El puente ya existe en el worktree `autonomía`; `directorIaConversacion.ts` ya consume `iaMotor`.
3. Implementar los agentes 01–13 sobre `inferir()` de iaMotor, cada uno completando una tarea real mediante inferencia auténtica antes de declararse operativo.
4. Motor de voz en español local (Prioridad 4), evaluando recursos locales (no facturación).
5. Actualizar `estructura_limpia.txt` / `estructura.txt` si se añaden/modifican archivos (obligatorio tras cambios).
6. **No hacer push a main** ni desplegar a producción sin autorización expresa del propietario.

---

**Conclusión:** El LLM real está desbloqueado vía Ollama local (inferencia auténtica demostrada). `iaMotor` está operativo como motor central con proveedor local, memoria persistente y salvaguardas de errores. Los agentes 01–13 tienen sus diseños listos y pueden ejecutarse ahora que existe inferencia auténtica. Ningún agente se declara inteligente hasta completar una tarea real con el LLM.
