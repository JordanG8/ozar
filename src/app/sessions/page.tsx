import Link from "next/link";
import { Suspense } from "react";
import { listSessions, sessionPageSize } from "@/lib/sessions";
import { LoadingStudy, StudyAccess } from "../study-access";
import styles from "../manage.module.css";
import { formatSessionDate, modeLabel, pageNumber, Pagination, SessionMetrics } from "./shared";

export default function SessionsPage({ searchParams }: PageProps<"/sessions">) {
  return <Suspense fallback={<LoadingStudy />}>
    <StudyAccess path="/sessions">{async ({ id }) => {
      const page = pageNumber((await searchParams).page);
      const records = await listSessions(id, page);
      return <main className={styles.shell}>
        <nav className={styles.nav}><Link href="/?menu=1">אוצר</Link><Link href="/infinite">תרגול רציף</Link></nav>
        <h1 className={styles.heading}>יומן תרגול</h1>
        {!records.length && <p className={styles.muted}>אין אימונים להצגה כאן.</p>}
        <ul className={styles.list}>
          {records.slice(0, sessionPageSize).map((session) => <li key={session.id}>
            <Link className={styles.entry} href={`/sessions/${session.id}`}>
              <div className={styles.row}><strong>{modeLabel(session.mode)}</strong>
                <time dateTime={session.startedAt.toISOString()}>{formatSessionDate(session.startedAt)}</time></div>
              <SessionMetrics session={session} />
            </Link>
          </li>)}
        </ul>
        <Pagination page={page} path="/sessions" more={records.length > sessionPageSize} />
      </main>;
    }}</StudyAccess>
  </Suspense>;
}
