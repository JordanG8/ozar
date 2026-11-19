"use client";

import Link from "next/link";
import { useRef, useState, useSyncExternalStore, type DragEvent, type FormEvent } from "react";
import { maxImportBytes, maxImportFileBytes, previewRows, type Mapping } from "@/lib/import/rows";
import type { readSpreadsheet } from "@/lib/import/spreadsheet";
import { Icon } from "../../icons";
import { TopBar } from "../../ui";
import ui from "../../ui.module.css";
import styles from "./import-deck.module.css";

type Spreadsheet = Awaited<ReturnType<typeof readSpreadsheet>>;
const columns = { term: "מילה", definition: "פירוש", example: "דוגמה" };
const pageSize = 25;
const columnName = (index: number) => index < 26 ? String.fromCharCode(65 + index) : `A${String.fromCharCode(65 + index - 26)}`;
const template = "data:text/csv;charset=utf-8," + encodeURIComponent(
  "﻿מילה,הגדרה,דוגמה\r\nאיתן,\"חזק, יציב\",הגשר נותר איתן גם בסערה.\r\nעגום,\"עצוב, קודר\",הוא חזר הביתה עגום.\r\n");
const subscribe = () => () => {};

export function ImportDeck() {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const [sheet, setSheet] = useState<Spreadsheet | null>(null);
  const [fileName, setFileName] = useState("");
  const [mapping, setMapping] = useState<Mapping>({ term: 0, definition: 1, example: -1 });
  const [header, setHeader] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [page, setPage] = useState(0);
  const [saved, setSaved] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const rows = sheet ? previewRows(sheet.rows, mapping, header) : [];
  const entries = rows.flatMap(({ word }) => word ? [word] : []);
  const issues = rows.length - entries.length;
  const requiredColumns = [mapping.term, mapping.definition];
  const mapped = [...requiredColumns, ...(mapping.example < 0 ? [] : [mapping.example])];
  const validMapping = !requiredColumns.includes(-1) && new Set(mapped).size === mapped.length;
  const pages = Math.ceil(rows.length / pageSize);

  async function pick(file: File | undefined) {
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
      setFileName(file.name);
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

  function drop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (!working) void pick(event.dataTransfer.files[0]);
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

  function reset() {
    requestId.current = null;
    setSheet(null);
    setSaved(null);
    setName("");
  }

  const errorRows = rows.filter((row) => row.error);

  if (saved) return <main className={ui.screen}>
    <TopBar back="/" />
    <div className={styles.done}>
      <span className={styles.doneRing}><Icon name="check" size={32} /></span>
      <h2 role="status">{entries.length} מילים נוספו</h2>
      <p className={ui.lede}>החפיסה ״{name.trim()}״ נשמרה. המילים ייכנסו למנות הלמידה לפי סדר הקובץ.</p>
      {errorRows.length > 0 && <div className={styles.skipped}>
        <h3 className={ui.section}>דילגנו על {errorRows.length} שורות</h3>
        <ul>{errorRows.slice(0, 6).map((row) => <li key={row.number} className={ui.row}>
          <span><b>שורה {row.number}{row.term ? ` · ${row.term}` : ""}</b><small>{row.error}</small></span>
        </li>)}</ul>
        <a className={ui.inlineLink} href={template} download="ozar-template.csv"><Icon name="download" size={18} />הורדת תבנית</a>
      </div>}
    </div>
    <div className={ui.footer}>
      <Link className={ui.primary} href={`/learn?deck=${saved}`}>ללימוד החפיסה</Link>
      <button type="button" className={ui.quiet} onClick={reset}>ייבוא קובץ נוסף</button>
    </div>
  </main>;

  return <main className={ui.screen}>
    <TopBar title={sheet ? "תצוגה מקדימה" : "ייבוא מילים משלך"} />
    <form className={styles.form} onSubmit={save}>
      {!sheet ? <div className={styles.pickStep}>
        <p className={ui.lede}>קובץ עם עמודת מילים ועמודת פירושים. עמודת דוגמאות לא חובה.</p>
        <label className={styles.drop} data-dragging={dragging} data-working={working}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)} onDrop={drop}>
          <input ref={picker} className="visually-hidden" type="file" accept=".csv,.xlsx" aria-label="קובץ מילים"
            disabled={!hydrated || working} onChange={(event) => void pick(event.target.files?.[0])} />
          <span className={ui.rowIcon}><Icon name="upload" size={28} /></span>
          <strong>{working ? "קורא את הקובץ…" : "בחירת קובץ"}</strong>
          <span className={ui.meta}><span dir="ltr">.xlsx</span> או <span dir="ltr">.csv</span></span>
          {working && <i aria-hidden="true" className={styles.sweep} />}
        </label>
        <a className={ui.inlineLink} href={template} download="ozar-template.csv"><Icon name="download" size={18} />הורדת תבנית (<span dir="ltr">.csv</span>)</a>
      </div> : <>
        <p className={styles.meta}><bdi>{fileName}</bdi> · {rows.length} שורות</p>
        <label className={`${ui.label} ${styles.pad}`}>שם החפיסה
          <input className={ui.field} value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required disabled={working} />
        </label>
        <div className={styles.mapping}>
          {(Object.keys(columns) as (keyof Mapping)[]).map((field) => <label key={field}>
            <span>{columns[field]}</span>
            <select value={mapping[field]} disabled={working} aria-label={`עמודת ${columns[field]}`} onChange={(event) => {
              setMapping({ ...mapping, [field]: Number(event.target.value) });
              setPage(0);
            }}>
              <option value={-1}>{field === "example" ? "להתעלם" : "בחירה"}</option>
              {Array.from({ length: sheet.width }, (_, index) => <option key={index} value={index}>
                {columnName(index)}{header && sheet.rows[0].cells[index] ? ` · ${sheet.rows[0].cells[index].slice(0, 30)}` : ""}
              </option>)}
            </select>
          </label>)}
        </div>
        <label className={styles.check}><input type="checkbox" checked={header} disabled={working}
          onChange={(event) => { setHeader(event.target.checked); setPage(0); }} />השורה הראשונה מכילה כותרות</label>
        {!validMapping && <p className={`${ui.error} ${styles.pad}`}>יש לבחור עמודות שונות למילה, לפירוש ולדוגמה.</p>}
        <div className={styles.table} tabIndex={0} role="region" aria-label="תצוגה מקדימה של המילים">
          <table>
            <thead><tr><th>#</th><th>מילה</th><th>פירוש</th><th>דוגמה</th></tr></thead>
            <tbody>{rows.slice(page * pageSize, (page + 1) * pageSize).map((row) => <tr key={row.number} data-error={Boolean(row.error)}>
              <td>{row.number}</td><td><b>{row.term}</b></td>
              <td>{row.definition}{row.error && <span className={styles.rowError}>{row.error}</span>}</td>
              <td>{row.example}</td>
            </tr>)}</tbody>
          </table>
        </div>
        {pages > 1 && <div className={styles.pager}>
          <button className={ui.quiet} type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>הקודם</button>
          <span><bdi>{page + 1} / {pages}</bdi></span>
          <button className={ui.quiet} type="button" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>הבא</button>
        </div>}
      </>}
      <div className={styles.spacer} />
      <div className={ui.footer}>
        {!!error && <p role="alert" className={ui.error}>{error}</p>}
        {sheet ? <>
          <p role="status" className={styles.tally}><b>{entries.length} תקינות</b>{issues ? <> · <span>{issues} עם שגיאות, ידולגו</span></> : null}</p>
          <button className={ui.primary} type="submit" disabled={working || !entries.length || !validMapping || !name.trim()}>
            {working ? "שומר…" : `ייבוא ${entries.length} מילים`}
          </button>
          <button className={ui.quiet} type="button" disabled={working} onClick={reset}>קובץ אחר</button>
        </> : <button className={ui.primary} type="button" disabled={!hydrated || working} onClick={() => picker.current?.click()}>בחירת קובץ</button>}
      </div>
    </form>
  </main>;
}
