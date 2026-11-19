/**
 * FIXTURES SINTÉTICOS del Agente 11 (webs nicho): tres nichos inventados con datos aportados de calidad distinta, y los informes de apoyo (02, 09 y 10) construidos con los módulos y fixtures
 * EXISTENTES. Nada es real: ni la demanda, ni los costes, ni los programas, ni los competidores. Escenarios:
 *   · n-portatiles (categoría «informatica»): demanda ESTIMADA con método y un «hecho verificado» SIN fuente (se degrada a hipótesis); costes con una estimación, una hipótesis y un concepto
 *     no disponible; afiliación con varios programas (02); competencia con un hueco (09);
 *   · n-sonido (categoría «audio-sonido»): sin demanda, un único coste verificado, afiliación con pocos programas, competencia solo con una señal débil;
 *   · n-jardin (categoría que NO está en nuestro catálogo): sin ningún dato.
 */
import { compararProgramas, cargarDatasetAfiliacion } from '../afiliacion/afiliacion.mjs';
import { informeCompetencia } from '../competencia/competencia.mjs';
import { construirDatosCompetencia } from '../competencia/fixtures.mjs';
import { construirFuentesMarketing, informe10Fx, AHORA_MK } from '../marketing/fixtures.mjs';

export { AHORA_MK, informe10Fx };

export function construirNichos() {
  return [
    { id: 'n-portatiles', nombre: 'Portátiles y monitores (nicho ficticio)', categoria: 'informatica', categoriaAfiliacion: 'informatica', palabrasClave: ['portatil', 'monitor'], datosAportados: {
      demanda: [
        { id: 'busquedas-mes', descripcion: 'Búsquedas mensuales estimadas (valor aportado)', valor: 2400, unidad: 'busquedas/mes', clase: 'estimacion', fuente: 'herramienta de palabras clave (ficticia)', fecha: '2026-11-01', metodo: 'media de tres meses que da la herramienta' },
        { id: 'interes-estable', descripcion: 'Interés estable en el último año', valor: 1800, unidad: 'indice', clase: 'hecho_verificado' },
      ],
      costes: [
        { concepto: 'Dominio', importeEur: 12, clase: 'estimacion', metodo: 'precio de lista de un registrador (ficticio)', fuente: 'registrador ficticio', fecha: '2026-11-10' },
        { concepto: 'Alojamiento', importeEur: 60, clase: 'estimacion', metodo: 'plan básico anual de un proveedor (ficticio)' },
        { concepto: 'Contenido', importeEur: 400, clase: 'hipotesis' },
        { concepto: 'Herramientas', importeEur: null, clase: 'no_disponible' },
      ] } },
    { id: 'n-sonido', nombre: 'Audio y sonido (nicho ficticio)', categoria: 'audio-sonido', categoriaAfiliacion: 'sonido', palabrasClave: ['auriculares', 'altavoz'], datosAportados: { demanda: [], costes: [{ concepto: 'Dominio', importeEur: 12, clase: 'hecho_verificado', fuente: 'presupuesto del registrador (ficticio)', fecha: '2026-11-12' }] } },
    { id: 'n-jardin', nombre: 'Jardín (nicho ficticio sin datos)', categoria: 'jardin', categoriaAfiliacion: 'jardin', palabrasClave: ['jardin'], datosAportados: {} },
  ];
}

/** Informes de apoyo con los módulos EXISTENTES: 02 por nicho (dataset simulado del 02), 09 (observaciones sintéticas) y 10 (señales mínimas). */
export function construirInformesApoyo({ motorCompetencia, motorMarketing, ahora = AHORA_MK }) {
  const ds = cargarDatasetAfiliacion();
  const nichos = construirNichos();
  const fuentes = construirFuentesMarketing(motorMarketing, ahora);
  const afiliacionPorNicho = {};
  for (const n of nichos) { const r = compararProgramas(ds, { categoria: n.categoriaAfiliacion, ahora }); if (r.ranking.length || r.sinComision.length) afiliacionPorNicho[n.id] = r.informe; }
  const competencia = informeCompetencia({ motor: motorCompetencia, datos: construirDatosCompetencia(), fuentes, ahora, modo: 'completo' }).informe;
  const analitica = informe10Fx({ potencial: ['aud-altavoz'], revisar: ['inf-portatil'] });
  return { informes: { afiliacionPorNicho, competencia, analitica }, fuentes };
}
