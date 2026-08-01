import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelOrder,
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

  it("撤单路径会安全编码订单编号", async () => {
    await cancelOrder("order/with space", "REAL");

    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/orders/order%2Fwith%20space?mode=REAL");
    expect(init.method).toBe("DELETE");
  });
});
