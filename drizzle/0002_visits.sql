CREATE TABLE "visits" (
	"day" date NOT NULL,
	"visitor" text NOT NULL,
	"visitor_month" text NOT NULL,
	"pageviews" integer DEFAULT 1 NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"country" text,
	"region" text,
	"city" text,
	"device" text NOT NULL,
	"entry_path" text NOT NULL,
	"referrer" text,
	CONSTRAINT "visits_day_visitor_pk" PRIMARY KEY("day","visitor")
);
--> statement-breakpoint
CREATE INDEX "visits_last_seen_idx" ON "visits" USING btree ("last_seen");