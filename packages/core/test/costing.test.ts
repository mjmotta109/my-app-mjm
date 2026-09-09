import { describe, expect, it } from "vitest";
import { DEMO_OBSERVED_ON, DEMO_PRICES, INGREDIENT_BY_ID, RECIPE_BY_ID } from "@rinde/data";
import { PriceIndex } from "../src/pricing.js";
import { VirtualPantry } from "../src/inventory.js";
import { costMeal } from "../src/costing.js";
import { scaleRecipe } from "../src/scaling.js";
import { sumCop } from "../src/money.js";
import type { IngredientPrice, InventoryItem } from "../src/types.js";

const prices = new PriceIndex(DEMO_PRICES, INGREDIENT_BY_ID, DEMO_OBSERVED_ON);
const pollo = RECIPE_BY_ID.get("pollo_guisado")!;

function inv(ingredientId: string, qtyBase: number): InventoryItem {
  return { id: `i_${ingredientId}`, ingredientId, qtyBase, updatedOn: DEMO_OBSERVED_ON };
}

describe("costeo de una comida (§15)", () => {
  it("el costo total es la suma exacta de las líneas", () => {
    const scale = scaleRecipe(pollo, 2, INGREDIENT_BY_ID);
    const costed = costMeal(scale, new VirtualPantry([]), prices, 2, { commit: false });
    const lines = costed.lines.map((l) => l.valueCop).filter((v): v is number => v !== null);
    expect(costed.costCop).toBe(sumCop(lines));
    expect(costed.costCop).toBeGreaterThan(0);
  });

  it("distingue lo que vale la comida de lo que hay que gastar", () => {
    const scale = scaleRecipe(pollo, 2, INGREDIENT_BY_ID);
    const vacia = costMeal(scale, new VirtualPantry([]), prices, 2, { commit: false });
    const conPollo = costMeal(
      scale,
      new VirtualPantry([inv("pollo_muslo", 1000), inv("arroz_blanco", 1000)]),
      prices,
      2,
      { commit: false },
    );
    expect(conPollo.costCop).toBe(vacia.costCop);           // vale lo mismo
    expect(conPollo.purchaseCop).toBeLessThan(vacia.purchaseCop); // cuesta menos comprar
  });

  it("con la despensa llena no hay nada que comprar", () => {
    const scale = scaleRecipe(pollo, 2, INGREDIENT_BY_ID);
    const llena = new VirtualPantry(
      scale.lines.map((line) => inv(line.ingredientId, line.qtyBase * 10)),
    );
    const costed = costMeal(scale, llena, prices, 2, { commit: false });
    expect(costed.purchaseCop).toBe(0);
    expect(costed.costCop).toBeGreaterThan(0);
  });

  it("el costo por persona multiplicado por las personas vuelve al total", () => {
    const scale = scaleRecipe(pollo, 2, INGREDIENT_BY_ID);
    const costed = costMeal(scale, new VirtualPantry([]), prices, 2, { commit: false });
    expect(Math.abs(costed.costPerPersonCop * 2 - costed.costCop)).toBeLessThanOrEqual(1);
  });

  it("un ingrediente SIN precio no vale $0: la comida queda incompleta (§18)", () => {
    const sinArroz = DEMO_PRICES.filter((p) => p.ingredientId !== "arroz_blanco");
    const index = new PriceIndex(sinArroz, INGREDIENT_BY_ID, DEMO_OBSERVED_ON);
    const scale = scaleRecipe(pollo, 2, INGREDIENT_BY_ID);
    const costed = costMeal(scale, new VirtualPantry([]), index, 2, { commit: false });
    expect(costed.costIncomplete).toBe(true);
    expect(costed.unpricedIngredientIds).toContain("arroz_blanco");
    const arrozLine = costed.lines.find((l) => l.ingredientId === "arroz_blanco")!;
    expect(arrozLine.valueCop).toBeNull();
  });

  it("commit:true descuenta la despensa; commit:false no", () => {
    const scale = scaleRecipe(pollo, 2, INGREDIENT_BY_ID);
    const pantry = new VirtualPantry([inv("arroz_blanco", 1000)]);
    costMeal(scale, pantry, prices, 2, { commit: false });
    expect(pantry.stockOf("arroz_blanco")).toBe(1000);
    costMeal(scale, pantry, prices, 2, { commit: true });
    expect(pantry.stockOf("arroz_blanco")).toBeLessThan(1000);
  });

  it("un ingrediente opcional que no está en casa nunca genera compra", () => {
    const spaghetti = RECIPE_BY_ID.get("spaghetti_carne")!;
    const scale = scaleRecipe(spaghetti, 4, INGREDIENT_BY_ID);
    const costed = costMeal(scale, new VirtualPantry([]), prices, 4, { commit: false });
    expect(costed.lines.some((l) => l.ingredientId === "queso_campesino")).toBe(false);
  });

  it("un ingrediente opcional que SÍ está en casa se usa y no cuesta compra", () => {
    const spaghetti = RECIPE_BY_ID.get("spaghetti_carne")!;
    const scale = scaleRecipe(spaghetti, 4, INGREDIENT_BY_ID);
    const costed = costMeal(scale, new VirtualPantry([inv("queso_campesino", 500)]), prices, 4, {
      commit: false,
    });
    const queso = costed.lines.find((l) => l.ingredientId === "queso_campesino")!;
    expect(queso.toBuyBase).toBe(0);
  });
});

describe("índice de precios (§17, §18)", () => {
  it("normaliza a COP por unidad base", () => {
    const pollo = prices.get("pollo_pechuga")!;
    expect(pollo.copPerBaseUnit).toBeCloseTo(18.9, 5); // $18.900/kg = 18,9 COP/g
    expect(prices.costOf("pollo_pechuga", 1000)).toBe(18900);
  });

  it("degrada a estimado un precio de más de 14 días", () => {
    const index = new PriceIndex(DEMO_PRICES, INGREDIENT_BY_ID, "2026-10-15");
    const pollo = index.get("pollo_pechuga")!;
    expect(pollo.degraded).toBe(true);
    expect(pollo.confidence).toBe("estimated");
  });

  it("prefiere un precio real sobre uno demo, sin promediarlos", () => {
    const real: IngredientPrice = {
      id: "real_1",
      ingredientId: "pollo_pechuga",
      priceCop: 30000,
      quantity: 1,
      unit: "kg",
      city: "Bogotá",
      sourceId: "manual_admin",
      observedOn: DEMO_OBSERVED_ON,
      confidence: "measured",
      isDemo: false,
    };
    const index = new PriceIndex([...DEMO_PRICES, real], INGREDIENT_BY_ID, DEMO_OBSERVED_ON);
    const chosen = index.get("pollo_pechuga")!;
    expect(chosen.isDemo).toBe(false);
    expect(chosen.copPerBaseUnit).toBe(30); // el real, no un promedio con el demo
  });

  it("ignora un precio observado en el futuro", () => {
    const futuro: IngredientPrice = {
      ...DEMO_PRICES[0]!,
      id: "futuro",
      observedOn: "2027-01-01",
      priceCop: 1,
    };
    const index = new PriceIndex([futuro], INGREDIENT_BY_ID, DEMO_OBSERVED_ON);
    expect(index.get(futuro.ingredientId)).toBeUndefined();
  });

  it("costOf devuelve null, nunca 0, para un ingrediente sin precio", () => {
    expect(prices.costOf("ingrediente_inexistente", 100)).toBeNull();
  });

  it("filtra por ciudad cuando se pide", () => {
    const index = new PriceIndex(DEMO_PRICES, INGREDIENT_BY_ID, DEMO_OBSERVED_ON, "Medellín");
    expect(index.size).toBe(0);
  });
});
