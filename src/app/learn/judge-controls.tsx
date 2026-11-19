import styles from "./study.module.css";

export function JudgeControls({ pending, busy, onGrade }: {
  pending: "checking" | "self_grade"; busy: boolean; onGrade: (correct: boolean) => void;
}) {
  if (pending === "checking") return <p className={styles.status} role="status">בודק את משמעות התשובה…</p>;
  return <div>
    <p className={styles.status} role="status">אפשר לסמן אם ידעת את המשמעות.</p>
    <div className={styles.choices}>
      <button type="button" className={styles.primary} disabled={busy} onClick={() => onGrade(true)}>ידעתי</button>
      <button type="button" className={styles.secondary} disabled={busy} onClick={() => onGrade(false)}>לא ידעתי</button>
    </div>
  </div>;
}
