import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as pgDrizzle } from "drizzle-orm/pglite";
import { answerPrompt, markMatcherDispute, openInfinite, openLearn, revealHint, selfGradeMeaning, submitMeaning } from "./store";
import { judgeTimeoutMs } from "./judge-config";
import { randomUUID } from "node:crypto";
import { saveDeck, listDecks } from "../import/decks";
import { getSessionDetails, listSessions } from "../sessions";
import { deleteAccount, exportData, getPreferences, savePreferences } from "../settings";

const runtime = vi.hoisted(() => ({ db: null }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: () => runtime.db }));
vi.mock("@/lib/neon-auth", () => ({ getNeonAuth: () => null }));
const postgres = new PGlite();
const source = JSON.parse(await readFile("data/builtin-words.json", "utf8"));
const expected = new Map(source.map((word) => [word.term.normalize("NFC"), word]));
let builtIn;

beforeAll(async () => {
  runtime.db = pgDrizzle(postgres);
  vi.stubEnv("DATABASE_URL", "postgresql://local/ozar_test");
  await postgres.exec(await readFile("drizzle/0001_vocabulary_trainer.sql", "utf8"));
  await postgres.exec(await readFile("drizzle/0002_infinite_practice.sql", "utf8"));
  await postgres.exec(await readFile("drizzle/0003_meaning_judge.sql", "utf8"));
  const deck = await postgres.query("INSERT INTO decks (kind, name) VALUES ('builtin', 'אוצר') RETURNING id");
  builtIn = deck.rows[0].id;
  for (const [index, word] of source.slice(0, 37).entries()) {
    await postgres.query("INSERT INTO words(deck_id, term, term_plain, definition, example, accepted_answers, unit, position, difficulty) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [
      builtIn, word.term, word.term.replace(/[\u0591-\u05C7]/gu, ""), word.definition, word.example,
      word.accepted_answers, word.unit, index + 1, word.difficulty,
    ]);
  }
});

it("practices only seen cards, enforces the cooldown and applies FSRS according to card state and date", async () => {
  const userId = "infinite-learner";
  const sessionId = randomUUID();
  expect((await openInfinite(userId, sessionId)).prompt).toBeNull();
  let learn = await openLearn(userId, true);
  for (let index = 0; index < 6; index++) {
    expect(learn.prompt.kind).toBe("intro");
    await answerPrompt(userId, learn.prompt.id, { kind: "continue" });
    learn = await openLearn(userId, false);
  }
  const pendingLearn = learn.prompt.id;
  // Force one seen card to start graduated with yesterday as its last answer day.
  await postgres.query(`
    UPDATE cards SET state = 'review', last_answer_day = current_date - 1, stability = 6,
      difficulty = 5, reps = 3, last_review_at = now() - interval '1 day'
    WHERE user_id = $1 AND word_id = (SELECT id FROM words WHERE position = 1 AND deck_id = $2)
  `, [userId, builtIn]);
  const history = [];
  let answered = 0;
  for (let index = 0; index < 12; index++) {
    const state = await openInfinite(userId, sessionId);
    expect(state.answers).toBe(index);
    const prompt = state.prompt;
    expect((await openInfinite(userId, sessionId)).prompt.id).toBe(prompt.id);
    expect(prompt.kind).toBe(index % 4 === 3 ? "reverse_choice" : "voice_meaning");
    const row = (await postgres.query(`
      SELECT words.position, cards.first_seen_at FROM session_prompts
      JOIN cards ON cards.id = session_prompts.card_id JOIN words ON words.id = cards.word_id
      WHERE session_prompts.id = $1
    `, [prompt.id])).rows[0];
    expect(row.first_seen_at).toBeTruthy();
    expect(history.slice(-5)).not.toContain(row.position);
    history.push(row.position);
    const word = source[row.position - 1];
    const correctChoice = prompt.kind === "reverse_choice" && prompt.choices.find(({ term }) => term === word.term);
    const input = correctChoice ? { kind: "tap", choice: correctChoice.id } : {
      kind: "voice", final: false, alternatives: ["לא יודע", word.accepted_answers[0]],
    };
    const result = await answerPrompt(userId, prompt.id, input, "infinite");
    expect(result.feedback.correct).toBe(true);
    answered++;
    if (index === 0) {
      await expect(markMatcherDispute("another-user", prompt.id, true)).rejects.toThrow();
      expect(await markMatcherDispute(userId, prompt.id, true)).toEqual({ disputed: true });
      await expect(answerPrompt("another-user", prompt.id, input, "infinite")).rejects.toThrow();
    }
  }
  expect(answered).toBe(12);
  const graded = (await postgres.query(`
    SELECT words.position, review_logs.applied_to_fsrs AS applied FROM review_logs
    JOIN cards ON cards.id = review_logs.card_id JOIN words ON words.id = cards.word_id
    JOIN session_prompts ON session_prompts.id = review_logs.prompt_id
    WHERE review_logs.session_id = $1 ORDER BY session_prompts.ordinal
  `, [sessionId])).rows;
  expect(graded.filter(({ position }) => position === 1).map(({ applied }) => applied)).toEqual([true, false]);
  expect(graded.filter(({ position }) => position !== 1).every(({ applied }) => applied)).toBe(true);
  expect((await openLearn(userId, false)).prompt.id).toBe(pendingLearn);
  expect(await openInfinite(userId, sessionId)).toMatchObject({ correct: 12, combo: 12, best: 12, today: 12, streak: 1 });
});

afterAll(async () => { vi.unstubAllEnvs(); await postgres.close(); });

it("resumes a real PostgreSQL queue, grades all prompt types, isolates users and graduates only once", async () => {
  let state = await openLearn("learner-a", true);
  expect(state.total).toBe(25);
  expect(state.prompt.kind).toBe("intro");
  expect(state.prompt.term).toBe(source[0].term);
  const firstPrompt = state.prompt;
  const other = await openLearn("learner-b", true);
  expect(other.prompt.term).toBe(firstPrompt.term);
  expect(other.prompt.id).not.toBe(firstPrompt.id);
  await expect(answerPrompt("learner-b", firstPrompt.id, {kind:"continue"})).rejects.toThrow();
  const [initial, retry] = await Promise.all([
    answerPrompt("learner-a", firstPrompt.id, {kind:"continue"}),
    answerPrompt("learner-a", firstPrompt.id, {kind:"continue"}),
  ]);
  expect(initial.accepted && retry.accepted).toBe(true);
  state = await openLearn("learner-a", false);
  expect(state.prompt.term).toBe(source[1].term);
  expect((await openLearn("learner-a", true)).prompt.id).toBe(state.prompt.id);
  let typed = 0, wrong = 0, reverse = 0;
  for (let n = 0; state.prompt && n < 110; n++) {
    const p = state.prompt;
    if (p.kind === "intro") {
      await answerPrompt("learner-a", p.id, {kind:"continue"});
    } else if (p.kind === "voice_meaning") {
      const word = expected.get(p.term);
      if (!typed) {
        expect((await answerPrompt("learner-a", p.id, {kind:"voice", alternatives:["לא יודע"], final:false})).accepted).toBe(false);
        expect((await revealHint("learner-a", p.id, 1)).hintLevel).toBe(1);
        expect((await revealHint("learner-a", p.id, 2)).letters).toBeTruthy();
        expect((await answerPrompt("learner-a", p.id, {kind:"skip"})).feedback.correct).toBe(false);
        wrong++;
      } else {
        const result = await answerPrompt("learner-a", p.id, {kind:"typed", value:word.accepted_answers[0]});
        expect(result.feedback.correct).toBe(true);
      }
      typed++;
    } else {
      expect(p.choices).toHaveLength(4);
      const correct = p.choices.find(({term}) => expected.get(term)?.definition === p.definition);
      expect(correct).toBeTruthy();
      const result = await answerPrompt("learner-a", p.id, {kind:"tap", choice:correct.id});
      expect(result.feedback.correct).toBe(true);
      reverse++;
    }
    state = await openLearn("learner-a", false);
  }
  expect(state.prompt).toBeNull();
  expect(reverse).toBe(25);
  expect(wrong).toBe(1);
  expect(typed).toBe(26);
  expect((await openLearn("learner-a", true)).prompt).toBeNull();
  expect((await openLearn("learner-b", false)).prompt.id).toBe(other.prompt.id);
  const persisted = await postgres.query("SELECT state, count(*)::int AS count, min(scheduled_days)::int AS days FROM cards WHERE user_id='learner-a' GROUP BY state");
  expect(persisted.rows).toEqual([{ state:"review", count:25, days: expect.any(Number) }]);
  expect(persisted.rows[0].days).toBeGreaterThanOrEqual(1);
  const summary = await postgres.query("SELECT answers, correct, difficulty_1_10::float AS difficulty FROM sessions WHERE user_id='learner-a'");
  expect(summary.rows[0]).toMatchObject({answers:51, correct:50});
  expect(summary.rows[0].difficulty).toBeGreaterThanOrEqual(1);
  const [session] = await listSessions("learner-a", 1);
  const values = await postgres.query("SELECT response_ms, difficulty_for_session FROM review_logs WHERE session_id = $1", [session.id]);
  const weights = values.rows.map(({ response_ms }) => Math.max(250, response_ms));
  const difficulty = values.rows.reduce((sum, { difficulty_for_session }, index) => sum + difficulty_for_session * weights[index], 0) /
    weights.reduce((sum, weight) => sum + weight, 0);
  expect(session.difficulty1To10).toBeCloseTo(difficulty);
  expect(session.accuracy).toBeCloseTo(50 / 51);
  expect((await getSessionDetails("learner-a", session.id, 1)).answers[0].correct).toBe(false);
  expect(await getSessionDetails("learner-b", session.id, 1)).toBeNull();
});

it("stores and exports private imported decks and protects data when identity deletion fails", async () => {
  const userId = "import-learner";
  const id = randomUUID();
  const entries = [{ term: "איתן", definition: "חזק, יציב; עמיד", example: null }];
  await savePreferences(userId, { newPerDay: 5, desiredRetention: .93, dailyGoal: 20, inputDefault: "typed" });
  expect((await getPreferences(userId)).inputDefault).toBe("typed");
  expect(await saveDeck(userId, id, "אישי", entries)).toEqual({ id });
  expect(await saveDeck(userId, id, "אישי", entries)).toEqual({ id });
  expect((await listDecks("different-user")).map(({ id }) => id)).not.toContain(id);
  expect((await openLearn("different-user", true, id)).prompt).toBeNull();
  expect((await openLearn(userId, true, id)).prompt.term).toBe("איתן");
  expect((await exportData(userId)).words[0].acceptedAnswers).toEqual(["חזק", "יציב", "עמיד"]);
  await expect(deleteAccount(userId, async () => { throw new Error("provider unavailable"); })).rejects.toThrow("provider unavailable");
  expect((await exportData(userId)).decks).toHaveLength(1);
  await deleteAccount(userId, async () => {});
  expect(await exportData(userId)).toMatchObject({ learner: null, decks: [], words: [], cards: [], sessions: [] });
  expect((await listDecks("different-user")).map(({ id }) => id)).toContain(builtIn);
});

const paraphrase = "אבן שאיתה משחיזים סכינים להיות חדים יותר";

async function firstInfinitePrompt(userId) {
  const { prompt } = await openLearn(userId, true);
  await answerPrompt(userId, prompt.id, { kind: "continue" });
  return (await openInfinite(userId, randomUUID())).prompt;
}

it("grades a paraphrase once, caps partial ratings, and keeps its exact reuse private", async () => {
  const user = "judge-partial";
  const prompt = await firstInfinitePrompt(user);
  const input = { kind: "voice", alternatives: [paraphrase], final: true };
  expect(await answerPrompt(user, prompt.id, { ...input, final: false }, "infinite")).toMatchObject({ accepted: false });
  let finish;
  const judge = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
  const first = submitMeaning(user, prompt.id, input, "infinite", Date.now(), judge);
  await vi.waitFor(() => expect(judge).toHaveBeenCalledTimes(1));
  expect(await submitMeaning(user, prompt.id, input, "infinite", Date.now(), judge)).toMatchObject({ judgePending: "checking" });
  expect(await selfGradeMeaning(user, prompt.id, false, "infinite")).toMatchObject({ judgePending: "checking" });
  finish({ choice: "partial", probabilities: { correct: .1, partial: .85, wrong: .05 } });
  expect(await first).toMatchObject({ feedback: { correct: true, decision: "partial", matched: paraphrase, definition: source[0].definition } });
  expect(judge).toHaveBeenCalledWith(source[0].term, source[0].definition, paraphrase, expect.any(AbortSignal));
  const [firstLog] = (await exportData(user)).reviews;
  expect(firstLog).toMatchObject({ rating: "hard", judge: { model: "google/gemini-decision-1", input: paraphrase,
    status: "decided", output: { choice: "partial" }, latencyMs: expect.any(Number) } });

  const repeated = (await openInfinite(user, randomUUID())).prompt;
  expect(await answerPrompt(user, repeated.id, { ...input, final: false }, "infinite")).toMatchObject({
    feedback: { decision: "partial", correct: true, matched: paraphrase },
  });
  const cached = (await exportData(user)).reviews.find(({ promptId }) => promptId === repeated.id);
  expect(cached).toMatchObject({ rating: "hard", judge: { status: "cached", latencyMs: 0 } });
  await markMatcherDispute(user, repeated.id, true);
  const afterDispute = (await openInfinite(user, randomUUID())).prompt;
  expect(await answerPrompt(user, afterDispute.id, { ...input, final: false }, "infinite")).toMatchObject({ accepted: false });

  const other = await firstInfinitePrompt("judge-other");
  expect(await answerPrompt("judge-other", other.id, { ...input, final: false }, "infinite")).toMatchObject({ accepted: false });
  await expect(submitMeaning("judge-other", prompt.id, input, "infinite", Date.now(), judge)).rejects.toThrow();
  expect(judge).toHaveBeenCalledTimes(1);
});

it("keeps a timed-out answer pending, and records its one-tap grade without remembering it", async () => {
  const user = "judge-timeout";
  const prompt = await firstInfinitePrompt(user);
  const input = { kind: "typed", value: paraphrase };
  const never = vi.fn(() => new Promise(() => {}));
  const receipt = await submitMeaning(user, prompt.id, input, "infinite", Date.now() - judgeTimeoutMs + 100, never);
  expect(receipt).toMatchObject({ accepted: false, feedback: null, judgePending: "self_grade" });
  expect(never).toHaveBeenCalledTimes(1);
  expect((await exportData(user)).reviews).toHaveLength(0);
  expect(await selfGradeMeaning(user, prompt.id, true, "infinite")).toMatchObject({ accepted: true, feedback: { correct: true } });
  expect(await selfGradeMeaning(user, prompt.id, false, "infinite")).toMatchObject({ accepted: true, feedback: { correct: true } });
  expect((await exportData(user)).reviews[0]).toMatchObject({ transcript: paraphrase, judge: {
    status: "timeout", selfGrade: true, output: null,
  } });
  const next = (await openInfinite(user, randomUUID())).prompt;
  expect(await answerPrompt(user, next.id, { kind: "voice", alternatives: [paraphrase], final: false }, "infinite"))
    .toMatchObject({ accepted: false });
  const wrong = vi.fn(async () => ({ choice: "wrong" }));
  expect(await submitMeaning(user, next.id, input, "infinite", Date.now(), wrong))
    .toMatchObject({ feedback: { correct: false, decision: "wrong", definition: source[0].definition } });
  expect((await exportData(user)).reviews.find(({ promptId }) => promptId === next.id)).toMatchObject({ rating: "again" });
});
