import Fastify from "fastify";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  PriceIndex, buildShoppingList, cookMeal, cycleCount, generateMealPlan, parsePriceCsv,
  rindeMas, weeklyPriceUpdate, whatCanICook, eaterEquivalents, validateObservations,
} from "@rinde/core";
import type {
  Household, IngredientPrice, InventoryItem, MealSlot, PriceObservation, UserPreference,
} from "@rinde/core";
import { CATEGORIES, INGREDIENTS, INGREDIENT_BY_ID, RECIPES, RECIPE_BY_ID } from "@rinde/data";
import type { Repository } from "./repository.js";

/**
 * API REST de Rinde.
 *
 * El servidor NO reimplementa nada: deserializa, llama a `@rinde/core` y
 * persiste. Los mismos números que produce la PWA en el navegador.
 *
 * Autenticación: en el MVP no hay cuentas (§25). El `householdId` es un
 * identificador opaco; quien lo tiene, accede a ese hogar. Las rutas `/admin`
 * sí exigen un token, y si no hay token configurado quedan DESHABILITADAS —
 * nunca abiertas con una clave por defecto.
 */

export interface AppOptions {
  repository: Repository;
  /** Token de administración. Sin él, `/admin/*` responde 503. */
  adminToken?: string;
  /** Fecha de referencia para vigencia de precios. Inyectable para tests. */
  now?: () => string;
  logger?: boolean;
}

export function buildApp(options: AppOptions): FastifyInstance {
  const { repository } = options;
  const now = options.now ?? (() => new Date().toISOString().slice(0, 10));
  const app = Fastify({ logger: options.logger ?? false });

  const pricesFor = (city?: string): PriceIndex =>
    new PriceIndex(repository.listPrices(city), INGREDIENT_BY_ID, now(), city);

  function requireHousehold(request: FastifyRequest, reply: FastifyReply): Household | null {
    const { id } = request.params as { id: string };
    const household = repository.getHousehold(id);
    if (!household) {
      reply.code(404).send({ error: "not_found", message: "No existe ese hogar." });
      return null;
    }
    return household;
  }

  function requireAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
    if (!options.adminToken) {
      reply.code(503).send({
        error: "admin_disabled",
        message:
          "La administración de precios está deshabilitada porque no hay RINDE_ADMIN_TOKEN " +
          "configurado. No existe un token por defecto.",
      });
      return false;
    }
    const header = request.headers["authorization"];
    if (header !== `Bearer ${options.adminToken}`) {
      reply.code(401).send({ error: "unauthorized", message: "Token de administración inválido." });
      return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- salud

  app.get("/health", async () => ({
    status: "ok",
    ingredients: INGREDIENTS.length,
    recipes: RECIPES.length,
    prices: repository.listPrices().length,
    asOf: now(),
  }));

  // -------------------------------------------------------------- catálogo

  app.get("/catalog/ingredients", async () => ({
    categories: CATEGORIES,
    ingredients: INGREDIENTS,
    nutritionDisclaimer:
      "Valores nutricionales estimados. No provienen de una fuente verificada y no " +
      "constituyen información médica ni dietética.",
  }));

  app.get("/catalog/recipes", async (request) => {
    const query = request.query as { slot?: MealSlot; tag?: string; q?: string };
    let recipes = RECIPES;
    if (query.slot) recipes = recipes.filter((recipe) => recipe.slots.includes(query.slot!));
    if (query.tag) recipes = recipes.filter((recipe) => recipe.tags.includes(query.tag as never));
    if (query.q) {
      const term = query.q.toLowerCase();
      recipes = recipes.filter((recipe) => recipe.name.toLowerCase().includes(term));
    }
    return { total: recipes.length, recipes };
  });

  app.get("/catalog/recipes/:recipeId", async (request, reply) => {
    const { recipeId } = request.params as { recipeId: string };
    const recipe = RECIPE_BY_ID.get(recipeId);
    if (!recipe) return reply.code(404).send({ error: "not_found" });
    return recipe;
  });

  // --------------------------------------------------------------- precios

  app.get("/prices", async (request) => {
    const query = request.query as { city?: string; ingredientIds?: string };
    const index = pricesFor(query.city);
    const ids = query.ingredientIds
      ? query.ingredientIds.split(",").map((value) => value.trim())
      : index.ingredientIds();

    return {
      asOf: now(),
      containsDemo: index.containsDemo(),
      sources: repository.listSources(),
      prices: ids.map((ingredientId) => {
        const price = index.get(ingredientId);
        // `null` explícito cuando no hay precio: nunca 0.
        return price ?? {
          ingredientId,
          copPerBaseUnit: null,
          confidence: null,
          note: "Sin precio disponible",
        };
      }),
    };
  });

  app.get("/prices/:ingredientId/history", async (request) => {
    const { ingredientId } = request.params as { ingredientId: string };
    return { ingredientId, history: repository.listPriceHistory(ingredientId) };
  });

  // --------------------------------------------------------------- hogares

  app.post("/households", async (request, reply) => {
    const body = request.body as Partial<Household>;
    const error = validateHouseholdInput(body);
    if (error) return reply.code(400).send({ error: "invalid_input", message: error });

    const household: Household = {
      id: `hogar_${cryptoId()}`,
      adults: body.adults!,
      children: body.children ?? 0,
      budgetCop: body.budgetCop!,
      city: body.city ?? "Bogotá",
      slots: body.slots!,
      days: body.days!,
      preferences: (body.preferences as UserPreference[]) ?? [],
      tier: "free",
      createdOn: now(),
    };
    repository.createHousehold(household);
    return reply.code(201).send(household);
  });

  app.get("/households/:id", async (request, reply) => {
    const household = requireHousehold(request, reply);
    return household ?? reply;
  });

  app.patch("/households/:id", async (request, reply) => {
    if (!requireHousehold(request, reply)) return reply;
    const { id } = request.params as { id: string };
    const patch = request.body as Partial<Household>;
    // El id y el nivel no se cambian desde el cliente.
    delete (patch as { id?: string }).id;
    delete (patch as { tier?: string }).tier;
    const error = validateHouseholdInput({ ...requireHouseholdSafe(repository, id)!, ...patch });
    if (error) return reply.code(400).send({ error: "invalid_input", message: error });
    return repository.updateHousehold(id, patch);
  });

  app.delete("/households/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    repository.deleteHousehold(id);
    return reply.code(204).send();
  });

  // ------------------------------------------------------------ inventario

  app.get("/households/:id/inventory", async (request, reply) => {
    if (!requireHousehold(request, reply)) return reply;
    const { id } = request.params as { id: string };
    return { items: repository.listInventory(id) };
  });

  app.post("/households/:id/inventory", async (request, reply) => {
    if (!requireHousehold(request, reply)) return reply;
    const { id } = request.params as { id: string };
    const body = request.body as { ingredientId?: string; qtyBase?: number; expiresOn?: string };

    if (!body.ingredientId || !INGREDIENT_BY_ID.has(body.ingredientId)) {
      return reply.code(400).send({
        error: "unknown_ingredient",
        message: `El ingrediente "${body.ingredientId}" no está en el catálogo.`,
      });
    }
    if (typeof body.qtyBase !== "number" || !Number.isFinite(body.qtyBase) || body.qtyBase <= 0) {
      return reply.code(400).send({ error: "invalid_quantity", message: "qtyBase debe ser > 0." });
    }

    const item: InventoryItem = {
      id: `inv_${cryptoId()}`,
      ingredientId: body.ingredientId,
      qtyBase: body.qtyBase,
      updatedOn: now(),
      ...(body.expiresOn ? { expiresOn: body.expiresOn } : {}),
    };
    repository.upsertInventoryItem(id, item);
    return reply.code(201).send(item);
  });

  app.patch("/households/:id/inventory/:itemId", async (request, reply) => {
    if (!requireHousehold(request, reply)) return reply;
    const { id, itemId } = request.params as { id: string; itemId: string };
    const existing = repository.listInventory(id).find((item) => item.id === itemId);
    if (!existing) return reply.code(404).send({ error: "not_found" });

    const body = request.body as { qtyBase?: number; expiresOn?: string };
    const qtyBase = body.qtyBase ?? existing.qtyBase;
    if (!Number.isFinite(qtyBase) || qtyBase < 0) {
      return reply.code(400).send({ error: "invalid_quantity" });
    }
    if (qtyBase === 0) {
      repository.deleteInventoryItem(id, itemId);
      return reply.code(204).send();
    }
    const updated: InventoryItem = {
      ...existing,
      qtyBase,
      updatedOn: now(),
      ...(body.expiresOn ? { expiresOn: body.expiresOn } : {}),
    };
    repository.upsertInventoryItem(id, updated);
    return updated;
  });

  app.delete("/households/:id/inventory/:itemId", async (request, reply) => {
    const { id, itemId } = request.params as { id: string; itemId: string };
    repository.deleteInventoryItem(id, itemId);
    return reply.code(204).send();
  });

  // ------------------------------------------------------------------ plan

  app.post("/households/:id/plan", async (request, reply) => {
    const household = requireHousehold(request, reply);
    if (!household) return reply;
    const body = (request.body ?? {}) as { startDate?: string; seed?: number };

    const plan = generateMealPlan({
      household,
      startDate: body.startDate ?? now(),
      inventory: repository.listInventory(household.id),
      recipes: RECIPES,
      catalog: INGREDIENT_BY_ID,
      prices: pricesFor(household.city),
      planId: `plan_${cryptoId()}`,
      ...(body.seed !== undefined ? { seed: body.seed } : {}),
    });
    repository.savePlan(plan);
    return reply.code(201).send(plan);
  });

  app.get("/households/:id/plan/current", async (request, reply) => {
    if (!requireHousehold(request, reply)) return reply;
    const { id } = request.params as { id: string };
    const plan = repository.getCurrentPlan(id);
    if (!plan) {
      return reply.code(404).send({
        error: "no_plan",
        message: "Este hogar todavía no tiene un plan. Genera uno con POST /households/:id/plan.",
      });
    }
    return plan;
  });

  /** Cocinar una comida: descuenta el inventario con el motor. */
  app.post("/households/:id/meals/:mealId/cook", async (request, reply) => {
    const household = requireHousehold(request, reply);
    if (!household) return reply;
    const { mealId } = request.params as { mealId: string };

    const plan = repository.getCurrentPlan(household.id);
    if (!plan) return reply.code(404).send({ error: "no_plan" });
    const meal = plan.meals.find((entry) => entry.id === mealId);
    if (!meal) return reply.code(404).send({ error: "meal_not_found" });
    if (meal.status === "cooked") {
      return reply.code(409).send({
        error: "already_cooked",
        message: "Esta comida ya se cocinó; el inventario no se descuenta dos veces.",
      });
    }

    const result = cookMeal(meal, repository.listInventory(household.id), now());
    repository.replaceInventory(household.id, result.inventory);
    repository.setMealStatus(plan.id, mealId, "cooked", new Date().toISOString());

    return {
      meal: result.meal,
      consumed: result.consumed,
      shortages: result.shortages,
      inventory: result.inventory,
    };
  });

  // --------------------------------------------------------------- mercado

  app.get("/households/:id/shopping-list", async (request, reply) => {
    const household = requireHousehold(request, reply);
    if (!household) return reply;
    const plan = repository.getCurrentPlan(household.id);
    if (!plan) return reply.code(404).send({ error: "no_plan" });

    const query = request.query as { cycle?: string };
    const cycle = query.cycle === "all" ? ("all" as const) : Number(query.cycle ?? 1) || 1;
    return {
      cycles: cycleCount(plan),
      list: buildShoppingList(plan, INGREDIENT_BY_ID, pricesFor(household.city), {
        cycle,
        categories: CATEGORIES,
      }),
    };
  });

  // ------------------------------------------------------- qué puedo cocinar

  app.post("/households/:id/what-can-i-cook", async (request, reply) => {
    const household = requireHousehold(request, reply);
    if (!household) return reply;
    const body = (request.body ?? {}) as { slot?: MealSlot; limit?: number };

    const servings = eaterEquivalents(household.adults, household.children);
    const excluded = new Set(
      household.preferences
        .filter((preference) => preference.kind === "allergy")
        .map((preference) => preference.value),
    );

    return {
      servings,
      options: whatCanICook(
        repository.listInventory(household.id),
        RECIPES,
        INGREDIENT_BY_ID,
        pricesFor(household.city),
        servings,
        {
          limit: body.limit ?? 10,
          excludedIngredientIds: excluded,
          ...(body.slot ? { slot: body.slot } : {}),
        },
      ),
    };
  });

  // ------------------------------------------------------------- rinde más

  app.post("/households/:id/rinde-mas", async (request, reply) => {
    const household = requireHousehold(request, reply);
    if (!household) return reply;
    const plan = repository.getCurrentPlan(household.id);
    if (!plan) return reply.code(404).send({ error: "no_plan" });

    const body = (request.body ?? {}) as { extraBudgetCop?: number };
    const extra = body.extraBudgetCop ?? 0;
    if (!Number.isInteger(extra) || extra <= 0) {
      return reply.code(400).send({
        error: "invalid_budget",
        message: "extraBudgetCop debe ser un entero de COP mayor que 0.",
      });
    }
    return { options: rindeMas(extra, plan, INGREDIENT_BY_ID, pricesFor(household.city)) };
  });

  // ------------------------------------------------------------ administración

  app.post("/admin/prices", async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    const body = request.body as { sourceId?: string; observations?: PriceObservation[] };
    if (!body.sourceId || !Array.isArray(body.observations)) {
      return reply.code(400).send({
        error: "invalid_input",
        message: "Se requieren sourceId y observations[].",
      });
    }
    return applyPriceUpdate(body.sourceId, body.observations);
  });

  app.post("/admin/prices/import", async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    const body = request.body as { sourceId?: string; csv?: string };
    if (!body.sourceId || typeof body.csv !== "string") {
      return reply.code(400).send({ error: "invalid_input", message: "Se requieren sourceId y csv." });
    }
    const { observations, errors } = parsePriceCsv(body.csv);
    const result = applyPriceUpdate(body.sourceId, observations);
    return { ...result, parseErrors: errors };
  });

  app.get("/admin/price-updates", async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    return { updates: repository.listPriceUpdates(50) };
  });

  app.get("/admin/prices/validate", async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    const body = request.query as { csv?: string };
    if (!body.csv) return reply.code(400).send({ error: "invalid_input" });
    const { observations, errors } = parsePriceCsv(body.csv);
    const validation = validateObservations(observations, INGREDIENT_BY_ID);
    return { accepted: validation.accepted.length, errors: [...errors, ...validation.errors] };
  });

  function applyPriceUpdate(sourceId: string, observations: readonly PriceObservation[]) {
    const result = weeklyPriceUpdate({
      sourceId,
      observations,
      catalog: INGREDIENT_BY_ID,
      previousHistory: repository.listPriceHistory(),
      asOf: now(),
      isDemo: false,
    });
    repository.insertPrices(result.prices as IngredientPrice[]);
    repository.insertPriceHistory(result.history);
    repository.recordPriceUpdate(result.report, new Date().toISOString());
    return result.report;
  }

  return app;
}

// ---------------------------------------------------------------------------

function validateHouseholdInput(body: Partial<Household>): string | null {
  if (typeof body.adults !== "number" || body.adults < 0) return "adults debe ser un número >= 0.";
  if (body.children !== undefined && (typeof body.children !== "number" || body.children < 0)) {
    return "children debe ser un número >= 0.";
  }
  if ((body.adults ?? 0) + (body.children ?? 0) <= 0) return "El hogar debe tener al menos una persona.";
  if (!Number.isInteger(body.budgetCop) || (body.budgetCop as number) <= 0) {
    return "budgetCop debe ser un entero de pesos colombianos mayor que 0.";
  }
  if (!Array.isArray(body.slots) || body.slots.length === 0) {
    return "slots debe traer al menos un tipo de comida.";
  }
  const validSlots: MealSlot[] = ["desayuno", "almuerzo", "cena", "snack"];
  if (body.slots.some((slot) => !validSlots.includes(slot))) return "slots contiene un valor inválido.";
  if (!Number.isInteger(body.days) || (body.days as number) <= 0 || (body.days as number) > 62) {
    return "days debe ser un entero entre 1 y 62.";
  }
  return null;
}

function requireHouseholdSafe(repository: Repository, id: string): Household | null {
  return repository.getHousehold(id);
}

function cryptoId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
