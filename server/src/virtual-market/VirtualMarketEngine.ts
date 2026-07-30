import type {
  Quote,
  TradeActorType,
} from "@gupiaomoniqi/shared";
import { GAME_RULES } from "../config.js";
import { marketDateKey } from "../domain/marketRules.js";
import { clamp, roundPercent, roundPrice } from "../domain/money.js";
import type {
  GameRepository,
  InstrumentRecord,
} from "../repositories/GameRepository.js";

export type RandomSource = () => number;
export type Clock = () => Date;

export class VirtualMarketEngine {
  readonly #sectorFactors = new Map<string, number>();
  readonly #marketFactors = new Map<string, number>();
  readonly #tradePressure = new Map<string, number>();
  readonly #netOrderFlow = new Map<string, number>();
  readonly #pendingTradeVolume = new Map<string, number>();
  readonly #pendingTradeNotional = new Map<string, number>();
  readonly #instrumentsById = new Map<string, InstrumentRecord>();
  readonly #quotesById = new Map<string, Quote>();

  constructor(
    private readonly repository: GameRepository,
    private readonly seeds: InstrumentRecord[],
    private readonly random: RandomSource = Math.random,
    private readonly clock: Clock = () => new Date(),
  ) {
    for (const instrument of seeds) {
      this.#instrumentsById.set(instrument.id, instrument);
    }
  }

  recordTrade(
    instrumentId: string,
    side: "BUY" | "SELL",
    quantity: number,
    actorType: TradeActorType,
  ): void {
    const instrument = this.#instrumentsById.get(instrumentId);

    if (!instrument || quantity <= 0) {
      return;
    }

    const direction = side === "BUY" ? 1 : -1;
    const referencePrice =
      this.#quotesById.get(instrumentId)?.currentPrice ??
      instrument.initialPrice;
    const participation =
      quantity /
      Math.max(
        instrument.liquidity,
        instrument.lotSize * 20,
      );
    const actorWeight = actorType === "AI" ? 1 : 0.85;
    const delta =
      direction *
      actorWeight *
      clamp(participation * 0.012, 0.000004, 0.0012);
    const currentPressure =
      this.#tradePressure.get(instrumentId) ?? 0;
    const currentFlow = this.#netOrderFlow.get(instrumentId) ?? 0;

    this.#tradePressure.set(
      instrumentId,
      clamp(currentPressure + delta, -0.004, 0.004),
    );
    this.#netOrderFlow.set(
      instrumentId,
      clamp(
        currentFlow + direction * quantity,
        -instrument.liquidity * 20,
        instrument.liquidity * 20,
      ),
    );
    this.#pendingTradeVolume.set(
      instrumentId,
      (this.#pendingTradeVolume.get(instrumentId) ?? 0) + quantity,
    );
    this.#pendingTradeNotional.set(
      instrumentId,
      (this.#pendingTradeNotional.get(instrumentId) ?? 0) +
        quantity * referencePrice,
    );
  }

  getNetOrderFlow(instrumentId: string): number {
    return Math.round(this.#netOrderFlow.get(instrumentId) ?? 0);
  }

  async initialize(): Promise<Quote[]> {
    const existing = this.repository.listQuotes();
    if (existing.length > 0) {
      this.#replaceQuoteCache(existing);
      return existing;
    }

    const timestamp = this.clock().toISOString();
    const quotes = this.seeds.map((instrument) => ({
      instrumentId: instrument.id,
      symbol: instrument.symbol,
      market: instrument.market,
      quoteCurrency: instrument.quoteCurrency,
      currentPrice: instrument.initialPrice,
      previousClose: instrument.initialPrice,
      openPrice: instrument.initialPrice,
      highPrice: instrument.initialPrice,
      lowPrice: instrument.initialPrice,
      volume: 0,
      changeAmount: 0,
      changePercent: 0,
      updatedAt: timestamp,
    }));

    await this.repository.saveQuotes(quotes);
    this.#replaceQuoteCache(quotes);
    return quotes;
  }

  async tick(): Promise<Quote[]> {
    await this.initialize();

    const tickAt = this.clock();
    const timestamp = tickAt.toISOString();
    const currentMarketFactors = new Map<string, number>();
    const currentMarketDates = new Map<string, string>();

    for (const instrument of this.seeds) {
      if (currentMarketFactors.has(instrument.market)) {
        continue;
      }

      const previousMarketFactor =
        this.#marketFactors.get(instrument.market) ?? 0;
      const marketFactor = clamp(
        previousMarketFactor * 0.82 + this.#centeredRandom(0.00055),
        -0.0012,
        0.0012,
      );
      this.#marketFactors.set(instrument.market, marketFactor);
      currentMarketFactors.set(instrument.market, marketFactor);
      currentMarketDates.set(
        instrument.market,
        marketDateKey(instrument.market, tickAt),
      );
    }

    const quotes = this.seeds.map((instrument) => {
      const current = this.#quotesById.get(instrument.id);

      if (!current) {
        throw new Error(`缺少 ${instrument.symbol} 的行情快照`);
      }
      const isNewMarketDay =
        marketDateKey(instrument.market, new Date(current.updatedAt)) !==
        currentMarketDates.get(instrument.market);
      const working = isNewMarketDay
        ? {
            ...current,
            previousClose: current.currentPrice,
            openPrice: current.currentPrice,
            highPrice: current.currentPrice,
            lowPrice: current.currentPrice,
            volume: 0,
          }
        : current;

      const marketKey = instrument.market;
      const marketFactor = currentMarketFactors.get(marketKey) ?? 0;

      const sectorKey = `${marketKey}:${instrument.industry}`;
      const previousSectorFactor =
        this.#sectorFactors.get(sectorKey) ?? 0;
      const sectorFactor = clamp(
        previousSectorFactor * 0.76 + this.#centeredRandom(0.00035),
        -0.0008,
        0.0008,
      );
      this.#sectorFactors.set(sectorKey, sectorFactor);

      const distanceFromClose =
        (working.currentPrice - working.previousClose) /
        working.previousClose;
      const meanReversion = -distanceFromClose * 0.018;
      const individualNoise = this.#centeredRandom(instrument.volatility);
      const orderFlowPressure =
        this.#tradePressure.get(instrument.id) ?? 0;
      const pendingVolume =
        this.#pendingTradeVolume.get(instrument.id) ?? 0;
      const pendingNotional =
        this.#pendingTradeNotional.get(instrument.id) ?? 0;
      const volumeShare = clamp(
        pendingVolume /
          Math.max(
            instrument.liquidity,
            instrument.lotSize * 20,
          ),
        0,
        25,
      );
      const notionalShare = clamp(
        pendingNotional /
          Math.max(
            working.currentPrice * instrument.liquidity,
            working.currentPrice * instrument.lotSize * 20,
          ),
        0,
        25,
      );
      const flowDirection = Math.sign(
        this.#netOrderFlow.get(instrument.id) ?? 0,
      );
      const activityImpulse =
        flowDirection *
        clamp(
          Math.sqrt(volumeShare) * 0.001 +
            Math.sqrt(notionalShare) * 0.0012,
          0,
          0.002,
        );
      const changeRate = clamp(
        marketFactor +
          sectorFactor +
          individualNoise +
          orderFlowPressure +
          activityImpulse +
          meanReversion,
        -GAME_RULES.maxTickChangeRate,
        GAME_RULES.maxTickChangeRate,
      );

      const lowerLimit =
        working.previousClose * (1 - GAME_RULES.dailyPriceLimitRate);
      const upperLimit =
        working.previousClose * (1 + GAME_RULES.dailyPriceLimitRate);
      const nextPrice = roundPrice(
        clamp(
          working.currentPrice * (1 + changeRate),
          lowerLimit,
          upperLimit,
        ),
      );
      const backgroundVolume = Math.max(
        100,
        Math.round(
          instrument.liquidity *
            (0.35 + this.random() * 1.15) *
            (1 + Math.abs(changeRate) * 140) *
            (1 + Math.min(2.5, Math.sqrt(volumeShare + notionalShare))),
        ),
      );
      const volumeIncrement =
        backgroundVolume +
        (this.#pendingTradeVolume.get(instrument.id) ?? 0);
      const changeAmount = roundPrice(nextPrice - working.previousClose);
      const changePercent = roundPercent(
        (changeAmount / working.previousClose) * 100,
      );
      this.#tradePressure.set(
        instrument.id,
        orderFlowPressure * 0.52,
      );
      this.#netOrderFlow.set(
        instrument.id,
        (this.#netOrderFlow.get(instrument.id) ?? 0) * 0.78,
      );
      this.#pendingTradeVolume.delete(instrument.id);
      this.#pendingTradeNotional.delete(instrument.id);

      return {
        ...working,
        currentPrice: nextPrice,
        highPrice: Math.max(working.highPrice, nextPrice),
        lowPrice: Math.min(working.lowPrice, nextPrice),
        volume: working.volume + volumeIncrement,
        changeAmount,
        changePercent,
        updatedAt: timestamp,
      };
    });

    await this.repository.saveQuotes(quotes);
    this.#replaceQuoteCache(quotes);
    return quotes;
  }

  #centeredRandom(amplitude: number): number {
    return (this.random() * 2 - 1) * amplitude;
  }

  #replaceQuoteCache(quotes: Quote[]): void {
    this.#quotesById.clear();
    for (const quote of quotes) {
      this.#quotesById.set(quote.instrumentId, structuredClone(quote));
    }
  }
}
