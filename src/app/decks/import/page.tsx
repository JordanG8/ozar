import Link from "next/link";
import { Suspense } from "react";
import { LoadingStudy, StudyAccess } from "../../study-access";
import styles from "../../manage.module.css";
import { ImportDeck } from "./import-deck";

export default function DeckImportPage() {
  return <Suspense fallback={<LoadingStudy />}>
    <StudyAccess path="/decks/import">{() => <main className={styles.shell}>
      <nav className={styles.nav}><Link href="/?menu=1">אוצר</Link><Link href="/learn">לימוד מילים</Link></nav>
      <h1 className={styles.heading}>ייבוא מילים</h1>
      <ImportDeck />
    </main>}</StudyAccess>
  </Suspense>;
}
