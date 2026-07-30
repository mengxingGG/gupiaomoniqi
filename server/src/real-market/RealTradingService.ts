import { randomUUID } from "node:crypto";
import {
  MINIMUM_TRADE_FEE_USD,
  USD_CNY_DISPLAY_RATE,
  VIRTUAL_TRADE_FEE_RATE,
  quotePriceToUsd,
  type DisplayCurrency,
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

  async execute(
    accountId: string,
    displayCurrency: DisplayCurrency,
    request: TradeRequest,
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
        const existing = request.idempotencyKey
          ? await findIdempotentTransaction(
              databaseTransaction,
              portfolio.id,
              request.idempotencyKey,
            )
          : null;
        if (existing) {
          return existing;
        }

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
                      available_quantity + $3,
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
