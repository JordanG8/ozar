"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { decisionNudge, type AnswerInput, type AnswerReceipt, type Feedback, type MeaningInput, type StudyState } from "@/lib/learn/protocol";
import { Icon } from "../icons";
import ui from "../ui.module.css";
import { feel } from "../feel";
import { Choices, ContinueDisk, Definition, Example, Nudge, Rule, StudyCard, Term, Transcript } from "./card";
import card from "./card.module.css";
import { JudgeControls } from "./judge-controls";
import { request } from "./request";
import { useJudge } from "./use-judge";
import { useSpeech } from "./use-speech";
import { VoiceControls } from "./voice-controls";
import styles from "./study.module.css";

type Hint = { hintLevel: number; example: string | null; letters: string | null };
type Deck = { id: string; name: string; size: number; seen: number };
type Result = Feedback & { picked: string | null };

function HintExample({ text }: { text: string }) {
  const parts = text.split("____");
  return <p>{parts.map((part, index) => <span key={index}>{part}{index < parts.length - 1 &&
    <span className={card.blank} role="img" aria-label="מילה חסרה" />}</span>)}</p>;
}

export function Study({ decks, initialDeck }: { decks: Deck[]; initialDeck?: string }) {
  const [deckId, setDeckId] = useState(initialDeck);
  const [state, setState] = useState<StudyState | null>(null);
  const [result, setResult] = useState<Result | null>(null);
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
  const picked = useRef<string | null>(null);
  const speechInFlight = useRef(false);
  const speechPending = useRef<{ promptId: string; input: AnswerInput } | null>(null);
  const lastSpoken = useRef("");
  const streak = useRef(0);
  const judge = useJudge("learn");

  function showError(cause: unknown) {
    setError(cause instanceof Error ? cause.message : "אירעה תקלה. אפשר לנסות שוב.");
  }

  async function show(action: "start" | "next") {
    const data = await request<StudyState>({ action, deckId });
    active.current = data.prompt?.id ?? null;
    picked.current = null;
    judge.reset(data.prompt?.id, data.judgePending);
    speechPending.current = null;
    lastSpoken.current = "";
    setState(data);
    setResult(null);
    setHint(null);
    setValue("");
    setSpoken("");
    if (data.hintLevel && data.prompt?.kind === "voice_meaning") {
      setHint(await request<Hint>({ action: "hint", level: data.hintLevel, promptId: data.prompt.id }));
    }
  }

  function accept(feedback: Feedback) {
    if (active.current) {
      streak.current = feedback.correct ? streak.current + 1 : 0;
      feel(!feedback.correct ? "wrong" : feedback.decision === "partial" ? "partial" : "correct", { step: streak.current, gesture: true });
    }
    active.current = null;
    judge.reset();
    speechPending.current = null;
    setResult({ ...feedback, picked: picked.current });
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
      const receipt = await judge.submit(voicePrompt, input);
      if (receipt?.feedback && active.current === voicePrompt) accept(receipt.feedback);
    } catch (cause) { showError(cause); }
  }

  async function processSpeech(alternatives: string[], ended: boolean) {
    if (!voicePrompt || active.current !== voicePrompt) return;
    if (ended) {
      speechPending.current = null;
      setSpoken(alternatives[0]);
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
        const receipt = await request<AnswerReceipt>({ action: "answer", ...pending });
        if (receipt.feedback && active.current === pending.promptId) accept(receipt.feedback);
      }
    } catch (cause) {
      showError(cause);
      lastSpoken.current = "";
    } finally {
      speechInFlight.current = false;
    }
  }

  const speech = useSpeech(voicePrompt, Boolean(voicePrompt && speechReady && !useTyping && !result && !judge.pending), processSpeech);

  async function submit(input: AnswerInput) {
    if (!prompt) return;
    speech.stop();
    if (input.kind === "tap") picked.current = input.choice;
    const receipt = await request<AnswerReceipt>({ action: "answer", promptId: prompt.id, input });
    if (receipt.feedback) accept(receipt.feedback);
    else if (receipt.accepted) await show("next");
  }

  useEffect(() => {
    if (state) title.current?.focus();
  }, [state, result]);

  useEffect(() => {
    if (useTyping && voicePrompt && !judge.pending && !result) field.current?.focus();
  }, [useTyping, voicePrompt, judge.pending, result]);

  const hintLevel = hint?.hintLevel ?? state?.hintLevel ?? 0;
  const progressed = state ? state.total - state.remaining : 0;
  const reverse = prompt?.kind === "reverse_choice" ? prompt : null;
  const tone = !result ? "idle" : !result.correct ? "wrong" : result.decision === "partial" ? "partial" : "correct";
  const position = state ? Math.min(state.total, progressed + (prompt ? 1 : 0)) : 0;

  return (
    <main className={styles.shell}>
      <header className={styles.progressHead}>
        <Link className={`${ui.iconButton} ${styles.close}`} href="/" aria-label="סיום מנת הלמידה"><Icon name="close" /></Link>
        <div className={styles.progressMeta}>
          <strong>למידה</strong>
          {state && state.total > 0 && prompt ? <span>מילה <bdi>{position}</bdi> מתוך <bdi>{state.total}</bdi></span> : null}
        </div>
        <div className={styles.progress} role="progressbar" aria-label="התקדמות הלמידה" aria-valuemin={0}
          aria-valuemax={state?.total || 1} aria-valuenow={progressed}>
          <i style={{ width: `${state?.total ? progressed / state.total * 100 : 0}%` }} />
        </div>
      </header>

      <div className={styles.stage}>
        {!state ? <section className={styles.start}>
          <h1 ref={title} tabIndex={-1}>מנת הלמידה של היום</h1>
          <p className={ui.lede}>מילים חדשות, אחת אחרי השנייה: היכרות, שליפה בקול ובחירה הפוכה.</p>
          {decks.length > 1 && <label className={ui.label}>חפיסה ללימוד
            <select className={styles.select} disabled={busy} value={deckId} onChange={(event) => setDeckId(event.target.value)}>
              {decks.map((deck) => <option key={deck.id} value={deck.id}>{deck.name} · {deck.size} מילים</option>)}
            </select>
          </label>}
        </section> : result ? <StudyCard tone={tone} kind={prompt?.kind} verdict={tone}
          bottom={reverse && !result.correct ? <p className={card.ask}><b>{result.term}</b>. נחזור אליה בעוד כמה כרטיסים</p> : undefined}>
          <Term size="learn" ref={title}>{result.term}</Term>
          <Rule />
          <Definition>{result.definition}</Definition>
          {result.decision && decisionNudge(result.decision) && <Nudge>{decisionNudge(result.decision)}</Nudge>}
          <Example example={result.example} term={result.term} />
        </StudyCard> : !prompt ? <section className={styles.end}>
          <h1 ref={title} tabIndex={-1}>סיימת את מנת הלמידה</h1>
          <span className={styles.endNumber}>{state.total}</span>
          <p className={styles.endLabel}>{state.total ? "מילים חדשות נכנסו לסבב" : "אין מילים חדשות להיום"}</p>
        </section> : prompt.kind === "intro" ? <StudyCard kind="intro" top="מילה חדשה">
          <h1 ref={title} tabIndex={-1} className={`${card.term} ${card.learnTerm}`}>{prompt.term}</h1>
          <Definition>{prompt.definition}</Definition>
          <Rule />
          <Example example={prompt.example} term={prompt.term} />
        </StudyCard> : prompt.kind === "voice_meaning" ? <StudyCard kind="voice_meaning" compact={useTyping}
          bottom={<button type="button" className={card.hintButton} disabled={busy || hintLevel >= 2}
            onClick={() => void run(async () => {
              feel("tick", { gesture: true });
              setHint(await request<Hint>({ action: "hint", level: hintLevel + 1, promptId: prompt.id }));
            })}><Icon name="hint" size={18} />{hintLevel >= 2 ? "אין עוד רמזים" : `רמז · ${2 - hintLevel} נותרו`}</button>}>
          <h1 ref={title} tabIndex={-1} className={`${card.term} ${card.learnTerm}`}>{prompt.term}</h1>
          {hint && <><Rule />
            <div className={card.hint} aria-live="polite"><span>רמז 1 · דוגמה</span>
              {hint.example ? <HintExample text={hint.example} /> : <p>אין דוגמה זמינה לרמז הזה.</p>}</div>
            {hint.letters && <div className={card.hint}><span>רמז 2 · אותיות ראשונות</span>
              <p className={card.letters} aria-label={hint.letters}>{hint.letters.split(" · ").map((letter, index) =>
                <span key={index} aria-hidden="true">{letter}</span>)}</p></div>}
          </>}
        </StudyCard> : <StudyCard kind="reverse_choice">
          <p className={card.ask}>איזה ביטוי מתאים?</p>
          <h1 className={card.question} ref={title} tabIndex={-1}>{prompt.definition}</h1>
        </StudyCard>}
      </div>

      <footer className={styles.controls} data-layout={!voicePrompt || (result && reverse) ? "end" : undefined}>
        {error && <p className={styles.alert} role="alert">{error}</p>}
        {!state ? <>
          <button type="button" className={ui.primary} disabled={busy} onClick={() => void run(async () => {
            setSpeechReady(true);
            await show("start");
          })}>התחלה או המשך</button>
          <Link className={ui.quiet} href="/decks/import"><Icon name="upload" size={18} />ייבוא מילים</Link>
        </> : result ? <>
          {reverse ? <Choices choices={reverse.choices} picked={result.picked} answer={result.term} onPick={() => {}} />
            : <Transcript tone="dim">{spoken || value ? <>{spoken ? "אמרת" : "כתבת"}: <bdi>{spoken || value}</bdi></> : null}</Transcript>}
          <ContinueDisk key={prompt?.id} tone={tone === "idle" ? "correct" : tone} from={reverse || useTyping ? "none" : "mic"} compact={Boolean(reverse)}
            loadMs={tone === "wrong" ? 1100 : tone === "partial" ? 900 : 650} label="הכרטיס הבא" busy={busy}
            onContinue={() => void run(() => show("next"))} />
        </> : !prompt ? <>
          <Link href="/infinite" className={ui.primary}>להמשיך לאינסופי</Link>
          {decks.length > 1 ? <button type="button" className={ui.quiet} onClick={() => setState(null)}>בחירת חפיסה</button>
            : <Link href="/" className={ui.quiet}>לסיים להיום</Link>}
        </> : prompt.kind === "intro" ? <button type="button" className={ui.primary} disabled={busy}
          onClick={() => { feel("next", { gesture: true }); void run(() => submit({ kind: "continue" })); }}>הבנתי</button>
          : reverse ? <Choices choices={reverse.choices} disabled={busy}
            onPick={(choice) => void run(() => submit({ kind: "tap", choice }))} />
          : judge.pending ? <JudgeControls pending={judge.pending} busy={judge.selfBusy} transcript={spoken || value}
            onGrade={(correct) => void submitMeaning({ kind: "self", correct })} />
          : <VoiceControls speech={speech} typing={useTyping} value={value} field={field} spoken={spoken} busy={busy}
            inputId="meaning" onValue={setValue}
            onSubmit={() => void submitMeaning({ kind: "typed", value })}
            onToggle={() => { speech.stop(); setSpoken(""); setTyped(!useTyping); }}
            onSkip={() => void run(() => submit({ kind: "skip" }))} />}
      </footer>
    </main>
  );
}
