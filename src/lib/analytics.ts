import { and, desc, gte, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Db } from "@/lib/db";
import { visits } from "@/lib/db/schema";

/**
 * Mesure d'audience respectueuse de la vie privée (dans l'esprit de Plausible) :
 * - l'adresse IP n'est JAMAIS stockée : elle sert seulement, avec le navigateur et un sel
 *   secret, à calculer une empreinte SHA-256 qui change chaque jour (et chaque mois) ;
 * - une même personne (même IP + même navigateur) n'est comptée qu'une fois par jour ;
 * - les robots et les préchargements sont ignorés ; « Do Not Track » / GPC sont respectés côté navigateur ;
 * - localisation approximative (ville / région / pays) fournie par Cloudflare ;
 * - données conservées 13 mois maximum (recommandation CNIL).
 */

export const ANALYTICS_RETENTION_DAYS = 395;
export const NOTRACK_COOKIE = "pm_notrack";

const BOT_RE =
  /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora link preview|whatsapp|telegram|discord|slack|headless|phantom|puppeteer|playwright|selenium|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|curl|wget|python|httpclient|java\/|go-http|node-fetch|axios|okhttp|preview/i;

export function isBot(userAgent: string | null): boolean {
  return !userAgent || userAgent.length < 20 || BOT_RE.test(userAgent);
}

export type Device = "mobile" | "tablet" | "desktop";

export function deviceOf(userAgent: string): Device {
  if (/ipad|tablet|(android(?!.*mobile))/i.test(userAgent)) return "tablet";
  if (/mobi|iphone|ipod|android/i.test(userAgent)) return "mobile";
  return "desktop";
}

const parisDay = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });

/** Jour calendaire à Paris (AAAA-MM-JJ) : une « journée » de visites suit l'heure française. */
export function visitDay(at: Date): string {
  return parisDay.format(at);
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Empreintes du jour et du mois. Sans le sel secret, impossible de retrouver l'IP. */
export async function visitorIds(salt: string, ip: string, userAgent: string, day: string) {
  const [visitor, visitorMonth] = await Promise.all([
    sha256(`${salt}|d|${day}|${ip}|${userAgent}`),
    sha256(`${salt}|m|${day.slice(0, 7)}|${ip}|${userAgent}`),
  ]);
  return { visitor, visitorMonth };
}

/** Ne garde que le domaine du site d'origine (jamais l'URL complète). */
export function referrerHost(referrer: string | null | undefined, ownHost: string): string | null {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, "");
    return host && host !== ownHost.replace(/^www\./, "") ? host : null;
  } catch {
    return null;
  }
}

/** Chemin normalisé : /station/123 → /station/:id (on compte des pages, pas des requêtes). */
export function normalizePath(path: string): string {
  const clean = path.split(/[?#]/)[0].slice(0, 200) || "/";
  return clean.replace(/^\/station\/\d+/, "/station/:id");
}

export type Hit = {
  ip: string;
  userAgent: string;
  path: string;
  referrer: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  at?: Date;
};

/** Enregistre une page vue : nouvelle ligne pour un nouveau visiteur du jour, sinon +1 page vue. */
export async function recordHit(db: Db, salt: string, hit: Hit) {
  const at = hit.at ?? new Date();
  const day = visitDay(at);
  const ids = await visitorIds(salt, hit.ip, hit.userAgent, day);
  await db
    .insert(visits)
    .values({
      day,
      ...ids,
      firstSeen: at,
      lastSeen: at,
      country: hit.country,
      region: hit.region,
      city: hit.city,
      device: deviceOf(hit.userAgent),
      entryPath: normalizePath(hit.path),
      referrer: hit.referrer,
    })
    .onConflictDoUpdate({
      target: [visits.day, visits.visitor],
      set: { pageviews: sql`${visits.pageviews} + 1`, lastSeen: at },
    });
}

export async function pruneVisits(db: Db) {
  const res = await db.execute(sql`delete from ${visits} where day < current_date - ${ANALYTICS_RETENTION_DAYS}::int`);
  return res.count;
}

export type Ranked = { label: string; visitors: number };

export type AudienceStats = {
  live: number;
  today: { visitors: number; pageviews: number };
  yesterday: { visitors: number; pageviews: number };
  last7: { visitors: number; pageviews: number };
  last30: { visitors: number; pageviews: number };
  daily: { day: string; visitors: number; pageviews: number }[];
  cities: Ranked[];
  regions: Ranked[];
  countries: Ranked[];
  devices: Ranked[];
  pages: Ranked[];
  referrers: Ranked[];
};

/**
 * Visiteurs uniques sur une période : empreintes mensuelles distinctes. Une personne venue
 * à cheval sur deux mois compte deux fois (rare) ; jamais plus d'une fois par mois sinon.
 */
const uniques = sql<number>`count(distinct (${visits.visitorMonth}, to_char(${visits.day}, 'YYYY-MM')))::int`;

export async function getAudience(db: Db, now = new Date()): Promise<AudienceStats> {
  const today = visitDay(now);
  const ago = (n: number) => visitDay(new Date(now.getTime() - n * 86_400_000));
  const period = async (from: string, to: string) => {
    const [r] = await db
      .select({ visitors: uniques, pageviews: sql<number>`coalesce(sum(${visits.pageviews}), 0)::int` })
      .from(visits)
      .where(and(gte(visits.day, from), sql`${visits.day} <= ${to}`));
    return r;
  };
  const top = async (column: AnyPgColumn, label?: (v: string) => string) => {
    const rows = await db
      .select({ label: column, visitors: uniques })
      .from(visits)
      .where(and(gte(visits.day, ago(29)), sql`${column} is not null`))
      .groupBy(column)
      .orderBy(desc(uniques))
      .limit(10);
    return rows.map((r) => ({ label: label ? label(String(r.label)) : String(r.label), visitors: r.visitors }));
  };
  const cityLabel = sql<string>`${visits.city} || coalesce(' (' || ${visits.region} || ')', '')`;

  const [live, t, y, w, m, daily, cities, regions, countries, devices, pages, referrers] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(visits)
      .where(sql`${visits.lastSeen} > now() - interval '5 minutes'`)
      .then((r) => r[0].n),
    period(today, today),
    period(ago(1), ago(1)),
    period(ago(6), today),
    period(ago(29), today),
    db
      .select({ day: visits.day, visitors: sql<number>`count(*)::int`, pageviews: sql<number>`sum(${visits.pageviews})::int` })
      .from(visits)
      .where(gte(visits.day, ago(29)))
      .groupBy(visits.day)
      .orderBy(visits.day),
    db
      .select({ label: cityLabel, visitors: uniques })
      .from(visits)
      .where(and(gte(visits.day, ago(29)), sql`${visits.city} is not null`))
      .groupBy(cityLabel)
      .orderBy(desc(uniques))
      .limit(10),
    top(visits.region),
    top(visits.country),
    top(visits.device, (d) => ({ mobile: "Mobile", tablet: "Tablette", desktop: "Ordinateur" })[d] ?? d),
    top(visits.entryPath),
    top(visits.referrer),
  ]);
  // 30 jours continus (0 les jours sans visite) pour une échelle de graphique stable.
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const days = Array.from({ length: 30 }, (_, i) => ago(29 - i)).map((day) => byDay.get(day) ?? { day, visitors: 0, pageviews: 0 });
  return { live, today: t, yesterday: y, last7: w, last30: m, daily: days, cities, regions, countries, devices, pages, referrers };
}
