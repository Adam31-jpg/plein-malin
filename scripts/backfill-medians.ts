/**
 * Rattrapage des médianes quotidiennes par département, SANS stocker l'historique détaillé
 * (limité à 6 mois pour le plan gratuit) :
 *   npm run backfill:medians -- --from 2024-01-01
 *
 * Lit les fichiers annuels officiels en streaming, station par station. Chaque station devient
 * une série de prix journaliers (Int16, en millièmes) ; on en déduit la médiane de chaque
 * département et carburant, jusqu'à hier. Les cours de marché sont rattrapés sur la même période.
 * Carburants : les 4 principaux (E85 et GPLc, rares et stables, n'en ont pas besoin).
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { AnnualXmlParser, readAnnualFile, type HistoryRow } from "@/lib/carburants/annual";
import { syncMarket } from "@/lib/daily";
import { getDb } from "@/lib/db";
import { fuelDaily, stations } from "@/lib/db/schema";
import type { FuelCode } from "@/lib/fuels";

const BACKFILL_FUELS: FuelCode[] = ["gazole", "e10", "sp98", "sp95"];
const MIN_STATIONS = 3;
const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const from = arg("--from") ?? "2024-01-01";

function median(values: number[]) {
  const s = values.sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function main() {
  const db = getDb();
  const known = await db
    .select({ id: stations.id, departement: stations.departement })
    .from(stations)
    .where(sql`${stations.lastSeenAt} > now() - interval '7 days' and ${stations.departement} is not null`);
  const deptOf = new Map(known.map((s) => [s.id, s.departement!]));

  const t0 = Date.parse(`${from}T00:00:00Z`);
  const today = Date.parse(`${iso(Date.now())}T00:00:00Z`);
  const D = Math.round((today - t0) / DAY); // jusqu'à hier inclus
  console.log(`[backfill] ${known.length} stations, ${BACKFILL_FUELS.length} carburants, ${D} jours (${from} → ${iso(today - DAY)})`);

  // series[fuel][stationId] = prix journaliers en millièmes (0 = inconnu)
  const series = new Map<FuelCode, Map<number, Int16Array>>(BACKFILL_FUELS.map((f) => [f, new Map()]));
  // Dernier prix connu d'une station à la fin de l'année précédente (en millièmes).
  const carried = new Map<string, number>();

  let yearStart = t0;
  let yearEnd = t0;
  const parser = new AnnualXmlParser(new Set(deptOf.keys()), (id, rows: HistoryRow[]) => {
    for (const fuel of BACKFILL_FUELS) {
      const list = rows.filter((r) => r.fuel === fuel).sort((a, b) => +a.updatedAt - +b.updatedAt);
      const key = `${id}:${fuel}`;
      let current = carried.get(key) ?? 0;
      if (!list.length && !current) continue;
      let arr = series.get(fuel)!.get(id);
      if (!arr) series.get(fuel)!.set(id, (arr = new Int16Array(D)));
      let j = 0;
      for (let t = yearStart; t < yearEnd; t += DAY) {
        while (j < list.length && +list[j].updatedAt < t + DAY) current = Math.round(list[j++].price * 1000);
        const d = Math.round((t - t0) / DAY);
        if (d >= 0 && d < D && current) arr[d] = current;
      }
      while (j < list.length) current = Math.round(list[j++].price * 1000);
      if (current) carried.set(key, current);
    }
  });

  for (let year = new Date(t0).getUTCFullYear() - 1; year <= new Date(today).getUTCFullYear(); year++) {
    yearStart = Math.max(Date.UTC(year, 0, 1), t0);
    yearEnd = Math.min(Date.UTC(year + 1, 0, 1), today);
    console.log(`[backfill] ${year}…`);
    await readAnnualFile(year, parser);
  }

  // Médianes par département.
  const byDept = new Map<string, number[]>();
  for (const [id, dep] of deptOf) byDept.set(dep, [...(byDept.get(dep) ?? []), id]);
  const rows: { day: string; fuel: string; area: string; median: number; stations: number }[] = [];
  for (const fuel of BACKFILL_FUELS) {
    const perStation = series.get(fuel)!;
    for (const [area, ids] of byDept) {
      const arrays = ids.map((id) => perStation.get(id)).filter((a): a is Int16Array => !!a);
      for (let d = 0; d < D; d++) {
        const values: number[] = [];
        for (const a of arrays) if (a[d]) values.push(a[d]);
        if (values.length >= MIN_STATIONS) rows.push({ day: iso(t0 + d * DAY), fuel, area, median: median(values) / 1000, stations: values.length });
      }
    }
  }
  console.log(`[backfill] ${rows.length} médianes calculées, écriture…`);
  for (let i = 0; i < rows.length; i += 2000) {
    await db
      .insert(fuelDaily)
      .values(rows.slice(i, i + 2000))
      .onConflictDoUpdate({ target: [fuelDaily.area, fuelDaily.fuel, fuelDaily.day], set: { median: sql`excluded.median`, stations: sql`excluded.stations` } });
  }
  const market = await syncMarket(db, iso(t0 - 60 * DAY));
  const [count] = await db.select({ n: sql<number>`count(*)::int`, areas: sql<number>`count(distinct area)::int` }).from(fuelDaily);
  console.log(`[backfill] terminé : table ${count.n} lignes, ${count.areas} départements · ${market.brent} cours Brent`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`[backfill] ÉCHEC : ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
