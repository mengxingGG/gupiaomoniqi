import type { StockMarket } from "@gupiaomoniqi/shared";

/**
 * 真实市场交易时段判断。
 *
 * 目的：行情新鲜度校验在“价格活跃变化”的时段内保持严格，
 * 在盘前/盘后/午休/周末等非交易时段放宽，避免非热门股票
 * 因全量扫描周期（5 分钟）大于严格新鲜度窗口（2 分钟）而
 * 周期性无法交易。
 */

type WallTime = {
  dayOfWeek: number; // 0=Sunday .. 6=Saturday
  minutes: number; // 0..1439
  year: number;
  month: number; // 0-based
};

/** 把时刻转换为指定 UTC 偏移时区的墙上时间。 */
function wallTime(at: Date, utcOffsetMinutes: number): WallTime {
  const wall = new Date(at.getTime() + utcOffsetMinutes * 60_000);
  return {
    dayOfWeek: wall.getUTCDay(),
    minutes: wall.getUTCHours() * 60 + wall.getUTCMinutes(),
    year: wall.getUTCFullYear(),
    month: wall.getUTCMonth(),
  };
}

/** 某月第 n 个指定星期几的日期（1-based）。 */
function nthWeekdayOfMonth(
  year: number,
  month0: number,
  weekday: number,
  n: number,
): number {
  const first = new Date(Date.UTC(year, month0, 1));
  const firstWeekday = first.getUTCDay();
  const offset = (weekday - firstWeekday + 7) % 7;
  return 1 + offset + (n - 1) * 7;
}

/** 某月最后一个指定星期几的日期。 */
function lastWeekdayOfMonth(
  year: number,
  month0: number,
  weekday: number,
): number {
  const days = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const last = new Date(Date.UTC(year, month0, days));
  const lastWeekday = last.getUTCDay();
  const offset = (lastWeekday - weekday + 7) % 7;
  return days - offset;
}

/** 美国夏令时（EDT）：3 月第二个周日 02:00 至 11 月第一个周日 02:00。 */
export function isUsDaylightSaving(at: Date): boolean {
  const est = wallTime(at, -5 * 60);
  const start = Date.UTC(est.year, 2, nthWeekdayOfMonth(est.year, 2, 0, 2), 2);
  const end = Date.UTC(est.year, 10, nthWeekdayOfMonth(est.year, 10, 0, 1), 2);
  return at.getTime() >= start && at.getTime() < end;
}

/** 英国夏令时（BST）：3 月最后一个周日 01:00 UTC 至 10 月最后一个周日 01:00 UTC。 */
export function isUkDaylightSaving(at: Date): boolean {
  const gmt = wallTime(at, 0);
  const start = Date.UTC(gmt.year, 2, lastWeekdayOfMonth(gmt.year, 2, 0), 1);
  const end = Date.UTC(gmt.year, 9, lastWeekdayOfMonth(gmt.year, 9, 0), 1);
  return at.getTime() >= start && at.getTime() < end;
}

/** 在给定 UTC 偏移时区内，是否落在周一到周五的某个 [start, end) 分钟窗口内。 */
function inWeeklyWindows(
  at: Date,
  utcOffsetMinutes: number,
  windows: ReadonlyArray<readonly [number, number]>,
): boolean {
  const { dayOfWeek, minutes } = wallTime(at, utcOffsetMinutes);
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return false;
  }
  return windows.some(([start, end]) => minutes >= start && minutes < end);
}

/**
 * 判断某市场在给定时刻是否处于交易时段（价格会活跃变化的时段）。
 *
 * - CN：北京时间 9:15-11:30、13:00-15:00（含集合竞价与收盘集合竞价）
 * - HK：北京时间 9:30-12:00、13:00-16:00（午休视为非交易时段）
 * - US：美东时间 9:30-16:00（自动处理 EDT/EST 夏令时）
 * - UK：伦敦时间 8:00-16:30（自动处理 BST/GMT 夏令时）
 */
export function isMarketTradingTime(
  market: StockMarket,
  at: Date,
): boolean {
  switch (market) {
    case "CN":
      return inWeeklyWindows(at, 8 * 60, [
        [9 * 60 + 15, 11 * 60 + 30],
        [13 * 60, 15 * 60],
      ]);
    case "HK":
      return inWeeklyWindows(at, 8 * 60, [
        [9 * 60 + 30, 12 * 60],
        [13 * 60, 16 * 60],
      ]);
    case "US": {
      const offset = isUsDaylightSaving(at) ? -4 * 60 : -5 * 60;
      return inWeeklyWindows(at, offset, [[9 * 60 + 30, 16 * 60]]);
    }
    case "UK": {
      const offset = isUkDaylightSaving(at) ? 60 : 0;
      return inWeeklyWindows(at, offset, [[8 * 60, 16 * 60 + 30]]);
    }
    default:
      return false;
  }
}

/** 行情新鲜度阈值：交易时段用严格阈值，非交易时段用宽松阈值。 */
export function quoteMaximumAgeMs(
  market: StockMarket,
  at: Date,
  strictMs: number,
  offHoursMs: number,
): number {
  return isMarketTradingTime(market, at) ? strictMs : offHoursMs;
}
