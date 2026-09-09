import type {
  Cop,
  Ingredient,
  IngredientPrice,
  IsoDate,
  PriceConfidence,
  UnitPrice,
} from "./types.js";
import { daysBetween } from "./dates.js";
import { toBase } from "./units.js";

/**
 * Normalización y vigencia de precios (§17, §18 del brief).
 *
 * Dos reglas que no se negocian:
 *   1. Un precio con más de `STALE_AFTER_DAYS` días deja de presentarse como
 *      vigente y pasa a `estimated`.
 *   2. Un precio demo y uno real jamás se promedian ni se mezclan.
 */

/** A partir de aquí un precio deja de considerarse vigente. */
export const STALE_AFTER_DAYS = 14;

export class PricingError extends Error {
  override readonly name = "PricingError";
}

/**
 * Convierte una observación (`$18.900 por 1 kg`) a COP por unidad base
 * (`18,9 COP/g`) y calcula su antigüedad respecto a `asOf`.
 */
export function normalizePrice(
  price: IngredientPrice,
  ingredient: Ingredient,
  asOf: IsoDate,
): UnitPrice {
  if (price.ingredientId !== ingredient.id) {
    throw new PricingError(
      `El precio ${price.id} es de ${price.ingredientId}, no de ${ingredient.id}`,
    );
  }
  if (price.quantity <= 0) {
    throw new PricingError(`El precio ${price.id} declara una cantidad <= 0`);
  }
  const quantityBase = toBase(price.quantity, price.unit, ingredient);
  if (quantityBase <= 0) {
    throw new PricingError(`El precio ${price.id} se normaliza a una cantidad <= 0`);
  }

  const ageDays = daysBetween(price.observedOn, asOf);
  const degraded = ageDays > STALE_AFTER_DAYS && price.confidence !== "estimated";
  const confidence: PriceConfidence = degraded ? "estimated" : price.confidence;

  return {
    ingredientId: ingredient.id,
    copPerBaseUnit: price.priceCop / quantityBase,
    baseUnit: ingredient.baseUnit,
    confidence,
    isDemo: price.isDemo,
    sourceId: price.sourceId,
    observedOn: price.observedOn,
    ageDays,
    degraded,
  };
}

const CONFIDENCE_RANK: Record<PriceConfidence, number> = {
  measured: 0,
  reported: 1,
  estimated: 2,
};

/**
 * Índice de precios vigentes por ingrediente.
 *
 * Ante varias observaciones del mismo ingrediente elige **una**, nunca un
 * promedio entre datos de distinta naturaleza. El orden de preferencia es:
 * datos reales antes que demo → mayor confianza → observación más reciente →
 * precio más bajo (a igualdad de todo lo demás, el más barato).
 */
export class PriceIndex {
  private readonly byIngredient = new Map<string, UnitPrice>();

  constructor(
    prices: readonly IngredientPrice[],
    catalog: ReadonlyMap<string, Ingredient>,
    asOf: IsoDate,
    city?: string,
  ) {
    for (const price of prices) {
      if (city && price.city !== city) continue;
      const ingredient = catalog.get(price.ingredientId);
      if (!ingredient) continue;

      let normalized: UnitPrice;
      try {
        normalized = normalizePrice(price, ingredient, asOf);
      } catch {
        continue; // un precio corrupto se ignora, no rompe el índice
      }
      // Un precio observado en el futuro respecto a `asOf` no es utilizable.
      if (normalized.ageDays < 0) continue;

      const current = this.byIngredient.get(price.ingredientId);
      if (!current || this.isBetter(normalized, current)) {
        this.byIngredient.set(price.ingredientId, normalized);
      }
    }
  }

  private isBetter(candidate: UnitPrice, incumbent: UnitPrice): boolean {
    if (candidate.isDemo !== incumbent.isDemo) return !candidate.isDemo;
    const rank = CONFIDENCE_RANK[candidate.confidence] - CONFIDENCE_RANK[incumbent.confidence];
    if (rank !== 0) return rank < 0;
    if (candidate.ageDays !== incumbent.ageDays) return candidate.ageDays < incumbent.ageDays;
    return candidate.copPerBaseUnit < incumbent.copPerBaseUnit;
  }

  get(ingredientId: string): UnitPrice | undefined {
    return this.byIngredient.get(ingredientId);
  }

  has(ingredientId: string): boolean {
    return this.byIngredient.has(ingredientId);
  }

  /**
   * Costo de `qtyBase` unidades base. Devuelve `null` — NUNCA `0` — cuando no
   * hay precio. `0` significaría "es gratis", que es falso y engañoso.
   */
  costOf(ingredientId: string, qtyBase: number): Cop | null {
    const price = this.byIngredient.get(ingredientId);
    if (!price) return null;
    return Math.round(price.copPerBaseUnit * qtyBase);
  }

  ingredientIds(): string[] {
    return [...this.byIngredient.keys()].sort();
  }

  get size(): number {
    return this.byIngredient.size;
  }

  /** `true` si alguno de los precios vigentes es un dato de demostración. */
  containsDemo(): boolean {
    for (const price of this.byIngredient.values()) if (price.isDemo) return true;
    return false;
  }
}
