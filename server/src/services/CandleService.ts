import type {
  Candle,
  CandleInterval,
  CandleSource,
  ChartRange,
  ChartSeries,
  Quote,
} from "@gupiaomoniqi/shared";
import type {
  CandleRecord,
  GameRepository,
} from "../repositories/GameRepository.js";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1_000;

export class CandleService {
  readonly #currentMinutes = new Map<string, CandleRecord>();
  readonly #currentDays = new Map<string, CandleRecord>();
  readonly #lastQuotes = new Map<string, Quote>();
  #lastPersistedAt = 0;

  constructor(
    private readonly repository: GameRepository,
    private readonly persistEveryMs = 30_000,
  ) {}

  async initialize(): Promise<void> {
    const missing: CandleRecord[] = [];

    for (const quote of this.repository.listQuotes()) {
      const minuteTime = bucketStart(quote.updatedAt, "MINUTE");
      const dayTime = bucketStart(quote.updatedAt, "DAY");
      const latestMinute =
        this.repository.getLatestCandle?.(
          quote.instrumentId,
          "MINUTE",
        ) ??
        this.repository.listCandles(quote.instrumentId, "MINUTE").at(-1);
      const latestDay =
        this.repository.getLatestCandle?.(quote.instrumentId, "DAY") ??
        this.repository.listCandles(quote.instrumentId, "DAY").at(-1);
      const minute =
        latestMinute?.time === minuteTime
          ? structuredClone(latestMinute)
          : snapshotMinute(quote, minuteTime);
      const day =
        latestDay?.time === dayTime
          ? structuredClone(latestDay)
          : snapshotDay(quote, dayTime, !latestDay);

      this.#currentMinutes.set(quote.instrumentId, minute);
      this.#currentDays.set(quote.instrumentId, day);
      this.#lastQuotes.set(quote.instrumentId, structuredClone(quote));

      if (!latestMinute || latestMinute.time !== minuteTime) {
        missing.push(minute);
      }
      if (!latestDay || latestDay.time !== dayTime) {
        missing.push(day);
      }
    }

    await this.repository.upsertCandles(missing);
    this.#lastPersistedAt = Date.now();
  }

  async recordQuotes(quotes: Quote[]): Promise<void> {
    const completed: CandleRecord[] = [];

    for (const quote of quotes) {
      const previous =
        this.#lastQuotes.get(quote.instrumentId) ?? quote;
      const volumeDelta = Math.max(0, quote.volume - previous.volume);

      this.#recordInterval(
        quote,
        previous,
        volumeDelta,
        "MINUTE",
        this.#currentMinutes,
        completed,
      );
      this.#recordInterval(
        quote,
        previous,
        volumeDelta,
        "DAY",
        this.#currentDays,
        completed,
      );
      this.#lastQuotes.set(quote.instrumentId, structuredClone(quote));
    }

    const now = Date.now();
    const checkpointDue =
      now - this.#lastPersistedAt >= this.persistEveryMs;
    const checkpoint = checkpointDue
      ? [
          ...this.#currentMinutes.values(),
          ...this.#currentDays.values(),
        ]
      : [];

    await this.repository.upsertCandles([
      ...completed,
      ...checkpoint.map((candle) => structuredClone(candle)),
    ]);

    if (checkpointDue) {
      this.#lastPersistedAt = now;
    }
  }

  async flush(): Promise<void> {
    await this.repository.upsertCandles([
      ...this.#currentMinutes.values(),
      ...this.#currentDays.values(),
    ]);
    this.#lastPersistedAt = Date.now();
  }

  async getChart(
    instrumentId: string,
    range: ChartRange,
  ): Promise<ChartSeries | undefined> {
    const quote = this.repository.getQuote(instrumentId);

    if (!quote || !this.repository.getInstrumentById(instrumentId)) {
      return undefined;
    }

    const candles =
      range === "INTRADAY"
        ? (await this.#withCurrent(
            instrumentId,
            "MINUTE",
            this.#currentMinutes.get(instrumentId),
            240,
          )).slice(-240)
        : range === "DAY"
          ? (await this.#withCurrent(
              instrumentId,
              "DAY",
              this.#currentDays.get(instrumentId),
              160,
            )).slice(-160)
          : aggregateCandles(
              await this.#withCurrent(
                instrumentId,
                "DAY",
                this.#currentDays.get(instrumentId),
                range === "MONTH" ? 2_200 : 4_500,
              ),
              range,
            ).slice(range === "MONTH" ? -72 : -12);

    return {
      instrumentId,
      range,
      mode: "VIRTUAL",
      source: "DATABASE_RECORDED",
      candles: candles.map(toPublicCandle),
      coverageStart: candles[0]?.time ?? null,
      updatedAt: quote.updatedAt,
    };
  }

  #recordInterval(
    quote: Quote,
    previous: Quote,
    volumeDelta: number,
    interval: CandleInterval,
    currentMap: Map<string, CandleRecord>,
    completed: CandleRecord[],
  ): void {
    const time = bucketStart(quote.updatedAt, interval);
    const current = currentMap.get(quote.instrumentId);

    if (!current || current.time !== time) {
      if (current) {
        completed.push({
          ...current,
          isPartial: false,
          updatedAt: quote.updatedAt,
        });
      }

      currentMap.set(
        quote.instrumentId,
        tickCandle(
          quote,
          previous.currentPrice,
          volumeDelta,
          interval,
          time,
        ),
      );
      return;
    }

    currentMap.set(quote.instrumentId, {
      ...current,
      high: Math.max(current.high, quote.currentPrice),
      low: Math.min(current.low, quote.currentPrice),
      close: quote.currentPrice,
      volume: current.volume + volumeDelta,
      source: "MARKET_TICK",
      isPartial: true,
      updatedAt: quote.updatedAt,
    });
  }

  async #withCurrent(
    instrumentId: string,
    interval: CandleInterval,
    current: CandleRecord | undefined,
    limit: number,
  ): Promise<CandleRecord[]> {
    const stored = this.repository.loadCandles
      ? await this.repository.loadCandles(instrumentId, interval, limit)
      : this.repository.listCandles(instrumentId, interval).slice(-limit);
    const byTime = new Map(
      stored.map((candle) => [candle.time, candle]),
    );

    if (current) {
      byTime.set(current.time, structuredClone(current));
    }

    return [...byTime.values()].sort((left, right) =>
      left.time.localeCompare(right.time),
    );
  }
}

function snapshotMinute(quote: Quote, time: string): CandleRecord {
  return {
    instrumentId: quote.instrumentId,
    interval: "MINUTE",
    time,
    open: quote.currentPrice,
    high: quote.currentPrice,
    low: quote.currentPrice,
    close: quote.currentPrice,
    volume: 0,
    source: "DATABASE_SNAPSHOT",
    isPartial: true,
    updatedAt: quote.updatedAt,
  };
}

function snapshotDay(
  quote: Quote,
  time: string,
  includeStoredDay: boolean,
): CandleRecord {
  return {
    instrumentId: quote.instrumentId,
    interval: "DAY",
    time,
    open: includeStoredDay ? quote.openPrice : quote.currentPrice,
    high: includeStoredDay ? quote.highPrice : quote.currentPrice,
    low: includeStoredDay ? quote.lowPrice : quote.currentPrice,
    close: quote.currentPrice,
    volume: includeStoredDay ? quote.volume : 0,
    source: "DATABASE_SNAPSHOT",
    isPartial: true,
    updatedAt: quote.updatedAt,
  };
}

function tickCandle(
  quote: Quote,
  open: number,
  volume: number,
  interval: CandleInterval,
  time: string,
): CandleRecord {
  return {
    instrumentId: quote.instrumentId,
    interval,
    time,
    open,
    high: Math.max(open, quote.currentPrice),
    low: Math.min(open, quote.currentPrice),
    close: quote.currentPrice,
    volume,
    source: "MARKET_TICK",
    isPartial: true,
    updatedAt: quote.updatedAt,
  };
}

function aggregateCandles(
  candles: CandleRecord[],
  range: "MONTH" | "YEAR",
): CandleRecord[] {
  const grouped = new Map<string, CandleRecord>();

  for (const candle of candles) {
    const date = new Date(candle.time);
    const time =
      range === "MONTH"
        ? new Date(
            Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1),
          ).toISOString()
        : new Date(Date.UTC(date.getUTCFullYear(), 0, 1)).toISOString();
    const existing = grouped.get(time);

    if (!existing) {
      grouped.set(time, {
        ...candle,
        interval: "DAY",
        time,
      });
      continue;
    }

    grouped.set(time, {
      ...existing,
      high: Math.max(existing.high, candle.high),
      low: Math.min(existing.low, candle.low),
      close: candle.close,
      volume: existing.volume + candle.volume,
      source: strongerSource(existing.source, candle.source),
      isPartial: candle.isPartial,
      updatedAt:
        existing.updatedAt > candle.updatedAt
          ? existing.updatedAt
          : candle.updatedAt,
    });
  }

  return [...grouped.values()].sort((left, right) =>
    left.time.localeCompare(right.time),
  );
}

function strongerSource(
  left: CandleSource,
  right: CandleSource,
): CandleSource {
  const weight: Record<CandleSource, number> = {
    DATABASE_SNAPSHOT: 0,
    TRANSACTION_BACKFILL: 1,
    MARKET_TICK: 2,
    REAL_PROVIDER_SNAPSHOT: 0,
    REAL_PROVIDER_HISTORY: 0,
  };
  return weight[right] > weight[left] ? right : left;
}

function bucketStart(
  timestamp: string,
  interval: CandleInterval,
): string {
  const time = new Date(timestamp).getTime();
  const size = interval === "MINUTE" ? MINUTE_MS : DAY_MS;
  return new Date(Math.floor(time / size) * size).toISOString();
}

function toPublicCandle(candle: CandleRecord): Candle {
  const {
    instrumentId: _instrumentId,
    interval: _interval,
    updatedAt: _updatedAt,
    ...publicCandle
  } = candle;
  return publicCandle;
}
