import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/server-env";
import { safeEqual, STATS_COOKIE, statsToken } from "@/lib/stats-auth";

/** POST /api/stats/login (formulaire) → cookie de session de 30 jours. */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const password = String(form?.get("password") ?? "");
  const expected = serverEnv("STATS_PASSWORD");
  const token = await statsToken();
  if (!expected || !token || !(await safeEqual(password, expected))) {
    await new Promise((r) => setTimeout(r, 800)); // freine les essais en rafale
    return NextResponse.redirect(new URL("/stats?erreur=1", req.url), 303);
  }
  const res = NextResponse.redirect(new URL("/stats", req.url), 303);
  res.cookies.set(STATS_COOKIE, token, {
    httpOnly: true,
    secure: req.nextUrl.protocol === "https:",
    sameSite: "strict",
    path: "/",
    maxAge: 30 * 86_400,
  });
  return res;
}
