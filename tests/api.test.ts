import { describe, expect, it } from "vitest";
import { normalizeRecord, parsePrices, type RawRecord } from "@/lib/carburants/api";

describe("parsePrices", () => {
  it("lit un tableau de prix", () => {
    const raw = JSON.stringify([
      { "@nom": "Gazole", "@id": "1", "@maj": "2026-10-17 09:03:48", "@valeur": "2.299" },
      { "@nom": "E10", "@id": "5", "@maj": "2026-09-15 05:54:08", "@valeur": "2.179" },
    ]);
    expect(parsePrices(raw)).toEqual([
      { fuel: "gazole", price: 2.299, updatedAt: new Date("2026-10-17T07:03:48Z") },
      { fuel: "e10", price: 2.179, updatedAt: new Date("2026-09-15T03:54:08Z") },
    ]);
  });
  it("lit un objet unique (station mono-carburant)", () => {
    const raw = JSON.stringify({ "@nom": "Gazole", "@id": "1", "@maj": "2026-10-18 00:01:00", "@valeur": "2.250" });
    expect(parsePrices(raw)).toHaveLength(1);
  });
  it("écarte les valeurs aberrantes et le JSON invalide", () => {
    expect(parsePrices(JSON.stringify({ "@nom": "Gazole", "@maj": "2026-10-18 00:01:00", "@valeur": "0" }))).toEqual([]);
    expect(parsePrices("{oops")).toEqual([]);
    expect(parsePrices(null)).toEqual([]);
  });
});

describe("normalizeRecord", () => {
  const base: RawRecord = {
    id: 31200022,
    cp: "31200",
    pop: "R",
    adresse: "55 BOULEVARD DE SUISSE",
    ville: "Toulouse",
    latitude: "4361600",
    longitude: "142100",
    geom: { lat: 43.616, lon: 1.421 },
    prix: null,
    horaires_automate_24_24: "Non",
    services_service: ["Lavage manuel"],
    horaires_jour: null,
    carburants_rupture_temporaire: "E10;SP98",
    code_departement: "31",
  };
  it("privilégie geom", () => {
    expect(normalizeRecord(base)).toMatchObject({ lat: 43.616, lon: 1.421, roadType: "R", automate24: false, outOfStock: ["e10", "sp98"] });
  });
  it("retombe sur latitude/longitude ÷ 100 000", () => {
    expect(normalizeRecord({ ...base, geom: null })).toMatchObject({ lat: 43.616, lon: 1.421 });
  });
  it("rejette une station sans coordonnées", () => {
    expect(normalizeRecord({ ...base, geom: null, latitude: null })).toBeNull();
  });
});
