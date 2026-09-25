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

/**
 * Qué es la receta dentro de una comida.
 *
 * Existe porque sin esto el catálogo mezcla un sancocho con "arepa con
 * mantequilla", y el planificador —que busca ajustarse al presupuesto— elige lo
 * segundo. Una comida principal solo puede resolverse con un `plato`.
 */
export type RecipeKind = "plato" | "acompanamiento" | "bebida" | "snack";

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
  /** Cómo se comporta la receta al cocinarla por adelantado. */
  prep: PrepInfo;
  /**
   * Un `plato` se sostiene solo como comida. Lo demás acompaña, se bebe o se
   * pica entre comidas, y NO puede ocupar un desayuno, un almuerzo ni una cena.
   */
  kind: RecipeKind;
}

/**
 * Comportamiento de una receta en cocina por adelantado (meal prep).
 *
 * `keepsDays` son días de conservación EN NEVERA a partir del día que se
 * cocina, contando ese día como el primero. Son valores prudentes de manejo
 * doméstico, no un análisis microbiológico: ante la duda, menos días.
 */
export interface PrepInfo {
  /** `false` para lo que solo sirve recién hecho: fritos, huevos al momento. */
  batchFriendly: boolean;
  /** Días que aguanta en nevera, incluido el día en que se cocina. */
  keepsDays: number;
  freezable: boolean;
  /** Qué conviene dejar sin hacer hasta el momento de servir. */
  finishNote?: string;
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

/**
 * Cuánto tiempo tiene el hogar para cocinar (§ tiempo de preparación).
 *
 * Se separa entre semana y fin de semana porque es la diferencia que la gente
 * realmente vive: un martes a las 7 p.m. no se parece en nada a un domingo.
 * Un slot sin minutos declarados se trata como "sin límite".
 */
export interface CookingTimeBudget {
  /** Minutos disponibles por comida, de lunes a viernes. */
  weekday: Partial<Record<MealSlot, number>>;
  /** Minutos disponibles por comida, sábado y domingo. */
  weekend: Partial<Record<MealSlot, number>>;
  /** Dificultad máxima aceptable entre semana. */
  maxWeekdayDifficulty: Difficulty;
}

/**
 * Preferencia de cocina por adelantado.
 *
 * `batchSize` es cuántas comidas del MISMO plato se cocinan de una sola vez.
 * 3 significa "cocino una vez y como eso tres veces esa semana".
 */
export interface MealPrepPreference {
  enabled: boolean;
  /** Comidas por tanda. 1 equivale a no agrupar. */
  batchSize: number;
  /** Días que cubre una jornada de cocina. Normalmente 7. */
  windowDays: number;
}

export type Sex = "femenino" | "masculino" | "sin_especificar";

export type ActivityLevel = "sedentario" | "ligero" | "moderado" | "alto" | "muy_alto";

export type NutritionGoal = "mantener" | "bajar_peso" | "subir_peso" | "masa_muscular";

/**
 * De dónde salen las porciones.
 *
 * - `estandar`: de `adults` y `children`. Es el camino por defecto y no pide
 *   ningún dato personal (D21).
 * - `necesidades`: de la energía estimada de cada persona según su perfil
 *   físico y su objetivo. Hay que elegirlo; dar el peso no lo activa solo.
 */
export type PortionBasis = "estandar" | "necesidades";

/**
 * Perfil físico de una persona del hogar. **Todos los campos son opcionales**
 * a propósito (§27): Rinde funciona sin pedir peso, estatura ni edad. Si el
 * usuario los da, se usan para estimar necesidades energéticas; si no, se usa
 * una referencia genérica y se dice que es genérica.
 */
export interface PersonProfile {
  id: string;
  name?: string;
  kind: "adulto" | "nino";
  sex: Sex;
  ageYears?: number;
  weightKg?: number;
  heightCm?: number;
  activity: ActivityLevel;
  goal: NutritionGoal;
  /** Marca situaciones que Rinde NO estima y deriva a un profesional. */
  flags?: ("embarazo" | "lactancia" | "condicion_medica")[];
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
  /** Sin definir = sin límite de tiempo, que es como se comportaba antes. */
  cookingTime?: CookingTimeBudget;
  /**
   * Modo "cocinar por adelantado".
   *
   * Cambia cómo se GENERA el plan, no solo cómo se muestra: si el hogar va a
   * cocinar por tandas, el plan tiene que repetir cada plato varias veces
   * dentro de la semana, porque si no, no hay nada que agrupar. Sin esto, la
   * puntuación de variedad reparte 21 recetas distintas en 21 comidas y el
   * meal prep no ahorra ni un minuto.
   */
  mealPrep?: MealPrepPreference;
  /**
   * Perfiles físicos, opcionales. Las PORCIONES siempre salen de
   * `adults`/`children`; estos perfiles solo afinan las metas nutricionales.
   * Separarlos evita que dar el peso cambie cuánta comida se cocina.
   */
  nutritionProfiles?: PersonProfile[];
  /** Sin definir = `estandar`. Ver `PortionBasis`. */
  portionBasis?: PortionBasis;
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

/**
 * Un ingrediente que el planificador cambió por otro más barato dentro de esta
 * comida concreta. Viaja con la comida para que la interfaz pueda decirlo: un
 * plato que ya no lleva lo que decía no puede servirse en silencio.
 */
export interface MealSubstitution {
  fromIngredientId: string;
  toIngredientId: string;
}

/** Nutrición estimada de la comida tal como quedó, sustituciones incluidas. */
export interface MealNutrition extends Nutrition {
  /** Siempre estimada a partir de ingredientes crudos. Nunca es dato médico. */
  isEstimated: boolean;
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
  /** Cambios de ingrediente aplicados a esta comida. Vacío si no hubo ninguno. */
  substitutions: MealSubstitution[];
  /** Aporte estimado de la comida completa (todas las porciones). */
  nutrition: MealNutrition;
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
  /**
   * Comidas que NO cupieron en el tiempo de cocina declarado. Se planificaron
   * igual (con la receta más rápida disponible) pero el hogar debe saberlo.
   */
  mealsOverTimeBudget: number;
  /**
   * Comidas que no alcanzaron el mínimo nutricional del horario. Se
   * planificaron con lo más sustancioso que había, y se reporta.
   */
  mealsBelowNutritionFloor: number;
  /** Energía media por persona y día del plan. `null` si no se pudo estimar. */
  averageKcalPerPersonPerDay: number | null;
  /** De dónde salieron las porciones de este plan. */
  portionBasis: PortionBasis;
  /** Raciones de adulto de referencia que se cocinaron por comida. */
  portionEquivalents: number;
  /** Las que habría con porciones estándar, para poder comparar. */
  standardPortionEquivalents: number;
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
