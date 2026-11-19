import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getSessionSummary } from "@/lib/sessions";
import { LoadingStudy, StudyAccess } from "../../../study-access";
import { SectionLabel } from "../../../ui";
import ui from "../../../ui.module.css";
import styles from "../../sessions.module.css";
import { accuracy, difficulty, duration, formatSessionDate, modeLabel } from "../../shared";

export default function SummaryPage({ params }: PageProps<"/sessions/[id]/summary">) {
  return <Suspense fallback={<LoadingStudy />}>
    <StudyAccess path="/sessions">{async ({ id: userId }) => {
      const { id } = await params;
      if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(id)) notFound();
      const summary = await getSessionSummary(userId, id);
      if (!summary) notFound();
      const { session, slowest } = summary;
      return <main className={ui.screen}>
        <header className={ui.bar}>
          <p className={ui.meta}><time dateTime={session.startedAt.toISOString()}>{formatSessionDate(session.startedAt)}</time> · {modeLabel(session.mode)}</p>
        </header>
        <h1 className={styles.hero}><span>סיום סשן</span><span className={styles.heroNumber}>{session.answers}</span><span>תשובות</span></h1>
        <dl className={styles.figures}>
          <div><dt>דיוק</dt><dd><bdi>{accuracy(session)}</bdi></dd></div>
          <div><dt>קושי</dt><dd><bdi>{difficulty(session)}</bdi></dd></div>
          <div><dt>משך</dt><dd>{duration(session.durationMs)}</dd></div>
          <div><dt>רצף ארוך</dt><dd>{session.bestCombo}</dd></div>
        </dl>
        <section className={styles.slow}>
          {slowest.length > 0 && <>
            <SectionLabel>{slowest.length === 3 ? "שלוש האיטיות ביותר" : "האיטיות ביותר"}</SectionLabel>
            {slowest.map((answer) => <div className={styles.slowRow} key={answer.id}>
              <span><b>{answer.term}</b><small>{answer.definition}</small></span>
              <span><bdi>{(answer.responseMs / 1000).toFixed(1)}</bdi> שנ׳</span>
            </div>)}
          </>}
        </section>
        <div className={ui.footer}>
          <Link className={ui.primary} href={session.mode === "infinite" ? "/infinite" : "/learn"}>עוד סבב</Link>
          <Link className={ui.quiet} href="/">לבית</Link>
          <Link className={ui.quiet} href={`/sessions/${session.id}`}>כל התשובות</Link>
        </div>
      </main>;
    }}</StudyAccess>
  </Suspense>;
}
