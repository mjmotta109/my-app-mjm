import { describe, expect, it } from "vitest";
import { INGREDIENT_BY_ID, RECIPE_BY_ID } from "@rinde/data";
import { eaterEquivalents, scaleRecipe } from "../src/scaling.js";
import type { Recipe } from "../src/types.js";

const pollo = RECIPE_BY_ID.get("pollo_guisado")!;

describe("escalado de porciones (§9)", () => {
  it("escalar de 4 a 2 personas usa la mitad de un ingrediente continuo", () => {
    const cuatro = scaleRecipe(pollo, 4, INGREDIENT_BY_ID);
    const dos = scaleRecipe(pollo, 2, INGREDIENT_BY_ID);
    const arrozCuatro = cuatro.lines.find((l) => l.ingredientId === "arroz_blanco")!;
    const arrozDos = dos.lines.find((l) => l.ingredientId === "arroz_blanco")!;
    expect(arrozDos.qtyBase).toBeCloseTo(arrozCuatro.qtyBase / 2, 1);
    expect(dos.factor).toBe(0.5);
  });

  it("nunca produce una fracción de un ingrediente discreto", () => {
    for (const servings of [1, 1.7, 2, 2.7, 3, 5, 8]) {
      const scaled = scaleRecipe(pollo, servings, INGREDIENT_BY_ID);
      const tomate = scaled.lines.find((l) => l.ingredientId === "tomate");
      if (tomate) {
        expect(Number.isInteger(tomate.qtyBase), `servings=${servings}`).toBe(true);
        expect(tomate.qtyBase).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("un hogar de 1 persona sigue necesitando al menos un huevo", () => {
    const huevos = RECIPE_BY_ID.get("huevos_pericos")!;
    const scaled = scaleRecipe(huevos, 1, INGREDIENT_BY_ID);
    const huevo = scaled.lines.find((l) => l.ingredientId === "huevo")!;
    expect(huevo.qtyBase).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(huevo.qtyBase)).toBe(true);
  });

  it("guarda la cantidad exacta como diagnóstico junto a la redondeada", () => {
    const scaled = scaleRecipe(pollo, 1, INGREDIENT_BY_ID);
    const tomate = scaled.lines.find((l) => l.ingredientId === "tomate")!;
    expect(tomate.exactBase).toBeCloseTo(0.75, 5);
    expect(tomate.qtyBase).toBe(1);
  });

  it("reporta ingredientes desconocidos en vez de romper (§32)", () => {
    const rota: Recipe = {
      ...pollo,
      id: "receta_rota",
      ingredients: [
        { ingredientId: "arroz_blanco", qty: 200, unit: "g" },
        { ingredientId: "ingrediente_que_no_existe", qty: 1, unit: "unit" },
      ],
    };
    const scaled = scaleRecipe(rota, 2, INGREDIENT_BY_ID);
    expect(scaled.unknownIngredientIds).toEqual(["ingrediente_que_no_existe"]);
    expect(scaled.lines).toHaveLength(1);
  });

  it("rechaza porciones no positivas", () => {
    expect(() => scaleRecipe(pollo, 0, INGREDIENT_BY_ID)).toThrow(RangeError);
    expect(() => scaleRecipe(pollo, -2, INGREDIENT_BY_ID)).toThrow(RangeError);
  });
});

describe("comensales equivalentes", () => {
  it("un niño cuenta como una fracción de adulto (supuesto documentado)", () => {
    expect(eaterEquivalents(2, 0)).toBe(2);
    expect(eaterEquivalents(2, 2)).toBeCloseTo(3.4, 5);
    expect(eaterEquivalents(2, 2, 0.5)).toBe(3);
  });

  it("un hogar vacío no es un hogar", () => {
    expect(() => eaterEquivalents(0, 0)).toThrow(RangeError);
    expect(() => eaterEquivalents(-1, 0)).toThrow(RangeError);
  });
});
