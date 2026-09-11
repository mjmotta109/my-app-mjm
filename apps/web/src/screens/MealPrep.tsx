import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  cycleCount, formatCop, formatDayShort, humanize, planMealPrep, sessionIngredients,
} from "@rinde/core";
import type { PrepBatch } from "@rinde/core";
import { INGREDIENT_BY_ID, RECIPE_BY_ID, SLOT_LABEL, ingredientName } from "../lib/catalog.js";
import { useStore } from "../state/store.js";
import { Badge, Card, Empty, Header, Money, Notice, Progress, Sheet, Toggle } from "../components/ui.js";

/**
 * Cocinar por adelantado (meal prep).
 *
 * No es solo un plan: es la jornada de cocina. Cada tanda se marca como
 * cocinada AQUÍ, y al hacerlo se descuenta el inventario una sola vez y quedan
 * resueltas todas las comidas que cubre.
 */
export function MealPrep(): React.JSX.Element {
  const { state, dispatch } = useStore();
  const { plan, household } = state;
  const [semana, setSemana] = useState(1);
  const [detalle, setDetalle] = useState<PrepBatch | null>(null);

  const modoActivo = household?.mealPrep?.enabled ?? false;

  const prep = useMemo(() => {
    if (!plan) return null;
    const from = addDaysLocal(plan.startDate, (semana - 1) * 7);
    return planMealPrep(plan, RECIPE_BY_ID, { from, days: 7 });
  }, [plan, semana]);

  if (!plan || !household || !prep) {
    return (
      <>
        <Header title="Cocinar por adelantado" back />
        <main className="contenido">
          <Empty icon="🍲" title="Necesitas un plan primero" />
        </main>
      </>
    );
  }

  const cocinadas = new Set(state.cookedMealIds);
  const tandas = prep.sessions.flatMap((session) => session.batches);
  const tandasHechas = tandas.filter((batch) => batch.mealIds.every((id) => cocinadas.has(id)));

  return (
    <>
      <Header title="Cocinar por adelantado" eyebrow={`Semana ${semana}`} back />
      <main className="contenido pila">
        {!modoActivo && (
          <Notice tone="info">
            <strong>El plan no está armado para cocinar por tandas.</strong> Aun así puedes
            adelantar lo que se deje. Si activas el modo abajo, Rinde repetirá cada plato dentro
            de la semana para que una sola olla resuelva varias comidas.
          </Notice>
        )}

        <Card>
          <Toggle
            checked={modoActivo}
            onChange={(activo) =>
              dispatch({
                type: "setMealPrep",
                mealPrep: activo ? { enabled: true, batchSize: 3, windowDays: 7 } : undefined,
              })
            }
          >
            <strong>Modo cocinar por adelantado</strong>
            <div className="pequeno tenue">
              Regenera el plan repitiendo cada plato hasta 3 veces por semana.
            </div>
          </Toggle>
        </Card>

        {cycleCount(plan) > 1 && (
          <div className="chip-fila">
            {Array.from({ length: cycleCount(plan) }, (_, index) => index + 1).map((numero) => (
              <button
                key={numero}
                type="button"
                className={`chip ${semana === numero ? "chip--activo" : ""}`}
                onClick={() => setSemana(numero)}
              >
                Semana {numero}
              </button>
            ))}
          </div>
        )}

        {/* ------------------------------------------------------ resumen */}
        <Card tone="verde">
          <div className="etiqueta">Tiempo de cocina esta semana</div>
          <div className="fila" style={{ gap: 10, alignItems: "baseline" }}>
            <span className="cifra cifra--xl">{prep.minutesWithPrep}</span>
            <span className="pequeno">min</span>
            {prep.minutesSaved > 0 && (
              <span className="pequeno positivo" style={{ marginLeft: "auto" }}>
                −{prep.minutesSaved} min
              </span>
            )}
          </div>
          <p className="pequeno tenue" style={{ marginTop: 6 }}>
            Cocinando comida por comida serían {prep.minutesIfCookedDaily} minutos.
          </p>
          <div style={{ marginTop: 14 }}>
            <Progress value={prep.batchedMealCount} max={prep.totalMealCount} />
            <p className="diminuto tenue" style={{ marginTop: 6 }}>
              {prep.batchedMealCount} de {prep.totalMealCount} comidas se pueden adelantar
            </p>
          </div>
        </Card>

        {tandas.length > 0 && (
          <p className="pequeno tenue">
            {tandasHechas.length} de {tandas.length} tandas cocinadas
          </p>
        )}

        {/* ------------------------------------------------------ jornadas */}
        {prep.sessions.length === 0 ? (
          <Empty
            icon="🍳"
            title="No hay nada que adelantar esta semana"
            description="Todas las comidas del plan son de las que solo quedan bien recién hechas."
          />
        ) : (
          prep.sessions.map((session) => {
            const listas = session.batches.filter((batch) =>
              batch.mealIds.every((id) => cocinadas.has(id)),
            ).length;
            return (
              <section key={session.date}>
                <div className="grupo-titulo">
                  <span>Jornada · {session.label}</span>
                  <span className="tenue" style={{ textTransform: "none", letterSpacing: 0 }}>
                    {session.activeMinutes} min · {formatCop(session.costCop)}
                  </span>
                </div>

                <div className="pila">
                  {session.batches.map((batch) => {
                    const hecha = batch.mealIds.every((id) => cocinadas.has(id));
                    return (
                      <Card key={batch.id} className={hecha ? "tarjeta--verde" : ""}>
                        <div className="fila fila--entre" style={{ alignItems: "flex-start" }}>
                          <div className="crecer">
                            <h3>{batch.recipeName}</h3>
                            <div className="fila diminuto tenue" style={{ gap: 6, flexWrap: "wrap", marginTop: 5 }}>
                              <span className="insignia insignia--estimado">⏱ {batch.minutes} min</span>
                              <span className="insignia insignia--estimado">
                                {batch.servings} porciones
                              </span>
                              <span className={`insignia ${batch.storage === "congelador" ? "insignia--estimado" : "insignia--verde"}`}>
                                {batch.storage === "congelador" ? "🧊 Congelador" : "❄️ Nevera"}
                              </span>
                            </div>
                          </div>
                          <Money value={batch.costCop} size="md" />
                        </div>

                        <p className="pequeno tenue" style={{ marginTop: 10 }}>
                          Cubre {batch.covers.length} comida(s):{" "}
                          {batch.covers
                            .map((cover) => `${(SLOT_LABEL[cover.slot] ?? cover.slot).toLowerCase()} de ${cover.label}`)
                            .join(", ")}
                          .
                        </p>
                        <p className="diminuto tenue" style={{ marginTop: 4 }}>
                          Consumir antes del {formatDayShort(batch.eatBy)}.
                        </p>
                        {batch.freezeNote && (
                          <p className="diminuto" style={{ marginTop: 4, color: "var(--ambar)" }}>
                            {batch.freezeNote}
                          </p>
                        )}
                        {batch.finishNote && (
                          <p className="diminuto tenue" style={{ marginTop: 4 }}>{batch.finishNote}</p>
                        )}

                        <div className="fila" style={{ gap: 8, marginTop: 14 }}>
                          <button
                            type="button"
                            className="boton boton--secundario boton--compacto"
                            onClick={() => setDetalle(batch)}
                          >
                            Ver qué necesito
                          </button>
                          {hecha ? (
                            <Badge tone="verde">✓ Cocinada</Badge>
                          ) : (
                            <button
                              type="button"
                              className="boton boton--compacto"
                              onClick={() => dispatch({ type: "cookBatch", batch })}
                            >
                              Ya la cociné
                            </button>
                          )}
                        </div>
                      </Card>
                    );
                  })}
                </div>

                <p className="diminuto tenue" style={{ padding: "8px 4px 0" }}>
                  {listas} de {session.batches.length} tandas listas. Empieza por la de arriba:
                  es la que más tarda, y mientras se cocina puedes avanzar con las demás.
                </p>

                <details style={{ marginTop: 10 }}>
                  <summary className="pequeno" style={{ cursor: "pointer" }}>
                    Todo lo que necesitas para esta jornada
                  </summary>
                  <div className="tarjeta tarjeta--plana" style={{ marginTop: 8 }}>
                    <div className="lista">
                      {sessionIngredients(session, INGREDIENT_BY_ID).map((item) => {
                        const ingredient = INGREDIENT_BY_ID.get(item.ingredientId);
                        const cantidad = ingredient ? humanize(item.qtyBase, ingredient) : null;
                        return (
                          <div key={item.ingredientId} className="lista__item">
                            <span className="crecer">{item.name}</span>
                            <span className="pequeno tenue">
                              {cantidad
                                ? `${cantidad.qty} ${cantidad.unit === "unit" ? "u" : cantidad.unit}`
                                : item.qtyBase}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </details>
              </section>
            );
          })
        )}

        {/* ------------------------------------------------ al momento */}
        {prep.cookFresh.length > 0 && (
          <section>
            <div className="grupo-titulo"><span>Estas hay que hacerlas al momento</span></div>
            <div className="tarjeta tarjeta--plana">
              <div className="lista">
                {prep.cookFresh.map((meal) => (
                  <Link
                    key={meal.mealId}
                    to={`/comida/${encodeURIComponent(meal.mealId)}`}
                    className="lista__item"
                  >
                    <span className="crecer">
                      <div className="lista__nombre"><strong>{meal.recipeName}</strong></div>
                      <div className="diminuto tenue">
                        {SLOT_LABEL[meal.slot]} · {formatDayShort(meal.date)} · {meal.minutes} min
                      </div>
                      <div className="diminuto tenue" style={{ marginTop: 3 }}>{meal.reason}</div>
                    </span>
                    <span className="tenue" aria-hidden="true">›</span>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        )}

        {prep.notes.map((note) => (
          <p key={note} className="diminuto tenue">{note}</p>
        ))}

        <Sheet
          open={detalle !== null}
          onClose={() => setDetalle(null)}
          title={detalle?.recipeName ?? ""}
        >
          {detalle && (
            <div className="pila">
              <p className="pequeno tenue">
                Cantidades para las {detalle.servings} porciones de la tanda completa.
              </p>
              <div className="tarjeta tarjeta--plana">
                <div className="lista">
                  {detalle.lines.map((line) => {
                    const ingredient = INGREDIENT_BY_ID.get(line.ingredientId);
                    const cantidad = ingredient ? humanize(line.qtyBase, ingredient) : null;
                    return (
                      <div key={line.ingredientId} className="lista__item">
                        <span className="crecer">{ingredientName(line.ingredientId)}</span>
                        <span className="pequeno tenue">
                          {cantidad
                            ? `${cantidad.qty} ${cantidad.unit === "unit" ? "u" : cantidad.unit}`
                            : line.qtyBase}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <Link
                to={`/receta/${detalle.recipeId}`}
                className="boton boton--secundario"
                onClick={() => setDetalle(null)}
              >
                Ver la receta
              </Link>
            </div>
          )}
        </Sheet>
      </main>
    </>
  );
}

/** Suma días a una fecha `YYYY-MM-DD` sin depender de la zona horaria. */
function addDaysLocal(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}
