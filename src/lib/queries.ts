import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { currentPrices, ingestRuns, priceHistory, stations } from "@/lib/db/schema";
import type { FuelCode } from "@/lib/fuels";
import { median } from "@/lib/format";
import { fetchNearbyLive, fetchStationLive } from "@/lib/carburants/api";
import { boundingBox, haversineKm, type LatLon } from "@/lib/geo";
import { brandFamily } from "@/lib/brands";

export type NearbyStation = {
  id: number;
  name: string | null;
  brand: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  lat: number;
  lon: number;
  roadType: string | null;
  automate24: boolean;
  price: number;
  updatedAt: string;
  distanceKm: number;
  /** Nombre de stations de la même enseigne (dans la zone collectée) au même prix exact */
  sameBrandSamePrice: number;
  /** Prix anormalement bas ou haut par rapport à la médiane : à vérifier sur place */
  unusual: boolean;
};

export type OutOfStockStation = { id: number; name: string | null; brand: string | null; address: string | null; city: string | null; distanceKm: number };

export type NearbyResult = {
  stations: NearbyStation[];
  /** Prix médian de la zone : robuste aux stations d'autoroute très chères. */
  median: number | null;
  /** Stations écartées car leur prix n'a pas été confirmé depuis plus de 7 jours */
  staleHidden: number;
  /** Stations proches en rupture de ce carburant */
  outOfStock: OutOfStockStation[];
  /** "live" : flux officiel interrogé à l'instant ; "db" : dernière collecte (secours) */
  source: "live" | "db";
  /** Date des prix affichés : maintenant en direct, ou date de la dernière collecte */
  pricesAt: string | null;
  /** Département de la station la plus proche (zone de la prévision affichée) */
  area: string | null;
};

/** Un prix non confirmé depuis 7 jours n'est plus considéré comme fiable. */
export const MAX_PRICE_AGE_DAYS = 7;
/** Écart à la médiane au-delà duquel un prix est signalé comme inhabituel. */
const UNUSUAL_LOW = 0.3;
const UNUSUAL_HIGH = 0.5;

const distanceSql = (center: LatLon) => sql<number>`(
  6371 * 2 * asin(sqrt(
    power(sin(radians(${stations.lat} - ${center.lat}) / 2), 2) +
    cos(radians(${center.lat})) * cos(radians(${stations.lat})) *
    power(sin(radians(${stations.lon} - ${center.lon}) / 2), 2)
  ))
)`;

type RawNearby = Omit<NearbyStation, "updatedAt" | "sameBrandSamePrice" | "unusual"> & { updatedAt: Date };

/** Stations de même enseigne au même prix exact (ex. prix plafonné par l'enseigne), dans les départements concernés. */
async function brandPriceCounts(fuel: FuelCode, departements: string[]): Promise<Map<string, number>> {
  if (departements.length === 0) return new Map();
  const rows = await getDb()
    .select({ brand: stations.brand, price: currentPrices.price })
    .from(currentPrices)
    .innerJoin(stations, eq(stations.id, currentPrices.stationId))
    .where(
      and(
        eq(currentPrices.fuel, fuel),
        inArray(stations.departement, departements),
        sql`${stations.brand} is not null and ${stations.lastSeenAt} > now() - interval '7 days'`,
      ),
    );
  const counts = new Map<string, number>();
  for (const r of rows) {
    const fam = brandFamily(r.brand);
    if (fam) counts.set(`${fam}|${r.price}`, (counts.get(`${fam}|${r.price}`) ?? 0) + 1);
  }
  return counts;
}

/** Filtre de fraîcheur, médiane, signalements : identique en direct et depuis la base. */
function finalize(
  rows: RawNearby[],
  outOfStock: OutOfStockStation[],
  samePrice: Map<string, number>,
  source: NearbyResult["source"],
  pricesAt: string | null,
  area: string | null,
): NearbyResult {
  const maxAge = Date.now() - MAX_PRICE_AGE_DAYS * 86_400_000;
  const fresh = rows.filter((r) => r.updatedAt.getTime() >= maxAge).sort((a, b) => a.price - b.price || a.distanceKm - b.distanceKm);
  const med = median(fresh.map((r) => r.price));
  const list: NearbyStation[] = fresh.map((r) => {
    const fam = brandFamily(r.brand);
    return {
      ...r,
      updatedAt: r.updatedAt.toISOString(),
      sameBrandSamePrice: fam ? (samePrice.get(`${fam}|${r.price}`) ?? 1) : 1,
      unusual: med !== null && (r.price < med - UNUSUAL_LOW || r.price > med + UNUSUAL_HIGH),
    };
  });
  return { stations: list, median: med, staleHidden: rows.length - fresh.length, outOfStock, source, pricesAt, area };
}

/**
 * Stations proches : interroge le flux officiel EN DIRECT (partout en France, prix de moins
 * de 10 min) et complète avec la base (noms OSM, enseignes). Si le flux est indisponible,
 * on retombe sur la dernière collecte en base (zone collectée seulement).
 */
export async function getNearby(params: LatLon & { radiusKm: number; fuel: FuelCode; limit?: number }): Promise<NearbyResult> {
  let live: Awaited<ReturnType<typeof fetchNearbyLive>>;
  try {
    live = await fetchNearbyLive(params, params.radiusKm);
  } catch (err) {
    console.warn("[nearby] flux officiel indisponible, repli sur la base", err instanceof Error ? err.message : err);
    return getNearbyFromDb(params);
  }

  // Enrichissement par la base : best effort, l'affichage des prix n'en dépend pas.
  const ids = live.map((s) => s.id);
  const departements = [...new Set(live.map((s) => s.departement).filter((d): d is string => !!d))];
  const nearest = live.reduce<(typeof live)[number] | null>((best, s) => (!best || haversineKm(params, s) < haversineKm(params, best) ? s : best), null);
  const [known, samePrice] = await Promise.all([
    ids.length
      ? getDb()
          .select({ id: stations.id, name: stations.name, brand: stations.brand })
          .from(stations)
          .where(inArray(stations.id, ids))
          .catch(() => [])
      : Promise.resolve([]),
    brandPriceCounts(params.fuel, departements).catch(() => new Map<string, number>()),
  ]);
  const names = new Map(known.map((k) => [k.id, k]));

  const rows: RawNearby[] = [];
  const ruptures: OutOfStockStation[] = [];
  for (const s of live) {
    const n = names.get(s.id);
    const base = { id: s.id, name: n?.name ?? null, brand: n?.brand ?? null, address: s.address, city: s.city, distanceKm: haversineKm(params, s) };
    const p = s.prices.find((x) => x.fuel === params.fuel);
    if (p) {
      rows.push({
        ...base,
        postalCode: s.postalCode,
        lat: s.lat,
        lon: s.lon,
        roadType: s.roadType,
        automate24: s.automate24,
        price: p.price,
        updatedAt: p.updatedAt,
      });
    } else if (s.outOfStock.includes(params.fuel)) {
      ruptures.push(base);
    }
  }
  ruptures.sort((a, b) => a.distanceKm - b.distanceKm);
  return finalize(rows.slice(0, params.limit ?? 200), ruptures.slice(0, 5), samePrice, "live", new Date().toISOString(), nearest?.departement ?? null);
}

/** Même résultat depuis la dernière collecte en base (secours si le flux officiel ne répond pas). */
export async function getNearbyFromDb(params: LatLon & { radiusKm: number; fuel: FuelCode; limit?: number }): Promise<NearbyResult> {
  const db = getDb();
  const box = boundingBox(params, params.radiusKm);
  const distance = distanceSql(params);
  const inZone = and(
    sql`${stations.lat} between ${box.minLat} and ${box.maxLat}`,
    sql`${stations.lon} between ${box.minLon} and ${box.maxLon}`,
    sql`${distance} <= ${params.radiusKm}`,
    // Une station absente du flux depuis 7 jours est considérée fermée.
    sql`${stations.lastSeenAt} > now() - interval '7 days'`,
  );
  const [rows, ruptures, lastIngestAt] = await Promise.all([
    db
      .select({
        id: stations.id,
        name: stations.name,
        brand: stations.brand,
        address: stations.address,
        city: stations.city,
        departement: stations.departement,
        postalCode: stations.postalCode,
        lat: stations.lat,
        lon: stations.lon,
        roadType: stations.roadType,
        automate24: stations.automate24,
        price: currentPrices.price,
        updatedAt: currentPrices.updatedAt,
        distanceKm: distance,
      })
      .from(stations)
      .innerJoin(currentPrices, and(eq(currentPrices.stationId, stations.id), eq(currentPrices.fuel, params.fuel)))
      .where(inZone)
      .orderBy(asc(currentPrices.price), asc(distance))
      .limit(params.limit ?? 200),
    db
      .select({ id: stations.id, name: stations.name, brand: stations.brand, address: stations.address, city: stations.city, distanceKm: distance })
      .from(stations)
      .where(and(inZone, sql`${stations.outOfStock} ? ${params.fuel}`))
      .orderBy(asc(distance))
      .limit(5),
    getLastIngestAt(),
  ]);
  const departements = [...new Set(rows.map((r) => r.departement).filter((d): d is string => !!d))];
  const samePrice = await brandPriceCounts(params.fuel, departements);
  const nearest = [...rows].sort((a, b) => Number(a.distanceKm) - Number(b.distanceKm))[0];
  return finalize(
    rows.map((r) => ({ ...r, distanceKm: Number(r.distanceKm) })),
    ruptures.map((r) => ({ ...r, distanceKm: Number(r.distanceKm) })),
    samePrice,
    "db",
    lastIngestAt,
    nearest?.departement ?? null,
  );
}

export async function getLastIngestAt(): Promise<string | null> {
  const [run] = await getDb()
    .select({ finishedAt: ingestRuns.finishedAt })
    .from(ingestRuns)
    .where(eq(ingestRuns.status, "ok"))
    .orderBy(desc(ingestRuns.finishedAt))
    .limit(1);
  return run?.finishedAt?.toISOString() ?? null;
}

/**
 * Fiche station : depuis la base si la station est dans la zone collectée (historique disponible),
 * sinon directement depuis le flux officiel (prix actuels, sans historique).
 */
export async function getStation(id: number) {
  const db = getDb();
  const [station] = await db.select().from(stations).where(eq(stations.id, id)).limit(1);
  if (station) {
    const prices = await db
      .select({ fuel: currentPrices.fuel, price: currentPrices.price, updatedAt: currentPrices.updatedAt })
      .from(currentPrices)
      .where(eq(currentPrices.stationId, id));
    return { station, collected: true, prices: prices.map((p) => ({ ...p, updatedAt: p.updatedAt.toISOString() })) };
  }
  const live = await fetchStationLive(id);
  if (!live) return null;
  const now = new Date();
  return {
    station: {
      id: live.id,
      postalCode: live.postalCode,
      city: live.city,
      address: live.address,
      departement: live.departement,
      lat: live.lat,
      lon: live.lon,
      roadType: live.roadType,
      automate24: live.automate24,
      services: live.services,
      openingHours: live.openingHours,
      name: null,
      brand: null,
      outOfStock: live.outOfStock as string[],
      lastSeenAt: now,
      createdAt: now,
    },
    collected: false,
    prices: live.prices.map((p) => ({ fuel: p.fuel as string, price: p.price, updatedAt: p.updatedAt.toISOString() })),
  };
}

export type HistoryPoint = { fuel: string; price: number; at: string };

/**
 * Changements de prix des `days` derniers jours, plus le dernier prix connu
 * avant la fenêtre, avec sa vraie date (la courbe en escalier démarre au bon niveau
 * et l'on peut afficher « prix inchangé depuis le … »).
 */
export async function getHistory(stationId: number, days: number): Promise<HistoryPoint[]> {
  const db = getDb();
  const since = new Date(Date.now() - days * 86_400_000);
  const inWindow = await db
    .select({ fuel: priceHistory.fuel, price: priceHistory.price, at: priceHistory.updatedAt })
    .from(priceHistory)
    .where(and(eq(priceHistory.stationId, stationId), gte(priceHistory.updatedAt, since)))
    .orderBy(asc(priceHistory.updatedAt));
  const before = await db.execute<{ fuel: string; price: string; at: Date }>(sql`
    select distinct on (fuel) fuel, price, updated_at as at
    from ${priceHistory}
    where station_id = ${stationId} and updated_at < ${since.toISOString()}
    order by fuel, updated_at desc
  `);
  return [
    ...before.map((r) => ({ fuel: r.fuel, price: Number(r.price), at: new Date(r.at).toISOString() })),
    ...inWindow.map((r) => ({ fuel: r.fuel, price: r.price, at: r.at.toISOString() })),
  ];
}

/** Situe un prix face aux stations voisines : médiane locale et part des stations plus chères. */
export async function getAreaComparison(center: LatLon, fuel: FuelCode, price: number, radiusKm = 10) {
  const { stations: list, median } = await getNearby({ ...center, radiusKm, fuel, limit: 500 });
  if (median === null || list.length < 3) return null;
  const pricier = list.filter((s) => s.price > price + 0.0005).length;
  return { median, count: list.length, cheaperThanPct: Math.round((pricier / (list.length - 1)) * 100) };
}
