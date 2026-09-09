/**
 * Generador pseudoaleatorio determinista (mulberry32).
 *
 * El planificador no usa `Math.random()`. La única aleatoriedad del sistema
 * viene de una semilla que se guarda dentro del plan, así que el mismo plan se
 * puede reproducir exactamente. Se usa solo para desempatar entre recetas con
 * puntuación idéntica, de modo que dos hogares iguales no reciban un menú
 * calcado.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Semilla estable derivada de un texto. Igual entrada, igual semilla. */
export function seedFrom(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
