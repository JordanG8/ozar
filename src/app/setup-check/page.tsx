import { connection } from "next/server";
import { Suspense } from "react";
import { getNeonAuth } from "@/lib/neon-auth";
import { SignInCheck } from "./sign-in-check";

async function SetupConnection() {
  await connection();
  const auth = getNeonAuth();
  if (!auth) return <p>החיבור ל־Neon Auth עדיין לא מוגדר.</p>;

  const session = await auth.getSession();
  return <SignInCheck signedIn={Boolean(session.data?.user)} />;
}

export default function SetupCheck() {
  return (
    <main lang="he" dir="rtl" style={{ padding: "2rem", maxWidth: "36rem", margin: "auto" }}>
      <h1>אוצר · בדיקת חיבור</h1>
      <Suspense fallback={<p>בודק חיבור…</p>}>
        <SetupConnection />
      </Suspense>
    </main>
  );
}
