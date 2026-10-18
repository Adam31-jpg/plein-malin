import { getCloudflareContext } from "@opennextjs/cloudflare";

/** Variable d'environnement : binding Cloudflare en production, process.env en local. */
export function serverEnv(name: string): string | undefined {
  try {
    const value = (getCloudflareContext().env as Record<string, unknown>)[name];
    if (typeof value === "string" && value) return value;
  } catch {
    /* hors Cloudflare */
  }
  return process.env[name] || undefined;
}

/** Localisation approximative déduite par Cloudflare (absente en local). */
export function requestGeo(): { country: string | null; region: string | null; city: string | null } {
  try {
    const cf = getCloudflareContext().cf as { country?: string; region?: string; city?: string } | undefined;
    return { country: cf?.country ?? null, region: cf?.region ?? null, city: cf?.city ?? null };
  } catch {
    return { country: null, region: null, city: null };
  }
}
