/**
 * Contrôle de véracité : `npm run verify`
 * - chaque prix en base est comparé au flux officiel en direct ;
 * - fraîcheur de chaque source (collecte, cours de marché, médianes, prévisions, noms OSM).
 * Code de sortie 1 si une incohérence est trouvée.
 */
import "dotenv/config";
import { desc, inArray, sql } from "drizzle-orm";
import { fetchAllStations, fetchDepartement } from "@/lib/carburants/api";
import { getDb } from "@/lib/db";
import { currentPrices, forecasts, fuelDaily, ingestRuns, marketDaily, stations } from "@/lib/db/schema";

const departements = (process.env.COLLECT_DEPARTEMENTS ?? "31").split(",").map((d) => d.trim()).filter(Boolean);
const problems: string[] = [];
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const ko = (msg: string) => {
  problems.push(msg);
  console.log(`  ✗ ${msg}`);
};
const hoursSince = (d: Date | string) => (Date.now() - new Date(d).getTime()) / 3_600_000;

async function main() {
  const db = getDb();
  const [lastRun] = await db.select().from(ingestRuns).orderBy(desc(ingestRuns.startedAt)).limit(1);

  console.log("Prix : base ↔ flux officiel en direct");
  const live = departements.includes("all") ? await fetchAllStations() : (await Promise.all(departements.map((d) => fetchDepartement(d)))).flat();
  const rows = departements.includes("all")
    ? await db.select().from(currentPrices)
    : await db.select().from(currentPrices).where(inArray(currentPrices.stationId, live.map((s) => s.id)));
  const db_ = new Map(rows.map((r) => [`${r.stationId}:${r.fuel}`, r]));
  // Les stations déclarent parfois un prix avec plusieurs heures de retard : un prix plus récent
  // dans le flux qu'en base (ou apparu depuis) attend simplement la prochaine collecte.
  let same = 0, pending = 0, wrong = 0;
  for (const s of live) {
    for (const p of s.prices) {
      const r = db_.get(`${s.id}:${p.fuel}`);
      if (r && Math.abs(r.price - p.price) < 0.0005) same++;
      else if (!r || p.updatedAt > r.updatedAt) pending++;
      else {
        wrong++;
        if (wrong <= 5) ko(`prix différent : station ${s.id} ${p.fuel} base ${r.price} / officiel ${p.price}`);
      }
    }
  }
  const total = same + pending + wrong;
  if (wrong === 0) ok(`${same}/${total} prix identiques au flux officiel (${pending} publiés depuis la dernière collecte)`);
  else ko(`${wrong} prix différents sur ${total}`);
  if (pending > total * 0.05) ko(`${pending} prix en attente : la collecte semble en retard`);

  console.log("Fraîcheur des sources");
  if (!lastRun) ko("aucune collecte");
  else if (lastRun.status !== "ok") ko(`dernière collecte en échec : ${lastRun.error}`);
  else if (hoursSince(lastRun.startedAt) > 2) ko(`dernière collecte il y a ${hoursSince(lastRun.startedAt).toFixed(1)} h`);
  else ok(`dernière collecte il y a ${Math.round(hoursSince(lastRun.startedAt) * 60)} min (${lastRun.stationsSeen} stations)`);

  const [m] = await db.select().from(marketDaily).where(sql`${marketDaily.dieselUsdGal} is not null`).orderBy(desc(marketDaily.day)).limit(1);
  if (!m) ko("aucun cours de marché");
  else if (hoursSince(m.day) > 24 * 10) ko(`cours de marché trop anciens (${m.day})`);
  else ok(`cours de marché au ${m.day} (publication EIA avec quelques jours de décalage)`);

  const [d] = await db.select().from(fuelDaily).orderBy(desc(fuelDaily.day)).limit(1);
  if (!d || hoursSince(d.day) > 48) ko(`médianes quotidiennes en retard (${d?.day ?? "aucune"})`);
  else ok(`médianes quotidiennes au ${d.day}`);

  const fc = await db.select({ fuel: forecasts.fuel, computedAt: forecasts.computedAt }).from(forecasts);
  const oldFc = fc.filter((f) => hoursSince(f.computedAt) > 36);
  if (fc.length === 0) ko("aucune prévision");
  else if (oldFc.length) ko(`prévisions anciennes : ${oldFc.map((f) => f.fuel).join(", ")}`);
  else ok(`${fc.length} prévisions de moins de 36 h`);

  const [named] = await db.select({ n: sql<number>`count(*) filter (where ${stations.name} is not null)::int`, t: sql<number>`count(*)::int` }).from(stations);
  if (named.n / Math.max(named.t, 1) < 0.8) ko(`seulement ${named.n}/${named.t} stations nommées`);
  else ok(`${named.n}/${named.t} stations nommées (OpenStreetMap)`);

  console.log(problems.length ? `\n${problems.length} problème(s)` : "\nTout est cohérent.");
  process.exit(problems.length ? 1 : 0);
}

main().catch((err) => {
  console.error(`[verify] ÉCHEC : ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
