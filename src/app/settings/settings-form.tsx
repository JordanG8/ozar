"use client";

import { createAuthClient } from "@neon/auth/next";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { Preferences } from "@/lib/settings";
import styles from "../manage.module.css";
import study from "../learn/study.module.css";

const auth = createAuthClient();

async function request(action: string, payload: object = {}) {
  const response = await fetch("/api/settings", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...payload }),
  });
  if (response.status === 401) throw new Error("פג תוקף הכניסה. יש להתחבר מחדש.");
  if (response.status === 409 && action === "delete") throw new Error("יש לצאת מהחשבון, להיכנס שוב ולנסות למחוק.");
  if (!response.ok) throw new Error("הפעולה נכשלה. אפשר לנסות שוב.");
  return response;
}

export function SettingsForm({ preferences, email }: { preferences: Preferences; email: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState("");

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setStatus("");
    setError("");
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "אירעה תקלה. אפשר לנסות שוב."); }
    finally { setBusy(false); }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const preferences = {
      newPerDay: Number(fields.get("new")),
      dailyGoal: Number(fields.get("goal")),
      inputDefault: fields.get("input"),
      desiredRetention: Number(fields.get("retention")) / 100,
    };
    void run(async () => { await request("save", { preferences }); setStatus("ההגדרות נשמרו."); });
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

  return <>
    <form className={styles.form} onSubmit={save}>
      <label>מילים חדשות ביום<input type="number" name="new" min="0" max="2000" step="1" required defaultValue={preferences.newPerDay} /></label>
      <label>יעד תשובות יומי<input type="number" name="goal" min="1" max="10000" step="1" required defaultValue={preferences.dailyGoal} /></label>
      <label>מענה כברירת מחדל<select name="input" defaultValue={preferences.inputDefault}>
        <option value="voice">דיבור</option><option value="typed">הקלדה</option>
      </select></label>
      <label>שיעור זכירה רצוי באחוזים<input type="number" name="retention" min="1" max="99" step="0.1"
        required defaultValue={Number((preferences.desiredRetention * 100).toFixed(1))} /></label>
      <button type="submit" className={study.primary} disabled={busy}>שמירת הגדרות</button>
    </form>
    <section className={styles.section}>
      <h2>החשבון שלי</h2>
      <p className={styles.muted}><bdi>{email}</bdi></p>
      <div className={styles.action}>
        <button className={styles.linkButton} type="button" disabled={busy} onClick={() => void run(download)}>הורדת הנתונים שלי</button>
        <button className={styles.linkButton} type="button" disabled={busy} onClick={() => void run(async () => {
          const { error } = await auth.signOut();
          if (error) throw new Error("היציאה נכשלה. אפשר לנסות שוב.");
          router.replace("/?menu=1");
          router.refresh();
        })}>יציאה מהחשבון</button>
      </div>
      {confirming ? <form className={styles.form} onSubmit={(event) => {
        event.preventDefault();
        if (confirmation.trim() !== email) return;
        void run(async () => {
          await request("delete", { email, confirmed: true });
          router.replace("/?menu=1");
          router.refresh();
        });
      }}>
        <p className={study.wrong}>המחיקה קבועה ותכלול את החשבון, החפיסות המיובאות והיסטוריית התרגול.</p>
        <label>הקלידו את כתובת הדוא״ל לאישור<input type="email" dir="ltr" required value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)} /></label>
        <div className={styles.action}>
          <button className={styles.linkButton} type="submit" disabled={busy || confirmation.trim() !== email}>מחיקת החשבון לצמיתות</button>
          <button className={styles.linkButton} type="button" disabled={busy} onClick={() => { setConfirming(false); setConfirmation(""); }}>ביטול</button>
        </div>
      </form> : <button className={styles.linkButton} type="button" disabled={busy} onClick={() => setConfirming(true)}>מחיקת חשבון</button>}
    </section>
    {error && <p role="alert" className={study.wrong}>{error}</p>}
    {status && <p role="status" className={study.correct}>{status}</p>}
  </>;
}
