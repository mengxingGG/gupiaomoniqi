import type {
  AITraderStrategy,
  Candle,
  CandleInterval,
  DisplayCurrency,
  Instrument,
  Quote,
  StockMarket,
  Transaction,
} from "@gupiaomoniqi/shared";

export interface InstrumentRecord extends Instrument {
  initialPrice: number;
  volatility: number;
  liquidity: number;
}

export interface CandleRecord extends Candle {
  instrumentId: string;
  interval: CandleInterval;
  updatedAt: string;
}

export interface AccountRecord {
  id: string;
  username: string;
  usernameNormalized: string;
  passwordHash: string;
  displayName: string;
  displayCurrency: DisplayCurrency;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface PortfolioRecord {
  id: string;
  accountId: string | null;
  mode: "VIRTUAL";
  initialCashUsd: number;
  availableCashUsd: number;
  frozenCashUsd: number;
}

export interface PositionRecord {
  id: string;
  instrumentId: string;
  quantity: number;
  availableQuantity: number;
  frozenQuantity: number;
  averageCostUsd: number;
}

export interface CreateAccountCommit {
  account: AccountRecord;
  portfolio: PortfolioRecord;
}

export interface SessionRecord {
  tokenHash: string;
  accountId: string;
  expiresAt: string;
}

export interface TradeCommit {
  portfolioId: string;
  instrumentId: string;
  occurredAt: string;
  availableCashUsd: number;
  position: PositionRecord | null;
  transaction?: Transaction;
  settlementLot?: SettlementLotRecord;
}

export interface SettlementLotRecord {
  id: string;
  portfolioId: string;
  instrumentId: string;
  quantity: number;
  unlockAt: string;
  settledAt: string | null;
  sourceTransactionId: string | null;
}

export interface SettlementResult {
  portfolioId: string;
  instrumentId: string;
  quantity: number;
}

export interface AITraderRecord {
  id: string;
  portfolioId: string;
  name: string;
  strategy: AITraderStrategy;
  psychology: string;
  riskLevel: number;
  activityLevel: number;
  preferredMarket: StockMarket;
  isActive: boolean;
  lastActionAt: string | null;
  nextActionAt: string;
  totalTrades: number;
  winCount: number;
  lossCount: number;
  createdAt: string;
}

export interface CreateAITraderCommit {
  trader: AITraderRecord;
  portfolio: PortfolioRecord;
}

export interface GameRepository {
  listInstruments(): InstrumentRecord[];
  getInstrumentById(instrumentId: string): InstrumentRecord | undefined;
  listQuotes(): Quote[];
  getQuote(instrumentId: string): Quote | undefined;
  saveQuotes(quotes: Quote[]): Promise<void>;
  listCandles(
    instrumentId: string,
    interval: CandleInterval,
  ): CandleRecord[];
  getLatestCandle?(
    instrumentId: string,
    interval: CandleInterval,
  ): CandleRecord | undefined;
  upsertCandles(candles: CandleRecord[]): Promise<void>;

  createAccount(commit: CreateAccountCommit): Promise<void>;
  getAccountById(accountId: string): AccountRecord | undefined;
  getAccountByUsername(usernameNormalized: string): AccountRecord | undefined;
  updateLastLogin(accountId: string, at: string): Promise<void>;
  updateDisplayCurrency(
    accountId: string,
    currency: DisplayCurrency,
  ): Promise<void>;

  createSession(session: SessionRecord): Promise<void>;
  getSession(tokenHash: string): SessionRecord | undefined;
  deleteSession(tokenHash: string): Promise<void>;

  getPortfolioByAccountId(accountId: string): PortfolioRecord | undefined;
  getPortfolioById(portfolioId: string): PortfolioRecord | undefined;
  listPositions(portfolioId: string): PositionRecord[];
  getPosition(
    portfolioId: string,
    instrumentId: string,
  ): PositionRecord | undefined;
  listTransactions(portfolioId: string): Transaction[];
  getTransactionByIdempotencyKey(
    portfolioId: string,
    idempotencyKey: string,
  ): Transaction | undefined;
  commitTrade(commit: TradeCommit): Promise<void>;
  settleDuePositions(at: string): Promise<SettlementResult[]>;
  creditCashAdjustment(
    accountId: string,
    claimId: string,
    amountUsd: number,
    reason: string,
  ): Promise<void>;

  listAITraders(): AITraderRecord[];
  getAITrader(traderId: string): AITraderRecord | undefined;
  getAITraderByPortfolioId(
    portfolioId: string,
  ): AITraderRecord | undefined;
  createAITraders(commits: CreateAITraderCommit[]): Promise<void>;
  updateAITrader(trader: AITraderRecord): Promise<void>;
  updateAITraders(traders: AITraderRecord[]): Promise<void>;
}
