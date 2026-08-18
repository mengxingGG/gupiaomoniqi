import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";
import { createApplication } from "../src/application.js";
import { migrateDatabase } from "../src/db/migrations.js";
import * as schema from "../src/db/schema.js";
import { DatabaseGameRepository } from "../src/repositories/DatabaseGameRepository.js";
import { MemoryGameRepository } from "../src/repositories/MemoryGameRepository.js";
import { MarketStateService } from "../src/virtual-market/MarketStateService.js";
import {
  DatabaseVirtualMarketStateStore,
  MemoryVirtualMarketStateStore,
} from "../src/virtual-market/MarketStateStore.js";
import { VirtualMarketEngine } from "../src/virtual-market/VirtualMarketEngine.js";
import { createTestHarness, TEST_INSTRUMENTS } from "./helpers.js";

describe("MarketStateService", () => {
  it("通过后端状态接口公开市场阶段与事件审计信息", async () => {
    const repository = new MemoryGameRepository(TEST_INSTRUMENTS);
    const context = await createApplication({
      repository,
      virtualMarketEventsEnabled: false,
    });
    try {
      const status = await context.app.inject({
        method: "GET",
        url: "/api/ai/market-state/status",
      });
      expect(status.statusCode).toBe(200);
      expect(status.json().data).toMatchObject({
        instrumentCount: TEST_INSTRUMENTS.length,
        totalEventCount: 0,
      });
      const events = await context.app.inject({
        method: "GET",
        url: "/api/ai/market-events?limit=20",
      });
      expect(events.statusCode).toBe(200);
      expect(events.json().data).toEqual([]);
    } finally {
      await context.app.close();
    }
  });

  it("长期价值与市场阶段在加速 20 日回放中形成个股趋势分化", async () => {
    let now = new Date("2026-08-18T00:00:00.000Z");
    const repository = new MemoryGameRepository(TEST_INSTRUMENTS);
    const marketState = new MarketStateService(
      repository,
      TEST_INSTRUMENTS,
      new MemoryVirtualMarketStateStore(),
      () => 0.5,
      () => now,
      false,
    );
    const engine = new VirtualMarketEngine(
      repository,
      TEST_INSTRUMENTS,
      () => 0.5,
      () => now,
      marketState,
    );
    await engine.initialize();
    const initial = new Map(
      repository.listQuotes().map((quote) => [
        quote.instrumentId,
        quote.currentPrice,
      ]),
    );

    for (let day = 1; day <= 20; day += 1) {
      now = new Date(now.getTime() + 24 * 60 * 60_000);
      await engine.tick();
    }

    const returns = repository.listQuotes().map((quote) =>
      quote.currentPrice / initial.get(quote.instrumentId)! - 1,
    );
    expect(Math.max(...returns) - Math.min(...returns)).toBeGreaterThan(0.025);
    expect(
      repository.listQuotes().every((quote) =>
        Number.isFinite(engine.getMarketSignal(quote.instrumentId)?.targetPrice),
      ),
    ).toBe(true);
  });

  it("事件逐步修改长期价值，短期情绪在结束后按半衰期消退", async () => {
    let now = new Date("2026-08-18T00:00:00.000Z");
    const repository = new MemoryGameRepository(TEST_INSTRUMENTS);
    const marketState = new MarketStateService(
      repository,
      TEST_INSTRUMENTS,
      new MemoryVirtualMarketStateStore(),
      () => 0.5,
      () => now,
      false,
    );
    const engine = new VirtualMarketEngine(
      repository,
      TEST_INSTRUMENTS,
      () => 0.5,
      () => now,
      marketState,
    );
    await engine.initialize();
    const before = engine.getMarketSignal("us-aapl")!;
    await engine.scheduleMarketEvent({
      kind: "PRODUCT_BREAKTHROUGH",
      scopeType: "INSTRUMENT",
      scopeKey: "us-aapl",
      headline: "模拟产品突破",
      fundamentalImpact: 0.08,
      sentimentImpact: 0.05,
      volatilityMultiplier: 1.4,
      durationMs: 2 * 24 * 60 * 60_000,
      decayHalfLifeMs: 2 * 24 * 60 * 60_000,
    });

    now = new Date(now.getTime() + 24 * 60 * 60_000);
    await engine.tick();
    const active = engine.getMarketSignal("us-aapl")!;
    expect(active.fundamentalValue).toBeGreaterThan(before.fundamentalValue);
    expect(active.eventSentiment).toBeCloseTo(0.025, 3);

    now = new Date(now.getTime() + 3 * 24 * 60 * 60_000);
    await engine.tick();
    const decayed = engine.getMarketSignal("us-aapl")!;
    expect(decayed.fundamentalValue).toBeGreaterThan(active.fundamentalValue);
    expect(decayed.eventSentiment).toBeCloseTo(0.025, 3);

    now = new Date(now.getTime() + 4 * 24 * 60 * 60_000);
    await engine.tick();
    expect(engine.getMarketSignal("us-aapl")!.eventSentiment).toBeLessThan(
      decayed.eventSentiment,
    );
  });

  it("巨量持仓同时产生即时冲击与随持有时间增强的所有权溢价", async () => {
    let now = new Date("2026-08-18T00:00:00.000Z");
    const { repository, engine, tradeService, accountId } =
      await createTestHarness({ clock: () => now });
    await repository.creditCashAdjustment(
      accountId!,
      "ownership-test-capital",
      100_000_000,
      "测试长期资金",
    );
    await tradeService.execute(accountId!, {
      instrumentId: "us-aapl",
      side: "BUY",
      quantity: 500_000,
      mode: "VIRTUAL",
    });
    now = new Date(now.getTime() + 61_000);
    await engine.tick();
    const initialPremium = engine.getMarketSignal("us-aapl")!.ownershipPremium;
    expect(initialPremium).toBeGreaterThan(0);

    now = new Date(now.getTime() + 10 * 24 * 60 * 60_000);
    await engine.tick();
    const maturePremium = engine.getMarketSignal("us-aapl")!.ownershipPremium;
    expect(maturePremium).toBeGreaterThan(initialPremium);
  });

  it("数据库存储可在服务重建后恢复基本状态、阶段与事件进度", async () => {
    const client = new PGlite();
    await client.waitReady;
    const connection = { client, db: drizzle({ client, schema }) };
    try {
      await migrateDatabase(client);
      await seedInstrument(client);
      const repository = await DatabaseGameRepository.create(connection);
      let now = new Date("2026-08-18T00:00:00.000Z");
      const service = new MarketStateService(
        repository,
        repository.listInstruments(),
        new DatabaseVirtualMarketStateStore(client),
        () => 0.5,
        () => now,
        false,
      );
      await service.initialize(repository.listQuotes());
      const event = await service.scheduleEvent({
        kind: "PERSISTENCE_TEST",
        scopeType: "INSTRUMENT",
        scopeKey: "cn-600519",
        headline: "持久化测试事件",
        fundamentalImpact: 0.04,
        sentimentImpact: 0.02,
        durationMs: 24 * 60 * 60_000,
        decayHalfLifeMs: 24 * 60 * 60_000,
      });
      now = new Date(now.getTime() + 12 * 60 * 60_000);
      await service.refresh(repository.listQuotes(), now);
      const before = service.getSignal("cn-600519", 1890)!;

      const restored = new MarketStateService(
        repository,
        repository.listInstruments(),
        new DatabaseVirtualMarketStateStore(client),
        () => 0.5,
        () => now,
        false,
      );
      await restored.initialize(repository.listQuotes());
      expect(
        restored.getSignal("cn-600519", 1890)?.fundamentalValue,
      ).toBeCloseTo(before.fundamentalValue, 7);
      expect(restored.listEvents()).toEqual([
        expect.objectContaining({ id: event.id, appliedFraction: 0.5 }),
      ]);
    } finally {
      await client.close();
    }
  });
});

async function seedInstrument(client: PGlite): Promise<void> {
  await client.exec(`
    INSERT INTO market_import_batches (
      id, source, source_host, source_fetched_at, selection,
      requested_per_market, instrument_count, market_counts, fx_rates,
      snapshot_sha256
    ) VALUES (
      '22222222-2222-4222-8222-222222222222',
      'test', 'test.local', '2026-08-18T00:00:00.000Z',
      'fixture', 1, 1, '{"CN":1}', '{}', 'market-state-fixture'
    );
    INSERT INTO instruments (
      id, symbol, name, market, type, industry, source_currency,
      settlement_currency, source_secid, source_price_unit,
      source_initial_price, source_previous_close, initial_price,
      lot_size, settlement_cycle, volatility, liquidity,
      circulating_market_cap, import_batch_id
    ) VALUES (
      'cn-600519', '600519', '贵州茅台', 'CN', 'STOCK_VIRTUAL',
      '白酒', 'CNY', 'CNY', '1.600519', 'CNY',
      1890, 1890, 1890, 100, 'T1', 0.001, 1000,
      1000000000000, '22222222-2222-4222-8222-222222222222'
    );
    INSERT INTO quotes (
      instrument_id, current_price, previous_close, open_price,
      high_price, low_price, volume, change_amount, change_percent,
      updated_at
    ) VALUES (
      'cn-600519', 1890, 1890, 1890, 1890, 1890, 0, 0, 0,
      '2026-08-18T00:00:00.000Z'
    );
  `);
}
