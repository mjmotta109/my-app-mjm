import type { BaseUnit, CategoryId, Ingredient, IngredientTag, PackSize, Unit } from "@rinde/core";
import { NUTRITION_SOURCE } from "./nutrition-note.js";
import { TABLE_NUTRITION } from "./nutrition-table.generated.js";

/**
 * Catálogo de ingredientes con nombres y presentaciones de uso común en
 * Colombia.
 *
 * Lee `nutrition-note.ts` antes de confiar en los valores nutricionales:
 * son estimaciones sin verificar y están marcados como tales.
 *
 * `gramsPerUnit` y `gramsPerMl` son pesos y densidades aproximados de uso
 * doméstico. Existen para que las conversiones sean posibles y explícitas; sin
 * ellos el motor se niega a convertir en vez de adivinar.
 */

interface Spec {
  id: string;
  name: string;
  cat: CategoryId;
  base: BaseUnit;
  tags: IngredientTag[];
  /** [kcal, proteína g, carbohidratos g, grasa g, fibra g] por 100 g. */
  n?: [number, number, number, number, number];
  gpu?: number;
  gpml?: number;
  discrete?: boolean;
  step?: number;
  packs?: [number, Unit, string?][];
  fresh?: boolean;
  shelf?: number;
  subs?: string[];
  syn?: string[];
}

function build(spec: Spec): Ingredient {
  const packSizes: PackSize[] = (spec.packs ?? []).map(([qty, unit, label]) => ({
    qty,
    unit,
    ...(label ? { label } : {}),
  }));
  return {
    id: spec.id,
    name: spec.name,
    categoryId: spec.cat,
    baseUnit: spec.base,
    rounding: spec.discrete ? "discrete" : "continuous",
    roundingStep: spec.step ?? (spec.discrete ? 1 : spec.base === "unit" ? 1 : 5),
    packSizes,
    perishable: spec.fresh ?? false,
    tags: spec.tags,
    ...nutricionDe(spec),
    ...(spec.gpu !== undefined ? { gramsPerUnit: spec.gpu } : {}),
    ...(spec.gpml !== undefined ? { gramsPerMl: spec.gpml } : {}),
    ...(spec.shelf !== undefined ? { shelfLifeDays: spec.shelf } : {}),
    ...(spec.subs ? { substitutes: spec.subs } : {}),
    ...(spec.syn ? { synonyms: spec.syn } : {}),
  };
}

/**
 * Nutrición de un ingrediente, en orden de preferencia:
 *
 *   1. La tabla de composición (USDA FoodData Central), cuando el ingrediente
 *      tiene un alimento emparejado en `tablas/emparejamiento.csv`. Es un dato
 *      referenciado: `nutritionIsEstimated` pasa a `false` y la fuente dice
 *      exactamente qué fila de qué tabla se usó.
 *   2. La aproximación vieja del catálogo, marcada como estimada, para los
 *      ingredientes que la tabla no trae (los más colombianos: panela, papa
 *      criolla, arracacha, bocadillo…).
 */
function nutricionDe(
  spec: Spec,
): Pick<Ingredient, "nutrition" | "nutritionSource" | "nutritionIsEstimated"> {
  const tabla = TABLE_NUTRITION[spec.id];
  if (tabla) {
    return {
      nutrition: {
        kcal: tabla.kcal,
        proteinG: tabla.proteinG,
        carbsG: tabla.carbsG,
        fatG: tabla.fatG,
        ...(tabla.fiberG !== undefined ? { fiberG: tabla.fiberG } : {}),
      },
      nutritionSource:
        `${tabla.table}, FDC ${tabla.fdcId}: "${tabla.description}"` +
        (tabla.match === "cercano" ? ` — equivalente más cercano (${tabla.note ?? "no es el mismo producto"})` : ""),
      nutritionIsEstimated: false,
    };
  }
  if (!spec.n) return { nutritionIsEstimated: true };
  return {
    nutrition: {
      kcal: spec.n[0],
      proteinG: spec.n[1],
      carbsG: spec.n[2],
      fatG: spec.n[3],
      fiberG: spec.n[4],
    },
    nutritionSource: NUTRITION_SOURCE,
    nutritionIsEstimated: true,
  };
}

const SPECS: Spec[] = [
  // ---------------------------------------------------------------- proteínas
  { id: "pollo_pechuga", name: "Pechuga de pollo", cat: "proteinas", base: "g", tags: ["proteina"],
    n: [120, 22.5, 0, 2.6, 0], fresh: true, shelf: 3, step: 50,
    packs: [[500, "g", "media libra"], [1, "kg", "bandeja 1 kg"]],
    subs: ["pollo_muslo", "huevo", "lenteja"], syn: ["pollo", "pechuga"] },
  { id: "pollo_muslo", name: "Muslo de pollo", cat: "proteinas", base: "g", tags: ["proteina"],
    n: [175, 18, 0, 11, 0], fresh: true, shelf: 3, step: 50,
    packs: [[500, "g", "media libra"], [1, "kg", "bandeja 1 kg"]],
    subs: ["pollo_pechuga", "huevo"], syn: ["muslo", "perniles", "pernil"] },
  { id: "pollo_entero", name: "Pollo entero", cat: "proteinas", base: "g", tags: ["proteina"],
    n: [215, 18, 0, 15, 0], fresh: true, shelf: 3, step: 100,
    packs: [[1800, "g", "pollo entero"]], subs: ["pollo_muslo"], syn: ["gallina"] },
  { id: "carne_molida", name: "Carne molida de res", cat: "proteinas", base: "g", tags: ["proteina"],
    n: [254, 17.2, 0, 20, 0], fresh: true, shelf: 2, step: 50,
    packs: [[500, "g", "media libra"], [1, "kg", "1 kg"]],
    subs: ["lenteja", "pollo_pechuga", "frijol_rojo"], syn: ["carne", "molida", "carne de res"] },
  { id: "carne_res", name: "Carne de res (posta)", cat: "proteinas", base: "g", tags: ["proteina"],
    n: [130, 21, 0, 5, 0], fresh: true, shelf: 3, step: 50,
    packs: [[500, "g", "media libra"], [1, "kg", "1 kg"]],
    subs: ["pollo_pechuga", "lenteja", "carne_molida"], syn: ["posta", "res", "bistec"] },
  { id: "cerdo_lomo", name: "Lomo de cerdo", cat: "proteinas", base: "g", tags: ["proteina"],
    n: [143, 21, 0, 6, 0], fresh: true, shelf: 3, step: 50,
    packs: [[500, "g", "media libra"], [1, "kg", "1 kg"]],
    subs: ["pollo_pechuga", "carne_res"], syn: ["cerdo", "lomo"] },
  { id: "cerdo_costilla", name: "Costilla de cerdo", cat: "proteinas", base: "g", tags: ["proteina"],
    n: [277, 17, 0, 23, 0], fresh: true, shelf: 3, step: 100,
    packs: [[500, "g", "media libra"], [1, "kg", "1 kg"]],
    subs: ["cerdo_lomo"], syn: ["costilla"] },
  { id: "atun_lata", name: "Atún en lata", cat: "proteinas", base: "g", tags: ["proteina"],
    n: [116, 26, 0, 1, 0], step: 10,
    packs: [[160, "g", "lata 160 g"], [480, "g", "tres latas"]],
    subs: ["huevo", "pollo_pechuga"], syn: ["atun", "lata de atun"] },
  { id: "tilapia", name: "Filete de tilapia", cat: "proteinas", base: "g", tags: ["proteina"],
    n: [96, 20, 0, 1.7, 0], fresh: true, shelf: 2, step: 50,
    packs: [[500, "g", "media libra"], [1, "kg", "1 kg"]],
    subs: ["pollo_pechuga", "atun_lata"], syn: ["pescado", "mojarra", "filete"] },
  { id: "salchicha", name: "Salchicha", cat: "proteinas", base: "g", tags: ["proteina"],
    n: [300, 12, 3, 27, 0], fresh: true, shelf: 10, step: 50,
    packs: [[250, "g", "paquete 250 g"]], subs: ["huevo"], syn: ["salchichas"] },
  { id: "chorizo", name: "Chorizo", cat: "proteinas", base: "g", tags: ["proteina"],
    n: [350, 16, 2, 31, 0], fresh: true, shelf: 7, step: 50,
    packs: [[250, "g", "paquete 250 g"]], subs: ["salchicha"], syn: ["chorizos"] },

  // ------------------------------------------------------------------- granos
  { id: "arroz_blanco", name: "Arroz blanco", cat: "granos", base: "g", tags: ["grano", "basico"],
    n: [365, 7.1, 80, 0.7, 1.3], step: 25,
    packs: [[500, "g", "libra"], [1, "kg", "bolsa 1 kg"], [3, "kg", "bolsa 3 kg"]],
    subs: ["pasta_espagueti"], syn: ["arroz"] },
  { id: "lenteja", name: "Lentejas", cat: "granos", base: "g", tags: ["proteina_vegetal", "grano", "basico"],
    n: [353, 25.8, 60, 1.1, 10.7], step: 25,
    packs: [[500, "g", "libra"], [1, "kg", "bolsa 1 kg"]],
    subs: ["frijol_rojo", "garbanzo", "arveja_seca"], syn: ["lentejas"] },
  { id: "frijol_rojo", name: "Fríjol rojo", cat: "granos", base: "g", tags: ["proteina_vegetal", "grano"],
    n: [333, 23.6, 60, 0.8, 15], step: 25,
    packs: [[500, "g", "libra"], [1, "kg", "bolsa 1 kg"]],
    subs: ["lenteja", "garbanzo"], syn: ["frijol", "frijoles", "frijol"] },
  { id: "garbanzo", name: "Garbanzos", cat: "granos", base: "g", tags: ["proteina_vegetal", "grano"],
    n: [378, 20.5, 63, 6, 12.2], step: 25,
    packs: [[500, "g", "libra"], [1, "kg", "bolsa 1 kg"]],
    subs: ["lenteja", "frijol_rojo"], syn: ["garbanzos"] },
  { id: "arveja_seca", name: "Arveja seca", cat: "granos", base: "g", tags: ["proteina_vegetal", "grano"],
    n: [341, 24.5, 60, 1.2, 8.3], step: 25,
    packs: [[500, "g", "libra"]], subs: ["lenteja"], syn: ["arveja partida"] },
  { id: "pasta_espagueti", name: "Pasta espagueti", cat: "granos", base: "g", tags: ["grano"],
    n: [371, 13, 75, 1.5, 3.2], step: 25,
    packs: [[250, "g", "paquete 250 g"], [500, "g", "paquete 500 g"]],
    subs: ["arroz_blanco"], syn: ["pasta", "espagueti", "spaghetti", "fideos"] },
  { id: "avena_hojuelas", name: "Avena en hojuelas", cat: "granos", base: "g", tags: ["grano"],
    n: [389, 16.9, 66, 6.9, 10.6], step: 10,
    packs: [[500, "g", "bolsa 500 g"]], syn: ["avena"] },
  { id: "harina_maiz", name: "Harina de maíz precocida", cat: "granos", base: "g", tags: ["grano", "basico"],
    n: [358, 7, 76, 3.7, 4], step: 25,
    packs: [[500, "g", "bolsa 500 g"], [1, "kg", "bolsa 1 kg"]],
    syn: ["harina de maiz", "harina pan", "masa de arepa"] },
  { id: "harina_trigo", name: "Harina de trigo", cat: "granos", base: "g", tags: ["grano"],
    n: [364, 10, 76, 1, 2.7], step: 25,
    packs: [[500, "g", "bolsa 500 g"], [1, "kg", "bolsa 1 kg"]], syn: ["harina"] },
  { id: "pan_tajado", name: "Pan tajado", cat: "granos", base: "unit", tags: ["grano"],
    n: [265, 9, 49, 3.2, 2.7], gpu: 28, discrete: true, fresh: true, shelf: 5,
    packs: [[18, "unit", "bolsa x18"]], syn: ["pan", "tajadas de pan"] },
  { id: "arepa", name: "Arepa", cat: "granos", base: "unit", tags: ["grano", "basico"],
    n: [220, 4.5, 45, 2.5, 2], gpu: 90, discrete: true, fresh: true, shelf: 4,
    packs: [[5, "unit", "paquete x5"], [10, "unit", "paquete x10"]], syn: ["arepas"] },
  { id: "maiz_pira", name: "Maíz pira", cat: "granos", base: "g", tags: ["grano"],
    n: [387, 12, 78, 4.7, 14.5], step: 25, packs: [[500, "g", "libra"]],
    syn: ["crispetas", "maiz para crispetas"] },

  // ----------------------------------------------------------------- verduras
  { id: "papa_pastusa", name: "Papa pastusa", cat: "verduras", base: "g", tags: ["tuberculo", "basico"],
    n: [77, 2, 17, 0.1, 2.2], fresh: true, shelf: 21, step: 50,
    packs: [[500, "g", "libra"], [1, "kg", "1 kg"], [5, "kg", "bulto pequeño"]],
    subs: ["yuca", "platano_verde"], syn: ["papa", "papas"] },
  { id: "papa_criolla", name: "Papa criolla", cat: "verduras", base: "g", tags: ["tuberculo"],
    n: [85, 2, 19, 0.1, 2], fresh: true, shelf: 14, step: 50,
    packs: [[500, "g", "libra"]], subs: ["papa_pastusa"], syn: ["criolla"] },
  { id: "yuca", name: "Yuca", cat: "verduras", base: "g", tags: ["tuberculo"],
    n: [160, 1.4, 38, 0.3, 1.8], fresh: true, shelf: 7, step: 50,
    packs: [[500, "g", "libra"], [1, "kg", "1 kg"]], subs: ["papa_pastusa"], syn: ["yucas"] },
  { id: "platano_verde", name: "Plátano verde", cat: "verduras", base: "unit", tags: ["tuberculo"],
    n: [122, 1.3, 32, 0.4, 2.3], gpu: 200, discrete: true, fresh: true, shelf: 10,
    packs: [[1, "unit"], [5, "unit", "racimo x5"]],
    subs: ["yuca", "papa_pastusa"], syn: ["platano", "platanos", "verde"] },
  { id: "platano_maduro", name: "Plátano maduro", cat: "verduras", base: "unit", tags: ["tuberculo"],
    n: [122, 1.3, 32, 0.4, 2.3], gpu: 200, discrete: true, fresh: true, shelf: 5,
    packs: [[1, "unit"], [5, "unit", "racimo x5"]],
    subs: ["platano_verde"], syn: ["maduro", "maduros"] },
  { id: "tomate", name: "Tomate", cat: "verduras", base: "unit", tags: ["verdura", "basico"],
    n: [18, 0.9, 3.9, 0.2, 1.2], gpu: 120, discrete: true, fresh: true, shelf: 7,
    packs: [[1, "unit"], [500, "g", "libra"], [1, "kg", "1 kg"]], syn: ["tomates"] },
  { id: "cebolla_cabezona", name: "Cebolla cabezona", cat: "verduras", base: "unit", tags: ["verdura", "basico"],
    n: [40, 1.1, 9.3, 0.1, 1.7], gpu: 110, discrete: true, fresh: true, shelf: 21,
    packs: [[1, "unit"], [500, "g", "libra"], [1, "kg", "1 kg"]],
    subs: ["cebolla_larga"], syn: ["cebolla", "cebollas", "cebolla roja"] },
  { id: "cebolla_larga", name: "Cebolla larga", cat: "verduras", base: "g", tags: ["verdura"],
    n: [32, 1.8, 7.3, 0.2, 2.6], fresh: true, shelf: 7, step: 25,
    packs: [[250, "g", "manojo"]], subs: ["cebolla_cabezona"], syn: ["cebolla junca", "junca"] },
  { id: "zanahoria", name: "Zanahoria", cat: "verduras", base: "unit", tags: ["verdura", "basico"],
    n: [41, 0.9, 9.6, 0.2, 2.8], gpu: 90, discrete: true, fresh: true, shelf: 21,
    packs: [[1, "unit"], [500, "g", "libra"], [1, "kg", "1 kg"]], syn: ["zanahorias"] },
  { id: "ahuyama", name: "Ahuyama", cat: "verduras", base: "g", tags: ["verdura"],
    n: [26, 1, 6.5, 0.1, 0.5], fresh: true, shelf: 14, step: 50,
    packs: [[500, "g", "libra"], [1, "kg", "1 kg"]], syn: ["auyama", "calabaza", "zapallo"] },
  { id: "habichuela", name: "Habichuela", cat: "verduras", base: "g", tags: ["verdura"],
    n: [31, 1.8, 7, 0.2, 3.4], fresh: true, shelf: 7, step: 25,
    packs: [[250, "g"], [500, "g", "libra"]], syn: ["habichuelas"] },
  { id: "repollo", name: "Repollo", cat: "verduras", base: "g", tags: ["verdura"],
    n: [25, 1.3, 5.8, 0.1, 2.5], fresh: true, shelf: 14, step: 50,
    packs: [[500, "g", "medio repollo"], [1, "kg", "repollo entero"]], syn: ["col"] },
  { id: "lechuga", name: "Lechuga", cat: "verduras", base: "unit", tags: ["verdura"],
    n: [15, 1.4, 2.9, 0.2, 1.3], gpu: 300, discrete: true, fresh: true, shelf: 6,
    packs: [[1, "unit"]], syn: ["lechugas"] },
  { id: "pimenton", name: "Pimentón", cat: "verduras", base: "unit", tags: ["verdura"],
    n: [31, 1, 6, 0.3, 2.1], gpu: 120, discrete: true, fresh: true, shelf: 10,
    packs: [[1, "unit"], [500, "g", "libra"]], syn: ["pimenton rojo", "pimiento"] },
  { id: "ajo", name: "Ajo", cat: "verduras", base: "unit", tags: ["condimento"],
    n: [149, 6.4, 33, 0.5, 2.1], gpu: 5, discrete: true, fresh: true, shelf: 60,
    packs: [[1, "unit", "diente"], [12, "unit", "cabeza"]], syn: ["dientes de ajo", "ajos"] },
  { id: "cilantro", name: "Cilantro", cat: "verduras", base: "g", tags: ["condimento"],
    n: [23, 2.1, 3.7, 0.5, 2.8], fresh: true, shelf: 5, step: 5,
    packs: [[50, "g", "manojo"]], syn: ["cilantros"] },
  { id: "espinaca", name: "Espinaca", cat: "verduras", base: "g", tags: ["verdura"],
    n: [23, 2.9, 3.6, 0.4, 2.2], fresh: true, shelf: 5, step: 25,
    packs: [[250, "g", "manojo"]], syn: ["espinacas"] },
  { id: "brocoli", name: "Brócoli", cat: "verduras", base: "g", tags: ["verdura"],
    n: [34, 2.8, 6.6, 0.4, 2.6], fresh: true, shelf: 7, step: 50,
    packs: [[500, "g", "libra"]], syn: ["brocolis"] },
  { id: "arveja_verde", name: "Arveja verde", cat: "verduras", base: "g", tags: ["verdura", "proteina_vegetal"],
    n: [81, 5.4, 14, 0.4, 5.1], fresh: true, shelf: 7, step: 25,
    packs: [[250, "g"], [500, "g", "libra"]], syn: ["arvejas", "arveja"] },
  { id: "remolacha", name: "Remolacha", cat: "verduras", base: "unit", tags: ["verdura"],
    n: [43, 1.6, 9.6, 0.2, 2.8], gpu: 130, discrete: true, fresh: true, shelf: 14,
    packs: [[1, "unit"], [500, "g", "libra"]], syn: ["remolachas"] },
  { id: "pepino", name: "Pepino", cat: "verduras", base: "unit", tags: ["verdura"],
    n: [15, 0.7, 3.6, 0.1, 0.5], gpu: 200, discrete: true, fresh: true, shelf: 7,
    packs: [[1, "unit"]], syn: ["pepinos", "pepino cohombro"] },

  // ------------------------------------------------------------------ frutas
  { id: "banano", name: "Banano", cat: "frutas", base: "unit", tags: ["fruta"],
    n: [89, 1.1, 22.8, 0.3, 2.6], gpu: 120, discrete: true, fresh: true, shelf: 6,
    packs: [[1, "unit"], [6, "unit", "racimo x6"], [1, "kg", "1 kg"]], syn: ["bananos", "guineo"] },
  { id: "aguacate", name: "Aguacate", cat: "frutas", base: "unit", tags: ["fruta", "grasa"],
    n: [160, 2, 8.5, 14.7, 6.7], gpu: 250, discrete: true, fresh: true, shelf: 5,
    packs: [[1, "unit"]], syn: ["aguacates"] },
  { id: "naranja", name: "Naranja", cat: "frutas", base: "unit", tags: ["fruta"],
    n: [47, 0.9, 11.8, 0.1, 2.4], gpu: 180, discrete: true, fresh: true, shelf: 14,
    packs: [[1, "unit"], [1, "kg", "1 kg"]], syn: ["naranjas"] },
  { id: "mango", name: "Mango", cat: "frutas", base: "unit", tags: ["fruta"],
    n: [60, 0.8, 15, 0.4, 1.6], gpu: 250, discrete: true, fresh: true, shelf: 6,
    packs: [[1, "unit"], [1, "kg", "1 kg"]], syn: ["mangos"] },
  { id: "papaya", name: "Papaya", cat: "frutas", base: "g", tags: ["fruta"],
    n: [43, 0.5, 11, 0.3, 1.7], fresh: true, shelf: 5, step: 50,
    packs: [[1000, "g", "papaya mediana"]], syn: ["papayas"] },
  { id: "guayaba", name: "Guayaba", cat: "frutas", base: "unit", tags: ["fruta"],
    n: [68, 2.6, 14, 1, 5.4], gpu: 90, discrete: true, fresh: true, shelf: 5,
    packs: [[1, "unit"], [500, "g", "libra"]], syn: ["guayabas"] },
  { id: "limon", name: "Limón", cat: "frutas", base: "unit", tags: ["fruta", "condimento"],
    n: [29, 1.1, 9.3, 0.3, 2.8], gpu: 60, discrete: true, fresh: true, shelf: 14,
    packs: [[1, "unit"], [500, "g", "libra"]], syn: ["limones"] },
  { id: "maracuya", name: "Maracuyá", cat: "frutas", base: "unit", tags: ["fruta"],
    n: [97, 2.2, 23, 0.7, 10.4], gpu: 90, discrete: true, fresh: true, shelf: 10,
    packs: [[1, "unit"], [500, "g", "libra"]], syn: ["maracuyas"] },
  { id: "mora", name: "Mora", cat: "frutas", base: "g", tags: ["fruta"],
    n: [43, 1.4, 9.6, 0.5, 5.3], fresh: true, shelf: 4, step: 50,
    packs: [[500, "g", "libra"]], syn: ["moras"] },
  { id: "pina", name: "Piña", cat: "frutas", base: "g", tags: ["fruta"],
    n: [50, 0.5, 13, 0.1, 1.4], fresh: true, shelf: 6, step: 100,
    packs: [[1500, "g", "piña entera"]], syn: ["pina", "piñas"] },

  // ------------------------------------------------------- lácteos y huevos
  { id: "huevo", name: "Huevo", cat: "lacteos", base: "unit", tags: ["proteina", "basico"],
    n: [143, 12.6, 0.7, 9.5, 0], gpu: 50, discrete: true, fresh: true, shelf: 21,
    packs: [[1, "unit"], [12, "unit", "panal x12"], [30, "unit", "panal x30"]],
    subs: ["pollo_pechuga"], syn: ["huevos"] },
  { id: "leche_entera", name: "Leche entera", cat: "lacteos", base: "ml", tags: ["lacteo", "basico"],
    n: [61, 3.2, 4.8, 3.3, 0], gpml: 1.03, fresh: true, shelf: 5, step: 50,
    packs: [[1000, "ml", "bolsa 1 litro"]], syn: ["leche"] },
  { id: "queso_campesino", name: "Queso campesino", cat: "lacteos", base: "g", tags: ["lacteo", "proteina"],
    n: [250, 18, 3, 19, 0], fresh: true, shelf: 8, step: 25,
    packs: [[250, "g", "bloque 250 g"], [500, "g", "bloque 500 g"]],
    subs: ["queso_costeno"], syn: ["queso"] },
  { id: "queso_costeno", name: "Queso costeño", cat: "lacteos", base: "g", tags: ["lacteo", "proteina"],
    n: [290, 20, 2, 22, 0], fresh: true, shelf: 12, step: 25,
    packs: [[250, "g", "bloque 250 g"]], subs: ["queso_campesino"], syn: ["queso salado"] },
  { id: "yogurt", name: "Yogurt", cat: "lacteos", base: "ml", tags: ["lacteo"],
    n: [61, 3.5, 4.7, 3.3, 0], gpml: 1.03, fresh: true, shelf: 14, step: 50,
    packs: [[1000, "ml", "bolsa 1 litro"]], syn: ["yogur"] },
  { id: "kumis", name: "Kumis", cat: "lacteos", base: "ml", tags: ["lacteo"],
    n: [60, 3.3, 5, 3.1, 0], gpml: 1.03, fresh: true, shelf: 12, step: 50,
    packs: [[1000, "ml", "bolsa 1 litro"]], subs: ["yogurt"] },
  { id: "mantequilla", name: "Mantequilla", cat: "lacteos", base: "g", tags: ["grasa"],
    n: [717, 0.9, 0.1, 81, 0], fresh: true, shelf: 60, step: 5,
    packs: [[125, "g", "barra 125 g"]], subs: ["aceite_girasol"] },

  // --------------------------------------------------------------- abarrotes
  { id: "aceite_girasol", name: "Aceite de girasol", cat: "abarrotes", base: "ml", tags: ["grasa", "basico"],
    n: [884, 0, 0, 100, 0], gpml: 0.92, step: 5,
    packs: [[1000, "ml", "botella 1 litro"]], syn: ["aceite"] },
  { id: "azucar", name: "Azúcar", cat: "abarrotes", base: "g", tags: ["basico"],
    n: [387, 0, 100, 0, 0], step: 5, packs: [[1, "kg", "bolsa 1 kg"]], subs: ["panela"] },
  { id: "panela", name: "Panela", cat: "abarrotes", base: "g", tags: ["basico"],
    n: [350, 0.5, 90, 0, 0], step: 25, packs: [[500, "g", "panela"]], subs: ["azucar"] },
  { id: "chocolate_mesa", name: "Chocolate de mesa", cat: "abarrotes", base: "g", tags: ["basico"],
    n: [500, 6, 55, 30, 5], step: 25, packs: [[250, "g", "caja 250 g"]],
    syn: ["chocolate", "pastilla de chocolate"] },
  { id: "cafe", name: "Café molido", cat: "abarrotes", base: "g", tags: ["basico"],
    n: [2, 0.1, 0.3, 0, 0], step: 5, packs: [[250, "g", "bolsa 250 g"], [500, "g", "bolsa 500 g"]],
    syn: ["cafe"] },
  { id: "salsa_tomate", name: "Salsa de tomate", cat: "abarrotes", base: "g", tags: ["condimento"],
    n: [92, 1.3, 21, 0.2, 1.3], step: 10, packs: [[200, "g", "bolsa 200 g"]] },

  // ------------------------------------------------------------- condimentos
  { id: "sal", name: "Sal", cat: "condimentos", base: "g", tags: ["condimento", "basico"],
    n: [0, 0, 0, 0, 0], step: 1, packs: [[500, "g", "bolsa 500 g"]] },
  { id: "pimienta", name: "Pimienta", cat: "condimentos", base: "g", tags: ["condimento"],
    n: [251, 10, 64, 3.3, 25], step: 1, packs: [[20, "g", "sobre 20 g"]] },
  { id: "comino", name: "Comino", cat: "condimentos", base: "g", tags: ["condimento"],
    n: [375, 18, 44, 22, 11], step: 1, packs: [[20, "g", "sobre 20 g"]] },
  { id: "color_azafran", name: "Color (azafrán)", cat: "condimentos", base: "g", tags: ["condimento"],
    n: [310, 11, 65, 6, 4], step: 1, packs: [[20, "g", "sobre 20 g"]],
    syn: ["color", "azafran", "triguisar"] },
  { id: "oregano", name: "Orégano", cat: "condimentos", base: "g", tags: ["condimento"],
    n: [265, 9, 69, 4.3, 43], step: 1, packs: [[20, "g", "sobre 20 g"]] },
  { id: "laurel", name: "Laurel", cat: "condimentos", base: "unit", tags: ["condimento"],
    n: [313, 7.6, 75, 8.4, 26], gpu: 0.2, discrete: true, packs: [[20, "unit", "sobre"]],
    syn: ["hojas de laurel"] },

  // ------------------------------------- ampliación: variedad de cocinas
  // Todo lo de abajo se consigue en plaza o supermercado en Colombia. La idea
  // no es "comida internacional": es poder cocinar un salteado, un curry o una
  // pasta sin salir del mercado de la esquina.
  { id: "champinones", name: "Champiñones", cat: "verduras", base: "g", tags: ["verdura"],
    n: [22, 3.1, 3.3, 0.3, 1], fresh: true, shelf: 5, step: 25,
    packs: [[250, "g", "bandeja 250 g"]], syn: ["champinon", "hongos", "setas"] },
  { id: "calabacin", name: "Calabacín", cat: "verduras", base: "g", tags: ["verdura"],
    n: [17, 1.2, 3.1, 0.3, 1], fresh: true, shelf: 7, step: 50,
    packs: [[500, "g", "libra"]], syn: ["zucchini", "calabacines"] },
  { id: "berenjena", name: "Berenjena", cat: "verduras", base: "unit", tags: ["verdura"],
    n: [25, 1, 6, 0.2, 3], gpu: 250, discrete: true, fresh: true, shelf: 7,
    packs: [[1, "unit"]], syn: ["berenjenas"] },
  { id: "apio", name: "Apio", cat: "verduras", base: "g", tags: ["verdura"],
    n: [16, 0.7, 3, 0.2, 1.6], fresh: true, shelf: 10, step: 25,
    packs: [[250, "g", "manojo"]] },
  { id: "maiz_tierno", name: "Mazorca", cat: "verduras", base: "unit", tags: ["verdura", "grano"],
    n: [86, 3.3, 19, 1.2, 2.7], gpu: 200, discrete: true, fresh: true, shelf: 5,
    packs: [[1, "unit"], [3, "unit", "x3"]], syn: ["maiz tierno", "choclo", "mazorcas"] },
  { id: "arracacha", name: "Arracacha", cat: "verduras", base: "g", tags: ["tuberculo"],
    n: [100, 1, 24, 0.2, 2], fresh: true, shelf: 10, step: 50,
    packs: [[500, "g", "libra"], [1, "kg", "1 kg"]], subs: ["papa_pastusa", "yuca"] },
  { id: "jengibre", name: "Jengibre", cat: "condimentos", base: "g", tags: ["condimento"],
    n: [80, 1.8, 18, 0.8, 2], fresh: true, shelf: 21, step: 5,
    packs: [[100, "g"]] },
  { id: "quinua", name: "Quinua", cat: "granos", base: "g", tags: ["grano", "proteina_vegetal"],
    n: [368, 14, 64, 6, 7], step: 25, packs: [[500, "g", "bolsa 500 g"]],
    subs: ["arroz_blanco"], syn: ["quinoa"] },
  { id: "pasta_corta", name: "Pasta corta", cat: "granos", base: "g", tags: ["grano"],
    n: [371, 13, 75, 1.5, 3.2], step: 25,
    packs: [[250, "g", "paquete 250 g"], [500, "g", "paquete 500 g"]],
    subs: ["pasta_espagueti"], syn: ["macarrones", "tornillos", "coditos"] },
  { id: "tortilla_trigo", name: "Tortilla de trigo", cat: "granos", base: "unit", tags: ["grano"],
    n: [306, 8, 51, 7.5, 3], gpu: 45, discrete: true, shelf: 20,
    packs: [[10, "unit", "paquete x10"]], subs: ["arepa"], syn: ["tortillas", "wrap"] },
  { id: "soya_texturizada", name: "Soya texturizada", cat: "proteinas", base: "g",
    tags: ["proteina_vegetal"], n: [330, 50, 30, 1.5, 18], step: 25,
    packs: [[250, "g"], [500, "g", "bolsa 500 g"]],
    subs: ["lenteja", "carne_molida"], syn: ["carne de soya", "soya"] },
  { id: "sardina_lata", name: "Sardinas en lata", cat: "proteinas", base: "g", tags: ["proteina"],
    n: [208, 25, 0, 11, 0], step: 10, packs: [[155, "g", "lata 155 g"]],
    subs: ["atun_lata"], syn: ["sardina"] },
  { id: "jamon", name: "Jamón", cat: "proteinas", base: "g", tags: ["proteina"],
    n: [145, 18, 1.5, 7, 0], fresh: true, shelf: 10, step: 25,
    packs: [[250, "g", "paquete 250 g"]], syn: ["jamones"] },
  { id: "crema_leche", name: "Crema de leche", cat: "lacteos", base: "ml", tags: ["lacteo", "grasa"],
    n: [292, 2.5, 3, 30, 0], gpml: 1, fresh: true, shelf: 10, step: 25,
    packs: [[200, "ml", "caja 200 ml"]] },
  { id: "queso_mozzarella", name: "Queso mozzarella", cat: "lacteos", base: "g",
    tags: ["lacteo", "proteina"], n: [280, 22, 2, 21, 0], fresh: true, shelf: 12, step: 25,
    packs: [[250, "g"], [500, "g", "bloque 500 g"]], subs: ["queso_campesino"],
    syn: ["mozarella", "queso para pizza"] },
  { id: "mani", name: "Maní", cat: "abarrotes", base: "g", tags: ["proteina_vegetal", "grasa"],
    n: [567, 26, 16, 49, 8.5], step: 10, packs: [[250, "g"], [500, "g", "bolsa 500 g"]],
    syn: ["cacahuate", "manies"] },
  { id: "leche_coco", name: "Leche de coco", cat: "abarrotes", base: "ml", tags: ["grasa"],
    n: [197, 2, 3, 21, 0], gpml: 1, step: 25, packs: [[400, "ml", "lata 400 ml"]] },
  { id: "bocadillo", name: "Bocadillo de guayaba", cat: "abarrotes", base: "g", tags: ["basico"],
    n: [280, 0.5, 70, 0.1, 2], step: 25, packs: [[250, "g"], [500, "g", "caja"]],
    syn: ["bocadillos", "dulce de guayaba"] },
  { id: "lulo", name: "Lulo", cat: "frutas", base: "unit", tags: ["fruta"],
    n: [26, 0.6, 6, 0.1, 1], gpu: 100, discrete: true, fresh: true, shelf: 7,
    packs: [[1, "unit"], [500, "g", "libra"]], syn: ["lulos", "naranjilla"] },
  { id: "salsa_soya", name: "Salsa de soya", cat: "abarrotes", base: "ml", tags: ["condimento"],
    n: [53, 8, 5, 0.1, 0], gpml: 1.1, step: 5, packs: [[250, "ml", "botella 250 ml"]],
    syn: ["soya", "salsa china"] },
  { id: "vinagre", name: "Vinagre", cat: "abarrotes", base: "ml", tags: ["condimento"],
    n: [18, 0, 0.9, 0, 0], gpml: 1, step: 5, packs: [[500, "ml", "botella 500 ml"]] },
  { id: "mostaza", name: "Mostaza", cat: "abarrotes", base: "g", tags: ["condimento"],
    n: [66, 4, 5, 4, 3], step: 5, packs: [[200, "g", "frasco 200 g"]] },
  { id: "mayonesa", name: "Mayonesa", cat: "abarrotes", base: "g", tags: ["grasa"],
    n: [680, 1, 1, 75, 0], step: 5, packs: [[400, "g", "frasco 400 g"]] },
  { id: "curry_polvo", name: "Curry en polvo", cat: "condimentos", base: "g", tags: ["condimento"],
    n: [325, 14, 56, 14, 33], step: 1, packs: [[20, "g", "sobre 20 g"]],
    syn: ["curry"] },
  { id: "paprika", name: "Paprika", cat: "condimentos", base: "g", tags: ["condimento"],
    n: [282, 14, 54, 13, 35], step: 1, packs: [[20, "g", "sobre 20 g"]],
    syn: ["pimenton en polvo"] },
  { id: "canela", name: "Canela", cat: "condimentos", base: "g", tags: ["condimento"],
    n: [247, 4, 81, 1.2, 53], step: 1, packs: [[20, "g", "sobre 20 g"]] },
  { id: "aji_picante", name: "Ají picante", cat: "condimentos", base: "g", tags: ["condimento"],
    n: [40, 1.9, 9, 0.4, 1.5], fresh: true, shelf: 14, step: 5,
    packs: [[100, "g"]], syn: ["aji", "picante", "chile"] },
];


export const INGREDIENTS: Ingredient[] = SPECS.map(build);

export const INGREDIENT_BY_ID: ReadonlyMap<string, Ingredient> = new Map(
  INGREDIENTS.map((ingredient) => [ingredient.id, ingredient]),
);
