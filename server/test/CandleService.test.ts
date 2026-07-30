import { describe, expect, it } from "vitest";
import { CandleService } from "../src/services/CandleService.js";
import { createTestHarness } from "./helpers.js";

describe("CandleService", () => {
  it("初始化时优先读取最新K线快照，避免全量扫描历史", async () => {
    const now = new Date("2026-07-27T12:00:10.000Z");
    const { repository, engine } = await createTestHarness({
      registerAccount: false,
      clock: () => now,
    });
    await engine.initialize();

    const optimizedRepository = {
      ...repository,
      listInstruments: repository.listInstruments.bind(repository),
      getInstrumentById: repository.getInstrumentById.bind(repository),
      listQuotes: () => {
        const quote = repository.getQuote("us-aapl");
        return quote ? [quote] : [];
      },
      getQuote: repository.getQuote.bind(repository),
      saveQuotes: repository.saveQuotes.bind(repository),
      upsertCandles: repository.upsertCandles.bind(repository),
      createAccount: repository.createAccount.bind(repository),
      getAccountById: repository.getAccountById.bind(repository),
      getAccountByUsername:
        repository.getAccountByUsername.bind(repository),
      updateLastLogin: repository.updateLastLogin.bind(repository),
      updateDisplayCurrency:
        repository.updateDisplayCurrency.bind(repository),
      createSession: repository.createSession.bind(repository),
      getSession: repository.getSession.bind(repository),
      deleteSession: repository.deleteSession.bind(repository),
      getPortfolioByAccountId:
        repository.getPortfolioByAccountId.bind(repository),
      getPortfolioById: repository.getPortfolioById.bind(repository),
      listPositions: repository.listPositions.bind(repository),
      getPosition: repository.getPosition.bind(repository),
      listTransactions: repository.listTransactions.bind(repository),
      getTransactionByIdempotencyKey:
        repository.getTransactionByIdempotencyKey.bind(repository),
      commitTrade: repository.commitTrade.bind(repository),
      settleDuePositions: repository.settleDuePositions.bind(repository),
      creditCashAdjustment:
        repository.creditCashAdjustment.bind(repository),
      listAITraders: repository.listAITraders.bind(repository),
      getAITrader: repository.getAITrader.bind(repository),
      getAITraderByPortfolioId:
        repository.getAITraderByPortfolioId.bind(repository),
      createAITraders: repository.createAITraders.bind(repository),
      updateAITrader: repository.updateAITrader.bind(repository),
      updateAITraders: repository.updateAITraders.bind(repository),
      getLatestCandle: (instrumentId, interval) => {
      if (instrumentId !== "us-aapl") {
        return undefined;
      }
      if (interval === "MINUTE") {
        return {
          instrumentId,
          interval,
          time: "2026-07-27T12:00:00.000Z",
          open: 100,
          high: 101,
          low: 99,
          close: 100.5,
          volume: 500,
          source: "DATABASE_RECORDED",
          isPartial: true,
          updatedAt: now.toISOString(),
        };
      }
      return {
        instrumentId,
        interval,
        time: "2026-07-27T00:00:00.000Z",
        open: 100,
        high: 102,
        low: 98,
        close: 100.5,
        volume: 1_200,
        source: "DATABASE_RECORDED",
        isPartial: true,
        updatedAt: now.toISOString(),
      };
      },
      listCandles: () => {
        throw new Error("SHOULD_NOT_SCAN_FULL_HISTORY");
      },
    };
    const fastRepository = optimizedRepository as typeof repository;

    const service = new CandleService(fastRepository);
    await service.initialize();
    fastRepository.listCandles = repository.listCandles.bind(repository);

    expect(
      service.getChart("us-aapl", "INTRADAY")?.candles.at(-1),
    ).toMatchObject({
      time: "2026-07-27T12:00:00.000Z",
      close: 100.5,
    });
    expect(service.getChart("us-aapl", "DAY")?.candles.at(-1)).toMatchObject(
      {
        time: "2026-07-27T00:00:00.000Z",
        close: 100.5,
      },
    );
  });

  it("只用数据库快照和实际 tick 生成可重载的 K 线", async () => {
    let now = new Date("2026-07-27T12:00:10.000Z");
    const { repository, engine } = await createTestHarness({
      registerAccount: false,
      random: () => 0.8,
      clock: () => now,
    });
    const service = new CandleService(repository, 0);
    await service.initialize();

    const initialDay = service.getChart("us-aapl", "DAY");
    expect(initialDay?.source).toBe("DATABASE_RECORDED");
    expect(initialDay?.candles).toHaveLength(1);
    expect(initialDay?.candles[0]).toMatchObject({
      source: "DATABASE_SNAPSHOT",
      isPartial: true,
    });

    now = new Date("2026-07-27T12:00:40.000Z");
    await service.recordQuotes(await engine.tick());
    const firstMinute = service.getChart("us-aapl", "INTRADAY");
    expect(firstMinute?.candles).toHaveLength(1);
    expect(firstMinute?.candles[0]).toMatchObject({
      source: "MARKET_TICK",
      isPartial: true,
    });
    expect(firstMinute!.candles[0]!.volume).toBeGreaterThan(0);

    now = new Date("2026-07-27T12:01:05.000Z");
    await service.recordQuotes(await engine.tick());
    await service.flush();

    const twoMinutes = service.getChart("us-aapl", "INTRADAY");
    expect(twoMinutes?.candles).toHaveLength(2);
    expect(twoMinutes?.candles[0]?.isPartial).toBe(false);
    expect(twoMinutes?.candles[1]?.isPartial).toBe(true);

    const reloaded = new CandleService(repository, 0);
    await reloaded.initialize();
    expect(
      reloaded.getChart("us-aapl", "INTRADAY")?.candles,
    ).toHaveLength(2);
    expect(reloaded.getChart("us-aapl", "MONTH")?.candles).toHaveLength(
      1,
    );
    expect(reloaded.getChart("us-aapl", "YEAR")?.candles).toHaveLength(
      1,
    );
  });
});
