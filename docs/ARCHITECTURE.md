# Rinde — Arquitectura (FASE 1)

> **Rinde** — Tu presupuesto. Tu despensa. Tu mes.

Este documento se escribió **antes** de construir la aplicación, como exige la
metodología por fases del brief. Describe el stack elegido, por qué se eligió,
el modelo de datos, la API y las decisiones que condicionan el resto del código.

---

## 1. Requisitos que condicionan la arquitectura

| # | Requisito | Consecuencia arquitectónica |
|---|-----------|-----------------------------|
| 1 | PWA instalable, mobile-first, Android + iOS + desktop | Web app SPA + service worker + manifest |
| 2 | Debe poder convertirse en app Android para Google Play **sin reconstruir** | Nada específico del navegador en la lógica de negocio; envoltorio nativo posterior (Capacitor) sobre el mismo build web |
| 3 | La lógica determinista controla dinero, cantidades y unidades | Motor puro, sin I/O, sin red, sin LLM, en un paquete propio y testeable |
| 4 | Usable **sin registro** | La app debe funcionar 100% en el dispositivo; el backend es opcional |
| 5 | Backend separado, API clara | El motor se ejecuta igual en el navegador y en el servidor |
| 6 | Precios de fuentes reales, nunca inventados | Capa de ingesta con procedencia, confianza y fecha por cada precio |
| 7 | La IA complementa, no sustituye el cálculo | La IA solo produce *intenciones estructuradas*; el motor valida y calcula |

---

## 2. Stack elegido

### Lenguaje: TypeScript en todo el repositorio
El mismo motor de cálculo se ejecuta en el navegador (modo sin registro,
offline) y en el servidor (modo sincronizado, futura app Android). Escribirlo
dos veces en dos lenguajes garantizaría divergencia en los números — que es
exactamente lo que el brief prohíbe. Un solo `@rinde/core` compilado a ES2022
resuelve esto.

### Monorepo con **npm workspaces**
Sin herramienta extra (Nx, Turborepo): el proyecto todavía no la justifica y
`npm workspaces` viene incluido en Node. Se puede migrar después sin tocar
código.

```
rinde/
├── packages/
│   ├── core/     @rinde/core   — motor determinista puro. CERO dependencias.
│   └── data/     @rinde/data   — catálogo demo: ingredientes, recetas, precios.
├── apps/
│   ├── web/      @rinde/web    — PWA (React + Vite). El producto.
│   └── api/      @rinde/api    — backend REST (Fastify + SQLite).
└── docs/
```

### Frontend: **React 19 + Vite 7 + TypeScript + React Router 7**
- React: el ecosistema con mejor camino a nativo (React Native / Capacitor) si
  algún día se necesita más que un WebView.
- Vite: build rápido, salida estática, soporte de PWA maduro.
- **`vite-plugin-pwa`** (envuelve Workbox) para el service worker y el manifest.
  Es la opción estándar y mantenida; no se escribe un service worker a mano.
- **Sin framework de UI** (no MUI, no Chakra). El brief pide una identidad
  concreta (Notion + fintech + comida). Un design system propio en CSS
  variables es más pequeño, más rápido en móvil y no pelea con la marca.
- **Sin librería de estado global** (no Redux/Zustand). El estado es un único
  documento del hogar; React Context + `useReducer` + persistencia en
  IndexedDB/localStorage es suficiente y evita dependencia innecesaria.

### Backend: **Fastify 5 + SQLite**
- Fastify: servidor Node maduro, rápido, con validación de esquemas integrada.
- SQLite: el modelo de datos es relacional (ingredientes ↔ recetas ↔ precios ↔
  inventario). Empezar con SQLite y migrar a PostgreSQL después es un cambio de
  driver, no de diseño, porque todo el acceso pasa por una interfaz `Repository`.
- **El backend no es obligatorio para el MVP.** La PWA funciona sin él.

### Tests: **Vitest**
Mismo runtime y misma resolución de módulos que Vite. Los tests del motor son
puros y rápidos.

---

## 3. La decisión central: el motor es una librería, no un servicio

```
        ┌──────────────────────────────────────────┐
        │            @rinde/core                   │
        │  unidades · escalado · costos · plan     │
        │  inventario · lista · sustituciones      │
        │  FUNCIONES PURAS — sin red, sin reloj,   │
        │  sin aleatoriedad, sin LLM               │
        └───────────────┬──────────────────────────┘
                        │ misma función, mismos números
          ┌─────────────┴─────────────┐
          ▼                           ▼
   ┌─────────────┐            ┌──────────────┐
   │ @rinde/web  │            │  @rinde/api  │
   │  PWA        │            │  Fastify     │
   │  offline    │            │  SQLite      │
   └─────────────┘            └──────────────┘
```

Consecuencias deliberadas:

1. **Determinismo comprobable.** `core` no llama a `Date.now()` ni a
   `Math.random()`. La fecha "hoy" y la semilla de variedad se *inyectan*. El
   mismo input produce siempre el mismo plan, lo que hace los tests reales.
2. **La app funciona sin servidor.** Requisito 4 del brief.
3. **El futuro Android no reconstruye nada.** El motor ya es portable.
4. **Sustituir la heurística por un optimizador** (ILP/CP-SAT) es cambiar una
   implementación detrás de la interfaz `MealPlanner`, no reescribir la app.

### La frontera de la IA

`core` **no importa ningún cliente de LLM.** La IA vive fuera y solo puede
producir un objeto tipado que el motor valida:

```
"Tengo un poquito de pollo, unas papas y tres tomates"
        │  (LLM — solo interpretación de lenguaje)
        ▼
  [{ingredientId:"pollo_pechuga", qty:250, unit:"g", confidence:"low"}, …]
        │  (motor determinista — validación, conversión, costeo)
        ▼
  inventario actualizado, costos calculados
```

El LLM nunca suma, nunca convierte unidades y nunca decide si algo cabe en el
presupuesto. En el MVP el parser de lenguaje natural es **determinista**
(léxico + reglas de cantidad en español); el adaptador de LLM es una interfaz
declarada, no una dependencia activa.

---

## 4. Reglas numéricas

### Dinero
Todo el dinero son **enteros de pesos colombianos (COP)**. No hay decimales, no
hay `float` en ninguna parte del cálculo de precios. El COP no usa centavos en
la práctica. Las divisiones (costo por porción, prorrateo de un ingrediente
entre comidas) usan división entera con reparto del residuo, de modo que la
suma de las partes es **exactamente** igual al total. Esto se testea.

### Unidades
Tres dimensiones canónicas: **g** (masa), **ml** (volumen), **unit** (conteo).
Toda cantidad se normaliza a su base antes de operar. Las conversiones entre
dimensiones (una taza de arroz → gramos; un huevo → gramos) requieren datos por
ingrediente (`gramsPerUnit`, `gramsPerMl`); si el dato no existe, la conversión
**falla explícitamente** en vez de adivinar.

### Porciones (§9 del brief)
Escalar 4→2 personas da factores fraccionarios. `0.37 huevos` no se le muestra
a nadie. Cada ingrediente declara cómo se redondea al presentarlo:
- `discrete` (huevo, aguacate, arepa): se redondea a la unidad, mínimo 1.
- `continuous` (arroz, aceite): se redondea a un paso legible (5 g, 10 g…).
El **cálculo del costo usa la cantidad redondeada**, no la fraccionaria, para
que lo que se muestra y lo que se cobra sean el mismo número.

---

## 5. Modelo de datos

Entidades del brief §24, con las llaves que realmente usa el motor.

```
FoodCategory   id, nombre, orden (define el orden de la lista de mercado)

Ingredient     id, nombre, categoryId, unidad base (g|ml|unit),
               gramsPerUnit?, gramsPerMl?, rounding (discrete|continuous),
               roundingStep, formatos de compra (packSizes),
               perecedero, díasDeVidaÚtil?, etiquetas (proteína, grano…),
               nutrición por 100 g + fuente + esEstimado

IngredientPrice  ← el corazón de §17/§18
               id, ingredientId, precio (COP entero), cantidad, unidad,
               ciudad/región, storeId?, sourceId, fechaObservación,
               fechaCarga, confianza (measured|reported|estimated),
               esDemo (booleano, NUNCA se mezcla con precio real)

PriceSource    id, nombre, tipo (api|csv|manual|public|commercial),
               licencia, url, requiereAtribución, notas legales

Store          id, nombre, ciudad, tipo (plaza|supermercado|tienda)

PriceUpdate    id, sourceId, semanaISO, #registros, #cambios, estado, log
PriceHistory   ingredientId, semanaISO, precioUnitario, variación%

Recipe         id, nombre, descripción, porciones base, minutos, dificultad,
               categoría (desayuno|almuerzo|cena|snack), región, etiquetas,
               restricciones que cumple, pasos, nutrición estimada,
               prep (se puede adelantar, días en nevera, congelable)
RecipeIngredient  recipeId, ingredientId, cantidad, unidad, opcional?,
               sustitucionesPermitidas[]

Household      id, adultos, niños, presupuesto mensual (COP), ciudad,
               comidas activas, díasDelPlan, preferencias, exclusiones,
               tiempoDeCocina?, modoTandas?, perfilesFísicos?

CookingTimeBudget  minutos por comida entre semana y fin de semana,
               dificultad máxima entre semana
MealPrepPreference batchSize (comidas por tanda), windowDays
PersonProfile  sexo?, edad?, peso?, estatura?, actividad, objetivo, banderas?
               (TODO opcional: Rinde planifica sin datos personales)
UserPreference  householdId, tipo (dislike|allergy|diet), valor, severidad

InventoryItem  id, householdId, ingredientId, cantidad, unidad,
               vencimiento?, precioReferencia?, actualizadoEn

MealPlan       id, householdId, fechaInicio, días, presupuesto,
               costoProyectado, generadoCon (versión del planificador), semilla
Meal           id, planId, fecha, slot, recipeId, porciones,
               costoEstimado, estado (planned|cooked|skipped)

ShoppingList   id, planId, total estimado, generadaEn
ShoppingListItem  ingredientId, cantidadAComprar, unidad, formatoDeCompra,
               precioUnitarioUsado, costoLínea, priceConfidence, comprado

Leftover       id, householdId, ingredientId, cantidad, unidad, origenMealId,
               vence
```

**Regla dura sobre precios:** un `IngredientPrice` sin `sourceId` no existe.
Cada precio arrastra de dónde salió, cuándo y con qué confianza, hasta la
interfaz. Ver [DATA_SOURCES.md](./DATA_SOURCES.md).

---

## 6. API

REST sobre HTTP, JSON. Contrato completo en [API.md](./API.md). Resumen:

```
GET    /health
GET    /catalog/ingredients        catálogo + nutrición
GET    /catalog/recipes            filtros: slot, tags, maxCost
GET    /catalog/recipes/:id
GET    /prices?city=&ingredientIds=   precio vigente + procedencia
GET    /prices/:ingredientId/history

POST   /households                 crea hogar (anónimo, sin credenciales)
GET    /households/:id
PATCH  /households/:id
GET    /households/:id/inventory
POST   /households/:id/inventory
PATCH  /households/:id/inventory/:itemId
DELETE /households/:id/inventory/:itemId

POST   /households/:id/plan        genera plan  → motor
GET    /households/:id/plan/current
POST   /households/:id/meals/:mealId/cook    descuenta inventario
GET    /households/:id/shopping-list
POST   /households/:id/what-can-i-cook
POST   /households/:id/rinde-mas   { extraBudget }

POST   /admin/prices               carga manual   (requiere rol admin)
POST   /admin/prices/import        importación CSV
GET    /admin/price-updates
```

Decisiones:
- **Sin autenticación obligatoria en el MVP.** El `householdId` es un UUID
  opaco generado por el cliente; quien lo tiene, accede. Las rutas `/admin/*`
  sí exigen un token. Cuando llegue Google Sign-In, el hogar anónimo se
  *reclama* asociándolo a un `userId` — la migración ya está prevista en el
  esquema (`Household.ownerUserId` nullable).
- **El servidor ejecuta el mismo `@rinde/core`.** `POST /plan` no reimplementa
  nada; deserializa, llama al motor, persiste el resultado.
- **Versionado:** prefijo `/v1` en producción.
- **El plan se persiste como documento JSON**, no normalizado en tablas de
  comidas y líneas. Un plan es un artefacto generado e inmutable: se regenera
  entero, nunca se edita comida por comida. Lo que sí cambia con el uso (si una
  comida ya se cocinó) vive en su propia tabla `meal_status` y se superpone al
  leer. Normalizar el resto llegará cuando haga falta consultar **entre**
  planes. Ver [DECISIONS.md](./DECISIONS.md) D12.

El contrato completo, con ejemplos y códigos de error, está en
[API.md](./API.md).

---

## 7. Estrategia PWA

- **App shell** (HTML, JS, CSS, iconos, fuentes): precache, `CacheFirst`.
- **Catálogo** (ingredientes, recetas): `StaleWhileRevalidate` — cambia poco y
  debe estar disponible offline.
- **Precios**: `NetworkFirst` con caída a caché **y una etiqueta visible de
  desactualizado**. Un precio viejo mostrado como vigente es exactamente el
  fallo que el brief prohíbe.
- **Datos del hogar** (inventario, plan): fuente de verdad **local**
  (IndexedDB). Funcionan offline por definición.

Lo que **no** funciona offline, y se dice en la interfaz: actualizar precios,
sincronizar entre dispositivos, y cualquier función de IA.

---

## 8. Camino a Android (Google Play)

La PWA se empaqueta con **Capacitor**, que envuelve el build web en un proyecto
Android nativo. Requisitos que el código de hoy ya respeta para no cerrar esa
puerta:

- El build de `web` es estático — no necesita servidor propio.
- Sin rutas absolutas al host; el router funciona con `hash` o `history` según
  configuración.
- Toda llamada de red pasa por un único `apiClient` con `baseURL`
  configurable — en Android apuntará al backend desplegado.
- El almacenamiento pasa por una interfaz `Storage`, no por `localStorage`
  directo, para poder cambiar a almacenamiento nativo.
- Sin APIs exclusivas del navegador en la lógica de negocio.

TWA (Trusted Web Activity) es la alternativa más barata, pero Capacitor da
acceso a cámara y notificaciones sin reescribir — por eso es el camino previsto.

---

## 9. Freemium (§28) — preparación, sin cobros

`Household.tier: "free" | "premium"` y un único módulo `entitlements.ts` que
responde `can(feature, tier)`. Las pantallas preguntan a ese módulo. No hay
integración de pagos, ni SDK de facturación, ni pantallas de compra. Añadir
Google Play Billing después es implementar un proveedor que devuelva el `tier`.

---

## 10. Lo que este MVP **no** hace

Declarado explícitamente para que nadie lo asuma:

- **No encuentra el plan óptimo global.** Usa una heurística voraz con
  penalizaciones (§31 del brief). Lo dice en la interfaz (`diagnostics.method`
  es siempre `"heuristic"`) y en el código. El planificador **apunta a usar el
  95% del presupuesto** en vez de minimizar el gasto: el presupuesto es el
  dinero que el hogar tiene para comer, no solo un techo. Por qué, y qué pasó
  cuando se hizo al revés, en [DECISIONS.md](./DECISIONS.md) D7.
- **No trae precios reales automáticamente.** No hay ninguna API de precios
  conectada; ver `DATA_SOURCES.md` para por qué y qué haría falta.
- **No es una herramienta médica.** La nutrición es estimada y está marcada
  como tal. Las alergias se tratan como exclusiones duras + advertencia. Las
  necesidades energéticas usan ecuaciones poblacionales, con sus fuentes y sus
  límites en [NUTRICION.md](./NUTRICION.md); no bajan del piso de seguridad y
  no estiman embarazo, lactancia ni condiciones médicas.
- **No sincroniza entre dispositivos** todavía (no hay cuentas).
- **No usa un LLM** en el MVP. La interfaz está declarada; no hay clave de API
  ni llamada activa.
