import { describe, expect, it } from "vitest";
import {
  REAL_MARKET_CONFIG,
  recommendVirtualRuntimeProfile,
} from "../src/config.js";

describe("virtual runtime profile", () => {
  it("2核4G 机器会自动收敛 AI 负载", () => {
    const profile = recommendVirtualRuntimeProfile({
      cpuCount: 2,
      totalMemoryBytes: 4 * 1024 * 1024 * 1024,
    });

    expect(profile.aiTraderCount).toBeLessThan(3_000);
    expect(profile.aiActivePerRound).toBeLessThanOrEqual(64);
    expect(profile.aiRoundIntervalMs).toBeGreaterThanOrEqual(4_000);
  });
});

describe("real market runtime defaults", () => {
  it("全市场轮询采用低并发稳定档，自选热页仍保持秒级刷新", () => {
    expect(REAL_MARKET_CONFIG.concurrency).toBe(2);
    expect(REAL_MARKET_CONFIG.fullSweepTargetMs).toBe(60_000);
    expect(REAL_MARKET_CONFIG.hotRefreshIntervalMs).toBe(1_000);
    expect(REAL_MARKET_CONFIG.hotPagesPerRound).toBe(2);
  });
});
