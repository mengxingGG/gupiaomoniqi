import type {
  SettlementCycle,
  StockMarket,
} from "@gupiaomoniqi/shared";

const CHINA_TIME_OFFSET_MS = 8 * 60 * 60 * 1_000;
const MARKET_TIME_ZONES: Record<StockMarket, string> = {
  CN: "Asia/Shanghai",
  HK: "Asia/Hong_Kong",
  US: "America/New_York",
  UK: "Europe/London",
};
const MARKET_DATE_FORMATTERS = new Map<
  StockMarket,
  Intl.DateTimeFormat
>();
const CN_MARKET_CLOSED_DATES = new Set([
  "2026-01-01",
  "2026-01-02",
  "2026-02-16",
  "2026-02-17",
  "2026-02-18",
  "2026-02-19",
  "2026-02-20",
  "2026-02-23",
  "2026-04-06",
  "2026-05-01",
  "2026-05-04",
  "2026-05-05",
  "2026-06-19",
  "2026-09-25",
  "2026-10-01",
  "2026-10-02",
  "2026-10-05",
  "2026-10-06",
  "2026-10-07",
]);

export function settlementCycleForMarket(
  market: StockMarket,
): SettlementCycle {
  return market === "CN" ? "T1" : "T0";
}

export function marketDateKey(
  market: StockMarket,
  at: Date,
): string {
  let formatter = MARKET_DATE_FORMATTERS.get(market);

  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: MARKET_TIME_ZONES[market],
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    MARKET_DATE_FORMATTERS.set(market, formatter);
  }

  const values = Object.fromEntries(
    formatter
      .formatToParts(at)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export function nextSettlementAt(
  market: StockMarket,
  tradedAt: Date,
): Date | null {
  if (settlementCycleForMarket(market) === "T0") {
    return null;
  }

  const chinaLocal = new Date(
    tradedAt.getTime() + CHINA_TIME_OFFSET_MS,
  );
  let year = chinaLocal.getUTCFullYear();
  let month = chinaLocal.getUTCMonth();
  let day = chinaLocal.getUTCDate() + 1;

  for (;;) {
    const candidateLocal = new Date(Date.UTC(year, month, day));
    const weekday = candidateLocal.getUTCDay();

    const dateKey = [
      candidateLocal.getUTCFullYear(),
      String(candidateLocal.getUTCMonth() + 1).padStart(2, "0"),
      String(candidateLocal.getUTCDate()).padStart(2, "0"),
    ].join("-");

    if (
      weekday !== 0 &&
      weekday !== 6 &&
      !CN_MARKET_CLOSED_DATES.has(dateKey)
    ) {
      return new Date(
        candidateLocal.getTime() - CHINA_TIME_OFFSET_MS,
      );
    }

    year = candidateLocal.getUTCFullYear();
    month = candidateLocal.getUTCMonth();
    day = candidateLocal.getUTCDate() + 1;
  }
}
