import type { FoodCategory } from "@rinde/core";

/**
 * Categorías de alimento. El `order` define el recorrido de la lista de
 * mercado: se agrupa como uno camina la plaza o el supermercado, no
 * alfabéticamente.
 */
export const CATEGORIES: FoodCategory[] = [
  { id: "proteinas", name: "Proteínas", order: 1 },
  { id: "granos", name: "Granos y cereales", order: 2 },
  { id: "verduras", name: "Verduras y tubérculos", order: 3 },
  { id: "frutas", name: "Frutas", order: 4 },
  { id: "lacteos", name: "Lácteos y huevos", order: 5 },
  { id: "abarrotes", name: "Abarrotes", order: 6 },
  { id: "condimentos", name: "Condimentos", order: 7 },
  { id: "bebidas", name: "Bebidas", order: 8 },
];

export const CATEGORY_BY_ID = new Map(CATEGORIES.map((category) => [category.id, category]));
