import { describe, expect, it } from "vitest";
import { brandFamily } from "@/lib/brands";
import { brentEurPerLitre, galEurPerLitre, parseEcbCsv, parseFredCsv } from "@/lib/market";

describe("sources de marché", () => {
  it("lit le CSV FRED en ignorant les jours sans cotation", () => {
    expect(parseFredCsv("observation_date,DCOILBRENTEU\n2026-10-13,125.78\n2026-10-14,.\n2026-10-15,126.55\n")).toEqual([
      { day: "2026-10-13", value: 125.78 },
      { day: "2026-10-15", value: 126.55 },
    ]);
  });
  it("lit le CSV SDMX de la BCE", () => {
    const csv = "KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE\nEXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-10-16,1.1253";
    expect(parseEcbCsv(csv)).toEqual([{ day: "2026-10-16", value: 1.1253 }]);
  });
  it("convertit en €/L", () => {
    expect(brentEurPerLitre(126.55, 1.1195)).toBeCloseTo(0.711, 3);
    expect(galEurPerLitre(5.066, 1.1195)).toBeCloseTo(1.195, 3);
  });
});

describe("brandFamily", () => {
  it.each([
    ["Total Access", "TotalEnergies"],
    ["TotalEnergies", "TotalEnergies"],
    ["Carrefour Market", "Carrefour"],
    ["E. Leclerc", "E.Leclerc"],
    ["Super U", "Système U"],
    ["Avia", "Avia"],
  ])("%s → %s", (brand, family) => expect(brandFamily(brand)).toBe(family));
});
