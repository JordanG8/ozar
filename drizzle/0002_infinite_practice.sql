ALTER TABLE "review_logs" ADD COLUMN "matcher_disputed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "combo" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "best_combo" integer DEFAULT 0 NOT NULL;