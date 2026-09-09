import type { BaseUnit, Dimension, Ingredient, Quantity, Unit } from "./types.js";

/**
 * Conversión de unidades.
 *
 * Tres dimensiones canónicas: masa (`g`), volumen (`ml`) y conteo (`unit`).
 * Cruzar de una dimensión a otra (una taza de arroz → gramos, un huevo →
 * gramos) SOLO es posible si el ingrediente aporta el dato correspondiente
 * (`gramsPerMl`, `gramsPerUnit`). Si el dato no existe, la conversión falla
 * con un error explícito. El motor no adivina densidades.
 */

export class UnitError extends Error {
  override readonly name = "UnitError";
}

const DIMENSION_OF: Record<Unit, Dimension> = {
  mg: "mass",
  g: "mass",
  kg: "mass",
  ml: "volume",
  l: "volume",
  taza: "volume",
  cda: "volume",
  cdta: "volume",
  pizca: "mass",
  unit: "count",
};

/**
 * Factores hacia la unidad base de cada dimensión.
 *
 * Las medidas de cocina usan las equivalencias métricas convencionales:
 * 1 taza = 250 ml, 1 cucharada = 15 ml, 1 cucharadita = 5 ml.
 * `pizca` es una aproximación convencional de 0,5 g — se usa solo en
 * condimentos, donde su peso en el costo es despreciable.
 */
const TO_BASE: Record<Unit, number> = {
  mg: 0.001,
  g: 1,
  kg: 1000,
  ml: 1,
  l: 1000,
  taza: 250,
  cda: 15,
  cdta: 5,
  pizca: 0.5,
  unit: 1,
};

export function dimensionOf(unit: Unit): Dimension {
  const dim = DIMENSION_OF[unit];
  if (!dim) throw new UnitError(`Unidad desconocida: ${unit}`);
  return dim;
}

export function baseUnitOf(dimension: Dimension): BaseUnit {
  return dimension === "mass" ? "g" : dimension === "volume" ? "ml" : "unit";
}

/**
 * Convierte una cantidad a la unidad base del ingrediente.
 * Devuelve un número en `ingredient.baseUnit`.
 */
export function toBase(qty: number, unit: Unit, ingredient: Ingredient): number {
  if (!Number.isFinite(qty)) {
    throw new UnitError(`Cantidad no finita para ${ingredient.id}: ${qty}`);
  }
  const fromDim = dimensionOf(unit);
  const targetDim: Dimension =
    ingredient.baseUnit === "g" ? "mass" : ingredient.baseUnit === "ml" ? "volume" : "count";

  const inFromBase = qty * TO_BASE[unit];
  if (fromDim === targetDim) return inFromBase;

  // Cruce de dimensiones: requiere un dato del ingrediente.
  if (fromDim === "count" && targetDim === "mass") {
    return inFromBase * requireGramsPerUnit(ingredient);
  }
  if (fromDim === "mass" && targetDim === "count") {
    return inFromBase / requireGramsPerUnit(ingredient);
  }
  if (fromDim === "volume" && targetDim === "mass") {
    return inFromBase * requireGramsPerMl(ingredient);
  }
  if (fromDim === "mass" && targetDim === "volume") {
    return inFromBase / requireGramsPerMl(ingredient);
  }
  if (fromDim === "count" && targetDim === "volume") {
    return (inFromBase * requireGramsPerUnit(ingredient)) / requireGramsPerMl(ingredient);
  }
  if (fromDim === "volume" && targetDim === "count") {
    return (inFromBase * requireGramsPerMl(ingredient)) / requireGramsPerUnit(ingredient);
  }
  throw new UnitError(
    `No se puede convertir ${unit} a ${ingredient.baseUnit} para ${ingredient.id}`,
  );
}

function requireGramsPerUnit(ingredient: Ingredient): number {
  const value = ingredient.gramsPerUnit;
  if (!value || value <= 0) {
    throw new UnitError(
      `${ingredient.id} no define gramsPerUnit; no se puede convertir entre unidades y gramos`,
    );
  }
  return value;
}

function requireGramsPerMl(ingredient: Ingredient): number {
  const value = ingredient.gramsPerMl;
  if (!value || value <= 0) {
    throw new UnitError(
      `${ingredient.id} no define gramsPerMl; no se puede convertir entre volumen y masa`,
    );
  }
  return value;
}

/** Convierte desde la unidad base del ingrediente a la unidad pedida. */
export function fromBase(qtyBase: number, unit: Unit, ingredient: Ingredient): number {
  const oneUnitInBase = toBase(1, unit, ingredient);
  if (oneUnitInBase === 0) throw new UnitError(`Factor de conversión nulo para ${unit}`);
  return qtyBase / oneUnitInBase;
}

/**
 * Elige la unidad más legible para mostrar una cantidad.
 *
 * 1500 g → `1.5 kg`; 800 g → `800 g`; 2000 ml → `2 l`; 12 unidades → `12 unidades`.
 * Nunca cambia de dimensión, así que nunca puede fallar por falta de densidad.
 */
export function humanize(qtyBase: number, ingredient: Ingredient): Quantity {
  const rounded = roundForDisplay(qtyBase, ingredient);
  if (ingredient.baseUnit === "unit") {
    return { qty: rounded, unit: "unit" };
  }
  if (ingredient.baseUnit === "g") {
    return rounded >= 1000
      ? { qty: round(rounded / 1000, 2), unit: "kg" }
      : { qty: round(rounded, 0), unit: "g" };
  }
  return rounded >= 1000
    ? { qty: round(rounded / 1000, 2), unit: "l" }
    : { qty: round(rounded, 0), unit: "ml" };
}

/**
 * Redondea una cantidad a algo que un ser humano pueda ejecutar en una cocina.
 *
 * - `discrete` (huevo, aguacate, arepa): entero, mínimo 1 si se pidió algo > 0.
 *   Esto es lo que evita mostrar "0,37 huevos".
 * - `continuous` (arroz, aceite): múltiplo de `roundingStep`, mínimo un paso.
 */
export function roundForDisplay(qtyBase: number, ingredient: Ingredient): number {
  if (qtyBase <= 0) return 0;
  const step = ingredient.roundingStep > 0 ? ingredient.roundingStep : 1;

  if (ingredient.rounding === "discrete") {
    return Math.max(1, Math.round(qtyBase / step) * step);
  }
  const snapped = Math.round(qtyBase / step) * step;
  return round(Math.max(step, snapped), 3);
}

/** Redondea hacia arriba al siguiente paso. Se usa para decidir qué comprar. */
export function roundUpToStep(qtyBase: number, step: number): number {
  if (qtyBase <= 0) return 0;
  const s = step > 0 ? step : 1;
  return round(Math.ceil(qtyBase / s) * s, 3);
}

export function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Texto legible: `1.5 kg`, `12 unidades`, `800 g`. */
export function formatQuantity(quantity: Quantity): string {
  const qty = Number.isInteger(quantity.qty)
    ? String(quantity.qty)
    : String(round(quantity.qty, 2)).replace(".", ",");
  if (quantity.unit === "unit") {
    return `${qty} ${quantity.qty === 1 ? "unidad" : "unidades"}`;
  }
  return `${qty} ${quantity.unit}`;
}
