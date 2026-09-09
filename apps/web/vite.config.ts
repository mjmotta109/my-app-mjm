import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

/**
 * Build de la PWA.
 *
 * `base: "./"` y rutas relativas: el build es estático y se puede servir desde
 * cualquier subdirectorio o desde el sistema de archivos, que es lo que
 * necesita el empaquetado con Capacitor para Android (§34 del brief).
 */
export default defineConfig({
  base: "./",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icon-192.png", "icon-512.png", "icon-maskable-512.png"],
      manifest: {
        name: "Rinde — Tu presupuesto. Tu despensa. Tu mes.",
        short_name: "Rinde",
        description:
          "Planifica la comida del mes con el dinero que tienes. Presupuesto, despensa, menú y lista de mercado.",
        lang: "es-CO",
        dir: "ltr",
        theme_color: "#147A55",
        background_color: "#FCFBF9",
        display: "standalone",
        orientation: "portrait",
        start_url: "./",
        scope: "./",
        categories: ["food", "finance", "lifestyle"],
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // El catálogo y la app viven en caché; los datos del hogar viven en
        // localStorage, así que la app abre y funciona sin red.
        runtimeCaching: [
          {
            // Los PRECIOS se piden a la red primero. Un precio viejo servido
            // como vigente es exactamente el error que el producto no puede
            // cometer, así que la caída a caché siempre se muestra etiquetada.
            urlPattern: /\/prices(\/|\?|$)/,
            handler: "NetworkFirst",
            options: {
              cacheName: "rinde-precios",
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 * 14 },
            },
          },
          {
            urlPattern: /\/catalog\//,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "rinde-catalogo" },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
