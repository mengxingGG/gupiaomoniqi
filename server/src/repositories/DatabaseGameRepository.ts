import type {
  AITraderStrategy,
  CandleInterval,
  CandleSource,
  DisplayCurrency,
  InstrumentType,
  OrderStatus,
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
  gt,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import type { DatabaseConnection } from "../db/client.js";
import {
  accounts,
  aiTraderDecisions,
  aiTraders,
  candles as candleTable,
  emailVerificationChallenges,
  orders as orderTable,
  passwordResetChallenges,
  positionSettlementLots,
  portfolios,
  positions,
  quotes,
  registrationEmailChallenges,
  sessions,
  transactions as transactionTable,
} from "../db/schema.js";
import type {
  AITraderDecisionRecord,
  AITraderRecord,
  AccountRecord,
  CandleRecord,
  CreateAITraderCommit,
  CreateAccountCommit,
  EmailVerificationChallengeRecord,
  GameRepository,
  InstrumentRecord,
  OrderRecord,
  OrderStateCommit,
  PasswordResetChallengeRecord,
  PortfolioRecord,
  PositionRecord,
  RegistrationEmailChallengeRecord,
  RegistrationEmailVerificationCommit,
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

const CANDLE_HOT_CACHE_LIMIT = 2;

export class DatabaseGameRepository implements GameRepository {
  readonly #instruments = new Map<string, InstrumentRecord>();
  readonly #quotes = new Map<string, Quote>();
  readonly #candles = new Map<string, Map<string, CandleRecord>>();
  readonly #accounts = new Map<string, AccountRecord>();
  readonly #accountIdsByUsername = new Map<string, string>();
  readonly #accountIdsByEmail = new Map<string, string>();
  readonly #sessions = new Map<string, SessionRecord>();
  readonly #passwordResetChallenges = new Map<
    string,
    PasswordResetChallengeRecord
  >();
  readonly #emailVerificationChallenges = new Map<
    string,
    EmailVerificationChallengeRecord
  >();
  readonly #registrationEmailChallenges = new Map<
    string,
    RegistrationEmailChallengeRecord
  >();
  readonly #portfolios = new Map<string, PortfolioRecord>();
  readonly #portfolioIdsByAccount = new Map<string, string>();
  readonly #positions = new Map<string, Map<string, PositionRecord>>();
  readonly #transactions = new Map<string, Transaction[]>();
  readonly #orders = new Map<string, OrderRecord>();
  readonly #aiTraders = new Map<string, AITraderRecord>();
  readonly #aiTraderIdsByPortfolio = new Map<string, string>();
  readonly #aiTraderDecisions = new Map<
    string,
    AITraderDecisionRecord[]
  >();

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

  async loadCandles(
    instrumentId: string,
    interval: CandleInterval,
    limit: number,
  ): Promise<CandleRecord[]> {
    const safeLimit = Math.max(1, Math.min(5_000, Math.trunc(limit)));
    const result = await this.connection.client.query<{
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
         FROM (
           SELECT instrument_id, interval, bucket_start, open, high, low,
                  close, volume, source, is_partial, updated_at
             FROM candles
            WHERE instrument_id = $1 AND interval = $2
            ORDER BY bucket_start DESC
            LIMIT $3
         ) recent
        ORDER BY bucket_start`,
      [instrumentId, interval, safeLimit],
    );

    return result.rows.map(toCandleRecord);
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
      trimOldestCandles(series, CANDLE_HOT_CACHE_LIMIT);
      this.#candles.set(key, series);
    }
  }

  async createAccount(
    commit: CreateAccountCommit,
    registrationVerification?: RegistrationEmailVerificationCommit,
  ): Promise<void> {
    if (
      this.#accountIdsByUsername.has(commit.account.usernameNormalized)
    ) {
      throw new Error("ACCOUNT_EXISTS");
    }
    if (
      commit.account.emailNormalized &&
      this.#accountIdsByEmail.has(commit.account.emailNormalized)
    ) {
      throw new Error("EMAIL_EXISTS");
    }

    try {
      await this.connection.db.transaction(async (transaction) => {
        if (registrationVerification) {
          const consumed = await transaction
            .update(registrationEmailChallenges)
            .set({
              consumedAt: new Date(registrationVerification.consumedAt),
            })
            .where(
              and(
                eq(
                  registrationEmailChallenges.id,
                  registrationVerification.challengeId,
                ),
                eq(
                  registrationEmailChallenges.emailNormalized,
                  registrationVerification.emailNormalized,
                ),
                isNotNull(registrationEmailChallenges.verifiedAt),
                isNull(registrationEmailChallenges.consumedAt),
                gt(
                  registrationEmailChallenges.expiresAt,
                  new Date(registrationVerification.consumedAt),
                ),
              ),
            )
            .returning({ id: registrationEmailChallenges.id });
          if (consumed.length === 0) {
            throw new Error("REGISTRATION_EMAIL_NOT_VERIFIED");
          }
        }
        await transaction.insert(accounts).values({
          id: commit.account.id,
          username: commit.account.username,
          usernameNormalized: commit.account.usernameNormalized,
          email: commit.account.email,
          emailNormalized: commit.account.emailNormalized,
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
      if (String(error).includes("email_normalized")) {
        throw new Error("EMAIL_EXISTS");
      }
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
    if (commit.account.emailNormalized) {
      this.#accountIdsByEmail.set(
        commit.account.emailNormalized,
        commit.account.id,
      );
    }
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
    if (registrationVerification) {
      const challenge = this.#registrationEmailChallenges.get(
        registrationVerification.emailNormalized,
      );
      if (challenge?.id === registrationVerification.challengeId) {
        challenge.consumedAt = registrationVerification.consumedAt;
      }
    }
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

  getAccountByEmail(emailNormalized: string): AccountRecord | undefined {
    const accountId = this.#accountIdsByEmail.get(emailNormalized);
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

  async resetPassword(
    accountId: string,
    passwordHash: string,
    challengeId?: string,
  ): Promise<void> {
    await this.connection.db.transaction(async (transaction) => {
      if (challengeId) {
        const consumed = await transaction
          .update(passwordResetChallenges)
          .set({ consumedAt: new Date() })
          .where(
            and(
              eq(passwordResetChallenges.id, challengeId),
              isNull(passwordResetChallenges.consumedAt),
            ),
          )
          .returning({ id: passwordResetChallenges.id });
        if (consumed.length === 0) {
          throw new Error("PASSWORD_RESET_CHALLENGE_CONSUMED");
        }
      }
      await transaction
        .update(accounts)
        .set({ passwordHash })
        .where(eq(accounts.id, accountId));
      await transaction
        .delete(sessions)
        .where(eq(sessions.accountId, accountId));
    });

    this.#requireAccount(accountId).passwordHash = passwordHash;
    for (const [tokenHash, session] of this.#sessions) {
      if (session.accountId === accountId) {
        this.#sessions.delete(tokenHash);
      }
    }
    if (challengeId) {
      const challenge = this.#passwordResetChallenges.get(accountId);
      if (challenge?.id === challengeId) {
        challenge.consumedAt = new Date().toISOString();
      }
    }
  }

  async bindAccountEmail(
    accountId: string,
    email: string,
    emailNormalized: string,
    challengeId: string,
  ): Promise<void> {
    try {
      await this.connection.db.transaction(async (transaction) => {
        const consumed = await transaction
          .update(emailVerificationChallenges)
          .set({ consumedAt: new Date() })
          .where(
            and(
              eq(emailVerificationChallenges.id, challengeId),
              eq(emailVerificationChallenges.accountId, accountId),
              eq(
                emailVerificationChallenges.emailNormalized,
                emailNormalized,
              ),
              isNull(emailVerificationChallenges.consumedAt),
            ),
          )
          .returning({ id: emailVerificationChallenges.id });
        if (consumed.length === 0) {
          throw new Error("EMAIL_VERIFICATION_CHALLENGE_CONSUMED");
        }

        const updated = await transaction
          .update(accounts)
          .set({ email, emailNormalized })
          .where(
            and(eq(accounts.id, accountId), isNull(accounts.emailNormalized)),
          )
          .returning({ id: accounts.id });
        if (updated.length === 0) {
          throw new Error("ACCOUNT_EMAIL_ALREADY_SET");
        }
      });
    } catch (error) {
      if (String(error).includes("email_normalized")) {
        throw new Error("EMAIL_EXISTS");
      }
      throw error;
    }

    const account = this.#requireAccount(accountId);
    account.email = email;
    account.emailNormalized = emailNormalized;
    this.#accountIdsByEmail.set(emailNormalized, accountId);
    const challenge = this.#emailVerificationChallenges.get(accountId);
    if (challenge?.id === challengeId) {
      challenge.consumedAt = new Date().toISOString();
    }
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

  async replacePasswordResetChallenge(
    challenge: PasswordResetChallengeRecord,
  ): Promise<void> {
    await this.connection.db.transaction(async (transaction) => {
      await transaction
        .update(passwordResetChallenges)
        .set({ consumedAt: new Date(challenge.createdAt) })
        .where(
          and(
            eq(passwordResetChallenges.accountId, challenge.accountId),
            isNull(passwordResetChallenges.consumedAt),
          ),
        );
      await transaction.insert(passwordResetChallenges).values({
        id: challenge.id,
        accountId: challenge.accountId,
        codeHash: challenge.codeHash,
        expiresAt: new Date(challenge.expiresAt),
        attemptsRemaining: challenge.attemptsRemaining,
        consumedAt: challenge.consumedAt
          ? new Date(challenge.consumedAt)
          : null,
        createdAt: new Date(challenge.createdAt),
      });
    });
    this.#passwordResetChallenges.set(
      challenge.accountId,
      structuredClone(challenge),
    );
  }

  getPasswordResetChallenge(
    accountId: string,
  ): PasswordResetChallengeRecord | undefined {
    const challenge = this.#passwordResetChallenges.get(accountId);
    return challenge ? structuredClone(challenge) : undefined;
  }

  async updatePasswordResetChallenge(
    challenge: PasswordResetChallengeRecord,
  ): Promise<void> {
    await this.connection.db
      .update(passwordResetChallenges)
      .set({
        attemptsRemaining: challenge.attemptsRemaining,
        consumedAt: challenge.consumedAt
          ? new Date(challenge.consumedAt)
          : null,
      })
      .where(eq(passwordResetChallenges.id, challenge.id));
    this.#passwordResetChallenges.set(
      challenge.accountId,
      structuredClone(challenge),
    );
  }

  async recordPasswordResetFailure(
    accountId: string,
    challengeId: string,
    at: string,
  ): Promise<number> {
    const result = await this.connection.client.query<{
      attempts_remaining: number;
      consumed_at: Date | string | null;
    }>(
      `UPDATE password_reset_challenges
          SET attempts_remaining = GREATEST(0, attempts_remaining - 1),
              consumed_at = CASE
                WHEN attempts_remaining <= 1 THEN $3
                ELSE consumed_at
              END
        WHERE id = $1 AND account_id = $2 AND consumed_at IS NULL
      RETURNING attempts_remaining, consumed_at`,
      [challengeId, accountId, at],
    );
    const row = result.rows[0];
    const challenge = this.#passwordResetChallenges.get(accountId);
    if (row && challenge?.id === challengeId) {
      challenge.attemptsRemaining = row.attempts_remaining;
      challenge.consumedAt = row.consumed_at
        ? new Date(row.consumed_at).toISOString()
        : null;
    }
    return row?.attempts_remaining ?? 0;
  }

  async replaceEmailVerificationChallenge(
    challenge: EmailVerificationChallengeRecord,
  ): Promise<void> {
    await this.connection.db.transaction(async (transaction) => {
      await transaction
        .update(emailVerificationChallenges)
        .set({ consumedAt: new Date(challenge.createdAt) })
        .where(
          and(
            eq(emailVerificationChallenges.accountId, challenge.accountId),
            isNull(emailVerificationChallenges.consumedAt),
          ),
        );
      await transaction.insert(emailVerificationChallenges).values({
        id: challenge.id,
        accountId: challenge.accountId,
        email: challenge.email,
        emailNormalized: challenge.emailNormalized,
        codeHash: challenge.codeHash,
        expiresAt: new Date(challenge.expiresAt),
        attemptsRemaining: challenge.attemptsRemaining,
        consumedAt: challenge.consumedAt
          ? new Date(challenge.consumedAt)
          : null,
        createdAt: new Date(challenge.createdAt),
      });
    });
    this.#emailVerificationChallenges.set(
      challenge.accountId,
      structuredClone(challenge),
    );
  }

  getEmailVerificationChallenge(
    accountId: string,
  ): EmailVerificationChallengeRecord | undefined {
    const challenge = this.#emailVerificationChallenges.get(accountId);
    return challenge ? structuredClone(challenge) : undefined;
  }

  async updateEmailVerificationChallenge(
    challenge: EmailVerificationChallengeRecord,
  ): Promise<void> {
    await this.connection.db
      .update(emailVerificationChallenges)
      .set({
        attemptsRemaining: challenge.attemptsRemaining,
        consumedAt: challenge.consumedAt
          ? new Date(challenge.consumedAt)
          : null,
      })
      .where(eq(emailVerificationChallenges.id, challenge.id));
    this.#emailVerificationChallenges.set(
      challenge.accountId,
      structuredClone(challenge),
    );
  }

  async recordEmailVerificationFailure(
    accountId: string,
    challengeId: string,
    at: string,
  ): Promise<number> {
    const result = await this.connection.client.query<{
      attempts_remaining: number;
      consumed_at: Date | string | null;
    }>(
      `UPDATE email_verification_challenges
          SET attempts_remaining = GREATEST(0, attempts_remaining - 1),
              consumed_at = CASE
                WHEN attempts_remaining <= 1 THEN $3
                ELSE consumed_at
              END
        WHERE id = $1 AND account_id = $2 AND consumed_at IS NULL
      RETURNING attempts_remaining, consumed_at`,
      [challengeId, accountId, at],
    );
    const row = result.rows[0];
    const challenge = this.#emailVerificationChallenges.get(accountId);
    if (row && challenge?.id === challengeId) {
      challenge.attemptsRemaining = row.attempts_remaining;
      challenge.consumedAt = row.consumed_at
        ? new Date(row.consumed_at).toISOString()
        : null;
    }
    return row?.attempts_remaining ?? 0;
  }

  async replaceRegistrationEmailChallenge(
    challenge: RegistrationEmailChallengeRecord,
  ): Promise<void> {
    await this.connection.db.transaction(async (transaction) => {
      await transaction
        .update(registrationEmailChallenges)
        .set({ consumedAt: new Date(challenge.createdAt) })
        .where(
          and(
            eq(
              registrationEmailChallenges.emailNormalized,
              challenge.emailNormalized,
            ),
            isNull(registrationEmailChallenges.consumedAt),
          ),
        );
      await transaction.insert(registrationEmailChallenges).values({
        id: challenge.id,
        email: challenge.email,
        emailNormalized: challenge.emailNormalized,
        codeHash: challenge.codeHash,
        expiresAt: new Date(challenge.expiresAt),
        attemptsRemaining: challenge.attemptsRemaining,
        verifiedAt: challenge.verifiedAt
          ? new Date(challenge.verifiedAt)
          : null,
        consumedAt: challenge.consumedAt
          ? new Date(challenge.consumedAt)
          : null,
        createdAt: new Date(challenge.createdAt),
      });
    });
    this.#registrationEmailChallenges.set(
      challenge.emailNormalized,
      structuredClone(challenge),
    );
  }

  getRegistrationEmailChallenge(
    emailNormalized: string,
  ): RegistrationEmailChallengeRecord | undefined {
    const challenge = this.#registrationEmailChallenges.get(emailNormalized);
    return challenge ? structuredClone(challenge) : undefined;
  }

  async updateRegistrationEmailChallenge(
    challenge: RegistrationEmailChallengeRecord,
  ): Promise<void> {
    await this.connection.db
      .update(registrationEmailChallenges)
      .set({
        attemptsRemaining: challenge.attemptsRemaining,
        verifiedAt: challenge.verifiedAt
          ? new Date(challenge.verifiedAt)
          : null,
        consumedAt: challenge.consumedAt
          ? new Date(challenge.consumedAt)
          : null,
      })
      .where(eq(registrationEmailChallenges.id, challenge.id));
    this.#registrationEmailChallenges.set(
      challenge.emailNormalized,
      structuredClone(challenge),
    );
  }

  async recordRegistrationEmailFailure(
    emailNormalized: string,
    challengeId: string,
    at: string,
  ): Promise<number> {
    const result = await this.connection.client.query<{
      attempts_remaining: number;
      consumed_at: Date | string | null;
    }>(
      `UPDATE registration_email_challenges
          SET attempts_remaining = GREATEST(0, attempts_remaining - 1),
              consumed_at = CASE
                WHEN attempts_remaining <= 1 THEN $3
                ELSE consumed_at
              END
        WHERE id = $1 AND email_normalized = $2 AND consumed_at IS NULL
      RETURNING attempts_remaining, consumed_at`,
      [challengeId, emailNormalized, at],
    );
    const row = result.rows[0];
    const challenge = this.#registrationEmailChallenges.get(emailNormalized);
    if (row && challenge?.id === challengeId) {
      challenge.attemptsRemaining = row.attempts_remaining;
      challenge.consumedAt = row.consumed_at
        ? new Date(row.consumed_at).toISOString()
        : null;
    }
    return row?.attempts_remaining ?? 0;
  }

  async verifyRegistrationEmailChallenge(
    emailNormalized: string,
    challengeId: string,
    at: string,
  ): Promise<boolean> {
    const result = await this.connection.client.query<{
      verified_at: Date | string;
    }>(
      `UPDATE registration_email_challenges
          SET verified_at = COALESCE(verified_at, $3)
        WHERE id = $1
          AND email_normalized = $2
          AND consumed_at IS NULL
          AND attempts_remaining > 0
          AND expires_at > $3
      RETURNING verified_at`,
      [challengeId, emailNormalized, at],
    );
    const row = result.rows[0];
    const challenge = this.#registrationEmailChallenges.get(emailNormalized);
    if (row && challenge?.id === challengeId) {
      challenge.verifiedAt = new Date(row.verified_at).toISOString();
    }
    return row !== undefined;
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

  listOrders(
    portfolioId: string,
    status?: OrderStatus,
  ): OrderRecord[] {
    return [...this.#orders.values()]
      .filter(
        (order) =>
          order.portfolioId === portfolioId &&
          (!status || order.status === status),
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((order) => structuredClone(order));
  }

  listOpenOrders(instrumentIds?: string[]): OrderRecord[] {
    const allowed = instrumentIds ? new Set(instrumentIds) : null;
    return [...this.#orders.values()]
      .filter(
        (order) =>
          order.status === "OPEN" &&
          (!allowed || allowed.has(order.instrumentId)),
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((order) => structuredClone(order));
  }

  getOrderById(orderId: string): OrderRecord | undefined {
    const order = this.#orders.get(orderId);
    return order ? structuredClone(order) : undefined;
  }

  getOrderByIdempotencyKey(
    portfolioId: string,
    idempotencyKey: string,
  ): OrderRecord | undefined {
    const order = [...this.#orders.values()].find(
      (candidate) =>
        candidate.portfolioId === portfolioId &&
        candidate.idempotencyKey === idempotencyKey,
    );
    return order ? structuredClone(order) : undefined;
  }

  async commitOrderState(commit: OrderStateCommit): Promise<void> {
    let committedCash:
      | { availableCashUsd: number; frozenCashUsd: number }
      | undefined;
    await this.connection.db.transaction(async (transaction) => {
      const updated = await transaction
        .update(portfolios)
        .set({
          availableCashUsd:
            commit.availableCashDeltaUsd === undefined
              ? commit.availableCashUsd
              : sql`${portfolios.availableCashUsd} + ${commit.availableCashDeltaUsd}`,
          frozenCashUsd:
            commit.frozenCashDeltaUsd === undefined
              ? commit.frozenCashUsd
              : sql`${portfolios.frozenCashUsd} + ${commit.frozenCashDeltaUsd}`,
        })
        .where(eq(portfolios.id, commit.portfolioId))
        .returning({
          availableCashUsd: portfolios.availableCashUsd,
          frozenCashUsd: portfolios.frozenCashUsd,
        });
      committedCash = updated[0];
      if (!committedCash) {
        throw new Error("PORTFOLIO_NOT_FOUND");
      }

      if (commit.position !== undefined) {
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
      }

      await transaction
        .insert(orderTable)
        .values(toOrderValues(commit.order))
        .onConflictDoUpdate({
          target: orderTable.id,
          set: toOrderUpdateValues(commit.order),
        });
    });

    const portfolio = this.#requirePortfolio(commit.portfolioId);
    portfolio.availableCashUsd = committedCash!.availableCashUsd;
    portfolio.frozenCashUsd = committedCash!.frozenCashUsd;
    if (commit.position !== undefined) {
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
    }
    this.#orders.set(commit.order.id, structuredClone(commit.order));
  }

  async commitTrade(commit: TradeCommit): Promise<void> {
    let committedCash:
      | { availableCashUsd: number; frozenCashUsd: number }
      | undefined;
    await this.connection.db.transaction(async (transaction) => {
      const portfolioUpdate: {
        availableCashUsd: number | ReturnType<typeof sql>;
        frozenCashUsd?: number | ReturnType<typeof sql>;
      } = {
        availableCashUsd:
          commit.availableCashDeltaUsd === undefined
            ? commit.availableCashUsd
            : sql`${portfolios.availableCashUsd} + ${commit.availableCashDeltaUsd}`,
      };
      if (commit.frozenCashDeltaUsd !== undefined) {
        portfolioUpdate.frozenCashUsd =
          sql`${portfolios.frozenCashUsd} + ${commit.frozenCashDeltaUsd}`;
      } else if (commit.frozenCashUsd !== undefined) {
        portfolioUpdate.frozenCashUsd = commit.frozenCashUsd;
      }
      const updated = await transaction
        .update(portfolios)
        .set(portfolioUpdate)
        .where(eq(portfolios.id, commit.portfolioId))
        .returning({
          availableCashUsd: portfolios.availableCashUsd,
          frozenCashUsd: portfolios.frozenCashUsd,
        });
      committedCash = updated[0];
      if (!committedCash) {
        throw new Error("PORTFOLIO_NOT_FOUND");
      }

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

      if (commit.order) {
        await transaction
          .insert(orderTable)
          .values(toOrderValues(commit.order))
          .onConflictDoUpdate({
            target: orderTable.id,
            set: toOrderUpdateValues(commit.order),
          });
      }
    });

    const portfolio = this.#requirePortfolio(commit.portfolioId);
    portfolio.availableCashUsd = committedCash!.availableCashUsd;
    portfolio.frozenCashUsd = committedCash!.frozenCashUsd;
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
    if (commit.order) {
      this.#orders.set(commit.order.id, structuredClone(commit.order));
    }
  }

  async settleDuePositions(at: string): Promise<SettlementResult[]> {
    const settledAt = new Date(at);
    const grouped = new Map<string, SettlementResult>();
    await this.connection.client.transaction(async (transaction) => {
      const claimed = await transaction.query<{
        portfolio_id: string;
        instrument_id: string;
        quantity: number;
      }>(
        `UPDATE position_settlement_lots
            SET settled_at = $1
          WHERE settled_at IS NULL AND unlock_at <= $1
        RETURNING portfolio_id, instrument_id, quantity`,
        [settledAt],
      );
      for (const lot of claimed.rows) {
        const key = `${lot.portfolio_id}:${lot.instrument_id}`;
        const current = grouped.get(key);
        grouped.set(key, {
          portfolioId: lot.portfolio_id,
          instrumentId: lot.instrument_id,
          quantity: (current?.quantity ?? 0) + lot.quantity,
        });
      }

      for (const settlement of grouped.values()) {
        await transaction.query(
          `UPDATE positions
              SET available_quantity = LEAST(
                    quantity - frozen_quantity,
                    available_quantity + $3
                  ),
                  updated_at = $4
            WHERE portfolio_id = $1 AND instrument_id = $2`,
          [
            settlement.portfolioId,
            settlement.instrumentId,
            settlement.quantity,
            settledAt,
          ],
        );
      }
    });

    if (grouped.size === 0) {
      return [];
    }

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
            traderKind: trader.traderKind ?? "RULE",
            personaKey: trader.personaKey ?? null,
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
              traderKind: trader.traderKind ?? "RULE",
              personaKey: trader.personaKey ?? null,
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
              traderKind: sql`excluded.trader_kind`,
              personaKey: sql`excluded.persona_key`,
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

  listAITraderDecisions(
    traderId: string,
    limit: number,
  ): AITraderDecisionRecord[] {
    return (this.#aiTraderDecisions.get(traderId) ?? [])
      .slice(0, Math.max(0, limit))
      .map((decision) => structuredClone(decision));
  }

  async appendAITraderDecision(
    decision: AITraderDecisionRecord,
  ): Promise<void> {
    await this.connection.db.insert(aiTraderDecisions).values({
      id: decision.id,
      traderId: decision.traderId,
      decidedAt: new Date(decision.decidedAt),
      action: decision.action,
      instrumentId: decision.instrumentId,
      result: decision.result,
      reason: decision.reason,
      modelId: decision.modelId,
      detail: decision.detail,
    });
    const decisions = this.#aiTraderDecisions.get(decision.traderId) ?? [];
    decisions.unshift(structuredClone(decision));
    if (decisions.length > 100) {
      decisions.length = 100;
    }
    this.#aiTraderDecisions.set(decision.traderId, decisions);
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
         FROM candles stored_candle
        WHERE bucket_start = (
          SELECT max(candidate.bucket_start)
            FROM candles candidate
           WHERE candidate.instrument_id = stored_candle.instrument_id
             AND candidate.interval = stored_candle.interval
        )
        ORDER BY instrument_id, interval`,
    );

    for (const row of candleResult.rows) {
      const candle = toCandleRecord(row);
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
      email: string | null;
      email_normalized: string | null;
      password_hash: string;
      display_name: string;
      display_currency: DisplayCurrency;
      created_at: Date | string;
      last_login_at: Date | string | null;
    }>(
      `SELECT id, username, username_normalized, email, email_normalized,
              password_hash, display_name, display_currency, created_at,
              last_login_at
         FROM accounts`,
    );

    for (const row of accountResult.rows) {
      const account: AccountRecord = {
        id: row.id,
        username: row.username,
        usernameNormalized: row.username_normalized,
        email: row.email,
        emailNormalized: row.email_normalized,
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
      if (account.emailNormalized) {
        this.#accountIdsByEmail.set(account.emailNormalized, account.id);
      }
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
      trader_kind: "RULE" | "LLM";
      persona_key: string | null;
      is_active: boolean;
      last_action_at: Date | string | null;
      next_action_at: Date | string;
      total_trades: number;
      win_count: number;
      loss_count: number;
      created_at: Date | string;
    }>(
      `SELECT id, portfolio_id, name, strategy, psychology,
              risk_level, activity_level, preferred_market,
              trader_kind, persona_key, is_active,
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
        traderKind: row.trader_kind,
        personaKey: row.persona_key,
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

    const decisionResult = await this.connection.client.query<{
      id: string;
      trader_id: string;
      decided_at: Date | string;
      action: string;
      instrument_id: string | null;
      result: string;
      reason: string | null;
      model_id: string;
      detail: string | null;
    }>(
      `SELECT id, trader_id, decided_at, action, instrument_id,
              result, reason, model_id, detail
         FROM (
           SELECT id, trader_id, decided_at, action, instrument_id,
                  result, reason, model_id, detail,
                  row_number() OVER (
                    PARTITION BY trader_id ORDER BY decided_at DESC
                  ) AS decision_rank
             FROM ai_trader_decisions
            WHERE decided_at >= now() - interval '30 days'
         ) recent_decisions
        WHERE decision_rank <= 100
        ORDER BY decided_at DESC`,
    );
    for (const row of decisionResult.rows) {
      const decisions = this.#aiTraderDecisions.get(row.trader_id) ?? [];
      if (decisions.length >= 100) {
        continue;
      }
      decisions.push({
        id: row.id,
        traderId: row.trader_id,
        decidedAt: new Date(row.decided_at).toISOString(),
        action: row.action,
        instrumentId: row.instrument_id,
        result: row.result,
        reason: row.reason,
        modelId: row.model_id,
        detail: row.detail,
      });
      this.#aiTraderDecisions.set(row.trader_id, decisions);
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
      `SELECT id, portfolio_id, instrument_id, symbol, name, market, side,
              quantity, quote_price, quote_currency, fx_rate_to_usd,
              price_usd, gross_amount_usd, fee_usd, net_amount_usd,
              realized_profit_usd, actor_type, actor_id, idempotency_key,
              created_at
         FROM (
           SELECT t.id, t.portfolio_id, t.instrument_id, i.symbol, i.name,
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
                  t.actor_type, t.actor_id, t.idempotency_key, t.created_at,
                  pf.account_id, ait.trader_kind,
                  row_number() OVER (
                    PARTITION BY t.portfolio_id ORDER BY t.created_at DESC
                  ) AS transaction_rank
             FROM transactions t
             JOIN instruments i ON i.id = t.instrument_id
             JOIN portfolios pf ON pf.id = t.portfolio_id
             LEFT JOIN ai_traders ait ON ait.portfolio_id = pf.id
            WHERE pf.account_id IS NOT NULL OR ait.trader_kind = 'LLM'
         ) visible_transactions
        WHERE account_id IS NOT NULL
           OR (trader_kind = 'LLM' AND transaction_rank <= 500)
        ORDER BY created_at DESC`,
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

    const challengeResult = await this.connection.client.query<{
      id: string;
      account_id: string;
      code_hash: string;
      expires_at: Date | string;
      attempts_remaining: number;
      consumed_at: Date | string | null;
      created_at: Date | string;
    }>(
      `SELECT id, account_id, code_hash, expires_at, attempts_remaining,
              consumed_at, created_at
         FROM password_reset_challenges
        WHERE consumed_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC`,
    );
    for (const row of challengeResult.rows) {
      if (this.#passwordResetChallenges.has(row.account_id)) {
        continue;
      }
      this.#passwordResetChallenges.set(row.account_id, {
        id: row.id,
        accountId: row.account_id,
        codeHash: row.code_hash,
        expiresAt: new Date(row.expires_at).toISOString(),
        attemptsRemaining: row.attempts_remaining,
        consumedAt: row.consumed_at
          ? new Date(row.consumed_at).toISOString()
          : null,
        createdAt: new Date(row.created_at).toISOString(),
      });
    }

    const emailChallengeResult = await this.connection.client.query<{
      id: string;
      account_id: string;
      email: string;
      email_normalized: string;
      code_hash: string;
      expires_at: Date | string;
      attempts_remaining: number;
      consumed_at: Date | string | null;
      created_at: Date | string;
    }>(
      `SELECT id, account_id, email, email_normalized, code_hash,
              expires_at, attempts_remaining, consumed_at, created_at
         FROM email_verification_challenges
        WHERE consumed_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC`,
    );
    for (const row of emailChallengeResult.rows) {
      if (this.#emailVerificationChallenges.has(row.account_id)) {
        continue;
      }
      this.#emailVerificationChallenges.set(row.account_id, {
        id: row.id,
        accountId: row.account_id,
        email: row.email,
        emailNormalized: row.email_normalized,
        codeHash: row.code_hash,
        expiresAt: new Date(row.expires_at).toISOString(),
        attemptsRemaining: row.attempts_remaining,
        consumedAt: row.consumed_at
          ? new Date(row.consumed_at).toISOString()
          : null,
        createdAt: new Date(row.created_at).toISOString(),
      });
    }

    const registrationChallengeResult =
      await this.connection.client.query<{
        id: string;
        email: string;
        email_normalized: string;
        code_hash: string;
        expires_at: Date | string;
        attempts_remaining: number;
        verified_at: Date | string | null;
        consumed_at: Date | string | null;
        created_at: Date | string;
      }>(
        `SELECT id, email, email_normalized, code_hash, expires_at,
                attempts_remaining, verified_at, consumed_at, created_at
           FROM registration_email_challenges
          WHERE consumed_at IS NULL AND expires_at > now()
          ORDER BY created_at DESC`,
      );
    for (const row of registrationChallengeResult.rows) {
      if (this.#registrationEmailChallenges.has(row.email_normalized)) {
        continue;
      }
      this.#registrationEmailChallenges.set(row.email_normalized, {
        id: row.id,
        email: row.email,
        emailNormalized: row.email_normalized,
        codeHash: row.code_hash,
        expiresAt: new Date(row.expires_at).toISOString(),
        attemptsRemaining: row.attempts_remaining,
        verifiedAt: row.verified_at
          ? new Date(row.verified_at).toISOString()
          : null,
        consumedAt: row.consumed_at
          ? new Date(row.consumed_at).toISOString()
          : null,
        createdAt: new Date(row.created_at).toISOString(),
      });
    }

    const orderResult = await this.connection.client.query<{
      id: string;
      portfolio_id: string;
      instrument_id: string;
      symbol: string;
      name: string;
      market: StockMarket;
      side: "BUY" | "SELL";
      order_mode: "MARKET" | "LIMIT";
      status: OrderStatus;
      quantity: number;
      filled_quantity: number;
      limit_price: number | null;
      quote_currency: QuoteCurrency;
      reserved_cash_usd: number;
      reserved_quantity: number;
      actor_type: TradeActorType;
      actor_id: string;
      idempotency_key: string | null;
      created_at: Date | string;
      updated_at: Date | string;
      filled_at: Date | string | null;
      cancelled_at: Date | string | null;
      transaction_id: string | null;
    }>(
      `SELECT o.id, o.portfolio_id, o.instrument_id,
              i.symbol, i.name, i.market, o.side, o.order_mode,
              o.status, o.quantity, o.filled_quantity,
              o.limit_price::float8, o.quote_currency,
              o.reserved_cash_usd::float8, o.reserved_quantity,
              o.actor_type, o.actor_id, o.idempotency_key,
              o.created_at, o.updated_at, o.filled_at,
              o.cancelled_at, o.transaction_id
         FROM orders o
         JOIN instruments i ON i.id = o.instrument_id
         JOIN portfolios pf ON pf.id = o.portfolio_id
        WHERE pf.account_id IS NOT NULL
           OR o.status = 'OPEN'
           OR o.created_at >= now() - interval '30 days'
        ORDER BY o.created_at DESC`,
    );

    for (const row of orderResult.rows) {
      this.#orders.set(row.id, {
        id: row.id,
        mode: "VIRTUAL",
        portfolioId: row.portfolio_id,
        instrumentId: row.instrument_id,
        symbol: row.symbol,
        name: row.name,
        market: row.market,
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
        actorId: row.actor_id,
        idempotencyKey: row.idempotency_key ?? undefined,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
        filledAt: row.filled_at
          ? new Date(row.filled_at).toISOString()
          : null,
        cancelledAt: row.cancelled_at
          ? new Date(row.cancelled_at).toISOString()
          : null,
        transactionId: row.transaction_id,
      });
    }
  }

  async ensureAIPortfolioCashFloor(
    portfolioId: string,
    thresholdUsd: number,
    topUpUsd: number,
  ): Promise<boolean> {
    const result = await this.connection.client.query<{
      initial_cash_usd: number;
      available_cash_usd: number;
    }>(
      `UPDATE portfolios
          SET initial_cash_usd = initial_cash_usd + $3,
              available_cash_usd = available_cash_usd + $3
        WHERE id = $1
          AND available_cash_usd + frozen_cash_usd < $2
      RETURNING initial_cash_usd::float8, available_cash_usd::float8`,
      [portfolioId, thresholdUsd, topUpUsd],
    );
    const row = result.rows[0];
    if (!row) {
      if (!this.#portfolios.has(portfolioId)) {
        throw new Error("PORTFOLIO_NOT_FOUND");
      }
      return false;
    }
    const portfolio = this.#requirePortfolio(portfolioId);
    portfolio.initialCashUsd = row.initial_cash_usd;
    portfolio.availableCashUsd = row.available_cash_usd;
    return true;
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

function toOrderValues(order: OrderRecord) {
  return {
    id: order.id,
    portfolioId: order.portfolioId,
    instrumentId: order.instrumentId,
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
    actorId: order.actorId,
    idempotencyKey: order.idempotencyKey,
    createdAt: new Date(order.createdAt),
    updatedAt: new Date(order.updatedAt),
    filledAt: order.filledAt ? new Date(order.filledAt) : null,
    cancelledAt: order.cancelledAt
      ? new Date(order.cancelledAt)
      : null,
    transactionId: order.transactionId,
  };
}

function toOrderUpdateValues(order: OrderRecord) {
  const values = toOrderValues(order);
  return {
    status: values.status,
    filledQuantity: values.filledQuantity,
    reservedCashUsd: values.reservedCashUsd,
    reservedQuantity: values.reservedQuantity,
    updatedAt: values.updatedAt,
    filledAt: values.filledAt,
    cancelledAt: values.cancelledAt,
    transactionId: values.transactionId,
  };
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

function toCandleRecord(row: {
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
}): CandleRecord {
  return {
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
}

function trimOldestCandles(
  series: Map<string, CandleRecord>,
  limit: number,
): void {
  if (series.size <= limit) {
    return;
  }
  const oldest = [...series.keys()]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, series.size - limit);
  for (const time of oldest) {
    series.delete(time);
  }
}
