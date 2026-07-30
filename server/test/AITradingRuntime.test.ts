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

  it("启动后等待完整间隔再执行首轮，给 HTTP readiness 留出时间", async () => {
    vi.useFakeTimers();
    const service = {
      runRound: vi.fn(async () => null),
    };
    const runtime = new AITradingRuntime(
      service as never,
      1_000,
      32,
    );

    runtime.start();
    await vi.advanceTimersByTimeAsync(999);
    expect(service.runRound).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(service.runRound).toHaveBeenCalledTimes(1);
    runtime.stop();
  });

  it("无效动态参数不会退化成 0ms 调度", async () => {
    vi.useFakeTimers();
    const service = {
      runRound: vi.fn(async () => null),
    };
    const runtime = new AITradingRuntime(
      service as never,
      750,
      24,
      () => ({
        activePerRound: Number.NaN,
        intervalMs: Number.NaN,
      }),
    );

    runtime.start();
    await vi.advanceTimersByTimeAsync(749);
    expect(service.runRound).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(service.runRound).toHaveBeenCalledWith(24);
    runtime.stop();
  });
});
