import { NavLink } from "react-router-dom";

/**
 * Navegación inferior (§7 del brief).
 *
 * Cuatro destinos, no seis. Los seis anteriores mezclaban dos cosas distintas:
 * lugares donde se *hace* algo a diario (hoy, plan, mercado, despensa) y
 * lugares a los que se entra de vez en cuando (recetas, perfil). Poner las seis
 * al mismo nivel obligaba a elegir entre seis cada vez que se abría la app.
 *
 * Recetas vive ahora dentro de Plan, que es desde donde se buscan. Perfil es un
 * engranaje en la cabecera de Hoy: se toca una vez y no se vuelve.
 */
const DESTINOS = [
  { to: "/", label: "Hoy", icon: "🍽️", end: true },
  { to: "/plan", label: "Plan", icon: "📅", end: false },
  { to: "/mercado", label: "Mercado", icon: "🛒", end: false },
  { to: "/despensa", label: "Despensa", icon: "🧺", end: false },
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
