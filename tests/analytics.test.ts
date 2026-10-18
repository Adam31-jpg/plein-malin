import { describe, expect, it } from "vitest";
import { deviceOf, isBot, normalizePath, referrerHost, visitDay, visitorIds } from "@/lib/analytics";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

describe("audience", () => {
  it("écarte les robots et aperçus de liens", () => {
    expect(isBot("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe(true);
    expect(isBot("WhatsApp/2.23.20.0")).toBe(true);
    expect(isBot("curl/8.4.0")).toBe(true);
    expect(isBot(null)).toBe(true);
    expect(isBot(IPHONE)).toBe(false);
  });

  it("reconnaît le type d'appareil", () => {
    expect(deviceOf(IPHONE)).toBe("mobile");
    expect(deviceOf(MAC)).toBe("desktop");
    expect(deviceOf("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe("tablet");
  });

  it("même IP + même navigateur = même visiteur dans la journée, jamais l'IP en clair", async () => {
    const a = await visitorIds("sel", "86.1.2.3", IPHONE, "2026-10-18");
    const b = await visitorIds("sel", "86.1.2.3", IPHONE, "2026-10-18");
    expect(a).toEqual(b);
    expect(a.visitor).not.toContain("86.1.2.3");
    expect(a.visitor).toMatch(/^[0-9a-f]{32}$/);
  });

  it("autre jour, autre navigateur ou autre sel = autre empreinte ; même mois = même empreinte mensuelle", async () => {
    const base = await visitorIds("sel", "86.1.2.3", IPHONE, "2026-10-18");
    const nextDay = await visitorIds("sel", "86.1.2.3", IPHONE, "2026-10-19");
    expect(nextDay.visitor).not.toBe(base.visitor);
    expect(nextDay.visitorMonth).toBe(base.visitorMonth);
    expect((await visitorIds("sel", "86.1.2.3", MAC, "2026-10-18")).visitor).not.toBe(base.visitor);
    expect((await visitorIds("autre", "86.1.2.3", IPHONE, "2026-10-18")).visitor).not.toBe(base.visitor);
  });

  it("jour calendaire à l'heure de Paris", () => {
    expect(visitDay(new Date("2026-10-18T22:30:00Z"))).toBe("2026-10-19");
  });

  it("normalise les pages et ne garde que le domaine d'origine", () => {
    expect(normalizePath("/station/31120001?fuel=e10")).toBe("/station/:id");
    expect(referrerHost("https://www.google.com/search?q=essence", "plein-malin.workers.dev")).toBe("google.com");
    expect(referrerHost("https://plein-malin.workers.dev/station/1", "plein-malin.workers.dev")).toBeNull();
  });
});
