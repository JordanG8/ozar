import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { getHomeSummary, type HomeSummary } from "@/lib/home";
import { getNeonAuth } from "@/lib/neon-auth";
import { Icon } from "./icons";
import { SignIn } from "./sign-in";
import { LoadingStudy } from "./study-access";
import ui from "./ui.module.css";
import styles from "./page.module.css";

const dayNames = { met: "היעד הושג", today: "היום", missed: "ללא יעד", future: "" };

function Ring({ fraction, done }: { fraction: number; done: boolean }) {
  return (
    <svg className={styles.ring} viewBox="0 0 248 248" role="img" aria-label={`יעד יומי ${Math.round(fraction * 100)}%`}>
      <circle cx="124" cy="124" r="122" pathLength="100" className={styles.track} />
      {fraction > 0 && <circle cx="124" cy="124" r="122" pathLength="100" className={done ? styles.ringDone : styles.ringFill}
        strokeDasharray={`${Math.min(100, fraction * 100)} 100`} />}
    </svg>
  );
}

function Home({ summary }: { summary: HomeSummary }) {
  const { streak, today, goal, week, seen, learnWaiting, learnInProgress } = summary;
  const locked = seen === 0;
  const done = today >= goal;
  return (
    <main className={ui.screen}>
      <header className={`${ui.bar} ${styles.bar}`}>
        <span className={styles.wordmark}>אוצר</span>
        <Link className={ui.iconButton} href="/settings" aria-label="הגדרות"><Icon name="settings" /></Link>
      </header>

      <section className={styles.streak} aria-label="רצף ימים">
        <p><span className={styles.streakNumber}>{streak}</span> <span className={styles.streakLabel}>
          {streak ? (streak === 1 ? "יום ברצף" : "ימים ברצף") : "יום ראשון"}</span></p>
        <ol className={styles.week} aria-label="השבוע">
          {week.map((day, index) => <li key={index} data-state={day.state}>
            <span>{day.label}</span><i aria-hidden="true" /><span className="visually-hidden">{dayNames[day.state]}</span>
          </li>)}
        </ol>
      </section>

      <section className={styles.center}>
        <div className={styles.dial}>
          <Ring fraction={goal ? today / goal : 0} done={done && !locked} />
          {locked ? <div className={`${styles.disk} ${styles.locked}`} aria-disabled="true">
            <Icon name="lock" size={28} /><span className={styles.diskSub}>אינסופי</span>
          </div> : done ? <div className={`${styles.disk} ${styles.doneDisk}`}>
            <span className={styles.check}><Icon name="check" size={40} /></span>
            <span className={styles.diskMeta}><bdi>{today} מתוך {goal}</bdi> תשובות</span>
          </div> : <Link className={styles.disk} href="/infinite">
            <span className={styles.diskTitle}>התחל</span><span className={styles.diskSub}>אינסופי</span>
          </Link>}
        </div>
        {locked ? <p className={styles.caption}>האינסופי חוזר על מילים שכבר ראית. הוא נפתח אחרי מנת הלמידה הראשונה.</p>
          : done ? <><h2 className={styles.doneTitle}>סיימת להיום</h2>
            <p className={styles.caption}><bdi>{today}</bdi> תשובות היום</p></>
          : <p className={styles.caption}><bdi>{today} מתוך {goal}</bdi> תשובות היום</p>}
      </section>

      {locked ? <div className={ui.footer}>
        <Link className={ui.primary} href="/learn">{learnWaiting ? `ללמוד ${learnWaiting} מילים ראשונות` : "ללמוד מילים ראשונות"}</Link>
      </div> : <>
        {done && <div className={styles.continue}><Link className={ui.primary} href="/infinite">להמשיך באינסופי</Link></div>}
        {learnWaiting > 0 && <Link className={styles.learnRow} href="/learn">
          <span className={styles.learnText}>
            <strong>{learnInProgress ? `${learnWaiting} מילים במנת הלמידה` : `${learnWaiting} מילים חדשות מחכות`}</strong>
            <span>{learnInProgress ? "להמשיך מאיפה שעצרת" : "מנת הלמידה של היום"}</span>
          </span>
          <span className={ui.rowIcon}><Icon name="chevron" /></span>
        </Link>}
        <nav className={styles.links} aria-label="עוד">
          <Link className={ui.quiet} href="/sessions"><Icon name="log" size={18} />יומן סשנים</Link>
          <Link className={ui.quiet} href="/decks/import"><Icon name="upload" size={18} />ייבוא מילים</Link>
        </nav>
      </>}
    </main>
  );
}

async function Destination() {
  await connection();
  const auth = getNeonAuth();
  const session = await auth?.getSession();
  const user = session?.data?.user;
  if (!user) return <SignIn callbackPath="/" available={Boolean(session)} />;
  return <Home summary={await getHomeSummary(user.id)} />;
}

export default function HomePage() {
  return <Suspense fallback={<LoadingStudy />}><Destination /></Suspense>;
}
