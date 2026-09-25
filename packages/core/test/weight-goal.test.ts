import { describe, expect, it } from "vitest";
import { DEMO_OBSERVED_ON, DEMO_PRICES, INGREDIENT_BY_ID, RECIPES } from "@rinde/data";
import { PriceIndex } from "../src/pricing.js";
import { generateMealPlan } from "../src/planner.js";
import {
  GENERIC_ADULT, KCAL_FLOOR, MAX_DEFICIT_KCAL, householdNeeds, mealFloor,
  personEnergyNeeds, portionSizing,
} from "../src/nutrition-needs.js";
import type { Household, NutritionGoal, PersonProfile } from "../src/types.js";

/**
 * "Agrega la opción de ahorrar y bajar de peso, o de mantener peso, basado en
 * valores nutricionales e información de la persona."
 *
 * Dos cosas tienen que ser ciertas a la vez: que elegir bajar de peso cambie de
 * verdad lo que se compra (si no, el "ahorrar" es mentira), y que Rinde nunca
 * proponga un déficit a quien no debe tenerlo.
 */

const prices = new PriceIndex(DEMO_PRICES, INGREDIENT_BY_ID, DEMO_OBSERVED_ON);

const ana = (goal: NutritionGoal = "mantener", extra: Partial<PersonProfile> = {}): PersonProfile => ({
  id: "ana", name: "Ana", kind: "adulto", sex: "femenino", ageYears: 30, weightKg: 68,
  heightCm: 162, activity: "sedentario", goal, ...extra,
});
const beto = (goal: NutritionGoal = "mantener", extra: Partial<PersonProfile> = {}): PersonProfile => ({
  id: "beto", name: "Beto", kind: "adulto", sex: "masculino", ageYears: 34, weightKg: 80,
  heightCm: 175, activity: "ligero", goal, ...extra,
});

function hogar(overrides: Partial<Household> = {}): Household {
  return {
    id: "hogar_peso", adults: 2, children: 0, budgetCop: 800_000, city: "Bogotá",
    slots: ["desayuno", "almuerzo", "cena"], days: 30, preferences: [], tier: "free",
    createdOn: DEMO_OBSERVED_ON, ...overrides,
  };
}
const plan = (h: Household) =>
  generateMealPlan({
    household: h, startDate: DEMO_OBSERVED_ON, inventory: [], recipes: RECIPES,
    catalog: INGREDIENT_BY_ID, prices,
  });

describe("porciones: el objetivo cambia la compra solo si se elige", () => {
  it("por defecto, dar el peso NO cambia cuánto se cocina (D21 sigue en pie)", () => {
    const sinPerfil = portionSizing(hogar());
    const conPerfil = portionSizing(hogar({ nutritionProfiles: [ana("bajar_peso"), beto("bajar_peso")] }));
    expect(conPerfil.basis).toBe("estandar");
    expect(conPerfil.eaters).toBe(sinPerfil.eaters);
  });

  it("con porciones según necesidades, cada persona pesa su energía frente a 2.000 kcal", () => {
    const h = hogar({ portionBasis: "necesidades", nutritionProfiles: [ana(), beto()] });
    const esperado =
      personEnergyNeeds(ana()).targetKcal / GENERIC_ADULT.kcal +
      personEnergyNeeds(beto()).targetKcal / GENERIC_ADULT.kcal;
    expect(portionSizing(h).eaters).toBeCloseTo(esperado, 2);
  });

  it("quien no tiene perfil recibe la porción estándar, no una inventada", () => {
    const h = hogar({ portionBasis: "necesidades", nutritionProfiles: [ana("bajar_peso")] });
    const s = portionSizing(h);
    expect(s.eaters).toBeCloseTo(personEnergyNeeds(ana("bajar_peso")).targetKcal / 2000 + 1, 2);
    expect(s.warnings.join(" ")).toContain("porción estándar");
  });

  it("bajar de peso AHORRA: el planificador no reinvierte lo que se deja de comer", () => {
    const estandar = plan(hogar({ budgetCop: 1_200_000 }));
    const bajando = plan(
      hogar({
        budgetCop: 1_200_000, portionBasis: "necesidades",
        nutritionProfiles: [ana("bajar_peso"), beto("bajar_peso")],
      }),
    );
    // Con un presupuesto holgado, sin la escala de gasto el planificador
    // gastaría lo que sobra en platos más caros y el ahorro desaparecería.
    const ahorro = 1 - bajando.projectedSpendCop / estandar.projectedSpendCop;
    const menosComida = 1 - bajando.diagnostics.portionEquivalents / estandar.diagnostics.portionEquivalents;
    expect(ahorro).toBeGreaterThan(menosComida * 0.6);
  });

  it("el plan dice de dónde salieron sus porciones", () => {
    const p = plan(hogar({ portionBasis: "necesidades", nutritionProfiles: [ana("bajar_peso"), beto()] }));
    expect(p.diagnostics.portionBasis).toBe("necesidades");
    expect(p.diagnostics.standardPortionEquivalents).toBe(2);
    expect(p.diagnostics.portionEquivalents).toBeLessThan(2);
  });

  it("con porciones reducidas, ninguna comida queda bajo el piso", () => {
    const h = hogar({ portionBasis: "necesidades", nutritionProfiles: [ana("bajar_peso"), beto("bajar_peso")] });
    const p = plan(h);
    const needs = householdNeeds(h);
    const cortas = p.meals.filter((m) => {
      const piso = mealFloor(needs, m.slot);
      return m.nutrition.kcal < piso.kcal || m.nutrition.proteinG < piso.proteinG;
    });
    expect(cortas).toEqual([]);
    expect(p.diagnostics.mealsBelowNutritionFloor).toBe(0);
  });

  it("el aviso de presupuesto excedido nunca propone bajar de peso", () => {
    // Bajar de peso es una decisión de salud de cada persona, no una palanca
    // para cuadrar las cuentas. La app no la sugiere por su cuenta.
    const p = plan(hogar({ budgetCop: 300_000 }));
    expect(p.diagnostics.withinBudget).toBe(false);
    expect(p.diagnostics.warnings.join(" ").toLowerCase()).not.toContain("bajar de peso");
  });
});

describe("barandas: a quién Rinde NO le propone un déficit", () => {
  const casos: [string, PersonProfile][] = [
    ["un niño", { ...ana("bajar_peso"), kind: "nino", ageYears: 10, weightKg: 40, heightCm: 140 }],
    ["un menor de 18", ana("bajar_peso", { ageYears: 16 })],
    ["embarazo", ana("bajar_peso", { flags: ["embarazo"] })],
    ["lactancia", ana("bajar_peso", { flags: ["lactancia"] })],
    ["una condición médica", ana("bajar_peso", { flags: ["condicion_medica"] })],
    ["IMC por debajo de 18,5", ana("bajar_peso", { weightKg: 47 })],
  ];
  for (const [quien, perfil] of casos) {
    it(`no aplica déficit a ${quien}, y dice por qué`, () => {
      const n = personEnergyNeeds(perfil);
      expect(n.appliedGoal).toBe("mantener");
      expect(n.goalNotApplied).toBeTruthy();
      if (perfil.kind === "adulto") {
        const mantener = personEnergyNeeds({ ...perfil, goal: "mantener" });
        expect(n.targetKcal).toBe(mantener.targetKcal);
      }
    });
  }

  it("sin peso, estatura y edad no hay déficit posible: usa mantenimiento y lo dice", () => {
    const n = personEnergyNeeds({ id: "x", kind: "adulto", sex: "femenino", activity: "sedentario", goal: "bajar_peso" });
    expect(n.usedGenericReference).toBe(true);
    expect(n.appliedGoal).toBe("mantener");
    expect(n.goalNotApplied).toContain("peso, estatura y edad");
  });

  it("el déficit nunca pasa de 500 kcal, aunque el 15% dé más", () => {
    const grande = beto("bajar_peso", { weightKg: 110, heightCm: 190, activity: "muy_alto" });
    const n = personEnergyNeeds(grande);
    expect(n.tdeeKcal! - n.targetKcal).toBeLessThanOrEqual(MAX_DEFICIT_KCAL);
    expect(n.tdeeKcal! * 0.15).toBeGreaterThan(MAX_DEFICIT_KCAL);
  });

  it("nunca baja del piso calórico de su sexo", () => {
    const pequena = ana("bajar_peso", { weightKg: 52, heightCm: 150, ageYears: 60 });
    expect(personEnergyNeeds(pequena).targetKcal).toBeGreaterThanOrEqual(KCAL_FLOOR.femenino);
  });

  it("bajar de peso no reduce la meta de proteína: se come menos, no menos proteína", () => {
    expect(personEnergyNeeds(beto("bajar_peso")).proteinG).toEqual(personEnergyNeeds(beto()).proteinG);
  });

  it("a un niño con peso y estatura no se le aplica la ecuación de adultos", () => {
    const nino: PersonProfile = { id: "n", kind: "nino", sex: "masculino", ageYears: 9, weightKg: 30, heightCm: 132, activity: "moderado", goal: "mantener" };
    const n = personEnergyNeeds(nino);
    expect(n.bmrKcal).toBeNull();
    expect(n.usedGenericReference).toBe(true);
  });
});
