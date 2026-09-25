import { chromium } from "playwright";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Prueba de humo del flujo completo en un navegador real (§32, §33).
 *
 * Recorre lo que hace una persona de verdad: onboarding → plan → detalle →
 * cocinar → mercado → despensa → recetas → perfil, y comprueba que no haya
 * scroll horizontal a 390 px ni errores en consola.
 *
 * Uso:
 *   npm run build -w @rinde/web
 *   npx vite preview --port 4173   (en apps/web)
 *   node apps/web/e2e/smoke.mjs [carpeta-de-capturas]
 */

const BASE = process.env.RINDE_E2E_URL ?? "http://localhost:4173";
const OUT = process.argv[2] ?? "e2e-shots";

/** Chromium preinstalado del entorno, si lo hay; si no, el que traiga Playwright. */
function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";
  if (!existsSync(root)) return undefined;
  for (const entry of readdirSync(root)) {
    const candidate = join(root, entry, "chrome-linux", "chrome");
    if (entry.startsWith("chromium-") && existsSync(candidate)) return candidate;
  }
  return undefined;
}

const errors = [];
const executablePath = chromiumPath();
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

async function shot(name) { await page.screenshot({ path: `${OUT}/${name}.png` }); }
async function step(label, fn) {
  try { await fn(); console.log("✓", label); }
  catch (e) { console.log("✗", label, "→", e.message.split("\n")[0]); errors.push(`${label}: ${e.message.split("\n")[0]}`); }
}

await page.goto(`${BASE}/`, { waitUntil: "networkidle" });

await step("landing muestra la marca", async () => {
  await page.getByRole("heading", { name: "Rinde", exact: true }).waitFor({ timeout: 5000 });
  await shot("01-landing");
});

await step("empezar → onboarding presupuesto", async () => {
  await page.getByRole("link", { name: "Empezar" }).click();
  await page.getByText("¿Cuánto quieres que rinda tu comida?").waitFor();
  await shot("02-onboarding-presupuesto");
});

await step("presupuesto 800.000 y continuar", async () => {
  const input = page.getByLabel("Presupuesto en pesos colombianos");
  await input.fill("");
  await input.fill("800000");
  if ((await input.inputValue()) !== "800.000") throw new Error(`formato inesperado: ${await input.inputValue()}`);
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByText("¿Para cuántas personas?").waitFor();
  await shot("03-personas");
});

await step("2 adultos, 30 días", async () => {
  await page.getByRole("button", { name: "30 días" }).click();
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByText("¿Qué comidas quieres planificar?").waitFor();
  await shot("04-comidas");
});

await step("comidas → tiempo de cocina", async () => {
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByText("¿Cuánto tiempo tienes para cocinar?").waitFor();
  await shot("05-tiempo-cocina");
});

await step("elegir 'Siempre corriendo' y activar cocinar por adelantado", async () => {
  await page.getByRole("button", { name: /Siempre corriendo/ }).click();
  await page.getByRole("button", { name: /Quiero cocinar por adelantado/ }).click();
  await page.getByText(/mismo plato hasta tres veces/).waitFor();
  await shot("05b-tandas");
});

await step("tiempo → despensa", async () => {
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByText("¿Qué tienes en casa?").waitFor();
  await shot("06-despensa-onboarding");
});

await step("texto libre: 'un poquito de pollo, unas papas y tres tomates'", async () => {
  await page.getByLabel("Escríbelo como lo dirías").fill("Tengo un poquito de pollo, unas papas y tres tomates");
  await page.getByRole("button", { name: "Agregar lo que escribí" }).click();
  await page.getByText("No dijiste cuánto").first().waitFor();
  await shot("07-nlp-pregunta-cantidad");
});

await step("confirmar cantidades vagas", async () => {
  await page.getByLabel("Cantidad de Pechuga de pollo en g").fill("1000");
  await page.getByLabel("Cantidad de Papa pastusa en g").fill("500");
  await shot("07b-cantidades-confirmadas");
});

await step("agregar básicos y crear plan", async () => {
  await page.getByRole("button", { name: "Arroz blanco", exact: true }).click();
  await page.getByRole("button", { name: "Lentejas", exact: true }).click();
  await page.getByRole("button", { name: "Huevo", exact: true }).click();
  await page.getByRole("button", { name: "Crear mi plan" }).click();
  await page.getByText(/Día 1 de 30/).waitFor({ timeout: 15000 });
  await shot("08-dashboard");
});

await step("el inicio enseña qué se come hoy antes que nada", async () => {
  // `innerText` devuelve el texto YA transformado por CSS, y varios títulos
  // van en mayúsculas por `text-transform`. Se compara sin distinguir caja.
  const texto = (await page.locator(".contenido").innerText()).toLowerCase();
  for (const esperado of ["desayuno", "almuerzo", "cena", "lo cociné", "el dinero", "$800.000"]) {
    if (!texto.includes(esperado)) throw new Error(`falta "${esperado}" en el inicio`);
  }
  if (!texto.includes("datos de demostración")) throw new Error("no advierte que los precios son demo");
  // Lo que se come va ARRIBA del dinero: es la jerarquía de la pantalla.
  if (texto.indexOf("desayuno") > texto.indexOf("el dinero")) {
    throw new Error("el dinero aparece antes que la comida del día");
  }
});

await step("el inicio no vuelve a ser un muro de tarjetas", async () => {
  const enlaces = await page.locator(".tarjeta-boton").count();
  if (enlaces > 3) throw new Error(`${enlaces} tarjetas-enlace en el inicio; el límite es 3`);
  const items = await page.locator(".nav__item").count();
  if (items !== 4) throw new Error(`la navegación tiene ${items} destinos, deberían ser 4`);
});

await step("el plan respeta el tiempo de cocina declarado", async () => {
  const texto = (await page.locator(".contenido").innerText()).toLowerCase();
  if (texto.includes("no caben en el tiempo")) {
    throw new Error("el plan dejó comidas fuera del tiempo declarado");
  }
});

await step("cocinar por adelantado: hay tandas y ahorro de tiempo", async () => {
  await page.getByRole("link", { name: /Plan/ }).first().click();
  await page.getByRole("link", { name: /Cocinar por adelantado/ }).click();
  await page.getByRole("heading", { name: "Cocinar por adelantado" }).waitFor();
  const texto = (await page.locator(".contenido").innerText()).toLowerCase();
  for (const esperado of ["tiempo de cocina esta semana", "jornada", "consumir antes del"]) {
    if (!texto.includes(esperado)) throw new Error(`falta "${esperado}" en meal prep`);
  }
  if (!/−\d+ min/.test(await page.locator(".contenido").innerText())) {
    throw new Error("no muestra ahorro de tiempo");
  }
  await shot("09-meal-prep");
});

await step("ejecutar una tanda la marca como cocinada", async () => {
  const boton = page.getByRole("button", { name: "Ya la cociné" }).first();
  await boton.click();
  await page.getByText("✓ Cocinada").first().waitFor();
  await shot("10-tanda-cocinada");
});

await step("ver qué necesito para una tanda", async () => {
  await page.getByRole("button", { name: "Ver qué necesito" }).first().click();
  await page.getByText(/Cantidades para las/).waitFor();
  await shot("11-tanda-ingredientes");
  await page.locator(".hoja__panel .boton-icono").click();
});

await step("plan mensual", async () => {
  await page.getByRole("link", { name: /Plan/ }).first().click();
  await page.getByRole("heading", { name: "Plan" }).waitFor();
  await shot("12-plan");
});

await step("detalle de comida", async () => {
  await page.locator(".lista__item").first().click();
  await page.getByText("Cómo se prepara").waitFor();
  const texto = (await page.locator(".contenido").innerText()).toLowerCase();
  for (const esperado of ["costo estimado", "por persona", "ingredientes", "nutrición", "estimada"]) {
    if (!texto.includes(esperado)) throw new Error(`falta "${esperado}" en el detalle`);
  }
  await shot("13-comida");
});

await step("cocinar descuenta inventario", async () => {
  await page.getByRole("button", { name: /Lo cociné/ }).click();
  await page.getByText("Listo, inventario actualizado").waitFor();
  await shot("14-cocinado");
  await page.getByRole("button", { name: /^Cerrar / }).click();
});

await step("mercado", async () => {
  await page.getByRole("link", { name: /Mercado/ }).first().click();
  await page.getByRole("heading", { name: "Mercado" }).waitFor();
  const texto = (await page.locator(".contenido").innerText()).toLowerCase();
  if (!texto.includes("total de esta compra")) throw new Error("falta el total");
  if (!texto.includes("proteínas") && !texto.includes("granos")) throw new Error("no agrupa por categoría");
  await shot("15-mercado");
});

await step("marcar un producto como comprado", async () => {
  const primero = page.locator(".lista__item").first();
  await primero.click();
  if ((await primero.getAttribute("aria-pressed")) !== "true") throw new Error("no quedó marcado");
  await shot("16-mercado-marcado");
});

await step("despensa", async () => {
  await page.getByRole("link", { name: /Despensa/ }).first().click();
  await page.getByRole("heading", { name: "Mi despensa" }).waitFor();
  await shot("17-despensa");
});

await step("¿qué puedo cocinar?", async () => {
  await page.getByRole("link", { name: /¿Qué puedo cocinar con esto\?/ }).click();
  await page.getByRole("heading", { name: "¿Qué puedo cocinar?" }).waitFor();
  await shot("18-que-puedo-cocinar");
});

await step("recetas muestran tiempo y dificultad y se pueden filtrar", async () => {
  await page.getByRole("link", { name: /Plan/ }).first().click();
  await page.getByRole("link", { name: /Recetario/ }).click();
  await page.getByRole("heading", { name: "Recetas" }).waitFor();
  const texto = await page.locator(".contenido").innerText();
  if (!/⏱ \d+ min/.test(texto)) throw new Error("el índice no muestra el tiempo");
  if (!/(Fácil|Media|Difícil)/.test(texto)) throw new Error("el índice no muestra la dificultad");

  await page.getByRole("button", { name: "≤ 15 min" }).click();
  await page.waitForTimeout(250);
  const tiempos = await page.locator(".lista__item .insignia").allInnerTexts();
  for (const t of tiempos.filter((x) => x.includes("min"))) {
    const min = Number(t.replace(/\D/g, ""));
    if (min > 15) throw new Error(`el filtro dejó pasar una receta de ${min} min`);
  }
  await shot("19-recetas");

  await page.getByRole("button", { name: "≤ 15 min" }).click();
  await page.getByLabel("Buscar receta").fill("lenteja");
  await page.waitForTimeout(200);
});

await step("ajustes se abren desde el engranaje y vienen agrupados", async () => {
  await page.getByRole("link", { name: "Hoy" }).first().click();
  await page.getByRole("link", { name: "Ajustes" }).click();
  await page.getByRole("heading", { name: "Ajustes" }).waitFor();
  const texto = (await page.locator(".contenido").innerText()).toLowerCase();
  if (!texto.includes("mi hogar")) throw new Error("no abre en el grupo de hogar");
  // Los ajustes de cocina NO están en el mismo scroll: ese era el problema.
  if (texto.includes("tiempo de cocina")) throw new Error("las once secciones siguen en un solo scroll");
  await shot("20-ajustes");
});

await step("cada grupo de ajustes trae lo suyo y nada más", async () => {
  await page.getByRole("button", { name: /Cómo cocino/ }).click();
  const cocina = (await page.locator(".contenido").innerText()).toLowerCase();
  if (!cocina.includes("tiempo de cocina")) throw new Error("falta el tiempo de cocina");
  if (cocina.includes("privacidad")) throw new Error("mezcla la privacidad con la cocina");
  await page.getByRole("button", { name: /La app/ }).click();
  const app = (await page.locator(".contenido").innerText()).toLowerCase();
  if (!app.includes("precios") || !app.includes("privacidad")) throw new Error("falta precios o privacidad");
  await shot("20b-ajustes-app");
});

await step("panel de precios explica la procedencia", async () => {
  await page.getByRole("button", { name: /Origen de los precios/ }).click();
  await page.getByText("¿Por qué no hay precios reales?").waitFor();
  await shot("21-precios");
  await page.getByRole("button", { name: /^Cerrar / }).click();
});

await step("estado físico estima necesidades y advierte que es opcional", async () => {
  await page.goto(`${BASE}/#/estado-fisico`);
  await page.getByRole("heading", { name: "Estado físico" }).waitFor();
  let texto = (await page.locator(".contenido").innerText()).toLowerCase();
  if (!texto.includes("esto es opcional")) throw new Error("no dice que es opcional");
  if (!texto.includes("referencia genérica")) throw new Error("no marca la referencia genérica");

  await page.getByRole("button", { name: "+ Adulto" }).click();
  await page.getByLabel("Edad").fill("34");
  await page.getByLabel("Peso").fill("62");
  await page.getByLabel("Estatura").fill("163");
  await page.getByRole("button", { name: "Femenino", exact: true }).click();
  await page.getByRole("button", { name: /Moderado/ }).click();
  await page.waitForTimeout(300);

  texto = await page.locator(".contenido").innerText();
  if (!texto.includes("Mifflin-St Jeor")) throw new Error("no explica en qué se basa la estimación");
  if (!/no es una herramienta médica/i.test(texto)) throw new Error("falta la advertencia médica");
  await shot("23-estado-fisico");
});

await step("bajar de peso: con porciones según cada persona, el mes cuesta menos", async () => {
  // Dar los datos no cambia la compra por sí solo (D21): hay que elegirlo.
  await page.getByRole("button", { name: /Según cada persona/ }).click();
  await page.getByRole("button", { name: "Bajar de peso", exact: true }).click();
  await page.getByText("Lo que cambia en tu mes").waitFor({ timeout: 10000 });
  const texto = await page.locator(".contenido").innerText();
  // Un adulto con perfil que baja de peso y otro sin perfil (porción estándar).
  if (!/−\$[\d.]+ frente a porciones estándar/.test(texto)) {
    throw new Error("no muestra el ahorro frente a porciones estándar");
  }
  if (!/Bajar de peso · \d/.test(texto)) throw new Error("la persona no muestra su objetivo aplicado");
  await page.getByText("¿Cuánto se cocina?").scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -80));
  await shot("23b-bajar-de-peso");
});

await step("bajar de peso NO se aplica en embarazo, y lo dice", async () => {
  await page.getByRole("button", { name: "Embarazo", exact: true }).click();
  await page.getByText(/Durante el embarazo o la lactancia Rinde no aplica déficit/).first().waitFor();
  const texto = await page.locator(".contenido").innerText();
  if (!/Mantener el peso · \d/.test(texto)) throw new Error("siguió aplicando el déficit en embarazo");
  await page.getByRole("button", { name: "Embarazo", exact: true }).click();
  await shot("23c-embarazo-sin-deficit");
});

await step("el inicio dice que las porciones están ajustadas", async () => {
  await page.goto(`${BASE}/#/`);
  await page.getByText(/Porciones ajustadas a cada persona/).waitFor();
  await shot("23d-inicio-porciones");
});

await step("rinde más", async () => {
  await page.goto(`${BASE}/#/rinde-mas`);
  await page.getByRole("heading", { name: "Rinde más" }).waitFor();
  await page.waitForTimeout(400);
  await shot("22-rinde-mas");
});

await step("el estado sobrevive a recargar (persistencia local)", async () => {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.getByText(/Día 1 de 30/).waitFor({ timeout: 8000 });
  await shot("24-persistencia");
});

await step("manifest e iconos disponibles", async () => {
  for (const ruta of ["/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/sw.js"]) {
    const res = await page.request.get(`${BASE}${ruta}`);
    if (!res.ok()) throw new Error(`${ruta} → ${res.status()}`);
  }
});

await step("sin scroll horizontal a 390 px", async () => {
  for (const ruta of ["#/", "#/plan", "#/mercado", "#/despensa", "#/recetas", "#/perfil"]) {
    await page.goto(`${BASE}/${ruta}`);
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) throw new Error(`${ruta} desborda ${overflow}px`);
  }
});

await browser.close();
console.log("\n--- errores de consola/página ---");
console.log(errors.length === 0 ? "ninguno" : errors.join("\n"));
process.exit(errors.length === 0 ? 0 : 1);
