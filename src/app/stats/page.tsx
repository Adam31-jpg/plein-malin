import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { ChevronLeft } from "@/components/icons";
import { getAudience, NOTRACK_COOKIE, type AudienceStats, type Ranked } from "@/lib/analytics";
import { getDb } from "@/lib/db";
import { isStatsSession, STATS_COOKIE } from "@/lib/stats-auth";

export const metadata: Metadata = { title: "Audience — Plein Malin", robots: { index: false, follow: false } };

const nf = new Intl.NumberFormat("fr-FR");
const dayFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
const COUNTRIES = new Intl.DisplayNames(["fr"], { type: "region" });

export default async function StatsPage({ searchParams }: PageProps<"/stats">) {
  const [jar, sp] = await Promise.all([cookies(), searchParams]);
  if (!(await isStatsSession(jar.get(STATS_COOKIE)?.value))) return <Login error={sp.erreur === "1"} />;
  const stats = await getAudience(getDb());
  const notrack = jar.get(NOTRACK_COOKIE)?.value === "1";
  return <Dashboard stats={stats} notrack={notrack} />;
}

function Login({ error }: { error: boolean }) {
  return (
    <main className="page stats">
      <h1 className="station-title">Audience</h1>
      <form method="post" action="/api/stats/login" className="card stats-login">
        <label htmlFor="password">Mot de passe</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
        {error && <p className="badge badge--warn">Mot de passe incorrect</p>}
        <button type="submit" className="btn btn--primary">
          Voir les statistiques
        </button>
      </form>
    </main>
  );
}

function Dashboard({ stats: s, notrack }: { stats: AudienceStats; notrack: boolean }) {
  const max = Math.max(1, ...s.daily.map((d) => d.visitors));
  return (
    <main className="page stats">
      <nav className="page__nav">
        <Link href="/" className="icon-btn" aria-label="Retour à l'accueil">
          <ChevronLeft />
        </Link>
      </nav>
      <h1 className="station-title">Audience</h1>
      <p className="station-sub">
        <span className="live-dot" aria-hidden="true" /> {nf.format(s.live)} visiteur{s.live > 1 ? "s" : ""} en ce moment (5 dernières minutes)
      </p>

      <div className="kpis">
        <Kpi label="Aujourd'hui" v={s.today} />
        <Kpi label="Hier" v={s.yesterday} />
        <Kpi label="7 jours" v={s.last7} />
        <Kpi label="30 jours" v={s.last30} />
      </div>

      <section className="card">
        <h2 className="card__title">Visiteurs uniques par jour (30 jours)</h2>
        {s.last30.visitors === 0 ? (
          <p className="card__sub">Pas encore de visite enregistrée.</p>
        ) : (
          <div className="bars" role="img" aria-label="Visiteurs uniques par jour sur 30 jours">
            {s.daily.map((d) => (
              <div key={d.day} className="bars__col" title={`${dayFmt.format(new Date(`${d.day}T00:00:00Z`))} : ${d.visitors} visiteurs, ${d.pageviews} pages`}>
                <span className="bars__bar" style={{ height: `${(d.visitors / max) * 100}%` }} />
              </div>
            ))}
          </div>
        )}
        {s.last30.visitors > 0 && (
          <p className="card__sub" style={{ display: "flex", justifyContent: "space-between" }}>
            <span>{dayFmt.format(new Date(`${s.daily[0].day}T00:00:00Z`))}</span>
            <span>max {max} / jour</span>
            <span>{dayFmt.format(new Date(`${s.daily.at(-1)!.day}T00:00:00Z`))}</span>
          </p>
        )}
      </section>

      <div className="stats-grid">
        <Top title="Villes" rows={s.cities} />
        <Top title="Régions" rows={s.regions} />
        <Top title="Pays" rows={s.countries.map((r) => ({ ...r, label: COUNTRIES.of(r.label) ?? r.label }))} />
        <Top title="Appareils" rows={s.devices} />
        <Top title="Pages d'entrée" rows={s.pages} />
        <Top title="Sites d'origine" rows={s.referrers} empty="Accès direct uniquement" />
      </div>

      <section className="card">
        <h2 className="card__title">Comment c&apos;est compté</h2>
        <ul className="stats-notes">
          <li>Un visiteur = une même connexion (adresse IP) avec le même navigateur, compté une seule fois par jour, et une seule fois par mois dans les totaux 7 et 30 jours.</li>
          <li>Aucune adresse IP n&apos;est stockée : seule une empreinte chiffrée, qui change chaque jour, est conservée (13 mois maximum).</li>
          <li>Robots, aperçus de liens et navigateurs « Do Not Track » ne sont pas comptés. Un téléphone qui change de réseau (Wi-Fi → 4G) dans la journée peut compter deux fois ; plusieurs personnes derrière la même box avec le même navigateur, une seule.</li>
          <li>Localisation approximative déduite par Cloudflare (ville du point de connexion de l&apos;opérateur, parfois voisine de la vraie ville).</li>
        </ul>
        <form method="post" action="/api/stats/notrack">
          <button type="submit" className="btn" style={{ width: "100%", marginTop: 12 }}>
            {notrack ? "Cet appareil n'est pas compté · le recompter" : "Ne pas compter mes visites sur cet appareil"}
          </button>
        </form>
      </section>
    </main>
  );
}

function Kpi({ label, v }: { label: string; v: { visitors: number; pageviews: number } }) {
  return (
    <div className="kpi">
      <span className="kpi__label">{label}</span>
      <span className="kpi__value">{nf.format(v.visitors)}</span>
      <span className="kpi__sub">
        visiteur{v.visitors > 1 ? "s" : ""} · {nf.format(v.pageviews)} page{v.pageviews > 1 ? "s" : ""}
      </span>
    </div>
  );
}

function Top({ title, rows, empty = "Pas encore de données" }: { title: string; rows: Ranked[]; empty?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.visitors));
  return (
    <section className="card">
      <h2 className="card__title">{title}</h2>
      {rows.length === 0 ? (
        <p className="card__sub">{empty}</p>
      ) : (
        <ol className="rank">
          {rows.map((r) => (
            <li key={r.label}>
              <span className="rank__bar" style={{ width: `${(r.visitors / max) * 100}%` }} />
              <span className="rank__label">{r.label}</span>
              <span className="rank__value">{nf.format(r.visitors)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
