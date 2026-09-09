import type { IngredientPrice, IsoDate, PriceHistoryEntry, PriceSource, Store, Unit } from "@rinde/core";
import { isoWeek, normalizePrice, round } from "@rinde/core";
import { INGREDIENT_BY_ID } from "./ingredients.js";

/**
 * ⚠️ PRECIOS DE DEMOSTRACIÓN — NO SON PRECIOS REALES DE MERCADO ⚠️
 *
 * Todos los precios de este archivo llevan `isDemo: true` y `sourceId`
 * `demo_bogota`. Existen para que el producto se pueda probar de punta a
 * punta, no para informar a nadie cuánto cuesta la comida.
 *
 * La interfaz muestra "Datos de demostración" en todo lugar donde aparezca uno
 * de estos precios, y el motor nunca promedia un precio demo con uno real.
 *
 * Para precios reales hay que cargar datos por CSV o por el panel de
 * administración. Ver `docs/DATA_SOURCES.md`.
 */

export const DEMO_NOTICE =
  "Datos de demostración. Los precios no corresponden a un mercado real y no " +
  "deben usarse para tomar decisiones de compra.";

/** Fecha de observación de los precios demo. Coincide con `DEMO_WEEK`. */
export const DEMO_OBSERVED_ON: IsoDate = "2026-09-07";
export const DEMO_WEEK = isoWeek(DEMO_OBSERVED_ON);
export const DEMO_CITY = "Bogotá";

export const PRICE_SOURCES: PriceSource[] = [
  {
    id: "demo_bogota",
    name: "Datos de demostración (Bogotá)",
    type: "demo",
    requiresAttribution: false,
    notes:
      "Precios inventados para poder probar la aplicación. NO son observaciones " +
      "de ningún mercado real ni provienen de ninguna fuente oficial.",
  },
  {
    id: "manual_admin",
    name: "Carga manual del administrador",
    type: "manual",
    requiresAttribution: false,
    notes: "Precios digitados o importados por CSV desde el panel de administración.",
  },
];

export const STORES: Store[] = [
  { id: "demo_plaza", name: "Plaza de mercado (demo)", city: DEMO_CITY, type: "plaza" },
  { id: "demo_super", name: "Supermercado (demo)", city: DEMO_CITY, type: "supermercado" },
];

/** [ingredientId, precio COP, cantidad, unidad] */
type Row = [string, number, number, Unit];

const ROWS: Row[] = [
  // Proteínas
  ["pollo_pechuga", 18900, 1, "kg"],
  ["pollo_muslo", 11500, 1, "kg"],
  ["pollo_entero", 12900, 1, "kg"],
  ["carne_molida", 22000, 1, "kg"],
  ["carne_res", 28000, 1, "kg"],
  ["cerdo_lomo", 21000, 1, "kg"],
  ["cerdo_costilla", 16000, 1, "kg"],
  ["atun_lata", 5200, 160, "g"],
  ["tilapia", 24000, 1, "kg"],
  ["salchicha", 7500, 250, "g"],
  ["chorizo", 9000, 250, "g"],
  // Granos
  ["arroz_blanco", 4800, 1, "kg"],
  ["lenteja", 6500, 1, "kg"],
  ["frijol_rojo", 9500, 1, "kg"],
  ["garbanzo", 9800, 1, "kg"],
  ["arveja_seca", 6800, 1, "kg"],
  ["pasta_espagueti", 3200, 500, "g"],
  ["avena_hojuelas", 4500, 500, "g"],
  ["harina_maiz", 4200, 1, "kg"],
  ["harina_trigo", 3800, 1, "kg"],
  ["pan_tajado", 6500, 18, "unit"],
  ["arepa", 4500, 5, "unit"],
  ["maiz_pira", 4000, 500, "g"],
  // Verduras
  ["papa_pastusa", 2800, 1, "kg"],
  ["papa_criolla", 4500, 1, "kg"],
  ["yuca", 3200, 1, "kg"],
  ["platano_verde", 1500, 1, "unit"],
  ["platano_maduro", 1600, 1, "unit"],
  ["tomate", 4200, 1, "kg"],
  ["cebolla_cabezona", 3800, 1, "kg"],
  ["cebolla_larga", 2500, 250, "g"],
  ["zanahoria", 3000, 1, "kg"],
  ["ahuyama", 2800, 1, "kg"],
  ["habichuela", 5000, 500, "g"],
  ["repollo", 3500, 1, "kg"],
  ["lechuga", 3000, 1, "unit"],
  ["pimenton", 1800, 1, "unit"],
  ["ajo", 1200, 12, "unit"],
  ["cilantro", 1000, 50, "g"],
  ["espinaca", 3500, 250, "g"],
  ["brocoli", 6000, 500, "g"],
  ["arveja_verde", 6500, 500, "g"],
  ["remolacha", 3000, 1, "kg"],
  ["pepino", 2000, 1, "unit"],
  // Frutas
  ["banano", 3500, 1, "kg"],
  ["aguacate", 4500, 1, "unit"],
  ["naranja", 3500, 1, "kg"],
  ["mango", 4500, 1, "kg"],
  ["papaya", 4000, 1000, "g"],
  ["guayaba", 5000, 500, "g"],
  ["limon", 3500, 500, "g"],
  ["maracuya", 6000, 500, "g"],
  ["mora", 6500, 500, "g"],
  ["pina", 6000, 1500, "g"],
  // Lácteos y huevos
  ["huevo", 18000, 30, "unit"],
  ["leche_entera", 4200, 1000, "ml"],
  ["queso_campesino", 9000, 500, "g"],
  ["queso_costeno", 7000, 250, "g"],
  ["yogurt", 7500, 1000, "ml"],
  ["kumis", 7000, 1000, "ml"],
  ["mantequilla", 6500, 125, "g"],
  // Abarrotes
  ["aceite_girasol", 12000, 1000, "ml"],
  ["azucar", 4800, 1, "kg"],
  ["panela", 4000, 500, "g"],
  ["chocolate_mesa", 8500, 250, "g"],
  ["cafe", 9000, 250, "g"],
  ["salsa_tomate", 3500, 200, "g"],
  // Condimentos
  ["sal", 2000, 500, "g"],
  ["pimienta", 2500, 20, "g"],
  ["comino", 2200, 20, "g"],
  ["color_azafran", 2000, 20, "g"],
  ["oregano", 2500, 20, "g"],
  ["laurel", 2000, 20, "unit"],
];

export const DEMO_PRICES: IngredientPrice[] = ROWS.map(([ingredientId, priceCop, quantity, unit]) => ({
  id: `demo_${ingredientId}_${DEMO_WEEK}`,
  ingredientId,
  priceCop,
  quantity,
  unit,
  city: DEMO_CITY,
  storeId: "demo_plaza",
  sourceId: "demo_bogota",
  observedOn: DEMO_OBSERVED_ON,
  confidence: "reported",
  isDemo: true,
}));

/**
 * Historial demo de la semana anterior, para que la pantalla de variación
 * semanal tenga con qué comparar.
 *
 * Los deltas son deterministas (derivados del `id` del ingrediente), no
 * aleatorios: la demo se ve igual cada vez que se carga.
 */
export const DEMO_PREVIOUS_WEEK: IsoDate = "2026-08-31";

export const DEMO_PRICE_HISTORY: PriceHistoryEntry[] = DEMO_PRICES.map((price) => {
  const ingredient = INGREDIENT_BY_ID.get(price.ingredientId)!;
  const normalized = normalizePrice(price, ingredient, DEMO_OBSERVED_ON);
  // Delta determinista entre -6% y +6% a partir del nombre del ingrediente.
  let hash = 0;
  for (const char of price.ingredientId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const delta = ((hash % 121) - 60) / 1000;
  return {
    ingredientId: price.ingredientId,
    week: isoWeek(DEMO_PREVIOUS_WEEK),
    copPerBaseUnit: round(normalized.copPerBaseUnit * (1 + delta), 6),
    city: DEMO_CITY,
  };
});
