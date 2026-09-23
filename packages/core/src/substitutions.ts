import type { Cop, Ingredient, Recipe } from "./types.js";
import type { PriceIndex } from "./pricing.js";
import { baseToGrams } from "./nutrition.js";
import { round, toBase } from "./units.js";

/**
 * Sustituciones (§21 del brief).
 *
 * Sobre qué base se sustituye:
 *
 *   - Si ambos ingredientes tienen dato de proteína y el original es una
 *     fuente proteica, la equivalencia es **por proteína**: reemplazar 500 g
 *     de carne por 500 g de lentejas no es equivalente y decir lo contrario
 *     sería engañar sobre la nutrición del plan.
 *   - En cualquier otro caso la equivalencia es **por peso**, 1:1.
 *
 * `basis` viaja con la sugerencia para que la interfaz pueda decir en qué se
 * basó el cálculo. El ahorro sale siempre de precios almacenados, nunca de
 * una estimación inventada.
 */

export type SubstitutionBasis = "protein" | "weight";

export interface SubstitutionSuggestion {
  fromIngredientId: string;
  toIngredientId: string;
  fromQtyBase: number;
  toQtyBase: number;
  fromCostCop: Cop;
  toCostCop: Cop;
  /** Positivo = ahorro. Negativo = la sustitución cuesta más. */
  savingCop: Cop;
  basis: SubstitutionBasis;
  recipeId?: string;
}

export interface SuggestOptions {
  /** Ingredientes vetados por alergia o rechazo del usuario. */
  excludedIngredientIds?: ReadonlySet<string>;
  /** Ahorro mínimo para que valga la pena proponerla. */
  minSavingCop?: number;
}

/**
 * Calcula la cantidad equivalente del sustituto y sobre qué base.
 * Devuelve `null` si no hay forma defendible de equiparar los dos.
 */
export function equivalentQuantity(
  from: Ingredient,
  to: Ingredient,
  fromQtyBase: number,
): { qtyBase: number; basis: SubstitutionBasis } | null {
  const fromGrams = baseToGrams(fromQtyBase, from);
  if (fromGrams === null) return null;

  const isProteinSwap =
    from.tags.some((t) => t === "proteina" || t === "proteina_vegetal") &&
    to.tags.some((t) => t === "proteina" || t === "proteina_vegetal");

  if (isProteinSwap && from.nutrition && to.nutrition && to.nutrition.proteinG > 0) {
    const proteinGrams = (fromGrams / 100) * from.nutrition.proteinG;
    const targetGrams = (proteinGrams / to.nutrition.proteinG) * 100;
    const qtyBase = gramsToBase(targetGrams, to);
    if (qtyBase === null) return null;
    return { qtyBase: round(qtyBase, 3), basis: "protein" };
  }

  const qtyBase = gramsToBase(fromGrams, to);
  if (qtyBase === null) return null;
  return { qtyBase: round(qtyBase, 3), basis: "weight" };
}

function gramsToBase(grams: number, ingredient: Ingredient): number | null {
  if (ingredient.baseUnit === "g") return grams;
  if (ingredient.baseUnit === "unit") {
    return ingredient.gramsPerUnit ? grams / ingredient.gramsPerUnit : null;
  }
  return ingredient.gramsPerMl ? grams / ingredient.gramsPerMl : null;
}

/** Evalúa un reemplazo concreto. `null` si falta algún precio. */
export function evaluateSubstitution(
  from: Ingredient,
  to: Ingredient,
  fromQtyBase: number,
  prices: PriceIndex,
): SubstitutionSuggestion | null {
  const equivalent = equivalentQuantity(from, to, fromQtyBase);
  if (!equivalent) return null;

  const fromCost = prices.costOf(from.id, fromQtyBase);
  const toCost = prices.costOf(to.id, equivalent.qtyBase);
  // Sin precio de alguno de los dos no se puede afirmar ningún ahorro.
  if (fromCost === null || toCost === null) return null;

  return {
    fromIngredientId: from.id,
    toIngredientId: to.id,
    fromQtyBase: round(fromQtyBase, 3),
    toQtyBase: equivalent.qtyBase,
    fromCostCop: fromCost,
    toCostCop: toCost,
    savingCop: fromCost - toCost,
    basis: equivalent.basis,
  };
}

/** Sustituciones que ahorran dinero dentro de una receta concreta. */
export function suggestForRecipe(
  recipe: Recipe,
  scaledQuantities: ReadonlyMap<string, number>,
  catalog: ReadonlyMap<string, Ingredient>,
  prices: PriceIndex,
  options: SuggestOptions = {},
): SubstitutionSuggestion[] {
  const excluded = options.excludedIngredientIds ?? new Set<string>();
  const minSaving = options.minSavingCop ?? 1;
  const out: SubstitutionSuggestion[] = [];

  for (const item of recipe.ingredients) {
    const from = catalog.get(item.ingredientId);
    if (!from) continue;
    const qtyBase = scaledQuantities.get(item.ingredientId);
    if (qtyBase === undefined || qtyBase <= 0) continue;

    const candidates = new Set([
      ...(item.allowedSubstitutes ?? []),
      ...(from.substitutes ?? []),
    ]);

    for (const candidateId of candidates) {
      if (candidateId === from.id || excluded.has(candidateId)) continue;
      const to = catalog.get(candidateId);
      if (!to) continue;
      const suggestion = evaluateSubstitution(from, to, qtyBase, prices);
      if (suggestion && suggestion.savingCop >= minSaving) {
        out.push({ ...suggestion, recipeId: recipe.id });
      }
    }
  }

  return out.sort(
    (a, b) => b.savingCop - a.savingCop || (a.toIngredientId < b.toIngredientId ? -1 : 1),
  );
}

/**
 * Palabras que no distinguen a un plato de otro y por tanto no sirven para
 * saber qué ingrediente lo define.
 */
const PALABRAS_VACIAS = new Set([
  "de", "del", "la", "el", "los", "las", "un", "una", "con", "sin", "y", "en", "al", "a",
  "casera", "casero", "caseros", "caseras", "rellena", "relleno", "guisado", "guisada",
  "sudado", "sudada", "asado", "asada", "frito", "frita", "criolla", "criollo", "mixto",
  "mixta", "clasico", "clasica", "para", "estilo", "tipo", "salteado", "salteada",
]);

function palabrasDe(texto: string): string[] {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 3 && !PALABRAS_VACIAS.has(w));
}

/**
 * ¿Este ingrediente le da el nombre al plato?
 *
 * Cambiar el pollo de una "Arepa rellena de pollo" por lentejas ahorra dinero y
 * la aritmética cuadra, pero el plato que llega a la mesa ya no es el que dice
 * el nombre. Eso es presentar una cosa como otra, así que no se hace
 * automáticamente: el planificador puede abaratar una receta, no redefinirla.
 * La sugerencia sigue existiendo para que la persona la acepte si quiere.
 */
export function defineLaIdentidad(recipe: Recipe, ingredient: Ingredient): boolean {
  const delNombre = new Set(palabrasDe(recipe.name));
  return palabrasDe(ingredient.name).some((w) => delNombre.has(w));
}

/**
 * Devuelve una copia de la receta con los ingredientes caros reemplazados.
 * La usa el planificador cuando el presupuesto no alcanza (§31, paso 8).
 */
export function substituteExpensive(
  recipe: Recipe,
  catalog: ReadonlyMap<string, Ingredient>,
  prices: PriceIndex,
  options: SuggestOptions = {},
): { recipe: Recipe; applied: SubstitutionSuggestion[] } {
  const excluded = options.excludedIngredientIds ?? new Set<string>();
  const minSaving = options.minSavingCop ?? 1;
  const applied: SubstitutionSuggestion[] = [];

  const ingredients = recipe.ingredients.map((item) => {
    const from = catalog.get(item.ingredientId);
    if (!from) return item;
    // Lo que le da el nombre al plato no se toca.
    if (defineLaIdentidad(recipe, from)) return item;

    const candidates = [...new Set([...(item.allowedSubstitutes ?? []), ...(from.substitutes ?? [])])]
      .filter((id) => id !== from.id && !excluded.has(id))
      .sort();

    let best: { suggestion: SubstitutionSuggestion; to: Ingredient } | null = null;
    for (const candidateId of candidates) {
      const to = catalog.get(candidateId);
      if (!to) continue;
      // Se evalúa sobre la cantidad de la receta base; la proporción se
      // mantiene al escalar después.
      let qtyBase: number;
      try {
        qtyBase = toBase(item.qty, item.unit, from);
      } catch {
        continue;
      }
      const suggestion = evaluateSubstitution(from, to, qtyBase, prices);
      if (!suggestion || suggestion.savingCop < minSaving) continue;
      if (!best || suggestion.savingCop > best.suggestion.savingCop) best = { suggestion, to };
    }

    if (!best) return item;
    applied.push({ ...best.suggestion, recipeId: recipe.id });
    const toUnit = best.to.baseUnit;
    return { ...item, ingredientId: best.to.id, qty: best.suggestion.toQtyBase, unit: toUnit };
  });

  if (applied.length === 0) return { recipe, applied };
  return { recipe: { ...recipe, ingredients }, applied };
}
