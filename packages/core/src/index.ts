/**
 * @rinde/core — motor determinista de Rinde.
 *
 * Reglas del paquete, sin excepciones:
 *   · Cero dependencias externas.
 *   · Cero I/O: no lee archivos, no llama a la red, no toca una base de datos.
 *   · No lee el reloj: la fecha "hoy" siempre se pasa como argumento.
 *   · No usa `Math.random()`: la variedad viene de una semilla guardada.
 *   · Todo el dinero es un entero de COP.
 *   · Ningún LLM. La IA vive fuera y sus salidas se validan aquí.
 *
 * El resultado es que el mismo input produce siempre el mismo plan, en el
 * navegador y en el servidor, y que los tests dicen la verdad.
 */

export * from "./types.js";

export {
  cop, isCop, assertCop, sumCop, splitEvenly, allocate, percentChange, formatCop, MoneyError,
} from "./money.js";

export {
  addDays, daysBetween, dayOfWeek, weekdayName, monthName, formatDayShort, formatDayLong,
  isoWeek, startOfWeek, assertIsoDate, DateError,
} from "./dates.js";

export {
  toBase, fromBase, humanize, roundForDisplay, roundUpToStep, round, formatQuantity,
  dimensionOf, baseUnitOf, UnitError,
} from "./units.js";

export {
  scaleRecipe, eaterEquivalents, DEFAULT_CHILD_FACTOR,
  type ScaledLine, type ScaleResult,
} from "./scaling.js";

export {
  PriceIndex, normalizePrice, STALE_AFTER_DAYS, PricingError,
} from "./pricing.js";

export {
  costMeal, breakdown, averageCostPerMealPerPerson,
  type CostedMeal, type CostMealOptions,
} from "./costing.js";

export {
  VirtualPantry, planPurchase, expiryUrgency, expiringSoon,
  type TakeResult, type PurchasePlan, type ExpiryUrgency,
} from "./inventory.js";

export {
  nutritionOfScaled, baseToGrams, dayFitScore, addNutrition, zeroNutrition,
  DAILY_REFERENCE, EMPTY_NUTRITION, type NutritionTotals,
} from "./nutrition.js";

export {
  generateMealPlan, purchaseTotalOf, minutesAvailable, maxDifficultyFor,
  DEFAULT_WEIGHTS, PLANNER_VERSION,
  type PlanRequest, type ScoringWeights,
} from "./planner.js";

export {
  personEnergyNeeds, householdNeeds, restingEnergy, perMealTargets,
  MIFFLIN_ST_JEOR, ACTIVITY_FACTORS, ACTIVITY_LABELS, GOAL_ADJUSTMENT, GOAL_LABELS,
  PROTEIN_G_PER_KG, KCAL_FLOOR, FIBER_TARGET_G, GENERIC_ADULT, CHILD_ENERGY_FACTOR,
  NUTRITION_DISCLAIMER_SHORT, mealFloor, mealTarget, MEAL_MIN_SHARE, MEAL_TARGET_SHARE,
  type EnergyNeeds, type HouseholdNeeds, type ProteinRange, type MealFloor,
} from "./nutrition-needs.js";

export {
  planMealPrep, cookBatch, storageLabel, sessionIngredients,
  FREEZER_DAYS, BATCH_MARGINAL_TIME,
  type MealPrepPlan, type MealPrepOptions, type PrepBatch, type PrepSession,
  type FreshMeal, type Storage, type CookBatchResult,
} from "./meal-prep.js";

export {
  buildShoppingList, cycleCount, toggleChecked, pendingTotal, DEFAULT_CYCLE_DAYS,
  type ShoppingListOptions,
} from "./shopping.js";

export {
  cookMeal, consumeFromInventory, detectLeftovers, suggestLeftoverUses,
  type CookResult, type ConsumeResult, type LeftoverSuggestion,
} from "./cooking.js";

export {
  whatCanICook, type CookableRecipe, type WhatCanICookOptions,
} from "./what-can-i-cook.js";

export {
  rindeMas, averageGramsPerMeal,
  type RindeMasOption, type RindeMasOptionId, type RindeMasItem,
} from "./rinde-mas.js";

export {
  suggestForRecipe, substituteExpensive, evaluateSubstitution, equivalentQuantity, defineLaIdentidad,
  type SubstitutionSuggestion, type SubstitutionBasis, type SuggestOptions,
} from "./substitutions.js";

export {
  weeklyPriceUpdate, validateObservations, parsePriceCsv, describeChange,
  type PriceObservation, type PriceProvider, type WeeklyUpdateInput,
  type WeeklyUpdateResult, type ValidationResult,
} from "./price-update.js";

export { parseCsv, parseCsvRecords, CsvError } from "./csv.js";

export {
  parsePantryText, buildLexicon, normalizeText, validateParsedItems,
  type ParsedItem, type ParseResult,
} from "./nl-parse.js";

export { can, maxPlanDays, FEATURE_LABELS, type Tier, type Feature } from "./entitlements.js";

export { mulberry32, seedFrom } from "./random.js";
