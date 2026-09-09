# Decisiones de diseño

Cada entrada dice qué se decidió, por qué, y qué habría que cambiar para
revertirlo. Las que salieron de encontrar un problema real durante el
desarrollo están marcadas.

---

## D1 — Todo el dinero es un entero de COP

El peso colombiano no usa centavos en la práctica. Trabajar en enteros elimina
los errores de coma flotante y hace que las sumas mostradas cuadren.

Las divisiones (costo por persona, prorrateo de un ingrediente) usan reparto
del residuo mayor: **la suma de las partes es exactamente igual al total**.
Está testeado con totales impares.

---

## D2 — El motor es una librería, no un servicio

`@rinde/core` no tiene dependencias, no hace I/O, no lee el reloj y no usa
`Math.random()`. Se ejecuta igual en el navegador y en el servidor.

Consecuencias: la PWA funciona sin registro y sin red; el futuro Android no
reescribe la lógica; los tests son deterministas y por tanto significan algo.

Para revertir: habría que duplicar la lógica en el backend, que es exactamente
la divergencia numérica que el brief prohíbe.

---

## D3 — La IA no toca los números

El brief lo pide en §23 y aquí es estructural: `@rinde/core` no importa ningún
cliente de LLM y no puede hacerlo sin romper su regla de cero dependencias.

En el MVP el intérprete de lenguaje natural es **determinista** (léxico y
reglas en español). Cuando se conecte un LLM, su salida tendrá que pasar por
`validateParsedItems` igual que cualquier otra entrada.

**Una cantidad vaga no se convierte en un número.** "Un poquito de pollo"
devuelve `qtyBase: null` y `needsConfirmation: true`, y la interfaz pregunta.
Adivinar que son 200 g contaminaría el presupuesto entero con un dato falso.

---

## D4 — Dos costos distintos por comida, y no son lo mismo

- `costCop` — lo que **vale** la comida: todos sus ingredientes a precio de
  referencia, incluidos los que ya estaban en casa. Es lo que se muestra.
- `purchaseCop` — lo que hay que **gastar de más**: solo lo que falta. Es lo
  que se compara con el presupuesto.

Confundirlos haría que tener comida en casa "aumentara" el gasto proyectado.

---

## D5 — Un ingrediente sin precio no vale $0

`PriceIndex.costOf()` devuelve `null`, nunca `0`. La comida queda marcada como
`costIncomplete`, el ingrediente se reporta en `unpricedIngredientIds`, y la
interfaz muestra **"Sin precio"**. Un `0` diría "es gratis", que es falso.

---

## D6 — Consolidar la compra al final, no comida a comida

El §14 del brief describe el problema: comprar 500 g + 300 g + 700 g de pollo
para tres recetas en vez de una cantidad consolidada.

La despensa virtual acumula el **requerimiento neto** por ingrediente a lo
largo de todo el plan, y el formato de venta (libra, kilo, panal) se aplica
**una sola vez** sobre ese neto. Por eso la lista dice "2 kg de pollo" una vez
y no tres líneas.

Efecto secundario buscado: el sobrante de comprar por formato vuelve a la
despensa y lo aprovechan las comidas siguientes.

---

## D7 — El presupuesto es un recurso, no solo un techo 🔍

**Salió de un problema encontrado durante el desarrollo.**

La primera versión puntuaba el costo de forma relativa: la opción más barata
del turno ganaba siempre. Resultado con $800.000 para 2 personas: un plan de
**$258.742**, dejando $541.258 sin usar, con "avena en agua" de desayuno tres
días seguidos y $1.439 por comida y persona.

Técnicamente cabía en el presupuesto. Como producto era un fracaso: dejaba a
la familia comiendo peor de lo que podía permitirse.

La versión actual **apunta a usar el 95% del presupuesto**: se premia acercarse
a lo que la comida *puede* costar, y pasarse penaliza mucho más rápido que
quedarse corto. El objetivo por comida se recalcula en cada turno a partir de
lo ya gastado, así que gastar de más ahora aprieta lo que viene.

Mismo escenario, versión actual: **$658.548**, 36 recetas distintas, $3.486 por
comida y persona.

El 5% restante es colchón: el gasto real se calcula sobre formatos de venta, y
siempre queda por encima de la suma de los déficits comida a comida.

---

## D8 — Un plato no se repite con menos de dos días de diferencia 🔍

**Del mismo hallazgo.** Sin esta regla, el plato más barato del catálogo se
apodera de un horario completo. La penalización por repetición cercana
(`REPEAT_DAMPING`) hunde la puntuación de una receta usada hace menos de dos
días. Solo se ignora si literalmente no hay otra opción para ese turno.

---

## D9 — Las sustituciones de proteína se equiparan por proteína, no por peso

Reemplazar 500 g de carne por 500 g de lentejas no es equivalente y decirlo
sería engañar sobre la nutrición del plan. Cuando ambos ingredientes son
fuentes proteicas y tienen dato, la equivalencia es **por proteína**; en
cualquier otro caso, por peso. La base viaja con la sugerencia (`basis`) y la
interfaz la muestra.

Sin precio de alguno de los dos, **no se afirma ningún ahorro**: la sugerencia
simplemente no existe.

---

## D10 — "Rinde más" se calcula con el plan del usuario, no con constantes

Para decir cuántas comidas añade 1 kg de pollo hace falta saber cuánto pollo
lleva una comida. Ese número se **mide sobre el plan real del usuario**, no se
inventa un "gramos por persona" genérico.

Si el plan no tiene comidas de esa categoría, `extraMeals` es `null` y la
interfaz dice que no se puede estimar. No se rellena con un número plausible.

---

## D11 — `HashRouter` en vez de rutas de historial

El build es estático y tiene que funcionar servido desde cualquier
subdirectorio y, más adelante, desde el sistema de archivos dentro del
contenedor de Android. Con rutas de historial haría falta que el servidor
reescribiera todas las URL a `index.html` — justo la dependencia que cierra la
puerta al empaquetado nativo.

Coste aceptado: URLs con `#`.

---

## D12 — El plan se guarda como documento JSON; el estado de cada comida, no

Un plan es un artefacto **generado e inmutable**: se regenera entero, nunca se
edita comida por comida. Normalizarlo en tablas de comidas y líneas añadiría
código sin habilitar ninguna consulta que el MVP necesite.

Lo que **sí** cambia con el uso —si una comida ya se cocinó— vive en su propia
tabla `meal_status` y se superpone al leer. Cuando haga falta consultar entre
planes (analítica, historial), ahí toca normalizar.

---

## D13 — Sin `RINDE_ADMIN_TOKEN`, la administración queda deshabilitada

No hay token por defecto. Sin la variable configurada, `/admin/*` responde
`503` explicando por qué. Un valor por defecto en el código es una credencial
conocida esperando a llegar a producción.

---

## D14 — Los datos demo no pueden disfrazarse de reales

- Todo precio demo lleva `isDemo: true` desde el catálogo hasta la pantalla.
- Un precio demo y uno real **nunca se promedian**; ante ambos, gana el real.
- Toda la nutrición lleva `nutritionIsEstimated: true`, sin excepción, porque
  no se pudo consultar ninguna tabla de composición verificada.
- Un precio de más de 14 días se degrada solo a `estimated`.

---

## D15 — El niño cuenta como 0,7 de la porción de un adulto

Es un **supuesto de planificación**, no un dato nutricional medido. Está
declarado como constante con nombre (`DEFAULT_CHILD_FACTOR`), es un parámetro
inyectable, y la interfaz lo dice en Perfil.

---

## D16 — Se descartó el scraping de supermercados

Ninguna cadena colombiana ofrece una API pública de precios que se haya podido
verificar. Sus términos de servicio normalmente prohíben el scraping y el brief
también. La arquitectura deja el hueco (`PriceSource.type = "commercial"`) sin
escribir código.

Tampoco se escribió un adaptador de SIPSA: desde el entorno de desarrollo no se
pudo abrir ni un endpoint, así que **no se conoce el esquema real de campos**.
Escribir un adaptador con nombres de columna supuestos sería inventar una API.
Ver [DATA_SOURCES.md](./DATA_SOURCES.md).
