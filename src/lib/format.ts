/** 2.219 → "2,219" */
export function formatPrice(price: number): string {
  return price.toFixed(3).replace(".", ",");
}

/** Sépare "2,21" et "9" pour afficher le millième plus petit, comme sur les totems. */
export function splitPrice(price: number): { main: string; milli: string } {
  const s = formatPrice(price);
  return { main: s.slice(0, -1), milli: s.slice(-1) };
}

/** Écart en centimes par litre, signé : "−3 cts", "+1 ct", "= moy." */
export function formatDeltaCents(delta: number): string {
  const cents = Math.round(delta * 100);
  if (cents === 0) return "≈ moyenne";
  const sign = cents > 0 ? "+" : "−";
  const abs = Math.abs(cents);
  return `${sign}${abs} ct${abs > 1 ? "s" : ""}`;
}

export function formatKm(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1).replace(".", ",")} km`;
}

export function formatEuros(value: number): string {
  return value.toFixed(2).replace(".", ",");
}

const SMALL_WORDS = new Set(["de", "du", "des", "la", "le", "les", "d", "l", "et", "à", "au", "aux", "en", "sur"]);

/** "55 BOULEVARD DE SUISSE" → "55 Boulevard de Suisse" (les adresses de l'API sont souvent en capitales). */
export function prettifyAddress(raw: string): string {
  if (raw !== raw.toUpperCase()) return raw;
  return raw
    .toLowerCase()
    .split(/(\s+|-|')/)
    .map((word, i) => {
      if (!/\p{L}/u.test(word)) return word;
      if (i > 0 && SMALL_WORDS.has(word)) return word;
      if (/^(rn|rd|n|d|zi|za|zac|ca)\d*$/.test(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join("");
}

const DAY_ABBR: Record<string, string> = {
  lundi: "Lun",
  mardi: "Mar",
  mercredi: "Mer",
  jeudi: "Jeu",
  vendredi: "Ven",
  samedi: "Sam",
  dimanche: "Dim",
};

/**
 * "Lundi07.00-20.00, Mardi07.00-20.00, …" → ["Lun–Ven 07h00–20h00", "Sam–Dim 08h30–20h00"].
 * Les jours consécutifs aux horaires identiques sont regroupés.
 */
export function formatOpeningHours(raw: string): string[] {
  const days = [...raw.matchAll(/(\p{L}+)\s*((?:\d{2}\.\d{2}-\d{2}\.\d{2}\s*)*)/gu)]
    .map((m) => ({
      day: DAY_ABBR[m[1].toLowerCase()],
      hours: (m[2].match(/\d{2}\.\d{2}-\d{2}\.\d{2}/g) ?? []).map((h) => h.replace(/\./g, "h").replace("-", "–")).join(", ") || "Fermé",
    }))
    .filter((d) => d.day);
  const groups: { from: string; to: string; hours: string }[] = [];
  for (const d of days) {
    const last = groups.at(-1);
    if (last && last.hours === d.hours) last.to = d.day;
    else groups.push({ from: d.day, to: d.day, hours: d.hours });
  }
  return groups.map((g) => `${g.from === g.to ? g.from : `${g.from}–${g.to}`} ${g.hours}`);
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
