import { Link } from "react-router-dom";
import { expiringSoon, expiryUrgency, formatCop, humanize } from "@rinde/core";
import { CATEGORY_EMOJI, INGREDIENT_BY_ID, PRICES, categoryName, getIngredient } from "../lib/catalog.js";
import { today, useStore } from "../state/store.js";
import { Badge, Empty, Header, Money, Notice } from "../components/ui.js";

/** Pantalla 6: despensa / inventario (§10, §29.6). */
export function Pantry(): React.JSX.Element {
  const { state, dispatch } = useStore();
  const hoy = today();
  const porVencer = expiringSoon(state.inventory, hoy, 5);

  const grupos = new Map<string, typeof state.inventory>();
  for (const item of state.inventory) {
    const categoria = getIngredient(item.ingredientId)?.categoryId ?? "abarrotes";
    const lista = grupos.get(categoria);
    if (lista) lista.push(item);
    else grupos.set(categoria, [item]);
  }

  const valorTotal = state.inventory.reduce((total, item) => {
    const cost = PRICES.costOf(item.ingredientId, item.qtyBase);
    return total + (cost ?? 0);
  }, 0);
  const algoSinPrecio = state.inventory.some(
    (item) => PRICES.costOf(item.ingredientId, item.qtyBase) === null,
  );

  return (
    <>
      <Header
        title="Mi despensa"
        eyebrow={`${state.inventory.length} ${state.inventory.length === 1 ? "ingrediente" : "ingredientes"}`}
        action={<Link to="/despensa/agregar" className="boton boton--compacto">Agregar</Link>}
      />
      <main className="contenido pila">
        {state.inventory.length === 0 ? (
          <Empty
            icon="🧺"
            title="Tu despensa está vacía"
            description="Agrega lo que tengas en casa para que Rinde no te lo haga comprar otra vez."
            action={<Link to="/despensa/agregar" className="boton">Agregar ingredientes</Link>}
          />
        ) : (
          <>
            {/*
              La acción principal de esta pantalla. "¿Qué puedo cocinar?" era un
              destino más en la navegación inferior, lejos del único momento en
              que alguien se hace esa pregunta: mirando lo que tiene.
            */}
            <Link to="/que-puedo-cocinar" className="boton">
              🍳 ¿Qué puedo cocinar con esto?
            </Link>

            <div className="tarjeta tarjeta--verde">
              <div className="etiqueta">Valor de lo que tienes</div>
              <Money value={valorTotal} size="lg" />
              <p className="diminuto tenue" style={{ marginTop: 4 }}>
                A precios de referencia{algoSinPrecio ? ". Algunos ingredientes no tienen precio y no suman." : "."}
              </p>
            </div>

            {porVencer.length > 0 && (
              <Notice tone="alerta">
                <strong>Se vence pronto:</strong>{" "}
                {porVencer
                  .map((item) => getIngredient(item.ingredientId)?.name ?? item.ingredientId)
                  .join(", ")}
                . Rinde ya está priorizando estos ingredientes en tu plan.
              </Notice>
            )}

            {[...grupos.entries()].map(([categoria, items]) => (
              <section key={categoria}>
                <div className="grupo-titulo">
                  <span>{CATEGORY_EMOJI[categoria] ?? "🍽️"} {categoryName(categoria)}</span>
                  <span className="tenue" style={{ textTransform: "none", letterSpacing: 0 }}>
                    {items.length}
                  </span>
                </div>
                <div className="tarjeta tarjeta--plana">
                  <div className="lista">
                    {items.map((item) => {
                      const ingredient = getIngredient(item.ingredientId);
                      const cantidad = ingredient ? humanize(item.qtyBase, ingredient) : null;
                      const urgencia = expiryUrgency(item.expiresOn, hoy);
                      const valor = PRICES.costOf(item.ingredientId, item.qtyBase);
                      return (
                        <div key={item.id} className="lista__item">
                          <span className="crecer">
                            <div className="lista__nombre">
                              <strong>{ingredient?.name ?? item.ingredientId}</strong>
                            </div>
                            <div className="diminuto tenue">
                              {cantidad ? `${cantidad.qty} ${cantidad.unit === "unit" ? (cantidad.qty === 1 ? "unidad" : "unidades") : cantidad.unit}` : item.qtyBase}
                              {valor !== null && ` · ${formatCop(valor)}`}
                            </div>
                            {item.expiresOn && urgencia !== "ok" && (
                              <div style={{ marginTop: 5 }}>
                                <Badge tone={urgencia === "expired" || urgencia === "urgent" ? "alerta" : "estimado"}>
                                  {ETIQUETA_VENCIMIENTO[urgencia]}
                                </Badge>
                              </div>
                            )}
                          </span>
                          <div className="fila" style={{ gap: 6, flex: "none" }}>
                            <button
                              type="button"
                              className="boton-icono"
                              aria-label={`Reducir ${ingredient?.name ?? item.ingredientId}`}
                              onClick={() =>
                                dispatch({
                                  type: "updateInventory",
                                  id: item.id,
                                  qtyBase: Math.max(0, item.qtyBase - (ingredient?.roundingStep ?? 1)),
                                })
                              }
                            >
                              −
                            </button>
                            <button
                              type="button"
                              className="boton-icono"
                              aria-label={`Aumentar ${ingredient?.name ?? item.ingredientId}`}
                              onClick={() =>
                                dispatch({
                                  type: "updateInventory",
                                  id: item.id,
                                  qtyBase: item.qtyBase + (ingredient?.roundingStep ?? 1),
                                })
                              }
                            >
                              +
                            </button>
                            <button
                              type="button"
                              className="boton-icono"
                              aria-label={`Eliminar ${ingredient?.name ?? item.ingredientId}`}
                              onClick={() => dispatch({ type: "removeInventory", id: item.id })}
                            >
                              🗑
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>
            ))}
          </>
        )}
      </main>
    </>
  );
}

const ETIQUETA_VENCIMIENTO: Record<string, string> = {
  expired: "Vencido",
  urgent: "Vence hoy o mañana",
  soon: "Vence esta semana",
  unknown: "Sin fecha",
  ok: "",
};
