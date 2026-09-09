import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatCop, normalizeText, parsePantryText, planPurchase, roundForDisplay } from "@rinde/core";
import { CATEGORY_EMOJI, INGREDIENTS, INGREDIENT_BY_ID, PRICES, categoryName } from "../lib/catalog.js";
import { createInventoryItem, useStore } from "../state/store.js";
import { Card, Header, Notice } from "../components/ui.js";

/** Pantalla 7: agregar ingrediente a la despensa (§29.7). */
export function AddIngredient(): React.JSX.Element {
  const { dispatch } = useStore();
  const navigate = useNavigate();

  const [busqueda, setBusqueda] = useState("");
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [cantidad, setCantidad] = useState("");
  const [vence, setVence] = useState("");
  const [textoLibre, setTextoLibre] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);

  const resultados = useMemo(() => {
    const termino = normalizeText(busqueda);
    if (!termino) return INGREDIENTS.slice(0, 24);
    return INGREDIENTS.filter((ingredient) =>
      [ingredient.name, ...(ingredient.synonyms ?? [])].some((nombre) =>
        normalizeText(nombre).includes(termino),
      ),
    ).slice(0, 40);
  }, [busqueda]);

  const ingredient = seleccion ? INGREDIENT_BY_ID.get(seleccion) : undefined;
  const unidad = ingredient?.baseUnit === "unit" ? "unidades" : ingredient?.baseUnit ?? "";
  const cantidadNum = Number(cantidad);
  const valido = ingredient !== undefined && Number.isFinite(cantidadNum) && cantidadNum > 0;
  const costoReferencia =
    ingredient && valido ? PRICES.costOf(ingredient.id, cantidadNum) : null;

  function guardar(): void {
    if (!ingredient || !valido) return;
    dispatch({
      type: "addInventory",
      item: createInventoryItem(
        ingredient.id,
        roundForDisplay(cantidadNum, ingredient),
        vence || undefined,
      ),
    });
    navigate("/despensa");
  }

  function agregarTexto(): void {
    const resultado = parsePantryText(textoLibre, INGREDIENT_BY_ID);
    const conCantidad = resultado.items.filter((item) => item.qtyBase !== null);
    for (const item of conCantidad) {
      dispatch({ type: "addInventory", item: createInventoryItem(item.ingredientId, item.qtyBase!) });
    }
    const sinCantidad = resultado.items.filter((item) => item.qtyBase === null);
    const partes: string[] = [];
    if (conCantidad.length > 0) partes.push(`Se agregaron ${conCantidad.length}.`);
    if (sinCantidad.length > 0) {
      partes.push(
        `No dijiste cuánto de: ${sinCantidad
          .map((item) => INGREDIENT_BY_ID.get(item.ingredientId)?.name ?? item.ingredientId)
          .join(", ")}. Agrégalos con cantidad abajo.`,
      );
    }
    if (resultado.unrecognized.length > 0) {
      partes.push(`No reconocimos: ${resultado.unrecognized.join(", ")}.`);
    }
    setAviso(partes.join(" ") || "No encontramos ingredientes en ese texto.");
    setTextoLibre("");
  }

  return (
    <>
      <Header title="Agregar a la despensa" back />
      <main className="contenido pila pila--lg">
        <Card>
          <div className="campo">
            <label className="etiqueta" htmlFor="texto-libre">Escríbelo como lo dirías</label>
            <textarea
              id="texto-libre"
              rows={2}
              placeholder="2 kg de arroz, media libra de lentejas y 12 huevos"
              value={textoLibre}
              onChange={(event) => setTextoLibre(event.target.value)}
              style={{ minHeight: 68, resize: "vertical" }}
            />
            <button
              type="button"
              className="boton boton--secundario"
              disabled={!textoLibre.trim()}
              onClick={agregarTexto}
            >
              Agregar
            </button>
            <p className="campo__ayuda">
              Si no dices una cantidad concreta, Rinde te la pregunta: no la inventa.
            </p>
          </div>
        </Card>

        {aviso && <Notice tone="info">{aviso}</Notice>}

        <div className="campo">
          <label className="etiqueta" htmlFor="buscar">O búscalo</label>
          <input
            id="buscar"
            type="text"
            placeholder="arroz, pollo, papa…"
            value={busqueda}
            onChange={(event) => {
              setBusqueda(event.target.value);
              setSeleccion(null);
            }}
          />
        </div>

        {seleccion && ingredient ? (
          <Card>
            <div className="fila fila--entre" style={{ marginBottom: 14 }}>
              <div>
                <strong>{ingredient.name}</strong>
                <div className="pequeno tenue">
                  {CATEGORY_EMOJI[ingredient.categoryId]} {categoryName(ingredient.categoryId)}
                </div>
              </div>
              <button type="button" className="boton-icono" onClick={() => setSeleccion(null)} aria-label="Cambiar ingrediente">✕</button>
            </div>

            <div className="campo">
              <label className="etiqueta" htmlFor="cantidad">Cantidad en {unidad}</label>
              <input
                id="cantidad"
                type="number"
                inputMode="decimal"
                min={0}
                value={cantidad}
                onChange={(event) => setCantidad(event.target.value)}
              />
              <div className="chip-fila" style={{ marginTop: 6 }}>
                {sugerencias(ingredient).map((valor) => (
                  <button
                    key={valor}
                    type="button"
                    className={`chip ${Number(cantidad) === valor ? "chip--activo" : ""}`}
                    onClick={() => setCantidad(String(valor))}
                  >
                    {valor} {unidad}
                  </button>
                ))}
              </div>
            </div>

            <div className="campo" style={{ marginTop: 14 }}>
              <label className="etiqueta" htmlFor="vence">Se vence el (opcional)</label>
              <input id="vence" type="date" value={vence} onChange={(event) => setVence(event.target.value)} />
              <p className="campo__ayuda">
                Si lo pones, Rinde usa primero lo que vence antes.
              </p>
            </div>

            {costoReferencia !== null && (
              <p className="pequeno tenue" style={{ marginTop: 12 }}>
                Valor de referencia: {formatCop(costoReferencia)}
              </p>
            )}

            <button type="button" className="boton" style={{ marginTop: 16 }} disabled={!valido} onClick={guardar}>
              Guardar en mi despensa
            </button>
          </Card>
        ) : (
          <div className="tarjeta tarjeta--plana">
            <div className="lista">
              {resultados.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="lista__item"
                  onClick={() => {
                    setSeleccion(item.id);
                    setCantidad(String(planPurchase(item.roundingStep, item).purchaseBase));
                  }}
                >
                  <span aria-hidden="true" style={{ width: 26 }}>{CATEGORY_EMOJI[item.categoryId] ?? "🍽️"}</span>
                  <span className="crecer">
                    <div className="lista__nombre">{item.name}</div>
                    <div className="diminuto tenue">{categoryName(item.categoryId)}</div>
                  </span>
                  <span className="tenue" aria-hidden="true">+</span>
                </button>
              ))}
              {resultados.length === 0 && (
                <div className="lista__item">
                  <span className="tenue">No encontramos "{busqueda}" en el catálogo.</span>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </>
  );
}

/** Cantidades típicas a partir de los formatos reales de venta. */
function sugerencias(ingredient: { packSizes: { qty: number; unit: string }[]; roundingStep: number; id: string }): number[] {
  const catalogEntry = INGREDIENT_BY_ID.get(ingredient.id)!;
  const valores = catalogEntry.packSizes
    .map((pack) => planPurchase(1, { ...catalogEntry, packSizes: [pack] }).purchaseBase)
    .filter((value) => value > 0);
  return [...new Set(valores)].sort((a, b) => a - b).slice(0, 4);
}
