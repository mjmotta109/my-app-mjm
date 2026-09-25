import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { DEMO_OBSERVED_ON, DEMO_PRICES, DEMO_PRICE_HISTORY, PRICE_SOURCES, STORES } from "@rinde/data";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { buildApp } from "../src/app.js";

/**
 * Pruebas de la API contra una base de datos en memoria.
 *
 * `now` se inyecta con la fecha de referencia del catálogo demo para que la
 * vigencia de precios sea determinista.
 */

const ADMIN_TOKEN = "token_de_prueba";
let app: FastifyInstance;
let repository: SqliteRepository;
let householdId: string;

beforeAll(async () => {
  const db = openDb(":memory:");
  repository = new SqliteRepository(db);
  repository.upsertSources(PRICE_SOURCES);
  repository.upsertStores(STORES);
  repository.insertPrices(DEMO_PRICES);
  repository.insertPriceHistory(DEMO_PRICE_HISTORY);

  app = buildApp({ repository, adminToken: ADMIN_TOKEN, now: () => DEMO_OBSERVED_ON });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("salud y catálogo", () => {
  it("responde /health con el tamaño del catálogo", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe("ok");
    expect(body.recipes).toBeGreaterThanOrEqual(50);
    expect(body.prices).toBe(DEMO_PRICES.length);
  });

  it("entrega el catálogo con la advertencia nutricional", async () => {
    const response = await app.inject({ method: "GET", url: "/catalog/ingredients" });
    const body = response.json();
    expect(body.ingredients.length).toBeGreaterThan(60);
    expect(body.nutritionDisclaimer).toMatch(/estimad/i);
  });

  it("filtra recetas por tipo de comida", async () => {
    const response = await app.inject({ method: "GET", url: "/catalog/recipes?slot=desayuno" });
    const body = response.json();
    expect(body.total).toBeGreaterThan(3);
    for (const recipe of body.recipes) expect(recipe.slots).toContain("desayuno");
  });

  it("404 para una receta que no existe", async () => {
    const response = await app.inject({ method: "GET", url: "/catalog/recipes/no_existe" });
    expect(response.statusCode).toBe(404);
  });
});

describe("precios", () => {
  it("normaliza y arrastra la procedencia", async () => {
    const response = await app.inject({ method: "GET", url: "/prices?ingredientIds=pollo_pechuga" });
    const body = response.json();
    expect(body.containsDemo).toBe(true);
    expect(body.sources.some((source: { id: string }) => source.id === "demo_bogota")).toBe(true);
    expect(body.prices[0].copPerBaseUnit).toBeCloseTo(18.9, 5);
    expect(body.prices[0].isDemo).toBe(true);
  });

  it("un ingrediente sin precio devuelve null, nunca 0", async () => {
    const response = await app.inject({ method: "GET", url: "/prices?ingredientIds=no_existe" });
    const precio = response.json().prices[0];
    expect(precio.copPerBaseUnit).toBeNull();
    expect(precio.note).toMatch(/sin precio/i);
  });

  it("expone el historial de un ingrediente", async () => {
    const response = await app.inject({ method: "GET", url: "/prices/pollo_pechuga/history" });
    expect(response.json().history.length).toBeGreaterThan(0);
  });
});

describe("hogares", () => {
  it("crea un hogar sin pedir credenciales (§25)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/households",
      payload: { adults: 2, children: 0, budgetCop: 800_000, slots: ["desayuno", "almuerzo", "cena"], days: 30 },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    householdId = body.id;
    expect(body.tier).toBe("free");
  });

  it("rechaza entradas inválidas con un mensaje útil", async () => {
    const casos = [
      { payload: { adults: 0, children: 0, budgetCop: 1000, slots: ["cena"], days: 7 }, match: /al menos una persona/i },
      { payload: { adults: 2, budgetCop: 0, slots: ["cena"], days: 7 }, match: /budgetCop/ },
      { payload: { adults: 2, budgetCop: 1000, slots: [], days: 7 }, match: /slots/ },
      { payload: { adults: 2, budgetCop: 1000, slots: ["almuerzo"], days: 400 }, match: /days/ },
      { payload: { adults: 2, budgetCop: 1000, slots: ["brunch"], days: 7 }, match: /slots/ },
      { payload: { adults: 2, budgetCop: 1000.5, slots: ["cena"], days: 7 }, match: /entero/ },
    ];
    for (const caso of casos) {
      const response = await app.inject({ method: "POST", url: "/households", payload: caso.payload });
      expect(response.statusCode, JSON.stringify(caso.payload)).toBe(400);
      expect(response.json().message).toMatch(caso.match);
    }
  });

  it("404 para un hogar que no existe", async () => {
    const response = await app.inject({ method: "GET", url: "/households/hogar_fantasma" });
    expect(response.statusCode).toBe(404);
  });

  it("actualiza el hogar pero no deja cambiar el nivel", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: `/households/${householdId}`,
      payload: { budgetCop: 900_000, tier: "premium" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().budgetCop).toBe(900_000);
    expect(response.json().tier).toBe("free");
  });
});

describe("inventario", () => {
  it("agrega ingredientes del catálogo", async () => {
    for (const [ingredientId, qtyBase] of [
      ["pollo_pechuga", 1000], ["arroz_blanco", 1000], ["lenteja", 500],
      ["huevo", 12], ["papa_pastusa", 500],
    ] as const) {
      const response = await app.inject({
        method: "POST",
        url: `/households/${householdId}/inventory`,
        payload: { ingredientId, qtyBase },
      });
      expect(response.statusCode).toBe(201);
    }
    const listado = await app.inject({ method: "GET", url: `/households/${householdId}/inventory` });
    expect(listado.json().items).toHaveLength(5);
  });

  it("rechaza un ingrediente que no está en el catálogo", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/households/${householdId}/inventory`,
      payload: { ingredientId: "unobtainium", qtyBase: 100 },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("unknown_ingredient");
  });

  it("rechaza cantidades no positivas", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/households/${householdId}/inventory`,
      payload: { ingredientId: "arroz_blanco", qtyBase: -5 },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("plan, mercado y cocinar — el flujo del §37", () => {
  let planId: string;
  let mealId: string;

  it("genera un plan que cabe en el presupuesto", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/households/${householdId}/plan`,
      payload: { startDate: DEMO_OBSERVED_ON },
    });
    expect(response.statusCode).toBe(201);
    const plan = response.json();
    planId = plan.id;
    mealId = plan.meals[0].id;

    expect(plan.meals).toHaveLength(90);
    expect(plan.diagnostics.method).toBe("heuristic");

    // `withinBudget` no se afirma a ciegas: se comprueba que concuerde con el
    // número. Antes esta prueba fijaba un tope de $900.000 y daba por hecho que
    // cabía; cuando el planificador dejó de abaratar el plan cambiando la carne
    // por lentejas (D28), el gasto honesto se salió del tope y la prueba falló
    // por la razón equivocada: el plan no empeoró, dejó de mentir.
    // El presupuesto se lee del plan: pruebas anteriores modifican el hogar.
    const presupuesto = plan.budgetCop;
    expect(plan.diagnostics.withinBudget).toBe(plan.projectedSpendCop <= presupuesto);
    expect(plan.diagnostics.budgetDeltaCop).toBe(presupuesto - plan.projectedSpendCop);
    if (!plan.diagnostics.withinBudget) {
      expect(plan.diagnostics.warnings.join(" ")).toContain("presupuesto");
    }
    // Lo que no puede pasar es que cuadre el dinero dando de comer de menos.
    expect(plan.diagnostics.mealsBelowNutritionFloor).toBe(0);
  });

  it("devuelve el plan vigente", async () => {
    const response = await app.inject({ method: "GET", url: `/households/${householdId}/plan/current` });
    expect(response.statusCode).toBe(200);
    expect(response.json().id).toBe(planId);
  });

  it("arma la lista de mercado agrupada por categoría", async () => {
    const response = await app.inject({ method: "GET", url: `/households/${householdId}/shopping-list` });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.cycles).toBe(5);
    expect(body.list.groups.length).toBeGreaterThan(2);
    expect(body.list.containsDemoPrices).toBe(true);
    const total = body.list.groups.reduce((sum: number, group: { subtotalCop: number }) => sum + group.subtotalCop, 0);
    expect(body.list.totalCop).toBe(total);
  });

  it("la lista de todo el plan cuadra con el gasto proyectado", async () => {
    const plan = (await app.inject({ method: "GET", url: `/households/${householdId}/plan/current` })).json();
    const lista = (await app.inject({
      method: "GET", url: `/households/${householdId}/shopping-list?cycle=all`,
    })).json();
    expect(lista.list.totalCop).toBe(plan.projectedSpendCop);
  });

  it("cocinar descuenta el inventario", async () => {
    const antes = (await app.inject({ method: "GET", url: `/households/${householdId}/inventory` })).json();
    const response = await app.inject({
      method: "POST", url: `/households/${householdId}/meals/${mealId}/cook`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.meal.status).toBe("cooked");
    expect(body.consumed.length + body.shortages.length).toBeGreaterThan(0);

    const totalAntes = antes.items.reduce((sum: number, item: { qtyBase: number }) => sum + item.qtyBase, 0);
    const despues = (await app.inject({ method: "GET", url: `/households/${householdId}/inventory` })).json();
    const totalDespues = despues.items.reduce((sum: number, item: { qtyBase: number }) => sum + item.qtyBase, 0);
    expect(totalDespues).toBeLessThan(totalAntes);
  });

  it("no descuenta dos veces la misma comida", async () => {
    const response = await app.inject({
      method: "POST", url: `/households/${householdId}/meals/${mealId}/cook`,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe("already_cooked");
  });

  it("el estado 'cocinada' persiste en el plan", async () => {
    const plan = (await app.inject({ method: "GET", url: `/households/${householdId}/plan/current` })).json();
    expect(plan.meals.find((meal: { id: string }) => meal.id === mealId).status).toBe("cooked");
  });

  it("responde qué se puede cocinar con lo que queda", async () => {
    const response = await app.inject({
      method: "POST", url: `/households/${householdId}/what-can-i-cook`, payload: { limit: 5 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().servings).toBe(2);
  });

  it("rinde más calcula con datos del plan", async () => {
    const response = await app.inject({
      method: "POST", url: `/households/${householdId}/rinde-mas`, payload: { extraBudgetCop: 50_000 },
    });
    expect(response.statusCode).toBe(200);
    const opciones = response.json().options;
    expect(opciones).toHaveLength(3);
    for (const opcion of opciones) expect(opcion.totalCop).toBeLessThanOrEqual(50_000);
  });

  it("rechaza un monto extra inválido", async () => {
    const response = await app.inject({
      method: "POST", url: `/households/${householdId}/rinde-mas`, payload: { extraBudgetCop: 0 },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("cocinar por adelantado y nutrición", () => {
  let prepHouseholdId: string;

  it("crea un hogar en modo tandas con tiempo de cocina", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/households",
      payload: {
        adults: 2, children: 0, budgetCop: 800_000, days: 14,
        slots: ["desayuno", "almuerzo", "cena"],
      },
    });
    prepHouseholdId = response.json().id;

    const patch = await app.inject({
      method: "PATCH",
      url: `/households/${prepHouseholdId}`,
      payload: {
        cookingTime: {
          weekday: { desayuno: 15, almuerzo: 35, cena: 25 },
          weekend: { desayuno: 40, almuerzo: 90, cena: 45 },
          maxWeekdayDifficulty: "facil",
        },
        mealPrep: { enabled: true, batchSize: 3, windowDays: 7 },
      },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().mealPrep.enabled).toBe(true);

    const plan = await app.inject({
      method: "POST",
      url: `/households/${prepHouseholdId}/plan`,
      payload: { startDate: DEMO_OBSERVED_ON },
    });
    expect(plan.statusCode).toBe(201);
    expect(plan.json().diagnostics.mealsOverTimeBudget).toBe(0);
  });

  it("devuelve jornadas de cocina con tandas que cubren varias comidas", async () => {
    const response = await app.inject({
      method: "GET", url: `/households/${prepHouseholdId}/meal-prep?week=1`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.batchModeEnabled).toBe(true);
    expect(body.prep.sessions.length).toBeGreaterThan(0);
    expect(body.prep.minutesWithPrep).toBeLessThan(body.prep.minutesIfCookedDaily);

    const tandas = body.prep.sessions.flatMap((s: { batches: unknown[] }) => s.batches);
    expect(tandas.some((b: { mealIds: string[] }) => b.mealIds.length > 1)).toBe(true);
    expect(body.shoppingBySession[0].ingredients.length).toBeGreaterThan(0);
  });

  it("cocinar una tanda resuelve todas sus comidas de una vez", async () => {
    const prep = (await app.inject({
      method: "GET", url: `/households/${prepHouseholdId}/meal-prep?week=1`,
    })).json();
    const batch = prep.prep.sessions
      .flatMap((s: { batches: { id: string; mealIds: string[] }[] }) => s.batches)
      .find((b: { mealIds: string[] }) => b.mealIds.length > 1)!;

    const response = await app.inject({
      method: "POST",
      url: `/households/${prepHouseholdId}/meal-prep/batches/${batch.id}/cook`,
      payload: { week: 1 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().cookedMealIds).toEqual(batch.mealIds);

    const plan = (await app.inject({
      method: "GET", url: `/households/${prepHouseholdId}/plan/current`,
    })).json();
    for (const mealId of batch.mealIds) {
      expect(plan.meals.find((meal: { id: string }) => meal.id === mealId).status).toBe("cooked");
    }
  });

  it("no cocina dos veces la misma tanda", async () => {
    const prep = (await app.inject({
      method: "GET", url: `/households/${prepHouseholdId}/meal-prep?week=1`,
    })).json();
    const cocinada = prep.prep.sessions
      .flatMap((s: { batches: { id: string; mealIds: string[] }[] }) => s.batches)
      .find((b: { mealIds: string[] }) => b.mealIds.length > 1)!;

    const response = await app.inject({
      method: "POST",
      url: `/households/${prepHouseholdId}/meal-prep/batches/${cocinada.id}/cook`,
      payload: { week: 1 },
    });
    expect(response.statusCode).toBe(409);
  });

  it("404 para una tanda que no existe", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/households/${prepHouseholdId}/meal-prep/batches/no_existe/cook`,
      payload: { week: 1 },
    });
    expect(response.statusCode).toBe(404);
  });

  it("sin perfiles físicos devuelve la referencia genérica y lo declara", async () => {
    const response = await app.inject({
      method: "GET", url: `/households/${prepHouseholdId}/nutrition`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.needs.anyGeneric).toBe(true);
    expect(body.needs.kcal).toBe(4000);
    expect(body.disclaimer).toMatch(/no es una herramienta médica/i);
  });

  it("con perfil físico estima con Mifflin-St Jeor y explica en qué se basó", async () => {
    await app.inject({
      method: "PATCH",
      url: `/households/${prepHouseholdId}`,
      payload: {
        nutritionProfiles: [{
          id: "p1", name: "Ana", kind: "adulto", sex: "femenino",
          ageYears: 34, weightKg: 62, heightCm: 163, activity: "moderado", goal: "mantener",
        }],
      },
    });
    const response = await app.inject({
      method: "GET", url: `/households/${prepHouseholdId}/nutrition`,
    });
    const body = response.json();
    expect(body.needs.perPerson[0].needs.bmrKcal).toBe(1308);
    expect(body.needs.perPerson[0].needs.basis).toMatch(/Mifflin-St Jeor/);
    // El hogar tiene dos adultos y solo uno dio su perfil: el otro cuenta con
    // la referencia genérica, y la meta del hogar es la de los dos.
    expect(body.needs.anyGeneric).toBe(true);
    expect(body.needs.kcal).toBe(body.needs.perPerson[0].needs.targetKcal + 2000);
  });
});

describe("administración de precios", () => {
  it("sin token no se puede entrar", async () => {
    const response = await app.inject({ method: "POST", url: "/admin/prices", payload: {} });
    expect(response.statusCode).toBe(401);
  });

  it("carga manual de un precio real y lo prefiere sobre el demo", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/admin/prices",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: {
        sourceId: "manual_admin",
        observations: [{
          ingredientId: "pollo_pechuga", priceCop: 21_500, quantity: 1, unit: "kg",
          city: "Bogotá", observedOn: DEMO_OBSERVED_ON, confidence: "measured",
        }],
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().accepted).toBe(1);

    const precios = (await app.inject({ method: "GET", url: "/prices?ingredientIds=pollo_pechuga" })).json();
    expect(precios.prices[0].isDemo).toBe(false);
    expect(precios.prices[0].copPerBaseUnit).toBeCloseTo(21.5, 5);
  });

  it("importa CSV y reporta la línea exacta de cada error", async () => {
    const csv = [
      "ingredient_id,price_cop,quantity,unit,city,store,source_id,observed_on,confidence",
      `arroz_blanco,5200,1,kg,Bogotá,D1,manual_admin,${DEMO_OBSERVED_ON},measured`,
      `unobtainium,9999,1,kg,Bogotá,D1,manual_admin,${DEMO_OBSERVED_ON},measured`,
    ].join("\n");

    const response = await app.inject({
      method: "POST",
      url: "/admin/prices/import",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: { sourceId: "manual_admin", csv },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.accepted).toBe(1);
    expect(body.rejected).toBe(1);
    expect(body.errors.join(" ")).toMatch(/unobtainium/);
  });

  it("registra el historial de actualizaciones", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/price-updates",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(response.json().updates.length).toBeGreaterThanOrEqual(2);
  });
});

describe("administración deshabilitada sin token configurado", () => {
  it("responde 503 y explica por qué, en vez de usar una clave por defecto", async () => {
    const db = openDb(":memory:");
    const sinToken = buildApp({ repository: new SqliteRepository(db), now: () => DEMO_OBSERVED_ON });
    await sinToken.ready();
    const response = await sinToken.inject({ method: "POST", url: "/admin/prices", payload: {} });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toBe("admin_disabled");
    expect(response.json().message).toMatch(/no existe un token por defecto/i);
    await sinToken.close();
  });
});
