/**
 * Import de l'historique officiel (fichiers annuels) pour les stations déjà connues.
 *   npm run import:history               → 183 derniers jours (rétention de l'historique détaillé)
 *   npm run import:history -- --days 90
 *
 * À lancer après une première collecte (`npm run collect`) : seules les stations présentes
 * dans le flux actuel sont importées. Lecture station par station (mémoire constante, toute
 * la France possible) ; seuls les CHANGEMENTS de prix sont écrits ; import idempotent.
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { AnnualXmlParser, readAnnualFile, toChanges, type HistoryRow } from "@/lib/carburants/annual";
import { getDb } from "@/lib/db";
import { priceHistory, stations } from "@/lib/db/schema";
import { compactHistory, DEFAULT_RETENTION_DAYS } from "@/lib/ingest";

const daysArg = process.argv.indexOf("--days");
const days = Math.min(daysArg > 0 ? Number(process.argv[daysArg + 1]) : 183, DEFAULT_RETENTION_DAYS);
if (!Number.isFinite(days) || days < 1) throw new Error("--days doit être un nombre positif");

async function main() {
  const db = getDb();
  const known = await db.select({ id: stations.id }).from(stations).where(sql`${stations.lastSeenAt} > now() - interval '7 days'`);
  if (known.length === 0) throw new Error("Aucune station en base : lancez d'abord `npm run collect`.");

  const since = new Date(Date.now() - days * 86_400_000);
  // Chaque station est réduite à ses changements dès sa lecture (mémoire ~ nombre de changements,
  // pas de relevés bruts) ; les années sont recollées à la fin.
  const perStation = new Map<number, HistoryRow[]>();
  const parser = new AnnualXmlParser(new Set(known.map((s) => s.id)), (id, rows) => {
    const kept = toChanges(rows, since);
    if (kept.length) perStation.set(id, [...(perStation.get(id) ?? []), ...kept]);
  });
  for (let year = since.getFullYear(); year <= new Date().getFullYear(); year++) {
    console.log(`[import] téléchargement ${year}…`);
    await readAnnualFile(year, parser);
  }
  const changes: HistoryRow[] = [];
  for (const rows of perStation.values()) changes.push(...toChanges(rows, since));
  perStation.clear();
  console.log(`[import] ${known.length} stations → ${changes.length} changements depuis le ${since.toISOString().slice(0, 10)}`);

  let inserted = 0;
  for (let i = 0; i < changes.length; i += 2000) {
    const res = await db
      .insert(priceHistory)
      .values(changes.slice(i, i + 2000))
      .onConflictDoNothing()
      .returning({ stationId: priceHistory.stationId });
    inserted += res.length;
    if ((i / 2000) % 50 === 0) console.log(`[import] ${inserted} lignes insérées…`);
  }
  const removed = await compactHistory(db);
  console.log(`[import] ${inserted} lignes insérées, ${removed} doublon(s) de prix fusionné(s)`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`[import] ÉCHEC : ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
