/**
 * Tipos del dominio de Rinde.
 *
 * Regla del paquete: TODO el dinero es un entero de pesos colombianos (COP).
 * No hay `float` en ningún cálculo monetario. Ver `money.ts`.
 */

// ---------------------------------------------------------------------------
// Dinero y tiempo
// ---------------------------------------------------------------------------

/** Pesos colombianos, entero. Nunca decimales. */
export type Cop = number;

/** Fecha civil `YYYY-MM-DD`. Se pasa como dato; el motor nunca lee el reloj. */
export type IsoDate = string;

/** Semana ISO `YYYY-Www`, p. ej. `2026-W37`. */
export type IsoWeek = string;

// ---------------------------------------------------------------------------
// Unidades
// ---------------------------------------------------------------------------

export type Dimension = "mass" | "volume" | "count";

/** Unidad base canónica de cada dimensión. */
export type BaseUnit = "g" | "ml" | "unit";

/**
 * Unidades que el usuario puede escribir o ver.
 * `cda` = cucharada, `cdta` = cucharadita.
 */
export type Unit =
  | "g"
  | "kg"
  | "mg"
  | "ml"
  | "l"
  | "unit"
  | "taza"
  | "cda"
  | "cdta"
  | "pizca";

export interface Quantity {
  qty: number;
  unit: Unit;
}

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

export type CategoryId =
  | "proteinas"
  | "granos"
  | "verduras"
  | "frutas"
  | "lacteos"
  | "abarrotes"
  | "condimentos"
  | "bebidas";

export interface FoodCategory {
  id: CategoryId;
  name: string;
  /** Orden en que se recorre el mercado. Menor primero. */
  order: number;
}

export type IngredientTag =
  | "proteina"
  | "proteina_vegetal"
  | "grano"
  | "tuberculo"
  | "verdura"
  | "fruta"
  | "lacteo"
  | "grasa"
  | "condimento"
  | "basico";

/** Cómo se redondea una cantidad al presentarla o al comprarla. */
export type RoundingMode = "discrete" | "continuous";

export interface Nutrition {
  /** kcal por 100 g de producto. */
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG?: number;
}

/** Formato en que el producto se vende realmente. */
export interface PackSize {
  qty: number;
  unit: Unit;
  /** Etiqueta para la lista de mercado, p. ej. "libra", "bolsa 500 g". */
  label?: string;
}

export interface Ingredient {
  id: string;
  name: string;
  categoryId: CategoryId;
  baseUnit: BaseUnit;
  /** Gramos que pesa una unidad. Necesario para convertir `unit` ↔ `g`. */
  gramsPerUnit?: number;
  /** Densidad: gramos por ml. Necesario para convertir `ml` ↔ `g`. */
  gramsPerMl?: number;
  rounding: RoundingMode;
  /** Paso de redondeo, expresado en `baseUnit`. */
  roundingStep: number;
  packSizes: PackSize[];
  perishable: boolean;
  shelfLifeDays?: number;
  tags: IngredientTag[];
  /**
   * Nutrición por **100 g de producto**, siempre — no por unidad base.
   * Para ingredientes con base `unit` o `ml` se convierte con `gramsPerUnit`
   * / `gramsPerMl`. Unificar el denominador evita comparar peras con litros.
   */
  nutrition?: Nutrition;
  /** De dónde salió el dato nutricional. Obligatorio si hay `nutrition`. */
  nutritionSource?: string;
  /** `true` si el valor es una estimación y no una medición referenciada. */
  nutritionIsEstimated: boolean;
  /** Ingredientes que pueden reemplazarlo, en orden de preferencia. */
  substitutes?: string[];
  /** Nombres alternativos con que la gente lo escribe. Para búsqueda y NLP. */
  synonyms?: string[];
}

// ---------------------------------------------------------------------------
// Precios
// ---------------------------------------------------------------------------

export type PriceConfidence = "measured" | "reported" | "estimated";
export type PriceSourceType =
  | "api"
  | "csv"
  | "manual"
  | "public"
  | "commercial"
  | "index"
  | "demo";

export interface PriceSource {
  id: string;
  name: string;
  type: PriceSourceType;
  url?: string;
  license?: string;
  requiresAttribution: boolean;
  notes?: string;
}

export interface Store {
  id: string;
  name: string;
  city: string;
  type: "plaza" | "supermercado" | "tienda" | "mayorista";
}

/**
 * Una observación de precio. Nunca existe sin `sourceId` y `observedOn`.
 * `isDemo` marca los datos de demostración; jamás se mezclan con datos reales.
 */
export interface IngredientPrice {
  id: string;
  ingredientId: string;
  /** Precio en COP por `quantity` `unit`. */
  priceCop: Cop;
  quantity: number;
  unit: Unit;
  city: string;
  storeId?: string;
  sourceId: string;
  observedOn: IsoDate;
  confidence: PriceConfidence;
  isDemo: boolean;
}

/** Precio ya normalizado a la unidad base del ingrediente. */
export interface UnitPrice {
  ingredientId: string;
  /** COP por unidad base (por g, por ml o por unidad). Puede ser fraccionario. */
  copPerBaseUnit: number;
  baseUnit: BaseUnit;
  confidence: PriceConfidence;
  isDemo: boolean;
  sourceId: string;
  observedOn: IsoDate;
  /** Días transcurridos entre `observedOn` y la fecha de referencia. */
  ageDays: number;
  /** `true` si se degradó a `estimated` por antigüedad. */
  degraded: boolean;
}

export interface PriceHistoryEntry {
  ingredientId: string;
  week: IsoWeek;
  copPerBaseUnit: number;
  city: string;
}

export interface PriceChange {
  ingredientId: string;
  previousCopPerBaseUnit: number;
  currentCopPerBaseUnit: number;
  /** Variación porcentual redondeada a un decimal. */
  changePct: number;
  direction: "up" | "down" | "flat";
}

export interface PriceUpdateReport {
  week: IsoWeek;
  sourceId: string;
  accepted: number;
  rejected: number;
  changes: PriceChange[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// Recetas
// ---------------------------------------------------------------------------

export type MealSlot = "desayuno" | "almuerzo" | "cena" | "snack";
export type Difficulty = "facil" | "media" | "dificil";
export type DietTag =
  | "vegetariano"
  | "vegano"
  | "sin_gluten"
  | "sin_lactosa"
  | "economico"
  | "alto_proteina";

export interface RecipeIngredient {
  ingredientId: string;
  qty: number;
  unit: Unit;
  optional?: boolean;
  /** Ingredientes que este puede aceptar como reemplazo en esta receta. */
  allowedSubstitutes?: string[];
}

export interface Recipe {
  id: string;
  name: string;
  description: string;
  /** Porciones que rinde la receta tal como está escrita. */
  baseServings: number;
  slots: MealSlot[];
  minutes: number;
  difficulty: Difficulty;
  region: string;
  tags: DietTag[];
  ingredients: RecipeIngredient[];
  steps: string[];
  /** `true` mientras la nutrición se calcule sumando ingredientes. */
  nutritionIsEstimated: boolean;
}

// ---------------------------------------------------------------------------
// Hogar, preferencias, inventario
// ---------------------------------------------------------------------------

export type PreferenceKind = "dislike" | "allergy" | "diet";

export interface UserPreference {
  kind: PreferenceKind;
  /** `ingredientId` para dislike/allergy, `DietTag` para diet. */
  value: string;
  severity: "soft" | "hard";
}

export interface Household {
  id: string;
  adults: number;
  children: number;
  budgetCop: Cop;
  city: string;
  slots: MealSlot[];
  days: number;
  preferences: UserPreference[];
  tier: "free" | "premium";
  createdOn: IsoDate;
}

export interface InventoryItem {
  id: string;
  ingredientId: string;
  /** Cantidad en la unidad base del ingrediente. */
  qtyBase: number;
  expiresOn?: IsoDate;
  /** Lo que costó, si se sabe. Solo informativo. */
  referencePriceCop?: Cop;
  updatedOn: IsoDate;
}

export interface Leftover {
  id: string;
  ingredientId: string;
  qtyBase: number;
  fromMealId: string;
  createdOn: IsoDate;
  expiresOn?: IsoDate;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export type MealStatus = "planned" | "cooked" | "skipped";

/** Una línea de ingrediente ya escalada al hogar, con su costo. */
export interface CostedIngredientLine {
  ingredientId: string;
  /** Cantidad necesaria, en unidad base, ya redondeada para presentación. */
  qtyBase: number;
  /** Cantidad cubierta por lo que ya había (despensa o sobras). */
  fromInventoryBase: number;
  /** Cantidad que hay que comprar. */
  toBuyBase: number;
  /** Valor total de la línea a precio de referencia. `null` si no hay precio. */
  valueCop: Cop | null;
  priceConfidence: PriceConfidence | null;
  priceIsDemo: boolean;
}

export interface Meal {
  id: string;
  date: IsoDate;
  slot: MealSlot;
  recipeId: string;
  /** Porciones cocinadas (equivale a los comensales del hogar). */
  servings: number;
  lines: CostedIngredientLine[];
  /** Valor total de los ingredientes de la comida. */
  costCop: Cop;
  /** Costo por persona. La suma de las partes es exactamente `costCop`. */
  costPerPersonCop: Cop;
  /** `true` si algún ingrediente no tenía precio y el costo está incompleto. */
  costIncomplete: boolean;
  status: MealStatus;
}

export interface MealPlan {
  id: string;
  householdId: string;
  startDate: IsoDate;
  days: number;
  budgetCop: Cop;
  /** Costo de lo que hay que COMPRAR. Es lo que se compara con el presupuesto. */
  projectedSpendCop: Cop;
  /** Valor total de la comida del mes, incluyendo lo que ya se tenía. */
  totalFoodValueCop: Cop;
  meals: Meal[];
  /** Ingredientes sin precio que dejaron el costo incompleto. */
  unpricedIngredientIds: string[];
  /**
   * Requerimiento neto consolidado del plan completo: lo que hay que comprar
   * de cada ingrediente, ya descontado el inventario. De aquí sale la lista de
   * mercado. Consolidar aquí (y no comida a comida) es lo que evita comprar el
   * mismo ingrediente tres veces.
   */
  netRequirements: { ingredientId: string; qtyBase: number }[];
  /** Lo que quedará en la despensa al terminar el plan. */
  pantryLeftovers: { ingredientId: string; qtyBase: number }[];
  /** Versión del algoritmo que generó este plan. */
  plannerVersion: string;
  seed: number;
  /** Diagnóstico honesto de lo que el planificador logró y lo que no. */
  diagnostics: PlanDiagnostics;
}

export interface PlanDiagnostics {
  /** SIEMPRE `"heuristic"` en el MVP. Nunca se afirma optimalidad global. */
  method: "heuristic";
  withinBudget: boolean;
  /** Cuánto sobra (positivo) o cuánto falta (negativo). */
  budgetDeltaCop: Cop;
  mealsPlanned: number;
  mealsRequested: number;
  distinctRecipes: number;
  /** Pasos de reparación ejecutados para intentar caber en el presupuesto. */
  repairSteps: string[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Mercado
// ---------------------------------------------------------------------------

export interface ShoppingListItem {
  ingredientId: string;
  /** Cantidad neta que el plan necesita comprar, en unidad base. */
  neededBase: number;
  /** Cantidad que realmente se compra según formatos de venta. */
  purchaseBase: number;
  /** Presentación legible: `{ qty: 2, unit: "kg" }`. */
  display: Quantity;
  packLabel?: string;
  /** Costo de la compra. `null` si no hay precio para el ingrediente. */
  lineCostCop: Cop | null;
  priceConfidence: PriceConfidence | null;
  priceIsDemo: boolean;
  categoryId: CategoryId;
  /** Sobrante que quedará tras cubrir el plan (por comprar por formato). */
  surplusBase: number;
  checked: boolean;
}

export interface ShoppingListGroup {
  categoryId: CategoryId;
  categoryName: string;
  items: ShoppingListItem[];
  /** Suma de las líneas con precio. */
  subtotalCop: Cop;
}

export interface ShoppingList {
  planId: string;
  cycle: number;
  groups: ShoppingListGroup[];
  totalCop: Cop;
  /** Ingredientes en la lista que no tienen precio. */
  unpricedIngredientIds: string[];
  containsDemoPrices: boolean;
}
