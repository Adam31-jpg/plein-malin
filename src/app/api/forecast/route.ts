import { NextResponse, type NextRequest } from "next/server";
import { DEPARTEMENTS } from "@/lib/departements";
import { getForecast } from "@/lib/forecast-query";
import { DEFAULT_FUEL } from "@/lib/fuels";
import { parseFuel } from "@/lib/prefs";

/** GET /api/forecast?fuel=gazole&area=31 → tendance 7 jours du département, avec sa fiabilité mesurée. */
export async function GET(req: NextRequest) {
  const fuel = parseFuel(req.nextUrl.searchParams.get("fuel") ?? DEFAULT_FUEL);
  const area = req.nextUrl.searchParams.get("area") ?? "31";
  if (!fuel) return NextResponse.json({ error: "Carburant inconnu" }, { status: 400 });
  if (!(area in DEPARTEMENTS)) return NextResponse.json({ error: "Département inconnu" }, { status: 400 });
  try {
    const forecast = await getForecast(fuel, area);
    return NextResponse.json({ forecast }, { headers: { "cache-control": "public, max-age=600" } });
  } catch (err) {
    console.error("[api/forecast]", err);
    return NextResponse.json({ error: "Base de données indisponible" }, { status: 503 });
  }
}
