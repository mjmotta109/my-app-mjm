import { describe, expect, it } from "vitest";
import { allocate, formatCop, percentChange, splitEvenly, sumCop, assertCop, MoneyError } from "../src/money.js";

describe("dinero (COP entero)", () => {
  it("reparte en partes iguales sin perder ni inventar pesos", () => {
    for (const total of [0, 1, 7, 100, 6900, 763_401]) {
      for (const parts of [1, 2, 3, 4, 7]) {
        const split = splitEvenly(total, parts);
        expect(split).toHaveLength(parts);
        expect(sumCop(split)).toBe(total);
        expect(Math.max(...split) - Math.min(...split)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("$6.900 entre 2 personas da $3.450 por persona", () => {
    expect(splitEvenly(6900, 2)).toEqual([3450, 3450]);
  });

  it("reparte un total impar sin descuadrar la suma", () => {
    const split = splitEvenly(6901, 2);
    expect(split).toEqual([3451, 3450]);
    expect(sumCop(split)).toBe(6901);
  });

  it("reparte proporcionalmente y la suma sigue siendo exacta", () => {
    const parts = allocate(6900, [4500, 700, 1100, 600]);
    expect(sumCop(parts)).toBe(6900);
    expect(parts[0]).toBeGreaterThan(parts[1]!);
  });

  it("con pesos en cero reparte por igual en vez de dividir por cero", () => {
    expect(sumCop(allocate(100, [0, 0, 0]))).toBe(100);
  });

  it("rechaza montos que no son enteros de COP", () => {
    expect(() => assertCop(1200.5)).toThrow(MoneyError);
  });

  it("calcula la variación porcentual con un decimal", () => {
    expect(percentChange(18500, 19200)).toBe(3.8);
    expect(percentChange(19200, 18500)).toBe(-3.6);
  });

  it("formatea en pesos colombianos", () => {
    expect(formatCop(18900)).toBe("$18.900");
    expect(formatCop(800000)).toBe("$800.000");
    expect(formatCop(0)).toBe("$0");
  });
});
