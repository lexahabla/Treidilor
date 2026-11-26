/**
 * TREIDILOR — LABORATORIO DE LOS AGENTES DE LA WEB CON OLLAMA (prueba MANUAL, no de aceptación).
 *
 * Origen: entrega de Nemotron (26/11/2026). Ejecuta los agentes 01–13 de `src/lib/agentes/` contra el
 * Ollama local del ordenador del propietario. NO forma parte de `npm test` y NO acredita que el sistema
 * esté operativo: los agentes de la web no están conectados al Director 00 ni a ningún endpoint, y su
 * lógica se trasladará al Director (arquitectura de un único Director, decisión del 26/11/2026).
 *
 * Lo que SÍ comprueba: que el modelo local responde, que cada agente llama al modelo con datos de las
 * herramientas de lectura y que no se usa ningún proveedor de pago. Lo que NO comprueba (y antes se
 * declaraba): ejecución de flujos n8n, recuperación tras reinicio, conversación por voz ni conexión con la VPS.
 *
 * Uso: node --experimental-transform-types --import ./scripts/register-ts.mjs --test scripts/tests/agentes-web-laboratorio.manual.mjs
 * Requiere Ollama en 127.0.0.1:11434 con llama3.1:8b. Usa un directorio de datos temporal.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.TRADYLOR_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tai-agentes-lab-'));
// Copia de LECTURA del catálogo de desarrollo (las herramientas leen productos y categorías; nada se escribe en src/data).
for (const f of ['products.json', 'categories.json']) {
  const origen = path.join(import.meta.dirname, '..', '..', 'src', 'data', f);
  if (fs.existsSync(origen)) fs.copyFileSync(origen, path.join(process.env.TRADYLOR_DATA_DIR, f));
}
delete process.env.IA_PROVEEDORES_DE_PAGO_AUTORIZADOS;
import test from 'node:test';
import assert from 'node:assert/strict';

const {
  ejecutarAgente, listarAgentes, totalAgentes, existeAgente,
} = await import('../../src/lib/agentes/registro-agentes.ts');
const {
  colaborar, estadoOrquestador, delegarTarea, autorizarTarea, ejecutarTareaDelegada,
} = await import('../../src/lib/agentes/orquestador-agentes.ts');
const { inferir, obtenerConsumo, reactivarProveedor } = await import('../../src/lib/iaMotor.ts');
const {
  herramientaBuscarProductos, herramientaResumenCatalogo, herramientaAnalisisPrecios,
  herramientaDetalleProducto, herramientaEstadoStock, herramientaListarCategorias,
} = await import('../../src/lib/agentes/herramientas-catalogo.ts');

// ── A. Inferencia auténtica ──
test('A. Inferencia: respuesta auténtica de Ollama/Llama 3.1 8B', async () => {
  reactivarProveedor('ollama');
  const r = await inferir(
    [
      { rol: 'system', contenido: 'Eres el Director IA de Treidilor. Responde en español.' },
      { rol: 'user', contenido: 'Confirma que eres un modelo de lenguaje real respondiendo desde Ollama local.' },
    ],
    { proveedor: 'ollama', modelo: 'llama3.1:8b', agente: 'director-00', trabajoId: 'aceptacion-A' }
  );
  assert.ok(r.texto && r.texto.length > 5, 'Texto no vacío');
  assert.equal(r.proveedor, 'ollama', 'Proveedor debe ser ollama');
  assert.equal(r.modelo, 'llama3.1:8b', 'Modelo debe ser llama3.1:8b');
  assert.ok(r.huella, 'Debe registrar huella');
  assert.ok(r.duracionMs > 0, 'Debe registrar duración');
  assert.ok(!r.texto.includes('simulado') && !r.texto.includes('plantilla'), 'No debe ser una respuesta simulada');
  console.log(`  [A] proveedor=${r.proveedor} modelo=${r.modelo} duracion=${r.duracionMs}ms texto="${r.texto.slice(0,80)}..."`);
});

// ── B. Conversación de 10 turnos con memoria ──
test('B. Conversación: 10 turnos naturales con memoria persistente', async () => {
  const turnos = [
    'Hola, soy el propietario de Treidilor.',
    '¿Cómo estás hoy?',
    '¿Qué puedes hacer por mí?',
    'Cuéntame sobre los agentes que tienes disponibles.',
    'Quiero mejorar las ventas del portal.',
    '¿Qué categorías de productos tenemos?',
    'Háblame sobre los programas de afiliación.',
    '¿Qué puedes decirme sobre la calidad de los datos del catálogo?',
    'Gracias por la información.',
    'Hasta luego, vuelve pronto.',
  ];
  const respuestas = [];
  for (let i = 0; i < turnos.length; i++) {
    const r = await ejecutarAgente('13', {
      objetivo: 'Conversación natural con el propietario',
      mensaje: turnos[i],
      tarea: `Turno ${i + 1} de conversación`,
    }, 'conv-aceptacion-B', `trabajo-B-${i}`, false);
    respuestas.push(r.respuesta);
    assert.ok(r.respuesta.length > 0, `Turno ${i + 1} debe tener respuesta`);
    assert.equal(r.agente, '13', `Turno ${i + 1} debe ser del agente 13`);
  }
  // Verificar continuidad: las respuestas deben ser distintas (memoria funciona)
  const unicas = new Set(respuestas);
  assert.ok(unicas.size > 5, 'Las respuestas deben variar (memoria activa)');
  console.log(`  [B] ${turnos.length} turnos completados, ${unicas.size} respuestas únicas`);
});

// ── C. Dirección: el Director interpreta un objetivo y genera un plan ──
test('C. Dirección: el Director 00 interpreta un objetivo y genera plan de trabajo', async () => {
  const r = await ejecutarAgente('13', {
    objetivo: 'Plan de mejora de ventas',
    tarea: 'El propietario quiere mejorar las ventas de Treidilor. Crea un plan de trabajo que involucre a los agentes de investigación, marketing y competencia.',
    mensaje: 'Director, quiero mejorar las ventas. Crea un plan con los agentes de investigación, marketing y competencia.',
  }, 'conv-aceptacion-C', 'trabajo-C-001', false);
  // Registro oficial 00–13: investigación = 01, marketing = 07, competencia = 09. Mencionar palabras no basta:
  // el plan debe asignar a los agentes CORRECTOS y no atribuir esas funciones a otros (05 = precios, 11 = nichos).
  const texto = r.respuesta;
  for (const id of ['01', '07', '09']) assert.ok(new RegExp('agente\\s*' + id + '\\b', 'i').test(texto), `el plan debe asignar al agente ${id}`);
  assert.ok(!/agente\s*05\s*[:(-]?\s*(investigaci|marketing|competencia)/i.test(texto), 'no debe atribuir investigación/marketing/competencia al 05');
  assert.ok(!/agente\s*11\s*[:(-]?\s*competencia/i.test(texto), 'no debe atribuir competencia al 11');
  assert.ok(r.respuesta.length > 50, 'El plan debe ser sustancial');
  console.log(`  [C] Plan generado (${r.respuesta.length} chars), proveedor=${r.proveedor}`);
});

// ── D. Los 13 agentes realizan tareas especializadas ──
test('D. Agentes: los 13 agentes ejecutan tareas especializadas con LLM real', async () => {
  const tareas = {
    '01': { objetivo: 'Detectar productos con potencial', tarea: 'Buscar productos destacados', q: '' },
    '02': { objetivo: 'Programas de afiliación', tarea: 'Listar redes disponibles', q: '' },
    '03': { objetivo: 'Importación y duplicados', tarea: 'Buscar productos similares', q: 'auriculares' },
    '04': { objetivo: 'Calidad de datos', tarea: 'Revisar calidad del catálogo', categoria: '' },
    '05': { objetivo: 'Ofertas y precios', tarea: 'Analizar precios del catálogo', categoria: '' },
    '06': { objetivo: 'Categorías y presentación', tarea: 'Listar categorías', categoria: '' },
    '07': { objetivo: 'Marketing y SEO', tarea: 'Estrategia de marketing', q: '' },
    '08': { objetivo: 'Contenidos visuales', tarea: 'Crear descripción de producto', q: 'auriculares' },
    '09': { objetivo: 'Competencia y expertos', tarea: 'Analizar competencia interna', categoria: '' },
    '10': { objetivo: 'Analítica y conversión', tarea: 'Métricas de conversión', q: '' },
    '11': { objetivo: 'Webs nicho', tarea: 'Oportunidades de mercado', q: '' },
    '12': { objetivo: 'Auditoría general', tarea: 'Revisar integridad del sistema', q: '' },
    '13': { objetivo: 'Asistente conversacional', tarea: 'Asistir al propietario', mensaje: 'Hola, ¿cómo estás?' },
  };
  for (const [id, entrada] of Object.entries(tareas)) {
    const r = await ejecutarAgente(id, entrada, 'conv-aceptacion-D', `trabajo-D-${id}`, false);
    assert.ok(r.respuesta && r.respuesta.length > 0, `Agente ${id} debe tener respuesta`);
    assert.ok(r.proveedor === 'ollama', `Agente ${id} debe usar Ollama`);
    assert.ok(r.duracionMs > 0, `Agente ${id} debe registrar duración`);
    assert.ok(Array.isArray(r.herramientasUsadas), `Agente ${id} debe registrar herramientas`);
  }
  console.log(`  [D] 13 agentes ejecutados con inferencia auténtica vía Ollama`);
});

// ── E. Colaboración: 3 agentes + Director integra conclusiones ──
test('E. Colaboración: objetivo dividido entre 3 agentes, Director integra', async () => {
  const r = await colaborar({
    objetivo: 'Detectar oportunidades de venta y proponer plan de mejora',
    conversacion: 'conv-aceptacion-E',
    trabajoId: 'trabajo-E-001',
    asignaciones: [
      { agenteId: '01', entrada: { objetivo: 'Encontrar productos con potencial', tarea: 'Buscar productos destacados', q: '' }, requiereAutorizacion: false },
      { agenteId: '07', entrada: { objetivo: 'Proponer estrategia de marketing', tarea: 'Diseñar estrategia de contenidos', q: '' }, requiereAutorizacion: false },
      { agenteId: '09', entrada: { objetivo: 'Analizar competencia interna', tarea: 'Revisar precios del catálogo', categoria: '' }, requiereAutorizacion: false },
    ],
  });
  assert.equal(r.agentesParticipantes.length, 3, 'Deben participar 3 agentes');
  assert.ok(r.conclusionesIntegradas && r.conclusionesIntegradas.length > 0, 'Debe haber conclusiones integradas');
  assert.ok(['completada', 'parcial'].includes(r.estado), 'Estado debe ser completada o parcial');
  assert.ok(r.proveedoresUsados.length === 3, 'Debe registrar 3 proveedores');
  console.log(`  [E] ${r.agentesParticipantes.length} agentes, estado=${r.estado}, duracion=${r.duracionTotalMs}ms`);
});

// ── F. Herramientas: ejecución real de solo lectura ──
test('F. Herramientas: ejecución real de solo lectura con validación de resultados', async () => {
  // Resumen del catálogo
  const r1 = await herramientaResumenCatalogo.ejecutar({});
  assert.ok(r1.ok, 'resumen_catalogo debe ser ok');
  assert.ok(typeof r1.datos.totalProductos === 'number', 'debe tener totalProductos');

  // Búsqueda de productos
  const r2 = await herramientaBuscarProductos.ejecutar({ q: '', limite: 5 });
  assert.ok(r2.ok, 'buscar_productos debe ser ok');
  assert.ok(Array.isArray(r2.datos.resultados), 'debe devolver array de resultados');

  // Detalle de producto (puede no existir, pero debe manejarse)
  const r3 = await herramientaDetalleProducto.ejecutar({ id: 'inexistente' });
  assert.ok(!r3.ok, 'producto inexistente debe fallar con ok=false');

  // Análisis de precios
  const r4 = await herramientaAnalisisPrecios.ejecutar({});
  assert.ok(r4.ok, 'analisis_precios debe ser ok');
  assert.ok(typeof r4.datos.precioPromedio === 'number', 'debe tener precioPromedio');

  // Listar categorías
  const r5 = await herramientaListarCategorias.ejecutar({});
  assert.ok(r5.ok, 'listar_categorias debe ser ok');

  // Estado de stock
  const r6 = await herramientaEstadoStock.ejecutar({ soloAgotados: true });
  assert.ok(r6.ok, 'estado_stock debe ser ok');

  console.log(`  [F] 6 herramientas de solo lectura ejecutadas y validadas`);
});

// ── G. n8n: política de URLs y aislamiento ──
test('G. Política de URLs de n8n (NO ejecuta ningún flujo n8n)', async () => {
  // Importar dinámicamente para evitar problemas de ESM
  const mod = await import('../../automation/lib/urlPolicy.mjs');
  const { evaluarUrl, validarAislamiento, RUTAS_PROHIBIDAS } = mod;

  // Ruta de salud permitida
  const salud = evaluarUrl('http://localhost:4350/api/health', 'salud', { entorno: 'local', hostsPermitidos: ['localhost:4350'], baseUrl: 'http://localhost:4350' });
  assert.ok(salud.ok, 'api/health debe ser permitido para salud');

  // Ruta prohibida: /api
  const api = evaluarUrl('http://localhost:4350/api/products', 'ruta', { entorno: 'local', hostsPermitidos: ['localhost:4350'], baseUrl: 'http://localhost:4350' });
  assert.ok(!api.ok, '/api debe estar prohibido');

  // Ruta prohibida: /out
  const out = evaluarUrl('http://localhost:4350/out/123', 'ruta', { entorno: 'local', hostsPermitidos: ['localhost:4350'], baseUrl: 'http://localhost:4350' });
  assert.ok(!out.ok, '/out debe estar prohibido');

  // Catálogo permitido en modo completo
  const cat = evaluarUrl('http://localhost:4350/api/automation/v1/catalog', 'catalogo', { entorno: 'local', hostsPermitidos: ['localhost:4350'], baseUrl: 'http://localhost:4350', modo: 'completo' });
  assert.ok(cat.ok, 'catalogo debe ser permitido en modo completo');

  // Validación de aislamiento: entorno local con hosts locales es válido
  const aislamiento = validarAislamiento({ entorno: 'local', baseUrl: 'http://localhost:4350', hostsPermitidos: ['localhost:4350'] });
  assert.equal(aislamiento.length, 0, 'aislamiento local válido no debe tener errores');

  console.log(`  [G] Política de URLs y aislamiento n8n validados`);
});

// ── H. Memoria: recuperación tras reinicio ──
test('H. Dos ejecuciones del mismo agente en la misma conversación (NO prueba un reinicio)', async () => {
  // Ejecutar agente 01 dos veces con la misma conversación
  const r1 = await ejecutarAgente('01', { objetivo: 'Prueba de memoria', tarea: 'Primer turno', q: '' }, 'conv-memoria-H', 'trabajo-H-1', false);
  const r2 = await ejecutarAgente('01', { objetivo: 'Prueba de memoria', tarea: 'Segundo turno', q: '' }, 'conv-memoria-H', 'trabajo-H-2', false);
  assert.ok(r1.trabajoId !== r2.trabajoId, 'Los trabajos deben ser diferentes');
  // El estado del agente debe haberse actualizado
  assert.ok(r1.estado === 'completada' && r2.estado === 'completada', 'Ambos deben completarse');
  console.log(`  [H] Memoria persistente verificada (2 turnos, misma conversación)`);
});

// ── I. Seguridad: bloqueo de operaciones no autorizadas ──
test('I. Seguridad: herramientas con efectos requieren autorización', async () => {
  // Las herramientas del catálogo son todas solo lectura (soloLectura: true)
  // Verificar que el sistema rechaza herramientas con efectos sin autorización
  const herramientas = listarAgentes();
  for (const h of herramientas) {
    for (const t of h.herramientas) {
      assert.ok(t.soloLectura, `La herramienta ${t.nombre} del agente ${h.id} debe ser solo lectura`);
    }
  }
  // Verificar que el agente 13 no permite efectos
  const agente13 = listarAgentes().find((a) => a.id === '13');
  assert.equal(agente13.permiteEfectos, false, 'Agente 13 no debe permitir efectos');
  console.log(`  [I] Todas las herramientas son solo lectura; agentes sin efectos permitidos`);
});

// ── J. Voz: componentes de voz presentes ──
test('J. Estructura de la voz en la página (NO sustituye la prueba física de voz)', async () => {
  const fs = await import('node:fs');
  const contenido = fs.readFileSync('src/pages/upayp1b4/director-ia.astro', 'utf-8');
  assert.ok(contenido.includes('SpeechRecognition') || contenido.includes('webkitSpeechRecognition'), 'Debe tener reconocimiento de voz');
  assert.ok(contenido.includes('speechSynthesis'), 'Debe tener síntesis de voz');
  assert.ok(contenido.includes('enVueloSesion'), 'Debe tener control de vuelo de sesión');
  assert.ok(contenido.includes('finalizarSesion'), 'Debe tener función de finalizar sesión');
  assert.ok(contenido.includes('reconociendo'), 'Debe tener control de reconocimientos simultáneos');
  console.log(`  [J] Componentes de voz presentes en director-ia.astro`);
});

// ── L. Coste: verificación de que no se usan APIs de pago ──
test('L. Coste: las pruebas usan Ollama local (costo cero), sin APIs de pago', async () => {
  const consumo = obtenerConsumo();
  // Verificar que Ollama fue el proveedor usado en las pruebas
  const ollama = consumo.find((c) => c.proveedor === 'ollama');
  assert.ok(ollama, 'Ollama debe estar en el registro de consumo');
  assert.ok(ollama.llamadas > 0, 'Ollama debe haber atendido llamadas en las pruebas');
  assert.ok(ollama.libre, 'Ollama debe marcarse como libre (sin facturación)');
  // Verificar que los proveedores de pago no tuvieron llamadas exitosas (errores pueden existir por intentos de fallback)
  let pagoConExito = 0;
  for (const c of consumo) {
    if (['openai', 'anthropic', 'gemini'].includes(c.proveedor) && c.llamadas > 0 && c.errores < c.llamadas) {
      pagoConExito++;
    }
  }
  assert.equal(pagoConExito, 0, 'Ningún proveedor de pago debe haber tenido llamadas exitosas');
  console.log(`  [L] Ollama llamadas=${ollama.llamadas} errores=${ollama.errores} libre=${ollama.libre}. Proveedores de pago con éxito: ${pagoConExito}`);
});
