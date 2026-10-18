import { sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { stations } from "@/lib/db/schema";
import { fetchWithRetry } from "@/lib/http";

const OVERPASS = "https://overpass-api.de/api/interpreter";

export type OsmStation = { id: number; name: string | null; brand: string | null };

type OverpassElement = { tags?: Record<string, string> };

/**
 * Noms et enseignes de toutes les stations françaises depuis OpenStreetMap (~12 000, ~2 Mo).
 * L'appariement se fait uniquement par le tag `ref:FR:prix-carburants` (= id officiel) :
 * jamais par proximité, pour ne pas se tromper de station.
 */
export async function fetchOsmStations(): Promise<OsmStation[]> {
  const query =
    '[out:json][timeout:180];area["ISO3166-1"="FR"][admin_level=2]->.fr;' +
    'nwr["amenity"="fuel"]["ref:FR:prix-carburants"](area.fr);out tags;';
  const res = await fetchWithRetry(
    OVERPASS,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "plein-malin/1.0 (prix carburants)" },
      body: new URLSearchParams({ data: query }),
    },
    { retries: 3, timeoutMs: 240_000 },
  );
  const json = (await res.json()) as { elements?: OverpassElement[] };
  const out = new Map<number, OsmStation>();
  for (const el of json.elements ?? []) {
    const t = el.tags ?? {};
    for (const ref of (t["ref:FR:prix-carburants"] ?? "").split(";")) {
      const id = Number(ref.trim());
      if (!Number.isInteger(id) || id <= 0) continue;
      out.set(id, { id, name: t.name ?? t.brand ?? null, brand: t.brand ?? t.operator ?? null });
    }
  }
  return [...out.values()];
}

/** Met à jour name/brand des stations connues. Renvoie le nombre de stations nommées. */
export async function enrichFromOsm(db: Db): Promise<{ matched: number; total: number }> {
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(stations);
  if (!total) return { matched: 0, total: 0 };
  const osm = await fetchOsmStations();
  let matched = 0;
  for (let i = 0; i < osm.length; i += 1000) {
    const values = sql.join(
      osm.slice(i, i + 1000).map((o) => sql`(${o.id}::int, ${o.name}::text, ${o.brand}::text)`),
      sql`, `,
    );
    const res = await db.execute(sql`
      update ${stations} s set name = v.name, brand = v.brand
      from (values ${values}) as v(id, name, brand)
      where s.id = v.id
    `);
    matched += res.count;
  }
  return { matched, total };
}
