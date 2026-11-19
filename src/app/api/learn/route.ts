import { getNeonAuth } from "@/lib/neon-auth";
import { answerPrompt, LearnerUnauthorized, markMatcherDispute, openInfinite, openLearn, revealHint, StudyConflict } from "@/lib/learn/store";
import type { AnswerInput } from "@/lib/learn/protocol";

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
const isUuid = (value: unknown): value is string => typeof value === "string" && uuid.test(value);
const isText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 300;
const invalid = () => Response.json({ error: "invalid" }, { status: 400 });

function parseAnswer(input: unknown): AnswerInput | undefined {
  if (!input || typeof input !== "object" || !("kind" in input)) return;
  if (input.kind === "continue" || input.kind === "skip") return { kind: input.kind };
  if (input.kind === "tap" && "choice" in input && isUuid(input.choice)) return { kind: input.kind, choice: input.choice };
  if (input.kind === "typed" && "value" in input && isText(input.value)) return { kind: input.kind, value: input.value.trim() };
  if (input.kind === "voice" && "alternatives" in input && "final" in input &&
      Array.isArray(input.alternatives) && input.alternatives.length > 0 &&
      input.alternatives.length <= 5 && input.alternatives.every(isText) && typeof input.final === "boolean") {
    return { kind: input.kind, alternatives: input.alternatives, final: input.final };
  }
}

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
