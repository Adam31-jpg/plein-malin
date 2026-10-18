import { describe, expect, it } from "vitest";
import { formatAgo, parseParisLocal } from "@/lib/time";

describe("parseParisLocal", () => {
  it("convertit l'heure d'été (UTC+2)", () => {
    expect(parseParisLocal("2026-10-18 11:47:24")?.toISOString()).toBe("2026-10-18T09:47:24.000Z");
  });
  it("convertit l'heure d'hiver (UTC+1)", () => {
    expect(parseParisLocal("2026-01-15 08:00:00")?.toISOString()).toBe("2026-01-15T07:00:00.000Z");
  });
  it("ignore le faux suffixe +00:00 du flux", () => {
    expect(parseParisLocal("2026-10-18T11:47:24+00:00")?.toISOString()).toBe("2026-10-18T09:47:24.000Z");
  });
  it("gère le passage à l'heure d'hiver", () => {
    expect(parseParisLocal("2026-10-25 04:00:00")?.toISOString()).toBe("2026-10-25T03:00:00.000Z");
  });
  it("rejette une chaîne invalide", () => {
    expect(parseParisLocal("hier")).toBeNull();
  });
});

describe("formatAgo", () => {
  const now = new Date("2026-10-18T12:00:00Z");
  it.each([
    ["2026-10-18T11:59:30Z", "à l'instant"],
    ["2026-10-18T11:35:00Z", "il y a 25 min"],
    ["2026-10-18T10:00:00Z", "il y a 2 h"],
    ["2026-10-15T12:00:00Z", "il y a 3 j"],
  ])("%s → %s", (date, expected) => {
    expect(formatAgo(date, now)).toBe(expected);
  });
});

import { formatOpeningHours, prettifyAddress } from "@/lib/format";

describe("formatOpeningHours", () => {
  it("regroupe les jours identiques", () => {
    expect(
      formatOpeningHours(
        "Lundi07.00-20.00, Mardi07.00-20.00, Mercredi07.00-20.00, Jeudi07.00-20.00, Vendredi07.00-20.00, Samedi08.30-20.00, Dimanche08.30-20.00",
      ),
    ).toEqual(["Lun–Ven 07h00–20h00", "Sam–Dim 08h30–20h00"]);
  });
});

describe("prettifyAddress", () => {
  it("met en forme une adresse en capitales", () => {
    expect(prettifyAddress("55 BOULEVARD DE SUISSE")).toBe("55 Boulevard de Suisse");
    expect(prettifyAddress("RN20")).toBe("RN20");
  });
});
