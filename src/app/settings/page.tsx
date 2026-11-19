import Link from "next/link";
import { Suspense } from "react";
import { getPreferences } from "@/lib/settings";
import { LoadingStudy, StudyAccess } from "../study-access";
import styles from "../manage.module.css";
import { SettingsForm } from "./settings-form";

export default function SettingsPage() {
  return <Suspense fallback={<LoadingStudy />}>
    <StudyAccess path="/settings">{async ({ id, email }) => <main className={styles.shell}>
      <nav className={styles.nav}><Link href="/?menu=1">אוצר</Link><Link href="/infinite">תרגול רציף</Link></nav>
      <h1 className={styles.heading}>הגדרות</h1>
      <SettingsForm preferences={await getPreferences(id)} email={email} />
    </main>}</StudyAccess>
  </Suspense>;
}
