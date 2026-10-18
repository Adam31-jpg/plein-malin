import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { isBot, NOTRACK_COOKIE, recordHit, referrerHost } from "@/lib/analytics";
import { getDb } from "@/lib/db";
import { requestGeo, serverEnv } from "@/lib/server-env";

const bodySchema = z.object({
  path: z.string().max(500),
  referrer: z.string().max(1000).nullable().optional(),
});

let warned = false;

/** POST /api/hit — page vue envoyée par le navigateur (voir components/Analytics.tsx). */
export async function POST(req: NextRequest) {
  const done = new NextResponse(null, { status: 204 });
  const ua = req.headers.get("user-agent");
  // Robots, préchargements et appareils exclus (« ne pas me compter ») : rien n'est enregistré.
  if (isBot(ua) || req.cookies.get(NOTRACK_COOKIE)?.value === "1" || req.headers.get("sec-purpose")?.includes("prefetch")) return done;

  const salt = serverEnv("ANALYTICS_SALT");
  if (!salt) {
    if (!warned) console.warn("[analytics] ANALYTICS_SALT absent : aucune visite enregistrée");
    warned = true;
    return done;
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || parsed.data.path.startsWith("/stats")) return done;

  // L'IP n'est utilisée que pour calculer l'empreinte, puis oubliée.
  const ip =
    req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? req.headers.get("x-real-ip") ?? "local";
  try {
    await recordHit(getDb(), salt, {
      ip,
      userAgent: ua!,
      path: parsed.data.path,
      referrer: referrerHost(parsed.data.referrer, req.nextUrl.hostname),
      ...requestGeo(),
    });
  } catch (err) {
    console.error("[analytics]", err);
  }
  return done;
}
