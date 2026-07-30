import { describe, expect, it } from "vitest";
import {
  nextSettlementAt,
  settlementCycleForMarket,
} from "../src/domain/marketRules.js";

describe("market rules", () => {
  it("沪深为 T+1，港美英为 T+0", () => {
    expect(settlementCycleForMarket("CN")).toBe("T1");
    expect(settlementCycleForMarket("HK")).toBe("T0");
    expect(settlementCycleForMarket("US")).toBe("T0");
    expect(settlementCycleForMarket("UK")).toBe("T0");
  });

  it("周五买入的沪深持仓顺延到周一结算", () => {
    const unlockAt = nextSettlementAt(
      "CN",
      new Date("2026-07-31T07:00:00.000Z"),
    );

    expect(unlockAt?.toISOString()).toBe(
      "2026-08-02T16:00:00.000Z",
    );
  });

  it("跨春节买入顺延到交易所恢复开市日", () => {
    const unlockAt = nextSettlementAt(
      "CN",
      new Date("2026-02-13T07:00:00.000Z"),
    );

    expect(unlockAt?.toISOString()).toBe(
      "2026-02-23T16:00:00.000Z",
    );
  });
});
