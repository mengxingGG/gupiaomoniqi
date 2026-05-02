import { useState } from 'react'
import { useMarketStore, type StockData } from '../../store/useMarketStore'
import { useUIStore } from '../../store/useUIStore'

interface StockListProps {
  stocks: StockData[]
  onSelect?: (stock: StockData) => void
}

type SortMode = 'none' | 'up' | 'down'

export default function StockList({ stocks, onSelect }: StockListProps) {
  const { selectStock, selectedStock } = useMarketStore()
  const { searchQuery, setSearchQuery } = useUIStore()
  const [sortMode, setSortMode] = useState<SortMode>('none')

  const filtered = stocks
    .filter(s => s.code.includes(searchQuery) || s.name.includes(searchQuery))
    .sort((a, b) => {
      if (sortMode === 'up') return b.changePercent - a.changePercent
      if (sortMode === 'down') return a.changePercent - b.changePercent
      return 0
    })

  const up = (n: number) => n >= 0
  const fmt = (n: number) => n.toFixed(2)

  const handleClick = (stock: StockData) => {
    selectStock(stock)
    onSelect?.(stock)
  }

  const toggleSort = (mode: SortMode) => {
    setSortMode(sortMode === mode ? 'none' : mode)
  }

  return (
    <div className="flex flex-col h-full text-xs">
      {/* 搜索栏 */}
      <div className="px-2 py-1.5 border-b border-gray-100 dark:border-gray-700">
        <input
          type="text" value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="搜索代码/名称..."
          className="w-full px-2 py-1 border border-gray-200 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-200 text-xs"
        />
      </div>

      {/* 表头 */}
      <div className="grid grid-cols-3 px-2 py-1 text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-700/30 border-b border-gray-100 dark:border-gray-700">
        <span>名称/代码</span>
        <span className="text-right">现价</span>
        <button
          onClick={() => toggleSort(sortMode === 'up' ? 'down' : 'up')}
          className={`text-right flex items-center justify-end gap-1 hover:text-gray-600 dark:hover:text-gray-300 ${
            sortMode !== 'none' ? 'text-primary' : ''
          }`}
        >
          涨跌幅
          {sortMode === 'up' && <span>↑</span>}
          {sortMode === 'down' && <span>↓</span>}
        </button>
      </div>

      {/* 股票列表 */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-gray-400">暂无数据</div>
        ) : (
          filtered.map(stock => {
            const isActive = selectedStock?.code === stock.code
            const changeUp = up(stock.changePercent)
            return (
              <button
                key={stock.code}
                onClick={() => handleClick(stock)}
                className={`w-full grid grid-cols-3 px-2 py-1.5 text-left border-b border-gray-50 dark:border-gray-700/50 transition-colors ${
                  isActive
                    ? 'bg-primary/10 dark:bg-primary/20'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                }`}
              >
                <div className="min-w-0">
                  <div className={`font-medium truncate ${isActive ? 'text-primary' : 'text-gray-800 dark:text-gray-200'}`}>
                    {stock.name}
                  </div>
                  <div className="text-gray-400 dark:text-gray-500 font-mono">{stock.code}</div>
                </div>
                <div className={`text-right self-center font-number tabular-nums font-medium ${changeUp ? 'text-up' : 'text-down'}`}>
                  {fmt(stock.currentPrice)}
                </div>
                <div className={`text-right self-center ${changeUp ? 'bg-up/10 text-up' : 'bg-down/10 text-down'} font-number tabular-nums rounded px-1`}>
                  {changeUp ? '+' : ''}{fmt(stock.changePercent)}%
                </div>
              </button>
            )
          })
        )}
      </div>

      {/* 底部统计 */}
      <div className="px-2 py-1 text-gray-400 border-t border-gray-100 dark:border-gray-700">
        共 {filtered.length} 只
      </div>
    </div>
  )
}
