import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getNeonAuth } from "@/lib/neon-auth";
import { hasUsedInfinite } from "@/lib/learn/store";
import styles from "./page.module.css";

function Menu() {
  return (
    <main className={styles.home}>
      <header className={styles.header}>אוצר מילים לפסיכומטרי</header>
      <section className={styles.title}>
        <h1>אוֹצָר</h1>
        <p>לומדים מילים בעברית ומתרגלים לזכור את המשמעות, בקול או בהקלדה.</p>
      </section>
      <nav className={styles.menu} aria-label="מצבי תרגול">
        <Link className={styles.start} href="/learn">ללימוד מילים</Link>
        <Link className={styles.practice} href="/infinite">תרגול רציף</Link>
        <Link className={styles.practice} href="/sessions">יומן תרגול</Link>
        <Link className={styles.practice} href="/decks/import">ייבוא מילים</Link>
      </nav>
    </main>
  );
}

async function Destination({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  await connection();
  const { menu } = await searchParams;
  if (menu !== "1") {
    const user = (await getNeonAuth()?.getSession())?.data?.user;
    if (user && await hasUsedInfinite(user.id)) redirect("/infinite");
  }
  return <Menu />;
}

export default function Home({ searchParams }: PageProps<"/">) {
  return <Suspense fallback={<Menu />}><Destination searchParams={searchParams} /></Suspense>;
}
