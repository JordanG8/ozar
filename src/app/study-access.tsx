import { connection } from "next/server";
import type { ReactNode } from "react";
import { getNeonAuth } from "@/lib/neon-auth";
import { SignIn } from "./sign-in";
import ui from "./ui.module.css";

export async function StudyAccess({ path, children }: {
  path: string;
  children: (user: { id: string; email: string }) => ReactNode | Promise<ReactNode>;
}) {
  await connection();
  const session = await getNeonAuth()?.getSession();
  if (session?.data?.user) return children(session.data.user);
  return <SignIn callbackPath={path} available={Boolean(session)} />;
}

export function LoadingStudy() {
  return <main className={ui.screen}><div className={ui.empty}><p role="status" className={ui.lede}>טוען את אוצר…</p></div></main>;
}
