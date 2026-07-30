import type {
  DisplayCurrency,
  OrderBookSnapshot,
} from "@gupiaomoniqi/shared";
import { formatNumber, formatQuoteMoney } from "../format";

interface OrderBookPanelProps {
  orderBook: OrderBookSnapshot;
  displayCurrency: DisplayCurrency;
}

export function OrderBookPanel({
  orderBook,
  displayCurrency,
}: OrderBookPanelProps) {
  const maximumQuantity = Math.max(
    1,
    ...orderBook.asks.map((level) => level.quantity),
    ...orderBook.bids.map((level) => level.quantity),
  );

  if (orderBook.available === false) {
    return (
      <section className="detail-panel order-book-panel">
        <div className="panel-title-row">
          <div>
            <span className="eyebrow">ORDER BOOK</span>
            <h3>五档盘口</h3>
          </div>
          <span className="simulation-chip">暂不可用</span>
        </div>
        <div className="order-book-unavailable">
          <strong>没有可验证的真实盘口数据</strong>
          <p>{orderBook.notice}</p>
        </div>
      </section>
    );
  }

  const bestAsk = orderBook.asks[orderBook.asks.length - 1];
  const bestBid = orderBook.bids[0];
  const spread =
    bestAsk && bestBid ? Math.max(0, bestAsk.price - bestBid.price) : null;

  return (
    <section className="detail-panel order-book-panel">
      <div className="panel-title-row">
        <div>
          <span className="eyebrow">ORDER BOOK</span>
          <h3>五档盘口</h3>
        </div>
        <span className="simulation-chip real-chip">真实盘口</span>
      </div>

      <div className="order-book-heading">
        <span>档位</span>
        <span>价格</span>
        <span>数量</span>
      </div>

      <div className="order-book-side asks">
        {[...orderBook.asks].reverse().map((level, index) => (
          <OrderLevel
            key={level.price}
            label={`卖 ${orderBook.asks.length - index}`}
            level={level}
            maximumQuantity={maximumQuantity}
            quoteCurrency={orderBook.quoteCurrency}
            displayCurrency={displayCurrency}
            kind="ask"
          />
        ))}
      </div>

      <div className="order-book-midline">
        <span>
          点差{" "}
          {spread === null
            ? "--"
            : formatQuoteMoney(
                spread,
                orderBook.quoteCurrency,
                displayCurrency,
                { decimals: spread < 1 ? 4 : 2 },
              )}
        </span>
        <span>更新 {formatOrderBookTime(orderBook.updatedAt)}</span>
      </div>

      <div className="order-book-side bids">
        {orderBook.bids.map((level, index) => (
          <OrderLevel
            key={level.price}
            label={`买 ${index + 1}`}
            level={level}
            maximumQuantity={maximumQuantity}
            quoteCurrency={orderBook.quoteCurrency}
            displayCurrency={displayCurrency}
            kind="bid"
          />
        ))}
      </div>
    </section>
  );
}

function formatOrderBookTime(updatedAt: string): string {
  const value = new Date(updatedAt);
  return value.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function OrderLevel({
  label,
  level,
  maximumQuantity,
  quoteCurrency,
  displayCurrency,
  kind,
}: {
  label: string;
  level: OrderBookSnapshot["asks"][number];
  maximumQuantity: number;
  quoteCurrency: OrderBookSnapshot["quoteCurrency"];
  displayCurrency: DisplayCurrency;
  kind: "ask" | "bid";
}) {
  return (
    <div className={`order-level ${kind}`}>
      <span
        className="depth-bar"
        style={{
          width: `${Math.max(3, (level.quantity / maximumQuantity) * 100)}%`,
        }}
      />
      <span>{label}</span>
      <strong>
        {formatQuoteMoney(
          level.price,
          quoteCurrency,
          displayCurrency,
          { decimals: level.price < 1 ? 4 : 2 },
        )}
      </strong>
      <span>{formatNumber(level.quantity, { compact: true })}</span>
    </div>
  );
}
