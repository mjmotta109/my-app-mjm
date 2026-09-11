import type { CookingTimeBudget, MealSlot } from "@rinde/core";

/**
 * Presets de tiempo de cocina.
 *
 * Preguntar "¿cuántos minutos tienes para el almuerzo del martes?" es pedirle
 * al usuario que haga el trabajo de diseño. Se pregunta cómo es su vida y de
 * ahí salen los minutos, que después se pueden ajustar uno por uno.
 */

export interface TimePreset {
  id: string;
  label: string;
  description: string;
  budget: CookingTimeBudget;
}

export const TIME_PRESETS: TimePreset[] = [
  {
    id: "corriendo",
    label: "Siempre corriendo",
    description: "Entre semana, lo mínimo. El fin de semana tampoco mucho.",
    budget: {
      weekday: { desayuno: 10, almuerzo: 25, cena: 20, snack: 10 },
      weekend: { desayuno: 25, almuerzo: 45, cena: 30, snack: 15 },
      maxWeekdayDifficulty: "facil",
    },
  },
  {
    id: "normal",
    label: "Normal",
    description: "Algo de tiempo entre semana y más el fin de semana.",
    budget: {
      weekday: { desayuno: 15, almuerzo: 40, cena: 30, snack: 15 },
      weekend: { desayuno: 40, almuerzo: 90, cena: 45, snack: 20 },
      maxWeekdayDifficulty: "media",
    },
  },
  {
    id: "me_gusta_cocinar",
    label: "Me gusta cocinar",
    description: "Hay tiempo y ganas casi todos los días.",
    budget: {
      weekday: { desayuno: 25, almuerzo: 60, cena: 45, snack: 20 },
      weekend: { desayuno: 60, almuerzo: 120, cena: 90, snack: 30 },
      maxWeekdayDifficulty: "dificil",
    },
  },
];

export const SIN_LIMITE_ID = "sin_limite";

export const SLOT_ORDER: MealSlot[] = ["desayuno", "almuerzo", "cena", "snack"];

/** Identifica a cuál preset corresponde un presupuesto, o `null` si es a medida. */
export function matchPreset(budget: CookingTimeBudget | undefined): string {
  if (!budget) return SIN_LIMITE_ID;
  const found = TIME_PRESETS.find(
    (preset) => JSON.stringify(preset.budget) === JSON.stringify(budget),
  );
  return found?.id ?? "a_medida";
}
