import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Esquema y apertura de la base de datos.
 *
 * SQLite para el MVP. Todo el acceso pasa por `repository.ts`, así que migrar
 * a PostgreSQL es cambiar esa implementación, no el resto del servidor.
 *
 * DECISIÓN SOBRE `meal_plan`: el plan se guarda como un documento JSON, no
 * normalizado en tablas de comidas y líneas. Un plan es un artefacto generado
 * e inmutable — se regenera entero, nunca se edita comida por comida — y
 * normalizarlo solo añadiría código sin habilitar ninguna consulta que el MVP
 * necesite. Lo que SÍ cambia con el uso (si una comida ya se cocinó) vive en
 * `meal_status`, que es su propia tabla. Cuando haga falta consultar entre
 * planes (analítica, historial), ahí sí toca normalizar.
 */

export type Db = Database.Database;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS household (
  id             TEXT PRIMARY KEY,
  adults         INTEGER NOT NULL,
  children       INTEGER NOT NULL,
  budget_cop     INTEGER NOT NULL,
  city           TEXT    NOT NULL,
  slots          TEXT    NOT NULL,   -- JSON: MealSlot[]
  days           INTEGER NOT NULL,
  preferences    TEXT    NOT NULL,   -- JSON: UserPreference[]
  tier           TEXT    NOT NULL DEFAULT 'free',
  created_on     TEXT    NOT NULL,
  -- Nulo mientras el hogar sea anónimo. Cuando llegue Google Sign-In, el
  -- hogar se "reclama" escribiendo aquí: no hace falta migrar datos.
  owner_user_id  TEXT,
  -- JSON. Nulos cuando el hogar no los ha configurado, que es lo normal:
  -- Rinde planifica sin límite de tiempo y sin datos físicos de nadie.
  cooking_time       TEXT,
  meal_prep          TEXT,
  nutrition_profiles TEXT
);

CREATE TABLE IF NOT EXISTS inventory_item (
  id                   TEXT PRIMARY KEY,
  household_id         TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  ingredient_id        TEXT NOT NULL,
  qty_base             REAL NOT NULL,
  expires_on           TEXT,
  reference_price_cop  INTEGER,
  updated_on           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inventory_household ON inventory_item(household_id);

CREATE TABLE IF NOT EXISTS meal_plan (
  id            TEXT PRIMARY KEY,
  household_id  TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  payload       TEXT NOT NULL,       -- JSON: MealPlan
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plan_household ON meal_plan(household_id, created_at DESC);

CREATE TABLE IF NOT EXISTS meal_status (
  plan_id    TEXT NOT NULL REFERENCES meal_plan(id) ON DELETE CASCADE,
  meal_id    TEXT NOT NULL,
  status     TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  PRIMARY KEY (plan_id, meal_id)
);

CREATE TABLE IF NOT EXISTS price_source (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  type                 TEXT NOT NULL,
  url                  TEXT,
  license              TEXT,
  requires_attribution INTEGER NOT NULL DEFAULT 0,
  notes                TEXT
);

CREATE TABLE IF NOT EXISTS store (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  type TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS price (
  id            TEXT PRIMARY KEY,
  ingredient_id TEXT    NOT NULL,
  price_cop     INTEGER NOT NULL,
  quantity      REAL    NOT NULL,
  unit          TEXT    NOT NULL,
  city          TEXT    NOT NULL,
  store_id      TEXT,
  -- Sin fuente no hay precio: es la regla del §18 escrita en el esquema.
  source_id     TEXT    NOT NULL REFERENCES price_source(id),
  observed_on   TEXT    NOT NULL,
  confidence    TEXT    NOT NULL,
  is_demo       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_price_lookup ON price(ingredient_id, city, observed_on DESC);

CREATE TABLE IF NOT EXISTS price_history (
  ingredient_id      TEXT NOT NULL,
  week               TEXT NOT NULL,
  city               TEXT NOT NULL,
  cop_per_base_unit  REAL NOT NULL,
  PRIMARY KEY (ingredient_id, week, city)
);

CREATE TABLE IF NOT EXISTS price_update (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id  TEXT NOT NULL,
  week       TEXT NOT NULL,
  accepted   INTEGER NOT NULL,
  rejected   INTEGER NOT NULL,
  errors     TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

/**
 * Columnas añadidas después de la primera versión del esquema.
 *
 * `CREATE TABLE IF NOT EXISTS` no toca una tabla que ya existe, así que una
 * base creada antes se quedaría sin estas columnas y las escrituras fallarían
 * en silencio. Se añaden aquí, comprobando primero si ya están.
 */
const MIGRATIONS: { table: string; column: string; definition: string }[] = [
  { table: "household", column: "cooking_time", definition: "TEXT" },
  { table: "household", column: "meal_prep", definition: "TEXT" },
  { table: "household", column: "nutrition_profiles", definition: "TEXT" },
];

function migrate(db: Db): void {
  for (const { table, column, definition } of MIGRATIONS) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (columns.some((entry) => entry.name === column)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function openDb(file: string): Db {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.exec(SCHEMA);
  migrate(db);
  return db;
}
