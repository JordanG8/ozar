import { notFound } from "next/navigation";
import { Suspense } from "react";
import { answerPageSize, getSessionDetails } from "@/lib/sessions";
import { Icon } from "../../icons";
import { LoadingStudy, StudyAccess } from "../../study-access";
import { SectionLabel, TopBar } from "../../ui";
import ui from "../../ui.module.css";
import styles from "../sessions.module.css";
import { formatSessionDate, pageNumber, Pagination, sessionMeta } from "../shared";

type Answer = NonNullable<Awaited<ReturnType<typeof getSessionDetails>>>["answers"][number];

function said(answer: Answer) {
  if (answer.input === "tap") return answer.selectedTerm ? <>בחרת: <span>{answer.selectedTerm}</span></> : "בחירה מתוך אפשרויות";
  if (answer.transcript) return <>אמרת: <span>{answer.transcript}</span></>;
  return "דילגת";
}

export default function SessionPage({ params, searchParams }: PageProps<"/sessions/[id]">) {
  return <Suspense fallback={<LoadingStudy />}>
    <StudyAccess path="/sessions">{async ({ id: userId }) => {
      const { id } = await params;
      if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(id)) notFound();
      const page = pageNumber((await searchParams).page);
      const details = await getSessionDetails(userId, id, page);
      if (!details) notFound();
      const { session, answers } = details;
      const shown = answers.slice(0, answerPageSize);
      const misses = shown.filter(({ correct }) => !correct);
      const hits = shown.filter(({ correct }) => correct);
      return <main className={ui.screen}>
        <TopBar back="/sessions" title={<time dateTime={session.startedAt.toISOString()}>{formatSessionDate(session.startedAt)}</time>} />
        <p className={styles.summaryLine}>{sessionMeta(session, true)}</p>
        <div className={styles.answers}>
          {misses.length > 0 && <>
            <SectionLabel>פספוסים · {session.answers - session.correct}</SectionLabel>
            <ul className={styles.answerList}>
              {misses.map((answer) => <li className={styles.miss} key={answer.id}>
                <strong>{answer.term}</strong>
                <span className={styles.said}>{said(answer)}</span>
                <span className={styles.definition}>{answer.definition}</span>
                {answer.disputed && <span className={styles.said}>סומן לבדיקה של זיהוי הדיבור</span>}
              </li>)}
            </ul>
          </>}
          {hits.length > 0 && <details className={styles.group} open={!misses.length}>
            <summary><span>נכונות · {session.correct}</span><span><Icon name="chevron" size={18} /></span></summary>
            <ul className={styles.answerList}>
              {hits.map((answer) => <li className={styles.hit} key={answer.id}>
                <span><b>{answer.term}</b><small>{answer.definition}</small></span>
                <span><bdi>{(answer.responseMs / 1000).toFixed(1)}</bdi> שנ׳{answer.disputed ? " · סומן לבדיקה" : ""}</span>
              </li>)}
            </ul>
          </details>}
        </div>
        <Pagination page={page} path={`/sessions/${id}`} more={answers.length > answerPageSize} />
      </main>;
    }}</StudyAccess>
  </Suspense>;
}
