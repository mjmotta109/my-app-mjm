import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Configuración del envoltorio nativo.
 *
 * Se eligió **Capacitor** sobre una TWA porque Capacitor empaqueta los archivos
 * web DENTRO del APK. Rinde funciona sin servidor y sin red, así que no tiene
 * sentido exigir un dominio propio verificado solo para poder instalarla — que
 * es lo que una TWA obligaría. Ver docs/ANDROID.md.
 */
const config: CapacitorConfig = {
  /**
   * ⚠️ El applicationId NO SE PUEDE CAMBIAR después de publicar en Play.
   * Si tienes un dominio propio, cámbialo AHORA por su forma invertida.
   */
  appId: "co.rinde.app",
  appName: "Rinde",
  webDir: "dist",

  android: {
    // La app se ve igual en un WebView viejo que en uno nuevo.
    webContentsDebuggingEnabled: false,
    // Sin esto, un error de red en el WebView muestra la página de error de
    // Chrome dentro de la app. Rinde no hace peticiones de red, pero si algún
    // día las hace, el fallo tiene que verse como parte de la app.
    allowMixedContent: false,
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      backgroundColor: "#147A55",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      // Se oculta desde el código cuando React ya montó, para que no haya un
      // parpadeo en blanco entre el splash y la primera pantalla.
      launchAutoHide: false,
    },
    StatusBar: {
      style: "LIGHT",
      backgroundColor: "#147A55",
    },
  },
};

export default config;
