"use client";

import { createAuthClient } from "@neon/auth/next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import type { Preferences } from "@/lib/settings";
import { feel, feelEnabled, setFeelEnabled, type FeelSetting } from "../feel";
import { Icon } from "../icons";
import { SectionLabel } from "../ui";
import ui from "../ui.module.css";
import styles from "./settings.module.css";

const auth = createAuthClient();
type Field = "newPerDay" | "dailyGoal" | "inputDefault" | "desiredRetention";

async function request(action: string, payload: object = {}) {
  const response = await fetch("/api/settings", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...payload }),
  });
  if (response.status === 401) throw new Error("פג תוקף הכניסה. יש להתחבר מחדש.");
  if (response.status === 409 && action === "delete") throw new Error("יש לצאת מהחשבון, להיכנס שוב ולנסות למחוק.");
  if (!response.ok) throw new Error("הפעולה נכשלה. אפשר לנסות שוב.");
  return response;
}

function valid(preferences: Preferences) {
  const { newPerDay, dailyGoal } = preferences;
  return Number.isInteger(newPerDay) && newPerDay >= 0 && newPerDay <= 2000 &&
    Number.isInteger(dailyGoal) && dailyGoal >= 1 && dailyGoal <= 10000;
}

function Stepper({ id, value, step, min, max, onChange }: {
  id: string; value: number; step: number; min: number; max: number; onChange: (value: number) => void;
}) {
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  return <div className={styles.stepper}>
    <button type="button" aria-label="הפחתה" disabled={value <= min} onClick={() => onChange(clamp(value - step))}><Icon name="minus" /></button>
    <input id={id} type="number" inputMode="numeric" min={min} max={max} step="1" value={Number.isNaN(value) ? "" : value}
      onChange={(event) => onChange(event.target.value === "" ? Number.NaN : Number(event.target.value))} />
    <button type="button" aria-label="הוספה" disabled={value >= max} onClick={() => onChange(clamp(value + step))}><Icon name="plus" /></button>
  </div>;
}

const feelChanged = "ozar:feel";
function subscribeFeel(notify: () => void) {
  window.addEventListener(feelChanged, notify);
  window.addEventListener("storage", notify);
  return () => {
    window.removeEventListener(feelChanged, notify);
    window.removeEventListener("storage", notify);
  };
}

// Sound and vibration belong to the device, not the account, so they save locally and at once.
function FeelToggle({ setting, label }: { setting: FeelSetting; label: string }) {
  const enabled = useSyncExternalStore(subscribeFeel, () => feelEnabled(setting), () => true);
  return <fieldset className={`${ui.row} ${styles.row} ${styles.fieldset}`}>
    <legend className="visually-hidden">{label}</legend>
    <span aria-hidden="true" className={styles.grow}>{label}</span>
    <div className={styles.segment}>
      {([[true, "פועל"], [false, "כבוי"]] as const).map(([value, text]) => <label key={text}>
        <input type="radio" name={setting} checked={enabled === value} onChange={() => {
          setFeelEnabled(setting, value);
          window.dispatchEvent(new Event(feelChanged));
          if (value) feel(setting === "sound" ? "correct" : "partial", { step: 5, gesture: true });
        }} />{text}
      </label>)}
    </div>
  </fieldset>;
}

export function SettingsForm({ preferences: initial, email }: { preferences: Preferences; email: string }) {
  const router = useRouter();
  const [preferences, setPreferences] = useState(initial);
  const [saved, setSaved] = useState<Field | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const latest = useRef(initial);
  const sequence = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const chain = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!saved) return;
    const hide = window.setTimeout(() => setSaved(null), 2000);
    return () => window.clearTimeout(hide);
  }, [saved]);

  function change<K extends Field>(field: K, value: Preferences[K]) {
    const next = { ...latest.current, [field]: value };
    latest.current = next;
    setPreferences(next);
    setSaved(null);
    window.clearTimeout(timer.current);
    if (!valid(next)) return;
    const ticket = ++sequence.current;
    timer.current = window.setTimeout(() => {
      chain.current = chain.current.then(async () => {
        try {
          await request("save", { preferences: latest.current });
          if (ticket === sequence.current) { setError(""); setSaved(field); }
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "השמירה נכשלה.");
        }
      });
    }, field === "newPerDay" || field === "dailyGoal" ? 350 : 150);
  }

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "אירעה תקלה. אפשר לנסות שוב."); }
    finally { setBusy(false); }
  }

  async function download() {
    const response = await request("export");
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "ozar-data.json";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const savedMark = (field: Field): ReactNode => saved === field
    ? <span className={styles.saved} role="status">נשמר</span> : null;
  const retention = Math.round(preferences.desiredRetention * 100);

  return <div className={ui.body}>
    <SectionLabel>למידה</SectionLabel>
    <div className={`${ui.row} ${styles.row}`}>
      <span><label htmlFor="new-per-day">מילים חדשות ביום</label>{savedMark("newPerDay")}</span>
      <Stepper id="new-per-day" value={preferences.newPerDay} step={5} min={0} max={2000} onChange={(value) => change("newPerDay", value)} />
    </div>
    <div className={`${ui.row} ${styles.row}`}>
      <span><label htmlFor="daily-goal">יעד יומי <span className={ui.meta}>בתשובות</span></label>{savedMark("dailyGoal")}</span>
      <Stepper id="daily-goal" value={preferences.dailyGoal} step={10} min={1} max={10000} onChange={(value) => change("dailyGoal", value)} />
    </div>
    <fieldset className={`${ui.row} ${styles.row} ${styles.fieldset}`}>
      <legend className="visually-hidden">קלט ברירת מחדל</legend>
      <span><span aria-hidden="true">קלט ברירת מחדל</span>{savedMark("inputDefault")}</span>
      <div className={styles.segment}>
        {([["voice", "קול"], ["typed", "מקלדת"]] as const).map(([value, label]) => <label key={value}>
          <input type="radio" name="input" value={value} checked={preferences.inputDefault === value}
            onChange={() => change("inputDefault", value)} />{label}
        </label>)}
      </div>
    </fieldset>
    <div className={styles.slider}>
      <div className={styles.sliderHead}>
        <span><label htmlFor="retention">שימור רצוי</label>{savedMark("desiredRetention")}</span>
        <strong><bdi>{retention}%</bdi></strong>
      </div>
      <input id="retention" type="range" min="70" max="97" step="1" value={retention}
        style={{ "--fill": `${(retention - 70) / 27 * 100}%` } as CSSProperties}
        onChange={(event) => change("desiredRetention", Number(event.target.value) / 100)} />
      <p className={ui.meta}>גבוה יותר = זוכרים יותר, ויותר חזרות ביום</p>
    </div>

    <SectionLabel>משוב</SectionLabel>
    <FeelToggle setting="sound" label="צלילים" />
    <FeelToggle setting="haptics" label="רטט" />

    <SectionLabel>נתונים</SectionLabel>
    <Link className={ui.row} href="/decks/import"><span>ייבוא מילים</span><span className={ui.rowIcon}><Icon name="chevron" size={18} /></span></Link>
    <button type="button" className={ui.row} disabled={busy} onClick={() => void run(download)}>
      <span>ייצוא הנתונים שלי</span><span className={ui.rowIcon}><Icon name="download" /></span>
    </button>

    <SectionLabel>חשבון</SectionLabel>
    <div className={ui.row}><span className={ui.rowValue}><bdi>{email}</bdi></span></div>
    <button type="button" className={ui.row} disabled={busy} onClick={() => void run(async () => {
      const { error } = await auth.signOut();
      if (error) throw new Error("היציאה נכשלה. אפשר לנסות שוב.");
      router.replace("/?menu=1");
      router.refresh();
    })}><span>התנתקות</span></button>
    {confirming ? <form className={styles.confirm} onSubmit={(event) => {
      event.preventDefault();
      if (confirmation.trim() !== email) return;
      void run(async () => {
        await request("delete", { email, confirmed: true });
        router.replace("/?menu=1");
        router.refresh();
      });
    }}>
      <p className={ui.error}>המחיקה קבועה ותכלול את החשבון, החפיסות המיובאות והיסטוריית התרגול.</p>
      <label className={ui.label}>הקלידו את כתובת הדוא״ל לאישור
        <input className={ui.field} type="email" dir="ltr" required value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)} />
      </label>
      <button className={styles.danger} type="submit" disabled={busy || confirmation.trim() !== email}>מחיקת החשבון לצמיתות</button>
      <button className={ui.quiet} type="button" disabled={busy} onClick={() => { setConfirming(false); setConfirmation(""); }}>ביטול</button>
    </form> : <button type="button" className={`${ui.row} ${styles.deleteRow}`} disabled={busy} onClick={() => setConfirming(true)}>
      <span>מחיקת חשבון</span>
    </button>}
    {error && <p role="alert" className={`${ui.error} ${styles.message}`}>{error}</p>}
  </div>;
}
