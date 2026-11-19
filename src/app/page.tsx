import Link from "next/link";
import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.home}>
      <header className={styles.header}>אוצר מילים לפסיכומטרי</header>
      <section className={styles.title}>
        <h1>אוֹצָר</h1>
        <p>לומדים מילים בעברית ומתרגלים לזכור את המשמעות, בקול או בהקלדה.</p>
      </section>
      <Link className={styles.start} href="/learn">ללימוד מילים</Link>
    </main>
  );
}
