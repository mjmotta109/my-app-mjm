import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CATEGORIES, DEMO_PRICES, INGREDIENTS, INGREDIENT_BY_ID, RECIPES, TABLE_NUTRITION, TABLE_UNMATCHED,
} from "@rinde/data";
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

  it("cada ingrediente dice de dónde sale su nutrición: tabla citada o estimación declarada (§20)", () => {
    for (const ingredient of INGREDIENTS) {
      const tabla = TABLE_NUTRITION[ingredient.id];
      if (tabla) {
        // Referenciado: no estimado, y la fuente nombra la fila exacta.
        expect(ingredient.nutritionIsEstimated, ingredient.id).toBe(false);
        expect(ingredient.nutritionSource, ingredient.id).toContain(`FDC ${tabla.fdcId}`);
        // Un equivalente cercano lo dice en la propia fuente.
        if (tabla.match === "cercano") expect(ingredient.nutritionSource).toContain("equivalente más cercano");
      } else {
        // Sin tabla: sigue siendo una estimación, y lo declara.
        expect(ingredient.nutritionIsEstimated, ingredient.id).toBe(true);
        expect(TABLE_UNMATCHED[ingredient.id], `${ingredient.id} no está en el emparejamiento`).toBeTruthy();
      }
    }
  });

  it("el emparejamiento cubre los 100 ingredientes, sin dejar ninguno sin decidir", () => {
    const decididos = new Set([...Object.keys(TABLE_NUTRITION), ...Object.keys(TABLE_UNMATCHED)]);
    expect(INGREDIENTS.filter((i) => !decididos.has(i.id)).map((i) => i.id)).toEqual([]);
  });

  it("los números del catálogo son los de la tabla, no una transcripción", () => {
    // Se relee el CSV bajado de USDA y se compara fila por fila. Si alguien
    // edita a mano el archivo generado, o regenera con otra tabla, esto falla.
    const leer = (nombre: string) => {
      const texto = readFileSync(new URL(`../../data/tablas/usda/${nombre}.csv`, import.meta.url), "utf-8");
      const filas = new Map<string, string[]>();
      for (const linea of texto.trim().split("\n").slice(1)) {
        // La descripción puede traer comas entre comillas: se toma la primera
        // columna y las seis numéricas del final.
        const partes = linea.split(",");
        filas.set(partes[0]!, partes.slice(-6, -1));
      }
      return filas;
    };
    const tablas: Record<string, Map<string, string[]>> = {
      "SR Legacy": leer("sr_legacy"),
      "Foundation": leer("foundation"),
    };
    for (const [id, dato] of Object.entries(TABLE_NUTRITION)) {
      const clave = dato.table.includes("SR Legacy") ? "SR Legacy" : "Foundation";
      const fila = tablas[clave]!.get(String(dato.fdcId));
      expect(fila, `${id}: FDC ${dato.fdcId} no está en ${clave}`).toBeDefined();
      const [kcal, proteina, grasa, carbohidratos] = fila!.map(Number);
      expect(dato.kcal, id).toBeCloseTo(kcal!, 1);
      expect(dato.proteinG, id).toBeCloseTo(proteina!, 2);
      expect(dato.fatG, id).toBeCloseTo(grasa!, 2);
      expect(dato.carbsG, id).toBeCloseTo(carbohidratos!, 2);
    }
  });

  it("la nutrición de una RECETA siempre es estimada: cocinar cambia los números (§20)", () => {
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
