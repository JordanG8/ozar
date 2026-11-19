import { Suspense } from "react";
import { LoadingStudy, StudyAccess } from "../study-access";
import { Practice } from "./practice";

export default function InfinitePage() {
  return (
    <Suspense fallback={<LoadingStudy />}>
      <StudyAccess path="/infinite">{() => <Practice />}</StudyAccess>
    </Suspense>
  );
}
