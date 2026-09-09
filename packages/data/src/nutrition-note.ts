/**
 * ADVERTENCIA SOBRE LOS DATOS NUTRICIONALES DE ESTE CATÁLOGO.
 *
 * Todos los valores nutricionales de `ingredients.ts` son **aproximaciones de
 * composición de alimentos de uso general**. No se transcribieron de la Tabla
 * de Composición de Alimentos Colombianos del ICBF ni de ninguna otra base
 * verificada, porque no se pudo consultar ninguna desde el entorno donde se
 * construyó este catálogo.
 *
 * Por eso TODOS los ingredientes llevan `nutritionIsEstimated: true` y la
 * interfaz muestra siempre la etiqueta "estimado". Cambiar esa marca a `false`
 * exige reemplazar los valores por datos de una fuente citada, ingrediente por
 * ingrediente.
 *
 * Rinde no es una herramienta médica ni dietética.
 */
export const NUTRITION_SOURCE =
  "aproximacion_generica_sin_verificar";

export const NUTRITION_DISCLAIMER =
  "Valores nutricionales estimados a partir de aproximaciones genéricas de " +
  "composición de alimentos. No provienen de una fuente verificada y no " +
  "constituyen información médica ni dietética.";
