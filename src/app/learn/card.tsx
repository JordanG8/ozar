"use client";

import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode, type Ref } from "react";
import { exampleParts } from "@/lib/learn/matcher";
import { feel } from "../feel";
import { Icon } from "../icons";
import { Glyph, type GlyphShape } from "./glyph";
import styles from "./card.module.css";

export type Tone = "idle" | "correct" | "partial" | "wrong" | "milestone";

export function StudyCard({ tone = "idle", kind, verdict, top, bottom, compact, children }: {
  tone?: Tone; kind?: string; verdict?: string; top?: ReactNode; bottom?: ReactNode; compact?: boolean; children: ReactNode;
}) {
  return (
    <section className={`${styles.card} ${compact ? styles.compact : ""}`} data-tone={tone} data-kind={kind}
      data-verdict={verdict} aria-label="כרטיס">
      <div className={styles.top}>{top}</div>
      <div className={styles.content}>{children}</div>
      {bottom ? <div className={styles.bottom}>{bottom}</div> : <div className={styles.top} />}
    </section>
  );
}

export function Term({ children, size = "infinite", ref }: {
  children: ReactNode; size?: "infinite" | "learn"; ref?: Ref<HTMLHeadingElement>;
}) {
  return <h1 ref={ref} className={`${styles.term} ${size === "learn" ? styles.learnTerm : ""}`} tabIndex={-1}>{children}</h1>;
}

export function Rule() {
  return <div aria-hidden="true" className={styles.rule} />;
}

export function Definition({ children }: { children: ReactNode }) {
  return <p className={`${styles.definition} ${styles.rise}`}>{children}</p>;
}

export function Example({ example, term }: { example: string | null; term: string }) {
  if (!example) return null;
  const parts = exampleParts(example, term);
  return <p className={`${styles.example} ${styles.rise}`}>{parts.map(({ text, highlighted, start }) =>
    highlighted ? <strong key={start}>{text}</strong> : text)}</p>;
}

export function Nudge({ children }: { children: ReactNode }) {
  return <p className={`${styles.nudge} ${styles.rise}`}>{children}</p>;
}

// Combo as tally marks in amber groups of five.
export function Tally({ count, large }: { count: number; large?: boolean }) {
  if (count <= 0) return null;
  const marks = Math.min(count, 25);
  const groups = Math.floor(marks / 5);
  const rest = marks % 5;
  let path = "";
  for (let group = 0; group < groups; group++) {
    const x = group * 24;
    path += `M${x + 2} 1v14M${x + 6} 1v14M${x + 10} 1v14M${x + 14} 1v14M${x} 13L${x + 16} 3`;
  }
  for (let mark = 0; mark < rest; mark++) path += `M${groups * 24 + 2 + mark * 4} 1v14`;
  const width = groups * 24 + (rest ? rest * 4 : -8);
  return (
    <span className={`${styles.tally} ${large ? styles.tallyLarge : ""}`}>
      <svg aria-hidden="true" width={width * (large ? 1.6 : 1)} height={16 * (large ? 1.6 : 1)} viewBox={`0 0 ${width} 16`}
        fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><path d={path} /></svg>
      {!large && <span className={styles.tallyCount} aria-hidden="true">{count}</span>}
      <span className="visually-hidden">רצף של {count}</span>
    </span>
  );
}

export type DiskState = "listening" | "rest" | "judging" | "off";

const holdKeys = new Set([" ", "Enter"]);

// The continue disk hands its arrows to the next card's mic disk, which morphs them back into the mic.
let continuedAt = -Infinity;
const handedOff = () => typeof performance !== "undefined" && performance.now() - continuedAt < 1500;

export function MicDisk({ state, label, onClick, onPress, onRelease, disabled }: {
  state: DiskState; label: string; onClick?: () => void; disabled?: boolean;
  /** Press-and-hold mode: onPress on the way down, onRelease when the pointer or key lifts. */
  onPress?: () => void; onRelease?: () => void;
}) {
  const [initial] = useState<GlyphShape>(() => handedOff() ? "arrows" : "mic");
  const hold: ButtonHTMLAttributes<HTMLButtonElement> = onPress ? {
    onPointerDown: (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      onPress();
    },
    onPointerUp: onRelease,
    onPointerCancel: onRelease,
    onLostPointerCapture: onRelease,
    onBlur: onRelease,
    onKeyDown: (event) => {
      if (!holdKeys.has(event.key)) return;
      event.preventDefault();
      if (!event.repeat) onPress();
    },
    onKeyUp: (event) => {
      if (!holdKeys.has(event.key)) return;
      event.preventDefault();
      onRelease?.();
    },
    onContextMenu: (event) => event.preventDefault(),
  } : { onClick };
  return (
    <div className={styles.diskWrap} data-state={state}>
      {state === "listening" && <><i aria-hidden="true" className={styles.wave} /><i aria-hidden="true" className={`${styles.wave} ${styles.late}`} /></>}
      {state === "judging" && <Ring />}
      <button type="button" className={styles.disk} aria-label={label}
        aria-pressed={onPress ? state === "listening" : state === "listening" ? true : undefined}
        data-hold={onPress ? true : undefined} disabled={disabled} {...hold}>
        {state === "off" ? <Icon name="micOff" size={30} /> : <Glyph to="mic" initial={initial} />}
      </button>
    </div>
  );
}

function Ring({ duration }: { duration?: number }) {
  return <svg aria-hidden="true" className={styles.ring} viewBox="0 0 112 112"
    style={duration ? { "--load": `${duration}ms` } as CSSProperties : undefined}>
    <circle cx="56" cy="56" r="54" pathLength="100" className={styles.ringTrack} />
    <circle cx="56" cy="56" r="54" pathLength="100" className={styles.ringArc} />
  </svg>;
}

const interactive = "input, textarea, select, button, a, [contenteditable]";

/**
 * After a verdict the thumb disk never moves on by itself. A ring loads around it while the card is
 * read, then the mic folds into a double chevron that nudges twice toward the next card and waits
 * for a tap (or Enter). With from="none" (no mic was there) the chevrons draw themselves in.
 */
export function ContinueDisk({ tone, from, loadMs, label, busy, compact, onContinue }: {
  tone: Tone; from: "mic" | "none"; loadMs: number; label: string; busy?: boolean;
  /** Under the answer choices, where height is short: a smaller disk and no hint line. */
  compact?: boolean; onContinue: () => void;
}) {
  const [phase, setPhase] = useState<"loading" | "ready" | "nudge">("loading");
  const [spinning, setSpinning] = useState(false);
  const used = useRef(false);
  const go = useRef(onContinue);
  useEffect(() => { go.current = onContinue; }, [onContinue]);

  useEffect(() => {
    const quiet = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => setPhase("ready"), quiet ? Math.min(loadMs, 400) : loadMs);
    return () => window.clearTimeout(timer);
  }, [loadMs]);

  useEffect(() => {
    if (phase !== "nudge") return;
    // Felt on each push of the nudge, which peaks at 18% and 58% of its 700 ms.
    const timer = window.setTimeout(() => feel("nudge"), 126);
    return () => window.clearTimeout(timer);
  }, [phase]);

  // A slow next card turns the ring into a spinner, but a fast one never flashes it.
  useEffect(() => {
    if (!busy) return;
    const timer = window.setTimeout(() => setSpinning(true), 150);
    return () => { window.clearTimeout(timer); setSpinning(false); };
  }, [busy]);

  const ready = phase !== "loading" && !busy;
  const proceed = useCallback(() => {
    if (used.current) return;
    used.current = true;
    continuedAt = performance.now();
    feel("next", { gesture: true });
    go.current();
  }, []);

  useEffect(() => {
    if (!ready) return;
    used.current = false;
    function key(event: KeyboardEvent) {
      if (event.key !== "Enter" || event.repeat || (event.target as Element | null)?.closest?.(interactive)) return;
      event.preventDefault();
      proceed();
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [ready, proceed]);

  const arrived = useCallback(() => setPhase("nudge"), []);
  return <>
    <div className={styles.diskWrap} data-state="continue" data-tone={tone} data-phase={phase} data-busy={spinning || undefined}
      data-size={compact ? "compact" : undefined}>
      <Ring duration={loadMs} />
      <button type="button" className={styles.disk} aria-label={label} disabled={!ready} onClick={proceed}>
        {from === "mic" ? <Glyph initial="mic" to={phase === "loading" ? "mic" : "arrows"} onArrive={arrived} />
          : phase !== "loading" ? <Glyph to="arrows" draw onArrive={arrived} /> : null}
      </button>
    </div>
    {!compact && <p className={styles.continueHint} data-shown={phase === "nudge" || undefined}>הקישו להמשך</p>}
  </>;
}

export function Transcript({ children, locked, struck, tone, live }: {
  children?: ReactNode; locked?: boolean; struck?: boolean; tone?: "dim" | "wrong"; live?: boolean;
}) {
  return (
    <div className={styles.transcript} data-locked={locked} data-tone={tone} data-live={live || undefined}
      aria-live={live ? "polite" : undefined}>
      <p>{struck ? <s>{children}</s> : children}</p>
      {locked && <div aria-hidden="true" className={styles.sweep}><i /></div>}
    </div>
  );
}

export function Choices({ choices, picked, answer, disabled, onPick }: {
  choices: { id: string; term: string }[]; picked?: string | null; answer?: string | null;
  disabled?: boolean; onPick: (id: string) => void;
}) {
  const settled = Boolean(answer);
  return (
    <div className={styles.choices}>
      {choices.map((choice) => {
        const state = !settled ? undefined : choice.term === answer ? "correct" : choice.id === picked ? "wrong" : "dim";
        return <button type="button" key={choice.id} data-state={state} disabled={disabled || settled}
          onClick={() => onPick(choice.id)}>{choice.term}</button>;
      })}
    </div>
  );
}
