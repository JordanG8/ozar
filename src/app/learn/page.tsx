import { Suspense } from "react";
import { LoadingStudy, StudyAccess } from "../study-access";
import { Study } from "./study";

export default function LearnPage() {
  return (
    <Suspense fallback={<LoadingStudy />}>
      <StudyAccess path="/learn">{() => <Study />}</StudyAccess>
    </Suspense>
  );
}
