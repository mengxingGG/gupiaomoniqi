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
  #tradersLoaded = false;

  constructor(
    private readonly repository: GameRepository,
    private readonly tradeService: TradeService,
    private readonly random: () => number = Math.random,
    private readonly clock: () => Date = () => new Date(),
    private readonly enabled = true,
  ) {}

  async ensurePopulation(targetCount: number): Promise<number> {
    if (!this.enabled) {
      return this.#listAITraders().length;
    }

    const existing = this.#listAITraders();
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
          isActive: true,
          lastActionAt: null,
          nextActionAt: new Date(
            now.getTime() + (sequence % 120) * 500,
          ).toISOString(),
          totalTrades: 0,
          winCount: 0,
          lossCount: 0,
          createdAt: now.toISOString(),
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
    }

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
      trader.strategy === "CONSERVATIVE"
        ? 5
        : trader.strategy === "AGGRESSIVE"
          ? 10
          : 8;
    const buyProbability = Math.min(
      0.88,
      0.18 +
        cashRatio * 0.55 +
        trader.activityLevel * 0.018,
    );

    if (
      positions.length >= maxPositions ||
      portfolio.availableCashUsd < 10 ||
      this.random() > buyProbability
    ) {
      return null;
    }

    const candidate = this.#selectBuy(trader, positions);

    if (!candidate) {
      return null;
    }

    const quote = this.repository.getQuote(candidate.id);

    if (!quote) {
      return null;
    }

    const priceUsd = quotePriceToUsd(
      quote.currentPrice,
      quote.quoteCurrency,
    );
    const allocation = allocationRange(trader.strategy);
    const allocationRatio =
      allocation[0] +
      this.random() * (allocation[1] - allocation[0]);
    const maxSinglePositionRatio =
      trader.strategy === "AGGRESSIVE" ? 0.35 : 0.22;
    const currentPosition = positions.find(
      (position) => position.instrumentId === candidate.id,
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
      budgetUsd / (priceUsd * candidate.lotSize * 1.001),
    );
    const participationLots = Math.max(
      1,
      Math.floor(
        (candidate.liquidity *
          (0.55 + trader.riskLevel * 0.22)) /
          candidate.lotSize,
      ),
    );
    const lots = Math.min(budgetLots, participationLots);

    return lots > 0
      ? {
          side: "BUY",
          instrumentId: candidate.id,
          quantity: lots * candidate.lotSize,
        }
      : null;
  }

  #selectSell(
    trader: AITraderRecord,
    positions: PositionRecord[],
  ): TradeDecision | null {
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

        return {
          position,
          instrument,
          quote,
          profitPercent,
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
        } => item !== null,
      );

    if (sellable.length === 0) {
      return null;
    }

    const stopLoss = -(4 + trader.riskLevel * 0.8);
    const takeProfit = 3.5 + trader.riskLevel * 1.25;
    const forced = sellable
      .filter(
        (item) =>
          item.profitPercent <= stopLoss ||
          item.profitPercent >= takeProfit,
      )
      .sort(
        (left, right) =>
          Math.abs(right.profitPercent) -
          Math.abs(left.profitPercent),
      )[0];
    const discretionaryProbability =
      0.05 +
      sellable.length * 0.025 +
      trader.activityLevel * 0.008;

    if (!forced && this.random() > discretionaryProbability) {
      return null;
    }

    const selected =
      forced ?? this.#rankSellCandidate(trader, sellable);
    const sellRatio = forced
      ? selected.profitPercent <= stopLoss
        ? 1
        : 0.5 + this.random() * 0.5
      : 0.25 + this.random() * 0.5;
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

    return {
      side: "SELL",
      instrumentId: selected.instrument.id,
      quantity,
    };
  }

  #selectBuy(
    trader: AITraderRecord,
    positions: PositionRecord[],
  ): InstrumentRecord | undefined {
    const held = new Map(
      positions.map((position) => [
        position.instrumentId,
        position,
      ]),
    );
    const preferred = this.random() < 0.72;
    const candidates = this.repository
      .listInstruments()
      .filter(
        (instrument) =>
          instrument.isTradable &&
          (!preferred ||
            instrument.market === trader.preferredMarket),
      )
      .map((instrument) => {
        const quote = this.repository.getQuote(instrument.id);

        if (!quote) {
          return null;
        }

        return {
          instrument,
          score:
            this.#buyScore(trader.strategy, instrument, quote) +
            (held.has(instrument.id) ? -0.35 : 0) +
            (this.random() - 0.5) * 0.3,
        };
      })
      .filter(
        (
          item,
        ): item is {
          instrument: InstrumentRecord;
          score: number;
        } => item !== null,
      )
      .sort((left, right) => right.score - left.score);
    const shortlist = candidates.slice(0, 12);

    if (shortlist.length === 0) {
      return undefined;
    }

    const pick = Math.floor(
      Math.pow(this.random(), 2) * shortlist.length,
    );
    return shortlist[pick]?.instrument;
  }

  #buyScore(
    strategy: AITraderStrategy,
    instrument: InstrumentRecord,
    quote: Quote,
  ): number {
    const range = Math.max(
      quote.highPrice - quote.lowPrice,
      quote.currentPrice * 0.001,
    );
    const intradayPosition =
      (quote.currentPrice - quote.lowPrice) / range;
    const change = quote.changePercent / 5;
    const volumeIntensity = Math.log1p(
      quote.volume / Math.max(instrument.liquidity, 1),
    );
    const liquidityScore = Math.log10(
      Math.max(instrument.liquidity, 10),
    );

    switch (strategy) {
      case "MOMENTUM":
        return change * 1.4 + intradayPosition + volumeIntensity * 0.18;
      case "CONTRARIAN":
        return -change * 1.25 + (1 - intradayPosition) * 0.8;
      case "VALUE":
        return (
          ((quote.previousClose - quote.currentPrice) /
            quote.previousClose) *
            25 +
          liquidityScore * 0.12 -
          instrument.volatility * 80
        );
      case "TECHNICAL":
        return (
          intradayPosition * 1.15 +
          volumeIntensity * 0.32 +
          Math.sign(change) * 0.2
        );
      case "CONSERVATIVE":
        return (
          liquidityScore * 0.38 -
          Math.abs(change) * 0.65 -
          instrument.volatility * 120
        );
      case "AGGRESSIVE":
        return (
          Math.abs(change) * 0.95 +
          volumeIntensity * 0.28 +
          instrument.volatility * 100
        );
      default:
        return (
          change * 0.35 +
          intradayPosition * 0.3 +
          liquidityScore * 0.2
        );
    }
  }

  #rankSellCandidate(
    trader: AITraderRecord,
    candidates: Array<{
      position: PositionRecord;
      instrument: InstrumentRecord;
      quote: Quote;
      profitPercent: number;
    }>,
  ) {
    return [...candidates].sort((left, right) => {
      if (
        trader.strategy === "MOMENTUM" ||
        trader.strategy === "AGGRESSIVE"
      ) {
        return left.profitPercent - right.profitPercent;
      }

      if (
        trader.strategy === "VALUE" ||
        trader.strategy === "CONSERVATIVE"
      ) {
        return right.profitPercent - left.profitPercent;
      }

      return (
        Math.abs(right.profitPercent) -
        Math.abs(left.profitPercent)
      );
    })[0]!;
  }

  #nextTraderState(
    trader: AITraderRecord,
    transaction: Transaction | undefined,
    now: Date,
  ): AITraderRecord {
    const strategyMultiplier =
      trader.strategy === "CONSERVATIVE"
        ? 1.8
        : trader.strategy === "AGGRESSIVE" ||
            trader.strategy === "MOMENTUM"
          ? 0.65
          : 1;
    const baseDelayMs =
      (6_000 + (10 - trader.activityLevel) * 4_000) *
      strategyMultiplier;
    const jitterMs = this.random() * 12_000;
    const realized = transaction?.realizedProfitUsd;

    return {
      ...trader,
      lastActionAt: now.toISOString(),
      nextActionAt: new Date(
        now.getTime() + baseDelayMs + jitterMs,
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
      this.#upsertTraderStates(this.repository.listAITraders());
      this.#tradersLoaded = true;
    }
    return [...this.#volatileTraders.values()].map((trader) => ({
      ...trader,
    }));
  }

  #upsertTraderStates(traders: AITraderRecord[]): void {
    for (const trader of traders) {
      this.#volatileTraders.set(trader.id, { ...trader });
    }
  }
}

function allocationRange(
  strategy: AITraderStrategy,
): [number, number] {
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
