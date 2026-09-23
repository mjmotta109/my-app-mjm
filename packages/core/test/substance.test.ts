import { describe, expect, it } from "vitest";
import { DEMO_OBSERVED_ON, DEMO_PRICES, INGREDIENT_BY_ID, RECIPES, RECIPE_BY_ID } from "@rinde/data";
import { PriceIndex } from "../src/pricing.js";
import { generateMealPlan } from "../src/planner.js";
import { scaleRecipe } from "../src/scaling.js";
import { nutritionOfScaled } from "../src/nutrition.js";
import { householdNeeds, mealFloor, mealTarget, MEAL_MIN_SHARE } from "../src/nutrition-needs.js";
import type { Household, MealSlot } from "../src/types.js";

/**
 * "Si tener el control del dinero se traduce en comerme una arepa con
 * mantequilla todos los días, no tiene sentido el recetario."
 *
 * Estas pruebas son la respuesta a eso. El planificador optimiza presupuesto, y
 * la forma más barata de cumplir un presupuesto es dar de comer menos. Lo que
 * sigue verifica que eso no pueda pasar.
 */

const prices = new PriceIndex(DEMO_PRICES, INGREDIENT_BY_ID, DEMO_OBSERVED_ON);
const START = DEMO_OBSERVED_ON;
const PRINCIPALES: MealSlot[] = ["desayuno", "almuerzo", "cena"];

function household(overrides: Partial<Household> = {}): Household {
  return {
    id: "hogar_sustancia", adults: 2, children: 0, budgetCop: 800_000, city: "Bogotá",
    slots: PRINCIPALES, days: 30, preferences: [], tier: "free", createdOn: START,
    ...overrides,
  };
}

function plan(h: Household = household()) {
  return generateMealPlan({
    household: h, startDate: START, inventory: [], recipes: RECIPES,
    catalog: INGREDIENT_BY_ID, prices,
  });
}

/** Energía de una comida del plan, para el hogar completo. */
function kcalDe(recipeId: string, servings: number): number {
  const recipe = RECIPE_BY_ID.get(recipeId)!;
  return nutritionOfScaled(scaleRecipe(recipe, servings, INGREDIENT_BY_ID), INGREDIENT_BY_ID).kcal;
}

describe("el catálogo distingue un plato de un ensamblaje", () => {
  it("clasifica cada receta", () => {
    for (const recipe of RECIPES) {
      expect(["plato", "acompanamiento", "bebida", "snack"], recipe.id).toContain(recipe.kind);
    }
  });

  it("lo que no se sostiene solo NO es un plato", () => {
    // Una arepa con mantequilla, un jugo o un queso con bocadillo no son comida.
    for (const id of ["arepa_sola", "jugo_maracuya", "avena_agua", "queso_guayaba",
                      "banano_avena", "fruta_picada", "tostadas_bocadillo"]) {
      expect(RECIPE_BY_ID.get(id)!.kind, id).not.toBe("plato");
    }
  });

  it("hay suficientes platos de verdad en cada horario principal", () => {
    for (const slot of PRINCIPALES) {
      const platos = RECIPES.filter((r) => r.slots.includes(slot) && r.kind === "plato");
      expect(platos.length, slot).toBeGreaterThanOrEqual(25);
    }
  });

  it("los platos principales son comidas completas, no dos ingredientes", () => {
    const flacos = RECIPES.filter(
      (r) =>
        r.kind === "plato" &&
        r.slots.some((s) => s !== "snack") &&
        (r.ingredients.filter((i) => !i.optional).length < 4 || r.steps.length < 3),
    );
    expect(flacos.map((r) => r.id)).toEqual([]);
  });
});

describe("el planificador no puede servir un ensamblaje como comida", () => {
  const resultado = plan();

  it("NINGUNA comida principal se resuelve con algo que no sea un plato", () => {
    for (const meal of resultado.meals) {
      if (meal.slot === "snack") continue;
      const recipe = RECIPE_BY_ID.get(meal.recipeId)!;
      expect(recipe.kind, `${meal.date} ${meal.slot}: ${recipe.name}`).toBe("plato");
    }
  });

  it("toda comida principal alcanza el piso nutricional de su horario", () => {
    const needs = householdNeeds(household());
    const cortas = resultado.meals.filter((meal) => {
      if (meal.slot === "snack") return false;
      return kcalDe(meal.recipeId, meal.servings) < mealFloor(needs, meal.slot).kcal;
    });
    expect(cortas.map((m) => `${m.date} ${m.slot}`)).toEqual([]);
    expect(resultado.diagnostics.mealsBelowNutritionFloor).toBe(0);
  });
});

describe("el plan alimenta de verdad", () => {
  const resultado = plan();
  const needs = householdNeeds(household());

  function kcalPorDia(p: ReturnType<typeof plan>): number[] {
    const porDia = new Map<string, number>();
    for (const meal of p.meals) {
      porDia.set(meal.date, (porDia.get(meal.date) ?? 0) + kcalDe(meal.recipeId, meal.servings));
    }
    return [...porDia.values()].map((v) => v / 2).sort((a, b) => a - b);
  }

  it("ningún día se queda por debajo del 75% de la meta", () => {
    const dias = kcalPorDia(resultado);
    const minimo = needs.kcal / 2 * 0.75;
    expect(dias[0], `peor día: ${Math.round(dias[0]!)} kcal`).toBeGreaterThanOrEqual(minimo);
  });

  it("la mediana del mes queda cerca de la meta diaria, no un 15% por debajo", () => {
    const dias = kcalPorDia(resultado);
    const mediana = dias[Math.floor(dias.length / 2)]!;
    expect(mediana).toBeGreaterThanOrEqual(needs.kcal / 2 * 0.9);
  });

  it("el plan reporta la energía media por persona y día", () => {
    expect(resultado.diagnostics.averageKcalPerPersonPerDay).not.toBeNull();
    expect(resultado.diagnostics.averageKcalPerPersonPerDay!).toBeGreaterThan(1700);
  });

  it("un presupuesto muy bajo NO se resuelve pasando hambre en silencio", () => {
    // Con muy poca plata el plan no va a cuadrar, pero tiene que DECIRLO en vez
    // de servir comidas mínimas y reportar que todo va bien.
    const apretado = plan(household({ budgetCop: 40_000 }));
    const avisos = apretado.diagnostics.warnings.join(" ");
    expect(apretado.diagnostics.withinBudget).toBe(false);
    expect(avisos).toMatch(/no se encontró un plan/i);
  });
});

describe("el reparto del día no es en tercios iguales", () => {
  it("el almuerzo pesa más que el desayuno", () => {
    const needs = householdNeeds(household());
    const desayuno = mealTarget(needs, "desayuno", PRINCIPALES);
    const almuerzo = mealTarget(needs, "almuerzo", PRINCIPALES);
    expect(almuerzo.kcal).toBeGreaterThan(desayuno.kcal);
  });

  it("con un solo horario activo, ese horario recibe el día completo", () => {
    const needs = householdNeeds(household({ slots: ["almuerzo"] }));
    expect(mealTarget(needs, "almuerzo", ["almuerzo"]).kcal).toBe(needs.kcal);
  });

  it("un snack no tiene piso: no tiene que sostener nada", () => {
    expect(MEAL_MIN_SHARE.snack.kcal).toBe(0);
    const needs = householdNeeds(household());
    expect(mealFloor(needs, "snack").kcal).toBe(0);
  });

  it("los pisos son alcanzables: un piso que nadie cumple no protege a nadie", () => {
    const needs = householdNeeds(household());
    for (const slot of PRINCIPALES) {
      const piso = mealFloor(needs, slot);
      const alcanzan = RECIPES.filter((r) => {
        if (!r.slots.includes(slot) || r.kind !== "plato") return false;
        const n = nutritionOfScaled(scaleRecipe(r, 2, INGREDIENT_BY_ID), INGREDIENT_BY_ID);
        return n.kcal >= piso.kcal && n.proteinG >= piso.proteinG;
      });
      expect(alcanzan.length, `${slot}: solo ${alcanzan.length} recetas alcanzan el piso`)
        .toBeGreaterThanOrEqual(15);
    }
  });
});

/**
 * "Si tener el control del dinero se traduce en comerme lo mismo todos los
 * días, no tiene sentido agregar un recetario."
 *
 * El recetario necesita el mismo tipo de piso que la nutrición: sin él, la
 * forma más barata de cuadrar el presupuesto es comprar pocos ingredientes en
 * paquetes grandes y repetir once platos noventa veces.
 */
describe("el recetario no puede degenerar para cuadrar el presupuesto", () => {
  it("no sirve el mismo plato dos veces el mismo día", () => {
    const resultado = plan();
    const porDia = new Map<string, string[]>();
    for (const meal of resultado.meals) {
      const lista = porDia.get(meal.date) ?? [];
      lista.push(meal.recipeId);
      porDia.set(meal.date, lista);
    }
    for (const [date, recetas] of porDia) {
      expect(new Set(recetas).size, `${date}: ${recetas.join(", ")}`).toBe(recetas.length);
    }
  });

  it("ninguna receta se repite más de una vez por semana en un mes", () => {
    const resultado = plan();
    const usos = new Map<string, number>();
    for (const meal of resultado.meals) usos.set(meal.recipeId, (usos.get(meal.recipeId) ?? 0) + 1);
    const abusadas = [...usos.entries()].filter(([, n]) => n > 4);
    expect(abusadas.map(([id, n]) => `${id}×${n}`)).toEqual([]);
  });

  it("no sirve el mismo plato dos días seguidos", () => {
    // Lo mismo lunes y martes se lee como "otra vez lo mismo", aunque el tope
    // del mes esté lejos de agotarse.
    const resultado = plan();
    const fechas = [...new Set(resultado.meals.map((m) => m.date))].sort();
    const seguidas: string[] = [];
    for (let i = 1; i < fechas.length; i++) {
      const ayer = new Set(
        resultado.meals.filter((m) => m.date === fechas[i - 1]).map((m) => m.recipeId),
      );
      for (const meal of resultado.meals.filter((m) => m.date === fechas[i])) {
        if (ayer.has(meal.recipeId)) seguidas.push(`${meal.date} ${meal.slot} ${meal.recipeId}`);
      }
    }
    expect(seguidas).toEqual([]);
  });

  it("antes de servir una comida corta, repite: comer de menos es peor", () => {
    // Un hogar con 10 minutos entre semana tiene pocas opciones por horario.
    // La variedad cede ahí, el piso nutricional no.
    const apurado = plan(
      household({
        cookingTime: {
          weekday: { desayuno: 10, almuerzo: 25, cena: 20, snack: 10 },
          weekend: { desayuno: 25, almuerzo: 45, cena: 30, snack: 15 },
          maxWeekdayDifficulty: "facil",
        },
      }),
    );
    expect(apurado.diagnostics.mealsBelowNutritionFloor).toBe(0);
    expect(apurado.diagnostics.mealsOverTimeBudget).toBe(0);
    expect(apurado.diagnostics.distinctRecipes).toBeGreaterThanOrEqual(20);
  });

  it("un mes trae al menos 24 platos distintos, no once", () => {
    expect(plan().diagnostics.distinctRecipes).toBeGreaterThanOrEqual(24);
  });

  it("aprieta el presupuesto sin romper ninguno de los dos pisos", () => {
    // Presupuesto imposible a propósito: lo que importa no es que quepa, sino
    // que al no caber no se resuelva ni sirviendo de menos ni repitiendo.
    const apretado = plan(household({ budgetCop: 300_000 }));
    expect(apretado.diagnostics.withinBudget).toBe(false);
    expect(apretado.diagnostics.warnings.join(" ")).toContain("presupuesto");
    expect(apretado.diagnostics.distinctRecipes).toBeGreaterThanOrEqual(20);
    const usos = new Map<string, number>();
    for (const meal of apretado.meals) usos.set(meal.recipeId, (usos.get(meal.recipeId) ?? 0) + 1);
    expect(Math.max(...usos.values())).toBeLessThanOrEqual(4);
  });

  it("cada comida lleva lo que de verdad contiene, no lo que decía la receta", () => {
    const apretado = plan(household({ budgetCop: 300_000 }));
    for (const meal of apretado.meals) {
      // La nutrición reportada es la del plato tal como quedó.
      expect(meal.nutrition.kcal).toBeGreaterThan(0);
      expect(meal.nutrition.isEstimated).toBe(true);
      // Y los cambios de ingrediente viajan con la comida, no en silencio.
      for (const cambio of meal.substitutions) {
        expect(meal.lines.some((l) => l.ingredientId === cambio.toIngredientId)).toBe(true);
      }
    }
  });
});

/** "Necesito recetas más complejas." */
describe("el recetario se puede cocinar, no solo leer", () => {
  /**
   * Pasos que dicen CUÁNTO o CUÁNDO.
   *
   * La primera versión de esta prueba medía caracteres por paso, y eso premia
   * escribir largo, no explicar. Un paso concreto casi siempre lleva un número
   * —"9 minutos", "a 200 °C", "2 cm"—; "cocina hasta que ablande" no lleva
   * ninguno y es justo lo que deja tirado a quien está aprendiendo.
   */
  function pasosConcretos(recipeId: string): number {
    return RECIPE_BY_ID.get(recipeId)!.steps.filter((paso) => /\d/.test(paso)).length;
  }

  it("ningún plato del mes se despacha en menos de cuatro pasos", () => {
    const servidas = new Set(plan().meals.map((m) => m.recipeId));
    const cortas = [...servidas].filter((id) => RECIPE_BY_ID.get(id)!.steps.length < 4);
    expect(cortas).toEqual([]);
  });

  it("todo plato del mes dice al menos dos veces cuánto o cuándo", () => {
    const servidas = new Set(plan().meals.map((m) => m.recipeId));
    const vagas = [...servidas].filter((id) => pasosConcretos(id) < 2);
    expect(vagas).toEqual([]);
  });

  it("la mitad del mes se explica paso a paso, no en cuatro frases", () => {
    const servidas = new Set(plan().meals.map((m) => m.recipeId));
    const detalladas = [...servidas].filter(
      (id) => RECIPE_BY_ID.get(id)!.steps.length >= 6 && pasosConcretos(id) >= 3,
    );
    expect(detalladas.length).toBeGreaterThanOrEqual(Math.floor(servidas.size / 2));
  });

  it("los platos largos son los que explican más", () => {
    // Un sancocho de 90 minutos resuelto en cuatro frases no es una receta.
    const largos = RECIPES.filter((r) => r.kind === "plato" && r.minutes >= 60);
    const flojos = largos.filter((r) => r.steps.length < 5).map((r) => r.name);
    expect(flojos).toEqual([]);
  });
});
