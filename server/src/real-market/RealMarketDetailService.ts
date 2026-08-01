import type {
  Candle,
  CandleInterval,
  ChartRange,
  ChartSeries,
  OrderBookSnapshot,
} from "@gupiaomoniqi/shared";
import { RealMarketRepository } from "./RealMarketRepository.js";
import { RealMarketRuntime } from "./RealMarketRuntime.js";
import type { ProviderCandle } from "./types.js";

export class RealMarketDetailService {
  readonly #lastHistoryAttempt = new Map<string, number>();

  constructor(
    private readonly repository: RealMarketRepository,
    private readonly runtime: RealMarketRuntime,
  ) {}

  async getChart(
    instrumentId: string,
    range: ChartRange,
  ): Promise<ChartSeries | undefined> {
    const instrument =
      this.repository.getInstrumentById(instrumentId);
    const quote = this.repository.getQuote(instrumentId);
    if (!instrument || !quote) {
      return undefined;
    }

    this.runtime.touchInstrument(instrumentId, "DETAIL");
    const key = `${instrumentId}:${range}`;
    const minimumRetryMs = range === "INTRADAY" ? 60_000 : 60 * 60_000;
    const lastAttempt = this.#lastHistoryAttempt.get(key) ?? 0;
    let providerError: string | null = null;

    if (Date.now() - lastAttempt >= minimumRetryMs) {
      this.#lastHistoryAttempt.set(key, Date.now());
      const result = await this.runtime.ensureHistory(
        instrumentId,
        range,
      );
      providerError = result.error;
    }

    const source = await this.repository.listCandles(
      instrumentId,
      intervalForRange(range),
      limitForRange(range),
    );
    const selected = source.slice(-limitForRange(range));
    const hasProviderHistory = selected.some(
      (candle) => candle.source === "REAL_PROVIDER_HISTORY",
    );
    const summarizedError = providerError
      ? summarizeHistoryError(providerError)
      : null;
    const notice =
      selected.length === 0
        ? summarizedError
          ? `历史接口暂不可用：${summarizedError}`
          :
          "该市场暂未返回历史数据；系统不会生成虚假 K 线"
        : !hasProviderHistory && providerError
          ? `历史接口暂不可用，当前仅展示本地持续记录的真实快照：${summarizedError}`
          : null;

    return {
      instrumentId,
      range,
      mode: "REAL",
      source: "REAL_MARKET_RECORDED",
      candles: selected.map(toPublicCandle),
      coverageStart: selected[0]?.time ?? null,
      updatedAt: quote.receivedAt,
      referencePrice: quote.previousClose,
      complete: hasProviderHistory,
      notice: notice ?? undefined,
    };
  }

  async getOrderBook(
    instrumentId: string,
  ): Promise<OrderBookSnapshot | undefined> {
    const instrument =
      this.repository.getInstrumentById(instrumentId);
    const quote = this.repository.getQuote(instrumentId);
    if (!instrument || !quote) {
      return undefined;
    }
    this.runtime.touchInstrument(instrumentId, "DETAIL");
    const result = await this.runtime.fetchOrderBook(instrumentId);
    if (result.snapshot) {
      return result.snapshot;
    }
    return {
      instrumentId,
      quoteCurrency: quote.quoteCurrency,
      mode: "REAL",
      asks: [],
      bids: [],
      updatedAt: quote.receivedAt,
      available: false,
      notice:
        result.error
          ? `真实盘口接口暂不可用：${summarizeHistoryError(result.error)}`
          : "当前没有可验证的真实五档盘口，系统不会用随机数据伪造。",
    };
  }
}

function toPublicCandle(candle: ProviderCandle): Candle {
  const {
    instrumentId: _instrumentId,
    interval: _interval,
    updatedAt: _updatedAt,
    ...publicCandle
  } = candle;
  return publicCandle;
}

function intervalForRange(range: ChartRange): CandleInterval {
  return range === "INTRADAY"
    ? "MINUTE"
    : range === "DAY"
      ? "DAY"
      : range === "MONTH"
        ? "MONTH"
        : "YEAR";
}

function limitForRange(range: ChartRange): number {
  return range === "INTRADAY"
    ? 390
    : range === "DAY"
      ? 120
      : range === "MONTH"
        ? 60
        : 20;
}

function summarizeHistoryError(error: string): string {
  const normalized = error.replace(/\r/g, "").trim();
  const remoteDisconnected = normalized.match(
    /Remote end closed connection without response/i,
  )?.[0];
  if (remoteDisconnected) {
    return `兼容请求失败：${remoteDisconnected}`;
  }
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !line.startsWith("Traceback") &&
        !line.startsWith("File ") &&
        !line.startsWith("Error in sys.excepthook") &&
        !line.includes("apport_python_hook.py") &&
        !line.startsWith("Original exception was"),
    );
  return (lines[0] ?? "历史数据暂时不可用").slice(0, 180);
}
