import { describe, expect, it } from "vitest";
import { directionOf, forecast, isHit } from "@/lib/forecast";

const day = (i: number) => new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);

describe("prévision", () => {
  it("annonce le sens et mesure sa réussite", () => {
    expect(directionOf(0.02)).toBe("up");
    expect(directionOf(-0.015)).toBe("down");
    expect(directionOf(0.004)).toBe("stable");
    expect(isHit("up", 0.01)).toBe(true);
    expect(isHit("down", 0.01)).toBe(false);
    expect(isHit("stable", 0.015)).toBe(true);
  });

  it("retrouve une pompe qui suit le cours de gros avec 10 jours de retard", () => {
    // Cours de gros en vagues ; la pompe le suit 10 jours plus tard (+ marge fixe).
    const crude = Array.from({ length: 700 }, (_, i) => 0.8 + 0.15 * Math.sin(i / 25) + 0.05 * Math.sin(i / 7));
    const market = crude.map((v, i) => ({ day: day(i), eurPerLitre: v }));
    const daily = crude.slice(0, 700).map((_, i) => ({ day: day(i), median: Math.round((1.2 + crude[Math.max(0, i - 10)]) * 1000) / 1000 }));
    const f = forecast("gazole", daily.slice(80), market);
    expect(f).not.toBeNull();
    const { up, down } = f!.backtest.byDirection;
    expect((up.hits + down.hits) / (up.cases + down.cases)).toBeGreaterThan(0.85);
    expect(f!.reliable).toBe(true);
  });

  it("ne se dit pas fiable sur du bruit pur", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.04;
    const market = Array.from({ length: 700 }, (_, i) => ({ day: day(i), eurPerLitre: 0.8 + rnd() }));
    let p = 1.9;
    const daily = Array.from({ length: 620 }, (_, i) => ({ day: day(i + 80), median: Math.round((p += rnd()) * 1000) / 1000 }));
    const f = forecast("gazole", daily, market);
    expect(f).not.toBeNull();
    const { up, down } = f!.backtest.byDirection;
    expect((up.hits + down.hits) / Math.max(up.cases + down.cases, 1)).toBeLessThan(0.65);
  });
});
