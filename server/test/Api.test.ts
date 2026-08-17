import { afterEach, describe, expect, it } from "vitest";
import {
  createApplication,
  type ApplicationContext,
} from "../src/application.js";
import { createTestHarness, TEST_INSTRUMENTS } from "./helpers.js";

let context: ApplicationContext | undefined;

afterEach(async () => {
  if (context) {
    await context.app.close();
    context = undefined;
  }
});

describe("HTTP API", () => {
  it("限价委托 API 支持挂单、查询和撤单", async () => {
    const { repository } = await createTestHarness({
      registerAccount: false,
    });
    context = await createApplication({ repository });
    const registration = await context.app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        username: "limit_api_user",
        email: "limit_api_user@example.com",
        displayName: "限价用户",
        password: "ValidPass123",
      },
    });
    const authorization = {
      authorization: `Bearer ${registration.json().data.token as string}`,
    };
    const placed = await context.app.inject({
      method: "POST",
      url: "/api/orders",
      headers: authorization,
      payload: {
        mode: "VIRTUAL",
        instrumentId: "us-aapl",
        side: "BUY",
        quantity: 10,
        orderMode: "LIMIT",
        limitPrice: 110,
        idempotencyKey: "api-limit-order-001",
      },
    });
    expect(placed.statusCode).toBe(201);
    expect(placed.json().data.order.status).toBe("OPEN");
    expect(placed.json().data.transaction).toBeUndefined();

    const listed = await context.app.inject({
      method: "GET",
      url: "/api/account/orders?mode=VIRTUAL&status=OPEN",
      headers: authorization,
    });
    expect(listed.json().data).toHaveLength(1);
    const cancelled = await context.app.inject({
      method: "DELETE",
      url: `/api/orders/${placed.json().data.order.id}?mode=VIRTUAL`,
      headers: authorization,
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().data.order.status).toBe("CANCELLED");
    expect(cancelled.json().data.portfolio.frozenCashUsd).toBe(0);
  });

  it("行情与股票专业图表可匿名浏览，账户接口要求登录", async () => {
    const { repository } = await createTestHarness({
      registerAccount: false,
    });
    context = await createApplication({ repository });

    const marketResponse = await context.app.inject({
      method: "GET",
      url: "/api/market?pageSize=100",
    });
    const chartResponse = await context.app.inject({
      method: "GET",
      url: "/api/instruments/us-aapl/chart?range=DAY",
    });
    const orderBookResponse = await context.app.inject({
      method: "GET",
      url: "/api/instruments/us-aapl/order-book",
    });
    const accountResponse = await context.app.inject({
      method: "GET",
      url: "/api/account",
    });
    const aiStatusResponse = await context.app.inject({
      method: "GET",
      url: "/api/ai/status",
    });

    expect(marketResponse.statusCode).toBe(200);
    expect(marketResponse.json().data.items).toHaveLength(4);
    expect(chartResponse.statusCode).toBe(200);
    expect(chartResponse.json().data.candles).toHaveLength(1);
    expect(chartResponse.json().data.source).toBe(
      "DATABASE_RECORDED",
    );
    expect(chartResponse.json().data.candles[0].source).toBe(
      "DATABASE_SNAPSHOT",
    );
    expect(orderBookResponse.json().data.asks).toHaveLength(5);
    expect(orderBookResponse.json().data.bids).toHaveLength(5);
    expect(aiStatusResponse.statusCode).toBe(200);
    expect(aiStatusResponse.json().data.enabled).toBe(false);
    expect(accountResponse.statusCode).toBe(401);
    expect(TEST_INSTRUMENTS).toHaveLength(4);
    expect(marketResponse.json().data).toBeDefined();
    const healthResponse = await context.app.inject({
      method: "GET",
      url: "/api/health",
    });
    expect(healthResponse.statusCode).toBe(200);
    expect(healthResponse.json().data.loadControl).toBeDefined();
    expect(healthResponse.json().data.runtimeMemory).toMatchObject({
      heapUsedMb: expect.any(Number),
      heapLimitMb: expect.any(Number),
    });
  });

  it("行情支持行业目录、行业筛选且筛选发生在分页之前", async () => {
    const { repository } = await createTestHarness({
      registerAccount: false,
    });
    context = await createApplication({ repository });

    const directory = await context.app.inject({
      method: "GET",
      url: "/api/industries?mode=VIRTUAL",
    });
    const cnDirectory = await context.app.inject({
      method: "GET",
      url: "/api/industries?mode=VIRTUAL&market=CN",
    });
    const filtered = await context.app.inject({
      method: "GET",
      url: "/api/market?mode=VIRTUAL&market=US&industry=%E7%A7%91%E6%8A%80&page=1&pageSize=1",
    });
    const searched = await context.app.inject({
      method: "GET",
      url: "/api/market?mode=VIRTUAL&search=%E7%A7%91%E6%8A%80&pageSize=100",
    });

    expect(directory.statusCode).toBe(200);
    expect(directory.json().data).toEqual(
      expect.arrayContaining([
        { industry: "白酒", count: 1 },
        { industry: "互联网", count: 1 },
        { industry: "科技", count: 1 },
        { industry: "银行", count: 1 },
      ]),
    );
    expect(cnDirectory.json().data).toEqual([
      { industry: "白酒", count: 1 },
    ]);
    expect(filtered.json().data).toMatchObject({ total: 1, page: 1, pageSize: 1 });
    expect(filtered.json().data.items[0].instrument).toMatchObject({
      symbol: "AAPL",
      industry: "科技",
    });
    expect(searched.json().data.total).toBe(1);
  });

  it("注册后获得 100 万美元并通过统一账户完成交易", async () => {
    const { repository } = await createTestHarness({
      registerAccount: false,
    });
    context = await createApplication({ repository });

    const registerResponse = await context.app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        username: "api_trader",
        email: "api_trader@example.com",
        displayName: "接口交易员",
        password: "ValidPass123",
      },
    });
    expect(registerResponse.statusCode).toBe(201);
    const token = registerResponse.json().data.token as string;
    const authorization = { authorization: `Bearer ${token}` };

    const accountBefore = await context.app.inject({
      method: "GET",
      url: "/api/account",
      headers: authorization,
    });
    const tradeResponse = await context.app.inject({
      method: "POST",
      url: "/api/trades",
      headers: authorization,
      payload: {
        instrumentId: "us-aapl",
        side: "BUY",
        quantity: 10,
        idempotencyKey: "api-buy-aapl-001",
      },
    });
    const currencyResponse = await context.app.inject({
      method: "PUT",
      url: "/api/account/display-currency",
      headers: authorization,
      payload: {
        currency: "CNY",
      },
    });
    const accountAfter = await context.app.inject({
      method: "GET",
      url: "/api/account",
      headers: authorization,
    });

    expect(accountBefore.json().data.initialCashUsd).toBe(1_000_000);
    expect(tradeResponse.statusCode).toBe(201);
    expect(tradeResponse.json().data.portfolio.positions[0].symbol).toBe(
      "AAPL",
    );
    expect(currencyResponse.json().data.displayCurrency).toBe("CNY");
    expect(accountAfter.json().data.displayCurrency).toBe("CNY");
    expect(accountAfter.json().data.availableCashUsd).toBeLessThan(
      1_000_000,
    );
  });

  it("API 默认返回安全响应头并仅允许白名单跨域来源", async () => {
    const { repository } = await createTestHarness({
      registerAccount: false,
    });
    context = await createApplication({ repository });

    const allowed = await context.app.inject({
      method: "GET",
      url: "/api/health",
      headers: {
        origin: "http://localhost:5173",
      },
    });
    const blocked = await context.app.inject({
      method: "GET",
      url: "/api/health",
      headers: {
        origin: "https://evil.example.com",
      },
    });

    expect(allowed.headers["x-content-type-options"]).toBe("nosniff");
    expect(allowed.headers["x-frame-options"]).toBe("DENY");
    expect(allowed.headers["referrer-policy"]).toBe("no-referrer");
    expect(allowed.headers["content-security-policy"]).toContain(
      "default-src 'none'",
    );
    expect(allowed.headers["access-control-allow-origin"]).toBe(
      "http://localhost:5173",
    );
    expect(blocked.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("相同接口幂等键只生成一条成交记录", async () => {
    const { repository } = await createTestHarness({
      registerAccount: false,
    });
    context = await createApplication({ repository });
    const registerResponse = await context.app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        username: "idempotent_trader",
        email: "idempotent_trader@example.com",
        displayName: "幂等交易员",
        password: "ValidPass123",
      },
    });
    const token = registerResponse.json().data.token as string;
    const request = {
      method: "POST" as const,
      url: "/api/trades",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        instrumentId: "us-aapl",
        side: "BUY",
        quantity: 1,
        idempotencyKey: "api-same-request",
      },
    };
    const first = await context.app.inject(request);
    const second = await context.app.inject(request);
    const transactions = await context.app.inject({
      method: "GET",
      url: "/api/account/transactions",
      headers: request.headers,
    });

    expect(second.json().data.transaction.id).toBe(
      first.json().data.transaction.id,
    );
    expect(transactions.json().data).toHaveLength(1);
  });

  it("虚拟盘支持按涨跌幅排序", async () => {
    const { repository } = await createTestHarness({
      registerAccount: false,
    });
    await repository.saveQuotes([
      {
        instrumentId: "cn-600519",
        symbol: "600519",
        market: "CN",
        quoteCurrency: "CNY",
        currentPrice: 99,
        previousClose: 100,
        openPrice: 100,
        highPrice: 101,
        lowPrice: 98,
        volume: 10_000,
        changeAmount: -1,
        changePercent: -1,
        updatedAt: "2026-07-27T12:00:00.000Z",
      },
      {
        instrumentId: "hk-00700",
        symbol: "00700",
        market: "HK",
        quoteCurrency: "CNY",
        currentPrice: 82.4,
        previousClose: 80,
        openPrice: 80.2,
        highPrice: 82.8,
        lowPrice: 79.8,
        volume: 12_000,
        changeAmount: 2.4,
        changePercent: 3,
        updatedAt: "2026-07-27T12:00:00.000Z",
      },
      {
        instrumentId: "us-aapl",
        symbol: "AAPL",
        market: "US",
        quoteCurrency: "USD",
        currentPrice: 132,
        previousClose: 120,
        openPrice: 121,
        highPrice: 133,
        lowPrice: 119,
        volume: 15_000,
        changeAmount: 12,
        changePercent: 10,
        updatedAt: "2026-07-27T12:00:00.000Z",
      },
      {
        instrumentId: "uk-hsba",
        symbol: "HSBA",
        market: "UK",
        quoteCurrency: "USD",
        currentPrice: 20.2,
        previousClose: 20,
        openPrice: 20,
        highPrice: 20.4,
        lowPrice: 19.9,
        volume: 9_000,
        changeAmount: 0.2,
        changePercent: 1,
        updatedAt: "2026-07-27T12:00:00.000Z",
      },
    ]);
    context = await createApplication({ repository });

    const response = await context.app.inject({
      method: "GET",
      url: "/api/market?mode=VIRTUAL&pageSize=100&sortBy=CHANGE_PERCENT&sortOrder=DESC",
    });

    expect(response.statusCode).toBe(200);
    expect(
      response.json().data.items.map((item: { instrument: { symbol: string } }) =>
        item.instrument.symbol
      ),
    ).toEqual(["AAPL", "00700", "HSBA", "600519"]);
  });
});
