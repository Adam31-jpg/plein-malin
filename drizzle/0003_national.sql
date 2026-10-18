-- Historique compact : la clé primaire (station, carburant, date) remplace l'id et les index secondaires.
ALTER TABLE "price_history" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "price_history" DROP COLUMN "collected_at";--> statement-breakpoint
DROP INDEX IF EXISTS "price_history_station_fuel_date_uq";--> statement-breakpoint
DROP INDEX IF EXISTS "price_history_fuel_date_idx";--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_station_id_fuel_updated_at_pk" PRIMARY KEY("station_id","fuel","updated_at");--> statement-breakpoint
-- Médianes et prévisions par département (les données existantes sont celles du 31).
ALTER TABLE "fuel_daily" ADD COLUMN "area" text DEFAULT '31' NOT NULL;--> statement-breakpoint
ALTER TABLE "fuel_daily" DROP CONSTRAINT "fuel_daily_day_fuel_pk";--> statement-breakpoint
ALTER TABLE "fuel_daily" ADD CONSTRAINT "fuel_daily_area_fuel_day_pk" PRIMARY KEY("area","fuel","day");--> statement-breakpoint
ALTER TABLE "forecasts" ADD COLUMN "area" text DEFAULT '31' NOT NULL;--> statement-breakpoint
ALTER TABLE "forecasts" DROP CONSTRAINT "forecasts_pkey";--> statement-breakpoint
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_area_fuel_pk" PRIMARY KEY("area","fuel");
