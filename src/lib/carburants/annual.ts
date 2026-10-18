import { Unzip, UnzipInflate } from "fflate";
import { fuelFromApi, type FuelCode } from "@/lib/fuels";
import { fetchWithRetry } from "@/lib/http";
import { parseParisLocal } from "@/lib/time";

/** Fichier annuel officiel : un XML (ISO-8859-1) zippé, ~30 Mo pour toute la France. */
export const annualUrl = (year: number) => `https://donnees.roulez-eco.fr/opendata/annee/${year}`;

export type HistoryRow = { stationId: number; fuel: FuelCode; price: number; updatedAt: Date };

const PDV_RE = /<pdv\s[^>]*\bid="(\d+)"/;
const PRIX_RE = /<prix\s[^>]*?nom="([^"]+)"[^>]*?maj="([^"]+)"[^>]*?valeur="([\d.]+)"/g;

/**
 * Lit le XML ligne à ligne et ne garde que les prix des stations demandées.
 * Le fichier est groupé par station : avec `onStation`, chaque station est transmise dès
 * qu'elle est lue puis oubliée (mémoire constante, même pour toute la France).
 * Sans `onStation`, les relevés s'accumulent dans `rows`.
 */
export class AnnualXmlParser {
  readonly rows: HistoryRow[] = [];
  private current: number | null = null;
  private buffer: HistoryRow[] = [];

  constructor(
    private readonly wanted: Set<number>,
    private readonly onStation?: (stationId: number, rows: HistoryRow[]) => void,
  ) {}

  /** À appeler en fin de fichier pour transmettre la dernière station. */
  flush() {
    if (this.onStation && this.current !== null && this.buffer.length) this.onStation(this.current, this.buffer);
    this.buffer = [];
  }

  line(text: string) {
    const pdv = PDV_RE.exec(text);
    if (pdv) {
      this.flush();
      const id = Number(pdv[1]);
      this.current = this.wanted.has(id) ? id : null;
    }
    if (this.current === null || !text.includes("<prix")) return;
    for (const m of text.matchAll(PRIX_RE)) {
      const fuel = fuelFromApi(m[1]);
      const updatedAt = parseParisLocal(m[2]);
      let price = Number(m[3]);
      if (price > 100) price /= 1000; // anciens fichiers : prix en millièmes d'euro
      if (!fuel || !updatedAt || !(price > 0.3 && price < 5)) continue;
      const row = { stationId: this.current, fuel, price: Math.round(price * 1000) / 1000, updatedAt };
      if (this.onStation) this.buffer.push(row);
      else this.rows.push(row);
    }
  }
}

/**
 * Ne garde que les changements de prix (le fichier contient aussi chaque reconfirmation),
 * à partir de `since`, plus le dernier prix connu juste avant pour que la courbe démarre au bon niveau.
 */
export function toChanges(rows: HistoryRow[], since: Date): HistoryRow[] {
  const series = new Map<string, HistoryRow[]>();
  for (const r of rows) {
    const k = `${r.stationId}:${r.fuel}`;
    const list = series.get(k);
    if (list) list.push(r);
    else series.set(k, [r]);
  }
  const out: HistoryRow[] = [];
  for (const list of series.values()) {
    list.sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
    let lastPrice: number | null = null;
    let beforeWindow: HistoryRow | null = null;
    for (const r of list) {
      if (r.price === lastPrice) continue;
      lastPrice = r.price;
      if (r.updatedAt < since) beforeWindow = r;
      else {
        if (beforeWindow) {
          out.push(beforeWindow);
          beforeWindow = null;
        }
        out.push(r);
      }
    }
    if (beforeWindow) out.push(beforeWindow);
  }
  return out;
}

/** Télécharge et décompresse le fichier d'une année en streaming, en filtrant au fil de l'eau. */
export async function readAnnualFile(year: number, parser: AnnualXmlParser, log: (msg: string) => void = console.log) {
  // Téléchargement complet d'abord (~30 Mo) : le délai ne doit couvrir que le réseau,
  // pas le traitement du XML (plusieurs minutes pour toute la France).
  const res = await fetchWithRetry(annualUrl(year), {}, { timeoutMs: 5 * 60_000, retries: 3 });
  const zip = new Uint8Array(await res.arrayBuffer());
  const decoder = new TextDecoder("latin1");
  let pending = "";
  let bytes = 0;
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (file) => {
    if (!file.name.endsWith(".xml")) return;
    file.ondata = (err, data, final) => {
      if (err) throw err;
      bytes += data.length;
      pending += decoder.decode(data, { stream: !final });
      const lines = pending.split("\n");
      pending = final ? "" : lines.pop()!;
      for (const l of lines) parser.line(l);
    };
    file.start();
  };
  const CHUNK = 1 << 20;
  for (let i = 0; i < zip.length; i += CHUNK) unzip.push(zip.subarray(i, i + CHUNK), i + CHUNK >= zip.length);
  parser.flush();
  log(`[import] ${year} : ${(bytes / 1e6).toFixed(0)} Mo de XML lus`);
}
