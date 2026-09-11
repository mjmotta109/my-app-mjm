# Ficha de Google Play — Rinde

Texto listo para pegar en Play Console. Lo que esté entre `[CORCHETES]` lo
tienes que completar tú.

---

## Nombre de la app (máx. 30 caracteres)

```
Rinde: presupuesto de comida
```
*(28 caracteres)*

## Descripción breve (máx. 80 caracteres)

```
Tu presupuesto. Tu despensa. Tu mes. Planifica la comida con lo que tienes.
```
*(74 caracteres)*

## Descripción completa (máx. 4.000 caracteres)

```
Rinde te ayuda a que el presupuesto de comida te alcance todo el mes.

No es una app de recetas. Es un asistente de planificación para la comida de
tu casa: le dices cuánta plata tienes, cuántos son en el hogar y qué hay en la
despensa, y te arma el mes completo.

QUÉ HACE

• Reparte tu presupuesto entre todas las comidas del mes, sin pasarse.
• Usa primero lo que ya tienes en casa, para que no lo compres dos veces.
• Te dice qué cocinar cada día, con el costo por comida y por persona.
• Arma la lista de mercado agrupada como se recorre la plaza, con las
  cantidades en la forma en que se venden los productos: la libra, el kilo,
  el panal de huevos.
• Cuando cocinas, descuenta los ingredientes de tu despensa solo.

PLANIFICA SEGÚN EL TIEMPO QUE TIENES

Dinos cómo es tu semana y Rinde solo propone recetas que te quepan en el día.
Un martes de veinte minutos no es el día del sancocho.

COCINAR POR ADELANTADO

Si prefieres cocinar dos veces por semana en vez de todos los días, Rinde arma
el plan por tandas: te dice qué día cocinar, cuánto rinde cada olla, qué va a
la nevera, qué al congelador y hasta cuándo aguanta.

¿QUÉ PUEDO COCINAR?

Mira lo que hay en tu despensa y te dice qué se puede hacer ahora mismo, con
el porcentaje de ingredientes que ya tienes y cuánto costaría completar lo que
falta.

RINDE MÁS

¿Te sobró plata del presupuesto? Te muestra en qué conviene gastarla, con
números sacados de tu propio plan.

COCINA COLOMBIANA

119 recetas con ingredientes que se consiguen en cualquier plaza o
supermercado del país: sancocho, ajiaco, lentejas, fríjoles, arepas, sudados,
y también curry, salteados, pastas y wraps resueltos con lo mismo.

SIN CUENTA Y SIN INTERNET

No necesitas registrarte. No pedimos correo ni teléfono. Todo se guarda en tu
teléfono y funciona sin conexión.

IMPORTANTE SOBRE LOS PRECIOS

Esta versión usa PRECIOS DE DEMOSTRACIÓN, marcados como tales dentro de la
aplicación. No son precios reales de mercado y no deben usarse para tomar
decisiones de compra. Los cálculos del plan sí son reales; lo que está
pendiente es conectar una fuente de precios verificada.

NO ES UNA HERRAMIENTA MÉDICA

Las estimaciones de nutrición son aproximadas y están marcadas como tales.
Rinde no da consejo médico ni dietético.
```

## Categoría

- **Categoría:** Alimentación y bebida
- **Etiquetas sugeridas:** presupuesto, recetas, planificación de comidas,
  lista de mercado, despensa

## Gráficos

| Recurso | Archivo | Tamaño |
|---|---|---|
| Icono de la ficha | `play-icon-512.png` | 512 × 512 |
| Gráfico destacado | `play-feature-graphic-1024x500.png` | 1024 × 500 |
| Capturas de teléfono | `screenshots/1-*` … `6-*` | 780 × 1688 |

Las capturas se tomaron de la aplicación real corriendo, no son maquetas. Para
regenerarlas: levanta `vite preview` y corre `npm run e2e -w @rinde/web`.

## Clasificación de contenido

Al llenar el cuestionario, todas las respuestas son **No**: sin violencia, sin
contenido sexual, sin lenguaje soez, sin sustancias, sin juegos de azar, sin
compras dentro de la app, sin contenido generado por usuarios que se comparta.

Resultado esperado: apta para todo público.

## Política de privacidad

URL: **[PENDIENTE: sube `PRIVACIDAD.md` como página web y pon aquí su URL]**

Play exige que sea una URL pública y accesible. GitHub Pages sirve y es gratis.

---

## Formulario de seguridad de los datos

Esta es la parte donde más gente se equivoca. Para Rinde, tal como está hoy:

### ¿Tu app recopila o comparte alguno de los tipos de datos requeridos?

**NO.**

El formulario se refiere a datos que **salen del dispositivo**. Rinde guarda
todo localmente y no transmite nada, así que la respuesta es no.

Si declaras "sí" por error, Play te va a pedir que describas prácticas de
recopilación que no existen, y la ficha va a mostrar advertencias que no
corresponden.

### ¿Los datos están cifrados en tránsito?

No aplica: no hay tránsito.

### ¿Los usuarios pueden pedir que se borren sus datos?

Sí — desde **Perfil → Borrar todos mis datos** dentro de la aplicación.

### Si algún día agregas cuentas o sincronización

Este formulario cambia por completo y hay que volver a llenarlo **antes** de
publicar esa versión. Los datos físicos (peso, estatura, edad) entrarían en la
categoría de **salud y estado físico**, que Play trata con más exigencia.

---

## Antes de publicar: lo que falta

- [ ] Correo de contacto en `PRIVACIDAD.md`
- [ ] URL pública de la política de privacidad
- [ ] `applicationId` definitivo (hoy `co.rinde.app`) — **no se puede cambiar
      después de publicar**
- [ ] Prueba cerrada con 12 testers durante 14 días seguidos, si tu cuenta de
      Play es personal y se creó después del 13 de noviembre de 2023
- [ ] Decidir si se publica con precios de demostración o se espera a tener
      una fuente real
