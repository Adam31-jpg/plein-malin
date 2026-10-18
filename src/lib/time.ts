const PARIS = "Europe/Paris";

/**
 * Décalage (en minutes) entre l'heure de Paris et UTC à un instant donné.
 * Mis en cache par heure UTC : l'import d'un fichier annuel convertit ~10 millions de dates.
 */
const offsetCache = new Map<number, number>();
function parisOffsetMinutes(at: Date): number {
  const hourKey = Math.floor(at.getTime() / 3_600_000);
  const cached = offsetCache.get(hourKey);
  if (cached !== undefined) return cached;
  const offset = computeParisOffset(new Date(hourKey * 3_600_000));
  if (offsetCache.size > 200_000) offsetCache.clear();
  offsetCache.set(hourKey, offset);
  return offset;
}

function computeParisOffset(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PARIS,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - at.getTime()) / 60000);
}

/**
 * Convertit une date "naïve" de l'API ("2026-10-18 00:01:00", heure légale française)
 * en Date UTC. Le flux expose aussi `gazole_maj` suffixé "+00:00", mais c'est en
 * réalité l'heure de Paris : on ignore donc tout suffixe de fuseau.
 */
export function parseParisLocal(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const naiveUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi, s ? +s : 0);
  // Deux passes pour tomber juste autour des changements d'heure.
  let guess = naiveUtc - parisOffsetMinutes(new Date(naiveUtc)) * 60000;
  guess = naiveUtc - parisOffsetMinutes(new Date(guess)) * 60000;
  return new Date(guess);
}

/** "à l'instant", "il y a 25 min", "il y a 2 h", "il y a 3 j". */
export function formatAgo(date: Date | string, now: Date = new Date()): string {
  const t = typeof date === "string" ? new Date(date) : date;
  const minutes = Math.max(0, Math.round((now.getTime() - t.getTime()) / 60000));
  if (minutes < 2) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 60) return `il y a ${days} j`;
  return `il y a ${Math.round(days / 30)} mois`;
}

export type Freshness = "fresh" | "recent" | "stale";

/** < 6 h : frais, < 48 h : récent, au-delà : à vérifier. */
export function freshness(date: Date | string, now: Date = new Date()): Freshness {
  const hours = (now.getTime() - new Date(date).getTime()) / 3_600_000;
  if (hours < 6) return "fresh";
  if (hours < 48) return "recent";
  return "stale";
}
