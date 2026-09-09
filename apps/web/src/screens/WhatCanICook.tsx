import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { eaterEquivalents, whatCanICook } from "@rinde/core";
import type { MealSlot } from "@rinde/core";
import { INGREDIENT_BY_ID, PRICES, RECIPES, SLOT_LABEL, ingredientName } from "../lib/catalog.js";
import { useStore } from "../state/store.js";
import { Empty, Header, Money, Progress } from "../components/ui.js";

/** Pantalla 8: ¿qué puedo cocinar? (§11, §29.8). */
export function WhatCanICook(): React.JSX.Element {
  const { state } = useStore();
  const [slot, setSlot] = useState<MealSlot | "todos">("todos");

  const porciones = state.household
    ? eaterEquivalents(state.household.adults, state.household.children)
    : 2;

  const opciones = useMemo(
    () =>
      whatCanICook(state.inventory, RECIPES, INGREDIENT_BY_ID, PRICES, porciones, {
        ...(slot === "todos" ? {} : { slot }),
        minCoverage: 0.35,
        limit: 15,
        excludedIngredientIds: new Set(
          (state.household?.preferences ?? [])
            .filter((preference) => preference.kind === "allergy")
            .map((preference) => preference.value),
        ),
      }),
    [state.inventory, state.household, porciones, slot],
  );

  return (
    <>
      <Header title="¿Qué puedo cocinar?" eyebrow="Con lo que hay en casa" back />
      <main className="contenido pila">
        <div className="chip-fila">
          {(["todos", "desayuno", "almuerzo", "cena", "snack"] as const).map((valor) => (
            <button
              key={valor}
              type="button"
              className={`chip ${slot === valor ? "chip--activo" : ""}`}
              onClick={() => setSlot(valor)}
            >
              {valor === "todos" ? "Todo" : SLOT_LABEL[valor]}
            </button>
          ))}
        </div>

        {opciones.length === 0 ? (
          <Empty
            icon="🥣"
            title="Falta demasiado"
            description={
              state.inventory.length === 0
                ? "Tu despensa está vacía. Agrega lo que tengas en casa."
                : "Con lo que hay no alcanza para ninguna receta completa. Mira la lista de mercado."
            }
            action={<Link to="/despensa/agregar" className="boton">Agregar a la despensa</Link>}
          />
        ) : (
          <div className="pila">
            {opciones.map((opcion, index) => (
              <Link key={opcion.recipeId} to={`/receta/${opcion.recipeId}`} className="tarjeta">
                <div className="fila fila--entre" style={{ alignItems: "flex-start", marginBottom: 10 }}>
                  <div className="crecer">
                    <div className="diminuto tenue">{index + 1}</div>
                    <h3>{opcion.recipeName}</h3>
                    <div className="pequeno tenue">
                      {opcion.minutes} min · {opcion.slots.map((s) => SLOT_LABEL[s]).join(" · ")}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flex: "none" }}>
                    <div className="etiqueta">Costo estimado</div>
                    <Money value={opcion.costIncomplete ? null : opcion.costCop} size="md" />
                  </div>
                </div>

                <Progress value={opcion.coveragePct} max={100} tone={opcion.coveragePct >= 90 ? "ok" : "aviso"} />

                <div className="fila fila--entre" style={{ marginTop: 8 }}>
                  <span className="pequeno">
                    <strong>{opcion.coveragePct}%</strong> de ingredientes disponibles
                  </span>
                  {opcion.missingCostCop > 0 && (
                    <span className="pequeno tenue">
                      te falta <Money value={opcion.missingCostCop} size="sm" />
                    </span>
                  )}
                </div>

                {opcion.missingIngredientIds.length > 0 && (
                  <p className="diminuto tenue" style={{ marginTop: 8 }}>
                    Falta: {opcion.missingIngredientIds.slice(0, 4).map(ingredientName).join(", ")}
                    {opcion.missingIngredientIds.length > 4 && ` y ${opcion.missingIngredientIds.length - 4} más`}
                  </p>
                )}
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
