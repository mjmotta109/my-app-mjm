import type { Ingredient, Recipe } from "./types.js";
import { UnitError, roundForDisplay, toBase } from "./units.js";

/**
 * Escalado de porciones (§9 del brief).
 *
 * Una receta escrita para 4 personas que se cocina para 2 se multiplica por
 * 0,5. El problema real no es multiplicar: es que el resultado sea ejecutable
 * en una cocina. `0,37 huevos` no se le muestra a nadie.
 *
 * Regla clave: **el costo se calcula sobre la cantidad ya redondeada**, no
 * sobre la fraccionaria. Si se redondea 1,4 huevos a 1 huevo, se cobra 1
 * huevo. Lo que se muestra y lo que se cobra son el mismo número.
 */

export interface ScaledLine {
  ingredientId: string;
  /** Cantidad exacta antes de redondear, en unidad base. Solo diagnóstico. */
  exactBase: number;
  /** Cantidad redondeada, en unidad base. Esta es la que se usa para todo. */
  qtyBase: number;
  optional: boolean;
}

export interface ScaleResult {
  recipeId: string;
  baseServings: number;
  targetServings: number;
  factor: number;
  lines: ScaledLine[];
  /** Ingredientes de la receta que no están en el catálogo. */
  unknownIngredientIds: string[];
}

/**
 * Comensales equivalentes de un hogar.
 *
 * SUPUESTO EXPLÍCITO DEL MODELO: un niño consume ~0,7 de la porción de un
 * adulto. Es una convención de planificación, no un dato nutricional medido.
 * Se expone como parámetro para poder ajustarla o sustituirla por un modelo
 * mejor sin tocar el resto del motor.
 */
export const DEFAULT_CHILD_FACTOR = 0.7;

export function eaterEquivalents(
  adults: number,
  children: number,
  childFactor: number = DEFAULT_CHILD_FACTOR,
): number {
  if (adults < 0 || children < 0) {
    throw new RangeError("adults y children no pueden ser negativos");
  }
  if (adults + children === 0) {
    throw new RangeError("El hogar debe tener al menos una persona");
  }
  return adults + children * childFactor;
}

/**
 * Escala una receta a `targetServings` porciones.
 *
 * Los ingredientes desconocidos se reportan en `unknownIngredientIds` en vez
 * de lanzar: una receta con un ingrediente sin catalogar debe poder mostrarse,
 * marcada como incompleta, en vez de romper la aplicación.
 */
export function scaleRecipe(
  recipe: Recipe,
  targetServings: number,
  catalog: ReadonlyMap<string, Ingredient>,
): ScaleResult {
  if (recipe.baseServings <= 0) {
    throw new RangeError(`La receta ${recipe.id} declara baseServings <= 0`);
  }
  if (targetServings <= 0) {
    throw new RangeError(`targetServings debe ser > 0, se recibió ${targetServings}`);
  }

  const factor = targetServings / recipe.baseServings;
  const lines: ScaledLine[] = [];
  const unknownIngredientIds: string[] = [];

  for (const item of recipe.ingredients) {
    const ingredient = catalog.get(item.ingredientId);
    if (!ingredient) {
      unknownIngredientIds.push(item.ingredientId);
      continue;
    }
    let exactBase: number;
    try {
      exactBase = toBase(item.qty, item.unit, ingredient) * factor;
    } catch (error) {
      if (error instanceof UnitError) {
        unknownIngredientIds.push(item.ingredientId);
        continue;
      }
      throw error;
    }
    lines.push({
      ingredientId: item.ingredientId,
      exactBase,
      qtyBase: roundForDisplay(exactBase, ingredient),
      optional: item.optional === true,
    });
  }

  return {
    recipeId: recipe.id,
    baseServings: recipe.baseServings,
    targetServings,
    factor,
    lines,
    unknownIngredientIds,
  };
}
