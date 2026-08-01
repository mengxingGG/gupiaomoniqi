import type {
  DisplayCurrency,
  LimitOrder,
  MarketMode,
  PortfolioSnapshot,
  PublicAccount,
  Transaction,
} from "@gupiaomoniqi/shared";
import { useEffect, useRef, useState } from "react";
import {
  ApiClientError,
  cancelOrder,
  fetchOrders,
  fetchPortfolio,
  fetchTransactions,
} from "../api";
import {
  formatMoney,
  formatNumber,
  formatQuoteMoney,
  signedClass,
} from "../format";

export type OrdersTab = "ORDERS" | "TRANSACTIONS";

interface OrdersPageProps {
  account: PublicAccount | null;
  displayCurrency: DisplayCurrency;
  mode: MarketMode;
  tab: OrdersTab;
  onTabChange: (tab: OrdersTab) => void;
  onRequireAuth: () => void;
  onOpenStock: (instrumentId: string) => void;
}

export function OrdersPage({
  account,
  displayCurrency,
  mode,
  tab,
  onTabChange,
  onRequireAuth,
  onOpenStock,
}: OrdersPageProps) {
  const [portfolio, setPortfolio] = useState<PortfolioSnapshot | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [orders, setOrders] = useState<LimitOrder[]>([]);
  const [loading, setLoading] = useState(Boolean(account));
  const [error, setError] = useState<string | null>(null);
  const [ordersEndpointMissing, setOrdersEndpointMissing] = useState(false);
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(
    null,
  );
  const [orderNotice, setOrderNotice] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const dataRequestEpochRef = useRef(0);
  const ordersEndpointMissingRef = useRef(false);
  const accountContextKey = `${account?.id ?? "anonymous"}:${mode}`;
  const accountContextKeyRef = useRef(accountContextKey);
  accountContextKeyRef.current = accountContextKey;

  useEffect(() => {
    dataRequestEpochRef.current += 1;
    ordersEndpointMissingRef.current = false;
    setOrdersEndpointMissing(false);
    setCancellingOrderId(null);
    setOrderNotice(null);

    if (!account) {
      setPortfolio(null);
      setTransactions([]);
      setOrders([]);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    const refresh = async () => {
      const requestEpoch = ++dataRequestEpochRef.current;
      const portfolioRequest = fetchPortfolio(mode);
      const transactionsRequest = fetchTransactions(mode);
      const ordersRequest = ordersEndpointMissingRef.current
        ? null
        : fetchOrders(mode);
      const [portfolioResult, transactionResult, orderResult] =
        await Promise.all([
          settle(portfolioRequest),
          settle(transactionsRequest),
          ordersRequest ? settle(ordersRequest) : Promise.resolve(null),
        ]);

      if (!active || requestEpoch !== dataRequestEpochRef.current) {
        return;
      }

      if (portfolioResult.ok) {
        setPortfolio(portfolioResult.value);
      }
      if (transactionResult.ok) {
        setTransactions(transactionResult.value);
      }
      if (orderResult?.ok) {
        setOrders(orderResult.value);
      } else if (orderResult && isMissingEndpoint(orderResult.error)) {
        ordersEndpointMissingRef.current = true;
        setOrdersEndpointMissing(true);
      }

      const essentialError = !portfolioResult.ok
        ? portfolioResult.error
        : !transactionResult.ok
          ? transactionResult.error
          : orderResult && !orderResult.ok && !isMissingEndpoint(orderResult.error)
            ? orderResult.error
            : null;
      setError(essentialError ? errorMessage(essentialError) : null);
      setLoading(false);
    };

    void refresh();
    let refreshTimer: number | undefined;
    const scheduleRefresh = async () => {
      try {
        await refresh();
      } finally {
        if (active) {
          refreshTimer = window.setTimeout(
            () => void scheduleRefresh(),
            5_000,
          );
        }
      }
    };
    refreshTimer = window.setTimeout(() => void scheduleRefresh(), 5_000);

    return () => {
      active = false;
      dataRequestEpochRef.current += 1;
      if (refreshTimer !== undefined) {
        window.clearTimeout(refreshTimer);
      }
    };
  }, [account?.id, mode]);

  async function handleCancelOrder(order: LimitOrder) {
    if (order.status !== "OPEN" || cancellingOrderId) {
      return;
    }

    const operationContext = accountContextKey;
    dataRequestEpochRef.current += 1;
    setCancellingOrderId(order.id);
    setOrderNotice(null);
    try {
      const result = await cancelOrder(order.id, mode);
      if (accountContextKeyRef.current !== operationContext) {
        return;
      }
      dataRequestEpochRef.current += 1;
      setOrders((current) =>
        current.map((candidate) =>
          candidate.id === result.order.id ? result.order : candidate,
        ),
      );
      setPortfolio(result.portfolio);
      setOrderNotice({
        kind: "success",
        text: `${order.name}委托已撤销，冻结资产已释放`,
      });
    } catch (nextError) {
      if (accountContextKeyRef.current !== operationContext) {
        return;
      }
      if (isMissingEndpoint(nextError)) {
        ordersEndpointMissingRef.current = true;
        setOrdersEndpointMissing(true);
      }
      setOrderNotice({
        kind: "error",
        text: isMissingEndpoint(nextError)
          ? "当前服务器尚未更新订单接口"
          : errorMessage(nextError),
      });
    } finally {
      if (accountContextKeyRef.current === operationContext) {
        setCancellingOrderId(null);
      }
    }
  }

  if (!account) {
    return (
      <main className="page-shell orders-page">
        <section className="account-gate">
          <span className="eyebrow">ACCOUNT REQUIRED</span>
          <h1>登录后管理委托与成交</h1>
          <p>订单和成交记录按模拟盘独立保存。</p>
          <button type="button" onClick={onRequireAuth}>
            注册或登录
          </button>
        </section>
      </main>
    );
  }

  const openOrderCount = orders.filter((order) => order.status === "OPEN").length;

  return (
    <main className="page-shell orders-page">
      <section className="account-heading compact-heading orders-heading">
        <div>
          <span className="eyebrow">ORDERS · {modeLabel(mode)}</span>
          <h1>订单中心</h1>
          <p>委托与成交分开查看</p>
        </div>
        <div className="orders-overview">
          <span>待成交 <strong>{openOrderCount}</strong></span>
          <span>
            冻结资金 <strong>{portfolio ? formatMoney(portfolio.frozenCashUsd, displayCurrency) : "—"}</strong>
          </span>
        </div>
      </section>

      <nav className="orders-tabs" aria-label="订单内容">
        <button
          className={tab === "ORDERS" ? "active" : ""}
          type="button"
          onClick={() => onTabChange("ORDERS")}
        >
          委托订单
          <small>{openOrderCount} 待成交</small>
        </button>
        <button
          className={tab === "TRANSACTIONS" ? "active" : ""}
          type="button"
          onClick={() => onTabChange("TRANSACTIONS")}
        >
          成交记录
          <small>{transactions.length} 笔</small>
        </button>
      </nav>

      {error ? <div className="page-error">{error}</div> : null}
      {orderNotice ? (
        <div className={`inline-notice order-notice page-order-notice ${orderNotice.kind}`}>
          {orderNotice.text}
        </div>
      ) : null}

      {tab === "ORDERS" ? (
        <section className="account-section order-management orders-content">
          <div className="section-heading">
            <div>
              <span className="eyebrow">OPEN & HISTORY</span>
              <h2>委托订单</h2>
            </div>
            <span>{orders.length} 笔</span>
          </div>

          {ordersEndpointMissing ? (
            <div className="endpoint-notice">
              <strong>订单接口等待服务器更新</strong>
              <span>部署 1.0 后即可查看与撤销限价委托；资产和成交记录不受影响。</span>
            </div>
          ) : loading ? (
            <div className="account-loading compact-loading">正在读取委托…</div>
          ) : orders.length === 0 ? (
            <div className="section-empty compact-empty">
              <strong>暂无委托</strong>
              <span>市价成交和限价挂单都会记录在这里。</span>
            </div>
          ) : (
            <OrdersTable
              cancellingOrderId={cancellingOrderId}
              displayCurrency={displayCurrency}
              onCancel={(order) => void handleCancelOrder(order)}
              onOpenStock={onOpenStock}
              orders={orders}
            />
          )}
        </section>
      ) : (
        <section className="account-section orders-content">
          <div className="section-heading">
            <div>
              <span className="eyebrow">TRANSACTIONS</span>
              <h2>成交记录</h2>
            </div>
            <span>{transactions.length} 笔</span>
          </div>

          {loading ? (
            <div className="account-loading compact-loading">正在读取成交…</div>
          ) : transactions.length === 0 ? (
            <div className="section-empty">
              <strong>暂无成交</strong>
              <span>买入或卖出后，流水会立即出现在这里。</span>
            </div>
          ) : (
            <TransactionsTable
              displayCurrency={displayCurrency}
              onOpenStock={onOpenStock}
              transactions={transactions}
            />
          )}
        </section>
      )}
    </main>
  );
}

function OrdersTable({
  cancellingOrderId,
  displayCurrency,
  onCancel,
  onOpenStock,
  orders,
}: {
  cancellingOrderId: string | null;
  displayCurrency: DisplayCurrency;
  onCancel: (order: LimitOrder) => void;
  onOpenStock: (instrumentId: string) => void;
  orders: LimitOrder[];
}) {
  return (
    <div className="account-table-wrap">
      <table className="account-table orders-table">
        <thead>
          <tr>
            <th>股票</th>
            <th>委托</th>
            <th>价格</th>
            <th>成交 / 委托</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id} onClick={() => onOpenStock(order.instrumentId)}>
              <td>
                <strong>{order.name}</strong>
                <span>{order.symbol} · {shortDateTime(order.createdAt)}</span>
              </td>
              <td>
                <span className={`trade-direction ${order.side.toLowerCase()}`}>
                  {order.side === "BUY" ? "买入" : "卖出"}
                </span>
                <span>{order.orderMode === "LIMIT" ? "限价" : "市价"}</span>
              </td>
              <td>
                {order.limitPrice === null
                  ? "市价"
                  : formatQuoteMoney(
                      order.limitPrice,
                      order.quoteCurrency,
                      displayCurrency,
                    )}
              </td>
              <td>
                {formatNumber(order.filledQuantity, { maximumFractionDigits: 0 })}
                <span>
                  共 {formatNumber(order.quantity, { maximumFractionDigits: 0 })} 股
                </span>
              </td>
              <td>
                <span className={`order-status ${order.status.toLowerCase()}`}>
                  {orderStatusLabel(order.status)}
                </span>
                {order.status === "OPEN" && order.reservedCashUsd > 0 ? (
                  <span>冻结 {formatMoney(order.reservedCashUsd, displayCurrency)}</span>
                ) : null}
                {order.status === "OPEN" && order.reservedQuantity > 0 ? (
                  <span>冻结 {order.reservedQuantity} 股</span>
                ) : null}
              </td>
              <td>
                {order.status === "OPEN" ? (
                  <button
                    className="cancel-order-button"
                    disabled={cancellingOrderId === order.id}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onCancel(order);
                    }}
                  >
                    {cancellingOrderId === order.id ? "撤单中" : "撤单"}
                  </button>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TransactionsTable({
  displayCurrency,
  onOpenStock,
  transactions,
}: {
  displayCurrency: DisplayCurrency;
  onOpenStock: (instrumentId: string) => void;
  transactions: Transaction[];
}) {
  return (
    <div className="account-table-wrap">
      <table className="account-table transaction-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>股票</th>
            <th>方向</th>
            <th>数量</th>
            <th>成交价</th>
            <th>成交净额</th>
            <th>已实现盈亏</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((transaction) => (
            <tr
              key={transaction.id}
              onClick={() => onOpenStock(transaction.instrumentId)}
            >
              <td>{shortDateTime(transaction.createdAt)}</td>
              <td>
                <strong>{transaction.name}</strong>
                <span>{transaction.symbol}</span>
              </td>
              <td>
                <span className={`trade-direction ${transaction.side.toLowerCase()}`}>
                  {transaction.side === "BUY" ? "买入" : "卖出"}
                </span>
              </td>
              <td>{transaction.quantity} 股</td>
              <td>{formatMoney(transaction.priceUsd, displayCurrency)}</td>
              <td>{formatMoney(transaction.netAmountUsd, displayCurrency)}</td>
              <td className={signedClass(transaction.realizedProfitUsd ?? 0)}>
                {transaction.realizedProfitUsd === null
                  ? "—"
                  : formatMoney(transaction.realizedProfitUsd, displayCurrency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function orderStatusLabel(status: LimitOrder["status"]): string {
  return { OPEN: "待成交", FILLED: "已成交", CANCELLED: "已撤单" }[status];
}

function shortDateTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function modeLabel(mode: MarketMode): string {
  return mode === "REAL" ? "真实行情模拟盘" : "虚拟市场模拟盘";
}

function isMissingEndpoint(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 404;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "订单读取失败";
}

async function settle<T>(promise: Promise<T>): Promise<
  | { ok: true; value: T }
  | { ok: false; error: unknown }
> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error };
  }
}
