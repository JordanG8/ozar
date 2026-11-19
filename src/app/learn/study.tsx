"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { exampleParts } from "@/lib/learn/matcher";
import { decisionNudge, type AnswerInput, type AnswerReceipt, type Feedback, type MeaningInput, type StudyState } from "@/lib/learn/protocol";
import { JudgeControls } from "./judge-controls";
import { request } from "./request";
import { useJudge } from "./use-judge";
import { useSpeech } from "./use-speech";
import styles from "./study.module.css";

type Hint = { hintLevel: number; example: string | null; letters: string | null };

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

type Deck = { id: string; name: string; size: number; seen: number };

export function Study({ decks, initialDeck }: { decks: Deck[]; initialDeck?: string }) {
  const [deckId, setDeckId] = useState(initialDeck);
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
  const judge = useJudge("learn");

  function showError(cause: unknown) {
    setError(cause instanceof Error ? cause.message : "אירעה תקלה. אפשר לנסות שוב.");
  }

  async function show(action: "start" | "next") {
    const data = await request<StudyState>({ action, deckId });
    active.current = data.prompt?.id ?? null;
    judge.reset(data.prompt?.id, data.judgePending);
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
    judge.reset();
    speechPending.current = null;
    setFeedback(result);
  }

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try { await action(); } catch (cause) { showError(cause); } finally { setBusy(false); }
  }

  async function submitMeaning(input: MeaningInput | { kind: "self"; correct: boolean }) {
    if (!voicePrompt || active.current !== voicePrompt) return;
    setError("");
    try {
      const result = await judge.submit(voicePrompt, input);
      if (result?.feedback && active.current === voicePrompt) accept(result.feedback);
    } catch (cause) { showError(cause); }
  }

  async function processSpeech(alternatives: string[], ended: boolean) {
    if (!voicePrompt || active.current !== voicePrompt) return;
    if (ended) {
      speechPending.current = null;
      await submitMeaning({ kind: "voice", alternatives, final: true });
      return;
    }
    const key = JSON.stringify(alternatives);
    if (lastSpoken.current === key) return;
    lastSpoken.current = key;
    setSpoken(alternatives[0]);
    speechPending.current = { promptId: voicePrompt, input: { kind: "voice", alternatives, final: false } };
    if (speechInFlight.current) return;
    speechInFlight.current = true;
    try {
      while (speechPending.current) {
        const pending = speechPending.current;
        speechPending.current = null;
        const result = await request<AnswerReceipt>({ action: "answer", ...pending });
        if (result.feedback && active.current === pending.promptId) accept(result.feedback);
      }
    } catch (cause) {
      showError(cause);
      lastSpoken.current = "";
    } finally {
      speechInFlight.current = false;
    }
  }

  const speech = useSpeech(voicePrompt, Boolean(voicePrompt && speechReady && !useTyping && !feedback && !judge.pending), processSpeech);

  async function submit(input: AnswerInput) {
    if (!prompt) return;
    speech.stop();
    const result = await request<AnswerReceipt>({ action: "answer", promptId: prompt.id, input });
    if (result.feedback) accept(result.feedback);
    else if (result.accepted) await show("next");
  }

  useEffect(() => {
    if (state) title.current?.focus();
  }, [state, feedback]);

  useEffect(() => {
    if (useTyping && voicePrompt && !judge.pending && !feedback) field.current?.focus();
  }, [useTyping, voicePrompt, judge.pending, feedback]);

  function submitTyped(event: FormEvent) {
    event.preventDefault();
    if (value.trim()) void submitMeaning({ kind: "typed", value });
  }

  const hintLevel = hint?.hintLevel ?? state?.hintLevel ?? 0;
  const progressed = state ? state.total - state.remaining : 0;
  const status = error || (voicePrompt && !useTyping && !judge.pending && !feedback ? speech.speechError || spoken : "");

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
            {decks.length > 1 && <label className={styles.deck}>חפיסה ללימוד
              <select disabled={busy} value={deckId} onChange={(event) => setDeckId(event.target.value)}>
                {decks.map((deck) => <option key={deck.id} value={deck.id}>{deck.name} · {deck.size} מילים</option>)}
              </select>
            </label>}
            <Link className={styles.import} href="/decks/import">ייבוא מילים</Link>
          </>
        ) : feedback ? (
          <>
            <p className={feedback.correct ? styles.correct : styles.wrong}>
              {feedback.decision === "partial" ? "תשובה נכונה חלקית" : feedback.correct ? "תשובה נכונה" : "נתרגל את המילה שוב"}
            </p>
            <h1 ref={title} tabIndex={-1}>{feedback.term}</h1>
            {feedback.correct && feedback.matched && feedback.matched !== feedback.term &&
              <p className={styles.correct}>{feedback.matched}</p>}
            <p className={styles.definition}>{feedback.definition}</p>
            {feedback.decision && decisionNudge(feedback.decision) && <p className={styles.example}>{decisionNudge(feedback.decision)}</p>}
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
        {(voicePrompt || feedback) && <p role="status" className={styles.micStatus}
          data-listening={speech.listening}>{speech.micStatus}</p>}
        {status && <p role={error ? "alert" : undefined} className={error ? styles.wrong : styles.status}>{status}</p>}
        {!state ? <button className={styles.primary} disabled={busy} onClick={() => void run(async () => {
          setSpeechReady(true);
          await show("start");
        })}>התחלה או המשך</button>
          : feedback ? <button className={styles.primary} disabled={busy} onClick={() => void run(() => show("next"))}>הכרטיס הבא</button>
          : !prompt ? <>
            <Link href="/infinite" className={styles.primary}>לתרגול רציף</Link>
            {decks.length > 1 && <button className={styles.secondary} onClick={() => setState(null)}>בחירת חפיסה</button>}
          </>
          : prompt.kind === "intro" ? <button className={styles.primary} disabled={busy}
            onClick={() => void run(() => submit({ kind: "continue" }))}>להמשך</button>
          : prompt.kind === "reverse_choice" ? <div className={styles.choices}>
            {prompt.choices.map((choice) => <button className={styles.secondary} key={choice.id} disabled={busy}
              onClick={() => void run(() => submit({ kind: "tap", choice: choice.id }))}>{choice.term}</button>)}
          </div>
          : judge.pending ? <JudgeControls pending={judge.pending} busy={judge.selfBusy}
            onGrade={(correct) => void submitMeaning({ kind: "self", correct })} />
          : <>
            {useTyping ? <form className={styles.typed} onSubmit={submitTyped}>
              <label htmlFor="meaning">התשובה שלך</label>
              <input id="meaning" ref={field} value={value} onChange={(event) => setValue(event.target.value)} maxLength={300} />
              <button className={styles.primary} disabled={busy || !value.trim()} type="submit">בדיקה</button>
            </form> : <button className={styles.mic} data-listening={speech.listening} disabled={busy || speech.finishing}
              aria-pressed={speech.recording} onClick={() => speech.recording ? speech.finish() : speech.start()}>
              <Microphone />
              {speech.finishing ? "מסיים זיהוי…" : speech.recording ? "עצירת הקלטה" : "מענה בקול"}
            </button>}
            {!useTyping && speech.showTranscriptionNotice && <p className={styles.status}>הקלטות קצרות נשלחות לתמלול.</p>}
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
