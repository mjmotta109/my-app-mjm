import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  formatCop, formatDayLong, scaleRecipe, suggestForRecipe,
  detectLeftovers, suggestLeftoverUses,
} from "@rinde/core";
import { INGREDIENT_BY_ID, PRICES, RECIPES, SLOT_LABEL, getRecipe, ingredientName } from "../lib/catalog.js";
import { useStore } from "../state/store.js";
import { Badge, Card, DemoNotice, Empty, Header, IngredientQty, Money, Notice, PriceBadge, Sheet } from "../components/ui.js";

/** Pantalla 5: detalle de una comida del plan (§8, §29.5). */
export function MealDetail(): React.JSX.Element {
  const { mealId = "" } = useParams();
  const { state, dispatch } = useStore();
  const [cocinado, setCocinado] = useState(false);

  const meal = state.plan?.meals.find((entry) => entry.id === decodeURIComponent(mealId));
  const recipe = meal ? getRecipe(meal.recipeId) : undefined;

  if (!meal || !recipe) {
    return (
      <>
        <Header title="Comida" back />
        <main className="contenido">
          <Empty icon="🤔" title="No encontramos esta comida" description="Puede que el plan se haya regenerado." />
        </main>
      </>
    );
  }

  const scale = scaleRecipe(recipe, meal.servings, INGREDIENT_BY_ID);
  // El aporte lo trae la comida, no se recalcula desde la receta del catálogo:
  // si el planificador cambió un ingrediente, la receta original ya no describe
  // lo que se va a cocinar.
  const nutrition = meal.nutrition;
  const cantidades = new Map(scale.lines.map((line) => [line.ingredientId, line.qtyBase]));
  const sustituciones = suggestForRecipe(recipe, cantidades, INGREDIENT_BY_ID, PRICES, {
    minSavingCop: 300,
  });

  const sobras = cocinado
    ? suggestLeftoverUses(
        detectLeftovers(state.inventory, INGREDIENT_BY_ID, meal.id, meal.date),
        RECIPES,
        state.inventory,
        4,
      )
    : [];

  return (
    <>
      <Header title={recipe.name} eyebrow={`${SLOT_LABEL[meal.slot]} · ${formatDayLong(meal.date)}`} back />
      <main className="contenido pila pila--lg">
        <p className="media">{recipe.description}</p>

        {meal.substitutions.length > 0 && (
          <Notice tone="info">
            <strong>Esta comida lleva cambios</strong> para que el plan cupiera en tu presupuesto:{" "}
            {meal.substitutions
              .map((c) => `${ingredientName(c.fromIngredientId)} → ${ingredientName(c.toIngredientId)}`)
              .join(", ")}
            . La lista de ingredientes de abajo es la que vas a cocinar.
          </Notice>
        )}

        <div className="malla-3">
          <Card><div className="etiqueta">Tiempo</div><div className="cifra cifra--md">{recipe.minutes} min</div></Card>
          <Card><div className="etiqueta">Dificultad</div><div className="cifra cifra--md" style={{ fontSize: 16 }}>{DIFICULTAD[recipe.difficulty]}</div></Card>
          <Card><div className="etiqueta">Porciones</div><div className="cifra cifra--md">{meal.servings}</div></Card>
        </div>

        <Card tone="verde">
          <div className="fila fila--entre">
            <div>
              <div className="etiqueta">Costo estimado</div>
              <Money value={meal.costIncomplete ? null : meal.costCop} size="lg" />
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="etiqueta">Por persona</div>
              <span className="cifra cifra--md">{formatCop(meal.costPerPersonCop)}</span>
            </div>
          </div>
          {meal.costIncomplete && (
            <p className="pequeno" style={{ marginTop: 10 }}>
              Falta el precio de algún ingrediente, así que este costo está incompleto.
            </p>
          )}
        </Card>

        {/* ------------------------------------------------- ingredientes */}
        <section>
          <DemoNotice show={meal.lines.some((line) => line.priceIsDemo)} />

          <div className="grupo-titulo">
            <span>Ingredientes</span>
            <span className="tenue" style={{ textTransform: "none", letterSpacing: 0 }}>
              para {meal.servings}
            </span>
          </div>
          <div className="tarjeta tarjeta--plana">
            <div className="lista">
              {meal.lines.map((line) => (
                <div key={line.ingredientId} className="lista__item">
                  <span className="crecer">
                    <div className="lista__nombre">{ingredientName(line.ingredientId)}</div>
                    <div className="diminuto tenue">
                      <IngredientQty ingredientId={line.ingredientId} qtyBase={line.qtyBase} />
                      {line.fromInventoryBase > 0 && " · ya lo tienes"}
                    </div>
                  </span>
                  <span style={{ textAlign: "right", flex: "none" }}>
                    <Money value={line.valueCop} size="sm" />
                    <div><PriceBadge confidence={line.priceConfidence} isDemo={line.priceIsDemo} inlineDemo={false} /></div>
                  </span>
                </div>
              ))}
            </div>
          </div>
          {scale.unknownIngredientIds.length > 0 && (
            <p className="diminuto tenue" style={{ marginTop: 8 }}>
              Sin datos de: {scale.unknownIngredientIds.join(", ")}.
            </p>
          )}
        </section>

        {/* ------------------------------------------------ instrucciones */}
        <section>
          <div className="grupo-titulo"><span>Cómo se prepara</span></div>
          <Card>
            <ol className="paso-lista" style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {recipe.steps.map((step, index) => (
                <li key={index} className="paso">
                  <span className="paso__numero">{index + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </Card>
        </section>

        {/* --------------------------------------------------- nutrición */}
        <section>
          <div className="grupo-titulo">
            <span>Nutrición</span>
            <Badge tone="estimado">Estimada</Badge>
          </div>
          <Card>
            <div className="malla-2">
              <Dato label="Calorías" value={`${nutrition.kcal} kcal`} />
              <Dato label="Proteína" value={`${nutrition.proteinG} g`} />
              <Dato label="Carbohidratos" value={`${nutrition.carbsG} g`} />
              <Dato label="Grasa" value={`${nutrition.fatG} g`} />
            </div>
            <p className="diminuto tenue" style={{ marginTop: 12 }}>
              Total de la receta ({meal.servings} porciones), sumando ingredientes crudos. No
              considera pérdidas por cocción. Rinde no es una herramienta médica ni dietética.
            </p>
          </Card>
        </section>

        {/* ----------------------------------------------- sustituciones */}
        {sustituciones.length > 0 && (
          <section>
            <div className="grupo-titulo"><span>Para que rinda más</span></div>
            <div className="pila">
              {sustituciones.slice(0, 3).map((suggestion) => (
                <Card key={`${suggestion.fromIngredientId}-${suggestion.toIngredientId}`}>
                  <div className="fila fila--entre">
                    <span className="crecer">
                      Cambia <strong>{ingredientName(suggestion.fromIngredientId)}</strong> por{" "}
                      <strong>{ingredientName(suggestion.toIngredientId)}</strong>
                    </span>
                    <span className="cifra positivo">−{formatCop(suggestion.savingCop)}</span>
                  </div>
                  <p className="diminuto tenue" style={{ marginTop: 6 }}>
                    Equivalencia por {suggestion.basis === "protein" ? "proteína" : "peso"}:{" "}
                    <IngredientQty ingredientId={suggestion.toIngredientId} qtyBase={suggestion.toQtyBase} />
                  </p>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* --------------------------------------------------- cocinar */}
        {meal.status === "cooked" ? (
          <Notice tone="info">Ya cocinaste esta comida y el inventario quedó descontado.</Notice>
        ) : (
          <button
            type="button"
            className="boton"
            onClick={() => {
              dispatch({ type: "cookMeal", mealId: meal.id });
              setCocinado(true);
            }}
          >
            Lo cociné — descontar de la despensa
          </button>
        )}

        <Sheet open={cocinado} onClose={() => setCocinado(false)} title="Listo, inventario actualizado">
          <p className="media" style={{ marginBottom: 16 }}>
            Descontamos los ingredientes de tu despensa.
          </p>
          {sobras.length > 0 && (
            <>
              <div className="grupo-titulo"><span>Aprovecha lo que sobró</span></div>
              <div className="pila">
                {sobras.map((suggestion) => (
                  <Link
                    key={suggestion.recipeId}
                    to={`/receta/${suggestion.recipeId}`}
                    className="tarjeta-boton"
                    onClick={() => setCocinado(false)}
                  >
                    <span className="crecer">
                      <strong>{suggestion.recipeName}</strong>
                      <div className="pequeno tenue">
                        Usa {suggestion.usesIngredientIds.map(ingredientName).join(", ")}
                      </div>
                    </span>
                    <span className="tenue" aria-hidden="true">›</span>
                  </Link>
                ))}
              </div>
            </>
          )}
          <button type="button" className="boton boton--secundario" style={{ marginTop: 16 }} onClick={() => setCocinado(false)}>
            Cerrar
          </button>
        </Sheet>
      </main>
    </>
  );
}

function Dato({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div>
      <div className="etiqueta">{label}</div>
      <div className="cifra cifra--md">{value}</div>
    </div>
  );
}

const DIFICULTAD: Record<string, string> = { facil: "Fácil", media: "Media", dificil: "Difícil" };
