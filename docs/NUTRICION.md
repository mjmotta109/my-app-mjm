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

De **aproximaciones de composición de alimentos de uso general**. No se
transcribieron de la Tabla de Composición de Alimentos Colombianos del ICBF ni
de ninguna otra base verificada, porque no se pudo consultar ninguna desde el
entorno donde se construyó el catálogo.

Por eso **los 100 ingredientes llevan `nutritionIsEstimated: true`**, sin
excepción, y la interfaz muestra siempre la etiqueta "Estimada".

Poner `false` en esa marca exige reemplazar los valores por datos de una fuente
citada, **ingrediente por ingrediente**. No es un interruptor global.

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

| Objetivo | Ajuste |
|---|---|
| Mantener el peso | 0 % |
| Bajar de peso | −15 % |
| Subir de peso | +10 % |
| Ganar masa muscular | +5 % y más proteína |

Márgenes **moderados y conservadores a propósito**. Un déficit agresivo no es
algo que una aplicación de presupuesto de mercado deba proponerle a nadie por su
cuenta.

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

Las metas alimentan **una de las siete señales** de puntuación del planificador
(`nutrition`, peso 0,09). El planificador intenta que el día quede
razonablemente equilibrado contra esa meta; **no persigue el número**.

El presupuesto, el inventario, la variedad y el tiempo pesan más, porque el
producto es hacer que la plata alcance, no cuadrar macros.

---

# Advertencia final

Las ecuaciones de este anexo describen **promedios de población**. Dos cuerpos
con el mismo peso, la misma estatura y la misma edad pueden gastar energías
bastante distintas — por composición corporal, genética, medicación, sueño,
temperatura, y cosas que todavía no se entienden bien.

Úsalas para decidir cuánto arroz comprar. Para decidir qué comer cuando hay algo
de salud de por medio, habla con un profesional.
