import type { StockData as Stock } from '../../store/useMarketStore'

interface OrderBookProps {
  stock: Stock
  onPriceClick?: (price: number) => void
}

// 基于价格生成伪随机数（确定性，价格变化时刷新）
function prand(seed: number, i: number): number {
  const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453
  return Math.abs(x - Math.floor(x))
}

function generateOrderBook(stock: Stock) {
  const price = stock.currentPrice
  const tick = price >= 500 ? 1 : price >= 100 ? 0.1 : 0.01
  const seed = Math.round(price * 100)
  const volBase = Math.max(1000, stock.volume / 200)

  // 买卖盘量随涨跌方向倾斜
  const bullish = stock.changePercent > 0
  const buyBias = bullish ? 1.4 : 0.8
  const sellBias = bullish ? 0.8 : 1.4

  const asks = Array.from({ length: 5 }, (_, i) => {
    const level = 5 - i // 卖五→卖一
    return {
      label: `卖${['五','四','三','二','一'][i]}`,
      price: Math.round((price + level * tick) * 100) / 100,
      volume: Math.round((prand(seed, i + 10) * volBase + volBase * 0.5) * sellBias / 100) * 100,
    }
  })

  const bids = Array.from({ length: 5 }, (_, i) => ({
    label: `买${['一','二','三','四','五'][i]}`,
    price: Math.round((price - (i + 1) * tick) * 100) / 100,
    volume: Math.round((prand(seed, i + 20) * volBase + volBase * 0.5) * buyBias / 100) * 100,
  }))

  return { asks, bids }
}

function fmtVol(v: number): string {
  if (v >= 100000000) return (v / 100000000).toFixed(1) + '亿'
  if (v >= 10000) return (v / 10000).toFixed(0) + '万'
  return v.toLocaleString()
}

export default function OrderBook({ stock, onPriceClick }: OrderBookProps) {
  const { asks, bids } = generateOrderBook(stock)
  const up = stock.changePercent >= 0

  return (
    <div className="text-xs select-none">
      {/* 卖盘 (倒序显示：卖五在上) */}
      <div className="mb-0.5">
        {asks.map((ask) => (
          <div
            key={ask.label}
            className="grid grid-cols-3 px-2 py-0.5 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
            onClick={() => onPriceClick?.(ask.price)}
          >
            <span className="text-gray-400 dark:text-gray-500">{ask.label}</span>
            <span className="text-center text-down font-number tabular-nums">{ask.price.toFixed(2)}</span>
            <span className="text-right text-gray-500 dark:text-gray-400 font-number tabular-nums">{fmtVol(ask.volume)}</span>
          </div>
        ))}
      </div>

      {/* 当前价格行 */}
      <div className={`grid grid-cols-3 px-2 py-1 border-y border-gray-200 dark:border-gray-600 ${up ? 'bg-red-50 dark:bg-red-900/10' : 'bg-green-50 dark:bg-green-900/10'}`}>
        <span className="text-gray-500 dark:text-gray-400">最新</span>
        <span className={`text-center font-bold font-number tabular-nums ${up ? 'text-up' : 'text-down'}`}>
          {stock.currentPrice.toFixed(2)}
        </span>
        <span className={`text-right font-number tabular-nums text-xs ${up ? 'text-up' : 'text-down'}`}>
          {up ? '+' : ''}{stock.changePercent.toFixed(2)}%
        </span>
      </div>

      {/* 买盘 */}
      <div className="mt-0.5">
        {bids.map((bid) => (
          <div
            key={bid.label}
            className="grid grid-cols-3 px-2 py-0.5 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
            onClick={() => onPriceClick?.(bid.price)}
          >
            <span className="text-gray-400 dark:text-gray-500">{bid.label}</span>
            <span className="text-center text-up font-number tabular-nums">{bid.price.toFixed(2)}</span>
            <span className="text-right text-gray-500 dark:text-gray-400 font-number tabular-nums">{fmtVol(bid.volume)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
