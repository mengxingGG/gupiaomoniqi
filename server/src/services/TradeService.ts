import { randomUUID } from "node:crypto";
import {
  quotePriceToUsd,
  USD_CNY_DISPLAY_RATE,
  type TradeActorType,
  type TradeRequest,
  type TradeResult,
  type Transaction,
} from "@gupiaomoniqi/shared";
import { GAME_RULES } from "../config.js";
import { nextSettlementAt } from "../domain/marketRules.js";
import { roundMoney, roundUnitPrice } from "../domain/money.js";
import type {
  GameRepository,
  PositionRecord,
  SettlementLotRecord,
} from "../repositories/GameRepository.js";
import type { PortfolioService } from "./PortfolioService.js";

export interface MarketImpactRecorder {
  recordTrade(
    instrumentId: string,
    side: "BUY" | "SELL",
    quantity: number,
    actorType: TradeActorType,
  ): void;
}

export class TradeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "TradeError";
  }
}

export class TradeService {
  #queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly repository: GameRepository,
    private readonly portfolioService: PortfolioService,
    private readonly clock: () => Date = () => new Date(),
    private readonly marketImpact?: MarketImpactRecorder,
  ) {}

  execute(
    accountId: string,
    request: TradeRequest,
  ): Promise<TradeResult> {
    return this.#enqueue(async () => {
      const portfolio =
        this.repository.getPortfolioByAccountId(accountId);

      if (!portfolio) {
        throw new TradeError(
          "PORTFOLIO_NOT_FOUND",
          "模拟账户不存在",
          404,
        );
      }

      const transaction = await this.#executePortfolio(
        portfolio.id,
        request,
        "USER",
        accountId,
      );

      return {
        transaction,
        portfolio: this.portfolioService.getSnapshot(accountId),
      };
    });
  }

  executeAI(
    traderId: string,
    portfolioId: string,
    request: TradeRequest,
  ): Promise<Transaction> {
    return this.#enqueue(() =>
      this.#executePortfolio(
        portfolioId,
        request,
        "AI",
        traderId,
      ),
    );
  }

  settleDuePositions(at: Date = this.clock()) {
    return this.#enqueue(() =>
      this.repository.settleDuePositions(at.toISOString()),
    );
  }

  #enqueue<T>(work: () => Promise<T>): Promise<T> {
    const operation = this.#queue.then(work);
    this.#queue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  async #executePortfolio(
    portfolioId: string,
    request: TradeRequest,
    actorType: TradeActorType,
    actorId: string,
  ): Promise<Transaction> {
    const now = this.clock();
    await this.repository.settleDuePositions(now.toISOString());
    const portfolio = this.repository.getPortfolioById(portfolioId);

    if (!portfolio) {
      throw new TradeError(
        "PORTFOLIO_NOT_FOUND",
        "模拟账户不存在",
        404,
      );
    }

    if (request.idempotencyKey) {
      const existing =
        this.repository.getTransactionByIdempotencyKey(
          portfolio.id,
          request.idempotencyKey,
        );

      if (existing) {
        if (
          existing.instrumentId !== request.instrumentId ||
          existing.side !== request.side ||
          existing.quantity !== request.quantity
        ) {
          throw new TradeError(
            "IDEMPOTENCY_KEY_REUSED",
            "这次交易请求标识已经用于另一笔订单",
            409,
          );
        }

        return existing;
      }
    }

    const instrument = this.repository.getInstrumentById(
      request.instrumentId,
    );

    if (!instrument || instrument.type !== "STOCK_VIRTUAL") {
      throw new TradeError(
        "INSTRUMENT_NOT_FOUND",
        "没有找到这只模拟股票",
        404,
      );
    }

    if (!instrument.isTradable) {
      throw new TradeError(
        "INSTRUMENT_NOT_TRADABLE",
        "这只股票当前不可交易",
      );
    }

    if (
      !Number.isSafeInteger(request.quantity) ||
      request.quantity <= 0 ||
      request.quantity % instrument.lotSize !== 0
    ) {
      throw new TradeError(
        "INVALID_QUANTITY",
        `交易数量必须是 ${instrument.lotSize} 股的正整数倍`,
      );
    }

    if (request.orderMode && request.orderMode !== "MARKET") {
      throw new TradeError(
        "ORDER_MODE_NOT_SUPPORTED",
        "当前阶段只支持市价单",
      );
    }

    const quote = this.repository.getQuote(instrument.id);

    if (!quote) {
      throw new TradeError(
        "QUOTE_UNAVAILABLE",
        "这只股票暂时没有可用行情",
        503,
      );
    }

    const fxRateToUsd =
      quote.quoteCurrency === "CNY"
        ? 1 / USD_CNY_DISPLAY_RATE
        : 1;
    const priceUsd = roundUnitPrice(
      quotePriceToUsd(quote.currentPrice, quote.quoteCurrency),
    );
    const grossAmountUsd = roundMoney(priceUsd * request.quantity);
    const feeUsd = roundMoney(
      Math.max(
        GAME_RULES.minimumFeeUsd,
        grossAmountUsd * GAME_RULES.feeRate,
      ),
    );
    const oldPosition = this.repository.getPosition(
      portfolio.id,
      instrument.id,
    );
    let realizedProfitUsd: number | null = null;
    let netAmountUsd: number;
    let availableCashUsd: number;
    let position: PositionRecord | null;

    if (request.side === "BUY") {
      netAmountUsd = roundMoney(grossAmountUsd + feeUsd);

      if (portfolio.availableCashUsd < netAmountUsd) {
        throw new TradeError(
          "INSUFFICIENT_CASH",
          "可用模拟资金不足",
        );
      }

      const oldQuantity = oldPosition?.quantity ?? 0;
      const newQuantity = oldQuantity + request.quantity;
      const oldCostUsd =
        (oldPosition?.averageCostUsd ?? 0) * oldQuantity;
      const averageCostUsd = roundUnitPrice(
        (oldCostUsd + grossAmountUsd + feeUsd) / newQuantity,
      );

      availableCashUsd = roundMoney(
        portfolio.availableCashUsd - netAmountUsd,
      );
      position = {
        id: oldPosition?.id ?? randomUUID(),
        instrumentId: instrument.id,
        quantity: newQuantity,
        availableQuantity:
          (oldPosition?.availableQuantity ?? 0) +
          (instrument.settlementCycle === "T0"
            ? request.quantity
            : 0),
        frozenQuantity: oldPosition?.frozenQuantity ?? 0,
        averageCostUsd,
      };
    } else {
      if (
        !oldPosition ||
        oldPosition.availableQuantity < request.quantity
      ) {
        throw new TradeError(
          "INSUFFICIENT_POSITION",
          instrument.settlementCycle === "T1"
            ? "可卖持仓不足；沪深当日买入需下一交易日方可卖出"
            : "可卖持仓不足",
        );
      }

      netAmountUsd = roundMoney(grossAmountUsd - feeUsd);
      realizedProfitUsd = roundMoney(
        (priceUsd - oldPosition.averageCostUsd) * request.quantity -
          feeUsd,
      );
      const remainingQuantity =
        oldPosition.quantity - request.quantity;

      availableCashUsd = roundMoney(
        portfolio.availableCashUsd + netAmountUsd,
      );
      position =
        remainingQuantity === 0
          ? null
          : {
              ...oldPosition,
              quantity: remainingQuantity,
              availableQuantity:
                oldPosition.availableQuantity - request.quantity,
            };
    }

    const transactionId = randomUUID();
    const transaction: Transaction = {
      id: transactionId,
      instrumentId: instrument.id,
      symbol: instrument.symbol,
      name: instrument.name,
      market: instrument.market,
      side: request.side,
      quantity: request.quantity,
      quotePrice: quote.currentPrice,
      quoteCurrency: quote.quoteCurrency,
      fxRateToUsd,
      priceUsd,
      grossAmountUsd,
      feeUsd,
      netAmountUsd,
      realizedProfitUsd,
      createdAt: now.toISOString(),
      actorType,
      actorId,
      idempotencyKey: request.idempotencyKey,
    };
    let settlementLot: SettlementLotRecord | undefined;
    const persistTransaction = actorType !== "AI";

    if (
      request.side === "BUY" &&
      instrument.settlementCycle === "T1"
    ) {
      const unlockAt = nextSettlementAt(instrument.market, now);

      if (!unlockAt) {
        throw new Error("T1_SETTLEMENT_DATE_UNAVAILABLE");
      }

      settlementLot = {
        id: randomUUID(),
        portfolioId: portfolio.id,
        instrumentId: instrument.id,
        quantity: request.quantity,
        unlockAt: unlockAt.toISOString(),
        settledAt: null,
        sourceTransactionId: persistTransaction
          ? transactionId
          : null,
      };
    }

    await this.repository.commitTrade({
      portfolioId: portfolio.id,
      instrumentId: instrument.id,
      occurredAt: now.toISOString(),
      availableCashUsd,
      position,
      transaction: persistTransaction ? transaction : undefined,
      settlementLot,
    });
    this.marketImpact?.recordTrade(
      instrument.id,
      request.side,
      request.quantity,
      actorType,
    );

    return transaction;
  }
}
