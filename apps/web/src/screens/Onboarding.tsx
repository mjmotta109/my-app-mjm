import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  formatCop, humanize, parsePantryText, planPurchase, roundForDisplay,
  type CookingTimeBudget, type InventoryItem, type MealSlot, type ParsedItem,
} from "@rinde/core";
import { TIME_PRESETS } from "../lib/time-presets.js";
import { INGREDIENT_BY_ID, INGREDIENTS } from "../lib/catalog.js";
import { createHousehold, createInventoryItem, useStore } from "../state/store.js";
import { Card, Counter, Notice, Toggle } from "../components/ui.js";

/**
 * Pantalla 2: configuración inicial (§5, §29.2).
 *
 * Cuatro preguntas, una por pantalla. La cuarta —qué tienes en casa— acepta
 * texto libre ("un poquito de pollo, unas papas y tres tomates"), pero cuando
 * la frase no dice una cantidad concreta, Rinde PREGUNTA en vez de inventarla.
 */

const SLOTS: { id: MealSlot; label: string; hint: string }[] = [
  { id: "desayuno", label: "Desayuno", hint: "Con qué empiezas el día" },
  { id: "almuerzo", label: "Almuerzo", hint: "La comida principal" },
  { id: "cena", label: "Cena", hint: "Lo de la noche" },
  { id: "snack", label: "Snacks", hint: "Entre comidas" },
];

const BASICOS = [
  "arroz_blanco", "pollo_pechuga", "huevo", "papa_pastusa", "lenteja",
  "frijol_rojo", "aceite_girasol", "tomate", "cebolla_cabezona", "panela",
  "leche_entera", "platano_maduro",
];

interface Borrador {
  ingredientId: string;
  qtyBase: number | null;
  needsConfirmation: boolean;
  rawText?: string;
}

export function Onboarding(): React.JSX.Element {
  const { dispatch } = useStore();
  const navigate = useNavigate();

  const [paso, setPaso] = useState(0);
  const [presupuesto, setPresupuesto] = useState("800000");
  const [adultos, setAdultos] = useState(2);
  const [ninos, setNinos] = useState(0);
  const [dias, setDias] = useState(30);
  const [slots, setSlots] = useState<MealSlot[]>(["desayuno", "almuerzo", "cena"]);
  const [tiempoId, setTiempoId] = useState("normal");
  const [tandas, setTandas] = useState(false);
  const [texto, setTexto] = useState("");
  const [borradores, setBorradores] = useState<Borrador[]>([]);
  const [noReconocido, setNoReconocido] = useState<string[]>([]);

  const presupuestoCop = Number(presupuesto.replace(/\D/g, "")) || 0;
  const personas = adultos + ninos;
  const comidas = dias * slots.length;

  function agregarDesdeTexto(): void {
    if (!texto.trim()) return;
    const resultado = parsePantryText(texto, INGREDIENT_BY_ID);
    fusionar(resultado.items.map(desdeParsed));
    setNoReconocido(resultado.unrecognized);
    setTexto("");
  }

  function desdeParsed(item: ParsedItem): Borrador {
    return {
      ingredientId: item.ingredientId,
      qtyBase: item.qtyBase,
      needsConfirmation: item.needsConfirmation,
      rawText: item.rawText,
    };
  }

  function fusionar(nuevos: Borrador[]): void {
    setBorradores((actuales) => {
      const mapa = new Map(actuales.map((item) => [item.ingredientId, item]));
      for (const nuevo of nuevos) mapa.set(nuevo.ingredientId, nuevo);
      return [...mapa.values()];
    });
  }

  function agregarBasico(ingredientId: string): void {
    const ingredient = INGREDIENT_BY_ID.get(ingredientId);
    if (!ingredient) return;
    if (borradores.some((item) => item.ingredientId === ingredientId)) {
      setBorradores((items) => items.filter((item) => item.ingredientId !== ingredientId));
      return;
    }
    // Se propone el formato de venta más pequeño como punto de partida. El
    // usuario lo ve y lo puede cambiar: no se guarda nada a sus espaldas.
    const sugerido = planPurchase(ingredient.roundingStep, ingredient).purchaseBase;
    fusionar([{ ingredientId, qtyBase: sugerido, needsConfirmation: false }]);
  }

  function crearPlan(): void {
    const inventory: InventoryItem[] = borradores
      .filter((item): item is Borrador & { qtyBase: number } => item.qtyBase !== null && item.qtyBase > 0)
      .map((item) => createInventoryItem(item.ingredientId, item.qtyBase));

    const preset = TIME_PRESETS.find((entry) => entry.id === tiempoId);
    const household = createHousehold({
      adults: adultos, children: ninos, budgetCop: presupuestoCop, slots, days: dias,
      ...(preset ? { cookingTime: preset.budget } : {}),
      ...(tandas ? { mealPrep: { enabled: true, batchSize: 3, windowDays: 7 } } : {}),
    });
    dispatch({ type: "onboard", household, inventory });
    navigate("/", { replace: true });
  }

  const pasos = [
    {
      titulo: "¿Cuánto quieres que rinda tu comida?",
      subtitulo: "Introduce tu presupuesto para todo el periodo.",
      valido: presupuestoCop > 0,
      contenido: (
        <div className="pila">
          <div className="campo">
            <input
              className="entrada-dinero"
              inputMode="numeric"
              value={presupuesto === "" ? "" : formatCop(presupuestoCop).replace("$", "")}
              onChange={(event) => setPresupuesto(event.target.value.replace(/\D/g, ""))}
              aria-label="Presupuesto en pesos colombianos"
            />
            <p className="campo__ayuda" style={{ textAlign: "center" }}>Pesos colombianos (COP)</p>
          </div>
          <div className="chip-fila">
            {[400_000, 600_000, 800_000, 1_200_000].map((monto) => (
              <button
                key={monto}
                type="button"
                className={`chip ${presupuestoCop === monto ? "chip--activo" : ""}`}
                onClick={() => setPresupuesto(String(monto))}
              >
                {formatCop(monto)}
              </button>
            ))}
          </div>
        </div>
      ),
    },
    {
      titulo: "¿Para cuántas personas?",
      subtitulo: "Y por cuántos días quieres planificar.",
      valido: personas > 0 && dias > 0,
      contenido: (
        <div className="pila">
          <Card>
            <Counter label="Adultos" value={adultos} onChange={setAdultos} min={0} max={10} />
            <hr className="separador" />
            <Counter label="Niños" value={ninos} onChange={setNinos} min={0} max={10} />
          </Card>
          <div className="campo">
            <span className="etiqueta">Días a planificar</span>
            <div className="chip-fila">
              {[7, 15, 30].map((valor) => (
                <button
                  key={valor}
                  type="button"
                  className={`chip ${dias === valor ? "chip--activo" : ""}`}
                  onClick={() => setDias(valor)}
                >
                  {valor} días
                </button>
              ))}
            </div>
          </div>
          {personas === 0 && (
            <Notice tone="alerta">Necesitamos al menos una persona para calcular las porciones.</Notice>
          )}
        </div>
      ),
    },
    {
      titulo: "¿Qué comidas quieres planificar?",
      subtitulo: "Puedes cambiarlo después.",
      valido: slots.length > 0,
      contenido: (
        <div className="pila">
          {SLOTS.map((slot) => (
            <Toggle
              key={slot.id}
              checked={slots.includes(slot.id)}
              onChange={(checked) =>
                setSlots((actuales) =>
                  checked
                    ? [...SLOTS.map((s) => s.id).filter((id) => actuales.includes(id) || id === slot.id)]
                    : actuales.filter((id) => id !== slot.id),
                )
              }
            >
              <strong>{slot.label}</strong>
              <div className="pequeno tenue">{slot.hint}</div>
            </Toggle>
          ))}
          {slots.length > 0 && (
            <p className="pequeno tenue">
              Son {comidas} comidas para {personas} {personas === 1 ? "persona" : "personas"}.
            </p>
          )}
        </div>
      ),
    },
    {
      titulo: "¿Cuánto tiempo tienes para cocinar?",
      subtitulo: "Rinde solo propone recetas que te quepan en el día que tienes.",
      valido: true,
      contenido: (
        <div className="pila">
          {TIME_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`opcion ${tiempoId === preset.id ? "opcion--activa" : ""}`}
              onClick={() => setTiempoId(preset.id)}
            >
              <span className="opcion__marca" aria-hidden="true">
                {tiempoId === preset.id ? "✓" : ""}
              </span>
              <span className="crecer">
                <strong>{preset.label}</strong>
                <div className="pequeno tenue">{preset.description}</div>
                <div className="diminuto tenue" style={{ marginTop: 4 }}>
                  Entre semana: almuerzo {preset.budget.weekday.almuerzo} min · cena{" "}
                  {preset.budget.weekday.cena} min
                </div>
              </span>
            </button>
          ))}

          <hr className="separador" style={{ margin: "10px 0" }} />

          <Toggle checked={tandas} onChange={setTandas}>
            <strong>Quiero cocinar por adelantado</strong>
            <div className="pequeno tenue">
              Cocinas dos veces por semana en vez de todos los días. Rinde arma el plan
              repitiendo cada plato para que valga la pena hacer la tanda.
            </div>
          </Toggle>

          {tandas && (
            <Notice tone="info">
              Con esto vas a comer el mismo plato hasta tres veces por semana. Es el costo de
              cocinar una sola vez: si prefieres variedad todos los días, déjalo apagado.
            </Notice>
          )}
        </div>
      ),
    },
    {
      titulo: "¿Qué tienes en casa?",
      subtitulo: "Lo que ya tienes no hay que comprarlo. Puedes saltarte este paso.",
      valido: true,
      contenido: (
        <div className="pila">
          <div className="campo">
            <label className="etiqueta" htmlFor="texto-despensa">Escríbelo como lo dirías</label>
            <textarea
              id="texto-despensa"
              rows={3}
              placeholder="Tengo un poquito de pollo, unas papas y tres tomates"
              value={texto}
              onChange={(event) => setTexto(event.target.value)}
              style={{ minHeight: 88, resize: "vertical" }}
            />
            <button type="button" className="boton boton--secundario" onClick={agregarDesdeTexto}>
              Agregar lo que escribí
            </button>
          </div>

          {noReconocido.length > 0 && (
            <Notice tone="info">
              No reconocimos: {noReconocido.join(", ")}. Puedes agregarlo desde la despensa.
            </Notice>
          )}

          <div>
            <span className="etiqueta">O toca lo que tengas</span>
            <div className="chip-fila" style={{ marginTop: 8, flexWrap: "wrap", overflowX: "visible" }}>
              {BASICOS.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`chip ${borradores.some((b) => b.ingredientId === id) ? "chip--activo" : ""}`}
                  onClick={() => agregarBasico(id)}
                >
                  {INGREDIENT_BY_ID.get(id)?.name ?? id}
                </button>
              ))}
            </div>
          </div>

          {borradores.length > 0 && (
            <Card className="tarjeta--plana">
              <div className="lista">
                {borradores.map((item) => (
                  <BorradorFila
                    key={item.ingredientId}
                    item={item}
                    onChange={(qtyBase) =>
                      setBorradores((items) =>
                        items.map((entry) =>
                          entry.ingredientId === item.ingredientId
                            ? { ...entry, qtyBase, needsConfirmation: qtyBase === null }
                            : entry,
                        ),
                      )
                    }
                    onRemove={() =>
                      setBorradores((items) => items.filter((entry) => entry.ingredientId !== item.ingredientId))
                    }
                  />
                ))}
              </div>
            </Card>
          )}

          {borradores.some((item) => item.needsConfirmation) && (
            <Notice tone="info">
              Hay cantidades sin confirmar. Rinde no las adivina: si las dejas vacías, esos
              ingredientes no entran a tu despensa.
            </Notice>
          )}
        </div>
      ),
    },
  ];

  const actual = pasos[paso]!;

  return (
    <main className="contenido contenido--sin-nav">
      <div className="fila" style={{ gap: 6, marginBottom: 22 }}>
        {pasos.map((_, index) => (
          <div
            key={index}
            style={{
              height: 4, flex: 1, borderRadius: 999,
              background: index <= paso ? "var(--verde)" : "var(--linea)",
            }}
          />
        ))}
      </div>

      <h1 style={{ marginBottom: 8 }}>{actual.titulo}</h1>
      <p className="tenue" style={{ marginBottom: 22 }}>{actual.subtitulo}</p>

      {actual.contenido}

      <div className="pila" style={{ marginTop: 28 }}>
        <button
          type="button"
          className="boton"
          disabled={!actual.valido}
          onClick={() => (paso === pasos.length - 1 ? crearPlan() : setPaso(paso + 1))}
        >
          {paso === pasos.length - 1 ? "Crear mi plan" : "Continuar"}
        </button>
        {paso > 0 && (
          <button type="button" className="boton boton--fantasma" onClick={() => setPaso(paso - 1)}>
            Atrás
          </button>
        )}
      </div>
    </main>
  );
}

function BorradorFila({
  item, onChange, onRemove,
}: {
  item: Borrador;
  onChange: (qtyBase: number | null) => void;
  onRemove: () => void;
}): React.JSX.Element {
  const ingredient = INGREDIENT_BY_ID.get(item.ingredientId);
  const unidad = ingredient?.baseUnit === "unit" ? "unidades" : ingredient?.baseUnit ?? "";
  const legible = ingredient && item.qtyBase !== null ? humanize(item.qtyBase, ingredient) : null;

  return (
    <div className="lista__item">
      <div className="crecer">
        <div className="lista__nombre"><strong>{ingredient?.name ?? item.ingredientId}</strong></div>
        {item.needsConfirmation ? (
          <div className="pequeno" style={{ color: "var(--ambar)" }}>
            No dijiste cuánto — escríbelo
          </div>
        ) : (
          legible && <div className="pequeno tenue">{legible.qty} {legible.unit}</div>
        )}
      </div>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        style={{ width: 92, minHeight: 44, textAlign: "right" }}
        value={item.qtyBase ?? ""}
        placeholder={unidad}
        aria-label={`Cantidad de ${ingredient?.name ?? item.ingredientId} en ${unidad}`}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === "") return onChange(null);
          const value = Number(raw);
          onChange(Number.isFinite(value) && value > 0 && ingredient
            ? roundForDisplay(value, ingredient)
            : null);
        }}
      />
      <span className="diminuto tenue" style={{ width: 46 }}>{unidad}</span>
      <button type="button" className="boton-icono" onClick={onRemove} aria-label="Quitar">✕</button>
    </div>
  );
}
