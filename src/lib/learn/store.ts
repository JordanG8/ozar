import { randomInt } from "node:crypto";
import { Pool } from "pg";
import { and, count, desc, eq, gt, gte, inArray, isNotNull, isNull, ne, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/node-postgres";
import { getNeonAuth } from "@/lib/neon-auth";
import {
  appUsers, cards, decks, learningQueue, learningRuns, reviewLogs, sessionPrompts,
  sessions, userSettings, words,
} from "@/lib/db/schema";
import { recallEstimator, scheduleLearning, scheduleReview } from "./fsrs";
import { dayStreak, infiniteKind, pickInfinite } from "./infinite";
import { judgeModel, judgeTimeoutMs, type JudgeAttempt, type JudgeLog, type JudgeOutput } from "./judge-config";
import { exampleParts, matchMeaning, normalize } from "./matcher";
import type { AnswerInput, AnswerReceipt, Feedback, InfiniteState, MeaningInput, StudyState } from "./protocol";
import { nextStage, rateAnswer, selectQueued } from "./queue";

const makeDb = (source: string) => {
  const url = new URL(source);
  if (url.hostname.endsWith(".neon.tech")) url.searchParams.set("sslmode", "verify-full");
  const pool = new Pool({ connectionString: url.toString(), max: 3, connectionTimeoutMillis: 8_000 });
  pool.on("error", (error) => console.error("Idle database connection failed", { type: error.name }));
  return drizzle(pool);
};
let db: ReturnType<typeof makeDb> | undefined;
export type Transaction = Parameters<Parameters<ReturnType<typeof makeDb>["transaction"]>[0]>[0];
type Run = typeof learningRuns.$inferSelect;
type Settings = typeof userSettings.$inferSelect;
type Prompt = typeof sessionPrompts.$inferSelect;
type Word = typeof words.$inferSelect;
type DbReader = Pick<Transaction, "select">;
type Mode = "learn" | "infinite";

export class StudyConflict extends Error {}
export class LearnerUnauthorized extends Error {}

export function getDb() {
  const connectionString = process.env.DATABASE_URL ?? process.env.DATABASE_URL_UNPOOLED;
  if (!connectionString) throw new Error("Missing database connection");
  return db ??= makeDb(connectionString);
}

export async function withLearner<T>(userId: string, run: (tx: Transaction, settings: Settings) => Promise<T>) {
  return getDb().transaction(async (tx) => {
    await lockLearner(tx, userId);
    const [existing] = await tx.select({ id: appUsers.id }).from(appUsers).where(eq(appUsers.id, userId));
    if (!existing) {
      // A stale signed session must not recreate the learner after account deletion.
      const auth = getNeonAuth();
      if (auth && (await auth.getSession({ query: { disableCookieCache: "true" } })).data?.user.id !== userId) {
        throw new LearnerUnauthorized();
      }
      await tx.insert(appUsers).values({ id: userId }).onConflictDoNothing();
    }
    await tx.insert(userSettings).values({ userId }).onConflictDoNothing();
    const [settings] = await tx.select().from(userSettings).where(eq(userSettings.userId, userId));
    return run(tx, settings);
  });
}

export async function lockLearner(tx: Transaction, userId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}::text, 0))`);
}

function getActiveRun(tx: Transaction, userId: string, deckId?: string) {
  return tx.select({ run: learningRuns }).from(learningRuns).innerJoin(decks, eq(decks.id, learningRuns.deckId)).where(and(
    eq(learningRuns.userId, userId), isNull(learningRuns.finishedAt),
    deckId ? and(eq(decks.id, deckId), sql`(${decks.ownerId} = ${userId} OR ${decks.kind} = 'builtin')`) : eq(decks.kind, "builtin"),
  )).orderBy(learningRuns.startedAt).limit(1).then(([row]) => row?.run);
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
  return { ...state, prompt: await showReviewPrompt(tx, { ...prompt, kind }, word), judgePending: waitingOn(prompt.judgeAttempt) };
}

async function showReviewPrompt(tx: Transaction, prompt: Prompt, word: Word): Promise<InfiniteState["prompt"]> {
  const { kind, id, choiceWordIds } = prompt;
  if (kind === "voice_meaning") return { kind, id, term: word.term };
  if (kind !== "reverse_choice" || !choiceWordIds) throw new StudyConflict();
  const options = await tx.select({ id: words.id, term: words.term }).from(words).where(inArray(words.id, choiceWordIds));
  const byId = new Map(options.map((option) => [option.id, option]));
  const choices = choiceWordIds.map((id) => byId.get(id)).filter((option) => option !== undefined);
  if (choices.length !== 4) throw new StudyConflict();
  return { kind, id, definition: word.definition, choices };
}

export function openLearn(userId: string, start: boolean, deckId?: string) {
  return withLearner(userId, async (tx, settings) => {
    const run = await getActiveRun(tx, userId, deckId) ?? (start ? await createRun(tx, settings, deckId) : undefined);
    return stateForRun(tx, settings, run);
  });
}

async function getPrompt(tx: DbReader, userId: string, promptId: string, mode: Mode = "learn", lock = false) {
  const query = tx.select({ prompt: sessionPrompts, card: cards, word: words })
    .from(sessionPrompts).innerJoin(cards, eq(cards.id, sessionPrompts.cardId))
    .innerJoin(words, eq(words.id, cards.wordId))
    .innerJoin(sessions, and(eq(sessions.id, sessionPrompts.sessionId), eq(sessions.userId, userId), eq(sessions.mode, mode)))
    .where(and(eq(sessionPrompts.id, promptId), eq(sessionPrompts.userId, userId))).limit(1);
  const [row] = await (lock ? query.for("update", { of: sessionPrompts }) : query);
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

const answerKey = (value: string) => value.normalize("NFC").trim().toLowerCase().replace(/\s+/gu, " ");

async function rememberedAnswer(tx: DbReader, prompt: Prompt, alternatives: string[]) {
  const keys = alternatives.map(answerKey);
  if (!keys.length) return null;
  const disputed = alias(reviewLogs, "disputed_answer");
  const rows = await tx.select({ judge: reviewLogs.judge }).from(reviewLogs).where(and(
    eq(reviewLogs.userId, prompt.userId), eq(reviewLogs.cardId, prompt.cardId),
    sql`${reviewLogs.judge}->>'status' = 'decided' AND ${reviewLogs.judge}->'output'->>'choice' IN ('correct', 'partial')`,
    inArray(sql<string>`${reviewLogs.judge}->>'cacheKey'`, keys),
    notExists(tx.select({ id: disputed.promptId }).from(disputed).where(and(
      eq(disputed.userId, prompt.userId), eq(disputed.cardId, prompt.cardId), eq(disputed.matcherDisputed, true),
      sql`${disputed.judge}->>'cacheKey' = ${reviewLogs.judge}->>'cacheKey'`,
    ))),
  )).orderBy(desc(reviewLogs.reviewedAt)).limit(keys.length);
  for (const [index, key] of keys.entries()) {
    const cached = rows.find(({ judge }) => judge?.cacheKey === key)?.judge;
    if (cached) return { ...cached, input: alternatives[index], status: "cached" as const, latencyMs: 0 };
  }
  return null;
}

async function gradeAnswer(tx: DbReader, prompt: Prompt, word: Word, input: AnswerInput) {
  const reversed = prompt.kind === "reverse_choice" && input.kind === "tap";
  const meaning = prompt.kind === "voice_meaning" && (input.kind === "typed" || input.kind === "voice" || input.kind === "skip");
  if (!reversed && !meaning) throw new StudyConflict();
  if (reversed && !prompt.choiceWordIds?.includes(input.choice)) throw new StudyConflict();
  const alternatives = input.kind === "voice" ? input.alternatives : input.kind === "typed" ? [input.value] : [];
  const found = alternatives.map((value) => ({ value, match: matchMeaning(value, word.acceptedAnswers, word.definition) }))
    .find(({ match }) => match !== null);
  const judge = found || !meaning ? null : await rememberedAnswer(tx, prompt, alternatives);
  if (input.kind === "voice" && !found && !judge && !input.final) return null;
  const match = found?.match ?? judge?.input;
  return {
    correct: reversed ? input.choice === word.id : Boolean(match),
    matched: reversed && input.choice === word.id ? word.term : match ?? null,
    transcript: found?.value ?? judge?.input ?? alternatives[0] ?? (reversed ? input.choice : null),
    input: reversed ? "tap" as const : input.kind === "voice" ? "voice" as const : "typed" as const,
    judge,
  };
}

function waitingOn(attempt: JudgeAttempt | null): AnswerReceipt["judgePending"] {
  if (!attempt) return;
  return attempt.failure || Date.now() >= attempt.deadline ? "self_grade" : "checking";
}

type Resolution = { attempt: JudgeAttempt; judge: JudgeLog };

async function completedReceipt(tx: DbReader, prompt: Prompt, word: Word): Promise<AnswerReceipt> {
  const [log] = await tx.select().from(reviewLogs).where(and(
    eq(reviewLogs.promptId, prompt.id), eq(reviewLogs.userId, prompt.userId),
  ));
  return {
    accepted: true,
    feedback: log ? answerFeedback(word, log.correct, log.matchedAnswer, log.judge) : null,
    responseMs: log?.responseMs,
  };
}

function answerFeedback(word: Word, correct: boolean, matched: string | null, judge: JudgeLog | null): Feedback {
  return {
    correct, matched, term: word.term, definition: word.definition, example: word.example,
    ...(judge?.output && { decision: judge.output.choice }),
  };
}

export async function submitMeaning(userId: string, promptId: string, input: MeaningInput, mode: Mode,
  receivedAt: number, decide: (word: string, definition: string, text: string, signal: AbortSignal) => Promise<JudgeOutput>,
): Promise<AnswerReceipt> {
  const db = getDb();
  const { prompt, word } = await getPrompt(db, userId, promptId, mode);
  if (prompt.kind !== "voice_meaning") throw new StudyConflict();
  if (prompt.completedAt) return completedReceipt(db, prompt, word);
  if (prompt.judgeAttempt) return { accepted: false, feedback: null, judgePending: waitingOn(prompt.judgeAttempt) };
  const text = input.kind === "typed" ? input.value : input.alternatives[0];
  const immediate = await gradeAnswer(db, prompt, word, input);
  if (immediate?.correct || /^לא יודע(?:ת|ימ|ות)?(?: |$)/u.test(normalize(text)) || !/[\p{L}\p{N}]/u.test(text)) {
    return answerPrompt(userId, promptId, input, mode);
  }

  const attempt: JudgeAttempt = { model: judgeModel, input: input.kind, text, receivedAt, deadline: receivedAt + judgeTimeoutMs };
  const scope = and(eq(sessionPrompts.id, promptId), eq(sessionPrompts.userId, userId), isNull(sessionPrompts.completedAt));
  const [claimed] = await db.update(sessionPrompts).set({ judgeAttempt: attempt })
    .where(and(scope, isNull(sessionPrompts.judgeAttempt))).returning({ id: sessionPrompts.id });
  if (!claimed) {
    const { prompt: current } = await getPrompt(db, userId, promptId, mode);
    if (current.completedAt) return completedReceipt(db, current, word);
    return { accepted: false, feedback: null, judgePending: waitingOn(current.judgeAttempt) };
  }

  const start = performance.now();
  const remaining = attempt.deadline - Date.now();
  const signal = AbortSignal.timeout(Math.max(1, remaining));
  let output: JudgeOutput | undefined;
  try {
    if (remaining > 0) {
      output = await Promise.race([
        decide(word.term, word.definition, text, signal),
        new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
      ]);
    }
  } catch (error) {
    if (!signal.aborted) console.warn("Vocabulary judge unavailable", { type: error instanceof Error ? error.name : "unknown" });
  }
  const latencyMs = Math.round(performance.now() - start);
  if (!output || Date.now() >= attempt.deadline) {
    const failure = Date.now() >= attempt.deadline || signal.aborted ? "timeout" : "unavailable";
    await db.update(sessionPrompts).set({ judgeAttempt: { ...attempt, failure, latencyMs } }).where(scope);
    const { prompt: current } = await getPrompt(db, userId, promptId, mode);
    if (current.completedAt) return completedReceipt(db, current, word);
    return { accepted: false, feedback: null, judgePending: "self_grade" };
  }
  return answerPrompt(userId, promptId, input, mode, {
    attempt, judge: { model: attempt.model, input: text, output, latencyMs, status: "decided", cacheKey: answerKey(text) },
  });
}

export async function selfGradeMeaning(userId: string, promptId: string, correct: boolean, mode: Mode): Promise<AnswerReceipt> {
  const db = getDb();
  const { prompt, word } = await getPrompt(db, userId, promptId, mode);
  if (prompt.kind !== "voice_meaning") throw new StudyConflict();
  if (prompt.completedAt) return completedReceipt(db, prompt, word);
  const attempt = prompt.judgeAttempt;
  if (!attempt || waitingOn(attempt) === "checking") return { accepted: false, feedback: null, judgePending: "checking" };
  return answerPrompt(userId, promptId, { kind: "typed", value: attempt.text }, mode, {
    attempt, judge: {
      model: attempt.model, input: attempt.text, output: null, latencyMs: attempt.latencyMs ?? Math.max(0, attempt.deadline - attempt.receivedAt),
      status: attempt.failure ?? "timeout", cacheKey: answerKey(attempt.text), selfGrade: correct,
    },
  });
}

async function localDay(tx: Transaction, settings: Settings, now: Date) {
  const [day] = await tx.select({ today: sql<string>`(${now.toISOString()}::timestamptz AT TIME ZONE ${settings.timeZone})::date::text` })
    .from(appUsers).where(eq(appUsers.id, settings.userId));
  return day.today;
}

export function answerPrompt(
  userId: string, promptId: string, input: AnswerInput, mode: Mode = "learn", resolution?: Resolution,
): Promise<AnswerReceipt> {
  return withLearner(userId, async (tx, settings) => {
    const { prompt, card, word } = await getPrompt(tx, userId, promptId, mode, true);
    if (prompt.completedAt) return completedReceipt(tx, prompt, word);
    if (resolution && (prompt.kind !== "voice_meaning" || prompt.judgeAttempt?.receivedAt !== resolution.attempt.receivedAt)) throw new StudyConflict();
    if (!resolution && prompt.judgeAttempt) return { accepted: false, feedback: null, judgePending: waitingOn(prompt.judgeAttempt) };
    const now = new Date();
    let responseMs: number | undefined;
    let result: Feedback | null = null;
    let correct = false;
    let next: ReturnType<typeof nextStage> = null;
    if (prompt.kind === "intro" && input.kind === "continue") {
      await tx.update(cards).set({ firstSeenAt: now, state: "learning" }).where(and(eq(cards.id, card.id), isNull(cards.firstSeenAt)));
      next = nextStage(prompt.kind, false, prompt.ordinal);
    } else {
      const grade = resolution ? {
        correct: resolution.judge.selfGrade ?? (resolution.judge.output !== null && resolution.judge.output.choice !== "wrong"),
        matched: resolution.judge.output && resolution.judge.output.choice !== "wrong" ? resolution.attempt.text : null,
        transcript: resolution.attempt.text, input: resolution.attempt.input, judge: resolution.judge,
      } : await gradeAnswer(tx, prompt, word, input);
      if (!grade) return { accepted: false, feedback: null };
      const { matched, transcript } = grade;
      correct = grade.correct;
      responseMs = Math.max(0, Math.min(86_400_000, (resolution?.attempt.receivedAt ?? +now) - +prompt.issuedAt));
      const history = await tx.select({ ms: reviewLogs.responseMs }).from(reviewLogs).where(and(
        eq(reviewLogs.userId, userId), eq(reviewLogs.correct, true), eq(reviewLogs.cardType, prompt.kind),
        gt(reviewLogs.responseMs, 0),
      )).orderBy(sql`${reviewLogs.reviewedAt} DESC`).limit(21);
      const rating = rateAnswer(correct, Math.max(prompt.hintLevel, Number(grade.judge?.output?.choice === "partial")), responseMs, history.map(({ ms }) => ms));
      if (mode === "learn") next = nextStage(prompt.kind, correct, prompt.ordinal);
      const today = await localDay(tx, settings, now);
      const apply = mode === "learn" || card.state !== "review" || card.lastAnswerDay !== today;
      const [queued] = mode === "infinite" && card.state === "learning"
        ? await tx.select({ stage: learningQueue.nextStage }).from(learningQueue)
          .where(and(eq(learningQueue.userId, userId), eq(learningQueue.cardId, card.id))).limit(1)
        : [];
      const stage = queued ? queued.stage : next?.nextStage;
      // Infinite updates memory state without consuming a reserved Learn step.
      const scheduled = apply
        ? mode === "learn" || queued
          ? scheduleLearning(card, settings, rating, now, stage === "reverse_choice" ? stage : stage ? "voice_meaning" : null)
          : scheduleReview(card, settings, rating, now)
        : null;
      const difficultyForSession = Math.min(10, Math.max(1, scheduled?.updates.difficulty ?? card.difficulty));
      await tx.insert(reviewLogs).values({
        promptId, userId, sessionId: prompt.sessionId, cardId: card.id, mode, cardType: prompt.kind,
        input: grade.input, correct, rating, responseMs,
        transcript, matchedAnswer: matched, appliedToFsrs: apply, reviewDay: today, reviewedAt: now, judge: grade.judge,
        previousReviewAt: card.lastReviewAt, previousDue: card.due, previousState: card.state,
        previousStability: card.stability, previousDifficulty: card.difficulty, previousLearningStep: card.learningStep,
        elapsedDays: scheduled?.reviewElapsedDays ?? Math.max(0, (+now - +(card.lastReviewAt ?? now)) / 86_400_000),
        scheduledDays: scheduled?.updates.scheduledDays ?? card.scheduledDays, difficultyForSession,
      });
      if (scheduled) await tx.update(cards).set({ ...scheduled.updates, lastAnswerDay: today })
        .where(and(eq(cards.id, card.id), eq(cards.userId, userId)));
      result = answerFeedback(word, correct, matched, grade.judge);
    }
    const queueKey = and(eq(learningQueue.runId, prompt.sessionId), eq(learningQueue.cardId, card.id), eq(learningQueue.userId, userId));
    if (mode === "learn") {
      if (next) await tx.update(learningQueue).set(next).where(queueKey);
      else await tx.delete(learningQueue).where(queueKey);
      await tx.update(learningRuns).set({ promptCount: prompt.ordinal }).where(and(eq(learningRuns.id, prompt.sessionId), eq(learningRuns.userId, userId)));
    }
    await tx.update(sessionPrompts).set({ completedAt: now, judgeAttempt: null }).where(eq(sessionPrompts.id, promptId));
    await tx.update(sessions).set({
      endedAt: now,
      durationMs: sql`least(2147483647, greatest(0, extract(epoch FROM (${now.toISOString()}::timestamptz - ${sessions.startedAt})) * 1000))::integer`,
      ...(result && {
        answers: sql`${sessions.answers} + 1`,
        correct: sql`${sessions.correct} + ${Number(correct)}`,
        combo: correct ? sql`${sessions.combo} + 1` : 0,
        bestCombo: correct ? sql`greatest(${sessions.bestCombo}, ${sessions.combo} + 1)` : sessions.bestCombo,
        difficulty1To10: sql`(
          SELECT SUM(difficulty_for_session * greatest(response_ms, 250)::double precision)
          / SUM(greatest(response_ms, 250)::double precision)
          FROM review_logs WHERE user_id = ${userId} AND session_id = ${prompt.sessionId}
        )`,
      }),
    }).where(and(eq(sessions.id, prompt.sessionId), eq(sessions.userId, userId)));
    return { accepted: true, feedback: result, responseMs };
  });
}

export async function hasUsedInfinite(userId: string) {
  const [result] = await getDb().select({ id: sessions.id }).from(sessions).where(and(
    eq(sessions.userId, userId), eq(sessions.mode, "infinite"), gt(sessions.answers, 0),
  )).limit(1);
  return Boolean(result);
}

export function openInfinite(userId: string, sessionId: string): Promise<InfiniteState> {
  return withLearner(userId, async (tx, settings) => {
    const now = new Date();
    const today = await localDay(tx, settings, now);
    const recent = await tx.select({ id: reviewLogs.cardId }).from(reviewLogs).where(and(
      eq(reviewLogs.userId, userId), eq(reviewLogs.mode, "infinite"),
    )).orderBy(desc(reviewLogs.reviewedAt), desc(reviewLogs.promptId)).limit(5);
    const daily = await tx.select({ day: reviewLogs.reviewDay, answers: count() }).from(reviewLogs)
      .where(eq(reviewLogs.userId, userId)).groupBy(reviewLogs.reviewDay);
    const [{ best }] = await tx.select({ best: sql<number>`coalesce(max(${sessions.bestCombo}), 0)::int` })
      .from(sessions).where(and(eq(sessions.userId, userId), eq(sessions.mode, "infinite")));
    const [existing] = await tx.select().from(sessions).where(and(
      eq(sessions.userId, userId), eq(sessions.mode, "infinite"), eq(sessions.id, sessionId),
    )).limit(1);
    const [{ averageMs }] = existing ? await tx.select({
      averageMs: sql<number>`coalesce(avg(${reviewLogs.responseMs}), 0)::float8`,
    }).from(reviewLogs).where(and(eq(reviewLogs.userId, userId), eq(reviewLogs.sessionId, sessionId))) : [{ averageMs: 0 }];
    const state = {
      prompt: null, inputDefault: settings.inputDefault, startedAt: (existing?.startedAt ?? now).toISOString(),
      answers: existing?.answers ?? 0, correct: existing?.correct ?? 0, averageMs,
      combo: existing?.combo ?? 0, best, goal: settings.dailyGoal,
      today: daily.find(({ day }) => day === today)?.answers ?? 0,
      streak: dayStreak(today, daily.map(({ day }) => day)),
    };
    if (existing) {
      const [pending] = await tx.select({ prompt: sessionPrompts, word: words }).from(sessionPrompts)
        .innerJoin(cards, eq(cards.id, sessionPrompts.cardId)).innerJoin(words, eq(words.id, cards.wordId))
        .where(and(eq(sessionPrompts.userId, userId), eq(sessionPrompts.sessionId, sessionId), isNull(sessionPrompts.completedAt))).limit(1);
      if (pending) return { ...state, prompt: await showReviewPrompt(tx, pending.prompt, pending.word), judgePending: waitingOn(pending.prompt.judgeAttempt) };
    }
    const candidates = await tx.select().from(cards).where(and(eq(cards.userId, userId), isNotNull(cards.firstSeenAt)));
    if (!candidates.length) return state;
    const misses = await tx.selectDistinct({ cardId: reviewLogs.cardId }).from(reviewLogs).where(and(
      eq(reviewLogs.userId, userId), eq(reviewLogs.correct, false),
      gte(reviewLogs.reviewedAt, new Date(+now - 2 * 86_400_000)),
    ));
    const missed = new Set(misses.map(({ cardId }) => cardId));
    const recall = recallEstimator(settings, now);
    const chosen = pickInfinite(candidates.map((card) => ({
      id: card.id, wordId: card.wordId,
      weight: .2 + 4 * (1 - recall(card)) + (card.state !== "review" ? 1.2 : 0) + (missed.has(card.id) ? 1.8 : 0),
    })), recent.map(({ id }) => id));
    if (!chosen) throw new StudyConflict();
    const [word] = await tx.select().from(words).where(eq(words.id, chosen.wordId));
    if (!existing) {
      const inserted = await tx.insert(sessions).values({
        id: sessionId, userId, mode: "infinite", startedAt: now, endedAt: now,
      }).onConflictDoNothing().returning({ id: sessions.id });
      if (!inserted.length) throw new StudyConflict();
    }
    const kind = infiniteKind(state.answers);
    const [prompt] = await tx.insert(sessionPrompts).values({
      userId, sessionId, cardId: chosen.id, kind, ordinal: state.answers + 1,
      choiceWordIds: kind === "reverse_choice" ? await makeChoices(tx, word) : null,
    }).returning();
    return { ...state, prompt: await showReviewPrompt(tx, prompt, word) };
  });
}

export function markMatcherDispute(userId: string, promptId: string, disputed: boolean) {
  return withLearner(userId, async (tx) => {
    const updated = await tx.update(reviewLogs).set({ matcherDisputed: disputed }).where(and(
      eq(reviewLogs.userId, userId), eq(reviewLogs.promptId, promptId),
      eq(reviewLogs.mode, "infinite"), eq(reviewLogs.cardType, "voice_meaning"),
      eq(reviewLogs.input, "voice"), isNotNull(reviewLogs.transcript),
    )).returning({ id: reviewLogs.promptId });
    if (!updated.length) throw new StudyConflict();
    return { disputed };
  });
}
