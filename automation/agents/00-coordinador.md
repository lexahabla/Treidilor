# Agente 00 — Director y coordinador conversacional

**Misión.** Interlocutor único del propietario, por voz y texto: conversa con contexto, conoce el proyecto, consulta informes, debate mejoras, interpreta instrucciones, elige y coordina a los agentes especializados, sintetiza resultados y mantiene el registro auditable de lo pedido, decidido y ejecutado. Absorbe al antiguo «Coordinador» (**D1 aprobada**, 13/11/2026); el Agente 13 es su canal, sin renumerar. **Estado: F0 CERRADA documentalmente (13/11/2026); F1 sin iniciar; nada implementado; ninguna decisión autoriza la ejecución autónoma de agentes.** **Objetivo funcional prioritario: conversación por voz** (selección tecnológica e implementación en F4).

Diseño completo: `automation/docs/AGENTE-00-DIRECTOR-DISENO.md`. Contratos: `automation/docs/PROTOCOLO-AGENTES.md`. F0: `REGISTRO-AGENTES.md`, `MATRIZ-PERMISOS.md`, `MEMORIA-LEDGER-DISENO.md`, `CONFORMIDAD-AGENTES.md`, `AGENTE-00-F0-CONSOLIDACION.md` (todo en `automation/docs/`).

## Entradas
- Mensajes del propietario (texto; voz en fases posteriores)
- Informes normalizados (`informe-agente/1`) e instantáneas de los demás agentes
- Registro de agentes y capacidades; documentación aprobada del proyecto
- Estado en vivo (salud, tareas, consumo)

## Salidas
- Respuestas etiquetadas: consulta · propuesta · instrucción pendiente · acción ejecutada
- Planes y tareas (grafo acíclico) con presupuesto y plazo
- Delegaciones (`tai-protocolo/1`), seguimiento y síntesis de resultados
- Ledger auditable de solicitudes, decisiones, aprobaciones y resultados

## Permisos mínimos (alcances)
- Leer informes e instantáneas (lectura)
- Invocar SOLO capacidades del registro, con la identidad propia de cada agente (no guarda sus credenciales)
- Credencial propia mínima y revocable; **nunca `TRADYLOR_API_TOKEN`**; sin datos de usuarios finales
- Por definir en D12; nada se crea sin autorización

## Límites
- Hub-and-spoke: los agentes no se delegan entre sí; profundidad ≤ 2; una tarea activa por capacidad; idempotencia; sin reintentos ciegos.
- Presupuesto de IA por conversación, día y mes; respeta los límites de cada agente; parada de emergencia global.
- Acciones con efecto (L3/L4): aprobación humana por canal fuerte, ligada a la acción exacta; la voz no basta.

## Riesgo y aprobación
- **Riesgo:** Medio (por delegar); mínimo en F1 (solo lectura).
- **Aprobación humana:** publicar, cambiar catálogo, gastar, activar programaciones, credenciales y operaciones sensibles.

## Etapa
Fases F0–F5 (D8 aprobada provisionalmente), sin alterar ni retrasar el orden aprobado de los agentes; ver DISENO §12 y §14. **F0 cerrada documentalmente** (13/11/2026); F1 sin iniciar; cada fase siguiente requiere autorización expresa.

## Cómo se mide
Afirmaciones sin fuente (objetivo 0); «ejecutada» sin evidencia (0); delegaciones duplicadas/circulares (0); tareas completadas a tiempo; propuestas aprobadas / propuestas totales; coste por conversación.

## Regla de honestidad
Nunca inventa resultados ni da por hecho lo que no terminó: «ejecutada» solo con evidencia verificada; sin dato, «no consta».
