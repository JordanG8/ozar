CREATE TYPE "public"."answer_input" AS ENUM('voice', 'typed', 'tap');--> statement-breakpoint
CREATE TYPE "public"."card_state" AS ENUM('new', 'learning', 'review', 'relearning');--> statement-breakpoint
CREATE TYPE "public"."deck_kind" AS ENUM('builtin', 'imported');--> statement-breakpoint
CREATE TYPE "public"."input_preference" AS ENUM('voice', 'typed');--> statement-breakpoint
CREATE TYPE "public"."prompt_kind" AS ENUM('intro', 'voice_meaning', 'reverse_choice');--> statement-breakpoint
CREATE TYPE "public"."review_rating" AS ENUM('again', 'hard', 'good', 'easy');--> statement-breakpoint
CREATE TYPE "public"."study_mode" AS ENUM('learn', 'infinite');--> statement-breakpoint
CREATE TABLE "app_users" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"word_id" uuid NOT NULL,
	"first_seen_at" timestamp with time zone,
	"due" timestamp with time zone DEFAULT now() NOT NULL,
	"last_review_at" timestamp with time zone,
	"last_answer_day" date,
	"state" "card_state" DEFAULT 'new' NOT NULL,
	"stability" double precision DEFAULT 0 NOT NULL,
	"difficulty" double precision DEFAULT 0 NOT NULL,
	"elapsed_days" double precision DEFAULT 0 NOT NULL,
	"scheduled_days" double precision DEFAULT 0 NOT NULL,
	"reps" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"learning_step" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "cards_user_word" UNIQUE("user_id","word_id"),
	CONSTRAINT "cards_user_id" UNIQUE("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "decks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text,
	"name" text NOT NULL,
	"kind" "deck_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decks_owner_matches_kind" CHECK (("decks"."kind" = 'builtin') = ("decks"."owner_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "learning_queue" (
	"run_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"card_id" uuid NOT NULL,
	"next_stage" "prompt_kind" NOT NULL,
	"eligible_position" integer NOT NULL,
	CONSTRAINT "learning_queue_run_id_card_id_pk" PRIMARY KEY("run_id","card_id"),
	CONSTRAINT "learning_queue_positive_position" CHECK ("learning_queue"."eligible_position" > 0)
);
--> statement-breakpoint
CREATE TABLE "learning_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"deck_id" uuid NOT NULL,
	"prompt_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "learning_runs_user_id" UNIQUE("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "review_logs" (
	"prompt_id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"card_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"mode" "study_mode" NOT NULL,
	"card_type" "prompt_kind" NOT NULL,
	"correct" boolean NOT NULL,
	"rating" "review_rating" NOT NULL,
	"response_ms" integer NOT NULL,
	"input" "answer_input" NOT NULL,
	"transcript" text,
	"matched_answer" text,
	"applied_to_fsrs" boolean NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"review_day" date NOT NULL,
	"previous_review_at" timestamp with time zone,
	"previous_due" timestamp with time zone NOT NULL,
	"previous_state" "card_state" NOT NULL,
	"previous_stability" double precision NOT NULL,
	"previous_difficulty" double precision NOT NULL,
	"previous_learning_step" integer NOT NULL,
	"elapsed_days" double precision NOT NULL,
	"scheduled_days" double precision NOT NULL,
	"difficulty_for_session" double precision NOT NULL,
	CONSTRAINT "review_logs_response_nonnegative" CHECK ("review_logs"."response_ms" >= 0),
	CONSTRAINT "review_logs_ratings_match_result" CHECK ("review_logs"."correct" = ("review_logs"."rating" <> 'again')),
	CONSTRAINT "review_logs_input_matches_prompt" CHECK (
    ("review_logs"."card_type" = 'reverse_choice' AND "review_logs"."input" = 'tap') OR
    ("review_logs"."card_type" = 'voice_meaning' AND "review_logs"."input" IN ('voice', 'typed'))
  ),
	CONSTRAINT "review_logs_difficulty_range" CHECK ("review_logs"."difficulty_for_session" BETWEEN 1 AND 10)
);
--> statement-breakpoint
CREATE TABLE "session_prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"session_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"kind" "prompt_kind" NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"hint_level" smallint DEFAULT 0 NOT NULL,
	"choice_word_ids" uuid[],
	CONSTRAINT "session_prompts_session_ordinal" UNIQUE("session_id","ordinal"),
	CONSTRAINT "session_prompts_user_session_card_id" UNIQUE("user_id","session_id","card_id","id"),
	CONSTRAINT "session_prompts_hint_range" CHECK ("session_prompts"."hint_level" BETWEEN 0 AND 2),
	CONSTRAINT "session_prompts_ordinal_positive" CHECK ("session_prompts"."ordinal" > 0),
	CONSTRAINT "session_prompts_choices_match_kind" CHECK (
    CASE WHEN "session_prompts"."kind" = 'reverse_choice'
      THEN "session_prompts"."choice_word_ids" IS NOT NULL AND cardinality("session_prompts"."choice_word_ids") = 4
      ELSE "session_prompts"."choice_word_ids" IS NULL
    END
  )
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"mode" "study_mode" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"answers" integer DEFAULT 0 NOT NULL,
	"correct" integer DEFAULT 0 NOT NULL,
	"accuracy" double precision GENERATED ALWAYS AS (CASE WHEN "answers" = 0 THEN 0 ELSE "correct"::double precision / "answers" END) STORED,
	"difficulty_1_10" double precision,
	CONSTRAINT "sessions_user_id" UNIQUE("user_id","id"),
	CONSTRAINT "sessions_counts_valid" CHECK ("sessions"."correct" >= 0 AND "sessions"."answers" >= "sessions"."correct" AND "sessions"."duration_ms" >= 0),
	CONSTRAINT "sessions_difficulty_range" CHECK ("sessions"."difficulty_1_10" BETWEEN 1 AND 10)
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"new_per_day" integer DEFAULT 25 NOT NULL,
	"daily_goal" integer DEFAULT 50 NOT NULL,
	"desired_retention" double precision DEFAULT 0.9 NOT NULL,
	"fsrs_params" jsonb,
	"input_default" "input_preference" DEFAULT 'voice' NOT NULL,
	"time_zone" text DEFAULT 'Asia/Jerusalem' NOT NULL,
	CONSTRAINT "settings_new_per_day_nonnegative" CHECK ("user_settings"."new_per_day" >= 0),
	CONSTRAINT "settings_positive_goal" CHECK ("user_settings"."daily_goal" > 0),
	CONSTRAINT "settings_retention_range" CHECK ("user_settings"."desired_retention" > 0 AND "user_settings"."desired_retention" < 1)
);
--> statement-breakpoint
CREATE TABLE "words" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deck_id" uuid NOT NULL,
	"term" text NOT NULL,
	"term_plain" text NOT NULL,
	"definition" text NOT NULL,
	"example" text,
	"accepted_answers" text[] NOT NULL,
	"unit" integer,
	"position" integer NOT NULL,
	"difficulty" smallint DEFAULT 5 NOT NULL,
	CONSTRAINT "words_deck_position" UNIQUE("deck_id","position"),
	CONSTRAINT "words_difficulty_range" CHECK ("words"."difficulty" BETWEEN 1 AND 10),
	CONSTRAINT "words_numbering_positive" CHECK ("words"."position" > 0 AND ("words"."unit" IS NULL OR "words"."unit" > 0)),
	CONSTRAINT "words_answers_required" CHECK (cardinality("words"."accepted_answers") > 0)
);
--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_word_id_words_id_fk" FOREIGN KEY ("word_id") REFERENCES "public"."words"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_owner_id_app_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_queue" ADD CONSTRAINT "learning_queue_user_run_fk" FOREIGN KEY ("user_id","run_id") REFERENCES "public"."learning_runs"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_queue" ADD CONSTRAINT "learning_queue_user_card_fk" FOREIGN KEY ("user_id","card_id") REFERENCES "public"."cards"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_runs" ADD CONSTRAINT "learning_runs_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_runs" ADD CONSTRAINT "learning_runs_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_logs" ADD CONSTRAINT "review_logs_user_prompt_fk" FOREIGN KEY ("user_id","session_id","card_id","prompt_id") REFERENCES "public"."session_prompts"("user_id","session_id","card_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_prompts" ADD CONSTRAINT "session_prompts_user_session_fk" FOREIGN KEY ("user_id","session_id") REFERENCES "public"."sessions"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_prompts" ADD CONSTRAINT "session_prompts_user_card_fk" FOREIGN KEY ("user_id","card_id") REFERENCES "public"."cards"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "words" ADD CONSTRAINT "words_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cards_user_due" ON "cards" USING btree ("user_id","due");--> statement-breakpoint
CREATE INDEX "cards_word" ON "cards" USING btree ("word_id");--> statement-breakpoint
CREATE UNIQUE INDEX "decks_one_builtin" ON "decks" USING btree ("kind") WHERE "decks"."kind" = 'builtin';--> statement-breakpoint
CREATE INDEX "decks_owner" ON "decks" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "learning_queue_run_eligible" ON "learning_queue" USING btree ("run_id","eligible_position");--> statement-breakpoint
CREATE INDEX "learning_queue_user_card" ON "learning_queue" USING btree ("user_id","card_id");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_runs_one_active" ON "learning_runs" USING btree ("user_id","deck_id") WHERE "learning_runs"."finished_at" IS NULL;--> statement-breakpoint
CREATE INDEX "learning_runs_deck" ON "learning_runs" USING btree ("deck_id");--> statement-breakpoint
CREATE INDEX "review_logs_user_reviewed" ON "review_logs" USING btree ("user_id","reviewed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "review_logs_session_correct" ON "review_logs" USING btree ("session_id","correct","reviewed_at");--> statement-breakpoint
CREATE INDEX "review_logs_user_card_reviewed" ON "review_logs" USING btree ("user_id","card_id","reviewed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "session_prompts_user_card" ON "session_prompts" USING btree ("user_id","card_id");--> statement-breakpoint
CREATE INDEX "sessions_user_started" ON "sessions" USING btree ("user_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "words_deck_difficulty" ON "words" USING btree ("deck_id","difficulty");