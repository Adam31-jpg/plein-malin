import { sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { fuelDaily, marketDaily } from "@/lib/db/schema";
import { FUELS } from "@/lib/fuels";
import { fetchEurUsd, fetchFred } from "@/lib/market";

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const daysAgo = (n: number) => isoDay(new Date(Date.now() - n * 86_400_000));
/** Les médianes ne sont recalculées depuis l'historique détaillé que sur la dernière année. */
const SAFE_RECOMPUTE_DAYS = 180;

type MarketRow = { brentUsd?: number; dieselUsdGal?: number; gasolineUsdGal?: number; eurUsd?: number };

/** Met à jour les cours depuis `from` (YYYY-MM-DD). Les sources sont fusionnées par jour. */
export async function syncMarket(db: Db, from: string) {
  const [brent, diesel, gasoline, eurUsd] = await Promise.all([
    fetchFred("brent", from),
    fetchFred("diesel", from),
    fetchFred("gasoline", from),
    fetchEurUsd(from),
  ]);
  const byDay = new Map<string, MarketRow>();
  const put = (points: { day: string; value: number }[], key: keyof MarketRow) => {
    for (const p of points) byDay.set(p.day, { ...byDay.get(p.day), [key]: p.value });
  };
  put(brent, "brentUsd");
  put(diesel, "dieselUsdGal");
  put(gasoline, "gasolineUsdGal");
  put(eurUsd, "eurUsd");
  const rows = [...byDay].map(([day, v]) => ({
    day,
    brentUsd: v.brentUsd ?? null,
    dieselUsdGal: v.dieselUsdGal ?? null,
    gasolineUsdGal: v.gasolineUsdGal ?? null,
    eurUsd: v.eurUsd ?? null,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    await db
      .insert(marketDaily)
      .values(rows.slice(i, i + 500))
      .onConflictDoUpdate({
        target: marketDaily.day,
        set: {
          brentUsd: sql`coalesce(excluded.brent_usd, ${marketDaily.brentUsd})`,
          dieselUsdGal: sql`coalesce(excluded.diesel_usd_gal, ${marketDaily.dieselUsdGal})`,
          gasolineUsdGal: sql`coalesce(excluded.gasoline_usd_gal, ${marketDaily.gasolineUsdGal})`,
          eurUsd: sql`coalesce(excluded.eur_usd, ${marketDaily.eurUsd})`,
        },
      });
  }
  return {
    brent: brent.length,
    diesel: diesel.length,
    gasoline: gasoline.length,
    eurUsd: eurUsd.length,
    lastBrent: brent.at(-1)?.day ?? null,
    lastEurUsd: eurUsd.at(-1)?.day ?? null,
  };
}

/** Une médiane départementale n'est retenue qu'avec au moins 3 stations. */
const MIN_STATIONS = 3;

/**
 * Recalcule le prix médian quotidien par département et carburant depuis `from`, à partir de
 * l'historique détaillé : pour chaque jour, le dernier prix connu de chaque station ouverte.
 * Prévu pour quelques jours (cron quotidien) ; les années passées viennent de `backfill:medians`.
 */
export async function refreshFuelDaily(db: Db, from: string) {
  // Au-delà de 6 mois, l'historique détaillé est élagué : les médianes plus anciennes viennent
  // de `backfill:medians` (fichiers officiels) et ne doivent pas être recalculées depuis la base.
  if (from < daysAgo(SAFE_RECOMPUTE_DAYS)) from = daysAgo(SAFE_RECOMPUTE_DAYS);
  const fuels = sql.join(
    FUELS.map((f) => sql`(${f.code})`),
    sql`, `,
  );
  const res = await db.execute(sql`
    insert into ${fuelDaily} (day, fuel, area, median, stations)
    select d.day::date, f.fuel, s.departement, round(percentile_cont(0.5) within group (order by p.price)::numeric, 3), count(*)::int
    from generate_series(${from}::date, current_date, interval '1 day') d(day)
    cross join (values ${fuels}) f(fuel)
    cross join stations s
    cross join lateral (
      select h.price from price_history h
      where h.station_id = s.id and h.fuel = f.fuel and h.updated_at < d.day + interval '1 day'
      order by h.updated_at desc
      limit 1
    ) p
    where s.departement is not null and s.last_seen_at > now() - interval '7 days'
    group by d.day, f.fuel, s.departement
    having count(*) >= ${MIN_STATIONS}
    on conflict (area, fuel, day) do update set median = excluded.median, stations = excluded.stations
  `);
  return res.count;
}
