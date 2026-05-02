import { useMemo } from 'react'
import { useGameStore } from '../../store/useGameStore'
import { useMarketStore } from '../../store/useMarketStore'
import { useAuthStore } from '../../store/useAuthStore'

export default function AssetOverview() {
  const { positions } = useGameStore()
  const { stocks } = useMarketStore()
  const { player } = useAuthStore()

  // 计算资产概览
  const overview = useMemo(() => {
    if (!player) return null

    // 计算持仓市值
    let positionsValue = 0
    let positionsCost = 0
    positions.forEach((position) => {
      const stock = stocks.find((s) => s.code === position.stockCode)
      const value = stock ? stock.currentPrice * position.quantity : position.totalCost
      positionsValue += value
      positionsCost += position.totalCost
    })

    // 计算总资产
    const totalAssets = player.cash + positionsValue

    // 计算盈亏
    const totalProfit = positionsValue - positionsCost
    const profitPercent = positionsCost > 0 ? (totalProfit / positionsCost) * 100 : 0

    // 计算持仓占比
    const positionRatio = totalAssets > 0 ? (positionsValue / totalAssets) * 100 : 0
    const cashRatio = totalAssets > 0 ? (player.cash / totalAssets) * 100 : 0

    // 初始资金收益率
    const initialProfit = totalAssets - player.initialCash
    const initialProfitPercent = (initialProfit / player.initialCash) * 100

    return {
      cash: player.cash,
      positionsValue,
      positionsCost,
      totalAssets,
      totalProfit,
      profitPercent,
      positionRatio,
      cashRatio,
      initialProfit,
      initialProfitPercent,
      initialCash: player.initialCash,
    }
  }, [player, positions, stocks])

  if (!overview) {
    return (
      <div className="p-4 text-center text-gray-500">
        加载中...
      </div>
    )
  }

  // 格式化金额
  const formatMoney = (amount: number) => {
    if (Math.abs(amount) >= 10000) {
      return `¥${(amount / 10000).toFixed(1)}万`
    }
    return `¥${amount.toLocaleString()}`
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg w-full max-w-md mx-auto">
      {/* 头部 */}
      <div className="flex items-center gap-2 p-4 border-b border-gray-200 dark:border-gray-700">
        <span className="text-2xl">📊</span>
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">资产概览</h2>
      </div>

      {/* 总资产 */}
      <div className="p-4 bg-gradient-to-r from-blue-500 to-purple-600 text-white">
        <div className="text-sm opacity-80">总资产</div>
        <div className="text-3xl font-bold font-number mt-1">
          {formatMoney(overview.totalAssets)}
        </div>
        <div className={`text-sm mt-1 ${overview.initialProfit >= 0 ? 'text-green-200' : 'text-red-200'}`}>
          {overview.initialProfit >= 0 ? '+' : ''}{formatMoney(overview.initialProfit)} ({overview.initialProfitPercent.toFixed(2)}%)
        </div>
      </div>

      {/* 资产分布 */}
      <div className="p-4">
        <div className="mb-3">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-600 dark:text-gray-400">资金占比</span>
            <span className="font-number">{overview.cashRatio.toFixed(1)}%</span>
          </div>
          <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${overview.cashRatio}%` }}
            />
          </div>
        </div>

        <div className="mb-4">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-600 dark:text-gray-400">持仓占比</span>
            <span className="font-number">{overview.positionRatio.toFixed(1)}%</span>
          </div>
          <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-purple-500 transition-all duration-300"
              style={{ width: `${overview.positionRatio}%` }}
            />
          </div>
        </div>

        {/* 明细 */}
        <div className="grid grid-cols-2 gap-4">
          <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">可用资金</div>
            <div className="font-bold text-gray-900 dark:text-white font-number">
              {formatMoney(overview.cash)}
            </div>
          </div>
          <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">持仓市值</div>
            <div className="font-bold text-gray-900 dark:text-white font-number">
              {formatMoney(overview.positionsValue)}
            </div>
          </div>
          <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">持仓成本</div>
            <div className="font-bold text-gray-900 dark:text-white font-number">
              {formatMoney(overview.positionsCost)}
            </div>
          </div>
          <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">持仓盈亏</div>
            <div className={`font-bold font-number ${overview.totalProfit >= 0 ? 'text-up' : 'text-down'}`}>
              {overview.totalProfit >= 0 ? '+' : ''}{formatMoney(overview.totalProfit)}
            </div>
          </div>
        </div>

        {/* 初始资金 */}
        <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
          <div className="flex justify-between items-center">
            <div className="text-sm text-gray-600 dark:text-gray-400">初始资金</div>
            <div className="font-number text-gray-900 dark:text-white">
              {formatMoney(overview.initialCash)}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
