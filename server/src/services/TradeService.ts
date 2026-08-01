import { randomUUID } from "node:crypto";
import {
  quotePriceToUsd,
  USD_CNY_DISPLAY_RATE,
  type LimitOrder,
  type OrderCancellationResult,
  type OrderStatus,
  type OrderSubmissionResult,
  type Quote,
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
  OrderRecord,
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
    grossAmountUsd?: number,
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

interface PortfolioExecutionOptions {
  settleDuePositions?: boolean;
  persistTransaction?: boolean;
  order?: OrderRecord;
  reservedOrder?: OrderRecord;
}

interface InternalOrderSubmission {
  order: OrderRecord;
  transaction?: Transaction;
}

export class TradeService {
  #queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly repository: GameRepository,
    private readonly portfolioService: PortfolioService,
    private readonly clock: () => Date = () => new Date(),
    private readonly marketImpact?: MarketImpactRecorder,
  ) {}

  execute(accountId: string, request: TradeRequest): Promise<TradeResult> {
    return this.#enqueue(async () => {
      const portfolio = this.repository.getPortfolioByAccountId(accountId);
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

  placeOrder(
    accountId: string,
    request: TradeRequest,
  ): Promise<OrderSubmissionResult> {
    return this.#enqueue(async () => {
      const portfolio = this.repository.getPortfolioByAccountId(accountId);
      if (!portfolio) {
        throw new TradeError(
          "PORTFOLIO_NOT_FOUND",
          "模拟账户不存在",
          404,
        );
      }
      const result = await this.#placePortfolioOrder(
        portfolio.id,
        request,
        "USER",
        accountId,
        true,
      );
      return {
        order: toPublicOrder(result.order),
        transaction: result.transaction,
        portfolio: this.portfolioService.getSnapshot(accountId),
      };
    });
  }

  placeAIOrder(
    traderId: string,
    portfolioId: string,
    request: TradeRequest,
    options: {
      settleDuePositions?: boolean;
      persistTransaction?: boolean;
    } = {},
  ): Promise<InternalOrderSubmission> {
    return this.#enqueue(() =>
      this.#placePortfolioOrder(
        portfolioId,
        request,
        "AI",
        traderId,
        options.persistTransaction ?? true,
        options.settleDuePositions ?? true,
      ),
    );
  }

  listOrders(accountId: string, status?: OrderStatus): LimitOrder[] {
    const portfolio = this.repository.getPortfolioByAccountId(accountId);
    if (!portfolio) {
      throw new TradeError(
        "PORTFOLIO_NOT_FOUND",
        "模拟账户不存在",
        404,
      );
    }
    return this.repository
      .listOrders(portfolio.id, status)
      .map(toPublicOrder);
  }

  cancelOrder(
    accountId: string,
    orderId: string,
  ): Promise<OrderCancellationResult> {
    return this.#enqueue(async () => {
      const portfolio = this.repository.getPortfolioByAccountId(accountId);
      if (!portfolio) {
        throw new TradeError(
          "PORTFOLIO_NOT_FOUND",
          "模拟账户不存在",
          404,
        );
      }
      const order = this.repository.getOrderById(orderId);
      if (!order || order.portfolioId !== portfolio.id) {
        throw new TradeError("ORDER_NOT_FOUND", "没有找到这笔委托", 404);
      }
      if (order.status === "CANCELLED") {
        return {
          order: toPublicOrder(order),
          portfolio: this.portfolioService.getSnapshot(accountId),
        };
      }
      if (order.status !== "OPEN") {
        throw new TradeError(
          "ORDER_NOT_OPEN",
          "已成交的委托不能撤销",
          409,
        );
      }

      const currentPortfolio = this.repository.getPortfolioById(portfolio.id);
      if (!currentPortfolio) {
        throw new TradeError(
          "PORTFOLIO_NOT_FOUND",
          "模拟账户不存在",
          404,
        );
      }
      const now = this.clock().toISOString();
      let position: PositionRecord | undefined;
      let availableCashUsd = currentPortfolio.availableCashUsd;
      let frozenCashUsd = currentPortfolio.frozenCashUsd;

      if (order.side === "BUY") {
        if (
          order.reservedCashUsd <= 0 ||
          frozenCashUsd + 0.01 < order.reservedCashUsd
        ) {
          throw new Error("ORDER_CASH_RESERVATION_CORRUPTED");
        }
        availableCashUsd = roundMoney(
          availableCashUsd + order.reservedCashUsd,
        );
        frozenCashUsd = roundMoney(
          frozenCashUsd - order.reservedCashUsd,
        );
      } else {
        const currentPosition = this.repository.getPosition(
          portfolio.id,
          order.instrumentId,
        );
        if (
          !currentPosition ||
          currentPosition.frozenQuantity < order.reservedQuantity
        ) {
          throw new Error("ORDER_POSITION_RESERVATION_CORRUPTED");
        }
        position = {
          ...currentPosition,
          availableQuantity:
            currentPosition.availableQuantity + order.reservedQuantity,
          frozenQuantity:
            currentPosition.frozenQuantity - order.reservedQuantity,
        };
      }

      const cancelled: OrderRecord = {
        ...order,
        status: "CANCELLED",
        reservedCashUsd: 0,
        reservedQuantity: 0,
        updatedAt: now,
        cancelledAt: now,
      };
      await this.repository.commitOrderState({
        portfolioId: portfolio.id,
        instrumentId: order.instrumentId,
        occurredAt: now,
        availableCashUsd,
        availableCashDeltaUsd: roundMoney(
          availableCashUsd - currentPortfolio.availableCashUsd,
        ),
        frozenCashUsd,
        frozenCashDeltaUsd: roundMoney(
          frozenCashUsd - currentPortfolio.frozenCashUsd,
        ),
        position,
        order: cancelled,
      });
      return {
        order: toPublicOrder(cancelled),
        portfolio: this.portfolioService.getSnapshot(accountId),
      };
    });
  }

  matchOpenOrders(instrumentIds?: string[]): Promise<number> {
    return this.#enqueue(async () => {
      const orders = this.repository.listOpenOrders(instrumentIds);
      let filled = 0;
      for (const order of orders) {
        const quote = this.repository.getQuote(order.instrumentId);
        if (!quote || !crossesLimit(order, quote)) {
          continue;
        }
        try {
          await this.#executePortfolio(
            order.portfolioId,
            {
              instrumentId: order.instrumentId,
              side: order.side,
              quantity: order.quantity,
              orderMode: "LIMIT",
              limitPrice: order.limitPrice ?? undefined,
              idempotencyKey: order.idempotencyKey,
            },
            order.actorType,
            order.actorId,
            {
              settleDuePositions: false,
              persistTransaction: true,
              reservedOrder: order,
            },
          );
          filled += 1;
        } catch (error) {
          if (!(error instanceof TradeError)) {
            throw error;
          }
        }
      }
      return filled;
    });
  }

  ensureAIPortfolioCashFloor(
    traderId: string,
    thresholdUsd: number,
    topUpUsd: number,
  ): Promise<boolean> {
    return this.#enqueue(async () => {
      const trader = this.repository.getAITrader(traderId);
      if (!trader) {
        throw new TradeError("AI_TRADER_NOT_FOUND", "智能交易者不存在", 404);
      }
      return this.repository.ensureAIPortfolioCashFloor(
        trader.portfolioId,
        thresholdUsd,
        topUpUsd,
      );
    });
  }

  executeAI(
    traderId: string,
    portfolioId: string,
    request: TradeRequest,
    options: {
      settleDuePositions?: boolean;
      persistTransaction?: boolean;
    } = {},
  ): Promise<Transaction> {
    return this.#enqueue(() =>
      this.#executePortfolio(
        portfolioId,
        request,
        "AI",
        traderId,
        {
          settleDuePositions: options.settleDuePositions ?? true,
          persistTransaction: options.persistTransaction ?? false,
        },
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

  async #placePortfolioOrder(
    portfolioId: string,
    request: TradeRequest,
    actorType: TradeActorType,
    actorId: string,
    persistTransaction: boolean,
    settleDuePositions = true,
  ): Promise<InternalOrderSubmission> {
    const now = this.clock();
    if (settleDuePositions) {
      await this.repository.settleDuePositions(now.toISOString());
    }
    const portfolio = this.repository.getPortfolioById(portfolioId);
    if (!portfolio) {
      throw new TradeError(
        "PORTFOLIO_NOT_FOUND",
        "模拟账户不存在",
        404,
      );
    }
    const instrument = this.#validateInstrumentAndQuantity(request);
    const orderMode = request.orderMode ?? "MARKET";
    const limitPrice = normalizeLimitPrice(orderMode, request.limitPrice);

    if (request.idempotencyKey) {
      const existing = this.repository.getOrderByIdempotencyKey(
        portfolioId,
        request.idempotencyKey,
      );
      if (existing) {
        assertSameOrder(existing, request, orderMode, limitPrice);
        const transaction = existing.transactionId
          ? this.repository
              .listTransactions(portfolioId)
              .find((item) => item.id === existing.transactionId)
          : undefined;
        return { order: existing, transaction };
      }

      if (
        this.repository.getTransactionByIdempotencyKey(
          portfolioId,
          request.idempotencyKey,
        )
      ) {
        throw new TradeError(
          "IDEMPOTENCY_KEY_REUSED",
          "这次下单请求标识已经用于另一笔交易",
          409,
        );
      }
    }

    const quote = this.repository.getQuote(instrument.id);
    if (!quote) {
      throw new TradeError(
        "QUOTE_UNAVAILABLE",
        "这只股票暂时没有可用行情",
        503,
      );
    }
    const createdAt = now.toISOString();
    const order: OrderRecord = {
      id: randomUUID(),
      mode: "VIRTUAL",
      portfolioId,
      instrumentId: instrument.id,
      symbol: instrument.symbol,
      name: instrument.name,
      market: instrument.market,
      side: request.side,
      orderMode,
      status: orderMode === "MARKET" ? "FILLED" : "OPEN",
      quantity: request.quantity,
      filledQuantity: 0,
      limitPrice,
      quoteCurrency: quote.quoteCurrency,
      reservedCashUsd: 0,
      reservedQuantity: 0,
      actorType,
      actorId,
      idempotencyKey: request.idempotencyKey,
      createdAt,
      updatedAt: createdAt,
      filledAt: null,
      cancelledAt: null,
      transactionId: null,
    };

    if (orderMode === "MARKET" || crossesLimit(order, quote)) {
      const transaction = await this.#executePortfolio(
        portfolioId,
        { ...request, orderMode, limitPrice: limitPrice ?? undefined },
        actorType,
        actorId,
        {
          settleDuePositions: false,
          persistTransaction,
          order,
        },
      );
      return {
        order: this.repository.getOrderById(order.id) ?? order,
        transaction,
      };
    }

    let availableCashUsd = portfolio.availableCashUsd;
    let frozenCashUsd = portfolio.frozenCashUsd;
    let position: PositionRecord | undefined;
    if (request.side === "BUY") {
      const limitPriceUsd = roundUnitPrice(
        quotePriceToUsd(limitPrice!, quote.quoteCurrency),
      );
      const reservedCashUsd = settlementAmountUsd(
        limitPriceUsd,
        request.quantity,
        "BUY",
      );
      if (availableCashUsd < reservedCashUsd) {
        throw new TradeError(
          "INSUFFICIENT_CASH",
          "可用模拟资金不足",
        );
      }
      availableCashUsd = roundMoney(availableCashUsd - reservedCashUsd);
      frozenCashUsd = roundMoney(frozenCashUsd + reservedCashUsd);
      order.reservedCashUsd = reservedCashUsd;
    } else {
      const currentPosition = this.repository.getPosition(
        portfolioId,
        instrument.id,
      );
      if (
        !currentPosition ||
        currentPosition.availableQuantity < request.quantity
      ) {
        throw new TradeError(
          "INSUFFICIENT_POSITION",
          instrument.settlementCycle === "T1"
            ? "可卖持仓不足；沪深当日买入需下一交易日方可卖出"
            : "可卖持仓不足",
        );
      }
      position = {
        ...currentPosition,
        availableQuantity:
          currentPosition.availableQuantity - request.quantity,
        frozenQuantity:
          currentPosition.frozenQuantity + request.quantity,
      };
      order.reservedQuantity = request.quantity;
    }
    await this.repository.commitOrderState({
      portfolioId,
      instrumentId: instrument.id,
      occurredAt: createdAt,
      availableCashUsd,
      availableCashDeltaUsd: roundMoney(
        availableCashUsd - portfolio.availableCashUsd,
      ),
      frozenCashUsd,
      frozenCashDeltaUsd: roundMoney(
        frozenCashUsd - portfolio.frozenCashUsd,
      ),
      position,
      order,
    });
    return { order };
  }

  async #executePortfolio(
    portfolioId: string,
    request: TradeRequest,
    actorType: TradeActorType,
    actorId: string,
    options: PortfolioExecutionOptions = {},
  ): Promise<Transaction> {
    const now = this.clock();
    if (options.settleDuePositions ?? true) {
      await this.repository.settleDuePositions(now.toISOString());
    }
    const portfolio = this.repository.getPortfolioById(portfolioId);
    if (!portfolio) {
      throw new TradeError(
        "PORTFOLIO_NOT_FOUND",
        "模拟账户不存在",
        404,
      );
    }

    if (request.idempotencyKey && !options.order && !options.reservedOrder) {
      const existing = this.repository.getTransactionByIdempotencyKey(
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

    const instrument = this.#validateInstrumentAndQuantity(request);
    if (
      !options.order &&
      !options.reservedOrder &&
      request.orderMode &&
      request.orderMode !== "MARKET"
    ) {
      throw new TradeError(
        "ORDER_MODE_NOT_SUPPORTED",
        "限价单请使用订单接口提交",
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
    if (
      options.reservedOrder &&
      !crossesLimit(options.reservedOrder, quote)
    ) {
      throw new TradeError("LIMIT_NOT_REACHED", "限价尚未触发", 409);
    }

    const fxRateToUsd =
      quote.quoteCurrency === "CNY" ? 1 / USD_CNY_DISPLAY_RATE : 1;
    const priceUsd = roundUnitPrice(
      quotePriceToUsd(quote.currentPrice, quote.quoteCurrency),
    );
    const grossAmountUsd = roundMoney(priceUsd * request.quantity);
    const feeUsd = tradeFeeUsd(grossAmountUsd);
    const oldPosition = this.repository.getPosition(
      portfolio.id,
      instrument.id,
    );
    let realizedProfitUsd: number | null = null;
    let netAmountUsd: number;
    let availableCashUsd: number;
    let frozenCashUsd = portfolio.frozenCashUsd;
    let position: PositionRecord | null;

    if (request.side === "BUY") {
      netAmountUsd = roundMoney(grossAmountUsd + feeUsd);
      if (options.reservedOrder) {
        if (
          portfolio.frozenCashUsd + 0.01 <
          options.reservedOrder.reservedCashUsd
        ) {
          throw new Error("ORDER_CASH_RESERVATION_CORRUPTED");
        }
        availableCashUsd = roundMoney(
          portfolio.availableCashUsd +
            options.reservedOrder.reservedCashUsd -
            netAmountUsd,
        );
        frozenCashUsd = roundMoney(
          portfolio.frozenCashUsd -
            options.reservedOrder.reservedCashUsd,
        );
      } else {
        if (portfolio.availableCashUsd < netAmountUsd) {
          throw new TradeError(
            "INSUFFICIENT_CASH",
            "可用模拟资金不足",
          );
        }
        availableCashUsd = roundMoney(
          portfolio.availableCashUsd - netAmountUsd,
        );
      }

      const oldQuantity = oldPosition?.quantity ?? 0;
      const newQuantity = oldQuantity + request.quantity;
      const oldCostUsd =
        (oldPosition?.averageCostUsd ?? 0) * oldQuantity;
      position = {
        id: oldPosition?.id ?? randomUUID(),
        instrumentId: instrument.id,
        quantity: newQuantity,
        availableQuantity:
          (oldPosition?.availableQuantity ?? 0) +
          (instrument.settlementCycle === "T0" ? request.quantity : 0),
        frozenQuantity: oldPosition?.frozenQuantity ?? 0,
        averageCostUsd: roundUnitPrice(
          (oldCostUsd + grossAmountUsd + feeUsd) / newQuantity,
        ),
      };
    } else {
      if (options.reservedOrder) {
        if (
          !oldPosition ||
          oldPosition.frozenQuantity < request.quantity
        ) {
          throw new Error("ORDER_POSITION_RESERVATION_CORRUPTED");
        }
      } else if (
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
      const safePosition = oldPosition!;
      netAmountUsd = roundMoney(grossAmountUsd - feeUsd);
      realizedProfitUsd = roundMoney(
        (priceUsd - safePosition.averageCostUsd) * request.quantity -
          feeUsd,
      );
      availableCashUsd = roundMoney(
        portfolio.availableCashUsd + netAmountUsd,
      );
      const remainingQuantity = safePosition.quantity - request.quantity;
      position =
        remainingQuantity === 0
          ? null
          : {
              ...safePosition,
              quantity: remainingQuantity,
              availableQuantity: options.reservedOrder
                ? safePosition.availableQuantity
                : safePosition.availableQuantity - request.quantity,
              frozenQuantity: options.reservedOrder
                ? safePosition.frozenQuantity - request.quantity
                : safePosition.frozenQuantity,
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
    const persistTransaction =
      options.persistTransaction ?? actorType !== "AI";
    let settlementLot: SettlementLotRecord | undefined;
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
        sourceTransactionId: persistTransaction ? transactionId : null,
      };
    }

    const sourceOrder = options.reservedOrder ?? options.order;
    const filledOrder: OrderRecord | undefined = sourceOrder
      ? {
          ...sourceOrder,
          status: "FILLED",
          filledQuantity: sourceOrder.quantity,
          reservedCashUsd: 0,
          reservedQuantity: 0,
          updatedAt: now.toISOString(),
          filledAt: now.toISOString(),
          transactionId: persistTransaction ? transactionId : null,
        }
      : undefined;
    await this.repository.commitTrade({
      portfolioId: portfolio.id,
      instrumentId: instrument.id,
      occurredAt: now.toISOString(),
      availableCashUsd,
      availableCashDeltaUsd: roundMoney(
        availableCashUsd - portfolio.availableCashUsd,
      ),
      frozenCashUsd,
      frozenCashDeltaUsd: roundMoney(
        frozenCashUsd - portfolio.frozenCashUsd,
      ),
      position,
      transaction: persistTransaction ? transaction : undefined,
      settlementLot,
      order: filledOrder,
    });
    this.marketImpact?.recordTrade(
      instrument.id,
      request.side,
      request.quantity,
      actorType,
      grossAmountUsd,
    );
    return transaction;
  }

  #validateInstrumentAndQuantity(request: TradeRequest) {
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
    return instrument;
  }
}

function normalizeLimitPrice(
  orderMode: "MARKET" | "LIMIT",
  value: number | undefined,
): number | null {
  if (orderMode === "MARKET") {
    if (value !== undefined) {
      throw new TradeError(
        "UNEXPECTED_LIMIT_PRICE",
        "市价单不能填写限价",
      );
    }
    return null;
  }
  if (!Number.isFinite(value) || value === undefined || value <= 0) {
    throw new TradeError("INVALID_LIMIT_PRICE", "请输入有效的限价");
  }
  return roundUnitPrice(value);
}

function crossesLimit(order: OrderRecord, quote: Quote): boolean {
  if (order.orderMode === "MARKET") {
    return true;
  }
  if (order.limitPrice === null) {
    return false;
  }
  return order.side === "BUY"
    ? quote.currentPrice <= order.limitPrice
    : quote.currentPrice >= order.limitPrice;
}

function tradeFeeUsd(grossAmountUsd: number): number {
  return roundMoney(
    Math.max(
      GAME_RULES.minimumFeeUsd,
      grossAmountUsd * GAME_RULES.feeRate,
    ),
  );
}

function settlementAmountUsd(
  priceUsd: number,
  quantity: number,
  side: "BUY" | "SELL",
): number {
  const gross = roundMoney(priceUsd * quantity);
  const fee = tradeFeeUsd(gross);
  return side === "BUY"
    ? roundMoney(gross + fee)
    : roundMoney(gross - fee);
}

function assertSameOrder(
  existing: OrderRecord,
  request: TradeRequest,
  orderMode: "MARKET" | "LIMIT",
  limitPrice: number | null,
): void {
  if (
    existing.instrumentId !== request.instrumentId ||
    existing.side !== request.side ||
    existing.quantity !== request.quantity ||
    existing.orderMode !== orderMode ||
    existing.limitPrice !== limitPrice
  ) {
    throw new TradeError(
      "IDEMPOTENCY_KEY_REUSED",
      "这次下单请求标识已经用于另一笔委托",
      409,
    );
  }
}

function toPublicOrder(order: OrderRecord): LimitOrder {
  return {
    id: order.id,
    mode: order.mode,
    instrumentId: order.instrumentId,
    symbol: order.symbol,
    name: order.name,
    market: order.market,
    side: order.side,
    orderMode: order.orderMode,
    status: order.status,
    quantity: order.quantity,
    filledQuantity: order.filledQuantity,
    limitPrice: order.limitPrice,
    quoteCurrency: order.quoteCurrency,
    reservedCashUsd: order.reservedCashUsd,
    reservedQuantity: order.reservedQuantity,
    actorType: order.actorType,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    filledAt: order.filledAt,
    cancelledAt: order.cancelledAt,
    transactionId: order.transactionId,
  };
}
