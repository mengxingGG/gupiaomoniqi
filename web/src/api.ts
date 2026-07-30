import type {
  AITradingStatus,
  ApiEnvelope,
  AuthResult,
  ChartRange,
  ChartSeries,
  DisplayCurrency,
  DailyCheckInStatus,
  MarketItem,
  MarketMode,
  OrderBookSnapshot,
  PaginatedData,
  PortfolioSnapshot,
  PublicAccount,
  RealMarketStatus,
  RewardClaimResult,
  StockMarket,
  TradeRequest,
  TradeResult,
  Transaction,
  WatchlistState,
} from "@gupiaomoniqi/shared";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";
const AUTH_STORAGE_KEY = "stock-simulator-auth";

export interface MarketQuery {
  mode: MarketMode;
  market?: StockMarket;
  search?: string;
  page: number;
  pageSize: number;
  watchlist?: boolean;
  sortBy?: "DEFAULT" | "CHANGE_PERCENT";
  sortOrder?: "DESC" | "ASC";
}

export interface StoredAuth {
  token: string;
  account: PublicAccount;
}

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export function readStoredAuth(): StoredAuth | null {
  try {
    const value = window.localStorage.getItem(AUTH_STORAGE_KEY);
    return value ? (JSON.parse(value) as StoredAuth) : null;
  } catch {
    return null;
  }
}

export function storeAuth(auth: StoredAuth | null): void {
  if (auth) {
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
  } else {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
  }
}

export function register(input: {
  username: string;
  password: string;
  displayName: string;
}): Promise<AuthResult> {
  return request<AuthResult>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  }, false);
}

export function login(input: {
  username: string;
  password: string;
}): Promise<AuthResult> {
  return request<AuthResult>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  }, false);
}

export async function logout(): Promise<void> {
  await request<{ loggedOut: true }>("/api/auth/logout", {
    method: "POST",
  }).catch(() => undefined);
  storeAuth(null);
}

export function fetchCurrentAccount(): Promise<PublicAccount> {
  return request<PublicAccount>("/api/auth/me");
}

export async function updateDisplayCurrency(
  currency: DisplayCurrency,
): Promise<PublicAccount> {
  return request<PublicAccount>("/api/account/display-currency", {
    method: "PUT",
    body: JSON.stringify({ currency }),
  });
}

export async function fetchMarket(
  query: MarketQuery,
): Promise<PaginatedData<MarketItem>> {
  const params = new URLSearchParams({
    mode: query.mode,
    page: String(query.page),
    pageSize: String(query.pageSize),
  });

  if (query.market) {
    params.set("market", query.market);
  }
  if (query.search) {
    params.set("search", query.search);
  }
  if (query.watchlist) {
    params.set("watchlist", "true");
  }
  if (query.sortBy && query.sortBy !== "DEFAULT") {
    params.set("sortBy", query.sortBy);
    params.set("sortOrder", query.sortOrder ?? "DESC");
  }

  return request<PaginatedData<MarketItem>>(
    `/api/market?${params}`,
    undefined,
    false,
  );
}

export function fetchInstrument(
  instrumentId: string,
  mode: MarketMode,
): Promise<MarketItem> {
  return request<MarketItem>(
    `/api/instruments/${encodeURIComponent(instrumentId)}?mode=${mode}`,
    undefined,
    false,
  );
}

export function fetchChart(
  instrumentId: string,
  range: ChartRange,
  mode: MarketMode,
): Promise<ChartSeries> {
  return request<ChartSeries>(
    `/api/instruments/${encodeURIComponent(instrumentId)}/chart?range=${range}&mode=${mode}`,
    undefined,
    false,
  );
}

export function fetchOrderBook(
  instrumentId: string,
  mode: MarketMode,
): Promise<OrderBookSnapshot> {
  return request<OrderBookSnapshot>(
    `/api/instruments/${encodeURIComponent(instrumentId)}/order-book?mode=${mode}`,
    undefined,
    false,
  );
}

export function fetchPortfolio(
  mode: MarketMode,
): Promise<PortfolioSnapshot> {
  return request<PortfolioSnapshot>(`/api/account?mode=${mode}`);
}

export function fetchTransactions(
  mode: MarketMode,
): Promise<Transaction[]> {
  return request<Transaction[]>(
    `/api/account/transactions?mode=${mode}`,
  );
}

export function fetchAIStatus(): Promise<AITradingStatus> {
  return request<AITradingStatus>(
    "/api/ai/status",
    undefined,
    false,
  );
}

export function executeTrade(
  trade: TradeRequest,
  mode: MarketMode,
): Promise<TradeResult> {
  return request<TradeResult>("/api/trades", {
    method: "POST",
    body: JSON.stringify({ ...trade, mode }),
  });
}

export function marketSocketUrl(filter?: {
  mode?: MarketMode;
  market?: StockMarket;
  instrumentId?: string;
}): string {
  const configuredBase = import.meta.env.VITE_WS_BASE_URL as
    | string
    | undefined;
  const base =
    configuredBase ??
    `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
  const url = new URL("/ws/market", base);

  if (filter?.mode) {
    url.searchParams.set("mode", filter.mode);
  }
  if (filter?.market) {
    url.searchParams.set("market", filter.market);
  }
  if (filter?.instrumentId) {
    url.searchParams.set("instrumentId", filter.instrumentId);
  }

  return url.toString();
}

export function fetchRealMarketStatus(): Promise<RealMarketStatus> {
  return request<RealMarketStatus>(
    "/api/real-market/status",
    undefined,
    false,
  );
}

export function fetchWatchlist(
  mode: MarketMode,
): Promise<WatchlistState> {
  return request<WatchlistState>(`/api/watchlist?mode=${mode}`);
}

export function addWatchlist(
  mode: MarketMode,
  instrumentId: string,
): Promise<WatchlistState> {
  return request<WatchlistState>("/api/watchlist", {
    method: "POST",
    body: JSON.stringify({ mode, instrumentId }),
  });
}

export function removeWatchlist(
  mode: MarketMode,
  instrumentId: string,
): Promise<WatchlistState> {
  return request<WatchlistState>("/api/watchlist", {
    method: "DELETE",
    body: JSON.stringify({ mode, instrumentId }),
  });
}

export function fetchCheckInStatus(): Promise<DailyCheckInStatus> {
  return request<DailyCheckInStatus>("/api/rewards/check-in");
}

export function claimDailyCheckIn(
  mode: MarketMode,
): Promise<RewardClaimResult> {
  return request<RewardClaimResult>("/api/rewards/check-in", {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}

export function redeemGiftCode(
  mode: MarketMode,
  code: string,
  idempotencyKey: string,
): Promise<RewardClaimResult> {
  return request<RewardClaimResult>("/api/rewards/gift-code", {
    method: "POST",
    body: JSON.stringify({ mode, code, idempotencyKey }),
  });
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  authenticated = true,
): Promise<T> {
  const headers = new Headers(init.headers);

  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (authenticated) {
    const token = readStoredAuth()?.token;

    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });
  const payload = (await response.json()) as
    | ApiEnvelope<T>
    | { code?: string; message?: string };

  if (!response.ok || !("data" in payload)) {
    const error = new ApiClientError(
      "message" in payload && payload.message
        ? payload.message
        : `请求失败（${response.status}）`,
      "code" in payload && payload.code
        ? payload.code
        : "REQUEST_FAILED",
      response.status,
    );

    if (response.status === 401 && authenticated) {
      storeAuth(null);
      window.dispatchEvent(new CustomEvent("simulator:auth-expired"));
    }

    throw error;
  }

  return payload.data;
}
