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

await step("comidas → despensa", async () => {
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByText("¿Qué tienes en casa?").waitFor();
  await shot("05-despensa-onboarding");
});

await step("texto libre: 'un poquito de pollo, unas papas y tres tomates'", async () => {
  await page.getByLabel("Escríbelo como lo dirías").fill("Tengo un poquito de pollo, unas papas y tres tomates");
  await page.getByRole("button", { name: "Agregar lo que escribí" }).click();
  await page.getByText("No dijiste cuánto").first().waitFor();
  await shot("06-nlp-pregunta-cantidad");
});

await step("confirmar cantidades vagas", async () => {
  await page.getByLabel("Cantidad de Pechuga de pollo en g").fill("1000");
  await page.getByLabel("Cantidad de Papa pastusa en g").fill("500");
  await shot("07-cantidades-confirmadas");
});

await step("agregar básicos y crear plan", async () => {
  await page.getByRole("button", { name: "Arroz blanco", exact: true }).click();
  await page.getByRole("button", { name: "Lentejas", exact: true }).click();
  await page.getByRole("button", { name: "Huevo", exact: true }).click();
  await page.getByRole("button", { name: "Crear mi plan" }).click();
  await page.getByText("Mi mes").waitFor({ timeout: 15000 });
  await shot("08-dashboard");
});

await step("el dashboard muestra presupuesto y gasto proyectado", async () => {
  // `innerText` devuelve el texto YA transformado por CSS, y varios títulos
  // van en mayúsculas por `text-transform`. Se compara sin distinguir caja.
  const texto = (await page.locator(".contenido").innerText()).toLowerCase();
  for (const esperado of ["presupuesto", "$800.000", "gasto proyectado", "comidas", "próxima comida"]) {
    if (!texto.includes(esperado)) throw new Error(`falta "${esperado}" en el dashboard`);
  }
  if (!texto.includes("datos de demostración")) throw new Error("no advierte que los precios son demo");
});

await step("plan mensual", async () => {
  await page.getByRole("link", { name: /Plan/ }).first().click();
  await page.getByRole("heading", { name: "Plan" }).waitFor();
  await shot("09-plan");
});

await step("detalle de comida", async () => {
  await page.locator(".lista__item").first().click();
  await page.getByText("Cómo se prepara").waitFor();
  const texto = (await page.locator(".contenido").innerText()).toLowerCase();
  for (const esperado of ["costo estimado", "por persona", "ingredientes", "nutrición", "estimada"]) {
    if (!texto.includes(esperado)) throw new Error(`falta "${esperado}" en el detalle`);
  }
  await shot("10-comida");
});

await step("cocinar descuenta inventario", async () => {
  await page.getByRole("button", { name: /Lo cociné/ }).click();
  await page.getByText("Listo, inventario actualizado").waitFor();
  await shot("11-cocinado");
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();
});

await step("mercado", async () => {
  await page.getByRole("link", { name: /Mercado/ }).first().click();
  await page.getByRole("heading", { name: "Mercado" }).waitFor();
  const texto = (await page.locator(".contenido").innerText()).toLowerCase();
  if (!texto.includes("total de esta compra")) throw new Error("falta el total");
  if (!texto.includes("proteínas") && !texto.includes("granos")) throw new Error("no agrupa por categoría");
  await shot("12-mercado");
});

await step("marcar un producto como comprado", async () => {
  const primero = page.locator(".lista__item").first();
  await primero.click();
  if ((await primero.getAttribute("aria-pressed")) !== "true") throw new Error("no quedó marcado");
  await shot("13-mercado-marcado");
});

await step("despensa", async () => {
  await page.getByRole("link", { name: /Despensa/ }).first().click();
  await page.getByRole("heading", { name: "Mi despensa" }).waitFor();
  await shot("14-despensa");
});

await step("¿qué puedo cocinar?", async () => {
  await page.getByRole("link", { name: /¿Qué puedo cocinar con esto\?/ }).click();
  await page.getByRole("heading", { name: "¿Qué puedo cocinar?" }).waitFor();
  await shot("15-que-puedo-cocinar");
});

await step("recetas", async () => {
  await page.getByRole("link", { name: /Recetas/ }).first().click();
  await page.getByRole("heading", { name: "Recetas" }).waitFor();
  await page.getByLabel("Buscar receta").fill("lenteja");
  await page.waitForTimeout(200);
  await shot("16-recetas");
});

await step("perfil", async () => {
  await page.getByRole("link", { name: /Perfil/ }).first().click();
  await page.getByRole("heading", { name: "Perfil" }).waitFor();
  await shot("17-perfil");
});

await step("panel de precios explica la procedencia", async () => {
  await page.getByRole("button", { name: /Origen de los precios/ }).click();
  await page.getByText("¿Por qué no hay precios reales?").waitFor();
  await shot("18-precios");
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();
});

await step("rinde más", async () => {
  await page.goto(`${BASE}/#/rinde-mas`);
  await page.getByRole("heading", { name: "Rinde más" }).waitFor();
  await page.waitForTimeout(400);
  await shot("19-rinde-mas");
});

await step("el estado sobrevive a recargar (persistencia local)", async () => {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.getByText("Mi mes").waitFor({ timeout: 8000 });
  await shot("20-persistencia");
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
