import { describe, expect, it } from "vitest";
import { maximumAffordableLots } from "@gupiaomoniqi/shared";

describe("percentage trade sizing", () => {
  it("按预算扣除最低手续费后计算最大整手数量", () => {
    expect(maximumAffordableLots(1_000, 100)).toBe(9);
    expect(maximumAffordableLots(101, 100)).toBe(1);
    expect(maximumAffordableLots(100, 100)).toBe(0);
  });

  it("大额交易按费率计算且不会超过预算", () => {
    const lots = maximumAffordableLots(1_000_000, 1_000);
    const gross = lots * 1_000;
    const fee = Math.max(1, gross * 0.0003);

    expect(gross + fee).toBeLessThanOrEqual(1_000_000);
    expect((lots + 1) * 1_000).toBeGreaterThan(1_000_000 - fee);
  });
});
