"use client";

import { useMemo, useState } from "react";
import { formatPrice } from "@/lib/format";
import type { HistoryPoint } from "@/lib/queries";

const W = 340;
const H = 180;
const PAD = { top: 12, right: 8, bottom: 22, left: 8 };
const PERIODS = [30, 90] as const;

const dateFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "Europe/Paris" });

/**
 * Courbe en escalier : un prix reste valable jusqu'au changement suivant,
 * c'est la représentation honnête d'un historique de changements.
 */
export default function PriceChart({ points, areaAverage, fuelLabel }: { points: HistoryPoint[]; areaAverage: number | null; fuelLabel: string }) {
  const [now] = useState(() => Date.now());
  // Pas de changement sur 30 jours ? On ouvre directement sur 90 jours pour voir une vraie évolution.
  const [days, setDays] = useState<(typeof PERIODS)[number]>(() =>
    points.some((p) => now - +new Date(p.at) < 30 * 86_400_000) ? 30 : 90,
  );
  const lastChange = useMemo(() => points.reduce<string | null>((acc, p) => (!acc || p.at > acc ? p.at : acc), null), [points]);

  const chart = useMemo(() => {
    const start = now - days * 86_400_000;
    const sorted = [...points].sort((a, b) => +new Date(a.at) - +new Date(b.at));
    // Dernier prix avant la fenêtre → valeur de départ.
    const before = sorted.filter((p) => +new Date(p.at) <= start).at(-1);
    const inside = sorted.filter((p) => +new Date(p.at) > start);
    const series = [...(before ? [{ ...before, at: new Date(start).toISOString() }] : []), ...inside];
    if (series.length === 0) return null;

    const prices = series.map((p) => p.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const lo = Math.min(min, areaAverage ?? min) - 0.01;
    const hi = Math.max(max, areaAverage ?? max) + 0.01;
    const t0 = +new Date(series[0].at);
    const x = (t: number) => PAD.left + ((t - t0) / Math.max(now - t0, 1)) * (W - PAD.left - PAD.right);
    const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);

    let d = `M${x(t0).toFixed(1)},${y(series[0].price).toFixed(1)}`;
    for (let i = 1; i < series.length; i++) {
      const t = +new Date(series[i].at);
      d += ` H${x(t).toFixed(1)} V${y(series[i].price).toFixed(1)}`;
    }
    d += ` H${x(now).toFixed(1)}`;
    const last = series.at(-1)!;
    return {
      path: d,
      area: `${d} V${H - PAD.bottom} H${x(t0).toFixed(1)} Z`,
      lastX: x(now),
      lastY: y(last.price),
      avgY: areaAverage !== null ? y(areaAverage) : null,
      min,
      max,
      changes: inside.length,
      startLabel: dateFmt.format(new Date(t0)),
      partial: t0 > start + 86_400_000,
    };
  }, [points, days, areaAverage, now]);

  return (
    <section className="card" aria-labelledby="chart-title">
      <div className="card__head">
        <div>
          <h2 className="card__title" id="chart-title">
            {fuelLabel} · évolution
          </h2>
          {chart && (
            <p className="card__sub">
              {chart.changes === 0
                ? `Prix inchangé depuis le ${lastChange ? dateFmt.format(new Date(lastChange)) : "début de la période"}`
                : `min ${formatPrice(chart.min)} · max ${formatPrice(chart.max)} · ${chart.changes} changement${chart.changes > 1 ? "s" : ""}`}
            </p>
          )}
        </div>
        <div className="segmented" role="group" aria-label="Période">
          {PERIODS.map((p) => (
            <button key={p} type="button" aria-pressed={p === days} onClick={() => setDays(p)}>
              {p} j
            </button>
          ))}
        </div>
      </div>

      {chart ? (
        <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Prix du ${fuelLabel} sur ${days} jours, entre ${formatPrice(chart.min)} et ${formatPrice(chart.max)} euros`}>
          {chart.avgY !== null && (
            <>
              <line x1={PAD.left} x2={W - PAD.right} y1={chart.avgY} y2={chart.avgY} stroke="var(--faint)" strokeDasharray="4 5" />
              <text x={W - PAD.right} y={chart.avgY - 5} textAnchor="end">
                médiane 10 km
              </text>
            </>
          )}
          <path d={chart.area} fill="color-mix(in srgb, var(--accent) 14%, transparent)" />
          <path d={chart.path} fill="none" stroke="var(--accent)" strokeWidth={2.5} strokeLinejoin="round" />
          <circle cx={chart.lastX} cy={chart.lastY} r={5} fill="var(--accent)" stroke="var(--bg)" strokeWidth={2} />
          <text x={PAD.left} y={H - 5}>
            {chart.startLabel}
          </text>
          <text x={W - PAD.right} y={H - 5} textAnchor="end">
            auj.
          </text>
        </svg>
      ) : (
        <p className="card__sub" style={{ marginTop: 12 }}>
          Pas encore d&apos;historique pour ce carburant.
        </p>
      )}
      {chart?.partial && (
        <p className="card__sub" style={{ marginTop: 6 }}>
          Historique collecté depuis le {chart.startLabel} — importez l&apos;historique annuel pour remonter plus loin.
        </p>
      )}
    </section>
  );
}
