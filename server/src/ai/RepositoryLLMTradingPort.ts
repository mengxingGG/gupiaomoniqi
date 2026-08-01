import { randomUUID } from "node:crypto";
import {
  maximumAffordableLots,
  quotePriceToUsd,
} from "@gupiaomoniqi/shared";
import { roundMoney, roundPercent } from "../domain/money.js";
import type {
  AITraderDecisionRecord,
  AITraderRecord,
  CreateAITraderCommit,
  GameRepository,
} from "../repositories/GameRepository.js";
import type { TradeService } from "../services/TradeService.js";
import type { VirtualMarketEngine } from "../virtual-market/VirtualMarketEngine.js";
import type { LLMTradeDecision } from "./LLMDecisionSchema.js";
import type {
  LLMCandleContext,
  LLMMarketCandidate,
  LLMTradingContext,
} from "./LLMMarketContext.js";
import type { LLMTraderPersona } from "./LLMPersonas.js";
import type {
  LLMAgentRunCompletion,
  LLMDecisionExecutionResult,
  LLMTraderAgent,
  LLMTradingPort,
} from "./LLMTradingService.js";

const MINIMUM_CONFIDENCE = 0.55;

export class RepositoryLLMTradingPort implements LLMTradingPort {
  constructor(
    private readonly repository: GameRepository,
    private readonly tradeService: TradeService,
    private readonly engine?: VirtualMarketEngine,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async ensureAgents(
    personas: readonly LLMTraderPersona[],
  ): Promise<void> {
    const existingKeys = new Set(
      this.repository
        .listAITraders()
        .filter((trader) => trader.traderKind === "LLM")
        .map((trader) => trader.personaKey)
        .filter((key): key is string => Boolean(key)),
    );
    const now = this.clock();
    const commits: CreateAITraderCommit[] = personas
      .filter((persona) => !existingKeys.has(persona.key))
      .map((persona, index) => {
        const portfolioId = randomUUID();
        const traderId = randomUUID();
        return {
          portfolio: {
            id: portfolioId,
            accountId: null,
            mode: "VIRTUAL" as const,
            initialCashUsd: persona.initialCashUsd,
            availableCashUsd: persona.initialCashUsd,
            frozenCashUsd: 0,
          },
          trader: {
            id: traderId,
            portfolioId,
            name: `智慧交易者·${persona.name}`,
            strategy: persona.strategy,
            psychology: persona.psychology,
            riskLevel: persona.riskLevel,
            activityLevel: persona.activityLevel,
            preferredMarket: persona.preferredMarket,
            traderKind: "LLM" as const,
            personaKey: persona.key,
            isActive: true,
            lastActionAt: null,
            nextActionAt: new Date(
              now.getTime() + index * 2_000,
            ).toISOString(),
            totalTrades: 0,
            winCount: 0,
            lossCount: 0,
            createdAt: now.toISOString(),
          },
        };
      });
    await this.repository.createAITraders(commits);
  }

  async listDueAgents(
    at: string,
    limit: number,
  ): Promise<LLMTraderAgent[]> {
    const cutoff = new Date(at).getTime();
    return this.repository
      .listAITraders()
      .filter(
        (trader) =>
          trader.traderKind === "LLM" &&
          trader.isActive &&
          Boolean(trader.personaKey) &&
          new Date(trader.nextActionAt).getTime() <= cutoff,
      )
      .sort((left, right) =>
        left.nextActionAt.localeCompare(right.nextActionAt),
      )
      .slice(0, Math.max(0, limit))
      .map((trader) => ({
        traderId: trader.id,
        personaKey: trader.personaKey!,
        scheduledAt: trader.nextActionAt,
      }));
  }

  async buildContext(
    agent: LLMTraderAgent,
  ): Promise<LLMTradingContext> {
    const trader = this.#requireTrader(agent);
    const portfolio = this.repository.getPortfolioById(trader.portfolioId);
    if (!portfolio) {
      throw new Error("LLM_PORTFOLIO_NOT_FOUND");
    }
    const positionRecords = this.repository.listPositions(portfolio.id);
    const positions = positionRecords.flatMap((position) => {
      const instrument = this.repository.getInstrumentById(
        position.instrumentId,
      );
      const quote = this.repository.getQuote(position.instrumentId);
      if (!instrument || !quote) {
        return [];
      }
      const currentPriceUsd = quotePriceToUsd(
        quote.currentPrice,
        quote.quoteCurrency,
      );
      const marketValueUsd = roundMoney(
        currentPriceUsd * position.quantity,
      );
      const costUsd = position.averageCostUsd * position.quantity;
      return [
        {
          instrumentId: instrument.id,
          symbol: instrument.symbol,
          name: instrument.name,
          market: instrument.market,
          quantity: position.quantity,
          availableQuantity: position.availableQuantity,
          frozenQuantity: position.frozenQuantity,
          averageCostUsd: position.averageCostUsd,
          currentPrice: quote.currentPrice,
          marketValueUsd,
          profitLossPercent:
            costUsd <= 0
              ? 0
              : roundPercent(
                  ((marketValueUsd - costUsd) / costUsd) * 100,
                ),
        },
      ];
    });
    const positionsValueUsd = roundMoney(
      positions.reduce((total, position) => total + position.marketValueUsd, 0),
    );
    const totalAssetsUsd = roundMoney(
      portfolio.availableCashUsd +
        portfolio.frozenCashUsd +
        positionsValueUsd,
    );
    const mandatoryIds = new Set(positions.map((item) => item.instrumentId));
    const openOrders = this.repository.listOrders(portfolio.id, "OPEN");
    for (const order of openOrders) {
      mandatoryIds.add(order.instrumentId);
    }
    const instruments = this.repository.listInstruments();
    const ranked = instruments
      .map((instrument) => ({
        instrument,
        quote: this.repository.getQuote(instrument.id),
      }))
      .filter(
        (entry): entry is typeof entry & { quote: NonNullable<typeof entry.quote> } =>
          Boolean(entry.quote),
      )
      .sort((left, right) => {
        const leftMandatory = mandatoryIds.has(left.instrument.id) ? 1 : 0;
        const rightMandatory = mandatoryIds.has(right.instrument.id) ? 1 : 0;
        if (leftMandatory !== rightMandatory) {
          return rightMandatory - leftMandatory;
        }
        const leftPreferred =
          left.instrument.market === trader.preferredMarket ? 1 : 0;
        const rightPreferred =
          right.instrument.market === trader.preferredMarket ? 1 : 0;
        if (leftPreferred !== rightPreferred) {
          return rightPreferred - leftPreferred;
        }
        const leftScore =
          Math.abs(left.quote.changePercent) * 1_000 +
          Math.log10(Math.max(1, left.quote.volume));
        const rightScore =
          Math.abs(right.quote.changePercent) * 1_000 +
          Math.log10(Math.max(1, right.quote.volume));
        return rightScore - leftScore;
      });
    const candidates = ranked
      .slice(0, 40)
      .map(({ instrument, quote }) =>
        this.#candidate(instrument.id, quote.currentPrice),
      )
      .filter((item): item is LLMMarketCandidate => Boolean(item));

    const marketOverview: Record<
      string,
      { advancing: number; declining: number; unchanged: number; averageChangePercent: number }
    > = {};
    for (const market of ["CN", "HK", "US", "UK"] as const) {
      const quotes = this.repository
        .listQuotes()
        .filter((quote) => quote.market === market);
      marketOverview[market] = {
        advancing: quotes.filter((quote) => quote.changePercent > 0).length,
        declining: quotes.filter((quote) => quote.changePercent < 0).length,
        unchanged: quotes.filter((quote) => quote.changePercent === 0).length,
        averageChangePercent:
          quotes.length === 0
            ? 0
            : roundPercent(
                quotes.reduce(
                  (total, quote) => total + quote.changePercent,
                  0,
                ) / quotes.length,
              ),
      };
    }

    return {
      now: this.clock().toISOString(),
      portfolio: {
        availableCashUsd: portfolio.availableCashUsd,
        frozenCashUsd: portfolio.frozenCashUsd,
        totalAssetsUsd,
        profitLossUsd: roundMoney(
          totalAssetsUsd - portfolio.initialCashUsd,
        ),
        profitLossPercent:
          portfolio.initialCashUsd <= 0
            ? 0
            : roundPercent(
                ((totalAssetsUsd - portfolio.initialCashUsd) /
                  portfolio.initialCashUsd) *
                  100,
              ),
      },
      positions,
      openOrders: openOrders.map((order) => ({
        id: order.id,
        instrumentId: order.instrumentId,
        side: order.side,
        orderType: order.orderMode,
        limitPrice: order.limitPrice,
        quantity: order.quantity,
        filledQuantity: order.filledQuantity,
        status: order.status,
      })),
      marketOverview,
      candidates,
      recentActivity: this.repository
        .listAITraderDecisions(trader.id, 20)
        .reverse()
        .map((decision) => ({
          at: decision.decidedAt,
          action: decision.action,
          instrumentId: decision.instrumentId,
          result: decision.result,
          reason: decision.reason ?? undefined,
        })),
      rules: {
        feeRate: 0.0003,
        minimumFeeUsd: 1,
        dailyPriceLimitPercent: 10,
        lotTrading: true,
        cnSettlement: "T+1",
        otherSettlement: "T+0",
      },
    };
  }

  ensureCashFloor(
    traderId: string,
    thresholdUsd: number,
    topUpUsd: number,
  ): Promise<boolean> {
    return this.tradeService.ensureAIPortfolioCashFloor(
      traderId,
      thresholdUsd,
      topUpUsd,
    );
  }

  async executeDecision(
    agent: LLMTraderAgent,
    persona: LLMTraderPersona,
    context: LLMTradingContext,
    decision: LLMTradeDecision,
  ): Promise<LLMDecisionExecutionResult> {
    if (decision.action === "HOLD") {
      return { state: "HOLD", detail: decision.reason };
    }
    if (decision.confidence < MINIMUM_CONFIDENCE) {
      return { state: "REJECTED", detail: "置信度低于执行阈值" };
    }
    const trader = this.#requireTrader(agent);
    const candidate = context.candidates.find(
      (item) => item.instrumentId === decision.instrumentId,
    );
    if (!candidate) {
      return { state: "REJECTED", detail: "标的不在候选集" };
    }
    if (
      decision.limitPrice !== null &&
      (decision.limitPrice < candidate.previousClose * 0.9 ||
        decision.limitPrice > candidate.previousClose * 1.1)
    ) {
      return { state: "REJECTED", detail: "限价超出当日价格边界" };
    }

    let quantity: number;
    if (decision.action === "BUY") {
      const occupiedInstruments = new Set(
        context.positions
          .filter((position) => position.quantity > 0)
          .map((position) => position.instrumentId),
      );
      for (const order of context.openOrders) {
        if (order.side === "BUY" && order.status === "OPEN") {
          occupiedInstruments.add(order.instrumentId);
        }
      }
      if (
        !occupiedInstruments.has(candidate.instrumentId) &&
        occupiedInstruments.size >= persona.maximumPositions
      ) {
        return { state: "REJECTED", detail: "持仓标的数量已达风控上限" };
      }
      const existingPositionValue =
        context.positions.find(
          (position) => position.instrumentId === candidate.instrumentId,
        )?.marketValueUsd ?? 0;
      const pendingBuyValue = context.openOrders
        .filter(
          (order) =>
            order.side === "BUY" &&
            order.status === "OPEN" &&
            order.instrumentId === candidate.instrumentId,
        )
        .reduce(
          (sum, order) =>
            sum +
            quotePriceToUsd(
              order.limitPrice ?? candidate.currentPrice,
              candidate.quoteCurrency as "CNY" | "USD",
            ) *
              Math.max(0, order.quantity - order.filledQuantity),
          0,
        );
      const maximumPositionUsd =
        context.portfolio.totalAssetsUsd *
        (persona.maximumSinglePositionPercent / 100);
      const budgetUsd = Math.max(
        0,
        Math.min(
          context.portfolio.availableCashUsd *
            (decision.allocationPercent / 100),
          maximumPositionUsd - existingPositionValue - pendingBuyValue,
        ),
      );
      const price = decision.limitPrice ?? candidate.currentPrice;
      const grossPerLotUsd =
        quotePriceToUsd(price, candidate.quoteCurrency as "CNY" | "USD") *
        candidate.lotSize;
      const lots = maximumAffordableLots(budgetUsd, grossPerLotUsd);
      quantity = lots * candidate.lotSize;
    } else {
      const position = context.positions.find(
        (item) => item.instrumentId === candidate.instrumentId,
      );
      if (!position) {
        return { state: "REJECTED", detail: "没有可卖持仓" };
      }
      const availableLots = Math.floor(
        position.availableQuantity / candidate.lotSize,
      );
      const lots =
        decision.positionPercent === 100
          ? availableLots
          : Math.floor(
              availableLots * (decision.positionPercent / 100),
            );
      quantity = lots * candidate.lotSize;
    }
    if (quantity <= 0) {
      return { state: "REJECTED", detail: "不足一手，未执行" };
    }
    const result = await this.tradeService.placeAIOrder(
      trader.id,
      trader.portfolioId,
      {
        instrumentId: candidate.instrumentId,
        side: decision.action,
        quantity,
        orderMode: decision.orderType!,
        limitPrice: decision.limitPrice ?? undefined,
        idempotencyKey: llmRunIdempotencyKey(agent),
      },
      { persistTransaction: true },
    );
    return {
      state: result.order.status === "OPEN" ? "PENDING" : "EXECUTED",
      orderId: result.order.id,
      transactionId: result.transaction?.id,
      detail: decision.reason,
    };
  }

  async completeAgentRun(
    agent: LLMTraderAgent,
    completion: LLMAgentRunCompletion,
  ): Promise<void> {
    const trader = this.#requireTrader(agent);
    const next: AITraderRecord = {
      ...trader,
      lastActionAt: completion.completedAt,
      nextActionAt: completion.nextActionAt,
      totalTrades:
        trader.totalTrades +
        (completion.state === "EXECUTED" ||
        completion.state === "PENDING"
          ? 1
          : 0),
    };
    const decision: AITraderDecisionRecord = {
      id: randomUUID(),
      traderId: trader.id,
      decidedAt: completion.completedAt,
      action: completion.decision?.action ?? "ERROR",
      instrumentId: completion.decision?.instrumentId ?? null,
      result: completion.state,
      reason: completion.decision?.reason ?? null,
      modelId: completion.modelId,
      detail: completion.detail,
    };
    await this.repository.updateAITrader(next);
    await this.repository.appendAITraderDecision(decision);
  }

  #requireTrader(agent: LLMTraderAgent): AITraderRecord {
    const trader = this.repository.getAITrader(agent.traderId);
    if (
      !trader ||
      trader.traderKind !== "LLM" ||
      trader.personaKey !== agent.personaKey ||
      trader.nextActionAt !== agent.scheduledAt
    ) {
      throw new Error("LLM_TRADER_NOT_FOUND");
    }
    return trader;
  }

  #candidate(
    instrumentId: string,
    _currentPrice: number,
  ): LLMMarketCandidate | null {
    const instrument = this.repository.getInstrumentById(instrumentId);
    const quote = this.repository.getQuote(instrumentId);
    if (!instrument || !quote) {
      return null;
    }
    const dailyBars = this.repository
      .listCandles(instrumentId, "DAY")
      .slice(-20)
      .map(toCandleContext);
    const minuteBars = this.repository
      .listCandles(instrumentId, "MINUTE")
      .slice(-20)
      .map(toCandleContext);
    const closes = dailyBars.map((bar) => bar.close);
    return {
      instrumentId,
      symbol: instrument.symbol,
      name: instrument.name,
      market: instrument.market,
      quoteCurrency: instrument.quoteCurrency,
      settlementCycle: instrument.settlementCycle,
      lotSize: instrument.lotSize,
      currentPrice: quote.currentPrice,
      previousClose: quote.previousClose,
      changePercent: quote.changePercent,
      openPrice: quote.openPrice,
      highPrice: quote.highPrice,
      lowPrice: quote.lowPrice,
      volume: quote.volume,
      liquidity: instrument.liquidity,
      volatility: instrument.volatility,
      distanceToUpperLimitPercent: roundPercent(
        ((quote.previousClose * 1.1 - quote.currentPrice) /
          quote.currentPrice) *
          100,
      ),
      distanceToLowerLimitPercent: roundPercent(
        ((quote.currentPrice - quote.previousClose * 0.9) /
          quote.currentPrice) *
          100,
      ),
      netOrderFlow: this.engine?.getNetOrderFlow(instrumentId) ?? 0,
      indicators: {
        ma5: movingAverage(closes, 5),
        ma10: movingAverage(closes, 10),
        ma20: movingAverage(closes, 20),
        rsi14: rsi(closes, 14),
      },
      recentMinuteBars: minuteBars,
      recentDailyBars: dailyBars,
    };
  }
}

function llmRunIdempotencyKey(agent: LLMTraderAgent): string {
  return `llm-${agent.traderId}-${agent.scheduledAt}`;
}

function toCandleContext(candle: {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}): LLMCandleContext {
  return {
    time: candle.time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  };
}

function movingAverage(values: number[], period: number): number | null {
  if (values.length < period) {
    return null;
  }
  const selected = values.slice(-period);
  return roundMoney(
    selected.reduce((total, value) => total + value, 0) / period,
  );
}

function rsi(values: number[], period: number): number | null {
  if (values.length <= period) {
    return null;
  }
  const changes = values
    .slice(-(period + 1))
    .slice(1)
    .map((value, index) => value - values.slice(-(period + 1))[index]!);
  const gains = changes.reduce(
    (total, change) => total + Math.max(0, change),
    0,
  );
  const losses = changes.reduce(
    (total, change) => total + Math.max(0, -change),
    0,
  );
  if (losses === 0) {
    return 100;
  }
  return roundPercent(100 - 100 / (1 + gains / losses));
}
