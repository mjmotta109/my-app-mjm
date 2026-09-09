import type {
  CategoryId,
  Cop,
  FoodCategory,
  Ingredient,
  MealPlan,
  ShoppingList,
  ShoppingListGroup,
  ShoppingListItem,
} from "./types.js";
import type { PriceIndex } from "./pricing.js";
import { planPurchase } from "./inventory.js";
import { addDays } from "./dates.js";
import { humanize, round } from "./units.js";

/**
 * Lista de mercado (§16 del brief).
 *
 * Se construye a partir del **requerimiento neto consolidado** del plan, no
 * comida a comida: por eso aparece "2 kg de pollo" una sola vez y no tres
 * líneas de 700 g. Sobre ese neto se aplica el formato real de venta.
 *
 * Ciclos de compra: los no perecederos se compran una vez para todo el plan;
 * los perecederos se reparten en ciclos (por defecto semanales), porque nadie
 * compra el tomate de la cuarta semana el primer día.
 */

export const DEFAULT_CYCLE_DAYS = 7;

export interface ShoppingListOptions {
  /** Número de ciclo (1-based) o `"all"` para el plan completo. */
  cycle?: number | "all";
  cycleDays?: number;
  categories?: readonly FoodCategory[];
}

const FALLBACK_CATEGORY_ORDER: CategoryId[] = [
  "proteinas",
  "granos",
  "verduras",
  "frutas",
  "lacteos",
  "abarrotes",
  "condimentos",
  "bebidas",
];

export function buildShoppingList(
  plan: MealPlan,
  catalog: ReadonlyMap<string, Ingredient>,
  prices: PriceIndex,
  options: ShoppingListOptions = {},
): ShoppingList {
  const cycle = options.cycle ?? 1;
  const cycleDays = options.cycleDays ?? DEFAULT_CYCLE_DAYS;
  const needed = requirementsForCycle(plan, catalog, cycle, cycleDays);

  const byCategory = new Map<CategoryId, ShoppingListItem[]>();
  const unpriced: string[] = [];
  let containsDemo = false;

  for (const [ingredientId, neededBase] of [...needed.entries()].sort()) {
    if (neededBase <= 0) continue;
    const ingredient = catalog.get(ingredientId);
    if (!ingredient) {
      unpriced.push(ingredientId);
      continue;
    }
    const purchase = planPurchase(neededBase, ingredient);
    const lineCostCop = prices.costOf(ingredientId, purchase.purchaseBase);
    const unitPrice = prices.get(ingredientId);
    if (lineCostCop === null) unpriced.push(ingredientId);
    if (unitPrice?.isDemo) containsDemo = true;

    const item: ShoppingListItem = {
      ingredientId,
      neededBase: round(neededBase, 3),
      purchaseBase: purchase.purchaseBase,
      display: humanize(purchase.purchaseBase, ingredient),
      lineCostCop,
      priceConfidence: unitPrice?.confidence ?? null,
      priceIsDemo: unitPrice?.isDemo ?? false,
      categoryId: ingredient.categoryId,
      surplusBase: purchase.surplusBase,
      checked: false,
      ...(purchase.packLabel ? { packLabel: purchase.packLabel } : {}),
    };
    const bucket = byCategory.get(ingredient.categoryId);
    if (bucket) bucket.push(item);
    else byCategory.set(ingredient.categoryId, [item]);
  }

  const order = buildCategoryOrder(options.categories);
  const groups: ShoppingListGroup[] = [...byCategory.entries()]
    .sort((a, b) => (order.get(a[0])?.order ?? 99) - (order.get(b[0])?.order ?? 99))
    .map(([categoryId, items]) => ({
      categoryId,
      categoryName: order.get(categoryId)?.name ?? categoryId,
      items: items.sort((a, b) => (b.lineCostCop ?? 0) - (a.lineCostCop ?? 0) || (a.ingredientId < b.ingredientId ? -1 : 1)),
      subtotalCop: sumLines(items),
    }));

  return {
    planId: plan.id,
    cycle: cycle === "all" ? 0 : cycle,
    groups,
    totalCop: groups.reduce((total, group) => total + group.subtotalCop, 0),
    unpricedIngredientIds: [...new Set(unpriced)].sort(),
    containsDemoPrices: containsDemo,
  };
}

/** Cuántos ciclos de compra tiene el plan. */
export function cycleCount(plan: MealPlan, cycleDays = DEFAULT_CYCLE_DAYS): number {
  return Math.max(1, Math.ceil(plan.days / cycleDays));
}

function requirementsForCycle(
  plan: MealPlan,
  catalog: ReadonlyMap<string, Ingredient>,
  cycle: number | "all",
  cycleDays: number,
): Map<string, number> {
  if (cycle === "all") {
    return new Map(plan.netRequirements.map((entry) => [entry.ingredientId, entry.qtyBase]));
  }

  const from = addDays(plan.startDate, (cycle - 1) * cycleDays);
  const to = addDays(plan.startDate, cycle * cycleDays);
  const out = new Map<string, number>();

  for (const meal of plan.meals) {
    for (const line of meal.lines) {
      if (line.toBuyBase <= 0) continue;
      const ingredient = catalog.get(line.ingredientId);
      const perishable = ingredient?.perishable ?? true;
      // Lo no perecedero se compra todo en el primer ciclo; lo perecedero,
      // solo lo que se consume dentro de la ventana de este ciclo.
      const inScope = perishable ? meal.date >= from && meal.date < to : cycle === 1;
      if (!inScope) continue;
      out.set(line.ingredientId, round((out.get(line.ingredientId) ?? 0) + line.toBuyBase, 4));
    }
  }
  return out;
}

function buildCategoryOrder(
  categories?: readonly FoodCategory[],
): Map<CategoryId, { name: string; order: number }> {
  const map = new Map<CategoryId, { name: string; order: number }>();
  if (categories && categories.length > 0) {
    for (const category of categories) {
      map.set(category.id, { name: category.name, order: category.order });
    }
    return map;
  }
  FALLBACK_CATEGORY_ORDER.forEach((id, index) => map.set(id, { name: id, order: index }));
  return map;
}

function sumLines(items: readonly ShoppingListItem[]): Cop {
  let total = 0;
  for (const item of items) if (item.lineCostCop !== null) total += item.lineCostCop;
  return total;
}

/** Marca un artículo como comprado sin mutar la lista original. */
export function toggleChecked(
  list: ShoppingList,
  ingredientId: string,
  checked: boolean,
): ShoppingList {
  return {
    ...list,
    groups: list.groups.map((group) => ({
      ...group,
      items: group.items.map((item) =>
        item.ingredientId === ingredientId ? { ...item, checked } : item,
      ),
    })),
  };
}

/** Total de lo que aún falta por comprar. */
export function pendingTotal(list: ShoppingList): Cop {
  let total = 0;
  for (const group of list.groups) {
    for (const item of group.items) {
      if (!item.checked && item.lineCostCop !== null) total += item.lineCostCop;
    }
  }
  return total;
}
