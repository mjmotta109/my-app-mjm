import type { Ingredient, Nutrition } from "./types.js";
import type { ScaleResult } from "./scaling.js";
import { round } from "./units.js";

/**
 * Nutrición estimada.
 *
 * ADVERTENCIA DE PRODUCTO: estos valores se obtienen **sumando los aportes de
 * los ingredientes crudos**. No consideran pérdidas por cocción, absorción de
 * grasa, ni variedad concreta del producto. Se marcan siempre como estimados
 * y NUNCA deben presentarse como información médica o dietética profesional.
 */

export interface NutritionTotals extends Nutrition {
  /** `true` si algún ingrediente aportó al total sin dato verificado. */
  isEstimated: boolean;
  /** Ingredientes sin dato nutricional: el total está incompleto. */
  missingIngredientIds: string[];
}

export const EMPTY_NUTRITION: NutritionTotals = {
  kcal: 0,
  proteinG: 0,
  carbsG: 0,
  fatG: 0,
  fiberG: 0,
  isEstimated: true,
  missingIngredientIds: [],
};

/** Convierte una cantidad en unidad base a gramos de producto. */
export function baseToGrams(qtyBase: number, ingredient: Ingredient): number | null {
  if (ingredient.baseUnit === "g") return qtyBase;
  if (ingredient.baseUnit === "unit") {
    return ingredient.gramsPerUnit ? qtyBase * ingredient.gramsPerUnit : null;
  }
  return ingredient.gramsPerMl ? qtyBase * ingredient.gramsPerMl : null;
}

/** Suma la nutrición de una receta ya escalada. */
export function nutritionOfScaled(
  scale: ScaleResult,
  catalog: ReadonlyMap<string, Ingredient>,
): NutritionTotals {
  let kcal = 0;
  let proteinG = 0;
  let carbsG = 0;
  let fatG = 0;
  let fiberG = 0;
  let isEstimated = false;
  const missing = new Set<string>(scale.unknownIngredientIds);

  for (const line of scale.lines) {
    const ingredient = catalog.get(line.ingredientId);
    if (!ingredient?.nutrition) {
      missing.add(line.ingredientId);
      continue;
    }
    const grams = baseToGrams(line.qtyBase, ingredient);
    if (grams === null) {
      missing.add(line.ingredientId);
      continue;
    }
    const factor = grams / 100;
    const n = ingredient.nutrition;
    kcal += n.kcal * factor;
    proteinG += n.proteinG * factor;
    carbsG += n.carbsG * factor;
    fatG += n.fatG * factor;
    fiberG += (n.fiberG ?? 0) * factor;
    if (ingredient.nutritionIsEstimated) isEstimated = true;
  }

  return {
    kcal: Math.round(kcal),
    proteinG: round(proteinG, 1),
    carbsG: round(carbsG, 1),
    fatG: round(fatG, 1),
    fiberG: round(fiberG, 1),
    // Sumar ingredientes crudos ya es, en sí mismo, una estimación.
    isEstimated: true,
    missingIngredientIds: [...missing].sort(),
  };
}

/**
 * Objetivos diarios de referencia por persona adulta.
 *
 * SUPUESTO EXPLÍCITO: 2.000 kcal, 55 g de proteína y 25 g de fibra al día son
 * valores de referencia genéricos usados aquí SOLO como señal de balance para
 * el planificador. No son una recomendación individual y no sustituyen a un
 * profesional de la salud.
 */
export const DAILY_REFERENCE = {
  kcal: 2000,
  proteinG: 55,
  fiberG: 25,
} as const;

/**
 * Qué tan bien un aporte nutricional cubre el déficit del día, en [0, 1].
 * Solo se usa como una de las señales de puntuación del planificador.
 */
export function balanceScore(
  contribution: Nutrition,
  consumedToday: Nutrition,
  eaters: number,
  slotsPerDay: number,
  /**
   * Metas por comida del hogar. Si se omite, se usa la referencia genérica
   * escalada por comensales — el comportamiento de siempre.
   */
  mealTargets?: { kcal: number; proteinG: number },
): number {
  const targetKcal =
    mealTargets?.kcal ?? (DAILY_REFERENCE.kcal * eaters) / Math.max(1, slotsPerDay);
  const targetProtein =
    mealTargets?.proteinG ?? (DAILY_REFERENCE.proteinG * eaters) / Math.max(1, slotsPerDay);

  const kcalRatio = clamp01(contribution.kcal / Math.max(1, targetKcal));
  const proteinRatio = clamp01(contribution.proteinG / Math.max(1, targetProtein));
  const fiberRatio = clamp01((contribution.fiberG ?? 0) / 6);

  // Se premia acercarse al objetivo, no superarlo: una comida con el triple de
  // calorías de las que tocan no es "mejor".
  const kcalFit = 1 - Math.abs(kcalRatio - 1);
  // El déficit del día se mide contra la meta DIARIA del hogar, que es la meta
  // por comida multiplicada por las comidas del día.
  const dayProteinTarget = targetProtein * Math.max(1, slotsPerDay);
  const dayProteinDeficit = clamp01(1 - consumedToday.proteinG / Math.max(1, dayProteinTarget));

  return clamp01(0.45 * kcalFit + 0.4 * proteinRatio * dayProteinDeficit + 0.15 * fiberRatio);
}

export function addNutrition(a: Nutrition, b: Nutrition): Nutrition {
  return {
    kcal: a.kcal + b.kcal,
    proteinG: round(a.proteinG + b.proteinG, 1),
    carbsG: round(a.carbsG + b.carbsG, 1),
    fatG: round(a.fatG + b.fatG, 1),
    fiberG: round((a.fiberG ?? 0) + (b.fiberG ?? 0), 1),
  };
}

export function zeroNutrition(): Nutrition {
  return { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Qué tan bien encaja una comida en el día.
 *
 * Dos decisiones que importan:
 *
 * 1. **La meta es la del horario, no un tercio del día.** Un desayuno se mide
 *    contra lo que debe aportar un desayuno. Repartir en partes iguales empuja
 *    a elegir siempre el plato más grande y mata la variedad.
 * 2. **Hay una meseta, no un pico.** Cualquier comida entre el 80% y el 125%
 *    de su meta puntúa igual de bien. Si la puntuación premiara clavar el
 *    número exacto, el mismo plato ganaría los treinta días. Dentro de la
 *    banda razonable, que decidan la variedad, el precio y el tiempo.
 *
 * Quedarse corto penaliza MÁS que pasarse: el producto existe para que la
 * gente coma, no para que ahorre comiendo menos.
 */
export function dayFitScore(
  contribution: Nutrition,
  targetKcal: number,
  targetProteinG: number,
  /** Déficit acumulado del día hasta ahora, en kcal. Empuja a compensar. */
  kcalDebt = 0,
): number {
  const objetivo = Math.max(1, targetKcal + Math.max(0, kcalDebt) * 0.5);
  const ratio = contribution.kcal / objetivo;

  let kcalFit: number;
  if (ratio < 0.9) kcalFit = clamp01(ratio / 0.9);           // corto: penaliza duro
  else if (ratio <= 1.25) kcalFit = 1;                        // banda razonable
  else kcalFit = clamp01(1 - (ratio - 1.25) * 0.5);           // pasarse: penaliza suave

  const proteinRatio = contribution.proteinG / Math.max(1, targetProteinG);
  const proteinFit = proteinRatio >= 0.9 ? 1 : clamp01(proteinRatio / 0.9);

  const fiberFit = clamp01((contribution.fiberG ?? 0) / 8);

  return clamp01(0.5 * kcalFit + 0.38 * proteinFit + 0.12 * fiberFit);
}
