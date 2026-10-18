import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

const isWorkersRuntime = typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

function create(url: string): Db {
  const client = postgres(url, {
    max: isWorkersRuntime ? 1 : 5,
    // Compatible pgBouncer / Hyperdrive / Neon pooler.
    prepare: false,
    // numeric → number (sinon postgres.js renvoie une chaîne)
    types: { numeric: { to: 1700, from: [1700], serialize: String, parse: Number } },
  });
  return drizzle(client, { schema });
}

const globalForDb = globalThis as unknown as { __pleinMalinDb?: Db };

/** Sous Workers, les requêtes web passent par Hyperdrive (pool + latence réduite vers Neon). */
function workersUrl(): string | undefined {
  try {
    const env = getCloudflareContext().env as { HYPERDRIVE?: { connectionString: string } };
    return env.HYPERDRIVE?.connectionString;
  } catch {
    return undefined; // hors requête (ex. handler `scheduled`)
  }
}

/**
 * Sous Node on réutilise un pool unique. Sous Cloudflare Workers, une connexion
 * TCP ne peut pas être partagée entre requêtes : on en ouvre une par requête.
 * `url` force une connexion précise (la collecte planifiée utilise DATABASE_URL).
 */
export function getDb(url?: string): Db {
  if (isWorkersRuntime) {
    const target = url ?? workersUrl() ?? process.env.DATABASE_URL;
    if (!target) throw new Error("Ni HYPERDRIVE ni DATABASE_URL ne sont configurés");
    return create(target);
  }
  if (url) return create(url);
  const fromEnv = process.env.DATABASE_URL;
  if (!fromEnv) throw new Error("DATABASE_URL n'est pas défini");
  globalForDb.__pleinMalinDb ??= create(fromEnv);
  return globalForDb.__pleinMalinDb;
}

export { schema };
