import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Ago } from "@/components/Ago";
import { ChevronLeft, ClockIcon, NavigateIcon, TrendIcon } from "@/components/icons";
import PriceChart from "@/components/PriceChart";
import { PriceTag, toneFor } from "@/components/PriceTag";
import { stationTitle } from "@/lib/brands";
import { formatOpeningHours, formatPrice, prettifyAddress } from "@/lib/format";
import { DEFAULT_FUEL, FUELS, fuelLabel, isFuelCode, type FuelCode } from "@/lib/fuels";
import { getAreaComparison, getHistory, getStation } from "@/lib/queries";

async function load(idParam: string) {
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) return null;
  return getStation(id);
}

export async function generateMetadata({ params }: PageProps<"/station/[id]">): Promise<Metadata> {
  const data = await load((await params).id);
  if (!data) return { title: "Station introuvable — Plein Malin" };
  const { station } = data;
  return { title: `${stationTitle(station)}, ${prettifyAddress(station.city ?? "")} — Plein Malin` };
}

// Rendu sans <Suspense> : la page n'est envoyée qu'une fois la station trouvée,
// ce qui permet de répondre un vrai 404 pour un id inconnu.
export default async function StationPage({ params, searchParams }: PageProps<"/station/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const data = await load(id);
  if (!data) notFound();
  const { station, prices, collected } = data;

  const ordered = FUELS.map((f) => prices.find((p) => p.fuel === f.code)).filter((p): p is NonNullable<typeof p> => !!p);
  const wanted = isFuelCode(sp.fuel) ? sp.fuel : DEFAULT_FUEL;
  const fuel: FuelCode = ordered.some((p) => p.fuel === wanted) ? wanted : ((ordered[0]?.fuel as FuelCode | undefined) ?? wanted);
  const current = ordered.find((p) => p.fuel === fuel);

  const [history, comparison] = await Promise.all([
    collected ? getHistory(station.id, 90) : Promise.resolve([]),
    current ? getAreaComparison(station, fuel, current.price) : Promise.resolve(null),
  ]);
  const comparisonsByFuel = new Map<string, number | null>([[fuel, comparison?.median ?? null]]);

  const directions = `https://www.google.com/maps/dir/?api=1&destination=${station.lat},${station.lon}`;
  const waze = `https://waze.com/ul?ll=${station.lat},${station.lon}&navigate=yes`;

  return (
    <main className="page">
      <nav className="page__nav">
        <Link href={`/?fuel=${fuel}`} className="icon-btn" aria-label="Retour à la liste">
          <ChevronLeft />
        </Link>
      </nav>

      <h1 className="station-title">{stationTitle(station)}</h1>
      <p className="station-sub">
        {station.address ? `${prettifyAddress(station.address)}, ` : ""}
        {station.postalCode} {station.city ? prettifyAddress(station.city) : ""}
        {station.roadType === "A" ? " · Autoroute" : ""}
        {station.automate24 ? " · Automate 24/24" : ""}
      </p>

      {station.outOfStock.length > 0 && (
        <p className="note note--warn" style={{ marginTop: 12 }}>
          <strong>En rupture :</strong> {station.outOfStock.map((f) => (isFuelCode(f) ? fuelLabel(f) : f)).join(", ")}
        </p>
      )}

      {ordered.length === 0 ? (
        <div className="state">Aucun prix publié actuellement par cette station.</div>
      ) : (
        <div className="price-grid" role="list" aria-label="Prix actuels">
          {ordered.map((p) => (
            <Link
              key={p.fuel}
              role="listitem"
              href={`?fuel=${p.fuel}`}
              replace
              scroll={false}
              className="price-card"
              aria-current={p.fuel === fuel ? "true" : undefined}
            >
              <div className="price-card__fuel">{fuelLabel(p.fuel as FuelCode)}</div>
              <PriceTag price={p.price} tone={toneFor(p.price, comparisonsByFuel.get(p.fuel) ?? null)} />
              <div className="price-card__when">
                <Ago date={p.updatedAt} />
              </div>
            </Link>
          ))}
        </div>
      )}

      {!collected && (
        <p className="note" style={{ marginTop: 14 }}>
          Prix officiels en direct. L&apos;historique et la courbe ne sont suivis que pour la Haute-Garonne et le Tarn.
        </p>
      )}

      {current && collected && (
        <PriceChart points={history.filter((h) => h.fuel === fuel)} areaAverage={comparison?.median ?? null} fuelLabel={fuelLabel(fuel)} />
      )}

      <div className="facts">
        {comparison && current && (
          <div className="fact">
            <TrendIcon style={{ color: comparison.cheaperThanPct >= 50 ? "var(--cheap)" : "var(--pricey)" }} />
            <span>
              Moins chère que <strong>{comparison.cheaperThanPct} %</strong> des {comparison.count} stations à 10 km (médiane{" "}
              {formatPrice(comparison.median)} €).
            </span>
          </div>
        )}
        {station.openingHours && (
          <div className="fact">
            <ClockIcon style={{ color: "var(--me)" }} />
            <span>
              {formatOpeningHours(station.openingHours).map((line) => (
                <span key={line} style={{ display: "block" }}>
                  {line}
                </span>
              ))}
            </span>
          </div>
        )}
      </div>

      <div className="actions">
        <a className="btn btn--primary" href={directions} target="_blank" rel="noopener noreferrer">
          <NavigateIcon /> Y aller
        </a>
        <a className="btn" href={waze} target="_blank" rel="noopener noreferrer">
          Waze
        </a>
      </div>
    </main>
  );
}
