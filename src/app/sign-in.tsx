"use client";

import { createAuthClient } from "@neon/auth/next";
import { useState, type FormEvent } from "react";
import ui from "./ui.module.css";
import styles from "./sign-in.module.css";

const auth = createAuthClient();

export function SignIn({ callbackPath, available }: { callbackPath: string; available: boolean }) {
  const [step, setStep] = useState<"choose" | "email" | "code">("choose");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch {
      setError("הפעולה נכשלה. אפשר לנסות שוב.");
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      if (step === "email") {
        const { error } = await auth.emailOtp.sendVerificationOtp({ email, type: "sign-in" });
        if (error) throw error;
        setStep("code");
        return;
      }
      const { error } = await auth.signIn.emailOtp({ email, otp });
      if (error) throw error;
      window.location.reload();
    });
  }

  return (
    <main className={`${ui.screen} ${styles.screen}`}>
      <section className={styles.brand}>
        <h1 className={styles.wordmark}>אוצר</h1>
        <p className={styles.promise}>המילים של הפסיכומטרי. בקול, כל יום.</p>
      </section>
      <div className={styles.actions}>
        {!available ? <p className={ui.lede}>הכניסה אינה זמינה כרגע.</p> : step === "choose" ? <>
          <button type="button" className={ui.primary} disabled={busy} onClick={() => void run(async () => {
            const { error } = await auth.signIn.social({
              provider: "google",
              callbackURL: new URL(callbackPath, window.location.origin).href,
            });
            if (error) throw error;
          })}>המשך עם Google</button>
          <button type="button" className={ui.outline} disabled={busy} onClick={() => setStep("email")}>כניסה עם קוד למייל</button>
        </> : <form className={styles.form} onSubmit={submit}>
          <label className={ui.label}>כתובת דוא״ל
            <input className={ui.field} type="email" autoComplete="email" dir="ltr" required autoFocus={step === "email"}
              readOnly={step === "code"} value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          {step === "code" && <label className={ui.label}>קוד כניסה
            <input className={`${ui.field} ${styles.code}`} autoComplete="one-time-code" inputMode="numeric" dir="ltr" required autoFocus
              value={otp} onChange={(event) => setOtp(event.target.value)} />
            <span className={ui.meta}>שלחנו קוד בן 6 ספרות אל <bdi>{email}</bdi></span>
          </label>}
          <button className={ui.primary} disabled={busy} type="submit">{step === "code" ? "כניסה" : "שליחת קוד"}</button>
          <button type="button" className={ui.quiet} disabled={busy} onClick={() => { setStep("choose"); setOtp(""); }}>חזרה</button>
        </form>}
        <p role="status" className={error ? ui.error : ui.meta}>{error}</p>
      </div>
    </main>
  );
}
