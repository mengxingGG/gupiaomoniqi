import { randomUUID } from "node:crypto";
import {
  quotePriceToUsd,
  type AITraderRankingItem,
  type AITraderStrategy,
  type AITradingStatus,
  type Quote,
  type StockMarket,
  type Transaction,
} from "@gupiaomoniqi/shared";
import { GAME_RULES } from "../config.js";
import { roundMoney, roundPercent } from "../domain/money.js";
import type {
  AITraderRecord,
  CreateAITraderCommit,
  GameRepository,
  InstrumentRecord,
  PositionRecord,
} from "../repositories/GameRepository.js";
import {
  TradeError,
  type TradeService,
} from "../services/TradeService.js";
import type { VirtualMarketSignal } from "../virtual-market/MarketStateService.js";

const STRATEGIES: AITraderStrategy[] = [
  "BALANCED",
  "MOMENTUM",
  "CONTRARIAN",
  "VALUE",
  "TECHNICAL",
  "CONSERVATIVE",
  "AGGRESSIVE",
];
const MARKETS: StockMarket[] = ["CN", "HK", "US", "UK"];
const STARTUP_RECOVERY_DELAY_MS = 1_000;
const STARTUP_RECOVERY_WINDOW_MS = 60_000;
const TRADERS_PER_EVENT_LOOP_YIELD = 8;
const PSYCHOLOGIES = [
  "纪律型",
  "耐心型",
  "趋势型",
  "逆向型",
  "风控型",
  "进取型",
  "均衡型",
] as const;

interface TradeDecision {
  side: "BUY" | "SELL";
  instrumentId: string;
  quantity: number;
}

interface RuleAIMarketSignalSource {
  getMarketSignal(instrumentId: string): VirtualMarketSignal | undefined;
  getMarketSignalVersion(): string;
}

interface RuleAIFactor {
  instrument: InstrumentRecord;
  quote: Quote;
  signal: VirtualMarketSignal | null;
  intradayPosition: number;
  dailyChange: number;
  volumeIntensity: number;
  liquidityScore: number;
}

interface ScoredRuleAICandidate {
  factor: RuleAIFactor;
  score: number;
}

export interface AIRoundResult {
  activeTraders: number;
  trades: number;
  buyVolume: number;
  sellVolume: number;
  completedAt: string;
  durationMs: number;
}

export class AITradingService {
  #lastRound: AIRoundResult | null = null;
  readonly #recentTradeTimes: number[] = [];
  readonly #volatileTraders = new Map<string, AITraderRecord>();
  #tradableInstruments: InstrumentRecord[] | null = null;
  readonly #tradableInstrumentsByMarket = new Map<
    StockMarket,
    InstrumentRecord[]
  >();
  #tradersLoaded = false;
  #startupScheduleRecovered = false;
  readonly #factorByInstrument = new Map<string, RuleAIFactor>();
  readonly #rankings = new Map<string, ScoredRuleAICandidate[]>();
  #factorVersion = "uninitialized";
  #sourceSignalVersion: string | null = null;

  constructor(
    private readonly repository: GameRepository,
    private readonly tradeService: TradeService,
    private readonly random: () => number = Math.random,
    private readonly clock: () => Date = () => new Date(),
    private readonly enabled = true,
    private readonly marketSignals?: RuleAIMarketSignalSource,
  ) {}

  async ensurePopulation(targetCount: number): Promise<number> {
    if (!this.enabled) {
      return this.#listAITraders().length;
    }

    const existing = this.#spreadStaleStartupSchedule(
      this.#listAITraders(),
    );
    const missing = Math.max(0, targetCount - existing.length);

    if (missing === 0) {
      return existing.length;
    }

    const now = this.clock();
    const commits: CreateAITraderCommit[] = [];

    for (let offset = 0; offset < missing; offset += 1) {
      const sequence = existing.length + offset + 1;
      const strategy = STRATEGIES[(sequence - 1) % STRATEGIES.length]!;
      const portfolioId = randomUUID();
      const traderId = randomUUID();
      const activityLevel = 3 + (sequence % 8);
      const riskLevel =
        strategy === "CONSERVATIVE"
          ? 2 + (sequence % 3)
          : strategy === "AGGRESSIVE"
            ? 7 + (sequence % 4)
            : 3 + (sequence % 6);
      const initialCashUsd = GAME_RULES.initialCashUsd;

      commits.push({
        portfolio: {
          id: portfolioId,
          accountId: null,
          mode: "VIRTUAL",
          initialCashUsd,
          availableCashUsd: initialCashUsd,
          frozenCashUsd: 0,
        },
        trader: {
          id: traderId,
          portfolioId,
          name: `${strategyLabel(strategy)}量化 ${String(sequence).padStart(5, "0")}`,
          strategy,
          psychology:
            PSYCHOLOGIES[(sequence - 1) % PSYCHOLOGIES.length]!,
          riskLevel,
          activityLevel,
          preferredMarket: MARKETS[(sequence - 1) % MARKETS.length]!,
          traderKind: "RULE",
          personaKey: null,
          isActive: true,
          lastActionAt: null,
          nextActionAt: new Date(
            now.getTime() + (sequence % 120) * 500,
          ).toISOString(),
          totalTrades: 0,
          winCount: 0,
          lossCount: 0,
          createdAt: now.toISOString(),
          investmentHorizon: investmentHorizon(strategy),
          conviction: 0,
          thesisInstrumentId: null,
          thesisScore: 0,
          thesisStartedAt: null,
          minimumHoldUntil: null,
          lastSignalVersion: null,
        },
      });
    }

    await this.repository.createAITraders(commits);
    this.#upsertTraderStates(commits.map((commit) => commit.trader));
    return existing.length + commits.length;
  }

  async runRound(
    maximumActive = GAME_RULES.aiActivePerRound,
  ): Promise<AIRoundResult> {
    const startedAt = Date.now();
    const now = this.clock();
    await this.tradeService.settleDuePositions(now);

    if (!this.enabled) {
      return this.#finishRound(0, [], now, Date.now() - startedAt);
    }

    this.#refreshFactorSnapshot();

    const due = this.#listAITraders()
      .filter(
        (trader) =>
          trader.isActive &&
          new Date(trader.nextActionAt).getTime() <= now.getTime(),
      )
      .sort(
        (left, right) =>
          new Date(left.nextActionAt).getTime() -
          new Date(right.nextActionAt).getTime(),
      )
      .slice(0, Math.max(0, maximumActive));
    const transactions: Transaction[] = [];
    const nextStates: AITraderRecord[] = [];

    for (const trader of due) {
      const decision = this.#decide(trader);
      let transaction: Transaction | undefined;

      if (decision) {
        try {
          transaction = await this.tradeService.executeAI(
            trader.id,
            trader.portfolioId,
            {
              instrumentId: decision.instrumentId,
              side: decision.side,
              quantity: decision.quantity,
              orderMode: "MARKET",
            },
            {
              settleDuePositions: false,
            },
          );
          transactions.push(transaction);
        } catch (error) {
          if (!(error instanceof TradeError)) {
            throw error;
          }
        }
      }

      nextStates.push(
        this.#nextTraderState(trader, transaction, now),
      );

      if (
        nextStates.length % TRADERS_PER_EVENT_LOOP_YIELD ===
        0
      ) {
        await yieldToEventLoop();
      }
    }

    await this.repository.updateAITraders(nextStates);
    this.#upsertTraderStates(nextStates);
    return this.#finishRound(
      due.length,
      transactions,
      now,
      Date.now() - startedAt,
    );
  }

  getStatus(): AITradingStatus {
    const traders = this.#listAITraders();
    const now = this.clock().getTime();
    this.#discardOldTradeTimes(now);
    const strategyCounts = Object.fromEntries(
      STRATEGIES.map((strategy) => [strategy, 0]),
    ) as Record<AITraderStrategy, number>;

    for (const trader of traders) {
      strategyCounts[trader.strategy] += 1;
    }
    const observedSeconds =
      this.#recentTradeTimes.length === 0
        ? 60
        : Math.max(
            1,
            Math.min(
              60,
              (now - this.#recentTradeTimes[0]!) / 1_000,
            ),
          );

    return {
      enabled: this.enabled,
      population: traders.length,
      activeTraders: this.#lastRound?.activeTraders ?? 0,
      lastRoundTrades: this.#lastRound?.trades ?? 0,
      lastRoundBuyVolume: this.#lastRound?.buyVolume ?? 0,
      lastRoundSellVolume: this.#lastRound?.sellVolume ?? 0,
      lifetimeTrades: traders.reduce(
        (total, trader) => total + trader.totalTrades,
        0,
      ),
      lastRoundAt: this.#lastRound?.completedAt ?? null,
      lastRoundDurationMs: this.#lastRound?.durationMs ?? 0,
      recentTradesPerMinute: this.#recentTradeTimes.length,
      recentTradesPerSecond:
        Math.round(
          (this.#recentTradeTimes.length / observedSeconds) * 100,
        ) / 100,
      dueBacklog: traders.filter(
        (trader) =>
          trader.isActive &&
          new Date(trader.nextActionAt).getTime() <= now,
      ).length,
      strategyCounts,
    };
  }

  getRanking(limit = 20): AITraderRankingItem[] {
    return this.#listAITraders()
      .map((trader) => {
        const portfolio = this.repository.getPortfolioById(
          trader.portfolioId,
        );
        const positionsValueUsd = this.repository
          .listPositions(trader.portfolioId)
          .reduce((total, position) => {
            const quote = this.repository.getQuote(
              position.instrumentId,
            );

            return quote
              ? total +
                  position.quantity *
                    quotePriceToUsd(
                      quote.currentPrice,
                      quote.quoteCurrency,
                    )
              : total;
          }, 0);
        const totalAssetsUsd = roundMoney(
          (portfolio?.availableCashUsd ?? 0) +
            (portfolio?.frozenCashUsd ?? 0) +
            positionsValueUsd,
        );
        const initialCashUsd =
          portfolio?.initialCashUsd ?? GAME_RULES.initialCashUsd;
        const profitLossUsd = roundMoney(
          totalAssetsUsd - initialCashUsd,
        );
        const completedSells = trader.winCount + trader.lossCount;

        return {
          id: trader.id,
          name: trader.name,
          strategy: trader.strategy,
          totalAssetsUsd,
          profitLossUsd,
          profitLossPercent:
            initialCashUsd === 0
              ? 0
              : roundPercent(
                  (profitLossUsd / initialCashUsd) * 100,
                ),
          totalTrades: trader.totalTrades,
          winRate:
            completedSells === 0
              ? 0
              : roundPercent(
                  (trader.winCount / completedSells) * 100,
                ),
          lastActionAt: trader.lastActionAt,
        };
      })
      .sort(
        (left, right) =>
          right.totalAssetsUsd - left.totalAssetsUsd,
      )
      .slice(0, Math.max(1, Math.min(100, limit)));
  }

  #decide(trader: AITraderRecord): TradeDecision | null {
    const horizon =
      trader.investmentHorizon ?? investmentHorizon(trader.strategy);
    trader.investmentHorizon = horizon;
    trader.lastSignalVersion = this.#factorVersion;
    const portfolio = this.repository.getPortfolioById(
      trader.portfolioId,
    );

    if (!portfolio) {
      return null;
    }

    const positions = this.repository.listPositions(portfolio.id);
    const sellDecision = this.#selectSell(trader, positions);

    if (sellDecision) {
      return sellDecision;
    }

    const positionsValueUsd = positions.reduce(
      (total, position) => {
        const quote = this.repository.getQuote(
          position.instrumentId,
        );
        return quote
          ? total +
              position.quantity *
                quotePriceToUsd(
                  quote.currentPrice,
                  quote.quoteCurrency,
                )
          : total;
      },
      0,
    );
    const totalAssetsUsd =
      portfolio.availableCashUsd +
      portfolio.frozenCashUsd +
      positionsValueUsd;
    const cashRatio =
      totalAssetsUsd <= 0
        ? 0
        : portfolio.availableCashUsd / totalAssetsUsd;
    const maxPositions =
      horizon === "LONG"
        ? 6
        : horizon === "SHORT"
          ? 10
          : 8;

    if (
      positions.length >= maxPositions ||
      portfolio.availableCashUsd < 10 ||
      cashRatio < 0.04
    ) {
      return null;
    }

    const candidate = this.#selectBuy(trader, positions);
    const threshold = entryThreshold(horizon, trader.strategy);

    if (!candidate || candidate.score < threshold) {
      return null;
    }

    const { instrument, quote } = candidate.factor;
    const conviction = clamp(
      0.3 + (candidate.score - threshold) * 0.32,
      0.2,
      0.95,
    );

    const priceUsd = quotePriceToUsd(
      quote.currentPrice,
      quote.quoteCurrency,
    );
    const allocation = allocationRange(trader.strategy, horizon);
    const allocationRatio =
      allocation[0] + conviction * (allocation[1] - allocation[0]);
    const maxSinglePositionRatio =
      horizon === "LONG"
        ? 0.3
        : trader.strategy === "AGGRESSIVE"
          ? 0.35
          : 0.22;
    const currentPosition = positions.find(
      (position) => position.instrumentId === instrument.id,
    );
    const currentValueUsd =
      (currentPosition?.quantity ?? 0) * priceUsd;
    const exposureRoomUsd = Math.max(
      0,
      totalAssetsUsd * maxSinglePositionRatio -
        currentValueUsd,
    );
    const budgetUsd = Math.min(
      portfolio.availableCashUsd * allocationRatio,
      exposureRoomUsd,
      Math.max(0, portfolio.availableCashUsd - 1),
    );
    const budgetLots = Math.floor(
      budgetUsd / (priceUsd * instrument.lotSize * 1.001),
    );
    const participationLots = Math.max(
      1,
      Math.floor(
        (instrument.liquidity *
          (0.55 + trader.riskLevel * 0.22)) /
          instrument.lotSize,
      ),
    );
    const lots = Math.min(budgetLots, participationLots);

    if (lots > 0) {
      const now = this.clock();
      const continuingThesis =
        trader.thesisInstrumentId === instrument.id;
      trader.conviction = conviction;
      trader.thesisInstrumentId = instrument.id;
      trader.thesisScore = candidate.score;
      trader.thesisStartedAt = continuingThesis
        ? (trader.thesisStartedAt ?? now.toISOString())
        : now.toISOString();
      trader.minimumHoldUntil = continuingThesis
        ? (trader.minimumHoldUntil ??
          new Date(
            now.getTime() + minimumHoldDurationMs(horizon),
          ).toISOString())
        : new Date(
            now.getTime() + minimumHoldDurationMs(horizon),
          ).toISOString();
    }

    return lots > 0
      ? {
          side: "BUY",
          instrumentId: instrument.id,
          quantity: lots * instrument.lotSize,
        }
      : null;
  }

  #selectSell(
    trader: AITraderRecord,
    positions: PositionRecord[],
  ): TradeDecision | null {
    const now = this.clock();
    const horizon =
      trader.investmentHorizon ?? investmentHorizon(trader.strategy);
    const sellable = positions
      .map((position) => {
        const instrument = this.repository.getInstrumentById(
          position.instrumentId,
        );
        const quote = this.repository.getQuote(position.instrumentId);

        if (
          !instrument ||
          !quote ||
          position.availableQuantity < instrument.lotSize
        ) {
          return null;
        }

        const currentPriceUsd = quotePriceToUsd(
          quote.currentPrice,
          quote.quoteCurrency,
        );
        const profitPercent =
          ((currentPriceUsd - position.averageCostUsd) /
            position.averageCostUsd) *
          100;
        const factor =
          this.#factorByInstrument.get(instrument.id) ??
          this.#buildFactor(instrument, quote);
        const score = this.#score(trader.strategy, factor);
        const signal = factor.signal;
        const riskStop =
          profitPercent <= -(7 + trader.riskLevel * 0.75);
        const severeSignal =
          score <= -0.65 ||
          (signal?.eventSentiment ?? 0) <= -0.045;
        const thesisInvalid = score <= exitThreshold(horizon);
        const overvalued =
          (signal?.fundamentalGap ??
            (quote.previousClose - quote.currentPrice) /
              Math.max(quote.currentPrice, 0.0001)) <= -0.12 &&
          score < 0.12;
        const adaptiveProfitTarget =
          horizon === "SHORT" ? 5 : horizon === "SWING" ? 12 : 25;
        const matureProfit =
          profitPercent >= adaptiveProfitTarget && score < 0.2;
        const minimumHoldActive =
          trader.thesisInstrumentId === instrument.id &&
          trader.minimumHoldUntil !== null &&
          trader.minimumHoldUntil !== undefined &&
          new Date(trader.minimumHoldUntil).getTime() > now.getTime();

        return {
          position,
          instrument,
          quote,
          profitPercent,
          score,
          riskStop,
          severeSignal,
          thesisInvalid,
          overvalued,
          matureProfit,
          minimumHoldActive,
        };
      })
      .filter(
        (
          item,
        ): item is {
          position: PositionRecord;
          instrument: InstrumentRecord;
          quote: Quote;
          profitPercent: number;
          score: number;
          riskStop: boolean;
          severeSignal: boolean;
          thesisInvalid: boolean;
          overvalued: boolean;
          matureProfit: boolean;
          minimumHoldActive: boolean;
        } => item !== null,
      );

    if (sellable.length === 0) {
      return null;
    }

    const exits = sellable
      .filter(
        (item) =>
          item.riskStop ||
          item.severeSignal ||
          (!item.minimumHoldActive &&
            (item.thesisInvalid || item.overvalued || item.matureProfit)),
      )
      .sort(
        (left, right) =>
          left.score - right.score ||
          left.profitPercent - right.profitPercent,
      );
    const selected = exits[0];

    if (!selected) {
      const thesis = trader.thesisInstrumentId
        ? sellable.find(
            (item) => item.instrument.id === trader.thesisInstrumentId,
          )
        : undefined;
      if (thesis) {
        trader.thesisScore = thesis.score;
        trader.conviction = clamp(
          (trader.conviction ?? 0.5) * 0.75 +
            normalizedConviction(thesis.score) * 0.25,
          0.1,
          0.95,
        );
      }
      return null;
    }

    const sellRatio =
      selected.riskStop || selected.severeSignal
        ? 1
        : horizon === "LONG"
          ? 0.35
          : horizon === "SWING"
            ? 0.55
            : 0.8;
    const lots = Math.max(
      1,
      Math.floor(
        (selected.position.availableQuantity * sellRatio) /
          selected.instrument.lotSize,
      ),
    );
    const quantity = Math.min(
      selected.position.availableQuantity,
      lots * selected.instrument.lotSize,
    );

    if (trader.thesisInstrumentId === selected.instrument.id) {
      trader.conviction = 0;
      trader.thesisInstrumentId = null;
      trader.thesisScore = 0;
      trader.thesisStartedAt = null;
      trader.minimumHoldUntil = null;
    }

    return {
      side: "SELL",
      instrumentId: selected.instrument.id,
      quantity,
    };
  }

  #selectBuy(
    trader: AITraderRecord,
    positions: PositionRecord[],
  ): ScoredRuleAICandidate | undefined {
    const held = new Set(positions.map((position) => position.instrumentId));
    if (trader.thesisInstrumentId) {
      const factor = this.#factorByInstrument.get(trader.thesisInstrumentId);
      if (factor) {
        const score =
          this.#score(trader.strategy, factor) -
          (held.has(factor.instrument.id) ? 0.45 : 0);
        if (
          score >=
          entryThreshold(
            trader.investmentHorizon ??
              investmentHorizon(trader.strategy),
            trader.strategy,
          ) *
            0.85
        ) {
          return { factor, score };
        }
      }
    }
    const preferred = this.random() < 0.72;
    const candidates = this.#rankedCandidates(
      trader.strategy,
      preferred ? trader.preferredMarket : undefined,
    );
    const shortlist = candidates
      .slice(0, 24)
      .map((candidate) => ({
        factor: candidate.factor,
        score:
          candidate.score -
          (held.has(candidate.factor.instrument.id) ? 0.45 : 0),
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, 8);

    if (shortlist.length === 0) {
      return undefined;
    }

    const pick = Math.floor(Math.pow(this.random(), 2.5) * shortlist.length);
    return shortlist[pick];
  }

  #candidatePool(market?: StockMarket): InstrumentRecord[] {
    if (!this.#tradableInstruments) {
      this.#tradableInstruments = this.repository
        .listInstruments()
        .filter((instrument) => instrument.isTradable);
      for (const candidateMarket of MARKETS) {
        this.#tradableInstrumentsByMarket.set(
          candidateMarket,
          this.#tradableInstruments.filter(
            (instrument) => instrument.market === candidateMarket,
          ),
        );
      }
    }

    return market
      ? (this.#tradableInstrumentsByMarket.get(market) ?? [])
      : this.#tradableInstruments;
  }

  #buildFactor(
    instrument: InstrumentRecord,
    quote: Quote,
  ): RuleAIFactor {
    const range = Math.max(
      quote.highPrice - quote.lowPrice,
      quote.currentPrice * 0.001,
    );
    const intradayPosition =
      (quote.currentPrice - quote.lowPrice) / range;
    const volumeIntensity = Math.log1p(
      quote.volume / Math.max(instrument.liquidity, 1),
    );
    const liquidityScore = Math.log10(
      Math.max(instrument.liquidity, 10),
    );
    return {
      instrument,
      quote,
      signal: this.marketSignals?.getMarketSignal(instrument.id) ?? null,
      intradayPosition,
      dailyChange: quote.changePercent / 100,
      volumeIntensity,
      liquidityScore,
    };
  }

  #score(strategy: AITraderStrategy, factor: RuleAIFactor): number {
    const {
      instrument,
      signal,
      intradayPosition,
      dailyChange,
      volumeIntensity,
      liquidityScore,
    } = factor;
    const expected = signal?.expectedDailyReturn ?? 0;
    const fundamentalGap =
      signal?.fundamentalGap ??
      (factor.quote.previousClose - factor.quote.currentPrice) /
        Math.max(factor.quote.currentPrice, 0.0001);
    const ownership = signal?.ownershipPremium ?? 0;
    const event = signal?.eventSentiment ?? 0;
    const quality = signal
      ? signal.qualityScore - signal.leverageRisk * 0.55
      : 0;

    switch (strategy) {
      case "MOMENTUM":
        return (
          dailyChange * 22 +
          expected * 70 +
          intradayPosition * 0.32 +
          event * 8 +
          volumeIntensity * 0.06 +
          liquidityScore * 0.04
        );
      case "CONTRARIAN":
        return (
          -dailyChange * 16 +
          fundamentalGap * 3.2 +
          expected * 65 +
          (1 - intradayPosition) * 0.22
        );
      case "VALUE":
        return (
          fundamentalGap * 5 +
          expected * 80 +
          quality * 0.45 +
          ownership * 2.5 +
          liquidityScore * 0.035 -
          instrument.volatility * 35
        );
      case "TECHNICAL":
        return (
          dailyChange * 13 +
          expected * 55 +
          intradayPosition * 0.28 +
          volumeIntensity * 0.1 +
          Math.sign(dailyChange) * 0.08 +
          liquidityScore * 0.035
        );
      case "CONSERVATIVE":
        return (
          expected * 65 +
          fundamentalGap * 2 +
          quality * 0.5 +
          ownership * 1.5 +
          liquidityScore * 0.055 -
          Math.abs(dailyChange) * 8 -
          instrument.volatility * 60
        );
      case "AGGRESSIVE":
        return (
          expected * 75 +
          Math.abs(dailyChange) * 12 +
          event * 10 +
          volumeIntensity * 0.1 +
          instrument.volatility * 55 +
          liquidityScore * 0.025
        );
      default:
        return (
          expected * 75 +
          fundamentalGap * 2.4 +
          dailyChange * 7 +
          ownership * 2 +
          event * 6 +
          intradayPosition * 0.12 +
          liquidityScore * 0.045
        );
    }
  }

  #rankedCandidates(
    strategy: AITraderStrategy,
    market?: StockMarket,
  ): ScoredRuleAICandidate[] {
    const key = `${strategy}:${market ?? "ALL"}`;
    const cached = this.#rankings.get(key);
    if (cached) {
      return cached;
    }
    const ranked = this.#candidatePool(market)
      .map((instrument) => this.#factorByInstrument.get(instrument.id))
      .filter((factor): factor is RuleAIFactor => factor !== undefined)
      .map((factor) => ({
        factor,
        score: this.#score(strategy, factor),
      }))
      .sort((left, right) => right.score - left.score);
    this.#rankings.set(key, ranked);
    return ranked;
  }

  #refreshFactorSnapshot(): void {
    const sourceSignalVersion =
      this.marketSignals?.getMarketSignalVersion() ?? null;
    if (
      sourceSignalVersion !== null &&
      sourceSignalVersion === this.#sourceSignalVersion
    ) {
      return;
    }
    const quoteVersion = this.repository.listQuotes().reduce(
      (version, quote) => ({
        latest:
          quote.updatedAt > version.latest
            ? quote.updatedAt
            : version.latest,
        checksum:
          version.checksum +
          quote.currentPrice * 31 +
          quote.changePercent * 17 +
          quote.volume * 0.000001,
      }),
      { latest: "", checksum: 0 },
    );
    const version = `${this.marketSignals?.getMarketSignalVersion() ?? "legacy"}:${quoteVersion.latest}:${quoteVersion.checksum.toFixed(6)}`;
    if (version === this.#factorVersion) {
      return;
    }
    this.#factorByInstrument.clear();
    this.#rankings.clear();
    for (const instrument of this.#candidatePool()) {
      const quote = this.repository.getQuote(instrument.id);
      if (quote) {
        this.#factorByInstrument.set(
          instrument.id,
          this.#buildFactor(instrument, quote),
        );
      }
    }
    this.#factorVersion = version;
    this.#sourceSignalVersion = sourceSignalVersion;
  }

  #nextTraderState(
    trader: AITraderRecord,
    transaction: Transaction | undefined,
    now: Date,
  ): AITraderRecord {
    const horizon =
      trader.investmentHorizon ?? investmentHorizon(trader.strategy);
    const [minimumDelayMs, maximumDelayMs] =
      horizon === "SHORT"
        ? [15_000, 60_000]
        : horizon === "SWING"
          ? [2 * 60_000, 8 * 60_000]
          : [15 * 60_000, 45 * 60_000];
    const activityScale = clamp(1.2 - trader.activityLevel * 0.035, 0.75, 1.1);
    const nextDelayMs =
      (minimumDelayMs +
        this.random() * (maximumDelayMs - minimumDelayMs)) *
      activityScale;
    const realized = transaction?.realizedProfitUsd;

    return {
      ...trader,
      lastActionAt: now.toISOString(),
      nextActionAt: new Date(
        now.getTime() + nextDelayMs,
      ).toISOString(),
      totalTrades: trader.totalTrades + (transaction ? 1 : 0),
      winCount:
        trader.winCount +
        (realized !== null && realized !== undefined && realized > 0
          ? 1
          : 0),
      lossCount:
        trader.lossCount +
        (realized !== null && realized !== undefined && realized < 0
          ? 1
          : 0),
    };
  }

  #finishRound(
    activeTraders: number,
    transactions: Transaction[],
    now: Date,
    durationMs: number,
  ): AIRoundResult {
    const result = {
      activeTraders,
      trades: transactions.length,
      buyVolume: transactions
        .filter((transaction) => transaction.side === "BUY")
        .reduce(
          (total, transaction) => total + transaction.quantity,
          0,
        ),
      sellVolume: transactions
        .filter((transaction) => transaction.side === "SELL")
        .reduce(
          (total, transaction) => total + transaction.quantity,
          0,
        ),
      completedAt: now.toISOString(),
      durationMs,
    };
    for (const _transaction of transactions) {
      this.#recentTradeTimes.push(now.getTime());
    }
    this.#discardOldTradeTimes(now.getTime());
    this.#lastRound = result;
    return result;
  }

  #discardOldTradeTimes(now: number): void {
    const cutoff = now - 60_000;
    let removeCount = 0;

    while (
      removeCount < this.#recentTradeTimes.length &&
      this.#recentTradeTimes[removeCount]! < cutoff
    ) {
      removeCount += 1;
    }

    if (removeCount > 0) {
      this.#recentTradeTimes.splice(0, removeCount);
    }
  }

  #listAITraders(): AITraderRecord[] {
    if (!this.#tradersLoaded) {
      this.#upsertTraderStates(
        this.repository
          .listAITraders()
          .filter((trader) => trader.traderKind !== "LLM"),
      );
      this.#tradersLoaded = true;
    }
    return [...this.#volatileTraders.values()];
  }

  #spreadStaleStartupSchedule(
    traders: AITraderRecord[],
  ): AITraderRecord[] {
    if (this.#startupScheduleRecovered) {
      return traders;
    }
    this.#startupScheduleRecovered = true;

    const now = this.clock().getTime();
    const stale = traders
      .filter((trader) => {
        if (!trader.isActive) {
          return false;
        }
        const nextActionAt = new Date(trader.nextActionAt).getTime();
        return (
          !Number.isFinite(nextActionAt) || nextActionAt <= now
        );
      })
      .sort((left, right) => {
        const leftAt = new Date(left.nextActionAt).getTime();
        const rightAt = new Date(right.nextActionAt).getTime();
        const normalizedLeft = Number.isFinite(leftAt)
          ? leftAt
          : Number.NEGATIVE_INFINITY;
        const normalizedRight = Number.isFinite(rightAt)
          ? rightAt
          : Number.NEGATIVE_INFINITY;
        return (
          normalizedLeft - normalizedRight ||
          left.id.localeCompare(right.id)
        );
      });

    if (stale.length === 0) {
      return traders;
    }

    const recoveredAtById = new Map(
      stale.map((trader, index) => [
        trader.id,
        now +
          STARTUP_RECOVERY_DELAY_MS +
          Math.floor(
            (index * STARTUP_RECOVERY_WINDOW_MS) / stale.length,
          ),
      ]),
    );
    const recovered = traders.map((trader) => {
      const recoveredAt = recoveredAtById.get(trader.id);
      return recoveredAt === undefined
        ? trader
        : {
            ...trader,
            nextActionAt: new Date(recoveredAt).toISOString(),
          };
    });

    this.#upsertTraderStates(recovered);
    return recovered;
  }

  #upsertTraderStates(traders: AITraderRecord[]): void {
    for (const trader of traders) {
      this.#volatileTraders.set(trader.id, { ...trader });
    }
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function allocationRange(
  strategy: AITraderStrategy,
  horizon: "SHORT" | "SWING" | "LONG",
): [number, number] {
  if (horizon === "SHORT") {
    return strategy === "AGGRESSIVE" ? [0.1, 0.2] : [0.05, 0.13];
  }
  if (horizon === "LONG") {
    return strategy === "CONSERVATIVE" ? [0.12, 0.22] : [0.16, 0.3];
  }
  switch (strategy) {
    case "CONSERVATIVE":
      return [0.08, 0.16];
    case "AGGRESSIVE":
      return [0.24, 0.42];
    case "MOMENTUM":
      return [0.16, 0.32];
    case "VALUE":
      return [0.14, 0.26];
    default:
      return [0.12, 0.24];
  }
}

function investmentHorizon(
  strategy: AITraderStrategy,
): "SHORT" | "SWING" | "LONG" {
  if (strategy === "VALUE" || strategy === "CONSERVATIVE") {
    return "LONG";
  }
  if (strategy === "AGGRESSIVE") {
    return "SHORT";
  }
  return "SWING";
}

function entryThreshold(
  horizon: "SHORT" | "SWING" | "LONG",
  strategy: AITraderStrategy,
): number {
  const horizonThreshold =
    horizon === "SHORT" ? 0.16 : horizon === "LONG" ? 0.08 : 0.12;
  return strategy === "CONSERVATIVE"
    ? horizonThreshold + 0.08
    : horizonThreshold;
}

function exitThreshold(horizon: "SHORT" | "SWING" | "LONG"): number {
  return horizon === "SHORT" ? -0.04 : horizon === "LONG" ? -0.22 : -0.12;
}

function minimumHoldDurationMs(
  horizon: "SHORT" | "SWING" | "LONG",
): number {
  return horizon === "SHORT"
    ? 20 * 60_000
    : horizon === "SWING"
      ? 8 * 60 * 60_000
      : 3 * 24 * 60 * 60_000;
}

function normalizedConviction(score: number): number {
  return 1 / (1 + Math.exp(-score * 1.8));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function strategyLabel(strategy: AITraderStrategy): string {
  return {
    BALANCED: "均衡",
    MOMENTUM: "动量",
    CONTRARIAN: "逆向",
    VALUE: "价值",
    TECHNICAL: "技术",
    CONSERVATIVE: "稳健",
    AGGRESSIVE: "进取",
  }[strategy];
}
