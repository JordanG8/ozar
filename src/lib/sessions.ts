import { and, asc, desc, eq, gt } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { cards, reviewLogs, sessions, sessionPrompts, words } from "./db/schema";
import { getDb } from "./learn/store";

export const sessionPageSize = 24;
export const answerPageSize = 40;

export function listSessions(userId: string, page: number) {
  return getDb().select().from(sessions).where(and(eq(sessions.userId, userId), gt(sessions.answers, 0)))
    .orderBy(desc(sessions.startedAt), desc(sessions.id)).limit(sessionPageSize + 1).offset((page - 1) * sessionPageSize);
}

export async function getSessionDetails(userId: string, sessionId: string, page: number) {
  const db = getDb();
  const scope = and(eq(sessions.userId, userId), eq(sessions.id, sessionId), gt(sessions.answers, 0));
  const [session] = await db.select().from(sessions).where(scope).limit(1);
  if (!session) return null;
  const option = alias(words, "selected_option");
  const answers = await db.select({
    id: reviewLogs.promptId, correct: reviewLogs.correct, type: reviewLogs.cardType, input: reviewLogs.input,
    transcript: reviewLogs.transcript, matched: reviewLogs.matchedAnswer, disputed: reviewLogs.matcherDisputed,
    applied: reviewLogs.appliedToFsrs, term: words.term, definition: words.definition, responseMs: reviewLogs.responseMs,
    selectedTerm: option.term,
  }).from(reviewLogs)
    .innerJoin(sessionPrompts, eq(sessionPrompts.id, reviewLogs.promptId))
    .innerJoin(cards, and(eq(cards.id, reviewLogs.cardId), eq(cards.userId, userId)))
    .innerJoin(words, eq(words.id, cards.wordId))
    .leftJoin(option, and(eq(reviewLogs.input, "tap"), sql`${option.id} = ANY(${sessionPrompts.choiceWordIds})`,
      sql`${option.id}::text = ${reviewLogs.transcript}`))
    .where(and(eq(reviewLogs.userId, userId), eq(reviewLogs.sessionId, session.id)))
    .orderBy(asc(reviewLogs.correct), asc(reviewLogs.reviewedAt), asc(reviewLogs.promptId))
    .limit(answerPageSize + 1).offset((page - 1) * answerPageSize);
  return { session, answers };
}
