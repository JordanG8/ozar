import Link from "next/link";
import type { sessions } from "@/lib/db/schema";
import styles from "../manage.module.css";

const formatter = new Intl.DateTimeFormat("he-IL", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jerusalem",
});

export function formatSessionDate(date: Date) {
  return formatter.format(date);
}

export function modeLabel(mode: "infinite" | "learn") {
  return mode === "infinite" ? "תרגול רציף" : "לימוד";
}

export function SessionMetrics({ session }: { session: typeof sessions.$inferSelect }) {
  const seconds = Math.floor(session.durationMs / 1000);
  return <dl className={styles.metrics}>
    <div><dt>משך</dt><dd><bdi>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</bdi></dd></div>
    <div><dt>תשובות</dt><dd>{session.answers}</dd></div>
    <div><dt>דיוק</dt><dd><bdi>{Math.round((session.accuracy ?? 0) * 100)}%</bdi></dd></div>
    <div><dt>קושי</dt><dd>{session.difficulty1To10?.toFixed(1) ?? "—"}</dd></div>
  </dl>;
}

export function pageNumber(value: string | string[] | undefined) {
  const page = typeof value === "string" && /^[1-9]\d{0,5}$/u.test(value) ? Number(value) : 1;
  return page;
}

export function Pagination({ page, path, more }: { page: number; path: string; more: boolean }) {
  if (page === 1 && !more) return null;
  return <nav aria-label="עמודים" className={styles.pagination}>
    {page > 1 && <Link href={`${path}?page=${page - 1}`}>לעמוד הקודם</Link>}
    <span>עמוד {page}</span>
    {more && <Link href={`${path}?page=${page + 1}`}>לעמוד הבא</Link>}
  </nav>;
}
