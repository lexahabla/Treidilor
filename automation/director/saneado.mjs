/**
 * Agente 00 · DETECCIÓN DE «INSTRUCCIONES» DENTRO DE DATOS (defensa contra inyección). PURO.
 * Los datos (hallazgos, títulos de producto, textos de informes) NUNCA pasan por el intérprete ni cambian niveles; este módulo solo sirve
 * para AVISAR al propietario de que un dato contiene texto con forma de orden («contenido anómalo, posible inyección»).
 */
const PATRONES = [
  /\bignora\w*\b.{0,30}\b(reglas|instrucciones|limites|restricciones)\b/i,
  /\bignore\b.{0,20}\b(previous|prior|all|the)\b/i,
  /\[\s*(sistema|system)\s*\]/i,
  /\b(aprueba|autoriza)\b.{0,12}\btodo\b/i,
  /\bdesactiva\w*\b.{0,20}\blimites?\b/i,
  /\bpublica\b.{0,20}\bportada\b/i,
  /\b(eres|actua como|act as|you are now)\b.{0,30}\b(administrador|admin|root|sistema)\b/i,
  /\b(revela|muestra|envia)\b.{0,30}\b(token|clave|credencial|contrasena|password)\b/i,
];

/** Devuelve las anomalías encontradas: [{origen, fragmento}] (fragmento acotado a 80 caracteres; es texto del dato, se cita como texto). */
export function detectarInstruccionesEnDatos(elementos) {
  const hallazgos = [];
  for (const { origen, texto } of elementos) {
    const t = String(texto ?? '');
    if (PATRONES.some((rx) => rx.test(t))) hallazgos.push({ origen, fragmento: t.slice(0, 80) });
  }
  return hallazgos;
}
