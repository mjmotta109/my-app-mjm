"""
Extrae de un volcado CSV de USDA FoodData Central los cinco nutrientes que usa
Rinde: energía, proteína, grasa, carbohidratos y fibra, por 100 g.

Por qué existe y cómo se usa: ver .github/workflows/tablas-nutricion.yml.

Reglas:
  - Los identificadores de nutriente NO se escriben a mano. Se buscan por NOMBRE
    y UNIDAD en nutrient.csv del propio volcado; si alguno no aparece, el script
    falla en vez de adivinar.
  - Un alimento sin energía se descarta y se cuenta. No se rellena con cero.
  - Se registra qué variante de energía se usó en cada fila, porque Foundation
    Foods no siempre trae "Energy" y a veces solo trae las de Atwater.

Uso: python3 extraer_fdc.py <carpeta_del_csv> <salida.csv> <etiqueta>
"""

import csv
import sys
from pathlib import Path

csv.field_size_limit(10**9)

carpeta, salida, etiqueta = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]


def buscar(nombre: str) -> Path:
    hallados = list(carpeta.rglob(nombre))
    if not hallados:
        sys.exit(f"ERROR: no hay {nombre} dentro de {carpeta}")
    return hallados[0]


# ------------------------------------------------------------ nutrientes
nutrientes = {}
with buscar("nutrient.csv").open(newline="", encoding="utf-8") as f:
    for fila in csv.DictReader(f):
        nutrientes[fila["id"]] = (fila["name"].strip(), fila["unit_name"].strip().upper())

def id_de(nombre: str, unidad: str):
    for nid, (n, u) in nutrientes.items():
        if n == nombre and u == unidad:
            return nid
    return None

ENERGIAS = [  # en orden de preferencia
    ("Energy", "KCAL"),
    ("Energy (Atwater Specific Factors)", "KCAL"),
    ("Energy (Atwater General Factors)", "KCAL"),
]
energia_ids = {id_de(n, u): n for n, u in ENERGIAS if id_de(n, u)}
if not energia_ids:
    sys.exit("ERROR: ningún nutriente de energía en kcal en nutrient.csv")

OTROS = {
    "protein_g": ("Protein", "G"),
    "fat_g": ("Total lipid (fat)", "G"),
    "carbs_g": ("Carbohydrate, by difference", "G"),
    "fiber_g": ("Fiber, total dietary", "G"),
}
otros_ids = {}
for clave, (n, u) in OTROS.items():
    nid = id_de(n, u)
    if nid is None:
        sys.exit(f"ERROR: no aparece el nutriente '{n}' ({u}) en nutrient.csv")
    otros_ids[nid] = clave

print(f"[{etiqueta}] energía: {energia_ids}")
print(f"[{etiqueta}] otros:   {otros_ids}")

# ------------------------------------------------------------ categorías
categorias = {}
cat = list(carpeta.rglob("food_category.csv"))
if cat:
    with cat[0].open(newline="", encoding="utf-8") as f:
        for fila in csv.DictReader(f):
            categorias[fila["id"]] = fila["description"]

# ------------------------------------------------------------ alimentos
alimentos = {}
with buscar("food.csv").open(newline="", encoding="utf-8") as f:
    for fila in csv.DictReader(f):
        alimentos[fila["fdc_id"]] = {
            "description": fila["description"],
            "category": categorias.get(fila.get("food_category_id", ""), ""),
            "data_type": fila.get("data_type", ""),
        }

# ------------------------------------------------------------ valores
valores = {}
with buscar("food_nutrient.csv").open(newline="", encoding="utf-8") as f:
    for fila in csv.DictReader(f):
        fid, nid, cantidad = fila["fdc_id"], fila["nutrient_id"], fila["amount"]
        if fid not in alimentos or cantidad in ("", None):
            continue
        destino = valores.setdefault(fid, {})
        if nid in energia_ids:
            # Se guarda la de mayor preferencia disponible.
            actual = destino.get("_energia_rango")
            rango = [n for n, _ in ENERGIAS].index(energia_ids[nid])
            if actual is None or rango < actual:
                destino["kcal"] = float(cantidad)
                destino["energy_basis"] = energia_ids[nid]
                destino["_energia_rango"] = rango
        elif nid in otros_ids:
            destino[otros_ids[nid]] = float(cantidad)

# ------------------------------------------------------------ salida
sin_energia = 0
filas = 0
with salida.open("w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["fdc_id", "data_type", "description", "category",
                "kcal", "protein_g", "fat_g", "carbs_g", "fiber_g", "energy_basis"])
    for fid in sorted(alimentos, key=int):
        v = valores.get(fid, {})
        if "kcal" not in v:
            sin_energia += 1
            continue
        a = alimentos[fid]
        # Un dato ausente queda VACÍO, no en cero.
        w.writerow([fid, a["data_type"], a["description"], a["category"],
                    v["kcal"], v.get("protein_g", ""), v.get("fat_g", ""),
                    v.get("carbs_g", ""), v.get("fiber_g", ""), v["energy_basis"]])
        filas += 1

print(f"[{etiqueta}] {filas} alimentos escritos; {sin_energia} descartados por no traer energía")
if filas == 0:
    sys.exit("ERROR: no se escribió ningún alimento")
