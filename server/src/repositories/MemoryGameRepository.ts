import type {
  CandleInterval,
  DisplayCurrency,
  OrderStatus,
  Quote,
  Transaction,
} from "@gupiaomoniqi/shared";
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
  SettlementLotRecord,
  SettlementResult,
  TradeCommit,
} from "./GameRepository.js";

export class MemoryGameRepository implements GameRepository {
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
  readonly #settlementLots = new Map<string, SettlementLotRecord>();
  readonly #cashAdjustmentClaims = new Set<string>();
  readonly #aiTraders = new Map<string, AITraderRecord>();
  readonly #aiTraderIdsByPortfolio = new Map<string, string>();
  readonly #aiTraderDecisions = new Map<
    string,
    AITraderDecisionRecord[]
  >();

  constructor(instruments: InstrumentRecord[]) {
    for (const instrument of instruments) {
      this.#instruments.set(instrument.id, structuredClone(instrument));
    }
  }

  listInstruments(): InstrumentRecord[] {
    return [...this.#instruments.values()].map((item) =>
      structuredClone(item),
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

  async saveQuotes(quotes: Quote[]): Promise<void> {
    for (const quote of quotes) {
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

  async upsertCandles(candles: CandleRecord[]): Promise<void> {
    for (const candle of candles) {
      const key = candleSeriesKey(candle.instrumentId, candle.interval);
      const series =
        this.#candles.get(key) ?? new Map<string, CandleRecord>();
      series.set(candle.time, structuredClone(candle));
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
    const registrationChallenge = registrationVerification
      ? this.#registrationEmailChallenges.get(
          registrationVerification.emailNormalized,
        )
      : undefined;
    if (
      registrationVerification &&
      (!registrationChallenge ||
        registrationChallenge.id !== registrationVerification.challengeId ||
        registrationChallenge.emailNormalized !==
          commit.account.emailNormalized ||
        !registrationChallenge.verifiedAt ||
        registrationChallenge.consumedAt ||
        new Date(registrationChallenge.expiresAt).getTime() <=
          new Date(registrationVerification.consumedAt).getTime())
    ) {
      throw new Error("REGISTRATION_EMAIL_NOT_VERIFIED");
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
    if (registrationChallenge && registrationVerification) {
      registrationChallenge.consumedAt = registrationVerification.consumedAt;
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
    const account = this.#requireAccount(accountId);
    account.lastLoginAt = at;
  }

  async resetPassword(
    accountId: string,
    passwordHash: string,
    challengeId?: string,
  ): Promise<void> {
    if (challengeId) {
      const challenge = this.#passwordResetChallenges.get(accountId);
      if (
        !challenge ||
        challenge.id !== challengeId ||
        challenge.consumedAt
      ) {
        throw new Error("PASSWORD_RESET_CHALLENGE_CONSUMED");
      }
    }
    const account = this.#requireAccount(accountId);
    account.passwordHash = passwordHash;
    for (const [tokenHash, session] of this.#sessions) {
      if (session.accountId === accountId) {
        this.#sessions.delete(tokenHash);
      }
    }
    if (challengeId) {
      const challenge = this.#passwordResetChallenges.get(accountId);
      challenge!.consumedAt = new Date().toISOString();
    }
  }

  async bindAccountEmail(
    accountId: string,
    email: string,
    emailNormalized: string,
    challengeId: string,
  ): Promise<void> {
    const account = this.#requireAccount(accountId);
    const challenge = this.#emailVerificationChallenges.get(accountId);
    if (account.emailNormalized) {
      throw new Error("ACCOUNT_EMAIL_ALREADY_SET");
    }
    if (
      !challenge ||
      challenge.id !== challengeId ||
      challenge.emailNormalized !== emailNormalized ||
      challenge.consumedAt
    ) {
      throw new Error("EMAIL_VERIFICATION_CHALLENGE_CONSUMED");
    }
    const existingAccountId = this.#accountIdsByEmail.get(emailNormalized);
    if (existingAccountId && existingAccountId !== accountId) {
      throw new Error("EMAIL_EXISTS");
    }

    account.email = email;
    account.emailNormalized = emailNormalized;
    this.#accountIdsByEmail.set(emailNormalized, accountId);
    challenge.consumedAt = new Date().toISOString();
  }

  async updateDisplayCurrency(
    accountId: string,
    currency: DisplayCurrency,
  ): Promise<void> {
    const account = this.#requireAccount(accountId);
    account.displayCurrency = currency;
  }

  async createSession(session: SessionRecord): Promise<void> {
    this.#sessions.set(session.tokenHash, structuredClone(session));
  }

  getSession(tokenHash: string): SessionRecord | undefined {
    const session = this.#sessions.get(tokenHash);

    if (!session) {
      return undefined;
    }

    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      this.#sessions.delete(tokenHash);
      return undefined;
    }

    return structuredClone(session);
  }

  async deleteSession(tokenHash: string): Promise<void> {
    this.#sessions.delete(tokenHash);
  }

  async replacePasswordResetChallenge(
    challenge: PasswordResetChallengeRecord,
  ): Promise<void> {
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
    const challenge = this.#passwordResetChallenges.get(accountId);
    if (!challenge || challenge.id !== challengeId || challenge.consumedAt) {
      return 0;
    }
    challenge.attemptsRemaining = Math.max(
      0,
      challenge.attemptsRemaining - 1,
    );
    if (challenge.attemptsRemaining === 0) {
      challenge.consumedAt = at;
    }
    return challenge.attemptsRemaining;
  }

  async replaceEmailVerificationChallenge(
    challenge: EmailVerificationChallengeRecord,
  ): Promise<void> {
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
    const challenge = this.#emailVerificationChallenges.get(accountId);
    if (!challenge || challenge.id !== challengeId || challenge.consumedAt) {
      return 0;
    }
    challenge.attemptsRemaining = Math.max(
      0,
      challenge.attemptsRemaining - 1,
    );
    if (challenge.attemptsRemaining === 0) {
      challenge.consumedAt = at;
    }
    return challenge.attemptsRemaining;
  }

  async replaceRegistrationEmailChallenge(
    challenge: RegistrationEmailChallengeRecord,
  ): Promise<void> {
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
    const challenge = this.#registrationEmailChallenges.get(emailNormalized);
    if (!challenge || challenge.id !== challengeId || challenge.consumedAt) {
      return 0;
    }
    challenge.attemptsRemaining = Math.max(
      0,
      challenge.attemptsRemaining - 1,
    );
    if (challenge.attemptsRemaining === 0) {
      challenge.consumedAt = at;
    }
    return challenge.attemptsRemaining;
  }

  async verifyRegistrationEmailChallenge(
    emailNormalized: string,
    challengeId: string,
    at: string,
  ): Promise<boolean> {
    const challenge = this.#registrationEmailChallenges.get(emailNormalized);
    if (
      !challenge ||
      challenge.id !== challengeId ||
      challenge.consumedAt ||
      challenge.attemptsRemaining <= 0 ||
      new Date(challenge.expiresAt).getTime() <= new Date(at).getTime()
    ) {
      return false;
    }
    challenge.verifiedAt = challenge.verifiedAt ?? at;
    return true;
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
    const portfolio = this.#portfolios.get(commit.portfolioId);
    if (!portfolio) {
      throw new Error("PORTFOLIO_NOT_FOUND");
    }
    portfolio.availableCashUsd = commit.availableCashUsd;
    portfolio.frozenCashUsd = commit.frozenCashUsd;
    if (commit.position !== undefined) {
      const positions =
        this.#positions.get(commit.portfolioId) ??
        new Map<string, PositionRecord>();
      this.#positions.set(commit.portfolioId, positions);
      if (commit.position) {
        positions.set(
          commit.position.instrumentId,
          structuredClone(commit.position),
        );
      } else {
        positions.delete(commit.instrumentId);
      }
    }
    this.#orders.set(commit.order.id, structuredClone(commit.order));
  }

  async commitTrade(commit: TradeCommit): Promise<void> {
    const portfolio = this.#portfolios.get(commit.portfolioId);

    if (!portfolio) {
      throw new Error("PORTFOLIO_NOT_FOUND");
    }

    portfolio.availableCashUsd = commit.availableCashUsd;
    if (commit.frozenCashUsd !== undefined) {
      portfolio.frozenCashUsd = commit.frozenCashUsd;
    }
    const positions =
      this.#positions.get(commit.portfolioId) ??
      new Map<string, PositionRecord>();
    this.#positions.set(commit.portfolioId, positions);

    if (commit.position) {
      positions.set(
        commit.position.instrumentId,
        structuredClone(commit.position),
      );
    } else {
      positions.delete(commit.instrumentId);
    }

    if (commit.transaction) {
      const transactions =
        this.#transactions.get(commit.portfolioId) ?? [];
      transactions.unshift(structuredClone(commit.transaction));
      this.#transactions.set(commit.portfolioId, transactions);
    }

    if (commit.settlementLot) {
      this.#settlementLots.set(
        commit.settlementLot.id,
        structuredClone(commit.settlementLot),
      );
    }

    if (commit.order) {
      this.#orders.set(commit.order.id, structuredClone(commit.order));
    }
  }

  async settleDuePositions(at: string): Promise<SettlementResult[]> {
    const cutoff = new Date(at).getTime();
    const grouped = new Map<string, SettlementResult>();

    for (const lot of this.#settlementLots.values()) {
      if (
        lot.settledAt ||
        new Date(lot.unlockAt).getTime() > cutoff
      ) {
        continue;
      }

      const key = `${lot.portfolioId}:${lot.instrumentId}`;
      const current = grouped.get(key);

      grouped.set(key, {
        portfolioId: lot.portfolioId,
        instrumentId: lot.instrumentId,
        quantity: (current?.quantity ?? 0) + lot.quantity,
      });
      lot.settledAt = at;
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
    _reason: string,
  ): Promise<void> {
    if (this.#cashAdjustmentClaims.has(claimId)) {
      return;
    }
    const portfolioId = this.#portfolioIdsByAccount.get(accountId);
    const portfolio = portfolioId
      ? this.#portfolios.get(portfolioId)
      : undefined;
    if (!portfolio) {
      throw new Error("PORTFOLIO_NOT_FOUND");
    }
    portfolio.initialCashUsd += amountUsd;
    portfolio.availableCashUsd += amountUsd;
    this.#cashAdjustmentClaims.add(claimId);
  }

  async ensureAIPortfolioCashFloor(
    portfolioId: string,
    thresholdUsd: number,
    topUpUsd: number,
  ): Promise<boolean> {
    const portfolio = this.#portfolios.get(portfolioId);
    if (!portfolio) {
      throw new Error("PORTFOLIO_NOT_FOUND");
    }
    if (
      portfolio.availableCashUsd + portfolio.frozenCashUsd >=
      thresholdUsd
    ) {
      return false;
    }
    portfolio.initialCashUsd = roundCash(
      portfolio.initialCashUsd + topUpUsd,
    );
    portfolio.availableCashUsd = roundCash(
      portfolio.availableCashUsd + topUpUsd,
    );
    return true;
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
    for (const commit of commits) {
      if (this.#aiTraders.has(commit.trader.id)) {
        continue;
      }

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
    for (const trader of traders) {
    if (!this.#aiTraders.has(trader.id)) {
      throw new Error("AI_TRADER_NOT_FOUND");
    }

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
    const decisions = this.#aiTraderDecisions.get(decision.traderId) ?? [];
    decisions.unshift(structuredClone(decision));
    if (decisions.length > 100) {
      decisions.length = 100;
    }
    this.#aiTraderDecisions.set(decision.traderId, decisions);
  }

  #requireAccount(accountId: string): AccountRecord {
    const account = this.#accounts.get(accountId);

    if (!account) {
      throw new Error("ACCOUNT_NOT_FOUND");
    }

    return account;
  }
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

function roundCash(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
