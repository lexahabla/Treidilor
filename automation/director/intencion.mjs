/**
 * Agente 00 · INTERPRETACIÓN DE INSTRUCCIONES POR REGLAS (determinista; PURO). Es la RED DE SEGURIDAD del Director:
 *  · F1.4: único intérprete (sin LLM).
 *  · F1.5: cuando hay modelo, este módulo sigue ejecutándose como SUELO: lo que detecta como acción L4, cambio de nivel, petición de
 *    credenciales o ejecución autónoma NO puede relajarlo el modelo; y es el intérprete cuando no hay modelo (presupuesto agotado,
 *    consumo desactivado, proveedor caído).
 * Convierte una frase en una INTENCIÓN; no ejecuta nada ni decide permisos (eso lo hacen el registro y la matriz). Lo ambiguo se pregunta.
 * Los datos (informes, fichas, páginas) nunca pasan por aquí: solo el texto del propietario.
 */
const plano = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export const TIPOS_INTENCION = Object.freeze([
  'ayuda', 'estado_agentes', 'estado_agente', 'listar_tareas', 'estado_tarea', 'consultar_informe', 'consultar_propuestas_reparacion', 'listar_informes', 'comparar_informes', 'resumen_general', 'balance',
  'lanzar_auditoria', 'detener', 'parada_total', 'conversacion', 'agente_no_operativo', 'accion_humana', 'accion_ambigua', 'confirmacion_vaga', 'cambio_nivel', 'pide_credencial',
  'peticion_desproporcionada', 'consultar_suscripciones', 'recomendar_suscripciones', 'estudiar_afiliacion', 'comparar_afiliacion', 'analizar_importacion', 'simular_importacion', 'analizar_precios', 'proponer_portada', 'guardar_borrador_portada', 'analizar_analitica', 'listar_aprobaciones', 'proponer_plan_campanas', 'redactar_brief', 'auditar_seo', 'revisar_texto_publicitario', 'proponer_borrador_ficha', 'proponer_recursos_visuales', 'proponer_borrador_historia', 'proponer_borrador_redes', 'revisar_pieza', 'validar_observaciones', 'detectar_huecos', 'comparar_precios_observados', 'informe_competencia', 'analizar_oportunidades_nicho', 'estudiar_viabilidad_nicho', 'investigar_candidatos', 'ejecucion_autonoma', 'desconocida',
]);
export const TEMAS = Object.freeze(['reparto_comercio', 'numero_productos', 'workflow', 'plan', 'repetir']);
const NIVEL = { L0: 0, L1: 1, L2: 2, L3: 3, L4: 4 };

/** Riesgo máximo por tipo de intención: lo fija el CÓDIGO, nunca el modelo. */
export const RIESGO_POR_TIPO = Object.freeze({
  ayuda: 'L0', estado_agentes: 'L0', estado_agente: 'L0', listar_tareas: 'L0', estado_tarea: 'L0', consultar_informe: 'L0', consultar_propuestas_reparacion: 'L0', listar_informes: 'L0', comparar_informes: 'L0', resumen_general: 'L0', balance: 'L0',
  peticion_desproporcionada: 'L0', consultar_suscripciones: 'L0', recomendar_suscripciones: 'L1', estudiar_afiliacion: 'L1', comparar_afiliacion: 'L1', analizar_importacion: 'L1', simular_importacion: 'L2', analizar_precios: 'L1', proponer_portada: 'L1', guardar_borrador_portada: 'L3', analizar_analitica: 'L0', listar_aprobaciones: 'L0', proponer_plan_campanas: 'L1', redactar_brief: 'L1', auditar_seo: 'L1', revisar_texto_publicitario: 'L0', proponer_borrador_ficha: 'L1', proponer_recursos_visuales: 'L1', proponer_borrador_historia: 'L1', proponer_borrador_redes: 'L1', revisar_pieza: 'L0', validar_observaciones: 'L0', detectar_huecos: 'L1', comparar_precios_observados: 'L1', informe_competencia: 'L1', analizar_oportunidades_nicho: 'L1', estudiar_viabilidad_nicho: 'L1', investigar_candidatos: 'L1', desconocida: 'L0', conversacion: 'L1', agente_no_operativo: 'L1', lanzar_auditoria: 'L2', detener: 'L2', parada_total: 'L2', confirmacion_vaga: 'L2',
  cambio_nivel: 'L3', accion_humana: 'L4', accion_ambigua: 'L4', pide_credencial: 'L4', ejecucion_autonoma: 'L4',
});
export const nivelMayor = (a, b) => (NIVEL[a] >= NIVEL[b] ? a : b);
/** Tipos que el modelo NO puede relajar: si las reglas los detectan, mandan las reglas. */
export const TIPOS_SUELO = Object.freeze(['accion_humana', 'ejecucion_autonoma', 'cambio_nivel', 'pide_credencial', 'accion_ambigua']);

const PLANIFICADOS = [
  ['05', /\b(precios?|ofertas?|bajad[ao]s? de precio|descuentos?)\b/], ['02', /\b(afiliacion|awin|programa de afiliacion|programas de afiliados)\b/], ['01', /\b(tendencias?|investigador)\b/],
  ['03', /\b(importador)\b/], ['06', /\b(portada|historias|categorias)\b/], ['07', /\b(redes sociales|seo|marketing|publicaciones|campanas?|black friday|publicidad)\b/], ['08', /\b(imagenes|contenido visual|recursos visuales|videos?|creatividades?)\b/],
  ['09', /\b(competencia|competidores|expertos)\b/], ['10', /\b(analitica|conversion(es)?|trafico)\b/], ['11', /\b(webs? nicho|nichos?)\b/],
];

const RX = {
  ayuda: /\b(ayuda|que puedes|que sabes hacer|comandos|como funciona)\b/,
  agentes: /\b(agentes?|capacidades|registro de agentes|quien esta operativo|que agentes)\b/,
  tareas: /\b(tareas?|pendientes|en curso|cola)\b/,
  calidad: /\b(calidad|catalogo|fichas?|productos?|comercio|categorias?|duplicados?|hallazgos?|problemas?)\b/,
  propuestas04: /\b(propuestas? de (reparaci[oó]n|correcci[oó]n)|correcciones? pendientes?|reparaciones? (del )?(agente )?04|propuestas (de )?(04|calidad))\b/,
  auditor: /\b(auditor|auditoria general|salud|sitio|web|rutas?|enlaces?|disponibilidad|despliegue|caida)\b/,
  informe: /\b(informe|informes|resultado|resultados|ultima|ultimo|auditoria|estado)\b/,
  historial: /\b(historial|historico|historicos|anteriores|todos los informes|lista(r)? los informes|ejecuciones)\b/,
  comparar: /\b(compar\w+|diferenc\w+|que ha cambiado|que cambio|cambios? entre|evolucion|nuevas incidencias|resueltas)\b/,
  lanzar: /\b(lanza|lanzar|ejecuta|ejecutar|inicia|iniciar|haz|hacer|realiza|realizar|pasa|pasar|genera|generar|nueva|nuevo|vuelve a)\b.*\b(auditoria|auditar|revision|analisis|informe)\b|\b(audita|auditar|revisa|revisar)\b/,
  humana: /\b(publica\w*|importa|importe|importar|importen|importalo|importame|corrige\w*|repara\w*|aplica\w* (las )?correcciones|cambia\w* (los )?precios?|borra\w*|elimina\w*|activa\w*|desactiva\w*|programa(?!s? de afiliac)\w*|despliega\w*|rota\w*|crea\w* (un )?(token|credencial)\w*|credenciales?|tokens?|afiliarme|afiliate|date de alta|solicita\w* (el )?alta|hazte (una )?cuenta|registrame|registrate)\b/,
  autonoma: /\b(cada (noche|dia|hora|semana|mes|manana|tarde)|todas las (noches|semanas|mananas)|automaticamente|tu solo|tu sola|sin preguntarme|sin que te lo pida|sin pedirme|siempre que|programa(da)?s?(?! de afiliac)|periodicamente|en segundo plano)\b/,
  presente: /\b(ahora|hoy|actual|actualmente|como esta|esta bien|ultimo|ultima|en este momento|hay algun problema)\b/,
  decision: /\b(deberia|conviene|puedo|lanzo|importo|publico|es seguro|me fio)\b/,
  historica: /\b(historico|anterior|anteriores|(?:ex|fx)-[0-9a-z]+|que mostro|hace|evolucion|cambio entre|compar\w+)\b/,
  conversacion: /\b(que opinas|opinas|ideas? para|dame ideas|tiene sentido|que te parece|lluvia de ideas|debatamos|estrategia|enfoque)\b/,
  resumenGeneral: /\b(estado general|todo bien|todo esta bien|como va todo|resumen general|estado de todo|todo ok)\b/,
  estadoAgente: /\b(funcionando|desplegad[oa]|operativ[oa]|en produccion|que puede hacer|que hace)\b/,
  repartoComercio: /\b(cada (comercio|tienda|red)|por (comercio|tienda|red)|reparto (por|de) (comercio|tienda|red))\b/,
  numeroProductos: /\bcuantos productos (hay|tenemos|tiene)\b/,
  ambigua: /^(arregla|soluciona|resuelve|mejora|actualiza)\b/,
  confirmacion: /^(vale,? |ok,? |si,? |de acuerdo,? )?(hazlo|adelante|dale|procede|me gusta (tu )?propuesta,? ?(adelante)?|si,? ?publicalo)\b/,
  cambioNivel: /\b(pon|poner|baja|bajar|cambia|cambiar|rebaja|quita|quitar|elimina)\b.*\b(nivel|l0|l1|confirmaciones?|aprobaciones?)\b/,
  pideCredencial: /\b(dime|dame|muestrame|cual es|revela|ensename)\b.*\b(valor|token|clave|credencial|contrasena|password|api key)\b/,
  detener: /^(para|deten|detener|cancela|aborta)\b.*\b(auditoria|tarea|tareas|ejecucion|en marcha)\b/,
  paradaTotal: /^(para todo|parada de emergencia|detenlo todo|cancela todo|detener todo)\b/,
  balance: /\b(que hemos hecho|balance|resumen de la semana|que se ha hecho|que hicimos)\b/,
  estadoTarea: /\b(ya esta|ya termino|ha terminado|como va|en que estado esta|sigue en curso)\b.*\b(auditoria|tarea)\b/,
  desproporcionada: /\b(resume|resumeme|resumir)\b.*\b(todo|completo|entero)\b.*\b(historial|proyecto|historia)\b/,
  workflow: /\bworkflows?\b/,
  suscripciones: /\b(suscripcion(es)?|planes? de ia|consumo de ia|gasto en ia|cuanto (llevo |he |hemos )?gast\w+|presupuesto (de|para|en) (la )?(ia|api)|ahorr\w+ (en|de) (la )?(ia|api)|creditos|tokens|api de pago|claude pro|cuotas? de ia|limites? de uso|openai|claude)\b/,
  recomienda: /\b(recomienda\w*|mejor combinacion|optimiza\w*|alternativas?|conviene|que me aconsejas)\b/,
  afiliacion: /\b(afiliacion|afiliados|programas? de afiliados?|redes? de afiliacion|awin|admitad|tradedoubler|kwanko|associates|partner network|commission junction|cj affiliate|comisiones?)\b/,
  comparaAfil: /\b(compara\w*|mejor(es)?|cual(es)?|ranking|conviene|ordena\w*|entre)\b/,
  precios05: /\b(precios?|ofertas?|descuentos?|rebajas?|bajadas?|bajado|chollos?|ahorr\w+|mas barat\w+|caidas? de precio)\b/,
  verbo05: /\b(analiza\w*|detecta\w*|compara\w*|vigila\w*|ha bajado|han bajado|hay (alguna |algun )?(oferta|bajada|chollo|descuento)\w*|oportunidad\w*|cuanto (puedo )?ahorr\w*|dudos\w*|anomal\w*|falso\w*|verificad\w*|donde (esta|sale) mas barat\w*|mejor precio)\b/,
  analitica10: /\b(analitica|conversion(es)?|trafico|visitas|clics?|tasa de clic|rebote|sesiones|embudo|rendimiento comercial|que (productos|fichas) (se )?(ven|visitan|convierten))\b/,
  verbo10: /\b(analiza\w*|como (va|van|esta|estan)|dime|muestra\w*|resumen|rendimiento|tendencias?|cuantas?|cuanto|evolucion|que tal|informe|oportunidades?|experimentos?|mejorar|mejor|peor|optimiza\w*)\b/,
  consumoTokens: /\b(cuantos|cuantas) (tokens|llamadas)\b|\btokens (consumidos|gastados|usados)\b|\bconsumo de tokens\b/,
  eludir: /\b(ignora\w*|olvida\w*|salta\w*|evita\w*|sin)\b.{0,25}\b(reglas|permisos|confirm\w+|aprob\w+|autoriz\w+|limites|restricciones|el ledger|registro)\b|\b(actua |comportate )?como (administrador|admin|root|el propietario)\b|\bsoy (el |tu )?(administrador|admin|propietario|dueno|jefe)\b.{0,40}\b(aprueba|autoriza|ejecuta|confirma|hazlo)\b|\b(modo|mode) (dios|admin|desarrollador|developer)\b/,
  modIA: /\b(cambia\w*|modifica\w*|sube|subir|baja|bajar|pon|poner|aumenta\w*|reduce\w*)\b.{0,25}\b(presupuesto|proveedor|tope|limite|plan|modelo) (de |del |para |en )?(la )?(ia|api|mensual|diario)?\b|\b(contrata\w*|suscribe\w*|suscribete|da de alta (una )?(suscripcion|api))\b|\bcambia\w* (a|de) (otro )?(proveedor|modelo|plan)\b/,
  aprobaciones: /\b(autorizaci\w+|aprobaci\w+|solicitud(es)? de (autorizacion|aprobacion))\b.{0,30}\b(pendiente\w*|esperando|hay|cuales|tengo|lista\w*)\b|\b(pendiente\w*|esperando)\b.{0,20}\b(autorizaci\w+|aprobaci\w+)\b|\bque (debo|tengo que|puedo) (aprobar|autorizar)\b/,
  envioPublicidad: /\b(env[ií]a\w*|manda\w*|dispara\w*|lanza\w*|programa\w*)\b.{0,40}\b(email|emails|correo|correos|newsletter|mensaje|mensajes|sms|notificaci\w+|campana|campanas|anuncio|anuncios|publicidad)\b|\b(invierte|invertir|gasta|gastar|paga|pagar|contrata|contratar)\b.{0,30}\b(publicidad|anuncios?|ads|campana|campanas)\b/i,
  revisaTexto07: /\b(revisa\w*|comprueba\w*|valida\w*|analiza\w*|audita\w*)\b.{0,40}\b(texto|copy|anuncio|mensaje|descripcion)\b.{0,30}\b(publicitari\w*|publicidad|campana|promocional|marketing|email|newsletter)\b|\b(revisa\w*|comprueba\w*|valida\w*)\b.{0,15}\b(este|mi|el) (texto|copy|anuncio)\b/,
  brief07: /\b(redacta\w*|prepara\w*|elabora\w*|escribe\w*|dame|genera\w*)\b.{0,30}\bbrief\b|\bbrief\b.{0,30}\bcampana\b/,
  seo07: /\b(auditoria|audita\w*|revisa\w*|analiza\w*)\b.{0,25}\bseo\b|\bseo\b.{0,25}\b(fichas|contenido|titulos|descripciones)\b/,
  plan07: /\b(plan(ifica\w*)?|propon\w*|prepara\w*|calendario)\b.{0,30}\b(campanas?|marketing)\b/,
  pieza08: /\b(revisa\w*|comprueba\w*|valida\w*)\b.{0,25}\b(pieza|contenido|borrador|publicacion|post|historia)\b/,
  ficha08: /\b(redacta\w*|escribe\w*|prepara\w*|propon\w*)\b.{0,30}\b(descripcion|ficha|titulo|texto)\b/,
  recursos08: /\b(propon\w*|sugiere\w*|prepara\w*|busca\w*)\b.{0,30}\b(imagen|imagenes|foto|fotos|recursos visuales)\b/,
  historia08: /\b(redacta\w*|escribe\w*|prepara\w*|propon\w*)\b.{0,25}\bhistoria\b.{0,30}\bcampana\b/,
  redes08: /\b(redacta\w*|escribe\w*|prepara\w*|propon\w*)\b.{0,25}\b(posts?|publicacion(es)?|textos?)\b.{0,25}\b(redes|instagram|facebook|tiktok|twitter)\b/,
  valida09: /\b(valida\w*|comprueba\w*|revisa\w*)\b.{0,30}\b(observaciones|fuentes citadas|fuentes de la competencia)\b/,
  huecos09: /\b(huecos?|oportunidades? editoriales?)\b.{0,40}\b(competencia|competidores|expertos|fuentes)\b|\b(competencia|competidores|expertos)\b.{0,40}\bhuecos?\b|\bdetecta\w*.{0,15}\bhuecos?\b/,
  precios09: /\bprecios?\b.{0,30}\b(observad\w*|competidores|competencia|rivales)\b|\b(competidores|competencia|rivales)\b.{0,30}\bprecios?\b/,
  informe09: /\b(informe|analisis|analiza\w*|resumen|estudia\w*)\b.{0,30}\b(competencia|competidores|expertos)\b|\b(competencia|competidores|expertos)\b.{0,20}\b(informe|analisis)\b/,
  externo09: /\b(scraping|rastrea\w*|espia\w*|visita\w*|descarga\w*|entra\w*|navega\w*)\b.{0,40}\b(web|webs|pagina|paginas|sitio|sitios|url|internet|competidor\w*|competencia)\b|\bconsulta\w*\b.{0,30}\b(web|webs|pagina|paginas|internet|url)\b|\b(en su web|en sus webs|en internet)\b/,
  crearWeb: /\b(crea\w*|monta\w*|lanza\w*|compra\w*|contrata\w*|registra\w*|abre\w*|despliega\w*)\b.{0,30}\b(web|webs|sitio|sitios|dominio|dominios|alojamiento|hosting|tienda online)\b/,
  viabilidad11: /\b(viabilidad|estudio de viabilidad|estudia\w*)\b.{0,40}\b(nicho|nichos)\b|\b(nicho|nichos)\b.{0,30}\bviabilidad\b/,
  oportunidades11: /\b(oportunidades?|analiza\w*|ordena\w*|compara\w*|prioriza\w*|que)\b.{0,30}\b(nicho|nichos)\b/,
  fuera11: /\b(estructura|esqueleto|arquitectura|mapa)\b.{0,30}\b(sitio|web|nicho)\b|\bestrategia de contenidos?\b/,
  investigar01: /\b(investiga\w*|busca\w*|detecta\w*|identifica\w*|propon\w*|encuentra\w*|dame|muestra\w*)\b.{0,35}\b(candidatos?|tendencias?|productos? (con potencial|a destacar|interesantes|para destacar))\b|\b(candidatos?|tendencias?)\b.{0,25}\b(comerciales?|del catalogo|de productos?)\b|\b(que|cuales|hay)\b.{0,20}\btendencias?\b/,
  nicho11: /\b(nicho|nichos|viabilidad)\b/,
  competencia09: /\b(competenc\w+|competidor\w*|rival\w*|experto\w*|scraping|rastrea\w*|espia\w*)\b/,
  contenido08: /\b(redacta\w*|escribe\w*|genera\w*|crea\w*|dise[nñ]a\w*|propon\w*|sube\w*|subir|prepara\w*)\b.{0,40}\b(descripcion|descripciones|texto|textos|imagen|imagenes|foto|fotos|video|videos|post|posts|publicacion|publicaciones|historia|historias|guia|guias|banner|creatividad)\b/,
  portada06: /\b(portada|historias?|categorias?)\b/,
  verbo06: /\b(propon\w*|propuesta|disena\w*|prepara\w*|sugier\w*|sugiere\w*|organiza\w*|analiza\w*|revisa\w*|estructura\w*|ordena\w*)\b/,
  guarda06: /\b(guarda\w*|deja\w*|prepara\w*)\b.*\bborrador\b|\bborrador\b.*\b(guarda\w*|deja\w*)\b/,
  importacion03: /\b(importacion|importaciones|importar|lote|dry ?run)\b/,
  verbo03: /\b(simula\w*|analiza\w*|prepara\w*|propon\w*|propuesta|evalua\w*|comprueba\w*|valida\w*|detecta\w*|revisa\w*|dry ?run)\b/,
  repetir: /\b(lanzala|ejecutala|repitela|vuelve a lanzarla|hazla otra vez)\b/,
  agenteSinNumero: /\b(lanza|ejecuta|arranca|inicia)\b.*\bagente\b(?!\s*\d)/,
  secuencial:/\b(cuando (acabe|termine|finalice)|despues|luego|a continuacion|y despues)\b/,
};

export const MAX_ENTRADA_IMPORTACION = 20000;
/** Extrae del TEXTO del propietario la entrada de una importación: un bloque JSON válido, una URL o un ASIN (en ese orden). No abre nada. */
/** Texto entre comillas («…», "…", “…”) o lo que sigue a los dos puntos; null si no hay. Máx. 4000 caracteres (si es más largo, se devuelve igualmente para que el Director lo rechace). */
export function extraerTextoPublicitario(texto) {
  const t = String(texto ?? '');
  const q = /«([^»]+)»|"([^"]+)"|“([^”]+)”/.exec(t);
  if (q) return (q[1] ?? q[2] ?? q[3]).trim() || null;
  const i = t.indexOf(':');
  return i >= 0 && t.slice(i + 1).trim() ? t.slice(i + 1).trim() : null;
}

export function extraerEntradaImportacion(texto) {
  const t = String(texto ?? '');
  const a = t.search(/[[{]/);
  const b = Math.max(t.lastIndexOf(']'), t.lastIndexOf('}'));
  if (a >= 0 && b > a) {
    const frag = t.slice(a, b + 1);
    if (frag.length <= MAX_ENTRADA_IMPORTACION) { try { JSON.parse(frag); return frag; } catch { /* no es JSON */ } }
  }
  const u = /https?:\/\/[^\s"'<>]+/.exec(t);
  if (u) return u[0];
  const asin = /\bB0[A-Z0-9]{8}\b/i.exec(t);
  return asin ? asin[0].toUpperCase() : null;
}

const idEjecucion = (t) => {
  const m = /\b((?:ex|fx)-[0-9a-z]+(?:-[0-9a-z]+)*)\b/.exec(t);
  return m ? m[1] : null;
};
const agentePorNumero = (t) => {
  const m = /\bagente\s*(?:numero\s*)?(\d{1,2})\b/.exec(t);
  return m ? m[1].padStart(2, '0') : null;
};

/** Devuelve la intención: { tipo, agentes[], parametros, tema, pregunta, ambiguedad|null, riesgoMax, aclaracion|null, textoPlano }. */
export function interpretar(texto) {
  const original = String(texto ?? '');
  const t = plano(original);
  const base = { tipo: 'desconocida', agentes: [], parametros: {}, tema: null, pregunta: 'presente', ambiguedad: null, riesgoMax: 'L0', aclaracion: null, textoPlano: t };
  const con = (tipo, extra = {}) => ({ ...base, tipo, riesgoMax: RIESGO_POR_TIPO[tipo], ...extra });
  if (!t) return { ...base, aclaracion: 'La instrucción está vacía.' };

  const numero = agentePorNumero(t);
  const agentes = [];
  if (numero && ['04', '12'].includes(numero)) agentes.push(numero);
  if (RX.calidad.test(t) && !agentes.includes('04')) agentes.push('04');
  if (RX.auditor.test(t) && !agentes.includes('12')) agentes.push('12');
  // El orden de los agentes sigue el orden en que se nombran en la frase (importa para «primero X y luego Y»).
  agentes.sort((a, b) => (t.search(a === '04' ? RX.calidad : RX.auditor) - t.search(b === '04' ? RX.calidad : RX.auditor)));
  const ej = idEjecucion(t);
  const parametros = ej ? { idEjecucion: ej } : {};

  // 0) Cambio de nivel y petición de credenciales: el modelo no puede relajarlas.
  if (RX.pideCredencial.test(t)) return con('pide_credencial');
  if (RX.cambioNivel.test(t) && !RX.humana.test(t.replace(/\b(elimina|activa\w*)\b/g, ''))) return con('cambio_nivel');
  // 1) Workflows: modificarlos, activarlos o programarlos es L4 humano (antes que «ejecución autónoma»).
  if (RX.workflow.test(t) && /\b(modifica|cambia|edita|activa\w*|programa\w*|crea|borra|elimina)\b/.test(t)) return con('accion_humana', { tema: 'workflow', agentes });
  // 2) Parada de emergencia y detención: siempre permitidas, sin aprobación.
  if (RX.paradaTotal.test(t)) return con('parada_total');
  if (RX.detener.test(t)) return con('detener', { agentes });
  // 3) Ejecución autónoma o programada: NO autorizada.
  if (RX.autonoma.test(t) && (RX.lanzar.test(t) || RX.humana.test(t) || /\b(hazlo|ejecutalo|revisa|audita|lanza)\b/.test(t))) return con('ejecucion_autonoma', { aclaracion: 'La ejecución autónoma o programada de agentes no está autorizada.' });
  // 4) Acciones sobre el sistema (L4) y verbos ambiguos.
  // 3a) Canal del propietario (Agente 13): intentos de saltarse permisos, cambios de presupuesto/proveedor (L4 humano), consumo y autorizaciones pendientes.
  if (RX.eludir.test(t)) return con('cambio_nivel', { aclaracion: 'Se ha intentado eludir permisos, confirmaciones o registro: no se puede.' });
  if (RX.envioPublicidad.test(t)) return con('accion_humana', { aclaracion: 'Enviar mensajes, lanzar campañas o invertir en publicidad es una acción humana (L4): ningún agente ni este canal la ejecuta.' });
  // 3e) Agente 08 (contenido y recursos visuales): L1 de borradores y L0 de revisión; generar imágenes, publicar o subir siguen sin capacidad (3g) o son L4 humano.
  if (!RX.humana.test(t) && !RX.envioPublicidad.test(t)) {
    const limpiar = (x) => x.trim().replace(/^((del|de la|de los|de las|de|el|la|los|las|producto|ficha)\s+)+/, '');
    const campana = (/campana (?:de |del |para |de la |de los )?([a-z0-9][a-z0-9 -]{1,58})$/.exec(t.replace(/[.?!]+$/, '')) || [])[1];
    if (RX.pieza08.test(t) && !RX.portada06.test(t.replace(/historias?/g, ''))) { const txt = extraerTextoPublicitario(original); const urls = String(original).replace(/«[^»]*»|"[^"]*"|“[^”]*”/g, ' ').match(/https?:\/\/[^\s»"”]+/); return con('revisar_pieza', { agentes: ['08'], parametros: { ...(txt ? { entrada: txt } : {}), ...(urls ? { imagenUrl: urls[0].slice(0, 300) } : {}) } }); }
    if (RX.historia08.test(t)) return con('proponer_borrador_historia', { agentes: ['08'], parametros: campana ? { campana: campana.trim() } : {} });
    if (RX.redes08.test(t)) return con('proponer_borrador_redes', { agentes: ['08'], parametros: campana ? { campana: campana.trim() } : {} });
    if (RX.recursos08.test(t) && !RX.seo07.test(t) && !RX.portada06.test(t.replace(/historias?/g, ''))) { const m = /(?:imagen(?:es)?|fotos?|recursos visuales)(?: del| de la| de el| de los| de las| de| para)? ?(?:producto |ficha )?([a-z0-9][a-z0-9 -]{1,58})$/.exec(t.replace(/[.?!]+$/, '')); return con('proponer_recursos_visuales', { agentes: ['08'], parametros: m ? { producto: limpiar(m[1]) } : {} }); }
    if (RX.ficha08.test(t) && !RX.portada06.test(t.replace(/historias?/g, '')) && !RX.seo07.test(t) && !RX.brief07.test(t) && !RX.plan07.test(t) && !/(informe|informes|auditoria|calidad|resumen|estado)/.test(t)) { const m = /(?:descripcion|ficha|titulo|texto)(?: del| de la| de el| de)? ?(?:producto |ficha )?([a-z0-9][a-z0-9 -]{1,58})$/.exec(t.replace(/[.?!]+$/, '')); return con('proponer_borrador_ficha', { agentes: ['08'], parametros: m ? { producto: limpiar(m[1]) } : {} }); }
  }
  // 3f) Agente 07 (marketing y SEO): L1 de propuesta y L0 de revisión de texto; publicar, enviar e invertir se detectaron arriba como L4 humano.
  if (!RX.humana.test(t)) {
    if (RX.revisaTexto07.test(t)) { const txt = extraerTextoPublicitario(original); return con('revisar_texto_publicitario', { agentes: ['07'], parametros: txt ? { entrada: txt } : {} }); }
    if (RX.brief07.test(t)) { const m = /campana (?:de |del |para |de la |de los )?([a-z0-9][a-z0-9 -]{1,58})$/.exec(t.replace(/[.?!]+$/, '')); return con('redactar_brief', { agentes: ['07'], parametros: m ? { campana: m[1].trim() } : {} }); }
    if (RX.seo07.test(t)) return con('auditar_seo', { agentes: ['07'] });
    if (RX.plan07.test(t)) return con('proponer_plan_campanas', { agentes: ['07'] });
  }
  if (RX.investigar01.test(t) && RX.externo09.test(t) && !RX.humana.test(t) && !RX.nicho11.test(t) && !RX.competencia09.test(t)) return con('agente_no_operativo', { agentes: ['01'] }); // buscar tendencias en la web = fuente externa: sin capacidad (v2.5)
  // 3j) Agente 01 (investigador): candidatos e hipótesis comerciales (v0 de reglas); nunca importa nada (importar es L4 humano).
  if (RX.investigar01.test(t) && !RX.humana.test(t) && !RX.envioPublicidad.test(t) && !RX.crearWeb.test(t) && !RX.nicho11.test(t) && !RX.competencia09.test(t) && !RX.externo09.test(t)) return con('investigar_candidatos', { agentes: ['01'] });
  // 3i) Agente 11 (webs nicho): sin capacidades aprobadas → se explica que no está operativo; nunca se cae a los informes del 04/12.
  if (RX.nicho11.test(t) && !RX.humana.test(t) && !RX.envioPublicidad.test(t) && !RX.crearWeb.test(t) && !RX.fuera11.test(t)) {
    if (RX.viabilidad11.test(t)) return con('estudiar_viabilidad_nicho', { agentes: ['11'] });
    if (RX.oportunidades11.test(t)) return con('analizar_oportunidades_nicho', { agentes: ['11'] });
  }
  if ((RX.nicho11.test(t) || RX.fuera11.test(t)) && !RX.humana.test(t) && !RX.envioPublicidad.test(t) && !RX.crearWeb.test(t)) return con('agente_no_operativo', { agentes: ['11'] });
  // 3h) Agente 09 (competencia y expertos): sin capacidades aprobadas → se explica que no está operativo; nunca se cae a los informes del 04/12 por palabras como «web».
  if (RX.competencia09.test(t) && !RX.humana.test(t) && !RX.envioPublicidad.test(t) && !RX.externo09.test(t)) {
    if (RX.valida09.test(t)) return con('validar_observaciones', { agentes: ['09'] });
    if (RX.huecos09.test(t)) return con('detectar_huecos', { agentes: ['09'] });
    if (RX.precios09.test(t)) return con('comparar_precios_observados', { agentes: ['09'] });
    if (RX.informe09.test(t)) return con('informe_competencia', { agentes: ['09'] });
  }
  if (RX.competencia09.test(t) && !RX.humana.test(t) && !RX.envioPublicidad.test(t)) return con('agente_no_operativo', { agentes: ['09'] });
  // 3g) Agente 08 (contenido y recursos visuales): sin capacidades aprobadas → se explica que no está operativo; nunca se cae a otro agente (p. ej. «ficha» → informes del 04).
  if (RX.contenido08.test(t) && !RX.humana.test(t) && !RX.portada06.test(t)) return con('agente_no_operativo', { agentes: ['08'] });
  if (RX.crearWeb.test(t)) return con('accion_humana', { aclaracion: 'Crear una web, comprar un dominio o contratar alojamiento es una acción humana (L4): ningún agente ni este canal la ejecuta.' });
  if (RX.consumoTokens.test(t) && !RX.pideCredencial.test(t)) return con('consultar_suscripciones');
  if (RX.modIA.test(t) && /\b(ia|api|presupuesto|proveedor|tope|modelo|suscripci\w+|plan)\b/.test(t)) return con('accion_humana', { aclaracion: 'Cambiar presupuestos, proveedores, planes o suscripciones de IA es una acción humana (L4).' });
  if (RX.aprobaciones.test(t) && !RX.humana.test(t)) return con('listar_aprobaciones');
  // 3b) Agente 03 (importador): analizar, preparar o SIMULAR una importación (nunca ejecutarla: «importa…» a secas sigue siendo L4 humano, más abajo).
  if (RX.importacion03.test(t) && RX.verbo03.test(t)) {
    const parametros = {};
    const entrada = extraerEntradaImportacion(original);
    if (entrada) parametros.entrada = entrada;
    return con(/\bsimula\w*|\bdry ?run\b/.test(t) ? 'simular_importacion' : 'analizar_importacion', { agentes: ['03'], parametros });
  }
  // 3d) Agente 10 (analítica y conversión): lectura L0 de analítica AGREGADA; cualquier cambio sobre el sistema sigue siendo L4 humano (se detecta en `humana`).
  if (RX.analitica10.test(t) && RX.verbo10.test(t) && !RX.humana.test(t) && !RX.precios05.test(t) && !RX.importacion03.test(t) && !RX.portada06.test(t)) return con('analizar_analitica', { agentes: ['10'] });
  // 3c) Agente 06 (portada, historias y categorías): proponer (L1) o SIMULAR guardar el borrador (L3 reversible). Publicar/activar/reorganizar sigue siendo L4 humano (lo detecta `humana` más abajo).
  if ((RX.portada06.test(t) || (RX.guarda06.test(t) && /\bpropuesta\b/.test(t) && !RX.importacion03.test(t) && !RX.precios05.test(t) && !RX.afiliacion.test(t))) && !RX.humana.test(t.replace(/borrador(es)?/g, '')) && !/\bpublicalo\b/.test(t)) {
    if (RX.guarda06.test(t)) return con('guardar_borrador_portada', { agentes: ['06'] });
    if (RX.verbo06.test(t)) return con('proponer_portada', { agentes: ['06'] });
  }
  if (RX.confirmacion.test(t) && !RX.humana.test(t.replace(/publicalo/, ''))) return con('confirmacion_vaga');
  if (RX.humana.test(t) || /\bpublicalo\b/.test(t)) return con('accion_humana', { agentes, aclaracion: 'Es una acción sobre el sistema (L4): la ejecuta una persona en el panel.' });
  if (RX.ambigua.test(t)) return con('accion_ambigua', { agentes, ambiguedad: '¿Qué quieres exactamente?' });

  // 4a) Agente 02 (investigador de afiliación): estudiar o comparar programas (propuesta L1, solo informes; darse de alta es L4 humano y se detectó arriba).
  if (RX.afiliacion.test(t)) {
    const prog = /\b(amazon|aliexpress|ebay|awin|cj|commission junction|admitad|tradedoubler|kwanko|etsy)\b/.exec(t);
    const idProg = prog ? ({ 'commission junction': 'cj' }[prog[1]] || prog[1]) : null;
    const cat = /\bde (informatica|hogar|sonido)\b/.exec(t);
    const parametros = {};
    if (idProg) parametros.programa = idProg;
    if (cat) parametros.categoria = cat[1];
    return con(idProg && !RX.comparaAfil.test(t) ? 'estudiar_afiliacion' : 'comparar_afiliacion', { agentes: ['02'], parametros });
  }
  // 4a2) Agente 05 (analista de precios): solo informes y propuestas L1; cambiar o actualizar precios es L4 humano (se detectó arriba).
  if (RX.precios05.test(t) && RX.verbo05.test(t)) return con('analizar_precios', { agentes: ['05'] });
  // 4b) Suscripciones, planes y consumo de IA (informe del Agente 13): consulta L0 o recomendación L1; nunca contrata ni cambia nada.
  if (RX.suscripciones.test(t)) return con(RX.recomienda.test(t) ? 'recomendar_suscripciones' : 'consultar_suscripciones');
  // 5) Conversación estratégica (propuesta, sin tareas).
  if (RX.conversacion.test(t)) return con('conversacion', { pregunta: 'presente' });
  if (RX.desproporcionada.test(t)) return con('peticion_desproporcionada');

  // 6) Agentes planificados / estado de un agente concreto.
  if (numero && RX.estadoAgente.test(t + ' que puede hacer') && (RX.estadoAgente.test(t) || /que puede/.test(t))) return con('estado_agente', { agentes: [numero] });
  if (!numero && RX.estadoAgente.test(t) && agentes.length === 1) return con('estado_agente', { agentes });
  if (numero && !['04', '12'].includes(numero) && !RX.lanzar.test(t)) return con('estado_agente', { agentes: [numero] });
  if (RX.repetir.test(t)) return con('lanzar_auditoria', { agentes, pregunta: 'decision', tema: 'repetir' });
  if (RX.agenteSinNumero.test(t)) return con('accion_ambigua', { agentes, ambiguedad: '¿Qué agente? Indica su número (00–13).', parametros: { referencia: (/\bagente\s+([a-z]+)/.exec(t) || [])[1] || '' } });
  // 7) Lanzar una auditoría (L2).
  if (RX.lanzar.test(t) && !/\b(seo|marketing|campanas?|publicidad)\b/.test(t) && !RX.comparar.test(t) && !RX.historial.test(t) && !/\b(ultimo|ultima)\b/.test(t)) {
    const params = { ...parametros };
    const ent = /\bcontra (\w+)\b/.exec(t);
    if (ent) params.entorno = ent[1];
    const pag = /\b(\d+) paginas\b/.exec(t);
    if (pag) params.paginas = Number(pag[1]);
    const amb = agentes.length === 0 ? 'No indicas qué auditar: ¿calidad del catálogo (04) o salud del sitio (12)?' : agentes.length > 1 && !RX.secuencial.test(t) ? 'Indicas varios temas: ¿qué auditoría quieres lanzar, 04 o 12?' : null;
    return con('lanzar_auditoria', { agentes, parametros: params, pregunta: 'decision', ambiguedad: amb, tema: agentes.length > 1 && RX.secuencial.test(t) ? 'plan' : null });
  }
  if (RX.estadoTarea.test(t)) return con('estado_tarea', { agentes });
  if (RX.balance.test(t)) return con('balance');
  const pregunta = RX.decision.test(t) ? 'decision' : RX.comparar.test(t) || RX.historica.test(t) ? 'historica' : 'presente';
  if (RX.comparar.test(t)) return con('comparar_informes', { agentes, parametros, pregunta: 'historica', ambiguedad: agentes.length === 0 ? '¿Comparo los informes de calidad del catálogo (04) o los del auditor (12)?' : agentes.length > 1 ? 'Indicas varios temas: ¿04 o 12?' : null });
  if (RX.historial.test(t)) return con('listar_informes', { agentes, parametros, pregunta: 'historica', ambiguedad: agentes.length === 0 ? '¿Listo los informes de calidad (04) o los del auditor (12)?' : agentes.length > 1 ? 'Indicas varios temas: ¿04 o 12?' : null });
  if (RX.resumenGeneral.test(t)) return con('resumen_general', { agentes: ['04', '12'] });
  if (RX.agentes.test(t) && !RX.informe.test(t)) return con('estado_agentes');
  if (RX.tareas.test(t) && !RX.informe.test(t)) return con('listar_tareas');
  if (RX.ayuda.test(t)) return con('ayuda');
  const plan = PLANIFICADOS.find(([id, rx]) => rx.test(t) && !(id === '05' && agentes.length && /calidad/.test(t)));
  if (plan && agentes.length === 0) return con('agente_no_operativo', { agentes: [plan[0]] });
  if (plan && agentes.length && /\b(precios?|afiliacion|analitica|conversion(es)?|competencia|seo|marketing|campanas?|publicidad)\b/.test(t) && !/\b(calidad|catalogo|salud|sitio|web)\b/.test(t)) return con('agente_no_operativo', { agentes: [plan[0]] });
  if (RX.propuestas04.test(t)) {
    if (!agentes.includes('04')) agentes.push('04');
    return con('consultar_propuestas_reparacion', { agentes });
  }
  if (RX.informe.test(t) || agentes.length) {
    const tema = RX.repartoComercio.test(t) ? 'reparto_comercio' : RX.numeroProductos.test(t) ? 'numero_productos' : null;
    const ambiguo = agentes.length !== 1;
    return con('consultar_informe', { agentes, parametros, tema, pregunta, ambiguedad: ambiguo ? (agentes.length === 0 ? '¿Quieres el informe de calidad del catálogo (04) o el del auditor del sitio (12)?' : 'Indicas varios temas: ¿el informe de 04 o el de 12?') : null });
  }
  return { ...base, aclaracion: 'No he entendido la instrucción. Escribe «ayuda» para ver lo que sé hacer.' };
}
