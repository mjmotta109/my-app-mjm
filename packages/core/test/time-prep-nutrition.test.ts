import { describe, expect, it } from "vitest";
import { DEMO_OBSERVED_ON, DEMO_PRICES, INGREDIENT_BY_ID, RECIPES, RECIPE_BY_ID } from "@rinde/data";
import { PriceIndex } from "../src/pricing.js";
import { generateMealPlan, maxDifficultyFor, minutesAvailable } from "../src/planner.js";
import { cookBatch, planMealPrep, sessionIngredients, FREEZER_DAYS } from "../src/meal-prep.js";
import {
  householdNeeds, personEnergyNeeds, restingEnergy, perMealTargets,
  ACTIVITY_FACTORS, GENERIC_ADULT, KCAL_FLOOR, MIFFLIN_ST_JEOR,
} from "../src/nutrition-needs.js";
import { daysBetween } from "../src/dates.js";
import type { CookingTimeBudget, Household, InventoryItem, PersonProfile } from "../src/types.js";

const prices = new PriceIndex(DEMO_PRICES, INGREDIENT_BY_ID, DEMO_OBSERVED_ON);
const START = DEMO_OBSERVED_ON; // lunes 7 de septiembre de 2026

const TIEMPO: CookingTimeBudget = {
  weekday: { desayuno: 15, almuerzo: 35, cena: 25 },
  weekend: { desayuno: 40, almuerzo: 90, cena: 45 },
  maxWeekdayDifficulty: "facil",
};

function household(overrides: Partial<Household> = {}): Household {
  return {
    id: "hogar_tiempo", adults: 2, children: 0, budgetCop: 800_000, city: "Bogotá",
    slots: ["desayuno", "almuerzo", "cena"], days: 30, preferences: [],
    tier: "free", createdOn: START, ...overrides,
  };
}

function plan(h: Household, inventory: InventoryItem[] = []) {
  return generateMealPlan({
    household: h, startDate: START, inventory, recipes: RECIPES,
    catalog: INGREDIENT_BY_ID, prices,
  });
}

// ---------------------------------------------------------------------------

describe("catálogo ampliado", () => {
  it("tiene bastante más de 50 recetas y cubre todos los horarios", () => {
    expect(RECIPES.length).toBeGreaterThanOrEqual(110);
    for (const slot of ["desayuno", "almuerzo", "cena", "snack"] as const) {
      expect(RECIPES.filter((r) => r.slots.includes(slot)).length, slot).toBeGreaterThanOrEqual(20);
    }
  });

  it("toda receta declara tiempo, dificultad y comportamiento de meal prep", () => {
    for (const recipe of RECIPES) {
      expect(recipe.minutes, recipe.id).toBeGreaterThan(0);
      expect(["facil", "media", "dificil"]).toContain(recipe.difficulty);
      expect(recipe.prep.keepsDays, recipe.id).toBeGreaterThanOrEqual(1);
      expect(typeof recipe.prep.batchFriendly).toBe("boolean");
    }
  });

  it("hay recetas rápidas de verdad para los días de afán", () => {
    for (const slot of ["desayuno", "almuerzo", "cena"] as const) {
      const rapidas = RECIPES.filter((r) => r.slots.includes(slot) && r.minutes <= 20);
      expect(rapidas.length, slot).toBeGreaterThanOrEqual(5);
    }
  });

  it("lo que no aguanta guardado está marcado como tal", () => {
    // Las frituras y los huevos al momento no se cocinan el domingo para el jueves.
    for (const id of ["tilapia_patacon", "patacon_queso", "huevos_pericos", "ensalada_atun"]) {
      expect(RECIPE_BY_ID.get(id)!.prep.batchFriendly, id).toBe(false);
    }
    // Los granos son lo que mejor aguanta.
    expect(RECIPE_BY_ID.get("frijoles_arroz")!.prep.keepsDays).toBeGreaterThanOrEqual(4);
  });
});

describe("tiempo disponible para cocinar", () => {
  it("distingue entre semana y fin de semana", () => {
    // 2026-09-07 es lunes; 2026-09-12 es sábado.
    expect(minutesAvailable(TIEMPO, "2026-09-07", "cena")).toBe(25);
    expect(minutesAvailable(TIEMPO, "2026-09-12", "cena")).toBe(45);
    expect(maxDifficultyFor(TIEMPO, "2026-09-07")).toBe("facil");
    expect(maxDifficultyFor(TIEMPO, "2026-09-12")).toBeNull();
  });

  it("sin presupuesto de tiempo declarado no hay límite", () => {
    expect(minutesAvailable(undefined, "2026-09-07", "cena")).toBeNull();
    expect(maxDifficultyFor(undefined, "2026-09-07")).toBeNull();
  });

  it("el plan RESPETA el tiempo disponible en cada comida", () => {
    const conTiempo = plan(household({ cookingTime: TIEMPO }));
    const excedidas = conTiempo.meals.filter((meal) => {
      const limite = minutesAvailable(TIEMPO, meal.date, meal.slot);
      return limite !== null && RECIPE_BY_ID.get(meal.recipeId)!.minutes > limite;
    });
    expect(excedidas).toEqual([]);
    expect(conTiempo.diagnostics.mealsOverTimeBudget).toBe(0);
  });

  it("declarar poco tiempo reduce de verdad los minutos de cocina del mes", () => {
    const minutos = (p: ReturnType<typeof plan>) =>
      p.meals.reduce((total, meal) => total + RECIPE_BY_ID.get(meal.recipeId)!.minutes, 0);
    expect(minutos(plan(household({ cookingTime: TIEMPO })))).toBeLessThan(
      minutos(plan(household())),
    );
  });

  it("entre semana respeta el tope de dificultad", () => {
    const conTiempo = plan(household({ cookingTime: TIEMPO, days: 14 }));
    const dificilesEntreSemana = conTiempo.meals.filter((meal) => {
      if (maxDifficultyFor(TIEMPO, meal.date) === null) return false;
      return RECIPE_BY_ID.get(meal.recipeId)!.difficulty === "dificil";
    });
    expect(dificilesEntreSemana).toEqual([]);
  });

  it("si NINGUNA receta cabe, planifica la más rápida y lo REPORTA", () => {
    const imposible: CookingTimeBudget = {
      weekday: { almuerzo: 5 }, weekend: { almuerzo: 5 }, maxWeekdayDifficulty: "facil",
    };
    const resultado = plan(household({ slots: ["almuerzo"], days: 5, cookingTime: imposible }));
    expect(resultado.meals).toHaveLength(5);
    expect(resultado.diagnostics.mealsOverTimeBudget).toBe(5);
    expect(resultado.diagnostics.warnings.join(" ")).toMatch(/no caben en el tiempo/i);
  });
});

describe("cocinar por adelantado", () => {
  const conPrep = household({
    cookingTime: TIEMPO,
    mealPrep: { enabled: true, batchSize: 3, windowDays: 7 },
  });

  it("el modo tandas hace que las recetas se repitan DENTRO de la semana", () => {
    const normal = plan(household({ days: 7 }));
    const tandas = plan({ ...conPrep, days: 7 });
    expect(tandas.diagnostics.distinctRecipes).toBeLessThan(normal.diagnostics.distinctRecipes);
  });

  it("pero conserva variedad ENTRE semanas a lo largo del mes", () => {
    // Sin esto, el mes entero se resolvería con cuatro recetas repetidas.
    expect(plan(conPrep).diagnostics.distinctRecipes).toBeGreaterThanOrEqual(15);
  });

  it("reparte la tanda entre días: nunca el mismo plato dos veces el mismo día", () => {
    const p = plan(conPrep);
    const porDia = new Map<string, string[]>();
    for (const meal of p.meals) {
      const lista = porDia.get(meal.date) ?? [];
      lista.push(meal.recipeId);
      porDia.set(meal.date, lista);
    }
    for (const [date, recetas] of porDia) {
      expect(new Set(recetas).size, `${date}: ${recetas.join(", ")}`).toBe(recetas.length);
    }
  });

  it("agrupa comidas en tandas y ahorra tiempo de verdad", () => {
    const prep = planMealPrep(plan(conPrep), RECIPE_BY_ID, { from: START, days: 7 });
    expect(prep.batchedMealCount).toBeGreaterThan(0);
    expect(prep.minutesWithPrep).toBeLessThan(prep.minutesIfCookedDaily);
    expect(prep.minutesSaved).toBe(prep.minutesIfCookedDaily - prep.minutesWithPrep);
    expect(prep.sessions.some((session) => session.batches.some((b) => b.mealIds.length > 1))).toBe(true);
  });

  it("cada comida aparece en UNA sola tanda o en la lista de al momento", () => {
    const prep = planMealPrep(plan(conPrep), RECIPE_BY_ID, { from: START, days: 7 });
    const enTandas = prep.sessions.flatMap((s) => s.batches.flatMap((b) => b.mealIds));
    const frescas = prep.cookFresh.map((m) => m.mealId);
    const todas = [...enTandas, ...frescas];
    expect(new Set(todas).size).toBe(todas.length);
    expect(todas).toHaveLength(prep.totalMealCount);
  });

  it("NUNCA adelanta una receta que solo sirve recién hecha", () => {
    const prep = planMealPrep(plan(household({ days: 7 })), RECIPE_BY_ID, { from: START, days: 7 });
    for (const session of prep.sessions) {
      for (const batch of session.batches) {
        expect(RECIPE_BY_ID.get(batch.recipeId)!.prep.batchFriendly, batch.recipeId).toBe(true);
      }
    }
    for (const fresca of prep.cookFresh) expect(fresca.reason).toBeTruthy();
  });

  it("NUNCA estira la conservación: lo que no aguanta en nevera va al congelador", () => {
    const prep = planMealPrep(plan(conPrep), RECIPE_BY_ID, { from: START, days: 7 });
    for (const session of prep.sessions) {
      for (const batch of session.batches) {
        const receta = RECIPE_BY_ID.get(batch.recipeId)!;
        const ultima = batch.covers[batch.covers.length - 1]!.date;
        const dias = daysBetween(session.date, ultima);
        if (batch.storage === "nevera") {
          expect(dias, batch.recipeId).toBeLessThan(receta.prep.keepsDays);
        } else {
          expect(receta.prep.freezable, batch.recipeId).toBe(true);
          expect(dias).toBeLessThan(FREEZER_DAYS);
          expect(batch.freezeNote).toBeTruthy();
        }
      }
    }
  });

  it("no cocina el mismo plato dos veces en la misma jornada", () => {
    const prep = planMealPrep(plan(conPrep), RECIPE_BY_ID, { from: START, days: 7 });
    for (const session of prep.sessions) {
      const ids = session.batches.map((b) => b.recipeId);
      expect(new Set(ids).size, session.date).toBe(ids.length);
    }
  });

  it("nunca programa una tanda después de la comida que cubre", () => {
    const prep = planMealPrep(plan(conPrep), RECIPE_BY_ID, { from: START, days: 7 });
    for (const session of prep.sessions) {
      for (const batch of session.batches) {
        for (const cover of batch.covers) expect(cover.date >= session.date).toBe(true);
      }
    }
  });

  it("el costo de la tanda es la suma de lo que el plan ya presupuestó", () => {
    const p = plan(conPrep);
    const prep = planMealPrep(p, RECIPE_BY_ID, { from: START, days: 7 });
    for (const session of prep.sessions) {
      for (const batch of session.batches) {
        const esperado = batch.mealIds
          .map((id) => p.meals.find((meal) => meal.id === id)!)
          .reduce((total, meal) => total + meal.costCop, 0);
        expect(batch.costCop, batch.recipeId).toBe(esperado);
      }
    }
  });

  it("cocinar una tanda descuenta el inventario UNA vez y resuelve todas sus comidas", () => {
    const p = plan(conPrep);
    const prep = planMealPrep(p, RECIPE_BY_ID, { from: START, days: 7 });
    const batch = prep.sessions
      .flatMap((s) => s.batches)
      .find((b) => b.mealIds.length > 1)!;

    const inventario: InventoryItem[] = batch.lines.map((line, index) => ({
      id: `inv_${index}`,
      ingredientId: line.ingredientId,
      qtyBase: line.qtyBase * 2,
      updatedOn: START,
    }));

    const resultado = cookBatch(batch, inventario, START);
    expect(resultado.cookedMealIds).toEqual(batch.mealIds);
    expect(resultado.shortages).toEqual([]);
    for (const linea of batch.lines) {
      const restante = resultado.inventory.find((item) => item.ingredientId === linea.ingredientId);
      expect(restante!.qtyBase, linea.ingredientId).toBeCloseTo(linea.qtyBase, 2);
    }
  });

  it("lista los ingredientes de toda la jornada para tenerlos a mano", () => {
    const prep = planMealPrep(plan(conPrep), RECIPE_BY_ID, { from: START, days: 7 });
    const ingredientes = sessionIngredients(prep.sessions[0]!, INGREDIENT_BY_ID);
    expect(ingredientes.length).toBeGreaterThan(0);
    expect(new Set(ingredientes.map((i) => i.ingredientId)).size).toBe(ingredientes.length);
    for (const item of ingredientes) expect(item.qtyBase).toBeGreaterThan(0);
  });

  it("avisa siempre de que los días de conservación son prudentes, no de laboratorio", () => {
    const prep = planMealPrep(plan(conPrep), RECIPE_BY_ID, { from: START, days: 7 });
    expect(prep.notes.join(" ")).toMatch(/no son un análisis de laboratorio/i);
  });
});

describe("necesidades nutricionales según estado físico", () => {
  const ana: PersonProfile = {
    id: "ana", name: "Ana", kind: "adulto", sex: "femenino",
    ageYears: 34, weightKg: 62, heightCm: 163, activity: "moderado", goal: "mantener",
  };

  it("aplica Mifflin-St Jeor con los coeficientes publicados", () => {
    // 10·62 + 6,25·163 − 5·34 − 161 = 620 + 1018,75 − 170 − 161 = 1307,75 → 1308
    expect(restingEnergy(ana)).toBe(1308);
    const hombre = { ...ana, sex: "masculino" as const };
    // La única diferencia entre sexos es la constante: −161 frente a +5.
    expect(restingEnergy(hombre)! - restingEnergy(ana)!).toBe(
      MIFFLIN_ST_JEOR.maleConstant - MIFFLIN_ST_JEOR.femaleConstant,
    );
  });

  it("multiplica por el factor de actividad", () => {
    const needs = personEnergyNeeds(ana);
    expect(needs.tdeeKcal).toBe(Math.round(1308 * ACTIVITY_FACTORS.moderado));
    expect(needs.targetKcal).toBe(needs.tdeeKcal);
    expect(needs.usedGenericReference).toBe(false);
  });

  it("bajar de peso resta y subir suma, sin exagerar", () => {
    const bajar = personEnergyNeeds({ ...ana, goal: "bajar_peso" });
    const subir = personEnergyNeeds({ ...ana, goal: "subir_peso" });
    const mantener = personEnergyNeeds(ana);
    expect(bajar.targetKcal).toBeLessThan(mantener.targetKcal);
    expect(subir.targetKcal).toBeGreaterThan(mantener.targetKcal);
    expect(bajar.targetKcal).toBeGreaterThan(mantener.targetKcal * 0.8);
  });

  it("NO baja del piso de seguridad, y lo dice", () => {
    const needs = personEnergyNeeds({
      ...ana, ageYears: 60, weightKg: 48, heightCm: 150,
      activity: "sedentario", goal: "bajar_peso",
    });
    expect(needs.targetKcal).toBe(KCAL_FLOOR.femenino);
    expect(needs.warnings.join(" ")).toMatch(/profesional de la salud/i);
  });

  it("más actividad pide más proteína; ganar músculo, todavía más", () => {
    const sedentaria = personEnergyNeeds({ ...ana, activity: "sedentario" });
    const activa = personEnergyNeeds({ ...ana, activity: "muy_alto" });
    const musculo = personEnergyNeeds({ ...ana, activity: "muy_alto", goal: "masa_muscular" });
    expect(activa.proteinG.targetG).toBeGreaterThan(sedentaria.proteinG.targetG);
    expect(musculo.proteinG.targetG).toBeGreaterThan(activa.proteinG.targetG);
    expect(sedentaria.proteinG.minG).toBe(Math.round(0.8 * 62)); // la RDA
  });

  it("sin peso, estatura o edad usa la referencia genérica Y lo declara", () => {
    const needs = personEnergyNeeds({
      id: "x", kind: "adulto", sex: "femenino", activity: "moderado", goal: "mantener",
    });
    expect(needs.bmrKcal).toBeNull();
    expect(needs.usedGenericReference).toBe(true);
    expect(needs.targetKcal).toBe(GENERIC_ADULT.kcal);
    expect(needs.missing).toEqual(["peso", "estatura", "edad"]);
    expect(needs.basis).toMatch(/gen[ée]rica/i);
  });

  it("embarazo y lactancia se derivan a un profesional, no se estiman", () => {
    const needs = personEnergyNeeds({ ...ana, flags: ["embarazo"] });
    expect(needs.warnings.join(" ")).toMatch(/consulta con un profesional/i);
  });

  it("sin sexo declarado avisa de que la estimación es más aproximada", () => {
    const needs = personEnergyNeeds({ ...ana, sex: "sin_especificar" });
    expect(needs.warnings.join(" ")).toMatch(/punto medio/i);
  });

  it("el hogar suma a sus miembros", () => {
    const luis: PersonProfile = {
      id: "luis", kind: "adulto", sex: "masculino", ageYears: 37,
      weightKg: 78, heightCm: 176, activity: "alto", goal: "masa_muscular",
    };
    const needs = householdNeeds(household({ nutritionProfiles: [ana, luis] }));
    expect(needs.kcal).toBe(
      personEnergyNeeds(ana).targetKcal + personEnergyNeeds(luis).targetKcal,
    );
    expect(needs.perPerson).toHaveLength(2);
    expect(needs.anyGeneric).toBe(false);
  });

  it("sin perfiles usa la referencia genérica por comensal y avisa", () => {
    const needs = householdNeeds(household({ adults: 2, children: 0 }));
    expect(needs.kcal).toBe(GENERIC_ADULT.kcal * 2);
    expect(needs.anyGeneric).toBe(true);
    expect(needs.warnings.join(" ")).toMatch(/referencia gen[ée]rica/i);
  });

  it("los niños cuentan menos que un adulto", () => {
    const conNinos = householdNeeds(household({ adults: 2, children: 2 }));
    const soloAdultos = householdNeeds(household({ adults: 4, children: 0 }));
    expect(conNinos.kcal).toBeLessThan(soloAdultos.kcal);
  });

  it("reparte la meta diaria entre las comidas del día", () => {
    const needs = householdNeeds(household({ nutritionProfiles: [ana] }));
    const porComida = perMealTargets(needs, 3);
    expect(porComida.kcal).toBe(Math.round(needs.kcal / 3));
  });

  it("dar el perfil físico NO cambia cuántas porciones se cocinan", () => {
    // Las porciones salen de adults/children; el perfil solo afina las metas.
    const sinPerfil = plan(household({ days: 3 }));
    const conPerfil = plan(household({ days: 3, nutritionProfiles: [ana] }));
    expect(conPerfil.meals[0]!.servings).toBe(sinPerfil.meals[0]!.servings);
  });
});
