import { useState, useEffect, useRef } from 'react'
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
  const { stocks, marketType, setMarketType, selectedStock, selectStock, fetchStockDetail, clearStockDetail } = useMarketStore()
  const [tradePriceOverride, setTradePriceOverride] = useState<number | null>(null)
  const prevStockCodeRef = useRef<string | null>(null)

  const filtered = stocks.filter(s =>
    marketType === 'ALL' || s.market === marketType
  )

  // 当切换股票时，清理旧股票数据，释放内存
  useEffect(() => {
    return () => {
      // 组件卸载时清理
      clearStockDetail()
    }
  }, [clearStockDetail])

  // 当选中新股票时，先清理旧股票的大数据
  useEffect(() => {
    if (selectedStock && prevStockCodeRef.current && prevStockCodeRef.current !== selectedStock.code) {
      // 切换了股票，旧数据会在新数据加载时自动覆盖
    }
    prevStockCodeRef.current = selectedStock?.code || null
  }, [selectedStock?.code])

  const handleStockSelect = async (stock: StockData) => {
    selectStock(stock)
    setTradePriceOverride(null)
    // 加载该股票的详细数据（按需加载，只取需要的条数）
    await fetchStockDetail(stock.code)
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

      {/* === 中间栏：股票详情（上方55%）+ 买卖盘和交易面板（下方45%）=== */}
      <div className="flex-1 flex flex-col min-w-0 bg-white dark:bg-gray-800">
        {selectedStock ? (
          <>
            {/* 上方55%：股票详情和图表 */}
            <div className="h-[55%] overflow-hidden">
              <StockDetail stock={selectedStock} />
            </div>
            
            {/* 下方45%：买卖盘 + 交易面板 */}
            <div className="h-[45%] border-t border-gray-100 dark:border-gray-700 flex flex-col overflow-hidden">
              {/* 买卖盘（上方45%，缩小约3%）*/}
              <div className="h-[45%] overflow-hidden border-b border-gray-100 dark:border-gray-700">
                <div className="px-2 py-1 text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50">
                  买卖盘口
                </div>
                <OrderBook
                  stock={selectedStock}
                  onPriceClick={handleOrderBookPriceClick}
                />
              </div>
              {/* 交易面板（下方55%，扩大约3%）*/}
              <div className="h-[55%] overflow-auto">
                <TradePanel stock={selectedStock} compact />
              </div>
            </div>
          </>
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
    </div>
  )
}
