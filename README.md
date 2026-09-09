# Rinde

> **Tu presupuesto. Tu despensa. Tu mes.**

Rinde ayuda a una persona o familia a que su presupuesto de alimentación
alcance todo el mes. No es una aplicación de recetas: es un asistente de
planificación financiera para la comida del hogar.

```
Presupuesto → inventario → menú → costos → lista de mercado → cocinar → repetir
```

Mercado inicial: **Colombia**. Moneda: **COP**.

---

## Qué hay aquí

```
rinde/
├── packages/
│   ├── core/     @rinde/core   Motor determinista. CERO dependencias.
│   └── data/     @rinde/data   Catálogo demo: 73 ingredientes, 60 recetas, precios DEMO.
├── apps/
│   ├── web/      @rinde/web    PWA mobile-first (React 19 + Vite 8). El producto.
│   └── api/      @rinde/api    Backend REST (Fastify 5 + SQLite).
└── docs/
    ├── ARCHITECTURE.md   Stack, modelo de datos, PWA, camino a Android.
    ├── DATA_SOURCES.md   De dónde salen (y de dónde NO salen) los precios.
    ├── API.md            Contrato REST completo.
    └── DECISIONS.md      Qué se decidió, por qué, y qué costaría revertirlo.
```

---

## Arrancar

```bash
npm install

# PWA (no necesita el backend: funciona sola, sin registro y sin red)
npm run dev:web            # http://localhost:5173

# Tests del motor y de la API
npm test                   # 173 tests
npm run typecheck

# Backend (opcional en el MVP)
npm run seed:api           # carga el catálogo DEMO en SQLite
npm run dev:api            # http://localhost:3000
```

### Prueba de humo en un navegador real

```bash
npm run build -w @rinde/web
cd apps/web && npx vite preview --port 4173
npm run e2e                                  # recorre el flujo completo
```

---

## Lo que este MVP hace

- **Onboarding en cuatro preguntas**: presupuesto, personas, comidas, despensa.
  Acepta texto libre en español: *"Tengo un poquito de pollo, unas papas y tres
  tomates"*.
- **Plan completo**: 30 días × 3 comidas para 2 personas con $800.000 sale en
  menos de un segundo, dentro del presupuesto, con ~36 recetas distintas.
- **Escalado de porciones** que nunca muestra `0,37 huevos`.
- **Costo por comida y por persona**, con la suma cuadrada al peso.
- **Lista de mercado** agrupada como se recorre la plaza, consolidada, en
  formatos reales de venta (libra, kilo, panal), dividida en ciclos semanales.
- **Cocinar descuenta la despensa** y sugiere qué hacer con las sobras.
- **"¿Qué puedo cocinar?"** con el porcentaje de ingredientes que ya tienes.
- **"Rinde más"**: en qué conviene gastar el dinero que sobra, calculado con
  datos de tu propio plan.
- **Sustituciones** que equiparan proteína por proteína, no por peso.
- **PWA instalable**, funciona offline, sin cuenta, sin enviar datos a nadie.

## Lo que este MVP NO hace

Declarado en voz alta para que nadie lo asuma:

- **No encuentra el plan óptimo global.** Es una heurística voraz. El propio
  plan lo dice: `diagnostics.method` es siempre `"heuristic"`.
- **No tiene precios reales.** Todo lo que trae va marcado como *Datos de
  demostración*. No hay ninguna API de precios conectada, y en
  [DATA_SOURCES.md](./docs/DATA_SOURCES.md) está por qué y qué haría falta.
- **No usa un LLM.** La interfaz para conectarlo está declarada; no hay clave
  ni llamada activa. El intérprete de lenguaje natural del MVP es determinista.
- **No es una herramienta médica.** Toda la nutrición es estimada y está
  marcada como tal.
- **No sincroniza entre dispositivos.** Todavía no hay cuentas.
- **No cobra nada.** La división free/premium está preparada, sin pagos.

---

## Las reglas que sostienen el producto

1. **Todo el dinero es un entero de COP.** Sin `float` en ningún cálculo
   monetario. La suma de las partes es exactamente el total.
2. **Un ingrediente sin precio no vale `$0`.** Vale `null`, y se dice.
3. **Un precio nunca existe sin fuente, fecha y confianza**, y esa procedencia
   llega hasta la pantalla.
4. **Un dato demo jamás se presenta como real**, ni se promedia con uno.
5. **La IA no decide cantidades.** Si la frase es vaga, se pregunta.
6. **El motor no lee el reloj ni usa `Math.random()`.** Misma entrada, mismo
   plan — por eso los tests significan algo.
7. **Nunca se afirma optimalidad** cuando solo hay una heurística.

---

## Estado

MVP funcional. Motor, PWA y API construidos y probados: 173 tests automáticos
más una prueba de humo de 23 pasos en un navegador real (Chromium a 390 px,
sin errores de consola).

Lo siguiente, en orden: verificar el esquema real de SIPSA para conectar
precios de verdad, cuentas con Google Sign-In, y empaquetado Android con
Capacitor.
