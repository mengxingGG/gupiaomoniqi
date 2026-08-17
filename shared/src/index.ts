export type MarketMode = "VIRTUAL" | "REAL";
export type StockMarket = "CN" | "HK" | "US" | "UK";
export type InstrumentType = "STOCK_VIRTUAL" | "STOCK_REAL";
export type SourceCurrency = "CNY" | "HKD" | "USD" | "GBP";
export type DisplayCurrency = "CNY" | "USD";
export type QuoteCurrency = "CNY" | "USD";
export type TradeSide = "BUY" | "SELL";
export type OrderMode = "MARKET" | "LIMIT";
export type OrderStatus = "OPEN" | "FILLED" | "CANCELLED";
export type ChartRange = "INTRADAY" | "DAY" | "MONTH" | "YEAR";
export type CandleInterval = "MINUTE" | "DAY" | "MONTH" | "YEAR";
export type CandleSource =
  | "DATABASE_SNAPSHOT"
  | "TRANSACTION_BACKFILL"
  | "MARKET_TICK"
  | "REAL_PROVIDER_HISTORY"
  | "REAL_PROVIDER_SNAPSHOT";
export type SettlementCycle = "T0" | "T1";
export type TradeActorType = "USER" | "AI";
export type AITraderStrategy =
  | "BALANCED"
  | "MOMENTUM"
  | "CONTRARIAN"
  | "VALUE"
  | "TECHNICAL"
  | "CONSERVATIVE"
  | "AGGRESSIVE";

export const USD_CNY_DISPLAY_RATE = 7;
export const VIRTUAL_TRADE_FEE_RATE = 0.0003;
export const MINIMUM_TRADE_FEE_USD = 1;
export const UNKNOWN_INDUSTRY = "未分类";

export function quotePriceToUsd(
  price: number,
  currency: QuoteCurrency,
): number {
  return currency === "CNY" ? price / USD_CNY_DISPLAY_RATE : price;
}

export function usdToDisplay(
  amountUsd: number,
  currency: DisplayCurrency,
): number {
  return currency === "CNY"
    ? amountUsd * USD_CNY_DISPLAY_RATE
    : amountUsd;
}

export function maximumAffordableLots(
  budgetUsd: number,
  grossPerLotUsd: number,
): number {
  if (
    !Number.isFinite(budgetUsd) ||
    !Number.isFinite(grossPerLotUsd) ||
    budgetUsd <= 0 ||
    grossPerLotUsd <= 0
  ) {
    return 0;
  }

  let lots = Math.floor(
    budgetUsd /
      (grossPerLotUsd * (1 + VIRTUAL_TRADE_FEE_RATE)),
  );

  while (lots > 0) {
    const gross = grossPerLotUsd * lots;
    const fee = Math.max(
      MINIMUM_TRADE_FEE_USD,
      gross * VIRTUAL_TRADE_FEE_RATE,
    );

    if (gross + fee <= budgetUsd) {
      return lots;
    }

    lots -= 1;
  }

  return 0;
}

export interface Instrument {
  id: string;
  symbol: string;
  name: string;
  market: StockMarket;
  sourceCurrency: SourceCurrency;
  quoteCurrency: QuoteCurrency;
  type: InstrumentType;
  industry: string;
  isTradable: boolean;
  lotSize: number;
  settlementCycle: SettlementCycle;
}

export interface Quote {
  instrumentId: string;
  symbol: string;
  market: StockMarket;
  quoteCurrency: QuoteCurrency;
  currentPrice: number;
  previousClose: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
  changeAmount: number;
  changePercent: number;
  updatedAt: string;
  receivedAt?: string;
}

export interface Position {
  instrumentId: string;
  symbol: string;
  name: string;
  market: StockMarket;
  quoteCurrency: QuoteCurrency;
  quantity: number;
  availableQuantity: number;
  frozenQuantity: number;
  pendingSettlementQuantity: number;
  averageCostUsd: number;
  currentPriceUsd: number;
  marketValueUsd: number;
  profitLossUsd: number;
  profitLossPercent: number;
}

export interface PortfolioSnapshot {
  mode: MarketMode;
  displayCurrency: DisplayCurrency;
  usdCnyRate: number;
  initialCashUsd: number;
  availableCashUsd: number;
  frozenCashUsd: number;
  positionsValueUsd: number;
  totalAssetsUsd: number;
  realizedProfitUsd: number;
  unrealizedProfitUsd: number;
  totalProfitLossUsd: number;
  positions: Position[];
}

export interface Transaction {
  id: string;
  instrumentId: string;
  symbol: string;
  name: string;
  market: StockMarket;
  side: TradeSide;
  quantity: number;
  quotePrice: number;
  quoteCurrency: QuoteCurrency;
  fxRateToUsd: number;
  priceUsd: number;
  grossAmountUsd: number;
  feeUsd: number;
  netAmountUsd: number;
  realizedProfitUsd: number | null;
  createdAt: string;
  actorType: TradeActorType;
  actorId?: string;
  idempotencyKey?: string;
}

export interface TradeRequest {
  instrumentId: string;
  side: TradeSide;
  quantity: number;
  orderMode?: OrderMode;
  /** 限价单价格，单位始终为标的 quoteCurrency。 */
  limitPrice?: number;
  idempotencyKey?: string;
}

export interface TradeResult {
  transaction: Transaction;
  portfolio: PortfolioSnapshot;
}

export interface LimitOrder {
  id: string;
  mode: MarketMode;
  instrumentId: string;
  symbol: string;
  name: string;
  market: StockMarket;
  side: TradeSide;
  orderMode: OrderMode;
  status: OrderStatus;
  quantity: number;
  filledQuantity: number;
  limitPrice: number | null;
  quoteCurrency: QuoteCurrency;
  reservedCashUsd: number;
  reservedQuantity: number;
  actorType: TradeActorType;
  createdAt: string;
  updatedAt: string;
  filledAt: string | null;
  cancelledAt: string | null;
  transactionId: string | null;
}

export interface OrderSubmissionResult {
  order: LimitOrder;
  transaction?: Transaction;
  portfolio: PortfolioSnapshot;
}

export interface OrderCancellationResult {
  order: LimitOrder;
  portfolio: PortfolioSnapshot;
}

export interface PublicAccount {
  id: string;
  username: string;
  email: string | null;
  displayName: string;
  displayCurrency: DisplayCurrency;
  createdAt: string;
}

export interface AuthResult {
  token: string;
  account: PublicAccount;
}

export interface ApiEnvelope<T> {
  data: T;
}

export interface ApiError {
  code: string;
  message: string;
}

export interface PaginatedData<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MarketItem {
  instrument: Instrument;
  quote: Quote;
}

export interface PasswordResetRequestResult {
  accepted: true;
  expiresInSeconds: number;
}

export interface PasswordResetConfirmResult {
  reset: true;
}

export interface EmailVerificationRequestResult {
  accepted: true;
  expiresInSeconds: number;
}

export interface RegistrationEmailVerificationConfirmResult {
  verificationToken: string;
  expiresInSeconds: number;
}

export interface IndustrySummary {
  industry: string;
  count: number;
}

export interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  averagePrice?: number;
  source: CandleSource;
  isPartial: boolean;
}

export interface ChartSeries {
  instrumentId: string;
  range: ChartRange;
  mode: MarketMode;
  source: "DATABASE_RECORDED" | "REAL_MARKET_RECORDED";
  candles: Candle[];
  coverageStart: string | null;
  updatedAt: string;
  referencePrice?: number;
  complete?: boolean;
  notice?: string;
}

export interface OrderBookLevel {
  price: number;
  quantity: number;
  orderCount: number;
}

export interface OrderBookSnapshot {
  instrumentId: string;
  quoteCurrency: QuoteCurrency;
  mode: MarketMode;
  asks: OrderBookLevel[];
  bids: OrderBookLevel[];
  updatedAt: string;
  available?: boolean;
  notice?: string;
}

export type RealMarketProviderState =
  | "DISABLED"
  | "STARTING"
  | "SYNCING"
  | "LIVE"
  | "DEGRADED";

export interface RealMarketMarketStatus {
  market: StockMarket;
  providerTotal: number;
  storedInstruments: number;
  totalPages: number;
  completedPages: number;
  failedPages: number;
  lastSuccessAt: string | null;
}

export interface RealMarketStatus {
  mode: "REAL";
  provider: "EASTMONEY_WEBGUEST";
  state: RealMarketProviderState;
  enabled: boolean;
  database: "PGLITE_SEPARATE";
  instrumentCount: number;
  quotedInstrumentCount: number;
  activeSweepId: string | null;
  activeSweepStartedAt: string | null;
  lastCompletedSweepAt: string | null;
  lastCompletedSweepDurationMs: number | null;
  fullSweepTargetMs: number;
  hotRefreshIntervalMs: number;
  pageSize: number;
  concurrency: number;
  hotPageCount: number;
  lastError: string | null;
  markets: RealMarketMarketStatus[];
}

export interface WatchlistItem {
  mode: MarketMode;
  instrumentId: string;
  createdAt: string;
  marketItem: MarketItem | null;
}

export interface WatchlistState {
  mode: MarketMode;
  items: WatchlistItem[];
  instrumentIds: string[];
  limit: number;
}

export type RewardKind = "CHECK_IN" | "GIFT_CODE";
export type RewardClaimState = "PENDING" | "COMPLETED";

export interface DailyCheckInStatus {
  date: string;
  claimed: boolean;
  claimedAt: string | null;
  mode: MarketMode | null;
  rewardUsd: number;
}

export interface RewardClaimResult {
  claimId: string;
  kind: RewardKind;
  mode: MarketMode;
  amountUsd: number;
  state: RewardClaimState;
  claimedAt: string;
  portfolio: PortfolioSnapshot;
}

export interface AITradingStatus {
  enabled: boolean;
  population: number;
  activeTraders: number;
  lastRoundTrades: number;
  lastRoundBuyVolume: number;
  lastRoundSellVolume: number;
  lifetimeTrades: number;
  lastRoundAt: string | null;
  lastRoundDurationMs: number;
  recentTradesPerMinute: number;
  recentTradesPerSecond: number;
  dueBacklog: number;
  strategyCounts: Record<AITraderStrategy, number>;
}

export interface AITraderRankingItem {
  id: string;
  name: string;
  strategy: AITraderStrategy;
  totalAssetsUsd: number;
  profitLossUsd: number;
  profitLossPercent: number;
  totalTrades: number;
  winRate: number;
  lastActionAt: string | null;
}

export type MarketSocketMessage =
  | {
      type: "snapshot";
      data: Quote[];
    }
  | {
      type: "quote_update";
      data: Quote[];
    };
