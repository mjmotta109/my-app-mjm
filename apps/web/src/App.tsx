import { HashRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { BottomNav } from "./components/BottomNav.js";
import { Landing } from "./screens/Landing.js";
import { Onboarding } from "./screens/Onboarding.js";
import { Dashboard } from "./screens/Dashboard.js";
import { PlanScreen } from "./screens/Plan.js";
import { MealDetail } from "./screens/MealDetail.js";
import { Pantry } from "./screens/Pantry.js";
import { AddIngredient } from "./screens/AddIngredient.js";
import { WhatCanICook } from "./screens/WhatCanICook.js";
import { RecipeDetail, RecipeList } from "./screens/Recipes.js";
import { Market } from "./screens/Market.js";
import { Profile } from "./screens/Profile.js";
import { RindeMas } from "./screens/RindeMas.js";
import { StoreProvider, useStore } from "./state/store.js";

/**
 * Enrutado con `HashRouter`.
 *
 * Es deliberado: el build es estático y tiene que funcionar servido desde
 * cualquier subdirectorio y, más adelante, desde el sistema de archivos dentro
 * del contenedor de Android (§34). Con rutas de historial haría falta que el
 * servidor reescribiera todas las URL a `index.html`, que es justo la
 * dependencia que no queremos tener.
 */
export function App(): React.JSX.Element {
  return (
    <StoreProvider>
      <HashRouter>
        <Shell />
      </HashRouter>
    </StoreProvider>
  );
}

function Shell(): React.JSX.Element {
  const { state } = useStore();
  const location = useLocation();

  // Cada cambio de pantalla vuelve arriba: en móvil, heredar el scroll de la
  // pantalla anterior desorienta.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  const sinNav = ["/bienvenida", "/inicio"].includes(location.pathname);

  return (
    <div className="app">
      <Routes>
        <Route path="/bienvenida" element={<Landing />} />
        <Route path="/inicio" element={<Onboarding />} />
        <Route path="/" element={<Protegida ok={state.onboarded}><Dashboard /></Protegida>} />
        <Route path="/plan" element={<Protegida ok={state.onboarded}><PlanScreen /></Protegida>} />
        <Route path="/comida/:mealId" element={<Protegida ok={state.onboarded}><MealDetail /></Protegida>} />
        <Route path="/mercado" element={<Protegida ok={state.onboarded}><Market /></Protegida>} />
        <Route path="/despensa" element={<Protegida ok={state.onboarded}><Pantry /></Protegida>} />
        <Route path="/despensa/agregar" element={<Protegida ok={state.onboarded}><AddIngredient /></Protegida>} />
        <Route path="/que-puedo-cocinar" element={<Protegida ok={state.onboarded}><WhatCanICook /></Protegida>} />
        <Route path="/recetas" element={<Protegida ok={state.onboarded}><RecipeList /></Protegida>} />
        <Route path="/receta/:recipeId" element={<Protegida ok={state.onboarded}><RecipeDetail /></Protegida>} />
        <Route path="/rinde-mas" element={<Protegida ok={state.onboarded}><RindeMas /></Protegida>} />
        <Route path="/perfil" element={<Protegida ok={state.onboarded}><Profile /></Protegida>} />
        <Route path="*" element={<Navigate to={state.onboarded ? "/" : "/bienvenida"} replace />} />
      </Routes>
      {state.onboarded && !sinNav && <BottomNav />}
    </div>
  );
}

/** Sin hogar configurado no hay nada que mostrar: se va al onboarding. */
function Protegida({ ok, children }: { ok: boolean; children: React.JSX.Element }): React.JSX.Element {
  if (!ok) return <Navigate to="/bienvenida" replace />;
  return children;
}
