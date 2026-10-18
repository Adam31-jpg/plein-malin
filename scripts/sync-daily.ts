/**
 * Tâches quotidiennes : cours de marché, médianes des derniers jours, prévisions par département.
 *   npm run sync:daily               → 3 derniers jours de médianes
 *   npm run sync:daily -- --days 30
 */
import "dotenv/config";
import { getDb } from "@/lib/db";
import { daysAgo, refreshFuelDaily, syncMarket } from "@/lib/daily";
import { computeAllForecasts } from "@/lib/forecast-query";

const daysArg = process.argv.indexOf("--days");
const days = daysArg > 0 ? Number(process.argv[daysArg + 1]) : 3;

export async function runDaily(log: (msg: string) => void = console.log) {
  const db = getDb();
  const market = await syncMarket(db, daysAgo(30));
  log(
    `[daily] marché : ${market.brent} Brent, ${market.diesel} gazole, ${market.gasoline} essence (dernier ${market.lastBrent}), ` +
      `${market.eurUsd} EUR/USD (dernier ${market.lastEurUsd})`,
  );
  const t = Date.now();
  const n = await refreshFuelDaily(db, daysAgo(days));
  log(`[daily] ${n} médianes quotidiennes recalculées en ${((Date.now() - t) / 1000).toFixed(1)} s`);
  await computeAllForecasts(db, log);
}

if (process.argv[1]?.endsWith("sync-daily.ts")) {
  runDaily()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`[daily] ÉCHEC : ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
}
