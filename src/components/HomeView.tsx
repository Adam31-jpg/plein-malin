"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Ago } from "@/components/Ago";
import ForecastCard from "@/components/ForecastCard";
import { LocateIcon, NavigateIcon, PinIcon } from "@/components/icons";
import { PriceTag, toneFor } from "@/components/PriceTag";
import { brandFamily, stationTitle } from "@/lib/brands";
import type { ForecastResponse } from "@/lib/forecast-query";
import { formatDeltaCents, formatKm, formatPrice, prettifyAddress } from "@/lib/format";
import { FUELS, fuelLabel, type FuelCode } from "@/lib/fuels";
import { DEFAULT_POSITION, type LatLon } from "@/lib/geo";
import { FUEL_COOKIE, RADII, RADIUS_COOKIE } from "@/lib/prefs";
import type { NearbyResult, NearbyStation } from "@/lib/queries";

const StationMap = dynamic(() => import("@/components/StationMap"), {
  ssr: false,
  loading: () => <div className="map map--loading" />,
});

const SHOWN = 5;
const STALE_INGEST_MS = 2 * 3_600_000;

type Position = LatLon & { source: "default" | "gps" };
type Props = {
  initialNearby: NearbyResult | null;
  initialForecast: ForecastResponse | null;
  initialFuel: FuelCode;
  initialArea: string;
  initialRadius: number;
};

/** Préférences en cookie : le serveur rend directement le bon carburant (pas de saut à l'hydratation). */
function storePref(name: string, value: string | number) {
  document.cookie = `${name}=${encodeURIComponent(String(value))}; path=/; max-age=31536000; samesite=lax`;
}

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Erreur ${res.status}`);
  }
  return (await res.json()) as T;
}

export default function HomeView({ initialNearby, initialForecast, initialFuel, initialRadius, initialArea }: Props) {
  const [position, setPosition] = useState<Position>({ ...DEFAULT_POSITION, source: "default" });
  const [geoState, setGeoState] = useState<"pending" | "ok" | "denied" | "unavailable">("pending");
  const [fuel, setFuel] = useState<FuelCode>(initialFuel);
  const [radius, setRadius] = useState(initialRadius);
  const [nearby, setNearby] = useState(initialNearby);
  // Département de la station la plus proche : la prévision affichée est celle de ce département.
  const area = nearby?.area ?? initialArea;
  const [forecast, setForecast] = useState(initialForecast);
  const [loading, setLoading] = useState(initialNearby === null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mountedAt] = useState(() => Date.now());
  const rowRefs = useRef(new Map<number, HTMLLIElement>());
  const firstNearby = useRef(true);
  const firstForecast = useRef(true);

  const requestPosition = useCallback(() => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoState("ok");
        setPosition({ lat: pos.coords.latitude, lon: pos.coords.longitude, source: "gps" });
      },
      (err) => setGeoState(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }, []);

  useEffect(() => {
    if ("geolocation" in navigator) requestPosition();
  }, [requestPosition]);

  // Stations proches : position, carburant ou rayon modifiés.
  useEffect(() => {
    if (firstNearby.current && initialNearby && position.source === "default" && fuel === initialFuel && radius === initialRadius) {
      firstNearby.current = false;
      return;
    }
    firstNearby.current = false;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ lat: String(position.lat), lon: String(position.lon), radius: String(radius), fuel });
    getJson<NearbyResult>(`/api/stations?${qs}`, controller.signal)
      .then((d) => {
        setNearby(d);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Erreur réseau");
        setLoading(false);
      });
    return () => controller.abort();
  }, [position, fuel, radius, initialNearby, initialFuel, initialRadius]);

  // Prévision : ne dépend que du carburant.
  useEffect(() => {
    if (firstForecast.current && fuel === initialFuel && area === initialArea) {
      firstForecast.current = false;
      return;
    }
    firstForecast.current = false;
    const controller = new AbortController();
    getJson<{ forecast: ForecastResponse | null }>(`/api/forecast?fuel=${fuel}&area=${encodeURIComponent(area)}`, controller.signal)
      .then((d) => setForecast(d.forecast))
      .catch(() => !controller.signal.aborted && setForecast(null));
    return () => controller.abort();
  }, [fuel, area, initialFuel, initialArea]);

  const relocate = () => {
    if (!("geolocation" in navigator)) return setGeoState("unavailable");
    setGeoState("pending");
    requestPosition();
  };
  const chooseFuel = (f: FuelCode) => {
    setFuel(f);
    setExpanded(false);
    setSelectedId(null);
    storePref(FUEL_COOKIE, f);
  };
  const chooseRadius = (r: number) => {
    setRadius(r);
    setExpanded(false);
    storePref(RADIUS_COOKIE, r);
  };
  const selectFromMap = useCallback(
    (id: number) => {
      const index = nearby?.stations.findIndex((s) => s.id === id) ?? -1;
      if (index >= SHOWN) setExpanded(true);
      setSelectedId(id);
      requestAnimationFrame(() => rowRefs.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "center" }));
    },
    [nearby],
  );

  const all = nearby?.stations ?? [];
  const shown = expanded ? all : all.slice(0, SHOWN);
  const median = nearby?.median ?? null;
  const fallbackAge = nearby?.source === "db" && nearby.pricesAt ? mountedAt - Date.parse(nearby.pricesAt) : null;

  return (
    <main className="home" aria-busy={loading}>
      <header className="home__head">
        <button type="button" className="where" onClick={relocate}>
          <PinIcon size={18} />
          <span className="where__label">
            {position.source === "gps" ? "Autour de moi" : DEFAULT_POSITION.label}
            <small>
              {geoState === "pending"
                ? "Localisation…"
                : geoState === "denied"
                  ? "Localisation refusée · position par défaut"
                  : geoState === "unavailable"
                    ? "Position introuvable · position par défaut"
                    : "Position GPS"}
            </small>
          </span>
          <LocateIcon size={22} />
        </button>
        <div className="chips" role="group" aria-label="Carburant">
          {FUELS.map((f) => (
            <button key={f.code} type="button" className="chip" aria-pressed={f.code === fuel} onClick={() => chooseFuel(f.code)}>
              {f.label}
            </button>
          ))}
        </div>
      </header>

      {nearby?.source === "db" && (
        <p className="alert" role="status">
          Le flux officiel ne répond pas : prix de notre dernier relevé
          {nearby.pricesAt && (
            <>
              {" "}
              (<Ago date={nearby.pricesAt} />)
            </>
          )}
          , disponible pour la Haute-Garonne et le Tarn seulement.
          {fallbackAge !== null && fallbackAge > STALE_INGEST_MS && " Ils peuvent avoir changé depuis."}
        </p>
      )}

      <ForecastCard forecast={forecast} fuel={fuel} area={area} />

      <section className="nearby-block" aria-labelledby="list-title">
        <div className="block-head">
          <h2 className="section-title" id="list-title">
            Les moins chères près de moi
          </h2>
          <div className="segmented" role="group" aria-label="Rayon">
            {RADII.map((r) => (
              <button key={r} type="button" aria-pressed={r === radius} onClick={() => chooseRadius(r)}>
                {r} km
              </button>
            ))}
          </div>
        </div>

        <StationMap center={position} stations={shown} selectedId={selectedId} onSelect={selectFromMap} />

        {error ? (
          <div className="state" role="alert">
            <strong>Impossible de charger les prix.</strong> {error}. Réessayez dans un instant.
          </div>
        ) : loading && all.length === 0 ? (
          <div className="picks" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton" style={{ height: 84 }} />
            ))}
          </div>
        ) : all.length === 0 ? (
          <div className="state">
            <strong>Aucune station ne vend du {fuelLabel(fuel)}</strong> dans un rayon de {radius} km. Élargissez le rayon.
          </div>
        ) : (
          <>
            <ol className="picks" style={{ opacity: loading ? 0.6 : 1 }}>
              {shown.map((s, i) => (
                <StationRow
                  key={s.id}
                  station={s}
                  rank={i + 1}
                  median={median}
                  fuel={fuel}
                  selected={s.id === selectedId}
                  rowRef={(el) => {
                    if (el) rowRefs.current.set(s.id, el);
                    else rowRefs.current.delete(s.id);
                  }}
                />
              ))}
            </ol>
            {all.length > SHOWN && (
              <button type="button" className="btn btn--ghost" onClick={() => setExpanded((e) => !e)}>
                {expanded ? "Voir moins" : `Voir les ${all.length} stations à ${radius} km`}
              </button>
            )}
          </>
        )}

        {nearby && nearby.outOfStock.length > 0 && (
          <div className="note note--warn">
            <strong>En rupture de {fuelLabel(fuel)} :</strong>{" "}
            {nearby.outOfStock.map((s, i) => (
              <span key={s.id}>
                {i > 0 && " · "}
                {stationTitle(s)} {s.address ? `(${prettifyAddress(s.address)}, ${formatKm(s.distanceKm)})` : `(${formatKm(s.distanceKm)})`}
              </span>
            ))}
          </div>
        )}
      </section>

      <footer className="home__foot">
        <p>
          {all.length} stations à {radius} km{median !== null && <> · médiane {formatPrice(median)} €</>}
          {nearby?.source === "live" && <> · prix officiels en direct</>}
          {nearby?.source === "db" && nearby.pricesAt && (
            <>
              {" "}
              · prix relevés <Ago date={nearby.pricesAt} />
            </>
          )}
        </p>
        {nearby && nearby.staleHidden > 0 && (
          <p>
            {nearby.staleHidden} station{nearby.staleHidden > 1 ? "s" : ""} masquée{nearby.staleHidden > 1 ? "s" : ""} : prix non confirmé depuis plus de 7
            jours.
          </p>
        )}
        <p>Prix officiels déclarés par les stations (data.economie.gouv.fr). Noms des stations : OpenStreetMap.</p>
      </footer>
    </main>
  );
}

function StationRow({
  station: s,
  rank,
  median,
  fuel,
  selected,
  rowRef,
}: {
  station: NearbyStation;
  rank: number;
  median: number | null;
  fuel: FuelCode;
  selected: boolean;
  rowRef: (el: HTMLLIElement | null) => void;
}) {
  const tone = toneFor(s.price, median);
  const family = brandFamily(s.brand);
  return (
    <li ref={rowRef} className={`pick${rank === 1 ? " pick--best" : ""}${selected ? " pick--selected" : ""}`}>
      <Link href={`/station/${s.id}?fuel=${fuel}`} className="pick__main">
        <span className="pick__rank" aria-label={`Rang ${rank}`}>
          {rank}
        </span>
        <span className="pick__price">
          <PriceTag price={s.price} tone={tone} />
          {median !== null && <span className={`pick__delta tone-${tone}`}>{formatDeltaCents(s.price - median)}</span>}
        </span>
        <span className="pick__body">
          <span className="pick__title">{stationTitle(s)}</span>
          <span className="pick__meta">
            {s.address ? prettifyAddress(s.address) : ""}
            {s.city ? `, ${prettifyAddress(s.city)}` : ""}
          </span>
          <span className="pick__meta">
            {formatKm(s.distanceKm)} · <Ago date={s.updatedAt} dot />
          </span>
          {(s.unusual || (family && s.sameBrandSamePrice >= 5) || s.automate24 || s.roadType === "A") && (
            <span className="pick__badges">
              {s.unusual && <span className="badge badge--warn">Prix inhabituel, à vérifier</span>}
              {family && s.sameBrandSamePrice >= 5 && (
                <span className="badge">
                  Même prix dans {s.sameBrandSamePrice} stations {family}
                </span>
              )}
              {s.roadType === "A" && <span className="badge">Autoroute</span>}
              {s.automate24 && <span className="badge">24/24</span>}
            </span>
          )}
        </span>
      </Link>
      <a
        className="pick__go"
        href={`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Itinéraire vers ${stationTitle(s)}`}
      >
        <NavigateIcon size={20} />
      </a>
    </li>
  );
}
