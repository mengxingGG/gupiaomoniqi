import { describe, expect, it } from "vitest";
import { GAME_RULES } from "../src/config.js";
import { createTestHarness, TEST_INSTRUMENTS } from "./helpers.js";

describe("VirtualMarketEngine", () => {
  it("初始化全部测试股票的行情", async () => {
    const { repository } = await createTestHarness();
    const quotes = repository.listQuotes();

    expect(quotes).toHaveLength(TEST_INSTRUMENTS.length);
    expect(quotes.every((quote) => quote.currentPrice > 0)).toBe(true);
    expect(quotes.every((quote) => quote.volume === 0)).toBe(true);
  });

  it("行情始终满足单 tick 和日涨跌幅边界", async () => {
    let state = 7;
    const random = () => {
      state = (state * 48_271) % 2_147_483_647;
      return state / 2_147_483_647;
    };
    const { engine } = await createTestHarness({ random });

    let previous = await engine.initialize();

    for (let index = 0; index < 500; index += 1) {
      const next = await engine.tick();

      for (let quoteIndex = 0; quoteIndex < next.length; quoteIndex += 1) {
        const before = previous[quoteIndex];
        const after = next[quoteIndex];

        expect(before).toBeDefined();
        expect(after).toBeDefined();

        if (!before || !after) {
          continue;
        }

        const tickChange =
          Math.abs(after.currentPrice - before.currentPrice) /
          before.currentPrice;
        const lowerLimit =
          after.previousClose * (1 - GAME_RULES.dailyPriceLimitRate);
        const upperLimit =
          after.previousClose * (1 + GAME_RULES.dailyPriceLimitRate);

        expect(tickChange).toBeLessThanOrEqual(
          GAME_RULES.maxTickChangeRate + 0.002,
        );
        expect(after.currentPrice).toBeGreaterThanOrEqual(
          Math.round(lowerLimit * 100) / 100,
        );
        expect(after.currentPrice).toBeLessThanOrEqual(
          Math.round(upperLimit * 100) / 100,
        );
        expect(after.volume).toBeGreaterThan(before.volume);
      }

      previous = next;
    }
  });

  it("跨市场本地交易日后重置开高低、昨收和日成交量", async () => {
    let now = new Date("2026-07-27T19:59:00.000Z");
    const { engine, repository } = await createTestHarness({
      clock: () => now,
      random: () => 0.7,
    });
    for (let index = 0; index < 3; index += 1) {
      await engine.tick();
    }
    const before = repository.getQuote("us-aapl")!;

    now = new Date("2026-07-28T13:30:00.000Z");
    await engine.tick();
    const after = repository.getQuote("us-aapl")!;

    expect(after.previousClose).toBe(before.currentPrice);
    expect(after.openPrice).toBe(before.currentPrice);
    expect(after.highPrice).toBeGreaterThanOrEqual(after.openPrice);
    expect(after.lowPrice).toBeLessThanOrEqual(after.openPrice);
    expect(after.volume).toBeGreaterThan(0);
    expect(after.volume).toBeLessThan(before.volume);
  });

  it("成交量冲击会明显放大单 tick 涨跌幅", async () => {
    const { engine, repository } = await createTestHarness({
      random: () => 0.5,
    });
    const before = repository.getQuote("us-aapl")!;

    engine.recordTrade("us-aapl", "BUY", 1_000, "AI");
    const [after] = (await engine.tick()).filter(
      (quote) => quote.instrumentId === "us-aapl",
    );

    expect(after).toBeDefined();
    expect(after?.changePercent).toBeGreaterThan(0.15);
    expect(after?.volume).toBeGreaterThan(before.volume + 1_000);
  });
});
