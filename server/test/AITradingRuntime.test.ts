import { afterEach, describe, expect, it, vi } from "vitest";
import { AITradingRuntime } from "../src/ai/AITradingRuntime.js";

describe("AITradingRuntime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("每轮都会读取最新的动态负载参数", async () => {
    vi.useFakeTimers();
    const rounds: number[] = [];
    let activePerRound = 96;
    let intervalMs = 1_000;
    const service = {
      runRound: vi.fn(async (maximumActive: number) => {
        rounds.push(maximumActive);
        return {
          activeTraders: maximumActive,
          trades: 0,
          buyVolume: 0,
          sellVolume: 0,
          completedAt: new Date().toISOString(),
          durationMs: 1,
        };
      }),
    };
    const runtime = new AITradingRuntime(
      service as never,
      intervalMs,
      activePerRound,
      () => ({
        activePerRound,
        intervalMs,
      }),
    );

    runtime.start();
    await vi.runOnlyPendingTimersAsync();
    activePerRound = 48;
    intervalMs = 2_000;
    await vi.advanceTimersByTimeAsync(2_000);
    runtime.stop();

    expect(rounds).toEqual([96, 48]);
  });
});
