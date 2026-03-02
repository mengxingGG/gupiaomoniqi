import { useMemo, useState } from 'react'
import { useGameStore } from '../../store/useGameStore'
import { useMarketStore } from '../../store/useMarketStore'
import PositionItem from './PositionItem'

type SortField = 'stockCode' | 'quantity' | 'totalCost' | 'profit' | 'profitPercent'
type SortOrder = 'asc' | 'desc'

export default function PositionList() {
  const { positions } = useGameStore()
  const { stocks } = useMarketStore()
  const [sortField, setSortField] = useState<SortField>('stockCode')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')

  // 获取持仓对应的股票信息并计算盈亏
  const positionsWithStock = useMemo(() => {
    return positions.map((position) => {
      const stock = stocks.find((s) => s.code === position.stockCode)
      const currentValue = stock ? stock.currentPrice * position.quantity : position.totalCost
      const profit = currentValue - position.totalCost
      const profitPercent = position.totalCost > 0 ? (profit / position.totalCost) * 100 : 0

      return {
        ...position,
        stock: stock as any,
        currentValue,
        profit,
        profitPercent,
      }
    })
  }, [positions, stocks])

  // 排序
  const sortedPositions = useMemo(() => {
    const sorted = [...positionsWithStock]
    sorted.sort((a, b) => {
      let aVal: number | string
      let bVal: number | string

      switch (sortField) {
        case 'stockCode':
          aVal = a.stockCode
          bVal = b.stockCode
          break
        case 'quantity':
          aVal = a.quantity
          bVal = b.quantity
          break
        case 'totalCost':
          aVal = a.totalCost
          bVal = b.totalCost
          break
        case 'profit':
          aVal = a.profit
          bVal = b.profit
          break
        case 'profitPercent':
          aVal = a.profitPercent
          bVal = b.profitPercent
          break
        default:
          return 0
      }

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortOrder === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal)
      }

      return sortOrder === 'asc'
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number)
    })

    return sorted
  }, [positionsWithStock, sortField, sortOrder])

  // 统计信息
  const stats = useMemo(() => {
    const totalCost = positionsWithStock.reduce((sum, p) => sum + p.totalCost, 0)
    const totalValue = positionsWithStock.reduce((sum, p) => sum + p.currentValue, 0)
    const totalProfit = totalValue - totalCost
    const totalProfitPercent = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0

    return {
      count: positions.length,
      totalCost,
      totalValue,
      totalProfit,
      totalProfitPercent,
    }
  }, [positionsWithStock])

  // 切换排序
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortOrder('desc')
    }
  }

  // 排序按钮样式
  const getSortButtonClass = (field: SortField) => {
    const base = 'px-2 py-1 text-xs rounded '
    if (sortField !== field) {
      return base + 'bg-gray-100 dark:bg-gray-700 text-gray-500'
    }
    return base + (sortOrder === 'asc' ? 'bg-primary text-white' : 'bg-primary text-white')
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg w-full max-w-md mx-auto">
      {/* 头部 */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <span className="text-2xl">💼</span>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">我的持仓</h2>
        </div>
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {stats.count} 只
        </div>
      </div>

      {/* 统计 */}
      <div className="grid grid-cols-2 gap-2 p-3 bg-gray-50 dark:bg-gray-700 text-xs">
        <div>
          <div className="text-gray-500">持仓成本</div>
          <div className="font-bold text-gray-900 dark:text-white font-number">
            ¥{stats.totalCost.toLocaleString()}
          </div>
        </div>
        <div>
          <div className="text-gray-500">持仓市值</div>
          <div className="font-bold text-gray-900 dark:text-white font-number">
            ¥{stats.totalValue.toLocaleString()}
          </div>
        </div>
        <div className="col-span-2">
          <div className="text-gray-500">持仓盈亏</div>
          <div className={`font-bold font-number ${stats.totalProfit >= 0 ? 'text-up' : 'text-down'}`}>
            {stats.totalProfit >= 0 ? '+' : ''}¥{stats.totalProfit.toLocaleString()} ({stats.totalProfitPercent.toFixed(2)}%)
          </div>
        </div>
      </div>

      {/* 排序选项 */}
      <div className="flex gap-1 p-2 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
        <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">排序:</span>
        <button onClick={() => handleSort('stockCode')} className={getSortButtonClass('stockCode')}>
          代码
        </button>
        <button onClick={() => handleSort('quantity')} className={getSortButtonClass('quantity')}>
          数量
        </button>
        <button onClick={() => handleSort('totalCost')} className={getSortButtonClass('totalCost')}>
          成本
        </button>
        <button onClick={() => handleSort('profit')} className={getSortButtonClass('profit')}>
          盈亏
        </button>
      </div>

      {/* 持仓列表 */}
      <div className="max-h-80 overflow-auto">
        {sortedPositions.length === 0 ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">
            暂无持仓
          </div>
        ) : (
          sortedPositions.map((position) => (
            <PositionItem
              key={position.id}
              position={position}
            />
          ))
        )}
      </div>
    </div>
  )
}
