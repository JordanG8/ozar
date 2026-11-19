"use client";

import { createAuthClient } from "@neon/auth/next";
import { useState, type FormEvent } from "react";

const auth = createAuthClient();

export function SignInCheck({ signedIn, callbackPath = "/setup-check" }: { signedIn: boolean; callbackPath?: "/setup-check" | "/learn" }) {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setStatus("");
    try {
      await action();
    } catch {
      setStatus("הפעולה נכשלה. אפשר לנסות שוב.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      if (!sent) {
        const { error } = await auth.emailOtp.sendVerificationOtp({ email, type: "sign-in" });
        if (error) throw error;
        setSent(true);
        setStatus("קוד הכניסה נשלח.");
        return;
      }

      const { error } = await auth.signIn.emailOtp({ email, otp });
      if (error) throw error;
      window.location.reload();
    });
  }

  return (
    <>
      {signedIn ? (
        <>
          <p>הכניסה הצליחה.</p>
          <button disabled={busy} onClick={() => run(async () => {
            const response = await fetch("/api/health", { method: "POST" });
            if (!response.ok || !(await response.json()).readBack) throw new Error();
            setStatus("הכתיבה והקריאה ממסד הנתונים הצליחו.");
          })}>בדיקת מסד נתונים</button>
          <button disabled={busy} onClick={() => run(async () => {
            const { error } = await auth.signOut();
            if (error) throw error;
            window.location.reload();
          })}>יציאה</button>
        </>
      ) : (
        <>
          <button disabled={busy} onClick={() => run(async () => {
            const { error } = await auth.signIn.social({
              provider: "google",
              callbackURL: new URL(callbackPath, window.location.origin).href,
            });
            if (error) throw error;
          })}>כניסה עם Google</button>
          <form onSubmit={submitCode}>
            <label>
              כתובת דוא״ל{" "}
              <input type="email" autoComplete="email" dir="ltr" required
                readOnly={sent} value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            {sent && (
              <label>
                קוד כניסה{" "}
                <input autoComplete="one-time-code" inputMode="numeric" dir="ltr" required
                  value={otp} onChange={(event) => setOtp(event.target.value)} />
              </label>
            )}
            <button disabled={busy} type="submit">{sent ? "כניסה" : "שליחת קוד"}</button>
          </form>
        </>
      )}
      <p role="status">{status}</p>
    </>
  );
}
