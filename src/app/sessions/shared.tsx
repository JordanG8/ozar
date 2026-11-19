import Link from "next/link";
import type { sessions } from "@/lib/db/schema";
import styles from "./sessions.module.css";

type Session = typeof sessions.$inferSelect;
const zone = "Asia/Jerusalem";
const time = new Intl.DateTimeFormat("he-IL", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zone });
const day = new Intl.DateTimeFormat("en-CA", { timeZone: zone });
const weekday = new Intl.DateTimeFormat("he-IL", { weekday: "narrow", timeZone: zone });
const dayMonth = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", timeZone: zone });

export function formatSessionDate(date: Date, now = new Date()) {
  const key = day.format(date);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const label = key === day.format(now) ? "היום" : key === day.format(yesterday) ? "אתמול"
    : `${weekday.format(date)} ${dayMonth.format(date)}`;
  return `${label}, ${time.format(date)}`;
}

export function modeLabel(mode: "infinite" | "learn") {
  return mode === "infinite" ? "אינסופי" : "למידה";
}

export function duration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function accuracy(session: Session) {
  return `${Math.round((session.accuracy ?? 0) * 100)}%`;
}

export function difficulty(session: Session) {
  return session.difficulty1To10 === null ? "—" : `${Math.round(session.difficulty1To10)}/10`;
}

export function sessionMeta(session: Session, withAccuracy = false) {
  return [modeLabel(session.mode), duration(session.durationMs), `${session.answers} תשובות`,
    ...(withAccuracy ? [accuracy(session)] : []), `קושי ${difficulty(session)}`].join(" · ");
}

export function pageNumber(value: string | string[] | undefined) {
  return typeof value === "string" && /^[1-9]\d{0,5}$/u.test(value) ? Number(value) : 1;
}

export function Pagination({ page, path, more }: { page: number; path: string; more: boolean }) {
  if (page === 1 && !more) return null;
  return <nav aria-label="עמודים" className={styles.pagination}>
    {page > 1 ? <Link href={`${path}?page=${page - 1}`}>הקודם</Link> : <span />}
    <span>עמוד {page}</span>
    {more ? <Link href={`${path}?page=${page + 1}`}>הבא</Link> : <span />}
  </nav>;
}
