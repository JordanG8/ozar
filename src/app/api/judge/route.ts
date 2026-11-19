import { getNeonAuth } from "@/lib/neon-auth";
import { decideMeaning } from "@/lib/learn/ai-judge";
import { invalid, isUuid, parseAnswer } from "@/lib/learn/requests";
import { LearnerUnauthorized, selfGradeMeaning, StudyConflict, submitMeaning } from "@/lib/learn/store";

export async function POST(request: Request) {
  const receivedAt = Date.now();
  if (!request.headers.get("content-type")?.startsWith("application/json")) return invalid();
  if (request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ error: "forbidden" }, { status: 403 });
  if (Number(request.headers.get("content-length")) > 4096) return invalid();
  try {
    const auth = getNeonAuth();
    if (!auth) return Response.json({ error: "unavailable" }, { status: 503 });
    const user = (await auth.getSession()).data?.user;
    if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });
    const raw = await request.text();
    if (raw.length > 4096) return invalid();
    let payload;
    try { payload = JSON.parse(raw); } catch { return invalid(); }
    if (!payload || typeof payload !== "object") return invalid();
    const { mode, promptId, input } = payload;
    if ((mode !== "learn" && mode !== "infinite") || !isUuid(promptId)) return invalid();
    if (input?.kind === "self" && typeof input.correct === "boolean") {
      return Response.json(await selfGradeMeaning(user.id, promptId, input.correct, mode));
    }
    const answer = parseAnswer(input);
    if (answer?.kind === "typed" || (answer?.kind === "voice" && answer.final)) {
      return Response.json(await submitMeaning(user.id, promptId, answer, mode, receivedAt, decideMeaning));
    }
    return invalid();
  } catch (error) {
    if (error instanceof LearnerUnauthorized) return Response.json({ error: "unauthenticated" }, { status: 401 });
    if (error instanceof StudyConflict) return Response.json({ error: "conflict" }, { status: 409 });
    console.error("Vocabulary judge request failed", { type: error instanceof Error ? error.name : "unknown" });
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
}
