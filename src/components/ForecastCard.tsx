import type { AnnouncementRecord, Direction } from "@/lib/forecast";
import type { ForecastResponse } from "@/lib/forecast-query";
import { departementName } from "@/lib/departements";
import { formatPrice } from "@/lib/format";
import { fuelLabel, type FuelCode } from "@/lib/fuels";

const dayFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
const pct = (v: number) => `${v >= 0.0005 ? "+" : v <= -0.0005 ? "−" : ""}${Math.abs(v * 100).toFixed(1).replace(".", ",")} %`;

const WORD: Record<Direction, string> = { up: "une hausse", down: "une baisse", stable: "un prix stable" };
const TITLE: Record<Direction, string> = { up: "En hausse", down: "En baisse", stable: "Stable" };
const ARROW: Record<Direction, string> = { up: "↗", down: "↘", stable: "→" };

const W = 320;
const H = 84;

/** Prix médian des 60 derniers jours (aucune projection chiffrée : seul le sens est annoncé). */
function Sparkline({ f }: { f: ForecastResponse }) {
  const pts = f.history;
  const values = pts.map((p) => p.median);
  const lo = Math.min(...values) - 0.005;
  const hi = Math.max(...values) + 0.005;
  const x = (i: number) => (i / (pts.length - 1)) * (W - 8) + 4;
  const y = (v: number) => 6 + (1 - (v - lo) / (hi - lo)) * (H - 22);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.median).toFixed(1)}`).join(" ");
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Prix médian du secteur sur les 60 derniers jours">
      <path d={line} className="spark__line" />
      <circle cx={x(pts.length - 1)} cy={y(f.current)} r={4} className="spark__dot" />
      <text x={4} y={H - 3}>
        {dayFmt.format(new Date(`${pts[0].day}T00:00:00Z`))}
      </text>
      <text x={W - 4} y={H - 3} textAnchor="end">
        aujourd&apos;hui
      </text>
    </svg>
  );
}

export default function ForecastCard({ forecast: f, fuel, area }: { forecast: ForecastResponse | null; fuel: FuelCode; area: string }) {
  const zone = departementName(area);
  if (!f) {
    return (
      <section className="forecast" aria-labelledby="fc-title">
        <p className="eyebrow">
          {fuelLabel(fuel)} · 7 prochains jours · {zone}
        </p>
        <h2 className="forecast__title" id="fc-title">
          Pas encore de tendance
        </h2>
        <p className="forecast__text">
          {area.startsWith("97")
            ? "Outre-mer : les prix maximum sont fixés chaque mois par arrêté préfectoral, il n'y a pas de tendance à prévoir."
            : "Pas assez de stations ou d'historique pour ce carburant dans ce département."}
        </p>
      </section>
    );
  }

  const rec = f.backtest.byDirection[f.direction];
  const rate = rec.cases ? Math.round((rec.hits / rec.cases) * 100) : null;
  const months = Math.round(f.backtest.days / 30);
  const record =
    rate === null
      ? `Le modèle n'a jamais annoncé ${WORD[f.direction]} ces ${months} derniers mois : pas de recul pour juger.`
      : `Quand l'app annonce ${WORD[f.direction]}, elle a eu raison ${rate} % du temps (${rec.hits} fois sur ${rec.cases}) ces ${months} derniers mois` +
        (f.direction === "stable" ? "." : `, contre ${Math.round(rec.blindRate * 100)} % si on l'annonçait systématiquement.`);
  const advice = !f.reliable
    ? "Pas de signal fiable : fais le plein quand tu en as besoin, à la moins chère ci-dessous."
    : f.direction === "down"
      ? "Pas pressé ? Attendre quelques jours devrait coûter un peu moins cher."
      : f.direction === "up"
        ? "Mieux vaut faire le plein maintenant."
        : "Pas de raison d'attendre : le prix ne devrait pas beaucoup bouger.";
  const facts = f.facts;
  const marketName = f.marketSeries === "diesel" ? "du gazole" : "de l'essence";
  const all = Object.entries(f.backtest.byDirection) as [Direction, AnnouncementRecord][];

  return (
    <section className={`forecast forecast--${f.reliable ? f.direction : "uncertain"}`} aria-labelledby="fc-title">
      <p className="eyebrow">
        {fuelLabel(fuel)} · 7 prochains jours · {zone}
      </p>
      <h2 className="forecast__title" id="fc-title">
        {f.reliable ? (
          <>
            <span aria-hidden="true">{ARROW[f.direction]} </span>
            {TITLE[f.direction]}
          </>
        ) : (
          "Incertain"
        )}
      </h2>
      <p className="forecast__numbers">
        Prix médian du département aujourd&apos;hui <strong>{formatPrice(f.current)} €</strong>
        {!f.reliable && <span className="muted"> · le modèle penche pour {WORD[f.direction]}, sans certitude</span>}
      </p>
      <p className={`forecast__record${f.reliable ? "" : " forecast__record--weak"}`}>{record}</p>
      <Sparkline f={f} />
      <p className="forecast__advice">{advice}</p>
      {facts && (
        <p className="forecast__fact">
          Pétrole brut (Brent) : <strong>{Math.round(facts.brentUsd)} $</strong> le baril
          {facts.brentChange14 !== null && <> ({pct(facts.brentChange14)} en 2 semaines)</>} · 1 € ={" "}
          <strong>{facts.eurUsd.toFixed(3).replace(".", ",")} $</strong>
          {facts.eurUsdChange14 !== null && <> ({pct(facts.eurUsdChange14)})</>}. Cours au {dayFmt.format(new Date(`${facts.day}T00:00:00Z`))} ; la
          pompe suit en général avec 1 à 3 semaines de retard.
        </p>
      )}
      <details className="forecast__details">
        <summary>Fiabilité et méthode</summary>
        <ul>
          <li>
            Bilan des {months} derniers mois, rejoués jour par jour avec uniquement les infos connues à chaque date :
            <ul>
              {all.map(([d, r]) => (
                <li key={d}>
                  annonce « {TITLE[d].toLowerCase()} » :{" "}
                  {r.cases ? `${Math.round((r.hits / r.cases) * 100)} % de réussite (${r.hits}/${r.cases})` : "jamais annoncée"} · systématique{" "}
                  {Math.round(r.blindRate * 100)} %
                </li>
              ))}
            </ul>
          </li>
          <li>
            Une annonce n&apos;est affichée comme fiable que si elle a eu raison au moins 65 % du temps sur au moins 15 cas et, pour une hausse ou une
            baisse, 10 points de mieux qu&apos;en l&apos;annonçant systématiquement. Sinon : « Incertain ».
          </li>
          <li>
            Pas de montant en centimes : le modèle trouve plus souvent le sens que l&apos;ampleur (erreur moyenne ±{(f.backtest.mae * 100).toFixed(1)} cts,
            contre ±{(f.backtest.naiveMae * 100).toFixed(1)} cts en supposant que rien ne bouge).
          </li>
          <li>
            Le modèle suit le cours de gros {marketName} raffiné (port de New York) converti en €/L, et l&apos;écart entre la pompe et ce cours.
          </li>
          <li>
            Sources : prix officiels déclarés par les stations (data.economie.gouv.fr), Brent et produits raffinés (EIA via FRED), EUR/USD (BCE).
            Recalculé chaque matin.
          </li>
        </ul>
      </details>
    </section>
  );
}
