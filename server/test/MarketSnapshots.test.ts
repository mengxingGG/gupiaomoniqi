import { describe, expect, it, vi } from "vitest";
import type { Quote } from "@gupiaomoniqi/shared";
import { MarketSnapshots } from "../src/assistant/MarketSnapshots.js";

function harness() {
  let now = new Date("2026-10-16T12:00:00Z");
  const days = vi.fn(async () => [
    { time: "2026-10-09T00:00:00Z", close: 99 }, { time: "2026-10-12T00:00:00Z", close: 100 },
    { time: "2026-10-16T00:00:00Z", close: 110, isPartial: true }, { time: "2026-10-17T00:00:00Z", close: 999 },
  ]);
  const service = new MarketSnapshots({
    stocks: mode => Array.from({ length: 105 }, (_, n) => ({ id: `${mode}-${n.toString().padStart(3, "0")}`, name: `股票${n}`, symbol: `S${n}`, market: "US" })),
    quote: () => ({ currentPrice: 111, quoteCurrency: "USD", updatedAt: now.toISOString() } as Quote), days,
  }, () => now);
  return { service, days, advance: () => { now = new Date(now.getTime() + 301000); } };
}
describe("rolling 7-day snapshots", () => {
  it("pages every stock exactly once, fixes mode and leaves missing days missing", async () => {
    const h = harness(), ids: string[] = []; let after = "";
    do {
      const result = await h.service.page({ mode: "VIRTUAL", after });
      expect(result.items.length).toBeLessThanOrEqual(50); expect(result.universe).toBe(105);
      expect(result.items[0]?.days.map(d => d.time)).toEqual(["2026-10-12T00:00:00Z", "2026-10-16T00:00:00Z"]);
      ids.push(...result.items.map(x => x.id)); after = result.nextAfter ?? "";
    } while (after);
    expect(new Set(ids).size).toBe(105); expect(ids.every(id => id.startsWith("VIRTUAL-"))).toBe(true);
  });
  it("searches non-watchlist stocks and caches only bounded history, with fresh quotes and mode isolation", async () => {
    const h = harness();
    const first = await h.service.page({ mode: "REAL", query: "S104" }); expect(first.items[0]?.id).toBe("REAL-104");
    await h.service.page({ mode: "REAL", ids: ["REAL-104"] }); expect(h.days).toHaveBeenCalledTimes(1);
    await h.service.page({ mode: "VIRTUAL", query: "S104" }); expect(h.days).toHaveBeenCalledTimes(2);
    h.advance(); const fresh = await h.service.page({ mode: "REAL", query: "S104" });
    expect(h.days).toHaveBeenCalledTimes(3); expect(fresh.items[0]?.quote?.time).not.toBe(first.items[0]?.quote?.time);
    expect((await h.service.page({ mode: "REAL", ids: ["VIRTUAL-104"] })).items).toEqual([]);
  });
  it("reports history failure without fabricating prices, and validates batch limits", async () => {
    const h = harness(); h.days.mockRejectedValue(new Error("offline"));
    const result = await h.service.page({ mode: "REAL", limit: 1 });
    expect(result.items[0]).toMatchObject({ days: [], historyError: "日快照暂不可用", quote: { price: 111 } });
    await expect(h.service.page({ mode: "REAL", limit: 500 })).rejects.toThrow();
  });
  it("coalesces concurrent history reads", async () => {
    const h = harness();
    await Promise.all([h.service.page({ mode: "REAL", limit: 1 }), h.service.page({ mode: "REAL", limit: 1 })]);
    expect(h.days).toHaveBeenCalledTimes(1);
  });
});
