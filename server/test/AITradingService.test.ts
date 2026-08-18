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
    const listInstrumentsSpy = vi.spyOn(repository, "listInstruments");

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
    expect(listInstrumentsSpy).toHaveBeenCalledTimes(1);
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
    listInstrumentsSpy.mockClear();
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
    expect(listInstrumentsSpy).not.toHaveBeenCalled();
    expect(
      repository.listTransactions(cnTrader!.portfolioId),
    ).toHaveLength(0);
  });

  it("长期 AI 会保存投资逻辑、在最短持有期内坚持有效观点，并在逻辑严重恶化时退出", async () => {
    let now = new Date("2026-08-18T00:00:00.000Z");
    let negative = false;
    let signalVersion = 1;
    const { repository, tradeService } = await createTestHarness({
      registerAccount: false,
      clock: () => now,
    });
    await repository.createAITraders([
      {
        portfolio: {
          id: "10000000-0000-4000-8000-000000000001",
          accountId: null,
          mode: "VIRTUAL",
          initialCashUsd: 1_000_000,
          availableCashUsd: 1_000_000,
          frozenCashUsd: 0,
        },
        trader: {
          id: "20000000-0000-4000-8000-000000000001",
          portfolioId: "10000000-0000-4000-8000-000000000001",
          name: "长期价值测试 AI",
          strategy: "VALUE",
          psychology: "耐心型",
          riskLevel: 5,
          activityLevel: 5,
          preferredMarket: "US",
          traderKind: "RULE",
          personaKey: null,
          isActive: true,
          lastActionAt: null,
          nextActionAt: now.toISOString(),
          totalTrades: 0,
          winCount: 0,
          lossCount: 0,
          createdAt: now.toISOString(),
        },
      },
    ]);
    const signalSource = {
      getMarketSignal(instrumentId: string) {
        const quote = repository.getQuote(instrumentId)!;
        const preferred = instrumentId === "us-aapl";
        const direction = negative && preferred ? -1 : preferred ? 1 : -0.2;
        return {
          instrumentId,
          fundamentalValue: quote.currentPrice * (1 + direction * 0.15),
          targetPrice: quote.currentPrice * (1 + direction * 0.15),
          fundamentalGap: direction * 0.15,
          expectedDailyReturn: direction * 0.02,
          marketDriftPerDay: direction * 0.002,
          sectorDriftPerDay: direction * 0.002,
          ownershipPremium: preferred ? 0.02 : 0,
          ownershipConcentration: 0.01,
          eventSentiment: negative && preferred ? -0.08 : 0,
          volatilityMultiplier: 1,
          qualityScore: preferred ? 0.9 : 0.4,
          growthScore: preferred ? 0.7 : 0,
          leverageRisk: preferred ? 0.2 : 0.6,
          signalVersion: String(signalVersion),
        };
      },
      getMarketSignalVersion: () => String(signalVersion),
    };
    const listQuotesSpy = vi.spyOn(repository, "listQuotes");
    const service = new AITradingService(
      repository,
      tradeService,
      () => 0.1,
      () => now,
      true,
      signalSource,
    );

    const entry = await service.runRound(1);
    expect(entry.buyVolume).toBeGreaterThan(0);
    expect(listQuotesSpy).toHaveBeenCalledTimes(1);
    expect(repository.getAITrader("20000000-0000-4000-8000-000000000001"))
      .toMatchObject({
        investmentHorizon: "LONG",
        thesisInstrumentId: "us-aapl",
        conviction: expect.any(Number),
        thesisStartedAt: now.toISOString(),
      });

    const initialQuantity = repository.getPosition(
      "10000000-0000-4000-8000-000000000001",
      "us-aapl",
    )!.quantity;
    now = new Date(now.getTime() + 24 * 60 * 60_000);
    const holdingRound = await service.runRound(1);
    expect(holdingRound.sellVolume).toBe(0);
    expect(listQuotesSpy).toHaveBeenCalledTimes(1);
    expect(
      repository.getPosition(
        "10000000-0000-4000-8000-000000000001",
        "us-aapl",
      )!.quantity,
    ).toBeGreaterThanOrEqual(initialQuantity);

    negative = true;
    signalVersion += 1;
    now = new Date(now.getTime() + 60 * 60_000);
    const exit = await service.runRound(1);
    expect(exit.sellVolume).toBeGreaterThan(0);
    expect(listQuotesSpy).toHaveBeenCalledTimes(2);
    expect(
      repository.getPosition(
        "10000000-0000-4000-8000-000000000001",
        "us-aapl",
      ),
    ).toBeUndefined();
  });
});
