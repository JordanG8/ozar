import { sql } from "drizzle-orm";
import {
  boolean, check, date, doublePrecision, foreignKey, index, integer, jsonb,
  pgEnum, pgTable, primaryKey, smallint, text, timestamp, unique, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

export const deckKind = pgEnum("deck_kind", ["builtin", "imported"]);
export const studyMode = pgEnum("study_mode", ["learn", "infinite"]);
export const promptKind = pgEnum("prompt_kind", ["intro", "voice_meaning", "reverse_choice"]);
export const answerInput = pgEnum("answer_input", ["voice", "typed", "tap"]);
export const inputPreference = pgEnum("input_preference", ["voice", "typed"]);
export const cardState = pgEnum("card_state", ["new", "learning", "review", "relearning"]);
export const reviewRating = pgEnum("review_rating", ["again", "hard", "good", "easy"]);

type FsrsParameters = { version: string; weights: number[] };

export const appUsers = pgTable("app_users", {
  id: text("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const userSettings = pgTable("user_settings", {
  userId: text("user_id").primaryKey().references(() => appUsers.id, { onDelete: "cascade" }),
  newPerDay: integer("new_per_day").default(25).notNull(),
  dailyGoal: integer("daily_goal").default(50).notNull(),
  desiredRetention: doublePrecision("desired_retention").default(0.9).notNull(),
  fsrsParams: jsonb("fsrs_params").$type<FsrsParameters>(),
  inputDefault: inputPreference("input_default").default("voice").notNull(),
  timeZone: text("time_zone").default("Asia/Jerusalem").notNull(),
}, (table) => [
  check("settings_new_per_day_nonnegative", sql`${table.newPerDay} >= 0`),
  check("settings_positive_goal", sql`${table.dailyGoal} > 0`),
  check("settings_retention_range", sql`${table.desiredRetention} > 0 AND ${table.desiredRetention} < 1`),
]);

export const decks = pgTable("decks", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: text("owner_id").references(() => appUsers.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: deckKind("kind").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check("decks_owner_matches_kind", sql`(${table.kind} = 'builtin') = (${table.ownerId} IS NULL)`),
  uniqueIndex("decks_one_builtin").on(table.kind).where(sql`${table.kind} = 'builtin'`),
  index("decks_owner").on(table.ownerId),
]);

export const words = pgTable("words", {
  id: uuid("id").defaultRandom().primaryKey(),
  deckId: uuid("deck_id").notNull().references(() => decks.id, { onDelete: "cascade" }),
  term: text("term").notNull(),
  termPlain: text("term_plain").notNull(),
  definition: text("definition").notNull(),
  example: text("example"),
  acceptedAnswers: text("accepted_answers").array().notNull(),
  unit: integer("unit"),
  position: integer("position").notNull(),
  difficulty: smallint("difficulty").default(5).notNull(),
}, (table) => [
  unique("words_deck_position").on(table.deckId, table.position),
  index("words_deck_difficulty").on(table.deckId, table.difficulty),
  check("words_difficulty_range", sql`${table.difficulty} BETWEEN 1 AND 10`),
  check("words_numbering_positive", sql`${table.position} > 0 AND (${table.unit} IS NULL OR ${table.unit} > 0)`),
  check("words_answers_required", sql`cardinality(${table.acceptedAnswers}) > 0`),
]);

export const cards = pgTable("cards", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  wordId: uuid("word_id").notNull().references(() => words.id, { onDelete: "cascade" }),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }),
  due: timestamp("due", { withTimezone: true }).defaultNow().notNull(),
  lastReviewAt: timestamp("last_review_at", { withTimezone: true }),
  lastAnswerDay: date("last_answer_day"),
  state: cardState("state").default("new").notNull(),
  stability: doublePrecision("stability").default(0).notNull(),
  difficulty: doublePrecision("difficulty").default(0).notNull(),
  elapsedDays: doublePrecision("elapsed_days").default(0).notNull(),
  scheduledDays: doublePrecision("scheduled_days").default(0).notNull(),
  reps: integer("reps").default(0).notNull(),
  lapses: integer("lapses").default(0).notNull(),
  learningStep: integer("learning_step").default(0).notNull(),
}, (table) => [
  unique("cards_user_word").on(table.userId, table.wordId),
  unique("cards_user_id").on(table.userId, table.id),
  index("cards_user_due").on(table.userId, table.due),
  index("cards_word").on(table.wordId),
]);

export const learningRuns = pgTable("learning_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  deckId: uuid("deck_id").notNull().references(() => decks.id, { onDelete: "cascade" }),
  promptCount: integer("prompt_count").default(0).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (table) => [
  unique("learning_runs_user_id").on(table.userId, table.id),
  uniqueIndex("learning_runs_one_active").on(table.userId, table.deckId)
    .where(sql`${table.finishedAt} IS NULL`),
  index("learning_runs_deck").on(table.deckId),
]);

export const learningQueue = pgTable("learning_queue", {
  runId: uuid("run_id").notNull(),
  userId: text("user_id").notNull(),
  cardId: uuid("card_id").notNull(),
  nextStage: promptKind("next_stage").notNull(),
  eligiblePosition: integer("eligible_position").notNull(),
}, (table) => [
  primaryKey({ columns: [table.runId, table.cardId] }),
  foreignKey({
    name: "learning_queue_user_run_fk",
    columns: [table.userId, table.runId],
    foreignColumns: [learningRuns.userId, learningRuns.id],
  }).onDelete("cascade"),
  foreignKey({
    name: "learning_queue_user_card_fk",
    columns: [table.userId, table.cardId],
    foreignColumns: [cards.userId, cards.id],
  }).onDelete("cascade"),
  index("learning_queue_run_eligible").on(table.runId, table.eligiblePosition),
  index("learning_queue_user_card").on(table.userId, table.cardId),
  check("learning_queue_positive_position", sql`${table.eligiblePosition} > 0`),
]);

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  mode: studyMode("mode").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  durationMs: integer("duration_ms").default(0).notNull(),
  answers: integer("answers").default(0).notNull(),
  correct: integer("correct").default(0).notNull(),
  accuracy: doublePrecision("accuracy").generatedAlwaysAs(
    sql`CASE WHEN "answers" = 0 THEN 0 ELSE "correct"::double precision / "answers" END`,
  ),
  difficulty1To10: doublePrecision("difficulty_1_10"),
}, (table) => [
  unique("sessions_user_id").on(table.userId, table.id),
  index("sessions_user_started").on(table.userId, table.startedAt.desc()),
  check("sessions_counts_valid", sql`${table.correct} >= 0 AND ${table.answers} >= ${table.correct} AND ${table.durationMs} >= 0`),
  check("sessions_difficulty_range", sql`${table.difficulty1To10} BETWEEN 1 AND 10`),
]);

export const sessionPrompts = pgTable("session_prompts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  sessionId: uuid("session_id").notNull(),
  cardId: uuid("card_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  kind: promptKind("kind").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  hintLevel: smallint("hint_level").default(0).notNull(),
  choiceWordIds: uuid("choice_word_ids").array(),
}, (table) => [
  unique("session_prompts_session_ordinal").on(table.sessionId, table.ordinal),
  unique("session_prompts_user_session_card_id").on(table.userId, table.sessionId, table.cardId, table.id),
  foreignKey({
    name: "session_prompts_user_session_fk",
    columns: [table.userId, table.sessionId],
    foreignColumns: [sessions.userId, sessions.id],
  }).onDelete("cascade"),
  foreignKey({
    name: "session_prompts_user_card_fk",
    columns: [table.userId, table.cardId],
    foreignColumns: [cards.userId, cards.id],
  }).onDelete("cascade"),
  index("session_prompts_user_card").on(table.userId, table.cardId),
  check("session_prompts_hint_range", sql`${table.hintLevel} BETWEEN 0 AND 2`),
  check("session_prompts_ordinal_positive", sql`${table.ordinal} > 0`),
  check("session_prompts_choices_match_kind", sql`
    CASE WHEN ${table.kind} = 'reverse_choice'
      THEN ${table.choiceWordIds} IS NOT NULL AND cardinality(${table.choiceWordIds}) = 4
      ELSE ${table.choiceWordIds} IS NULL
    END
  `),
]);

export const reviewLogs = pgTable("review_logs", {
  promptId: uuid("prompt_id").primaryKey(),
  userId: text("user_id").notNull(),
  cardId: uuid("card_id").notNull(),
  sessionId: uuid("session_id").notNull(),
  mode: studyMode("mode").notNull(),
  cardType: promptKind("card_type").notNull(),
  correct: boolean("correct").notNull(),
  rating: reviewRating("rating").notNull(),
  responseMs: integer("response_ms").notNull(),
  input: answerInput("input").notNull(),
  transcript: text("transcript"),
  matchedAnswer: text("matched_answer"),
  appliedToFsrs: boolean("applied_to_fsrs").notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }).defaultNow().notNull(),
  reviewDay: date("review_day").notNull(),
  previousReviewAt: timestamp("previous_review_at", { withTimezone: true }),
  previousDue: timestamp("previous_due", { withTimezone: true }).notNull(),
  previousState: cardState("previous_state").notNull(),
  previousStability: doublePrecision("previous_stability").notNull(),
  previousDifficulty: doublePrecision("previous_difficulty").notNull(),
  previousLearningStep: integer("previous_learning_step").notNull(),
  elapsedDays: doublePrecision("elapsed_days").notNull(),
  scheduledDays: doublePrecision("scheduled_days").notNull(),
  difficultyForSession: doublePrecision("difficulty_for_session").notNull(),
}, (table) => [
  foreignKey({
    name: "review_logs_user_prompt_fk",
    columns: [table.userId, table.sessionId, table.cardId, table.promptId],
    foreignColumns: [sessionPrompts.userId, sessionPrompts.sessionId, sessionPrompts.cardId, sessionPrompts.id],
  }).onDelete("cascade"),
  index("review_logs_user_reviewed").on(table.userId, table.reviewedAt.desc()),
  index("review_logs_session_correct").on(table.sessionId, table.correct, table.reviewedAt),
  index("review_logs_user_card_reviewed").on(table.userId, table.cardId, table.reviewedAt.desc()),
  check("review_logs_response_nonnegative", sql`${table.responseMs} >= 0`),
  check("review_logs_ratings_match_result", sql`${table.correct} = (${table.rating} <> 'again')`),
  check("review_logs_input_matches_prompt", sql`
    (${table.cardType} = 'reverse_choice' AND ${table.input} = 'tap') OR
    (${table.cardType} = 'voice_meaning' AND ${table.input} IN ('voice', 'typed'))
  `),
  check("review_logs_difficulty_range", sql`${table.difficultyForSession} BETWEEN 1 AND 10`),
]);
