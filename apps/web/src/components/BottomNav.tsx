import { NavLink } from "react-router-dom";

/**
 * Navegación inferior (§7 del brief). Seis destinos, alcanzables con el pulgar.
 * El emoji es decorativo; la etiqueta de texto es lo que se lee.
 */
const DESTINOS = [
  { to: "/", label: "Inicio", icon: "🏠", end: true },
  { to: "/plan", label: "Plan", icon: "📅", end: false },
  { to: "/mercado", label: "Mercado", icon: "🛒", end: false },
  { to: "/despensa", label: "Despensa", icon: "🧺", end: false },
  { to: "/recetas", label: "Recetas", icon: "🍲", end: false },
  { to: "/perfil", label: "Perfil", icon: "⚙️", end: false },
] as const;

export function BottomNav(): React.JSX.Element {
  return (
    <nav className="nav" aria-label="Navegación principal">
      {DESTINOS.map((destino) => (
        <NavLink key={destino.to} to={destino.to} end={destino.end} className="nav__item">
          <span className="nav__icono" aria-hidden="true">{destino.icon}</span>
          <span>{destino.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
