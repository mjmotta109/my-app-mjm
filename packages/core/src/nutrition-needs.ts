import type {
  ActivityLevel, Household, MealSlot, NutritionGoal, PersonProfile, PortionBasis, Sex,
} from "./types.js";
import { round } from "./units.js";

/**
 * Necesidades energéticas estimadas según el estado físico (anexo de nutrición).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  RINDE NO ES UNA HERRAMIENTA MÉDICA NI DIETÉTICA.
 *
 *  Todo lo que calcula este módulo es una ESTIMACIÓN a partir de ecuaciones
 *  poblacionales. Una ecuación poblacional describe promedios, no personas: dos
 *  cuerpos con el mismo peso, estatura y edad pueden gastar energías bastante
 *  distintas. Estos números sirven para dimensionar cuánta comida comprar, no
 *  para prescribir una dieta.
 *
 *  Ver `docs/NUTRICION.md` para las fuentes, los supuestos y los límites.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Determinismo: como todo `@rinde/core`, sin reloj y sin aleatoriedad.
 */

// ---------------------------------------------------------------------------
// Constantes, con su procedencia
// ---------------------------------------------------------------------------

/**
 * Ecuación de **Mifflin-St Jeor** (1990) para el gasto energético en reposo.
 *
 * Forma simplificada por sexo, que es la de uso corriente:
 *   hombres:  10·peso(kg) + 6,25·estatura(cm) − 5·edad(años) + 5
 *   mujeres:  10·peso(kg) + 6,25·estatura(cm) − 5·edad(años) − 161
 *
 * La publicación original expresa una sola regresión con coeficientes 9,99 /
 * 6,25 / 4,92 y un término de sexo; los propios autores señalaron que
 * redondear y separar por sexo no cambia el valor predictivo.
 *
 * Verificar contra la fuente primaria antes de usar esto para algo clínico:
 * Mifflin MD, St Jeor ST, et al., *American Journal of Clinical Nutrition*, 1990.
 */
export const MIFFLIN_ST_JEOR = {
  weightCoefficient: 10,
  heightCoefficient: 6.25,
  ageCoefficient: 5,
  maleConstant: 5,
  femaleConstant: -161,
} as const;

/**
 * Factores de actividad física (PAL) de uso convencional para multiplicar el
 * gasto en reposo. Son valores de manual ampliamente citados, no medidos para
 * esta población concreta.
 */
export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentario: 1.2,
  ligero: 1.375,
  moderado: 1.55,
  alto: 1.725,
  muy_alto: 1.9,
};

export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentario: "Sedentario — trabajo de escritorio, poco movimiento",
  ligero: "Ligero — camina a diario o se ejercita 1–3 días por semana",
  moderado: "Moderado — se ejercita 3–5 días por semana",
  alto: "Alto — se ejercita 6–7 días por semana o trabajo físico",
  muy_alto: "Muy alto — trabajo físico pesado o doble entrenamiento",
};

/**
 * Ajuste calórico por objetivo, en fracción del gasto total.
 *
 * Son márgenes moderados y convencionales, deliberadamente conservadores. Un
 * déficit agresivo no es cosa que una aplicación de presupuesto de mercado deba
 * proponerle a nadie por su cuenta.
 */
export const GOAL_ADJUSTMENT: Record<NutritionGoal, number> = {
  mantener: 0,
  bajar_peso: -0.15,
  subir_peso: 0.1,
  masa_muscular: 0.05,
};

/**
 * Tope absoluto del déficit, además del porcentaje.
 *
 * Con un gasto alto, el 15% pasa de 500 kcal. Rinde se queda por debajo de esa
 * cifra por decisión propia y conservadora: no es una recomendación clínica, es
 * el límite de lo que una app de mercado propone sin que nadie la supervise.
 */
export const MAX_DEFICIT_KCAL = 500;

/**
 * IMC por debajo del cual la clasificación de la OMS habla de bajo peso. Con
 * un IMC así, Rinde no aplica déficit aunque se pida.
 */
export const BMI_UNDERWEIGHT = 18.5;

/** Por debajo de esta edad no se aplica déficit: crecer no es bajar de peso. */
export const MIN_AGE_FOR_DEFICIT = 18;

export const GOAL_LABELS: Record<NutritionGoal, string> = {
  mantener: "Mantener el peso",
  bajar_peso: "Bajar de peso",
  subir_peso: "Subir de peso",
  masa_muscular: "Ganar masa muscular",
};

/**
 * Gramos de proteína por kilo de peso corporal al día.
 *
 * - `0,8 g/kg` es la RDA para personas adultas sedentarias. Es un **umbral de
 *   deficiencia**, no un objetivo de optimización.
 * - Los rangos altos (1,4–2,2 g/kg) provienen de la literatura de nutrición
 *   deportiva para quien entrena de forma regular.
 *
 * Ver `docs/NUTRICION.md`.
 */
export const PROTEIN_G_PER_KG: Record<ActivityLevel, { min: number; target: number; max: number }> = {
  sedentario: { min: 0.8, target: 1.0, max: 1.2 },
  ligero: { min: 1.0, target: 1.2, max: 1.4 },
  moderado: { min: 1.2, target: 1.4, max: 1.6 },
  alto: { min: 1.4, target: 1.6, max: 2.0 },
  muy_alto: { min: 1.6, target: 1.8, max: 2.2 },
};

/** Con objetivo de masa muscular se apunta al extremo alto del rango. */
export const MUSCLE_PROTEIN_BONUS = 0.2;

/**
 * Pisos calóricos por debajo de los cuales Rinde deja de recortar y avisa.
 *
 * Son cifras prudentes de uso común como límite inferior para adultos sin
 * supervisión profesional. No son una recomendación: son un tope de seguridad
 * para que la aplicación nunca proponga por su cuenta un plan más bajo.
 */
export const KCAL_FLOOR: Record<Sex, number> = {
  femenino: 1200,
  masculino: 1500,
  sin_especificar: 1200,
};

/** Fibra diaria de referencia para adultos, en gramos. Valor genérico. */
export const FIBER_TARGET_G = 25;

/**
 * Referencia genérica cuando no hay perfil físico. Es lo que Rinde usa si el
 * usuario no quiere dar peso, estatura ni edad — que es el camino por defecto.
 */
export const GENERIC_ADULT = { kcal: 2000, proteinG: 55, fiberG: FIBER_TARGET_G } as const;

/** Fracción de la porción de un adulto que se asume para un niño. */
export const CHILD_ENERGY_FACTOR = 0.7;

// ---------------------------------------------------------------------------
// Cálculo
// ---------------------------------------------------------------------------

export interface ProteinRange {
  minG: number;
  targetG: number;
  maxG: number;
}

export interface EnergyNeeds {
  /** Gasto en reposo. `null` si faltan datos para calcularlo. */
  bmrKcal: number | null;
  /** Gasto total con actividad. `null` si no hay `bmrKcal`. */
  tdeeKcal: number | null;
  /** Meta diaria tras aplicar el objetivo. Nunca por debajo del piso. */
  targetKcal: number;
  proteinG: ProteinRange;
  fiberG: number;
  /** `true` si `targetKcal` viene de la referencia genérica, no del perfil. */
  usedGenericReference: boolean;
  /** Datos que faltaron para poder calcular con la ecuación. */
  missing: string[];
  /** Avisos que la interfaz DEBE mostrar. */
  warnings: string[];
  /** Explicación en una línea de en qué se basó el número. */
  basis: string;
  /**
   * El objetivo que de verdad se aplicó. Puede no coincidir con el pedido:
   * bajar de peso se convierte en mantener cuando no es seguro proponerlo.
   */
  appliedGoal: NutritionGoal;
  /** Por qué no se aplicó el objetivo pedido, si no se aplicó. */
  goalNotApplied?: string;
  /** Índice de masa corporal, si hay peso y estatura. */
  bmi: number | null;
}

/** Gasto energético en reposo. `null` si falta peso, estatura o edad. */
export function restingEnergy(profile: PersonProfile): number | null {
  const { weightKg, heightCm, ageYears } = profile;
  if (!weightKg || !heightCm || !ageYears) return null;
  if (weightKg <= 0 || heightCm <= 0 || ageYears <= 0) return null;

  const base =
    MIFFLIN_ST_JEOR.weightCoefficient * weightKg +
    MIFFLIN_ST_JEOR.heightCoefficient * heightCm -
    MIFFLIN_ST_JEOR.ageCoefficient * ageYears;

  // Sin sexo declarado se toma el promedio de las dos constantes, y se avisa:
  // es una aproximación, no un dato.
  const constant =
    profile.sex === "masculino"
      ? MIFFLIN_ST_JEOR.maleConstant
      : profile.sex === "femenino"
        ? MIFFLIN_ST_JEOR.femaleConstant
        : (MIFFLIN_ST_JEOR.maleConstant + MIFFLIN_ST_JEOR.femaleConstant) / 2;

  return Math.round(base + constant);
}

/** IMC = peso / estatura². `null` si falta alguno. */
export function bodyMassIndex(profile: PersonProfile): number | null {
  const { weightKg, heightCm } = profile;
  if (!weightKg || !heightCm || weightKg <= 0 || heightCm <= 0) return null;
  const metros = heightCm / 100;
  return round(weightKg / (metros * metros), 1);
}

/**
 * ¿Es seguro que Rinde, por su cuenta, proponga un déficit a esta persona?
 * Devuelve el motivo si NO lo es. Todas son razones para no hacerlo, nunca
 * para hacerlo más fuerte.
 */
export function deficitBlockedReason(profile: PersonProfile): string | null {
  if (profile.kind === "nino") {
    return "Rinde no aplica déficit a niños: en crecimiento, comer menos no es bajar de peso.";
  }
  if (profile.ageYears !== undefined && profile.ageYears < MIN_AGE_FOR_DEFICIT) {
    return `Rinde no aplica déficit a menores de ${MIN_AGE_FOR_DEFICIT} años.`;
  }
  if (profile.flags?.includes("embarazo") || profile.flags?.includes("lactancia")) {
    return "Durante el embarazo o la lactancia Rinde no aplica déficit.";
  }
  if (profile.flags?.includes("condicion_medica")) {
    return "Con una condición médica registrada, Rinde no aplica déficit por su cuenta.";
  }
  const imc = bodyMassIndex(profile);
  if (imc !== null && imc < BMI_UNDERWEIGHT) {
    return (
      `Con un IMC de ${imc.toLocaleString("es-CO")} (por debajo de ${BMI_UNDERWEIGHT.toLocaleString("es-CO")}) ` +
      "Rinde no aplica déficit."
    );
  }
  return null;
}

export function personEnergyNeeds(profile: PersonProfile): EnergyNeeds {
  const missing: string[] = [];
  const warnings: string[] = [];

  if (!profile.weightKg) missing.push("peso");
  if (!profile.heightCm) missing.push("estatura");
  if (!profile.ageYears) missing.push("edad");

  if (profile.flags?.includes("embarazo") || profile.flags?.includes("lactancia")) {
    warnings.push(
      "Durante el embarazo y la lactancia las necesidades cambian de forma que Rinde no estima. " +
        "Consulta con un profesional de la salud.",
    );
  }
  if (profile.flags?.includes("condicion_medica")) {
    warnings.push(
      "Registraste una condición médica. Estas estimaciones no la tienen en cuenta; " +
        "sigue las indicaciones de tu profesional de salud.",
    );
  }

  // Mifflin-St Jeor se derivó con personas adultas. Aplicarla a un niño daría
  // un número con apariencia de precisión y sin respaldo, así que para niños se
  // usa siempre la referencia, aunque haya peso y estatura.
  const bmrKcal = profile.kind === "nino" ? null : restingEnergy(profile);
  const bmi = bodyMassIndex(profile);

  // Sin datos suficientes: referencia genérica, dicho en voz alta.
  if (bmrKcal === null) {
    const pedido = profile.goal;
    const sinObjetivo =
      pedido === "mantener"
        ? undefined
        : `Para "${GOAL_LABELS[pedido]}" hacen falta peso, estatura y edad. Sin ellos Rinde ` +
          "usa la referencia de mantenimiento.";
    if (sinObjetivo) warnings.push(sinObjetivo);
    const childScale = profile.kind === "nino" ? CHILD_ENERGY_FACTOR : 1;
    return {
      bmrKcal: null,
      tdeeKcal: null,
      targetKcal: Math.round(GENERIC_ADULT.kcal * childScale),
      proteinG: {
        minG: round(GENERIC_ADULT.proteinG * childScale, 0),
        targetG: round(GENERIC_ADULT.proteinG * childScale, 0),
        maxG: round(GENERIC_ADULT.proteinG * childScale * 1.5, 0),
      },
      fiberG: Math.round(FIBER_TARGET_G * childScale),
      usedGenericReference: true,
      missing,
      warnings,
      basis:
        `Referencia genérica (${GENERIC_ADULT.kcal} kcal para una persona adulta). ` +
        `Faltan datos: ${missing.join(", ")}.`,
      appliedGoal: "mantener",
      ...(sinObjetivo ? { goalNotApplied: sinObjetivo } : {}),
      bmi,
    };
  }

  if (profile.sex === "sin_especificar") {
    warnings.push(
      "Sin sexo declarado, la estimación usa un punto medio entre las dos constantes de la " +
        "ecuación. El resultado es más aproximado.",
    );
  }

  const tdeeKcal = Math.round(bmrKcal * ACTIVITY_FACTORS[profile.activity]);

  let appliedGoal: NutritionGoal = profile.goal;
  let goalNotApplied: string | undefined;
  if (profile.goal === "bajar_peso") {
    const bloqueo = deficitBlockedReason(profile);
    if (bloqueo) {
      appliedGoal = "mantener";
      goalNotApplied = `${bloqueo} Se calcula para mantener el peso.`;
      warnings.push(goalNotApplied);
    }
  }

  let ajuste = Math.round(tdeeKcal * GOAL_ADJUSTMENT[appliedGoal]);
  if (appliedGoal === "bajar_peso") ajuste = Math.max(ajuste, -MAX_DEFICIT_KCAL);
  const adjusted = tdeeKcal + ajuste;
  const floor = KCAL_FLOOR[profile.sex];

  let targetKcal = adjusted;
  if (profile.kind === "adulto" && adjusted < floor) {
    targetKcal = floor;
    warnings.push(
      `El objetivo elegido daría menos de ${floor} kcal al día. Rinde no baja de ahí por su ` +
        "cuenta: si necesitas un déficit mayor, háblalo con un profesional de la salud.",
    );
  }

  const range = PROTEIN_G_PER_KG[profile.activity];
  const bonus = profile.goal === "masa_muscular" ? MUSCLE_PROTEIN_BONUS : 0;
  const weight = profile.weightKg!;

  return {
    bmrKcal,
    tdeeKcal,
    targetKcal,
    proteinG: {
      minG: Math.round(range.min * weight),
      targetG: Math.round((range.target + bonus) * weight),
      maxG: Math.round((range.max + bonus) * weight),
    },
    fiberG: FIBER_TARGET_G,
    usedGenericReference: false,
    missing,
    warnings,
    basis:
      `Mifflin-St Jeor: ${bmrKcal} kcal en reposo × ${ACTIVITY_FACTORS[profile.activity]} ` +
      `(${profile.activity}) = ${tdeeKcal} kcal` +
      (ajuste === 0
        ? `, para "${GOAL_LABELS[appliedGoal]}".`
        : `, ${ajuste > 0 ? "+" : "−"}${Math.abs(ajuste)} kcal para "${GOAL_LABELS[appliedGoal]}".`),
    appliedGoal,
    ...(goalNotApplied ? { goalNotApplied } : {}),
    bmi,
  };
}

export interface HouseholdNeeds {
  /** Meta diaria del hogar completo. */
  kcal: number;
  proteinG: ProteinRange;
  fiberG: number;
  perPerson: { profileId: string; name?: string; needs: EnergyNeeds }[];
  /** `true` si algún miembro cayó en la referencia genérica. */
  anyGeneric: boolean;
  warnings: string[];
}

/**
 * Necesidades del hogar completo.
 *
 * Si no hay perfiles físicos, se usa la referencia genérica escalada por
 * `adults` y `children`. Esa es la ruta por defecto: Rinde no obliga a nadie a
 * dar su peso para poder planificar.
 */
export function householdNeeds(household: Household): HouseholdNeeds {
  const profiles = household.nutritionProfiles ?? [];

  if (profiles.length === 0) {
    const eaters = household.adults + household.children * CHILD_ENERGY_FACTOR;
    return {
      kcal: Math.round(GENERIC_ADULT.kcal * eaters),
      proteinG: {
        minG: Math.round(GENERIC_ADULT.proteinG * eaters),
        targetG: Math.round(GENERIC_ADULT.proteinG * eaters),
        maxG: Math.round(GENERIC_ADULT.proteinG * eaters * 1.5),
      },
      fiberG: Math.round(FIBER_TARGET_G * eaters),
      perPerson: [],
      anyGeneric: true,
      warnings: [
        "Metas basadas en una referencia genérica de 2.000 kcal por persona adulta. " +
          "Puedes afinarlas en Perfil → Estado físico.",
      ],
    };
  }

  // Se cuentan como mucho tantos perfiles como personas haya de cada tipo, y
  // quien no tiene perfil entra con la referencia genérica. Antes solo se
  // sumaban los perfiles: un hogar de dos adultos con un solo perfil tenía una
  // "meta del hogar" de una persona, y de esa cifra salen los pisos de cada
  // comida.
  const adultos = profiles.filter((p) => p.kind === "adulto").slice(0, household.adults);
  const ninos = profiles.filter((p) => p.kind === "nino").slice(0, household.children);
  const perPerson = [...adultos, ...ninos].map((profile) => ({
    profileId: profile.id,
    ...(profile.name ? { name: profile.name } : {}),
    needs: personEnergyNeeds(profile),
  }));

  const faltanAdultos = Math.max(0, household.adults - adultos.length);
  const faltanNinos = Math.max(0, household.children - ninos.length);
  const sinPerfil = faltanAdultos + faltanNinos * CHILD_ENERGY_FACTOR;

  const warnings = [...new Set(perPerson.flatMap((entry) => entry.needs.warnings))];
  if (sinPerfil > 0) {
    warnings.push(
      `${faltanAdultos + faltanNinos} persona(s) del hogar sin perfil físico se cuentan con la ` +
        "referencia genérica.",
    );
  }

  return {
    kcal: Math.round(
      perPerson.reduce((total, entry) => total + entry.needs.targetKcal, 0) +
        GENERIC_ADULT.kcal * sinPerfil,
    ),
    proteinG: {
      minG: Math.round(perPerson.reduce((t, e) => t + e.needs.proteinG.minG, 0) + GENERIC_ADULT.proteinG * sinPerfil),
      targetG: Math.round(perPerson.reduce((t, e) => t + e.needs.proteinG.targetG, 0) + GENERIC_ADULT.proteinG * sinPerfil),
      maxG: Math.round(perPerson.reduce((t, e) => t + e.needs.proteinG.maxG, 0) + GENERIC_ADULT.proteinG * 1.5 * sinPerfil),
    },
    fiberG: Math.round(perPerson.reduce((total, entry) => total + entry.needs.fiberG, 0) + FIBER_TARGET_G * sinPerfil),
    perPerson,
    anyGeneric: sinPerfil > 0 || perPerson.some((entry) => entry.needs.usedGenericReference),
    warnings,
  };
}

/** Reparte la meta diaria del hogar entre las comidas activas del día. */
export function perMealTargets(
  needs: HouseholdNeeds,
  slotsPerDay: number,
): { kcal: number; proteinG: number } {
  const slots = Math.max(1, slotsPerDay);
  return {
    kcal: Math.round(needs.kcal / slots),
    proteinG: Math.round(needs.proteinG.targetG / slots),
  };
}

export const NUTRITION_DISCLAIMER_SHORT =
  "Estimación con ecuaciones poblacionales. Rinde no es una herramienta médica ni dietética.";

// ---------------------------------------------------------------------------
// Piso nutricional por comida
// ---------------------------------------------------------------------------

/**
 * Fracción MÍNIMA de la meta diaria que cada horario debe aportar.
 *
 * Esto es lo que impide que "controlar el dinero" se traduzca en desayunar una
 * arepa con mantequilla. El planificador optimiza presupuesto; sin un piso, la
 * forma más barata de cumplir el presupuesto es dar de comer menos.
 *
 * Son mínimos, no objetivos: suman 0,68 y dejan margen para que el resto del
 * día lo llenen las comidas que el hogar sí quiere. Y son deliberadamente
 * alcanzables — un piso que ninguna receta cumple no protege a nadie, solo
 * vacía el menú.
 */
export const MEAL_MIN_SHARE: Record<MealSlot, { kcal: number; protein: number }> = {
  desayuno: { kcal: 0.18, protein: 0.16 },
  almuerzo: { kcal: 0.28, protein: 0.3 },
  cena: { kcal: 0.22, protein: 0.24 },
  // Un snack es un snack: no tiene que sostener nada.
  snack: { kcal: 0, protein: 0 },
};

/**
 * Cómo se reparte la energía del día entre horarios.
 *
 * No en tercios iguales: un desayuno no es un tercio de lo que se come en el
 * día. Repartir por igual empuja al planificador a elegir siempre el desayuno
 * más grande del catálogo, y la variedad se desploma.
 *
 * Se normaliza sobre los horarios que el hogar tenga activos, así que un hogar
 * que solo planifica almuerzo recibe ahí el 100%.
 */
export const MEAL_TARGET_SHARE: Record<MealSlot, number> = {
  desayuno: 0.25,
  almuerzo: 0.4,
  cena: 0.3,
  snack: 0.08,
};

/** Meta de energía y proteína de un horario concreto, para el hogar completo. */
export function mealTarget(
  needs: HouseholdNeeds,
  slot: MealSlot,
  activeSlots: readonly MealSlot[],
): { kcal: number; proteinG: number } {
  const total = activeSlots.reduce((sum, entry) => sum + MEAL_TARGET_SHARE[entry], 0);
  const share = total > 0 ? MEAL_TARGET_SHARE[slot] / total : 1;
  return {
    kcal: Math.round(needs.kcal * share),
    proteinG: Math.round(needs.proteinG.targetG * share),
  };
}

export interface MealFloor {
  kcal: number;
  proteinG: number;
}

/** Piso absoluto de un horario, para el hogar completo. */
export function mealFloor(needs: HouseholdNeeds, slot: MealSlot): MealFloor {
  const share = MEAL_MIN_SHARE[slot];
  return {
    kcal: Math.round(needs.kcal * share.kcal),
    proteinG: Math.round(needs.proteinG.targetG * share.protein),
  };
}

// ---------------------------------------------------------------------------
// Porciones según necesidades
// ---------------------------------------------------------------------------

export interface PortionSizing {
  basis: PortionBasis;
  /** Raciones de adulto de referencia que se cocinan en cada comida. */
  eaters: number;
  /** Las que habría con porciones estándar. */
  standardEaters: number;
  perPerson: {
    profileId: string;
    name?: string;
    /** Fracción de una ración de adulto de referencia. */
    share: number;
    appliedGoal: NutritionGoal;
  }[];
  warnings: string[];
}

/**
 * Cuántas raciones se cocinan en cada comida.
 *
 * Con `estandar` (el defecto) salen de `adults` y `children`, como siempre.
 *
 * Con `necesidades`, cada persona pesa lo que su energía estimada frente a la
 * referencia de 2.000 kcal: quien necesita 1.700 come 0,85 de una ración, quien
 * necesita 2.600 come 1,3. Así "mantener el peso" y "bajar de peso" cambian de
 * verdad lo que se compra, que es la única forma de que el objetivo tenga algo
 * que ver con el presupuesto.
 *
 * Lo que NO hace:
 *   - Para niños no usa la ecuación de adultos: usa siempre su factor.
 *   - A quien no tiene perfil le deja la ración estándar, no una inventada.
 *   - No baja de los pisos calóricos: eso ya lo garantiza `personEnergyNeeds`.
 */
export function portionSizing(
  household: Household,
  childFactor: number = CHILD_ENERGY_FACTOR,
): PortionSizing {
  const standardEaters = household.adults + household.children * childFactor;
  const basis: PortionBasis = household.portionBasis ?? "estandar";
  const profiles = household.nutritionProfiles ?? [];

  if (basis !== "necesidades" || profiles.length === 0) {
    return {
      basis: "estandar",
      eaters: standardEaters,
      standardEaters,
      perPerson: [],
      warnings:
        basis === "necesidades"
          ? ["Para ajustar las porciones a cada persona hace falta su perfil físico. Se usan porciones estándar."]
          : [],
    };
  }

  const warnings: string[] = [];
  const adultos = profiles.filter((p) => p.kind === "adulto").slice(0, household.adults);
  const ninos = profiles.filter((p) => p.kind === "nino").slice(0, household.children);
  const sobrantes = profiles.length - adultos.length - ninos.length;
  if (sobrantes > 0) {
    warnings.push(
      `Hay ${sobrantes} perfil(es) de más frente a las personas del hogar; no se cuentan.`,
    );
  }

  const perPerson: PortionSizing["perPerson"] = [];
  for (const perfil of adultos) {
    const needs = personEnergyNeeds(perfil);
    perPerson.push({
      profileId: perfil.id,
      ...(perfil.name ? { name: perfil.name } : {}),
      share: round(needs.targetKcal / GENERIC_ADULT.kcal, 3),
      appliedGoal: needs.appliedGoal,
    });
  }
  for (const perfil of ninos) {
    perPerson.push({
      profileId: perfil.id,
      ...(perfil.name ? { name: perfil.name } : {}),
      share: childFactor,
      appliedGoal: "mantener",
    });
  }

  const sinPerfil =
    (household.adults - adultos.length) + (household.children - ninos.length) * childFactor;
  if (household.adults - adultos.length > 0 || household.children - ninos.length > 0) {
    warnings.push("Las personas sin perfil físico reciben la porción estándar.");
  }

  const eaters = round(perPerson.reduce((t, p) => t + p.share, 0) + sinPerfil, 3);
  return { basis: "necesidades", eaters, standardEaters, perPerson, warnings };
}
