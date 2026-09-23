import { useMemo, useRef } from "react";
import { Link, NavLink } from "react-router-dom";
import { formatCop, formatDayLong, formatDayShort } from "@rinde/core";
import type { Meal } from "@rinde/core";
import { SLOT_LABEL, getRecipe } from "../lib/catalog.js";
import { useStore } from "../state/store.js";
import { Empty, Header, Money, Notice } from "../components/ui.js";

/** Pantalla 4: plan mensual (§8, §29.4). Calendario de comidas por día. */
export function PlanScreen(): React.JSX.Element {
  const { state, dispatch } = useStore();
  const { plan } = state;
  const contenedor = useRef<HTMLElement>(null);

  const porDia = useMemo(() => {
    const mapa = new Map<string, Meal[]>();
    for (const meal of plan?.meals ?? []) {
      const lista = mapa.get(meal.date);
      if (lista) lista.push(meal);
      else mapa.set(meal.date, [meal]);
    }
    return [...mapa.entries()];
  }, [plan]);

  if (!plan) {
    return (
      <>
        <Header title="Plan" eyebrow="Tu mes" />
        <main className="contenido">
          <Empty icon="📅" title="Todavía no hay plan" description="Crea tu plan desde Inicio." />
        </main>
      </>
    );
  }

  const cocinadas = plan.meals.filter((meal) => meal.status === "cooked").length;

  return (
    <>
      <Header
        title="Plan"
        eyebrow={`${plan.days} días · ${plan.meals.length} comidas`}
        action={
          <button
            type="button"
            className="boton boton--secundario boton--compacto"
            onClick={() => {
              if (confirm("Se generará un plan nuevo y se perderá el avance de esta lista. ¿Continuar?")) {
                dispatch({ type: "regeneratePlan" });
                contenedor.current?.scrollTo({ top: 0 });
              }
            }}
          >
            Regenerar
          </button>
        }
      />
      {/*
        Los dos destinos que antes ocupaban un puesto en la navegación inferior
        y una tarjeta en el inicio. Aquí es donde se buscan: el recetario, para
        ver qué más hay; cocinar por adelantado, para resolver la semana de una
        vez. Son accesos, no decisiones que haya que tomar todos los días.
      */}
      <nav className="accesos" aria-label="Herramientas del plan">
        <NavLink to="/recetas" className="accesos__item">
          <span aria-hidden="true">📖</span> Recetario
        </NavLink>
        <NavLink to="/cocinar-adelantado" className="accesos__item">
          <span aria-hidden="true">🍲</span> Cocinar por adelantado
        </NavLink>
      </nav>
      <main className="contenido pila" ref={contenedor}>
        {cocinadas > 0 && (
          <Notice tone="info">
            Ya cocinaste {cocinadas} de {plan.meals.length} comidas.
          </Notice>
        )}

        {plan.diagnostics.distinctRecipes > 0 && (
          <p className="diminuto tenue">
            {plan.diagnostics.distinctRecipes} recetas distintas en {plan.days} días. Ninguna se
            repite más de una vez por semana ni dos veces el mismo día.
          </p>
        )}

        {porDia.map(([fecha, comidas]) => (
          <section key={fecha}>
            <div className="grupo-titulo">
              <span>{formatDayShort(fecha)}</span>
              <span style={{ textTransform: "none", letterSpacing: 0 }} className="tenue">
                {formatCop(comidas.reduce((total, meal) => total + meal.costCop, 0))}
              </span>
            </div>
            <div className="tarjeta tarjeta--plana">
              <div className="lista">
                {comidas.map((meal) => {
                  const receta = getRecipe(meal.recipeId);
                  return (
                    <Link
                      key={meal.id}
                      to={`/comida/${encodeURIComponent(meal.id)}`}
                      className="lista__item"
                      style={meal.status === "cooked" ? { opacity: 0.55 } : undefined}
                    >
                      <span
                        aria-hidden="true"
                        style={{ fontSize: 20, width: 26, textAlign: "center", flex: "none" }}
                      >
                        {meal.status === "cooked" ? "✅" : SLOT_EMOJI[meal.slot] ?? "🍽️"}
                      </span>
                      <span className="crecer">
                        <span className="diminuto tenue">{SLOT_LABEL[meal.slot]}</span>
                        <div className="lista__nombre"><strong>{receta?.name ?? meal.recipeId}</strong></div>
                        <span className="diminuto tenue">
                          ⏱ {receta?.minutes ?? "?"} min · {DIFICULTAD[receta?.difficulty ?? "facil"]}{" "}
                          · {formatCop(meal.costPerPersonCop)} / persona
                        </span>
                      </span>
                      <span style={{ textAlign: "right", flex: "none" }}>
                        <Money value={meal.costIncomplete ? null : meal.costCop} size="sm" />
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
            <p className="diminuto tenue" style={{ padding: "6px 4px 0" }}>
              {formatDayLong(fecha)}
            </p>
          </section>
        ))}
      </main>
    </>
  );
}

const SLOT_EMOJI: Record<string, string> = {
  desayuno: "☕",
  almuerzo: "🍛",
  cena: "🌙",
  snack: "🍎",
};

const DIFICULTAD: Record<string, string> = { facil: "Fácil", media: "Media", dificil: "Difícil" };
