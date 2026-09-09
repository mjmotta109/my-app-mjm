import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { formatCop, formatQuantity, humanize, type Cop, type PriceConfidence, type Quantity } from "@rinde/core";
import { getIngredient } from "../lib/catalog.js";

/** Piezas de interfaz compartidas. Sin lógica de negocio: solo presentación. */

export function Header({
  title, eyebrow, back, action,
}: {
  title: string;
  eyebrow?: string;
  back?: boolean;
  action?: ReactNode;
}): React.JSX.Element {
  const navigate = useNavigate();
  return (
    <header className="encabezado">
      {back && (
        <button
          type="button"
          className="boton-icono"
          onClick={() => navigate(-1)}
          aria-label="Volver"
        >
          ←
        </button>
      )}
      <div className="encabezado__titulo">
        {eyebrow && <div className="encabezado__eyebrow">{eyebrow}</div>}
        <h2>{title}</h2>
      </div>
      {action}
    </header>
  );
}

export function Card({
  children, tone = "blanco", className = "",
}: {
  children: ReactNode;
  tone?: "blanco" | "verde";
  className?: string;
}): React.JSX.Element {
  return (
    <div className={`tarjeta ${tone === "verde" ? "tarjeta--verde" : ""} ${className}`.trim()}>
      {children}
    </div>
  );
}

/**
 * Muestra dinero. `null` NUNCA se dibuja como `$0`: un ingrediente sin precio
 * se dice explícitamente, porque presentar una estimación o un vacío como un
 * precio exacto es el error que Rinde no puede cometer (§18).
 */
export function Money({
  value, size = "md", className = "",
}: {
  value: Cop | null;
  size?: "xl" | "lg" | "md" | "sm";
  className?: string;
}): React.JSX.Element {
  if (value === null) {
    return <span className={`tenue pequeno ${className}`.trim()}>Sin precio</span>;
  }
  const cls = size === "sm" ? "" : `cifra--${size}`;
  return <span className={`cifra ${cls} ${className}`.trim()}>{formatCop(value)}</span>;
}

export function Qty({ quantity }: { quantity: Quantity }): React.JSX.Element {
  return <span className="cifra">{formatQuantity(quantity)}</span>;
}

export function IngredientQty({
  ingredientId, qtyBase,
}: {
  ingredientId: string;
  qtyBase: number;
}): React.JSX.Element {
  const ingredient = getIngredient(ingredientId);
  if (!ingredient) return <span className="tenue">{qtyBase}</span>;
  return <Qty quantity={humanize(qtyBase, ingredient)} />;
}

/**
 * Etiqueta de procedencia de UNA línea de precio.
 *
 * `inlineDemo={false}` en las pantallas que ya muestran un aviso de datos de
 * demostración arriba. Repetir "Datos de demostración" en cada renglón de una
 * lista de treinta productos no informa más: rompe el diseño de las filas y
 * deja de leerse. La divulgación va una vez, destacada, y en cada línea se
 * marca solo lo que SE DESVÍA de eso: un precio viejo o un precio ausente.
 */
export function PriceBadge({
  confidence, isDemo, inlineDemo = true,
}: {
  confidence: PriceConfidence | null;
  isDemo: boolean;
  inlineDemo?: boolean;
}): React.JSX.Element | null {
  if (confidence === null) return <span className="insignia insignia--estimado">Sin precio</span>;
  if (confidence === "estimated") return <span className="insignia insignia--estimado">Precio estimado</span>;
  if (isDemo && inlineDemo) return <span className="insignia insignia--demo">Datos de demostración</span>;
  return null;
}

export function Badge({
  children, tone = "verde",
}: {
  children: ReactNode;
  tone?: "verde" | "demo" | "estimado" | "alerta";
}): React.JSX.Element {
  return <span className={`insignia insignia--${tone}`}>{children}</span>;
}

export function Progress({
  value, max, tone,
}: {
  value: number;
  max: number;
  tone?: "ok" | "aviso" | "alerta";
}): React.JSX.Element {
  const pct = max <= 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100));
  const modifier = tone === "alerta" ? " barra__relleno--alerta" : tone === "aviso" ? " barra__relleno--aviso" : "";
  return (
    <div
      className="barra"
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={`barra__relleno${modifier}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Notice({
  children, tone = "info",
}: {
  children: ReactNode;
  tone?: "demo" | "alerta" | "info";
}): React.JSX.Element {
  return <div className={`aviso aviso--${tone}`}>{children}</div>;
}

/** Aviso de datos de demostración a nivel de pantalla (§26). */
export function DemoNotice({ show }: { show: boolean }): React.JSX.Element | null {
  if (!show) return null;
  return (
    <Notice tone="demo">
      <strong>Datos de demostración.</strong> Los precios de esta pantalla no son reales.
    </Notice>
  );
}

export function Empty({
  icon, title, description, action,
}: {
  icon: string;
  title: string;
  description?: string;
  action?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="vacio">
      <div className="vacio__icono" aria-hidden="true">{icon}</div>
      <h3>{title}</h3>
      {description && <p className="pequeno" style={{ marginTop: 6 }}>{description}</p>}
      {action && <div style={{ marginTop: 18 }}>{action}</div>}
    </div>
  );
}

export function Counter({
  label, value, onChange, min = 0, max = 12,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}): React.JSX.Element {
  return (
    <div className="fila fila--entre" style={{ padding: "6px 0" }}>
      <span>{label}</span>
      <div className="contador">
        <button
          type="button"
          className="boton-icono"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          aria-label={`Quitar un ${label.toLowerCase()}`}
        >
          −
        </button>
        <span className="contador__valor" aria-live="polite">{value}</span>
        <button
          type="button"
          className="boton-icono"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          aria-label={`Agregar un ${label.toLowerCase()}`}
        >
          +
        </button>
      </div>
    </div>
  );
}

export function Toggle({
  checked, onChange, children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <button type="button" className="opcion" aria-pressed={checked} onClick={() => onChange(!checked)}>
      <span className="opcion__marca" aria-hidden="true">{checked ? "✓" : ""}</span>
      <span className="crecer">{children}</span>
    </button>
  );
}

export function Sheet({
  open, onClose, title, children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}): React.JSX.Element | null {
  if (!open) return null;
  return (
    <div
      className="hoja"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="hoja__panel">
        <div className="fila fila--entre" style={{ marginBottom: 16 }}>
          <h3>{title}</h3>
          {/* La etiqueta incluye el título: si el panel también trae un botón
              "Cerrar", los dos controles quedan distinguibles para quien usa
              lector de pantalla o navegación por voz. */}
          <button
            type="button"
            className="boton-icono"
            onClick={onClose}
            aria-label={`Cerrar ${title}`}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
