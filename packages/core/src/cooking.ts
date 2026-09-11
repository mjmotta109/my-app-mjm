import type {
  Ingredient,
  InventoryItem,
  IsoDate,
  Leftover,
  Meal,
  Recipe,
} from "./types.js";
import { round } from "./units.js";

/**
 * Cocinar una comida descuenta el inventario (§10 del brief).
 *
 * Se consume por orden de vencimiento (lo que vence antes sale primero) y,
 * a igualdad, por antigüedad de actualización. Lo que falte NO se inventa:
 * se reporta como faltante para que la interfaz pueda decirlo.
 */

export interface CookResult {
  inventory: InventoryItem[];
  /** Lo que no alcanzó a cubrirse con el inventario. */
  shortages: { ingredientId: string; missingBase: number }[];
  consumed: { ingredientId: string; qtyBase: number }[];
  meal: Meal;
}

export interface ConsumeResult {
  inventory: InventoryItem[];
  shortages: { ingredientId: string; missingBase: number }[];
  consumed: { ingredientId: string; qtyBase: number }[];
}

/**
 * Descuenta un conjunto de líneas del inventario.
 *
 * Lo usan tanto cocinar una comida como cocinar una tanda completa de meal
 * prep: es exactamente el mismo descuento sobre distintas cantidades.
 * No muta el inventario recibido.
 */
export function consumeFromInventory(
  lines: readonly { ingredientId: string; qtyBase: number }[],
  inventory: readonly InventoryItem[],
  asOf: IsoDate,
): ConsumeResult {
  const items = inventory.map((item) => ({ ...item }));
  const shortages: ConsumeResult["shortages"] = [];
  const consumed: ConsumeResult["consumed"] = [];

  for (const line of lines) {
    let remaining = line.qtyBase;
    if (remaining <= 0) continue;

    const matching = items
      .filter((item) => item.ingredientId === line.ingredientId && item.qtyBase > 0)
      .sort(compareByExpiry);

    for (const item of matching) {
      if (remaining <= 0) break;
      const take = Math.min(item.qtyBase, remaining);
      item.qtyBase = round(item.qtyBase - take, 4);
      item.updatedOn = asOf;
      remaining = round(remaining - take, 4);
    }

    const used = round(line.qtyBase - remaining, 4);
    if (used > 0) consumed.push({ ingredientId: line.ingredientId, qtyBase: used });
    if (remaining > 0.0001) {
      shortages.push({ ingredientId: line.ingredientId, missingBase: remaining });
    }
  }

  return { inventory: items.filter((item) => item.qtyBase > 0.0001), shortages, consumed };
}

export function cookMeal(
  meal: Meal,
  inventory: readonly InventoryItem[],
  asOf: IsoDate,
): CookResult {
  const result = consumeFromInventory(meal.lines, inventory, asOf);
  return { ...result, meal: { ...meal, status: "cooked" } };
}

function compareByExpiry(a: InventoryItem, b: InventoryItem): number {
  if (a.expiresOn && b.expiresOn) {
    if (a.expiresOn !== b.expiresOn) return a.expiresOn < b.expiresOn ? -1 : 1;
  } else if (a.expiresOn) return -1;
  else if (b.expiresOn) return 1;
  if (a.updatedOn !== b.updatedOn) return a.updatedOn < b.updatedOn ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

// ---------------------------------------------------------------------------
// Sobras (§22)
// ---------------------------------------------------------------------------

export interface LeftoverSuggestion {
  recipeId: string;
  recipeName: string;
  /** Ingredientes sobrantes que esta receta aprovecha. */
  usesIngredientIds: string[];
  /** Proporción de los ingredientes de la receta que ya están cubiertos. */
  coverage: number;
}

/**
 * Detecta sobras aprovechables: existencias perecederas que quedaron después
 * de cocinar. Solo se consideran perecederos porque un kilo de arroz en la
 * alacena no es una "sobra", es despensa.
 */
export function detectLeftovers(
  inventory: readonly InventoryItem[],
  catalog: ReadonlyMap<string, Ingredient>,
  fromMealId: string,
  asOf: IsoDate,
  minQtyBase = 1,
): Leftover[] {
  const out: Leftover[] = [];
  for (const item of inventory) {
    const ingredient = catalog.get(item.ingredientId);
    if (!ingredient?.perishable) continue;
    if (item.qtyBase < minQtyBase) continue;
    out.push({
      id: `leftover_${item.ingredientId}_${asOf}`,
      ingredientId: item.ingredientId,
      qtyBase: item.qtyBase,
      fromMealId,
      createdOn: asOf,
      ...(item.expiresOn ? { expiresOn: item.expiresOn } : {}),
    });
  }
  return out.sort((a, b) => (a.ingredientId < b.ingredientId ? -1 : 1));
}

/** Recetas que aprovechan las sobras, ordenadas por cuántas usan. */
export function suggestLeftoverUses(
  leftovers: readonly Leftover[],
  recipes: readonly Recipe[],
  inventory: readonly InventoryItem[],
  limit = 5,
): LeftoverSuggestion[] {
  const leftoverIds = new Set(leftovers.map((l) => l.ingredientId));
  if (leftoverIds.size === 0) return [];
  const available = new Set(inventory.filter((i) => i.qtyBase > 0).map((i) => i.ingredientId));

  const scored = recipes
    .map((recipe) => {
      const required = recipe.ingredients.filter((item) => !item.optional);
      const uses = required.filter((item) => leftoverIds.has(item.ingredientId));
      const covered = required.filter(
        (item) => available.has(item.ingredientId) || leftoverIds.has(item.ingredientId),
      );
      return {
        recipeId: recipe.id,
        recipeName: recipe.name,
        usesIngredientIds: uses.map((item) => item.ingredientId).sort(),
        coverage: required.length === 0 ? 0 : covered.length / required.length,
      };
    })
    .filter((entry) => entry.usesIngredientIds.length > 0);

  return scored
    .sort(
      (a, b) =>
        b.usesIngredientIds.length - a.usesIngredientIds.length ||
        b.coverage - a.coverage ||
        (a.recipeId < b.recipeId ? -1 : 1),
    )
    .slice(0, limit);
}
