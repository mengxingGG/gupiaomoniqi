import type {
  AITraderStrategy,
  CandleInterval,
  CandleSource,
  DisplayCurrency,
  InstrumentType,
  Quote,
  QuoteCurrency,
  SettlementCycle,
  SourceCurrency,
  StockMarket,
  TradeActorType,
  Transaction,
} from "@gupiaomoniqi/shared";
import { randomUUID } from "node:crypto";
import {
  and,
  eq,
  inArray,
  isNull,
  lte,
  sql,
} from "drizzle-orm";
import type { DatabaseConnection } from "../db/client.js";
import {
  accounts,
  aiTraders,
  candles as candleTable,
  positionSettlementLots,
  portfolios,
  positions,
  quotes,
  sessions,
  transactions as transactionTable,
} from "../db/schema.js";
import type {
  AITraderRecord,
  AccountRecord,
  CandleRecord,
  CreateAITraderCommit,
  CreateAccountCommit,
  GameRepository,
  InstrumentRecord,
  PortfolioRecord,
  PositionRecord,
  SessionRecord,
  SettlementResult,
  TradeCommit,
} from "./GameRepository.js";

interface InstrumentQuoteRow {
  id: string;
  symbol: string;
  name: string;
  market: StockMarket;
  source_currency: SourceCurrency;
  quote_currency: QuoteCurrency;
  type: InstrumentType;
  industry: string;
  is_tradable: boolean;
  lot_size: number;
  settlement_cycle: SettlementCycle;
  initial_price: number;
  volatility: number;
  liquidity: number;
  current_price: number;
  previous_close: number;
  open_price: number;
  high_price: number;
  low_price: number;
  volume: number;
  change_amount: number;
  change_percent: number;
  quote_updated_at: Date | string;
}

export class DatabaseGameRepository implements GameRepository {
  readonly #instruments = new Map<string, InstrumentRecord>();
  readonly #quotes = new Map<string, Quote>();
  readonly #candles = new Map<string, Map<string, CandleRecord>>();
  readonly #accounts = new Map<string, AccountRecord>();
  readonly #accountIdsByUsername = new Map<string, string>();
  readonly #sessions = new Map<string, SessionRecord>();
  readonly #portfolios = new Map<string, PortfolioRecord>();
  readonly #portfolioIdsByAccount = new Map<string, string>();
  readonly #positions = new Map<string, Map<string, PositionRecord>>();
  readonly #transactions = new Map<string, Transaction[]>();
  readonly #aiTraders = new Map<string, AITraderRecord>();
  readonly #aiTraderIdsByPortfolio = new Map<string, string>();

  private constructor(private readonly connection: DatabaseConnection) {}

  static async create(
    connection: DatabaseConnection,
  ): Promise<DatabaseGameRepository> {
    const repository = new DatabaseGameRepository(connection);
    await repository.#load();
    return repository;
  }

  listInstruments(): InstrumentRecord[] {
    return [...this.#instruments.values()].map((instrument) =>
      structuredClone(instrument),
    );
  }

  getInstrumentById(instrumentId: string): InstrumentRecord | undefined {
    const instrument = this.#instruments.get(instrumentId);
    return instrument ? structuredClone(instrument) : undefined;
  }

  listQuotes(): Quote[] {
    return [...this.#quotes.values()].map((quote) => structuredClone(quote));
  }

  getQuote(instrumentId: string): Quote | undefined {
    const quote = this.#quotes.get(instrumentId);
    return quote ? structuredClone(quote) : undefined;
  }

  async saveQuotes(nextQuotes: Quote[]): Promise<void> {
    await this.connection.db.transaction(async (transaction) => {
      for (const chunk of chunked(nextQuotes, 150)) {
        await transaction
          .insert(quotes)
          .values(
            chunk.map((quote) => ({
              instrumentId: quote.instrumentId,
              currentPrice: quote.currentPrice,
              previousClose: quote.previousClose,
              openPrice: quote.openPrice,
              highPrice: quote.highPrice,
              lowPrice: quote.lowPrice,
              volume: quote.volume,
              changeAmount: quote.changeAmount,
              changePercent: quote.changePercent,
              updatedAt: new Date(quote.updatedAt),
            })),
          )
          .onConflictDoUpdate({
            target: quotes.instrumentId,
            set: {
              currentPrice: sql`excluded.current_price`,
              previousClose: sql`excluded.previous_close`,
              openPrice: sql`excluded.open_price`,
              highPrice: sql`excluded.high_price`,
              lowPrice: sql`excluded.low_price`,
              volume: sql`excluded.volume`,
              changeAmount: sql`excluded.change_amount`,
              changePercent: sql`excluded.change_percent`,
              updatedAt: sql`excluded.updated_at`,
            },
          });
      }
    });

    for (const quote of nextQuotes) {
      this.#quotes.set(quote.instrumentId, structuredClone(quote));
    }
  }

  listCandles(
    instrumentId: string,
    interval: CandleInterval,
  ): CandleRecord[] {
    return [
      ...(this.#candles.get(candleSeriesKey(instrumentId, interval))
        ?.values() ?? []),
    ]
      .sort((left, right) => left.time.localeCompare(right.time))
      .map((candle) => structuredClone(candle));
  }

  getLatestCandle(
    instrumentId: string,
    interval: CandleInterval,
  ): CandleRecord | undefined {
    return cloneLatestCandle(
      this.#candles.get(candleSeriesKey(instrumentId, interval)),
    );
  }

  async upsertCandles(nextCandles: CandleRecord[]): Promise<void> {
    if (nextCandles.length === 0) {
      return;
    }

    await this.connection.db.transaction(async (transaction) => {
      for (const chunk of chunked(nextCandles, 200)) {
        await transaction
          .insert(candleTable)
          .values(
            chunk.map((candle) => ({
              instrumentId: candle.instrumentId,
              interval: candle.interval,
              bucketStart: new Date(candle.time),
              open: candle.open,
              high: candle.high,
              low: candle.low,
              close: candle.close,
              volume: candle.volume,
              source: candle.source,
              isPartial: candle.isPartial,
              updatedAt: new Date(candle.updatedAt),
            })),
          )
          .onConflictDoUpdate({
            target: [
              candleTable.instrumentId,
              candleTable.interval,
              candleTable.bucketStart,
            ],
            set: {
              open: sql`excluded.open`,
              high: sql`excluded.high`,
              low: sql`excluded.low`,
              close: sql`excluded.close`,
              volume: sql`excluded.volume`,
              source: sql`excluded.source`,
              isPartial: sql`excluded.is_partial`,
              updatedAt: sql`excluded.updated_at`,
            },
          });
      }
    });

    for (const candle of nextCandles) {
      const key = candleSeriesKey(candle.instrumentId, candle.interval);
      const series =
        this.#candles.get(key) ?? new Map<string, CandleRecord>();
      series.set(candle.time, structuredClone(candle));
      this.#candles.set(key, series);
    }
  }

  async createAccount(commit: CreateAccountCommit): Promise<void> {
    if (
      this.#accountIdsByUsername.has(commit.account.usernameNormalized)
    ) {
      throw new Error("ACCOUNT_EXISTS");
    }

    try {
      await this.connection.db.transaction(async (transaction) => {
        await transaction.insert(accounts).values({
          id: commit.account.id,
          username: commit.account.username,
          usernameNormalized: commit.account.usernameNormalized,
          passwordHash: commit.account.passwordHash,
          displayName: commit.account.displayName,
          displayCurrency: commit.account.displayCurrency,
          createdAt: new Date(commit.account.createdAt),
          lastLoginAt: commit.account.lastLoginAt
            ? new Date(commit.account.lastLoginAt)
            : null,
        });
        await transaction.insert(portfolios).values({
          id: commit.portfolio.id,
          accountId: commit.account.id,
          name: `${commit.account.displayName}的模拟账户`,
          mode: "VIRTUAL",
          activeCurrency: commit.account.displayCurrency,
          initialCashUsd: commit.portfolio.initialCashUsd,
          availableCashUsd: commit.portfolio.availableCashUsd,
          frozenCashUsd: commit.portfolio.frozenCashUsd,
          createdAt: new Date(commit.account.createdAt),
        });
      });
    } catch (error) {
      if (String(error).includes("username_normalized")) {
        throw new Error("ACCOUNT_EXISTS");
      }
      throw error;
    }

    this.#accounts.set(commit.account.id, structuredClone(commit.account));
    this.#accountIdsByUsername.set(
      commit.account.usernameNormalized,
      commit.account.id,
    );
    this.#portfolios.set(
      commit.portfolio.id,
      structuredClone(commit.portfolio),
    );
    this.#portfolioIdsByAccount.set(
      commit.account.id,
      commit.portfolio.id,
    );
    this.#positions.set(commit.portfolio.id, new Map());
    this.#transactions.set(commit.portfolio.id, []);
  }

  getAccountById(accountId: string): AccountRecord | undefined {
    const account = this.#accounts.get(accountId);
    return account ? structuredClone(account) : undefined;
  }

  getAccountByUsername(
    usernameNormalized: string,
  ): AccountRecord | undefined {
    const accountId = this.#accountIdsByUsername.get(usernameNormalized);
    return accountId ? this.getAccountById(accountId) : undefined;
  }

  async updateLastLogin(accountId: string, at: string): Promise<void> {
    await this.connection.db
      .update(accounts)
      .set({ lastLoginAt: new Date(at) })
      .where(eq(accounts.id, accountId));
    const account = this.#requireAccount(accountId);
    account.lastLoginAt = at;
  }

  async updateDisplayCurrency(
    accountId: string,
    currency: DisplayCurrency,
  ): Promise<void> {
    await this.connection.db.transaction(async (transaction) => {
      await transaction
        .update(accounts)
        .set({ displayCurrency: currency })
        .where(eq(accounts.id, accountId));
      await transaction
        .update(portfolios)
        .set({ activeCurrency: currency })
        .where(eq(portfolios.accountId, accountId));
    });
    this.#requireAccount(accountId).displayCurrency = currency;
  }

  async createSession(session: SessionRecord): Promise<void> {
    await this.connection.db
      .insert(sessions)
      .values({
        tokenHash: session.tokenHash,
        accountId: session.accountId,
        expiresAt: new Date(session.expiresAt),
      })
      .onConflictDoUpdate({
        target: sessions.tokenHash,
        set: {
          accountId: session.accountId,
          expiresAt: new Date(session.expiresAt),
        },
      });
    this.#sessions.set(session.tokenHash, structuredClone(session));
  }

  getSession(tokenHash: string): SessionRecord | undefined {
    const session = this.#sessions.get(tokenHash);

    if (!session) {
      return undefined;
    }

    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      this.#sessions.delete(tokenHash);
      void this.connection.db
        .delete(sessions)
        .where(eq(sessions.tokenHash, tokenHash));
      return undefined;
    }

    return structuredClone(session);
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.connection.db
      .delete(sessions)
      .where(eq(sessions.tokenHash, tokenHash));
    this.#sessions.delete(tokenHash);
  }

  getPortfolioByAccountId(
    accountId: string,
  ): PortfolioRecord | undefined {
    const portfolioId = this.#portfolioIdsByAccount.get(accountId);
    return portfolioId ? this.getPortfolioById(portfolioId) : undefined;
  }

  getPortfolioById(portfolioId: string): PortfolioRecord | undefined {
    const portfolio = this.#portfolios.get(portfolioId);
    return portfolio ? structuredClone(portfolio) : undefined;
  }

  listPositions(portfolioId: string): PositionRecord[] {
    return [...(this.#positions.get(portfolioId)?.values() ?? [])].map(
      (position) => structuredClone(position),
    );
  }

  getPosition(
    portfolioId: string,
    instrumentId: string,
  ): PositionRecord | undefined {
    const position = this.#positions.get(portfolioId)?.get(instrumentId);
    return position ? structuredClone(position) : undefined;
  }

  listTransactions(portfolioId: string): Transaction[] {
    return (this.#transactions.get(portfolioId) ?? []).map((transaction) =>
      structuredClone(transaction),
    );
  }

  getTransactionByIdempotencyKey(
    portfolioId: string,
    idempotencyKey: string,
  ): Transaction | undefined {
    const transaction = (this.#transactions.get(portfolioId) ?? []).find(
      (item) => item.idempotencyKey === idempotencyKey,
    );
    return transaction ? structuredClone(transaction) : undefined;
  }

  async commitTrade(commit: TradeCommit): Promise<void> {
    await this.connection.db.transaction(async (transaction) => {
      await transaction
        .update(portfolios)
        .set({ availableCashUsd: commit.availableCashUsd })
        .where(eq(portfolios.id, commit.portfolioId));

      if (commit.position) {
        await transaction
          .insert(positions)
          .values({
            id: commit.position.id,
            portfolioId: commit.portfolioId,
            instrumentId: commit.position.instrumentId,
            quantity: commit.position.quantity,
            availableQuantity: commit.position.availableQuantity,
            frozenQuantity: commit.position.frozenQuantity,
            averageCost: commit.position.averageCostUsd,
            averageCostUsd: commit.position.averageCostUsd,
            updatedAt: new Date(commit.occurredAt),
          })
          .onConflictDoUpdate({
            target: [positions.portfolioId, positions.instrumentId],
            set: {
              quantity: commit.position.quantity,
              availableQuantity: commit.position.availableQuantity,
              frozenQuantity: commit.position.frozenQuantity,
              averageCost: commit.position.averageCostUsd,
              averageCostUsd: commit.position.averageCostUsd,
              updatedAt: new Date(commit.occurredAt),
            },
          });
      } else {
        await transaction
          .delete(positions)
          .where(
            and(
              eq(positions.portfolioId, commit.portfolioId),
              eq(positions.instrumentId, commit.instrumentId),
            ),
          );
      }

      if (commit.transaction) {
        await transaction.insert(transactionTable).values({
          id: commit.transaction.id,
          portfolioId: commit.portfolioId,
          instrumentId: commit.transaction.instrumentId,
          currency: "USD",
          side: commit.transaction.side,
          quantity: commit.transaction.quantity,
          price: commit.transaction.priceUsd,
          grossAmount: commit.transaction.grossAmountUsd,
          fee: commit.transaction.feeUsd,
          netAmount: commit.transaction.netAmountUsd,
          realizedProfit: commit.transaction.realizedProfitUsd,
          quotePrice: commit.transaction.quotePrice,
          quoteCurrency: commit.transaction.quoteCurrency,
          fxRateToUsd: commit.transaction.fxRateToUsd,
          priceUsd: commit.transaction.priceUsd,
          grossAmountUsd: commit.transaction.grossAmountUsd,
          feeUsd: commit.transaction.feeUsd,
          netAmountUsd: commit.transaction.netAmountUsd,
          realizedProfitUsd: commit.transaction.realizedProfitUsd,
          actorType: commit.transaction.actorType,
          actorId: commit.transaction.actorId,
          idempotencyKey: commit.transaction.idempotencyKey,
          createdAt: new Date(commit.transaction.createdAt),
        });
      }

      if (commit.settlementLot) {
        await transaction.insert(positionSettlementLots).values({
          id: commit.settlementLot.id,
          portfolioId: commit.settlementLot.portfolioId,
          instrumentId: commit.settlementLot.instrumentId,
          quantity: commit.settlementLot.quantity,
          unlockAt: new Date(commit.settlementLot.unlockAt),
          settledAt: commit.settlementLot.settledAt
            ? new Date(commit.settlementLot.settledAt)
            : null,
          sourceTransactionId:
            commit.settlementLot.sourceTransactionId,
          createdAt: new Date(commit.occurredAt),
        });
      }
    });

    const portfolio = this.#requirePortfolio(commit.portfolioId);
    portfolio.availableCashUsd = commit.availableCashUsd;
    const portfolioPositions =
      this.#positions.get(commit.portfolioId) ??
      new Map<string, PositionRecord>();
    this.#positions.set(commit.portfolioId, portfolioPositions);

    if (commit.position) {
      portfolioPositions.set(
        commit.position.instrumentId,
        structuredClone(commit.position),
      );
    } else {
      portfolioPositions.delete(commit.instrumentId);
    }

    if (commit.transaction) {
      const portfolioTransactions =
        this.#transactions.get(commit.portfolioId) ?? [];
      portfolioTransactions.unshift(
        structuredClone(commit.transaction),
      );
      if (
        this.#aiTraderIdsByPortfolio.has(commit.portfolioId) &&
        portfolioTransactions.length > 100
      ) {
        portfolioTransactions.length = 100;
      }
      this.#transactions.set(commit.portfolioId, portfolioTransactions);
    }
  }

  async settleDuePositions(at: string): Promise<SettlementResult[]> {
    const settledAt = new Date(at);
    const dueLots = await this.connection.db
      .select({
        id: positionSettlementLots.id,
        portfolioId: positionSettlementLots.portfolioId,
        instrumentId: positionSettlementLots.instrumentId,
        quantity: positionSettlementLots.quantity,
      })
      .from(positionSettlementLots)
      .where(
        and(
          isNull(positionSettlementLots.settledAt),
          lte(positionSettlementLots.unlockAt, settledAt),
        ),
      );

    if (dueLots.length === 0) {
      return [];
    }

    const grouped = new Map<string, SettlementResult>();

    for (const lot of dueLots) {
      const key = `${lot.portfolioId}:${lot.instrumentId}`;
      const current = grouped.get(key);
      grouped.set(key, {
        portfolioId: lot.portfolioId,
        instrumentId: lot.instrumentId,
        quantity: (current?.quantity ?? 0) + lot.quantity,
      });
    }

    await this.connection.db.transaction(async (transaction) => {
      for (const settlement of grouped.values()) {
        await transaction
          .update(positions)
          .set({
            availableQuantity: sql`LEAST(
              ${positions.quantity} - ${positions.frozenQuantity},
              ${positions.availableQuantity} + ${settlement.quantity}
            )`,
            updatedAt: settledAt,
          })
          .where(
            and(
              eq(positions.portfolioId, settlement.portfolioId),
              eq(positions.instrumentId, settlement.instrumentId),
            ),
          );
      }

      await transaction
        .update(positionSettlementLots)
        .set({ settledAt })
        .where(
          inArray(
            positionSettlementLots.id,
            dueLots.map((lot) => lot.id),
          ),
        );
    });

    for (const settlement of grouped.values()) {
      const position = this.#positions
        .get(settlement.portfolioId)
        ?.get(settlement.instrumentId);

      if (!position) {
        continue;
      }

      position.availableQuantity = Math.min(
        position.quantity - position.frozenQuantity,
        position.availableQuantity + settlement.quantity,
      );
    }

    return [...grouped.values()].map((item) =>
      structuredClone(item),
    );
  }

  async creditCashAdjustment(
    accountId: string,
    claimId: string,
    amountUsd: number,
    reason: string,
  ): Promise<void> {
    const portfolio = this.getPortfolioByAccountId(accountId);

    if (!portfolio) {
      throw new Error("PORTFOLIO_NOT_FOUND");
    }

    let applied = false;
    await this.connection.client.transaction(async (transaction) => {
      const existing = await transaction.query<{ present: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM cash_adjustments WHERE claim_id = $1
         ) AS present`,
        [claimId],
      );

      if (existing.rows[0]?.present) {
        return;
      }

      await transaction.query(
        `INSERT INTO cash_adjustments
           (id, portfolio_id, claim_id, amount_usd, reason)
         VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), portfolio.id, claimId, amountUsd, reason],
      );
      await transaction.query(
        `UPDATE portfolios
            SET initial_cash_usd = initial_cash_usd + $2,
                available_cash_usd = available_cash_usd + $2
          WHERE id = $1`,
        [portfolio.id, amountUsd],
      );
      applied = true;
    });

    if (applied) {
      const cached = this.#requirePortfolio(portfolio.id);
      cached.initialCashUsd += amountUsd;
      cached.availableCashUsd += amountUsd;
    }
  }

  listAITraders(): AITraderRecord[] {
    return [...this.#aiTraders.values()].map((trader) =>
      structuredClone(trader),
    );
  }

  getAITrader(traderId: string): AITraderRecord | undefined {
    const trader = this.#aiTraders.get(traderId);
    return trader ? structuredClone(trader) : undefined;
  }

  getAITraderByPortfolioId(
    portfolioId: string,
  ): AITraderRecord | undefined {
    const traderId = this.#aiTraderIdsByPortfolio.get(portfolioId);
    return traderId ? this.getAITrader(traderId) : undefined;
  }

  async createAITraders(
    commits: CreateAITraderCommit[],
  ): Promise<void> {
    if (commits.length === 0) {
      return;
    }

    await this.connection.db.transaction(async (transaction) => {
      for (const chunk of chunked(commits, 200)) {
        await transaction.insert(portfolios).values(
          chunk.map(({ portfolio }) => ({
            id: portfolio.id,
            accountId: null,
            name: "AI 模拟账户",
            mode: portfolio.mode,
            activeCurrency: "USD",
            initialCashUsd: portfolio.initialCashUsd,
            availableCashUsd: portfolio.availableCashUsd,
            frozenCashUsd: portfolio.frozenCashUsd,
          })),
        );
        await transaction.insert(aiTraders).values(
          chunk.map(({ trader }) => ({
            id: trader.id,
            portfolioId: trader.portfolioId,
            name: trader.name,
            strategy: trader.strategy,
            psychology: trader.psychology,
            riskLevel: trader.riskLevel,
            activityLevel: trader.activityLevel,
            preferredMarket: trader.preferredMarket,
            isActive: trader.isActive,
            lastActionAt: trader.lastActionAt
              ? new Date(trader.lastActionAt)
              : null,
            nextActionAt: new Date(trader.nextActionAt),
            totalTrades: trader.totalTrades,
            winCount: trader.winCount,
            lossCount: trader.lossCount,
            createdAt: new Date(trader.createdAt),
          })),
        );
      }
    });

    for (const commit of commits) {
      this.#portfolios.set(
        commit.portfolio.id,
        structuredClone(commit.portfolio),
      );
      this.#positions.set(commit.portfolio.id, new Map());
      this.#transactions.set(commit.portfolio.id, []);
      this.#aiTraders.set(
        commit.trader.id,
        structuredClone(commit.trader),
      );
      this.#aiTraderIdsByPortfolio.set(
        commit.portfolio.id,
        commit.trader.id,
      );
    }
  }

  async updateAITrader(trader: AITraderRecord): Promise<void> {
    await this.updateAITraders([trader]);
  }

  async updateAITraders(traders: AITraderRecord[]): Promise<void> {
    if (traders.length === 0) {
      return;
    }

    await this.connection.db.transaction(async (transaction) => {
      for (const chunk of chunked(traders, 200)) {
        await transaction
          .insert(aiTraders)
          .values(
            chunk.map((trader) => ({
              id: trader.id,
              portfolioId: trader.portfolioId,
              name: trader.name,
              strategy: trader.strategy,
              psychology: trader.psychology,
              riskLevel: trader.riskLevel,
              activityLevel: trader.activityLevel,
              preferredMarket: trader.preferredMarket,
              isActive: trader.isActive,
              lastActionAt: trader.lastActionAt
                ? new Date(trader.lastActionAt)
                : null,
              nextActionAt: new Date(trader.nextActionAt),
              totalTrades: trader.totalTrades,
              winCount: trader.winCount,
              lossCount: trader.lossCount,
              createdAt: new Date(trader.createdAt),
            })),
          )
          .onConflictDoUpdate({
            target: aiTraders.id,
            set: {
              name: sql`excluded.name`,
              strategy: sql`excluded.strategy`,
              psychology: sql`excluded.psychology`,
              riskLevel: sql`excluded.risk_level`,
              activityLevel: sql`excluded.activity_level`,
              preferredMarket: sql`excluded.preferred_market`,
              isActive: sql`excluded.is_active`,
              lastActionAt: sql`excluded.last_action_at`,
              nextActionAt: sql`excluded.next_action_at`,
              totalTrades: sql`excluded.total_trades`,
              winCount: sql`excluded.win_count`,
              lossCount: sql`excluded.loss_count`,
            },
          });
      }
    });

    for (const trader of traders) {
      this.#aiTraders.set(trader.id, structuredClone(trader));
    }
  }

  async #load(): Promise<void> {
    const instrumentResult =
      await this.connection.client.query<InstrumentQuoteRow>(
        `SELECT i.id, i.symbol, i.name, i.market, i.source_currency,
                i.settlement_currency AS quote_currency, i.type, i.industry,
                i.is_tradable, i.lot_size, i.settlement_cycle,
                i.initial_price::float8,
                i.volatility::float8, i.liquidity,
                q.current_price::float8, q.previous_close::float8,
                q.open_price::float8, q.high_price::float8,
                q.low_price::float8, q.volume::float8,
                q.change_amount::float8, q.change_percent::float8,
                q.updated_at AS quote_updated_at
           FROM instruments i
           JOIN quotes q ON q.instrument_id = i.id
          ORDER BY i.market, i.symbol`,
      );

    for (const row of instrumentResult.rows) {
      this.#instruments.set(row.id, {
        id: row.id,
        symbol: row.symbol,
        name: row.name,
        market: row.market,
        sourceCurrency: row.source_currency,
        quoteCurrency: row.quote_currency,
        type: row.type,
        industry: row.industry,
        isTradable: row.is_tradable,
        lotSize: row.lot_size,
        settlementCycle: row.settlement_cycle,
        initialPrice: row.initial_price,
        volatility: row.volatility,
        liquidity: row.liquidity,
      });
      this.#quotes.set(row.id, {
        instrumentId: row.id,
        symbol: row.symbol,
        market: row.market,
        quoteCurrency: row.quote_currency,
        currentPrice: row.current_price,
        previousClose: row.previous_close,
        openPrice: row.open_price,
        highPrice: row.high_price,
        lowPrice: row.low_price,
        volume: row.volume,
        changeAmount: row.change_amount,
        changePercent: row.change_percent,
        updatedAt: new Date(row.quote_updated_at).toISOString(),
      });
    }

    const candleResult = await this.connection.client.query<{
      instrument_id: string;
      interval: CandleInterval;
      bucket_start: Date | string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      source: CandleSource;
      is_partial: boolean;
      updated_at: Date | string;
    }>(
      `SELECT instrument_id, interval, bucket_start,
              open::float8, high::float8, low::float8, close::float8,
              volume::float8, source, is_partial, updated_at
         FROM candles
        WHERE interval = 'DAY'
           OR bucket_start >= now() - interval '7 days'
        ORDER BY instrument_id, interval, bucket_start`,
    );

    for (const row of candleResult.rows) {
      const candle: CandleRecord = {
        instrumentId: row.instrument_id,
        interval: row.interval,
        time: new Date(row.bucket_start).toISOString(),
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume,
        source: row.source,
        isPartial: row.is_partial,
        updatedAt: new Date(row.updated_at).toISOString(),
      };
      const key = candleSeriesKey(candle.instrumentId, candle.interval);
      const series =
        this.#candles.get(key) ?? new Map<string, CandleRecord>();
      series.set(candle.time, candle);
      this.#candles.set(key, series);
    }

    const accountResult = await this.connection.client.query<{
      id: string;
      username: string;
      username_normalized: string;
      password_hash: string;
      display_name: string;
      display_currency: DisplayCurrency;
      created_at: Date | string;
      last_login_at: Date | string | null;
    }>(
      `SELECT id, username, username_normalized, password_hash, display_name,
              display_currency, created_at, last_login_at
         FROM accounts`,
    );

    for (const row of accountResult.rows) {
      const account: AccountRecord = {
        id: row.id,
        username: row.username,
        usernameNormalized: row.username_normalized,
        passwordHash: row.password_hash,
        displayName: row.display_name,
        displayCurrency: row.display_currency,
        createdAt: new Date(row.created_at).toISOString(),
        lastLoginAt: row.last_login_at
          ? new Date(row.last_login_at).toISOString()
          : null,
      };
      this.#accounts.set(account.id, account);
      this.#accountIdsByUsername.set(
        account.usernameNormalized,
        account.id,
      );
    }

    const sessionResult = await this.connection.client.query<{
      token_hash: string;
      account_id: string;
      expires_at: Date | string;
    }>(
      `SELECT token_hash, account_id, expires_at
         FROM sessions
        WHERE expires_at > now()`,
    );

    for (const row of sessionResult.rows) {
      this.#sessions.set(row.token_hash, {
        tokenHash: row.token_hash,
        accountId: row.account_id,
        expiresAt: new Date(row.expires_at).toISOString(),
      });
    }

    const portfolioResult = await this.connection.client.query<{
      id: string;
      account_id: string | null;
      mode: "VIRTUAL";
      initial_cash_usd: number;
      available_cash_usd: number;
      frozen_cash_usd: number;
    }>(
      `SELECT id, account_id, mode, initial_cash_usd::float8,
              available_cash_usd::float8, frozen_cash_usd::float8
         FROM portfolios`,
    );

    for (const row of portfolioResult.rows) {
      const portfolio: PortfolioRecord = {
        id: row.id,
        accountId: row.account_id,
        mode: "VIRTUAL",
        initialCashUsd: row.initial_cash_usd,
        availableCashUsd: row.available_cash_usd,
        frozenCashUsd: row.frozen_cash_usd,
      };
      this.#portfolios.set(portfolio.id, portfolio);
      if (portfolio.accountId) {
        this.#portfolioIdsByAccount.set(
          portfolio.accountId,
          portfolio.id,
        );
      }
      this.#positions.set(portfolio.id, new Map());
      this.#transactions.set(portfolio.id, []);
    }

    const aiTraderResult = await this.connection.client.query<{
      id: string;
      portfolio_id: string;
      name: string;
      strategy: AITraderStrategy;
      psychology: string;
      risk_level: number;
      activity_level: number;
      preferred_market: StockMarket;
      is_active: boolean;
      last_action_at: Date | string | null;
      next_action_at: Date | string;
      total_trades: number;
      win_count: number;
      loss_count: number;
      created_at: Date | string;
    }>(
      `SELECT id, portfolio_id, name, strategy, psychology,
              risk_level, activity_level, preferred_market, is_active,
              last_action_at, next_action_at, total_trades,
              win_count, loss_count, created_at
         FROM ai_traders`,
    );

    for (const row of aiTraderResult.rows) {
      const trader: AITraderRecord = {
        id: row.id,
        portfolioId: row.portfolio_id,
        name: row.name,
        strategy: row.strategy,
        psychology: row.psychology,
        riskLevel: row.risk_level,
        activityLevel: row.activity_level,
        preferredMarket: row.preferred_market,
        isActive: row.is_active,
        lastActionAt: row.last_action_at
          ? new Date(row.last_action_at).toISOString()
          : null,
        nextActionAt: new Date(row.next_action_at).toISOString(),
        totalTrades: row.total_trades,
        winCount: row.win_count,
        lossCount: row.loss_count,
        createdAt: new Date(row.created_at).toISOString(),
      };
      this.#aiTraders.set(trader.id, trader);
      this.#aiTraderIdsByPortfolio.set(
        trader.portfolioId,
        trader.id,
      );
    }

    const positionResult = await this.connection.client.query<{
      id: string;
      portfolio_id: string;
      instrument_id: string;
      quantity: number;
      available_quantity: number;
      frozen_quantity: number;
      average_cost_usd: number;
    }>(
      `SELECT p.id, p.portfolio_id, p.instrument_id, p.quantity,
              p.available_quantity, p.frozen_quantity,
              p.average_cost_usd::float8
         FROM positions p
         JOIN portfolios pf ON pf.id = p.portfolio_id`,
    );

    for (const row of positionResult.rows) {
      this.#positions.get(row.portfolio_id)?.set(row.instrument_id, {
        id: row.id,
        instrumentId: row.instrument_id,
        quantity: row.quantity,
        availableQuantity: row.available_quantity,
        frozenQuantity: row.frozen_quantity,
        averageCostUsd: row.average_cost_usd,
      });
    }

    const transactionResult = await this.connection.client.query<{
      id: string;
      portfolio_id: string;
      instrument_id: string;
      symbol: string;
      name: string;
      market: StockMarket;
      side: "BUY" | "SELL";
      quantity: number;
      quote_price: number;
      quote_currency: QuoteCurrency;
      fx_rate_to_usd: number;
      price_usd: number;
      gross_amount_usd: number;
      fee_usd: number;
      net_amount_usd: number;
      realized_profit_usd: number | null;
      actor_type: TradeActorType;
      actor_id: string | null;
      idempotency_key: string | null;
      created_at: Date | string;
    }>(
      `SELECT t.id, t.portfolio_id, t.instrument_id, i.symbol, i.name,
              i.market, t.side, t.quantity,
              COALESCE(t.quote_price, t.price)::float8 AS quote_price,
              COALESCE(t.quote_currency, t.currency) AS quote_currency,
              COALESCE(t.fx_rate_to_usd, 1)::float8 AS fx_rate_to_usd,
              COALESCE(t.price_usd, t.price)::float8 AS price_usd,
              COALESCE(t.gross_amount_usd, t.gross_amount)::float8
                AS gross_amount_usd,
              COALESCE(t.fee_usd, t.fee)::float8 AS fee_usd,
              COALESCE(t.net_amount_usd, t.net_amount)::float8
                AS net_amount_usd,
              COALESCE(t.realized_profit_usd, t.realized_profit)::float8
                AS realized_profit_usd,
              t.actor_type, t.actor_id,
              t.idempotency_key,
              t.created_at
         FROM transactions t
         JOIN instruments i ON i.id = t.instrument_id
         JOIN portfolios pf ON pf.id = t.portfolio_id
        WHERE pf.account_id IS NOT NULL
        ORDER BY t.created_at DESC`,
    );

    for (const row of transactionResult.rows) {
      this.#transactions.get(row.portfolio_id)?.push({
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
        actorType: row.actor_type,
        actorId: row.actor_id ?? undefined,
        idempotencyKey: row.idempotency_key ?? undefined,
        createdAt: new Date(row.created_at).toISOString(),
      });
    }
  }

  #requireAccount(accountId: string): AccountRecord {
    const account = this.#accounts.get(accountId);

    if (!account) {
      throw new Error("ACCOUNT_NOT_FOUND");
    }

    return account;
  }

  #requirePortfolio(portfolioId: string): PortfolioRecord {
    const portfolio = this.#portfolios.get(portfolioId);

    if (!portfolio) {
      throw new Error("PORTFOLIO_NOT_FOUND");
    }

    return portfolio;
  }
}

function chunked<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

function candleSeriesKey(
  instrumentId: string,
  interval: CandleInterval,
): string {
  return `${instrumentId}:${interval}`;
}

function cloneLatestCandle(
  series: ReadonlyMap<string, CandleRecord> | undefined,
): CandleRecord | undefined {
  if (!series || series.size === 0) {
    return undefined;
  }

  let latest: CandleRecord | undefined;
  for (const candle of series.values()) {
    if (!latest || candle.time > latest.time) {
      latest = candle;
    }
  }
  return latest ? structuredClone(latest) : undefined;
}
