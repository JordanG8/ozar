import { randomInt } from "node:crypto";
import { Pool } from "@neondatabase/serverless";
import { and, count, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import {
  appUsers, cards, decks, learningQueue, learningRuns, reviewLogs, sessionPrompts,
  sessions, userSettings, words,
} from "@/lib/db/schema";
import { scheduleLearning } from "./fsrs";
import { exampleParts, matchMeaning, normalize } from "./matcher";
import type { AnswerInput, Feedback, StudyState } from "./protocol";
import { nextStage, rateAnswer, selectQueued } from "./queue";

const makeDb = (connectionString: string) => drizzle(new Pool({ connectionString, max: 3 }));
let db: ReturnType<typeof makeDb> | undefined;
type Transaction = Parameters<Parameters<ReturnType<typeof makeDb>["transaction"]>[0]>[0];
type Run = typeof learningRuns.$inferSelect;
type Settings = typeof userSettings.$inferSelect;

export class StudyConflict extends Error {}

async function withLearner<T>(userId: string, run: (tx: Transaction, settings: Settings) => Promise<T>) {
  const connectionString = process.env.DATABASE_URL ?? process.env.DATABASE_URL_UNPOOLED;
  if (!connectionString) throw new Error("Missing database connection");
  db ??= makeDb(connectionString);
  return db.transaction(async (tx) => {
    await tx.insert(appUsers).values({ id: userId }).onConflictDoNothing();
    await tx.select({ id: appUsers.id }).from(appUsers).where(eq(appUsers.id, userId)).for("update");
    await tx.insert(userSettings).values({ userId }).onConflictDoNothing();
    const [settings] = await tx.select().from(userSettings).where(eq(userSettings.userId, userId));
    return run(tx, settings);
  });
}

function getActiveRun(tx: Transaction, userId: string) {
  return tx.select().from(learningRuns).where(and(
    eq(learningRuns.userId, userId), isNull(learningRuns.finishedAt),
  )).orderBy(learningRuns.startedAt).limit(1).then(([run]) => run);
}

async function createRun(tx: Transaction, settings: Settings, deckId?: string) {
  const { userId } = settings;
  const [deck] = await tx.select({ id: decks.id }).from(decks).where(deckId
    ? and(eq(decks.id, deckId), sql`(${decks.ownerId} = ${userId} OR ${decks.kind} = 'builtin')`)
    : eq(decks.kind, "builtin")).limit(1);
  if (!deck) return;

  const [{ introduced }] = await tx.select({ introduced: count() }).from(cards).where(and(
    eq(cards.userId, userId),
    sql`(${cards.firstSeenAt} AT TIME ZONE ${settings.timeZone})::date = (now() AT TIME ZONE ${settings.timeZone})::date`,
  ));
  const budget = Math.max(0, settings.newPerDay - introduced);
  if (!budget) return;
  const candidates = await tx.select({ wordId: words.id }).from(words).leftJoin(cards, and(
    eq(cards.wordId, words.id), eq(cards.userId, userId),
  )).where(and(eq(words.deckId, deck.id), isNull(cards.id))).orderBy(words.position).limit(budget);
  if (!candidates.length) return;

  const [run] = await tx.insert(learningRuns).values({ userId, deckId: deck.id }).returning();
  await tx.insert(sessions).values({ id: run.id, userId, mode: "learn", startedAt: run.startedAt, endedAt: run.startedAt });
  const reserved = await tx.insert(cards).values(candidates.map(({ wordId }) => ({ userId, wordId })))
    .returning({ id: cards.id });
  await tx.insert(learningQueue).values(reserved.map(({ id }) => ({
    runId: run.id, userId, cardId: id, nextStage: "intro" as const, eligiblePosition: 1,
  })));
  return run;
}

async function makeChoices(tx: Transaction, word: typeof words.$inferSelect) {
  const close = (deckId: string) => tx.select({ id: words.id, term: words.term }).from(words)
    .where(and(eq(words.deckId, deckId), ne(words.id, word.id)))
    .orderBy(sql`abs(${words.difficulty} - ${word.difficulty})`, sql`random()`).limit(24);
  const options = [{ id: word.id, term: word.term }];
  const seen = new Set([normalize(word.term)]);
  function take(candidates: Awaited<ReturnType<typeof close>>) {
    for (const candidate of candidates) {
      if (options.length === 4) break;
      const term = normalize(candidate.term);
      if (seen.has(term)) continue;
      seen.add(term);
      options.push(candidate);
    }
  }
  take(await close(word.deckId));
  if (options.length < 4) {
    const [builtIn] = await tx.select({ id: decks.id }).from(decks).where(eq(decks.kind, "builtin")).limit(1);
    if (builtIn && builtIn.id !== word.deckId) take(await close(builtIn.id));
  }
  if (options.length !== 4) throw new Error("Insufficient reverse choices");
  for (let index = options.length - 1; index > 0; index--) {
    const swap = randomInt(index + 1);
    [options[index], options[swap]] = [options[swap], options[index]];
  }
  return options.map(({ id }) => id);
}

async function stateForRun(tx: Transaction, settings: Settings, run?: Run): Promise<StudyState> {
  const empty = { prompt: null, remaining: 0, total: 0, inputDefault: settings.inputDefault, hintLevel: 0 };
  if (!run) return empty;
  const scope = and(eq(learningQueue.runId, run.id), eq(learningQueue.userId, run.userId));
  const queue = await tx.select({
    cardId: learningQueue.cardId, nextStage: learningQueue.nextStage,
    eligiblePosition: learningQueue.eligiblePosition, position: words.position, word: words,
  }).from(learningQueue).innerJoin(cards, eq(cards.id, learningQueue.cardId))
    .innerJoin(words, eq(words.id, cards.wordId)).where(scope);
  const [{ graduated }] = await tx.select({ graduated: count() }).from(reviewLogs).where(and(
    eq(reviewLogs.userId, run.userId), eq(reviewLogs.sessionId, run.id),
    eq(reviewLogs.cardType, "reverse_choice"), eq(reviewLogs.correct, true),
  ));
  const state = { ...empty, remaining: queue.length, total: queue.length + graduated };
  if (!queue.length) {
    if (!run.finishedAt) {
      await tx.update(learningRuns).set({ finishedAt: new Date() }).where(eq(learningRuns.id, run.id));
    }
    return state;
  }

  const [pending] = await tx.select().from(sessionPrompts).where(and(
    eq(sessionPrompts.userId, run.userId), eq(sessionPrompts.sessionId, run.id), isNull(sessionPrompts.completedAt),
  )).limit(1);
  const ordinal = run.promptCount + 1;
  const queued = pending ? queue.find(({ cardId }) => cardId === pending.cardId) : selectQueued(queue, ordinal);
  if (!queued) throw new StudyConflict();
  const { word, nextStage: kind, cardId } = queued;
  const choiceWordIds = pending?.choiceWordIds ?? (kind === "reverse_choice" ? await makeChoices(tx, word) : null);
  const prompt = pending ?? (await tx.insert(sessionPrompts).values({
    userId: run.userId, sessionId: run.id, cardId, kind, ordinal, choiceWordIds,
  }).returning())[0];
  state.hintLevel = prompt.hintLevel;

  if (kind === "intro") return { ...state, prompt: { kind, id: prompt.id, term: word.term, definition: word.definition, example: word.example } };
  if (kind === "voice_meaning") return { ...state, prompt: { kind, id: prompt.id, term: word.term } };
  const options = await tx.select({ id: words.id, term: words.term }).from(words).where(inArray(words.id, choiceWordIds ?? []));
  const byId = new Map(options.map((option) => [option.id, option]));
  const choices = (choiceWordIds ?? []).map((id) => byId.get(id)).filter((option) => option !== undefined);
  if (choices.length !== 4) throw new StudyConflict();
  return { ...state, prompt: { kind, id: prompt.id, definition: word.definition, choices } };
}

export function openLearn(userId: string, start: boolean, deckId?: string) {
  return withLearner(userId, async (tx, settings) => {
    const run = await getActiveRun(tx, userId) ?? (start ? await createRun(tx, settings, deckId) : undefined);
    return stateForRun(tx, settings, run);
  });
}

async function getPrompt(tx: Transaction, userId: string, promptId: string) {
  const [row] = await tx.select({ prompt: sessionPrompts, card: cards, word: words })
    .from(sessionPrompts).innerJoin(cards, eq(cards.id, sessionPrompts.cardId))
    .innerJoin(words, eq(words.id, cards.wordId))
    .innerJoin(learningRuns, and(eq(learningRuns.id, sessionPrompts.sessionId), eq(learningRuns.userId, userId)))
    .where(and(eq(sessionPrompts.id, promptId), eq(sessionPrompts.userId, userId))).limit(1);
  if (!row) throw new StudyConflict();
  return row;
}

export function revealHint(userId: string, promptId: string, level: number) {
  return withLearner(userId, async (tx) => {
    const { prompt, word } = await getPrompt(tx, userId, promptId);
    if (prompt.completedAt || prompt.kind !== "voice_meaning" || level > prompt.hintLevel + 1) throw new StudyConflict();
    const hintLevel = Math.max(level, prompt.hintLevel);
    if (hintLevel !== prompt.hintLevel) {
      await tx.update(sessionPrompts).set({ hintLevel }).where(eq(sessionPrompts.id, promptId));
    }
    const parts = exampleParts(word.example, word.term);
    const example = parts.some(({ highlighted }) => highlighted)
      ? parts.map(({ text, highlighted }) => highlighted ? "____" : text).join("") : null;
    const letters = word.acceptedAnswers[0]?.split(/\s+/u).map((token) => token[0]).join(" · ") ?? "";
    return { hintLevel, example, letters: hintLevel === 2 ? letters : null };
  });
}

export function answerPrompt(userId: string, promptId: string, input: AnswerInput) {
  return withLearner(userId, async (tx, settings) => {
    const { prompt, card, word } = await getPrompt(tx, userId, promptId);
    function feedback(correct: boolean, matched: string | null): Feedback {
      return { correct, matched, term: word.term, definition: word.definition, example: word.example };
    }
    if (prompt.completedAt) {
      const [log] = await tx.select().from(reviewLogs).where(and(eq(reviewLogs.promptId, promptId), eq(reviewLogs.userId, userId)));
      return { accepted: true, feedback: log ? feedback(log.correct, log.matchedAnswer) : null };
    }
    const now = new Date();
    let result: Feedback | null = null;
    let correct = false;
    let next: ReturnType<typeof nextStage>;
    if (prompt.kind === "intro" && input.kind === "continue") {
      await tx.update(cards).set({ firstSeenAt: now, state: "learning" }).where(and(eq(cards.id, card.id), isNull(cards.firstSeenAt)));
      next = nextStage(prompt.kind, false, prompt.ordinal);
    } else {
      const reversed = prompt.kind === "reverse_choice" && input.kind === "tap";
      const meaning = prompt.kind === "voice_meaning" && (input.kind === "typed" || input.kind === "voice" || input.kind === "skip");
      if (!reversed && !meaning) throw new StudyConflict();
      if (reversed && !prompt.choiceWordIds?.includes(input.choice)) throw new StudyConflict();
      const alternatives = input.kind === "voice" ? input.alternatives : input.kind === "typed" ? [input.value] : [];
      const found = alternatives.map((value) => ({ value, match: matchMeaning(value, word.acceptedAnswers, word.definition) }))
        .find(({ match }) => match !== null);
      if (input.kind === "voice" && !found && !input.final) return { accepted: false, feedback: null };
      correct = reversed ? input.choice === word.id : Boolean(found);
      const matched = reversed && correct ? word.term : found?.match ?? null;
      const transcript = found?.value ?? alternatives[0] ?? null;
      const responseMs = Math.max(0, Math.min(86_400_000, now.getTime() - prompt.issuedAt.getTime()));
      const history = await tx.select({ ms: reviewLogs.responseMs }).from(reviewLogs).where(and(
        eq(reviewLogs.userId, userId), eq(reviewLogs.correct, true), eq(reviewLogs.cardType, prompt.kind),
        gt(reviewLogs.responseMs, 0),
      )).orderBy(sql`${reviewLogs.reviewedAt} DESC`).limit(21);
      const rating = rateAnswer(correct, prompt.hintLevel, responseMs, history.map(({ ms }) => ms));
      next = nextStage(prompt.kind, correct, prompt.ordinal);
      const { updates, reviewElapsedDays } = scheduleLearning(card, settings, rating, now,
        next?.nextStage === "reverse_choice" ? "reverse_choice" : next ? "voice_meaning" : null);
      const [day] = await tx.select({ today: sql<string>`(now() AT TIME ZONE ${settings.timeZone})::date::text` })
        .from(appUsers).where(eq(appUsers.id, userId));
      const difficultyForSession = Math.max(1, updates.difficulty);
      await tx.insert(reviewLogs).values({
        promptId, userId, sessionId: prompt.sessionId, cardId: card.id, mode: "learn", cardType: prompt.kind,
        input: reversed ? "tap" : input.kind === "voice" ? "voice" : "typed", correct, rating, responseMs,
        transcript, matchedAnswer: matched, appliedToFsrs: true, reviewDay: day.today, reviewedAt: now,
        previousReviewAt: card.lastReviewAt, previousDue: card.due, previousState: card.state,
        previousStability: card.stability, previousDifficulty: card.difficulty, previousLearningStep: card.learningStep,
        elapsedDays: reviewElapsedDays, scheduledDays: updates.scheduledDays, difficultyForSession,
      });
      await tx.update(cards).set({ ...updates, lastAnswerDay: day.today }).where(eq(cards.id, card.id));
      result = feedback(correct, matched);
    }
    const queueKey = and(eq(learningQueue.runId, prompt.sessionId), eq(learningQueue.cardId, card.id), eq(learningQueue.userId, userId));
    if (next) await tx.update(learningQueue).set(next).where(queueKey);
    else await tx.delete(learningQueue).where(queueKey);
    await tx.update(sessionPrompts).set({ completedAt: now }).where(eq(sessionPrompts.id, promptId));
    await tx.update(learningRuns).set({ promptCount: prompt.ordinal }).where(and(eq(learningRuns.id, prompt.sessionId), eq(learningRuns.userId, userId)));
    await tx.update(sessions).set({
      endedAt: now,
      durationMs: sql`least(2147483647, greatest(0, extract(epoch FROM (${now.toISOString()}::timestamptz - ${sessions.startedAt})) * 1000))::integer`,
      ...(result && {
        answers: sql`${sessions.answers} + 1`,
        correct: sql`${sessions.correct} + ${Number(correct)}`,
        difficulty1To10: sql`(
          SELECT SUM(difficulty_for_session * greatest(response_ms, 250)::double precision)
          / SUM(greatest(response_ms, 250)::double precision)
          FROM review_logs WHERE user_id = ${userId} AND session_id = ${prompt.sessionId}
        )`,
      }),
    }).where(and(eq(sessions.id, prompt.sessionId), eq(sessions.userId, userId)));
    return { accepted: true, feedback: result };
  });
}
