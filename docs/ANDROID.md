# Rinde en Android

Cómo llevar Rinde de PWA a una app publicable en Google Play.

---

## 1. Estado actual

### Hecho y verificado

| | |
|---|---|
| Proyecto nativo con **Capacitor 8.5.1** | `apps/web/android/` |
| `targetSdk` y `compileSdk` **36** | Lo que Play exige desde el 31 de agosto de 2026 |
| Build web sin service worker en nativo | `RINDE_TARGET=native` |
| Almacenamiento nativo (`SharedPreferences`) | vía `@capacitor/preferences` |
| Botón atrás de Android | Navega atrás; sale solo desde la raíz |
| Barra de estado y áreas seguras | Verde de marca, sin tapar el encabezado |
| Splash que no parpadea | Se oculta cuando el estado ya está hidratado |
| Iconos adaptativos + splash, todas las densidades | `npm run icons` |
| Material de la ficha de Play | `apps/web/store/` |
| Firma de release preparada | Guardada tras `keystore.properties` |

### El APK compila — verificado en CI

**El APK se compila correctamente.** No en este contenedor (que no tiene el SDK
de Android; ver §2), sino en `.github/workflows/android.yml`, donde los runners
de GitHub sí lo traen.

| | |
|---|---|
| Estado | ✅ verde |
| Tamaño del APK de depuración | **4,38 MB** |
| Artefacto | `rinde-debug-apk`, descargable desde la pestaña Actions |

El workflow corre el typecheck y las 216 pruebas antes de compilar, y falla si
el APK no aparece o es sospechosamente pequeño.

### Lo que sigue SIN verificar

**Nadie ha ejecutado la app en un dispositivo.** Que compile no prueba que el
botón atrás se comporte bien, que el splash no parpadee o que el almacenamiento
nativo persista entre reinicios.

Para eso: descarga el artefacto de Actions, descomprímelo e instálalo en un
teléfono con `adb install app-debug.apk` (o pásalo por archivo y ábrelo con la
instalación de orígenes desconocidos activada).

Lo que sí está probado en navegador: 216 pruebas automáticas y 30 pasos de
prueba de humo en Chromium a 390 px, incluida la persistencia tras recargar.

---

## 2. Cómo desbloquear el SDK en el entorno de desarrollo

Si quieres que Claude pueda compilar y probar el APK directamente, hay tres
caminos, de menos a más esfuerzo:

### Opción A — CI (recomendada, ya está lista)

No hay que tocar nada. Haz push y el workflow compila el APK. Claude puede
lanzar el workflow y leer los logs con las herramientas de GitHub, así que
igual detecta y corrige los errores de compilación.

**Ventaja:** funciona hoy, sin configurar nada. Ya está en verde.
**Límite:** compila, pero no ejecuta la app. Para probarla de verdad, instala
el artefacto en un teléfono.

### Opción B — Ampliar la política de red del entorno

La red de salida se define **cuando se crea el entorno de ejecución**. Habría
que crear uno cuya política permita:

```
dl.google.com          # SDK, command-line tools, imágenes de sistema
maven.google.com       # dependencias de AndroidX  (ya permitido)
services.gradle.org    # distribución de Gradle    (ya permitido)
repo.maven.apache.org  # dependencias Maven        (ya permitido)
plugins.gradle.org     # plugins de Gradle         (ya permitido)
```

De esos cinco, **solo falta `dl.google.com`**: los otros cuatro ya pasan.

Se configura en los ajustes del entorno de Claude Code en la web. La
documentación está en
<https://code.claude.com/docs/en/claude-code-on-the-web>.

Con eso, Claude podría instalar el SDK y correr `./gradlew assembleDebug` aquí.

### Opción C — Emulador

Además del SDK haría falta una imagen de sistema y KVM. Es poco probable que
funcione en un contenedor sin virtualización anidada. **Para probar la app de
verdad, instala el APK del CI en un teléfono real** — es más rápido y más
fiable que pelear con un emulador.

> **Nota:** una cuenta de Google Play, un keystore o un token **no** sirven
> para esto. El SDK de Android es una descarga pública; el problema es de red,
> no de permisos.

---

## 3. Compilar en tu máquina

### Requisitos

- Node 22
- JDK 21
- Android Studio (o solo las command-line tools del SDK) con la plataforma 36

### Pasos

```bash
npm ci
npm run build:native          # compila la web y sincroniza con android/
npm run android:open -w @rinde/web    # abre Android Studio
```

O sin Android Studio:

```bash
npm run android:apk -w @rinde/web     # APK de depuración
npm run android:bundle -w @rinde/web  # AAB firmado para Play
```

El APK queda en `apps/web/android/app/build/outputs/apk/debug/`.

### Después de tocar el código web

`cap sync` copia `dist/` dentro del proyecto Android. **Sin ese paso, el APK
sigue trayendo la versión anterior.** Los scripts `android:apk` y
`android:bundle` ya lo hacen.

---

## 4. Firma

Play acepta dos esquemas. **Usa Play App Signing**: Google guarda la llave de
firma de la app y tú solo manejas la de subida. Si pierdes la tuya, no pierdes
la app — sin eso, perder el keystore significa no poder actualizar nunca más y
tener que publicar una app nueva desde cero.

### Generar la llave de subida

```bash
keytool -genkeypair -v \
  -keystore apps/web/android/rinde-release.jks \
  -alias rinde -keyalg RSA -keysize 2048 -validity 10000
```

### Conectarla al build

Crea `apps/web/android/keystore.properties` (ya está en `.gitignore`):

```properties
storeFile=../rinde-release.jks
storePassword=TU_CLAVE
keyAlias=rinde
keyPassword=TU_CLAVE
```

`build.gradle` lo lee si existe y no hace nada si no existe, así que
`assembleDebug` sigue funcionando en una máquina sin llaves.

> **Nunca** subas el `.jks` ni el `keystore.properties` al repositorio. Guarda
> una copia del keystore en un gestor de contraseñas: es irrecuperable.

---

## 5. Publicar en Play

### Requisitos que dependen de ti

1. **Cuenta de Play Console.** Pago único; verifica el monto y los requisitos
   de verificación de identidad actuales en la propia consola.
2. **Prueba cerrada: 12 testers, 14 días seguidos.** Aplica a toda app
   publicada desde una cuenta **personal** creada a partir del 13 de noviembre
   de 2023. Las cuentas de organización están exentas. Es **por app**, y si un
   tester se sale y vuelve, sus 14 días se reinician.
   Fuente: [Play Console Help](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en)
3. **URL pública de la política de privacidad.** El texto está en
   `apps/web/store/PRIVACIDAD.md`; falta hospedarlo y poner tu correo.
4. **`applicationId` definitivo.** Hoy es `co.rinde.app`. **No se puede cambiar
   después de publicar.** Si tienes un dominio propio, cámbialo ahora en
   `capacitor.config.ts` y vuelve a correr `cap sync`.

### Checklist técnico

- [ ] `targetSdk 36` — ✅ ya está
- [ ] AAB firmado (`npm run android:bundle -w @rinde/web`)
- [ ] `versionCode` incrementado en cada subida (`android/app/build.gradle`)
- [ ] Icono 512×512 y gráfico destacado 1024×500 — ✅ en `apps/web/store/`
- [ ] Mínimo 2 capturas de teléfono — ✅ hay 6 en `store/screenshots/`
- [ ] Formulario de seguridad de datos — respuestas en `store/FICHA-PLAY.md`
- [ ] Clasificación de contenido — todas las respuestas son "No"

Los textos de la ficha están listos en `apps/web/store/FICHA-PLAY.md`.

---

## 6. Lo que hace que esto sea sencillo

Decisiones tomadas desde el primer día, antes de que hubiera proyecto Android:

- **`base: "./"`** — el build es estático y funciona desde el sistema de
  archivos, que es como lo carga el WebView.
- **`HashRouter`** — sin necesidad de reescrituras del servidor.
- **Motor sin I/O ni red** — `@rinde/core` corre igual en un WebView.
- **La app funciona sin backend** — no hay que desplegar nada para publicar.
- **`Storage` detrás de una interfaz** — cambiar a almacenamiento nativo fue
  escribir una implementación, no tocar las pantallas.

Ver [DECISIONS.md](./DECISIONS.md) D11 y D23.

---

## 7. Si algún día hay backend

Publicar con cuentas y sincronización cambia tres cosas:

1. Hay que **desplegar la API** en algún sitio con HTTPS (hoy `apps/api` corre
   local contra SQLite).
2. El **formulario de seguridad de datos cambia por completo**: pasarías a
   recopilar y transmitir datos, y el peso, la estatura y la edad entran en la
   categoría de **salud y estado físico**, que Play trata con más exigencia.
3. `apiClient` necesita una `baseURL` configurable por entorno.

Mientras no exista, la respuesta al formulario es limpia: la app no recoge ni
transmite nada.
