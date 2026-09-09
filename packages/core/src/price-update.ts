import type {
  Ingredient,
  IngredientPrice,
  IsoDate,
  PriceChange,
  PriceConfidence,
  PriceHistoryEntry,
  PriceUpdateReport,
  Unit,
} from "./types.js";
import { isoWeek } from "./dates.js";
import { normalizePrice } from "./pricing.js";
import { percentChange } from "./money.js";
import { parseCsvRecords } from "./csv.js";
import { round } from "./units.js";

/**
 * Actualización semanal de precios (§19 del brief).
 *
 * El proceso es: obtener → validar → comparar con la semana anterior →
 * detectar cambios → actualizar vigentes → guardar historial.
 *
 * `PriceProvider` es el punto de extensión para nuevas fuentes. Hoy están
 * implementados CSV y carga manual. NO hay ningún adaptador que asuma el
 * esquema de una API que no se haya podido verificar; ver docs/DATA_SOURCES.md.
 */

/** Una observación tal como la entrega una fuente, antes de validarse. */
export interface PriceObservation {
  ingredientId: string;
  priceCop: number;
  quantity: number;
  unit: Unit;
  city: string;
  storeId?: string;
  observedOn: IsoDate;
  confidence: PriceConfidence;
}

export interface PriceProvider {
  readonly sourceId: string;
  /** Obtiene las observaciones de una semana. Puede ser asíncrono. */
  fetchWeek(week: string): Promise<PriceObservation[]>;
}

const VALID_UNITS: readonly Unit[] = [
  "g", "kg", "mg", "ml", "l", "unit", "taza", "cda", "cdta", "pizca",
];
const VALID_CONFIDENCE: readonly PriceConfidence[] = ["measured", "reported", "estimated"];

export interface ValidationResult {
  accepted: PriceObservation[];
  errors: string[];
}

/**
 * Valida observaciones contra el catálogo.
 * Una fila con un ingrediente desconocido se RECHAZA con su número de línea —
 * no se descarta en silencio.
 */
export function validateObservations(
  observations: readonly PriceObservation[],
  catalog: ReadonlyMap<string, Ingredient>,
): ValidationResult {
  const accepted: PriceObservation[] = [];
  const errors: string[] = [];

  observations.forEach((observation, index) => {
    const line = index + 1;
    if (!catalog.has(observation.ingredientId)) {
      errors.push(`Línea ${line}: ingrediente desconocido "${observation.ingredientId}"`);
      return;
    }
    if (!Number.isInteger(observation.priceCop) || observation.priceCop <= 0) {
      errors.push(`Línea ${line}: precio inválido "${observation.priceCop}" (entero de COP > 0)`);
      return;
    }
    if (!Number.isFinite(observation.quantity) || observation.quantity <= 0) {
      errors.push(`Línea ${line}: cantidad inválida "${observation.quantity}"`);
      return;
    }
    if (!VALID_UNITS.includes(observation.unit)) {
      errors.push(`Línea ${line}: unidad desconocida "${observation.unit}"`);
      return;
    }
    if (!VALID_CONFIDENCE.includes(observation.confidence)) {
      errors.push(`Línea ${line}: confianza inválida "${observation.confidence}"`);
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(observation.observedOn)) {
      errors.push(`Línea ${line}: fecha inválida "${observation.observedOn}" (se espera YYYY-MM-DD)`);
      return;
    }
    if (!observation.city.trim()) {
      errors.push(`Línea ${line}: falta la ciudad`);
      return;
    }
    accepted.push(observation);
  });

  return { accepted, errors };
}

/** Lee el CSV documentado en docs/DATA_SOURCES.md §4. */
export function parsePriceCsv(text: string): { observations: PriceObservation[]; errors: string[] } {
  const records = parseCsvRecords(text);
  const observations: PriceObservation[] = [];
  const errors: string[] = [];

  records.forEach((record, index) => {
    const line = index + 2; // +1 por el encabezado, +1 porque las filas son 1-based
    const ingredientId = record["ingredient_id"] ?? "";
    if (!ingredientId) {
      errors.push(`Línea ${line}: falta ingredient_id`);
      return;
    }
    const priceCop = Number(record["price_cop"]);
    const quantity = Number(record["quantity"]);
    if (!Number.isFinite(priceCop) || !Number.isFinite(quantity)) {
      errors.push(`Línea ${line}: price_cop o quantity no son números`);
      return;
    }
    const storeId = record["store"];
    observations.push({
      ingredientId,
      priceCop: Math.round(priceCop),
      quantity,
      unit: (record["unit"] ?? "g") as Unit,
      city: record["city"] ?? "",
      observedOn: (record["observed_on"] ?? "") as IsoDate,
      confidence: (record["confidence"] ?? "reported") as PriceConfidence,
      ...(storeId ? { storeId } : {}),
    });
  });

  return { observations, errors };
}

export interface WeeklyUpdateInput {
  sourceId: string;
  observations: readonly PriceObservation[];
  catalog: ReadonlyMap<string, Ingredient>;
  /** Historial de la semana anterior, para comparar. */
  previousHistory: readonly PriceHistoryEntry[];
  asOf: IsoDate;
  isDemo?: boolean;
}

export interface WeeklyUpdateResult {
  report: PriceUpdateReport;
  /** Precios listos para guardar como vigentes. */
  prices: IngredientPrice[];
  /** Entradas nuevas del historial. */
  history: PriceHistoryEntry[];
}

/** Ejecuta el ciclo semanal completo. Es puro: no escribe en ninguna parte. */
export function weeklyPriceUpdate(input: WeeklyUpdateInput): WeeklyUpdateResult {
  const week = isoWeek(input.asOf);
  const { accepted, errors } = validateObservations(input.observations, input.catalog);
  const isDemo = input.isDemo ?? false;

  const previousByIngredient = new Map<string, PriceHistoryEntry>();
  for (const entry of input.previousHistory) {
    const current = previousByIngredient.get(entry.ingredientId);
    if (!current || entry.week > current.week) previousByIngredient.set(entry.ingredientId, entry);
  }

  const prices: IngredientPrice[] = [];
  const history: PriceHistoryEntry[] = [];
  const changes: PriceChange[] = [];

  accepted.forEach((observation, index) => {
    const ingredient = input.catalog.get(observation.ingredientId)!;
    const price: IngredientPrice = {
      id: `${input.sourceId}_${observation.ingredientId}_${week}_${index}`,
      ingredientId: observation.ingredientId,
      priceCop: observation.priceCop,
      quantity: observation.quantity,
      unit: observation.unit,
      city: observation.city,
      sourceId: input.sourceId,
      observedOn: observation.observedOn,
      confidence: observation.confidence,
      isDemo,
      ...(observation.storeId ? { storeId: observation.storeId } : {}),
    };

    let normalized;
    try {
      normalized = normalizePrice(price, ingredient, input.asOf);
    } catch (error) {
      errors.push(`Línea ${index + 1}: ${(error as Error).message}`);
      return;
    }

    prices.push(price);
    history.push({
      ingredientId: observation.ingredientId,
      week,
      copPerBaseUnit: round(normalized.copPerBaseUnit, 6),
      city: observation.city,
    });

    const previous = previousByIngredient.get(observation.ingredientId);
    if (previous && previous.copPerBaseUnit > 0 && previous.week !== week) {
      const changePct = percentChange(previous.copPerBaseUnit, normalized.copPerBaseUnit);
      changes.push({
        ingredientId: observation.ingredientId,
        previousCopPerBaseUnit: previous.copPerBaseUnit,
        currentCopPerBaseUnit: round(normalized.copPerBaseUnit, 6),
        changePct,
        direction: changePct > 0.05 ? "up" : changePct < -0.05 ? "down" : "flat",
      });
    }
  });

  return {
    report: {
      week,
      sourceId: input.sourceId,
      accepted: prices.length,
      rejected: input.observations.length - prices.length,
      changes: changes.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)),
      errors,
    },
    prices,
    history,
  };
}

/** "Subió 3,8% esta semana" / "Bajó 1,2% esta semana" / "Sin cambio". */
export function describeChange(change: PriceChange): string {
  if (change.direction === "flat") return "Sin cambio esta semana";
  const verb = change.direction === "up" ? "Subió" : "Bajó";
  const value = Math.abs(change.changePct).toFixed(1).replace(".", ",");
  return `${verb} ${value}% esta semana`;
}
