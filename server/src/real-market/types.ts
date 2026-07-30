import type {
  Candle,
  Instrument,
  Quote,
  StockMarket,
} from "@gupiaomoniqi/shared";

export interface RealInstrumentRecord extends Instrument {
  providerSecId: string;
  exchangeCode: string;
  sourcePage: number;
  sourceRank: number;
  sourceUpdatedAt: string;
  isActive: boolean;
}

export interface RealQuoteRecord extends Quote {
  rawCurrentPrice: number;
  rawPreviousClose: number;
  rawOpenPrice: number;
  rawHighPrice: number;
  rawLowPrice: number;
  amount: number;
  receivedAt: string;
}

export interface ProviderInstrumentSnapshot {
  instrument: RealInstrumentRecord;
  quote: RealQuoteRecord | null;
}

export interface ProviderPage {
  market: StockMarket;
  page: number;
  pageSize: number;
  providerTotal: number;
  receivedAt: string;
  durationMs: number;
  items: ProviderInstrumentSnapshot[];
}

export interface ProviderCandle extends Candle {
  instrumentId: string;
  interval: "MINUTE" | "DAY" | "MONTH" | "YEAR";
  updatedAt: string;
}

export interface ProviderOrderBookLevel {
  price: number;
  quantity: number;
}

export interface ProviderOrderBook {
  asks: ProviderOrderBookLevel[];
  bids: ProviderOrderBookLevel[];
  updatedAt: string;
}

export interface ProviderPageDescriptor {
  market: StockMarket;
  page: number;
}

export interface ProviderPageState {
  market: StockMarket;
  page: number;
  pageSize: number;
  providerTotal: number;
  rowCount: number;
  lastSweepId: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastDurationMs: number | null;
  consecutiveFailures: number;
  lastError: string | null;
}

export interface RealPositionRecord {
  id: string;
  portfolioId: string;
  instrumentId: string;
  quantity: number;
  availableQuantity: number;
  frozenQuantity: number;
  averageCostUsd: number;
}

export interface RealPortfolioRecord {
  id: string;
  accountId: string;
  initialCashUsd: number;
  availableCashUsd: number;
  frozenCashUsd: number;
}
