import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApplication } from "../src/application.js";
import {
  EastmoneyProvider,
  type EastmoneyProviderOptions,
} from "../src/real-market/EastmoneyProvider.js";
import { RealMarketDetailService } from "../src/real-market/RealMarketDetailService.js";
import { migrateRealDatabase } from "../src/real-market/db/migrations.js";
import { RealMarketRepository } from "../src/real-market/RealMarketRepository.js";
import { RealMarketRuntime } from "../src/real-market/RealMarketRuntime.js";
import type {
  ProviderInstrumentSnapshot,
  ProviderPage,
} from "../src/real-market/types.js";
import { createTestHarness } from "./helpers.js";

const openClients: PGlite[] = [];

afterEach(async () => {
  while (openClients.length > 0) {
    await openClients.pop()?.close();
  }
});

describe("real market database migrations", () => {
  it("upgrades a legacy portfolio without losing cash or positions", async () => {
    const client = new PGlite();
    openClients.push(client);
    await client.waitReady;
    await client.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE real_instruments (
        id TEXT PRIMARY KEY,
        provider_sec_id TEXT NOT NULL UNIQUE,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        market TEXT NOT NULL CHECK (market IN ('CN', 'HK', 'US', 'UK')),
        source_currency TEXT NOT NULL
          CHECK (source_currency IN ('CNY', 'HKD', 'USD', 'GBP')),
        quote_currency TEXT NOT NULL CHECK (quote_currency IN ('CNY', 'USD')),
        exchange_code TEXT NOT NULL,
        industry TEXT NOT NULL DEFAULT '',
        lot_size INTEGER NOT NULL CHECK (lot_size > 0),
        settlement_cycle TEXT NOT NULL CHECK (settlement_cycle IN ('T0', 'T1')),
        is_tradable BOOLEAN NOT NULL DEFAULT true,
        is_active BOOLEAN NOT NULL DEFAULT true,
        source_page INTEGER NOT NULL CHECK (source_page > 0),
        source_rank INTEGER NOT NULL CHECK (source_rank >= 0),
        last_seen_sweep_id TEXT,
        source_updated_at TIMESTAMPTZ NOT NULL,
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE real_portfolios (
        id UUID PRIMARY KEY,
        account_id TEXT NOT NULL UNIQUE,
        initial_cash_usd DOUBLE PRECISION NOT NULL,
        available_cash_usd DOUBLE PRECISION NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE real_positions (
        id UUID PRIMARY KEY,
        portfolio_id UUID NOT NULL
          REFERENCES real_portfolios(id) ON DELETE CASCADE,
        instrument_id TEXT NOT NULL REFERENCES real_instruments(id),
        quantity INTEGER NOT NULL CHECK (quantity >= 0),
        available_quantity INTEGER NOT NULL CHECK (available_quantity >= 0),
        average_cost_usd DOUBLE PRECISION NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (portfolio_id, instrument_id)
      );

      INSERT INTO schema_migrations (version) VALUES (1), (2);
      INSERT INTO real_instruments (
        id, provider_sec_id, symbol, name, market, source_currency,
        quote_currency, exchange_code, lot_size, settlement_cycle,
        source_page, source_rank, source_updated_at
      ) VALUES (
        'legacy-aapl', '105.AAPL', 'AAPL', 'Apple', 'US', 'USD',
        'USD', '105', 1, 'T0', 1, 0, '2026-07-28T12:00:00.000Z'
      );
      INSERT INTO real_portfolios (
        id, account_id, initial_cash_usd, available_cash_usd
      ) VALUES (
        '11111111-1111-4111-8111-111111111111',
        'legacy-account', 1000000, 876543.21
      );
      INSERT INTO real_positions (
        id, portfolio_id, instrument_id, quantity,
        available_quantity, average_cost_usd
      ) VALUES (
        '22222222-2222-4222-8222-222222222222',
        '11111111-1111-4111-8111-111111111111',
        'legacy-aapl', 123, 120, 98.76
      );
    `);

    await migrateRealDatabase(client);
    await migrateRealDatabase(client);

    const upgraded = await client.query<{
      account_id: string;
      initial_cash_usd: number;
      available_cash_usd: number;
      frozen_cash_usd: number;
      quantity: number;
      available_quantity: number;
      frozen_quantity: number;
      average_cost_usd: number;
    }>(`
      SELECT portfolio.account_id,
             portfolio.initial_cash_usd,
             portfolio.available_cash_usd,
             portfolio.frozen_cash_usd,
             position.quantity,
             position.available_quantity,
             position.frozen_quantity,
             position.average_cost_usd
        FROM real_portfolios portfolio
        JOIN real_positions position
          ON position.portfolio_id = portfolio.id
       WHERE portfolio.account_id = 'legacy-account'
    `);
    expect(upgraded.rows).toEqual([
      {
        account_id: "legacy-account",
        initial_cash_usd: 1_000_000,
        available_cash_usd: 876_543.21,
        frozen_cash_usd: 0,
        quantity: 123,
        available_quantity: 120,
        frozen_quantity: 0,
        average_cost_usd: 98.76,
      },
    ]);

    const columns = await client.query<{
      table_name: string;
      column_name: string;
      is_nullable: string;
      column_default: string | null;
    }>(`
      SELECT table_name, column_name, is_nullable, column_default
        FROM information_schema.columns
       WHERE (table_name = 'real_portfolios'
              AND column_name = 'frozen_cash_usd')
          OR (table_name = 'real_positions'
              AND column_name = 'frozen_quantity')
       ORDER BY table_name, column_name
    `);
    expect(columns.rows).toHaveLength(2);
    expect(columns.rows.every((column) => column.is_nullable === "NO")).toBe(
      true,
    );
    expect(columns.rows.every((column) => column.column_default !== null)).toBe(
      true,
    );

    const versions = await client.query<{ version: number }>(
      `SELECT version FROM schema_migrations ORDER BY version`,
    );
    expect(versions.rows.map(({ version }) => version)).toEqual([1, 2, 3, 4]);
  });
});

describe("真实行情完整模块", () => {
  it("真实列表请求不携带 timil 参数，避免中间分页被打空", async () => {
    let requestedUrl: URL | null = null;
    const fetchImplementation = vi.fn(async (input: string | URL) => {
      requestedUrl = new URL(String(input));
      return Response.json({
        rc: 0,
        data: {
          total: 1,
          diff: [
            {
              f2: 10,
              f3: 1,
              f4: 0.1,
              f5: 100,
              f6: 1_000,
              f12: "600519",
              f13: 1,
              f14: "贵州茅台",
              f15: 10.5,
              f16: 9.8,
              f17: 10,
              f18: 9.9,
              f100: "白酒",
              f124: 1_785_235_200,
            },
          ],
        },
      });
    }) as unknown as typeof fetch;
    const provider = providerWith(fetchImplementation);

    await provider.fetchPage("CN", 7);

    expect(requestedUrl?.searchParams.get("pn")).toBe("7");
    expect(requestedUrl?.searchParams.has("timil")).toBe(false);
  });

  it("东方财富单页按 providerSecId 保留最低排名的首条快照", async () => {
    const fetchImplementation = vi.fn(async () =>
      Response.json({
        rc: 0,
        data: {
          total: 2,
          diff: [
            {
              f2: 100,
              f3: 2.04,
              f4: 2,
              f5: 10_000,
              f6: 1_000_000,
              f12: "600519",
              f13: 1,
              f14: "贵州茅台",
              f15: 101,
              f16: 97,
              f17: 99,
              f18: 98,
              f100: "白酒",
              f124: 1_785_235_200,
            },
            {
              f2: 999,
              f3: 919.39,
              f4: 901,
              f5: 20_000,
              f6: 2_000_000,
              f12: "600519",
              f13: 1,
              f14: "重复条目",
              f15: 999,
              f16: 97,
              f17: 99,
              f18: 98,
              f100: "白酒",
              f124: 1_785_235_200,
            },
          ],
        },
      }),
    ) as unknown as typeof fetch;
    const page = await providerWith(fetchImplementation).fetchPage(
      "CN",
      1,
    );

    expect(page.providerTotal).toBe(2);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.instrument.providerSecId).toBe("1.600519");
    expect(page.items[0]?.instrument.sourceRank).toBe(0);
    expect(page.items[0]?.quote?.currentPrice).toBe(100);
  });

  it("按接口 total 分页并正确归一化英国 GBX 行情", async () => {
    const fetchImplementation = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      expect(url.pathname).toContain("/webguest/api/qt/clist/get");
      return Response.json({
        rc: 0,
        data: {
          total: 8_622,
          diff: [
            {
              f2: 1_250,
              f3: 1.5,
              f4: 18,
              f5: 12_000,
              f6: 15_000_000,
              f12: "HSBA",
              f13: 155,
              f14: "HSBC HOLDINGS",
              f15: 1_270,
              f16: 1_220,
              f17: 1_230,
              f18: 1_232,
              f100: "Banks",
              f124: 1_785_235_200,
            },
          ],
        },
      });
    }) as unknown as typeof fetch;
    const provider = providerWith(fetchImplementation);
    const page = await provider.fetchPage("UK", 1);

    expect(page.providerTotal).toBe(8_622);
    expect(Math.ceil(page.providerTotal / page.pageSize)).toBe(4_311);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.instrument.sourceCurrency).toBe("GBP");
    expect(page.items[0]?.instrument.quoteCurrency).toBe("USD");
    expect(page.items[0]?.quote?.rawCurrentPrice).toBe(1_250);
    expect(page.items[0]?.quote?.currentPrice).toBeCloseTo(
      12.5 * (9.0268 / 6.7771),
      8,
    );
  });

  it("历史接口被远端断开时回退到兼容请求器", async () => {
    const fetchImplementation = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/api/qt/stock/kline/get")) {
        throw new TypeError("fetch failed");
      }
      return Response.json({ rc: 0, data: { total: 0, diff: [] } });
    }) as unknown as typeof fetch;
    const requestJsonFallback = vi.fn(async (url: string) => {
      expect(url).toContain("/api/qt/stock/kline/get");
      return {
        rc: 0,
        data: {
          klines: [
            "2026-07-28,100,101,103,99,2000,0,0,0,0,0",
            "2026-07-29,101,104,105,100,3000,0,0,0,0,0",
          ],
        },
      };
    });
    const provider = providerWith(fetchImplementation, {
      requestJsonFallback,
    });

    const candles = await provider.fetchHistory(
      {
        id: "real-us-105-aapl",
        providerSecId: "105.AAPL",
        symbol: "AAPL",
        name: "苹果",
        market: "US",
        sourceCurrency: "USD",
        quoteCurrency: "USD",
        type: "STOCK_REAL",
        industry: "科技",
        isTradable: true,
        lotSize: 1,
        settlementCycle: "T0",
        exchangeCode: "105",
        sourcePage: 1,
        sourceRank: 0,
        sourceUpdatedAt: "2026-07-29T10:00:00.000Z",
        isActive: true,
      },
      "DAY",
    );

    expect(requestJsonFallback).toHaveBeenCalledTimes(1);
    expect(candles).toHaveLength(2);
    expect(candles[0]?.source).toBe("REAL_PROVIDER_HISTORY");
    expect(candles[1]?.close).toBe(104);
  });

  it("历史接口兼容请求器遇到临时断链时会重试后再成功", async () => {
    const fetchImplementation = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/api/qt/stock/kline/get")) {
        throw new TypeError("fetch failed");
      }
      return Response.json({ rc: 0, data: { total: 0, diff: [] } });
    }) as unknown as typeof fetch;
    const requestJsonFallback = vi
      .fn<(_: string) => Promise<Record<string, unknown>>>()
      .mockRejectedValueOnce(
        new Error("Remote end closed connection without response"),
      )
      .mockResolvedValueOnce({
        rc: 0,
        data: {
          klines: [
            "2026-07-28,100,101,103,99,2000,0,0,0,0,0",
            "2026-07-29,101,104,105,100,3000,0,0,0,0,0",
          ],
        },
      });
    const provider = providerWith(fetchImplementation, {
      requestJsonFallback,
    });

    const candles = await provider.fetchHistory(
      {
        id: "real-hk-116-00700",
        providerSecId: "116.00700",
        symbol: "00700",
        name: "腾讯控股",
        market: "HK",
        sourceCurrency: "HKD",
        quoteCurrency: "CNY",
        type: "STOCK_REAL",
        industry: "科技",
        isTradable: true,
        lotSize: 100,
        settlementCycle: "T0",
        exchangeCode: "116",
        sourcePage: 1,
        sourceRank: 0,
        sourceUpdatedAt: "2026-07-29T10:00:00.000Z",
        isActive: true,
      },
      "DAY",
    );

    expect(requestJsonFallback).toHaveBeenCalledTimes(2);
    expect(candles).toHaveLength(2);
    expect(candles[1]?.source).toBe("REAL_PROVIDER_HISTORY");
  });

  it("真实图表历史请求只抓前端展示所需的窗口范围", async () => {
    const requestedUrls: URL[] = [];
    const fetchImplementation = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      requestedUrls.push(url);
      if (url.pathname.includes("/api/qt/stock/kline/get")) {
        return Response.json({
          rc: 0,
          data: {
            klines: [
              "2026-07-01,100,101,102,99,2000,0,0,0,0,0",
              "2026-07-29,101,104,105,100,3000,0,0,0,0,0",
            ],
          },
        });
      }
      return Response.json({
        rc: 0,
        data: {
          trends: [
            "2026-07-29 09:30,101,0,0,0,0,0,0",
            "2026-07-29 15:00,104,0,0,0,0,0,0",
          ],
        },
      });
    }) as unknown as typeof fetch;
    const provider = providerWith(fetchImplementation, {
      clock: () => new Date("2026-07-29T12:00:00.000Z"),
    });
    const instrument = providerPage("2026-07-29T12:00:00.000Z").items[0]!
      .instrument;

    await provider.fetchHistory(instrument, "DAY");
    await provider.fetchHistory(instrument, "MONTH");
    await provider.fetchHistory(instrument, "YEAR");
    await provider.fetchHistory(instrument, "INTRADAY");

    const [dayUrl, monthUrl, yearUrl, intradayUrl] = requestedUrls;
    expect(dayUrl?.searchParams.get("beg")).toBe("20260629");
    expect(dayUrl?.searchParams.get("klt")).toBe("101");
    expect(monthUrl?.searchParams.get("klt")).toBe("103");
    expect(yearUrl?.searchParams.get("klt")).toBe("106");
    expect(intradayUrl?.searchParams.get("ndays")).toBe("1");
  });

  it("分时接口会解析真实分钟 OHLC、成交量和均价线", async () => {
    const fetchImplementation = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/api/qt/stock/trends2/get")) {
        return Response.json({
          rc: 0,
          data: {
            trends: [
              "2026-07-29 09:30,46.50,46.50,46.50,46.50,82141,381957600.00,46.500",
              "2026-07-29 15:00,52.49,52.95,52.95,52.49,96813,512625632.00,49.666",
            ],
          },
        });
      }
      return Response.json({ rc: 0, data: { total: 0, diff: [] } });
    }) as unknown as typeof fetch;
    const provider = providerWith(fetchImplementation);

    const candles = await provider.fetchHistory(
      {
        id: "real-cn-1-601398",
        providerSecId: "1.601398",
        symbol: "601398",
        name: "工商银行",
        market: "CN",
        sourceCurrency: "CNY",
        quoteCurrency: "CNY",
        type: "STOCK_REAL",
        industry: "银行",
        isTradable: true,
        lotSize: 100,
        settlementCycle: "T1",
        exchangeCode: "1",
        sourcePage: 1,
        sourceRank: 0,
        sourceUpdatedAt: "2026-07-29T10:00:00.000Z",
        isActive: true,
      },
      "INTRADAY",
    );

    expect(candles).toHaveLength(2);
    expect(candles[1]?.open).toBeCloseTo(52.49, 8);
    expect(candles[1]?.close).toBeCloseTo(52.95, 8);
    expect(candles[1]?.high).toBeCloseTo(52.95, 8);
    expect(candles[1]?.low).toBeCloseTo(52.49, 8);
    expect(candles[1]?.volume).toBe(96_813);
    expect(candles[1]?.averagePrice).toBeCloseTo(49.666, 8);
  });

  it("真实盘口接口会映射东方财富五档买卖盘", async () => {
    const fetchImplementation = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/api/qt/stock/get")) {
        return Response.json({
          rc: 0,
          data: {
            f11: 46.45,
            f12: 288,
            f13: 46.46,
            f14: 132,
            f15: 46.47,
            f16: 56,
            f17: 46.48,
            f18: 897,
            f19: 46.49,
            f20: 1300,
            f31: 46.54,
            f32: 52,
            f33: 46.53,
            f34: 118,
            f35: 46.52,
            f36: 307,
            f37: 46.51,
            f38: 128,
            f39: 46.50,
            f40: 489,
            f86: 1785333600,
          },
        });
      }
      return Response.json({ rc: 0, data: { total: 0, diff: [] } });
    }) as unknown as typeof fetch;
    const provider = providerWith(fetchImplementation);
    const instrument = providerPage("2026-07-29T12:00:00.000Z").items[0]!
      .instrument;

    const orderBook = await provider.fetchOrderBook(instrument);

    expect(orderBook.asks).toHaveLength(5);
    expect(orderBook.bids).toHaveLength(5);
    expect(orderBook.asks[0]).toMatchObject({
      price: 46.54,
      quantity: 52,
    });
    expect(orderBook.asks[4]).toMatchObject({
      price: 46.5,
      quantity: 489,
    });
    expect(orderBook.bids[0]).toMatchObject({
      price: 46.49,
      quantity: 1300,
    });
    expect(orderBook.bids[4]).toMatchObject({
      price: 46.45,
      quantity: 288,
    });
  });

  it("全量目录、最新报价和真实 K 线写入独立数据库并可重载", async () => {
    const { client, repository } = await createRealRepository();
    const now = "2026-07-28T12:00:00.000Z";
    const page = providerPage(now);
    await repository.startSweep("sweep-1", now);
    await repository.upsertProviderPage(
      page,
      "sweep-1",
      new Set(["real-us-105-aapl"]),
    );
    await repository.completeSweep("sweep-1", {
      completedAt: now,
      totalPages: 1,
      completedPages: 1,
      failedPages: 0,
      instrumentRows: 1,
      durationMs: 300,
      successfulMarkets: new Set(["US"]),
    });

    expect(repository.instrumentCount).toBe(1);
    expect(repository.getMarketItem("real-us-105-aapl")?.quote.currentPrice)
      .toBe(100);
    const days = await repository.listCandles(
      "real-us-105-aapl",
      "DAY",
      10,
    );
    expect(days).toHaveLength(1);
    expect(days[0]?.source).toBe("REAL_PROVIDER_SNAPSHOT");

    const reloaded = await RealMarketRepository.create(client);
    expect(reloaded.instrumentCount).toBe(1);
    expect(reloaded.quotedInstrumentCount).toBe(1);
    expect(reloaded.getInstrumentById("real-us-105-aapl")?.type).toBe(
      "STOCK_REAL",
    );
  });

  it("仓储写入前按股票 ID 去重并保留最低排名的完整快照", async () => {
    const { client, repository } = await createRealRepository();
    const now = "2026-07-28T12:00:00.000Z";
    const page = providerPage(now);
    const retained = page.items[0]!;
    const duplicate: ProviderInstrumentSnapshot = {
      instrument: {
        ...retained.instrument,
        name: "重复条目",
        sourceRank: 99,
      },
      quote: retained.quote
        ? {
            ...retained.quote,
            currentPrice: 999,
            highPrice: 999,
            changeAmount: 901,
            changePercent: 919.387755,
            rawCurrentPrice: 999,
            rawHighPrice: 999,
          }
        : null,
    };
    page.items = [retained, duplicate];
    page.providerTotal = 2;

    await expect(
      repository.upsertProviderPage(page, "duplicate-page-test"),
    ).resolves.toBeUndefined();

    const stored = await client.query<{
      instrument_count: number;
      quote_count: number;
      candle_count: number;
      source_rank: number;
      current_price: number;
      candle_close: number;
      page_row_count: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM real_instruments
           WHERE id = $1) AS instrument_count,
         (SELECT count(*)::int FROM real_quotes
           WHERE instrument_id = $1) AS quote_count,
         (SELECT count(*)::int FROM real_candles
           WHERE instrument_id = $1) AS candle_count,
         (SELECT row_count FROM real_provider_pages
           WHERE market = 'US' AND page = 1 AND page_size = 100)
           AS page_row_count,
         i.source_rank,
         q.current_price,
         c.close AS candle_close
       FROM real_instruments i
       JOIN real_quotes q ON q.instrument_id = i.id
       JOIN real_candles c ON c.instrument_id = i.id
       WHERE i.id = $1`,
      [retained.instrument.id],
    );

    expect(stored.rows).toEqual([
      expect.objectContaining({
        instrument_count: 1,
        quote_count: 1,
        candle_count: 1,
        source_rank: retained.instrument.sourceRank,
        current_price: retained.quote?.currentPrice,
        candle_close: retained.quote?.currentPrice,
        page_row_count: 1,
      }),
    ]);
    expect(
      repository.getMarketItem(retained.instrument.id)?.quote.currentPrice,
    ).toBe(retained.quote?.currentPrice);
  });

  it("相同股票 ID 映射不同 providerSecId 时拒绝整页写入", async () => {
    const { client, repository } = await createRealRepository();
    const page = providerPage("2026-07-28T12:00:00.000Z");
    const retained = page.items[0]!;
    const collision: ProviderInstrumentSnapshot = {
      instrument: {
        ...retained.instrument,
        providerSecId: "106.AAPL",
        exchangeCode: "106",
        sourceRank: 1,
      },
      quote: retained.quote
        ? { ...retained.quote }
        : null,
    };
    page.items = [retained, collision];

    await expect(
      repository.upsertProviderPage(page, "identity-collision-test"),
    ).rejects.toThrow(
      /real-us-105-aapl.*105\.AAPL.*106\.AAPL/i,
    );

    const stored = await client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM real_instruments",
    );
    expect(stored.rows[0]?.count).toBe(0);
  });

  it("跨页股票 ID 碰撞时保留已存身份且不修改任何行情", async () => {
    const { client, repository } = await createRealRepository();
    const firstPage = providerPage("2026-07-28T12:00:00.000Z");
    await repository.upsertProviderPage(firstPage, "first-page");

    const collisionPage = providerPage(
      "2026-07-28T12:01:00.000Z",
    );
    const incoming = collisionPage.items[0]!;
    collisionPage.page = 2;
    collisionPage.items = [
      {
        instrument: {
          ...incoming.instrument,
          providerSecId: "106.AAPL",
          exchangeCode: "106",
          sourcePage: 2,
        },
        quote: incoming.quote
          ? {
              ...incoming.quote,
              currentPrice: 999,
              highPrice: 999,
              changeAmount: 901,
              changePercent: 919.387755,
              rawCurrentPrice: 999,
              rawHighPrice: 999,
            }
          : null,
      },
    ];

    await expect(
      repository.upsertProviderPage(
        collisionPage,
        "second-page-collision",
      ),
    ).rejects.toThrow(
      /real-us-105-aapl.*105\.AAPL.*106\.AAPL/i,
    );

    const stored = await client.query<{
      provider_sec_id: string;
      source_page: number;
      current_price: number;
      candle_close: number;
      page_count: number;
    }>(
      `SELECT
         i.provider_sec_id,
         i.source_page,
         q.current_price,
         c.close AS candle_close,
         (SELECT count(*)::int FROM real_provider_pages) AS page_count
       FROM real_instruments i
       JOIN real_quotes q ON q.instrument_id = i.id
       JOIN real_candles c ON c.instrument_id = i.id
       WHERE i.id = $1`,
      [incoming.instrument.id],
    );
    expect(stored.rows).toEqual([
      expect.objectContaining({
        provider_sec_id: "105.AAPL",
        source_page: 1,
        current_price: 100,
        candle_close: 100,
        page_count: 1,
      }),
    ]);
    expect(repository.getSourcePage(incoming.instrument.id)).toEqual({
      market: "US",
      page: 1,
    });
    expect(
      repository.getQuote(incoming.instrument.id)?.currentPrice,
    ).toBe(100);
  });

  it("同步器读取各市场 total 后遍历全部分页而不是固定 1200 只", async () => {
    const { repository } = await createRealRepository();
    const totals = { CN: 5, HK: 3, US: 1, UK: 4 } as const;
    const calls: string[] = [];
    const fakeProvider = {
      fetchPage: vi.fn(
        async (
          market: keyof typeof totals,
          page: number,
        ): Promise<ProviderPage> => {
          calls.push(`${market}:${page}`);
          return {
            market,
            page,
            pageSize: 2,
            providerTotal: totals[market],
            receivedAt: new Date().toISOString(),
            durationMs: 1,
            items: [],
          };
        },
      ),
      fetchHistory: vi.fn(async () => []),
    } as unknown as EastmoneyProvider;
    const runtime = new RealMarketRuntime(
      repository,
      fakeProvider,
      {
        enabled: true,
        pageSize: 2,
        concurrency: 2,
        fullSweepTargetMs: 10_000,
        hotRefreshIntervalMs: 1_000,
        hotPagesPerRound: 2,
        requestTimeoutMs: 2_000,
        quoteMaximumReceiveAgeMs: 120_000,
      },
    );
    await runtime.initialize();
    runtime.start();
    await waitUntil(
      () => runtime.getStatus().lastCompletedSweepAt !== null,
      5_000,
    );
    runtime.stop();
    await runtime.waitForStop();

    expect(new Set(calls)).toEqual(
      new Set([
        "CN:1",
        "CN:2",
        "CN:3",
        "HK:1",
        "HK:2",
        "US:1",
        "UK:1",
        "UK:2",
      ]),
    );
    expect(runtime.getStatus().markets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          market: "CN",
          providerTotal: 5,
          totalPages: 3,
          completedPages: 3,
        }),
      ]),
    );
  });

  it("详情、持仓、自选页按优先级领先于普通页刷新", async () => {
    const fetchOrder: string[] = [];
    const fakeRepository = {
      getPageStates: () => [],
      latestCompletedSweep: async () => null,
      startSweep: async () => undefined,
      upsertProviderPage: async () => undefined,
      completeSweep: async () => undefined,
      recordPageFailure: async () => undefined,
      getSourcePage: (instrumentId: string) =>
        ({
          "watch-id": { market: "CN", page: 2 },
          "held-id": { market: "CN", page: 3 },
          "detail-id": { market: "CN", page: 4 },
        })[instrumentId],
      listHeldInstrumentIds: async () => new Set(["held-id"]),
      countByMarket: () => 0,
      instrumentCount: 0,
      quotedInstrumentCount: 0,
    } as unknown as RealMarketRepository;
    const fakeProvider = {
      fetchPage: vi.fn(
        async (market: "CN" | "HK" | "US" | "UK", page: number) => {
          fetchOrder.push(`${market}:${page}`);
          return {
            market,
            page,
            pageSize: 2,
            providerTotal: market === "CN" ? 8 : 1,
            receivedAt: new Date().toISOString(),
            durationMs: 1,
            items: [],
          } satisfies ProviderPage;
        },
      ),
      fetchHistory: vi.fn(async () => []),
    } as unknown as EastmoneyProvider;
    const runtime = new RealMarketRuntime(
      fakeRepository,
      fakeProvider,
      {
        enabled: true,
        pageSize: 2,
        concurrency: 1,
        fullSweepTargetMs: 10_000,
        hotRefreshIntervalMs: 1_000,
        hotPagesPerRound: 2,
        requestTimeoutMs: 2_000,
        quoteMaximumReceiveAgeMs: 120_000,
      },
      async () => new Map([["watch-id", 10_000]]),
    );
    runtime.touchInstrument("detail-id", "DETAIL");

    await runtime.initialize();
    runtime.start();
    await waitUntil(
      () => runtime.getStatus().lastCompletedSweepAt !== null,
      5_000,
    );
    runtime.stop();
    await runtime.waitForStop();

    const firstHotDetailIndex = fetchOrder.indexOf("CN:4");
    const firstHeldIndex = fetchOrder.indexOf("CN:3");
    const firstNormalIndex = fetchOrder.indexOf("CN:2");

    expect(firstHotDetailIndex).toBeGreaterThanOrEqual(0);
    expect(firstHeldIndex).toBeGreaterThanOrEqual(0);
    expect(firstNormalIndex).toBeGreaterThanOrEqual(0);
    expect(firstHotDetailIndex).toBeLessThan(firstNormalIndex);
    expect(firstHeldIndex).toBeLessThan(firstNormalIndex);
  });

  it("真实图表只返回前端需要的日线、月线和年线长度", async () => {
    const { repository } = await createRealRepository();
    const page = providerPage("2026-07-29T12:00:00.000Z");
    await repository.upsertProviderPage(page, "detail-history-test");
    const instrument = page.items[0]!.instrument;
    const receivedAt = "2026-07-29T12:00:00.000Z";

    const dailyCandles = Array.from({ length: 800 }, (_, index) => {
      const date = new Date(Date.UTC(2024, 0, 1 + index));
      return {
        instrumentId: instrument.id,
        interval: "DAY" as const,
        time: date.toISOString(),
        open: 100 + index,
        high: 101 + index,
        low: 99 + index,
        close: 100.5 + index,
        volume: 1_000 + index,
        source: "REAL_PROVIDER_HISTORY" as const,
        isPartial: false,
        updatedAt: receivedAt,
      };
    });
    const monthlyCandles = Array.from({ length: 60 }, (_, index) => {
      const date = new Date(Date.UTC(2021, index, 1));
      return {
        instrumentId: instrument.id,
        interval: "MONTH" as const,
        time: date.toISOString(),
        open: 200 + index,
        high: 201 + index,
        low: 199 + index,
        close: 200.5 + index,
        volume: 5_000 + index,
        source: "REAL_PROVIDER_HISTORY" as const,
        isPartial: false,
        updatedAt: receivedAt,
      };
    });
    const yearlyCandles = Array.from({ length: 20 }, (_, index) => {
      const date = new Date(Date.UTC(2007 + index, 0, 1));
      return {
        instrumentId: instrument.id,
        interval: "YEAR" as const,
        time: date.toISOString(),
        open: 300 + index,
        high: 301 + index,
        low: 299 + index,
        close: 300.5 + index,
        volume: 10_000 + index,
        source: "REAL_PROVIDER_HISTORY" as const,
        isPartial: false,
        updatedAt: receivedAt,
      };
    });
    const minuteCandles = Array.from({ length: 600 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 6, 29, 0, index));
      return {
        instrumentId: instrument.id,
        interval: "MINUTE" as const,
        time: date.toISOString(),
        open: 100 + index / 100,
        high: 100.2 + index / 100,
        low: 99.8 + index / 100,
        close: 100.1 + index / 100,
        volume: 100 + index,
        source: "REAL_PROVIDER_HISTORY" as const,
        isPartial: false,
        updatedAt: receivedAt,
        averagePrice: 100.05 + index / 100,
      };
    });
    await repository.upsertCandles([
      ...dailyCandles,
      ...monthlyCandles,
      ...yearlyCandles,
      ...minuteCandles,
    ]);
    const service = new RealMarketDetailService(repository, {
      touchInstrument: vi.fn(),
      ensureHistory: vi.fn(async () => ({ updated: 0, error: null })),
    } as unknown as RealMarketRuntime);

    const day = await service.getChart(instrument.id, "DAY");
    const month = await service.getChart(instrument.id, "MONTH");
    const year = await service.getChart(instrument.id, "YEAR");
    const intraday = await service.getChart(instrument.id, "INTRADAY");

    expect(day?.candles).toHaveLength(30);
    expect(month?.candles).toHaveLength(60);
    expect(year?.candles).toHaveLength(20);
    expect(intraday?.candles).toHaveLength(390);
    expect(intraday?.candles.at(-1)?.averagePrice).toBeDefined();
  });

  it("真实盘口接口失败时明确返回不可用提示而不是假盘口", async () => {
    const { repository } = await createRealRepository();
    const page = providerPage("2026-07-29T12:00:00.000Z");
    await repository.upsertProviderPage(page, "detail-order-book-test");
    const service = new RealMarketDetailService(repository, {
      touchInstrument: vi.fn(),
      ensureHistory: vi.fn(async () => ({ updated: 0, error: null })),
      fetchOrderBook: vi.fn(async () => ({
        snapshot: null,
        error: "fetch failed",
      })),
    } as unknown as RealMarketRuntime);

    const orderBook = await service.getOrderBook(
      page.items[0]!.instrument.id,
    );

    expect(orderBook?.available).toBe(false);
    expect(orderBook?.asks).toHaveLength(0);
    expect(orderBook?.notice).toContain("真实盘口接口暂不可用");
    expect(orderBook?.notice).toContain("fetch failed");
  });

  it("历史接口失败时返回给前端的提示会收敛为短错误而不是整段 traceback", async () => {
    const { repository } = await createRealRepository();
    const page = providerPage("2026-07-29T12:00:00.000Z");
    const instrument = page.items[0]!.instrument;
    await repository.upsertProviderPage(page, "seed-sweep");
    const service = new RealMarketDetailService(repository, {
      touchInstrument: vi.fn(),
      ensureHistory: vi.fn(async () => ({
        updated: 0,
        error:
          "东方财富请求失败：fetch failed；兼容请求失败：Traceback (most recent call last):\\n" +
          '  File "<string>", line 31, in <module>\\n' +
          "http.client.RemoteDisconnected: Remote end closed connection without response\\n" +
          "Error in sys.excepthook:\\n" +
          "apport_python_hook.py",
      })),
    } as unknown as RealMarketRuntime);

    const chart = await service.getChart(instrument.id, "INTRADAY");

    expect(chart?.candles).toHaveLength(0);
    expect(chart?.notice).toContain("历史接口暂不可用");
    expect(chart?.notice).toContain("兼容请求失败：Remote end closed connection without response");
    expect(chart?.notice).not.toContain("Traceback");
    expect(chart?.notice).not.toContain("apport");
    expect(chart?.notice?.length ?? 0).toBeLessThan(220);
  });

  it("同一身份拥有两个隔离账本，真实价交易、签到和礼包码均幂等", async () => {
    const virtual = await createTestHarness({
      registerAccount: false,
      clock: () => new Date("2026-07-28T12:00:00.000Z"),
    });
    const { repository: realRepository } =
      await createRealRepository();
    await realRepository.upsertProviderPage(
      providerPage("2026-07-28T12:00:00.000Z"),
      "seed-sweep",
    );
    const context = await createApplication({
      repository: virtual.repository,
      realRepository,
      realSyncEnabled: false,
      aiEnabled: false,
      clock: () => new Date("2026-07-28T12:00:00.000Z"),
    });

    try {
      const registration = await context.app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          username: "real_market_trader",
          displayName: "真实行情测试员",
          password: "ValidPass123",
        },
      });
      const token = registration.json().data.token as string;
      const headers = { authorization: `Bearer ${token}` };

      const realBefore = await context.app.inject({
        method: "GET",
        url: "/api/account?mode=REAL",
        headers,
      });
      const virtualBefore = await context.app.inject({
        method: "GET",
        url: "/api/account?mode=VIRTUAL",
        headers,
      });
      expect(realBefore.json().data.initialCashUsd).toBe(1_000_000);
      expect(virtualBefore.json().data.initialCashUsd).toBe(1_000_000);

      const trade = await context.app.inject({
        method: "POST",
        url: "/api/trades",
        headers,
        payload: {
          mode: "REAL",
          instrumentId: "real-us-105-aapl",
          side: "BUY",
          quantity: 10,
          idempotencyKey: "real-aapl-buy-001",
        },
      });
      expect(trade.statusCode).toBe(201);
      expect(trade.json().data.portfolio.mode).toBe("REAL");
      expect(trade.json().data.portfolio.positions[0].quantity).toBe(10);

      const reusedTradeKey = await context.app.inject({
        method: "POST",
        url: "/api/orders",
        headers,
        payload: {
          mode: "REAL",
          instrumentId: "real-us-105-aapl",
          side: "BUY",
          quantity: 10,
          orderMode: "MARKET",
          idempotencyKey: "real-aapl-buy-001",
        },
      });
      expect(reusedTradeKey.statusCode).toBe(409);
      expect(reusedTradeKey.json().code).toBe(
        "IDEMPOTENCY_KEY_REUSED",
      );

      const checkIn = await context.app.inject({
        method: "POST",
        url: "/api/rewards/check-in",
        headers,
        payload: { mode: "REAL" },
      });
      expect(checkIn.statusCode).toBe(201);
      expect(checkIn.json().data.amountUsd).toBe(100_000);
      const duplicateCheckIn = await context.app.inject({
        method: "POST",
        url: "/api/rewards/check-in",
        headers,
        payload: { mode: "VIRTUAL" },
      });
      expect(duplicateCheckIn.statusCode).toBe(409);

      const gift = await context.app.inject({
        method: "POST",
        url: "/api/rewards/gift-code",
        headers,
        payload: {
          mode: "REAL",
          code: "666666",
          idempotencyKey: "gift-666666-request-1",
        },
      });
      expect(gift.statusCode).toBe(201);
      expect(gift.json().data.amountUsd).toBe(100_000);
      const duplicateGift = await context.app.inject({
        method: "POST",
        url: "/api/rewards/gift-code",
        headers,
        payload: {
          mode: "VIRTUAL",
          code: "666666",
          idempotencyKey: "gift-666666-request-2",
        },
      });
      expect(duplicateGift.statusCode).toBe(409);

      for (const requestKey of [
        "developer-gift-request-1",
        "developer-gift-request-2",
      ]) {
        const developerGift = await context.app.inject({
          method: "POST",
          url: "/api/rewards/gift-code",
          headers,
          payload: {
            mode: "REAL",
            code: "#1161125922",
            idempotencyKey: requestKey,
          },
        });
        expect(developerGift.statusCode).toBe(201);
        expect(developerGift.json().data.amountUsd).toBe(1_000_000);
      }

      const virtualAfter = await context.app.inject({
        method: "GET",
        url: "/api/account?mode=VIRTUAL",
        headers,
      });
      const realAfter = await context.app.inject({
        method: "GET",
        url: "/api/account?mode=REAL",
        headers,
      });
      expect(virtualAfter.json().data.initialCashUsd).toBe(1_000_000);
      expect(realAfter.json().data.initialCashUsd).toBe(3_200_000);
      expect(realAfter.json().data.availableCashUsd).toBeLessThan(
        3_200_000,
      );
    } finally {
      await context.app.close();
    }
  });

  it("真实行情限价单冻结资金并在新报价穿价后成交", async () => {
    const now = new Date("2026-07-28T12:00:00.000Z");
    const virtual = await createTestHarness({
      registerAccount: false,
      clock: () => now,
    });
    const { repository: realRepository } = await createRealRepository();
    await realRepository.upsertProviderPage(
      providerPage(now.toISOString()),
      "limit-seed",
    );
    const context = await createApplication({
      repository: virtual.repository,
      realRepository,
      realSyncEnabled: false,
      aiEnabled: false,
      clock: () => now,
    });
    try {
      const registration = await context.app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          username: "real_limit_trader",
          displayName: "真实限价测试员",
          password: "ValidPass123",
        },
      });
      const headers = {
        authorization: `Bearer ${registration.json().data.token as string}`,
      };
      const placed = await context.app.inject({
        method: "POST",
        url: "/api/orders",
        headers,
        payload: {
          mode: "REAL",
          instrumentId: "real-us-105-aapl",
          side: "BUY",
          quantity: 10,
          orderMode: "LIMIT",
          limitPrice: 90,
          idempotencyKey: "real-limit-buy-001",
        },
      });
      expect(placed.statusCode).toBe(201);
      expect(placed.json().data.order.status).toBe("OPEN");
      expect(placed.json().data.portfolio.frozenCashUsd).toBe(901);

      now.setMinutes(now.getMinutes() + 3);
      const retriedAfterQuoteExpired = await context.app.inject({
        method: "POST",
        url: "/api/orders",
        headers,
        payload: {
          mode: "REAL",
          instrumentId: "real-us-105-aapl",
          side: "BUY",
          quantity: 10,
          orderMode: "LIMIT",
          limitPrice: 90,
          idempotencyKey: "real-limit-buy-001",
        },
      });
      expect(retriedAfterQuoteExpired.statusCode).toBe(201);
      expect(retriedAfterQuoteExpired.json().data.order.id).toBe(
        placed.json().data.order.id,
      );

      const page = providerPage(now.toISOString());
      page.items[0]!.quote!.currentPrice = 85;
      page.items[0]!.quote!.lowPrice = 85;
      page.items[0]!.quote!.changeAmount = -13;
      page.items[0]!.quote!.changePercent = -13.265306;
      await realRepository.upsertProviderPage(page, "limit-cross");
      await expect(
        context.realTradingService.matchOpenOrders([
          "real-us-105-aapl",
        ]),
      ).resolves.toBe(1);

      const listed = await context.app.inject({
        method: "GET",
        url: "/api/account/orders?mode=REAL",
        headers,
      });
      const account = await context.app.inject({
        method: "GET",
        url: "/api/account?mode=REAL",
        headers,
      });
      expect(listed.json().data[0]).toMatchObject({
        status: "FILLED",
        filledQuantity: 10,
      });
      expect(account.json().data.frozenCashUsd).toBe(0);
      expect(account.json().data.availableCashUsd).toBe(999_149);
      expect(account.json().data.positions[0].quantity).toBe(10);
    } finally {
      await context.app.close();
    }
  });

  it("自选股按账户保存并进入真实行情最高优先级来源", async () => {
    const virtual = await createTestHarness({
      registerAccount: false,
    });
    const { repository: realRepository } =
      await createRealRepository();
    await realRepository.upsertProviderPage(
      providerPage(new Date().toISOString()),
      "seed-sweep",
    );
    const context = await createApplication({
      repository: virtual.repository,
      realRepository,
      realSyncEnabled: false,
      aiEnabled: false,
    });

    try {
      const registration = await context.app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          username: "watchlist_trader",
          displayName: "自选测试员",
          password: "ValidPass123",
        },
      });
      const headers = {
        authorization: `Bearer ${registration.json().data.token as string}`,
      };
      const added = await context.app.inject({
        method: "POST",
        url: "/api/watchlist",
        headers,
        payload: {
          mode: "REAL",
          instrumentId: "real-us-105-aapl",
        },
      });
      expect(added.statusCode).toBe(201);
      expect(added.json().data.instrumentIds).toEqual([
        "real-us-105-aapl",
      ]);
      const priorities =
        await context.accountFeatureStore.realWatchlistPriorities();
      expect(priorities.get("real-us-105-aapl")).toBeGreaterThan(0);
      const filtered = await context.app.inject({
        method: "GET",
        url: "/api/market?mode=REAL&watchlist=true",
        headers,
      });
      expect(filtered.json().data.items).toHaveLength(1);
    } finally {
      await context.app.close();
    }
  });

  it("真实盘支持按涨跌幅排序", async () => {
    const virtual = await createTestHarness({
      registerAccount: false,
    });
    const { repository: realRepository } =
      await createRealRepository();
    const receivedAt = new Date().toISOString();
    await realRepository.upsertProviderPage(
      {
        market: "US",
        page: 1,
        pageSize: 100,
        providerTotal: 3,
        receivedAt,
        durationMs: 10,
        items: [
          snapshotWithChange("real-us-105-aapl", "AAPL", 8, 1),
          snapshotWithChange("real-us-106-msft", "MSFT", -2, 2),
          snapshotWithChange("real-us-107-tsla", "TSLA", 3, 3),
        ],
      },
      "seed-sweep",
    );
    const context = await createApplication({
      repository: virtual.repository,
      realRepository,
      realSyncEnabled: false,
      aiEnabled: false,
    });

    try {
      const response = await context.app.inject({
        method: "GET",
        url: "/api/market?mode=REAL&pageSize=100&sortBy=CHANGE_PERCENT&sortOrder=DESC",
      });

      expect(response.statusCode).toBe(200);
      expect(
        response.json().data.items.map((item: { instrument: { symbol: string } }) =>
          item.instrument.symbol
        ),
      ).toEqual(["AAPL", "TSLA", "MSFT"]);
    } finally {
      await context.app.close();
    }
  });
});

function providerWith(
  fetchImplementation: typeof fetch,
  overrides: Partial<EastmoneyProviderOptions> = {},
): EastmoneyProvider {
  const options: EastmoneyProviderOptions = {
    pageSize: 2,
    requestTimeoutMs: 2_000,
    fetchImplementation,
    clock: () => new Date("2026-07-28T12:00:00.000Z"),
    ...overrides,
  };
  return new EastmoneyProvider(options);
}

async function createRealRepository() {
  const client = new PGlite();
  openClients.push(client);
  await client.waitReady;
  await migrateRealDatabase(client);
  return {
    client,
    repository: await RealMarketRepository.create(client),
  };
}

function providerPage(receivedAt: string): ProviderPage {
  const snapshot: ProviderInstrumentSnapshot = {
    instrument: {
      id: "real-us-105-aapl",
      providerSecId: "105.AAPL",
      symbol: "AAPL",
      name: "苹果",
      market: "US",
      sourceCurrency: "USD",
      quoteCurrency: "USD",
      type: "STOCK_REAL",
      industry: "科技",
      isTradable: true,
      lotSize: 1,
      settlementCycle: "T0",
      exchangeCode: "105",
      sourcePage: 1,
      sourceRank: 0,
      sourceUpdatedAt: receivedAt,
      isActive: true,
    },
    quote: {
      instrumentId: "real-us-105-aapl",
      symbol: "AAPL",
      market: "US",
      quoteCurrency: "USD",
      currentPrice: 100,
      previousClose: 98,
      openPrice: 99,
      highPrice: 101,
      lowPrice: 97,
      volume: 10_000,
      amount: 1_000_000,
      changeAmount: 2,
      changePercent: 2.040816,
      updatedAt: receivedAt,
      receivedAt,
      rawCurrentPrice: 100,
      rawPreviousClose: 98,
      rawOpenPrice: 99,
      rawHighPrice: 101,
      rawLowPrice: 97,
    },
  };
  return {
    market: "US",
    page: 1,
    pageSize: 100,
    providerTotal: 1,
    receivedAt,
    durationMs: 100,
    items: [snapshot],
  };
}

function snapshotWithChange(
  instrumentId: string,
  symbol: string,
  changePercent: number,
  sourceRank: number,
): ProviderInstrumentSnapshot {
  const previousClose = 100;
  const currentPrice = previousClose * (1 + changePercent / 100);
  return {
    instrument: {
      id: instrumentId,
      providerSecId: `105.${symbol}`,
      symbol,
      name: symbol,
      market: "US",
      sourceCurrency: "USD",
      quoteCurrency: "USD",
      type: "STOCK_REAL",
      industry: "科技",
      isTradable: true,
      lotSize: 1,
      settlementCycle: "T0",
      exchangeCode: "105",
      sourcePage: 1,
      sourceRank,
      sourceUpdatedAt: "2026-07-28T12:00:00.000Z",
      isActive: true,
    },
    quote: {
      instrumentId,
      symbol,
      market: "US",
      quoteCurrency: "USD",
      currentPrice,
      previousClose,
      openPrice: previousClose,
      highPrice: currentPrice,
      lowPrice: previousClose,
      volume: 10_000,
      amount: currentPrice * 10_000,
      changeAmount: currentPrice - previousClose,
      changePercent,
      updatedAt: "2026-07-28T12:00:00.000Z",
      receivedAt: "2026-07-28T12:00:00.000Z",
      rawCurrentPrice: currentPrice,
      rawPreviousClose: previousClose,
      rawOpenPrice: previousClose,
      rawHighPrice: currentPrice,
      rawLowPrice: previousClose,
    },
  };
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("WAIT_TIMEOUT");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
