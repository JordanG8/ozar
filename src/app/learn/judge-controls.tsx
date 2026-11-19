import { MicDisk, Transcript } from "./card";
import styles from "./study.module.css";

export function JudgeControls({ pending, busy, transcript, onGrade }: {
  pending: "checking" | "self_grade"; busy: boolean; transcript?: string; onGrade: (correct: boolean) => void;
}) {
  if (pending === "checking") return <>
    <Transcript locked>{transcript}</Transcript>
    <MicDisk state="judging" label="בודק את התשובה" disabled />
    <p className={styles.status} role="status">בודק את משמעות התשובה…</p>
  </>;
  return <>
    <Transcript>{transcript}</Transcript>
    <p className={styles.status} role="status">השופט לא הגיב בזמן. איך היה?</p>
    <div className={styles.selfGrade}>
      <button type="button" disabled={busy} onClick={() => onGrade(true)}>צדקתי</button>
      <button type="button" disabled={busy} onClick={() => onGrade(false)}>טעיתי</button>
    </div>
  </>;
}
