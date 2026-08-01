import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { createApplication } from "../src/application.js";
import { migrateDatabase } from "../src/db/migrations.js";
import * as schema from "../src/db/schema.js";
import { migrateRealDatabase } from "../src/real-market/db/migrations.js";
import { runStorageMaintenance } from "../src/runtime/StorageMaintenance.js";

const openClients: PGlite[] = [];

afterEach(async () => {
  while (openClients.length > 0) {
    await openClients.pop()?.close();
  }
});

describe("StorageMaintenance", () => {
  it("清理虚拟盘中过期会话、旧 AI 成交和过期分钟线", async () => {
    const client = new PGlite();
    openClients.push(client);
    await client.waitReady;
    await migrateDatabase(client);

    const now = "2026-07-29T12:00:00.000Z";
    const userAccountId = randomUUID();
    const userPortfolioId = randomUUID();
    const aiPortfolioId = randomUUID();
    const aiTraderId = randomUUID();
    const instrumentId = "us-aapl";
    const importBatchId = randomUUID();

    await client.exec(`
      INSERT INTO accounts (
        id, username, username_normalized, password_hash, display_name
      ) VALUES (
        '${userAccountId}', 'user1', 'user1', 'hash', '用户一'
      );
      INSERT INTO portfolios (
        id, account_id, name, mode, active_currency,
        initial_cash_usd, available_cash_usd, frozen_cash_usd
      ) VALUES
        ('${userPortfolioId}', '${userAccountId}', '用户组合', 'VIRTUAL', 'USD', 1000, 1000, 0),
        ('${aiPortfolioId}', NULL, 'AI组合', 'VIRTUAL', 'USD', 1000, 1000, 0);
      INSERT INTO ai_traders (
        id, portfolio_id, name, strategy, psychology, risk_level,
        activity_level, preferred_market, trader_kind, persona_key,
        is_active, next_action_at
      ) VALUES (
        '${aiTraderId}', '${aiPortfolioId}', 'LLM 测试员', 'MOMENTUM',
        '测试', 5, 5, 'US', 'LLM', 'maintenance-test', true,
        '2026-07-29T12:00:00.000Z'
      );
      INSERT INTO ai_trader_decisions (
        id, trader_id, decided_at, action, result, model_id
      ) VALUES
        ('${randomUUID()}', '${aiTraderId}', '2026-06-01T00:00:00.000Z', 'HOLD', 'HOLD', 'test-model'),
        ('${randomUUID()}', '${aiTraderId}', '2026-07-29T00:00:00.000Z', 'HOLD', 'HOLD', 'test-model');
      INSERT INTO market_import_batches (
        id, source, source_host, source_fetched_at, selection,
        requested_per_market, instrument_count, market_counts,
        fx_rates, snapshot_sha256
      ) VALUES (
        '${importBatchId}', 'test', 'localhost', '2026-07-29T00:00:00.000Z', 'FULL',
        1, 1, '{"US":1}',
        '{"asOf":"2026-07-29T00:00:00.000Z","source":"test","HKD_CNY":1,"GBP_USD":1}',
        'sha256'
      );
      INSERT INTO market_import_batches (
        id, source, source_host, source_fetched_at, imported_at, selection,
        requested_per_market, instrument_count, market_counts,
        fx_rates, snapshot_sha256
      ) VALUES
      (
        '${randomUUID()}', 'test', 'localhost', '2026-06-01T00:00:00.000Z',
        '2026-06-01T00:00:00.000Z', 'FULL', 1, 0, '{"US":0}',
        '{"asOf":"2026-06-01T00:00:00.000Z","source":"test","HKD_CNY":1,"GBP_USD":1}',
        'old-orphan-sha'
      ),
      (
        '${randomUUID()}', 'test', 'localhost', '2026-07-29T00:00:00.000Z',
        '2026-07-29T00:00:00.000Z', 'FULL', 1, 0, '{"US":0}',
        '{"asOf":"2026-07-29T00:00:00.000Z","source":"test","HKD_CNY":1,"GBP_USD":1}',
        'recent-orphan-sha'
      );
      INSERT INTO instruments (
        id, symbol, name, market, source_currency, settlement_currency,
        type, industry, source_secid, source_price_unit, source_initial_price,
        source_previous_close, initial_price, lot_size, settlement_cycle,
        volatility, liquidity, import_batch_id, is_tradable
      ) VALUES (
        '${instrumentId}', 'AAPL', '苹果', 'US', 'USD', 'USD',
        'STOCK_VIRTUAL', '科技', '105.AAPL', 'USD', 100,
        100, 100, 1, 'T0',
        0.001, 1000, '${importBatchId}', true
      );
      INSERT INTO sessions (token_hash, account_id, expires_at, created_at) VALUES
        ('expired-session', '${userAccountId}', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z'),
        ('valid-session', '${userAccountId}', '2026-08-01T00:00:00.000Z', '2026-07-29T00:00:00.000Z');
      INSERT INTO candles (
        instrument_id, interval, bucket_start, open, high, low, close, volume,
        source, is_partial, updated_at
      ) VALUES
        ('${instrumentId}', 'MINUTE', '2026-07-20T09:30:00.000Z', 100, 101, 99, 100, 10, 'MARKET_TICK', false, '2026-07-20T09:30:00.000Z'),
        ('${instrumentId}', 'MINUTE', '2026-07-29T09:30:00.000Z', 100, 101, 99, 100, 10, 'MARKET_TICK', false, '2026-07-29T09:30:00.000Z'),
        ('${instrumentId}', 'DAY', '2026-07-20T00:00:00.000Z', 100, 101, 99, 100, 10, 'MARKET_TICK', false, '2026-07-20T00:00:00.000Z');
      INSERT INTO transactions (
        id, portfolio_id, instrument_id, currency, side, quantity, price,
        gross_amount, fee, net_amount, actor_type, created_at
      ) VALUES
        ('${randomUUID()}', '${aiPortfolioId}', '${instrumentId}', 'USD', 'BUY', 1, 100, 100, 1, 101, 'AI', '2026-06-01T00:00:00.000Z'),
        ('${randomUUID()}', '${aiPortfolioId}', '${instrumentId}', 'USD', 'BUY', 1, 100, 100, 1, 101, 'AI', '2026-07-29T00:00:00.000Z'),
        ('${randomUUID()}', '${userPortfolioId}', '${instrumentId}', 'USD', 'BUY', 1, 100, 100, 1, 101, 'USER', '2026-06-01T00:00:00.000Z');
      INSERT INTO position_settlement_lots (
        id, portfolio_id, instrument_id, quantity, unlock_at, settled_at, source_transaction_id, created_at
      )
      SELECT '${randomUUID()}', '${aiPortfolioId}', '${instrumentId}', 1, '2026-06-01T00:00:00.000Z', '2026-06-02T00:00:00.000Z', id, '2026-06-01T00:00:00.000Z'
      FROM transactions
      WHERE actor_type = 'AI'
      ORDER BY created_at ASC
      LIMIT 1;
    `);

    const result = await runStorageMaintenance({
      virtualClient: client,
      now: new Date(now),
    });

    expect(result.virtual?.deletedExpiredSessions).toBe(1);
    expect(result.virtual?.deletedOldAiDecisions).toBe(1);
    expect(result.virtual?.deletedOldAiTransactions).toBe(1);
    expect(result.virtual?.deletedOldMinuteCandles).toBe(1);
    expect(result.virtual?.deletedSettledLots).toBe(1);
    expect(result.virtual?.deletedOldImportBatches).toBe(1);
    expect(result.virtual?.vacuumed).toBe(true);
    expect(result.virtual?.checkpointed).toBe(true);

    const sessions = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM sessions`,
    );
    const aiTransactions = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM transactions
        WHERE actor_type = 'AI'`,
    );
    const aiDecisions = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM ai_trader_decisions`,
    );
    const userTransactions = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM transactions
        WHERE actor_type = 'USER'`,
    );
    const minuteCandles = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM candles
        WHERE interval = 'MINUTE'`,
    );
    const importBatches = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM market_import_batches`,
    );

    expect(sessions.rows[0]?.count).toBe(1);
    expect(aiTransactions.rows[0]?.count).toBe(1);
    expect(aiDecisions.rows[0]?.count).toBe(1);
    expect(userTransactions.rows[0]?.count).toBe(1);
    expect(minuteCandles.rows[0]?.count).toBe(1);
    expect(importBatches.rows[0]?.count).toBe(2);
  });

  it("按展示窗口清理真实盘超量 K 线", async () => {
    const client = new PGlite();
    openClients.push(client);
    await client.waitReady;
    await migrateRealDatabase(client);

    await client.exec(`
      INSERT INTO real_instruments (
        id, provider_sec_id, symbol, name, market,
        source_currency, quote_currency, exchange_code, industry,
        lot_size, settlement_cycle, source_page, source_rank,
        source_updated_at, updated_at
      ) VALUES (
        'real-us-105-aapl', '105.AAPL', 'AAPL', '苹果', 'US',
        'USD', 'USD', '105', '科技',
        1, 'T0', 1, 0,
        '2026-07-29T12:00:00.000Z', '2026-07-29T12:00:00.000Z'
      );
    `);

    const minuteValues = Array.from({ length: 500 }, (_, index) => {
      const time = new Date(
        Date.UTC(2026, 6, 29, 0, index),
      ).toISOString();
      return `('real-us-105-aapl','MINUTE','${time}',100,101,99,100,10,'REAL_PROVIDER_HISTORY',false,'2026-07-29T12:00:00.000Z')`;
    }).join(",");
    const dayValues = Array.from({ length: 900 }, (_, index) => {
      const day = new Date(Date.UTC(2024, 0, 1 + index)).toISOString();
      return `('real-us-105-aapl','DAY','${day}',100,101,99,100,10,'REAL_PROVIDER_HISTORY',false,'2026-07-29T12:00:00.000Z')`;
    }).join(",");

    await client.exec(`
      INSERT INTO real_candles (
        instrument_id, interval, bucket_start, open, high, low, close,
        volume, source, is_partial, updated_at
      ) VALUES ${minuteValues}, ${dayValues};
      INSERT INTO real_sync_sweeps (
        id, started_at, completed_at, total_pages, completed_pages,
        failed_pages, instrument_rows, duration_ms, state
      ) VALUES
        ('sweep-old-1', '2026-06-01T00:00:00.000Z', '2026-06-01T00:10:00.000Z', 10, 10, 0, 500, 1000, 'COMPLETED'),
        ('sweep-old-2', '2026-06-15T00:00:00.000Z', '2026-06-15T00:10:00.000Z', 10, 9, 1, 450, 1000, 'DEGRADED'),
        ('sweep-recent', '2026-07-25T00:00:00.000Z', '2026-07-25T00:10:00.000Z', 10, 10, 0, 500, 1000, 'COMPLETED');
    `);

    const result = await runStorageMaintenance({
      realClient: client,
      now: new Date("2026-07-29T12:00:00.000Z"),
    });

    expect(result.real?.deletedMinuteCandles).toBe(110);
    expect(result.real?.deletedDayCandles).toBe(100);
    expect(result.real?.deletedOldSyncSweeps).toBe(2);
    expect(result.real?.vacuumed).toBe(true);
    expect(result.real?.checkpointed).toBe(true);

    const counts = await client.query<{
      interval: string;
      count: number;
    }>(
      `SELECT interval, count(*)::int AS count
         FROM real_candles
        GROUP BY interval
        ORDER BY interval`,
    );
    const sweeps = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM real_sync_sweeps`,
    );

    expect(counts.rows).toEqual([
      { interval: "DAY", count: 800 },
      { interval: "MINUTE", count: 390 },
    ]);
    expect(sweeps.rows[0]?.count).toBe(1);
  });

  it("应用启动时会自动执行一次存储瘦身", async () => {
    const client = new PGlite();
    openClients.push(client);
    await client.waitReady;
    await migrateDatabase(client);

    const accountId = randomUUID();
    await client.exec(`
      INSERT INTO accounts (
        id, username, username_normalized, password_hash, display_name
      ) VALUES (
        '${accountId}', 'user2', 'user2', 'hash', '用户二'
      );
      INSERT INTO sessions (token_hash, account_id, expires_at, created_at) VALUES
        ('expired-session', '${accountId}', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z');
    `);

    const realClient = new PGlite();
    openClients.push(realClient);
    await realClient.waitReady;
    await migrateRealDatabase(realClient);

    const context = await createApplication({
      databaseConnection: {
        client,
        db: drizzle({ client, schema }),
      },
      realDatabaseConnection: {
        client: realClient,
      },
      aiEnabled: false,
      realSyncEnabled: false,
      clock: () => new Date("2026-07-29T12:00:00.000Z"),
    });

    const sessions = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM sessions`,
    );

    await context.app.close();
    expect(sessions.rows[0]?.count).toBe(0);
  });
});
