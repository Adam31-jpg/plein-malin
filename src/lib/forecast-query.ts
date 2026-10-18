import { and, asc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { getDb } from "@/lib/db";
import { forecasts, fuelDaily, marketDaily } from "@/lib/db/schema";
import { forecast, type Forecast, type ForecastOptions, type MarketDay } from "@/lib/forecast";
import type { FuelCode } from "@/lib/fuels";
import { galEurPerLitre } from "@/lib/market";

/** Le gazole suit le gazole raffiné, les essences suivent l'essence raffinée (port de New York). */
export const marketSeriesFor = (fuel: FuelCode): "diesel" | "gasoline" => (fuel === "gazole" || fuel === "gplc" ? "diesel" : "gasoline");

/** Indicateurs lisibles affichés à l'utilisateur (variation sur 14 jours). */
export type MarketFacts = { day: string; brentUsd: number; brentChange14: number | null; eurUsd: number; eurUsdChange14: number | null };

export type ForecastResponse = Forecast & { area: string; marketSeries: "diesel" | "gasoline"; facts: MarketFacts | null; computedAt: string };

/** Brent et EUR/USD : dernière valeur et variation relative sur 14 jours. */
function marketFacts(market: { day: string; brentUsd: number | null; eurUsd: number | null }[]): MarketFacts | null {
  const rows = market.filter((m) => m.brentUsd !== null && m.eurUsd !== null) as { day: string; brentUsd: number; eurUsd: number }[];
  const last = rows.at(-1);
  if (!last) return null;
  const ref = new Date(Date.parse(`${last.day}T00:00:00Z`) - 14 * 86_400_000).toISOString().slice(0, 10);
  const before = [...rows].reverse().find((m) => m.day <= ref);
  return {
    day: last.day,
    brentUsd: last.brentUsd,
    eurUsd: last.eurUsd,
    brentChange14: before ? last.brentUsd / before.brentUsd - 1 : null,
    eurUsdChange14: before ? last.eurUsd / before.eurUsd - 1 : null,
  };
}

/**
 * Profondeur d'historique lue pour la prévision : toutes les médianes disponibles.
 * Testé sur les 9 derniers mois : l'historique complet fait mieux qu'1 an ou qu'une fenêtre glissante.
 */
const HISTORY_DAYS = 2000;
/** Carburants prévus (E85 et GPLc : peu de stations, prix quasi fixes). */
export const FORECAST_FUELS: FuelCode[] = ["gazole", "e10", "sp98", "sp95"];

type MarketRow = typeof marketDaily.$inferSelect;
const sinceDay = () => new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);

export async function loadMarket(db: Db): Promise<MarketRow[]> {
  return db.select().from(marketDaily).where(gte(marketDaily.day, sinceDay())).orderBy(asc(marketDaily.day));
}

function quotesFor(fuel: FuelCode, market: MarketRow[]): MarketDay[] {
  const series = marketSeriesFor(fuel);
  return market
    .map((m) => ({ day: m.day, usd: series === "diesel" ? m.dieselUsdGal : m.gasolineUsdGal, eurUsd: m.eurUsd }))
    .filter((m): m is { day: string; usd: number; eurUsd: number } => m.usd !== null && m.eurUsd !== null)
    .map((m) => ({ day: m.day, eurPerLitre: galEurPerLitre(m.usd, m.eurUsd) }));
}

/** Calcule et stocke les prévisions d'un département (tous les carburants prévus). */
export async function computeAreaForecasts(db: Db, area: string, market: MarketRow[], options: ForecastOptions = {}) {
  const daily = await db
    .select({ day: fuelDaily.day, fuel: fuelDaily.fuel, median: fuelDaily.median })
    .from(fuelDaily)
    .where(and(eq(fuelDaily.area, area), gte(fuelDaily.day, sinceDay())))
    .orderBy(asc(fuelDaily.day));
  const facts = marketFacts(market);
  const out: { fuel: FuelCode; forecast: Forecast }[] = [];
  for (const fuel of FORECAST_FUELS) {
    const f = forecast(
      fuel,
      daily.filter((d) => d.fuel === fuel),
      quotesFor(fuel, market),
      options,
    );
    if (f) out.push({ fuel, forecast: f });
  }
  if (out.length) {
    const now = new Date();
    await db
      .insert(forecasts)
      .values(out.map((o) => ({ area, fuel: o.fuel, computedAt: now, payload: { ...o.forecast, marketSeries: marketSeriesFor(o.fuel), facts } })))
      .onConflictDoUpdate({ target: [forecasts.area, forecasts.fuel], set: { payload: sql`excluded.payload`, computedAt: sql`excluded.computed_at` } });
  }
  return out;
}

/** Toutes les zones ayant des médianes : ~100 départements × 4 carburants (~2 s de calcul). */
export async function computeAllForecasts(db: Db, log: (msg: string) => void = console.log) {
  const market = await loadMarket(db);
  const areas = await db.selectDistinct({ area: fuelDaily.area }).from(fuelDaily);
  let count = 0;
  let reliable = 0;
  for (const { area } of areas) {
    const res = await computeAreaForecasts(db, area, market);
    count += res.length;
    reliable += res.filter((r) => r.forecast.reliable).length;
  }
  log(`[prévisions] ${count} prévisions pour ${areas.length} départements, dont ${reliable} affichées comme fiables`);
  return { count, areas: areas.length, reliable };
}

/** Dernière prévision stockée pour un département (lecture simple, aucun calcul à la requête). */
export async function getForecast(fuel: FuelCode, area: string): Promise<ForecastResponse | null> {
  const [row] = await getDb()
    .select()
    .from(forecasts)
    .where(and(eq(forecasts.fuel, fuel), eq(forecasts.area, area)))
    .limit(1);
  if (!row) return null;
  const payload = row.payload as Omit<ForecastResponse, "computedAt" | "area">;
  return { ...payload, area: row.area, facts: payload.facts ?? null, computedAt: row.computedAt.toISOString() };
}
