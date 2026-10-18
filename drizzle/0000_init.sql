CREATE TABLE "current_prices" (
	"station_id" integer NOT NULL,
	"fuel" text NOT NULL,
	"price" numeric(5, 3) NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "current_prices_station_id_fuel_pk" PRIMARY KEY("station_id","fuel")
);
--> statement-breakpoint
CREATE TABLE "ingest_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"departements" text NOT NULL,
	"stations_seen" integer DEFAULT 0 NOT NULL,
	"price_changes" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "price_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"station_id" integer NOT NULL,
	"fuel" text NOT NULL,
	"price" numeric(5, 3) NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stations" (
	"id" integer PRIMARY KEY NOT NULL,
	"postal_code" text,
	"city" text,
	"address" text,
	"departement" text,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"road_type" text,
	"automate_24" boolean DEFAULT false NOT NULL,
	"services" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"opening_hours" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "current_prices" ADD CONSTRAINT "current_prices_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "current_prices_fuel_idx" ON "current_prices" USING btree ("fuel");--> statement-breakpoint
CREATE UNIQUE INDEX "price_history_station_fuel_date_uq" ON "price_history" USING btree ("station_id","fuel","updated_at");--> statement-breakpoint
CREATE INDEX "price_history_fuel_date_idx" ON "price_history" USING btree ("fuel","updated_at");--> statement-breakpoint
CREATE INDEX "stations_lat_lon_idx" ON "stations" USING btree ("lat","lon");--> statement-breakpoint
CREATE INDEX "stations_departement_idx" ON "stations" USING btree ("departement");