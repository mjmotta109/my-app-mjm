/**
 * Lector de CSV mínimo pero correcto: soporta comillas dobles, comas dentro
 * de campos entrecomillados, comillas escapadas (`""`) y saltos CRLF.
 * No se añade una dependencia externa para esto.
 */

export class CsvError extends Error {
  override readonly name = "CsvError";
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const pushField = (): void => {
    row.push(field);
    field = "";
  };
  const pushRow = (): void => {
    pushField();
    // Una línea totalmente vacía no es una fila.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const char = text[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += char;
      i++;
      continue;
    }
    if (char === '"') {
      if (field !== "") throw new CsvError(`Comilla inesperada en la posición ${i}`);
      inQuotes = true;
      i++;
      continue;
    }
    if (char === ",") {
      pushField();
      i++;
      continue;
    }
    if (char === "\r") {
      i++;
      continue;
    }
    if (char === "\n") {
      pushRow();
      i++;
      continue;
    }
    field += char;
    i++;
  }

  if (inQuotes) throw new CsvError("El archivo termina con una comilla sin cerrar");
  if (field !== "" || row.length > 0) pushRow();
  return rows;
}

/** Convierte un CSV con encabezado en objetos, respetando el orden de columnas. */
export function parseCsvRecords(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0]!.map((cell) => cell.trim());
  const out: Record<string, string>[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!;
    const record: Record<string, string> = {};
    header.forEach((key, index) => {
      record[key] = (row[index] ?? "").trim();
    });
    out.push(record);
  }
  return out;
}
