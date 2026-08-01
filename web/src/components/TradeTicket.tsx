import {
  MINIMUM_TRADE_FEE_USD,
  maximumAffordableLots,
  quotePriceToUsd,
  VIRTUAL_TRADE_FEE_RATE,
  type DisplayCurrency,
  type MarketItem,
  type MarketMode,
  type OrderMode,
  type OrderSubmissionResult,
  type PortfolioSnapshot,
  type TradeSide,
} from "@gupiaomoniqi/shared";
import {
  type FormEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { submitOrder } from "../api";
import {
  formatMoney,
  formatPercent,
  formatQuoteMoney,
  signedClass,
} from "../format";
import {
  displayPriceToQuote,
  editablePrice,
  parsePositivePrice,
  reconcileLimitPriceInput,
} from "../tradeMath";

const PERCENTAGES = [25, 50, 75, 100] as const;

interface TradeTicketProps {
  item: MarketItem;
  portfolio: PortfolioSnapshot | null;
  displayCurrency: DisplayCurrency;
  authenticated: boolean;
  mode: MarketMode;
  onRequireAuth: () => void;
  onCompleted: (result: OrderSubmissionResult) => void;
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
  const [orderMode, setOrderMode] = useState<OrderMode>("MARKET");
  const [limitPriceInput, setLimitPriceInput] = useState(() =>
    reconcileLimitPriceInput({
      currentInput: "",
      userEdited: false,
      previousDisplayCurrency: displayCurrency,
      displayCurrency,
      currentQuotePrice: item.quote.currentPrice,
      quoteCurrency: item.quote.quoteCurrency,
    }),
  );
  const [limitPriceEdited, setLimitPriceEdited] = useState(false);
  const [lots, setLots] = useState(1);
  const [requestKey, setRequestKey] = useState(newRequestKey);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const previousDisplayCurrencyRef = useRef(displayCurrency);
  const previousInstrumentIdRef = useRef(item.instrument.id);
  const position = portfolio?.positions.find(
    (itemPosition) =>
      itemPosition.instrumentId === item.instrument.id,
  );
  const quantity = lots * item.instrument.lotSize;
  const parsedLimitDisplayPrice =
    orderMode === "LIMIT"
      ? parsePositivePrice(limitPriceInput)
      : null;
  const limitPriceQuote =
    parsedLimitDisplayPrice === null
      ? null
      : displayPriceToQuote(
          parsedLimitDisplayPrice,
          displayCurrency,
          item.quote.quoteCurrency,
        );
  const orderPriceUsd =
    orderMode === "MARKET"
      ? quotePriceToUsd(
          item.quote.currentPrice,
          item.quote.quoteCurrency,
        )
      : limitPriceQuote === null
        ? null
        : quotePriceToUsd(
            limitPriceQuote,
            item.quote.quoteCurrency,
          );
  const unitLotUsd = useMemo(
    () => (orderPriceUsd ?? 0) * item.instrument.lotSize,
    [item.instrument.lotSize, orderPriceUsd],
  );
  const estimatedGrossUsd = unitLotUsd * lots;
  const estimatedFeeUsd =
    orderPriceUsd === null
      ? 0
      : Math.max(
          MINIMUM_TRADE_FEE_USD,
          estimatedGrossUsd * VIRTUAL_TRADE_FEE_RATE,
        );
  const estimatedSettlementUsd =
    side === "BUY"
      ? estimatedGrossUsd + estimatedFeeUsd
      : Math.max(0, estimatedGrossUsd - estimatedFeeUsd);
  const invalidLimitPrice =
    orderMode === "LIMIT" && parsedLimitDisplayPrice === null;
  const insufficientCash =
    side === "BUY" &&
    !invalidLimitPrice &&
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

  useLayoutEffect(() => {
    if (previousInstrumentIdRef.current === item.instrument.id) {
      return;
    }

    previousInstrumentIdRef.current = item.instrument.id;
    previousDisplayCurrencyRef.current = displayCurrency;
    setLots(1);
    setOrderMode("MARKET");
    setLimitPriceEdited(false);
    setLimitPriceInput(
      reconcileLimitPriceInput({
        currentInput: "",
        userEdited: false,
        previousDisplayCurrency: displayCurrency,
        displayCurrency,
        currentQuotePrice: item.quote.currentPrice,
        quoteCurrency: item.quote.quoteCurrency,
      }),
    );
    setRequestKey(newRequestKey());
    setNotice(null);
  }, [displayCurrency, item.instrument.id, item.quote.currentPrice, item.quote.quoteCurrency]);

  useLayoutEffect(() => {
    const previousDisplayCurrency = previousDisplayCurrencyRef.current;
    previousDisplayCurrencyRef.current = displayCurrency;
    const displayCurrencyChanged =
      previousDisplayCurrency !== displayCurrency;

    if (submitting && !displayCurrencyChanged) {
      return;
    }

    const nextInput = reconcileLimitPriceInput({
      currentInput: limitPriceInput,
      userEdited: limitPriceEdited,
      previousDisplayCurrency,
      displayCurrency,
      currentQuotePrice: item.quote.currentPrice,
      quoteCurrency: item.quote.quoteCurrency,
    });

    if (nextInput === limitPriceInput) {
      return;
    }

    setLimitPriceInput(nextInput);
    setRequestKey(newRequestKey());
    if (displayCurrencyChanged) {
      setNotice(null);
    }
  }, [
    displayCurrency,
    item.quote.currentPrice,
    item.quote.quoteCurrency,
    limitPriceEdited,
    limitPriceInput,
    submitting,
  ]);

  function changed(): void {
    setRequestKey(newRequestKey());
    setNotice(null);
  }

  function changeSide(nextSide: TradeSide) {
    setSide(nextSide);
    setLots(1);
    changed();
  }

  function changeOrderMode(nextMode: OrderMode) {
    setOrderMode(nextMode);
    if (nextMode === "LIMIT" && !limitPriceEdited) {
      setLimitPriceInput(
        reconcileLimitPriceInput({
          currentInput: limitPriceInput,
          userEdited: false,
          previousDisplayCurrency: displayCurrency,
          displayCurrency,
          currentQuotePrice: item.quote.currentPrice,
          quoteCurrency: item.quote.quoteCurrency,
        }),
      );
    }
    changed();
  }

  function changeLots(direction: -1 | 1) {
    setLots((current) => Math.max(1, current + direction));
    changed();
  }

  function applyPercentage(percent: number) {
    if (!portfolio) {
      onRequireAuth();
      return;
    }

    if (side === "BUY") {
      if (invalidLimitPrice) {
        setNotice({ kind: "error", text: "请先输入有效限价" });
        return;
      }
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

    setRequestKey(newRequestKey());
    setNotice(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();

    if (!authenticated) {
      onRequireAuth();
      return;
    }
    if (
      invalidLimitPrice ||
      (orderMode === "LIMIT" && limitPriceQuote === null)
    ) {
      setNotice({ kind: "error", text: "请输入大于 0 的有效限价" });
      return;
    }

    setSubmitting(true);
    setNotice(null);

    try {
      const result = await submitOrder(
        {
          instrumentId: item.instrument.id,
          side,
          quantity,
          orderMode,
          limitPrice:
            orderMode === "LIMIT"
              ? (limitPriceQuote ?? undefined)
              : undefined,
          idempotencyKey: requestKey,
        },
        mode,
      );
      onCompleted(result);
      setRequestKey(newRequestKey());

      if (result.order.status === "OPEN") {
        setNotice({
          kind: "success",
          text: `${side === "BUY" ? "买入" : "卖出"}限价委托已挂出，等待行情触发`,
        });
      } else {
        setNotice({
          kind: "success",
          text:
            side === "BUY" &&
            item.instrument.settlementCycle === "T1"
              ? `买入成交 ${lots} 手（${quantity} 股），下一交易日可卖`
              : `${side === "BUY" ? "买入" : "卖出"}成交 ${lots} 手（${quantity} 股）`,
        });
      }
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "下单失败",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="trade-ticket">
      <div className="panel-title-row">
        <div>
          <span className="eyebrow">ORDER · {orderMode}</span>
          <h3>{orderMode === "MARKET" ? "市价交易" : "限价委托"}</h3>
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

      <div className="order-mode-switch" aria-label="订单类型">
        <button
          className={orderMode === "MARKET" ? "active" : ""}
          type="button"
          onClick={() => changeOrderMode("MARKET")}
        >
          市价
        </button>
        <button
          className={orderMode === "LIMIT" ? "active" : ""}
          type="button"
          onClick={() => changeOrderMode("LIMIT")}
        >
          限价
        </button>
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
        {orderMode === "LIMIT" ? (
          <div className="limit-price-block">
            <div className="quantity-heading">
              <label htmlFor="trade-limit-price">委托价格</label>
              <span>以当前显示币种输入</span>
            </div>
            <div
              className={`limit-price-control ${invalidLimitPrice ? "invalid" : ""}`}
            >
              <input
                id="trade-limit-price"
                aria-invalid={invalidLimitPrice}
                aria-label={`限价（${displayCurrency}）`}
                inputMode="decimal"
                min="0.0001"
                step="0.0001"
                type="number"
                value={limitPriceInput}
                onChange={(event) => {
                  setLimitPriceInput(event.target.value);
                  setLimitPriceEdited(true);
                  changed();
                }}
              />
              <span>{displayCurrency}</span>
            </div>
          </div>
        ) : null}

        <div className="quantity-heading">
          <label htmlFor="trade-lots">手数（手）</label>
          <span>1 手 = {item.instrument.lotSize} 股</span>
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
                changed();
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
          <span>{side === "BUY" ? "使用可用资金" : "卖出可卖持仓"}</span>
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
            <dt>
              {orderMode === "LIMIT"
                ? side === "BUY"
                  ? "预计冻结"
                  : "预计成交净额"
                : side === "BUY"
                  ? "预计扣款"
                  : "预计到账"}
            </dt>
            <dd>
              {invalidLimitPrice
                ? "—"
                : formatMoney(estimatedSettlementUsd, displayCurrency)}
            </dd>
          </div>
          <div>
            <dt>预计手续费</dt>
            <dd>
              {invalidLimitPrice
                ? "—"
                : formatMoney(estimatedFeeUsd, displayCurrency)}
            </dd>
          </div>
          <div>
            <dt>可用 / 冻结资金</dt>
            <dd>
              {portfolio
                ? `${formatMoney(portfolio.availableCashUsd, displayCurrency)} / ${formatMoney(portfolio.frozenCashUsd, displayCurrency)}`
                : "注册后查看"}
            </dd>
          </div>
          <div>
            <dt>持仓 / 可卖 / 冻结</dt>
            <dd>
              {position?.quantity ?? 0} / {position?.availableQuantity ?? 0} /{" "}
              {position?.frozenQuantity ?? 0} 股
            </dd>
          </div>
        </dl>

        {invalidLimitPrice ? (
          <div className="inline-notice error">请输入大于 0 的有效限价</div>
        ) : null}
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
          <div className={`inline-notice ${notice.kind}`}>{notice.text}</div>
        ) : null}

        <button
          className={`trade-submit ${side === "BUY" ? "buy" : "sell"}`}
          disabled={
            submitting ||
            !Number.isSafeInteger(lots) ||
            !Number.isSafeInteger(quantity) ||
            lots < 1 ||
            invalidLimitPrice ||
            insufficientCash ||
            insufficientPosition
          }
          type="submit"
        >
          {!authenticated
            ? "注册或登录后交易"
            : submitting
              ? orderMode === "MARKET"
                ? "正在撮合…"
                : "正在提交委托…"
              : `${orderMode === "MARKET" ? "确认" : "提交"}${side === "BUY" ? "买入" : "卖出"} · ${orderMode === "MARKET" ? "市价" : "限价"}`}
        </button>
      </form>

      <p className="transaction-note">
        {orderMode === "LIMIT"
          ? "限价委托会冻结对应资金或可卖持仓，可在账户页撤单。"
          : mode === "REAL"
            ? "行情来自真实市场；资金、持仓与成交只写入独立模拟账本。"
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

function newRequestKey(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
