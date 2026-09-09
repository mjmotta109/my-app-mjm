import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./theme.css";

const container = document.getElementById("root");
if (!container) throw new Error("No se encontró el contenedor #root");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
