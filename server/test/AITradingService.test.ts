import { describe, expect, it, vi } from "vitest";
import { AITradingService } from "../src/ai/AITradingService.js";
import { createTestHarness } from "./helpers.js";

describe("AITradingService", () => {
  it("创建完整策略人群并通过统一交易账本成交", async () => {
    let now = new Date("2026-07-27T12:00:00.000Z");
    const { repository, tradeService, engine } =
      await createTestHarness({
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

    expect(await service.ensurePopulation(14)).toBe(14);
    const updateTradersSpy = vi.spyOn(
      repository,
      "updateAITraders",
    );
    expect(service.getStatus().strategyCounts).toEqual({
      BALANCED: 2,
      MOMENTUM: 2,
      CONTRARIAN: 2,
      VALUE: 2,
      TECHNICAL: 2,
      CONSERVATIVE: 2,
      AGGRESSIVE: 2,
    });

    now = new Date("2026-07-27T12:02:00.000Z");
    const round = await service.runRound(14);

    expect(round.activeTraders).toBe(14);
    expect(round.trades).toBeGreaterThan(0);
    expect(service.getStatus().lifetimeTrades).toBe(round.trades);
    expect(service.getStatus().recentTradesPerMinute).toBe(
      round.trades,
    );
    expect(service.getStatus().lastRoundDurationMs).toBeGreaterThanOrEqual(
      0,
    );
    expect(updateTradersSpy).toHaveBeenCalledTimes(1);
    expect(updateTradersSpy.mock.calls[0]?.[0]).toHaveLength(14);
    expect(
      repository
        .listAITraders()
        .every(
          (trader) =>
            trader.lastActionAt === now.toISOString() &&
            new Date(trader.nextActionAt).getTime() >
              now.getTime(),
        ),
    ).toBe(true);
    expect(
      repository
        .listAITraders()
        .reduce(
          (total, trader) => total + trader.totalTrades,
          0,
        ),
    ).toBe(round.trades);
    expect(service.getStatus().dueBacklog).toBe(0);

    const traded = repository
      .listAITraders()
      .find(
        (trader) =>
          repository.listPositions(trader.portfolioId).length > 0,
      );
    expect(traded).toBeDefined();
    expect(
      repository.listTransactions(traded!.portfolioId),
    ).toHaveLength(0);

    const cnTrader = repository
      .listAITraders()
      .find(
        (trader) =>
          trader.preferredMarket === "CN" &&
          repository.listPositions(trader.portfolioId).length > 0,
      );
    expect(cnTrader).toBeDefined();
    expect(
      repository.listPositions(cnTrader!.portfolioId)[0],
    ).toMatchObject({
      availableQuantity: 0,
    });

    const totalFlow = repository
      .listInstruments()
      .reduce(
        (total, instrument) =>
          total + Math.abs(engine.getNetOrderFlow(instrument.id)),
        0,
      );
    expect(totalFlow).toBeGreaterThan(0);
    expect(service.getRanking(5)).toHaveLength(5);

    const profitableQuotes = repository
      .listAITraders()
      .filter((trader) => trader.preferredMarket !== "CN")
      .flatMap((trader) =>
        repository.listPositions(trader.portfolioId),
      )
      .map((position) => repository.getQuote(position.instrumentId))
      .filter((quote) => quote !== undefined)
      .map((quote) => ({
        ...quote,
        currentPrice: quote.currentPrice * 1.2,
        highPrice: quote.currentPrice * 1.2,
        changeAmount: quote.currentPrice * 0.2,
        changePercent: 20,
      }));
    await repository.saveQuotes(profitableQuotes);
    now = new Date("2026-07-27T12:20:00.000Z");
    const sellRound = await service.runRound(14);

    expect(sellRound.sellVolume).toBeGreaterThan(0);
    expect(
      repository.listTransactions(cnTrader!.portfolioId),
    ).toHaveLength(0);
  });
});
