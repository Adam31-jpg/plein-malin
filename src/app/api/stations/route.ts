import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { DEFAULT_FUEL, isFuelCode } from "@/lib/fuels";
import { getNearby } from "@/lib/queries";

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().min(1).max(50).default(10),
  fuel: z.string().refine(isFuelCode).default(DEFAULT_FUEL),
});

/** GET /api/stations?lat=43.52&lon=1.40&radius=10&fuel=gazole */
export async function GET(req: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Paramètres invalides", issues: parsed.error.issues }, { status: 400 });
  }
  const { lat, lon, radius, fuel } = parsed.data;
  try {
    const result = await getNearby({ lat, lon, radiusKm: radius, fuel });
    return NextResponse.json(result, { headers: { "cache-control": "public, max-age=60, stale-while-revalidate=300" } });
  } catch (err) {
    console.error("[api/stations]", err);
    return NextResponse.json({ error: "Base de données indisponible" }, { status: 503 });
  }
}
