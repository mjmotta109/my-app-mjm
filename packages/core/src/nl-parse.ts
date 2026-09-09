import type { Ingredient, Unit } from "./types.js";
import { toBase } from "./units.js";

/**
 * Interpretación de texto libre en español (§23 del brief).
 *
 * "Tengo un poquito de pollo, unas papas y tres tomates"
 *   → [pollo (cantidad desconocida), papa (cantidad desconocida), tomate ×3]
 *
 * DOS DECISIONES DELIBERADAS:
 *
 * 1. Este parser es **determinista**, no un LLM. Reconoce números, unidades y
 *    nombres de ingredientes con reglas. Un LLM podría entender más frases,
 *    pero el brief prohíbe que la IA decida cantidades — así que la salida de
 *    un LLM tendría que pasar por esta misma validación de todos modos.
 *
 * 2. Una cantidad vaga ("un poquito", "unas") NO se convierte en un número
 *    inventado. Se devuelve `qtyBase: null` con `needsConfirmation: true` y
 *    la interfaz le pregunta al usuario. Adivinar que "un poquito de pollo"
 *    son 200 g contaminaría todo el presupuesto con un dato falso.
 *
 * Para conectar un LLM más adelante: que produzca `ParsedItem[]` y se pase por
 * `validateParsedItems`. El motor no cambia.
 */

export interface ParsedItem {
  ingredientId: string;
  /** Cantidad en la unidad base del ingrediente. `null` si el texto fue vago. */
  qtyBase: number | null;
  /** Lo que el usuario escribió literalmente para este ítem. */
  rawText: string;
  confidence: "high" | "medium" | "low";
  needsConfirmation: boolean;
}

export interface ParseResult {
  items: ParsedItem[];
  /** Fragmentos que no se pudieron asociar a ningún ingrediente. */
  unrecognized: string[];
}

const NUMBER_WORDS: Record<string, number> = {
  un: 1, una: 1, uno: 1,
  dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8,
  nueve: 9, diez: 10, once: 11, doce: 12, quince: 15, veinte: 20,
  treinta: 30, media: 0.5, medio: 0.5,
};

/** Expresiones que indican cantidad sin decir cuánta. */
const VAGUE_WORDS = [
  "poquito", "poco", "poca", "algo", "algunos", "algunas", "unos", "unas",
  "varios", "varias", "tantico", "harto", "harta", "bastante", "resto",
];

/** Unidades como las escribe la gente en Colombia. */
const UNIT_WORDS: Record<string, { unit: Unit; factor: number }> = {
  g: { unit: "g", factor: 1 },
  gr: { unit: "g", factor: 1 },
  gramo: { unit: "g", factor: 1 },
  gramos: { unit: "g", factor: 1 },
  kg: { unit: "kg", factor: 1 },
  kilo: { unit: "kg", factor: 1 },
  kilos: { unit: "kg", factor: 1 },
  kilogramo: { unit: "kg", factor: 1 },
  kilogramos: { unit: "kg", factor: 1 },
  libra: { unit: "g", factor: 500 },
  libras: { unit: "g", factor: 500 },
  ml: { unit: "ml", factor: 1 },
  l: { unit: "l", factor: 1 },
  litro: { unit: "l", factor: 1 },
  litros: { unit: "l", factor: 1 },
  taza: { unit: "taza", factor: 1 },
  tazas: { unit: "taza", factor: 1 },
  cucharada: { unit: "cda", factor: 1 },
  cucharadas: { unit: "cda", factor: 1 },
  cucharadita: { unit: "cdta", factor: 1 },
  cucharaditas: { unit: "cdta", factor: 1 },
  unidad: { unit: "unit", factor: 1 },
  unidades: { unit: "unit", factor: 1 },
};

/** Quita tildes y pasa a minúsculas para comparar sin sorpresas. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Índice de búsqueda: nombre del ingrediente + sinónimos, normalizados. */
export function buildLexicon(catalog: ReadonlyMap<string, Ingredient>): Map<string, string> {
  const lexicon = new Map<string, string>();
  for (const ingredient of catalog.values()) {
    for (const term of [ingredient.name, ...(ingredient.synonyms ?? [])]) {
      const key = normalizeText(term);
      if (key) lexicon.set(key, ingredient.id);
      // Plural ingenuo: "tomates" → "tomate". Solo se añade si no colisiona.
      if (key.endsWith("s") && !lexicon.has(key.slice(0, -1))) {
        lexicon.set(key.slice(0, -1), ingredient.id);
      }
      if (!key.endsWith("s") && !lexicon.has(`${key}s`)) {
        lexicon.set(`${key}s`, ingredient.id);
      }
      if (!key.endsWith("es") && !lexicon.has(`${key}es`)) {
        lexicon.set(`${key}es`, ingredient.id);
      }
    }
  }
  return lexicon;
}

export function parsePantryText(
  text: string,
  catalog: ReadonlyMap<string, Ingredient>,
  lexicon: ReadonlyMap<string, string> = buildLexicon(catalog),
): ParseResult {
  const items: ParsedItem[] = [];
  const unrecognized: string[] = [];
  const seen = new Set<string>();

  const fragments = normalizeText(text)
    .split(/,| y | e |;|\n|\+/g)
    .map((fragment) => fragment.trim())
    .filter(Boolean);

  for (const fragment of fragments) {
    const parsed = parseFragment(fragment, catalog, lexicon);
    if (!parsed) {
      unrecognized.push(fragment);
      continue;
    }
    // Si el mismo ingrediente aparece dos veces, se suma lo que sea numérico.
    if (seen.has(parsed.ingredientId)) {
      const existing = items.find((item) => item.ingredientId === parsed.ingredientId)!;
      if (existing.qtyBase !== null && parsed.qtyBase !== null) {
        existing.qtyBase += parsed.qtyBase;
      } else {
        existing.qtyBase = null;
        existing.needsConfirmation = true;
        existing.confidence = "low";
      }
      existing.rawText = `${existing.rawText}; ${parsed.rawText}`;
      continue;
    }
    seen.add(parsed.ingredientId);
    items.push(parsed);
  }

  return { items, unrecognized };
}

function parseFragment(
  fragment: string,
  catalog: ReadonlyMap<string, Ingredient>,
  lexicon: ReadonlyMap<string, string>,
): ParsedItem | null {
  const words = fragment.split(" ").filter(Boolean);
  const ingredientId = matchIngredient(words, lexicon);
  if (!ingredientId) return null;
  const ingredient = catalog.get(ingredientId);
  if (!ingredient) return null;

  const isVague = words.some((word) => VAGUE_WORDS.includes(word));
  const amount = extractAmount(words);

  if (amount === null || isVague) {
    return {
      ingredientId,
      qtyBase: null,
      rawText: fragment,
      confidence: isVague ? "low" : "medium",
      needsConfirmation: true,
    };
  }

  let qtyBase: number;
  try {
    qtyBase = toBase(amount.qty * amount.factor, amount.unit, ingredient);
  } catch {
    // La unidad no se puede convertir para este ingrediente: se pregunta.
    return {
      ingredientId,
      qtyBase: null,
      rawText: fragment,
      confidence: "low",
      needsConfirmation: true,
    };
  }

  return {
    ingredientId,
    qtyBase,
    rawText: fragment,
    confidence: amount.explicitUnit ? "high" : "medium",
    needsConfirmation: false,
  };
}

function matchIngredient(words: readonly string[], lexicon: ReadonlyMap<string, string>): string | null {
  // Se prueban primero las secuencias más largas: "pechuga de pollo" antes que "pollo".
  for (let size = Math.min(4, words.length); size >= 1; size--) {
    for (let start = 0; start + size <= words.length; start++) {
      const phrase = words.slice(start, start + size).join(" ");
      const match = lexicon.get(phrase);
      if (match) return match;
    }
  }
  return null;
}

interface Amount {
  qty: number;
  unit: Unit;
  factor: number;
  explicitUnit: boolean;
}

function extractAmount(words: readonly string[]): Amount | null {
  let qty: number | null = null;

  for (const word of words) {
    const numeric = Number(word.replace(",", "."));
    if (Number.isFinite(numeric) && word !== "") {
      qty = numeric;
      break;
    }
    const asWord = NUMBER_WORDS[word];
    if (asWord !== undefined) {
      qty = asWord;
      break;
    }
  }
  if (qty === null) return null;

  for (const word of words) {
    const unit = UNIT_WORDS[word];
    if (unit) return { qty, unit: unit.unit, factor: unit.factor, explicitUnit: true };
  }
  // Sin unidad explícita: se asume conteo ("tres tomates").
  return { qty, unit: "unit", factor: 1, explicitUnit: false };
}

/**
 * Valida ítems que vengan de cualquier origen, incluido un LLM.
 * Una cantidad no finita o negativa se convierte en "hay que confirmar", nunca
 * en un número que el motor pueda tomar por bueno.
 */
export function validateParsedItems(
  items: readonly ParsedItem[],
  catalog: ReadonlyMap<string, Ingredient>,
): ParsedItem[] {
  return items
    .filter((item) => catalog.has(item.ingredientId))
    .map((item) => {
      if (item.qtyBase === null) return item;
      if (!Number.isFinite(item.qtyBase) || item.qtyBase <= 0) {
        return { ...item, qtyBase: null, confidence: "low", needsConfirmation: true };
      }
      return item;
    });
}
