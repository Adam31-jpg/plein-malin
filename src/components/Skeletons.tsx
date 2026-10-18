import { FUELS } from "@/lib/fuels";

export function HomeSkeleton() {
  return (
    <main className="home" aria-busy="true">
      <header className="home__head">
        <div className="where skeleton" />
        <div className="chips" aria-hidden="true">
          {FUELS.map((f) => (
            <span key={f.code} className="chip" style={{ display: "inline-flex", alignItems: "center" }}>
              {f.label}
            </span>
          ))}
        </div>
      </header>
      <div className="skeleton" style={{ height: 260 }} aria-label="Chargement de la prévision" />
      <div className="skeleton" style={{ height: 260 }} />
    </main>
  );
}
