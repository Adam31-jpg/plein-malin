import { z } from "zod";
import { fuelFromApi, type FuelCode } from "@/lib/fuels";
import { fetchWithRetry, type RetryOptions } from "@/lib/http";
import { parseParisLocal } from "@/lib/time";

const DATASET_URL =
  "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2";

/**
 * Un enregistrement du flux instantané v2, tel que renvoyé par l'endpoint d'export.
 * `prix`, `horaires`, `services` sont des chaînes JSON (héritage du XML d'origine).
 */
const rawRecordSchema = z.object({
  id: z.number(),
  cp: z.string().nullable(),
  pop: z.string().nullable(),
  adresse: z.string().nullable(),
  ville: z.string().nullable(),
  latitude: z.union([z.string(), z.number()]).nullable(),
  longitude: z.union([z.string(), z.number()]).nullable(),
  geom: z.object({ lat: z.number(), lon: z.number() }).nullable().optional(),
  prix: z.string().nullable(),
  horaires_automate_24_24: z.string().nullable().optional(),
  services_service: z.array(z.string()).nullable().optional(),
  horaires_jour: z.string().nullable().optional(),
  carburants_rupture_temporaire: z.string().nullable().optional(),
  code_departement: z.string().nullable(),
});

export type RawRecord = z.infer<typeof rawRecordSchema>;

export type ApiPrice = { fuel: FuelCode; price: number; updatedAt: Date };

export type ApiStation = {
  id: number;
  postalCode: string | null;
  city: string | null;
  address: string | null;
  departement: string | null;
  lat: number;
  lon: number;
  /** "R" = route, "A" = autoroute */
  roadType: "R" | "A" | null;
  automate24: boolean;
  services: string[];
  openingHours: string | null;
  prices: ApiPrice[];
  /** Carburants en rupture temporaire */
  outOfStock: FuelCode[];
};

const rawPriceSchema = z.object({
  "@nom": z.string().optional(),
  "@id": z.coerce.number().optional(),
  "@maj": z.string(),
  "@valeur": z.coerce.number(),
});

/** `prix` vaut un objet si la station n'a qu'un carburant, un tableau sinon. */
export function parsePrices(raw: string | null): ApiPrice[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  const prices: ApiPrice[] = [];
  for (const item of list) {
    const p = rawPriceSchema.safeParse(item);
    if (!p.success) continue;
    const fuel = fuelFromApi(p.data["@nom"], p.data["@id"]);
    const updatedAt = parseParisLocal(p.data["@maj"]);
    // Ignore les valeurs aberrantes (0, prix en millièmes d'anciens formats…).
    if (!fuel || !updatedAt || !(p.data["@valeur"] > 0.3 && p.data["@valeur"] < 5)) continue;
    prices.push({ fuel, price: Math.round(p.data["@valeur"] * 1000) / 1000, updatedAt });
  }
  return prices;
}

export function normalizeRecord(record: RawRecord): ApiStation | null {
  // geom est fiable ; latitude/longitude sont en degrés × 100 000 (format PTV).
  const lat = record.geom?.lat ?? (record.latitude != null ? Number(record.latitude) / 100_000 : NaN);
  const lon = record.geom?.lon ?? (record.longitude != null ? Number(record.longitude) / 100_000 : NaN);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat === 0 || lon === 0) return null;
  return {
    id: record.id,
    postalCode: record.cp,
    city: record.ville,
    address: record.adresse,
    departement: record.code_departement,
    lat,
    lon,
    roadType: record.pop === "A" ? "A" : record.pop === "R" ? "R" : null,
    automate24: record.horaires_automate_24_24 === "Oui",
    services: record.services_service ?? [],
    openingHours: record.horaires_jour ?? null,
    prices: parsePrices(record.prix),
    outOfStock: (record.carburants_rupture_temporaire ?? "")
      .split(";")
      .map((n) => fuelFromApi(n.trim()))
      .filter((f): f is FuelCode => f !== null),
  };
}

const EXPORT_FIELDS = [
  "id",
  "cp",
  "pop",
  "adresse",
  "ville",
  "latitude",
  "longitude",
  "geom",
  "prix",
  "horaires_automate_24_24",
  "services_service",
  "horaires_jour",
  "carburants_rupture_temporaire",
  "code_departement",
].join(",");

/** Requête d'export (sans pagination) avec un filtre ODSQL, puis validation/normalisation. */
async function exportStations(where: string | null, label: string, retry?: RetryOptions): Promise<ApiStation[]> {
  const url = new URL(`${DATASET_URL}/exports/json`);
  if (where) url.searchParams.set("where", where);
  url.searchParams.set("select", EXPORT_FIELDS);
  const res = await fetchWithRetry(url.toString(), { headers: { accept: "application/json" } }, retry);
  const body: unknown = await res.json();
  const records = z.array(z.unknown()).parse(body);
  const stations: ApiStation[] = [];
  let invalid = 0;
  for (const item of records) {
    const parsed = rawRecordSchema.safeParse(item);
    const station = parsed.success ? normalizeRecord(parsed.data) : null;
    if (station) stations.push(station);
    else invalid++;
  }
  if (invalid > 0) console.warn(`[api] ${invalid} enregistrement(s) ignoré(s) (${label})`);
  return stations;
}

/**
 * Récupère toutes les stations d'un département via l'endpoint d'export
 * (pas de pagination, ~200 stations pour le 31).
 */
export async function fetchDepartement(code: string, retry?: RetryOptions): Promise<ApiStation[]> {
  if (!/^[0-9AB]{2,3}$/.test(code)) throw new Error(`Code département invalide : ${code}`);
  return exportStations(`code_departement="${code}"`, `département ${code}`, retry);
}

/** Toute la France en une requête (~9 800 stations, ~9 Mo, ~1,5 s). */
export async function fetchAllStations(retry?: RetryOptions): Promise<ApiStation[]> {
  return exportStations(null, "France", { timeoutMs: 120_000, ...retry });
}

/** Stations dans un rayon autour d'un point, partout en France, en direct (~0,2 s). */
export async function fetchNearbyLive(center: { lat: number; lon: number }, radiusKm: number): Promise<ApiStation[]> {
  if (!Number.isFinite(center.lat) || !Number.isFinite(center.lon) || !(radiusKm > 0 && radiusKm <= 50)) throw new Error("Paramètres géographiques invalides");
  const point = `POINT(${center.lon.toFixed(5)} ${center.lat.toFixed(5)})`;
  return exportStations(`within_distance(geom, geom'${point}', ${radiusKm}km)`, "recherche par rayon", { retries: 1, timeoutMs: 8_000 });
}

/** Une station par son identifiant officiel, en direct. */
export async function fetchStationLive(id: number): Promise<ApiStation | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const [station] = await exportStations(`id=${id}`, `station ${id}`, { retries: 1, timeoutMs: 8_000 });
  return station ?? null;
}
