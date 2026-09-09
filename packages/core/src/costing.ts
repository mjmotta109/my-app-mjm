import type { Cop, CostedIngredientLine, PriceConfidence } from "./types.js";
import type { ScaleResult } from "./scaling.js";
import type { PriceIndex } from "./pricing.js";
import type { VirtualPantry } from "./inventory.js";
import { splitEvenly, sumCop } from "./money.js";

/**
 * Costeo de una comida (§15 del brief).
 *
 * Se calculan DOS números distintos, y confundirlos sería un error de producto:
 *
 *   - `costCop`      — lo que vale la comida: todos sus ingredientes a precio
 *                      de referencia, incluidos los que ya estaban en casa.
 *                      Es lo que se muestra como "costo de esta comida".
 *   - `purchaseCop`  — lo que hay que gastar de más para cocinarla, es decir
 *                      solo lo que falta en la despensa. Es lo que se compara
 *                      con el presupuesto.
 *
 * Un ingrediente sin precio NO cuenta como $0: la comida queda marcada como
 * `costIncomplete` y el ingrediente se reporta.
 */

export interface CostedMeal {
  lines: CostedIngredientLine[];
  costCop: Cop;
  purchaseCop: Cop;
  costPerPersonCop: Cop;
  costIncomplete: boolean;
  unpricedIngredientIds: string[];
}

export interface CostMealOptions {
  /** `true` descuenta de la despensa; `false` solo simula (para puntuar). */
  commit: boolean;
  /** Los ingredientes opcionales no se compran; solo se usan si ya están. */
  includeOptional?: boolean;
}

export function costMeal(
  scale: ScaleResult,
  pantry: VirtualPantry,
  prices: PriceIndex,
  servings: number,
  options: CostMealOptions,
): CostedMeal {
  const includeOptional = options.includeOptional ?? false;
  const lines: CostedIngredientLine[] = [];
  const unpriced = new Set<string>(scale.unknownIngredientIds);
  const values: Cop[] = [];
  const purchases: Cop[] = [];

  for (const line of scale.lines) {
    if (line.optional && !includeOptional) {
      // Un opcional solo entra si ya está en casa: nunca genera compra.
      const available = pantry.stockOf(line.ingredientId);
      if (available <= 0) continue;
    }

    const take = options.commit
      ? pantry.take(line.ingredientId, line.qtyBase)
      : pantry.peek(line.ingredientId, line.qtyBase);

    const unitPrice = prices.get(line.ingredientId);
    const valueCop = prices.costOf(line.ingredientId, line.qtyBase);
    const purchaseCop = prices.costOf(line.ingredientId, take.deficit);

    if (valueCop === null) unpriced.add(line.ingredientId);
    else values.push(valueCop);
    if (purchaseCop !== null) purchases.push(purchaseCop);

    lines.push({
      ingredientId: line.ingredientId,
      qtyBase: line.qtyBase,
      fromInventoryBase: take.fromStock,
      toBuyBase: take.deficit,
      valueCop,
      priceConfidence: (unitPrice?.confidence ?? null) as PriceConfidence | null,
      priceIsDemo: unitPrice?.isDemo ?? false,
    });
  }

  const costCop = sumCop(values);
  const purchaseCop = sumCop(purchases);
  const perPerson = splitEvenly(costCop, Math.max(1, Math.round(servings)));

  return {
    lines,
    costCop,
    purchaseCop,
    costPerPersonCop: perPerson[0] ?? 0,
    costIncomplete: unpriced.size > 0,
    unpricedIngredientIds: [...unpriced].sort(),
  };
}

/**
 * Reparte el costo total de una comida entre sus líneas de forma que la suma
 * coincida exactamente con el total. Se usa para desgloses en la interfaz.
 */
export function breakdown(meal: CostedMeal): { ingredientId: string; costCop: Cop }[] {
  return meal.lines
    .filter((line) => line.valueCop !== null)
    .map((line) => ({ ingredientId: line.ingredientId, costCop: line.valueCop! }))
    .sort((a, b) => b.costCop - a.costCop || (a.ingredientId < b.ingredientId ? -1 : 1));
}

/** Costo promedio por comida y por persona. Devuelve `null` si no hay comidas. */
export function averageCostPerMealPerPerson(
  totalCop: Cop,
  meals: number,
  people: number,
): Cop | null {
  if (meals <= 0 || people <= 0) return null;
  return Math.round(totalCop / (meals * people));
}
