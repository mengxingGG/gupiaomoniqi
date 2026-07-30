import { describe, expect, it } from "vitest";
import { GAME_RULES } from "../src/config.js";
import { TradeError } from "../src/services/TradeService.js";
import { createTestHarness } from "./helpers.js";

describe("TradeService", () => {
  it("按统一美元账本买入人民币报价股票", async () => {
    const { accountId, tradeService } = await createTestHarness();
    expect(accountId).toBeDefined();

    const result = await tradeService.execute(accountId!, {
      instrumentId: "cn-600519",
      side: "BUY",
      quantity: 100,
      idempotencyKey: "buy-cn-600519-001",
    });

    expect(result.transaction.quotePrice).toBe(100);
    expect(result.transaction.quoteCurrency).toBe("CNY");
    expect(result.transaction.priceUsd).toBe(14.2857);
    expect(result.transaction.feeUsd).toBe(GAME_RULES.minimumFeeUsd);
    expect(result.portfolio.availableCashUsd).toBe(998_570.43);
    expect(result.portfolio.positions).toHaveLength(1);
    expect(result.portfolio.positions[0]).toMatchObject({
      quantity: 100,
      availableQuantity: 0,
      pendingSettlementQuantity: 100,
      averageCostUsd: 14.2957,
    });
    expect(result.transaction.actorType).toBe("USER");
  });

  it("沪深与美股共用同一份可用资金", async () => {
    const { accountId, tradeService } = await createTestHarness();

    const afterCn = await tradeService.execute(accountId!, {
      instrumentId: "cn-600519",
      side: "BUY",
      quantity: 100,
    });
    const afterUs = await tradeService.execute(accountId!, {
      instrumentId: "us-aapl",
      side: "BUY",
      quantity: 10,
    });

    expect(afterUs.portfolio.availableCashUsd).toBeLessThan(
      afterCn.portfolio.availableCashUsd,
    );
    expect(afterUs.portfolio.initialCashUsd).toBe(1_000_000);
    expect(afterUs.portfolio.positions).toHaveLength(2);
  });

  it("卖出后更新现金、持仓和已实现盈亏", async () => {
    const { accountId, repository, tradeService } =
      await createTestHarness();
    await tradeService.execute(accountId!, {
      instrumentId: "us-aapl",
      side: "BUY",
      quantity: 20,
    });

    const quote = repository.getQuote("us-aapl");
    expect(quote).toBeDefined();

    await repository.saveQuotes([
      {
        ...quote!,
        currentPrice: 125,
        highPrice: 125,
        changeAmount: 5,
        changePercent: 4.1667,
      },
    ]);

    const result = await tradeService.execute(accountId!, {
      instrumentId: "us-aapl",
      side: "SELL",
      quantity: 10,
    });
    const portfolio = repository.getPortfolioByAccountId(accountId!);

    expect(result.transaction.realizedProfitUsd).toBeGreaterThan(0);
    expect(result.portfolio.positions[0]?.quantity).toBe(10);
    expect(repository.listTransactions(portfolio!.id)).toHaveLength(2);
  });

  it("沪深 T+1 逐笔结算后才可卖，美股买入立即可卖", async () => {
    let now = new Date("2026-07-27T12:00:00.000Z");
    const { accountId, tradeService } = await createTestHarness({
      clock: () => now,
    });

    const cnBuy = await tradeService.execute(accountId!, {
      instrumentId: "cn-600519",
      side: "BUY",
      quantity: 100,
    });
    expect(cnBuy.portfolio.positions[0]).toMatchObject({
      quantity: 100,
      availableQuantity: 0,
      pendingSettlementQuantity: 100,
    });
    await expect(
      tradeService.execute(accountId!, {
        instrumentId: "cn-600519",
        side: "SELL",
        quantity: 100,
      }),
    ).rejects.toMatchObject({
      code: "INSUFFICIENT_POSITION",
    });

    now = new Date("2026-07-27T16:00:01.000Z");
    const settlements = await tradeService.settleDuePositions(now);
    expect(settlements).toEqual([
      expect.objectContaining({
        instrumentId: "cn-600519",
        quantity: 100,
      }),
    ]);

    const cnSell = await tradeService.execute(accountId!, {
      instrumentId: "cn-600519",
      side: "SELL",
      quantity: 100,
    });
    expect(
      cnSell.portfolio.positions.find(
        (position) => position.instrumentId === "cn-600519",
      ),
    ).toBeUndefined();

    const usBuy = await tradeService.execute(accountId!, {
      instrumentId: "us-aapl",
      side: "BUY",
      quantity: 1,
    });
    expect(usBuy.portfolio.positions[0]).toMatchObject({
      availableQuantity: 1,
      pendingSettlementQuantity: 0,
    });
  });

  it("相同幂等键不会重复扣款或重复建仓", async () => {
    const { accountId, tradeService } = await createTestHarness();
    const request = {
      instrumentId: "us-aapl",
      side: "BUY" as const,
      quantity: 10,
      idempotencyKey: "same-request-key",
    };
    const first = await tradeService.execute(accountId!, request);
    const second = await tradeService.execute(accountId!, request);

    expect(second.transaction.id).toBe(first.transaction.id);
    expect(second.portfolio.availableCashUsd).toBe(
      first.portfolio.availableCashUsd,
    );
    expect(second.portfolio.positions[0]?.quantity).toBe(10);
  });

  it("拒绝把同一幂等键复用于另一笔订单", async () => {
    const { accountId, tradeService } = await createTestHarness();
    await tradeService.execute(accountId!, {
      instrumentId: "us-aapl",
      side: "BUY",
      quantity: 1,
      idempotencyKey: "conflicting-request-key",
    });

    await expect(
      tradeService.execute(accountId!, {
        instrumentId: "us-aapl",
        side: "BUY",
        quantity: 2,
        idempotencyKey: "conflicting-request-key",
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<TradeError>>({
        code: "IDEMPOTENCY_KEY_REUSED",
      }),
    );
  });

  it.each([
    {
      request: {
        instrumentId: "cn-600519",
        side: "BUY" as const,
        quantity: 1,
      },
      code: "INVALID_QUANTITY",
    },
    {
      request: {
        instrumentId: "cn-600519",
        side: "BUY" as const,
        quantity: 100_000_000,
      },
      code: "INSUFFICIENT_CASH",
    },
    {
      request: {
        instrumentId: "cn-600519",
        side: "SELL" as const,
        quantity: 100,
      },
      code: "INSUFFICIENT_POSITION",
    },
  ])("拒绝非法交易：$code", async ({ request, code }) => {
    const { accountId, tradeService } = await createTestHarness();

    await expect(
      tradeService.execute(accountId!, request),
    ).rejects.toEqual(
      expect.objectContaining<Partial<TradeError>>({
        code,
      }),
    );
  });
});
