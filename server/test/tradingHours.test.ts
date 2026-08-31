import { describe, expect, it } from "vitest";
import {
  isMarketTradingTime,
  isUkDaylightSaving,
  isUsDaylightSaving,
  quoteMaximumAgeMs,
} from "../src/real-market/tradingHours.js";

/** 北京时间 (UTC+8) 转 Date。 */
function beijingTime(
  y: number,
  m: number, // 1-based
  d: number,
  hh: number,
  mm: number,
): Date {
  return new Date(Date.UTC(y, m - 1, d, hh - 8, mm));
}

/** 美东时间 (EST=UTC-5 / EDT=UTC-4) 转 Date。 */
function easternTime(
  y: number,
  m: number,
  d: number,
  hh: number,
  mm: number,
  offsetHours: number,
): Date {
  return new Date(Date.UTC(y, m - 1, d, hh - offsetHours, mm));
}

/** 伦敦时间 (GMT=UTC+0 / BST=UTC+1) 转 Date。 */
function londonTime(
  y: number,
  m: number,
  d: number,
  hh: number,
  mm: number,
  offsetHours: number,
): Date {
  return new Date(Date.UTC(y, m - 1, d, hh - offsetHours, mm));
}

describe("isMarketTradingTime - CN（北京时间，固定 UTC+8）", () => {
  it("连续竞价时段为交易时段", () => {
    expect(isMarketTradingTime("CN", beijingTime(2026, 8, 31, 9, 30))).toBe(true);
    expect(isMarketTradingTime("CN", beijingTime(2026, 8, 31, 11, 0))).toBe(true);
    expect(isMarketTradingTime("CN", beijingTime(2026, 8, 31, 14, 59))).toBe(true);
  });

  it("集合竞价 9:15-9:25 为交易时段", () => {
    expect(isMarketTradingTime("CN", beijingTime(2026, 8, 31, 9, 15))).toBe(true);
    expect(isMarketTradingTime("CN", beijingTime(2026, 8, 31, 9, 20))).toBe(true);
  });

  it("盘前/午休/盘后为非交易时段", () => {
    expect(isMarketTradingTime("CN", beijingTime(2026, 8, 31, 7, 0))).toBe(false);
    expect(isMarketTradingTime("CN", beijingTime(2026, 8, 31, 12, 0))).toBe(false);
    expect(isMarketTradingTime("CN", beijingTime(2026, 8, 31, 15, 30))).toBe(false);
    expect(isMarketTradingTime("CN", beijingTime(2026, 8, 31, 22, 0))).toBe(false);
  });

  it("周末为非交易时段", () => {
    // 2026-08-30 是周日
    expect(isMarketTradingTime("CN", beijingTime(2026, 8, 30, 10, 0))).toBe(false);
    // 2026-08-29 是周六
    expect(isMarketTradingTime("CN", beijingTime(2026, 8, 29, 14, 0))).toBe(false);
  });

  it("边界：15:00 整点为非交易时段，8:59 为非交易时段", () => {
    expect(isMarketTradingTime("CN", beijingTime(2026, 8, 31, 15, 0))).toBe(false);
    expect(isMarketTradingTime("CN", beijingTime(2026, 8, 31, 8, 59))).toBe(false);
  });
});

describe("isMarketTradingTime - HK（北京时间，固定 UTC+8）", () => {
  it("上午/下午交易时段", () => {
    expect(isMarketTradingTime("HK", beijingTime(2026, 8, 31, 10, 0))).toBe(true);
    expect(isMarketTradingTime("HK", beijingTime(2026, 8, 31, 14, 30))).toBe(true);
  });

  it("午休 12:00-13:00 为非交易时段", () => {
    expect(isMarketTradingTime("HK", beijingTime(2026, 8, 31, 12, 30))).toBe(false);
  });

  it("盘前/盘后为非交易时段", () => {
    expect(isMarketTradingTime("HK", beijingTime(2026, 8, 31, 9, 0))).toBe(false);
    expect(isMarketTradingTime("HK", beijingTime(2026, 8, 31, 16, 30))).toBe(false);
  });
});

describe("isMarketTradingTime - US（美东，含夏令时）", () => {
  it("夏令时（EDT, UTC-4）7 月盘中为交易时段", () => {
    expect(isMarketTradingTime("US", easternTime(2026, 7, 15, 10, 0, -4))).toBe(true);
  });

  it("冬令时（EST, UTC-5）1 月盘中为交易时段", () => {
    expect(isMarketTradingTime("US", easternTime(2026, 1, 15, 10, 0, -5))).toBe(true);
  });

  it("美东盘前/盘后为非交易时段", () => {
    expect(isMarketTradingTime("US", easternTime(2026, 7, 15, 8, 0, -4))).toBe(false);
    expect(isMarketTradingTime("US", easternTime(2026, 1, 15, 17, 0, -5))).toBe(false);
  });

  it("周末为非交易时段", () => {
    // 2026-07-19 是周日
    expect(isMarketTradingTime("US", easternTime(2026, 7, 19, 12, 0, -4))).toBe(false);
  });

  it("夏令时判断：3 月第二个周日 02:00 切换", () => {
    // 2026-03-08 是 3 月第二个周日，02:00 EST 切换到 EDT
    expect(isUsDaylightSaving(new Date(Date.UTC(2026, 2, 8, 1, 59)))).toBe(false);
    expect(isUsDaylightSaving(new Date(Date.UTC(2026, 2, 8, 2, 0)))).toBe(true);
    // 11 月第一个周日 2026-11-01 02:00 EDT 切回 EST
    expect(isUsDaylightSaving(new Date(Date.UTC(2026, 10, 1, 1, 59)))).toBe(true);
    expect(isUsDaylightSaving(new Date(Date.UTC(2026, 10, 1, 2, 0)))).toBe(false);
  });
});

describe("isMarketTradingTime - UK（伦敦，含夏令时）", () => {
  it("夏令时（BST, UTC+1）7 月盘中为交易时段", () => {
    expect(isMarketTradingTime("UK", londonTime(2026, 7, 15, 10, 0, 1))).toBe(true);
  });

  it("冬令时（GMT, UTC+0）1 月盘中为交易时段", () => {
    expect(isMarketTradingTime("UK", londonTime(2026, 1, 15, 10, 0, 0))).toBe(true);
  });

  it("伦敦盘前/盘后为非交易时段", () => {
    expect(isMarketTradingTime("UK", londonTime(2026, 7, 15, 7, 0, 1))).toBe(false);
    expect(isMarketTradingTime("UK", londonTime(2026, 1, 15, 17, 0, 0))).toBe(false);
  });

  it("夏令时判断：3 月最后一个周日 01:00 UTC 切换", () => {
    // 2026-03-29 是 3 月最后一个周日
    expect(isUkDaylightSaving(new Date(Date.UTC(2026, 2, 29, 0, 59)))).toBe(false);
    expect(isUkDaylightSaving(new Date(Date.UTC(2026, 2, 29, 1, 0)))).toBe(true);
    // 10 月最后一个周日 2026-10-25 01:00 UTC 切回
    expect(isUkDaylightSaving(new Date(Date.UTC(2026, 9, 25, 0, 59)))).toBe(true);
    expect(isUkDaylightSaving(new Date(Date.UTC(2026, 9, 25, 1, 0)))).toBe(false);
  });
});

describe("quoteMaximumAgeMs", () => {
  const strict = 120_000;
  const offHours = 30 * 60_000;

  it("交易时段返回严格阈值", () => {
    expect(
      quoteMaximumAgeMs("CN", beijingTime(2026, 8, 31, 10, 0), strict, offHours),
    ).toBe(strict);
  });

  it("非交易时段返回宽松阈值", () => {
    expect(
      quoteMaximumAgeMs("CN", beijingTime(2026, 8, 31, 7, 0), strict, offHours),
    ).toBe(offHours);
    expect(
      quoteMaximumAgeMs("CN", beijingTime(2026, 8, 30, 10, 0), strict, offHours),
    ).toBe(offHours);
  });
});
