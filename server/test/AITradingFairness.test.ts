import { describe, expect, it, vi } from "vitest";
import { AITradingService } from "../src/ai/AITradingService.js";
import type { AITraderRecord } from "../src/repositories/GameRepository.js";
import { createTestHarness } from "./helpers.js";

describe("AITradingService 调度公平性", () => {
  it("启动时把 5000 个过期交易者均匀铺开，避免重启雷群", async () => {
    let now = new Date("2026-07-30T04:00:00.000Z");
    const traders = Array.from(
      { length: 5_000 },
      (_, index): AITraderRecord => ({
        id: `trader-${String(index).padStart(4, "0")}`,
        portfolioId: `portfolio-${index}`,
        name: `AI ${index}`,
        strategy: "BALANCED",
        psychology: "纪律型",
        riskLevel: 5,
        activityLevel: 5,
        preferredMarket: "US",
        isActive: true,
        lastActionAt: null,
        nextActionAt: "2026-07-29T04:00:00.000Z",
        totalTrades: 0,
        winCount: 0,
        lossCount: 0,
        createdAt: "2026-07-28T04:00:00.000Z",
      }),
    );
    const repository = {
      listAITraders: vi.fn(() => traders),
      createAITraders: vi.fn(),
    };
    const tradeService = {
      settleDuePositions: vi.fn(),
      executeAI: vi.fn(),
    };
    const service = new AITradingService(
      repository as never,
      tradeService as never,
      () => 0.5,
      () => now,
      true,
    );

    expect(await service.ensurePopulation(5_000)).toBe(5_000);
    expect(service.getStatus()).toMatchObject({
      population: 5_000,
      dueBacklog: 0,
    });
    expect(repository.createAITraders).not.toHaveBeenCalled();

    now = new Date(now.getTime() + 1_000);
    expect(service.getStatus().dueBacklog).toBe(1);
    await service.ensurePopulation(5_000);
    expect(service.getStatus().dueBacklog).toBe(1);

    now = new Date(now.getTime() + 30_000);
    expect(service.getStatus().dueBacklog).toBeGreaterThan(2_400);
    expect(service.getStatus().dueBacklog).toBeLessThan(2_600);
  });

  it("一轮只结算一次，并在交易者循环中让出宏任务", async () => {
    let now = new Date("2026-07-30T04:00:00.000Z");
    const { repository, tradeService } = await createTestHarness({
      registerAccount: false,
      clock: () => now,
    });
    const service = new AITradingService(
      repository,
      tradeService,
      () => 0.1,
      () => now,
      true,
    );
    await service.ensurePopulation(14);
    now = new Date(now.getTime() + 120_000);
    const settleSpy = vi.spyOn(
      tradeService,
      "settleDuePositions",
    );
    const executeSpy = vi.spyOn(tradeService, "executeAI");
    let macrotaskObserved = false;
    setImmediate(() => {
      macrotaskObserved = true;
    });

    const round = await service.runRound(14);

    expect(round.activeTraders).toBe(14);
    expect(round.trades).toBeGreaterThan(0);
    expect(settleSpy).toHaveBeenCalledTimes(1);
    expect(executeSpy).toHaveBeenCalled();
    expect(
      executeSpy.mock.calls.every(
        (call) => call[3]?.settleDuePositions === false,
      ),
    ).toBe(true);
    expect(macrotaskObserved).toBe(true);
  });
});
