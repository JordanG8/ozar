CREATE TABLE "deployment_probe" (
	"id" text PRIMARY KEY NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
