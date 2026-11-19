import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { answerPageSize, getSessionDetails } from "@/lib/sessions";
import { LoadingStudy, StudyAccess } from "../../study-access";
import styles from "../../manage.module.css";
import study from "../../learn/study.module.css";
import { formatSessionDate, modeLabel, pageNumber, Pagination, SessionMetrics } from "../shared";

export default function SessionPage({ params, searchParams }: PageProps<"/sessions/[id]">) {
  return <Suspense fallback={<LoadingStudy />}>
    <StudyAccess path="/sessions">{async ({ id: userId }) => {
      const { id } = await params;
      if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(id)) notFound();
      const page = pageNumber((await searchParams).page);
      const details = await getSessionDetails(userId, id, page);
      if (!details) notFound();
      const { session, answers } = details;
      return <main className={styles.shell}>
        <nav className={styles.nav}><Link href="/?menu=1">אוצר</Link><Link href="/sessions">יומן תרגול</Link></nav>
        <h1 className={styles.heading}>{modeLabel(session.mode)}</h1>
        <time dateTime={session.startedAt.toISOString()}>{formatSessionDate(session.startedAt)}</time>
        <SessionMetrics session={session} />
        <ul className={styles.list}>
          {answers.slice(0, answerPageSize).map((answer) => <li className={styles.entry} key={answer.id}>
            <div className={styles.row}><strong>{answer.term}</strong>
              <span className={answer.correct ? study.correct : study.wrong}>{answer.correct ? "נכון" : "שגוי"}</span></div>
            <p>{answer.definition}</p>
            <p className={styles.muted}>
              {answer.input === "tap" ? (answer.selectedTerm ? `נבחרה המילה ${answer.selectedTerm}` : "בחירה מתוך אפשרויות")
                : answer.transcript ? `תשובה שנקלטה ״${answer.transcript}״` : "דילוג"}
              {" · "}<bdi>{(answer.responseMs / 1000).toFixed(1)}</bdi> שנ׳
            </p>
            {answer.disputed && <p className={styles.muted}>סומן לבדיקה של זיהוי הדיבור</p>}
          </li>)}
        </ul>
        <Pagination page={page} path={`/sessions/${id}`} more={answers.length > answerPageSize} />
      </main>;
    }}</StudyAccess>
  </Suspense>;
}
