import { describe, expect, it } from "vitest";
import {
  buildLLMDecisionPrompt,
  type LLMMarketCandidate,
  type LLMTradingContext,
} from "../src/ai/LLMMarketContext.js";
import { LLM_TRADER_PERSONAS } from "../src/ai/LLMPersonas.js";

describe("LLMMarketContext", () => {
  it("限制候选与 K 线数量并明确把行情视为不可信数据", () => {
    const prompt = buildLLMDecisionPrompt(
      LLM_TRADER_PERSONAS[0]!,
      contextWithCandidates(100),
      32_768,
    );
    const context = JSON.parse(prompt.user.split("\n").at(-1)!);

    expect(context.candidates.length).toBeGreaterThanOrEqual(24);
    expect(context.candidates.length).toBeLessThanOrEqual(40);
    expect(context.candidates[0].recentMinuteBars.length).toBeLessThanOrEqual(20);
    expect(context.candidates[12].recentMinuteBars).toBeUndefined();
    expect(prompt.system).toContain("不可信数据");
    expect(prompt.system).toContain("只输出一个严格 JSON");
    expect(prompt.user.length).toBeLessThan(64_000);
  });
});

function contextWithCandidates(count: number): LLMTradingContext {
  return {
    now: "2026-08-01T12:00:00.000Z",
    portfolio: {
      availableCashUsd: 10_000_000,
      frozenCashUsd: 0,
      totalAssetsUsd: 10_000_000,
      profitLossUsd: 0,
      profitLossPercent: 0,
    },
    positions: [],
    openOrders: [],
    marketOverview: { breadth: "balanced" },
    candidates: Array.from({ length: count }, (_, index) => candidate(index)),
    recentActivity: [],
    rules: { settlement: "CN T+1; others T+0" },
  };
}

function candidate(index: number): LLMMarketCandidate {
  const bars = Array.from({ length: 50 }, (_, bar) => ({
    time: new Date(Date.UTC(2026, 7, 1, 0, bar)).toISOString(),
    open: 100 + bar,
    high: 101 + bar,
    low: 99 + bar,
    close: 100.5 + bar,
    volume: 10_000 + bar,
  }));
  return {
    instrumentId: `us-${index}`,
    symbol: `T${index}`,
    name: `候选${index}`,
    market: "US",
    quoteCurrency: "USD",
    settlementCycle: "T0",
    lotSize: 1,
    currentPrice: 100,
    previousClose: 99,
    changePercent: 1.01,
    openPrice: 99.5,
    highPrice: 101,
    lowPrice: 98.5,
    volume: 100_000,
    liquidity: 10_000,
    volatility: 0.0017,
    indicators: { rsi14: 55, macd: 0.3 },
    orderBook: {
      bids: Array.from({ length: 10 }, (_, level) => ({
        price: 99.99 - level * 0.01,
        quantity: 1_000,
      })),
      asks: Array.from({ length: 10 }, (_, level) => ({
        price: 100.01 + level * 0.01,
        quantity: 1_000,
      })),
    },
    recentMinuteBars: bars,
    recentDailyBars: bars,
  };
}
