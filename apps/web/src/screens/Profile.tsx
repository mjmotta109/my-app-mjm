import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FEATURE_LABELS, can, describeChange, formatCop, weeklyPriceUpdate } from "@rinde/core";
import type { Feature, MealSlot, UserPreference } from "@rinde/core";
import {
  CATALOG_AS_OF, DEMO_NOTICE, DEMO_PRICE_HISTORY, INGREDIENTS, INGREDIENT_BY_ID,
  NUTRITION_DISCLAIMER, PRICES, SLOT_LABEL, ingredientName,
} from "../lib/catalog.js";
import { DEMO_PRICES } from "@rinde/data";
import { useStore } from "../state/store.js";
import { Badge, Card, Counter, Header, Notice, Sheet, Toggle } from "../components/ui.js";

/** Pantalla 11: perfil y configuración (§29.11, §27, §28). */
export function Profile(): React.JSX.Element {
  const { state, dispatch } = useStore();
  const navigate = useNavigate();
  const [verPrecios, setVerPrecios] = useState(false);
  const [verAlergias, setVerAlergias] = useState(false);

  const household = state.household;
  if (!household) {
    return (
      <>
        <Header title="Perfil" />
        <main className="contenido"><Notice tone="info">Todavía no hay un hogar configurado.</Notice></main>
      </>
    );
  }

  const alergias = household.preferences.filter((preference) => preference.kind === "allergy");

  function setPreference(value: string, activo: boolean): void {
    const otras = household!.preferences.filter(
      (preference) => !(preference.kind === "allergy" && preference.value === value),
    );
    const nuevas: UserPreference[] = activo
      ? [...otras, { kind: "allergy", value, severity: "hard" }]
      : otras;
    dispatch({ type: "setPreferences", preferences: nuevas });
  }

  return (
    <>
      <Header title="Perfil" eyebrow="Tu hogar y tus preferencias" />
      <main className="contenido pila pila--lg">
        {/* ------------------------------------------------------- hogar */}
        <section>
          <div className="grupo-titulo"><span>Mi hogar</span></div>
          <Card>
            <Counter
              label="Adultos"
              value={household.adults}
              min={0}
              onChange={(adults) => dispatch({ type: "updateHousehold", patch: { adults } })}
            />
            <hr className="separador" />
            <Counter
              label="Niños"
              value={household.children}
              min={0}
              onChange={(children) => dispatch({ type: "updateHousehold", patch: { children } })}
            />
            <p className="diminuto tenue" style={{ marginTop: 10 }}>
              Rinde calcula las porciones contando a un niño como 0,7 de la porción de un adulto.
              Es un supuesto de planificación, no un dato nutricional.
            </p>
          </Card>
        </section>

        {/* -------------------------------------------------- presupuesto */}
        <section>
          <div className="grupo-titulo"><span>Presupuesto y días</span></div>
          <Card>
            <div className="campo">
              <label className="etiqueta" htmlFor="presupuesto">Presupuesto del periodo</label>
              <input
                id="presupuesto"
                inputMode="numeric"
                value={formatCop(household.budgetCop).replace("$", "")}
                onChange={(event) => {
                  const budgetCop = Number(event.target.value.replace(/\D/g, "")) || 0;
                  if (budgetCop > 0) dispatch({ type: "updateHousehold", patch: { budgetCop } });
                }}
              />
            </div>
            <div className="campo" style={{ marginTop: 14 }}>
              <span className="etiqueta">Días a planificar</span>
              <div className="chip-fila">
                {[7, 15, 30].map((dias) => (
                  <button
                    key={dias}
                    type="button"
                    className={`chip ${household.days === dias ? "chip--activo" : ""}`}
                    onClick={() => dispatch({ type: "updateHousehold", patch: { days: dias } })}
                  >
                    {dias} días
                  </button>
                ))}
              </div>
            </div>
          </Card>
        </section>

        {/* ------------------------------------------------------ comidas */}
        <section>
          <div className="grupo-titulo"><span>Comidas del día</span></div>
          <div className="pila">
            {(["desayuno", "almuerzo", "cena", "snack"] as MealSlot[]).map((slot) => (
              <Toggle
                key={slot}
                checked={household.slots.includes(slot)}
                onChange={(checked) => {
                  const orden: MealSlot[] = ["desayuno", "almuerzo", "cena", "snack"];
                  const slots = orden.filter((entry) =>
                    entry === slot ? checked : household.slots.includes(entry),
                  );
                  if (slots.length > 0) dispatch({ type: "updateHousehold", patch: { slots } });
                }}
              >
                {SLOT_LABEL[slot]}
              </Toggle>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------- alergias */}
        <section>
          <div className="grupo-titulo"><span>Alergias y restricciones</span></div>
          <button type="button" className="tarjeta-boton" onClick={() => setVerAlergias(true)}>
            <span aria-hidden="true" style={{ fontSize: 20 }}>⚠️</span>
            <span className="crecer">
              <strong>{alergias.length === 0 ? "Ninguna registrada" : `${alergias.length} registradas`}</strong>
              <div className="pequeno tenue">
                {alergias.length === 0
                  ? "Toca para agregar"
                  : alergias.map((preference) => ingredientName(preference.value)).join(", ")}
              </div>
            </span>
            <span className="tenue" aria-hidden="true">›</span>
          </button>
          <Notice tone="alerta">
            <strong>Importante:</strong> Rinde no es una herramienta médica. Si registras una
            alergia, se excluyen las recetas que contengan ese ingrediente, incluso como opcional.
            Aun así, <strong>revisa siempre las etiquetas y los ingredientes tú mismo</strong>. Un
            error en el catálogo o una receta preparada por otra persona pueden contener trazas.
          </Notice>
        </section>

        {/* ----------------------------------------------------- precios */}
        <section>
          <div className="grupo-titulo"><span>Precios</span></div>
          <button type="button" className="tarjeta-boton" onClick={() => setVerPrecios(true)}>
            <span aria-hidden="true" style={{ fontSize: 20 }}>🏷️</span>
            <span className="crecer">
              <strong>Origen de los precios</strong>
              <div className="pequeno tenue">{PRICES.size} productos con precio</div>
            </span>
            <Badge tone="demo">Demo</Badge>
          </button>
        </section>

        {/* ------------------------------------------------------- plan */}
        <section>
          <div className="grupo-titulo"><span>Tu plan</span></div>
          <div className="pila">
            <button
              type="button"
              className="boton boton--secundario"
              onClick={() => {
                if (confirm("Se generará un plan nuevo con tu configuración actual. ¿Continuar?")) {
                  dispatch({ type: "regeneratePlan" });
                }
              }}
            >
              Regenerar el plan
            </button>
            <button
              type="button"
              className="boton boton--peligro"
              onClick={() => {
                if (confirm("Se borrará tu hogar, tu despensa y tu plan de este dispositivo. ¿Seguro?")) {
                  dispatch({ type: "reset" });
                  navigate("/bienvenida", { replace: true });
                }
              }}
            >
              Borrar todos mis datos
            </button>
          </div>
        </section>

        {/* --------------------------------------------------- freemium */}
        <section>
          <div className="grupo-titulo"><span>Tu plan de Rinde</span><Badge tone="verde">{household.tier === "premium" ? "Premium" : "Gratis"}</Badge></div>
          <Card>
            <div className="pila">
              {(Object.keys(FEATURE_LABELS) as Feature[]).map((feature) => (
                <div key={feature} className="fila fila--entre">
                  <span className={can(feature, household.tier) ? "" : "tenue"}>
                    {FEATURE_LABELS[feature]}
                  </span>
                  <span aria-hidden="true">{can(feature, household.tier) ? "✓" : "🔒"}</span>
                </div>
              ))}
            </div>
            <p className="diminuto tenue" style={{ marginTop: 14 }}>
              Todavía no hay pagos ni suscripciones. En el MVP nada está bloqueado; esta lista
              muestra cómo quedaría dividido.
            </p>
          </Card>
        </section>

        {/* --------------------------------------------------- privacidad */}
        <section>
          <div className="grupo-titulo"><span>Privacidad</span></div>
          <Card>
            <p className="pequeno media">
              Rinde guarda tu hogar, tu despensa y tu plan <strong>solo en este dispositivo</strong>.
              No pide correo, no pide teléfono y no envía tus datos a ningún servidor. Si borras los
              datos de la aplicación, se borran de verdad.
            </p>
            <p className="diminuto tenue" style={{ marginTop: 12 }}>{NUTRITION_DISCLAIMER}</p>
          </Card>
        </section>

        <p className="diminuto tenue" style={{ textAlign: "center" }}>
          Rinde · MVP · catálogo con fecha de referencia {CATALOG_AS_OF}
        </p>

        <Sheet open={verAlergias} onClose={() => setVerAlergias(false)} title="Alergias y restricciones">
          <p className="pequeno media" style={{ marginBottom: 14 }}>
            Marca los ingredientes que no puedes consumir. Las recetas que los contengan
            desaparecen de tu plan.
          </p>
          <div className="pila">
            {INGREDIENTS.filter((ingredient) =>
              ["huevo", "leche_entera", "queso_campesino", "harina_trigo", "pasta_espagueti",
               "tilapia", "atun_lata", "cerdo_lomo", "carne_res", "pollo_pechuga"].includes(ingredient.id),
            ).map((ingredient) => (
              <Toggle
                key={ingredient.id}
                checked={alergias.some((preference) => preference.value === ingredient.id)}
                onChange={(checked) => setPreference(ingredient.id, checked)}
              >
                {ingredient.name}
              </Toggle>
            ))}
          </div>
          <button type="button" className="boton" style={{ marginTop: 18 }} onClick={() => setVerAlergias(false)}>
            Listo
          </button>
        </Sheet>

        <Sheet open={verPrecios} onClose={() => setVerPrecios(false)} title="Origen de los precios">
          <PreciosPanel />
          <button type="button" className="boton" style={{ marginTop: 18 }} onClick={() => setVerPrecios(false)}>
            Cerrar
          </button>
        </Sheet>
      </main>
    </>
  );
}

/** Panel de procedencia y variación semanal (§17, §19). */
function PreciosPanel(): React.JSX.Element {
  const resultado = weeklyPriceUpdate({
    sourceId: "demo_bogota",
    isDemo: true,
    observations: DEMO_PRICES.map((price) => ({
      ingredientId: price.ingredientId,
      priceCop: price.priceCop,
      quantity: price.quantity,
      unit: price.unit,
      city: price.city,
      observedOn: price.observedOn,
      confidence: price.confidence,
    })),
    catalog: INGREDIENT_BY_ID,
    previousHistory: DEMO_PRICE_HISTORY,
    asOf: CATALOG_AS_OF,
  });

  const mayores = resultado.report.changes.slice(0, 8);

  return (
    <div className="pila">
      <Notice tone="demo"><strong>{DEMO_NOTICE}</strong></Notice>

      <Card>
        <div className="fila fila--entre">
          <span className="etiqueta">Semana</span>
          <strong>{resultado.report.week}</strong>
        </div>
        <hr className="separador" />
        <div className="fila fila--entre">
          <span className="etiqueta">Productos con precio</span>
          <strong>{resultado.report.accepted}</strong>
        </div>
        <hr className="separador" />
        <div className="fila fila--entre">
          <span className="etiqueta">Fuente</span>
          <strong>Datos de demostración</strong>
        </div>
      </Card>

      <div>
        <div className="grupo-titulo"><span>Lo que más se movió</span></div>
        <div className="tarjeta tarjeta--plana">
          <div className="lista">
            {mayores.map((change) => (
              <div key={change.ingredientId} className="lista__item">
                <span className="crecer">
                  <strong>{ingredientName(change.ingredientId)}</strong>
                  <div className="diminuto tenue">{describeChange(change)}</div>
                </span>
                <span className={`cifra ${change.direction === "up" ? "negativo" : "positivo"}`}>
                  {change.changePct > 0 ? "+" : ""}
                  {change.changePct.toFixed(1).replace(".", ",")}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <Card>
        <h3 style={{ marginBottom: 8 }}>¿Por qué no hay precios reales?</h3>
        <p className="pequeno media">
          Conectar una fuente real exige verificar su esquema, su licencia y su cobertura. Rinde
          admite carga manual, importación por CSV y APIs autorizadas, pero no hace scraping de
          sitios que no lo permiten, y no inventa un precio para llenar un hueco.
        </p>
        <p className="pequeno media" style={{ marginTop: 10 }}>
          Mientras no haya datos verificados, todo lo que ves lleva la etiqueta
          "Datos de demostración". Ver <code>docs/DATA_SOURCES.md</code>.
        </p>
      </Card>
    </div>
  );
}
