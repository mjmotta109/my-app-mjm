import type { Cop, Ingredient, IngredientTag, MealPlan, Quantity } from "./types.js";
import type { PriceIndex } from "./pricing.js";
import { planPurchase } from "./inventory.js";
import { baseToGrams } from "./nutrition.js";
import { humanize, round } from "./units.js";

/**
 * "Rinde más" (§12 del brief).
 *
 * El usuario tiene un dinero extra y pregunta en qué le rinde más gastarlo.
 *
 * De dónde salen los números: **del plan que el propio usuario ya tiene**.
 * Para saber cuántas comidas más da 1 kg de pollo, se mide cuántos gramos de
 * proteína consume una comida real de SU plan, y se divide. No hay constantes
 * inventadas de "gramos por persona".
 *
 * Si el plan no contiene ninguna comida de la categoría (por ejemplo, un plan
 * sin proteína animal), `extraMeals` es `null` y se dice por qué, en vez de
 * devolver un número inventado.
 */

export type RindeMasOptionId = "mas_proteina" | "mas_variedad" | "mayor_duracion";

export interface RindeMasItem {
  ingredientId: string;
  packs: number;
  qtyBase: number;
  display: Quantity;
  costCop: Cop;
}

export interface RindeMasOption {
  id: RindeMasOptionId;
  title: string;
  description: string;
  items: RindeMasItem[];
  totalCop: Cop;
  /** Comidas adicionales estimadas. `null` si el plan no permite estimarlo. */
  extraMeals: number | null;
  /** En qué se basó el cálculo. Se muestra al usuario. */
  basis: string;
}

const OPTION_TAGS: Record<RindeMasOptionId, IngredientTag[]> = {
  mas_proteina: ["proteina", "proteina_vegetal"],
  mas_variedad: ["verdura", "fruta"],
  mayor_duracion: ["grano", "tuberculo", "proteina_vegetal"],
};

const OPTION_META: Record<RindeMasOptionId, { title: string; description: string }> = {
  mas_proteina: {
    title: "Más proteína",
    description: "Refuerza las comidas con proteína, que suele ser lo primero que se recorta.",
  },
  mas_variedad: {
    title: "Más variedad",
    description: "Frutas y verduras para que el mes no sepa siempre igual.",
  },
  mayor_duracion: {
    title: "Mayor duración",
    description: "Granos y tubérculos: lo que más días de comida da por peso.",
  },
};

export interface RindeMasOptions {
  /** Ingredientes distintos como máximo por opción. */
  maxDistinct?: number;
  excludedIngredientIds?: ReadonlySet<string>;
}

export function rindeMas(
  extraBudgetCop: Cop,
  plan: MealPlan,
  catalog: ReadonlyMap<string, Ingredient>,
  prices: PriceIndex,
  options: RindeMasOptions = {},
): RindeMasOption[] {
  if (extraBudgetCop <= 0) return [];
  const maxDistinct = options.maxDistinct ?? 3;
  const excluded = options.excludedIngredientIds ?? new Set<string>();

  return (Object.keys(OPTION_TAGS) as RindeMasOptionId[]).map((id) =>
    buildOption(id, extraBudgetCop, plan, catalog, prices, maxDistinct, excluded),
  );
}

function buildOption(
  id: RindeMasOptionId,
  budgetCop: Cop,
  plan: MealPlan,
  catalog: ReadonlyMap<string, Ingredient>,
  prices: PriceIndex,
  maxDistinct: number,
  excluded: ReadonlySet<string>,
): RindeMasOption {
  const tags = OPTION_TAGS[id];
  const meta = OPTION_META[id];

  // Candidatos: ingredientes de la categoría, con precio, ordenados por
  // gramos por peso gastado. "Más comida por el mismo dinero" es literal.
  const candidates = [...catalog.values()]
    .filter((ingredient) => !excluded.has(ingredient.id))
    .filter((ingredient) => ingredient.tags.some((tag) => tags.includes(tag)))
    .map((ingredient) => {
      const price = prices.get(ingredient.id);
      if (!price || price.copPerBaseUnit <= 0) return null;
      const gramsPerBase = baseToGrams(1, ingredient);
      if (gramsPerBase === null || gramsPerBase <= 0) return null;
      return {
        ingredient,
        gramsPerCop: gramsPerBase / price.copPerBaseUnit,
      };
    })
    .filter((entry): entry is { ingredient: Ingredient; gramsPerCop: number } => entry !== null)
    .sort((a, b) => b.gramsPerCop - a.gramsPerCop || (a.ingredient.id < b.ingredient.id ? -1 : 1));

  // "Más variedad" prioriza ingredientes distintos, no el más barato repetido.
  const pool = candidates.slice(0, id === "mas_variedad" ? maxDistinct * 3 : maxDistinct * 2);

  const items: RindeMasItem[] = [];
  let spent = 0;
  let gramsAdded = 0;

  for (const entry of pool) {
    if (items.length >= maxDistinct) break;
    const remaining = budgetCop - spent;
    if (remaining <= 0) break;

    const smallestPack = smallestPackBase(entry.ingredient);
    if (smallestPack === null) continue;
    const packCost = prices.costOf(entry.ingredient.id, smallestPack);
    if (packCost === null || packCost <= 0 || packCost > remaining) continue;

    const packs = Math.max(1, Math.floor(remaining / packCost / (maxDistinct - items.length || 1)));
    const qtyBase = round(packs * smallestPack, 3);
    const costCop = prices.costOf(entry.ingredient.id, qtyBase);
    if (costCop === null || costCop > remaining) continue;

    const grams = baseToGrams(qtyBase, entry.ingredient);
    if (grams !== null) gramsAdded += grams;

    items.push({
      ingredientId: entry.ingredient.id,
      packs,
      qtyBase,
      display: humanize(qtyBase, entry.ingredient),
      costCop,
    });
    spent += costCop;
  }

  const usage = averageGramsPerMeal(plan, catalog, tags);
  const extraMeals =
    usage === null || usage <= 0 ? null : Math.floor(gramsAdded / usage);

  const basis =
    usage === null
      ? "Tu plan actual no incluye comidas de esta categoría, así que no se puede estimar cuántas comidas añade."
      : `Basado en tu plan: cada comida usa en promedio ${Math.round(usage)} g de esta categoría.`;

  return {
    id,
    title: meta.title,
    description: meta.description,
    items,
    totalCop: spent,
    extraMeals,
    basis,
  };
}

function smallestPackBase(ingredient: Ingredient): number | null {
  const plan = planPurchase(ingredient.roundingStep, ingredient);
  return plan.purchaseBase > 0 ? plan.purchaseBase : null;
}

/**
 * Gramos promedio de una categoría por comida, medidos sobre el plan real.
 * Devuelve `null` si el plan no usa ningún ingrediente de esa categoría.
 */
export function averageGramsPerMeal(
  plan: MealPlan,
  catalog: ReadonlyMap<string, Ingredient>,
  tags: readonly IngredientTag[],
): number | null {
  let grams = 0;
  let mealsUsingCategory = 0;

  for (const meal of plan.meals) {
    let mealGrams = 0;
    for (const line of meal.lines) {
      const ingredient = catalog.get(line.ingredientId);
      if (!ingredient?.tags.some((tag) => tags.includes(tag))) continue;
      const value = baseToGrams(line.qtyBase, ingredient);
      if (value !== null) mealGrams += value;
    }
    if (mealGrams > 0) {
      grams += mealGrams;
      mealsUsingCategory++;
    }
  }

  if (mealsUsingCategory === 0) return null;
  return grams / mealsUsingCategory;
}
