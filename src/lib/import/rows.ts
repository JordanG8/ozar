export const maxImportRows = 2000;
export const maxImportBytes = 3_500_000;
export const maxImportColumns = 32;
export const maxImportFileBytes = 5_000_000;
export const fieldLimits = { term: 180, definition: 300, example: 500 };

export type ImportWord = { term: string; definition: string; example: string | null };
export type Mapping = { term: number; definition: number; example: number };

const fields = ["term", "definition", "example"] as const;
const headers = {
  term: ["מילה", "המילה", "מונח", "מילים", "ביטוי", "word", "term", "vocabulary", "headword"],
  definition: ["משמעות", "הגדרה", "פירוש", "הסבר", "definition", "meaning", "translation"],
  example: ["דוגמה", "משפט", "משפט לדוגמה", "example", "sample sentence", "sentence"],
};

export function detectColumns(row: string[], width: number) {
  const normalized = row.map((cell) => cell.normalize("NFC").toLowerCase().trim());
  const detected = fields.map((field) => normalized.findIndex((cell) => headers[field].includes(cell)));
  const header = detected.some((index) => index >= 0);
  const used = new Set(detected.filter((index) => index >= 0));
  const mapped = [...detected];
  for (let field = 0; field < 2; field++) {
    if (mapped[field] >= 0) continue;
    const column = Array.from({ length: width }, (_, column) => column).find((column) => !used.has(column));
    if (column !== undefined) {
      mapped[field] = column;
      used.add(column);
    }
  }
  const example = header ? mapped[2] : width >= 3 ? 2 : -1;
  return { mapping: { term: mapped[0], definition: mapped[1], example }, header };
}

export function acceptedFromDefinition(definition: string) {
  return [...new Set(definition.split(/[,;\u061B]/u).map((meaning) => meaning.trim()).filter((meaning) => /[\p{L}\p{N}]/u.test(meaning)))];
}

export function cleanImportWord(value: unknown): ImportWord | null {
  if (!value || typeof value !== "object" || !("term" in value) || !("definition" in value)) return null;
  if (typeof value.term !== "string" || typeof value.definition !== "string" ||
    ("example" in value && value.example !== null && typeof value.example !== "string")) return null;
  const term = value.term.normalize("NFC").trim();
  const definition = value.definition.normalize("NFC").trim();
  const example = ("example" in value && typeof value.example === "string" ? value.example.normalize("NFC").trim() : "") || null;
  if (!term || term.length > fieldLimits.term || !definition || definition.length > fieldLimits.definition ||
    (example?.length ?? 0) > fieldLimits.example || !acceptedFromDefinition(definition).length ||
    [term, definition, example].some((value) => value?.includes("\u0000"))) return null;
  return { term, definition, example };
}

export function previewRows(rows: { number: number; cells: string[] }[], mapping: Mapping, header: boolean) {
  const seen = new Set<string>();
  return rows.slice(Number(header)).map(({ cells, number }) => {
    const term = cells[mapping.term]?.trim() ?? "";
    const definition = cells[mapping.definition]?.trim() ?? "";
    const example = cells[mapping.example]?.trim() ?? "";
    const word = cleanImportWord({ term, definition, example });
    const key = word && JSON.stringify([word.term, word.definition]);
    const duplicate = key && seen.has(key);
    if (key) seen.add(key);
    const error = !term ? "חסרה מילה" : !definition ? "חסרה הגדרה"
      : !word ? "תוכן לא תקין או ארוך מדי" : duplicate ? "שורה כפולה" : null;
    return { number, term, definition, example, word: error ? null : word, error };
  });
}
