"""
Genera packages/data/src/nutrition-table.generated.ts a partir de:

  - packages/data/tablas/emparejamiento.csv   (qué ingrediente es qué alimento)
  - packages/data/tablas/usda/*.csv            (bajados por CI de la fuente oficial)

El emparejamiento se decidió a mano, ingrediente por ingrediente. Este script
no decide nada: solo copia los números de la fila elegida, para que no se
transcriban a mano y no puedan desalinearse. Una prueba lo vuelve a comprobar.

Uso: python3 scripts/tablas/generar_nutricion.py
"""

import csv
import json
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
TABLAS = RAIZ / "packages/data/tablas"
SALIDA = RAIZ / "packages/data/src/nutrition-table.generated.ts"

NOMBRE_TABLA = {
    "sr_legacy": "USDA FoodData Central — SR Legacy (2018-04)",
    "foundation": "USDA FoodData Central — Foundation Foods (2026-04)",
}

filas = {}
for clave in NOMBRE_TABLA:
    for r in csv.DictReader((TABLAS / "usda" / f"{clave}.csv").open(encoding="utf-8")):
        filas[(clave, r["fdc_id"])] = r


def numero(valor: str, decimales: int):
    return None if valor in ("", None) else round(float(valor), decimales)


emparejados, sin_equivalente = {}, {}
for e in csv.DictReader((TABLAS / "emparejamiento.csv").open(encoding="utf-8")):
    iid = e["ingrediente"]
    if e["coincidencia"] == "sin_equivalente":
        sin_equivalente[iid] = e["nota"]
        continue
    fila = filas.get((e["tabla"], e["fdc_id"]))
    if fila is None:
        raise SystemExit(f"ERROR: {iid} apunta a {e['tabla']} {e['fdc_id']}, que no está en la tabla")
    entrada = {
        "kcal": numero(fila["kcal"], 1),
        "proteinG": numero(fila["protein_g"], 2),
        "carbsG": numero(fila["carbs_g"], 2),
        "fatG": numero(fila["fat_g"], 2),
        "table": NOMBRE_TABLA[e["tabla"]],
        "fdcId": int(e["fdc_id"]),
        "description": fila["description"],
        "match": e["coincidencia"],
    }
    fibra = numero(fila["fiber_g"], 2)
    if fibra is not None:
        entrada["fiberG"] = fibra
    # La tabla deja vacío lo que no midió. Se respeta: vacío no es cero.
    for k in ("proteinG", "carbsG", "fatG"):
        if entrada[k] is None:
            raise SystemExit(f"ERROR: {iid}: la fila {e['fdc_id']} no trae {k}")
    if e["nota"]:
        entrada["note"] = e["nota"]
    emparejados[iid] = entrada

cuerpo = [
    "// GENERADO por scripts/tablas/generar_nutricion.py — no editar a mano.",
    "// Fuente: packages/data/tablas/emparejamiento.csv + packages/data/tablas/usda/*.csv",
    "// Procedencia y huellas SHA-256: packages/data/tablas/usda/FUENTE.md",
    "",
    "export interface TableNutrition {",
    "  /** Por 100 g de producto, tal como lo trae la tabla. */",
    "  kcal: number;",
    "  proteinG: number;",
    "  carbsG: number;",
    "  fatG: number;",
    "  /** Ausente si la tabla no lo midió. Ausente no es cero. */",
    "  fiberG?: number;",
    "  table: string;",
    "  fdcId: number;",
    "  /** Descripción del alimento en la tabla, textual. */",
    "  description: string;",
    "  /** `cercano`: no es el mismo producto, es el más parecido que trae la tabla. */",
    "  match: \"exacto\" | \"cercano\";",
    "  note?: string;",
    "}",
    "",
    "export const TABLE_NUTRITION: Readonly<Record<string, TableNutrition>> = "
    + json.dumps(emparejados, ensure_ascii=False, indent=2) + ";",
    "",
    "/** Ingredientes sin equivalente en la tabla, con el porqué. */",
    "export const TABLE_UNMATCHED: Readonly<Record<string, string>> = "
    + json.dumps(sin_equivalente, ensure_ascii=False, indent=2) + ";",
    "",
]
SALIDA.write_text("\n".join(cuerpo), encoding="utf-8")
print(f"{len(emparejados)} emparejados, {len(sin_equivalente)} sin equivalente → {SALIDA.relative_to(RAIZ)}")
