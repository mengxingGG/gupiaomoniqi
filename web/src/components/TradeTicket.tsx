import {
  MINIMUM_TRADE_FEE_USD,
  maximumAffordableLots,
  quotePriceToUsd,
  VIRTUAL_TRADE_FEE_RATE,
  type DisplayCurrency,
  type MarketItem,
  type MarketMode,
  type PortfolioSnapshot,
  type TradeResult,
  type TradeSide,
} from "@gupiaomoniqi/shared";
import {
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import { executeTrade } from "../api";
import {
  formatMoney,
  formatPercent,
  formatQuoteMoney,
  signedClass,
} from "../format";

const PERCENTAGES = [25, 50, 75, 100] as const;

interface TradeTicketProps {
  item: MarketItem;
  portfolio: PortfolioSnapshot | null;
  displayCurrency: DisplayCurrency;
  authenticated: boolean;
  mode: MarketMode;
  onRequireAuth: () => void;
  onCompleted: (result: TradeResult) => void;
}

export function TradeTicket({
  item,
  portfolio,
  displayCurrency,
  authenticated,
  mode,
  onRequireAuth,
  onCompleted,
}: TradeTicketProps) {
  const [side, setSide] = useState<TradeSide>("BUY");
  const [lots, setLots] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const position = portfolio?.positions.find(
    (itemPosition) =>
      itemPosition.instrumentId === item.instrument.id,
  );
  const quantity = lots * item.instrument.lotSize;
  const unitLotUsd = useMemo(
    () =>
      quotePriceToUsd(
        item.quote.currentPrice,
        item.quote.quoteCurrency,
      ) * item.instrument.lotSize,
    [
      item.instrument.lotSize,
      item.quote.currentPrice,
      item.quote.quoteCurrency,
    ],
  );
  const estimatedGrossUsd = unitLotUsd * lots;
  const estimatedFeeUsd = Math.max(
    MINIMUM_TRADE_FEE_USD,
    estimatedGrossUsd * VIRTUAL_TRADE_FEE_RATE,
  );
  const estimatedSettlementUsd =
    side === "BUY"
      ? estimatedGrossUsd + estimatedFeeUsd
      : Math.max(0, estimatedGrossUsd - estimatedFeeUsd);
  const insufficientCash =
    side === "BUY" &&
    Boolean(
      portfolio &&
        estimatedSettlementUsd > portfolio.availableCashUsd,
    );
  const insufficientPosition =
    side === "SELL" &&
    Boolean(
      portfolio &&
        quantity > (position?.availableQuantity ?? 0),
    );

  useEffect(() => {
    setLots(1);
    setNotice(null);
  }, [item.instrument.id, item.instrument.lotSize]);

  function changeSide(nextSide: TradeSide) {
    setSide(nextSide);
    setLots(1);
    setNotice(null);
  }

  function changeLots(direction: -1 | 1) {
    setLots((current) => Math.max(1, current + direction));
    setNotice(null);
  }

  function applyPercentage(percent: number) {
    if (!portfolio) {
      onRequireAuth();
      return;
    }

    if (side === "BUY") {
      const budgetUsd =
        portfolio.availableCashUsd * (percent / 100);
      const nextLots = maximumAffordableLots(
        budgetUsd,
        unitLotUsd,
      );

      if (nextLots < 1) {
        setNotice({
          kind: "error",
          text: `${percent}% 可用资金不足 1 手`,
        });
        return;
      }

      setLots(nextLots);
    } else {
      const availableLots = Math.floor(
        (position?.availableQuantity ?? 0) /
          item.instrument.lotSize,
      );
      const nextLots =
        percent === 100
          ? availableLots
          : Math.floor(availableLots * (percent / 100));

      if (nextLots < 1) {
        setNotice({
          kind: "error",
          text: `${percent}% 可卖持仓不足 1 手`,
        });
        return;
      }

      setLots(nextLots);
    }

    setNotice(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();

    if (!authenticated) {
      onRequireAuth();
      return;
    }

    setSubmitting(true);
    setNotice(null);

    try {
      const result = await executeTrade(
        {
          instrumentId: item.instrument.id,
          side,
          quantity,
          orderMode: "MARKET",
          idempotencyKey:
            typeof crypto.randomUUID === "function"
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        },
        mode,
      );
      onCompleted(result);
      setNotice({
        kind: "success",
        text:
          side === "BUY" &&
          item.instrument.settlementCycle === "T1"
            ? `买入成交 ${lots} 手（${quantity} 股），下一交易日可卖`
            : `${side === "BUY" ? "买入" : "卖出"}成交 ${lots} 手（${quantity} 股）`,
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "交易失败",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="trade-ticket">
      <div className="panel-title-row">
        <div>
          <span className="eyebrow">ORDER · MARKET</span>
          <h3>市价交易</h3>
        </div>
        <span className="simulation-chip">
          {mode === "REAL" ? "真实价 · " : ""}
          {item.instrument.settlementCycle}
        </span>
      </div>

      <div className="ticket-stock">
        <div>
          <span>
            {marketLabel(item.instrument.market)} · {item.instrument.symbol}
          </span>
          <strong>{item.instrument.name}</strong>
        </div>
        <div className="ticket-price">
          <strong>
            {formatQuoteMoney(
              item.quote.currentPrice,
              item.quote.quoteCurrency,
              displayCurrency,
            )}
          </strong>
          <span className={signedClass(item.quote.changePercent)}>
            {formatPercent(item.quote.changePercent)}
          </span>
        </div>
      </div>

      <div className="trade-side-switch">
        <button
          className={side === "BUY" ? "active buy" : ""}
          type="button"
          onClick={() => changeSide("BUY")}
        >
          买入
        </button>
        <button
          className={side === "SELL" ? "active sell" : ""}
          type="button"
          onClick={() => changeSide("SELL")}
        >
          卖出
        </button>
      </div>

      <form onSubmit={submit}>
        <div className="quantity-heading">
          <label htmlFor="trade-lots">手数（手）</label>
          <span>
            1 手 = {item.instrument.lotSize} 股
          </span>
        </div>
        <div className="quantity-control">
          <button
            type="button"
            aria-label="减少手数"
            onClick={() => changeLots(-1)}
          >
            −
          </button>
          <input
            id="trade-lots"
            aria-label="交易手数"
            inputMode="numeric"
            min={1}
            step={1}
            type="number"
            value={lots}
            onChange={(event) => {
              const next = Number(event.target.value);

              if (Number.isFinite(next)) {
                setLots(Math.max(1, Math.floor(next)));
                setNotice(null);
              }
            }}
          />
          <button
            type="button"
            aria-label="增加手数"
            onClick={() => changeLots(1)}
          >
            +
          </button>
        </div>

        <div className="trade-percentage-row">
          <span>
            {side === "BUY" ? "使用可用资金" : "卖出可卖持仓"}
          </span>
          <div>
            {PERCENTAGES.map((percent) => (
              <button
                key={percent}
                type="button"
                onClick={() => applyPercentage(percent)}
              >
                {percent}%
              </button>
            ))}
          </div>
        </div>

        <div className="lot-conversion">
          本次 {lots} 手，共 {quantity.toLocaleString("zh-CN")} 股
        </div>

        <dl className="ticket-summary">
          <div>
            <dt>{side === "BUY" ? "预计扣款" : "预计到账"}</dt>
            <dd>
              {formatMoney(
                estimatedSettlementUsd,
                displayCurrency,
              )}
            </dd>
          </div>
          <div>
            <dt>预计手续费</dt>
            <dd>{formatMoney(estimatedFeeUsd, displayCurrency)}</dd>
          </div>
          <div>
            <dt>可用资金</dt>
            <dd>
              {portfolio
                ? formatMoney(
                    portfolio.availableCashUsd,
                    displayCurrency,
                  )
                : "注册后查看"}
            </dd>
          </div>
          <div>
            <dt>持仓 / 可卖</dt>
            <dd>
              {position?.quantity ?? 0} /{" "}
              {position?.availableQuantity ?? 0} 股
            </dd>
          </div>
        </dl>

        {insufficientCash ? (
          <div className="inline-notice error">可用资金不足</div>
        ) : null}
        {insufficientPosition ? (
          <div className="inline-notice error">
            可卖持仓不足
            {item.instrument.settlementCycle === "T1"
              ? "，当日买入部分尚未结算"
              : ""}
          </div>
        ) : null}
        {notice ? (
          <div className={`inline-notice ${notice.kind}`}>
            {notice.text}
          </div>
        ) : null}

        <button
          className={`trade-submit ${side === "BUY" ? "buy" : "sell"}`}
          disabled={
            submitting ||
            !Number.isSafeInteger(lots) ||
            !Number.isSafeInteger(quantity) ||
            lots < 1 ||
            insufficientCash ||
            insufficientPosition
          }
          type="submit"
        >
          {!authenticated
            ? "注册或登录后交易"
            : submitting
              ? "正在撮合…"
              : `确认${side === "BUY" ? "买入" : "卖出"} · 市价`}
        </button>
      </form>

      <p className="transaction-note">
        {mode === "REAL"
          ? "行情来自真实市场；资金、持仓与成交只写入独立模拟账本，不会连接券商。"
          : "虚拟盘遵循统一撮合、手续费、整手和 T+0/T+1 规则。"}
      </p>
    </section>
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
