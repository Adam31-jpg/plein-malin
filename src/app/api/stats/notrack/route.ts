import { NextResponse, type NextRequest } from "next/server";
import { NOTRACK_COOKIE } from "@/lib/analytics";

/** POST /api/stats/notrack : active / désactive le comptage de cet appareil (pour le propriétaire). */
export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/stats", req.url), 303);
  if (req.cookies.get(NOTRACK_COOKIE)?.value === "1") res.cookies.delete(NOTRACK_COOKIE);
  else res.cookies.set(NOTRACK_COOKIE, "1", { path: "/", maxAge: 400 * 86_400, sameSite: "lax" });
  return res;
}
