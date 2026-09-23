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

---

## D17 — El tiempo de cocina es un límite, no una preferencia

Una receta de 90 minutos no entra en un martes de 25, por buena que sea en todo
lo demás. Si el tiempo solo restara puntos, una receta larga podría ganar igual
por ser barata o por aprovechar la despensa.

Por eso el tiempo **filtra** candidatas antes de puntuar. Dentro del límite
todavía puntúa (mejor cuanto más margen deje), y la dificultad máxima entre
semana hunde —sin prohibir— lo que el hogar no quiere manejar un miércoles.

Cuando **ninguna** receta cabe, no se deja la comida sin planificar: se toma la
más rápida disponible y se cuenta en `diagnostics.mealsOverTimeBudget`, que la
interfaz muestra. Fallar en silencio sería peor que no tener la función.

Se pregunta por presets ("Siempre corriendo", "Normal", "Me gusta cocinar"), no
por minutos: pedirle al usuario que estime los minutos de cada comida de cada
día es pasarle el trabajo de diseño.

---

## D18 — El meal prep cambia cómo se GENERA el plan 🔍

**Salió de un problema encontrado durante el desarrollo.**

La primera versión agrupaba las comidas ya planificadas: si dos comidas de la
semana usaban la misma receta, se cocinaban juntas. Resultado medido: **0
minutos ahorrados**. Cada tanda cubría exactamente una comida.

La causa era estructural. Con 119 recetas y una puntuación de variedad que
penaliza repetir, el plan reparte 21 recetas distintas en 21 comidas. No había
nada que agrupar, y no lo habría nunca: **la variedad estaba peleando contra el
meal prep**.

Agrupar después no arregla eso. Cocinar por tandas exige que el plan repita cada
plato a propósito, así que es una preferencia del hogar (`Household.mealPrep`)
que cambia la puntuación:

- Dentro de la semana la lógica se **invierte**: completar una tanda ya empezada
  puntúa alto; una vez completa, se pasa a otra receta.
- La variedad se conserva **entre** semanas, para que el mes no se resuelva con
  cuatro recetas (ver D19).
- Lo que solo sirve recién hecho pierde terreno, sin prohibirse.

Medido en el mismo escenario: **21 de 21 comidas adelantadas, 192 minutos
ahorrados** (428 → 236) en la primera semana.

El costo está dicho en la interfaz antes de activarlo: vas a comer el mismo
plato hasta tres veces por semana.

---

## D19 — En modo tandas, el cupo de repeticiones se multiplica 🔍

**Del mismo hallazgo.** Al invertir la variedad dentro de la semana, el mes
entero pasó a resolverse con **11 recetas distintas**: el cupo total de
repeticiones (`maxRepeats`) se agotaba con la primera tanda y después ya no
discriminaba.

El cupo se multiplica por `batchSize`, que es exactamente lo que el modo tandas
hace a propósito. Resultado: **29 recetas distintas** en el mes, con tandas de
tres.

Además, una tanda se reparte **entre días**: la misma receta no sale de almuerzo
y cena el mismo día. Eso no ahorra una olla, solo cansa.

---

## D20 — Una tanda descuenta el inventario UNA vez

Cocinar por adelantado y después marcar cada comida como cocinada descontaría el
inventario tres veces por una sola olla.

`cookBatch()` descuenta las cantidades agregadas de la tanda y marca **todas**
sus comidas como cocinadas de golpe. El motor comparte el descuento con
`cookMeal()` a través de `consumeFromInventory()`: es el mismo código sobre
cantidades distintas, no dos implementaciones que puedan divergir.

El costo de la tanda se **agrega desde las comidas del plan**, no se reescala la
receta: así el meal prep y el presupuesto nunca se descuadran entre sí.

---

## D21 — Los datos físicos son opcionales y no cambian las porciones

Las porciones salen **siempre** de `adults` y `children`. El perfil físico
(`nutritionProfiles`) solo afina las metas de energía y proteína.

Separarlos evita algo que sería muy raro de usar: que dar tu peso cambie cuánta
comida se cocina. Y permite que el camino por defecto —planificar sin dar un
solo dato personal— sea completo, no una versión mutilada.

Lo que el módulo **no** hace, deliberadamente: estimar embarazo, lactancia o
condiciones médicas; bajar del piso calórico de seguridad; o devolver un número
sin decir de dónde salió (cada estimación trae su `basis`, y cuando faltan datos
lo declara en vez de rellenar con un peso plausible).

Fuentes y límites en [NUTRICION.md](./NUTRICION.md).

---

## D22 — El recetario se amplió con criterio de mercado, no de bandera

De 60 a **119 recetas**. Hay curry, salteados, wraps, lasaña y hummus junto al
sancocho y el ajiaco.

El criterio no es de dónde viene el plato: es que **se pueda cocinar aquí**, con
lo que se consigue en una plaza o un supermercado colombiano. Por eso se
añadieron 27 ingredientes (champiñones, quinua, soya texturizada, leche de coco,
tortillas de trigo, arracacha, mazorca) y ninguno que haya que importar.

Los tiempos van de 6 a 90 minutos **a propósito**: sin recetas rápidas de
verdad, el presupuesto de tiempo (D17) no tendría con qué llenar un martes. Los
desayunos, que eran el punto flojo con 15, pasaron a 29.

---

## D23 — Capacitor en vez de TWA para Android

Una **TWA** (Trusted Web Activity) es más barata de montar, pero exige que la
PWA esté hospedada en un dominio propio verificado con `assetlinks.json`: la app
instalada carga la web desde internet.

**Capacitor empaqueta los archivos web DENTRO del APK.** Rinde funciona sin
servidor y sin red por diseño, así que exigir un dominio y un hosting solo para
poder instalarla sería inventar una dependencia que el producto no tiene.

Además da acceso a APIs nativas —almacenamiento, botón atrás, barra de estado—
que una TWA no ofrece.

Costo aceptado: hay que compilar un APK y mantener un proyecto Android en el
repositorio, en vez de solo publicar una web.

---

## D24 — El almacenamiento pasó a ser asíncrono 🔍

El `localStorage` de un WebView **se puede limpiar sin aviso** cuando Android
necesita espacio. Perder la despensa y el plan del mes por eso sería grave, así
que en nativo se usa `SharedPreferences` vía `@capacitor/preferences`.

Ese almacenamiento es asíncrono, y ahí estaba la decisión real. Mantener la API
síncrona habría exigido una caché en memoria que se desincroniza o escribir en
dos sitios a la vez. Se asumió la asincronía.

La consecuencia obliga a algo que es fácil pasar por alto: **la app no dibuja
rutas hasta terminar de hidratar**. Sin ese `ready`, alguien con un plan
guardado vería la pantalla de bienvenida por un instante —y la ruta protegida lo
habría redirigido— antes de que llegaran sus datos. Y no se guarda nada antes de
hidratar, porque escribiría el estado vacío encima de los datos reales.

La interfaz `Storage` que ya existía desde el MVP hizo que esto fuera escribir
una implementación nueva, sin tocar una sola pantalla.

---

## D25 — El build nativo apaga el service worker

Dentro del APK los archivos ya están en el dispositivo: un service worker no
aporta nada y sí puede hacer daño. Después de actualizar la app desde Play,
serviría assets cacheados de la versión anterior y dejaría al usuario con una
mezcla de dos versiones.

`RINDE_TARGET=native` quita el plugin de PWA del build. La versión web lo sigue
usando, que es donde sí sirve.

---

## D26 — El APK se compila en CI, no aquí 🔍

El contenedor de desarrollo tiene JDK y Gradle pero **no el SDK de Android**: la
política de red del entorno bloquea `dl.google.com` con un 403. Es una
denegación de política, no un fallo transitorio, así que no se reintenta.

En vez de dar por bueno un proyecto Gradle sin compilar, el build vive en
`.github/workflows/android.yml`, donde el runner sí trae el SDK. El workflow
verifica que el APK se genere y que no sea sospechosamente pequeño, y lo publica
como artefacto descargable para instalar en un teléfono real.

Esto también evita un emulador: probar en un teléfono de verdad es más rápido y
más fiable que pelear con virtualización anidada dentro de un contenedor.

**Valió la pena de inmediato.** El primer build de CI falló en 24 segundos y
destapó que `npm run typecheck` —el comando que el README le dice al usuario que
corra— estaba roto desde el primer commit: no existía un `tsconfig.json` raíz.
No se había notado porque durante todo el desarrollo se invocó `tsc -b` con los
proyectos explícitos, nunca el script tal como está publicado. CI corre los
comandos publicados; yo corría los que me convenían.

---

## D27 — El presupuesto no se cuadra dando de comer de menos 🍽️

El planificador optimizaba presupuesto, y la forma más barata de cumplir un
presupuesto es servir menos comida. El plan de 2 personas cabía en $800.000
sirviendo **1.748 kcal por persona y día** contra una referencia de 2.000, y
resolvía los desayunos con jugo, café con pan o queso con bocadillo.

Tres cambios, en orden de importancia:

1. **Una comida principal solo se resuelve con un plato.** Cada receta declara
   ahora su `kind` (`plato`, `acompanamiento`, `bebida`, `snack`). Un jugo de
   naranja no es un desayuno por barato que salga, así que no compite por ese
   turno.
2. **Piso nutricional por horario.** `MEAL_MIN_SHARE` fija el mínimo que una
   comida debe aportar de la meta diaria (desayuno 18% de la energía, almuerzo
   28%, cena 22%). Es un límite duro, como el tiempo de cocina: una receta que
   no lo alcanza no se elige. Si **ninguna** lo alcanza se sirve la más
   sustanciosa y **se reporta** en `mealsBelowNutritionFloor`.
3. **`dayFitScore` en vez de `balanceScore`.** La puntuación premia acercarse a
   la meta del día con una meseta entre el 90% y el 125%, no un pico exacto.
   Con un pico, todas las comidas competían por ser "la que completa el día" y
   la variedad colapsaba.

Resultado medido: 1.748 → **2.013 kcal** por persona y día, ningún día por
debajo de 1.500 (antes 5 de 30), 12 desayunos distintos en el mes.

### El diagnóstico se mide sobre lo servido, no sobre la rama tomada

La primera versión contaba las comidas cortas en la rama del `if` que las
seleccionaba. Una receta que fallaba el tiempo **y** el piso se contaba solo
como "se pasó de tiempo", y una comida de 812 kcal contra un piso de 880 se
reportaba como cero incumplimientos. Ahora las dos condiciones se comprueban
sobre la comida que quedó en el plan. Un diagnóstico que se calcula en otro
sitio que el hecho que describe acaba describiendo otra cosa.

---

## D28 — Abaratar una receta sí; redefinirla, no 🥩

Con el presupuesto apretado, el planificador aplicaba **192 sustituciones** en
un plan de 90 comidas. Entre ellas: `pollo_pechuga` → `lenteja` dentro de una
receta llamada **"Arepa rellena de pollo"**. La aritmética estaba bien (la
equivalencia es por proteína, no por peso) y el ahorro era real. Lo que llegaba
a la mesa no era lo que decía el nombre.

Dos reglas nuevas:

- **`defineLaIdentidad(receta, ingrediente)`**: si el nombre del ingrediente
  comparte una palabra significativa con el nombre del plato, no se sustituye
  automáticamente. La sugerencia sigue existiendo para que la persona la acepte
  si quiere; lo que desaparece es el cambio a sus espaldas.
- **`Meal.substitutions` y `Meal.nutrition`**: cada comida viaja con lo que de
  verdad contiene y con su aporte estimado, en vez de obligar a la interfaz a
  recalcularlo desde la receta original (que es exactamente el error que
  cometió la primera versión de las pruebas).

**Lo que costó, dicho sin adornos:** el plan de 2 personas pasó de $745.026 a
~$845.000 y dejó de caber en $800.000. Ese ahorro no existía; era carne
facturada como carne y servida como lenteja.

---

## D29 — El recetario también necesita un piso 📖

Al quitar las sustituciones encubiertas, el presupuesto dejó de cuadrar. La
escalera de presión aprendió entonces a cambiar variedad por dinero (menos peso
a la variedad, más al desperdicio y la reutilización), porque el gasto real no
es lo que se come sino lo que se **compra**: un mes con 47 recetas distintas
deja media despensa de paquetes a medio usar.

Funcionó demasiado bien: el plan cabía en $771.090 usando **once recetas para
noventa comidas**. Cuadrar el dinero a costa de comer lo mismo todos los días
es justo lo que hace que sobre el recetario.

Ahora hay dos límites duros de repertorio, no preferencias puntuadas:

- ninguna receta se repite más de `totalComidas / 24` veces (4 en un mes: una
  vez por semana);
- el mismo plato no se sirve dos veces el mismo día.

La segunda **ya existía** como penalización del 0,15 sobre la puntuación de
variedad, y cedió en cuanto el presupuesto apretó: el plan servía el mismo
bowl en el almuerzo y en la cena. Una regla que se dobla bajo presión no es una
regla.

## Lo que esto deja sobre la mesa, dicho claro

Con los precios de demostración, un mes de comidas completas para 2 personas
—piso nutricional cumplido, sin sustituciones encubiertas, sin repetir un plato
más de una vez por semana— cuesta alrededor de **$845.000**, no $800.000.

El planificador lo dice y muestra el faltante exacto. No lo resuelve sirviendo
menos ni repitiendo, porque las dos salidas consisten en darle a la persona algo
peor de lo que cree estar recibiendo. Las palancas reales —subir el presupuesto,
aceptar más repetición, cocinar menos comidas fuera de casa— son suyas, no
mías.

Recordatorio: **los precios de demostración no son precios reales de mercado**,
así que esa cifra no es una afirmación sobre lo que cuesta comer en Colombia.
Es lo que cuesta con los datos que la app trae dentro, y está etiquetada como
tal en todas partes.
