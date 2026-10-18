import { fetchWithRetry } from "@/lib/http";

/**
 * Données de marché quotidiennes, sources officielles gratuites et sans clé :
 * - Brent (Europe, $/baril) : EIA, via FRED (série DCOILBRENTEU), publiée avec quelques jours de décalage ;
 * - EUR/USD : taux de référence de la Banque centrale européenne.
 */
export type MarketPoint = { day: string; value: number };

/** Séries FRED (EIA) : Brent Europe, gazole et essence raffinés au port de New York. */
export const FRED_SERIES = { brent: "DCOILBRENTEU", diesel: "DDFUELNYH", gasoline: "DGASNYH" } as const;
const fredUrl = (id: string, from: string) => `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${from}`;
const ECB_EURUSD = (from: string) =>
  `https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?format=csvdata&startPeriod=${from}`;

/** Parse un CSV "date,valeur" (FRED : en-tête `observation_date,DCOILBRENTEU`, "." si pas de cotation). */
export function parseFredCsv(csv: string): MarketPoint[] {
  return csv
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.split(","))
    .filter(([day, v]) => /^\d{4}-\d{2}-\d{2}$/.test(day) && v !== "." && Number(v) > 0)
    .map(([day, v]) => ({ day, value: Number(v) }));
}

/** Parse le CSV SDMX de la BCE (colonnes TIME_PERIOD et OBS_VALUE). */
export function parseEcbCsv(csv: string): MarketPoint[] {
  const [header, ...lines] = csv.trim().split(/\r?\n/);
  const cols = header.split(",");
  const iDay = cols.indexOf("TIME_PERIOD");
  const iVal = cols.indexOf("OBS_VALUE");
  if (iDay < 0 || iVal < 0) throw new Error("Format BCE inattendu");
  return lines
    .map((l) => l.split(","))
    .filter((c) => /^\d{4}-\d{2}-\d{2}$/.test(c[iDay]) && Number(c[iVal]) > 0)
    .map((c) => ({ day: c[iDay], value: Number(c[iVal]) }));
}

export async function fetchFred(series: keyof typeof FRED_SERIES, from: string): Promise<MarketPoint[]> {
  const res = await fetchWithRetry(fredUrl(FRED_SERIES[series], from), {}, { retries: 3 });
  return parseFredCsv(await res.text());
}

export async function fetchEurUsd(from: string): Promise<MarketPoint[]> {
  const res = await fetchWithRetry(ECB_EURUSD(from), {}, { retries: 3 });
  return parseEcbCsv(await res.text());
}

const LITRES_PER_BARREL = 158.987;
const LITRES_PER_GALLON = 3.785411784;

/** Conversions en €/L : l'unité qui se compare directement au prix à la pompe. */
export const brentEurPerLitre = (brentUsd: number, eurUsd: number) => brentUsd / eurUsd / LITRES_PER_BARREL;
export const galEurPerLitre = (usdPerGallon: number, eurUsd: number) => usdPerGallon / eurUsd / LITRES_PER_GALLON;
