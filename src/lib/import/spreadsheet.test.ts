import { expect, it } from "vitest";
import * as XLSX from "xlsx";
import { previewRows } from "./rows";
import { readSpreadsheet } from "./spreadsheet";

it("reads a UTF-8 BOM CSV with reordered headers, quoted delimiters, and invalid rows", async () => {
  const csv = '\uFEFFהגדרה,דוגמה,מילה\r\n"חזק, יציב; עמיד","גשר איתן, גם בגשם.",איתן\r\n,,חסר\r\n,,\r\n' +
    '"חזק, יציב; עמיד",משפט אחר,איתן\r\n';
  const parsed = await readSpreadsheet(new TextEncoder().encode(csv).buffer, "practice.csv");
  expect(parsed.mapping).toEqual({ definition: 0, example: 1, term: 2 });
  expect(parsed.header).toBe(true);
  expect(previewRows(parsed.rows, parsed.mapping, parsed.header)).toMatchObject([
    { number: 2, word: { term: "איתן", definition: "חזק, יציב; עמיד", example: "גשר איתן, גם בגשם." }, error: null },
    { number: 3, word: null, error: "חסרה הגדרה" },
    { number: 5, word: null, error: "שורה כפולה" },
  ]);
});

it("reads an XLSX sheet with leading and internal blank rows and no header", async () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    [], ["סיכל", "מנע"], [], ["ניטרלי", "בלתי מעורב", "הוא נשאר ניטרלי."],
  ]), "עברית");
  const parsed = await readSpreadsheet(XLSX.write(book, { type: "array", bookType: "xlsx" }), "practice.xlsx");
  expect(parsed.header).toBe(false);
  expect(previewRows(parsed.rows, parsed.mapping, parsed.header)).toMatchObject([
    { number: 2, word: { term: "סיכל", definition: "מנע", example: null }, error: null },
    { number: 4, word: { term: "ניטרלי", definition: "בלתי מעורב", example: "הוא נשאר ניטרלי." }, error: null },
  ]);
});
