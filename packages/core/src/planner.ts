import type {
  Cop,
  Household,
  Ingredient,
  InventoryItem,
  IsoDate,
  Meal,
  MealPlan,
  MealSlot,
  PlanDiagnostics,
  Recipe,
} from "./types.js";
import type { PriceIndex } from "./pricing.js";
import { VirtualPantry, expiryUrgency, planPurchase } from "./inventory.js";
import { costMeal } from "./costing.js";
import { DEFAULT_CHILD_FACTOR, eaterEquivalents, scaleRecipe, type ScaleResult } from "./scaling.js";
import { addNutrition, balanceScore, nutritionOfScaled, zeroNutrition } from "./nutrition.js";
import { substituteExpensive } from "./substitutions.js";
import { addDays } from "./dates.js";
import { mulberry32, seedFrom } from "./random.js";
import { splitEvenly } from "./money.js";
import { round } from "./units.js";

/**
 * Planificador de menú — el corazón de Rinde (§13 y §31 del brief).
 *
 * ES UNA HEURÍSTICA VORAZ, NO UN OPTIMIZADOR.
 * Recorre las comidas en orden y para cada una elige la receta con mejor
 * puntuación dado el estado actual (despensa simulada, presupuesto restante,
 * qué se comió antes, qué está por vencer). No explora combinaciones ni
 * garantiza nada parecido a un óptimo global, y el plan lo declara así en
 * `diagnostics.method`. Sustituirla por un optimizador real (ILP/CP-SAT)
 * significa reimplementar `generateMealPlan` respetando la misma firma.
 *
 * Determinismo: no lee el reloj, no llama a `Math.random()`. Misma entrada y
 * misma semilla ⇒ mismo plan, byte por byte.
 */

export const PLANNER_VERSION = "heuristic-1.0.0";

export interface ScoringWeights {
  /** Que la comida quepa en lo que queda de presupuesto. */
  budget: number;
  /** Usar primero lo que ya está en casa. */
  inventory: number;
  /** No repetir el mismo plato. */
  variety: number;
  /** No comprar cosas que se van a usar a medias. */
  waste: number;
  /** Mantener el día razonablemente equilibrado. */
  nutrition: number;
  /** Preferir ingredientes que aparecen en varias recetas. */
  reuse: number;
  /** Gastar antes lo que vence antes. */
  expiry: number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  budget: 0.3,
  inventory: 0.2,
  variety: 0.18,
  waste: 0.12,
  nutrition: 0.1,
  reuse: 0.06,
  expiry: 0.04,
};

export interface PlanRequest {
  household: Household;
  startDate: IsoDate;
  inventory: readonly InventoryItem[];
  recipes: readonly Recipe[];
  catalog: ReadonlyMap<string, Ingredient>;
  prices: PriceIndex;
  /** Si se omite, se deriva del hogar: mismo hogar ⇒ mismo plan. */
  seed?: number;
  weights?: Partial<ScoringWeights>;
  childFactor?: number;
  planId?: string;
}

interface Candidate {
  recipe: Recipe;
  scale: ScaleResult;
}

interface Attempt {
  meals: Meal[];
  pantry: VirtualPantry;
  /** Costo real de la compra, ya redondeado a formatos de venta. */
  purchaseTotalCop: Cop;
  totalFoodValueCop: Cop;
  unpriced: Set<string>;
  substitutionsApplied: number;
  pressure: number;
}

/** Presiones de presupuesto que se intentan, en orden, hasta caber. */
const PRESSURE_LADDER = [0, 0.35, 0.7, 1] as const;

/**
 * Fracción del presupuesto que el planificador APUNTA a usar.
 *
 * El presupuesto no es solo un techo: es el dinero que el hogar tiene para
 * comer. Un plan que gasta $250.000 de $800.000 no es un buen plan, es un plan
 * que deja a la familia comiendo peor de lo que puede permitirse. El
 * planificador busca acercarse a este porcentaje sin pasarse.
 *
 * El 5% restante es colchón: el gasto real se calcula sobre formatos de venta
 * (se compra la libra entera), así que siempre queda por encima de la suma de
 * los déficits comida a comida.
 */
const BUDGET_UTILIZATION = 0.95;

/**
 * Un mismo plato no debería repetirse con menos de dos días de diferencia.
 * Multiplicador que se aplica cuando eso pasa.
 */
const REPEAT_DAMPING = 0.35;

export function generateMealPlan(request: PlanRequest): MealPlan {
  const { household, startDate, catalog, prices } = request;
  const weights: ScoringWeights = { ...DEFAULT_WEIGHTS, ...request.weights };
  const seed = request.seed ?? seedFrom(`${household.id}:${startDate}`);
  const childFactor = request.childFactor ?? DEFAULT_CHILD_FACTOR;

  if (household.slots.length === 0) {
    throw new RangeError("El hogar debe tener al menos un tipo de comida activo");
  }
  if (household.days <= 0) {
    throw new RangeError("El plan debe cubrir al menos un día");
  }

  const eaters = eaterEquivalents(household.adults, household.children, childFactor);
  const headcount = household.adults + household.children;
  const mealsRequested = household.days * household.slots.length;
  const { hardExcluded, softExcluded, requiredDiets } = splitPreferences(household);

  const warnings: string[] = [];
  const repairSteps: string[] = [];
  let best: Attempt | null = null;

  for (const pressure of PRESSURE_LADDER) {
    const attempt = runAttempt({
      request,
      weights,
      seed,
      eaters,
      headcount,
      pressure,
      hardExcluded,
      softExcluded,
      requiredDiets,
    });
    if (pressure > 0) {
      repairSteps.push(
        `Presión de presupuesto ${Math.round(pressure * 100)}%: ` +
          `gasto proyectado $${attempt.purchaseTotalCop}` +
          (attempt.substitutionsApplied > 0
            ? `, ${attempt.substitutionsApplied} sustitución(es) aplicada(s)`
            : ""),
      );
    }
    if (best === null || attempt.purchaseTotalCop < best.purchaseTotalCop) best = attempt;
    if (attempt.purchaseTotalCop <= household.budgetCop) {
      best = attempt;
      break;
    }
  }

  const chosen = best!;
  const withinBudget = chosen.purchaseTotalCop <= household.budgetCop;

  if (!withinBudget) {
    warnings.push(
      "No se encontró un plan que cupiera en el presupuesto con las recetas y precios disponibles. " +
        "Se muestra el plan más económico que se pudo construir.",
    );
  }
  if (chosen.unpriced.size > 0) {
    warnings.push(
      `${chosen.unpriced.size} ingrediente(s) no tienen precio; el costo mostrado está incompleto.`,
    );
  }
  if (chosen.meals.length < mealsRequested) {
    warnings.push(
      `Solo se pudieron planificar ${chosen.meals.length} de ${mealsRequested} comidas: ` +
        "no hay suficientes recetas compatibles con las preferencias del hogar.",
    );
  }
  if (prices.containsDemo()) {
    warnings.push("El plan usa precios de demostración. No son precios reales de mercado.");
  }

  const diagnostics: PlanDiagnostics = {
    method: "heuristic",
    withinBudget,
    budgetDeltaCop: household.budgetCop - chosen.purchaseTotalCop,
    mealsPlanned: chosen.meals.length,
    mealsRequested,
    distinctRecipes: new Set(chosen.meals.map((m) => m.recipeId)).size,
    repairSteps,
    warnings,
  };

  return {
    id: request.planId ?? `plan_${household.id}_${startDate}`,
    householdId: household.id,
    startDate,
    days: household.days,
    budgetCop: household.budgetCop,
    projectedSpendCop: chosen.purchaseTotalCop,
    totalFoodValueCop: chosen.totalFoodValueCop,
    meals: chosen.meals,
    unpricedIngredientIds: [...chosen.unpriced].sort(),
    netRequirements: mapToList(chosen.pantry.netRequirements()),
    pantryLeftovers: mapToList(chosen.pantry.remaining()),
    plannerVersion: PLANNER_VERSION,
    seed,
    diagnostics,
  };
}

// ---------------------------------------------------------------------------

interface AttemptArgs {
  request: PlanRequest;
  weights: ScoringWeights;
  seed: number;
  eaters: number;
  headcount: number;
  pressure: number;
  hardExcluded: Set<string>;
  softExcluded: Set<string>;
  requiredDiets: string[];
}

function runAttempt(args: AttemptArgs): Attempt {
  const { request, weights, seed, eaters, headcount, pressure } = args;
  const { household, catalog, prices, startDate } = request;
  const rand = mulberry32(seed ^ Math.round(pressure * 1000));

  // A partir de presión media se reemplazan ingredientes caros por
  // alternativas más baratas antes de puntuar (§31, paso 8).
  let substitutionsApplied = 0;
  let recipes = request.recipes;
  if (pressure >= 0.7) {
    const swapped: Recipe[] = [];
    for (const recipe of request.recipes) {
      const result = substituteExpensive(recipe, catalog, prices, {
        excludedIngredientIds: args.hardExcluded,
        minSavingCop: 200,
      });
      substitutionsApplied += result.applied.length;
      swapped.push(result.recipe);
    }
    recipes = swapped;
  }

  const eligible = recipes.filter((recipe) =>
    isEligible(recipe, args.hardExcluded, args.requiredDiets, catalog),
  );

  // Las recetas se escalan una sola vez: el número de comensales no cambia
  // dentro de un plan.
  const bySlot = new Map<MealSlot, Candidate[]>();
  for (const slot of household.slots) bySlot.set(slot, []);
  for (const recipe of eligible) {
    const scale = scaleRecipe(recipe, eaters, catalog);
    for (const slot of recipe.slots) {
      const bucket = bySlot.get(slot);
      if (bucket) bucket.push({ recipe, scale });
    }
  }

  const pantry = new VirtualPantry(request.inventory);
  const meals: Meal[] = [];
  const unpriced = new Set<string>();
  const lastUsedAt = new Map<string, number>();
  const useCount = new Map<string, number>();
  const inPlay = new Set<string>();
  for (const item of request.inventory) inPlay.add(item.ingredientId);

  const totalMeals = household.days * household.slots.length;
  const varietyWindow = Math.min(14, Math.max(3, totalMeals));
  let mealIndex = 0;
  let spentSoFar = 0;
  let totalValue = 0;
  let consumedToday = zeroNutrition();

  for (let day = 0; day < household.days; day++) {
    const date = addDays(startDate, day);
    consumedToday = zeroNutrition();

    for (const slot of household.slots) {
      const candidates = bySlot.get(slot) ?? [];
      if (candidates.length === 0) {
        mealIndex++;
        continue;
      }

      const remainingMeals = Math.max(1, totalMeals - mealIndex);
      const targetBudget = household.budgetCop * BUDGET_UTILIZATION;
      const remainingBudget = Math.max(0, targetBudget - spentSoFar);
      // Cuánto puede costar esta comida para que el dinero alcance justo hasta
      // el final. Se recalcula en cada turno, así que gastar de más ahora
      // aprieta automáticamente lo que viene.
      const targetPerMeal = Math.max(1, remainingBudget / remainingMeals);
      // Con más presión, el techo por comida se aprieta.
      const costCap = targetPerMeal * (2.5 - 1.5 * pressure);

      // Primera pasada: cuánto costaría cada receta con la despensa actual.
      const simulations = candidates.map((candidate) => ({
        candidate,
        simulated: costMeal(candidate.scale, pantry, prices, headcount, { commit: false }),
      }));

      let chosen: { candidate: Candidate; score: number } | null = null;
      let fallback: { candidate: Candidate; score: number; cost: number } | null = null;

      for (const { candidate, simulated } of simulations) {
        const score = scoreCandidate({
          candidate,
          simulated,
          pantry,
          catalog,
          weights,
          targetPerMeal,
          mealIndex,
          varietyWindow,
          lastUsedAt,
          useCount,
          inPlay,
          eaters,
          slotsPerDay: household.slots.length,
          consumedToday,
          softExcluded: args.softExcluded,
          date,
          totalMeals,
          distinctCandidates: candidates.length,
        });
        const jittered = score + rand() * 1e-6;

        if (
          !fallback ||
          simulated.purchaseCop < fallback.cost ||
          (simulated.purchaseCop === fallback.cost && jittered > fallback.score)
        ) {
          fallback = { candidate, score: jittered, cost: simulated.purchaseCop };
        }
        if (pressure > 0 && simulated.purchaseCop > costCap) continue;
        if (!chosen || jittered > chosen.score) chosen = { candidate, score: jittered };
      }

      // Si el techo dejó fuera a todas, se toma la más barata posible en vez
      // de dejar la comida sin planificar.
      const winner = chosen?.candidate ?? fallback?.candidate;
      if (!winner) {
        mealIndex++;
        continue;
      }

      const costed = costMeal(winner.scale, pantry, prices, headcount, { commit: true });
      for (const id of costed.unpricedIngredientIds) unpriced.add(id);
      for (const line of costed.lines) inPlay.add(line.ingredientId);

      const perPerson = splitEvenly(costed.costCop, Math.max(1, headcount));
      meals.push({
        id: `${date}_${slot}`,
        date,
        slot,
        recipeId: winner.recipe.id,
        servings: round(eaters, 2),
        lines: costed.lines,
        costCop: costed.costCop,
        costPerPersonCop: perPerson[0] ?? 0,
        costIncomplete: costed.costIncomplete,
        status: "planned",
      });

      consumedToday = addNutrition(consumedToday, nutritionOfScaled(winner.scale, catalog));
      lastUsedAt.set(winner.recipe.id, mealIndex);
      useCount.set(winner.recipe.id, (useCount.get(winner.recipe.id) ?? 0) + 1);
      spentSoFar += costed.purchaseCop;
      totalValue += costed.costCop;
      mealIndex++;
    }
  }

  // El gasto real no es la suma de los déficits comida a comida: es lo que
  // cuesta comprar el requerimiento neto en los formatos en que se vende.
  const purchaseTotalCop = purchaseTotalOf(pantry, catalog, prices);

  return {
    meals,
    pantry,
    purchaseTotalCop,
    totalFoodValueCop: totalValue,
    unpriced,
    substitutionsApplied,
    pressure,
  };
}

// ---------------------------------------------------------------------------
// Puntuación
// ---------------------------------------------------------------------------

interface ScoreArgs {
  candidate: Candidate;
  simulated: ReturnType<typeof costMeal>;
  pantry: VirtualPantry;
  catalog: ReadonlyMap<string, Ingredient>;
  weights: ScoringWeights;
  /** Cuánto puede costar esta comida para que el presupuesto llegue al final. */
  targetPerMeal: number;
  mealIndex: number;
  varietyWindow: number;
  lastUsedAt: Map<string, number>;
  useCount: Map<string, number>;
  inPlay: Set<string>;
  eaters: number;
  slotsPerDay: number;
  consumedToday: ReturnType<typeof zeroNutrition>;
  softExcluded: Set<string>;
  date: IsoDate;
  totalMeals: number;
  distinctCandidates: number;
}

function scoreCandidate(args: ScoreArgs): number {
  const { candidate, simulated, weights } = args;

  // 1. Presupuesto: acercarse a lo que esta comida PUEDE costar.
  //
  // No se premia gastar poco, se premia gastar bien. Una comida de $900
  // cuando el presupuesto permite $8.900 no está ahorrando: está dejando al
  // hogar comiendo peor de lo que puede. Pasarse penaliza mucho más rápido
  // que quedarse corto, porque el techo del presupuesto sí es un techo.
  const ratio = simulated.purchaseCop / Math.max(1, args.targetPerMeal);
  const budgetScore =
    ratio <= 1 ? 0.55 + 0.45 * ratio : clamp01(1 - (ratio - 1) * 1.5);

  // 2. Inventario: qué proporción del valor de la comida ya está en casa.
  const inventoryScore =
    simulated.costCop > 0 ? clamp01((simulated.costCop - simulated.purchaseCop) / simulated.costCop) : 0;

  // 3. Variedad: cuánto hace que no se cocina y cuántas veces ya salió.
  const lastUsed = args.lastUsedAt.get(candidate.recipe.id);
  const recency = lastUsed === undefined ? 1 : clamp01((args.mealIndex - lastUsed) / args.varietyWindow);
  const maxRepeats = Math.max(2, Math.ceil(args.totalMeals / Math.max(1, args.distinctCandidates)));
  const repeatScore = clamp01(1 - (args.useCount.get(candidate.recipe.id) ?? 0) / maxRepeats);
  let varietyScore = 0.65 * recency + 0.35 * repeatScore;
  // Repetir el mismo plato con menos de dos días de diferencia hunde la
  // puntuación: sin esto, el plato más barato del catálogo se apodera de un
  // horario completo y el mes entero sabe igual.
  if (lastUsed !== undefined && args.mealIndex - lastUsed < args.slotsPerDay * 2) {
    varietyScore *= REPEAT_DAMPING;
  }

  // 4. Desperdicio: comprar un perecedero nuevo para usar solo una parte.
  let wastePenalty = 0;
  let wasteLines = 0;
  for (const line of simulated.lines) {
    if (line.toBuyBase <= 0) continue;
    const ingredient = args.catalog.get(line.ingredientId);
    if (!ingredient?.perishable) continue;
    const purchase = planPurchase(line.toBuyBase, ingredient);
    if (purchase.purchaseBase <= 0) continue;
    const unusedFraction = purchase.surplusBase / purchase.purchaseBase;
    // Si el ingrediente ya está en juego, el sobrante lo absorben otras comidas.
    wastePenalty += args.inPlay.has(line.ingredientId) ? unusedFraction * 0.25 : unusedFraction;
    wasteLines++;
  }
  const wasteScore = wasteLines === 0 ? 1 : clamp01(1 - wastePenalty / wasteLines);

  // 5. Nutrición: qué tanto ayuda a equilibrar el día.
  const nutrition = nutritionOfScaled(candidate.scale, args.catalog);
  const nutritionScore = balanceScore(nutrition, args.consumedToday, args.eaters, args.slotsPerDay);

  // 6. Reutilización: preferir ingredientes que ya están en el plan.
  const realLines = simulated.lines.length;
  const reused = simulated.lines.filter((line) => args.inPlay.has(line.ingredientId)).length;
  const reuseScore = realLines === 0 ? 0 : reused / realLines;

  // 7. Caducidad: premiar gastar lo que está por vencer.
  let expiryScore = 0;
  for (const line of simulated.lines) {
    if (line.fromInventoryBase <= 0) continue;
    const urgency = expiryUrgency(args.pantry.expiresOn(line.ingredientId), args.date);
    const value = urgency === "urgent" ? 1 : urgency === "soon" ? 0.6 : urgency === "ok" ? 0.1 : 0;
    if (value > expiryScore) expiryScore = value;
  }

  let score =
    weights.budget * budgetScore +
    weights.inventory * inventoryScore +
    weights.variety * varietyScore +
    weights.waste * wasteScore +
    weights.nutrition * nutritionScore +
    weights.reuse * reuseScore +
    weights.expiry * expiryScore;

  // Rechazos blandos: no se prohíbe la receta, se hunde su puntuación.
  for (const line of candidate.scale.lines) {
    if (args.softExcluded.has(line.ingredientId)) {
      score *= 0.25;
      break;
    }
  }
  // Una receta con ingredientes no catalogados no puede costearse bien.
  if (candidate.scale.unknownIngredientIds.length > 0) score *= 0.5;

  return score;
}

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

function isEligible(
  recipe: Recipe,
  hardExcluded: ReadonlySet<string>,
  requiredDiets: readonly string[],
  catalog: ReadonlyMap<string, Ingredient>,
): boolean {
  for (const diet of requiredDiets) {
    if (!recipe.tags.includes(diet as never)) return false;
  }
  for (const item of recipe.ingredients) {
    // Un alérgeno excluye la receta aunque el ingrediente sea opcional:
    // en seguridad alimentaria no se asume que alguien lo va a omitir.
    if (hardExcluded.has(item.ingredientId)) return false;
  }
  // Una receta donde no se reconoce ni la mitad de los ingredientes no se puede
  // costear de forma responsable.
  const known = recipe.ingredients.filter((item) => catalog.has(item.ingredientId)).length;
  return known * 2 >= recipe.ingredients.length;
}

function splitPreferences(household: Household): {
  hardExcluded: Set<string>;
  softExcluded: Set<string>;
  requiredDiets: string[];
} {
  const hardExcluded = new Set<string>();
  const softExcluded = new Set<string>();
  const requiredDiets: string[] = [];
  for (const preference of household.preferences) {
    if (preference.kind === "allergy") hardExcluded.add(preference.value);
    else if (preference.kind === "dislike") {
      if (preference.severity === "hard") hardExcluded.add(preference.value);
      else softExcluded.add(preference.value);
    } else if (preference.kind === "diet") requiredDiets.push(preference.value);
  }
  return { hardExcluded, softExcluded, requiredDiets };
}

/** Costo de comprar el requerimiento neto en formatos reales de venta. */
export function purchaseTotalOf(
  pantry: VirtualPantry,
  catalog: ReadonlyMap<string, Ingredient>,
  prices: PriceIndex,
): Cop {
  let total = 0;
  for (const [ingredientId, neededBase] of pantry.netRequirements()) {
    const ingredient = catalog.get(ingredientId);
    if (!ingredient) continue;
    const purchase = planPurchase(neededBase, ingredient);
    const cost = prices.costOf(ingredientId, purchase.purchaseBase);
    if (cost !== null) total += cost;
  }
  return total;
}

function mapToList(map: Map<string, number>): { ingredientId: string; qtyBase: number }[] {
  return [...map.entries()]
    .map(([ingredientId, qtyBase]) => ({ ingredientId, qtyBase: round(qtyBase, 3) }))
    .sort((a, b) => (a.ingredientId < b.ingredientId ? -1 : 1));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
