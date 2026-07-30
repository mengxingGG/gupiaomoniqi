import type {
  ChartRange,
  ChartSeries,
  DisplayCurrency,
  MarketItem,
  MarketMode,
  OrderBookSnapshot,
  PortfolioSnapshot,
  PublicAccount,
  Quote,
  TradeResult,
} from "@gupiaomoniqi/shared";
import { useEffect, useMemo, useState } from "react";
import {
  addWatchlist,
  fetchChart,
  fetchInstrument,
  fetchOrderBook,
  fetchPortfolio,
  fetchWatchlist,
  removeWatchlist,
} from "../api";
import { MarketChart } from "../components/MarketChart";
import { OrderBookPanel } from "../components/OrderBookPanel";
import { TradeTicket } from "../components/TradeTicket";
import {
  formatMoney,
  formatNumber,
  formatPercent,
  formatQuoteMoney,
  signedClass,
} from "../format";
import {
  type ConnectionState,
  useQuoteSocket,
} from "../useQuoteSocket";

const ranges: Array<{ value: ChartRange; label: string }> = [
  { value: "INTRADAY", label: "分时" },
  { value: "DAY", label: "日 K" },
  { value: "MONTH", label: "月 K" },
  { value: "YEAR", label: "年 K" },
];

interface StockPageProps {
  instrumentId: string;
  account: PublicAccount | null;
  displayCurrency: DisplayCurrency;
  mode: MarketMode;
  onBack: () => void;
  onRequireAuth: () => void;
  onConnectionChange: (connection: ConnectionState) => void;
}

export function StockPage({
  instrumentId,
  account,
  displayCurrency,
  mode,
  onBack,
  onRequireAuth,
  onConnectionChange,
}: StockPageProps) {
  const [item, setItem] = useState<MarketItem | null>(null);
  const [range, setRange] = useState<ChartRange>("INTRADAY");
  const [chart, setChart] = useState<ChartSeries | null>(null);
  const [orderBook, setOrderBook] =
    useState<OrderBookSnapshot | null>(null);
  const [portfolio, setPortfolio] =
    useState<PortfolioSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [chartLoading, setChartLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [watchlisted, setWatchlisted] = useState(false);
  const [watchlistUpdating, setWatchlistUpdating] = useState(false);

  const connection = useQuoteSocket(
    { instrumentId, mode },
    (quotes: Quote[]) => {
      const quote = quotes.find(
        (candidate) => candidate.instrumentId === instrumentId,
      );

      if (quote) {
        setItem((current) => (current ? { ...current, quote } : current));
      }
    },
  );

  useEffect(() => {
    onConnectionChange(connection);
  }, [connection, onConnectionChange]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    Promise.all([
      fetchInstrument(instrumentId, mode),
      fetchOrderBook(instrumentId, mode),
      account ? fetchPortfolio(mode) : Promise.resolve(null),
      account ? fetchWatchlist(mode) : Promise.resolve(null),
    ])
      .then(
        ([
          nextItem,
          nextOrderBook,
          nextPortfolio,
          nextWatchlist,
        ]) => {
        if (active) {
          setItem(nextItem);
          setOrderBook(nextOrderBook);
          setPortfolio(nextPortfolio);
          setWatchlisted(
            nextWatchlist?.instrumentIds.includes(instrumentId) ??
              false,
          );
        }
        },
      )
      .catch((nextError: unknown) => {
        if (active) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : "股票详情读取失败",
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [account, instrumentId, mode]);

  useEffect(() => {
    let active = true;
    setChartLoading(true);

    const refresh = () => {
      void fetchChart(instrumentId, range, mode)
        .then((nextChart) => {
          if (active) {
            setChart(nextChart);
          }
        })
        .catch((nextError: unknown) => {
          if (active) {
            setError(
              nextError instanceof Error
                ? nextError.message
                : "图表读取失败",
            );
          }
        })
        .finally(() => {
          if (active) {
            setChartLoading(false);
          }
        });
    };

    refresh();
    const timer = window.setInterval(
      refresh,
      range === "INTRADAY" ? 5_000 : 30_000,
    );

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [instrumentId, mode, range]);

  const position = useMemo(
    () =>
      portfolio?.positions.find(
        (candidate) => candidate.instrumentId === instrumentId,
      ),
    [instrumentId, portfolio],
  );

  function handleTradeCompleted(result: TradeResult) {
    setPortfolio(result.portfolio);
  }

  async function toggleWatchlist() {
    if (!account) {
      onRequireAuth();
      return;
    }
    if (watchlistUpdating) {
      return;
    }
    setWatchlistUpdating(true);
    try {
      const result = watchlisted
        ? await removeWatchlist(mode, instrumentId)
        : await addWatchlist(mode, instrumentId);
      setWatchlisted(result.instrumentIds.includes(instrumentId));
    } finally {
      setWatchlistUpdating(false);
    }
  }

  if (loading && !item) {
    return (
      <main className="page-shell stock-page">
        <div className="detail-loading">
          正在载入
          {mode === "REAL" ? "真实股票详情" : "股票详情与模拟行情"}
          …
        </div>
      </main>
    );
  }

  if (error && !item) {
    return (
      <main className="page-shell stock-page">
        <button className="back-link" type="button" onClick={onBack}>
          ← 返回行情
        </button>
        <div className="page-error">{error}</div>
      </main>
    );
  }

  if (!item) {
    return null;
  }

  const movement = signedClass(item.quote.changePercent);

  return (
    <main className="page-shell stock-page">
      <button className="back-link" type="button" onClick={onBack}>
        ← 返回行情
      </button>

      <section className="stock-heading">
        <div className="stock-title-block">
          <div className={`market-monogram market-${item.instrument.market}`}>
            {item.instrument.market}
          </div>
          <div>
            <div className="stock-heading-line">
              <h1>{item.instrument.name}</h1>
              <span className="simulation-chip">
                {mode === "REAL" ? "真实行情 · 模拟交易" : "虚拟股票"}
              </span>
              <button
                className={`watchlist-star detail-star ${watchlisted ? "selected" : ""}`}
                disabled={watchlistUpdating}
                type="button"
                onClick={() => void toggleWatchlist()}
              >
                {watchlisted ? "★ 已自选" : "☆ 加自选"}
              </button>
            </div>
            <p>
              {marketLabel(item.instrument.market)} · {item.instrument.symbol} ·{" "}
              {item.instrument.industry}
            </p>
          </div>
        </div>

        <div className="headline-quote">
          <strong>
            {formatQuoteMoney(
              item.quote.currentPrice,
              item.quote.quoteCurrency,
              displayCurrency,
            )}
          </strong>
          <span className={movement}>
            {formatPercent(item.quote.changePercent)}
            <small>
              {formatQuoteMoney(
                item.quote.changeAmount,
                item.quote.quoteCurrency,
                displayCurrency,
              )}
            </small>
          </span>
        </div>
      </section>

      {error ? <div className="page-error compact">{error}</div> : null}

      <section className="quote-stat-grid">
        <QuoteStat
          label="今开"
          value={formatQuoteMoney(
            item.quote.openPrice,
            item.quote.quoteCurrency,
            displayCurrency,
          )}
        />
        <QuoteStat
          label="最高"
          value={formatQuoteMoney(
            item.quote.highPrice,
            item.quote.quoteCurrency,
            displayCurrency,
          )}
        />
        <QuoteStat
          label="最低"
          value={formatQuoteMoney(
            item.quote.lowPrice,
            item.quote.quoteCurrency,
            displayCurrency,
          )}
        />
        <QuoteStat
          label="昨收"
          value={formatQuoteMoney(
            item.quote.previousClose,
            item.quote.quoteCurrency,
            displayCurrency,
          )}
        />
        <QuoteStat
          label={mode === "REAL" ? "真实成交量" : "模拟成交量"}
          value={formatNumber(item.quote.volume, { compact: true })}
        />
        <QuoteStat
          label="每手 / 规则"
          value={`${item.instrument.lotSize} 股 · ${item.instrument.settlementCycle}`}
        />
      </section>

      <div className="stock-workspace">
        <div className="stock-main-column">
          <section className="detail-panel chart-panel">
            <div className="chart-toolbar">
              <div>
                <span className="eyebrow">
                  {mode === "REAL"
                    ? "REAL DATA · LOCALLY RECORDED"
                    : "PRO CHART · DATABASE RECORDED"}
                </span>
                <h2>价格、成交量与 MACD</h2>
              </div>
              <div className="range-tabs">
                {ranges.map((option) => (
                  <button
                    className={range === option.value ? "active" : ""}
                    key={option.value}
                    type="button"
                    onClick={() => setRange(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {chartLoading || !chart ? (
              <div className="chart-loading">正在读取数据库行情记录…</div>
            ) : (
              <>
                {chart.notice ? (
                  <div className="chart-source-notice">
                    {chart.notice}
                  </div>
                ) : null}
                <MarketChart
                  displayCurrency={displayCurrency}
                  quoteCurrency={item.quote.quoteCurrency}
                  series={chart}
                />
              </>
            )}
          </section>

          <section className="stock-lower-grid">
            {orderBook ? (
              <OrderBookPanel
                displayCurrency={displayCurrency}
                orderBook={orderBook}
              />
            ) : (
              <div className="detail-panel chart-loading">正在载入盘口…</div>
            )}

            <section className="detail-panel position-panel">
              <div className="panel-title-row">
                <div>
                  <span className="eyebrow">YOUR POSITION</span>
                  <h3>该股盈亏</h3>
                </div>
                <span className="simulation-chip">
                  {account ? "账户持仓" : "未登录"}
                </span>
              </div>

              {!account ? (
                <div className="position-gate">
                  <p>注册后可查看该股票的持仓成本、浮动盈亏与可卖数量。</p>
                  <button type="button" onClick={onRequireAuth}>
                    注册或登录
                  </button>
                </div>
              ) : !position ? (
                <div className="position-gate">
                  <strong>当前未持有</strong>
                  <p>完成首笔买入后，这里会实时计算盈亏。</p>
                </div>
              ) : (
                <dl className="position-metrics">
                  <div>
                    <dt>持仓数量</dt>
                    <dd>{position.quantity} 股</dd>
                  </div>
                  <div>
                    <dt>可卖数量</dt>
                    <dd>{position.availableQuantity} 股</dd>
                  </div>
                  <div>
                    <dt>待结算数量</dt>
                    <dd>{position.pendingSettlementQuantity} 股</dd>
                  </div>
                  <div>
                    <dt>平均成本</dt>
                    <dd>
                      {formatMoney(
                        position.averageCostUsd,
                        displayCurrency,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>持仓市值</dt>
                    <dd>
                      {formatMoney(
                        position.marketValueUsd,
                        displayCurrency,
                      )}
                    </dd>
                  </div>
                  <div className="wide">
                    <dt>浮动盈亏</dt>
                    <dd className={signedClass(position.profitLossUsd)}>
                      {formatMoney(
                        position.profitLossUsd,
                        displayCurrency,
                      )}
                      <small>
                        {position.profitLossPercent > 0 ? "+" : ""}
                        {position.profitLossPercent.toFixed(2)}%
                      </small>
                    </dd>
                  </div>
                </dl>
              )}
            </section>
          </section>
        </div>

        <aside className="stock-side-column">
          <TradeTicket
            authenticated={Boolean(account)}
            displayCurrency={displayCurrency}
            item={item}
            mode={mode}
            portfolio={portfolio}
            onCompleted={handleTradeCompleted}
            onRequireAuth={onRequireAuth}
          />

          <section className="detail-panel stock-facts">
            <span className="eyebrow">INSTRUMENT</span>
            <h3>股票资料</h3>
            <dl>
              <div>
                <dt>市场</dt>
                <dd>{marketLabel(item.instrument.market)}</dd>
              </div>
              <div>
                <dt>代码</dt>
                <dd>{item.instrument.symbol}</dd>
              </div>
              <div>
                <dt>行业</dt>
                <dd>{item.instrument.industry}</dd>
              </div>
              <div>
                <dt>源行情币种</dt>
                <dd>{item.instrument.sourceCurrency}</dd>
              </div>
              <div>
                <dt>统一报价账本</dt>
                <dd>{item.instrument.quoteCurrency}</dd>
              </div>
              <div>
                <dt>卖出规则</dt>
                <dd>{item.instrument.settlementCycle}</dd>
              </div>
              <div>
                <dt>模式</dt>
                <dd>{mode}</dd>
              </div>
              {mode === "REAL" ? (
                <div>
                  <dt>行情时间</dt>
                  <dd>
                    {new Date(
                      item.quote.receivedAt ?? item.quote.updatedAt,
                    ).toLocaleString("zh-CN", { hour12: false })}
                  </dd>
                </div>
              ) : null}
            </dl>
          </section>
        </aside>
      </div>
    </main>
  );
}

function QuoteStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="quote-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function marketLabel(market: MarketItem["instrument"]["market"]): string {
  return {
    CN: "沪深",
    HK: "港股",
    US: "美股",
    UK: "英股",
  }[market];
}
