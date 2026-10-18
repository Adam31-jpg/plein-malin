import { serverEnv } from "@/lib/server-env";

export const STATS_COOKIE = "pm_stats";

async function hmac(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Jeton de session dérivé du mot de passe : changer STATS_PASSWORD déconnecte tout le monde. */
export async function statsToken(): Promise<string | null> {
  const password = serverEnv("STATS_PASSWORD");
  return password ? hmac(password, "plein-malin/stats-session/v1") : null;
}

/** Comparaison à temps constant (on compare des HMAC de même longueur). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const key = crypto.getRandomValues(new Uint8Array(16)).join(",");
  const [ha, hb] = await Promise.all([hmac(key, a), hmac(key, b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}

export async function isStatsSession(cookieValue: string | undefined): Promise<boolean> {
  const token = await statsToken();
  return !!token && !!cookieValue && safeEqual(cookieValue, token);
}
