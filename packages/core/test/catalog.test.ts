import { describe, expect, it } from "vitest";
import { CATEGORIES, DEMO_PRICES, INGREDIENTS, INGREDIENT_BY_ID, RECIPES } from "@rinde/data";
import { PriceIndex } from "../src/pricing.js";
import { toBase } from "../src/units.js";
import { DEMO_OBSERVED_ON } from "@rinde/data";

describe("integridad del catálogo", () => {
  it("trae al menos 50 recetas demo (§20)", () => {
    expect(RECIPES.length).toBeGreaterThanOrEqual(50);
  });

  it("no tiene ingredientes con id repetido", () => {
    expect(new Set(INGREDIENTS.map((i) => i.id)).size).toBe(INGREDIENTS.length);
  });

  it("no tiene recetas con id repetido", () => {
    expect(new Set(RECIPES.map((r) => r.id)).size).toBe(RECIPES.length);
  });

  it("TODOS los ingredientes de TODAS las recetas existen en el catálogo", () => {
    const missing: string[] = [];
    for (const recipe of RECIPES) {
      for (const item of recipe.ingredients) {
        if (!INGREDIENT_BY_ID.has(item.ingredientId)) {
          missing.push(`${recipe.id} → ${item.ingredientId}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("toda cantidad de receta se puede convertir a la unidad base", () => {
    const failures: string[] = [];
    for (const recipe of RECIPES) {
      for (const item of recipe.ingredients) {
        const ingredient = INGREDIENT_BY_ID.get(item.ingredientId);
        if (!ingredient) continue;
        try {
          const value = toBase(item.qty, item.unit, ingredient);
          if (!(value > 0)) failures.push(`${recipe.id} → ${item.ingredientId} = ${value}`);
        } catch (error) {
          failures.push(`${recipe.id} → ${item.ingredientId}: ${(error as Error).message}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("toda categoría usada por un ingrediente está declarada", () => {
    const known = new Set(CATEGORIES.map((c) => c.id));
    for (const ingredient of INGREDIENTS) expect(known.has(ingredient.categoryId)).toBe(true);
  });

  it("todo sustituto declarado existe", () => {
    for (const ingredient of INGREDIENTS) {
      for (const id of ingredient.substitutes ?? []) {
        expect(INGREDIENT_BY_ID.has(id), `${ingredient.id} → ${id}`).toBe(true);
      }
    }
  });

  it("toda receta declara al menos un slot y pasos", () => {
    for (const recipe of RECIPES) {
      expect(recipe.slots.length, recipe.id).toBeGreaterThan(0);
      expect(recipe.steps.length, recipe.id).toBeGreaterThan(0);
      expect(recipe.baseServings, recipe.id).toBeGreaterThan(0);
    }
  });

  it("cubre los cuatro tipos de comida", () => {
    for (const slot of ["desayuno", "almuerzo", "cena", "snack"] as const) {
      expect(RECIPES.filter((r) => r.slots.includes(slot)).length, slot).toBeGreaterThan(3);
    }
  });

  it("TODA la nutrición está marcada como estimada (§20)", () => {
    for (const ingredient of INGREDIENTS) expect(ingredient.nutritionIsEstimated).toBe(true);
    for (const recipe of RECIPES) expect(recipe.nutritionIsEstimated).toBe(true);
  });

  it("TODO precio demo está marcado como demo (§26)", () => {
    for (const price of DEMO_PRICES) {
      expect(price.isDemo).toBe(true);
      expect(price.sourceId).toBe("demo_bogota");
    }
  });

  it("el índice de precios demo se reconoce como demo", () => {
    const index = new PriceIndex(DEMO_PRICES, INGREDIENT_BY_ID, DEMO_OBSERVED_ON);
    expect(index.containsDemo()).toBe(true);
    expect(index.size).toBeGreaterThan(60);
  });

  it("cada ingrediente usado por una receta tiene precio demo", () => {
    const priced = new Set(DEMO_PRICES.map((p) => p.ingredientId));
    const used = new Set(RECIPES.flatMap((r) => r.ingredients.map((i) => i.ingredientId)));
    const withoutPrice = [...used].filter((id) => !priced.has(id));
    expect(withoutPrice).toEqual([]);
  });
});
