import Link from "next/link";
import { Suspense } from "react";
import { listSessions, sessionPageSize } from "@/lib/sessions";
import { LoadingStudy, StudyAccess } from "../study-access";
import { Notice, TopBar } from "../ui";
import ui from "../ui.module.css";
import styles from "./sessions.module.css";
import { accuracy, formatSessionDate, pageNumber, Pagination, sessionMeta } from "./shared";

export default function SessionsPage({ searchParams }: PageProps<"/sessions">) {
  return <Suspense fallback={<LoadingStudy />}>
    <StudyAccess path="/sessions">{async ({ id }) => {
      const page = pageNumber((await searchParams).page);
      const records = await listSessions(id, page);
      return <main className={ui.screen}>
        <TopBar title="יומן סשנים" />
        {!records.length ? <>
          <Notice title="עוד אין כאן כלום"><p className={ui.lede}>כל סשן שתסיים יופיע כאן, החדש למעלה.</p></Notice>
          <div className={ui.footer}><Link className={ui.primary} href="/learn">להתחיל ללמוד</Link></div>
        </> : <>
          <ul className={styles.list}>
            {records.slice(0, sessionPageSize).map((session) => <li key={session.id}>
              <Link className={styles.entry} href={`/sessions/${session.id}`}>
                <span className={styles.entryHead}>
                  <time dateTime={session.startedAt.toISOString()}>{formatSessionDate(session.startedAt)}</time>
                  <strong><bdi>{accuracy(session)}</bdi></strong>
                </span>
                <span className={styles.entryMeta}>{sessionMeta(session)}</span>
              </Link>
            </li>)}
          </ul>
          <Pagination page={page} path="/sessions" more={records.length > sessionPageSize} />
        </>}
      </main>;
    }}</StudyAccess>
  </Suspense>;
}
