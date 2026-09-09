import { describe, expect, it } from "vitest";
import { DEMO_OBSERVED_ON, DEMO_PRICES, INGREDIENT_BY_ID, RECIPES } from "@rinde/data";
import { PriceIndex } from "../src/pricing.js";
import { generateMealPlan } from "../src/planner.js";
import { eaterEquivalents } from "../src/scaling.js";
import { averageCostPerMealPerPerson } from "../src/costing.js";
import type { Household, InventoryItem, MealSlot, Recipe } from "../src/types.js";

const prices = new PriceIndex(DEMO_PRICES, INGREDIENT_BY_ID, DEMO_OBSERVED_ON);
const START = DEMO_OBSERVED_ON;

function household(overrides: Partial<Household> = {}): Household {
  return {
    id: "hogar_test",
    adults: 2,
    children: 0,
    budgetCop: 800_000,
    city: "Bogotá",
    slots: ["desayuno", "almuerzo", "cena"] as MealSlot[],
    days: 30,
    preferences: [],
    tier: "free",
    createdOn: START,
    ...overrides,
  };
}

function inv(ingredientId: string, qtyBase: number, expiresOn?: string): InventoryItem {
  return {
    id: `i_${ingredientId}`,
    ingredientId,
    qtyBase,
    updatedOn: START,
    ...(expiresOn ? { expiresOn } : {}),
  };
}

function plan(h: Household, inventory: InventoryItem[] = [], recipes: readonly Recipe[] = RECIPES) {
  return generateMealPlan({
    household: h,
    startDate: START,
    inventory,
    recipes,
    catalog: INGREDIENT_BY_ID,
    prices,
  });
}

/** El escenario del §14 y §37 del brief. */
const INVENTARIO_BRIEF = [
  inv("pollo_pechuga", 1000),
  inv("arroz_blanco", 1000),
  inv("lenteja", 500),
  inv("huevo", 12),
  inv("papa_pastusa", 500),
];

describe("generación de menú — el escenario del brief (§14, §37)", () => {
  const result = plan(household(), INVENTARIO_BRIEF);

  it("planifica las 90 comidas de 2 personas × 30 días × 3 comidas", () => {
    expect(result.diagnostics.mealsRequested).toBe(90);
    expect(result.meals).toHaveLength(90);
    expect(result.diagnostics.mealsPlanned).toBe(90);
  });

  it("cabe en el presupuesto de $800.000", () => {
    expect(result.projectedSpendCop).toBeLessThanOrEqual(800_000);
    expect(result.diagnostics.withinBudget).toBe(true);
    expect(result.diagnostics.budgetDeltaCop).toBeGreaterThanOrEqual(0);
  });

  it("NUNCA afirma haber encontrado el óptimo global (§31)", () => {
    expect(result.diagnostics.method).toBe("heuristic");
  });

  it("da variedad en vez de repetir el mismo plato 90 veces", () => {
    expect(result.diagnostics.distinctRecipes).toBeGreaterThanOrEqual(10);
  });

  it("consolida la compra: un ingrediente aparece UNA vez en el requerimiento neto", () => {
    const ids = result.netRequirements.map((entry) => entry.ingredientId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("usa el inventario: lo que hay en casa se consume de la despensa", () => {
    const desdeDespensa = new Map<string, number>();
    for (const meal of result.meals) {
      for (const line of meal.lines) {
        if (line.fromInventoryBase > 0) {
          desdeDespensa.set(
            line.ingredientId,
            (desdeDespensa.get(line.ingredientId) ?? 0) + line.fromInventoryBase,
          );
        }
      }
    }
    // Los cinco ingredientes del inventario inicial deben aparecer consumidos.
    for (const item of INVENTARIO_BRIEF) {
      expect(desdeDespensa.get(item.ingredientId) ?? 0, item.ingredientId).toBeGreaterThan(0);
    }
  });

  it("con inventario se obtiene más comida por cada peso gastado", () => {
    const sinInventario = plan(household(), []);
    const rendimiento = (p: typeof result) => p.totalFoodValueCop / Math.max(1, p.projectedSpendCop);
    expect(rendimiento(result)).toBeGreaterThan(rendimiento(sinInventario));
  });

  it("avisa de que los precios son de demostración", () => {
    expect(result.diagnostics.warnings.join(" ")).toMatch(/demostración/i);
  });

  it("cada comida tiene fecha, slot, costo y porciones", () => {
    for (const meal of result.meals) {
      expect(meal.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(["desayuno", "almuerzo", "cena", "snack"]).toContain(meal.slot);
      expect(meal.costCop).toBeGreaterThan(0);
      expect(meal.servings).toBeGreaterThan(0);
      expect(meal.status).toBe("planned");
    }
  });

  it("calcula un costo promedio por comida y por persona", () => {
    const avg = averageCostPerMealPerPerson(result.totalFoodValueCop, result.meals.length, 2);
    expect(avg).not.toBeNull();
    expect(avg!).toBeGreaterThan(0);
  });
});

describe("determinismo", () => {
  it("misma entrada ⇒ mismo plan, exactamente", () => {
    const a = plan(household(), INVENTARIO_BRIEF);
    const b = plan(household(), INVENTARIO_BRIEF);
    expect(a.meals.map((m) => m.recipeId)).toEqual(b.meals.map((m) => m.recipeId));
    expect(a.projectedSpendCop).toBe(b.projectedSpendCop);
    expect(a.seed).toBe(b.seed);
  });

  it("semillas distintas pueden dar planes distintos", () => {
    const a = generateMealPlan({
      household: household(), startDate: START, inventory: [], recipes: RECIPES,
      catalog: INGREDIENT_BY_ID, prices, seed: 1,
    });
    const b = generateMealPlan({
      household: household(), startDate: START, inventory: [], recipes: RECIPES,
      catalog: INGREDIENT_BY_ID, prices, seed: 999_999,
    });
    expect(a.seed).not.toBe(b.seed);
    // No se exige que difieran (la heurística es fuertemente determinista),
    // pero ambos deben ser planes válidos y completos.
    expect(a.meals).toHaveLength(90);
    expect(b.meals).toHaveLength(90);
  });
});

describe("casos del §32", () => {
  it("1 persona × 7 días", () => {
    const result = plan(household({ adults: 1, days: 7, budgetCop: 150_000 }));
    expect(result.meals).toHaveLength(21);
    expect(result.projectedSpendCop).toBeGreaterThan(0);
  });

  it("2 personas × 30 días", () => {
    const result = plan(household({ adults: 2, days: 30 }));
    expect(result.meals).toHaveLength(90);
  });

  it("4 personas × 30 días", () => {
    const result = plan(household({ adults: 4, days: 30, budgetCop: 1_400_000 }));
    expect(result.meals).toHaveLength(90);
    expect(result.diagnostics.withinBudget).toBe(true);
  });

  it("hogar con niños escala las porciones hacia abajo", () => {
    const conNinos = plan(household({ adults: 2, children: 2, days: 7 }));
    const soloAdultos = plan(household({ adults: 4, children: 0, days: 7 }));
    expect(conNinos.meals[0]!.servings).toBeCloseTo(eaterEquivalents(2, 2), 2);
    expect(conNinos.meals[0]!.servings).toBeLessThan(soloAdultos.meals[0]!.servings);
  });

  it("presupuesto MUY bajo: no miente, avisa que no alcanza", () => {
    const result = plan(household({ budgetCop: 30_000, days: 30 }));
    expect(result.diagnostics.withinBudget).toBe(false);
    expect(result.diagnostics.budgetDeltaCop).toBeLessThan(0);
    expect(result.diagnostics.warnings.join(" ")).toMatch(/no se encontró un plan/i);
    expect(result.diagnostics.repairSteps.length).toBeGreaterThan(0);
    // Aun así entrega un plan completo, el más barato que pudo construir.
    expect(result.meals).toHaveLength(90);
  });

  it("presupuesto bajo produce un plan más barato que uno holgado", () => {
    const bajo = plan(household({ budgetCop: 250_000 }));
    const alto = plan(household({ budgetCop: 3_000_000 }));
    expect(bajo.projectedSpendCop).toBeLessThan(alto.projectedSpendCop);
  });

  it("presupuesto alto: cabe y sobra", () => {
    const result = plan(household({ budgetCop: 5_000_000 }));
    expect(result.diagnostics.withinBudget).toBe(true);
    expect(result.diagnostics.budgetDeltaCop).toBeGreaterThan(0);
  });

  it("inventario abundante reduce muchísimo la compra", () => {
    const abundante = [
      inv("arroz_blanco", 20_000), inv("pollo_muslo", 10_000), inv("huevo", 200),
      inv("lenteja", 5_000), inv("papa_pastusa", 15_000), inv("tomate", 60),
      inv("cebolla_cabezona", 40), inv("aceite_girasol", 3_000), inv("sal", 1_000),
    ];
    const conInventario = plan(household(), abundante);
    const sinInventario = plan(household(), []);
    expect(conInventario.projectedSpendCop).toBeLessThan(sinInventario.projectedSpendCop * 0.85);
  });

  it("inventario vacío sigue produciendo un plan válido", () => {
    const result = plan(household(), []);
    expect(result.meals).toHaveLength(90);
    expect(result.netRequirements.length).toBeGreaterThan(0);
  });

  it("ingredientes SIN precio: no rompe, avisa y no los cuenta como $0", () => {
    const parciales = DEMO_PRICES.filter((p) => p.ingredientId !== "arroz_blanco");
    const index = new PriceIndex(parciales, INGREDIENT_BY_ID, DEMO_OBSERVED_ON);
    const result = generateMealPlan({
      household: household({ days: 7 }), startDate: START, inventory: [],
      recipes: RECIPES, catalog: INGREDIENT_BY_ID, prices: index,
    });
    expect(result.unpricedIngredientIds).toContain("arroz_blanco");
    expect(result.diagnostics.warnings.join(" ")).toMatch(/no tienen precio/i);
    expect(result.meals.length).toBeGreaterThan(0);
  });

  it("recetas con ingredientes desconocidos no rompen el plan", () => {
    const rota: Recipe = {
      id: "receta_fantasma", name: "Receta fantasma", description: "",
      baseServings: 4, slots: ["almuerzo"], minutes: 10, difficulty: "facil",
      region: "Colombia", tags: [],
      ingredients: [
        { ingredientId: "unobtainium", qty: 1, unit: "g" },
        { ingredientId: "vaporware", qty: 1, unit: "g" },
      ],
      steps: ["nada"], nutritionIsEstimated: true,
    };
    const result = plan(household({ days: 3 }), [], [...RECIPES, rota]);
    expect(result.meals.length).toBe(9);
    // Se descarta por no poder costearse: menos de la mitad de sus ingredientes
    // son reconocibles.
    expect(result.meals.some((m) => m.recipeId === "receta_fantasma")).toBe(false);
  });

  it("solo desayunos: planifica 1 comida al día", () => {
    const result = plan(household({ slots: ["desayuno"], days: 10 }));
    expect(result.meals).toHaveLength(10);
    expect(result.meals.every((m) => m.slot === "desayuno")).toBe(true);
  });

  it("rechaza un hogar sin comidas o sin días", () => {
    expect(() => plan(household({ slots: [] }))).toThrow(RangeError);
    expect(() => plan(household({ days: 0 }))).toThrow(RangeError);
  });
});

describe("preferencias y restricciones", () => {
  it("una ALERGIA excluye la receta aunque el ingrediente sea opcional", () => {
    const result = plan(
      household({ days: 14, preferences: [{ kind: "allergy", value: "huevo", severity: "hard" }] }),
    );
    const conHuevo = result.meals.filter((meal) =>
      RECIPES.find((r) => r.id === meal.recipeId)!.ingredients.some((i) => i.ingredientId === "huevo"),
    );
    expect(conHuevo).toEqual([]);
  });

  it("una dieta obligatoria filtra por etiqueta", () => {
    const result = plan(
      household({ days: 7, preferences: [{ kind: "diet", value: "vegetariano", severity: "hard" }] }),
    );
    for (const meal of result.meals) {
      expect(RECIPES.find((r) => r.id === meal.recipeId)!.tags).toContain("vegetariano");
    }
  });

  it("un rechazo blando reduce la frecuencia sin prohibir", () => {
    const sinPreferencia = plan(household({ days: 20 }));
    const conRechazo = plan(
      household({ days: 20, preferences: [{ kind: "dislike", value: "lenteja", severity: "soft" }] }),
    );
    const cuenta = (p: typeof sinPreferencia) =>
      p.meals.filter((meal) =>
        RECIPES.find((r) => r.id === meal.recipeId)!.ingredients.some((i) => i.ingredientId === "lenteja"),
      ).length;
    expect(cuenta(conRechazo)).toBeLessThanOrEqual(cuenta(sinPreferencia));
  });
});

describe("caducidad (§13.7)", () => {
  it("prefiere gastar lo que vence pronto", () => {
    const result = plan(household({ days: 3 }), [
      inv("pollo_muslo", 1000, "2026-09-09"),
      inv("tomate", 10, "2026-09-10"),
      inv("arroz_blanco", 2000),
    ]);
    const usado = result.meals
      .flatMap((m) => m.lines)
      .filter((l) => l.ingredientId === "pollo_muslo" && l.fromInventoryBase > 0);
    expect(usado.length).toBeGreaterThan(0);
  });
});
