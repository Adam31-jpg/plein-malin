/**
 * Tâches planifiées, exécutées par GitHub Actions (voir .github/workflows/collect.yml) :
 *   node jobs/collector.mjs collect   → collecte nationale (changements de prix seulement)
 *   node jobs/collector.mjs daily     → ménage, cours de marché, médianes, prévisions ; le lundi, noms OSM
 *
 * Ce fichier est empaqueté en un seul module autonome (`npm run build:job`) pour que
 * le workflow démarre en quelques secondes, sans `npm ci`.
 */
import { getDb } from "@/lib/db";
import { ingest, pruneOldData } from "@/lib/ingest";
import { enrichFromOsm } from "@/lib/osm";
import { runDaily } from "../scripts/sync-daily";

const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);
const departements = (process.env.COLLECT_DEPARTEMENTS ?? "all")
  .split(",")
  .map((d) => d.trim())
  .filter(Boolean);

async function collect() {
  const started = Date.now();
  const r = await ingest(getDb(), departements, log);
  log(
    `[collect] OK en ${((Date.now() - started) / 1000).toFixed(1)} s — ${r.stations} stations, ` +
      `${r.changes} changement(s), ${r.confirmations} confirmation(s), ${r.removed} rupture(s)`,
  );
}

async function daily() {
  const pruned = await pruneOldData(getDb());
  log(`[daily] ménage : ${pruned.history} ligne(s) d'historique, ${pruned.runs} journal(aux)`);
  await runDaily(log);
  if (new Date().getUTCDay() === 1 || process.env.FORCE_OSM === "1") {
    const osm = await enrichFromOsm(getDb());
    log(`[osm] ${osm.matched} stations nommées sur ${osm.total}`);
  }
}

const tasks: Record<string, () => Promise<void>> = { collect, daily };
const task = tasks[process.argv[2] ?? ""];
if (!task) {
  console.error(`Tâche inconnue. Utilisation : node jobs/collector.mjs <${Object.keys(tasks).join("|")}>`);
  process.exit(2);
}
task()
  .then(() => process.exit(0))
  .catch((err) => {
    log(`[${process.argv[2]}] ÉCHEC : ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    process.exit(1);
  });
