"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { decisionNudge, type AnswerInput, type AnswerReceipt, type Feedback, type InfiniteState, type MeaningInput } from "@/lib/learn/protocol";
import { Example, Microphone } from "../learn/study";
import { JudgeControls } from "../learn/judge-controls";
import { request } from "../learn/request";
import { useJudge } from "../learn/use-judge";
import { useSpeech } from "../learn/use-speech";
import study from "../learn/study.module.css";
import styles from "./practice.module.css";

const milestones = [10, 25, 50];

function elapsed(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function playFeedback(audio: AudioContext | null, correct: boolean, combo: number) {
  const milestone = correct && milestones.includes(combo);
  navigator.vibrate?.(milestone ? [30, 35, 65] : correct ? 12 : 35);
  if (audio?.state !== "running") return;
  const base = correct ? 420 * 2 ** (Math.min(combo, 50) / 45) : 180;
  const notes = milestone ? [base, base * 1.25, base * 1.5] : [base];
  notes.forEach((frequency, index) => {
    const start = audio.currentTime + index * .09;
    const oscillator = audio.createOscillator();
    const volume = audio.createGain();
    oscillator.frequency.value = frequency;
    volume.gain.setValueAtTime(.001, start);
    volume.gain.exponentialRampToValueAtTime(correct ? .075 : .045, start + .014);
    volume.gain.exponentialRampToValueAtTime(.001, start + .17);
    oscillator.connect(volume).connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + .18);
  });
}

type Judgment = { promptId: string; disputed: boolean; correct: boolean };
const message = (cause: unknown) => cause instanceof Error ? cause.message : "אירעה תקלה. אפשר לנסות שוב.";
const call = <T,>(data: object) => request<T>({ mode: "infinite", ...data });

export function Practice() {
  const [state, setState] = useState<InfiniteState | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [typed, setTyped] = useState<boolean | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [spoken, setSpoken] = useState("");
  const [judgment, setJudgment] = useState<Judgment | null>(null);
  const [flagging, setFlagging] = useState(false);
  const [clock, setClock] = useState(0);
  const [cardStart, setCardStart] = useState(0);
  const [loading, setLoading] = useState(false);
  const session = useRef<string | null>(null);
  const open = useRef(false);
  const active = useRef<string | null>(null);
  const posting = useRef(false);
  const queue = useRef<{ id: string; input: AnswerInput }[]>([]);
  const lastHeard = useRef("");
  const audio = useRef<AudioContext | null>(null);
  const inputField = useRef<HTMLInputElement>(null);
  const prompt = state?.prompt;
  const voice = prompt?.kind === "voice_meaning" ? prompt.id : null;
  const useTyping = typed ?? state?.inputDefault === "typed";
  const { pending: judgePending, selfBusy, reset: resetJudge, submit: requestJudge } = useJudge("infinite");

  const next = useCallback(async () => {
    if (open.current) return;
    open.current = true;
    setLoading(true);
    setError("");
    try {
      session.current ??= crypto.randomUUID();
      const upcoming = await call<InfiniteState>({ action: "next", sessionId: session.current });
      active.current = upcoming.prompt?.id ?? null;
      resetJudge(upcoming.prompt?.id, upcoming.judgePending);
      queue.current = [];
      lastHeard.current = "";
      setState(upcoming);
      setFeedback(null);
      setValue("");
      setSpoken("");
      const now = Date.now();
      setClock(now);
      setCardStart(now);
    } catch (cause) {
      setError(message(cause));
    } finally {
      open.current = false;
      setLoading(false);
    }
  }, [resetJudge]);

  useEffect(() => {
    void next();
    const clockTimer = window.setInterval(() => setClock(Date.now()), 250);
    return () => window.clearInterval(clockTimer);
  }, [next]);

  useEffect(() => {
    if (!feedback?.correct) return;
    const timer = window.setTimeout(() => void next(), feedback.decision === "partial" ? 2000 : 800);
    return () => window.clearTimeout(timer);
  }, [feedback, next]);

  useEffect(() => {
    if (useTyping && voice && !feedback && !judgePending) inputField.current?.focus();
  }, [useTyping, voice, feedback, judgePending]);

  useEffect(() => {
    function unlock() {
      try {
        if (window.AudioContext) {
          audio.current ??= new AudioContext();
          void audio.current.resume().catch(() => {});
        }
      } catch {
        // Text feedback works in browsers without Web Audio.
      }
    }
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      void audio.current?.close();
      audio.current = null;
    };
  }, []);

  function accept(id: string, receipt: AnswerReceipt, wasVoice: boolean) {
    if (!state || !receipt.feedback || active.current !== id) return;
    active.current = null;
    resetJudge();
    queue.current = [];
    const correct = receipt.feedback.correct;
    const combo = correct ? state.combo + 1 : 0;
    playFeedback(audio.current, correct, combo);
    setState({
      ...state, combo, best: Math.max(state.best, combo),
      answers: state.answers + 1, correct: state.correct + Number(correct), today: state.today + 1,
      averageMs: (state.averageMs * state.answers + (receipt.responseMs ?? Math.max(0, Date.now() - cardStart))) / (state.answers + 1),
    });
    if (wasVoice) setJudgment({ promptId: id, disputed: false, correct });
    setFeedback(receipt.feedback);
  }

  async function submitMeaning(input: MeaningInput | { kind: "self"; correct: boolean }) {
    if (!voice || active.current !== voice) return;
    setError("");
    try {
      const receipt = await requestJudge(voice, input);
      if (receipt) accept(voice, receipt, input.kind === "voice" || (input.kind === "self" && !useTyping));
    } catch (cause) { setError(message(cause)); }
  }

  async function submit(input: AnswerInput) {
    if (!state || !prompt || active.current !== prompt.id) return;
    queue.current.push({ id: prompt.id, input });
    if (posting.current) return;
    posting.current = true;
    setError("");
    try {
      while (queue.current.length) {
        const pending = queue.current.shift()!;
        if (active.current !== pending.id) continue;
        const receipt = await call<AnswerReceipt>({ action: "answer", promptId: pending.id, input: pending.input });
        accept(pending.id, receipt, pending.input.kind === "voice");
      }
    } catch (cause) {
      queue.current = [];
      lastHeard.current = "";
      setError(message(cause));
    } finally {
      posting.current = false;
    }
  }

  function heard(alternatives: string[], ended: boolean) {
    if (!voice || active.current !== voice) return;
    if (ended) {
      queue.current = [];
      void submitMeaning({ kind: "voice", alternatives, final: true });
      return;
    }
    const key = JSON.stringify(alternatives);
    if (lastHeard.current === key) return;
    lastHeard.current = key;
    setSpoken(alternatives[0]);
    void submit({ kind: "voice", alternatives, final: false });
  }

  const speech = useSpeech(voice,
    Boolean(voice && !useTyping && !feedback && !loading && !judgePending), heard);

  async function flag() {
    if (!judgment || flagging) return;
    setFlagging(true);
    try {
      await call({ action: "dispute", promptId: judgment.promptId, disputed: !judgment.disputed });
      setJudgment((current) => current?.promptId === judgment.promptId
        ? { ...current, disputed: !current.disputed } : current);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setFlagging(false);
    }
  }

  function typeAnswer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (value.trim()) void submitMeaning({ kind: "typed", value });
  }

  const accuracy = state?.answers ? `${Math.round(state.correct / state.answers * 100)}%` : "—";
  const sessionTime = state?.startedAt ? elapsed(clock - Date.parse(state.startedAt)) : "0:00";
  const missed = Boolean(feedback && !feedback.correct);

  return (
    <main className={styles.shell}>
      <header className={styles.head}>
        <nav aria-label="ניווט בתרגול"><Link href="/?menu=1" className={study.brand}>אוצר</Link><Link href="/sessions">יומן תרגול</Link></nav>
        <dl className={styles.stats}>
          <div><dt>זמן תרגול</dt><dd>{sessionTime}</dd></div>
          <div><dt>בכרטיס</dt><dd>{prompt && !feedback ? elapsed(clock - cardStart) : "—"}</dd></div>
          <div><dt>ממוצע</dt><dd>{state?.answers ? `${(state.averageMs / 1000).toFixed(1)} שנ׳` : "—"}</dd></div>
          <div><dt>דיוק</dt><dd>{accuracy}</dd></div>
        </dl>
      </header>

      <section className={styles.middle} aria-label="כרטיס תרגול">
        {state?.prompt && <div className={styles.goals}>
          <div className={styles.goal}>
            <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
              <circle cx="14" cy="14" r="11" pathLength="100" className={styles.track} />
              <circle cx="14" cy="14" r="11" pathLength="100" className={styles.fill}
                strokeDasharray={`${Math.min(100, state.today / state.goal * 100)} 100`} />
            </svg>
            <span aria-label={`יעד יומי ${state.today} מתוך ${state.goal}`}><bdi>{state.today}/{state.goal}</bdi></span>
          </div>
          <span>רצף יומי {state.streak}</span>
          <span className={styles.combo}>רצף {state.combo}</span>
          <span>שיא {state.best}</span>
        </div>}
        <div className={styles.card}>
          {feedback ? <>
            <p role="status" className={feedback.correct ? study.correct : study.wrong}>
              {feedback.decision === "partial" ? "נכון חלקית" : feedback.correct
                ? (milestones.includes(state?.combo ?? 0) ? `${state?.combo} תשובות נכונות ברצף` : "נכון") : "התשובה"}
            </p>
            <h1>{feedback.term}</h1>
            {feedback.correct && feedback.matched && feedback.matched !== feedback.term &&
              <p className={study.correct}>{feedback.matched}</p>}
            <p className={study.definition}>{feedback.definition}</p>
            {feedback.decision && decisionNudge(feedback.decision) && <p className={study.example}>{decisionNudge(feedback.decision)}</p>}
            {missed && <Example example={feedback.example} term={feedback.term} />}
          </> : prompt?.kind === "voice_meaning" ? <>
            <p className={study.label}>מה המשמעות?</p><h1>{prompt.term}</h1>
          </> : prompt?.kind === "reverse_choice" ? <>
            <p className={study.label}>בחרו את המילה המתאימה</p><h1 className={styles.question}>{prompt.definition}</h1>
          </> : state ? <>
            <h1>עדיין אין מילים לתרגול</h1><p className={study.definition}>כרטיסים יופיעו כאן אחרי שתכירו מילים במצב לימוד.</p>
          </> : <p role="status">{error ? "טעינת התרגול נכשלה" : "טוען תרגול…"}</p>}
        </div>
        {judgment && <button type="button" className={styles.flag} disabled={flagging} aria-pressed={judgment.disputed}
          onClick={() => void flag()}>{judgment.disputed ? "הדיווח נשמר · ביטול" :
          judgment.correct ? "הזיהוי האחרון אישר תשובה שגויה?" : "הזיהוי האחרון פסל תשובה נכונה?"}</button>}
      </section>

      <div className={styles.controls}>
        {(voice || feedback) && <p className={study.micStatus} role="status" data-listening={speech.listening}>{speech.micStatus}</p>}
        {error ? <p className={study.wrong} role="alert">{error}</p>
          : voice && !useTyping && !feedback && !judgePending && (speech.speechError || spoken) ? <p className={study.status}>
            {speech.speechError || spoken}
          </p> : null}
        {feedback ? <button type="button" className={study.primary} disabled={loading}
          onClick={() => { speech.stop(); void next(); }}>לכרטיס הבא</button>
          : !state && error ? <button className={study.primary} onClick={() => void next()}>ניסיון נוסף</button>
          : state && !prompt ? <Link className={study.primary} href="/learn">ללימוד מילים</Link>
          : prompt?.kind === "reverse_choice" ? <div className={study.choices}>
            {prompt.choices.map((choice) => <button className={study.secondary} key={choice.id} type="button"
              onClick={() => void submit({ kind: "tap", choice: choice.id })}>{choice.term}</button>)}
          </div>
          : judgePending ? <JudgeControls pending={judgePending} busy={selfBusy}
            onGrade={(correct) => void submitMeaning({ kind: "self", correct })} />
          : voice ? <>
            {useTyping ? <form className={study.typed} onSubmit={typeAnswer}>
              <label htmlFor="practice-answer">התשובה שלך</label>
              <input id="practice-answer" ref={inputField} maxLength={300} value={value} onChange={(event) => setValue(event.target.value)} />
              <button className={study.primary} type="submit" disabled={!value.trim()}>בדיקה</button>
            </form> : <button className={styles.mic} aria-pressed={speech.recording} data-listening={speech.listening}
              disabled={speech.finishing} onClick={() => speech.recording ? speech.finish() : speech.start()}>
              <Microphone />{speech.finishing ? "מסיים זיהוי…" : speech.recording ? "עצירת הקלטה" : "מענה בקול"}
            </button>}
            <div className={study.actions}>
              <button type="button" onClick={() => {
                speech.stop();
                queue.current = [];
                setTyped(!useTyping);
                setSpoken("");
              }}>{useTyping ? "מענה בקול" : "מענה בהקלדה"}</button>
              <button type="button" onClick={() => { speech.stop(); void submit({ kind: "skip" }); }}>לא יודע</button>
            </div>
          </> : null}
      </div>
    </main>
  );
}
