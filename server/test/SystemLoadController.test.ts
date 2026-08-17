import { describe, expect, it } from "vitest";
import {
  SystemLoadController,
  type SystemLoadSample,
} from "../src/runtime/SystemLoadController.js";

describe("SystemLoadController", () => {
  it("仅有 AI 积压时不进入降载自锁", () => {
    const controller = new SystemLoadController(
      {
        aiStatus: () => null,
        realStatus: () => null,
      },
      {
        aiActivePerRound: 320,
        aiRoundIntervalMs: 1_000,
        realConcurrency: 2,
        realHotRefreshIntervalMs: 1_000,
        realHotPagesPerRound: 1,
        realFullSweepTargetMs: 300_000,
      },
      {
        metricsProvider: () => ({
          cpuPercent: 20,
          rssRatio: 0.3,
          heapRatio: 0.35,
          eventLoopLagMs: 8,
          aiBacklog: 4_500,
          realSweepPressure: 0.1,
          sampledAt: "2026-08-17T10:00:00.000Z",
        }),
      },
    );

    controller.sampleNow();
    expect(controller.getStatus().level).toBe("NORMAL");
    expect(controller.getAiSettings()).toEqual({
      activePerRound: 320,
      intervalMs: 1_000,
    });
  });

  it("高压时降低 AI 与真实行情负载，恢复后逐步回升", () => {
    const samples: SystemLoadSample[] = [
      {
        cpuPercent: 92,
        rssRatio: 0.88,
        heapRatio: 0.72,
        eventLoopLagMs: 160,
        aiBacklog: 300,
        realSweepPressure: 0.6,
        sampledAt: "2026-07-29T10:00:00.000Z",
      },
      {
        cpuPercent: 22,
        rssRatio: 0.45,
        heapRatio: 0.38,
        eventLoopLagMs: 8,
        aiBacklog: 0,
        realSweepPressure: 0.1,
        sampledAt: "2026-07-29T10:00:05.000Z",
      },
      {
        cpuPercent: 21,
        rssRatio: 0.44,
        heapRatio: 0.37,
        eventLoopLagMs: 7,
        aiBacklog: 0,
        realSweepPressure: 0.1,
        sampledAt: "2026-07-29T10:00:10.000Z",
      },
      {
        cpuPercent: 20,
        rssRatio: 0.43,
        heapRatio: 0.36,
        eventLoopLagMs: 6,
        aiBacklog: 0,
        realSweepPressure: 0.1,
        sampledAt: "2026-07-29T10:00:15.000Z",
      },
    ];
    const controller = new SystemLoadController(
      {
        aiStatus: () => null,
        realStatus: () => null,
      },
      {
        aiActivePerRound: 320,
        aiRoundIntervalMs: 1_000,
        realConcurrency: 12,
        realHotRefreshIntervalMs: 1_000,
        realHotPagesPerRound: 8,
        realFullSweepTargetMs: 10_000,
      },
      {
        reliefSamples: 3,
        metricsProvider: () => {
          const next = samples.shift();
          if (!next) {
            throw new Error("NO_SAMPLE");
          }
          return next;
        },
      },
    );

    controller.sampleNow();
    expect(controller.getStatus().level).toBe("CRITICAL");
    expect(controller.getAiSettings().activePerRound).toBeLessThan(160);
    expect(controller.getRealMarketSettings().concurrency).toBeLessThan(8);

    controller.sampleNow();
    controller.sampleNow();
    expect(controller.getStatus().level).toBe("CRITICAL");

    controller.sampleNow();
    expect(controller.getStatus().level).toBe("NORMAL");
    expect(controller.getAiSettings().activePerRound).toBe(320);
    expect(controller.getRealMarketSettings().concurrency).toBe(12);
  });
});
