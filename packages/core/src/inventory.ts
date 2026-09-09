import type { Ingredient, InventoryItem, IsoDate, PackSize } from "./types.js";
import { daysBetween } from "./dates.js";
import { round, roundUpToStep, toBase } from "./units.js";

/**
 * Despensa virtual: el estado de existencias que el planificador simula.
 *
 * El planificador recorre las comidas en orden y va descontando. Lo que falta
 * NO se compra comida a comida: se acumula como *requerimiento neto* por
 * ingrediente y se convierte en compra una sola vez, al final. Eso es lo que
 * evita el problema del §14 del brief — comprar pollo tres veces para tres
 * recetas en vez de comprar una cantidad consolidada.
 */

export interface TakeResult {
  /** Cubierto con lo que ya había. */
  fromStock: number;
  /** Lo que falta y habrá que comprar. */
  deficit: number;
}

export class VirtualPantry {
  private readonly stock = new Map<string, number>();
  private readonly expiry = new Map<string, IsoDate>();
  private readonly netRequirement = new Map<string, number>();

  constructor(items: readonly InventoryItem[] = []) {
    for (const item of items) this.add(item.ingredientId, item.qtyBase, item.expiresOn);
  }

  add(ingredientId: string, qtyBase: number, expiresOn?: IsoDate): void {
    if (qtyBase <= 0) return;
    this.stock.set(ingredientId, round((this.stock.get(ingredientId) ?? 0) + qtyBase, 4));
    if (expiresOn) {
      const current = this.expiry.get(ingredientId);
      // Se conserva la fecha más próxima: es la que marca la urgencia.
      if (!current || expiresOn < current) this.expiry.set(ingredientId, expiresOn);
    }
  }

  stockOf(ingredientId: string): number {
    return this.stock.get(ingredientId) ?? 0;
  }

  expiresOn(ingredientId: string): IsoDate | undefined {
    return this.expiry.get(ingredientId);
  }

  /** Consume `qtyBase`; lo que no alcance se registra como requerimiento neto. */
  take(ingredientId: string, qtyBase: number): TakeResult {
    if (qtyBase <= 0) return { fromStock: 0, deficit: 0 };
    const available = this.stock.get(ingredientId) ?? 0;
    const fromStock = Math.min(available, qtyBase);
    const deficit = round(qtyBase - fromStock, 4);

    this.stock.set(ingredientId, round(available - fromStock, 4));
    if (deficit > 0) {
      this.netRequirement.set(
        ingredientId,
        round((this.netRequirement.get(ingredientId) ?? 0) + deficit, 4),
      );
    }
    return { fromStock: round(fromStock, 4), deficit };
  }

  /** Simula `take` sin modificar nada. Lo usa el sistema de puntuación. */
  peek(ingredientId: string, qtyBase: number): TakeResult {
    if (qtyBase <= 0) return { fromStock: 0, deficit: 0 };
    const available = this.stock.get(ingredientId) ?? 0;
    const fromStock = Math.min(available, qtyBase);
    return { fromStock: round(fromStock, 4), deficit: round(qtyBase - fromStock, 4) };
  }

  /** Requerimiento neto consolidado de todo el plan. */
  netRequirements(): Map<string, number> {
    return new Map(this.netRequirement);
  }

  /** Existencias que sobran al terminar el plan. */
  remaining(): Map<string, number> {
    const out = new Map<string, number>();
    for (const [id, qty] of this.stock) if (qty > 0.0001) out.set(id, round(qty, 4));
    return out;
  }

  clone(): VirtualPantry {
    const copy = new VirtualPantry();
    for (const [id, qty] of this.stock) copy.stock.set(id, qty);
    for (const [id, date] of this.expiry) copy.expiry.set(id, date);
    for (const [id, qty] of this.netRequirement) copy.netRequirement.set(id, qty);
    return copy;
  }
}

// ---------------------------------------------------------------------------
// Compras: del requerimiento neto al formato de venta real
// ---------------------------------------------------------------------------

export interface PurchasePlan {
  /** Lo que el plan necesita. */
  neededBase: number;
  /** Lo que hay que comprar realmente, dado cómo se vende el producto. */
  purchaseBase: number;
  /** Sobrante inevitable por comprar por formato. */
  surplusBase: number;
  packLabel?: string;
  packs: number;
}

/**
 * Traduce un requerimiento neto al formato de venta real.
 *
 * Nadie compra "347 g de arroz": compra una libra o un kilo. Se elige el
 * formato que **menos desperdicio genera**; a igualdad de desperdicio, el que
 * implique llevar menos empaques.
 */
export function planPurchase(neededBase: number, ingredient: Ingredient): PurchasePlan {
  if (neededBase <= 0) {
    return { neededBase: 0, purchaseBase: 0, surplusBase: 0, packs: 0 };
  }
  const options = ingredient.packSizes
    .map((pack) => ({ pack, base: safeToBase(pack, ingredient) }))
    .filter((option): option is { pack: PackSize; base: number } => option.base !== null && option.base > 0);

  if (options.length === 0) {
    // Sin formatos declarados: se redondea al paso del ingrediente.
    const purchaseBase = roundUpToStep(neededBase, ingredient.roundingStep);
    return {
      neededBase: round(neededBase, 4),
      purchaseBase,
      surplusBase: round(purchaseBase - neededBase, 4),
      packs: 1,
    };
  }

  let best: PurchasePlan | null = null;
  for (const { pack, base } of options) {
    const packs = Math.ceil(round(neededBase / base, 6));
    const purchaseBase = round(packs * base, 4);
    const surplusBase = round(purchaseBase - neededBase, 4);
    const candidate: PurchasePlan = {
      neededBase: round(neededBase, 4),
      purchaseBase,
      surplusBase,
      packs,
      ...(pack.label ? { packLabel: pack.label } : {}),
    };
    if (
      best === null ||
      candidate.surplusBase < best.surplusBase ||
      (candidate.surplusBase === best.surplusBase && candidate.packs < best.packs)
    ) {
      best = candidate;
    }
  }
  return best!;
}

function safeToBase(pack: PackSize, ingredient: Ingredient): number | null {
  try {
    return toBase(pack.qty, pack.unit, ingredient);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Vencimientos
// ---------------------------------------------------------------------------

export type ExpiryUrgency = "expired" | "urgent" | "soon" | "ok" | "unknown";

/** Clasifica cuán urgente es consumir un artículo respecto a `asOf`. */
export function expiryUrgency(expiresOn: IsoDate | undefined, asOf: IsoDate): ExpiryUrgency {
  if (!expiresOn) return "unknown";
  const days = daysBetween(asOf, expiresOn);
  if (days < 0) return "expired";
  if (days <= 2) return "urgent";
  if (days <= 5) return "soon";
  return "ok";
}

/** Artículos del inventario que vencen dentro de `withinDays`. */
export function expiringSoon(
  items: readonly InventoryItem[],
  asOf: IsoDate,
  withinDays = 5,
): InventoryItem[] {
  return items
    .filter((item) => {
      if (!item.expiresOn) return false;
      const days = daysBetween(asOf, item.expiresOn);
      return days >= 0 && days <= withinDays;
    })
    .sort((a, b) => (a.expiresOn! < b.expiresOn! ? -1 : a.expiresOn! > b.expiresOn! ? 1 : a.id < b.id ? -1 : 1));
}
