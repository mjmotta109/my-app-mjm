# Anexos de nutrición

> **Rinde no es una herramienta médica ni dietética.** Nada de lo que hay aquí
> es un consejo de salud, ni sustituye a un profesional. Sirve para dimensionar
> cuánta comida comprar y cocinar, no para prescribir una dieta.

Dos anexos, porque son dos problemas distintos con fuentes distintas:

- **Anexo A** — qué tiene la comida (composición de alimentos).
- **Anexo B** — cuánto necesita una persona (necesidades según estado físico).

---

# Anexo A — Composición de los alimentos

## A.1 De dónde salen los valores

De la **tabla de composición de alimentos de USDA FoodData Central**, bajada de
la fuente oficial por CI (`.github/workflows/tablas-nutricion.yml`), para **92
de los 100 ingredientes**. Los 8 restantes siguen siendo aproximaciones y
siguen marcados como estimados.

| Estado | Ingredientes | Qué significa |
|---|---|---|
| Exacto | 72 | El mismo alimento, en la misma forma (crudo, seco, enlatado) |
| Equivalente más cercano | 20 | La tabla no trae el producto; se usa el más parecido y **se dice cuál** |
| Sin equivalente | 8 | Papa criolla, panela, arracacha, bocadillo, kumis, queso costeño, el color y el café. Siguen estimados |

Dónde está cada cosa, para poder auditarla:

- **`packages/data/tablas/usda/FUENTE.md`** — URL de cada archivo, su SHA-256,
  fecha de descarga y enlace a la ejecución de CI que lo bajó.
- **`packages/data/tablas/usda/sr_legacy.csv`** y **`foundation.csv`** — los
  cinco nutrientes que usa Rinde, por 100 g, de los 7.793 alimentos de SR Legacy
  (2018-04) y los 378 de Foundation Foods (2026-04). Lo que la tabla no midió
  queda vacío, no en cero.
- **`packages/data/tablas/emparejamiento.csv`** — qué ingrediente es qué fila de
  la tabla. Se decidió **a mano, ingrediente por ingrediente**, y cada
  equivalente cercano lleva una nota (la posta se aproxima con la bola; el
  maracuyá de la tabla es la granadilla morada; la harina de maíz precocida no
  está y se usa la desgerminada).
- **`scripts/tablas/generar_nutricion.py`** — copia los números de la fila
  elegida. No decide nada. Una prueba relee el CSV y los compara uno por uno.

En la app, cada ingrediente trae en `nutritionSource` la tabla, el número FDC y
la descripción textual del alimento usado; si es un equivalente cercano, lo dice
en esa misma cadena.

### Lo que la tabla corrigió

El catálogo viejo tenía errores que la tabla destapó: el plátano verde traía el
valor del maduro (122 kcal; la tabla dice 152), la ahuyama era la de la calabaza
de otra especie (26 → 45 kcal, butternut) y "el color" traía la composición del
azafrán, que es otro producto.

### Límites que no se van con la tabla

- **Son alimentos muestreados en Estados Unidos.** Una variedad colombiana
  puede diferir: la mazorca de aquí es menos dulce, el aguacate criollo no es el
  Hass.
- **La licencia no está verificada.** La página de descargas de USDA no la
  menciona y el CI no la encontró en otras páginas del sitio
  (`tablas/usda/LICENCIA.md`). Antes de publicar la app en una tienda hay que
  confirmarla en fdc.nal.usda.gov.
- **La tabla colombiana del ICBF no se usa.** Existe y es la correcta para los
  8 ingredientes que faltan, pero sus PDF traen el permiso `copy:no`. Ver
  `tablas/icbf/DECISION.md`.

La nutrición de una **receta** sigue siendo siempre estimada, aunque sus
ingredientes vengan de la tabla: lo que se suma son ingredientes crudos, y
cocinar cambia los números (ver A.2).

## A.2 Cómo se suma una receta

```
nutrición de la receta = Σ (nutrición por 100 g del ingrediente × gramos / 100)
```

Lo que este cálculo **no** considera, y por eso es una estimación aunque los
datos de entrada fueran perfectos:

| No considera | Efecto |
|---|---|
| Pérdidas por cocción | Las vitaminas hidrosolubles se van en el agua de cocción |
| Absorción de grasa al freír | Un patacón absorbe aceite que no está en el plátano crudo |
| Variedad concreta del producto | Un aguacate Hass y uno criollo no son lo mismo |
| Parte no comestible | Se asume que lo que se pesa es lo que se come |
| Agua ganada o perdida | El arroz crudo pesa mucho menos que cocido |

Un ingrediente **sin dato nutricional no cuenta como cero**: aparece en
`missingIngredientIds` y el total queda declarado como incompleto — la misma
regla que se aplica a los precios.

## A.3 Unidad de referencia

Toda la nutrición del catálogo está **por 100 g de producto**, siempre.

Para ingredientes cuya unidad base no es el gramo (un huevo, una arepa, la
leche en ml), la conversión usa `gramsPerUnit` o `gramsPerMl` del propio
ingrediente. Si el dato falta, el motor **no adivina**: reporta el ingrediente
como incompleto.

Unificar el denominador evita el error clásico de sumar "por unidad" y "por 100
g" en la misma cuenta.

---

# Anexo B — Necesidades según el estado físico

## B.0 Lo primero: esto es opcional

Rinde planifica **sin saber el peso, la estatura ni la edad de nadie**. Ese es
el camino por defecto y funciona completo. Los datos físicos solo cambian las
metas de energía y proteína; **no cambian cuántas porciones se cocinan** —
las porciones salen siempre de cuántos adultos y niños hay.

Esa separación es deliberada: dar el peso no debería hacer que la app cocine
distinto, solo que estime mejor.

Todo se guarda **solo en el dispositivo**. Ver §27 del brief y `PRIVACIDAD` en
el README.

## B.1 Gasto en reposo — Mifflin-St Jeor

```
hombres:  10 × peso(kg) + 6,25 × estatura(cm) − 5 × edad(años) + 5
mujeres:  10 × peso(kg) + 6,25 × estatura(cm) − 5 × edad(años) − 161
```

**Fuente:** Mifflin MD, St Jeor ST, et al. (1990), *American Journal of Clinical
Nutrition*. Derivada de mediciones en 498 adultos sanos (251 hombres, 247
mujeres, de 19 a 78 años) en la Universidad de Nevada.

La publicación original expresa **una sola regresión**:

```
REE = 9,99 × peso + 6,25 × estatura − 4,92 × edad + 166 × sexo − 161
      (sexo = 1 hombre, 0 mujer)
```

Los propios autores señalaron que redondear los coeficientes y separar la
ecuación por sexo no afecta su valor predictivo, y por eso la forma simplificada
es la de uso corriente. **Rinde implementa la forma simplificada.**

> ⚠️ Los coeficientes de arriba se verificaron contra descripciones secundarias
> de la ecuación, no contra el PDF del artículo original. Antes de usar este
> módulo para cualquier fin clínico, **coteja con la fuente primaria**.

**Sin sexo declarado**, Rinde usa el punto medio entre las dos constantes
(−78) y lo advierte en la interfaz: el resultado es más aproximado.

**Sin peso, estatura o edad**, no hay ecuación posible. Rinde devuelve la
referencia genérica y lo declara en `usedGenericReference`, listando qué datos
faltan. No inventa un peso plausible.

## B.2 Factor de actividad

El gasto total se obtiene multiplicando el gasto en reposo por un factor de
actividad física (PAL). Son **valores de manual ampliamente citados**, no
medidos para esta población:

| Nivel | Factor | Qué significa |
|---|---|---|
| Sedentario | 1,2 | Trabajo de escritorio, poco movimiento |
| Ligero | 1,375 | Camina a diario o se ejercita 1–3 días por semana |
| Moderado | 1,55 | Se ejercita 3–5 días por semana |
| Alto | 1,725 | Se ejercita 6–7 días por semana o trabajo físico |
| Muy alto | 1,9 | Trabajo físico pesado o doble entrenamiento |

## B.3 Ajuste por objetivo

La interfaz ofrece dos objetivos, que son los que se pidieron: **mantener el
peso** y **bajar de peso**. El código conserva otros dos (subir de peso, masa
muscular) para no perder lo que un perfil guardado ya tuviera; si un perfil los
tiene, se muestran, y si no, no.

| Objetivo | Ajuste sobre el gasto total |
|---|---|
| Mantener el peso | 0 |
| Bajar de peso | −15 %, **con tope de 500 kcal** |
| Subir de peso | +10 % |
| Ganar masa muscular | +5 % y más proteína |

Márgenes **moderados y conservadores a propósito**. El tope de 500 kcal es una
decisión propia de Rinde, no una cifra clínica: con un gasto alto, el 15 % la
supera, y una app de mercado no debería proponer por su cuenta más que eso.

Bajar de peso **no reduce la meta de proteína**: la proteína se calcula por kilo
de peso y actividad, no como fracción de la energía. Se come menos, no menos
proteína.

### A quién Rinde no le aplica un déficit, aunque se pida

En estos casos el objetivo se convierte en *mantener* y la pantalla dice por
qué:

| Situación | Motivo |
|---|---|
| Niños | En crecimiento, comer menos no es bajar de peso |
| Menores de 18 años | Mismo motivo |
| Embarazo o lactancia | Las necesidades cambian de una forma que Rinde no estima |
| Condición médica registrada | La estimación no la tiene en cuenta |
| IMC por debajo de 18,5 | Umbral de bajo peso de la clasificación de la OMS |
| Faltan peso, estatura o edad | Sin datos no hay gasto que estimar; se usa la referencia de mantenimiento |

## B.4 Piso de seguridad

Rinde **nunca** propone menos de:

| | kcal/día |
|---|---|
| Mujeres | 1.200 |
| Hombres | 1.500 |
| Sin sexo declarado | 1.200 |

Si el objetivo elegido daría menos, Rinde **se detiene en el piso y lo dice**,
recomendando hablar con un profesional. No es una recomendación de consumir esa
cantidad: es un tope para que la aplicación no proponga por su cuenta un plan
más bajo.

## B.5 Proteína

| Nivel de actividad | Mínimo | Objetivo | Máximo |
|---|---|---|---|
| Sedentario | 0,8 | 1,0 | 1,2 |
| Ligero | 1,0 | 1,2 | 1,4 |
| Moderado | 1,2 | 1,4 | 1,6 |
| Alto | 1,4 | 1,6 | 2,0 |
| Muy alto | 1,6 | 1,8 | 2,2 |

*(gramos por kilo de peso corporal al día; con objetivo de masa muscular se
suman 0,2 g/kg al objetivo y al máximo)*

**Sobre el 0,8 g/kg:** es la RDA para personas adultas sedentarias, y conviene
entender qué es — un **umbral de deficiencia**, la cantidad por debajo de la
cual aparecen problemas, no un objetivo de optimización.

Los rangos altos provienen de la literatura de nutrición deportiva. La
declaración de posición de la *International Society of Sports Nutrition* sobre
proteína y ejercicio sitúa en **1,4–2,0 g/kg/día** lo suficiente para construir
y mantener masa muscular en la mayoría de personas que entrenan.

**Fuentes:**
- [ISSN Position Stand: protein and exercise](https://link.springer.com/article/10.1186/s12970-017-0177-8)
- [Harvard Health — How much protein do you need every day?](https://www.health.harvard.edu/blog/how-much-protein-do-you-need-every-day-201506188096)

## B.6 Fibra

25 g al día por persona adulta. Valor genérico de referencia.

## B.7 Referencia genérica

Cuando no hay perfil físico:

| | Por persona adulta |
|---|---|
| Energía | 2.000 kcal |
| Proteína | 55 g |
| Fibra | 25 g |

Un niño se cuenta como **0,7 de una persona adulta**. Es una convención de
planificación, no un dato nutricional medido, y está expuesta como constante
con nombre (`CHILD_ENERGY_FACTOR`).

## B.8 Lo que Rinde NO estima y deriva a un profesional

Si se marca alguna de estas situaciones, Rinde **muestra una advertencia y no
intenta ajustar los números**:

- **Embarazo** — las necesidades cambian de forma que estas ecuaciones no cubren.
- **Lactancia** — igual.
- **Condición médica** — cualquier patología que modifique requerimientos.

Tampoco estima necesidades de **niños y adolescentes** con las ecuaciones de
adulto: para un perfil marcado como niño sin datos completos se usa la
referencia genérica escalada, y se dice que es genérica.

## B.9 Cómo se usa dentro del planificador

Las metas entran de dos formas:

1. **Como piso por comida** (`MEAL_MIN_SHARE`): el desayuno, el almuerzo y la
   cena tienen que aportar un mínimo de la meta del día. Es un límite duro, no
   una preferencia (D27).
2. **Como una de las ocho señales de puntuación** (`nutrition`, peso 0,18), que
   premia acercarse a la meta del día sin perseguir el número exacto.

### B.10 Porciones según cada persona

Por defecto las porciones salen de cuántos adultos y niños hay (D21): dar el
peso **no** cambia cuánto se cocina. El hogar puede elegir en cambio
**porciones según cada persona** (`portionBasis: "necesidades"`):

```
raciones por comida = Σ (meta de energía de cada adulto con perfil ÷ 2.000)
                    + 1 por cada adulto sin perfil
                    + 0,7 por cada niño
```

Quien necesita 1.400 kcal come 0,7 de una ración de referencia; quien necesita
2.600, 1,3. A los niños nunca se les aplica la ecuación de adultos.

Con porciones reducidas, **el gasto objetivo del plan baja en la misma
proporción**. Sin eso el planificador, que apunta a usar el presupuesto, gastaba
en platos más caros lo que se dejaba de comer, y medido se comía el 70 % del
ahorro (D34).

**El aviso de presupuesto excedido nunca propone bajar de peso.** Es una
decisión de salud de cada persona, no una palanca para cuadrar las cuentas.

---

# Advertencia final

Las ecuaciones de este anexo describen **promedios de población**. Dos cuerpos
con el mismo peso, la misma estatura y la misma edad pueden gastar energías
bastante distintas — por composición corporal, genética, medicación, sueño,
temperatura, y cosas que todavía no se entienden bien.

Úsalas para decidir cuánto arroz comprar. Para decidir qué comer cuando hay algo
de salud de por medio, habla con un profesional.
