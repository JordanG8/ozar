"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { decisionNudge, type AnswerInput, type AnswerReceipt, type Feedback, type InfiniteState, type MeaningInput } from "@/lib/learn/protocol";
import { Icon } from "../icons";
import ui from "../ui.module.css";
import { Choices, Definition, Example, MicDisk, Nudge, Rule, StudyCard, Tally, Term, Transcript, type Tone } from "../learn/card";
import card from "../learn/card.module.css";
import { JudgeControls } from "../learn/judge-controls";
import { request } from "../learn/request";
import { useJudge } from "../learn/use-judge";
import { useSpeech } from "../learn/use-speech";
import { VoiceControls } from "../learn/voice-controls";
import styles from "../learn/study.module.css";

const isMilestone = (combo: number) => combo === 10 || combo === 25 || combo === 50 || (combo > 50 && combo % 25 === 0);
const advanceMs = { correct: 900, partial: 1800, milestone: 1600 };

function clock(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function playFeedback(audio: AudioContext | null, correct: boolean, combo: number) {
  const milestone = correct && isMilestone(combo);
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
type Result = Feedback & { combo: number; brokenAt: number; picked: string | null; spoken: string; ms: number; goalReached: boolean };
const message = (cause: unknown) => cause instanceof Error ? cause.message : "אירעה תקלה. אפשר לנסות שוב.";
const call = <T,>(data: object) => request<T>({ mode: "infinite", ...data });

export function Practice() {
  const router = useRouter();
  const [state, setState] = useState<InfiniteState | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [goalScreen, setGoalScreen] = useState(false);
  const [typed, setTyped] = useState<boolean | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [spoken, setSpoken] = useState("");
  const [judgment, setJudgment] = useState<Judgment | null>(null);
  const [flagging, setFlagging] = useState(false);
  const [now, setNow] = useState(0);
  const [cardStart, setCardStart] = useState(0);
  const [loading, setLoading] = useState(false);
  const session = useRef<string | null>(null);
  const open = useRef(false);
  const active = useRef<string | null>(null);
  const posting = useRef(false);
  const queue = useRef<{ id: string; input: AnswerInput }[]>([]);
  const lastHeard = useRef("");
  const lastPick = useRef<string | null>(null);
  const said = useRef("");
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
    setGoalScreen(false);
    try {
      session.current ??= crypto.randomUUID();
      const upcoming = await call<InfiniteState>({ action: "next", sessionId: session.current });
      active.current = upcoming.prompt?.id ?? null;
      resetJudge(upcoming.prompt?.id, upcoming.judgePending);
      queue.current = [];
      lastHeard.current = "";
      lastPick.current = null;
      said.current = "";
      setState(upcoming);
      setResult(null);
      setValue("");
      setSpoken("");
      const time = Date.now();
      setNow(time);
      setCardStart(time);
    } catch (cause) {
      setError(message(cause));
    } finally {
      open.current = false;
      setLoading(false);
    }
  }, [resetJudge]);

  const advance = useCallback(() => {
    if (result?.goalReached && !goalScreen) setGoalScreen(true);
    else void next();
  }, [result, goalScreen, next]);

  useEffect(() => {
    void next();
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [next]);

  useEffect(() => {
    if (!result?.correct || goalScreen) return;
    const wait = isMilestone(result.combo) ? advanceMs.milestone : result.decision === "partial" ? advanceMs.partial : advanceMs.correct;
    const timer = window.setTimeout(advance, wait);
    return () => window.clearTimeout(timer);
  }, [result, goalScreen, advance]);

  useEffect(() => {
    if (useTyping && voice && !result && !judgePending) inputField.current?.focus();
  }, [useTyping, voice, result, judgePending]);

  useEffect(() => {
    function unlock() {
      try {
        if (window.AudioContext) {
          audio.current ??= new AudioContext();
          void audio.current.resume().catch(() => {});
        }
      } catch {
        // Visual feedback works in browsers without Web Audio.
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
    const ms = receipt.responseMs ?? Math.max(0, Date.now() - cardStart);
    playFeedback(audio.current, correct, combo);
    setState({
      ...state, combo, best: Math.max(state.best, combo),
      answers: state.answers + 1, correct: state.correct + Number(correct), today: state.today + 1,
      averageMs: (state.averageMs * state.answers + ms) / (state.answers + 1),
    });
    if (wasVoice) setJudgment({ promptId: id, disputed: false, correct });
    setResult({
      ...receipt.feedback, combo, brokenAt: state.combo, picked: lastPick.current, spoken: said.current, ms,
      goalReached: state.today < state.goal && state.today + 1 >= state.goal,
    });
  }

  async function submitMeaning(input: MeaningInput | { kind: "self"; correct: boolean }) {
    if (!voice || active.current !== voice) return;
    setError("");
    if (input.kind === "typed") said.current = input.value;
    if (input.kind === "voice") said.current = input.alternatives[0] ?? said.current;
    try {
      const receipt = await requestJudge(voice, input);
      if (receipt) accept(voice, receipt, input.kind === "voice" || (input.kind === "self" && !useTyping));
    } catch (cause) { setError(message(cause)); }
  }

  async function submit(input: AnswerInput) {
    if (!state || !prompt || active.current !== prompt.id) return;
    if (input.kind === "tap") lastPick.current = input.choice;
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
    said.current = alternatives[0];
    setSpoken(alternatives[0]);
    void submit({ kind: "voice", alternatives, final: false });
  }

  const speech = useSpeech(voice,
    Boolean(voice && !useTyping && !result && !loading && !judgePending), heard);

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

  function end() {
    speech.stop();
    router.push(state?.answers && session.current ? `/sessions/${session.current}/summary` : "/");
  }

  const tone: Tone = !result ? "idle" : !result.correct ? "wrong"
    : isMilestone(result.combo) ? "milestone" : result.decision === "partial" ? "partial" : "correct";
  const cardTone = !result ? undefined : result.correct ? (result.decision === "partial" ? "partial" : "correct") : "wrong";
  const cardMs = result ? result.ms : prompt ? now - cardStart : 0;
  const accuracy = state?.answers ? `${Math.round(state.correct / state.answers * 100)}%` : "—";
  const reverse = prompt?.kind === "reverse_choice" ? prompt : null;

  return (
    <main className={styles.shell}>
      <header className={styles.stats}>
        <button type="button" className={`${ui.iconButton} ${styles.close}`} aria-label="סיום סשן" onClick={end}><Icon name="close" /></button>
        <dl aria-label="נתוני הסשן">
          <div><dt>סשן</dt><dd>{state?.startedAt ? clock(now - Date.parse(state.startedAt)) : "00:00"}</dd></div>
          <div><dt>כרטיס</dt><dd data-tone={cardTone}>{prompt ? (cardMs / 1000).toFixed(1) : "—"}</dd></div>
          <div><dt>ממוצע</dt><dd>{state?.answers ? (state.averageMs / 1000).toFixed(1) : "—"}</dd></div>
          <div><dt>דיוק</dt><dd>{accuracy}</dd></div>
        </dl>
      </header>

      <div className={styles.stage}>
        {goalScreen && state ? <section className={styles.end} aria-live="polite">
          <div className={styles.goal}>
            <svg viewBox="0 0 248 248" aria-hidden="true"><circle cx="124" cy="124" r="122" pathLength="100" /><circle cx="124" cy="124" r="122" pathLength="100" /></svg>
            <div className={styles.goalDisk}><span><Icon name="check" size={40} /></span><bdi>{state.goal} מתוך {state.goal}</bdi></div>
          </div>
          <h1 className={styles.goalTitle} tabIndex={-1}>סיימת להיום</h1>
          <p className={ui.lede}>{state.answers} תשובות בסשן · {accuracy} דיוק</p>
        </section> : result && isMilestone(result.combo) ? <StudyCard tone="milestone" kind={prompt?.kind} verdict={cardTone}>
          <Tally count={result.combo} large />
          <span className={card.milestoneNumber}>{result.combo}</span>
          <p className={card.milestoneLabel}>ברצף</p>
          <p className={card.ask}>השיא שלך: {state?.best}</p>
          <span className="visually-hidden">{result.term}: {result.definition}</span>
        </StudyCard> : result ? <StudyCard tone={tone} kind={prompt?.kind} verdict={cardTone}
          top={result.correct ? <Tally count={result.combo} /> : result.brokenAt > 0 ? <span>הרצף נעצר ב־{result.brokenAt}</span> : null}>
          {reverse && <p className={card.ask}>{reverse.definition}</p>}
          <Term>{result.term}</Term>
          <Rule />
          <Definition>{result.definition}</Definition>
          {result.decision === "partial" && <Nudge>{decisionNudge("partial")}</Nudge>}
          {!result.correct && <Example example={result.example} term={result.term} />}
        </StudyCard> : voice && prompt?.kind === "voice_meaning" ? <StudyCard kind="voice_meaning" compact={useTyping}
          top={<Tally count={state?.combo ?? 0} />}>
          <Term>{prompt.term}</Term>
          <Rule />
        </StudyCard> : reverse ? <StudyCard kind="reverse_choice" top={<Tally count={state?.combo ?? 0} />}>
          <p className={card.ask}>איזה ביטוי?</p>
          <h1 className={card.question} tabIndex={-1}>{reverse.definition}</h1>
        </StudyCard> : state ? <StudyCard>
          <h1 className={card.question}>עדיין אין מילים לתרגול</h1>
          <p className={card.ask}>כרטיסים יופיעו כאן אחרי שתכירו מילים במצב למידה.</p>
        </StudyCard> : <StudyCard>
          <p role="status" className={card.ask}>{error ? "טעינת התרגול נכשלה" : "טוען תרגול…"}</p>
        </StudyCard>}
      </div>

      <footer className={styles.controls} data-layout={reverse || goalScreen || (state && !prompt) ? "end" : undefined}>
        {error && <p className={styles.alert} role="alert">{error}</p>}
        {goalScreen ? <>
          <button type="button" className={ui.primary} onClick={() => void next()}>להמשיך באינסופי</button>
          <button type="button" className={ui.quiet} onClick={end}>מספיק להיום</button>
        </> : result ? <>
          {reverse ? <Choices choices={reverse.choices} picked={result.picked} answer={result.term} onPick={() => {}} />
            : result.correct ? <Transcript tone="dim">{result.spoken}</Transcript>
            : <Transcript tone="dim">{result.spoken ? <>אמרת: <s>{result.spoken}</s></> : null}</Transcript>}
          {reverse ? <button type="button" className={ui.quiet} disabled={loading} onClick={() => { speech.stop(); void next(); }}>לכרטיס הבא</button>
            : <MicDisk state={result.correct ? "countdown" : "continue"} runKey={prompt?.id}
              tone={tone === "milestone" ? "milestone" : result.decision === "partial" ? "partial" : "correct"}
              duration={isMilestone(result.combo) ? advanceMs.milestone : result.decision === "partial" ? advanceMs.partial : advanceMs.correct}
              label="לכרטיס הבא" disabled={loading} onClick={() => { speech.stop(); advance(); }} />}
          {!reverse && <p className={styles.status} role="status">{speech.micStatus}</p>}
          {judgment && <button type="button" className={styles.flag} disabled={flagging} aria-pressed={judgment.disputed}
            onClick={() => void flag()}>{judgment.disputed ? "הדיווח נשמר · ביטול" :
              judgment.correct ? "הזיהוי אישר תשובה שגויה?" : "הזיהוי פסל תשובה נכונה?"}</button>}
        </> : !state && error ? <button type="button" className={ui.primary} onClick={() => void next()}>ניסיון נוסף</button>
          : state && !prompt ? <Link className={ui.primary} href="/learn">ללמידת מילים</Link>
          : reverse ? <Choices choices={reverse.choices} onPick={(choice) => void submit({ kind: "tap", choice })} />
          : judgePending ? <JudgeControls pending={judgePending} busy={selfBusy} transcript={spoken || value}
            onGrade={(correct) => void submitMeaning({ kind: "self", correct })} />
          : voice ? <VoiceControls speech={speech} typing={useTyping} value={value} field={inputField} spoken={spoken}
            inputId="practice-answer" onValue={setValue}
            onSubmit={() => void submitMeaning({ kind: "typed", value })}
            onToggle={() => { speech.stop(); queue.current = []; setTyped(!useTyping); setSpoken(""); said.current = ""; }}
            onSkip={() => { speech.stop(); void submit({ kind: "skip" }); }} />
          : <MicDisk state="judging" label="טוען" disabled />}
      </footer>
    </main>
  );
}
