import type {
  Quote,
  TradeActorType,
} from "@gupiaomoniqi/shared";
import { quotePriceToUsd } from "@gupiaomoniqi/shared";
import { GAME_RULES } from "../config.js";
import { marketDateKey } from "../domain/marketRules.js";
import { clamp, roundPercent, roundPrice } from "../domain/money.js";
import type {
  GameRepository,
  InstrumentRecord,
} from "../repositories/GameRepository.js";
import {
  MarketStateService,
  type ScheduleVirtualMarketEventInput,
  type VirtualMarketSignal,
} from "./MarketStateService.js";

export type RandomSource = () => number;
export type Clock = () => Date;

export const VIRTUAL_MARKET_IMPACT_RULES = {
  naturalVolatilityMultiplier: 1,
  minimumDepthUsd: 1_000_000,
  maximumDepthUsd: 100_000_000,
  depthLiquidityMultiplier: 20,
  maximumVolumeParticipationShockRate: 0.002,
  maximumNewShockRate: 0.025,
  maximumImpactReservoirRate: 0.04,
  maximumAppliedImpactPerTickRate: 0.02,
  impactResidualDecay: 0.6,
} as const;

export class VirtualMarketEngine {
  readonly #sectorFactors = new Map<string, number>();
  readonly #marketFactors = new Map<string, number>();
  readonly #impactReservoir = new Map<string, number>();
  readonly #netOrderFlow = new Map<string, number>();
  readonly #pendingTradeVolume = new Map<string, number>();
  readonly #pendingSignedTradeVolume = new Map<string, number>();
  readonly #pendingSignedTradeNotionalUsd = new Map<string, number>();
  readonly #instrumentsById = new Map<string, InstrumentRecord>();
  readonly #quotesById = new Map<string, Quote>();
  readonly marketState: MarketStateService;
  #lastTickAtMs: number | null = null;

  constructor(
    private readonly repository: GameRepository,
    private readonly seeds: InstrumentRecord[],
    private readonly random: RandomSource = Math.random,
    private readonly clock: Clock = () => new Date(),
    marketState?: MarketStateService,
  ) {
    for (const instrument of seeds) {
      this.#instrumentsById.set(instrument.id, instrument);
    }
    this.marketState =
      marketState ??
      new MarketStateService(
        repository,
        seeds,
        undefined,
        random,
        clock,
      );
  }

  recordTrade(
    instrumentId: string,
    side: "BUY" | "SELL",
    quantity: number,
    _actorType: TradeActorType,
    grossAmountUsd?: number,
  ): void {
    const instrument = this.#instrumentsById.get(instrumentId);

    if (!instrument || quantity <= 0) {
      return;
    }

    const direction = side === "BUY" ? 1 : -1;
    const referencePrice =
      this.#quotesById.get(instrumentId)?.currentPrice ??
      instrument.initialPrice;
    const referencePriceUsd = quotePriceToUsd(
      referencePrice,
      instrument.quoteCurrency,
    );
    const suppliedNotionalUsd = grossAmountUsd ?? 0;
    const notionalUsd =
      Number.isFinite(suppliedNotionalUsd) && suppliedNotionalUsd > 0
        ? suppliedNotionalUsd
        : quantity * referencePriceUsd;
    const currentFlow = this.#netOrderFlow.get(instrumentId) ?? 0;

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
    this.#pendingSignedTradeVolume.set(
      instrumentId,
      (this.#pendingSignedTradeVolume.get(instrumentId) ?? 0) +
        direction * quantity,
    );
    this.#pendingSignedTradeNotionalUsd.set(
      instrumentId,
      (this.#pendingSignedTradeNotionalUsd.get(instrumentId) ?? 0) +
        direction * notionalUsd,
    );
  }

  getNetOrderFlow(instrumentId: string): number {
    return Math.round(this.#netOrderFlow.get(instrumentId) ?? 0);
  }

  async initialize(): Promise<Quote[]> {
    const existing = this.repository.listQuotes();
    if (existing.length > 0) {
      this.#replaceQuoteCache(existing);
      await this.marketState.initialize(existing);
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
    await this.marketState.initialize(quotes);
    return quotes;
  }

  async tick(): Promise<Quote[]> {
    await this.initialize();

    const tickAt = this.clock();
    const rawElapsedMs =
      tickAt.getTime() -
      (this.#lastTickAtMs ?? tickAt.getTime() - GAME_RULES.tickIntervalMs);
    const pricingElapsedMs = clamp(
      rawElapsedMs,
      250,
      24 * 60 * 60_000,
    );
    const microElapsedMs = clamp(rawElapsedMs, 250, 60_000);
    this.#lastTickAtMs = tickAt.getTime();
    const elapsedDays = pricingElapsedMs / (24 * 60 * 60_000);
    const microTimeScale = Math.sqrt(
      microElapsedMs / (24 * 60 * 60_000),
    );
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
        previousMarketFactor * 0.9 +
          this.#centeredRandom(
            0.006 *
              microTimeScale *
              VIRTUAL_MARKET_IMPACT_RULES.naturalVolatilityMultiplier,
          ),
        -0.001,
        0.001,
      );
      this.#marketFactors.set(instrument.market, marketFactor);
      currentMarketFactors.set(instrument.market, marketFactor);
      currentMarketDates.set(
        instrument.market,
        marketDateKey(instrument.market, tickAt),
      );
    }

    await this.marketState.refresh([...this.#quotesById.values()], tickAt);

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
        previousSectorFactor * 0.86 +
          this.#centeredRandom(
            0.004 *
              microTimeScale *
              VIRTUAL_MARKET_IMPACT_RULES.naturalVolatilityMultiplier,
          ),
        -0.0007,
        0.0007,
      );
      this.#sectorFactors.set(sectorKey, sectorFactor);

      const distanceFromClose =
        (working.currentPrice - working.previousClose) /
        working.previousClose;
      const meanReversion =
        -distanceFromClose *
        (1 - Math.exp(-pricingElapsedMs / (6 * 60 * 60_000)));
      const marketSignal = this.marketState.getSignal(
        instrument.id,
        working.currentPrice,
      );
      const dailyVolatility = clamp(
        instrument.volatility *
          10 *
          (marketSignal?.volatilityMultiplier ?? 1),
        0.008,
        0.065,
      );
      const individualNoise = this.#centeredRandom(
        dailyVolatility *
          microTimeScale *
          VIRTUAL_MARKET_IMPACT_RULES.naturalVolatilityMultiplier,
      );
      const pendingVolume =
        this.#pendingTradeVolume.get(instrument.id) ?? 0;
      const pendingSignedVolume =
        this.#pendingSignedTradeVolume.get(instrument.id) ?? 0;
      const pendingSignedNotionalUsd =
        this.#pendingSignedTradeNotionalUsd.get(instrument.id) ?? 0;
      const currentPriceUsd = quotePriceToUsd(
        working.currentPrice,
        working.quoteCurrency,
      );
      const impactDepthUsd = clamp(
        currentPriceUsd *
          Math.max(instrument.liquidity, instrument.lotSize * 20) *
          VIRTUAL_MARKET_IMPACT_RULES.depthLiquidityMultiplier,
        VIRTUAL_MARKET_IMPACT_RULES.minimumDepthUsd,
        VIRTUAL_MARKET_IMPACT_RULES.maximumDepthUsd,
      );
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
        Math.abs(pendingSignedNotionalUsd) / impactDepthUsd,
        0,
        25,
      );
      const notionalShock =
        VIRTUAL_MARKET_IMPACT_RULES.maximumNewShockRate *
        Math.tanh(pendingSignedNotionalUsd / impactDepthUsd);
      const volumeParticipationShock =
        VIRTUAL_MARKET_IMPACT_RULES.maximumVolumeParticipationShockRate *
        Math.tanh(
          (pendingSignedVolume /
            Math.max(instrument.liquidity, instrument.lotSize * 20)) *
            10,
        );
      const newTradeShock = clamp(
        notionalShock + volumeParticipationShock,
        -VIRTUAL_MARKET_IMPACT_RULES.maximumNewShockRate,
        VIRTUAL_MARKET_IMPACT_RULES.maximumNewShockRate,
      );
      const impactReservoir = clamp(
        (this.#impactReservoir.get(instrument.id) ?? 0) + newTradeShock,
        -VIRTUAL_MARKET_IMPACT_RULES.maximumImpactReservoirRate,
        VIRTUAL_MARKET_IMPACT_RULES.maximumImpactReservoirRate,
      );
      const appliedTradeImpact = clamp(
        impactReservoir,
        -VIRTUAL_MARKET_IMPACT_RULES.maximumAppliedImpactPerTickRate,
        VIRTUAL_MARKET_IMPACT_RULES.maximumAppliedImpactPerTickRate,
      );
      const naturalChangeRate = clamp(
        marketFactor +
          sectorFactor +
          individualNoise +
          meanReversion +
          (marketSignal?.expectedDailyReturn ?? 0) * elapsedDays,
        -GAME_RULES.maxTickChangeRate,
        GAME_RULES.maxTickChangeRate,
      );
      const changeRate = clamp(
        naturalChangeRate + appliedTradeImpact,
        -(
          GAME_RULES.maxTickChangeRate +
          VIRTUAL_MARKET_IMPACT_RULES.maximumAppliedImpactPerTickRate
        ),
        GAME_RULES.maxTickChangeRate +
          VIRTUAL_MARKET_IMPACT_RULES.maximumAppliedImpactPerTickRate,
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
      const remainingImpact =
        (impactReservoir - appliedTradeImpact) *
        VIRTUAL_MARKET_IMPACT_RULES.impactResidualDecay;
      if (Math.abs(remainingImpact) < 0.000001) {
        this.#impactReservoir.delete(instrument.id);
      } else {
        this.#impactReservoir.set(instrument.id, remainingImpact);
      }
      this.#netOrderFlow.set(
        instrument.id,
        (this.#netOrderFlow.get(instrument.id) ?? 0) * 0.78,
      );
      this.#pendingTradeVolume.delete(instrument.id);
      this.#pendingSignedTradeVolume.delete(instrument.id);
      this.#pendingSignedTradeNotionalUsd.delete(instrument.id);

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

  getMarketSignal(instrumentId: string): VirtualMarketSignal | undefined {
    const quote = this.#quotesById.get(instrumentId);
    return quote
      ? this.marketState.getSignal(instrumentId, quote.currentPrice)
      : undefined;
  }

  getMarketSignalVersion(): string {
    return this.marketState.signalVersion;
  }

  scheduleMarketEvent(input: ScheduleVirtualMarketEventInput) {
    return this.marketState.scheduleEvent(input);
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
