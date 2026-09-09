import { DEMO_PRICES, DEMO_PRICE_HISTORY, PRICE_SOURCES, STORES } from "@rinde/data";
import { openDb } from "./db.js";
import { SqliteRepository } from "./repository.js";

/**
 * Carga el catálogo de DEMOSTRACIÓN en la base de datos.
 *
 * Todos los precios que inserta llevan `is_demo = 1`. La API los devuelve
 * marcados y la interfaz los muestra como "Datos de demostración". No hay
 * ninguna ruta que convierta un precio demo en un precio real.
 */
const dbFile = process.env["RINDE_DB"] ?? "./data/rinde.db";
const db = openDb(dbFile);
const repository = new SqliteRepository(db);

repository.upsertSources(PRICE_SOURCES);
repository.upsertStores(STORES);
repository.insertPrices(DEMO_PRICES);
repository.insertPriceHistory(DEMO_PRICE_HISTORY);

console.log(`Base de datos: ${dbFile}`);
console.log(`  fuentes:   ${PRICE_SOURCES.length}`);
console.log(`  comercios: ${STORES.length}`);
console.log(`  precios:   ${DEMO_PRICES.length} (TODOS marcados como demostración)`);
console.log(`  historial: ${DEMO_PRICE_HISTORY.length}`);
db.close();
