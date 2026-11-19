import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { getNeonAuth } from "@/lib/neon-auth";
import { SignInCheck } from "../setup-check/sign-in-check";
import { Study } from "./study";
import styles from "./study.module.css";

async function LearnConnection() {
  await connection();
  const session = await getNeonAuth()?.getSession();
  if (session?.data?.user) return <Study />;

  return (
    <main className={styles.shell}>
      <header className={styles.top}><Link className={styles.brand} href="/">אוצר</Link><span>לימוד</span></header>
      <section className={`${styles.card} ${styles.signIn}`}>
        <h1>כניסה לאוצר</h1>
        <p className={styles.definition}>כדי לשמור על ההתקדמות שלך, יש להיכנס לחשבון.</p>
        {session ? <SignInCheck signedIn={false} callbackPath="/learn" /> : <p>הכניסה אינה זמינה כרגע.</p>}
      </section>
    </main>
  );
}

export default function LearnPage() {
  return (
    <Suspense fallback={<main className={styles.shell}><p role="status">טוען את אוצר…</p></main>}>
      <LearnConnection />
    </Suspense>
  );
}
