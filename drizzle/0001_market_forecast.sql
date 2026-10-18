CREATE TABLE "forecasts" (
	"fuel" text PRIMARY KEY NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fuel_daily" (
	"day" date NOT NULL,
	"fuel" text NOT NULL,
	"median" numeric(5, 3) NOT NULL,
	"stations" integer NOT NULL,
	CONSTRAINT "fuel_daily_day_fuel_pk" PRIMARY KEY("day","fuel")
);
--> statement-breakpoint
CREATE TABLE "market_daily" (
	"day" date PRIMARY KEY NOT NULL,
	"brent_usd" numeric(8, 3),
	"diesel_usd_gal" numeric(8, 4),
	"gasoline_usd_gal" numeric(8, 4),
	"eur_usd" numeric(8, 5)
);
--> statement-breakpoint
ALTER TABLE "stations" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "stations" ADD COLUMN "brand" text;--> statement-breakpoint
ALTER TABLE "stations" ADD COLUMN "out_of_stock" jsonb DEFAULT '[]'::jsonb NOT NULL;