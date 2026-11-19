import { Suspense } from "react";
import { getPreferences } from "@/lib/settings";
import { LoadingStudy, StudyAccess } from "../study-access";
import { TopBar } from "../ui";
import ui from "../ui.module.css";
import { SettingsForm } from "./settings-form";

export default function SettingsPage() {
  return <Suspense fallback={<LoadingStudy />}>
    <StudyAccess path="/settings">{async ({ id, email }) => <main className={ui.screen}>
      <TopBar title="הגדרות" />
      <SettingsForm preferences={await getPreferences(id)} email={email} />
    </main>}</StudyAccess>
  </Suspense>;
}
