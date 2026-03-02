import { useState } from 'react'
import { useMarketStore } from '../store/useMarketStore'
import { MarketType } from '../core/models/Stock'
import type { StockData } from '../store/useMarketStore'
import StockDetail from '../components/market/StockDetail'
import TradePanel from '../components/trade/TradePanel'
import OrderBook from '../components/market/OrderBook'
import StockList from '../components/market/StockList'

const MARKETS = [
  { value: 'ALL', label: '全部' },
  { value: MarketType.A_SHARE_T1, label: 'A股' },
  { value: MarketType.GEM_T1, label: '创业板' },
  { value: MarketType.STAR_T1, label: '科创板' },
  { value: MarketType.HK_STOCK_T0, label: '港股' },
  { value: MarketType.US_STOCK_T0, label: '美股' },
]

export default function TradingPage() {
  const { stocks, marketType, setMarketType, selectedStock, selectStock } = useMarketStore()
  const [tradePriceOverride, setTradePriceOverride] = useState<number | null>(null)

  const filtered = stocks.filter(s =>
    marketType === 'ALL' || s.market === marketType
  )

  const handleStockSelect = (stock: StockData) => {
    selectStock(stock)
    setTradePriceOverride(null)
  }

  const handleOrderBookPriceClick = (price: number) => {
    setTradePriceOverride(price)
  }

  return (
    <div className="flex h-full overflow-hidden bg-gray-100 dark:bg-gray-900 gap-px">
      {/* === 左栏：市场切换 + 股票列表 === */}
      <div className="w-56 shrink-0 flex flex-col bg-white dark:bg-gray-800">
        {/* 市场切换 */}
        <div className="flex flex-wrap gap-0.5 p-1.5 border-b border-gray-100 dark:border-gray-700">
          {MARKETS.map(m => (
            <button
              key={m.value}
              onClick={() => setMarketType(m.value)}
              className={`px-2 py-0.5 text-xs rounded transition-colors ${
                marketType === m.value
                  ? 'bg-primary text-white font-medium'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        {/* 股票列表 */}
        <div className="flex-1 overflow-hidden">
          <StockList stocks={filtered} onSelect={handleStockSelect} />
        </div>
      </div>

      {/* === 中栏：股票详情 + 图表 === */}
      <div className="flex-1 flex flex-col min-w-0 bg-white dark:bg-gray-800">
        {selectedStock ? (
          <div className="h-full overflow-auto">
            <StockDetail stock={selectedStock} />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-gray-500 text-sm">
            <div className="text-center">
              <div className="text-4xl mb-2">📊</div>
              <div>从左侧选择一只股票</div>
              <div className="text-xs mt-1 text-gray-300">查看行情详情并进行交易</div>
            </div>
          </div>
        )}
      </div>

      {/* === 右栏：买卖盘 + 交易面板 === */}
      <div className="w-52 shrink-0 flex flex-col bg-white dark:bg-gray-800">
        {selectedStock ? (
          <>
            {/* 买卖5档 */}
            <div className="border-b border-gray-100 dark:border-gray-700">
              <div className="px-2 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50">
                买卖盘口
              </div>
              <OrderBook
                stock={selectedStock}
                onPriceClick={handleOrderBookPriceClick}
              />
            </div>
            {/* 交易面板 */}
            <div className="flex-1 overflow-auto">
              <TradePanel
                stock={selectedStock}
                compact
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-300 dark:text-gray-600 text-xs text-center px-4">
            选择股票后可在此交易
          </div>
        )}
      </div>
    </div>
  )
}
