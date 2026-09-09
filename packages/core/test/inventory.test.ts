import { describe, expect, it } from "vitest";
import { INGREDIENT_BY_ID } from "@rinde/data";
import { VirtualPantry, expiringSoon, expiryUrgency, planPurchase } from "../src/inventory.js";
import type { InventoryItem } from "../src/types.js";

function item(ingredientId: string, qtyBase: number, expiresOn?: string): InventoryItem {
  return {
    id: `inv_${ingredientId}`,
    ingredientId,
    qtyBase,
    updatedOn: "2026-09-09",
    ...(expiresOn ? { expiresOn } : {}),
  };
}

describe("despensa virtual (§10)", () => {
  it("descuenta del inventario al cocinar: 1 kg pollo − 400 g = 600 g", () => {
    const pantry = new VirtualPantry([item("pollo_pechuga", 1000)]);
    const take = pantry.take("pollo_pechuga", 400);
    expect(take.fromStock).toBe(400);
    expect(take.deficit).toBe(0);
    expect(pantry.stockOf("pollo_pechuga")).toBe(600);
  });

  it("lo que falta se acumula como requerimiento neto, no como compras sueltas", () => {
    const pantry = new VirtualPantry([item("pollo_pechuga", 500)]);
    pantry.take("pollo_pechuga", 500); // cubierto
    pantry.take("pollo_pechuga", 300); // falta 300
    pantry.take("pollo_pechuga", 700); // falta 700
    expect(pantry.netRequirements().get("pollo_pechuga")).toBe(1000);
  });

  it("peek no modifica el estado", () => {
    const pantry = new VirtualPantry([item("arroz_blanco", 1000)]);
    const peeked = pantry.peek("arroz_blanco", 400);
    expect(peeked.fromStock).toBe(400);
    expect(pantry.stockOf("arroz_blanco")).toBe(1000);
  });

  it("una despensa vacía convierte todo en requerimiento", () => {
    const pantry = new VirtualPantry([]);
    const take = pantry.take("arroz_blanco", 250);
    expect(take.fromStock).toBe(0);
    expect(take.deficit).toBe(250);
  });

  it("clone aísla el estado", () => {
    const pantry = new VirtualPantry([item("arroz_blanco", 1000)]);
    const copy = pantry.clone();
    copy.take("arroz_blanco", 1000);
    expect(pantry.stockOf("arroz_blanco")).toBe(1000);
    expect(copy.stockOf("arroz_blanco")).toBe(0);
  });

  it("conserva la fecha de vencimiento más próxima", () => {
    const pantry = new VirtualPantry([
      item("pollo_pechuga", 500, "2026-09-20"),
      item("pollo_pechuga", 500, "2026-09-12"),
    ]);
    expect(pantry.expiresOn("pollo_pechuga")).toBe("2026-09-12");
  });
});

describe("compra por formato de venta", () => {
  const arroz = INGREDIENT_BY_ID.get("arroz_blanco")!;
  const huevo = INGREDIENT_BY_ID.get("huevo")!;

  it("347 g de arroz se compran como una libra", () => {
    const purchase = planPurchase(347, arroz);
    expect(purchase.purchaseBase).toBe(500);
    expect(purchase.surplusBase).toBe(153);
  });

  it("elige el formato que menos desperdicio genera", () => {
    expect(planPurchase(2600, arroz).purchaseBase).toBe(3000);
    expect(planPurchase(1000, arroz).purchaseBase).toBe(1000);
  });

  it("los huevos se compran por unidad exacta cuando se venden sueltos", () => {
    expect(planPurchase(7, huevo).purchaseBase).toBe(7);
    expect(planPurchase(7, huevo).surplusBase).toBe(0);
  });

  it("no comprar nada cuesta nada", () => {
    expect(planPurchase(0, arroz).purchaseBase).toBe(0);
  });

  it("sin formatos declarados redondea al paso del ingrediente", () => {
    const sinPacks = { ...arroz, packSizes: [] };
    const purchase = planPurchase(347, sinPacks);
    expect(purchase.purchaseBase % sinPacks.roundingStep).toBe(0);
    expect(purchase.purchaseBase).toBeGreaterThanOrEqual(347);
  });
});

describe("vencimientos (§13.7)", () => {
  it("clasifica la urgencia respecto a una fecha dada", () => {
    expect(expiryUrgency("2026-09-08", "2026-09-09")).toBe("expired");
    expect(expiryUrgency("2026-09-10", "2026-09-09")).toBe("urgent");
    expect(expiryUrgency("2026-09-13", "2026-09-09")).toBe("soon");
    expect(expiryUrgency("2026-10-09", "2026-09-09")).toBe("ok");
    expect(expiryUrgency(undefined, "2026-09-09")).toBe("unknown");
  });

  it("lista lo que vence pronto, lo más urgente primero", () => {
    const soon = expiringSoon(
      [item("tomate", 4, "2026-09-11"), item("pollo_pechuga", 500, "2026-09-10"), item("arroz_blanco", 1000)],
      "2026-09-09",
    );
    expect(soon.map((i) => i.ingredientId)).toEqual(["pollo_pechuga", "tomate"]);
  });
});
