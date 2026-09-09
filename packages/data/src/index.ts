/**
 * @rinde/data — catálogo de demostración.
 *
 * Contiene ingredientes y recetas de uso común en Colombia y un set de precios
 * DEMO claramente marcados. Nada de este paquete debe presentarse al usuario
 * como información de mercado real: ver `prices.ts` y `nutrition-note.ts`.
 */

export { CATEGORIES, CATEGORY_BY_ID } from "./categories.js";
export { INGREDIENTS, INGREDIENT_BY_ID } from "./ingredients.js";
export { RECIPES, RECIPE_BY_ID } from "./recipes.js";
export {
  DEMO_PRICES, DEMO_PRICE_HISTORY, PRICE_SOURCES, STORES,
  DEMO_NOTICE, DEMO_OBSERVED_ON, DEMO_PREVIOUS_WEEK, DEMO_WEEK, DEMO_CITY,
} from "./prices.js";
export { NUTRITION_SOURCE, NUTRITION_DISCLAIMER } from "./nutrition-note.js";
