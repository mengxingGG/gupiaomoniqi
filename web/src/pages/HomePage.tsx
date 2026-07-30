import type {
  DailyCheckInStatus,
  DisplayCurrency,
  MarketItem,
  MarketMode,
  PaginatedData,
  PublicAccount,
  Quote,
  RealMarketStatus,
  StockMarket,
} from "@gupiaomoniqi/shared";
import { useEffect, useState } from "react";
import {
  addWatchlist,
  claimDailyCheckIn,
  fetchCheckInStatus,
  fetchMarket,
  fetchRealMarketStatus,
  fetchWatchlist,
  removeWatchlist,
} from "../api";
import {
  formatNumber,
  formatPercent,
  formatQuoteMoney,
  signedClass,
} from "../format";
import {
  type ConnectionState,
  useQuoteSocket,
} from "../useQuoteSocket";

const PAGE_SIZE = 40;
const EMPTY_DATA: PaginatedData<MarketItem> = {
  items: [],
  total: 0,
  page: 1,
  pageSize: PAGE_SIZE,
};
const markets: Array<{
  value?: StockMarket;
  label: string;
  caption: string;
}> = [
  { label: "全部市场", caption: "ALL" },
  { value: "CN", label: "沪深", caption: "CN" },
  { value: "HK", label: "港股", caption: "HK" },
  { value: "US", label: "美股", caption: "US" },
  { value: "UK", label: "英股", caption: "UK" },
];

interface HomePageProps {
  account: PublicAccount | null;
  displayCurrency: DisplayCurrency;
  mode: MarketMode;
  onOpenStock: (instrumentId: string) => void;
  onConnectionChange: (connection: ConnectionState) => void;
  onRequireAuth: () => void;
}

export function HomePage({
  account,
  displayCurrency,
  mode,
  onOpenStock,
  onConnectionChange,
  onRequireAuth,
}: HomePageProps) {
  const [market, setMarket] = useState<StockMarket | undefined>();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [realStatus, setRealStatus] =
    useState<RealMarketStatus | null>(null);
  const [watchlistIds, setWatchlistIds] = useState<Set<string>>(
    new Set(),
  );
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  const [sortBy, setSortBy] = useState<"DEFAULT" | "CHANGE_PERCENT">(
    "DEFAULT",
  );
  const [sortOrder, setSortOrder] = useState<"DESC" | "ASC">("DESC");
  const [checkIn, setCheckIn] =
    useState<DailyCheckInStatus | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);

  const connection = useQuoteSocket({ market, mode }, (quotes) => {
    setData((current) =>
      mergeQuotes(current, quotes, sortBy, sortOrder)
    );
  });

  useEffect(() => {
    onConnectionChange(connection);
  }, [connection, onConnectionChange]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 250);

    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let active = true;
    let first = true;
    const refresh = () => {
      if (first) {
        setLoading(true);
        setError(null);
      }
      void fetchMarket({
        mode,
        market,
        search,
        page,
        pageSize: PAGE_SIZE,
        watchlist: watchlistOnly,
        sortBy,
        sortOrder,
      })
        .then((result) => {
          if (active) {
            setData(sortMarketData(result, sortBy, sortOrder));
          }
        })
        .catch((nextError: unknown) => {
          if (active) {
            setError(
              nextError instanceof Error
                ? nextError.message
                : "行情读取失败",
            );
          }
        })
        .finally(() => {
          if (active && first) {
            setLoading(false);
            first = false;
          }
        });
    };
    refresh();
    const timer =
      mode === "REAL" ? window.setInterval(refresh, 2_000) : null;

    return () => {
      active = false;
      if (timer !== null) {
        window.clearInterval(timer);
      }
    };
  }, [market, mode, page, search, watchlistOnly, sortBy, sortOrder]);

  useEffect(() => {
    if (mode !== "REAL") {
      setRealStatus(null);
      return;
    }
    let active = true;
    const refresh = () => {
      void fetchRealMarketStatus()
        .then((status) => {
          if (active) {
            setRealStatus(status);
          }
        })
        .catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 3_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [mode]);

  useEffect(() => {
    if (!account) {
      setWatchlistIds(new Set());
      setCheckIn(null);
      setWatchlistOnly(false);
      return;
    }
    let active = true;
    void Promise.all([
      fetchWatchlist(mode),
      fetchCheckInStatus(),
    ]).then(([watchlist, status]) => {
      if (active) {
        setWatchlistIds(new Set(watchlist.instrumentIds));
        setCheckIn(status);
      }
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, [account, mode]);

  async function toggleWatchlist(instrumentId: string) {
    if (!account) {
      onRequireAuth();
      return;
    }
    const selected = watchlistIds.has(instrumentId);
    const result = selected
      ? await removeWatchlist(mode, instrumentId)
      : await addWatchlist(mode, instrumentId);
    setWatchlistIds(new Set(result.instrumentIds));
  }

  async function handleCheckIn() {
    if (!account) {
      onRequireAuth();
      return;
    }
    if (checkIn?.claimed || checkingIn) {
      return;
    }
    setCheckingIn(true);
    try {
      const result = await claimDailyCheckIn(mode);
      setCheckIn({
        date: new Date().toISOString().slice(0, 10),
        claimed: true,
        claimedAt: result.claimedAt,
        mode: result.mode,
        rewardUsd: result.amountUsd,
      });
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "签到失败",
      );
    } finally {
      setCheckingIn(false);
    }
  }

  const pageCount = Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  return (
    <main className="page-shell home-page">
      <section className="market-hero">
        <div>
          <span className="eyebrow">
            {mode === "REAL"
              ? "REAL MARKET DATA · PAPER TRADING"
              : "VIRTUAL EXCHANGE · FOUR MARKETS"}
          </span>
          <h1>
            {mode === "REAL"
              ? "真实全市场行情，零风险模拟交易。"
              : "真实标的，统一币种，模拟成交。"}
          </h1>
          <p>
            {mode === "REAL"
              ? "东方财富返回的沪深、港股、美股与英股全部证券持续写入独立数据库；行情真实，资金与成交完全模拟。"
              : "沪深、港股、美股与英股在同一行情页浏览。证券身份来自公开行情，价格路径与成交均为模拟。"}
          </p>
          <button
            className={`check-in-button ${checkIn?.claimed ? "claimed" : ""}`}
            disabled={checkingIn || Boolean(checkIn?.claimed)}
            type="button"
            onClick={() => void handleCheckIn()}
          >
            {checkIn?.claimed
              ? "今日已签到 · US$100,000 已到账"
              : checkingIn
                ? "正在签到…"
                : "每日签到 · 领取 US$100,000"}
          </button>
        </div>
        <div className="hero-stats">
          <div className="hero-currency">
            <span>当前统一显示</span>
            <strong>
              {displayCurrency === "USD"
                ? "美元 USD"
                : "人民币 CNY"}
            </strong>
            <small>固定显示汇率 1 USD = 7 CNY</small>
          </div>
          {mode === "REAL" ? (
            <div className="hero-ai real-provider-card">
              <span>EASTMONEY · FULL UNIVERSE</span>
              <strong>
                {realStatus
                  ? realStatus.instrumentCount.toLocaleString("zh-CN")
                  : "—"}
              </strong>
              <small>
                接口总量{" "}
                {realStatus?.markets
                  .reduce(
                    (total, status) =>
                      total + status.providerTotal,
                    0,
                  )
                  .toLocaleString("zh-CN") ?? "—"}{" "}
                · {providerStateLabel(realStatus?.state)}
              </small>
              <small>
                全量轮询{" "}
                {realStatus?.lastCompletedSweepDurationMs
                  ? `${(realStatus.lastCompletedSweepDurationMs / 1_000).toFixed(1)} 秒`
                  : "尚未完成"}{" "}
                · 热页 {realStatus?.hotPageCount ?? 0}
              </small>
            </div>
          ) : null}
        </div>
      </section>

      <section className="market-browser">
        <div className="market-toolbar">
          <div className="market-tabs" aria-label="选择股票市场">
            <button
              className={watchlistOnly ? "active watchlist-tab" : ""}
              type="button"
              onClick={() => {
                if (!account) {
                  onRequireAuth();
                  return;
                }
                setWatchlistOnly((current) => !current);
                setPage(1);
              }}
            >
              <small>★</small>
              自选
            </button>
            {markets.map((option) => (
              <button
                className={market === option.value ? "active" : ""}
                key={option.caption}
                type="button"
                onClick={() => {
                  setMarket(option.value);
                  setWatchlistOnly(false);
                  setPage(1);
                }}
              >
                <small>{option.caption}</small>
                {option.label}
              </button>
            ))}
          </div>

          <label className="market-search">
            <span aria-hidden="true">⌕</span>
            <input
              placeholder="搜索代码或股票名称"
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </label>
        </div>

        {error ? <div className="page-error">{error}</div> : null}

        <div className="market-table-wrap">
          <table className="market-table">
            <thead>
              <tr>
                <th>股票</th>
                <th>市场</th>
                <th>{mode === "REAL" ? "最新真实价" : "模拟价"}</th>
                <th>
                  <button
                    className={`sortable-header ${sortBy === "CHANGE_PERCENT" ? "active" : ""}`}
                    type="button"
                    onClick={() => {
                      setPage(1);
                      if (sortBy !== "CHANGE_PERCENT") {
                        setSortBy("CHANGE_PERCENT");
                        setSortOrder("DESC");
                        return;
                      }
                      setSortOrder((current) =>
                        current === "DESC" ? "ASC" : "DESC"
                      );
                    }}
                  >
                    涨跌幅 {sortIndicator(sortBy, sortOrder)}
                  </button>
                </th>
                <th>今开</th>
                <th>最高 / 最低</th>
                <th>{mode === "REAL" ? "真实成交量" : "模拟成交量"}</th>
                <th aria-label="自选">★</th>
              </tr>
            </thead>
            <tbody>
              {loading && data.items.length === 0
                ? Array.from({ length: 10 }, (_, index) => (
                    <tr className="skeleton-row" key={index}>
                      <td colSpan={8}>
                        <span />
                      </td>
                    </tr>
                  ))
                : data.items.map((item) => (
                    <MarketRow
                      displayCurrency={displayCurrency}
                      item={item}
                      key={item.instrument.id}
                      onOpen={() => onOpenStock(item.instrument.id)}
                      selected={watchlistIds.has(item.instrument.id)}
                      onToggleWatchlist={() =>
                        void toggleWatchlist(item.instrument.id)
                      }
                    />
                  ))}
            </tbody>
          </table>

          {!loading && data.items.length === 0 ? (
            <div className="empty-table">
              <strong>没有匹配的股票</strong>
              <span>换一个代码、名称或市场试试。</span>
            </div>
          ) : null}
        </div>

        <div className="market-pagination">
          <span>
            第 {page} / {pageCount} 页
          </span>
          <div>
            <button
              disabled={page <= 1 || loading}
              type="button"
              onClick={() => setPage((current) => current - 1)}
            >
              上一页
            </button>
            <button
              disabled={page >= pageCount || loading}
              type="button"
              onClick={() => setPage((current) => current + 1)}
            >
              下一页
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

function MarketRow({
  item,
  displayCurrency,
  onOpen,
  selected,
  onToggleWatchlist,
}: {
  item: MarketItem;
  displayCurrency: DisplayCurrency;
  onOpen: () => void;
  selected: boolean;
  onToggleWatchlist: () => void;
}) {
  const movement = signedClass(item.quote.changePercent);

  return (
    <tr
      className="market-row"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          onOpen();
        }
      }}
    >
      <td>
        <div className="stock-cell">
          <span className={`market-monogram market-${item.instrument.market}`}>
            {item.instrument.market}
          </span>
          <div>
            <strong>{item.instrument.name}</strong>
            <span>
              {item.instrument.symbol} · {item.instrument.industry}
            </span>
          </div>
        </div>
      </td>
      <td>
        <span className="market-name">
          {marketLabel(item.instrument.market)}
        </span>
      </td>
      <td>
        <strong className="price-cell">
          {formatQuoteMoney(
            item.quote.currentPrice,
            item.quote.quoteCurrency,
            displayCurrency,
          )}
        </strong>
      </td>
      <td>
        <span className={`change-pill ${movement}`}>
          {formatPercent(item.quote.changePercent)}
        </span>
      </td>
      <td>
        {formatQuoteMoney(
          item.quote.openPrice,
          item.quote.quoteCurrency,
          displayCurrency,
        )}
      </td>
      <td>
        <span className="range-cell">
          <span className="up">
            {formatQuoteMoney(
              item.quote.highPrice,
              item.quote.quoteCurrency,
              displayCurrency,
            )}
          </span>
          <span className="down">
            {formatQuoteMoney(
              item.quote.lowPrice,
              item.quote.quoteCurrency,
              displayCurrency,
            )}
          </span>
        </span>
      </td>
      <td>{formatNumber(item.quote.volume, { compact: true })}</td>
      <td>
        <button
          aria-label={selected ? "移出自选" : "加入自选"}
          className={`watchlist-star ${selected ? "selected" : ""}`}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleWatchlist();
          }}
        >
          {selected ? "★" : "☆"}
        </button>
      </td>
    </tr>
  );
}

function mergeQuotes(
  data: PaginatedData<MarketItem>,
  quotes: Quote[],
  sortBy: "DEFAULT" | "CHANGE_PERCENT",
  sortOrder: "DESC" | "ASC",
): PaginatedData<MarketItem> {
  if (quotes.length === 0 || data.items.length === 0) {
    return data;
  }

  const byId = new Map(
    quotes.map((quote) => [quote.instrumentId, quote]),
  );
  let changed = false;
  const items = data.items.map((item) => {
    const quote = byId.get(item.instrument.id);

    if (!quote) {
      return item;
    }

    changed = true;
    return { ...item, quote };
  });

  return changed
    ? sortMarketData({ ...data, items }, sortBy, sortOrder)
    : data;
}

function sortMarketData(
  data: PaginatedData<MarketItem>,
  sortBy: "DEFAULT" | "CHANGE_PERCENT",
  sortOrder: "DESC" | "ASC",
): PaginatedData<MarketItem> {
  if (sortBy !== "CHANGE_PERCENT") {
    return data;
  }
  return {
    ...data,
    items: [...data.items].sort((left, right) =>
      sortOrder === "ASC"
        ? left.quote.changePercent - right.quote.changePercent
        : right.quote.changePercent - left.quote.changePercent,
    ),
  };
}

function sortIndicator(
  sortBy: "DEFAULT" | "CHANGE_PERCENT",
  sortOrder: "DESC" | "ASC",
): string {
  if (sortBy !== "CHANGE_PERCENT") {
    return "⇅";
  }
  return sortOrder === "DESC" ? "↓" : "↑";
}

function marketLabel(market: StockMarket): string {
  return {
    CN: "沪深",
    HK: "港股",
    US: "美股",
    UK: "英股",
  }[market];
}

function providerStateLabel(
  state: RealMarketStatus["state"] | undefined,
): string {
  return {
    DISABLED: "同步已关闭",
    STARTING: "正在发现全量股票",
    SYNCING: "全市场同步中",
    LIVE: "实时同步正常",
    DEGRADED: "部分分片降级",
  }[state ?? "STARTING"];
}
