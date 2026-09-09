import { Link } from "react-router-dom";

/** Pantalla 1: bienvenida (§29.1). */
export function Landing(): React.JSX.Element {
  return (
    <main className="contenido contenido--sin-nav" style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 28, paddingTop: 40 }}>
        <div>
          <div
            aria-hidden="true"
            style={{
              width: 62, height: 62, borderRadius: 18, background: "var(--verde)",
              color: "#fff", display: "grid", placeItems: "center",
              fontSize: 32, fontWeight: 800, marginBottom: 22,
            }}
          >
            R
          </div>
          <h1 style={{ fontSize: 40, lineHeight: 1.05 }}>Rinde</h1>
          <p style={{ fontSize: 20, marginTop: 12, color: "var(--tinta-media)", lineHeight: 1.35 }}>
            Tu presupuesto.
            <br />
            Tu despensa.
            <br />
            Tu mes.
          </p>
        </div>

        <div className="pila">
          {[
            ["💸", "Sabe cuánto puedes gastar", "Reparte tu presupuesto entre todas las comidas del mes."],
            ["🧺", "Usa lo que ya tienes", "Primero la despensa. Después el mercado."],
            ["🍲", "Te dice qué cocinar", "Un menú completo, con costo por comida y por persona."],
          ].map(([icon, title, text]) => (
            <div key={title} className="fila" style={{ alignItems: "flex-start", gap: 14 }}>
              <span aria-hidden="true" style={{ fontSize: 24 }}>{icon}</span>
              <div>
                <strong>{title}</strong>
                <p className="pequeno tenue">{text}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="pila" style={{ paddingBottom: 20 }}>
        <Link to="/inicio" className="boton">Empezar</Link>
        <p className="diminuto tenue" style={{ textAlign: "center" }}>
          No necesitas crear una cuenta. Todo se guarda en tu teléfono.
        </p>
      </div>
    </main>
  );
}
