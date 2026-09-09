import {
  CATEGORIES, DEMO_NOTICE, DEMO_OBSERVED_ON, DEMO_PRICES, DEMO_PRICE_HISTORY,
  INGREDIENTS, INGREDIENT_BY_ID, NUTRITION_DISCLAIMER, RECIPES, RECIPE_BY_ID,
} from "@rinde/data";
import { PriceIndex } from "@rinde/core";
import type { Ingredient, Recipe } from "@rinde/core";

/**
 * Fuente de datos del MVP: el catálogo demo, en el dispositivo.
 *
 * La aplicación funciona sin registro y sin servidor (§25). Cuando exista el
 * backend, esta capa es la que se reemplaza por llamadas HTTP: las pantallas
 * hablan solo con estas funciones, nunca con los datos crudos.
 */

export { CATEGORIES, INGREDIENTS, INGREDIENT_BY_ID, RECIPES, RECIPE_BY_ID };
export { DEMO_NOTICE, NUTRITION_DISCLAIMER, DEMO_OBSERVED_ON, DEMO_PRICE_HISTORY };

/**
 * Fecha de referencia del catálogo demo.
 *
 * Los precios demo se observaron el 7 de septiembre de 2026. Si se usara la
 * fecha real del dispositivo, en cuanto pasaran dos semanas TODOS los precios
 * demo se degradarían a "estimado" y la demostración dejaría de mostrar el
 * flujo normal. Con datos reales, `asOf` debe ser la fecha de hoy.
 */
export const CATALOG_AS_OF = DEMO_OBSERVED_ON;

export const PRICES = new PriceIndex(DEMO_PRICES, INGREDIENT_BY_ID, CATALOG_AS_OF);

export function ingredientName(ingredientId: string): string {
  return INGREDIENT_BY_ID.get(ingredientId)?.name ?? ingredientId;
}

export function getIngredient(ingredientId: string): Ingredient | undefined {
  return INGREDIENT_BY_ID.get(ingredientId);
}

export function getRecipe(recipeId: string): Recipe | undefined {
  return RECIPE_BY_ID.get(recipeId);
}

export function categoryName(categoryId: string): string {
  return CATEGORIES.find((category) => category.id === categoryId)?.name ?? categoryId;
}

/** Emoji por categoría. Decorativo: siempre acompañado de texto. */
export const CATEGORY_EMOJI: Record<string, string> = {
  proteinas: "🍗",
  granos: "🌾",
  verduras: "🥕",
  frutas: "🍌",
  lacteos: "🥚",
  abarrotes: "🫙",
  condimentos: "🧂",
  bebidas: "🥤",
};

export const SLOT_LABEL: Record<string, string> = {
  desayuno: "Desayuno",
  almuerzo: "Almuerzo",
  cena: "Cena",
  snack: "Snack",
};
