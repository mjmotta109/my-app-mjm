import type { Cop, Ingredient, InventoryItem, MealSlot, Recipe } from "./types.js";
import type { PriceIndex } from "./pricing.js";
import { VirtualPantry } from "./inventory.js";
import { costMeal } from "./costing.js";
import { scaleRecipe } from "./scaling.js";
import { round } from "./units.js";

/**
 * "¿Qué puedo cocinar?" (§11 del brief).
 *
 * Mira la despensa real y responde con lo que se puede cocinar ahora mismo,
 * ordenado por cuánto se cubre con lo que ya hay.
 *
 * La cobertura se pondera **por valor**, no por número de ingredientes: tener
 * el pollo y que falte la sal no es lo mismo que tener la sal y que falte el
 * pollo. Cuando falta el precio de una línea, esa línea pesa igual que las
 * demás en vez de desaparecer del cálculo.
 */

export interface CookableRecipe {
  recipeId: string;
  recipeName: string;
  /** 0..1 — proporción del valor de la receta ya cubierta por la despensa. */
  coverage: number;
  /** Igual que `coverage` pero en porcentaje entero, para mostrar. */
  coveragePct: number;
  missingIngredientIds: string[];
  /** Valor total de la receta a precios de referencia. */
  costCop: Cop;
  /** Lo que habría que comprar para cocinarla. */
  missingCostCop: Cop;
  costIncomplete: boolean;
  minutes: number;
  slots: MealSlot[];
}

export interface WhatCanICookOptions {
  slot?: MealSlot;
  /** Cobertura mínima para aparecer en la lista. */
  minCoverage?: number;
  limit?: number;
  excludedIngredientIds?: ReadonlySet<string>;
}

export function whatCanICook(
  inventory: readonly InventoryItem[],
  recipes: readonly Recipe[],
  catalog: ReadonlyMap<string, Ingredient>,
  prices: PriceIndex,
  servings: number,
  options: WhatCanICookOptions = {},
): CookableRecipe[] {
  const minCoverage = options.minCoverage ?? 0.4;
  const limit = options.limit ?? 10;
  const excluded = options.excludedIngredientIds ?? new Set<string>();

  const results: CookableRecipe[] = [];

  for (const recipe of recipes) {
    if (options.slot && !recipe.slots.includes(options.slot)) continue;
    if (recipe.ingredients.some((item) => excluded.has(item.ingredientId))) continue;

    const scale = scaleRecipe(recipe, servings, catalog);
    if (scale.lines.length === 0) continue;

    // Despensa desechable: se simula el consumo sin tocar el inventario real.
    const pantry = new VirtualPantry(inventory);
    const costed = costMeal(scale, pantry, prices, servings, { commit: false, includeOptional: false });

    let weightSum = 0;
    let covered = 0;
    const missing: string[] = [];

    for (const line of costed.lines) {
      if (line.qtyBase <= 0) continue;
      const ratio = line.fromInventoryBase / line.qtyBase;
      const weight = line.valueCop !== null && line.valueCop > 0 ? line.valueCop : 1;
      weightSum += weight;
      covered += weight * ratio;
      if (ratio < 0.999) missing.push(line.ingredientId);
    }

    const coverage = weightSum === 0 ? 0 : covered / weightSum;
    if (coverage < minCoverage) continue;

    results.push({
      recipeId: recipe.id,
      recipeName: recipe.name,
      coverage: round(coverage, 4),
      coveragePct: Math.round(coverage * 100),
      missingIngredientIds: missing.sort(),
      costCop: costed.costCop,
      missingCostCop: costed.purchaseCop,
      costIncomplete: costed.costIncomplete,
      minutes: recipe.minutes,
      slots: recipe.slots,
    });
  }

  return results
    .sort(
      (a, b) =>
        b.coverage - a.coverage ||
        a.missingCostCop - b.missingCostCop ||
        (a.recipeId < b.recipeId ? -1 : 1),
    )
    .slice(0, limit);
}
