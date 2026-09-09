import { describe, expect, it } from "vitest";
import {
  DEMO_OBSERVED_ON, DEMO_PRICES, DEMO_PRICE_HISTORY, INGREDIENT_BY_ID, RECIPES, RECIPE_BY_ID,
} from "@rinde/data";
import { PriceIndex } from "../src/pricing.js";
import { generateMealPlan } from "../src/planner.js";
import { cookMeal, detectLeftovers, suggestLeftoverUses } from "../src/cooking.js";
import { whatCanICook } from "../src/what-can-i-cook.js";
import { rindeMas, averageGramsPerMeal } from "../src/rinde-mas.js";
import { equivalentQuantity, evaluateSubstitution, suggestForRecipe, substituteExpensive } from "../src/substitutions.js";
import { describeChange, parsePriceCsv, validateObservations, weeklyPriceUpdate } from "../src/price-update.js";
import { parsePantryText } from "../src/nl-parse.js";
import { parseCsv } from "../src/csv.js";
import { can, maxPlanDays } from "../src/entitlements.js";
import { scaleRecipe } from "../src/scaling.js";
import type { Household, InventoryItem } from "../src/types.js";

const prices = new PriceIndex(DEMO_PRICES, INGREDIENT_BY_ID, DEMO_OBSERVED_ON);
const household: Household = {
  id: "h_feat", adults: 2, children: 0, budgetCop: 800_000, city: "Bogotá",
  slots: ["desayuno", "almuerzo", "cena"], days: 30, preferences: [],
  tier: "free", createdOn: DEMO_OBSERVED_ON,
};
function inv(ingredientId: string, qtyBase: number, expiresOn?: string): InventoryItem {
  return { id: `i_${ingredientId}`, ingredientId, qtyBase, updatedOn: DEMO_OBSERVED_ON,
    ...(expiresOn ? { expiresOn } : {}) };
}

describe("cocinar descuenta el inventario (§10)", () => {
  const plan = generateMealPlan({
    household: { ...household, days: 2 }, startDate: DEMO_OBSERVED_ON,
    inventory: [], recipes: RECIPES, catalog: INGREDIENT_BY_ID, prices,
  });

  it("1 kg de pollo menos 400 g deja 600 g", () => {
    const meal = { ...plan.meals[0]!, lines: [
      { ingredientId: "pollo_pechuga", qtyBase: 400, fromInventoryBase: 400, toBuyBase: 0,
        valueCop: 7560, priceConfidence: "reported" as const, priceIsDemo: true },
    ] };
    const result = cookMeal(meal, [inv("pollo_pechuga", 1000)], DEMO_OBSERVED_ON);
    expect(result.inventory[0]!.qtyBase).toBe(600);
    expect(result.shortages).toEqual([]);
    expect(result.meal.status).toBe("cooked");
  });

  it("consume primero lo que vence antes", () => {
    const meal = { ...plan.meals[0]!, lines: [
      { ingredientId: "tomate", qtyBase: 3, fromInventoryBase: 3, toBuyBase: 0,
        valueCop: 1500, priceConfidence: "reported" as const, priceIsDemo: true },
    ] };
    const result = cookMeal(meal, [
      { ...inv("tomate", 3, "2026-09-25"), id: "tarde" },
      { ...inv("tomate", 3, "2026-09-11"), id: "pronto" },
    ], DEMO_OBSERVED_ON);
    expect(result.inventory.find((i) => i.id === "pronto")).toBeUndefined();
    expect(result.inventory.find((i) => i.id === "tarde")!.qtyBase).toBe(3);
  });

  it("lo que falta se reporta como faltante, no se inventa", () => {
    const meal = { ...plan.meals[0]!, lines: [
      { ingredientId: "pollo_pechuga", qtyBase: 800, fromInventoryBase: 0, toBuyBase: 800,
        valueCop: 15120, priceConfidence: "reported" as const, priceIsDemo: true },
    ] };
    const result = cookMeal(meal, [inv("pollo_pechuga", 300)], DEMO_OBSERVED_ON);
    expect(result.shortages).toEqual([{ ingredientId: "pollo_pechuga", missingBase: 500 }]);
  });

  it("cocinar no muta el inventario recibido", () => {
    const original = [inv("pollo_pechuga", 1000)];
    const meal = { ...plan.meals[0]!, lines: [
      { ingredientId: "pollo_pechuga", qtyBase: 400, fromInventoryBase: 400, toBuyBase: 0,
        valueCop: 7560, priceConfidence: "reported" as const, priceIsDemo: true },
    ] };
    cookMeal(meal, original, DEMO_OBSERVED_ON);
    expect(original[0]!.qtyBase).toBe(1000);
  });
});

describe("sobras (§22)", () => {
  it("detecta sobras perecederas y no considera sobra la despensa seca", () => {
    const leftovers = detectLeftovers(
      [inv("pollo_pechuga", 300), inv("arroz_blanco", 2000)],
      INGREDIENT_BY_ID, "comida_1", DEMO_OBSERVED_ON,
    );
    expect(leftovers.map((l) => l.ingredientId)).toEqual(["pollo_pechuga"]);
  });

  it("sugiere recetas que aprovechan el pollo que sobró", () => {
    const leftovers = detectLeftovers([inv("pollo_pechuga", 300)], INGREDIENT_BY_ID, "m", DEMO_OBSERVED_ON);
    const suggestions = suggestLeftoverUses(leftovers, RECIPES, [inv("pollo_pechuga", 300), inv("arroz_blanco", 1000)]);
    expect(suggestions.length).toBeGreaterThan(0);
    for (const suggestion of suggestions) {
      expect(suggestion.usesIngredientIds).toContain("pollo_pechuga");
    }
  });

  it("sin sobras no sugiere nada", () => {
    expect(suggestLeftoverUses([], RECIPES, [])).toEqual([]);
  });
});

describe("¿qué puedo cocinar? (§11)", () => {
  const despensa = [
    inv("pollo_pechuga", 600), inv("arroz_blanco", 1000), inv("huevo", 6),
    inv("tomate", 4), inv("cebolla_cabezona", 3), inv("aceite_girasol", 500),
    inv("sal", 200),
  ];

  it("propone recetas ordenadas por cuánto se cubre con lo que hay", () => {
    const options = whatCanICook(despensa, RECIPES, INGREDIENT_BY_ID, prices, 2);
    expect(options.length).toBeGreaterThan(0);
    for (let i = 1; i < options.length; i++) {
      expect(options[i - 1]!.coverage).toBeGreaterThanOrEqual(options[i]!.coverage);
    }
    expect(options[0]!.coveragePct).toBeGreaterThanOrEqual(40);
  });

  it("informa qué falta y cuánto costaría completarlo", () => {
    const options = whatCanICook(despensa, RECIPES, INGREDIENT_BY_ID, prices, 2);
    const incompleta = options.find((option) => option.coverage < 1);
    expect(incompleta).toBeDefined();
    expect(incompleta!.missingIngredientIds.length).toBeGreaterThan(0);
    expect(incompleta!.missingCostCop).toBeGreaterThan(0);
  });

  it("una despensa vacía no puede cocinar nada", () => {
    expect(whatCanICook([], RECIPES, INGREDIENT_BY_ID, prices, 2)).toEqual([]);
  });

  it("respeta el filtro por tipo de comida", () => {
    const options = whatCanICook(despensa, RECIPES, INGREDIENT_BY_ID, prices, 2, { slot: "desayuno" });
    for (const option of options) expect(option.slots).toContain("desayuno");
  });

  it("excluye ingredientes vetados", () => {
    const options = whatCanICook(despensa, RECIPES, INGREDIENT_BY_ID, prices, 2, {
      excludedIngredientIds: new Set(["huevo"]),
    });
    for (const option of options) {
      expect(RECIPE_BY_ID.get(option.recipeId)!.ingredients.map((i) => i.ingredientId)).not.toContain("huevo");
    }
  });
});

describe("sustituciones (§21)", () => {
  it("equipara proteínas por proteína, no por peso", () => {
    const carne = INGREDIENT_BY_ID.get("carne_res")!;
    const lenteja = INGREDIENT_BY_ID.get("lenteja")!;
    const equivalent = equivalentQuantity(carne, lenteja, 500)!;
    expect(equivalent.basis).toBe("protein");
    // 500 g de res (21 g/100 g) = 105 g de proteína ≈ 407 g de lenteja (25,8 g/100 g)
    expect(equivalent.qtyBase).toBeCloseTo(407, 0);
  });

  it("cambiar carne por lentejas ahorra dinero y lo dice con números reales", () => {
    const carne = INGREDIENT_BY_ID.get("carne_res")!;
    const lenteja = INGREDIENT_BY_ID.get("lenteja")!;
    const suggestion = evaluateSubstitution(carne, lenteja, 1000, prices)!;
    expect(suggestion.fromCostCop).toBe(28_000);
    expect(suggestion.savingCop).toBeGreaterThan(0);
    expect(suggestion.toCostCop).toBe(prices.costOf("lenteja", suggestion.toQtyBase));
  });

  it("sin precio de alguno de los dos NO se afirma ningún ahorro", () => {
    const sinLenteja = new PriceIndex(
      DEMO_PRICES.filter((p) => p.ingredientId !== "lenteja"), INGREDIENT_BY_ID, DEMO_OBSERVED_ON,
    );
    const carne = INGREDIENT_BY_ID.get("carne_res")!;
    const lenteja = INGREDIENT_BY_ID.get("lenteja")!;
    expect(evaluateSubstitution(carne, lenteja, 1000, sinLenteja)).toBeNull();
  });

  it("sugiere sustituciones dentro de una receta, de mayor a menor ahorro", () => {
    const sudado = RECIPE_BY_ID.get("sudado_carne")!;
    const scaled = scaleRecipe(sudado, 4, INGREDIENT_BY_ID);
    const quantities = new Map(scaled.lines.map((l) => [l.ingredientId, l.qtyBase]));
    const suggestions = suggestForRecipe(sudado, quantities, INGREDIENT_BY_ID, prices);
    expect(suggestions.length).toBeGreaterThan(0);
    for (let i = 1; i < suggestions.length; i++) {
      expect(suggestions[i - 1]!.savingCop).toBeGreaterThanOrEqual(suggestions[i]!.savingCop);
    }
  });

  it("no propone un ingrediente excluido por alergia", () => {
    const sudado = RECIPE_BY_ID.get("sudado_carne")!;
    const scaled = scaleRecipe(sudado, 4, INGREDIENT_BY_ID);
    const quantities = new Map(scaled.lines.map((l) => [l.ingredientId, l.qtyBase]));
    const suggestions = suggestForRecipe(sudado, quantities, INGREDIENT_BY_ID, prices, {
      excludedIngredientIds: new Set(["lenteja"]),
    });
    expect(suggestions.map((s) => s.toIngredientId)).not.toContain("lenteja");
  });

  it("substituteExpensive devuelve una receta más barata sin mutar la original", () => {
    const sudado = RECIPE_BY_ID.get("sudado_carne")!;
    const { recipe, applied } = substituteExpensive(sudado, INGREDIENT_BY_ID, prices, { minSavingCop: 200 });
    expect(applied.length).toBeGreaterThan(0);
    expect(sudado.ingredients).not.toBe(recipe.ingredients);
    expect(RECIPE_BY_ID.get("sudado_carne")!.ingredients[0]!.ingredientId).toBe("carne_res");
  });
});

describe("rinde más (§12)", () => {
  const plan = generateMealPlan({
    household, startDate: DEMO_OBSERVED_ON, inventory: [], recipes: RECIPES,
    catalog: INGREDIENT_BY_ID, prices,
  });

  it("propone tres opciones y ninguna se pasa del dinero extra", () => {
    const options = rindeMas(50_000, plan, INGREDIENT_BY_ID, prices);
    expect(options).toHaveLength(3);
    for (const option of options) {
      expect(option.totalCop).toBeLessThanOrEqual(50_000);
      expect(option.items.length).toBeGreaterThan(0);
      expect(option.basis).toBeTruthy();
    }
  });

  it("las comidas extra salen del consumo real del plan, no de una constante", () => {
    const gramos = averageGramsPerMeal(plan, INGREDIENT_BY_ID, ["proteina", "proteina_vegetal"]);
    expect(gramos).not.toBeNull();
    expect(gramos!).toBeGreaterThan(0);
    const options = rindeMas(50_000, plan, INGREDIENT_BY_ID, prices);
    const proteina = options.find((o) => o.id === "mas_proteina")!;
    expect(proteina.extraMeals).not.toBeNull();
    expect(proteina.extraMeals!).toBeGreaterThanOrEqual(0);
  });

  it("sin datos de la categoría en el plan devuelve null en vez de inventar", () => {
    const planVacio = { ...plan, meals: [] };
    expect(averageGramsPerMeal(planVacio, INGREDIENT_BY_ID, ["proteina"])).toBeNull();
    const options = rindeMas(50_000, planVacio, INGREDIENT_BY_ID, prices);
    expect(options.every((o) => o.extraMeals === null)).toBe(true);
    expect(options[0]!.basis).toMatch(/no se puede estimar/i);
  });

  it("sin dinero extra no propone nada", () => {
    expect(rindeMas(0, plan, INGREDIENT_BY_ID, prices)).toEqual([]);
  });
});

describe("actualización semanal de precios (§19)", () => {
  it("valida y RECHAZA con número de línea lo que no sirve", () => {
    const { accepted, errors } = validateObservations([
      { ingredientId: "arroz_blanco", priceCop: 4800, quantity: 1, unit: "kg", city: "Bogotá",
        observedOn: "2026-09-14", confidence: "measured" },
      { ingredientId: "no_existe", priceCop: 100, quantity: 1, unit: "kg", city: "Bogotá",
        observedOn: "2026-09-14", confidence: "measured" },
      { ingredientId: "lenteja", priceCop: -5, quantity: 1, unit: "kg", city: "Bogotá",
        observedOn: "2026-09-14", confidence: "measured" },
      { ingredientId: "lenteja", priceCop: 6500, quantity: 1, unit: "kg", city: "",
        observedOn: "2026-09-14", confidence: "measured" },
    ], INGREDIENT_BY_ID);
    expect(accepted).toHaveLength(1);
    expect(errors).toHaveLength(3);
    expect(errors[0]).toMatch(/Línea 2.*no_existe/);
    expect(errors[1]).toMatch(/Línea 3/);
    expect(errors[2]).toMatch(/Línea 4.*ciudad/);
  });

  it("detecta la variación contra la semana anterior", () => {
    const result = weeklyPriceUpdate({
      sourceId: "manual_admin",
      observations: [{
        ingredientId: "pollo_pechuga", priceCop: 19_600, quantity: 1, unit: "kg",
        city: "Bogotá", observedOn: "2026-09-14", confidence: "measured",
      }],
      catalog: INGREDIENT_BY_ID,
      previousHistory: [{ ingredientId: "pollo_pechuga", week: "2026-W37", copPerBaseUnit: 18.9, city: "Bogotá" }],
      asOf: "2026-09-14",
    });
    expect(result.report.accepted).toBe(1);
    expect(result.report.week).toBe("2026-W38");
    const change = result.report.changes[0]!;
    expect(change.direction).toBe("up");
    expect(change.changePct).toBeCloseTo(3.7, 1);
    expect(describeChange(change)).toMatch(/^Subió 3,7% esta semana$/);
  });

  it("guarda historial normalizado a la unidad base", () => {
    const result = weeklyPriceUpdate({
      sourceId: "manual_admin",
      observations: [{ ingredientId: "arroz_blanco", priceCop: 5000, quantity: 1, unit: "kg",
        city: "Bogotá", observedOn: "2026-09-14", confidence: "measured" }],
      catalog: INGREDIENT_BY_ID, previousHistory: [], asOf: "2026-09-14",
    });
    expect(result.history[0]!.copPerBaseUnit).toBe(5);
    expect(result.report.changes).toEqual([]);
  });

  it("el historial demo permite comparar con la semana anterior", () => {
    expect(DEMO_PRICE_HISTORY.length).toBe(DEMO_PRICES.length);
    const result = weeklyPriceUpdate({
      sourceId: "demo_bogota", isDemo: true,
      observations: DEMO_PRICES.map((p) => ({
        ingredientId: p.ingredientId, priceCop: p.priceCop, quantity: p.quantity,
        unit: p.unit, city: p.city, observedOn: p.observedOn, confidence: p.confidence,
      })),
      catalog: INGREDIENT_BY_ID, previousHistory: DEMO_PRICE_HISTORY, asOf: DEMO_OBSERVED_ON,
    });
    expect(result.report.changes.length).toBeGreaterThan(50);
    expect(result.prices.every((p) => p.isDemo)).toBe(true);
  });

  it("describe correctamente una bajada y un precio sin cambio", () => {
    expect(describeChange({ ingredientId: "x", previousCopPerBaseUnit: 100,
      currentCopPerBaseUnit: 95, changePct: -5, direction: "down" })).toBe("Bajó 5,0% esta semana");
    expect(describeChange({ ingredientId: "x", previousCopPerBaseUnit: 100,
      currentCopPerBaseUnit: 100, changePct: 0, direction: "flat" })).toBe("Sin cambio esta semana");
  });
});

describe("importación CSV (§18)", () => {
  it("lee el formato documentado", () => {
    const csv = [
      "ingredient_id,price_cop,quantity,unit,city,store,source_id,observed_on,confidence",
      "pollo_pechuga,18900,1,kg,Bogotá,Plaza Paloquemao,manual_admin,2026-09-07,measured",
      "arroz_blanco,4200,1,kg,Bogotá,D1,manual_admin,2026-09-07,measured",
    ].join("\n");
    const { observations, errors } = parsePriceCsv(csv);
    expect(errors).toEqual([]);
    expect(observations).toHaveLength(2);
    expect(observations[0]).toMatchObject({
      ingredientId: "pollo_pechuga", priceCop: 18_900, unit: "kg",
      city: "Bogotá", storeId: "Plaza Paloquemao", confidence: "measured",
    });
  });

  it("maneja comas dentro de campos entrecomillados", () => {
    const rows = parseCsv('a,b\n"uno, dos",tres\n');
    expect(rows).toEqual([["a", "b"], ["uno, dos", "tres"]]);
  });

  it("maneja comillas escapadas", () => {
    expect(parseCsv('a\n"di ""hola"""\n')).toEqual([["a"], ['di "hola"']]);
  });

  it("informa la línea exacta de una fila mal formada", () => {
    const csv = "ingredient_id,price_cop,quantity,unit,city,observed_on,confidence\n,100,1,kg,Bogotá,2026-09-07,measured\n";
    const { errors } = parsePriceCsv(csv);
    expect(errors[0]).toMatch(/Línea 2/);
  });
});

describe("interpretación de lenguaje natural (§23)", () => {
  it("entiende la frase del brief sin inventar cantidades", () => {
    const result = parsePantryText(
      "Tengo un poquito de pollo, unas papas y tres tomates", INGREDIENT_BY_ID,
    );
    const ids = result.items.map((i) => i.ingredientId);
    expect(ids).toContain("pollo_pechuga");
    expect(ids).toContain("papa_pastusa");
    expect(ids).toContain("tomate");

    const pollo = result.items.find((i) => i.ingredientId === "pollo_pechuga")!;
    expect(pollo.qtyBase).toBeNull();
    expect(pollo.needsConfirmation).toBe(true);
    expect(pollo.confidence).toBe("low");

    const tomate = result.items.find((i) => i.ingredientId === "tomate")!;
    expect(tomate.qtyBase).toBe(3);
    expect(tomate.needsConfirmation).toBe(false);
  });

  it("entiende cantidades con unidad explícita", () => {
    const result = parsePantryText("2 kg de arroz, media libra de lentejas", INGREDIENT_BY_ID);
    const arroz = result.items.find((i) => i.ingredientId === "arroz_blanco")!;
    expect(arroz.qtyBase).toBe(2000);
    expect(arroz.confidence).toBe("high");
    const lenteja = result.items.find((i) => i.ingredientId === "lenteja")!;
    expect(lenteja.qtyBase).toBe(250);
  });

  it("funciona sin tildes y en plural", () => {
    const result = parsePantryText("2 platanos y 3 zanahorias", INGREDIENT_BY_ID);
    expect(result.items.map((i) => i.ingredientId).sort()).toEqual(["platano_verde", "zanahoria"]);
  });

  it("reporta lo que no reconoce en vez de descartarlo en silencio", () => {
    const result = parsePantryText("dos kriptonitas y un huevo", INGREDIENT_BY_ID);
    expect(result.unrecognized).toContain("dos kriptonitas");
    expect(result.items).toHaveLength(1);
  });

  it("prefiere la coincidencia más específica", () => {
    const result = parsePantryText("500 g de pechuga de pollo", INGREDIENT_BY_ID);
    expect(result.items[0]!.ingredientId).toBe("pollo_pechuga");
    expect(result.items[0]!.qtyBase).toBe(500);
  });
});

describe("niveles free/premium (§28)", () => {
  it("free tiene lo básico, premium todo", () => {
    expect(can("recetas", "free")).toBe(true);
    expect(can("plan_mensual", "free")).toBe(false);
    expect(can("plan_mensual", "premium")).toBe(true);
    expect(maxPlanDays("free")).toBe(7);
    expect(maxPlanDays("premium")).toBe(31);
  });
});
