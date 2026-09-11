import type {
  Cop, CostedIngredientLine, Difficulty, Ingredient, InventoryItem, IsoDate,
  Meal, MealPlan, MealSlot, Recipe,
} from "./types.js";
import { addDays, daysBetween, formatDayShort } from "./dates.js";
import { consumeFromInventory, type ConsumeResult } from "./cooking.js";
import { round } from "./units.js";

/**
 * Cocinar por adelantado (meal prep).
 *
 * La idea: en vez de cocinar 21 veces a la semana, cocinar dos o tres veces y
 * dejar la comida lista. Rinde agrupa las comidas del plan que usan la MISMA
 * receta dentro de una ventana, las convierte en una sola tanda, y dice qué
 * día cocinarla, cuánto rinde, cómo guardarla y hasta cuándo aguanta.
 *
 * Lo que NO hace, a propósito:
 *
 *   · No agrupa lo que no aguanta guardado. Un huevo frito y un patacón no se
 *     cocinan el domingo para el jueves; esas comidas se marcan como "al
 *     momento" con la razón, en vez de meterlas a la fuerza.
 *   · No estira la conservación. Si una comida cae más allá de lo que la
 *     receta aguanta en nevera, o va al congelador —cuando la receta lo
 *     admite— o se cocina fresca. No se inventan días de vida útil.
 *
 * Los días de conservación (`Recipe.prep.keepsDays`) son valores prudentes de
 * manejo doméstico, no un análisis microbiológico. Ver `docs/NUTRICION.md`.
 */

/** Días que se asume que aguanta una preparación congelada. Valor prudente. */
export const FREEZER_DAYS = 30;

/**
 * Cuánto tiempo extra cuesta cada porción adicional dentro de una misma tanda,
 * como fracción del tiempo de la receta.
 *
 * SUPUESTO EXPLÍCITO: cocinar el doble no toma el doble de tiempo (se pica una
 * vez, se lava una olla), pero tampoco es gratis. Se asume un 15% del tiempo de
 * la receta por cada porción-comida adicional. Es una convención declarada, no
 * una medición.
 */
export const BATCH_MARGINAL_TIME = 0.15;

export type Storage = "nevera" | "congelador";

export interface PrepBatch {
  id: string;
  recipeId: string;
  recipeName: string;
  /** Comidas del plan que esta tanda deja resueltas. */
  mealIds: string[];
  /** Fechas de esas comidas, para mostrar "cubre martes y jueves". */
  covers: { mealId: string; date: IsoDate; slot: MealSlot; label: string }[];
  /** Porciones totales a cocinar de una sola vez. */
  servings: number;
  /** Minutos activos estimados de la tanda completa. */
  minutes: number;
  difficulty: Difficulty;
  lines: CostedIngredientLine[];
  costCop: Cop;
  storage: Storage;
  keepsDays: number;
  /** Último día en que conviene consumirla. */
  eatBy: IsoDate;
  /** Qué porciones de la tanda hay que congelar, si alguna. */
  freezeNote?: string;
  finishNote?: string;
}

export interface PrepSession {
  date: IsoDate;
  label: string;
  batches: PrepBatch[];
  /** Minutos activos de toda la jornada de cocina. */
  activeMinutes: number;
  costCop: Cop;
}

export interface FreshMeal {
  mealId: string;
  date: IsoDate;
  slot: MealSlot;
  recipeId: string;
  recipeName: string;
  minutes: number;
  /** Por qué esta comida no se puede adelantar. */
  reason: string;
}

export interface MealPrepPlan {
  planId: string;
  from: IsoDate;
  to: IsoDate;
  sessions: PrepSession[];
  cookFresh: FreshMeal[];
  batchedMealCount: number;
  totalMealCount: number;
  /** Minutos de cocina si se cocinara comida por comida. */
  minutesIfCookedDaily: number;
  /** Minutos de cocina adelantando lo que se puede. */
  minutesWithPrep: number;
  /** Diferencia entre los dos anteriores. Puede ser 0. */
  minutesSaved: number;
  notes: string[];
}

export interface MealPrepOptions {
  /** Primer día de la ventana. Por defecto, el inicio del plan. */
  from?: IsoDate;
  /** Días que cubre la sesión de prep. Por defecto 7. */
  days?: number;
  /**
   * Días de cocina, como desplazamiento desde `from`. Por defecto `[0, 3]`:
   * una jornada el domingo y un refuerzo a mitad de semana, que es lo que hace
   * viable una semana entera sin comer nada de cuatro días.
   */
  sessionOffsets?: number[];
}

export function planMealPrep(
  plan: MealPlan,
  recipes: ReadonlyMap<string, Recipe>,
  options: MealPrepOptions = {},
): MealPrepPlan {
  const from = options.from ?? plan.startDate;
  const days = options.days ?? 7;
  const to = addDays(from, days - 1);
  const offsets = (options.sessionOffsets ?? [0, 3])
    .filter((offset) => offset >= 0 && offset < days)
    .sort((a, b) => a - b);
  const sessionDates = offsets.map((offset) => addDays(from, offset));

  const meals = plan.meals.filter((meal) => meal.date >= from && meal.date <= to);
  const cookFresh: FreshMeal[] = [];
  // Clave: receta + día de cocina. El almacenamiento NO entra en la clave:
  // nadie cocina el mismo plato dos veces el mismo día porque una porción vaya
  // a la nevera y otra al congelador. Se cocina una vez y se guarda distinto.
  const buckets = new Map<string, { recipe: Recipe; date: IsoDate; meals: Meal[] }>();

  for (const meal of meals) {
    const recipe = recipes.get(meal.recipeId);
    if (!recipe) {
      cookFresh.push(freshFrom(meal, recipe, "No encontramos la receta en el catálogo."));
      continue;
    }
    if (!recipe.prep.batchFriendly) {
      cookFresh.push(
        freshFrom(meal, recipe, recipe.prep.finishNote ?? "Esta receta solo queda bien recién hecha."),
      );
      continue;
    }

    const assignment = assignSession(meal.date, sessionDates, recipe);
    if (!assignment) {
      cookFresh.push(
        freshFrom(
          meal,
          recipe,
          `No aguanta desde ningún día de cocina: se conserva ${recipe.prep.keepsDays} días` +
            (recipe.prep.freezable ? "" : " y no se puede congelar") + ".",
        ),
      );
      continue;
    }

    const key = `${recipe.id}|${assignment.date}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.meals.push(meal);
    else buckets.set(key, { recipe, date: assignment.date, meals: [meal] });
  }

  const sessions: PrepSession[] = sessionDates.map((date) => ({
    date,
    label: formatDayShort(date),
    batches: [],
    activeMinutes: 0,
    costCop: 0,
  }));
  const byDate = new Map(sessions.map((session) => [session.date, session]));

  for (const [key, bucket] of [...buckets.entries()].sort()) {
    const batch = buildBatch(key, bucket);
    const session = byDate.get(bucket.date);
    if (!session) continue;
    session.batches.push(batch);
    session.activeMinutes += batch.minutes;
    session.costCop += batch.costCop;
  }

  // Lo que más tarda va primero: mientras el fríjol hierve, se pica lo demás.
  for (const session of sessions) {
    session.batches.sort((a, b) => b.minutes - a.minutes || (a.recipeId < b.recipeId ? -1 : 1));
  }

  const batched = sessions.flatMap((session) => session.batches);
  const batchedMealCount = batched.reduce((total, batch) => total + batch.mealIds.length, 0);

  const minutesIfCookedDaily = meals.reduce(
    (total, meal) => total + (recipes.get(meal.recipeId)?.minutes ?? 0),
    0,
  );
  const minutesWithPrep =
    batched.reduce((total, batch) => total + batch.minutes, 0) +
    cookFresh.reduce((total, meal) => total + meal.minutes, 0);

  const notes: string[] = [];
  if (cookFresh.length > 0) {
    notes.push(
      `${cookFresh.length} comida(s) no se pueden adelantar y quedan para hacer al momento.`,
    );
  }
  if (batched.some((batch) => batch.storage === "congelador")) {
    notes.push("Algunas tandas van al congelador: sácalas la noche anterior.");
  }
  notes.push(
    "Los días de conservación son valores prudentes de manejo doméstico. Ante la duda, huele, " +
      "mira y decide tú: no son un análisis de laboratorio.",
  );

  return {
    planId: plan.id,
    from,
    to,
    sessions: sessions.filter((session) => session.batches.length > 0),
    cookFresh: cookFresh.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    batchedMealCount,
    totalMealCount: meals.length,
    minutesIfCookedDaily,
    minutesWithPrep,
    minutesSaved: Math.max(0, minutesIfCookedDaily - minutesWithPrep),
    notes,
  };
}

// ---------------------------------------------------------------------------

/**
 * Elige el día de cocina para una comida.
 *
 * Se prefiere la jornada MÁS CERCANA anterior a la comida: cuanto menos tiempo
 * guardada, mejor. La nevera se prefiere al congelador.
 */
function assignSession(
  mealDate: IsoDate,
  sessionDates: readonly IsoDate[],
  recipe: Recipe,
): { date: IsoDate; storage: Storage } | null {
  const candidates = sessionDates.filter((date) => date <= mealDate);
  if (candidates.length === 0) return null;

  for (let i = candidates.length - 1; i >= 0; i--) {
    const date = candidates[i]!;
    // `keepsDays` cuenta el día de cocina como el primero: cocinar el lunes con
    // keepsDays 3 cubre lunes, martes y miércoles.
    if (daysBetween(date, mealDate) < recipe.prep.keepsDays) return { date, storage: "nevera" };
  }
  if (!recipe.prep.freezable) return null;

  for (let i = candidates.length - 1; i >= 0; i--) {
    const date = candidates[i]!;
    if (daysBetween(date, mealDate) < FREEZER_DAYS) return { date, storage: "congelador" };
  }
  return null;
}

function buildBatch(
  key: string,
  bucket: { recipe: Recipe; date: IsoDate; meals: Meal[] },
): PrepBatch {
  const { recipe, meals, date } = bucket;
  const sorted = [...meals].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // Las líneas se AGREGAN desde las comidas del plan, no se reescala la receta.
  // Así el costo de la tanda es exactamente la suma de lo que el plan ya
  // presupuestó, y no aparece un descuadre entre el plan y el meal prep.
  const byIngredient = new Map<string, CostedIngredientLine>();
  for (const meal of sorted) {
    for (const line of meal.lines) {
      const current = byIngredient.get(line.ingredientId);
      if (!current) {
        byIngredient.set(line.ingredientId, { ...line });
        continue;
      }
      byIngredient.set(line.ingredientId, {
        ...current,
        qtyBase: round(current.qtyBase + line.qtyBase, 4),
        fromInventoryBase: round(current.fromInventoryBase + line.fromInventoryBase, 4),
        toBuyBase: round(current.toBuyBase + line.toBuyBase, 4),
        valueCop:
          current.valueCop === null || line.valueCop === null
            ? null
            : current.valueCop + line.valueCop,
      });
    }
  }

  const lines = [...byIngredient.values()].sort((a, b) =>
    a.ingredientId < b.ingredientId ? -1 : 1,
  );
  const costCop = lines.reduce((total, line) => total + (line.valueCop ?? 0), 0);
  const servings = round(sorted.reduce((total, meal) => total + meal.servings, 0), 2);

  const extraPortions = Math.max(0, sorted.length - 1);
  const minutes = Math.round(recipe.minutes * (1 + extraPortions * BATCH_MARGINAL_TIME));

  // Las porciones que se comen dentro de la vida útil en nevera se quedan ahí;
  // las que caen después van al congelador. Se dice cuáles, en vez de aplicar
  // una sola etiqueta a toda la tanda.
  const fridgeLimit = addDays(date, recipe.prep.keepsDays - 1);
  const toFreeze = sorted.filter((meal) => meal.date > fridgeLimit);
  const storage: Storage = toFreeze.length > 0 ? "congelador" : "nevera";
  const keepsDays = storage === "congelador" ? FREEZER_DAYS : recipe.prep.keepsDays;
  const freezeNote =
    toFreeze.length > 0
      ? `Congela ${toFreeze.length} porción(es): las de ${toFreeze
          .map((meal) => formatDayShort(meal.date))
          .join(" y ")}.`
      : undefined;

  return {
    id: key.replace(/\|/g, "_"),
    recipeId: recipe.id,
    recipeName: recipe.name,
    mealIds: sorted.map((meal) => meal.id),
    covers: sorted.map((meal) => ({
      mealId: meal.id,
      date: meal.date,
      slot: meal.slot,
      label: formatDayShort(meal.date),
    })),
    servings,
    minutes,
    difficulty: recipe.difficulty,
    lines,
    costCop,
    storage,
    keepsDays,
    // Hasta cuándo hay que consumirla: la última comida que cubre, nunca más
    // allá de lo que la conservación permite.
    eatBy: minDate(sorted[sorted.length - 1]!.date, addDays(date, keepsDays - 1)),
    ...(freezeNote ? { freezeNote } : {}),
    ...(recipe.prep.finishNote ? { finishNote: recipe.prep.finishNote } : {}),
  };
}

function minDate(a: IsoDate, b: IsoDate): IsoDate {
  return a < b ? a : b;
}

function freshFrom(meal: Meal, recipe: Recipe | undefined, reason: string): FreshMeal {
  return {
    mealId: meal.id,
    date: meal.date,
    slot: meal.slot,
    recipeId: meal.recipeId,
    recipeName: recipe?.name ?? meal.recipeId,
    minutes: recipe?.minutes ?? 0,
    reason,
  };
}

// ---------------------------------------------------------------------------
// Ejecutar la tanda
// ---------------------------------------------------------------------------

export interface CookBatchResult extends ConsumeResult {
  batch: PrepBatch;
  /** Comidas que quedan marcadas como cocinadas de una sola vez. */
  cookedMealIds: string[];
}

/**
 * Cocinar una tanda: descuenta el inventario UNA vez por toda la tanda y deja
 * resueltas todas las comidas que cubre.
 *
 * Es el punto del meal prep: no se planea y ya, se ejecuta. Descontar comida
 * por comida después de haber cocinado todo junto descontaría de más.
 */
export function cookBatch(
  batch: PrepBatch,
  inventory: readonly InventoryItem[],
  asOf: IsoDate,
): CookBatchResult {
  const result = consumeFromInventory(batch.lines, inventory, asOf);
  return { ...result, batch, cookedMealIds: [...batch.mealIds] };
}

/** Texto de conservación listo para mostrar. */
export function storageLabel(batch: PrepBatch): string {
  const donde = batch.storage === "congelador" ? "Congelador" : "Nevera";
  return `${donde} · consumir antes del ${batch.eatBy}`;
}

/** Ingredientes de una jornada completa, para tener todo a mano antes de empezar. */
export function sessionIngredients(
  session: PrepSession,
  catalog: ReadonlyMap<string, Ingredient>,
): { ingredientId: string; name: string; qtyBase: number }[] {
  const totals = new Map<string, number>();
  for (const batch of session.batches) {
    for (const line of batch.lines) {
      totals.set(line.ingredientId, round((totals.get(line.ingredientId) ?? 0) + line.qtyBase, 4));
    }
  }
  return [...totals.entries()]
    .map(([ingredientId, qtyBase]) => ({
      ingredientId,
      name: catalog.get(ingredientId)?.name ?? ingredientId,
      qtyBase,
    }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}
