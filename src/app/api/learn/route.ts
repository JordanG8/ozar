import { getNeonAuth } from "@/lib/neon-auth";
import { answerPrompt, LearnerUnauthorized, markMatcherDispute, openInfinite, openLearn, revealHint, StudyConflict } from "@/lib/learn/store";
import { invalid, isUuid, parseAnswer } from "@/lib/learn/requests";

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) return invalid();
  if (request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ error: "forbidden" }, { status: 403 });
  const auth = getNeonAuth();
  if (!auth) return Response.json({ error: "unavailable" }, { status: 503 });
  try {
    const session = await auth.getSession();
    const user = session.data?.user;
    if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });
    const raw = await request.text();
    if (raw.length > 4096) return invalid();
    let payload;
    try { payload = JSON.parse(raw); } catch { return invalid(); }
    if (!payload || typeof payload !== "object") return invalid();
    const { action, deckId, promptId, level, input, mode, sessionId, disputed } = payload;
    if (mode === "infinite") {
      if (action === "next" && isUuid(sessionId)) return Response.json(await openInfinite(user.id, sessionId));
      if (!isUuid(promptId)) return invalid();
      if (action === "dispute" && typeof disputed === "boolean") {
        return Response.json(await markMatcherDispute(user.id, promptId, disputed));
      }
      if (action === "answer") {
        const answer = parseAnswer(input);
        if (answer && answer.kind !== "continue") return Response.json(await answerPrompt(user.id, promptId, answer, mode));
      }
      return invalid();
    }
    if (action === "start" && (deckId === undefined || isUuid(deckId))) {
      return Response.json(await openLearn(user.id, true, deckId));
    }
    if (action === "next" && (deckId === undefined || isUuid(deckId))) return Response.json(await openLearn(user.id, false, deckId));
    if (!isUuid(promptId)) return invalid();
    if (action === "hint" && (level === 1 || level === 2)) return Response.json(await revealHint(user.id, promptId, level));
    if (action === "answer") {
      const answer = parseAnswer(input);
      if (answer) return Response.json(await answerPrompt(user.id, promptId, answer));
    }
    return invalid();
  } catch (error) {
    if (error instanceof LearnerUnauthorized) return Response.json({ error: "unauthenticated" }, { status: 401 });
    if (error instanceof StudyConflict) return Response.json({ error: "conflict" }, { status: 409 });
    console.error("Learn request failed", { type: error instanceof Error ? error.name : "unknown" });
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
}
