import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  eaterEquivalents, formatCop, normalizeText, nutritionOfScaled, scaleRecipe,
  suggestForRecipe, VirtualPantry, costMeal,
} from "@rinde/core";
import type { Difficulty, MealSlot } from "@rinde/core";
import { INGREDIENT_BY_ID, PRICES, RECIPES, SLOT_LABEL, getRecipe, ingredientName } from "../lib/catalog.js";
import { useStore } from "../state/store.js";
import { Badge, Card, DemoNotice, Empty, Header, IngredientQty, Money, PriceBadge } from "../components/ui.js";

/** Explorador de recetas (§7 "Recetas"). */
/** Topes de tiempo del filtro, en minutos. */
const TIEMPOS = [15, 30, 45] as const;

const DIFICULTADES = ["facil", "media", "dificil"] as const;

export function RecipeList(): React.JSX.Element {
  const { state } = useStore();
  const [busqueda, setBusqueda] = useState("");
  const [slot, setSlot] = useState<MealSlot | "todos">("todos");
  const [maxMin, setMaxMin] = useState<number | null>(null);
  const [dificultad, setDificultad] = useState<Difficulty | null>(null);
  const [soloTandas, setSoloTandas] = useState(false);

  const porciones = state.household
    ? eaterEquivalents(state.household.adults, state.household.children)
    : 2;

  const resultados = useMemo(() => {
    const termino = normalizeText(busqueda);
    return RECIPES.filter((recipe) => {
      if (slot !== "todos" && !recipe.slots.includes(slot)) return false;
      if (maxMin !== null && recipe.minutes > maxMin) return false;
      if (dificultad !== null && recipe.difficulty !== dificultad) return false;
      if (soloTandas && !recipe.prep.batchFriendly) return false;
      if (!termino) return true;
      return (
        normalizeText(recipe.name).includes(termino) ||
        normalizeText(recipe.description).includes(termino) ||
        recipe.ingredients.some((item) => normalizeText(ingredientName(item.ingredientId)).includes(termino))
      );
    }).sort((a, b) => a.minutes - b.minutes || (a.name < b.name ? -1 : 1));
  }, [busqueda, slot, maxMin, dificultad, soloTandas]);

  return (
    <>
      <Header title="Recetas" eyebrow={`${RECIPES.length} en el recetario`} />
      <main className="contenido pila">
        <input
          type="text"
          placeholder="Buscar receta o ingrediente"
          value={busqueda}
          onChange={(event) => setBusqueda(event.target.value)}
          aria-label="Buscar receta"
        />
        <div className="chip-fila">
          {(["todos", "desayuno", "almuerzo", "cena", "snack"] as const).map((valor) => (
            <button
              key={valor}
              type="button"
              className={`chip ${slot === valor ? "chip--activo" : ""}`}
              onClick={() => setSlot(valor)}
            >
              {valor === "todos" ? "Todas" : SLOT_LABEL[valor]}
            </button>
          ))}
        </div>

        {/* Tiempo y dificultad son criterios de búsqueda de primera clase: son
            lo que de verdad decide si una receta entra en un martes. */}
        <div className="chip-fila">
          <button
            type="button"
            className={`chip ${maxMin === null ? "chip--activo" : ""}`}
            onClick={() => setMaxMin(null)}
          >
            ⏱ Cualquier tiempo
          </button>
          {TIEMPOS.map((minutos) => (
            <button
              key={minutos}
              type="button"
              className={`chip ${maxMin === minutos ? "chip--activo" : ""}`}
              onClick={() => setMaxMin(maxMin === minutos ? null : minutos)}
            >
              ≤ {minutos} min
            </button>
          ))}
        </div>

        <div className="chip-fila">
          {DIFICULTADES.map((valor) => (
            <button
              key={valor}
              type="button"
              className={`chip ${dificultad === valor ? "chip--activo" : ""}`}
              onClick={() => setDificultad(dificultad === valor ? null : valor)}
            >
              {DIFICULTAD[valor]}
            </button>
          ))}
          <button
            type="button"
            className={`chip ${soloTandas ? "chip--activo" : ""}`}
            onClick={() => setSoloTandas(!soloTandas)}
          >
            🧊 Se puede adelantar
          </button>
        </div>

        <p className="diminuto tenue">
          {resultados.length} de {RECIPES.length} recetas
        </p>

        {resultados.length === 0 ? (
          <Empty icon="🔍" title="Sin resultados" description={`No encontramos "${busqueda}".`} />
        ) : (
          <div className="tarjeta tarjeta--plana">
            <div className="lista">
              {resultados.map((recipe) => {
                const scale = scaleRecipe(recipe, porciones, INGREDIENT_BY_ID);
                const costed = costMeal(scale, new VirtualPantry([]), PRICES, porciones, { commit: false });
                return (
                  <Link key={recipe.id} to={`/receta/${recipe.id}`} className="lista__item">
                    <span className="crecer">
                      <div className="lista__nombre"><strong>{recipe.name}</strong></div>
                      <div className="fila diminuto tenue" style={{ gap: 6, flexWrap: "wrap", marginTop: 3 }}>
                        <span className="insignia insignia--estimado">⏱ {recipe.minutes} min</span>
                        <span className="insignia insignia--estimado">{DIFICULTAD[recipe.difficulty]}</span>
                        {recipe.prep.batchFriendly && (
                          <span className="insignia insignia--verde">🧊 se adelanta</span>
                        )}
                      </div>
                      <div className="diminuto tenue" style={{ marginTop: 3 }}>
                        {recipe.slots.map((s) => SLOT_LABEL[s]).join(" · ")}
                      </div>
                    </span>
                    <span style={{ textAlign: "right", flex: "none" }}>
                      <Money value={costed.costIncomplete ? null : costed.costCop} size="sm" />
                      <div className="diminuto tenue">para {porciones}</div>
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </>
  );
}

/** Pantalla 9: detalle de receta fuera del plan (§29.9). */
export function RecipeDetail(): React.JSX.Element {
  const { recipeId = "" } = useParams();
  const { state } = useStore();
  const recipe = getRecipe(recipeId);

  const porciones = state.household
    ? eaterEquivalents(state.household.adults, state.household.children)
    : 2;

  if (!recipe) {
    return (
      <>
        <Header title="Receta" back />
        <main className="contenido">
          <Empty icon="🤔" title="No encontramos esta receta" />
        </main>
      </>
    );
  }

  const scale = scaleRecipe(recipe, porciones, INGREDIENT_BY_ID);
  const pantry = new VirtualPantry(state.inventory);
  const costed = costMeal(scale, pantry, PRICES, porciones, { commit: false });
  const nutrition = nutritionOfScaled(scale, INGREDIENT_BY_ID);
  const cantidades = new Map(scale.lines.map((line) => [line.ingredientId, line.qtyBase]));
  const sustituciones = suggestForRecipe(recipe, cantidades, INGREDIENT_BY_ID, PRICES, { minSavingCop: 300 });

  return (
    <>
      <Header title={recipe.name} eyebrow={recipe.region} back />
      <main className="contenido pila pila--lg">
        <p className="media">{recipe.description}</p>

        <div className="fila" style={{ flexWrap: "wrap", gap: 6 }}>
          <Badge tone="estimado">⏱ {recipe.minutes} min</Badge>
          <Badge tone="estimado">{DIFICULTAD[recipe.difficulty]}</Badge>
          {recipe.tags.map((tag) => (
            <Badge key={tag} tone="verde">{ETIQUETA_DIETA[tag] ?? tag}</Badge>
          ))}
        </div>

        <Card>
          <div className="fila fila--entre">
            <strong>Cocinar por adelantado</strong>
            <Badge tone={recipe.prep.batchFriendly ? "verde" : "alerta"}>
              {recipe.prep.batchFriendly ? "Sí se puede" : "Solo recién hecho"}
            </Badge>
          </div>
          <p className="pequeno tenue" style={{ marginTop: 8 }}>
            {recipe.prep.batchFriendly
              ? `Aguanta ${recipe.prep.keepsDays} días en nevera` +
                (recipe.prep.freezable ? " y se puede congelar." : ", pero no se congela bien.")
              : recipe.prep.finishNote}
          </p>
        </Card>

        <Card tone="verde">
          <div className="fila fila--entre">
            <div>
              <div className="etiqueta">Costo para {porciones} porciones</div>
              <Money value={costed.costIncomplete ? null : costed.costCop} size="lg" />
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="etiqueta">Te falta comprar</div>
              <Money value={costed.purchaseCop} size="md" />
            </div>
          </div>
          <p className="diminuto tenue" style={{ marginTop: 8 }}>
            La receta original rinde {recipe.baseServings}; Rinde la escaló a tu hogar.
          </p>
        </Card>

        <DemoNotice show={costed.lines.some((line) => line.priceIsDemo)} />

        <section>
          <div className="grupo-titulo"><span>Ingredientes</span></div>
          <div className="tarjeta tarjeta--plana">
            <div className="lista">
              {costed.lines.map((line) => (
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
        </section>

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

        <section>
          <div className="grupo-titulo"><span>Nutrición</span><Badge tone="estimado">Estimada</Badge></div>
          <Card>
            <div className="malla-2">
              <div><div className="etiqueta">Calorías</div><div className="cifra cifra--md">{nutrition.kcal} kcal</div></div>
              <div><div className="etiqueta">Proteína</div><div className="cifra cifra--md">{nutrition.proteinG} g</div></div>
              <div><div className="etiqueta">Carbohidratos</div><div className="cifra cifra--md">{nutrition.carbsG} g</div></div>
              <div><div className="etiqueta">Grasa</div><div className="cifra cifra--md">{nutrition.fatG} g</div></div>
            </div>
            <p className="diminuto tenue" style={{ marginTop: 12 }}>
              Estimación por suma de ingredientes crudos. No es información médica ni dietética.
            </p>
          </Card>
        </section>

        {sustituciones.length > 0 && (
          <section>
            <div className="grupo-titulo"><span>Sustituciones más baratas</span></div>
            <div className="pila">
              {sustituciones.slice(0, 3).map((suggestion) => (
                <Card key={`${suggestion.fromIngredientId}-${suggestion.toIngredientId}`}>
                  <div className="fila fila--entre">
                    <span className="crecer">
                      {ingredientName(suggestion.fromIngredientId)} → {ingredientName(suggestion.toIngredientId)}
                    </span>
                    <span className="cifra positivo">−{formatCop(suggestion.savingCop)}</span>
                  </div>
                  <p className="diminuto tenue" style={{ marginTop: 6 }}>
                    Equivalencia por {suggestion.basis === "protein" ? "proteína" : "peso"}.
                  </p>
                </Card>
              ))}
            </div>
          </section>
        )}
      </main>
    </>
  );
}

const DIFICULTAD: Record<string, string> = { facil: "Fácil", media: "Media", dificil: "Difícil" };
const ETIQUETA_DIETA: Record<string, string> = {
  vegetariano: "Vegetariano",
  vegano: "Vegano",
  sin_gluten: "Sin gluten",
  sin_lactosa: "Sin lactosa",
  economico: "Económico",
  alto_proteina: "Alto en proteína",
};
