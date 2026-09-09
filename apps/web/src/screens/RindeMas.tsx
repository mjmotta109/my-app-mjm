import { useMemo, useState } from "react";
import { formatCop, rindeMas } from "@rinde/core";
import { INGREDIENT_BY_ID, PRICES, ingredientName } from "../lib/catalog.js";
import { useStore } from "../state/store.js";
import { Card, Empty, Header, Money, Notice } from "../components/ui.js";

/** "Rinde más" (§12): en qué conviene gastar el dinero que sobra. */
export function RindeMas(): React.JSX.Element {
  const { state } = useStore();
  const { plan, household } = state;
  const disponible = plan ? Math.max(0, plan.diagnostics.budgetDeltaCop) : 0;
  const [extra, setExtra] = useState(String(disponible || 50_000));

  const extraCop = Number(extra.replace(/\D/g, "")) || 0;

  const opciones = useMemo(
    () => (plan ? rindeMas(extraCop, plan, INGREDIENT_BY_ID, PRICES, {
      excludedIngredientIds: new Set(
        (household?.preferences ?? [])
          .filter((preference) => preference.kind === "allergy")
          .map((preference) => preference.value),
      ),
    }) : []),
    [plan, extraCop, household],
  );

  if (!plan) {
    return (
      <>
        <Header title="Rinde más" back />
        <main className="contenido">
          <Empty icon="✨" title="Necesitas un plan primero" />
        </main>
      </>
    );
  }

  return (
    <>
      <Header title="Rinde más" eyebrow="En qué conviene gastarlo" back />
      <main className="contenido pila pila--lg">
        <Card>
          <div className="campo">
            <label className="etiqueta" htmlFor="extra">¿Cuánto dinero extra tienes?</label>
            <input
              id="extra"
              className="entrada-dinero"
              inputMode="numeric"
              value={formatCop(extraCop).replace("$", "")}
              onChange={(event) => setExtra(event.target.value.replace(/\D/g, ""))}
            />
            {disponible > 0 && (
              <p className="campo__ayuda" style={{ textAlign: "center" }}>
                Te sobran {formatCop(disponible)} de tu presupuesto.
              </p>
            )}
          </div>
        </Card>

        {extraCop <= 0 ? (
          <Notice tone="info">Escribe un monto para ver opciones.</Notice>
        ) : (
          opciones.map((opcion, index) => (
            <section key={opcion.id}>
              <div className="grupo-titulo"><span>Opción {index + 1}</span></div>
              <Card>
                <div className="fila fila--entre" style={{ alignItems: "flex-start" }}>
                  <div className="crecer">
                    <h3>{opcion.title}</h3>
                    <p className="pequeno tenue">{opcion.description}</p>
                  </div>
                  <Money value={opcion.totalCop} size="md" />
                </div>

                <div className="lista" style={{ margin: "14px -16px 0" }}>
                  {opcion.items.map((item) => (
                    <div key={item.ingredientId} className="lista__item">
                      <span className="crecer">
                        <strong>{ingredientName(item.ingredientId)}</strong>
                        <div className="diminuto tenue">
                          {item.display.qty}{" "}
                          {item.display.unit === "unit"
                            ? item.display.qty === 1 ? "unidad" : "unidades"
                            : item.display.unit}
                        </div>
                      </span>
                      <Money value={item.costCop} size="sm" />
                    </div>
                  ))}
                </div>

                <div style={{ paddingTop: 14 }}>
                  {opcion.extraMeals === null ? (
                    <p className="pequeno" style={{ color: "var(--ambar)" }}>
                      No podemos estimar cuántas comidas añade.
                    </p>
                  ) : (
                    <div className="fila" style={{ gap: 8 }}>
                      <span className="cifra cifra--lg">{opcion.extraMeals}</span>
                      <span className="pequeno tenue">
                        {opcion.extraMeals === 1 ? "comida adicional" : "comidas adicionales"}
                      </span>
                    </div>
                  )}
                  <p className="diminuto tenue" style={{ marginTop: 6 }}>{opcion.basis}</p>
                </div>
              </Card>
            </section>
          ))
        )}

        <Notice tone="info">
          Estas cifras salen de tu propio plan: se mide cuánto usa realmente cada comida tuya y
          se divide. No son promedios inventados.
        </Notice>
      </main>
    </>
  );
}
