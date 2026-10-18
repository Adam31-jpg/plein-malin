import { prettifyAddress } from "@/lib/format";

/** Regroupe les variantes d'enseigne d'OpenStreetMap (« Total Access », « TotalEnergies »…). */
const FAMILIES: [RegExp, string][] = [
  [/total/i, "TotalEnergies"],
  [/carrefour/i, "Carrefour"],
  [/leclerc/i, "E.Leclerc"],
  [/intermarch/i, "Intermarché"],
  [/(syst[eè]me|super|hyper|march[ée]) u\b|^u$/i, "Système U"],
  [/auchan/i, "Auchan"],
  [/esso/i, "Esso"],
  [/avia/i, "Avia"],
  [/bp\b/i, "BP"],
  [/shell/i, "Shell"],
  [/casino/i, "Casino"],
];

export function brandFamily(brand: string | null | undefined): string | null {
  if (!brand) return null;
  for (const [re, family] of FAMILIES) if (re.test(brand)) return family;
  return brand;
}

/** Nom affiché : nom OSM, sinon enseigne, sinon adresse. */
export const stationTitle = (s: { name: string | null; brand: string | null; address: string | null }) =>
  s.name ?? s.brand ?? (s.address ? prettifyAddress(s.address) : "Station-service");
