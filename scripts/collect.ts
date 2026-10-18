/**
 * Worker de collecte.
 *   npm run collect          → une collecte puis sortie (à lancer par cron)
 *   npm run collect -- --watch → boucle toutes les COLLECT_INTERVAL_MINUTES minutes
 */
import "dotenv/config";
import { getDb } from "@/lib/db";
import { ingest, pruneOldData } from "@/lib/ingest";

const departements = (process.env.COLLECT_DEPARTEMENTS ?? "31")
  .split(",")
  .map((d) => d.trim())
  .filter(Boolean);
const intervalMinutes = Number(process.env.COLLECT_INTERVAL_MINUTES ?? 15);
const watch = process.argv.includes("--watch");

const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);

async function runOnce(): Promise<boolean> {
  const started = Date.now();
  try {
    const r = await ingest(getDb(), departements, log);
    const pruned = await pruneOldData(getDb());
    log(
      `[collect] OK en ${((Date.now() - started) / 1000).toFixed(1)} s — ${r.stations} stations, ` +
        `${r.changes} changement(s), ${r.confirmations} confirmation(s), ${r.removed} rupture(s), ménage ${pruned.history} ligne(s)`,
    );
    return true;
  } catch (err) {
    log(`[collect] ÉCHEC : ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

async function main() {
  if (!watch) {
    const ok = await runOnce();
    process.exit(ok ? 0 : 1);
  }
  log(`[collect] mode watch, toutes les ${intervalMinutes} min, départements ${departements.join(", ")}`);
  for (;;) {
    await runOnce();
    await new Promise((r) => setTimeout(r, intervalMinutes * 60_000));
  }
}

void main();
