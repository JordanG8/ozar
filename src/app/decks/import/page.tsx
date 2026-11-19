import { Suspense } from "react";
import { LoadingStudy, StudyAccess } from "../../study-access";
import { ImportDeck } from "./import-deck";

export default function DeckImportPage() {
  return <Suspense fallback={<LoadingStudy />}>
    <StudyAccess path="/decks/import">{() => <ImportDeck />}</StudyAccess>
  </Suspense>;
}
