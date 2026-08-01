import { randomUUID } from "node:crypto";
import {
  MINIMUM_TRADE_FEE_USD,
  USD_CNY_DISPLAY_RATE,
  VIRTUAL_TRADE_FEE_RATE,
  quotePriceToUsd,
  type DisplayCurrency,
  type LimitOrder,
  type OrderCancellationResult,
  type OrderStatus,
  type OrderSubmissionResult,
  type PortfolioSnapshot,
  type Position,
  type TradeRequest,
  type TradeResult,
  type Transaction,
} from "@gupiaomoniqi/shared";
import type { Transaction as DatabaseTransaction } from "@electric-sql/pglite";
import { GAME_RULES } from "../config.js";
import { nextSettlementAt } from "../domain/marketRules.js";
import {
  roundMoney,
  roundPercent,
  roundUnitPrice,
} from "../domain/money.js";
import { RealMarketRepository } from "./RealMarketRepository.js";
import type {
  RealPortfolioRecord,
  RealPositionRecord,
} from "./types.js";

export class RealTradeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "RealTradeError";
  }
}

export class RealTradingService {
  #queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly repository: RealMarketRepository,
    private readonly quoteMaximumReceiveAgeMs: number,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async getSnapshot(
    accountId: string,
    displayCurrency: DisplayCurrency,
  ): Promise<PortfolioSnapshot> {
    const portfolio = await this.#ensurePortfolio(accountId);
    await this.#settleDue(portfolio.id, this.clock());
    return this.#buildSnapshot(portfolio.id, displayCurrency);
  }

  async listTransactions(accountId: string): Promise<Transaction[]> {
    const portfolio = await this.#ensurePortfolio(accountId);
    const result = await this.repository.client.query<TransactionRow>(
      `SELECT id, instrument_id, symbol, name, market, side, quantity,
              quote_price::float8, quote_currency,
              fx_rate_to_usd::float8, price_usd::float8,
              gross_amount_usd::float8, fee_usd::float8,
              net_amount_usd::float8, realized_profit_usd::float8,
              actor_type, actor_id, idempotency_key, created_at
         FROM real_transactions
        WHERE portfolio_id = $1
        ORDER BY created_at DESC`,
      [portfolio.id],
    );
    return result.rows.map(toTransaction);
  }

  async listOrders(
    accountId: string,
    status?: OrderStatus,
  ): Promise<LimitOrder[]> {
    const portfolio = await this.#ensurePortfolio(accountId);
    const result = await this.repository.client.query<RealOrderRow>(
      `SELECT id, portfolio_id, instrument_id, side, order_mode, status,
              quantity, filled_quantity, limit_price::float8,
              quote_currency, reserved_cash_usd::float8,
              reserved_quantity, actor_type, actor_id, idempotency_key,
              created_at, updated_at, filled_at, cancelled_at,
              transaction_id
         FROM real_orders
        WHERE portfolio_id = $1
          AND ($2::text IS NULL OR status = $2)
        ORDER BY created_at DESC`,
      [portfolio.id, status ?? null],
    );
    return result.rows.map((row) => this.#toPublicOrder(row));
  }

  async listOpenOrderInstrumentIds(): Promise<string[]> {
    const result = await this.repository.client.query<{
      instrument_id: string;
    }>(
      `SELECT DISTINCT instrument_id
         FROM real_orders
        WHERE status = 'OPEN'`,
    );
    return result.rows.map((row) => row.instrument_id);
  }

  placeOrder(
    accountId: string,
    displayCurrency: DisplayCurrency,
    request: TradeRequest,
  ): Promise<OrderSubmissionResult> {
    return this.#enqueue(async () => {
      const portfolio = await this.#ensurePortfolio(accountId);
      const now = this.clock();
      await this.#settleDue(portfolio.id, now);
      const orderMode = request.orderMode ?? "MARKET";
      const limitPrice = normalizeRealLimitPrice(
        orderMode,
        request.limitPrice,
      );

      if (request.idempotencyKey) {
        const existing = await this.repository.client.query<RealOrderRow>(
          `SELECT id, portfolio_id, instrument_id, side, order_mode,
                  status, quantity, filled_quantity,
                  limit_price::float8, quote_currency,
                  reserved_cash_usd::float8, reserved_quantity,
                  actor_type, actor_id, idempotency_key, created_at,
                  updated_at, filled_at, cancelled_at, transaction_id
             FROM real_orders
            WHERE portfolio_id = $1 AND idempotency_key = $2`,
          [portfolio.id, request.idempotencyKey],
        );
        if (existing.rows[0]) {
          assertSameRealOrder(
            existing.rows[0],
            request,
            orderMode,
            limitPrice,
          );
          const transaction = existing.rows[0].transaction_id
            ? (
                await this.repository.client.query<TransactionRow>(
                  `SELECT id, instrument_id, symbol, name, market, side,
                          quantity, quote_price::float8, quote_currency,
                          fx_rate_to_usd::float8, price_usd::float8,
                          gross_amount_usd::float8, fee_usd::float8,
                          net_amount_usd::float8,
                          realized_profit_usd::float8, actor_type,
                          actor_id, idempotency_key, created_at
                     FROM real_transactions
                    WHERE id = $1`,
                  [existing.rows[0].transaction_id],
                )
              ).rows[0]
            : undefined;
          return {
            order: this.#toPublicOrder(existing.rows[0]),
            transaction: transaction
              ? toTransaction(transaction)
              : undefined,
            portfolio: await this.#buildSnapshot(
              portfolio.id,
              displayCurrency,
            ),
          };
        }


        const existingTransaction = await this.repository.client.query<{
          id: string;
        }>(
          `SELECT id
             FROM real_transactions
            WHERE portfolio_id = $1 AND idempotency_key = $2`,
          [portfolio.id, request.idempotencyKey],
        );
        if (existingTransaction.rows[0]) {
          throw new RealTradeError(
            "IDEMPOTENCY_KEY_REUSED",
            "这次下单请求标识已经用于另一笔交易",
            409,
          );
        }
      }

      const { instrument, quote } = this.#validateOrderRequest(
        request,
        now,
      );

      const createdAt = now.toISOString();
      const order: RealOrderRecord = {
        id: randomUUID(),
        mode: "REAL",
        portfolioId: portfolio.id,
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
        actorType: "USER",
        actorId: accountId,
        idempotencyKey: request.idempotencyKey,
        createdAt,
        updatedAt: createdAt,
        filledAt: null,
        cancelledAt: null,
        transactionId: null,
      };

      if (
        orderMode === "MARKET" ||
        realOrderCrosses(order, quote.currentPrice)
      ) {
        const result = await this.execute(
          accountId,
          displayCurrency,
          { ...request, orderMode, limitPrice: limitPrice ?? undefined },
          order,
        );
        const filled: LimitOrder = {
          ...toPublicRealOrder(order),
          status: "FILLED",
          filledQuantity: order.quantity,
          updatedAt: result.transaction.createdAt,
          filledAt: result.transaction.createdAt,
          transactionId: result.transaction.id,
        };
        return {
          order: filled,
          transaction: result.transaction,
          portfolio: result.portfolio,
        };
      }

      await this.repository.client.transaction(
        async (databaseTransaction) => {
          const lockedPortfolio = (
            await databaseTransaction.query<PortfolioRow>(
              `SELECT id, account_id, initial_cash_usd::float8,
                      available_cash_usd::float8,
                      frozen_cash_usd::float8
                 FROM real_portfolios
                WHERE id = $1 FOR UPDATE`,
              [portfolio.id],
            )
          ).rows[0];
          if (!lockedPortfolio) {
            throw new RealTradeError(
              "REAL_PORTFOLIO_NOT_FOUND",
              "真实行情模拟账户不存在",
              404,
            );
          }

          if (request.side === "BUY") {
            const priceUsd = roundUnitPrice(
              quotePriceToUsd(limitPrice!, quote.quoteCurrency),
            );
            const gross = roundMoney(priceUsd * request.quantity);
            const reserve = roundMoney(gross + realTradeFee(gross));
            if (lockedPortfolio.available_cash_usd < reserve) {
              throw new RealTradeError(
                "INSUFFICIENT_CASH",
                "真实行情模拟账户可用资金不足",
              );
            }
            order.reservedCashUsd = reserve;
            await databaseTransaction.query(
              `UPDATE real_portfolios
                  SET available_cash_usd = available_cash_usd - $2,
                      frozen_cash_usd = frozen_cash_usd + $2,
                      updated_at = $3
                WHERE id = $1`,
              [portfolio.id, reserve, createdAt],
            );
          } else {
            const position = (
              await databaseTransaction.query<PositionRow>(
                `SELECT id, portfolio_id, instrument_id, quantity,
                        available_quantity, frozen_quantity,
                        average_cost_usd::float8
                   FROM real_positions
                  WHERE portfolio_id = $1 AND instrument_id = $2
                  FOR UPDATE`,
                [portfolio.id, instrument.id],
              )
            ).rows[0];
            if (
              !position ||
              position.available_quantity < request.quantity
            ) {
              throw new RealTradeError(
                "INSUFFICIENT_POSITION",
                instrument.settlementCycle === "T1"
                  ? "可卖持仓不足，当日买入的沪深股票须下一交易日才能卖出"
                  : "可卖持仓不足",
              );
            }
            order.reservedQuantity = request.quantity;
            await databaseTransaction.query(
              `UPDATE real_positions
                  SET available_quantity = available_quantity - $3,
                      frozen_quantity = frozen_quantity + $3,
                      updated_at = $4
                WHERE portfolio_id = $1 AND instrument_id = $2`,
              [
                portfolio.id,
                instrument.id,
                request.quantity,
                createdAt,
              ],
            );
          }
          await insertRealOrder(databaseTransaction, order);
        },
      );
      return {
        order: toPublicRealOrder(order),
        portfolio: await this.#buildSnapshot(
          portfolio.id,
          displayCurrency,
        ),
      };
    });
  }

  cancelOrder(
    accountId: string,
    displayCurrency: DisplayCurrency,
    orderId: string,
  ): Promise<OrderCancellationResult> {
    return this.#enqueue(async () => {
      const portfolio = await this.#ensurePortfolio(accountId);
      const now = this.clock().toISOString();
      const row = await this.repository.client.transaction(
        async (databaseTransaction) => {
          const order = (
            await databaseTransaction.query<RealOrderRow>(
              `SELECT id, portfolio_id, instrument_id, side,
                      order_mode, status, quantity, filled_quantity,
                      limit_price::float8, quote_currency,
                      reserved_cash_usd::float8, reserved_quantity,
                      actor_type, actor_id, idempotency_key, created_at,
                      updated_at, filled_at, cancelled_at, transaction_id
                 FROM real_orders
                WHERE id = $1 AND portfolio_id = $2
                FOR UPDATE`,
              [orderId, portfolio.id],
            )
          ).rows[0];
          if (!order) {
            throw new RealTradeError(
              "ORDER_NOT_FOUND",
              "没有找到这笔委托",
              404,
            );
          }
          if (order.status === "CANCELLED") {
            return order;
          }
          if (order.status !== "OPEN") {
            throw new RealTradeError(
              "ORDER_NOT_OPEN",
              "已成交的委托不能撤销",
              409,
            );
          }
          if (order.side === "BUY") {
            const lockedPortfolio = (
              await databaseTransaction.query<{
                frozen_cash_usd: number;
              }>(
                `SELECT frozen_cash_usd::float8
                   FROM real_portfolios
                  WHERE id = $1
                  FOR UPDATE`,
                [portfolio.id],
              )
            ).rows[0];
            if (
              !lockedPortfolio ||
              order.reserved_cash_usd <= 0 ||
              lockedPortfolio.frozen_cash_usd + 0.01 <
                order.reserved_cash_usd
            ) {
              throw new Error("ORDER_CASH_RESERVATION_CORRUPTED");
            }
            await databaseTransaction.query(
              `UPDATE real_portfolios
                  SET available_cash_usd =
                        available_cash_usd + $2,
                      frozen_cash_usd =
                        frozen_cash_usd - $2,
                      updated_at = $3
                WHERE id = $1`,
              [portfolio.id, order.reserved_cash_usd, now],
            );
          } else {
            const lockedPosition = (
              await databaseTransaction.query<{
                frozen_quantity: number;
              }>(
                `SELECT frozen_quantity
                   FROM real_positions
                  WHERE portfolio_id = $1 AND instrument_id = $2
                  FOR UPDATE`,
                [portfolio.id, order.instrument_id],
              )
            ).rows[0];
            if (
              !lockedPosition ||
              order.reserved_quantity <= 0 ||
              lockedPosition.frozen_quantity < order.reserved_quantity
            ) {
              throw new Error("ORDER_POSITION_RESERVATION_CORRUPTED");
            }
            await databaseTransaction.query(
              `UPDATE real_positions
                  SET available_quantity =
                        available_quantity + $3,
                      frozen_quantity =
                        frozen_quantity - $3,
                      updated_at = $4
                WHERE portfolio_id = $1 AND instrument_id = $2
                  AND frozen_quantity >= $3`,
              [
                portfolio.id,
                order.instrument_id,
                order.reserved_quantity,
                now,
              ],
            );
          }
          const cancelled = {
            ...order,
            status: "CANCELLED" as const,
            reserved_cash_usd: 0,
            reserved_quantity: 0,
            updated_at: now,
            cancelled_at: now,
          };
          await databaseTransaction.query(
            `UPDATE real_orders
                SET status = 'CANCELLED', reserved_cash_usd = 0,
                    reserved_quantity = 0, updated_at = $2,
                    cancelled_at = $2
              WHERE id = $1 AND status = 'OPEN'`,
            [order.id, now],
          );
          return cancelled;
        },
      );
      return {
        order: this.#toPublicOrder(row),
        portfolio: await this.#buildSnapshot(
          portfolio.id,
          displayCurrency,
        ),
      };
    });
  }

  matchOpenOrders(instrumentIds?: string[]): Promise<number> {
    return this.#enqueue(async () => {
      const parameters: unknown[] = [];
      let filter = "";
      if (instrumentIds && instrumentIds.length > 0) {
        parameters.push(instrumentIds);
        filter = " AND instrument_id = ANY($1::text[])";
      } else if (instrumentIds?.length === 0) {
        return 0;
      }
      const open = await this.repository.client.query<RealOrderRow>(
        `SELECT id, portfolio_id, instrument_id, side, order_mode,
                status, quantity, filled_quantity, limit_price::float8,
                quote_currency, reserved_cash_usd::float8,
                reserved_quantity, actor_type, actor_id, idempotency_key,
                created_at, updated_at, filled_at, cancelled_at,
                transaction_id
           FROM real_orders
          WHERE status = 'OPEN'${filter}
          ORDER BY created_at`,
        parameters,
      );
      let filled = 0;
      for (const order of open.rows) {
        const quote = this.repository.getQuote(order.instrument_id);
        if (!quote || !realOrderRowCrosses(order, quote.currentPrice)) {
          continue;
        }
        if (
          this.clock().getTime() - new Date(quote.receivedAt).getTime() >
          this.quoteMaximumReceiveAgeMs
        ) {
          continue;
        }
        const instrument = this.repository.getInstrumentById(
          order.instrument_id,
        );
        if (!instrument) {
          continue;
        }
        const result = await this.#fillReservedOrder(
          order,
          instrument,
          quote,
        );
        if (result) {
          filled += 1;
        }
      }
      return filled;
    });
  }

  async execute(
    accountId: string,
    displayCurrency: DisplayCurrency,
    request: TradeRequest,
    orderDraft?: RealOrderRecord,
  ): Promise<TradeResult> {
    const portfolio = await this.#ensurePortfolio(accountId);
    const now = this.clock();
    await this.#settleDue(portfolio.id, now);
    const instrument = this.repository.getInstrumentById(
      request.instrumentId,
    );
    const quote = this.repository.getQuote(request.instrumentId);

    if (!instrument || !quote || !instrument.isTradable) {
      throw new RealTradeError(
        "REAL_INSTRUMENT_NOT_TRADABLE",
        "这只真实股票当前没有可交易的真实报价",
        404,
      );
    }
    if (
      now.getTime() - new Date(quote.receivedAt).getTime() >
      this.quoteMaximumReceiveAgeMs
    ) {
      throw new RealTradeError(
        "REAL_QUOTE_STALE",
        "真实行情已经过期，请等待东方财富同步恢复后再交易",
        409,
      );
    }
    if (
      !Number.isSafeInteger(request.quantity) ||
      request.quantity <= 0 ||
      request.quantity % instrument.lotSize !== 0
    ) {
      throw new RealTradeError(
        "INVALID_LOT_SIZE",
        `必须按整手交易，1 手为 ${instrument.lotSize} 股`,
      );
    }
    if (
      !orderDraft &&
      request.orderMode !== undefined &&
      request.orderMode !== "MARKET"
    ) {
      throw new RealTradeError(
        "ORDER_MODE_UNSUPPORTED",
        "真实行情模拟盘当前只支持市价成交",
      );
    }

    const transaction = await this.repository.client.transaction(
      async (databaseTransaction) => {
        const portfolioResult =
          await databaseTransaction.query<PortfolioRow>(
            `SELECT id, account_id, initial_cash_usd::float8,
                    available_cash_usd::float8,
                    frozen_cash_usd::float8
               FROM real_portfolios
              WHERE id = $1
              FOR UPDATE`,
            [portfolio.id],
          );
        const currentPortfolio = portfolioResult.rows[0];
        if (!currentPortfolio) {
          throw new RealTradeError(
            "REAL_PORTFOLIO_NOT_FOUND",
            "真实行情模拟账户不存在",
            404,
          );
        }

        const existing = request.idempotencyKey
          ? await findIdempotentTransaction(
              databaseTransaction,
              portfolio.id,
              request.idempotencyKey,
            )
          : null;
        if (existing) {
          assertSameTransaction(existing, request);
          return existing;
        }
        const positionResult =
          await databaseTransaction.query<PositionRow>(
            `SELECT id, portfolio_id, instrument_id, quantity,
                    available_quantity, frozen_quantity,
                    average_cost_usd::float8
               FROM real_positions
              WHERE portfolio_id = $1 AND instrument_id = $2
              FOR UPDATE`,
            [portfolio.id, instrument.id],
          );
        const oldPosition = positionResult.rows[0]
          ? mapPosition(positionResult.rows[0])
          : null;
        const priceUsd = roundUnitPrice(
          quotePriceToUsd(
            quote.currentPrice,
            quote.quoteCurrency,
          ),
        );
        const fxRateToUsd =
          quote.quoteCurrency === "CNY"
            ? 1 / USD_CNY_DISPLAY_RATE
            : 1;
        const grossAmountUsd = roundMoney(
          priceUsd * request.quantity,
        );
        const feeUsd = roundMoney(
          Math.max(
            MINIMUM_TRADE_FEE_USD,
            grossAmountUsd * VIRTUAL_TRADE_FEE_RATE,
          ),
        );
        const transactionId = randomUUID();
        let availableCashUsd = currentPortfolio.available_cash_usd;
        let position: RealPositionRecord | null;
        let netAmountUsd: number;
        let realizedProfitUsd: number | null = null;

        if (request.side === "BUY") {
          netAmountUsd = roundMoney(grossAmountUsd + feeUsd);
          if (netAmountUsd > availableCashUsd) {
            throw new RealTradeError(
              "INSUFFICIENT_CASH",
              "真实行情模拟账户可用资金不足",
            );
          }
          availableCashUsd = roundMoney(
            availableCashUsd - netAmountUsd,
          );
          const oldQuantity = oldPosition?.quantity ?? 0;
          const nextQuantity = oldQuantity + request.quantity;
          position = {
            id: oldPosition?.id ?? randomUUID(),
            portfolioId: portfolio.id,
            instrumentId: instrument.id,
            quantity: nextQuantity,
            availableQuantity:
              (oldPosition?.availableQuantity ?? 0) +
              (instrument.settlementCycle === "T0"
                ? request.quantity
                : 0),
            frozenQuantity: oldPosition?.frozenQuantity ?? 0,
            averageCostUsd: roundUnitPrice(
              ((oldPosition?.averageCostUsd ?? 0) * oldQuantity +
                priceUsd * request.quantity +
                feeUsd) /
                nextQuantity,
            ),
          };
        } else {
          if (
            !oldPosition ||
            request.quantity > oldPosition.availableQuantity
          ) {
            throw new RealTradeError(
              "INSUFFICIENT_POSITION",
              instrument.settlementCycle === "T1"
                ? "可卖持仓不足，当日买入的沪深股票须下一交易日才能卖出"
                : "可卖持仓不足",
            );
          }
          netAmountUsd = roundMoney(grossAmountUsd - feeUsd);
          realizedProfitUsd = roundMoney(
            (priceUsd - oldPosition.averageCostUsd) *
              request.quantity -
              feeUsd,
          );
          availableCashUsd = roundMoney(
            availableCashUsd + netAmountUsd,
          );
          const remaining = oldPosition.quantity - request.quantity;
          position =
            remaining === 0
              ? null
              : {
                  ...oldPosition,
                  quantity: remaining,
                  availableQuantity:
                    oldPosition.availableQuantity - request.quantity,
                };
        }

        const nextTransaction: Transaction = {
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
          actorType: "USER",
          actorId: accountId,
          idempotencyKey: request.idempotencyKey,
        };
        await insertTransaction(
          databaseTransaction,
          portfolio.id,
          nextTransaction,
        );
        await databaseTransaction.query(
          `UPDATE real_portfolios
              SET available_cash_usd = $2,
                  updated_at = $3
            WHERE id = $1`,
          [portfolio.id, availableCashUsd, now.toISOString()],
        );
        if (position) {
          await databaseTransaction.query(
            `INSERT INTO real_positions (
               id, portfolio_id, instrument_id, quantity,
               available_quantity, frozen_quantity,
               average_cost_usd, updated_at
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (portfolio_id, instrument_id)
             DO UPDATE SET
               quantity = excluded.quantity,
               available_quantity = excluded.available_quantity,
               frozen_quantity = excluded.frozen_quantity,
               average_cost_usd = excluded.average_cost_usd,
               updated_at = excluded.updated_at`,
            [
              position.id,
              portfolio.id,
              position.instrumentId,
              position.quantity,
              position.availableQuantity,
              position.frozenQuantity,
              position.averageCostUsd,
              now.toISOString(),
            ],
          );
        } else {
          await databaseTransaction.query(
            `DELETE FROM real_positions
              WHERE portfolio_id = $1 AND instrument_id = $2`,
            [portfolio.id, instrument.id],
          );
        }

        if (
          request.side === "BUY" &&
          instrument.settlementCycle === "T1"
        ) {
          const unlockAt = nextSettlementAt(instrument.market, now);
          if (!unlockAt) {
            throw new Error("T1_SETTLEMENT_DATE_UNAVAILABLE");
          }
          await databaseTransaction.query(
            `INSERT INTO real_position_settlement_lots (
               id, portfolio_id, instrument_id, quantity,
               unlock_at, source_transaction_id
             )
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              randomUUID(),
              portfolio.id,
              instrument.id,
              request.quantity,
              unlockAt.toISOString(),
              transactionId,
            ],
          );
        }
        if (orderDraft) {
          await insertRealOrder(databaseTransaction, {
            ...orderDraft,
            status: "FILLED",
            filledQuantity: orderDraft.quantity,
            filledAt: now.toISOString(),
            updatedAt: now.toISOString(),
            transactionId,
          });
        }
        return nextTransaction;
      },
    );

    return {
      transaction,
      portfolio: await this.#buildSnapshot(
        portfolio.id,
        displayCurrency,
      ),
    };
  }

  #enqueue<T>(work: () => Promise<T>): Promise<T> {
    const operation = this.#queue.then(work);
    this.#queue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  #validateOrderRequest(request: TradeRequest, now: Date) {
    const instrument = this.repository.getInstrumentById(
      request.instrumentId,
    );
    const quote = this.repository.getQuote(request.instrumentId);
    if (!instrument || !quote || !instrument.isTradable) {
      throw new RealTradeError(
        "REAL_INSTRUMENT_NOT_TRADABLE",
        "这只真实股票当前没有可交易的真实报价",
        404,
      );
    }
    if (
      now.getTime() - new Date(quote.receivedAt).getTime() >
      this.quoteMaximumReceiveAgeMs
    ) {
      throw new RealTradeError(
        "REAL_QUOTE_STALE",
        "真实行情已经过期，请等待东方财富同步恢复后再交易",
        409,
      );
    }
    if (
      !Number.isSafeInteger(request.quantity) ||
      request.quantity <= 0 ||
      request.quantity % instrument.lotSize !== 0
    ) {
      throw new RealTradeError(
        "INVALID_LOT_SIZE",
        `必须按整手交易，1 手为 ${instrument.lotSize} 股`,
      );
    }
    return { instrument, quote };
  }

  #toPublicOrder(row: RealOrderRow): LimitOrder {
    const instrument = this.repository.getInstrumentById(
      row.instrument_id,
    );
    if (!instrument) {
      throw new Error("REAL_ORDER_INSTRUMENT_NOT_FOUND");
    }
    return {
      id: row.id,
      mode: "REAL",
      instrumentId: row.instrument_id,
      symbol: instrument.symbol,
      name: instrument.name,
      market: instrument.market,
      side: row.side,
      orderMode: row.order_mode,
      status: row.status,
      quantity: row.quantity,
      filledQuantity: row.filled_quantity,
      limitPrice: row.limit_price,
      quoteCurrency: row.quote_currency,
      reservedCashUsd: row.reserved_cash_usd,
      reservedQuantity: row.reserved_quantity,
      actorType: row.actor_type,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      filledAt: row.filled_at
        ? new Date(row.filled_at).toISOString()
        : null,
      cancelledAt: row.cancelled_at
        ? new Date(row.cancelled_at).toISOString()
        : null,
      transactionId: row.transaction_id,
    };
  }

  async #fillReservedOrder(
    candidate: RealOrderRow,
    instrument: import("./types.js").RealInstrumentRecord,
    quote: import("./types.js").RealQuoteRecord,
  ): Promise<Transaction | null> {
    const now = this.clock();
    return this.repository.client.transaction(
      async (databaseTransaction) => {
        const order = (
          await databaseTransaction.query<RealOrderRow>(
            `SELECT id, portfolio_id, instrument_id, side,
                    order_mode, status, quantity, filled_quantity,
                    limit_price::float8, quote_currency,
                    reserved_cash_usd::float8, reserved_quantity,
                    actor_type, actor_id, idempotency_key, created_at,
                    updated_at, filled_at, cancelled_at, transaction_id
               FROM real_orders
              WHERE id = $1 FOR UPDATE`,
            [candidate.id],
          )
        ).rows[0];
        if (
          !order ||
          order.status !== "OPEN" ||
          !realOrderRowCrosses(order, quote.currentPrice)
        ) {
          return null;
        }
        const portfolio = (
          await databaseTransaction.query<PortfolioRow>(
            `SELECT id, account_id, initial_cash_usd::float8,
                    available_cash_usd::float8,
                    frozen_cash_usd::float8
               FROM real_portfolios
              WHERE id = $1 FOR UPDATE`,
            [order.portfolio_id],
          )
        ).rows[0];
        if (!portfolio) {
          throw new Error("REAL_ORDER_PORTFOLIO_NOT_FOUND");
        }
        const positionRow = (
          await databaseTransaction.query<PositionRow>(
            `SELECT id, portfolio_id, instrument_id, quantity,
                    available_quantity, frozen_quantity,
                    average_cost_usd::float8
               FROM real_positions
              WHERE portfolio_id = $1 AND instrument_id = $2
              FOR UPDATE`,
            [order.portfolio_id, order.instrument_id],
          )
        ).rows[0];
        const oldPosition = positionRow
          ? mapPosition(positionRow)
          : null;
        const priceUsd = roundUnitPrice(
          quotePriceToUsd(quote.currentPrice, quote.quoteCurrency),
        );
        const grossAmountUsd = roundMoney(priceUsd * order.quantity);
        const feeUsd = realTradeFee(grossAmountUsd);
        let availableCashUsd = portfolio.available_cash_usd;
        let frozenCashUsd = portfolio.frozen_cash_usd;
        let position: RealPositionRecord | null;
        let netAmountUsd: number;
        let realizedProfitUsd: number | null = null;

        if (order.side === "BUY") {
          netAmountUsd = roundMoney(grossAmountUsd + feeUsd);
          if (frozenCashUsd + 0.01 < order.reserved_cash_usd) {
            throw new Error("REAL_ORDER_CASH_RESERVATION_CORRUPTED");
          }
          availableCashUsd = roundMoney(
            availableCashUsd + order.reserved_cash_usd - netAmountUsd,
          );
          frozenCashUsd = roundMoney(
            Math.max(0, frozenCashUsd - order.reserved_cash_usd),
          );
          const oldQuantity = oldPosition?.quantity ?? 0;
          const nextQuantity = oldQuantity + order.quantity;
          position = {
            id: oldPosition?.id ?? randomUUID(),
            portfolioId: order.portfolio_id,
            instrumentId: order.instrument_id,
            quantity: nextQuantity,
            availableQuantity:
              (oldPosition?.availableQuantity ?? 0) +
              (instrument.settlementCycle === "T0"
                ? order.quantity
                : 0),
            frozenQuantity: oldPosition?.frozenQuantity ?? 0,
            averageCostUsd: roundUnitPrice(
              ((oldPosition?.averageCostUsd ?? 0) * oldQuantity +
                grossAmountUsd +
                feeUsd) /
                nextQuantity,
            ),
          };
        } else {
          if (
            !oldPosition ||
            oldPosition.frozenQuantity < order.reserved_quantity
          ) {
            throw new Error("REAL_ORDER_POSITION_RESERVATION_CORRUPTED");
          }
          netAmountUsd = roundMoney(grossAmountUsd - feeUsd);
          availableCashUsd = roundMoney(
            availableCashUsd + netAmountUsd,
          );
          realizedProfitUsd = roundMoney(
            (priceUsd - oldPosition.averageCostUsd) * order.quantity -
              feeUsd,
          );
          const remaining = oldPosition.quantity - order.quantity;
          position =
            remaining === 0
              ? null
              : {
                  ...oldPosition,
                  quantity: remaining,
                  frozenQuantity:
                    oldPosition.frozenQuantity - order.quantity,
                };
        }

        const nextTransaction: Transaction = {
          id: randomUUID(),
          instrumentId: instrument.id,
          symbol: instrument.symbol,
          name: instrument.name,
          market: instrument.market,
          side: order.side,
          quantity: order.quantity,
          quotePrice: quote.currentPrice,
          quoteCurrency: quote.quoteCurrency,
          fxRateToUsd:
            quote.quoteCurrency === "CNY"
              ? 1 / USD_CNY_DISPLAY_RATE
              : 1,
          priceUsd,
          grossAmountUsd,
          feeUsd,
          netAmountUsd,
          realizedProfitUsd,
          createdAt: now.toISOString(),
          actorType: order.actor_type,
          actorId: order.actor_id,
          idempotencyKey: order.idempotency_key ?? undefined,
        };
        await insertTransaction(
          databaseTransaction,
          order.portfolio_id,
          nextTransaction,
        );
        await databaseTransaction.query(
          `UPDATE real_portfolios
              SET available_cash_usd = $2, frozen_cash_usd = $3,
                  updated_at = $4
            WHERE id = $1`,
          [
            order.portfolio_id,
            availableCashUsd,
            frozenCashUsd,
            now.toISOString(),
          ],
        );
        if (position) {
          await databaseTransaction.query(
            `INSERT INTO real_positions (
               id, portfolio_id, instrument_id, quantity,
               available_quantity, frozen_quantity,
               average_cost_usd, updated_at
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             ON CONFLICT (portfolio_id, instrument_id)
             DO UPDATE SET quantity = excluded.quantity,
               available_quantity = excluded.available_quantity,
               frozen_quantity = excluded.frozen_quantity,
               average_cost_usd = excluded.average_cost_usd,
               updated_at = excluded.updated_at`,
            [
              position.id,
              order.portfolio_id,
              position.instrumentId,
              position.quantity,
              position.availableQuantity,
              position.frozenQuantity,
              position.averageCostUsd,
              now.toISOString(),
            ],
          );
        } else {
          await databaseTransaction.query(
            `DELETE FROM real_positions
              WHERE portfolio_id = $1 AND instrument_id = $2`,
            [order.portfolio_id, order.instrument_id],
          );
        }
        if (
          order.side === "BUY" &&
          instrument.settlementCycle === "T1"
        ) {
          const unlockAt = nextSettlementAt(instrument.market, now);
          if (!unlockAt) {
            throw new Error("T1_SETTLEMENT_DATE_UNAVAILABLE");
          }
          await databaseTransaction.query(
            `INSERT INTO real_position_settlement_lots (
               id, portfolio_id, instrument_id, quantity,
               unlock_at, source_transaction_id
             ) VALUES ($1,$2,$3,$4,$5,$6)`,
            [
              randomUUID(),
              order.portfolio_id,
              order.instrument_id,
              order.quantity,
              unlockAt.toISOString(),
              nextTransaction.id,
            ],
          );
        }
        await databaseTransaction.query(
          `UPDATE real_orders
              SET status = 'FILLED', filled_quantity = quantity,
                  reserved_cash_usd = 0, reserved_quantity = 0,
                  updated_at = $2, filled_at = $2,
                  transaction_id = $3
            WHERE id = $1 AND status = 'OPEN'`,
          [order.id, now.toISOString(), nextTransaction.id],
        );
        return nextTransaction;
      },
    );
  }

  async creditAdjustment(
    accountId: string,
    claimId: string,
    amountUsd: number,
    reason: string,
    displayCurrency: DisplayCurrency,
  ): Promise<PortfolioSnapshot> {
    const portfolio = await this.#ensurePortfolio(accountId);
    await this.repository.client.transaction(
      async (databaseTransaction) => {
        const existing = await databaseTransaction.query<{ id: string }>(
          `SELECT id
             FROM real_cash_adjustments
            WHERE claim_id = $1`,
          [claimId],
        );
        if (existing.rows[0]) {
          return;
        }
        await databaseTransaction.query(
          `INSERT INTO real_cash_adjustments
             (id, portfolio_id, claim_id, amount_usd, reason)
           VALUES ($1, $2, $3, $4, $5)`,
          [randomUUID(), portfolio.id, claimId, amountUsd, reason],
        );
        await databaseTransaction.query(
          `UPDATE real_portfolios
              SET initial_cash_usd = initial_cash_usd + $2,
                  available_cash_usd = available_cash_usd + $2,
                  updated_at = $3
            WHERE id = $1`,
          [
            portfolio.id,
            roundMoney(amountUsd),
            this.clock().toISOString(),
          ],
        );
      },
    );
    return this.#buildSnapshot(portfolio.id, displayCurrency);
  }

  async #ensurePortfolio(
    accountId: string,
  ): Promise<RealPortfolioRecord> {
    const existing = await this.repository.client.query<PortfolioRow>(
      `SELECT id, account_id, initial_cash_usd::float8,
              available_cash_usd::float8, frozen_cash_usd::float8
         FROM real_portfolios
        WHERE account_id = $1`,
      [accountId],
    );
    if (existing.rows[0]) {
      return mapPortfolio(existing.rows[0]);
    }

    const id = randomUUID();
    await this.repository.client.query(
      `INSERT INTO real_portfolios (
         id, account_id, initial_cash_usd,
         available_cash_usd, frozen_cash_usd
       )
       VALUES ($1, $2, $3, $3, 0)
       ON CONFLICT (account_id) DO NOTHING`,
      [id, accountId, GAME_RULES.initialCashUsd],
    );
    const result = await this.repository.client.query<PortfolioRow>(
      `SELECT id, account_id, initial_cash_usd::float8,
              available_cash_usd::float8, frozen_cash_usd::float8
         FROM real_portfolios
        WHERE account_id = $1`,
      [accountId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("REAL_PORTFOLIO_CREATION_FAILED");
    }
    return mapPortfolio(row);
  }

  async #settleDue(portfolioId: string, now: Date): Promise<void> {
    await this.repository.client.transaction(
      async (databaseTransaction) => {
        const due = await databaseTransaction.query<{
          id: string;
          instrument_id: string;
          quantity: number;
        }>(
          `SELECT id, instrument_id, quantity
             FROM real_position_settlement_lots
            WHERE portfolio_id = $1
              AND settled_at IS NULL
              AND unlock_at <= $2
            ORDER BY unlock_at
            FOR UPDATE`,
          [portfolioId, now.toISOString()],
        );
        for (const lot of due.rows) {
          await databaseTransaction.query(
            `UPDATE real_positions
                SET available_quantity =
                      LEAST(
                        quantity - frozen_quantity,
                        available_quantity + $3
                      ),
                    updated_at = $4
              WHERE portfolio_id = $1 AND instrument_id = $2`,
            [
              portfolioId,
              lot.instrument_id,
              lot.quantity,
              now.toISOString(),
            ],
          );
          await databaseTransaction.query(
            `UPDATE real_position_settlement_lots
                SET settled_at = $2
              WHERE id = $1`,
            [lot.id, now.toISOString()],
          );
        }
      },
    );
  }

  async #buildSnapshot(
    portfolioId: string,
    displayCurrency: DisplayCurrency,
  ): Promise<PortfolioSnapshot> {
    const portfolioResult =
      await this.repository.client.query<PortfolioRow>(
        `SELECT id, account_id, initial_cash_usd::float8,
                available_cash_usd::float8,
                frozen_cash_usd::float8
           FROM real_portfolios
          WHERE id = $1`,
        [portfolioId],
      );
    const row = portfolioResult.rows[0];
    if (!row) {
      throw new Error("REAL_PORTFOLIO_NOT_FOUND");
    }
    const portfolio = mapPortfolio(row);
    const positionResult =
      await this.repository.client.query<PositionRow>(
        `SELECT id, portfolio_id, instrument_id, quantity,
                available_quantity, frozen_quantity,
                average_cost_usd::float8
           FROM real_positions
          WHERE portfolio_id = $1`,
        [portfolioId],
      );
    const positions = positionResult.rows
      .map(mapPosition)
      .map((record): Position | null => {
        const instrument = this.repository.getInstrumentById(
          record.instrumentId,
        );
        const quote = this.repository.getQuote(record.instrumentId);
        if (!instrument || !quote) {
          return null;
        }
        const currentPriceUsd = roundUnitPrice(
          quotePriceToUsd(
            quote.currentPrice,
            quote.quoteCurrency,
          ),
        );
        const marketValueUsd = roundMoney(
          currentPriceUsd * record.quantity,
        );
        const costUsd = roundMoney(
          record.averageCostUsd * record.quantity,
        );
        const profitLossUsd = roundMoney(
          marketValueUsd - costUsd,
        );
        return {
          instrumentId: record.instrumentId,
          symbol: instrument.symbol,
          name: instrument.name,
          market: instrument.market,
          quoteCurrency: instrument.quoteCurrency,
          quantity: record.quantity,
          availableQuantity: record.availableQuantity,
          frozenQuantity: record.frozenQuantity,
          pendingSettlementQuantity: Math.max(
            0,
            record.quantity -
              record.availableQuantity -
              record.frozenQuantity,
          ),
          averageCostUsd: record.averageCostUsd,
          currentPriceUsd,
          marketValueUsd,
          profitLossUsd,
          profitLossPercent:
            costUsd === 0
              ? 0
              : roundPercent((profitLossUsd / costUsd) * 100),
        };
      })
      .filter((position): position is Position => position !== null)
      .sort((left, right) => right.marketValueUsd - left.marketValueUsd);
    const positionsValueUsd = roundMoney(
      positions.reduce(
        (sum, position) => sum + position.marketValueUsd,
        0,
      ),
    );
    const unrealizedProfitUsd = roundMoney(
      positions.reduce(
        (sum, position) => sum + position.profitLossUsd,
        0,
      ),
    );
    const realizedResult = await this.repository.client.query<{
      total: number;
    }>(
      `SELECT COALESCE(SUM(realized_profit_usd), 0)::float8 AS total
         FROM real_transactions
        WHERE portfolio_id = $1`,
      [portfolioId],
    );
    const realizedProfitUsd = roundMoney(
      realizedResult.rows[0]?.total ?? 0,
    );
    const totalAssetsUsd = roundMoney(
      portfolio.availableCashUsd +
        portfolio.frozenCashUsd +
        positionsValueUsd,
    );
    return {
      mode: "REAL",
      displayCurrency,
      usdCnyRate: USD_CNY_DISPLAY_RATE,
      initialCashUsd: portfolio.initialCashUsd,
      availableCashUsd: portfolio.availableCashUsd,
      frozenCashUsd: portfolio.frozenCashUsd,
      positionsValueUsd,
      totalAssetsUsd,
      realizedProfitUsd,
      unrealizedProfitUsd,
      totalProfitLossUsd: roundMoney(
        totalAssetsUsd - portfolio.initialCashUsd,
      ),
      positions,
    };
  }
}

interface PortfolioRow {
  id: string;
  account_id: string;
  initial_cash_usd: number;
  available_cash_usd: number;
  frozen_cash_usd: number;
}

interface PositionRow {
  id: string;
  portfolio_id: string;
  instrument_id: string;
  quantity: number;
  available_quantity: number;
  frozen_quantity: number;
  average_cost_usd: number;
}

interface TransactionRow {
  id: string;
  instrument_id: string;
  symbol: string;
  name: string;
  market: Transaction["market"];
  side: Transaction["side"];
  quantity: number;
  quote_price: number;
  quote_currency: Transaction["quoteCurrency"];
  fx_rate_to_usd: number;
  price_usd: number;
  gross_amount_usd: number;
  fee_usd: number;
  net_amount_usd: number;
  realized_profit_usd: number | null;
  actor_type: Transaction["actorType"];
  actor_id: string | null;
  idempotency_key: string | null;
  created_at: Date | string;
}

interface RealOrderRecord extends LimitOrder {
  mode: "REAL";
  portfolioId: string;
  actorId: string;
  idempotencyKey?: string;
}

interface RealOrderRow {
  id: string;
  portfolio_id: string;
  instrument_id: string;
  side: "BUY" | "SELL";
  order_mode: "MARKET" | "LIMIT";
  status: OrderStatus;
  quantity: number;
  filled_quantity: number;
  limit_price: number | null;
  quote_currency: Transaction["quoteCurrency"];
  reserved_cash_usd: number;
  reserved_quantity: number;
  actor_type: Transaction["actorType"];
  actor_id: string;
  idempotency_key: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  filled_at: Date | string | null;
  cancelled_at: Date | string | null;
  transaction_id: string | null;
}

function mapPortfolio(row: PortfolioRow): RealPortfolioRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    initialCashUsd: row.initial_cash_usd,
    availableCashUsd: row.available_cash_usd,
    frozenCashUsd: row.frozen_cash_usd,
  };
}

function mapPosition(row: PositionRow): RealPositionRecord {
  return {
    id: row.id,
    portfolioId: row.portfolio_id,
    instrumentId: row.instrument_id,
    quantity: row.quantity,
    availableQuantity: row.available_quantity,
    frozenQuantity: row.frozen_quantity,
    averageCostUsd: row.average_cost_usd,
  };
}

function toTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    instrumentId: row.instrument_id,
    symbol: row.symbol,
    name: row.name,
    market: row.market,
    side: row.side,
    quantity: row.quantity,
    quotePrice: row.quote_price,
    quoteCurrency: row.quote_currency,
    fxRateToUsd: row.fx_rate_to_usd,
    priceUsd: row.price_usd,
    grossAmountUsd: row.gross_amount_usd,
    feeUsd: row.fee_usd,
    netAmountUsd: row.net_amount_usd,
    realizedProfitUsd: row.realized_profit_usd,
    createdAt: new Date(row.created_at).toISOString(),
    actorType: row.actor_type,
    actorId: row.actor_id ?? undefined,
    idempotencyKey: row.idempotency_key ?? undefined,
  };
}

function normalizeRealLimitPrice(
  orderMode: "MARKET" | "LIMIT",
  value: number | undefined,
): number | null {
  if (orderMode === "MARKET") {
    if (value !== undefined) {
      throw new RealTradeError(
        "UNEXPECTED_LIMIT_PRICE",
        "市价单不能填写限价",
      );
    }
    return null;
  }
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    throw new RealTradeError(
      "INVALID_LIMIT_PRICE",
      "请输入有效的限价",
    );
  }
  return roundUnitPrice(value);
}

function realOrderCrosses(
  order: RealOrderRecord,
  currentPrice: number,
): boolean {
  if (order.orderMode === "MARKET") {
    return true;
  }
  return order.limitPrice !== null && order.side === "BUY"
    ? currentPrice <= order.limitPrice!
    : order.limitPrice !== null && currentPrice >= order.limitPrice;
}

function realOrderRowCrosses(
  order: RealOrderRow,
  currentPrice: number,
): boolean {
  if (order.order_mode === "MARKET") {
    return true;
  }
  if (order.limit_price === null) {
    return false;
  }
  return order.side === "BUY"
    ? currentPrice <= order.limit_price
    : currentPrice >= order.limit_price;
}

function realTradeFee(grossAmountUsd: number): number {
  return roundMoney(
    Math.max(
      MINIMUM_TRADE_FEE_USD,
      grossAmountUsd * VIRTUAL_TRADE_FEE_RATE,
    ),
  );
}

function toPublicRealOrder(order: RealOrderRecord): LimitOrder {
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

function assertSameRealOrder(
  existing: RealOrderRow,
  request: TradeRequest,
  orderMode: "MARKET" | "LIMIT",
  limitPrice: number | null,
): void {
  if (
    existing.instrument_id !== request.instrumentId ||
    existing.side !== request.side ||
    existing.quantity !== request.quantity ||
    existing.order_mode !== orderMode ||
    existing.limit_price !== limitPrice
  ) {
    throw new RealTradeError(
      "IDEMPOTENCY_KEY_REUSED",
      "这次下单请求标识已经用于另一笔委托",
      409,
    );
  }
}

function assertSameTransaction(
  existing: Transaction,
  request: TradeRequest,
): void {
  if (
    existing.instrumentId !== request.instrumentId ||
    existing.side !== request.side ||
    existing.quantity !== request.quantity
  ) {
    throw new RealTradeError(
      "IDEMPOTENCY_KEY_REUSED",
      "这次交易请求标识已经用于另一笔交易",
      409,
    );
  }
}

async function insertRealOrder(
  transaction: DatabaseTransaction,
  order: RealOrderRecord,
): Promise<void> {
  await transaction.query(
    `INSERT INTO real_orders (
       id, portfolio_id, instrument_id, side, order_mode, status,
       quantity, filled_quantity, limit_price, quote_currency,
       reserved_cash_usd, reserved_quantity, actor_type, actor_id,
       idempotency_key, created_at, updated_at, filled_at,
       cancelled_at, transaction_id
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
       $11,$12,$13,$14,$15,$16,$17,$18,$19,$20
     )`,
    [
      order.id,
      order.portfolioId,
      order.instrumentId,
      order.side,
      order.orderMode,
      order.status,
      order.quantity,
      order.filledQuantity,
      order.limitPrice,
      order.quoteCurrency,
      order.reservedCashUsd,
      order.reservedQuantity,
      order.actorType,
      order.actorId,
      order.idempotencyKey ?? null,
      order.createdAt,
      order.updatedAt,
      order.filledAt,
      order.cancelledAt,
      order.transactionId,
    ],
  );
}

async function findIdempotentTransaction(
  transaction: DatabaseTransaction,
  portfolioId: string,
  idempotencyKey: string,
): Promise<Transaction | null> {
  const result = await transaction.query<TransactionRow>(
    `SELECT id, instrument_id, symbol, name, market, side, quantity,
            quote_price::float8, quote_currency,
            fx_rate_to_usd::float8, price_usd::float8,
            gross_amount_usd::float8, fee_usd::float8,
            net_amount_usd::float8, realized_profit_usd::float8,
            actor_type, actor_id, idempotency_key, created_at
       FROM real_transactions
      WHERE portfolio_id = $1 AND idempotency_key = $2`,
    [portfolioId, idempotencyKey],
  );
  return result.rows[0] ? toTransaction(result.rows[0]) : null;
}

async function insertTransaction(
  databaseTransaction: DatabaseTransaction,
  portfolioId: string,
  transaction: Transaction,
): Promise<void> {
  await databaseTransaction.query(
    `INSERT INTO real_transactions (
       id, portfolio_id, instrument_id, symbol, name, market, side,
       quantity, quote_price, quote_currency, fx_rate_to_usd,
       price_usd, gross_amount_usd, fee_usd, net_amount_usd,
       realized_profit_usd, actor_type, actor_id, idempotency_key,
       created_at
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
       $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
     )`,
    [
      transaction.id,
      portfolioId,
      transaction.instrumentId,
      transaction.symbol,
      transaction.name,
      transaction.market,
      transaction.side,
      transaction.quantity,
      transaction.quotePrice,
      transaction.quoteCurrency,
      transaction.fxRateToUsd,
      transaction.priceUsd,
      transaction.grossAmountUsd,
      transaction.feeUsd,
      transaction.netAmountUsd,
      transaction.realizedProfitUsd,
      transaction.actorType,
      transaction.actorId ?? null,
      transaction.idempotencyKey ?? null,
      transaction.createdAt,
    ],
  );
}
