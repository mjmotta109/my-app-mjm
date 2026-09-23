import { Link } from "react-router-dom";
import { useMemo } from "react";
import {
  averageCostPerMealPerPerson, buildShoppingList, cycleCount, formatCop, formatDayLong,
} from "@rinde/core";
import type { Meal } from "@rinde/core";
import { CATEGORIES, INGREDIENT_BY_ID, PRICES, SLOT_LABEL, getRecipe } from "../lib/catalog.js";
import { today, useStore } from "../state/store.js";
import { Card, Header, Money, Notice, Progress } from "../components/ui.js";

/**
 * Pantalla de inicio: **Hoy** (§6, §29.3).
 *
 * Antes era un tablero: cuatro cifras sueltas y cinco tarjetas-enlace, todas
 * del mismo tamaño y compitiendo entre sí. Abrir la app era elegir entre nueve
 * cosas antes de saber qué hay que hacer.
 *
 * Ahora la pantalla responde una pregunta, en este orden:
 *
 *   1. ¿Qué como hoy?  — las comidas del día, con su botón de cocinar.
 *   2. ¿Cómo va el dinero? — una tarjeta, no cuatro cifras.
 *   3. ¿Algo que atender? — solo lo que de verdad requiere acción hoy.
 *
 * Lo que se fue: las tarjetas de "cocinar por adelantado" (vive en Plan),
 * "¿qué puedo cocinar?" (vive en Despensa, que es donde se está cuando surge la
 * pregunta) y las cifras de comidas/personas/días, que no cambian nunca y por
 * tanto no son información: son decoración.
 */
export function Dashboard(): React.JSX.Element {
  const { state, dispatch } = useStore();
  const { household, plan, inventory } = state;

  const dias = useMemo(() => {
    const mapa = new Map<string, Meal[]>();
    for (const meal of plan?.meals ?? []) {
      const lista = mapa.get(meal.date);
      if (lista) lista.push(meal);
      else mapa.set(meal.date, [meal]);
    }
    return [...mapa.entries()];
  }, [plan]);

  if (!household || !plan) {
    return (
      <main className="contenido">
        <Notice tone="info">Todavía no hay un plan. Empieza por la configuración inicial.</Notice>
      </main>
    );
  }

  const personas = household.adults + household.children;
  const disponible = plan.diagnostics.budgetDeltaCop;
  const excedido = disponible < 0;
  const usoPct = household.budgetCop > 0 ? plan.projectedSpendCop / household.budgetCop : 0;

  // El día que toca no es la fecha del calendario sino el primero que queda
  // sin cocinar: si ayer no cocinaste, hoy sigue siendo ayer. Es lo que la
  // persona tiene delante, no lo que dice el reloj.
  const indiceDia = Math.max(0, dias.findIndex(([, comidas]) => comidas.some((m) => m.status !== "cooked")));
  const entrada = dias[indiceDia];
  const fechaDia = entrada?.[0];
  const comidasDia = entrada?.[1] ?? [];
  const esFechaDeHoy = fechaDia === today();
  const siguiente = comidasDia.find((meal) => meal.status !== "cooked");

  const cicloActual = siguienteCiclo(plan.startDate, plan.days);
  const lista = buildShoppingList(plan, INGREDIENT_BY_ID, PRICES, {
    cycle: cicloActual, categories: CATEGORIES,
  });
  const comprados = new Set(state.checkedIngredientIds);
  const porComprar = lista.groups
    .flatMap((grupo) => grupo.items)
    .filter((item) => !comprados.has(item.ingredientId)).length;
  const promedio = averageCostPerMealPerPerson(plan.totalFoodValueCop, plan.meals.length, personas);
  const cocinadas = plan.meals.filter((m) => m.status === "cooked").length;

  return (
    <>
      <Header
        title={esFechaDeHoy ? "Hoy" : fechaDia ? formatDayLong(fechaDia) : "Tu plan"}
        eyebrow={`Día ${indiceDia + 1} de ${plan.days} · ${cocinadas} de ${plan.meals.length} cocinadas`}
        action={
          <Link to="/perfil" className="boton-icono" aria-label="Ajustes">
            <span aria-hidden="true">⚙️</span>
          </Link>
        }
      />
      <main className="contenido pila pila--lg">

        {/* ============================================ 1. qué se come hoy */}
        <section className="pila">
          {comidasDia.length === 0 ? (
            <Card>
              <h3>Cocinaste todo el plan</h3>
              <p className="pequeno tenue" style={{ marginTop: 6 }}>
                Ya no quedan comidas pendientes. Genera un plan nuevo desde Plan.
              </p>
            </Card>
          ) : (
            comidasDia.map((meal) => (
              <ComidaDelDia
                key={meal.id}
                meal={meal}
                // Solo la siguiente comida pendiente lleva el botón principal.
                // Tres botones verdes idénticos vuelven a poner a la persona a
                // elegir, que es justo lo que esta pantalla evita.
                esLaSiguiente={meal.id === siguiente?.id}
                onCocinar={() => dispatch({ type: "cookMeal", mealId: meal.id })}
              />
            ))
          )}
          {!esFechaDeHoy && fechaDia && (
            <p className="diminuto tenue">
              Tu plan corre sobre las fechas del catálogo de demostración, no sobre el calendario
              real. Por eso este día no coincide con la fecha de tu teléfono.
            </p>
          )}
        </section>

        {/* ================================================== 2. el dinero */}
        <section>
          <div className="grupo-titulo"><span>El dinero</span></div>
          <Card tone={excedido ? "blanco" : "verde"}>
            <div className="fila fila--entre">
              <div>
                <div className="etiqueta">Gasto proyectado del mes</div>
                <Money value={plan.projectedSpendCop} size="xl" />
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="etiqueta">{excedido ? "Te falta" : "Disponible"}</div>
                <span className={`cifra cifra--lg ${excedido ? "negativo" : ""}`}>
                  {formatCop(Math.abs(disponible))}
                </span>
              </div>
            </div>
            <div style={{ margin: "14px 0 8px" }}>
              <Progress
                value={plan.projectedSpendCop}
                max={household.budgetCop}
                tone={excedido ? "alerta" : usoPct > 0.9 ? "aviso" : "ok"}
              />
            </div>
            <div className="fila fila--entre pequeno tenue">
              <span>Presupuesto {formatCop(household.budgetCop)}</span>
              <span>{promedio === null ? "—" : `${formatCop(promedio)} por comida y persona`}</span>
            </div>
          </Card>
        </section>

        {/* ========================================= 3. solo lo que requiere acción */}
        {excedido && (
          <Notice tone="alerta">
            <strong>Faltan {formatCop(Math.abs(disponible))} para este plan.</strong> Rinde ya lo
            abarató todo lo que pudo sin servir de menos ni repetir el mismo plato toda la semana.
            Lo que queda está en tus manos: subir el presupuesto, quitar una comida del día o
            reducir los días, en Ajustes.
          </Notice>
        )}

        {plan.diagnostics.mealsBelowNutritionFloor > 0 && (
          <Notice tone="alerta">
            <strong>{plan.diagnostics.mealsBelowNutritionFloor} comida(s) quedan cortas</strong> frente
            al mínimo de su horario. No había recetas compatibles más sustanciosas; revisa tus
            restricciones o el tiempo de cocina en Ajustes.
          </Notice>
        )}

        {plan.diagnostics.warnings.some((warning) => /demostración/i.test(warning)) && (
          <Notice tone="demo">
            <strong>Datos de demostración.</strong> Los precios no son reales; sirven para probar la
            aplicación. Ver Ajustes → Precios.
          </Notice>
        )}

        <section>
          <div className="grupo-titulo"><span>Estado</span></div>
          <div className="pila">
            <Link to="/mercado" className="tarjeta-boton">
              <span aria-hidden="true" style={{ fontSize: 22 }}>🛒</span>
              <span className="crecer">
                <strong>Mercado</strong>
                <div className="pequeno tenue">
                  Compra {cicloActual} de {cycleCount(plan)} · {porComprar} por comprar
                </div>
              </span>
              <span className="fila" style={{ gap: 8 }}>
                <Money value={lista.totalCop} size="md" />
                <span className="tenue" aria-hidden="true">›</span>
              </span>
            </Link>

            <Link to="/despensa" className="tarjeta-boton">
              <span aria-hidden="true" style={{ fontSize: 22 }}>🧺</span>
              <span className="crecer">
                <strong>Despensa</strong>
                <div className="pequeno tenue">
                  {inventory.length} {inventory.length === 1 ? "ingrediente" : "ingredientes"}
                </div>
              </span>
              <span className="tenue" aria-hidden="true">›</span>
            </Link>

            {!excedido && disponible > 0 && (
              <Link to="/rinde-mas" className="tarjeta-boton">
                <span aria-hidden="true" style={{ fontSize: 22 }}>✨</span>
                <span className="crecer">
                  <strong>Rinde más</strong>
                  <div className="pequeno tenue">
                    Te sobran {formatCop(disponible)}. Mira en qué rinden más.
                  </div>
                </span>
                <span className="tenue" aria-hidden="true">›</span>
              </Link>
            )}
          </div>
        </section>

          <p className="diminuto tenue">
            Plan generado con una heurística ({plan.plannerVersion}), no con un optimizador
            matemático: es un plan bueno, no necesariamente el mejor posible.
          </p>
      </main>
    </>
  );
}

/** Una comida del día, con lo único que se hace con ella: verla o cocinarla. */
function ComidaDelDia({
  meal, esLaSiguiente, onCocinar,
}: {
  meal: Meal;
  esLaSiguiente: boolean;
  onCocinar: () => void;
}): React.JSX.Element {
  const receta = getRecipe(meal.recipeId);
  const cocinada = meal.status === "cooked";

  return (
    <Card className={cocinada ? "tarjeta--hecha" : ""}>
      <div className="fila fila--entre" style={{ alignItems: "flex-start", gap: 12 }}>
        <div className="crecer">
          <div className="etiqueta">{SLOT_LABEL[meal.slot]}</div>
          <h3 style={{ marginTop: 2 }}>{receta?.name ?? meal.recipeId}</h3>
          <p className="pequeno tenue" style={{ marginTop: 4 }}>
            {receta ? `${receta.minutes} min · ` : ""}
            {Math.round(meal.nutrition.kcal / Math.max(1, meal.servings))} kcal por porción
            {" · "}
            {formatCop(meal.costPerPersonCop)} por persona
          </p>
          {meal.substitutions.length > 0 && (
            <p className="diminuto tenue" style={{ marginTop: 4 }}>
              Con cambios para ajustar el presupuesto. Los verás en la receta.
            </p>
          )}
        </div>
      </div>
      <div className="fila" style={{ gap: 8, marginTop: 14 }}>
        <Link to={`/comida/${encodeURIComponent(meal.id)}`} className="boton boton--secundario crecer">
          Ver receta
        </Link>
        {!cocinada && (
          <button
            type="button"
            className={`boton crecer${esLaSiguiente ? "" : " boton--secundario"}`}
            onClick={onCocinar}
          >
            Lo cociné
          </button>
        )}
      </div>
      {cocinada && <p className="diminuto tenue" style={{ marginTop: 10 }}>✓ Cocinada y descontada de la despensa</p>}
    </Card>
  );
}

/** Primer ciclo de compra que aún no ha terminado, relativo al plan. */
function siguienteCiclo(startDate: string, days: number): number {
  const inicio = Date.parse(`${startDate}T00:00:00Z`);
  const transcurridos = Math.floor((Date.now() - inicio) / 86_400_000);
  if (!Number.isFinite(transcurridos) || transcurridos < 0) return 1;
  const ciclo = Math.floor(Math.min(transcurridos, days - 1) / 7) + 1;
  return Math.max(1, ciclo);
}
