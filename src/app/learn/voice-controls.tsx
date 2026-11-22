"use client";

import type { FormEvent, RefObject } from "react";
import { Icon } from "../icons";
import ui from "../ui.module.css";
import { MicDisk, Transcript } from "./card";
import type { useSpeech } from "./use-speech";
import styles from "./study.module.css";

type Speech = ReturnType<typeof useSpeech>;

export function VoiceControls({ speech, typing, value, field, spoken, busy, inputId, onValue, onSubmit, onToggle, onSkip }: {
  speech: Speech; typing: boolean; value: string; field: RefObject<HTMLInputElement | null>; spoken: string;
  busy?: boolean; inputId: string; onValue: (value: string) => void; onSubmit: () => void; onToggle: () => void; onSkip: () => void;
}) {
  function submit(event: FormEvent) {
    event.preventDefault();
    if (value.trim()) onSubmit();
  }

  if (typing) return <>
    {speech.speechError ? <p className={styles.status}>{speech.speechError}</p> : <div className={styles.status} />}
    <form className={styles.typed} onSubmit={submit}>
      <button type="button" className={`${ui.iconButton} ${ui.quietIcon}`} aria-label="מענה בקול" disabled={busy} onClick={onToggle}>
        <Icon name="mic" />
      </button>
      <label htmlFor={inputId} className="visually-hidden">התשובה שלך</label>
      <input id={inputId} ref={field} maxLength={300} value={value} placeholder="הקלד את הפירוש" autoComplete="off"
        onChange={(event) => onValue(event.target.value)} />
      <button type="submit" className={styles.send} aria-label="בדיקה" disabled={busy || !value.trim()}><Icon name="send" size={22} /></button>
    </form>
    <div className={styles.row}>
      <button type="button" className={ui.quiet} disabled={busy} onClick={onSkip}>לא יודע</button>
    </div>
  </>;

  const error = !spoken && speech.speechError;
  return <>
    <Transcript tone={error ? "dim" : undefined} live={Boolean(spoken)}>{spoken || speech.speechError}</Transcript>
    <MicDisk state={speech.recording ? "listening" : speech.finishing ? "judging" : "rest"}
      label="מענה בקול · יש ללחוץ ולהחזיק" disabled={busy || speech.finishing}
      onPress={() => void speech.press()} onRelease={speech.release} />
    <p className={styles.status} role="status" data-listening={speech.listening}>{speech.micStatus}</p>
    {speech.showTranscriptionNotice && <p className={styles.status}>ההקלטה נשלחת לתמלול בזמן ההחזקה.</p>}
    <div className={styles.row}>
      <button type="button" className={ui.quiet} aria-label="מענה בהקלדה" disabled={busy} onClick={onToggle}>
        <Icon name="keyboard" />מקלדת
      </button>
      <button type="button" className={ui.quiet} disabled={busy} onClick={onSkip}>לא יודע</button>
    </div>
  </>;
}
