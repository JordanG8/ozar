import { Suspense } from "react";
import { listDecks } from "@/lib/import/decks";
import { LoadingStudy, StudyAccess } from "../study-access";
import { Study } from "./study";

export default function LearnPage({ searchParams }: PageProps<"/learn">) {
  return (
    <Suspense fallback={<LoadingStudy />}>
      <StudyAccess path="/learn">{async ({ id }) => {
        const [available, { deck }] = await Promise.all([listDecks(id), searchParams]);
        const selected = available.find(({ id }) => id === deck)?.id ?? available[0]?.id;
        return <Study decks={available} initialDeck={selected} />;
      }}</StudyAccess>
    </Suspense>
  );
}
