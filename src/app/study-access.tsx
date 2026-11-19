import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { getNeonAuth } from "@/lib/neon-auth";
import { SignInCheck } from "./setup-check/sign-in-check";
import styles from "./learn/study.module.css";

export async function StudyAccess({ path, children }: {
  path: string;
  children: (user: { id: string; email: string }) => ReactNode | Promise<ReactNode>;
}) {
  await connection();
  const session = await getNeonAuth()?.getSession();
  if (session?.data?.user) return children(session.data.user);
  return (
    <main className={styles.shell}>
      <header className={styles.top}><Link className={styles.brand} href="/?menu=1">אוצר</Link></header>
      <section className={`${styles.card} ${styles.signIn}`}>
        <h1>כניסה לאוצר</h1>
        <p className={styles.definition}>כדי לשמור על ההתקדמות שלך, יש להיכנס לחשבון.</p>
        {session ? <SignInCheck signedIn={false} callbackPath={path} /> : <p>הכניסה אינה זמינה כרגע.</p>}
      </section>
    </main>
  );
}

export function LoadingStudy() {
  return <main className={styles.shell}><p role="status">טוען את אוצר…</p></main>;
}
