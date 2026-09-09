# API de Rinde

Backend REST en `apps/api` (Fastify 5 + SQLite). Todas las respuestas son JSON.

**El servidor no reimplementa nada.** Deserializa, llama a `@rinde/core` y
persiste. Son los mismos números que la PWA calcula en el navegador.

```bash
npm run build -w @rinde/api
npm run seed  -w @rinde/api        # carga el catálogo DEMO
PORT=3000 npm run start -w @rinde/api
```

Variables de entorno:

| Variable | Por defecto | Para qué |
|---|---|---|
| `PORT` | `3000` | Puerto |
| `HOST` | `0.0.0.0` | Interfaz |
| `RINDE_DB` | `./data/rinde.db` | Archivo SQLite |
| `RINDE_ADMIN_TOKEN` | *(sin valor)* | Habilita `/admin/*`. **Sin él esas rutas responden 503.** No hay token por defecto. |

---

## Autenticación

En el MVP **no hay cuentas** (§25 del brief). El `householdId` es un
identificador opaco generado por el servidor: quien lo tiene, accede a ese
hogar. Es suficiente para probar el producto y no obliga a nadie a registrarse.

`/admin/*` exige `Authorization: Bearer <RINDE_ADMIN_TOKEN>`.

Cuando llegue Google Sign-In, `household.owner_user_id` (ya en el esquema,
nullable) permite *reclamar* un hogar anónimo sin migrar datos.

---

## Catálogo

### `GET /health`
```json
{ "status": "ok", "ingredients": 73, "recipes": 60, "prices": 73, "asOf": "2026-09-09" }
```

### `GET /catalog/ingredients`
Devuelve `categories`, `ingredients` y `nutritionDisclaimer`. La advertencia
viaja **con los datos**, no solo en la interfaz.

### `GET /catalog/recipes?slot=&tag=&q=`
### `GET /catalog/recipes/:recipeId`

---

## Precios

### `GET /prices?city=&ingredientIds=`

```json
{
  "asOf": "2026-09-09",
  "containsDemo": true,
  "sources": [{ "id": "demo_bogota", "name": "Datos de demostración (Bogotá)", "type": "demo" }],
  "prices": [
    {
      "ingredientId": "pollo_pechuga",
      "copPerBaseUnit": 18.9,
      "baseUnit": "g",
      "confidence": "reported",
      "isDemo": true,
      "sourceId": "demo_bogota",
      "observedOn": "2026-09-07",
      "ageDays": 2,
      "degraded": false
    }
  ]
}
```

Reglas que la API garantiza:

- Un ingrediente **sin precio** devuelve `copPerBaseUnit: null` y una `note`.
  **Nunca `0`.**
- `degraded: true` marca un precio de más de 14 días, degradado a `estimated`.
- `isDemo: true` marca un dato de demostración. No se mezcla con datos reales.

### `GET /prices/:ingredientId/history`

---

## Hogares

### `POST /households` → `201`
```json
{ "adults": 2, "children": 0, "budgetCop": 800000,
  "slots": ["desayuno","almuerzo","cena"], "days": 30, "city": "Bogotá" }
```
Validaciones (todas devuelven `400` con `message` en español):
`budgetCop` entero > 0 · al menos una persona · `slots` no vacío y válido ·
`days` entre 1 y 62.

### `GET /households/:id` · `PATCH /households/:id` · `DELETE /households/:id`
`PATCH` ignora `id` y `tier`: el nivel no se cambia desde el cliente.

---

## Inventario

### `GET /households/:id/inventory`
### `POST /households/:id/inventory` → `201`
```json
{ "ingredientId": "pollo_pechuga", "qtyBase": 1000, "expiresOn": "2026-09-14" }
```
`qtyBase` va **en la unidad base del ingrediente** (`g`, `ml` o `unit`). Un
`ingredientId` fuera del catálogo devuelve `400 unknown_ingredient`.

### `PATCH /households/:id/inventory/:itemId`
`qtyBase: 0` elimina el artículo y devuelve `204`.

### `DELETE /households/:id/inventory/:itemId` → `204`

---

## Plan

### `POST /households/:id/plan` → `201`
Body opcional: `{ "startDate": "2026-09-07", "seed": 12345 }`.

Devuelve el `MealPlan` completo. Campos que importan:

| Campo | Qué es |
|---|---|
| `projectedSpendCop` | Lo que hay que **comprar**, en formatos reales de venta. Es lo que se compara con el presupuesto. |
| `totalFoodValueCop` | Lo que vale toda la comida del periodo, incluido lo que ya estaba en casa. |
| `netRequirements` | Requerimiento neto consolidado por ingrediente. De aquí sale la lista de mercado. |
| `unpricedIngredientIds` | Ingredientes sin precio: el costo está incompleto. |
| `diagnostics.method` | **Siempre `"heuristic"`.** La API nunca afirma optimalidad global. |
| `diagnostics.withinBudget` | Si cupo o no. |
| `diagnostics.repairSteps` | Qué intentó el planificador para abaratar. |
| `diagnostics.warnings` | Avisos en español, listos para mostrar. |

### `GET /households/:id/plan/current`
`404 no_plan` si todavía no se ha generado ninguno.

### `POST /households/:id/meals/:mealId/cook`
Descuenta el inventario con el motor y devuelve `meal`, `consumed`,
`shortages` e `inventory` actualizado.
`409 already_cooked` si ya se cocinó: **el inventario no se descuenta dos veces.**

---

## Mercado

### `GET /households/:id/shopping-list?cycle=1|all`
```json
{ "cycles": 5, "list": { "groups": [...], "totalCop": 264010, "containsDemoPrices": true,
                         "unpricedIngredientIds": [] } }
```
Con `cycle=all`, `list.totalCop` es **exactamente** `plan.projectedSpendCop`.

---

## Funciones

### `POST /households/:id/what-can-i-cook`
Body: `{ "slot": "almuerzo", "limit": 10 }` (ambos opcionales).
Devuelve las recetas ordenadas por cobertura del inventario, con
`coveragePct`, `missingIngredientIds` y `missingCostCop`.

### `POST /households/:id/rinde-mas`
Body: `{ "extraBudgetCop": 50000 }`.
Tres opciones con su canasta, su costo y `extraMeals`. **`extraMeals` puede ser
`null`**: significa que el plan del usuario no tiene datos de esa categoría y
no se puede estimar. La interfaz debe decirlo, no rellenarlo.

---

## Administración de precios

Todas exigen `Authorization: Bearer <RINDE_ADMIN_TOKEN>`.
Sin token configurado: `503 admin_disabled`.

### `POST /admin/prices`
```json
{ "sourceId": "manual_admin",
  "observations": [{ "ingredientId": "pollo_pechuga", "priceCop": 21500,
                     "quantity": 1, "unit": "kg", "city": "Bogotá",
                     "observedOn": "2026-09-07", "confidence": "measured" }] }
```

### `POST /admin/prices/import`
```json
{ "sourceId": "manual_admin", "csv": "ingredient_id,price_cop,..." }
```
Formato en [DATA_SOURCES.md §4](./DATA_SOURCES.md). Cada fila rechazada se
reporta **con su número de línea**; nada se descarta en silencio.

### `GET /admin/prices/validate?csv=...`
Valida sin escribir.

### `GET /admin/price-updates`
Historial de cargas.

---

## Errores

```json
{ "error": "unknown_ingredient", "message": "El ingrediente \"unobtainium\" no está en el catálogo." }
```

| Código | Cuándo |
|---|---|
| `400` | Entrada inválida (`invalid_input`, `unknown_ingredient`, `invalid_quantity`, `invalid_budget`) |
| `401` | Token de administración inválido |
| `404` | `not_found`, `no_plan`, `meal_not_found` |
| `409` | `already_cooked` |
| `503` | `admin_disabled` — no hay `RINDE_ADMIN_TOKEN` |
