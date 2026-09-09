import { useMemo, useState } from "react";
import { buildShoppingList, cycleCount, formatCop } from "@rinde/core";
import { CATEGORIES, CATEGORY_EMOJI, INGREDIENT_BY_ID, PRICES, ingredientName } from "../lib/catalog.js";
import { useStore } from "../state/store.js";
import { Empty, Header, Money, Notice, PriceBadge } from "../components/ui.js";

/** Pantalla 10: lista de mercado (§16, §29.10). */
export function Market(): React.JSX.Element {
  const { state, dispatch } = useStore();
  const { plan } = state;
  const [ciclo, setCiclo] = useState<number | "all">(1);

  const lista = useMemo(
    () =>
      plan
        ? buildShoppingList(plan, INGREDIENT_BY_ID, PRICES, { cycle: ciclo, categories: CATEGORIES })
        : null,
    [plan, ciclo],
  );

  if (!plan || !lista) {
    return (
      <>
        <Header title="Mercado" />
        <main className="contenido">
          <Empty icon="🛒" title="Todavía no hay lista" description="Crea tu plan y la lista se arma sola." />
        </main>
      </>
    );
  }

  const marcados = new Set(state.checkedIngredientIds);
  const items = lista.groups.flatMap((group) => group.items);
  const pendiente = items
    .filter((item) => !marcados.has(item.ingredientId))
    .reduce((total, item) => total + (item.lineCostCop ?? 0), 0);
  const comprados = items.filter((item) => marcados.has(item.ingredientId)).length;

  return (
    <>
      <Header
        title="Mercado"
        eyebrow={ciclo === "all" ? "Todo el plan" : `Compra ${ciclo} de ${cycleCount(plan)}`}
      />
      <main className="contenido pila">
        <div className="chip-fila">
          {Array.from({ length: cycleCount(plan) }, (_, index) => index + 1).map((numero) => (
            <button
              key={numero}
              type="button"
              className={`chip ${ciclo === numero ? "chip--activo" : ""}`}
              onClick={() => setCiclo(numero)}
            >
              Semana {numero}
            </button>
          ))}
          <button
            type="button"
            className={`chip ${ciclo === "all" ? "chip--activo" : ""}`}
            onClick={() => setCiclo("all")}
          >
            Todo el plan
          </button>
        </div>

        <div className="tarjeta tarjeta--verde">
          <div className="fila fila--entre">
            <div>
              <div className="etiqueta">Total de esta compra</div>
              <Money value={lista.totalCop} size="xl" />
            </div>
            {comprados > 0 && (
              <div style={{ textAlign: "right" }}>
                <div className="etiqueta">Falta</div>
                <span className="cifra cifra--md">{formatCop(pendiente)}</span>
              </div>
            )}
          </div>
          <p className="diminuto tenue" style={{ marginTop: 8 }}>
            {items.length} productos · {comprados} marcados
          </p>
        </div>

        {lista.containsDemoPrices && (
          <Notice tone="demo">
            <strong>Datos de demostración.</strong> Estos precios no son reales. Sirven para probar
            el flujo completo, no para saber cuánto vas a pagar.
          </Notice>
        )}

        {lista.unpricedIngredientIds.length > 0 && (
          <Notice tone="info">
            Sin precio: {lista.unpricedIngredientIds.map(ingredientName).join(", ")}. No están
            sumados en el total; el gasto real será mayor.
          </Notice>
        )}

        {lista.groups.length === 0 ? (
          <Empty
            icon="✅"
            title="Nada que comprar en esta semana"
            description="Con lo que tienes en la despensa alcanza."
          />
        ) : (
          lista.groups.map((group) => (
            <section key={group.categoryId}>
              <div className="grupo-titulo">
                <span>{CATEGORY_EMOJI[group.categoryId] ?? "🍽️"} {group.categoryName}</span>
                <span className="tenue" style={{ textTransform: "none", letterSpacing: 0 }}>
                  {formatCop(group.subtotalCop)}
                </span>
              </div>
              <div className="tarjeta tarjeta--plana">
                <div className="lista">
                  {group.items.map((item) => {
                    const marcado = marcados.has(item.ingredientId);
                    return (
                      <button
                        key={item.ingredientId}
                        type="button"
                        className={`lista__item ${marcado ? "lista__item--comprado" : ""}`}
                        aria-pressed={marcado}
                        onClick={() => dispatch({ type: "toggleChecked", ingredientId: item.ingredientId })}
                      >
                        <span className={`casilla ${marcado ? "casilla--marcada" : ""}`} aria-hidden="true">
                          {marcado ? "✓" : ""}
                        </span>
                        <span className="crecer">
                          <div className="lista__nombre">
                            <strong>{ingredientName(item.ingredientId)}</strong>
                          </div>
                          <div className="diminuto tenue">
                            {item.display.qty}{" "}
                            {item.display.unit === "unit"
                              ? item.display.qty === 1 ? "unidad" : "unidades"
                              : item.display.unit}
                            {item.packLabel && ` · ${item.packLabel}`}
                            {item.surplusBase > 0 && " · sobra un poco"}
                          </div>
                        </span>
                        <span style={{ textAlign: "right", flex: "none" }}>
                          <Money value={item.lineCostCop} size="sm" />
                          <div><PriceBadge confidence={item.priceConfidence} isDemo={item.priceIsDemo} /></div>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>
          ))
        )}

        <p className="diminuto tenue">
          Las cantidades ya están redondeadas a como se venden los productos, así que puede sobrar
          un poco de algunos. Ese sobrante vuelve a tu despensa.
        </p>
      </main>
    </>
  );
}
