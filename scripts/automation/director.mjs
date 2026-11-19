#!/usr/bin/env node
/**
 * Treidilor AI · Agente 00 · CONSOLA del Director (F1.4). Sin LLM y sin ejecución real: consulta informes preparados (exportaciones de las
 * tablas de los Agentes 04 y 12), registra tareas, las asigna según el registro de capacidades y gestiona aprobaciones L2–L4 SIMULADAS.
 * El ledger vive FUERA del repositorio (`TAI_DIRECTOR_DIR`, por defecto ~/.treidilor-director). Detalle: automation/docs/AGENTE-00-F1-IMPLEMENTACION.md
 *
 *   node scripts/automation/director.mjs consola
 *   node scripts/automation/director.mjs preguntar "dame el último informe de calidad"
 *   node scripts/automation/director.mjs ayuda
 */
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { LedgerLocal, ErrorLedger } from '../../automation/director/ledger.mjs';
import { cargarRegistro } from '../../automation/director/registro.mjs';
import { LectorInstantaneas } from '../../automation/director/lectores.mjs';
import { Director } from '../../automation/director/director.mjs';
import { ErrorProtocolo } from '../../automation/director/protocolo.mjs';
import { directorioInstantaneas, directorioLedger } from '../../automation/director/config.mjs';
import { CerebroLLM } from '../../automation/director/llm/cerebro.mjs';
import { Presupuesto } from '../../automation/director/llm/presupuesto.mjs';
import { ProveedorSimulado } from '../../automation/director/llm/proveedores.mjs';
import { cargarInventario } from '../../automation/director/suscripciones/aviso13.mjs';
import { RUTA_PROGRAMAS_SIMULADO } from '../../automation/director/agentes/afiliacion/afiliacion.mjs';
import { cargarMotor } from '../../automation/director/agentes/importador/importador.mjs';
import { cargarMotorPrecios } from '../../automation/director/agentes/precios/precios.mjs';
import { cargarMotorPortada } from '../../automation/director/agentes/portada/portada.mjs';
import { cargarMotorAnalitica } from '../../automation/director/agentes/analitica/analitica.mjs';
import { cargarMotorMarketing } from '../../automation/director/agentes/marketing/marketing.mjs';
import { cargarMotorContenido } from '../../automation/director/agentes/contenido/contenido.mjs';
import { cargarMotorCompetencia } from '../../automation/director/agentes/competencia/competencia.mjs';
import { cargarMotorNichos } from '../../automation/director/agentes/nichos/nichos.mjs';
import { Canal13, renderTexto } from '../../automation/director/canal/canal13.mjs';
import { comandoIntegridad, SUBCOMANDOS as SUBCOMANDOS_INTEGRIDAD } from '../../automation/director/integridad/consola.mjs';
import { ejecutarBateria } from '../../automation/director/evaluacion/ejecutar.mjs';
import { prepararPruebasReales } from '../../automation/director/evaluacion/pruebas-reales.mjs';

const USO = `Uso: node scripts/automation/director.mjs <comando> [argumentos] [opciones]

Conversación
  consola                              Modo interactivo (escribe instrucciones; «salir» termina)
  preguntar "<texto>"                  Procesa una instrucción en texto
Registro y tareas
  agentes                              Agentes y capacidades del registro (con el origen de su estado)
  tareas [--todas]                     Tareas activas (o todas)
  tarea ver <idTarea>                  Tarea con su traza completa
  tarea crear <capacidad> [k=v …]      Crea la tarea de una capacidad (L0 se ejecuta; L2+ queda esperando aprobación simulada)
Aprobaciones (SIMULADAS en F1: nada se envía a ningún agente)
  aprobar <idAprobacion> --simulada [--canal interfaz|voz|simulado] [--reautenticado]
  rechazar <idAprobacion> [motivo]
  cancelar <idTarea> [motivo]
  parada [motivo]  ·  reanudar         Parada de emergencia (sin aprobación) y su levantamiento
  reconciliar                          Marca como expiradas las tareas vencidas (sin repetir nada)
Informes (solo lectura sobre las exportaciones)
  informe <04|12> [--historial] [--comparar] [--id <idEjecucion>]
F1.5 (cerebro, consumo y suscripciones; todo SIMULADO, sin gasto ni red)
  preguntar "<texto>" --cerebro simulado   Interpreta con el cerebro LLM sobre un proveedor simulado (las reglas siguen como suelo de seguridad)
  consumo                              Presupuesto de IA: consumo real DESACTIVADO por defecto, topes 1 €/día y 10 €/mes
  suscripciones [--recomendar]         Informe del Agente 13 sobre planes/API de IA (inventario SIMULADO)
  evaluar [--caso EV-01]               Ejecuta la batería de 68 casos con proveedor simulado (3 repeticiones por caso)
  evaluar-reales                       Muestra el plan de pruebas reales mínimas (NO las ejecuta: requieren autorización)
Canal del propietario (Agente 13; texto; la voz queda para F4)
  canal hablar "<texto>"               Envía la instrucción al Director por el canal (respuesta clara, con naturaleza de los datos, alternativas y autorizaciones)
  canal estado | consumo | suscripciones | optimizar | autorizaciones
  canal decidir <idAprobacion> aprobada|rechazada   Solo reenvía la decisión; confirmar L2–L4 exige la interfaz autenticada (el canal de texto no confirma)
Ledger
  ledger verificar | recuperar | copia <dir> | exportar <dir> | restaurar <origen> <destino>
Opciones: --precios <json de catálogo con observaciones> (Agente 05; sintético) · --portada <json de categorías y productos de referencia> (Agente 06; sintético) · --analitica <json de eventos agregados> (Agente 10; sintético) · --marketing <json de productos y categorías de referencia> (Agente 07; sintético) · --contenido <json de fichas de referencia> (Agente 08; sintético) · --competencia <json de observaciones citadas> (Agente 09; sintético) · --nichos <json de nichos con demanda y costes aportados> (Agente 11; sintético) · --feed <json del feed del catálogo> (Agente 01; sintético) · --catalogo <json de referencia> (Agente 03; sintético) · --lector sintetico|real (por defecto sintetico; «real» exige TAI_DIRECTOR_LECTOR_REAL=si, --n8n-produccion <URL interna>, --hosts <lista> y la credencial en TAI_LECTOR_PROD_TOKEN_FILE; solo lectura de 04 y 12) · --ledger <dir> · --instantaneas <dir> · --json · --ahora <ISO> (solo pruebas: fija el reloj)`;

function opciones(argv) {
  const pos = [];
  const o = {};
  const conValor = new Set(['ledger', 'instantaneas', 'ahora', 'canal', 'id', 'cerebro', 'caso', 'catalogo', 'precios', 'portada', 'analitica', 'marketing', 'contenido', 'competencia', 'nichos', 'feed', 'lector', 'n8n-produccion', 'hosts', 'confirmar', 'almacen']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (conValor.has(k)) o[k] = argv[++i];
      else o[k] = true;
    } else pos.push(a);
  }
  return { pos, o };
}

export function construirDirector(o, env = process.env, motorImportacion = null, motorPrecios = null, motorPortada = null, motorAnalitica = null, motorMarketing = null, motorContenido = null, motorCompetencia = null, motorNichos = null) {
  const reloj = o.ahora ? () => Date.parse(o.ahora) : () => Date.now();
  if (o.ahora && Number.isNaN(Date.parse(o.ahora))) throw new ErrorProtocolo('solicitud_invalida', '--ahora debe ser una fecha ISO.');
  const ledger = new LedgerLocal({ dir: o.ledger || directorioLedger(env), reloj: () => new Date(reloj()) });
  const registro = cargarRegistro();
  const lector = new LectorInstantaneas({ dir: o.instantaneas || directorioInstantaneas(env) });
  const presupuesto = new Presupuesto({ reloj });
  const cerebro = o.cerebro === 'simulado' ? new CerebroLLM({ registro, proveedores: [{ proveedor: new ProveedorSimulado() }], presupuesto, reloj }) : null;
  if (o.cerebro && o.cerebro !== 'simulado') throw new ErrorProtocolo('permiso_denegado', 'Solo está disponible --cerebro simulado: no hay proveedor real configurado ni gasto autorizado.');
  return { director: new Director({ ledger, registro, lector, reloj, cerebro, inventarioIA: cargarInventario(), rutaAfiliacion: RUTA_PROGRAMAS_SIMULADO, motorImportacion, rutaCatalogoImportacion: o.catalogo || null, motorPrecios, rutaCatalogoPrecios: o.precios || null, motorPortada, rutaDatosPortada: o.portada || null, motorAnalitica, rutaAnalitica: o.analitica || null, motorMarketing, rutaFuentesMarketing: o.marketing || null, motorContenido, rutaFuentesContenido: o.contenido || null, motorCompetencia, rutaObservaciones: o.competencia || null, motorNichos, rutaNichos: o.nichos || null, rutaFeedInvestigador: o.feed || null }), ledger, presupuesto };
}

import { crearLectorReal, modoLector, refrescarLectorReal } from '../../automation/director/puente/lector-real.mjs';

const linea = (...p) => p.filter((x) => x !== null && x !== undefined && x !== '').join(' · ');

/** Ejecuta un comando y devuelve { codigo, texto, datos }. Nunca lanza para errores esperados (protocolo, ledger). */
export function ejecutarComando(pos, o, ctx) {
  const { director, ledger } = ctx;
  const [cmd, sub, ...resto] = pos;
  const ok = (texto, datos = null) => ({ codigo: 0, texto, datos });
  try {
    switch (cmd) {
      case undefined: case 'ayuda': case 'help': return ok(USO);
      case 'preguntar': {
        const texto = pos.slice(1).join(' ');
        if (!texto.trim()) return { codigo: 1, texto: 'Falta el texto de la instrucción.' };
        const r = director.procesarSolicitud(texto);
        return ok(r.texto, { idSolicitud: r.idSolicitud, categoria: r.categoria, estado: r.estado, tareas: r.tareas, aprobaciones: r.aprobaciones, registrada: r.registrada, avisos: r.avisos });
      }
      case 'consumo': {
        const eventos = ledger.leer({ tipo: 'consumo' });
        const p = Presupuesto.desdeEventos(eventos, { reloj: () => director.ahora() });
        const r = p.resumen(director.ahora());
        return ok(`Consumo de IA: ${r.consumoRealActivado ? 'ACTIVADO' : 'DESACTIVADO (por defecto)'} · hoy ${r.diaEur.toFixed(4)} € de ${r.topeDiarioEur} € · mes ${r.mesEur.toFixed(4)} € de ${r.topeMensualEur} € · llamadas registradas ${r.llamadasRegistradas} (las simuladas cuestan 0). Ningún gasto está autorizado.`, r);
      }
      case 'suscripciones': {
        const r = director._respSuscripciones(Boolean(o.recomendar));
        return ok(r.texto, { categoria: r.categoria });
      }
      case 'agentes': {
        const l = director.estadoAgentes();
        return ok(l.map((a) => `${a.id} ${a.nombre}: ${a.estado} (estado ${a.origenEstado})${a.capacidades.length ? `\n     ${a.capacidades.map((c) => `${c.id} ${c.nivel}/${c.disponibilidad}`).join('\n     ')}` : ''}`).join('\n'), l);
      }
      case 'tareas': {
        const t = director.listarTareas(o.todas ? {} : { activas: true });
        return ok(t.length ? t.map((x) => linea(x.idTarea, x.capacidad, x.estado, x.nivel, x.detalle)).join('\n') : 'No hay tareas.', t.map((x) => ({ idTarea: x.idTarea, estado: x.estado })));
      }
      case 'tarea': {
        if (sub === 'ver') {
          if (!resto[0]) return { codigo: 1, texto: 'Falta idTarea.' };
          const v = director.verTarea(resto[0]);
          const t = v.tarea;
          return ok([linea(t.idTarea, t.capacidad, t.estado, t.nivel), `Pidió: ${JSON.stringify(v.traza.quienPidioYCuando)}`, `Entendió: ${JSON.stringify(v.traza.queEntendio)}`, `Versiones: ${JSON.stringify(v.traza.versiones)}`, `Aprobación: ${JSON.stringify(v.traza.aprobacion)}`, `Respuesta: ${JSON.stringify(v.traza.respuesta)}`, `Evidencia: ${JSON.stringify(v.traza.evidencia)}`, `Verificación: ${JSON.stringify(v.traza.verificacion)}`, `Historial: ${t.historial.map((h) => h.estado).join(' → ')}`].join('\n'), { traza: v.traza });
        }
        if (sub === 'crear') {
          const [capId, ...kv] = resto;
          if (!capId) return { codigo: 1, texto: 'Falta la capacidad (p. ej. 04.leer-ultimo-informe).' };
          const parametros = {};
          for (const p of kv) { const m = /^([a-zA-Z]+)=(.+)$/.exec(p); if (!m) return { codigo: 1, texto: `Parámetro inválido «${p}» (usa clave=valor).` }; parametros[m[1]] = m[2]; }
          const cap = director.registro.buscarCapacidad(capId);
          if (!cap) return { codigo: 2, texto: `La capacidad «${capId}» no está en el registro.` };
          if (cap.nivelRiesgo === 'L0') {
            const r = director.leerCapacidad(capId, parametros);
            return ok(`Tarea ${r.idTarea}: ${r.estado}${r.confirmada ? ' (verificada releyendo la fuente)' : ''}${r.sinDatos ? ' (sin datos)' : ''}`, { idTarea: r.idTarea, estado: r.estado });
          }
          const r = director.solicitarEjecucion(capId, parametros);
          return ok(`Tarea ${r.idTarea} en espera de aprobación SIMULADA ${r.aprobacion.idAprobacion} (${r.aprobacion.nivel}, caduca ${r.aprobacion.caduca}).\n${r.aprobacion.resumen}`, { idTarea: r.idTarea, idAprobacion: r.aprobacion.idAprobacion });
        }
        return { codigo: 1, texto: 'Uso: tarea ver <id> | tarea crear <capacidad> [k=v …]' };
      }
      case 'aprobar': {
        if (!sub) return { codigo: 1, texto: 'Falta idAprobacion.' };
        if (!o.simulada) return { codigo: 1, texto: 'En F1 solo existen aprobaciones SIMULADAS: añade --simulada (no se enviará nada a ningún agente).' };
        const ahora = director.ahora();
        const r = director.resolverAprobacion(sub, 'aprobada', { canal: o.canal || 'simulado', ultimaAutenticacion: ahora, reautenticadoEn: o.reautenticado ? ahora : null });
        if (r.estado === 'ejecutada_local') return ok(r.texto, r);
        if (r.error) return { codigo: 2, texto: `No aprobada: ${r.error.mensaje} [${r.error.codigo}]`, datos: r };
        return ok(`Aprobación simulada registrada. NO se envió nada al agente (${r.envio.motivo}). Tarea ${r.idTarea}: cancelada («simulación F1»). Aprobación consumida: una aprobación = una ejecución.`, r);
      }
      case 'rechazar': {
        if (!sub) return { codigo: 1, texto: 'Falta idAprobacion.' };
        const r = director.resolverAprobacion(sub, 'rechazada', { motivo: resto.join(' ') || null });
        return r.error ? { codigo: 2, texto: `${r.error.mensaje} [${r.error.codigo}]` } : ok(`Aprobación rechazada; tarea ${r.idTarea} rechazada.`, r);
      }
      case 'cancelar': {
        if (!sub) return { codigo: 1, texto: 'Falta idTarea.' };
        const r = director.cancelarTarea(sub, resto.join(' ') || undefined);
        return ok(`Tarea ${r.idTarea} cancelada.`, r);
      }
      case 'parada': {
        const r = director.paradaEmergencia(pos.slice(1).join(' ') || undefined);
        return ok(`Parada de emergencia ${r.registrada ? 'registrada' : 'activa (sin registro)'}; canceladas: ${r.canceladas.length}. ${r.aviso || ''}`.trim(), r);
      }
      case 'reanudar': { director.reanudar(); return ok('Parada levantada.'); }
      case 'reconciliar': {
        const r = director.reconciliar();
        return ok(r.cambios.length ? r.cambios.map((c) => `${c.idTarea}: ${c.de} → ${c.a} (${c.motivo})`).join('\n') : 'Nada que reconciliar.', r);
      }
      case 'informe': {
        const ag = sub;
        if (!['04', '12'].includes(ag)) return { codigo: 1, texto: 'Uso: informe <04|12> [--historial] [--comparar] [--id <idEjecucion>]' };
        const capId = o.comparar ? `${ag}.comparar-informes` : o.historial || o.id ? `${ag}.leer-historial` : `${ag}.leer-ultimo-informe`;
        const parametros = o.id ? { idEjecucion: o.id } : {};
        const r = director.leerCapacidad(capId, parametros);
        const fake = { tipo: o.comparar ? 'comparar_informes' : o.historial && !o.id ? 'listar_informes' : 'consultar_informe', parametros, pregunta: o.comparar || o.historial || o.id ? 'historica' : 'presente' };
        const resp = director._respInforme(r, fake, ag);
        return ok(resp.texto, { idTarea: r.idTarea, estado: r.estado, frescura: resp.frescura });
      }
      case 'integridad': return comandoIntegridad({ sub, ledgerDir: ledger.dir, env: ctx.env ?? process.env, ahora: director.ahora() }); // 3E.8.10: SOLO consulta y desactivada por defecto (ver integridad/consola.mjs)
      case 'ledger': {
        if (sub === 'verificar') { const v = ledger.verificarCadena(); return { codigo: v.ok ? 0 : 2, texto: v.ok ? `Ledger íntegro: ${v.ultimaSecuencia} eventos${v.anclaAusente ? ' (ancla ausente: se regenerará al siguiente evento)' : ''}.` : `Ledger NO íntegro: ${[...v.errores, v.colaIncompleta ? 'cola incompleta (escritura interrumpida)' : ''].filter(Boolean).join(' | ')}`, datos: v }; }
        if (sub === 'recuperar') { const r = ledger.recuperarColaIncompleta(); return ok(r.recuperado ? `Cola incompleta apartada (${r.bytesApartados} bytes) en ${r.archivoHuerfano}; el ledger sigue íntegro.` : 'No había nada que recuperar.', r); }
        if (sub === 'copia') { if (!resto[0]) return { codigo: 1, texto: 'Falta el directorio de destino.' }; const r = ledger.copiaSeguridad(path.resolve(resto[0])); return ok(`Copia verificada: ${r.eventos} eventos en ${r.destino}.`, r); }
        if (sub === 'exportar') { if (!resto[0]) return { codigo: 1, texto: 'Falta el directorio de destino.' }; const r = ledger.exportar(path.resolve(resto[0])); return ok(`Exportado: ${r.eventos} eventos (${r.sha256Archivo.slice(0, 19)}…).`, r); }
        if (sub === 'restaurar') { if (!resto[0] || !resto[1]) return { codigo: 1, texto: 'Uso: ledger restaurar <origen> <destino>' }; const r = LedgerLocal.restaurar(path.resolve(resto[0]), path.resolve(resto[1])); return ok(`Restaurado y verificado: ${r.eventos} eventos.`, r); }
        return { codigo: 1, texto: 'Uso: ledger verificar | recuperar | copia <dir> | exportar <dir> | restaurar <origen> <destino>' };
      }
      default: return { codigo: 1, texto: `Comando desconocido «${cmd}».\n${USO}` };
    }
  } catch (e) {
    if (e instanceof ErrorProtocolo) return { codigo: 2, texto: `Rechazado: ${e.error.mensaje} [${e.codigo}]`, datos: e.error };
    if (e instanceof ErrorLedger) return { codigo: 2, texto: `Ledger: ${e.message} [${e.codigo}]` };
    throw e;
  }
}

/** Divide una línea respetando comillas dobles. */
export function dividirLinea(texto) {
  const partes = [];
  const rx = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = rx.exec(texto))) partes.push(m[1] !== undefined ? m[1] : m[2]);
  return partes;
}

const COMANDOS_CONSOLA = new Set(['agentes', 'tareas', 'tarea', 'aprobar', 'rechazar', 'cancelar', 'parada', 'reanudar', 'reconciliar', 'informe', 'ledger', 'ayuda', 'help']);

async function consola(ctx, o, antesDeCadaOrden = async () => {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'director> ' });
  process.stdout.write('Director de Treidilor AI (F1, sin LLM; aprobaciones SIMULADAS). Escribe una instrucción, «ayuda» o «salir».\n');
  rl.prompt();
  for await (const l of rl) {
    const texto = l.trim();
    if (['salir', 'exit', 'quit'].includes(texto.toLowerCase())) break;
    if (texto) {
      try { await antesDeCadaOrden(); } catch (e) { process.stdout.write(`No se pudo consultar el lector: ${e.message || e.error?.mensaje}\n`); rl.prompt(); continue; }
      const partes = dividirLinea(texto);
      const { pos, o: oLinea } = opciones(partes);
      const esComando = (COMANDOS_CONSOLA.has(pos[0]) && (pos[0] !== 'informe' || ['04', '12'].includes(pos[1]))) || (pos[0] === 'integridad' && (pos.length === 1 || SUBCOMANDOS_INTEGRIDAD.includes(pos[1])));
      const r = esComando ? ejecutarComando(pos, { ...o, ...oLinea }, ctx) : ejecutarComando(['preguntar', texto], o, ctx);
      process.stdout.write(`${r.texto}\n`);
    }
    rl.prompt();
  }
  rl.close();
}

export async function main(argv = process.argv.slice(2)) {
  const { pos, o } = opciones(argv);
  if (!pos.length || pos[0] === 'ayuda' || o.help) { process.stdout.write(`${USO}\n`); return 0; }
  let ctx;
  try {
    const motor = await cargarMotor().catch(() => null); // sin el cargador de TypeScript el Agente 03 se declara no disponible
    const motorPrecios = await cargarMotorPrecios().catch(() => null);
    const motorPortada = await cargarMotorPortada().catch(() => null);
    const motorAnalitica = await cargarMotorAnalitica().catch(() => null);
    const motorMarketing = await cargarMotorMarketing().catch(() => null);
    const motorContenido = await cargarMotorContenido().catch(() => null);
    const motorCompetencia = await cargarMotorCompetencia().catch(() => null);
    const motorNichos = await cargarMotorNichos().catch(() => null);
    ctx = construirDirector(o, process.env, motor, motorPrecios, motorPortada, motorAnalitica, motorMarketing, motorContenido, motorCompetencia, motorNichos);
  } catch (e) {
    if (e instanceof ErrorLedger || e instanceof ErrorProtocolo) { process.stderr.write(`No se pudo iniciar: ${e.message}\n`); return 1; }
    throw e;
  }
  let antes = async () => {};
  try {
    if (modoLector(o) === 'real') {
      const { lector, destino } = crearLectorReal(o);
      ctx.director.lector = lector;
      antes = async () => { await refrescarLectorReal(ctx.director, lector, destino); };
      process.stderr.write(`MODO LECTOR REAL (solo lectura de 04 y 12) · destino ${destino}\n`);
    }
  } catch (e) {
    if (e instanceof ErrorLedger || e instanceof ErrorProtocolo) { process.stderr.write(`No se pudo activar el modo lector: ${e.message || e.error?.mensaje}\n`); return 1; }
    throw e;
  }
  if (o.ahora) process.stderr.write('AVISO: --ahora fija el reloj (solo para pruebas); no lo uses con el ledger real.\n');
  if (pos[0] === 'consola') { await consola(ctx, o, antes); return 0; }
  try { if (['informe', 'preguntar', 'tarea', 'canal'].includes(pos[0])) await antes(); } catch (e) { if (e instanceof ErrorLedger || e instanceof ErrorProtocolo) { process.stderr.write(`No se pudo consultar el lector: ${e.message || e.error?.mensaje}\n`); return 1; } throw e; }
  if (pos[0] === 'canal') {
    const canal = new Canal13({ director: ctx.director });
    const sub = pos[1];
    let m;
    if (sub === 'hablar') {
      const texto = pos.slice(2).join(' ');
      if (!texto.trim()) { process.stdout.write('Falta el texto de la instrucción.\n'); return 1; }
      m = await canal.recibir(texto);
    } else if (sub === 'estado') m = canal.estado();
    else if (sub === 'consumo') m = canal.consumo();
    else if (sub === 'suscripciones') m = canal.suscripciones();
    else if (sub === 'optimizar') m = canal.optimizar();
    else if (sub === 'autorizaciones') m = await canal.recibir('¿Qué autorizaciones hay pendientes?');
    else if (sub === 'decidir') {
      if (!pos[2] || !['aprobada', 'rechazada'].includes(pos[3])) { process.stdout.write('Uso: canal decidir <idAprobacion> aprobada|rechazada\n'); return 1; }
      m = canal.decidir(pos[2], pos[3], {});
    } else { process.stdout.write('Uso: canal hablar "<texto>" | estado | consumo | suscripciones | optimizar | autorizaciones | decidir <id> aprobada|rechazada\n'); return 1; }
    process.stdout.write(o.json ? `${JSON.stringify(m, null, 2)}\n` : `${renderTexto(m)}\n`);
    return 0;
  }
  if (pos[0] === 'integridad' && pos[1] === 'ejecutar') { // 3E.8.11: ejecución manual en DOS etapas; solo por línea de comandos y cargada bajo demanda (la consulta nunca importa el supervisor)
    const { ejecutarManualConsola } = await import('../../automation/director/integridad/ejecutar-manual.mjs');
    const r = await ejecutarManualConsola({ o, ledgerDir: ctx.ledger.dir, env: process.env, ahora: ctx.director.ahora() });
    process.stdout.write(o.json ? `${JSON.stringify({ codigo: r.codigo, texto: r.texto, datos: r.datos ?? null }, null, 2)}\n` : `${r.texto}\n`);
    return r.codigo;
  }
  if (pos[0] === 'evaluar') {
    const { resultados, resumen } = await ejecutarBateria({ solo: o.caso || null });
    const lineas = resultados.map((x) => `${x.id} ${x.critico ? 'C' : ' '} ${x.estado.padEnd(32)} ${x.titulo}`).join('\n');
    process.stdout.write(o.json ? `${JSON.stringify({ resultados, resumen }, null, 2)}\n` : `${lineas}\n${JSON.stringify(resumen.porEstado)} fallos: ${resumen.fallos.length}\n${resumen.veredicto}\n`);
    return resumen.fallos.length ? 2 : 0;
  }
  if (pos[0] === 'evaluar-reales') {
    const plan = prepararPruebasReales();
    process.stdout.write(`${JSON.stringify({ ...plan, casos: plan.casos.map((c) => ({ caso: c.caso, critico: c.critico, tokensEntradaPorLlamada: c.tokensEntradaPorLlamada, evalua: c.evalua })) }, null, 2)}\nNO ejecutado: requiere consumo real activado, autorización de gasto, tarifa y transporte (hoy inexistentes).\n`);
    return 0;
  }
  if (pos[0] === 'preguntar' && ctx.director.cerebro) {
    const texto = pos.slice(1).join(' ');
    if (!texto.trim()) { process.stdout.write('Falta el texto de la instrucción.\n'); return 1; }
    const r = await ctx.director.procesarSolicitudAsync(texto);
    const nota = r.avisos.length ? `(${r.origenInterpretacion}; ${r.avisos.join(' · ')})\n` : '';
    process.stdout.write(o.json ? `${JSON.stringify({ codigo: 0, texto: r.texto, datos: { origen: r.origenInterpretacion, modo: r.modo, avisos: r.avisos } }, null, 2)}\n` : `${r.texto}\n${nota}`);
    return 0;
  }
  const r = ejecutarComando(pos, o, ctx);
  process.stdout.write(o.json ? `${JSON.stringify({ codigo: r.codigo, texto: r.texto, datos: r.datos ?? null }, null, 2)}\n` : `${r.texto}\n`);
  return r.codigo;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((c) => { process.exitCode = c; }, (e) => { process.stderr.write(`Error inesperado: ${e && e.message ? e.message : e}\n`); process.exitCode = 1; });
}
