import { Link } from "react-router-dom";
import {
  averageCostPerMealPerPerson, buildShoppingList, cycleCount, formatCop, formatDayShort,
} from "@rinde/core";
import { CATEGORIES, INGREDIENT_BY_ID, PRICES, SLOT_LABEL, getRecipe } from "../lib/catalog.js";
import { useStore } from "../state/store.js";
import { Card, Money, Notice, Progress } from "../components/ui.js";

/**
 * Pantalla 3: dashboard (§6, §29.3).
 *
 * Orden de la información, según §30: cuánto dinero tengo → cuánto voy a
 * gastar → qué voy a comer → qué tengo → qué necesito comprar.
 */
export function Dashboard(): React.JSX.Element {
  const { state } = useStore();
  const { household, plan, inventory } = state;

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

  const proxima = plan.meals.find((meal) => meal.status !== "cooked") ?? plan.meals[0];
  const recetaProxima = proxima ? getRecipe(proxima.recipeId) : undefined;

  const cicloActual = siguienteCiclo(plan.startDate, plan.days);
  const lista = buildShoppingList(plan, INGREDIENT_BY_ID, PRICES, {
    cycle: cicloActual,
    categories: CATEGORIES,
  });

  const promedio = averageCostPerMealPerPerson(plan.totalFoodValueCop, plan.meals.length, personas);

  return (
    <main className="contenido pila pila--lg">
      <div>
        <div className="encabezado__eyebrow" style={{ marginBottom: 4 }}>Mi mes</div>
        <h1>{plan.days} días por delante</h1>
      </div>

      {/* ---------------------------------------------------- presupuesto */}
      <Card tone="verde">
        <div className="etiqueta">Presupuesto</div>
        <Money value={household.budgetCop} size="xl" />

        <div style={{ margin: "16px 0 10px" }}>
          <Progress
            value={plan.projectedSpendCop}
            max={household.budgetCop}
            tone={excedido ? "alerta" : usoPct > 0.9 ? "aviso" : "ok"}
          />
        </div>

        <div className="fila fila--entre">
          <div>
            <div className="etiqueta">Gasto proyectado</div>
            <Money value={plan.projectedSpendCop} size="lg" />
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="etiqueta">{excedido ? "Te falta" : "Disponible"}</div>
            <span className={`cifra cifra--lg ${excedido ? "negativo" : ""}`}>
              {formatCop(Math.abs(disponible))}
            </span>
          </div>
        </div>
      </Card>

      {excedido && (
        <Notice tone="alerta">
          <strong>El plan no cabe en tu presupuesto.</strong> Rinde ya intentó abaratarlo con las
          recetas y los precios disponibles. Puedes subir el presupuesto, reducir los días o
          quitar una comida del día en Perfil.
        </Notice>
      )}

      {plan.diagnostics.warnings.some((warning) => /demostración/i.test(warning)) && (
        <Notice tone="demo">
          <strong>Datos de demostración.</strong> Los precios no son reales; sirven para probar la
          aplicación. Ver Perfil → Precios.
        </Notice>
      )}

      {/* --------------------------------------------------------- cifras */}
      <div className="malla-2">
        <Card>
          <div className="etiqueta">Comidas</div>
          <div className="cifra cifra--lg">{plan.meals.length}</div>
        </Card>
        <Card>
          <div className="etiqueta">Personas</div>
          <div className="cifra cifra--lg">{personas}</div>
        </Card>
        <Card>
          <div className="etiqueta">Días</div>
          <div className="cifra cifra--lg">{plan.days}</div>
        </Card>
        <Card>
          <div className="etiqueta">Costo promedio</div>
          <Money value={promedio} size="lg" />
          <div className="diminuto tenue">por comida / persona</div>
        </Card>
      </div>

      {/* -------------------------------------------------- próxima comida */}
      {proxima && recetaProxima && (
        <div>
          <div className="grupo-titulo"><span>Próxima comida</span></div>
          <Card>
            <div className="fila fila--entre" style={{ alignItems: "flex-start" }}>
              <div className="crecer">
                <h3>{recetaProxima.name}</h3>
                <p className="pequeno tenue">
                  {SLOT_LABEL[proxima.slot]} · {formatDayShort(proxima.date)}
                </p>
              </div>
              <div style={{ textAlign: "right" }}>
                <Money value={proxima.costCop} size="md" />
                <div className="diminuto tenue">
                  {formatCop(proxima.costPerPersonCop)} / persona
                </div>
              </div>
            </div>
            <Link
              to={`/comida/${encodeURIComponent(proxima.id)}`}
              className="boton boton--secundario"
              style={{ marginTop: 14 }}
            >
              Ver receta
            </Link>
          </Card>
        </div>
      )}

      {/* --------------------------------------------- despensa y mercado */}
      <div className="pila">
        <Link to="/despensa" className="tarjeta-boton">
          <span aria-hidden="true" style={{ fontSize: 22 }}>🧺</span>
          <span className="crecer">
            <strong>Inventario</strong>
            <div className="pequeno tenue">
              {inventory.length} {inventory.length === 1 ? "ingrediente" : "ingredientes"}
            </div>
          </span>
          <span className="tenue" aria-hidden="true">›</span>
        </Link>

        <Link to="/mercado" className="tarjeta-boton">
          <span aria-hidden="true" style={{ fontSize: 22 }}>🛒</span>
          <span className="crecer">
            <strong>Mercado</strong>
            <div className="pequeno tenue">
              Compra {cicloActual} de {cycleCount(plan)}
            </div>
          </span>
          <span className="fila" style={{ gap: 8 }}>
            <Money value={lista.totalCop} size="md" />
            <span className="tenue" aria-hidden="true">›</span>
          </span>
        </Link>

        <Link to="/que-puedo-cocinar" className="tarjeta-boton">
          <span aria-hidden="true" style={{ fontSize: 22 }}>🍳</span>
          <span className="crecer">
            <strong>¿Qué puedo cocinar?</strong>
            <div className="pequeno tenue">Con lo que hay en la despensa</div>
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

      <p className="diminuto tenue">
        Plan generado con una heurística ({plan.plannerVersion}), no con un optimizador
        matemático: es un plan bueno, no necesariamente el mejor posible.
      </p>
    </main>
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
