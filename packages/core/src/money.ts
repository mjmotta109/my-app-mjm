import type { Cop } from "./types.js";

/**
 * Aritmética de dinero en pesos colombianos.
 *
 * Todo el dinero del sistema es un entero de COP. El COP no usa centavos en la
 * práctica, así que trabajar en enteros elimina de raíz los errores de coma
 * flotante — y hace que las sumas mostradas cuadren exactamente.
 */

export class MoneyError extends Error {
  override readonly name = "MoneyError";
}

/** Convierte a un entero de COP, redondeando al peso más cercano. */
export function cop(value: number): Cop {
  if (!Number.isFinite(value)) {
    throw new MoneyError(`Valor monetario no finito: ${value}`);
  }
  return Math.round(value);
}

export function isCop(value: unknown): value is Cop {
  return typeof value === "number" && Number.isInteger(value);
}

export function assertCop(value: number, label = "monto"): Cop {
  if (!Number.isInteger(value)) {
    throw new MoneyError(`${label} debe ser un entero de COP, se recibió ${value}`);
  }
  return value;
}

export function sumCop(values: readonly Cop[]): Cop {
  let total = 0;
  for (const v of values) total += assertCop(v);
  return total;
}

/**
 * Reparte `total` en `parts` partes lo más iguales posible.
 *
 * Usa el método del residuo mayor: las primeras `resto` partes reciben un peso
 * extra. **La suma del resultado es exactamente `total`**, siempre. Esto es lo
 * que permite mostrar "costo por persona" sin que la suma se desvíe del total.
 */
export function splitEvenly(total: Cop, parts: number): Cop[] {
  assertCop(total, "total");
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new MoneyError(`El número de partes debe ser un entero positivo, se recibió ${parts}`);
  }
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const base = Math.floor(abs / parts);
  const remainder = abs - base * parts;
  const out: Cop[] = [];
  for (let i = 0; i < parts; i++) {
    out.push(sign * (base + (i < remainder ? 1 : 0)));
  }
  return out;
}

/**
 * Reparte `total` proporcionalmente a `weights`.
 * La suma del resultado es exactamente `total`, incluso con pesos irregulares.
 */
export function allocate(total: Cop, weights: readonly number[]): Cop[] {
  assertCop(total, "total");
  if (weights.length === 0) throw new MoneyError("allocate requiere al menos un peso");
  if (weights.some((w) => w < 0 || !Number.isFinite(w))) {
    throw new MoneyError("Los pesos deben ser números finitos no negativos");
  }
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum === 0) return splitEvenly(total, weights.length);

  const exact = weights.map((w) => (total * w) / weightSum);
  const floors = exact.map((v) => Math.floor(v));
  let assigned = floors.reduce((a, b) => a + b, 0);
  const out = [...floors];

  // Reparte el residuo a las partes con mayor fracción perdida.
  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => (b.frac - a.frac) || (a.index - b.index));

  let i = 0;
  while (assigned < total && order.length > 0) {
    const slot = order[i % order.length]!;
    out[slot.index] = out[slot.index]! + 1;
    assigned += 1;
    i += 1;
  }
  return out;
}

/** Porcentaje de variación entre dos valores, redondeado a un decimal. */
export function percentChange(previous: number, current: number): number {
  if (previous === 0) {
    throw new MoneyError("No se puede calcular variación porcentual desde 0");
  }
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** Formato colombiano: `$18.900`. Separador de miles con punto. */
export function formatCop(value: Cop): string {
  const sign = value < 0 ? "-" : "";
  const digits = Math.abs(Math.round(value)).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}$${grouped}`;
}
