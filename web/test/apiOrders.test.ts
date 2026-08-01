import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelOrder,
  fetchIndustries,
  fetchMarket,
  fetchOrders,
  submitOrder,
} from "../src/api.js";

describe("订单 API", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () =>
          JSON.stringify({
            token: "test-token",
            account: { displayCurrency: "USD" },
          }),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      dispatchEvent: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("提交限价单时携带模式、限价和幂等键", async () => {
    await submitOrder(
      {
        instrumentId: "CN:600000",
        side: "BUY",
        quantity: 100,
        orderMode: "LIMIT",
        limitPrice: 12.5,
        idempotencyKey: "request-12345678",
      },
      "VIRTUAL",
    );

    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/orders");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      mode: "VIRTUAL",
      instrumentId: "CN:600000",
      side: "BUY",
      quantity: 100,
      orderMode: "LIMIT",
      limitPrice: 12.5,
      idempotencyKey: "request-12345678",
    });
  });

  it("按模式和状态查询订单", async () => {
    await fetchOrders("REAL", "OPEN");

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/account/orders?mode=REAL&status=OPEN",
    );
  });

  it("旧服务器返回非 JSON 404 时仍保留状态码供页面降级", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("Not Found", { status: 404 }),
    );

    await expect(fetchOrders("VIRTUAL")).rejects.toMatchObject({
      status: 404,
      code: "INVALID_RESPONSE",
    });
  });

  it("撤单路径会安全编码订单编号", async () => {
    await cancelOrder("order/with space", "REAL");

    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/orders/order%2Fwith%20space?mode=REAL");
    expect(init.method).toBe("DELETE");
  });

  it("按市场读取行业汇总", async () => {
    await fetchIndustries("REAL", "HK");

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/industries?mode=REAL&market=HK",
    );
  });

  it("行情请求携带精确行业和涨跌幅排序", async () => {
    await fetchMarket({
      mode: "VIRTUAL",
      market: "CN",
      industry: "银行",
      page: 2,
      pageSize: 40,
      sortBy: "CHANGE_PERCENT",
      sortOrder: "ASC",
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/market?mode=VIRTUAL&page=2&pageSize=40&market=CN&industry=%E9%93%B6%E8%A1%8C&sortBy=CHANGE_PERCENT&sortOrder=ASC",
    );
  });
});
