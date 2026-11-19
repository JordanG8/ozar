import { detectColumns, maxImportColumns, maxImportRows } from "./rows";

export async function readSpreadsheet(data: ArrayBuffer, filename: string) {
  const XLSX = await import("xlsx");
  const csv = /\.csv$/iu.test(filename);
  const bytes = new Uint8Array(data);
  if (!csv && (bytes[0] !== 0x50 || bytes[1] !== 0x4b)) throw new Error("invalid_xlsx");
  let input: ArrayBuffer | string = data;
  if (csv) {
    const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : null;
    try { input = new TextDecoder(utf16 ?? "utf-8", { fatal: true }).decode(data); }
    catch { input = new TextDecoder("windows-1255").decode(data); }
  }
  const book = XLSX.read(input, {
    type: typeof input === "string" ? "string" : "array",
    raw: true, sheets: 0, sheetRows: maxImportRows + 2, dense: true,
  });
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet?.["!ref"]) throw new Error("empty_sheet");
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const width = Math.min(range.e.c + 1, maxImportColumns);
  if (range.e.c >= maxImportColumns || (sheet["!fullref"] && XLSX.utils.decode_range(sheet["!fullref"]).e.r >= maxImportRows + 1)) {
    throw new Error("too_large");
  }
  const cells = XLSX.utils.sheet_to_json<(string | number | boolean)[]>(sheet, {
    header: 1, range: { s: { r: range.s.r, c: 0 }, e: { r: range.e.r, c: width - 1 } },
    blankrows: true, defval: "",
  });
  const rows = cells.map((row, index) => ({
    number: range.s.r + index + 1,
    cells: row.map((cell) => String(cell).trim()),
  })).filter((row) => row.cells.some(Boolean));
  if (!rows.length) throw new Error("empty_sheet");
  const detected = detectColumns(rows[0].cells, width);
  if (rows.length - Number(detected.header) > maxImportRows) throw new Error("too_large");
  return { rows, width, ...detected };
}
