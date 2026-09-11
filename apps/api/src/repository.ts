import type {
  Household, IngredientPrice, InventoryItem, MealPlan, MealStatus,
  PriceHistoryEntry, PriceSource, PriceUpdateReport, Store,
} from "@rinde/core";
import type { Db } from "./db.js";

/**
 * Acceso a datos.
 *
 * Toda consulta del servidor pasa por esta interfaz. Cambiar SQLite por
 * PostgreSQL es escribir otra clase que la implemente.
 */
export interface Repository {
  createHousehold(household: Household): void;
  getHousehold(id: string): Household | null;
  updateHousehold(id: string, patch: Partial<Household>): Household | null;
  deleteHousehold(id: string): void;

  listInventory(householdId: string): InventoryItem[];
  upsertInventoryItem(householdId: string, item: InventoryItem): void;
  replaceInventory(householdId: string, items: readonly InventoryItem[]): void;
  deleteInventoryItem(householdId: string, itemId: string): void;

  savePlan(plan: MealPlan): void;
  getCurrentPlan(householdId: string): MealPlan | null;
  setMealStatus(planId: string, mealId: string, status: MealStatus, at: string): void;

  listPrices(city?: string): IngredientPrice[];
  insertPrices(prices: readonly IngredientPrice[]): void;
  listPriceHistory(ingredientId?: string): PriceHistoryEntry[];
  insertPriceHistory(entries: readonly PriceHistoryEntry[]): void;
  recordPriceUpdate(report: PriceUpdateReport, at: string): void;
  listPriceUpdates(limit: number): (PriceUpdateReport & { createdAt: string })[];

  upsertSources(sources: readonly PriceSource[]): void;
  listSources(): PriceSource[];
  upsertStores(stores: readonly Store[]): void;
}

export class SqliteRepository implements Repository {
  constructor(private readonly db: Db) {}

  // ------------------------------------------------------------- hogares

  createHousehold(household: Household): void {
    this.db
      .prepare(
        `INSERT INTO household (id, adults, children, budget_cop, city, slots, days,
                                preferences, tier, created_on,
                                cooking_time, meal_prep, nutrition_profiles)
         VALUES (@id, @adults, @children, @budgetCop, @city, @slots, @days,
                 @preferences, @tier, @createdOn,
                 @cookingTime, @mealPrep, @nutritionProfiles)`,
      )
      .run({
        id: household.id,
        adults: household.adults,
        children: household.children,
        budgetCop: household.budgetCop,
        city: household.city,
        slots: JSON.stringify(household.slots),
        days: household.days,
        preferences: JSON.stringify(household.preferences),
        tier: household.tier,
        createdOn: household.createdOn,
        cookingTime: household.cookingTime ? JSON.stringify(household.cookingTime) : null,
        mealPrep: household.mealPrep ? JSON.stringify(household.mealPrep) : null,
        nutritionProfiles: household.nutritionProfiles
          ? JSON.stringify(household.nutritionProfiles)
          : null,
      });
  }

  getHousehold(id: string): Household | null {
    const row = this.db.prepare(`SELECT * FROM household WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return {
      id: row["id"] as string,
      adults: row["adults"] as number,
      children: row["children"] as number,
      budgetCop: row["budget_cop"] as number,
      city: row["city"] as string,
      slots: JSON.parse(row["slots"] as string),
      days: row["days"] as number,
      preferences: JSON.parse(row["preferences"] as string),
      tier: row["tier"] as Household["tier"],
      createdOn: row["created_on"] as string,
      ...(row["cooking_time"]
        ? { cookingTime: JSON.parse(row["cooking_time"] as string) }
        : {}),
      ...(row["meal_prep"] ? { mealPrep: JSON.parse(row["meal_prep"] as string) } : {}),
      ...(row["nutrition_profiles"]
        ? { nutritionProfiles: JSON.parse(row["nutrition_profiles"] as string) }
        : {}),
    };
  }

  updateHousehold(id: string, patch: Partial<Household>): Household | null {
    const current = this.getHousehold(id);
    if (!current) return null;
    const merged: Household = { ...current, ...patch, id };
    this.db
      .prepare(
        `UPDATE household
            SET adults = @adults, children = @children, budget_cop = @budgetCop,
                city = @city, slots = @slots, days = @days,
                preferences = @preferences, tier = @tier,
                cooking_time = @cookingTime, meal_prep = @mealPrep,
                nutrition_profiles = @nutritionProfiles
          WHERE id = @id`,
      )
      .run({
        id,
        adults: merged.adults,
        children: merged.children,
        budgetCop: merged.budgetCop,
        city: merged.city,
        slots: JSON.stringify(merged.slots),
        days: merged.days,
        preferences: JSON.stringify(merged.preferences),
        tier: merged.tier,
        cookingTime: merged.cookingTime ? JSON.stringify(merged.cookingTime) : null,
        mealPrep: merged.mealPrep ? JSON.stringify(merged.mealPrep) : null,
        nutritionProfiles: merged.nutritionProfiles
          ? JSON.stringify(merged.nutritionProfiles)
          : null,
      });
    return merged;
  }

  deleteHousehold(id: string): void {
    this.db.prepare(`DELETE FROM household WHERE id = ?`).run(id);
  }

  // ----------------------------------------------------------- inventario

  listInventory(householdId: string): InventoryItem[] {
    const rows = this.db
      .prepare(`SELECT * FROM inventory_item WHERE household_id = ? ORDER BY ingredient_id`)
      .all(householdId) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row["id"] as string,
      ingredientId: row["ingredient_id"] as string,
      qtyBase: row["qty_base"] as number,
      updatedOn: row["updated_on"] as string,
      ...(row["expires_on"] ? { expiresOn: row["expires_on"] as string } : {}),
      ...(row["reference_price_cop"] !== null
        ? { referencePriceCop: row["reference_price_cop"] as number }
        : {}),
    }));
  }

  upsertInventoryItem(householdId: string, item: InventoryItem): void {
    this.db
      .prepare(
        `INSERT INTO inventory_item (id, household_id, ingredient_id, qty_base,
                                     expires_on, reference_price_cop, updated_on)
         VALUES (@id, @householdId, @ingredientId, @qtyBase, @expiresOn,
                 @referencePriceCop, @updatedOn)
         ON CONFLICT(id) DO UPDATE SET
           qty_base = excluded.qty_base,
           expires_on = excluded.expires_on,
           reference_price_cop = excluded.reference_price_cop,
           updated_on = excluded.updated_on`,
      )
      .run({
        id: item.id,
        householdId,
        ingredientId: item.ingredientId,
        qtyBase: item.qtyBase,
        expiresOn: item.expiresOn ?? null,
        referencePriceCop: item.referencePriceCop ?? null,
        updatedOn: item.updatedOn,
      });
  }

  replaceInventory(householdId: string, items: readonly InventoryItem[]): void {
    const run = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM inventory_item WHERE household_id = ?`).run(householdId);
      for (const item of items) this.upsertInventoryItem(householdId, item);
    });
    run();
  }

  deleteInventoryItem(householdId: string, itemId: string): void {
    this.db
      .prepare(`DELETE FROM inventory_item WHERE household_id = ? AND id = ?`)
      .run(householdId, itemId);
  }

  // ---------------------------------------------------------------- plan

  savePlan(plan: MealPlan): void {
    this.db
      .prepare(
        `INSERT INTO meal_plan (id, household_id, payload, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`,
      )
      .run(plan.id, plan.householdId, JSON.stringify(plan), new Date().toISOString());
  }

  getCurrentPlan(householdId: string): MealPlan | null {
    const row = this.db
      .prepare(
        `SELECT id, payload FROM meal_plan WHERE household_id = ?
          ORDER BY created_at DESC LIMIT 1`,
      )
      .get(householdId) as { id: string; payload: string } | undefined;
    if (!row) return null;

    const plan = JSON.parse(row.payload) as MealPlan;
    // El estado de cada comida vive aparte: se superpone sobre el documento.
    const estados = this.db
      .prepare(`SELECT meal_id, status FROM meal_status WHERE plan_id = ?`)
      .all(row.id) as { meal_id: string; status: MealStatus }[];
    if (estados.length === 0) return plan;

    const porComida = new Map(estados.map((entry) => [entry.meal_id, entry.status]));
    return {
      ...plan,
      meals: plan.meals.map((meal) => ({ ...meal, status: porComida.get(meal.id) ?? meal.status })),
    };
  }

  setMealStatus(planId: string, mealId: string, status: MealStatus, at: string): void {
    this.db
      .prepare(
        `INSERT INTO meal_status (plan_id, meal_id, status, changed_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(plan_id, meal_id) DO UPDATE SET
           status = excluded.status, changed_at = excluded.changed_at`,
      )
      .run(planId, mealId, status, at);
  }

  // -------------------------------------------------------------- precios

  listPrices(city?: string): IngredientPrice[] {
    const rows = (
      city
        ? this.db.prepare(`SELECT * FROM price WHERE city = ?`).all(city)
        : this.db.prepare(`SELECT * FROM price`).all()
    ) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row["id"] as string,
      ingredientId: row["ingredient_id"] as string,
      priceCop: row["price_cop"] as number,
      quantity: row["quantity"] as number,
      unit: row["unit"] as IngredientPrice["unit"],
      city: row["city"] as string,
      sourceId: row["source_id"] as string,
      observedOn: row["observed_on"] as string,
      confidence: row["confidence"] as IngredientPrice["confidence"],
      isDemo: Boolean(row["is_demo"]),
      ...(row["store_id"] ? { storeId: row["store_id"] as string } : {}),
    }));
  }

  insertPrices(prices: readonly IngredientPrice[]): void {
    const statement = this.db.prepare(
      `INSERT INTO price (id, ingredient_id, price_cop, quantity, unit, city, store_id,
                          source_id, observed_on, confidence, is_demo)
       VALUES (@id, @ingredientId, @priceCop, @quantity, @unit, @city, @storeId,
               @sourceId, @observedOn, @confidence, @isDemo)
       ON CONFLICT(id) DO UPDATE SET
         price_cop = excluded.price_cop, quantity = excluded.quantity,
         unit = excluded.unit, observed_on = excluded.observed_on,
         confidence = excluded.confidence`,
    );
    const run = this.db.transaction(() => {
      for (const price of prices) {
        statement.run({
          id: price.id,
          ingredientId: price.ingredientId,
          priceCop: price.priceCop,
          quantity: price.quantity,
          unit: price.unit,
          city: price.city,
          storeId: price.storeId ?? null,
          sourceId: price.sourceId,
          observedOn: price.observedOn,
          confidence: price.confidence,
          isDemo: price.isDemo ? 1 : 0,
        });
      }
    });
    run();
  }

  listPriceHistory(ingredientId?: string): PriceHistoryEntry[] {
    const rows = (
      ingredientId
        ? this.db
            .prepare(`SELECT * FROM price_history WHERE ingredient_id = ? ORDER BY week`)
            .all(ingredientId)
        : this.db.prepare(`SELECT * FROM price_history ORDER BY week`).all()
    ) as Record<string, unknown>[];
    return rows.map((row) => ({
      ingredientId: row["ingredient_id"] as string,
      week: row["week"] as string,
      copPerBaseUnit: row["cop_per_base_unit"] as number,
      city: row["city"] as string,
    }));
  }

  insertPriceHistory(entries: readonly PriceHistoryEntry[]): void {
    const statement = this.db.prepare(
      `INSERT INTO price_history (ingredient_id, week, city, cop_per_base_unit)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(ingredient_id, week, city) DO UPDATE SET
         cop_per_base_unit = excluded.cop_per_base_unit`,
    );
    const run = this.db.transaction(() => {
      for (const entry of entries) {
        statement.run(entry.ingredientId, entry.week, entry.city, entry.copPerBaseUnit);
      }
    });
    run();
  }

  recordPriceUpdate(report: PriceUpdateReport, at: string): void {
    this.db
      .prepare(
        `INSERT INTO price_update (source_id, week, accepted, rejected, errors, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(report.sourceId, report.week, report.accepted, report.rejected,
           JSON.stringify(report.errors), at);
  }

  listPriceUpdates(limit: number): (PriceUpdateReport & { createdAt: string })[] {
    const rows = this.db
      .prepare(`SELECT * FROM price_update ORDER BY id DESC LIMIT ?`)
      .all(limit) as Record<string, unknown>[];
    return rows.map((row) => ({
      week: row["week"] as string,
      sourceId: row["source_id"] as string,
      accepted: row["accepted"] as number,
      rejected: row["rejected"] as number,
      changes: [],
      errors: JSON.parse(row["errors"] as string) as string[],
      createdAt: row["created_at"] as string,
    }));
  }

  // -------------------------------------------------------------- fuentes

  upsertSources(sources: readonly PriceSource[]): void {
    const statement = this.db.prepare(
      `INSERT INTO price_source (id, name, type, url, license, requires_attribution, notes)
       VALUES (@id, @name, @type, @url, @license, @requiresAttribution, @notes)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, notes = excluded.notes`,
    );
    const run = this.db.transaction(() => {
      for (const source of sources) {
        statement.run({
          id: source.id,
          name: source.name,
          type: source.type,
          url: source.url ?? null,
          license: source.license ?? null,
          requiresAttribution: source.requiresAttribution ? 1 : 0,
          notes: source.notes ?? null,
        });
      }
    });
    run();
  }

  listSources(): PriceSource[] {
    const rows = this.db.prepare(`SELECT * FROM price_source ORDER BY id`).all() as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row["id"] as string,
      name: row["name"] as string,
      type: row["type"] as PriceSource["type"],
      requiresAttribution: Boolean(row["requires_attribution"]),
      ...(row["url"] ? { url: row["url"] as string } : {}),
      ...(row["license"] ? { license: row["license"] as string } : {}),
      ...(row["notes"] ? { notes: row["notes"] as string } : {}),
    }));
  }

  upsertStores(stores: readonly Store[]): void {
    const statement = this.db.prepare(
      `INSERT INTO store (id, name, city, type) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, city = excluded.city`,
    );
    const run = this.db.transaction(() => {
      for (const store of stores) statement.run(store.id, store.name, store.city, store.type);
    });
    run();
  }
}
