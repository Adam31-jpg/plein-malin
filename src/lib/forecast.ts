/**
 * Sens probable du prix médian à 7 jours : hausse, baisse ou stable.
 *
 * Modèle volontairement simple et vérifiable : régression linéaire (moindres carrés,
 * légère régularisation) de la variation du prix médian sur 7 jours, à partir de :
 * - la variation du cours de gros en €/L (gazole ou essence raffinés, convertis avec
 *   l'EUR/USD) sur les 7 et 14 derniers jours : il se répercute à la pompe en 1 à 3 semaines ;
 * - la dynamique récente du prix à la pompe ;
 * - l'écart entre le prix à la pompe et son niveau « normal » vu le cours de gros (rattrapage).
 *
 * On n'affiche que le SENS, jamais un montant : le backtest montre que le modèle trouve
 * souvent la direction mais pas l'ampleur. La fiabilité affichée est celle mesurée pour
 * l'annonce du jour (« quand il annonce une baisse, il a eu raison X fois sur Y ») en
 * rejouant les 9 derniers mois avec uniquement les informations connues à chaque date.
 * Les cours sont publiés avec quelques jours de retard : on n'utilise jamais une cotation
 * plus récente que `MARKET_LAG_DAYS`, backtest compris.
 */

export const HORIZON = 7;
export const MARKET_LAG_DAYS = 4;
/** Fenêtre de mesure de la fiabilité : 9 mois. */
export const BACKTEST_DAYS = 270;
/** Seuil d'annonce : en dessous de ±1 ct prévu, on annonce « stable ». */
export const DIRECTION_THRESHOLD = 0.01;
/**
 * Une annonce n'est montrée comme fiable qu'avec ≥ 65 % de réussite sur ≥ 15 cas et,
 * pour une hausse ou une baisse, au moins 10 points de mieux que la même annonce faite à l'aveugle.
 */
export const RELIABLE_RATE = 0.65;
export const RELIABLE_MIN_CASES = 15;
export const RELIABLE_EDGE = 0.1;
const MIN_TRAIN = 60;
const RIDGE = 1e-4;

export type Direction = "up" | "down" | "stable";
export type DailyPoint = { day: string; median: number };
/** Cours de gros en €/L (produit raffiné correspondant au carburant). */
export type MarketDay = { day: string; eurPerLitre: number };

/**
 * Bilan d'un type d'annonce sur la fenêtre de backtest.
 * `blindRate` : taux de réussite si l'on avait fait cette annonce TOUS les jours, sans modèle
 * (ex. « toujours en hausse » pendant une période de hausse). Le modèle doit faire mieux.
 */
export type AnnouncementRecord = { cases: number; hits: number; blindRate: number };

export type Backtest = {
  days: number;
  /** Par type d'annonce : combien de fois annoncée, combien de fois juste. */
  byDirection: { [D in Direction]: AnnouncementRecord };
  /** Erreur moyenne du modèle et de « le prix ne bouge pas » (€/L), pour information. */
  mae: number;
  naiveMae: number;
};

export type Forecast = {
  fuel: string;
  asOf: string;
  current: number;
  direction: Direction;
  /** L'annonce du jour a-t-elle été assez souvent juste par le passé ? */
  reliable: boolean;
  backtest: Backtest;
  /** Série récente pour le graphique (60 jours) */
  history: DailyPoint[];
};

export type ForecastOptions = {
  /** Limiter l'entraînement aux N derniers jours (défaut : tout l'historique). */
  trainWindowDays?: number;
};

const DAY = 86_400_000;
const toIdx = (day: string, origin: number) => Math.round((Date.parse(`${day}T00:00:00Z`) - origin) / DAY);
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(a.length, 1);

export function directionOf(change: number): Direction {
  return change >= DIRECTION_THRESHOLD ? "up" : change <= -DIRECTION_THRESHOLD ? "down" : "stable";
}

/** Une annonce est juste si le prix a bougé dans le sens annoncé (≥ 0,5 ct), ou de moins de 2 cts pour « stable ». */
export function isHit(direction: Direction, actual: number): boolean {
  if (direction === "up") return actual >= 0.005;
  if (direction === "down") return actual <= -0.005;
  return Math.abs(actual) < 0.02;
}

/** Série continue jour par jour (week-ends et jours fériés reprennent la dernière valeur). */
function fill(points: { day: string; v: number }[], origin: number, length: number): Float64Array {
  const out = new Float64Array(length).fill(NaN);
  const sorted = [...points].sort((a, b) => a.day.localeCompare(b.day));
  let j = 0;
  let last = NaN;
  for (let i = 0; i < length; i++) {
    while (j < sorted.length && toIdx(sorted[j].day, origin) <= i) last = sorted[j++].v;
    out[i] = last;
  }
  return out;
}

/** Résout A w = b par élimination de Gauss avec pivot partiel. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    if (Math.abs(A[c][c]) < 1e-12) continue;
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c];
      for (let j = c; j < n; j++) A[r][j] -= f * A[c][j];
      b[r] -= f * b[c];
    }
  }
  const w = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < n; j++) s -= A[i][j] * w[j];
    w[i] = Math.abs(A[i][i]) < 1e-12 ? 0 : s / A[i][i];
  }
  return w;
}

/**
 * Variables de base z = [1, Δcours 7 j, Δcours 7→14 j, Δpompe 7 j, pompe, cours].
 * Les variables du modèle s'en déduisent linéairement (l'écart pompe/cours dépend de
 * la relation de long terme a + b × cours, réestimée chaque jour) : on peut donc cumuler
 * les sommes une fois pour toutes et rejouer 9 mois de backtest en quelques millisecondes.
 */
const Z = 6;

class Model {
  constructor(
    private readonly retail: Float64Array,
    private readonly crude: Float64Array,
  ) {}

  base(i: number): number[] | null {
    const L = MARKET_LAG_DAYS;
    if (i - L - 14 < 0) return null;
    const v = [this.retail[i], this.retail[i - 7], this.crude[i - L], this.crude[i - L - 7], this.crude[i - L - 14]];
    if (!v.every(Number.isFinite)) return null;
    const [r0, r7, c0, c7, c14] = v;
    return [1, c0 - c7, c7 - c14, r0 - r7, r0, c0];
  }

  target(i: number) {
    return this.retail[i + HORIZON] - this.retail[i];
  }

  /** Rejoue tous les jours ≤ T ; appelle `onDay(t, prédiction)` pour les jours de [from, T]. */
  run(T: number, from: number, window: number | undefined, onDay: (t: number, pred: number) => void) {
    // Sommes cumulées de la relation de long terme (pompe ~ cours décalé).
    let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    // Sommes cumulées des moindres carrés sur z : S = Σ z zᵀ, s = Σ z y.
    const S = Array.from({ length: Z }, () => new Array<number>(Z).fill(0));
    const s = new Array<number>(Z).fill(0);
    const added: { i: number; z: number[]; y: number }[] = [];
    let rows = 0;
    let removeFrom = 0;
    const accumulate = (z: number[], y: number, sign: 1 | -1) => {
      for (let p = 0; p < Z; p++) {
        s[p] += sign * z[p] * y;
        for (let q = 0; q < Z; q++) S[p][q] += sign * z[p] * z[q];
      }
      rows += sign;
    };

    for (let t = 0; t <= T; t++) {
      const r = this.retail[t];
      const c = this.crude[t - MARKET_LAG_DAYS];
      if (Number.isFinite(r) && Number.isFinite(c)) {
        n++; sx += c; sy += r; sxx += c * c; sxy += c * r;
      }
      // La cible du jour t − H devient connue au jour t.
      const k = t - HORIZON;
      const zk = k >= 0 ? this.base(k) : null;
      if (zk) {
        const y = this.target(k);
        if (Number.isFinite(y)) {
          accumulate(zk, y, 1);
          added.push({ i: k, z: zk, y });
        }
      }
      // Fenêtre glissante d'entraînement (optionnelle).
      if (window !== undefined) {
        while (removeFrom < added.length && added[removeFrom].i < t - window) {
          accumulate(added[removeFrom].z, added[removeFrom].y, -1);
          removeFrom++;
        }
      }
      if (t < from || rows < MIN_TRAIN) continue;
      const zt = this.base(t);
      if (!zt) continue;

      const b = n >= 10 ? (n * sxy - sx * sy) / (n * sxx - sx * sx || 1) : 0;
      const a = (sy - b * sx) / Math.max(n, 1);
      // x = M z avec x = [1, Δc7, Δc14, Δr7, r − a − b·c]
      const M = [
        [1, 0, 0, 0, 0, 0],
        [0, 1, 0, 0, 0, 0],
        [0, 0, 1, 0, 0, 0],
        [0, 0, 0, 1, 0, 0],
        [-a, 0, 0, 0, 1, -b],
      ];
      const K = M.length;
      const A = Array.from({ length: K }, () => new Array<number>(K).fill(0));
      const bv = new Array<number>(K).fill(0);
      for (let p = 0; p < K; p++) {
        for (let u = 0; u < Z; u++) {
          if (M[p][u] === 0) continue;
          bv[p] += M[p][u] * s[u];
          for (let q = 0; q < K; q++) for (let v = 0; v < Z; v++) if (M[q][v] !== 0) A[p][q] += M[p][u] * S[u][v] * M[q][v];
        }
      }
      for (let p = 1; p < K; p++) A[p][p] += RIDGE * rows;
      const w = solve(A, bv);
      const x = M.map((row) => row.reduce((acc, m, u) => acc + m * zt[u], 0));
      onDay(t, w.reduce((acc, wi, p) => acc + wi * x[p], 0));
    }
  }
}

export function forecast(fuel: string, daily: DailyPoint[], market: MarketDay[], options: ForecastOptions = {}): Forecast | null {
  if (daily.length < MIN_TRAIN + HORIZON + 21 || market.length < 30) return null;
  const sorted = [...daily].sort((a, b) => a.day.localeCompare(b.day));
  const origin = Date.parse(`${sorted[0].day}T00:00:00Z`) - 60 * DAY;
  const asOf = sorted.at(-1)!.day;
  const T = toIdx(asOf, origin);
  const retail = fill(
    sorted.map((p) => ({ day: p.day, v: p.median })),
    origin,
    T + 1,
  );
  for (let i = 0; i < toIdx(sorted[0].day, origin); i++) retail[i] = NaN;
  const crude = fill(
    market.filter((m) => m.day <= asOf).map((m) => ({ day: m.day, v: m.eurPerLitre })),
    origin,
    T + 1,
  );
  const model = new Model(retail, crude);

  const byDirection: Backtest["byDirection"] = {
    up: { cases: 0, hits: 0, blindRate: 0 },
    down: { cases: 0, hits: 0, blindRate: 0 },
    stable: { cases: 0, hits: 0, blindRate: 0 },
  };
  const blind = { up: 0, down: 0, stable: 0, n: 0 };
  const errors: number[] = [];
  const naive: number[] = [];
  const latest: { pred: number | null } = { pred: null };
  model.run(T, T - HORIZON - BACKTEST_DAYS + 1, options.trainWindowDays, (t, pred) => {
    if (t === T) {
      latest.pred = pred;
      return;
    }
    const actual = model.target(t);
    if (t > T - HORIZON || !Number.isFinite(actual)) return;
    const d = directionOf(pred);
    byDirection[d].cases++;
    if (isHit(d, actual)) byDirection[d].hits++;
    blind.n++;
    for (const k of ["up", "down", "stable"] as const) if (isHit(k, actual)) blind[k]++;
    errors.push(Math.abs(pred - actual));
    naive.push(Math.abs(actual));
  });
  if (latest.pred === null) return null;
  for (const k of ["up", "down", "stable"] as const) byDirection[k].blindRate = blind.n ? blind[k] / blind.n : 0;

  const direction = directionOf(latest.pred);
  const rec = byDirection[direction];
  const rate = rec.cases ? rec.hits / rec.cases : 0;
  return {
    fuel,
    asOf,
    current: retail[T],
    direction,
    reliable:
      rec.cases >= RELIABLE_MIN_CASES && rate >= RELIABLE_RATE && (direction === "stable" || rate >= rec.blindRate + RELIABLE_EDGE),
    backtest: { days: BACKTEST_DAYS, byDirection, mae: mean(errors), naiveMae: mean(naive) },
    history: sorted.slice(-60),
  };
}
