import { App as CapacitorApp } from "@capacitor/app";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";
import { isNative } from "./storage.js";

/**
 * Integración con el contenedor nativo.
 *
 * Todo aquí es un no-op en el navegador, así que la PWA sigue funcionando
 * igual y no hace falta bifurcar el código de las pantallas.
 */

/**
 * Ajusta la barra de estado al verde de la marca.
 *
 * `setOverlaysWebView(false)` deja el WebView DEBAJO de la barra en vez de
 * detrás: con overlay, el encabezado quedaría tapado por la hora y la batería.
 */
export async function setupStatusBar(): Promise<void> {
  if (!isNative) return;
  try {
    await StatusBar.setOverlaysWebView({ overlay: false });
    await StatusBar.setBackgroundColor({ color: "#147A55" });
    await StatusBar.setStyle({ style: Style.Dark }); // texto claro sobre verde
  } catch {
    // Una barra de estado con otro color no justifica tumbar la app.
  }
}

/**
 * Oculta el splash nativo.
 *
 * Se llama cuando React ya montó y el estado está hidratado, no antes: si se
 * ocultara al arrancar, habría un parpadeo en blanco entre el splash y la
 * primera pantalla. Por eso `launchAutoHide` está en `false`.
 */
export async function hideSplash(): Promise<void> {
  if (!isNative) return;
  try {
    await SplashScreen.hide();
  } catch {
    /* si no está, no pasa nada */
  }
}

/**
 * Botón atrás de Android.
 *
 * Sin esto, el botón atrás cierra la app desde cualquier pantalla — el error
 * clásico de una web envuelta en un WebView. Aquí navega hacia atrás y solo
 * sale de la app cuando ya no hay a dónde volver.
 *
 * Devuelve una función para desuscribirse.
 */
export function onAndroidBack(handler: () => boolean | Promise<boolean>): () => void {
  if (!isNative) return () => {};
  const listener = CapacitorApp.addListener("backButton", () => {
    void (async () => {
      // `true` = el handler se encargó. `false` = no hay a dónde ir: salir.
      const manejado = await handler();
      if (!manejado) await CapacitorApp.exitApp();
    })();
  });
  return () => {
    void listener.then((entry) => entry.remove());
  };
}
