import { useState, useMemo } from 'react'
import { useGameStore } from '../store/useGameStore'
import { useMarketStore } from '../store/useMarketStore'
import { useAuthStore } from '../store/useAuthStore'
import { getMarketGroup, getMarketName } from '../core/models/Stock'
import type { StockData } from '../store/useMarketStore'
import TradePanel from '../components/trade/TradePanel'
import Modal from '../components/common/Modal'

export default function PortfolioPage() {
  const { positions } = useGameStore()
  const { stocks } = useMarketStore()
  const { player } = useAuthStore()
  const [tradeTarget, setTradeTarget] = useState<{ stock: StockData; type: 'BUY' | 'SELL' } | null>(null)

  // 持仓计算
  const items = useMemo(() => positions.map(pos => {
    const stock = stocks.find(s => s.code === pos.stockCode)
    const price = stock?.currentPrice ?? pos.averageCost
    const value = price * pos.quantity
    const profit = value - pos.totalCost
    const profitPct = pos.totalCost > 0 ? (profit / pos.totalCost) * 100 : 0
    const locked = pos.quantity - pos.availableQuantity
    const isT0 = getMarketGroup(pos.market as any) === 'T0'
    return { ...pos, stock, price, value, profit, profitPct, locked, isT0 }
  }), [positions, stocks])

  // 汇总
  const summary = useMemo(() => {
    const totalCost = items.reduce((s, p) => s + p.totalCost, 0)
    const totalValue = items.reduce((s, p) => s + p.value, 0)
    const totalProfit = totalValue - totalCost
    const profitPct = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0
    return { totalCost, totalValue, totalProfit, profitPct }
  }, [items])

  const fmtMoney = (n: number) => '¥' + n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const fmtPct = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2) + '%'
  const up = (n: number) => n >= 0

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-900 overflow-hidden">
      {/* 页面标题 */}
      <div className="px-4 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-base font-bold text-gray-900 dark:text-white">💼 我的持仓</h2>
      </div>

      {/* 资产摘要卡 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div>
          <div className="text-xs text-gray-400">可用资金</div>
          <div className="font-bold text-sm font-number tabular-nums text-blue-600">
            {fmtMoney(player?.cash ?? 0)}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-400">持仓市值</div>
          <div className="font-bold text-sm font-number tabular-nums text-gray-800 dark:text-gray-200">
            {fmtMoney(summary.totalValue)}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-400">持仓成本</div>
          <div className="font-bold text-sm font-number tabular-nums text-gray-800 dark:text-gray-200">
            {fmtMoney(summary.totalCost)}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-400">持仓盈亏</div>
          <div className={`font-bold text-sm font-number tabular-nums ${up(summary.totalProfit) ? 'text-up' : 'text-down'}`}>
            {fmtMoney(summary.totalProfit)} ({fmtPct(summary.profitPct)})
          </div>
        </div>
      </div>

      {/* 持仓表格 */}
      <div className="flex-1 overflow-auto">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <div className="text-4xl mb-3">💼</div>
            <div className="text-sm">暂无持仓，去交易页面买入股票</div>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
              <tr className="text-gray-500 dark:text-gray-400">
                <th className="text-left px-3 py-2 font-medium">股票</th>
                <th className="text-right px-2 py-2 font-medium">现价</th>
                <th className="text-right px-2 py-2 font-medium">涨跌幅</th>
                <th className="text-right px-2 py-2 font-medium">持仓</th>
                <th className="text-right px-2 py-2 font-medium">可卖(T+0)</th>
                <th className="text-right px-2 py-2 font-medium text-orange-400">T+1冻结</th>
                <th className="text-right px-2 py-2 font-medium">成本价</th>
                <th className="text-right px-2 py-2 font-medium">市值</th>
                <th className="text-right px-2 py-2 font-medium">盈亏</th>
                <th className="text-right px-2 py-2 font-medium">盈亏%</th>
                <th className="text-center px-2 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {items.map(item => (
                <tr key={item.id} className="bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-3 py-2">
                    <div className="font-medium text-gray-900 dark:text-gray-100">{item.stockName}</div>
                    <div className="text-gray-400 font-mono">{item.stockCode}</div>
                    <div className="flex gap-1 mt-0.5">
                      <span className="text-[10px] px-1 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-500">
                        {getMarketName(item.market as any)}
                      </span>
                      <span className={`text-[10px] px-1 rounded ${item.isT0 ? 'bg-purple-50 text-purple-500' : 'bg-orange-50 text-orange-500'}`}>
                        {item.isT0 ? 'T+0' : 'T+1'}
                      </span>
                    </div>
                  </td>
                  <td className={`px-2 py-2 text-right font-number tabular-nums font-medium ${up(item.stock?.changePercent ?? 0) ? 'text-up' : 'text-down'}`}>
                    {item.price.toFixed(2)}
                  </td>
                  <td className={`px-2 py-2 text-right font-number tabular-nums ${up(item.stock?.changePercent ?? 0) ? 'text-up' : 'text-down'}`}>
                    {item.stock ? fmtPct(item.stock.changePercent) : '-'}
                  </td>
                  <td className="px-2 py-2 text-right font-number tabular-nums text-gray-700 dark:text-gray-300">
                    {item.quantity.toLocaleString()}
                  </td>
                  <td className="px-2 py-2 text-right font-number tabular-nums text-green-600 dark:text-green-400 font-medium">
                    {item.availableQuantity.toLocaleString()}
                  </td>
                  <td className="px-2 py-2 text-right font-number tabular-nums">
                    {item.locked > 0 ? (
                      <span className="text-orange-500">🔒{item.locked.toLocaleString()}</span>
                    ) : (
                      <span className="text-gray-300 dark:text-gray-600">-</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right font-number tabular-nums text-gray-600 dark:text-gray-400">
                    {item.averageCost.toFixed(2)}
                  </td>
                  <td className="px-2 py-2 text-right font-number tabular-nums text-gray-700 dark:text-gray-300">
                    {fmtMoney(item.value)}
                  </td>
                  <td className={`px-2 py-2 text-right font-number tabular-nums ${up(item.profit) ? 'text-up' : 'text-down'}`}>
                    {up(item.profit) ? '+' : ''}{fmtMoney(item.profit)}
                  </td>
                  <td className={`px-2 py-2 text-right font-number tabular-nums ${up(item.profitPct) ? 'text-up' : 'text-down'}`}>
                    {fmtPct(item.profitPct)}
                  </td>
                  <td className="px-2 py-2 text-center">
                    <div className="flex gap-1 justify-center">
                      {item.stock && (
                        <>
                          <button
                            onClick={() => setTradeTarget({ stock: item.stock!, type: 'BUY' })}
                            className="px-2 py-0.5 text-[10px] bg-up/10 text-up border border-up/30 rounded hover:bg-up hover:text-white transition-colors"
                          >
                            加仓
                          </button>
                          <button
                            onClick={() => setTradeTarget({ stock: item.stock!, type: 'SELL' })}
                            disabled={item.availableQuantity <= 0}
                            className="px-2 py-0.5 text-[10px] bg-down/10 text-down border border-down/30 rounded hover:bg-down hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            减仓
                          </button>
                        </>
                      )}
                    </div>
                    {!item.isT0 && item.locked > 0 && (
                      <div className="text-[9px] text-orange-400 mt-0.5">T+1锁定</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* T+1 说明 */}
      {items.some(p => !p.isT0) && (
        <div className="px-4 py-2 bg-orange-50 dark:bg-orange-900/10 border-t border-orange-100 dark:border-orange-800 text-xs text-orange-600 dark:text-orange-400">
          ⚠ A股/创业板/科创板实行 <strong>T+1</strong> 制度：当日买入股票，次日交易日才可卖出（🔒 表示今日买入锁定数量）。
        </div>
      )}

      {/* 交易 Modal */}
      {tradeTarget && (
        <Modal
          isOpen={true}
          onClose={() => setTradeTarget(null)}
          title={`${tradeTarget.type === 'BUY' ? '📈 加仓' : '📉 减仓'} · ${tradeTarget.stock.name}`}
          size="sm"
        >
          <TradePanel stock={tradeTarget.stock} />
        </Modal>
      )}
    </div>
  )
}
