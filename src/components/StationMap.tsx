"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MlMap, Marker as MlMarker } from "maplibre-gl";
import { LocateIcon } from "@/components/icons";
import { formatPrice } from "@/lib/format";
import type { LatLon } from "@/lib/geo";
import type { NearbyStation } from "@/lib/queries";

type Props = {
  center: LatLon;
  stations: NearbyStation[];
  selectedId: number | null;
  onSelect: (id: number) => void;
};

/** Tuiles vectorielles OpenFreeMap : données OpenStreetMap, gratuites et sans clé. */
const STYLE_DARK = "https://tiles.openfreemap.org/styles/dark";
const STYLE_LIGHT = "https://tiles.openfreemap.org/styles/positron";

type Lib = typeof import("maplibre-gl");

export default function StationMap({ center, stations, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MlMap | null>(null);
  const [failed, setFailed] = useState(false);
  const libRef = useRef<Lib | null>(null);
  const markersRef = useRef(new Map<number, { marker: MlMarker; el: HTMLButtonElement }>());
  const meRef = useRef<MlMarker | null>(null);
  const onSelectRef = useRef(onSelect);
  const fitKeyRef = useRef("");

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // Création de la carte, une seule fois. Échec WebGL → message plutôt qu'un cadre vide.
  useEffect(() => {
    let cancelled = false;
    let instance: MlMap | null = null;
    const markers = markersRef.current;
    import("maplibre-gl")
      .then((lib) => {
        if (cancelled || !containerRef.current) return;
        libRef.current = lib;
        lib.setWorkerUrl(`/vendor/maplibre-gl-worker-${lib.getVersion()}.mjs`);
        const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        instance = new lib.Map({
          container: containerRef.current,
          style: dark ? STYLE_DARK : STYLE_LIGHT,
          center: [center.lon, center.lat],
          zoom: 12,
          attributionControl: { compact: true },
          dragRotate: false,
          pitchWithRotate: false,
          cooperativeGestures: false,
        });
        instance.touchZoomRotate.disableRotation();
        instance.on("error", (e) => console.warn("[carte]", e.error?.message));
        instance.once("load", () => {
          if (cancelled) return;
          // Attribution repliée (icône ⓘ) : dépliée, elle masque le bas d'une petite carte.
          containerRef.current?.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
          setMap(instance);
        });
      })
      .catch((err) => {
        console.error("[carte] chargement impossible", err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      markers.clear();
      meRef.current = null;
      instance?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- création unique, le centre suit via les effets ci-dessous
  }, []);

  // Ma position.
  useEffect(() => {
    const lib = libRef.current;
    if (!map || !lib) return;
    if (!meRef.current) {
      const el = document.createElement("div");
      el.className = "me-dot";
      el.setAttribute("aria-label", "Ma position");
      meRef.current = new lib.Marker({ element: el }).setLngLat([center.lon, center.lat]).addTo(map);
    } else {
      meRef.current.setLngLat([center.lon, center.lat]);
    }
  }, [map, center.lat, center.lon]);

  // Étiquettes de prix (mise à jour différentielle).
  useEffect(() => {
    const lib = libRef.current;
    if (!map || !lib) return;
    const markers = markersRef.current;
    const wanted = new Set(stations.map((s) => s.id));
    for (const [id, m] of markers) {
      if (!wanted.has(id)) {
        m.marker.remove();
        markers.delete(id);
      }
    }
    stations.forEach((s, i) => {
      let entry = markers.get(s.id);
      if (!entry) {
        const el = document.createElement("button");
        el.type = "button";
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          onSelectRef.current(s.id);
        });
        entry = { el, marker: new lib.Marker({ element: el, anchor: "bottom" }).setLngLat([s.lon, s.lat]).addTo(map) };
        markers.set(s.id, entry);
      }
      entry.el.textContent = formatPrice(s.price);
      entry.el.setAttribute("aria-label", `${s.name ?? "Station"}, ${formatPrice(s.price)} euros`);
      entry.el.className = `marker${i === 0 ? " marker--best" : ""}${s.id === selectedId ? " marker--selected" : ""}`;
      entry.el.style.zIndex = String(s.id === selectedId ? 1000 : stations.length - i);
    });
  }, [map, stations, selectedId]);

  // Cadre la carte sur ma position + les stations affichées (quand la liste change).
  useEffect(() => {
    const lib = libRef.current;
    if (!map || !lib) return;
    const key = `${center.lat},${center.lon}|${stations.map((s) => s.id).join(",")}`;
    if (key === fitKeyRef.current) return;
    fitKeyRef.current = key;
    if (stations.length === 0) {
      map.easeTo({ center: [center.lon, center.lat], zoom: 12 });
      return;
    }
    const bounds = new lib.LngLatBounds([center.lon, center.lat], [center.lon, center.lat]);
    for (const s of stations) bounds.extend([s.lon, s.lat]);
    // Marges : les étiquettes de prix dépassent au-dessus de leur point d'ancrage.
    map.fitBounds(bounds, { padding: { top: 64, bottom: 28, left: 48, right: 64 }, maxZoom: 15, duration: 600 });
  }, [map, stations, center.lat, center.lon]);

  // Station choisie depuis la liste : on la centre.
  useEffect(() => {
    const s = stations.find((x) => x.id === selectedId);
    if (map && s) map.easeTo({ center: [s.lon, s.lat], duration: 400 });
  }, [map, selectedId, stations]);

  const recenter = () => {
    fitKeyRef.current = "";
    map?.easeTo({ center: [center.lon, center.lat], zoom: 13 });
  };

  return (
    <div className="map">
      <div ref={containerRef} className="map__canvas" role="region" aria-label="Carte des stations" />
      {failed && <p className="map__fallback">Carte indisponible sur cet appareil. La liste ci-dessous reste à jour.</p>}
      {map && (
        <button type="button" className="map__recenter" onClick={recenter} aria-label="Recentrer sur ma position">
          <LocateIcon size={20} />
        </button>
      )}
    </div>
  );
}
