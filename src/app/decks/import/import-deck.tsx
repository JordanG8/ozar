"use client";

import Link from "next/link";
import { useRef, useState, useSyncExternalStore, type ChangeEvent, type FormEvent } from "react";
import { maxImportBytes, maxImportFileBytes, previewRows, type Mapping } from "@/lib/import/rows";
import type { readSpreadsheet } from "@/lib/import/spreadsheet";
import styles from "../../manage.module.css";
import study from "../../learn/study.module.css";
import table from "./import-deck.module.css";

type Spreadsheet = Awaited<ReturnType<typeof readSpreadsheet>>;
const columns = { term: "מילה", definition: "הגדרה", example: "דוגמה" };
const pageSize = 25;
const columnName = (index: number) => index < 26 ? String.fromCharCode(65 + index) : `A${String.fromCharCode(65 + index - 26)}`;
const template = "data:text/csv;charset=utf-8," + encodeURIComponent("\uFEFFמילה,הגדרה,דוגמה\r\nאיתן,\"חזק, יציב\",הגשר נותר איתן גם בסערה.\r\n");
const subscribe = () => () => {};

export function ImportDeck() {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const [sheet, setSheet] = useState<Spreadsheet | null>(null);
  const [mapping, setMapping] = useState<Mapping>({ term: 0, definition: 1, example: -1 });
  const [header, setHeader] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [page, setPage] = useState(0);
  const [saved, setSaved] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);

  const rows = sheet ? previewRows(sheet.rows, mapping, header) : [];
  const entries = rows.flatMap(({ word }) => word ? [word] : []);
  const issues = rows.length - entries.length;
  const requiredColumns = [mapping.term, mapping.definition];
  const mapped = [...requiredColumns, ...(mapping.example < 0 ? [] : [mapping.example])];
  const validMapping = !requiredColumns.includes(-1) && new Set(mapped).size === mapped.length;
  const pages = Math.ceil(rows.length / pageSize);

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setSheet(null);
    setSaved(null);
    setError("");
    setPage(0);
    requestId.current = null;
    if (!file) return;
    if (!/\.(csv|xlsx)$/iu.test(file.name) || file.size > maxImportFileBytes) {
      setError("יש לבחור קובץ CSV או XLSX בגודל עד 5 מ״ב.");
      return;
    }
    setWorking(true);
    try {
      const { readSpreadsheet } = await import("@/lib/import/spreadsheet");
      const parsed = await readSpreadsheet(await file.arrayBuffer(), file.name);
      setSheet(parsed);
      setMapping(parsed.mapping);
      setHeader(parsed.header);
      setName(file.name.replace(/\.(csv|xlsx)$/iu, "").slice(0, 100));
    } catch (cause) {
      setError(cause instanceof Error && cause.message === "too_large"
        ? "אפשר לייבא עד 2,000 שורות ו־32 עמודות בקובץ אחד."
        : "לא נמצאו נתונים שאפשר לקרוא בגיליון הראשון.");
    } finally {
      setWorking(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validMapping || !entries.length || !name.trim() || working || saved) return;
    setWorking(true);
    setError("");
    try {
      requestId.current ??= crypto.randomUUID();
      const body = JSON.stringify({ id: requestId.current, name: name.trim(), rows: entries });
      if (new TextEncoder().encode(body).byteLength > maxImportBytes) {
        setError("תוכן החפיסה ארוך מדי לשליחה אחת. אפשר לפצל את הקובץ לשתי חפיסות.");
        return;
      }
      const response = await fetch("/api/decks", { method: "POST", headers: { "Content-Type": "application/json" }, body });
      if (response.status === 401) {
        setError("פג תוקף הכניסה. יש להתחבר מחדש.");
      } else if (!response.ok) {
        setError("שמירת החפיסה נכשלה. אפשר לנסות שוב.");
      } else {
        const result: { id: string } = await response.json();
        setSaved(result.id);
      }
    } catch {
      setError("החיבור נקטע. אפשר לנסות שוב.");
    } finally {
      setWorking(false);
    }
  }

  if (saved) return <div className={styles.form}>
    <p role="status">החפיסה ״{name.trim()}״ נשמרה עם {entries.length} מילים.</p>
    <Link className={study.primary} href={`/learn?deck=${saved}`}>ללימוד החפיסה</Link>
    <button type="button" className={study.secondary} onClick={() => {
      requestId.current = null;
      setSheet(null);
      setSaved(null);
      setName("");
    }}>ייבוא קובץ נוסף</button>
  </div>;

  return <form className={styles.form} onSubmit={save}>
    <p className={styles.muted}>בחרו קובץ CSV או XLSX. נתוני הגיליון הראשון יוצגו לפני השמירה.</p>
    <a className={styles.linkButton} href={template} download="ozar-template.csv">הורדת תבנית CSV</a>
    <label>קובץ מילים<input type="file" accept=".csv,.xlsx" disabled={!hydrated || working} onChange={(event) => void pick(event)} /></label>
    {sheet && <>
      <label>שם החפיסה<input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required disabled={working} /></label>
      <div className={table.mapping}>
        {(Object.keys(columns) as (keyof Mapping)[]).map((field) => <label key={field}>{columns[field]}
          <select value={mapping[field]} disabled={working} onChange={(event) => {
            setMapping({ ...mapping, [field]: Number(event.target.value) });
            setPage(0);
          }}>
            <option value={-1}>{field === "example" ? "ללא עמודה" : "בחירת עמודה"}</option>
            {Array.from({ length: sheet.width }, (_, index) => <option key={index} value={index}>
              {columnName(index)}{header && sheet.rows[0].cells[index] ? ` · ${sheet.rows[0].cells[index].slice(0, 45)}` : ""}
            </option>)}
          </select>
        </label>)}
      </div>
      <label className={table.header}><input type="checkbox" checked={header} disabled={working}
        onChange={(event) => { setHeader(event.target.checked); setPage(0); }} />השורה הראשונה מכילה כותרות</label>
      {!validMapping && <p className={study.wrong}>יש לבחור עמודות שונות למילה, להגדרה ולדוגמה.</p>}
      <p role="status">{entries.length} מילים מוכנות לשמירה{issues ? ` · ${issues} שורות עם שגיאות שלא יישמרו` : ""}</p>
      <div className={table.scroll} tabIndex={0} role="region" aria-label="תצוגה מקדימה של המילים">
        <table>
          <thead><tr><th>שורה</th><th>מילה</th><th>הגדרה</th><th>דוגמה</th><th>בדיקה</th></tr></thead>
          <tbody>{rows.slice(page * pageSize, (page + 1) * pageSize).map((row) => <tr key={row.number}>
            <td>{row.number}</td><td>{row.term}</td><td>{row.definition}</td><td>{row.example}</td>
            <td className={row.error ? study.wrong : styles.muted}>{row.error ?? "תקינה"}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {pages > 1 && <div className={styles.action}>
        <button className={styles.linkButton} type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>הקודם</button>
        <span><bdi>{page + 1} / {pages}</bdi></span>
        <button className={styles.linkButton} type="button" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>הבא</button>
      </div>}
      <button className={study.primary} type="submit" disabled={working || !entries.length || !validMapping || !name.trim()}>
        {working ? "שומר…" : `שמירת ${entries.length} מילים`}
      </button>
    </>}
    {!!error && <p role="alert" className={study.wrong}>{error}</p>}
  </form>;
}
