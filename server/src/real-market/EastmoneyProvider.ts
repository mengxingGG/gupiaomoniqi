import type {
  CandleSource,
  ChartRange,
  QuoteCurrency,
  SourceCurrency,
  StockMarket,
} from "@gupiaomoniqi/shared";
import { IMPORT_FX_RATES } from "../db/constants.js";
import { requestJsonViaPython } from "./PythonJsonFallback.js";
import type {
  ProviderCandle,
  ProviderInstrumentSnapshot,
  ProviderOrderBook,
  ProviderPage,
  RealInstrumentRecord,
  RealQuoteRecord,
} from "./types.js";

const LIST_ENDPOINT =
  "https://push2.eastmoney.com/webguest/api/qt/clist/get";
const KLINE_ENDPOINT =
  "https://push2his.eastmoney.com/api/qt/stock/kline/get";
const TRENDS_ENDPOINT =
  "https://push2his.eastmoney.com/api/qt/stock/trends2/get";
const STOCK_QUOTE_ENDPOINT =
  "https://push2.eastmoney.com/api/qt/stock/get";
const PUBLIC_QUOTE_TOKEN = "fa5fd1943c7b386f172d6893dbfba10b";
const HISTORY_FALLBACK_ATTEMPTS = 3;
const ORDER_BOOK_FIELDS = [
  "f11",
  "f12",
  "f13",
  "f14",
  "f15",
  "f16",
  "f17",
  "f18",
  "f19",
  "f20",
  "f31",
  "f32",
  "f33",
  "f34",
  "f35",
  "f36",
  "f37",
  "f38",
  "f39",
  "f40",
  "f86",
  "f191",
  "f192",
].join(",");
const LIST_FIELDS = [
  "f2",
  "f3",
  "f4",
  "f5",
  "f6",
  "f12",
  "f13",
  "f14",
  "f15",
  "f16",
  "f17",
  "f18",
  "f20",
  "f21",
  "f100",
  "f124",
].join(",");

interface MarketProviderConfig {
  market: StockMarket;
  referer: string;
  filter: string;
  sourceCurrency: SourceCurrency;
  quoteCurrency: QuoteCurrency;
  sourcePriceScale: number;
  conversionRate: number;
  lotSize: number;
  timeZone: string;
}

const MARKET_CONFIG: Record<StockMarket, MarketProviderConfig> = {
  CN: {
    market: "CN",
    referer:
      "https://quote.eastmoney.com/center/gridlist.html#hs_a_board",
    filter:
      "m:0+t:6+f:!2,m:0+t:80+f:!2,m:1+t:2+f:!2," +
      "m:1+t:23+f:!2,m:0+t:81+s:262144+f:!2",
    sourceCurrency: "CNY",
    quoteCurrency: "CNY",
    sourcePriceScale: 1,
    conversionRate: 1,
    lotSize: 100,
    timeZone: "Asia/Shanghai",
  },
  HK: {
    market: "HK",
    referer:
      "https://quote.eastmoney.com/center/gridlist.html#hk_stocks",
    filter: "m:116+t:3,m:116+t:4,m:116+t:1,m:116+t:2",
    sourceCurrency: "HKD",
    quoteCurrency: "CNY",
    sourcePriceScale: 1,
    conversionRate: IMPORT_FX_RATES.HKD_CNY,
    lotSize: 100,
    timeZone: "Asia/Hong_Kong",
  },
  US: {
    market: "US",
    referer:
      "https://quote.eastmoney.com/center/gridlist.html#us_stocks",
    filter: "m:105,m:106,m:107",
    sourceCurrency: "USD",
    quoteCurrency: "USD",
    sourcePriceScale: 1,
    conversionRate: 1,
    lotSize: 1,
    timeZone: "America/New_York",
  },
  UK: {
    market: "UK",
    referer:
      "https://quote.eastmoney.com/center/gridlist.html#stocks_all",
    filter:
      "m:155+t:1,m:155+t:2,m:155+t:3,m:156+t:1," +
      "m:156+t:2,m:156+t:5,m:156+t:6,m:156+t:7,m:156+t:8",
    sourceCurrency: "GBP",
    quoteCurrency: "USD",
    sourcePriceScale: 0.01,
    conversionRate: IMPORT_FX_RATES.GBP_USD,
    lotSize: 1,
    timeZone: "Europe/London",
  },
};

export const REAL_MARKETS: StockMarket[] = ["CN", "HK", "US", "UK"];

export class EastmoneyProviderError extends Error {
  constructor(
    message: string,
    readonly code:
      | "HTTP_ERROR"
      | "INVALID_RESPONSE"
      | "PROVIDER_REJECTED"
      | "NO_DATA",
  ) {
    super(message);
    this.name = "EastmoneyProviderError";
  }
}

export interface EastmoneyProviderOptions {
  pageSize: number;
  requestTimeoutMs: number;
  fetchImplementation?: typeof fetch;
  clock?: () => Date;
  requestJsonFallback?: (
    url: string,
    referer: string,
    timeoutMs: number,
  ) => Promise<Record<string, unknown>>;
}

export class EastmoneyProvider {
  readonly #fetch: typeof fetch;
  readonly #clock: () => Date;
  readonly #requestJsonFallback: (
    url: string,
    referer: string,
    timeoutMs: number,
  ) => Promise<Record<string, unknown>>;

  constructor(private readonly options: EastmoneyProviderOptions) {
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#clock = options.clock ?? (() => new Date());
    this.#requestJsonFallback =
      options.requestJsonFallback ?? requestJsonViaPython;
  }

  async fetchPage(
    market: StockMarket,
    page: number,
    signal?: AbortSignal,
  ): Promise<ProviderPage> {
    const config = MARKET_CONFIG[market];
    const receivedAt = this.#clock();
    const startedAt = performance.now();
    const payload = await this.#requestJson(
      buildListUrl(config, page, this.options.pageSize),
      config.referer,
      signal,
    );
    const data = asObject(payload.data);

    if (!data) {
      throw new EastmoneyProviderError(
        `东方财富 ${market} 第 ${page} 页没有 data`,
        "NO_DATA",
      );
    }

    const providerTotal = integerValue(data.total);
    const rows = rowList(data.diff);

    if (providerTotal < 0 || (page === 1 && rows.length === 0)) {
      throw new EastmoneyProviderError(
        `东方财富 ${market} 第 ${page} 页结构无效`,
        "INVALID_RESPONSE",
      );
    }

    const normalizedItems = rows
      .map((row, index) =>
        normalizeListRow(
          row,
          config,
          page,
          this.options.pageSize,
          index,
          receivedAt,
        ),
      )
      .filter(
        (
          item,
        ): item is ProviderInstrumentSnapshot => item !== null,
      );
    const items = uniqueProviderItems(normalizedItems);

    return {
      market,
      page,
      pageSize: this.options.pageSize,
      providerTotal,
      receivedAt: receivedAt.toISOString(),
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      items,
    };
  }

  async fetchHistory(
    instrument: RealInstrumentRecord,
    range: ChartRange,
    signal?: AbortSignal,
  ): Promise<ProviderCandle[]> {
    return range === "INTRADAY"
      ? this.#fetchIntraday(instrument, signal)
      : this.#fetchPeriodKline(instrument, range, signal);
  }

  async fetchOrderBook(
    instrument: RealInstrumentRecord,
    signal?: AbortSignal,
  ): Promise<ProviderOrderBook> {
    const parameters = new URLSearchParams({
      secid: instrument.providerSecId,
      ut: PUBLIC_QUOTE_TOKEN,
      fltt: "2",
      invt: "2",
      fields: ORDER_BOOK_FIELDS,
    });
    const payload = await this.#requestJson(
      `${STOCK_QUOTE_ENDPOINT}?${parameters}`,
      MARKET_CONFIG[instrument.market].referer,
      signal,
    );
    const data = asObject(payload.data);
    if (!data) {
      throw new EastmoneyProviderError(
        `东方财富没有返回 ${instrument.symbol} 的盘口数据`,
        "NO_DATA",
      );
    }
    const updatedAt = timestampValue(data.f86, this.#clock());
    const asks = normalizeOrderBookSide(
      instrument,
      data,
      [
        ["f31", "f32"],
        ["f33", "f34"],
        ["f35", "f36"],
        ["f37", "f38"],
        ["f39", "f40"],
      ],
    );
    const bids = normalizeOrderBookSide(
      instrument,
      data,
      [
        ["f19", "f20"],
        ["f17", "f18"],
        ["f15", "f16"],
        ["f13", "f14"],
        ["f11", "f12"],
      ],
    );

    if (asks.length === 0 && bids.length === 0) {
      throw new EastmoneyProviderError(
        `东方财富没有返回 ${instrument.symbol} 的有效五档盘口`,
        "NO_DATA",
      );
    }

    return {
      asks,
      bids,
      updatedAt,
    };
  }

  async #fetchPeriodKline(
    instrument: RealInstrumentRecord,
    range: Exclude<ChartRange, "INTRADAY">,
    signal?: AbortSignal,
  ): Promise<ProviderCandle[]> {
    const request = historyWindow(range, this.#clock());
    const parameters = new URLSearchParams({
      secid: instrument.providerSecId,
      ut: PUBLIC_QUOTE_TOKEN,
      fields1: "f1,f2,f3,f4,f5,f6",
      fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
      klt: request.klt,
      fqt: "1",
      beg: request.begin,
      end: request.end,
      lmt: String(request.limit),
    });
    const payload = await this.#requestJson(
      `${KLINE_ENDPOINT}?${parameters}`,
      MARKET_CONFIG[instrument.market].referer,
      signal,
    );
    const data = asObject(payload.data);
    const rows = Array.isArray(data?.klines) ? data.klines : [];

    if (rows.length === 0) {
      throw new EastmoneyProviderError(
        `东方财富没有返回 ${instrument.symbol} 的日 K 数据`,
        "NO_DATA",
      );
    }

    const now = this.#clock().toISOString();
    return rows
      .map((value) =>
        normalizeKlineRow(
          String(value),
          instrument,
          now,
          range === "DAY" ? "DAY" : range,
        ),
      )
      .filter((candle): candle is ProviderCandle => candle !== null);
  }

  async #fetchIntraday(
    instrument: RealInstrumentRecord,
    signal?: AbortSignal,
  ): Promise<ProviderCandle[]> {
    const parameters = new URLSearchParams({
      secid: instrument.providerSecId,
      ut: PUBLIC_QUOTE_TOKEN,
      fields1: "f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13",
      fields2: "f51,f52,f53,f54,f55,f56,f57,f58",
      ndays: "1",
      iscr: "0",
      iscca: "0",
    });
    const payload = await this.#requestJson(
      `${TRENDS_ENDPOINT}?${parameters}`,
      MARKET_CONFIG[instrument.market].referer,
      signal,
    );
    const data = asObject(payload.data);
    const rows = Array.isArray(data?.trends) ? data.trends : [];

    if (rows.length === 0) {
      throw new EastmoneyProviderError(
        `东方财富没有返回 ${instrument.symbol} 的分时数据`,
        "NO_DATA",
      );
    }

    const now = this.#clock().toISOString();
    return rows
      .map((value) =>
        normalizeTrendRow(String(value), instrument, now),
      )
      .filter((candle): candle is ProviderCandle => candle !== null);
  }

  async #requestJson(
    url: string,
    referer: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const timeoutSignal = AbortSignal.timeout(
      this.options.requestTimeoutMs,
    );
    const combinedSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;
    const response = await this.#fetch(url, {
      signal: combinedSignal,
      headers: {
        Accept: "application/json,text/plain,*/*",
        Referer: referer,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
          "AppleWebKit/537.36 (KHTML, like Gecko) " +
          "Chrome/138.0 Safari/537.36 StockSimulator/3.0",
      },
    }).catch(async (error: unknown) => {
      if (isHistoryUrl(url)) {
        try {
          return await this.#requestHistoryFallback(
            url,
            referer,
          ).then((payload) => asSyntheticJsonResponse(payload));
        } catch (fallbackError) {
          throw new EastmoneyProviderError(
            `东方财富请求失败：${summarizeProviderError(error)}；兼容请求失败：${
              summarizeProviderError(fallbackError)
            }`,
            "HTTP_ERROR",
          );
        }
      }
      throw new EastmoneyProviderError(
        `东方财富请求失败：${summarizeProviderError(error)}`,
        "HTTP_ERROR",
      );
    });

    if (!response.ok) {
      throw new EastmoneyProviderError(
        `东方财富返回 HTTP ${response.status}`,
        "HTTP_ERROR",
      );
    }

    const payload = await response.json().catch(() => null);
    const object = asObject(payload);

    if (!object) {
      throw new EastmoneyProviderError(
        "东方财富响应不是 JSON 对象",
        "INVALID_RESPONSE",
      );
    }

    if (
      !Object.hasOwn(object, "rc") ||
      numericValue(object.rc) !== 0 ||
      object.data == null
    ) {
      throw new EastmoneyProviderError(
        `东方财富拒绝请求（rc=${String(object.rc)}）`,
        "PROVIDER_REJECTED",
      );
    }

    return object;
  }

  async #requestHistoryFallback(
    url: string,
    referer: string,
  ): Promise<Record<string, unknown>> {
    let lastError: unknown = null;
    for (
      let attempt = 0;
      attempt < HISTORY_FALLBACK_ATTEMPTS;
      attempt += 1
    ) {
      try {
        return await this.#requestJsonFallback(
          url,
          referer,
          this.options.requestTimeoutMs,
        );
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new Error("fallback unavailable");
  }
}

function buildListUrl(
  config: MarketProviderConfig,
  page: number,
  pageSize: number,
): string {
  const parameters = new URLSearchParams({
    np: "1",
    fltt: "2",
    invt: "2",
    pn: String(page),
    pz: String(pageSize),
    po: "1",
    fid: "f20",
    dect: "1",
    ut: PUBLIC_QUOTE_TOKEN,
    wbp2u: "|0|0|0|web",
    fs: config.filter,
    fields: LIST_FIELDS,
  });
  return `${LIST_ENDPOINT}?${parameters}`;
}

function isHistoryUrl(url: string): boolean {
  return url.startsWith(KLINE_ENDPOINT) || url.startsWith(TRENDS_ENDPOINT);
}

function historyWindow(
  range: Exclude<ChartRange, "INTRADAY">,
  now: Date,
): {
  klt: "101" | "103" | "106";
  begin: string;
  end: string;
  limit: number;
} {
  const end = formatEastmoneyDate(now);
  if (range === "DAY") {
    return {
      klt: "101",
      begin: formatEastmoneyDate(addDays(now, -30)),
      end,
      limit: 60,
    };
  }
  if (range === "MONTH") {
    return {
      klt: "103",
      begin: formatEastmoneyDate(addDays(now, -(365 * 5))),
      end,
      limit: 60,
    };
  }
  return {
    klt: "106",
    begin: formatEastmoneyDate(addDays(now, -(365 * 20))),
    end,
    limit: 20,
  };
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatEastmoneyDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function asSyntheticJsonResponse(payload: Record<string, unknown>): {
  ok: true;
  status: 200;
  json: () => Promise<Record<string, unknown>>;
} {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  };
}

function normalizeListRow(
  row: Record<string, unknown>,
  config: MarketProviderConfig,
  page: number,
  pageSize: number,
  index: number,
  receivedAt: Date,
): ProviderInstrumentSnapshot | null {
  const symbol = stringValue(row.f12);
  const name = stringValue(row.f14);
  const marketCode = stringValue(row.f13);

  if (!symbol || !name || !marketCode) {
    return null;
  }

  const providerSecId = `${marketCode}.${symbol}`;
  const sourceTimestamp = timestampValue(row.f124, receivedAt);
  const current = priceValue(row.f2);
  const previousClose = priceValue(row.f18);
  const open = priceValue(row.f17);
  const high = priceValue(row.f15);
  const low = priceValue(row.f16);
  const change = numericValue(row.f4);
  const percent = numericValue(row.f3);
  const hasQuote = current > 0 && previousClose > 0;
  const instrument: RealInstrumentRecord = {
    id: realInstrumentId(config.market, providerSecId),
    providerSecId,
    symbol,
    name,
    market: config.market,
    sourceCurrency: config.sourceCurrency,
    quoteCurrency: config.quoteCurrency,
    type: "STOCK_REAL",
    industry: cleanProviderText(row.f100),
    isTradable: hasQuote,
    lotSize: config.lotSize,
    settlementCycle: config.market === "CN" ? "T1" : "T0",
    exchangeCode: marketCode,
    sourcePage: page,
    sourceRank: (page - 1) * pageSize + index,
    sourceUpdatedAt: sourceTimestamp,
    isActive: true,
  };

  if (!hasQuote) {
    return { instrument, quote: null };
  }

  const factor = config.sourcePriceScale * config.conversionRate;
  const normalizedCurrent = current * factor;
  const normalizedPrevious = previousClose * factor;
  const normalizedOpen = (open > 0 ? open : current) * factor;
  const normalizedHigh =
    (high > 0 ? high : Math.max(current, open)) * factor;
  const normalizedLow =
    (low > 0 ? low : Math.min(current, open || current)) * factor;
  const quote: RealQuoteRecord = {
    instrumentId: instrument.id,
    symbol,
    market: config.market,
    quoteCurrency: config.quoteCurrency,
    currentPrice: normalizedCurrent,
    previousClose: normalizedPrevious,
    openPrice: normalizedOpen,
    highPrice: normalizedHigh,
    lowPrice: normalizedLow,
    volume: Math.max(0, numericValue(row.f5)),
    amount: Math.max(0, numericValue(row.f6)),
    changeAmount:
      Number.isFinite(change) && change !== 0
        ? change * factor
        : normalizedCurrent - normalizedPrevious,
    changePercent:
      Number.isFinite(percent) && percent !== 0
        ? percent
        : ((normalizedCurrent - normalizedPrevious) /
            normalizedPrevious) *
          100,
    updatedAt: sourceTimestamp,
    receivedAt: receivedAt.toISOString(),
    rawCurrentPrice: current,
    rawPreviousClose: previousClose,
    rawOpenPrice: open > 0 ? open : current,
    rawHighPrice: high > 0 ? high : Math.max(current, open),
    rawLowPrice: low > 0 ? low : Math.min(current, open || current),
  };
  return { instrument, quote };
}

function uniqueProviderItems(
  items: ProviderInstrumentSnapshot[],
): ProviderInstrumentSnapshot[] {
  const unique = new Map<string, ProviderInstrumentSnapshot>();
  for (const item of items) {
    const current = unique.get(item.instrument.providerSecId);
    if (
      !current ||
      item.instrument.sourceRank < current.instrument.sourceRank
    ) {
      unique.set(item.instrument.providerSecId, item);
    }
  }
  return [...unique.values()];
}

function normalizeKlineRow(
  value: string,
  instrument: RealInstrumentRecord,
  updatedAt: string,
  interval: "DAY" | "MONTH" | "YEAR",
): ProviderCandle | null {
  const parts = value.split(",");
  const date = parts[0];
  const open = priceValue(parts[1]);
  const close = priceValue(parts[2]);
  const high = priceValue(parts[3]);
  const low = priceValue(parts[4]);
  const volume = numericValue(parts[5]);

  if (
    !date ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    open <= 0 ||
    close <= 0 ||
    high <= 0 ||
    low <= 0
  ) {
    return null;
  }

  const factor = priceFactor(instrument.market);
  return {
    instrumentId: instrument.id,
    interval,
    time: normalizePeriodTime(date, interval),
    open: open * factor,
    high: high * factor,
    low: low * factor,
    close: close * factor,
    volume: Math.max(0, volume),
    source: "REAL_PROVIDER_HISTORY",
    isPartial: false,
    updatedAt,
  };
}

function normalizeTrendRow(
  value: string,
  instrument: RealInstrumentRecord,
  updatedAt: string,
): ProviderCandle | null {
  const parts = value.split(",");
  const localTime = parts[0];
  const open = priceValue(parts[1]);
  const close = priceValue(parts[2]);
  const high = priceValue(parts[3]);
  const low = priceValue(parts[4]);
  const volume = numericValue(parts[5]);
  const averagePrice = priceValue(parts[7]);

  if (
    !localTime ||
    !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(localTime) ||
    open <= 0 ||
    close <= 0 ||
    high <= 0 ||
    low <= 0
  ) {
    return null;
  }

  const time = zonedLocalTimeToIso(
    localTime,
    MARKET_CONFIG[instrument.market].timeZone,
  );
  const factor = priceFactor(instrument.market);
  return {
    instrumentId: instrument.id,
    interval: "MINUTE",
    time,
    open: open * factor,
    high: high * factor,
    low: low * factor,
    close: close * factor,
    volume: Math.max(0, volume),
    averagePrice:
      averagePrice > 0 ? averagePrice * factor : undefined,
    source: "REAL_PROVIDER_HISTORY",
    isPartial: false,
    updatedAt,
  };
}

function normalizePeriodTime(
  date: string,
  interval: "DAY" | "MONTH" | "YEAR",
): string {
  if (interval === "DAY") {
    return `${date}T00:00:00.000Z`;
  }
  if (/^\d{4}-\d{2}$/.test(date)) {
    return `${date}-01T00:00:00.000Z`;
  }
  if (/^\d{4}$/.test(date)) {
    return `${date}-01-01T00:00:00.000Z`;
  }
  return `${date}T00:00:00.000Z`;
}

function normalizeOrderBookSide(
  instrument: RealInstrumentRecord,
  row: Record<string, unknown>,
  keys: [string, string][],
): { price: number; quantity: number }[] {
  const factor = priceFactor(instrument.market);
  return keys
    .map(([priceKey, quantityKey]) => ({
      price: priceValue(row[priceKey]) * factor,
      quantity: integerValue(row[quantityKey]),
    }))
    .filter((level) => level.price > 0 && level.quantity > 0);
}

function priceFactor(market: StockMarket): number {
  const config = MARKET_CONFIG[market];
  return config.sourcePriceScale * config.conversionRate;
}

function realInstrumentId(
  market: StockMarket,
  providerSecId: string,
): string {
  return `real-${market.toLowerCase()}-${providerSecId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;
}

function rowList(value: unknown): Record<string, unknown>[] {
  const object = asObject(value);
  const values = Array.isArray(value)
    ? value
    : object
      ? Object.values(object)
      : [];
  return values
    .map(asObject)
    .filter((row): row is Record<string, unknown> => row !== null);
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string"
    ? value.trim()
    : typeof value === "number"
      ? String(value)
      : "";
}

function cleanProviderText(value: unknown): string {
  const text = stringValue(value);
  return text === "-" || text === "--" ? "" : text;
}

function numericValue(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }
  return 0;
}

function integerValue(value: unknown): number {
  return Math.max(0, Math.floor(numericValue(value)));
}

function priceValue(value: unknown): number {
  const number = numericValue(value);
  return number > 0 ? number : 0;
}

function timestampValue(value: unknown, fallback: Date): string {
  const seconds = numericValue(value);
  if (seconds > 1_000_000_000) {
    return new Date(seconds * 1_000).toISOString();
  }
  return fallback.toISOString();
}

function zonedLocalTimeToIso(
  value: string,
  timeZone: string,
): string {
  const [date = "", time = ""] = value.split(" ");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  let candidate = Date.UTC(
    year ?? 1970,
    (month ?? 1) - 1,
    day ?? 1,
    hour ?? 0,
    minute ?? 0,
  );
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  for (let index = 0; index < 2; index += 1) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(candidate))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
    const rendered = Date.UTC(
      parts.year ?? 1970,
      (parts.month ?? 1) - 1,
      parts.day ?? 1,
      parts.hour ?? 0,
      parts.minute ?? 0,
    );
    const desired = Date.UTC(
      year ?? 1970,
      (month ?? 1) - 1,
      day ?? 1,
      hour ?? 0,
      minute ?? 0,
    );
    candidate += desired - rendered;
  }

  return new Date(candidate).toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function summarizeProviderError(error: unknown): string {
  const message = errorMessage(error)
    .replace(/\r/g, "")
    .trim();
  const remoteDisconnected = message.match(
    /Remote end closed connection without response/i,
  )?.[0];
  if (remoteDisconnected) {
    return remoteDisconnected;
  }
  const fetchFailed = message.match(/fetch failed/i)?.[0];
  if (fetchFailed) {
    return fetchFailed;
  }
  return message
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("Traceback"))
    ?.slice(0, 180) ?? "unknown error";
}

export function realCandleSourceWeight(
  source: CandleSource,
): number {
  return source === "REAL_PROVIDER_HISTORY"
    ? 3
    : source === "REAL_PROVIDER_SNAPSHOT"
      ? 2
      : 0;
}
