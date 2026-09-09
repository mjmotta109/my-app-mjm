import { describe, expect, it } from "vitest";
import { INGREDIENT_BY_ID } from "@rinde/data";
import { formatQuantity, fromBase, humanize, roundForDisplay, toBase, UnitError } from "../src/units.js";
import type { Ingredient } from "../src/types.js";

const arroz = INGREDIENT_BY_ID.get("arroz_blanco")!;
const huevo = INGREDIENT_BY_ID.get("huevo")!;
const leche = INGREDIENT_BY_ID.get("leche_entera")!;
const aceite = INGREDIENT_BY_ID.get("aceite_girasol")!;

describe("conversión de unidades", () => {
  it("convierte dentro de la misma dimensión", () => {
    expect(toBase(1, "kg", arroz)).toBe(1000);
    expect(toBase(250, "g", arroz)).toBe(250);
    expect(toBase(1, "l", leche)).toBe(1000);
  });

  it("convierte unidades de cocina a mililitros", () => {
    expect(toBase(1, "taza", leche)).toBe(250);
    expect(toBase(1, "cda", leche)).toBe(15);
    expect(toBase(3, "cdta", leche)).toBe(15);
  });

  it("convierte conteo a masa usando gramsPerUnit", () => {
    expect(toBase(2, "unit", huevo)).toBe(2); // huevo tiene base 'unit'
    const carne = INGREDIENT_BY_ID.get("carne_molida")!;
    expect(() => toBase(1, "unit", carne)).toThrow(UnitError);
  });

  it("convierte volumen a masa solo si hay densidad", () => {
    // El aceite tiene base ml y densidad declarada.
    expect(toBase(1, "l", aceite)).toBe(1000);
    const arrozSinDensidad: Ingredient = { ...arroz };
    delete (arrozSinDensidad as { gramsPerMl?: number }).gramsPerMl;
    expect(() => toBase(1, "taza", arrozSinDensidad)).toThrow(UnitError);
  });

  it("NO adivina: falla explícitamente cuando falta el dato", () => {
    const sinDatos: Ingredient = { ...arroz, gramsPerUnit: undefined };
    expect(() => toBase(1, "unit", sinDatos)).toThrow(/gramsPerUnit/);
  });

  it("fromBase es la inversa de toBase", () => {
    expect(fromBase(1500, "kg", arroz)).toBe(1.5);
    expect(fromBase(500, "g", arroz)).toBe(500);
  });
});

describe("redondeo para humanos (§9)", () => {
  it("nunca muestra 0,37 huevos", () => {
    expect(roundForDisplay(0.37, huevo)).toBe(1);
    expect(roundForDisplay(1.4, huevo)).toBe(1);
    expect(roundForDisplay(1.6, huevo)).toBe(2);
    expect(Number.isInteger(roundForDisplay(2.5, huevo))).toBe(true);
  });

  it("un ingrediente discreto pedido en cantidad positiva nunca queda en 0", () => {
    expect(roundForDisplay(0.01, huevo)).toBe(1);
  });

  it("una cantidad de cero sigue siendo cero", () => {
    expect(roundForDisplay(0, huevo)).toBe(0);
    expect(roundForDisplay(0, arroz)).toBe(0);
  });

  it("redondea los continuos a un paso legible", () => {
    expect(roundForDisplay(347, arroz) % arroz.roundingStep).toBe(0);
    expect(roundForDisplay(1, arroz)).toBe(arroz.roundingStep);
  });

  it("elige la unidad más legible al mostrar", () => {
    expect(humanize(1500, arroz)).toEqual({ qty: 1.5, unit: "kg" });
    expect(humanize(800, arroz)).toEqual({ qty: 800, unit: "g" });
    expect(humanize(12, huevo)).toEqual({ qty: 12, unit: "unit" });
    expect(formatQuantity(humanize(12, huevo))).toBe("12 unidades");
    expect(formatQuantity(humanize(1, huevo))).toBe("1 unidad");
    expect(formatQuantity({ qty: 1.5, unit: "kg" })).toBe("1,5 kg");
  });
});
