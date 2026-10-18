import { eq, sql } from "drizzle-orm";
import { fetchAllStations, fetchDepartement, type ApiStation } from "@/lib/carburants/api";
import { pruneVisits } from "@/lib/analytics";
import type { Db } from "@/lib/db";
import { currentPrices, ingestRuns, priceHistory, stations } from "@/lib/db/schema";

export type IngestResult = { departements: string[]; stations: number; changes: number; confirmations: number; removed: number };

/** `COLLECT_DEPARTEMENTS=all` : toute la France en une requête (~9 800 stations, ~9 Mo). */
export const ALL_DEPARTEMENTS = "all";

const CHUNK = 500;
function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Une collecte complète : API → stations, current_prices, price_history (changements seulement). */
export async function ingest(db: Db, departements: string[], log: (msg: string) => void = console.log): Promise<IngestResult> {
  const [run] = await db.insert(ingestRuns).values({ departements: departements.join(",") }).returning({ id: ingestRuns.id });
  try {
    const incoming: ApiStation[] = [];
    const onRetry = (label: string) => (attempt: number, reason: string, delay: number) =>
      log(`[api] ${label} : tentative ${attempt} après "${reason}" (attente ${Math.round(delay / 1000)} s)`);
    if (departements.includes(ALL_DEPARTEMENTS)) {
      const list = await fetchAllStations({ onRetry: onRetry("France") });
      log(`[api] France : ${list.length} stations`);
      incoming.push(...list);
    } else {
      for (const dep of departements) {
        const list = await fetchDepartement(dep, { onRetry: onRetry(dep) });
        log(`[api] ${dep} : ${list.length} stations`);
        incoming.push(...list);
      }
    }
    if (incoming.length === 0) throw new Error("Le flux n'a renvoyé aucune station");

    const result = await db.transaction(async (tx) => {
      const now = new Date();
      for (const batch of chunks(incoming)) {
        await tx
          .insert(stations)
          .values(
            batch.map((s) => ({
              id: s.id,
              postalCode: s.postalCode,
              city: s.city,
              address: s.address,
              departement: s.departement,
              lat: s.lat,
              lon: s.lon,
              roadType: s.roadType,
              automate24: s.automate24,
              services: s.services,
              openingHours: s.openingHours,
              outOfStock: s.outOfStock,
              lastSeenAt: now,
            })),
          )
          .onConflictDoUpdate({
            target: stations.id,
            set: {
              postalCode: sql`excluded.postal_code`,
              city: sql`excluded.city`,
              address: sql`excluded.address`,
              departement: sql`excluded.departement`,
              lat: sql`excluded.lat`,
              lon: sql`excluded.lon`,
              roadType: sql`excluded.road_type`,
              automate24: sql`excluded.automate_24`,
              services: sql`excluded.services`,
              openingHours: sql`excluded.opening_hours`,
              outOfStock: sql`excluded.out_of_stock`,
              lastSeenAt: sql`excluded.last_seen_at`,
            },
          });
      }

      // Comparaison faite DANS PostgreSQL : on envoie les prix du flux dans une table
      // temporaire au lieu de rapatrier les ~35 000 prix connus (quota de transfert Neon).
      await tx.execute(sql`
        create temp table incoming_prices (station_id int, fuel text, price numeric(5,3), updated_at timestamptz) on commit drop
      `);
      const rows = incoming.flatMap((st) => st.prices.map((p) => ({ ...p, stationId: st.id })));
      for (const batch of chunks(rows, 2000)) {
        const values = sql.join(
          batch.map((r) => sql`(${r.stationId}::int, ${r.fuel}::text, ${r.price}::numeric, ${r.updatedAt.toISOString()}::timestamptz)`),
          sql`, `,
        );
        await tx.execute(sql`insert into incoming_prices values ${values}`);
      }

      // 1. Historique : nouveau prix (ou premier prix connu). Un relevé plus ancien que le prix connu est ignoré.
      const changed = await tx.execute(sql`
        insert into ${priceHistory} (station_id, fuel, price, updated_at)
        select i.station_id, i.fuel, i.price, i.updated_at
        from incoming_prices i
        left join ${currentPrices} c on c.station_id = i.station_id and c.fuel = i.fuel
        where c.station_id is null or (i.updated_at >= c.updated_at and i.price <> c.price)
        on conflict do nothing
      `);
      // 2. Dernier prix connu : nouveau prix ou même prix reconfirmé plus tard.
      const updated = await tx.execute(sql`
        insert into ${currentPrices} (station_id, fuel, price, updated_at)
        select station_id, fuel, price, updated_at from incoming_prices
        on conflict (station_id, fuel) do update set price = excluded.price, updated_at = excluded.updated_at
        where excluded.updated_at > ${currentPrices.updatedAt}
           or (excluded.updated_at = ${currentPrices.updatedAt} and excluded.price <> ${currentPrices.price})
      `);
      // 3. Ruptures : carburant disparu d'une station présente dans ce relevé.
      const removed = await tx.execute(sql`
        delete from ${currentPrices} c
        where c.station_id in (select id from ${stations} where last_seen_at = ${now.toISOString()}::timestamptz)
          and not exists (select 1 from incoming_prices i where i.station_id = c.station_id and i.fuel = c.fuel)
      `);
      return {
        departements,
        stations: incoming.length,
        changes: changed.count,
        confirmations: updated.count - changed.count,
        removed: removed.count,
      };
    });

    await db
      .update(ingestRuns)
      .set({ finishedAt: new Date(), status: "ok", stationsSeen: result.stations, priceChanges: result.changes })
      .where(eq(ingestRuns.id, run.id));
    return result;
  } catch (err) {
    await db
      .update(ingestRuns)
      .set({ finishedAt: new Date(), status: "error", error: err instanceof Error ? err.message : String(err) })
      .where(eq(ingestRuns.id, run.id))
      .catch(() => undefined);
    throw err;
  }
}

/**
 * Historique détaillé conservé : 6 mois pour toute la France (~160 Mo, plan gratuit Neon).
 * Les tendances longues utilisent les médianes quotidiennes (fuel_daily), conservées sans limite.
 */
export const DEFAULT_RETENTION_DAYS = 190;

/**
 * Garde la base petite (plan gratuit Neon) :
 * - supprime l'historique plus vieux que `retentionDays`, sauf le dernier prix de chaque série ;
 * - ne garde que 14 jours de journal de collecte.
 */
export async function pruneOldData(db: Db, retentionDays = DEFAULT_RETENTION_DAYS) {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  const history = await db.execute(sql`
    delete from ${priceHistory} p
    where p.updated_at < ${cutoff}
      and exists (
        select 1 from ${priceHistory} newer
        where newer.station_id = p.station_id and newer.fuel = p.fuel and newer.updated_at > p.updated_at
      )
  `);
  const runs = await db.execute(sql`delete from ${ingestRuns} where started_at < now() - interval '14 days'`);
  const visitsPruned = await pruneVisits(db);
  return { history: history.count, runs: runs.count, visits: visitsPruned };
}

/** Supprime les lignes d'historique qui répètent le prix précédent de la même série. */
export async function compactHistory(db: Db) {
  const res = await db.execute(sql`
    delete from ${priceHistory} p
    using (
      select station_id, fuel, updated_at, price, lag(price) over (partition by station_id, fuel order by updated_at) as prev
      from ${priceHistory}
    ) x
    where p.station_id = x.station_id and p.fuel = x.fuel and p.updated_at = x.updated_at and x.prev = x.price
  `);
  return res.count;
}
