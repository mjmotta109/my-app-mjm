import { describe, expect, it } from "vitest";
import { CATEGORIES, DEMO_OBSERVED_ON, DEMO_PRICES, INGREDIENT_BY_ID, RECIPES } from "@rinde/data";
import { PriceIndex } from "../src/pricing.js";
import { generateMealPlan } from "../src/planner.js";
import { buildShoppingList, cycleCount, pendingTotal, toggleChecked } from "../src/shopping.js";
import type { Household } from "../src/types.js";

const prices = new PriceIndex(DEMO_PRICES, INGREDIENT_BY_ID, DEMO_OBSERVED_ON);
const household: Household = {
  id: "h_lista", adults: 2, children: 0, budgetCop: 800_000, city: "Bogotá",
  slots: ["desayuno", "almuerzo", "cena"], days: 30, preferences: [],
  tier: "free", createdOn: DEMO_OBSERVED_ON,
};
const plan = generateMealPlan({
  household, startDate: DEMO_OBSERVED_ON, inventory: [], recipes: RECIPES,
  catalog: INGREDIENT_BY_ID, prices,
});
const full = buildShoppingList(plan, INGREDIENT_BY_ID, prices, { cycle: "all", categories: CATEGORIES });

describe("lista de mercado (§16)", () => {
  it("agrupa por categoría en el orden en que se recorre el mercado", () => {
    const orders = full.groups.map(
      (group) => CATEGORIES.find((c) => c.id === group.categoryId)!.order,
    );
    expect([...orders]).toEqual([...orders].sort((a, b) => a - b));
    expect(full.groups[0]!.categoryName).toBe("Proteínas");
  });

  it("consolida: cada ingrediente aparece UNA sola vez en toda la lista (§14)", () => {
    const ids = full.groups.flatMap((group) => group.items.map((item) => item.ingredientId));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("el total es la suma exacta de los subtotales", () => {
    const sum = full.groups.reduce((total, group) => total + group.subtotalCop, 0);
    expect(full.totalCop).toBe(sum);
  });

  it("cada subtotal es la suma exacta de sus líneas", () => {
    for (const group of full.groups) {
      const sum = group.items.reduce((total, item) => total + (item.lineCostCop ?? 0), 0);
      expect(group.subtotalCop, group.categoryId).toBe(sum);
    }
  });

  it("el total de la lista coincide con el gasto proyectado del plan", () => {
    expect(full.totalCop).toBe(plan.projectedSpendCop);
  });

  it("compra por formato real: nunca menos de lo que el plan necesita", () => {
    for (const group of full.groups) {
      for (const item of group.items) {
        expect(item.purchaseBase, item.ingredientId).toBeGreaterThanOrEqual(item.neededBase);
        expect(item.surplusBase).toBeCloseTo(item.purchaseBase - item.neededBase, 3);
      }
    }
  });

  it("muestra cantidades legibles, no números de base de datos", () => {
    for (const group of full.groups) {
      for (const item of group.items) {
        expect(item.display.qty).toBeGreaterThan(0);
        expect(["g", "kg", "ml", "l", "unit"]).toContain(item.display.unit);
      }
    }
  });

  it("marca que contiene precios de demostración (§26)", () => {
    expect(full.containsDemoPrices).toBe(true);
  });

  it("divide en ciclos semanales y el primero incluye lo no perecedero", () => {
    expect(cycleCount(plan)).toBe(5);
    const ciclo1 = buildShoppingList(plan, INGREDIENT_BY_ID, prices, { cycle: 1, categories: CATEGORIES });
    const ciclo2 = buildShoppingList(plan, INGREDIENT_BY_ID, prices, { cycle: 2, categories: CATEGORIES });
    const enCiclo1 = new Set(ciclo1.groups.flatMap((g) => g.items.map((i) => i.ingredientId)));
    expect(enCiclo1.has("arroz_blanco")).toBe(true);
    // El arroz (no perecedero) se compra una sola vez, en el primer ciclo.
    const enCiclo2 = new Set(ciclo2.groups.flatMap((g) => g.items.map((i) => i.ingredientId)));
    expect(enCiclo2.has("arroz_blanco")).toBe(false);
    expect(ciclo1.totalCop).toBeGreaterThan(0);
    expect(ciclo1.totalCop).toBeLessThan(full.totalCop);
  });

  it("marcar como comprado no muta la lista original y baja lo pendiente", () => {
    const antes = pendingTotal(full);
    const primero = full.groups[0]!.items[0]!;
    const despues = toggleChecked(full, primero.ingredientId, true);
    expect(pendingTotal(full)).toBe(antes);
    expect(pendingTotal(despues)).toBe(antes - (primero.lineCostCop ?? 0));
  });

  it("un ingrediente sin precio se reporta, no se cuenta como $0", () => {
    const parciales = DEMO_PRICES.filter((p) => p.ingredientId !== "cebolla_cabezona");
    const index = new PriceIndex(parciales, INGREDIENT_BY_ID, DEMO_OBSERVED_ON);
    const otroPlan = generateMealPlan({
      household: { ...household, days: 7 }, startDate: DEMO_OBSERVED_ON, inventory: [],
      recipes: RECIPES, catalog: INGREDIENT_BY_ID, prices: index,
    });
    const lista = buildShoppingList(otroPlan, INGREDIENT_BY_ID, index, { cycle: "all", categories: CATEGORIES });
    if (lista.groups.flatMap((g) => g.items).some((i) => i.ingredientId === "cebolla_cabezona")) {
      expect(lista.unpricedIngredientIds).toContain("cebolla_cabezona");
      const item = lista.groups.flatMap((g) => g.items).find((i) => i.ingredientId === "cebolla_cabezona")!;
      expect(item.lineCostCop).toBeNull();
    }
  });
});
