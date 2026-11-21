import type { ButtonHTMLAttributes, CSSProperties, ReactNode, Ref } from "react";
import { exampleParts } from "@/lib/learn/matcher";
import { Icon } from "../icons";
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

export type DiskState = "listening" | "rest" | "judging" | "countdown" | "continue" | "off";

const holdKeys = new Set([" ", "Enter"]);

export function MicDisk({ state, tone = "correct", duration = 900, label, onClick, onPress, onRelease, disabled, runKey }: {
  state: DiskState; tone?: Tone; duration?: number; label: string; onClick?: () => void; disabled?: boolean; runKey?: string;
  /** Press-and-hold mode: onPress on the way down, onRelease when the pointer or key lifts. */
  onPress?: () => void; onRelease?: () => void;
}) {
  const icon = state === "countdown" ? "check" : state === "off" ? "micOff" : "mic";
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
    <div className={styles.diskWrap} data-state={state} data-tone={tone}>
      {state === "listening" && <><i aria-hidden="true" className={styles.wave} /><i aria-hidden="true" className={`${styles.wave} ${styles.late}`} /></>}
      {state === "countdown" && <svg key={runKey} aria-hidden="true" className={styles.timer} viewBox="0 0 112 112"
        style={{ "--duration": `${duration}ms` } as CSSProperties}>
        <circle cx="56" cy="56" r="54" pathLength="100" className={styles.timerTrack} />
        <circle cx="56" cy="56" r="54" pathLength="100" className={styles.timerArc} />
      </svg>}
      <button type="button" className={styles.disk} aria-label={label}
        aria-pressed={onPress ? state === "listening" : state === "listening" ? true : undefined}
        data-hold={onPress ? true : undefined} disabled={disabled} {...hold}>
        <Icon name={icon} size={30} />
      </button>
    </div>
  );
}

export function Transcript({ children, locked, struck, tone }: {
  children?: ReactNode; locked?: boolean; struck?: boolean; tone?: "dim" | "wrong";
}) {
  return (
    <div className={styles.transcript} data-locked={locked} data-tone={tone}>
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
