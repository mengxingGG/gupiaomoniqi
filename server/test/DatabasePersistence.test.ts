import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AITradingService } from "../src/ai/AITradingService.js";
import { migrateDatabase } from "../src/db/migrations.js";
import * as schema from "../src/db/schema.js";
import { DatabaseGameRepository } from "../src/repositories/DatabaseGameRepository.js";
import { AuthService } from "../src/services/AuthService.js";
import { CandleService } from "../src/services/CandleService.js";
import { PortfolioService } from "../src/services/PortfolioService.js";
import { TradeService } from "../src/services/TradeService.js";

describe("DatabaseGameRepository", () => {
  it("并发奖励入账不会被使用旧快照的交易覆盖", async () => {
    const client = new PGlite();
    await client.waitReady;
    const connection = {
      client,
      db: drizzle({ client, schema }),
    };

    try {
      await migrateDatabase(client);
      await seedDatabase(client);
      const repository = await DatabaseGameRepository.create(connection);
      const clock = () => new Date("2026-07-27T12:00:00.000Z");
      const auth = await new AuthService(repository, clock).register({
        username: "cash_race_trader",
        displayName: "并发资金测试员",
        password: "ValidPass123",
      });
      const portfolioService = new PortfolioService(repository);
      const tradeService = new TradeService(
        repository,
        portfolioService,
        clock,
      );

      const originalCommitTrade = repository.commitTrade.bind(repository);
      let signalCommitStarted!: () => void;
      const commitStarted = new Promise<void>((resolve) => {
        signalCommitStarted = resolve;
      });
      let releaseCommit!: () => void;
      const commitGate = new Promise<void>((resolve) => {
        releaseCommit = resolve;
      });
      repository.commitTrade = async (commit) => {
        signalCommitStarted();
        await commitGate;
        await originalCommitTrade(commit);
      };

      const trade = tradeService.execute(auth.account.id, {
        instrumentId: "cn-600519",
        side: "BUY",
        quantity: 100,
      });
      await commitStarted;
      await repository.creditCashAdjustment(
        auth.account.id,
        "concurrent-reward-claim",
        100_000,
        "并发奖励回归",
      );
      releaseCommit();
      await trade;

      const portfolio = repository.getPortfolioByAccountId(
        auth.account.id,
      );
      expect(portfolio).toMatchObject({
        initialCashUsd: 1_100_000,
        availableCashUsd: 1_072_991.9,
      });
      const persisted = await client.query<{
        initial_cash_usd: number;
        available_cash_usd: number;
      }>(
        `SELECT initial_cash_usd::float8, available_cash_usd::float8
           FROM portfolios
          WHERE id = $1`,
        [portfolio!.id],
      );
      expect(persisted.rows[0]).toEqual({
        initial_cash_usd: 1_100_000,
        available_cash_usd: 1_072_991.9,
      });
    } finally {
      await client.close();
    }
  });

  it("在同一数据库事务中保存美元账本、持仓、成交和幂等键", async () => {
    const client = new PGlite();
    await client.waitReady;
    const connection = {
      client,
      db: drizzle({ client, schema }),
    };

    try {
      await migrateDatabase(client);
      await seedDatabase(client);

      const repository = await DatabaseGameRepository.create(connection);
      const candleService = new CandleService(repository, 0);
      await candleService.initialize();
      let now = new Date("2026-07-27T12:00:00.000Z");
      const clock = () => now;
      const authService = new AuthService(repository, clock);
      const auth = await authService.register({
        username: "database_trader",
        displayName: "数据库交易员",
        password: "ValidPass123",
      });
      const portfolioService = new PortfolioService(repository);
      const tradeService = new TradeService(
        repository,
        portfolioService,
        clock,
      );
      const request = {
        instrumentId: "cn-600519",
        side: "BUY" as const,
        quantity: 100,
        idempotencyKey: "database-buy-600519",
      };

      const first = await tradeService.execute(auth.account.id, request);
      const duplicate = await tradeService.execute(
        auth.account.id,
        request,
      );
      expect(duplicate.transaction.id).toBe(first.transaction.id);

      const reloaded = await DatabaseGameRepository.create(connection);
      expect(reloaded.listCandles("cn-600519", "DAY")).toHaveLength(1);
      expect(
        reloaded.listCandles("cn-600519", "DAY")[0],
      ).toMatchObject({
        source: "DATABASE_SNAPSHOT",
        open: 1890,
        close: 1890,
      });
      const portfolio = reloaded.getPortfolioByAccountId(auth.account.id);
      expect(portfolio?.availableCashUsd).toBe(972_991.9);
      expect(
        reloaded.getPosition(portfolio!.id, "cn-600519"),
      ).toMatchObject({
        instrumentId: "cn-600519",
        quantity: 100,
        availableQuantity: 0,
        averageCostUsd: 270.081,
      });
      expect(reloaded.listTransactions(portfolio!.id)).toHaveLength(1);
      expect(reloaded.listTransactions(portfolio!.id)[0]).toMatchObject({
        instrumentId: "cn-600519",
        side: "BUY",
        quantity: 100,
        grossAmountUsd: 27_000,
        feeUsd: 8.1,
        netAmountUsd: 27_008.1,
        actorType: "USER",
        idempotencyKey: "database-buy-600519",
      });
      const settlementCount = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM position_settlement_lots
          WHERE portfolio_id = $1
            AND settled_at IS NULL`,
        [portfolio!.id],
      );
      expect(settlementCount.rows[0]?.count).toBe(1);

      now = new Date("2026-07-27T16:00:01.000Z");
      const reloadedTradeService = new TradeService(
        reloaded,
        new PortfolioService(reloaded),
        clock,
      );
      const concurrentSettlements = await Promise.all([
        reloaded.settleDuePositions(now.toISOString()),
        reloaded.settleDuePositions(now.toISOString()),
      ]);
      expect(
        concurrentSettlements
          .flat()
          .reduce((sum, item) => sum + item.quantity, 0),
      ).toBe(100);
      expect(
        reloaded.getPosition(portfolio!.id, "cn-600519"),
      ).toMatchObject({
        availableQuantity: 100,
      });
      await reloadedTradeService.settleDuePositions(now);
      expect(
        reloaded.getPosition(portfolio!.id, "cn-600519"),
      ).toMatchObject({ availableQuantity: 100 });
    } finally {
      await client.close();
    }
  });

  it("AI 成交会更新持仓与市场状态，但不落交易流水", async () => {
    const client = new PGlite();
    await client.waitReady;
    const connection = {
      client,
      db: drizzle({ client, schema }),
    };

    try {
      await migrateDatabase(client);
      await seedDatabase(client);

      const repository = await DatabaseGameRepository.create(connection);
      const candleService = new CandleService(repository, 0);
      await candleService.initialize();
      let now = new Date("2026-07-27T12:00:00.000Z");
      const clock = () => now;
      const portfolioService = new PortfolioService(repository);
      const tradeService = new TradeService(
        repository,
        portfolioService,
        clock,
      );
      const aiService = new AITradingService(
        repository,
        tradeService,
        () => 0.1,
        clock,
        true,
      );
      const aiPortfolioId = randomUUID();
      const aiTraderId = randomUUID();

      await repository.createAITraders([
        {
          portfolio: {
            id: aiPortfolioId,
            accountId: null,
            mode: "VIRTUAL",
            initialCashUsd: 1_000_000,
            availableCashUsd: 1_000_000,
            frozenCashUsd: 0,
          },
          trader: {
            id: aiTraderId,
            portfolioId: aiPortfolioId,
            name: "测试 AI",
            strategy: "MOMENTUM",
            psychology: "趋势型",
            riskLevel: 8,
            activityLevel: 8,
            preferredMarket: "CN",
            isActive: true,
            lastActionAt: null,
            nextActionAt: "2026-07-27T11:59:00.000Z",
            totalTrades: 0,
            winCount: 0,
            lossCount: 0,
            createdAt: now.toISOString(),
          },
        },
      ]);

      const round = await aiService.runRound(1);
      expect(round.trades).toBeGreaterThan(0);

      const reloaded = await DatabaseGameRepository.create(connection);
      expect(reloaded.listTransactions(aiPortfolioId)).toHaveLength(0);
      const traderState = await client.query<{
        last_action_at: string | null;
        next_action_at: string;
        total_trades: number;
      }>(
        `SELECT last_action_at, next_action_at, total_trades
           FROM ai_traders
          WHERE id = $1`,
        [aiTraderId],
      );
      expect(traderState.rows[0]?.last_action_at).not.toBeNull();
      expect(
        new Date(
          traderState.rows[0]?.next_action_at ?? 0,
        ).getTime(),
      ).toBeGreaterThan(now.getTime());
      expect(traderState.rows[0]?.total_trades).toBe(round.trades);
      expect(reloaded.getAITrader(aiTraderId)).toMatchObject({
        lastActionAt: now.toISOString(),
        totalTrades: round.trades,
      });
      const aiPosition = reloaded.getPosition(
        aiPortfolioId,
        "cn-600519",
      );
      expect(aiPosition).toBeDefined();
      expect(aiPosition?.instrumentId).toBe("cn-600519");
      expect(aiPosition?.quantity ?? 0).toBeGreaterThan(0);
      expect(aiPosition?.availableQuantity).toBe(0);

      const settlementCount = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM position_settlement_lots
          WHERE portfolio_id = $1
            AND settled_at IS NULL`,
        [aiPortfolioId],
      );
      expect(settlementCount.rows[0]?.count).toBe(1);

      now = new Date("2026-07-27T16:00:01.000Z");
      await tradeService.settleDuePositions(now);
      const reloadedAfterSettle = await DatabaseGameRepository.create(
        connection,
      );
      expect(
        reloadedAfterSettle.getPosition(aiPortfolioId, "cn-600519"),
      ).toMatchObject({
        availableQuantity: aiPosition?.quantity,
      });
    } finally {
      await client.close();
    }
  });
});

async function seedDatabase(client: PGlite): Promise<void> {
  await client.exec(`
    INSERT INTO market_import_batches (
      id, source, source_host, source_fetched_at, selection,
      requested_per_market, instrument_count, market_counts, fx_rates,
      snapshot_sha256
    ) VALUES (
      '11111111-1111-4111-8111-111111111111',
      'test', 'test.local', '2026-07-27T00:00:00.000Z',
      'fixture', 1, 1, '{"CN":1}', '{}', 'fixture'
    );

    INSERT INTO instruments (
      id, symbol, name, market, type, industry, source_currency,
      settlement_currency, source_secid, source_price_unit,
      source_initial_price, source_previous_close, initial_price,
      lot_size, settlement_cycle, volatility, liquidity, import_batch_id
    ) VALUES (
      'cn-600519', '600519', '贵州茅台', 'CN', 'STOCK_VIRTUAL',
      '白酒', 'CNY', 'CNY', '1.600519', 'CNY',
      1890, 1890, 1890, 100, 'T1', 0.001, 1000,
      '11111111-1111-4111-8111-111111111111'
    );

    INSERT INTO quotes (
      instrument_id, current_price, previous_close, open_price,
      high_price, low_price, volume, change_amount, change_percent,
      updated_at
    ) VALUES (
      'cn-600519', 1890, 1890, 1890, 1890, 1890, 0, 0, 0,
      '2026-07-27T00:00:00.000Z'
    );
  `);
}
