import { NextResponse, type NextRequest } from "next/server";
import { getHistory } from "@/lib/queries";

/** GET /api/stations/31120003/history?days=90 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/stations/[id]/history">) {
  const { id } = await ctx.params;
  const stationId = Number(id);
  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get("days") ?? 30), 1), 730);
  if (!Number.isInteger(stationId) || Number.isNaN(days)) {
    return NextResponse.json({ error: "Paramètres invalides" }, { status: 400 });
  }
  try {
    return NextResponse.json({ points: await getHistory(stationId, days) });
  } catch (err) {
    console.error("[api/history]", err);
    return NextResponse.json({ error: "Base de données indisponible" }, { status: 503 });
  }
}
