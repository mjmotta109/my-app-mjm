import type {
  CookingTimeBudget,
  Cop,
  MealPrepPreference,
  Difficulty,
  Household,
  Ingredient,
  InventoryItem,
  IsoDate,
  Meal,
  MealPlan,
  MealSlot,
  MealSubstitution,
  PlanDiagnostics,
  Recipe,
} from "./types.js";
import type { PriceIndex } from "./pricing.js";
import { VirtualPantry, expiryUrgency, planPurchase } from "./inventory.js";
import { costMeal } from "./costing.js";
import { DEFAULT_CHILD_FACTOR, eaterEquivalents, scaleRecipe, type ScaleResult } from "./scaling.js";
import {
  addNutrition, dayFitScore, nutritionOfScaled, zeroNutrition, type NutritionTotals,
} from "./nutrition.js";
import { householdNeeds, mealFloor, mealTarget } from "./nutrition-needs.js";
import { substituteExpensive } from "./substitutions.js";
import { addDays, dayOfWeek } from "./dates.js";
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
  /** Caber en el tiempo que el hogar tiene para cocinar ese día. */
  time: number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  // La nutrición pesa casi tanto como el presupuesto a propósito. Con 0,09 el
  // plan cumplía el presupuesto dando de comer 1.748 kcal al día contra una
  // referencia de 2.000: ahorraba alimentando de menos. Ver DECISIONS.md D27.
  // El desperdicio y la reutilización subieron (0,09 -> 0,14 y 0,06 -> 0,10)
  // porque el gasto real no es lo que se come sino lo que se compra: un mes con
  // 47 recetas distintas deja media despensa de paquetes abiertos. Ver D28.
  budget: 0.3,
  nutrition: 0.18,
  inventory: 0.15,
  waste: 0.14,
  variety: 0.12,
  reuse: 0.1,
  time: 0.07,
  expiry: 0.04,
};

/** Orden de menor a mayor exigencia, para comparar dificultades. */
const DIFFICULTY_RANK: Record<Difficulty, number> = { facil: 0, media: 1, dificil: 2 };

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
  /** Nutrición de la receta ya escalada al hogar. Se calcula una sola vez. */
  nutrition: NutritionTotals;
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
  /** Comidas que no cupieron en el tiempo declarado por el hogar. */
  overTimeMeals: number;
  /** Comidas que no alcanzaron el piso nutricional de su horario. */
  belowFloorMeals: number;
  /** Energía media por persona y día. `null` si no hubo comidas. */
  kcalPerPersonPerDay: number | null;
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
  if (chosen.belowFloorMeals > 0) {
    warnings.push(
      `${chosen.belowFloorMeals} comida(s) se quedan por debajo del mínimo nutricional de su ` +
        "horario. No hay recetas compatibles más sustanciosas: revisa las restricciones o el " +
        "tiempo de cocina.",
    );
  }
  if (chosen.overTimeMeals > 0) {
    warnings.push(
      `${chosen.overTimeMeals} comida(s) no caben en el tiempo de cocina que declaraste. ` +
        "No hay recetas compatibles más rápidas para ese momento del día.",
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
    mealsOverTimeBudget: chosen.overTimeMeals,
    mealsBelowNutritionFloor: chosen.belowFloorMeals,
    averageKcalPerPersonPerDay: chosen.kcalPerPersonPerDay,
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
  const { request, weights: baseWeights, seed, eaters, headcount, pressure } = args;
  const { household, catalog, prices, startDate } = request;
  const rand = mulberry32(seed ^ Math.round(pressure * 1000));

  // Apretar el presupuesto no es solo "cocinar barato": el gasto real es lo que
  // se COMPRA, y un mes con cuarenta recetas distintas deja media despensa de
  // paquetes a medio usar. Cuando hay que apretar, lo que de verdad ahorra es
  // repetir platos para terminar los paquetes. Ese es el intercambio honesto
  // que se le ofrece a la persona: menos variedad a cambio de que el dinero
  // alcance. La presión lo hace explícito en vez de dejarlo al azar.
  const weights: ScoringWeights =
    pressure === 0
      ? baseWeights
      : {
          ...baseWeights,
          budget: baseWeights.budget * (1 + 0.4 * pressure),
          waste: baseWeights.waste * (1 + 0.9 * pressure),
          reuse: baseWeights.reuse * (1 + 0.9 * pressure),
          variety: baseWeights.variety * (1 - 0.6 * pressure),
        };

  // A partir de presión media se reemplazan ingredientes caros por
  // alternativas más baratas antes de puntuar (§31, paso 8).
  let substitutionsApplied = 0;
  /** Qué se cambió en cada receta, para poder decirlo en cada comida. */
  const cambiosPorReceta = new Map<string, MealSubstitution[]>();
  let recipes = request.recipes;
  if (pressure >= 0.7) {
    const swapped: Recipe[] = [];
    for (const recipe of request.recipes) {
      const result = substituteExpensive(recipe, catalog, prices, {
        excludedIngredientIds: args.hardExcluded,
        minSavingCop: 200,
      });
      substitutionsApplied += result.applied.length;
      if (result.applied.length > 0) {
        cambiosPorReceta.set(
          recipe.id,
          result.applied.map((a) => ({
            fromIngredientId: a.fromIngredientId,
            toIngredientId: a.toIngredientId,
          })),
        );
      }
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
    const nutrition = nutritionOfScaled(scale, catalog);
    for (const slot of recipe.slots) {
      const bucket = bySlot.get(slot);
      if (!bucket) continue;
      // Una comida principal solo se resuelve con un plato. Un jugo o un
      // pedazo de queso con bocadillo no son un desayuno, por barato que salga.
      if (slot !== "snack" && recipe.kind !== "plato") continue;
      bucket.push({ recipe, scale, nutrition });
    }
  }

  const pantry = new VirtualPantry(request.inventory);
  const meals: Meal[] = [];
  const unpriced = new Set<string>();
  const lastUsedAt = new Map<string, number>();
  const useCount = new Map<string, number>();
  /** Veces que se usó cada receta dentro de la ventana de cocina actual. */
  let useInWindow = new Map<string, number>();
  /** Recetas ya usadas HOY: una tanda se reparte entre días, no dentro del día. */
  let usedToday = new Set<string>();
  /** Último día del plan en que se usó cada receta. */
  const ultimoDia = new Map<string, number>();
  const mealPrep = household.mealPrep?.enabled ? household.mealPrep : null;
  const windowDays = Math.max(1, mealPrep?.windowDays ?? 7);
  const inPlay = new Set<string>();
  for (const item of request.inventory) inPlay.add(item.ingredientId);

  const totalMeals = household.days * household.slots.length;
  const varietyWindow = Math.min(14, Math.max(3, totalMeals));
  // Tope duro de repeticiones. Sin él, apretar el presupuesto degenera en once
  // recetas para noventa comidas: el dinero cuadra y el recetario sobra. Con
  // 90 comidas salen 4 usos por receta, o sea ninguna más de una vez por
  // semana. Si ni así cabe el presupuesto, el plan lo dice en vez de resolverlo
  // sirviendo lo mismo todos los días.
  const maxUsosPorReceta = Math.max(2, Math.ceil(totalMeals / 24));
  // Metas del hogar: del perfil físico si lo hay, o de la referencia genérica.
  const needs = householdNeeds(household);
  // Piso y meta de cada horario, calculados una sola vez.
  const floors = new Map(household.slots.map((slot) => [slot, mealFloor(needs, slot)]));
  const targets = new Map(
    household.slots.map((slot) => [slot, mealTarget(needs, slot, household.slots)]),
  );
  let mealIndex = 0;
  let spentSoFar = 0;
  let totalValue = 0;
  /** Comidas que no cupieron en el tiempo declarado. Se reporta, no se esconde. */
  let overTimeMeals = 0;
  /** Comidas que no alcanzaron el piso nutricional del horario. */
  let belowFloorMeals = 0;
  /** Energía total del plan, para poder reportar el promedio diario. */
  let totalKcal = 0;
  let consumedToday = zeroNutrition();

  for (let day = 0; day < household.days; day++) {
    const date = addDays(startDate, day);
    consumedToday = zeroNutrition();
    // Al abrir una ventana nueva se empieza de cero: las tandas se agrupan
    // dentro de la semana, no entre semanas.
    if (mealPrep && day % windowDays === 0) useInWindow = new Map();
    usedToday = new Set();

    // Energía que el día debería llevar acumulada al llegar a este horario.
    let esperadoHastaAhora = 0;
    for (const slot of household.slots) {
      const candidates = bySlot.get(slot) ?? [];
      if (candidates.length === 0) {
        mealIndex++;
        continue;
      }

      const floor = floors.get(slot) ?? { kcal: 0, proteinG: 0 };
      const target = targets.get(slot) ?? { kcal: 0, proteinG: 0 };
      // Lo que el día lleva de retraso: si el desayuno salió corto, el almuerzo
      // tiene que compensar.
      const kcalDebt = Math.max(0, esperadoHastaAhora - consumedToday.kcal);

      // Cuánto tiempo hay para cocinar ESTA comida, este día.
      const timeLimit = minutesAvailable(household.cookingTime, date, slot);
      const difficultyCap = maxDifficultyFor(household.cookingTime, date);

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
      let fallback:
        | { candidate: Candidate; score: number; cost: number; sirve: boolean }
        | null = null;
      /** La más rápida entre las que NO caben en el tiempo, por si no hay otra. */
      let quickest: { candidate: Candidate; score: number } | null = null;
      /** La más sustanciosa entre las que no alcanzan el piso nutricional. */
      let heartiest: { candidate: Candidate; score: number; cabe: boolean } | null = null;
      /** La menos repetida, por si el tope de repeticiones las agotó todas. */
      let menosUsada: { candidate: Candidate; usos: number; hoy: boolean; sirve: boolean } | null =
        null;

      for (const { candidate, simulated } of simulations) {
        // Dos límites duros de repertorio, no preferencias:
        //   - el mismo plato no se sirve dos veces el mismo día;
        //   - ninguna receta pasa del tope de usos del plan.
        // Como preferencia puntuada, la primera cedía en cuanto el presupuesto
        // apretaba y el plan servía lo mismo en almuerzo y cena.
        const usos = useCount.get(candidate.recipe.id) ?? 0;
        // "Hoy" incluye ayer: el mismo desayuno lunes y martes se lee como
        // "otra vez lo mismo" aunque el tope mensual esté lejos de agotarse.
        const hoy =
          usedToday.has(candidate.recipe.id) ||
          ultimoDia.get(candidate.recipe.id) === day - 1;
        if (hoy || usos >= maxUsosPorReceta) {
          // Se anota si además cumpliría los dos límites reales (tiempo y
          // piso): abajo eso decide si vale la pena repetir antes que servir
          // una comida corta.
          const sirve =
            (timeLimit === null || candidate.recipe.minutes <= timeLimit) &&
            cumpleFloor(candidate, floor);
          const mejor =
            !menosUsada ||
            (sirve && !menosUsada.sirve) ||
            (sirve === menosUsada.sirve &&
              ((!hoy && menosUsada.hoy) || (hoy === menosUsada.hoy && usos < menosUsada.usos)));
          if (mejor) menosUsada = { candidate, usos, hoy, sirve };
          continue;
        }
        const score = scoreCandidate({
          candidate,
          simulated,
          pantry,
          catalog,
          weights,
          targetPerMeal,
          timeLimit,
          difficultyCap,
          target,
          kcalDebt,
          mealIndex,
          varietyWindow,
          lastUsedAt,
          useCount,
          inPlay,
          eaters,
          slotsPerDay: household.slots.length,
          consumedToday,
          mealPrep,
          useInWindow,
          softExcluded: args.softExcluded,
          date,
          totalMeals,
          distinctCandidates: candidates.length,
        });
        const jittered = score + rand() * 1e-6;

        // El tiempo es un límite real, no una preferencia: una receta de 90
        // minutos no entra en un martes de 25, por buena que sea en todo lo
        // demás. Si NINGUNA cabe, abajo se toma la más rápida disponible.
        const cabeEnTiempo = timeLimit === null || candidate.recipe.minutes <= timeLimit;
        // El piso nutricional también es un límite real. Sin él, la forma más
        // barata de cumplir el presupuesto es dar de comer menos, y el plan
        // termina sirviendo 1.700 kcal al día contra una meta de 2.000.
        const alcanzaPiso = cumpleFloor(candidate, floor);

        // La reserva de último recurso. Se prefiere siempre una que cumpla los
        // dos límites reales: la más barata del catálogo suele ser también la
        // más flaca, y ahorrar sirviendo menos comida es lo que no se quiere.
        const sirveReserva = cabeEnTiempo && alcanzaPiso;
        const mejorReserva =
          !fallback ||
          (sirveReserva && !fallback.sirve) ||
          (sirveReserva === fallback.sirve &&
            (simulated.purchaseCop < fallback.cost ||
              (simulated.purchaseCop === fallback.cost && jittered > fallback.score)));
        if (mejorReserva) {
          fallback = { candidate, score: jittered, cost: simulated.purchaseCop, sirve: sirveReserva };
        }
        if (!cabeEnTiempo) {
          if (
            !quickest ||
            candidate.recipe.minutes < quickest.candidate.recipe.minutes ||
            (candidate.recipe.minutes === quickest.candidate.recipe.minutes &&
              jittered > quickest.score)
          ) {
            quickest = { candidate, score: jittered };
          }
        }
        // Se anotan las dos reservas por separado: una receta puede fallar el
        // tiempo Y el piso a la vez, y antes la primera comprobación se la
        // tragaba, así que el plan servía una comida corta contándola como
        // "se pasó de tiempo".
        if (!alcanzaPiso) {
          const mejorQueLaGuardada =
            !heartiest ||
            (cabeEnTiempo && !heartiest.cabe) ||
            (cabeEnTiempo === heartiest.cabe &&
              candidate.nutrition.kcal > heartiest.candidate.nutrition.kcal);
          if (mejorQueLaGuardada) heartiest = { candidate, score: jittered, cabe: cabeEnTiempo };
        }
        if (!cabeEnTiempo || !alcanzaPiso) continue;
        if (pressure > 0 && simulated.purchaseCop > costCap) continue;
        if (!chosen || jittered > chosen.score) chosen = { candidate, score: jittered };
      }

      // Si los topes dejaron fuera a todas, se toma la mejor alternativa posible
      // en vez de dejar la comida sin planificar: la más sustanciosa, luego la
      // más rápida entre las que se pasaron de tiempo, y si no, la más barata.
      // Orden de renuncias, de la que menos cuesta a la que más:
      //   1. la mejor que cumple todo;
      //   2. una que cumple tiempo y piso pero se pasa del tope de gasto de
      //      esta comida — el tope es una preferencia, el piso no;
      //   3. repetir un plato de ayer o del mes que sí cumple los dos límites;
      //   4. la más sustanciosa aunque no llegue al piso;
      //   5. la más rápida aunque no quepa en el tiempo;
      //   6. lo que haya.
      // Comer de menos es peor que comer dos veces lo mismo, y por eso repetir
      // va antes que quedarse corto. Pero repetir NO va antes que servir un
      // plato distinto que solo era un poco caro.
      const caraPeroCompleta = fallback?.sirve ? fallback.candidate : undefined;
      const repetirCompleta = menosUsada?.sirve ? menosUsada.candidate : undefined;
      const winner =
        chosen?.candidate ??
        caraPeroCompleta ??
        repetirCompleta ??
        heartiest?.candidate ??
        quickest?.candidate ??
        fallback?.candidate ??
        menosUsada?.candidate;
      if (!winner) {
        mealIndex++;
        continue;
      }
      // Los diagnósticos se miden sobre lo que de verdad se sirvió, no sobre la
      // rama por la que se llegó: son dos condiciones independientes y una
      // comida puede incumplir las dos.
      if (winner.nutrition.kcal < floor.kcal || winner.nutrition.proteinG < floor.proteinG) {
        belowFloorMeals++;
      }
      if (timeLimit !== null && winner.recipe.minutes > timeLimit) overTimeMeals++;

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
        // Solo los cambios que de verdad están en el plato: se avisa de lo que
        // se va a cocinar, no de lo que el catálogo consideró.
        substitutions: (cambiosPorReceta.get(winner.recipe.id) ?? []).filter((cambio) =>
          costed.lines.some((line) => line.ingredientId === cambio.toIngredientId),
        ),
        nutrition: {
          kcal: Math.round(winner.nutrition.kcal),
          proteinG: round(winner.nutrition.proteinG, 1),
          carbsG: round(winner.nutrition.carbsG, 1),
          fatG: round(winner.nutrition.fatG, 1),
          fiberG: round(winner.nutrition.fiberG ?? 0, 1),
          isEstimated: true,
        },
        status: "planned",
      });

      consumedToday = addNutrition(consumedToday, winner.nutrition);
      esperadoHastaAhora += target.kcal;
      totalKcal += winner.nutrition.kcal;
      lastUsedAt.set(winner.recipe.id, mealIndex);
      useCount.set(winner.recipe.id, (useCount.get(winner.recipe.id) ?? 0) + 1);
      useInWindow.set(winner.recipe.id, (useInWindow.get(winner.recipe.id) ?? 0) + 1);
      usedToday.add(winner.recipe.id);
      ultimoDia.set(winner.recipe.id, day);
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
    overTimeMeals,
    belowFloorMeals,
    kcalPerPersonPerDay:
      meals.length === 0 || headcount === 0
        ? null
        : Math.round(totalKcal / household.days / headcount),
  };
}

/** ¿La receta, ya escalada al hogar, alcanza el mínimo del horario? */
function cumpleFloor(candidate: Candidate, floor: { kcal: number; proteinG: number }): boolean {
  return candidate.nutrition.kcal >= floor.kcal && candidate.nutrition.proteinG >= floor.proteinG;
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
  /** Minutos disponibles para cocinar esta comida. `null` = sin límite. */
  timeLimit: number | null;
  /** Dificultad máxima aceptable este día. `null` = cualquiera. */
  difficultyCap: Difficulty | null;
  /** Meta de energía y proteína de este horario, para el hogar. */
  target: { kcal: number; proteinG: number };
  /** Energía que el día lleva de retraso respecto a lo esperado. */
  kcalDebt: number;
  mealIndex: number;
  varietyWindow: number;
  lastUsedAt: Map<string, number>;
  useCount: Map<string, number>;
  inPlay: Set<string>;
  eaters: number;
  slotsPerDay: number;
  consumedToday: ReturnType<typeof zeroNutrition>;
  /** Preferencia de cocina por tandas, o `null` si está apagada. */
  mealPrep: MealPrepPreference | null;
  /** Veces que cada receta ya salió en la ventana de cocina actual. */
  useInWindow: ReadonlyMap<string, number>;
  /** Recetas ya servidas hoy. */
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
  // En modo tandas cada receta se usa `batchSize` veces por semana a
  // propósito, así que el cupo total se multiplica igual: si no, la primera
  // tanda agotaría el cupo y el mes entero se resolvería con cuatro recetas.
  const batchFactor = args.mealPrep ? Math.max(1, args.mealPrep.batchSize) : 1;
  const maxRepeats =
    Math.max(2, Math.ceil(args.totalMeals / Math.max(1, args.distinctCandidates))) * batchFactor;
  const repeatScore = clamp01(1 - (args.useCount.get(candidate.recipe.id) ?? 0) / maxRepeats);
  let varietyScore: number;
  if (args.mealPrep) {
    // En modo "cocinar por adelantado" la lógica se INVIERTE dentro de la
    // semana: repetir un plato es exactamente lo que hace que la tanda valga la
    // pena. Se premia completar una tanda ya empezada y, una vez completa, se
    // pasa a otra receta. La variedad se conserva ENTRE semanas, no dentro.
    const enVentana = args.useInWindow.get(candidate.recipe.id) ?? 0;
    const cupo = Math.max(1, args.mealPrep.batchSize);
    // Abrir una tanda nueva: se sigue premiando la variedad ENTRE semanas, para
    // que el mes no se resuelva con cuatro recetas repetidas sin parar.
    if (enVentana === 0) varietyScore = (0.4 + 0.6 * recency) * repeatScore;
    else if (enVentana < cupo) varietyScore = 1;
    else varietyScore = 0.05;
    // Cocinar una vez y comerlo tres días es el punto. Comerlo de almuerzo y
    // otra vez de cena el MISMO día no: eso no ahorra una olla, solo cansa.
  } else {
    varietyScore = 0.65 * recency + 0.35 * repeatScore;
    // Repetir el mismo plato con menos de dos días de diferencia hunde la
    // puntuación: sin esto, el plato más barato del catálogo se apodera de un
    // horario completo y el mes entero sabe igual.
    if (lastUsed !== undefined && args.mealIndex - lastUsed < args.slotsPerDay * 2) {
      varietyScore *= REPEAT_DAMPING;
    }
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

  // 5. Nutrición: qué tanto cubre lo que le FALTA al día, no una fracción fija.
  // Si el desayuno salió liviano, el almuerzo tiene que compensar.
  const nutrition = candidate.nutrition;
  const nutritionScore = dayFitScore(
    nutrition,
    args.target.kcal,
    args.target.proteinG,
    args.kcalDebt,
  );

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

  // 8. Tiempo: caber holgado en los minutos que hay para cocinar ese día.
  //
  // Un martes con 25 minutos no es el día del sancocho. Se premia lo que cabe
  // con margen; pasarse cae a cero, y una receta más exigente de lo que el
  // hogar quiere manejar entre semana pierde terreno aunque quepa en tiempo.
  const timeScore = scoreTime(candidate.recipe, args.timeLimit, args.difficultyCap);

  let score =
    weights.budget * budgetScore +
    weights.inventory * inventoryScore +
    weights.variety * varietyScore +
    weights.time * timeScore +
    weights.waste * wasteScore +
    weights.nutrition * nutritionScore +
    weights.reuse * reuseScore +
    weights.expiry * expiryScore;

  // Cocinar por adelantado algo que solo sirve recién hecho no tiene sentido.
  // No se prohíbe (un desayuno de huevo tiene que poder salir igual): se hunde.
  if (args.mealPrep && !candidate.recipe.prep.batchFriendly) score *= 0.5;

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

/**
 * Minutos disponibles para una comida concreta.
 *
 * `null` significa "sin límite", que es como se comporta un hogar que no
 * declaró tiempos — exactamente igual que antes de que existiera esta función.
 */
export function minutesAvailable(
  budget: CookingTimeBudget | undefined,
  date: IsoDate,
  slot: MealSlot,
): number | null {
  if (!budget) return null;
  const day = dayOfWeek(date);
  const isWeekend = day === 0 || day === 6;
  const table = isWeekend ? budget.weekend : budget.weekday;
  const minutes = table[slot];
  return typeof minutes === "number" && minutes > 0 ? minutes : null;
}

/** Dificultad máxima aceptable ese día. El fin de semana no se limita. */
export function maxDifficultyFor(
  budget: CookingTimeBudget | undefined,
  date: IsoDate,
): Difficulty | null {
  if (!budget) return null;
  const day = dayOfWeek(date);
  if (day === 0 || day === 6) return null;
  return budget.maxWeekdayDifficulty;
}

function scoreTime(
  recipe: Recipe,
  timeLimit: number | null,
  difficultyCap: Difficulty | null,
): number {
  let score = 1;

  if (timeLimit !== null) {
    if (recipe.minutes > timeLimit) return 0;
    // Dentro del límite, mejor cuanto más margen deje: a 20 de 30 minutos
    // queda holgura real para un martes.
    score = 0.6 + 0.4 * (1 - recipe.minutes / timeLimit);
  }

  if (difficultyCap !== null) {
    const over = DIFFICULTY_RANK[recipe.difficulty] - DIFFICULTY_RANK[difficultyCap];
    if (over > 0) score *= over >= 2 ? 0.2 : 0.45;
  }
  return clamp01(score);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
