import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as pgDrizzle } from "drizzle-orm/pglite";
import { answerPrompt, markMatcherDispute, openInfinite, openLearn, revealHint } from "./store";
import { randomUUID } from "node:crypto";

const runtime = vi.hoisted(() => ({ db: null }));
vi.mock("drizzle-orm/neon-serverless", () => ({ drizzle: () => runtime.db }));
const postgres = new PGlite();
const source = JSON.parse(await readFile("data/builtin-words.json", "utf8"));
const expected = new Map(source.map((word) => [word.term.normalize("NFC"), word]));
let builtIn;

beforeAll(async () => {
  runtime.db = pgDrizzle(postgres);
  vi.stubEnv("DATABASE_URL", "postgresql://local/ozar_test");
  await postgres.exec(await readFile("drizzle/0001_vocabulary_trainer.sql", "utf8"));
  await postgres.exec(await readFile("drizzle/0002_infinite_practice.sql", "utf8"));
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
});
