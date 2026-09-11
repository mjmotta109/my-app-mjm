import { useState } from "react";
import {
  ACTIVITY_LABELS, GOAL_LABELS, NUTRITION_DISCLAIMER_SHORT,
  householdNeeds, personEnergyNeeds,
} from "@rinde/core";
import type { ActivityLevel, NutritionGoal, PersonProfile, Sex } from "@rinde/core";
import { createProfile, useStore } from "../state/store.js";
import { Badge, Card, Empty, Header, Notice } from "../components/ui.js";

/**
 * Estado físico y necesidades nutricionales (anexo de nutrición).
 *
 * Dos cosas que esta pantalla tiene que dejar clarísimas:
 *
 *   1. **Es opcional.** Rinde planifica perfectamente sin saber el peso de
 *      nadie. Lo dice arriba, antes de pedir un solo dato.
 *   2. **No es consejo médico.** Son ecuaciones poblacionales; describen
 *      promedios, no personas.
 */
export function PhysicalProfile(): React.JSX.Element {
  const { state, dispatch } = useStore();
  const household = state.household;
  const [abierto, setAbierto] = useState<string | null>(null);

  if (!household) {
    return (
      <>
        <Header title="Estado físico" back />
        <main className="contenido"><Empty icon="⚙️" title="No hay hogar configurado" /></main>
      </>
    );
  }

  const perfiles = household.nutritionProfiles ?? [];
  const needs = householdNeeds(household);

  function guardar(perfiles: PersonProfile[]): void {
    dispatch({ type: "setNutritionProfiles", profiles: perfiles });
  }

  function actualizar(id: string, patch: Partial<PersonProfile>): void {
    guardar(perfiles.map((perfil) => (perfil.id === id ? { ...perfil, ...patch } : perfil)));
  }

  return (
    <>
      <Header title="Estado físico" eyebrow="Necesidades de tu hogar" back />
      <main className="contenido pila pila--lg">
        <Notice tone="info">
          <strong>Esto es opcional.</strong> Rinde arma tu plan sin saber tu peso ni tu edad. Si
          das estos datos, las metas de energía y proteína se ajustan a tu hogar en vez de usar
          una referencia genérica. Se guardan solo en este dispositivo.
        </Notice>

        {/* ------------------------------------------------------- resumen */}
        <Card tone="verde">
          <div className="etiqueta">Meta diaria del hogar</div>
          <div className="fila" style={{ gap: 10, alignItems: "baseline" }}>
            <span className="cifra cifra--xl">{needs.kcal.toLocaleString("es-CO")}</span>
            <span className="pequeno">kcal</span>
          </div>
          <div className="fila fila--entre" style={{ marginTop: 12 }}>
            <div>
              <div className="etiqueta">Proteína</div>
              <span className="cifra cifra--md">{needs.proteinG.targetG} g</span>
              <div className="diminuto tenue">
                rango {needs.proteinG.minG}–{needs.proteinG.maxG} g
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="etiqueta">Fibra</div>
              <span className="cifra cifra--md">{needs.fiberG} g</span>
            </div>
          </div>
          {needs.anyGeneric && (
            <div style={{ marginTop: 12 }}><Badge tone="estimado">Referencia genérica</Badge></div>
          )}
        </Card>

        {needs.warnings.map((warning) => (
          <Notice key={warning} tone="alerta">{warning}</Notice>
        ))}

        {/* ------------------------------------------------------ personas */}
        <section>
          <div className="grupo-titulo"><span>Personas</span></div>

          {perfiles.length === 0 ? (
            <Empty
              icon="🧍"
              title="Sin perfiles"
              description="Agrega a las personas del hogar para afinar las metas."
            />
          ) : (
            <div className="pila">
              {perfiles.map((perfil) => {
                const calc = personEnergyNeeds(perfil);
                const editando = abierto === perfil.id;
                return (
                  <Card key={perfil.id}>
                    <button
                      type="button"
                      className="fila fila--entre"
                      style={{ width: "100%", background: "none", border: "none", padding: 0, textAlign: "left" }}
                      onClick={() => setAbierto(editando ? null : perfil.id)}
                    >
                      <span className="crecer">
                        <strong>{perfil.name || (perfil.kind === "nino" ? "Niño" : "Adulto")}</strong>
                        <div className="pequeno tenue">
                          {calc.usedGenericReference
                            ? `Referencia genérica · faltan ${calc.missing.join(", ")}`
                            : `${calc.targetKcal} kcal · ${calc.proteinG.targetG} g de proteína`}
                        </div>
                      </span>
                      <span className="tenue" aria-hidden="true">{editando ? "▾" : "›"}</span>
                    </button>

                    {editando && (
                      <div className="pila" style={{ marginTop: 16 }}>
                        <div className="campo">
                          <label className="etiqueta" htmlFor={`nombre-${perfil.id}`}>Nombre (opcional)</label>
                          <input
                            id={`nombre-${perfil.id}`}
                            type="text"
                            value={perfil.name ?? ""}
                            onChange={(event) => actualizar(perfil.id, { name: event.target.value })}
                          />
                        </div>

                        <div className="campo">
                          <span className="etiqueta">Sexo</span>
                          <div className="chip-fila">
                            {(["femenino", "masculino", "sin_especificar"] as Sex[]).map((valor) => (
                              <button
                                key={valor}
                                type="button"
                                className={`chip ${perfil.sex === valor ? "chip--activo" : ""}`}
                                onClick={() => actualizar(perfil.id, { sex: valor })}
                              >
                                {valor === "sin_especificar" ? "Prefiero no decir" : valor === "femenino" ? "Femenino" : "Masculino"}
                              </button>
                            ))}
                          </div>
                          <p className="campo__ayuda">
                            La ecuación usa una constante distinta según el sexo. Si no lo dices,
                            se toma un punto medio y la estimación es más aproximada.
                          </p>
                        </div>

                        <div className="malla-3">
                          <Numero
                            label="Edad"
                            unidad="años"
                            value={perfil.ageYears}
                            onChange={(ageYears) => actualizar(perfil.id, { ageYears })}
                          />
                          <Numero
                            label="Peso"
                            unidad="kg"
                            value={perfil.weightKg}
                            onChange={(weightKg) => actualizar(perfil.id, { weightKg })}
                          />
                          <Numero
                            label="Estatura"
                            unidad="cm"
                            value={perfil.heightCm}
                            onChange={(heightCm) => actualizar(perfil.id, { heightCm })}
                          />
                        </div>

                        <div className="campo">
                          <span className="etiqueta">Actividad física</span>
                          <div className="pila" style={{ gap: 8 }}>
                            {(Object.keys(ACTIVITY_LABELS) as ActivityLevel[]).map((valor) => (
                              <button
                                key={valor}
                                type="button"
                                className={`opcion ${perfil.activity === valor ? "opcion--activa" : ""}`}
                                onClick={() => actualizar(perfil.id, { activity: valor })}
                              >
                                <span className="opcion__marca" aria-hidden="true">
                                  {perfil.activity === valor ? "✓" : ""}
                                </span>
                                <span className="crecer pequeno">{ACTIVITY_LABELS[valor]}</span>
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="campo">
                          <span className="etiqueta">Objetivo</span>
                          <div className="chip-fila" style={{ flexWrap: "wrap", overflowX: "visible" }}>
                            {(Object.keys(GOAL_LABELS) as NutritionGoal[]).map((valor) => (
                              <button
                                key={valor}
                                type="button"
                                className={`chip ${perfil.goal === valor ? "chip--activo" : ""}`}
                                onClick={() => actualizar(perfil.id, { goal: valor })}
                              >
                                {GOAL_LABELS[valor]}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="campo">
                          <span className="etiqueta">Situaciones que Rinde no estima</span>
                          <div className="chip-fila" style={{ flexWrap: "wrap", overflowX: "visible" }}>
                            {(["embarazo", "lactancia", "condicion_medica"] as const).map((flag) => {
                              const activo = perfil.flags?.includes(flag) ?? false;
                              return (
                                <button
                                  key={flag}
                                  type="button"
                                  className={`chip ${activo ? "chip--activo" : ""}`}
                                  onClick={() => {
                                    const actuales = new Set(perfil.flags ?? []);
                                    if (activo) actuales.delete(flag);
                                    else actuales.add(flag);
                                    actualizar(perfil.id, { flags: [...actuales] });
                                  }}
                                >
                                  {FLAG_LABELS[flag]}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {!calc.usedGenericReference && (
                          <Notice tone="info"><span className="pequeno">{calc.basis}</span></Notice>
                        )}

                        <button
                          type="button"
                          className="boton boton--peligro"
                          onClick={() => {
                            guardar(perfiles.filter((entry) => entry.id !== perfil.id));
                            setAbierto(null);
                          }}
                        >
                          Quitar esta persona
                        </button>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}

          <div className="fila" style={{ gap: 8, marginTop: 12 }}>
            <button
              type="button"
              className="boton boton--secundario"
              onClick={() => {
                const nuevo = createProfile("adulto");
                guardar([...perfiles, nuevo]);
                setAbierto(nuevo.id);
              }}
            >
              + Adulto
            </button>
            <button
              type="button"
              className="boton boton--secundario"
              onClick={() => {
                const nuevo = createProfile("nino");
                guardar([...perfiles, nuevo]);
                setAbierto(nuevo.id);
              }}
            >
              + Niño
            </button>
          </div>
        </section>

        <Notice tone="alerta">
          <strong>Rinde no es una herramienta médica ni dietética.</strong> {NUTRITION_DISCLAIMER_SHORT}{" "}
          Las ecuaciones describen promedios de población, no a una persona concreta. Si tienes
          una condición de salud, estás en embarazo o lactancia, o quieres un plan alimentario de
          verdad, habla con un profesional.
        </Notice>
      </main>
    </>
  );
}

function Numero({
  label, unidad, value, onChange,
}: {
  label: string;
  unidad: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
}): React.JSX.Element {
  return (
    <div className="campo">
      <label className="etiqueta" htmlFor={`n-${label}`}>{label}</label>
      <input
        id={`n-${label}`}
        type="number"
        inputMode="numeric"
        min={0}
        placeholder={unidad}
        value={value ?? ""}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === "") return onChange(undefined);
          const parsed = Number(raw);
          onChange(Number.isFinite(parsed) && parsed > 0 ? parsed : undefined);
        }}
      />
    </div>
  );
}

const FLAG_LABELS: Record<string, string> = {
  embarazo: "Embarazo",
  lactancia: "Lactancia",
  condicion_medica: "Condición médica",
};
