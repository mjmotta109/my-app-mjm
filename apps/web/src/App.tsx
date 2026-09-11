import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { hideSplash, onAndroidBack, setupStatusBar } from "./lib/native.js";
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
import { MealPrep } from "./screens/MealPrep.js";
import { PhysicalProfile } from "./screens/PhysicalProfile.js";
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

/** Pantallas desde las que el botón atrás de Android sale de la app. */
const RAICES = new Set(["/", "/bienvenida"]);

function Shell(): React.JSX.Element {
  const { state, ready } = useStore();
  const location = useLocation();
  const navigate = useNavigate();

  // Cada cambio de pantalla vuelve arriba: en móvil, heredar el scroll de la
  // pantalla anterior desorienta.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  useEffect(() => {
    void setupStatusBar();
  }, []);

  // El splash se oculta cuando ya hay algo real que mostrar.
  useEffect(() => {
    if (ready) void hideSplash();
  }, [ready]);

  // Botón atrás de Android: vuelve a la pantalla anterior; desde una raíz,
  // sale de la app. Se vuelve a suscribir en cada cambio de ruta porque el
  // handler necesita saber dónde está.
  useEffect(() => {
    return onAndroidBack(() => {
      if (RAICES.has(location.pathname)) return false;
      // Una pantalla de detalle abierta directamente (por ejemplo desde una
      // notificación) no tiene historial atrás: se va al inicio en vez de
      // dejar al usuario atrapado.
      if (window.history.length > 1) navigate(-1);
      else navigate("/", { replace: true });
      return true;
    });
  }, [location.pathname, navigate]);

  // Hasta hidratar no se dibujan rutas: si no, alguien con un plan guardado
  // vería la bienvenida por un instante antes de que llegaran sus datos.
  if (!ready) return <div className="app" aria-busy="true" />;

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
        <Route path="/cocinar-adelantado" element={<Protegida ok={state.onboarded}><MealPrep /></Protegida>} />
        <Route path="/estado-fisico" element={<Protegida ok={state.onboarded}><PhysicalProfile /></Protegida>} />
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
