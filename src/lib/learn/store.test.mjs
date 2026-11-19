import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as pgDrizzle } from "drizzle-orm/pglite";
import { answerPrompt, openLearn, revealHint } from "./store";

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
  const deck = await postgres.query("INSERT INTO decks (kind, name) VALUES ('builtin', 'אוצר') RETURNING id");
  builtIn = deck.rows[0].id;
  for (const [index, word] of source.slice(0, 37).entries()) {
    await postgres.query("INSERT INTO words(deck_id, term, term_plain, definition, example, accepted_answers, unit, position, difficulty) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [
      builtIn, word.term, word.term.replace(/[\u0591-\u05C7]/gu, ""), word.definition, word.example,
      word.accepted_answers, word.unit, index + 1, word.difficulty,
    ]);
  }
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
