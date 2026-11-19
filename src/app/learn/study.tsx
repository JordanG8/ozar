"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { exampleParts } from "@/lib/learn/matcher";
import type { AnswerInput, Feedback, StudyState } from "@/lib/learn/protocol";
import { useSpeech } from "./use-speech";
import styles from "./study.module.css";

type Hint = { hintLevel: number; example: string | null; letters: string | null };
export type Receipt = { accepted: boolean; feedback: Feedback | null };

export async function request<T>(body: object): Promise<T> {
  const response = await fetch("/api/learn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.status === 401) throw new Error("פג תוקף הכניסה. יש לרענן את הדף ולהתחבר מחדש.");
  if (response.status === 409) throw new Error("התרגול השתנה בחלון אחר. יש לרענן את הדף כדי להמשיך.");
  if (!response.ok) throw new Error("החיבור נקטע. אפשר לנסות שוב.");
  return response.json();
}

export function Example({ example, term }: { example: string | null; term: string }) {
  if (!example) return null;
  const parts = exampleParts(example, term);
  return <p className={styles.example}>{parts.map(({ text, highlighted, start }) =>
    highlighted ? <strong key={start}>{text}</strong> : text)}</p>;
}

export function Microphone() {
  return (
    <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3m-3 0h6" />
    </svg>
  );
}

export function Study() {
  const [state, setState] = useState<StudyState | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [hint, setHint] = useState<Hint | null>(null);
  const [typed, setTyped] = useState<boolean | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [speechReady, setSpeechReady] = useState(false);
  const [spoken, setSpoken] = useState("");
  const prompt = state?.prompt;
  const voicePrompt = prompt?.kind === "voice_meaning" ? prompt.id : null;
  const useTyping = typed ?? (state?.inputDefault === "typed");
  const title = useRef<HTMLHeadingElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const active = useRef<string | null>(null);
  const speechInFlight = useRef(false);
  const speechPending = useRef<{ promptId: string; input: AnswerInput } | null>(null);
  const lastSpoken = useRef("");

  function showError(cause: unknown) {
    setError(cause instanceof Error ? cause.message : "אירעה תקלה. אפשר לנסות שוב.");
  }

  async function show(action: "start" | "next") {
    const data = await request<StudyState>({ action });
    active.current = data.prompt?.id ?? null;
    speechPending.current = null;
    lastSpoken.current = "";
    setState(data);
    setFeedback(null);
    setHint(null);
    setValue("");
    setSpoken("");
    if (data.hintLevel && data.prompt?.kind === "voice_meaning") {
      setHint(await request<Hint>({ action: "hint", level: data.hintLevel, promptId: data.prompt.id }));
    }
  }

  function accept(result: Feedback) {
    active.current = null;
    speechPending.current = null;
    setFeedback(result);
  }

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try { await action(); } catch (cause) { showError(cause); } finally { setBusy(false); }
  }

  async function processSpeech(alternatives: string[], final: boolean) {
    if (!voicePrompt || active.current !== voicePrompt) return;
    const key = JSON.stringify([alternatives, final]);
    if (lastSpoken.current === key) return;
    lastSpoken.current = key;
    setSpoken(alternatives[0]);
    speechPending.current = { promptId: voicePrompt, input: { kind: "voice", alternatives, final } };
    if (speechInFlight.current) return;
    speechInFlight.current = true;
    try {
      while (speechPending.current) {
        const pending = speechPending.current;
        speechPending.current = null;
        const result = await request<Receipt>({ action: "answer", ...pending });
        if (result.feedback && active.current === pending.promptId) accept(result.feedback);
      }
    } catch (cause) {
      showError(cause);
      lastSpoken.current = "";
    } finally {
      speechInFlight.current = false;
    }
  }

  const speech = useSpeech(voicePrompt, Boolean(voicePrompt && speechReady && !useTyping && !feedback), processSpeech);

  async function submit(input: AnswerInput) {
    if (!prompt) return;
    speech.stop();
    const result = await request<Receipt>({ action: "answer", promptId: prompt.id, input });
    if (result.feedback) accept(result.feedback);
    else if (result.accepted) await show("next");
  }

  useEffect(() => {
    if (state) title.current?.focus();
  }, [state, feedback]);

  useEffect(() => {
    if (useTyping && voicePrompt) field.current?.focus();
  }, [useTyping, voicePrompt]);

  function submitTyped(event: FormEvent) {
    event.preventDefault();
    if (value.trim()) void run(() => submit({ kind: "typed", value }));
  }

  const hintLevel = hint?.hintLevel ?? state?.hintLevel ?? 0;
  const progressed = state ? state.total - state.remaining : 0;
  const status = error || (speech.listening ? "מקשיב…" : spoken || (voicePrompt && !useTyping ? speech.speechError : ""));

  return (
    <main className={styles.shell}>
      <header className={styles.top}>
        <Link href="/?menu=1" className={styles.brand}>אוצר</Link>
        <span>לימוד</span>
        {state && state.total > 0 ? <span className={styles.count} aria-label={`${progressed} מתוך ${state.total} מילים הושלמו`}>
          <bdi>{progressed} / {state.total}</bdi>
        </span> : null}
      </header>
      {state && state.total > 0 && <progress className={styles.progress} value={progressed} max={state.total} aria-label="התקדמות הלימוד" />}
      <section className={styles.card} aria-busy={busy}>
        {!state ? (
          <>
            <h1 ref={title} tabIndex={-1}>לימוד מילים</h1>
            <p className={styles.definition}>מילים חדשות לפי סדר החפיסה, עם תרגול מהזיכרון.</p>
          </>
        ) : feedback ? (
          <>
            <p className={feedback.correct ? styles.correct : styles.wrong}>
              {feedback.correct ? "תשובה נכונה" : "נתרגל את המילה שוב"}
            </p>
            <h1 ref={title} tabIndex={-1}>{feedback.term}</h1>
            {feedback.correct && feedback.matched && feedback.matched !== feedback.term &&
              <p className={styles.correct}>{feedback.matched}</p>}
            <p className={styles.definition}>{feedback.definition}</p>
            <Example example={feedback.example} term={feedback.term} />
          </>
        ) : !prompt ? (
          <>
            <h1 ref={title} tabIndex={-1}>סיימת להיום</h1>
            <p className={styles.definition}>כל המילים הזמינות ללימוד היום הושלמו.</p>
          </>
        ) : prompt.kind === "intro" ? (
          <>
            <p className={styles.label}>מילה חדשה</p>
            <h1 ref={title} tabIndex={-1}>{prompt.term}</h1>
            <p className={styles.definition}>{prompt.definition}</p>
            <Example example={prompt.example} term={prompt.term} />
          </>
        ) : prompt.kind === "voice_meaning" ? (
          <>
            <p className={styles.label}>מה המשמעות?</p>
            <h1 ref={title} tabIndex={-1}>{prompt.term}</h1>
            {hint && <div className={styles.hint} aria-live="polite">
              <p>{hint.example ?? "אין דוגמה זמינה לרמז הזה."}</p>
              {hint.letters ? <p>אותיות ראשונות <b>{hint.letters}</b></p> : null}
            </div>}
          </>
        ) : (
          <>
            <p className={styles.label}>בחרו את המילה המתאימה</p>
            <h1 className={styles.question} ref={title} tabIndex={-1}>{prompt.definition}</h1>
          </>
        )}
      </section>
      <div className={styles.controls}>
        <p role="status" className={error ? styles.wrong : styles.status}>{status || ""}</p>
        {!state ? <button className={styles.primary} disabled={busy} onClick={() => void run(async () => {
          setSpeechReady(true);
          await show("start");
        })}>התחלה או המשך</button>
          : feedback ? <button className={styles.primary} disabled={busy} onClick={() => void run(() => show("next"))}>הכרטיס הבא</button>
          : !prompt ? <Link href="/infinite" className={styles.primary}>לתרגול רציף</Link>
          : prompt.kind === "intro" ? <button className={styles.primary} disabled={busy}
            onClick={() => void run(() => submit({ kind: "continue" }))}>להמשך</button>
          : prompt.kind === "reverse_choice" ? <div className={styles.choices}>
            {prompt.choices.map((choice) => <button className={styles.secondary} key={choice.id} disabled={busy}
              onClick={() => void run(() => submit({ kind: "tap", choice: choice.id }))}>{choice.term}</button>)}
          </div>
          : <>
            {useTyping ? <form className={styles.typed} onSubmit={submitTyped}>
              <label htmlFor="meaning">התשובה שלך</label>
              <input id="meaning" ref={field} value={value} onChange={(event) => setValue(event.target.value)} maxLength={300} />
              <button className={styles.primary} disabled={busy || !value.trim()} type="submit">בדיקה</button>
            </form> : <button className={styles.mic} data-listening={speech.listening} disabled={busy}
              aria-pressed={speech.listening} onClick={() => speech.listening ? speech.stop() : speech.start()}>
              <Microphone />
              {speech.listening ? "עצירת הקלטה" : "מענה בקול"}
            </button>}
            <div className={styles.actions}>
              <button disabled={busy} onClick={() => { speech.stop(); setSpoken(""); setTyped(!useTyping); }}>
                {useTyping ? "מענה בקול" : "מענה בהקלדה"}
              </button>
              {hintLevel < 2 && <button disabled={busy} onClick={() => void run(async () => {
                setHint(await request<Hint>({ action: "hint", level: hintLevel + 1, promptId: prompt.id }));
              })}>{hintLevel ? "אותיות ראשונות" : "רמז"}</button>}
              <button disabled={busy} onClick={() => void run(() => submit({ kind: "skip" }))}>לא יודע</button>
            </div>
          </>}
      </div>
    </main>
  );
}
