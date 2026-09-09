/**
 * Freemium (§28 del brief) — solo la preparación.
 *
 * NO hay pagos, ni SDK de facturación, ni pantallas de compra. Este módulo
 * existe para que las pantallas pregunten aquí en vez de esparcir condicionales
 * por toda la aplicación. Conectar Google Play Billing después significa
 * implementar algo que devuelva el `tier`; nada más cambia.
 */

export type Tier = "free" | "premium";

export type Feature =
  | "plan_semanal"
  | "plan_mensual"
  | "inventario_basico"
  | "recetas"
  | "presupuesto_basico"
  | "optimizacion_avanzada"
  | "precios_semanales"
  | "comparar_supermercados"
  | "nutricion_avanzada"
  | "historial"
  | "planes_familiares"
  | "recomendaciones_avanzadas";

const FREE_FEATURES: readonly Feature[] = [
  "plan_semanal",
  "inventario_basico",
  "recetas",
  "presupuesto_basico",
];

export function can(feature: Feature, tier: Tier): boolean {
  if (tier === "premium") return true;
  return FREE_FEATURES.includes(feature);
}

/** Días máximos de plan según el nivel. El MVP no bloquea nada todavía. */
export function maxPlanDays(tier: Tier): number {
  return tier === "premium" ? 31 : 7;
}

export const FEATURE_LABELS: Record<Feature, string> = {
  plan_semanal: "Planificación semanal",
  plan_mensual: "Planificación mensual",
  inventario_basico: "Inventario básico",
  recetas: "Recetas",
  presupuesto_basico: "Presupuesto básico",
  optimizacion_avanzada: "Optimización avanzada",
  precios_semanales: "Precios actualizados semanalmente",
  comparar_supermercados: "Comparación de supermercados",
  nutricion_avanzada: "Nutrición avanzada",
  historial: "Historial",
  planes_familiares: "Planes familiares",
  recomendaciones_avanzadas: "Recomendaciones avanzadas",
};
