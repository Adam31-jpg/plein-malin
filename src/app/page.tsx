import { cookies } from "next/headers";
import { Suspense } from "react";
import HomeView from "@/components/HomeView";
import { HomeSkeleton } from "@/components/Skeletons";
import { getForecast, type ForecastResponse } from "@/lib/forecast-query";
import { DEFAULT_POSITION } from "@/lib/geo";

/** Département de la position par défaut (Portet-sur-Garonne). */
const DEFAULT_AREA = "31";
import { DEFAULT_FUEL, DEFAULT_RADIUS, FUEL_COOKIE, parseFuel, parseRadius, RADIUS_COOKIE } from "@/lib/prefs";
import { getNearby, type NearbyResult } from "@/lib/queries";

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <HomeContent searchParams={searchParams} />
    </Suspense>
  );
}

async function HomeContent({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  const [{ fuel: fuelParam }, jar] = await Promise.all([searchParams, cookies()]);
  const fuel = parseFuel(fuelParam) ?? parseFuel(jar.get(FUEL_COOKIE)?.value) ?? DEFAULT_FUEL;
  const radius = parseRadius(jar.get(RADIUS_COOKIE)?.value) ?? DEFAULT_RADIUS;

  // Premier rendu sur la position par défaut : tout s'affiche sans attendre le GPS,
  // puis la liste se met à jour dès que la position est connue.
  let nearby: NearbyResult | null = null;
  let forecast: ForecastResponse | null = null;
  try {
    nearby = await getNearby({ ...DEFAULT_POSITION, radiusKm: radius, fuel });
    forecast = await getForecast(fuel, nearby.area ?? DEFAULT_AREA);
  } catch (err) {
    console.error("[home] base indisponible", err);
  }

  return (
    <HomeView initialNearby={nearby} initialForecast={forecast} initialFuel={fuel} initialRadius={radius} initialArea={nearby?.area ?? DEFAULT_AREA} />
  );
}
