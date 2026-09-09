import { createContext, useContext, useEffect, useMemo, useReducer } from "react";
import type { ReactNode } from "react";
import {
  cookMeal as cookMealEngine,
  generateMealPlan,
  type Household,
  type InventoryItem,
  type MealPlan,
  type MealSlot,
  type UserPreference,
} from "@rinde/core";
import { CATALOG_AS_OF, INGREDIENT_BY_ID, PRICES, RECIPES } from "../lib/catalog.js";
import { storage } from "../lib/storage.js";

/**
 * Estado de la aplicación.
 *
 * Un solo documento por hogar, persistido en el dispositivo. No hay Redux ni
 * Zustand: el estado es pequeño y las transiciones son pocas y explícitas.
 *
 * Regla: NINGÚN cálculo de dinero, cantidades o inventario vive aquí. Todo eso
 * es `@rinde/core`. Este archivo solo guarda, carga y despacha.
 */

export interface AppData {
  version: 1;
  onboarded: boolean;
  household: Household | null;
  inventory: InventoryItem[];
  plan: MealPlan | null;
  /** Ingredientes ya marcados como comprados en la lista de mercado. */
  checkedIngredientIds: string[];
  cookedMealIds: string[];
}

const STORAGE_KEY = "estado";

export const EMPTY_STATE: AppData = {
  version: 1,
  onboarded: false,
  household: null,
  inventory: [],
  plan: null,
  checkedIngredientIds: [],
  cookedMealIds: [],
};

export type Action =
  | { type: "onboard"; household: Household; inventory: InventoryItem[] }
  | { type: "updateHousehold"; patch: Partial<Household> }
  | { type: "setPreferences"; preferences: UserPreference[] }
  | { type: "addInventory"; item: InventoryItem }
  | { type: "updateInventory"; id: string; qtyBase: number; expiresOn?: string }
  | { type: "removeInventory"; id: string }
  | { type: "regeneratePlan" }
  | { type: "toggleChecked"; ingredientId: string }
  | { type: "cookMeal"; mealId: string }
  | { type: "reset" };

function newId(prefix: string): string {
  // `crypto.randomUUID` no está en todos los navegadores móviles antiguos.
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${random}`;
}

/** Hoy, según el dispositivo, como `YYYY-MM-DD`. */
export function today(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function buildPlan(household: Household, inventory: InventoryItem[]): MealPlan {
  return generateMealPlan({
    household,
    // El plan arranca en la fecha de referencia del catálogo para que los
    // precios demo se lean como vigentes. Con precios reales sería `today()`.
    startDate: CATALOG_AS_OF,
    inventory,
    recipes: RECIPES,
    catalog: INGREDIENT_BY_ID,
    prices: PRICES,
    planId: newId("plan"),
  });
}

export function reducer(state: AppData, action: Action): AppData {
  switch (action.type) {
    case "onboard": {
      const plan = buildPlan(action.household, action.inventory);
      return {
        ...state,
        onboarded: true,
        household: action.household,
        inventory: action.inventory,
        plan,
        checkedIngredientIds: [],
        cookedMealIds: [],
      };
    }

    case "updateHousehold": {
      if (!state.household) return state;
      const household = { ...state.household, ...action.patch };
      return { ...state, household, plan: buildPlan(household, state.inventory) };
    }

    case "setPreferences": {
      if (!state.household) return state;
      const household = { ...state.household, preferences: action.preferences };
      return { ...state, household, plan: buildPlan(household, state.inventory) };
    }

    case "addInventory": {
      // Si el ingrediente ya está, se suma en vez de duplicar la línea.
      const existing = state.inventory.find((item) => item.ingredientId === action.item.ingredientId);
      const inventory = existing
        ? state.inventory.map((item) =>
            item.id === existing.id
              ? {
                  ...item,
                  qtyBase: Math.round((item.qtyBase + action.item.qtyBase) * 1000) / 1000,
                  updatedOn: action.item.updatedOn,
                  ...(action.item.expiresOn ? { expiresOn: action.item.expiresOn } : {}),
                }
              : item,
          )
        : [...state.inventory, action.item];
      return { ...state, inventory };
    }

    case "updateInventory": {
      const inventory = state.inventory
        .map((item) =>
          item.id === action.id
            ? {
                ...item,
                qtyBase: action.qtyBase,
                updatedOn: today(),
                ...(action.expiresOn !== undefined ? { expiresOn: action.expiresOn } : {}),
              }
            : item,
        )
        .filter((item) => item.qtyBase > 0);
      return { ...state, inventory };
    }

    case "removeInventory":
      return { ...state, inventory: state.inventory.filter((item) => item.id !== action.id) };

    case "regeneratePlan": {
      if (!state.household) return state;
      return {
        ...state,
        plan: buildPlan(state.household, state.inventory),
        checkedIngredientIds: [],
        cookedMealIds: [],
      };
    }

    case "toggleChecked": {
      const checked = new Set(state.checkedIngredientIds);
      if (checked.has(action.ingredientId)) checked.delete(action.ingredientId);
      else checked.add(action.ingredientId);
      return { ...state, checkedIngredientIds: [...checked] };
    }

    case "cookMeal": {
      if (!state.plan) return state;
      const meal = state.plan.meals.find((entry) => entry.id === action.mealId);
      if (!meal || meal.status === "cooked") return state;

      // El descuento del inventario lo hace el motor, no esta capa.
      const result = cookMealEngine(meal, state.inventory, today());
      return {
        ...state,
        inventory: result.inventory,
        cookedMealIds: [...new Set([...state.cookedMealIds, action.mealId])],
        plan: {
          ...state.plan,
          meals: state.plan.meals.map((entry) =>
            entry.id === action.mealId ? result.meal : entry,
          ),
        },
      };
    }

    case "reset":
      return EMPTY_STATE;

    default:
      return state;
  }
}

function load(): AppData {
  const saved = storage.get<AppData>(STORAGE_KEY);
  if (!saved || saved.version !== 1) return EMPTY_STATE;
  return { ...EMPTY_STATE, ...saved };
}

interface StoreValue {
  state: AppData;
  dispatch: (action: Action) => void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, dispatch] = useReducer(reducer, undefined, load);

  useEffect(() => {
    if (state === EMPTY_STATE) storage.remove(STORAGE_KEY);
    else storage.set(STORAGE_KEY, state);
  }, [state]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error("useStore debe usarse dentro de <StoreProvider>");
  return value;
}

/** Crea un hogar nuevo con los valores del onboarding. */
export function createHousehold(input: {
  adults: number;
  children: number;
  budgetCop: number;
  slots: MealSlot[];
  days: number;
  city?: string;
}): Household {
  return {
    id: newId("hogar"),
    adults: input.adults,
    children: input.children,
    budgetCop: input.budgetCop,
    city: input.city ?? "Bogotá",
    slots: input.slots,
    days: input.days,
    preferences: [],
    tier: "free",
    createdOn: today(),
  };
}

export function createInventoryItem(ingredientId: string, qtyBase: number, expiresOn?: string): InventoryItem {
  return {
    id: newId("inv"),
    ingredientId,
    qtyBase,
    updatedOn: today(),
    ...(expiresOn ? { expiresOn } : {}),
  };
}
