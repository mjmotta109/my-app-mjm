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

Campos opcionales que cambian cómo se genera el plan (hay que regenerarlo
después con `POST /plan`):

```json
{
  "cookingTime": {
    "weekday": { "desayuno": 15, "almuerzo": 35, "cena": 25 },
    "weekend": { "desayuno": 40, "almuerzo": 90, "cena": 45 },
    "maxWeekdayDifficulty": "facil"
  },
  "mealPrep": { "enabled": true, "batchSize": 3, "windowDays": 7 },
  "nutritionProfiles": [{
    "id": "p1", "name": "Ana", "kind": "adulto", "sex": "femenino",
    "ageYears": 34, "weightKg": 62, "heightCm": 163,
    "activity": "moderado", "goal": "mantener"
  }]
}
```

Los tres son **opcionales**. Sin `cookingTime` no hay límite de tiempo; sin
`nutritionProfiles` se usa una referencia genérica. Los perfiles físicos **no
cambian las porciones** — esas salen siempre de `adults`/`children`.

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
| `diagnostics.mealsOverTimeBudget` | Comidas que no cupieron en el tiempo declarado. Se planificaron con la receta más rápida disponible, pero el hogar debe saberlo. |
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

## Cocinar por adelantado

### `GET /households/:id/meal-prep?week=1&days=7`

Agrupa las comidas de la ventana que usan la misma receta en una sola tanda.

```json
{
  "week": 1,
  "batchModeEnabled": true,
  "prep": {
    "sessions": [{ "date": "2026-09-07", "label": "Lunes 7", "activeMinutes": 63,
                   "batches": [{ "id": "...", "recipeName": "Sardinas con arroz y limón",
                                 "mealIds": ["..."], "servings": 6, "minutes": 23,
                                 "storage": "nevera", "eatBy": "2026-09-09" }] }],
    "cookFresh": [{ "recipeName": "Huevos pericos", "reason": "Se hace en el momento…" }],
    "minutesIfCookedDaily": 428, "minutesWithPrep": 236, "minutesSaved": 192
  },
  "shoppingBySession": [{ "date": "2026-09-07", "ingredients": [...] }]
}
```

Reglas que la API garantiza:

- **Nunca adelanta lo que solo sirve recién hecho.** Esas comidas salen en
  `cookFresh` con la razón.
- **Nunca estira la conservación.** Lo que no aguanta en nevera va al
  congelador si la receta lo admite (con `freezeNote` diciendo qué porciones),
  y si no, se cocina fresco.
- Una comida aparece en **una sola** tanda o en `cookFresh`, nunca en las dos.
- El costo de la tanda es la suma exacta de lo que el plan ya presupuestó.

`minutesSaved` puede ser 0: si el plan no está en modo tandas
(`Household.mealPrep.enabled`), cada receta sale una vez por semana y no hay
nada que agrupar. Ver [DECISIONS.md](./DECISIONS.md) D18.

### `POST /households/:id/meal-prep/batches/:batchId/cook`

Body: `{ "week": 1, "days": 7 }`.

Descuenta el inventario **una vez** por toda la tanda y marca como cocinadas
**todas** sus comidas. `409 already_cooked` si ya se hizo: el inventario no se
descuenta dos veces.

Los `batchId` se derivan de la ventana, así que hay que pedirlos con
`GET /meal-prep` antes; un id de otra ventana devuelve `404 batch_not_found`.

---

## Nutrición

### `GET /households/:id/nutrition`

```json
{
  "needs": {
    "kcal": 5107,
    "proteinG": { "minG": 172, "targetG": 227, "maxG": 296 },
    "perPerson": [{ "name": "Ana", "needs": {
        "bmrKcal": 1308, "tdeeKcal": 2027, "targetKcal": 2027,
        "usedGenericReference": false, "missing": [], "warnings": [],
        "basis": "Mifflin-St Jeor: 1308 kcal en reposo × 1.55 (moderado) = 2027 kcal…" }}],
    "anyGeneric": false,
    "warnings": []
  },
  "disclaimer": "Estimación con ecuaciones poblacionales. Rinde no es una herramienta médica…"
}
```

- Sin perfiles físicos devuelve la **referencia genérica** (2.000 kcal por
  persona adulta) con `anyGeneric: true` y un aviso. No inventa un peso.
- Cada estimación trae su `basis`: nunca un número sin decir de dónde salió.
- `missing` lista qué datos faltaron.
- **No estima** embarazo, lactancia ni condiciones médicas: devuelve una
  advertencia que deriva a un profesional.
- Nunca baja del piso calórico de seguridad.

Fórmulas, fuentes y límites en [NUTRICION.md](./NUTRICION.md).

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
| `404` | `not_found`, `no_plan`, `meal_not_found`, `batch_not_found` |
| `409` | `already_cooked` |
| `503` | `admin_disabled` — no hay `RINDE_ADMIN_TOKEN` |
