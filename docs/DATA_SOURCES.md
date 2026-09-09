# Fuentes de precios (§17 y §18 del brief)

> **Regla del proyecto:** Rinde no inventa precios, no inventa APIs y no
> presenta una estimación como un precio exacto. Este documento explica qué se
> verificó, qué **no** se pudo verificar y qué está realmente implementado.

---

## 0. Estado honesto de este documento

La investigación se hizo desde un entorno con **salida de red restringida**:
`dane.gov.co` y `datos.gov.co` estaban **bloqueados por el proxy**. Por eso:

- Lo que aparece abajo como **"verificado por búsqueda"** proviene de
  resultados de buscador que describen las páginas oficiales.
- **No se pudo abrir ni un solo endpoint**, así que **no se conoce el esquema
  real de campos de ningún dataset.**
- En consecuencia, **no se escribió ningún adaptador que asuma nombres de
  campos.** Hacerlo sería inventar una API, que es justo lo prohibido.

Lo que sí está implementado y funciona hoy: **CSV, carga manual y modo demo.**

---

## 1. Fuentes candidatas encontradas

### 1.1 DANE — SIPSA (Sistema de Información de Precios y Abastecimiento del Sector Agropecuario)

El candidato más serio para Colombia. Es el sistema oficial del DANE que
publica precios **mayoristas** de productos agropecuarios en las centrales de
abastos del país, en boletines **diarios, semanales y mensuales**.

Componentes: precios mayoristas (SIPSA-P), abastecimiento (SIPSA-A) e insumos
(SIPSA-I).

Puntos de acceso identificados:

| Recurso | URL |
|---|---|
| Portal SIPSA (DANE) | https://www.dane.gov.co/index.php/estadisticas-por-tema/agropecuario/sistema-de-informacion-de-precios-sipsa |
| Boletín mayorista semanal | https://www.dane.gov.co/index.php/estadisticas-por-tema/agropecuario/sistema-de-informacion-de-precios-sipsa/mayoristas-boletin-semanal-1 |
| "Servicio web para consulta de la base de datos de SIPSA" (DANE) | https://www.dane.gov.co/index.php/estadisticas-por-tema/agropecuario/sistema-de-informacion-de-precios-sipsa/servicio-web-para-consulta-de-la-base-de-datos-de-sipsa |
| SIPSA-P en Datos Abiertos Colombia (Socrata) | https://www.datos.gov.co/dataset/Sistema-de-Informaci-n-de-Precios-y-Abastecimiento/gkqq-k3k5 |
| Microdatos DANE — SIPSA-P | https://microdatos.dane.gov.co/index.php/catalog/776 |

**Lo que NO se pudo confirmar y hay que verificar antes de escribir el adaptador:**

1. El DANE anuncia un "servicio web para consulta de la base de datos de
   SIPSA", pero **no se pudo abrir la página**: se desconoce si es REST o SOAP,
   si requiere registro y qué métodos expone.
2. `datos.gov.co` corre sobre **Socrata**, que normalmente expone
   `https://www.datos.gov.co/resource/<id>.json` con soporte de SoQL. El
   identificador `gkqq-k3k5` apareció en los resultados, pero **no se verificó
   que ese endpoint responda ni qué columnas devuelve.**
3. La licencia exacta de reutilización no se pudo leer. Los datos del portal
   nacional de datos abiertos suelen ser reutilizables con atribución, pero
   **eso hay que confirmarlo en la ficha del dataset antes de publicar.**

**Limitación de fondo, independiente de lo técnico:** SIPSA publica precios
**mayoristas de centrales de abastos**, no precios de góndola de supermercado.
Un hogar que compra al detal paga más. Usar SIPSA directamente como "lo que te
va a costar" sería engañoso; hace falta un factor de ajuste mayorista→detal
que a su vez debe justificarse con datos, no inventarse.

### 1.2 Índice de Precios al Consumidor (IPC) — DANE

No sirve para precios absolutos (es un índice), pero **sí sirve para
actualizar precios viejos por inflación de la división "Alimentos y bebidas no
alcohólicas"**, marcando el resultado como `estimated`. La arquitectura lo
contempla (`PriceSource.type = "index"`), no está implementado.

### 1.3 Supermercados (Éxito, Jumbo, D1, Ara, Olímpica…)

**Ninguna cadena colombiana ofrece una API pública de precios documentada**
que se haya podido verificar.

**Decisión explícita: no se hace scraping.** Los términos de servicio de estos
sitios normalmente lo prohíben, y el brief lo prohíbe también. El camino
legítimo es un acuerdo comercial o un programa de afiliados; la arquitectura
deja el hueco (`PriceSource.type = "commercial"`, `Store`), sin código.

### 1.4 Agregadores comerciales

Existen proveedores de datos de retail por suscripción. No se evaluó ninguno
porque implica contrato. El adaptador sería igual al de cualquier API
autorizada.

---

## 2. Lo que Rinde implementa realmente hoy

| Vía | Estado | Dónde |
|---|---|---|
| **Modo demo** | ✅ funciona | `packages/data/src/prices.ts`, todo con `isDemo: true` |
| **Carga manual (admin)** | ✅ funciona | `POST /admin/prices` |
| **Importación CSV** | ✅ funciona | `POST /admin/prices/import`, parser en `@rinde/core` |
| **Historial + variación semanal** | ✅ funciona | `weeklyPriceUpdate()` en `@rinde/core` |
| **Adaptador SIPSA** | ⛔ **no implementado** | requiere verificar el esquema real primero |
| **APIs de supermercados** | ⛔ no implementado | requiere acuerdo comercial |
| **Scraping** | ⛔ **descartado por diseño** | — |

La interfaz `PriceProvider` (en `@rinde/core`) es el punto de extensión. Un
adaptador nuevo implementa un método y devuelve `PriceObservation[]`. Nada más
del sistema cambia.

---

## 3. Confianza de un precio — es parte del dato, no un detalle

Cada precio guarda su nivel de confianza y **la interfaz lo muestra siempre**:

| Nivel | Significado | Cómo se muestra |
|---|---|---|
| `measured` | Observado en un comercio en una fecha concreta | `$18.900/kg` |
| `reported` | De una fuente oficial agregada (ej. boletín) | `$18.900/kg · fuente` |
| `estimated` | Derivado (inflación, promedio, sustituto) | **`Precio estimado`** |
| `demo` | Dato de demostración | **`Datos de demostración`** |

Reglas implementadas en el motor y en la UI:

1. Un precio con más de **14 días** se degrada automáticamente a `estimated`.
2. Un precio `demo` **nunca** se presenta sin su etiqueta.
3. Un precio `demo` y uno real **nunca se promedian**.
4. Un ingrediente **sin precio** no rompe el plan: cuenta como costo
   desconocido, se excluye del total y se muestra como `Sin precio` —
   nunca como `$0`.

---

## 4. Formato CSV de importación

```csv
ingredient_id,price_cop,quantity,unit,city,store,source_id,observed_on,confidence
pollo_pechuga,18900,1,kg,Bogotá,Plaza Paloquemao,manual_admin,2026-09-07,measured
arroz_blanco,4200,1,kg,Bogotá,D1,manual_admin,2026-09-07,measured
```

- `price_cop` — entero, pesos colombianos, **sin separadores ni decimales**.
- `observed_on` — `YYYY-MM-DD`. **Fecha de observación**, no de carga.
- `confidence` — `measured` | `reported` | `estimated`.
- Filas con `ingredient_id` desconocido se **rechazan con el número de línea**;
  no se descartan en silencio.

---

## 5. Qué haría falta para conectar SIPSA de verdad

1. Abrir https://www.dane.gov.co/.../servicio-web-para-consulta-de-la-base-de-datos-de-sipsa
   y documentar protocolo, autenticación y métodos reales.
2. Consultar `https://www.datos.gov.co/resource/gkqq-k3k5.json?$limit=1` y
   **anotar los nombres de columna literales** en este documento.
3. Leer la licencia en la ficha del dataset y registrar la atribución exigida.
4. Construir la tabla de correspondencia entre los nombres de producto de SIPSA
   (que son variedades: "Arroz de primera", "Papa parda pastusa") y los
   `ingredient_id` de Rinde. Este mapeo es manual y es la parte más laboriosa.
5. Decidir y **justificar con datos** el factor mayorista→detal, o etiquetar
   claramente los precios como mayoristas.
6. Recién entonces escribir `SipsaPriceProvider`.

Hasta que eso ocurra, Rinde dice `Datos de demostración`. Y eso es correcto.

---

## Fuentes consultadas

- [DANE — SIPSA](https://www.dane.gov.co/index.php/estadisticas-por-tema/agropecuario/sistema-de-informacion-de-precios-sipsa)
- [DANE — Componente precios mayoristas](https://www.dane.gov.co/index.php/estadisticas-por-tema/agropecuario/sistema-de-informacion-de-precios-sipsa/componente-precios-mayoristas)
- [DANE — Mayoristas boletín semanal](https://www.dane.gov.co/index.php/estadisticas-por-tema/agropecuario/sistema-de-informacion-de-precios-sipsa/mayoristas-boletin-semanal-1)
- [DANE — Servicio web para consulta de la base de datos de SIPSA](https://www.dane.gov.co/index.php/estadisticas-por-tema/agropecuario/sistema-de-informacion-de-precios-sipsa/servicio-web-para-consulta-de-la-base-de-datos-de-sipsa)
- [Datos Abiertos Colombia — SIPSA-P (2013-2024)](https://www.datos.gov.co/dataset/Sistema-de-Informaci-n-de-Precios-y-Abastecimiento/gkqq-k3k5)
- [Microdatos DANE — SIPSA-P, catálogo 776](https://microdatos.dane.gov.co/index.php/catalog/776)

*Ninguna de estas URL pudo abrirse desde el entorno de desarrollo; provienen de
resultados de búsqueda y deben verificarse manualmente antes de escribir un
adaptador.*
