import { useState } from 'react'
import type { StockData } from '../../store/useMarketStore'
import { useGameStore } from '../../store/useGameStore'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import { GameConfig } from '../../core/constants/GameConfig'

interface TradePanelProps {
  stock: StockData
  compact?: boolean
}

type TradeType = 'BUY' | 'SELL'
type OrderMode = 'MARKET' | 'LIMIT'

const FEE_RATE = GameConfig.BUY_FEE_RATE || 0.0003

export default function TradePanel({ stock, compact = false }: TradePanelProps) {
  const [tradeType, setTradeType] = useState<TradeType>('BUY')
  const [orderMode, setOrderMode] = useState<OrderMode>('MARKET')
  const [quantity, setQuantity] = useState(100)
  const [limitPrice, setLimitPrice] = useState(stock.currentPrice)
  const [loading, setLoading] = useState(false)

  const { buy, sell, positions } = useGameStore()
  const { player } = useAuthStore()
  const { addToast } = useUIStore()

  const execPrice = orderMode === 'LIMIT' ? limitPrice : stock.currentPrice
  const totalAmount = execPrice * quantity
  const fee = totalAmount * FEE_RATE
  const totalCost = tradeType === 'BUY' ? totalAmount + fee : totalAmount - fee

  const currentPosition = positions.find((p) => p.stockCode === stock.code)
  const lockedQty = currentPosition
    ? currentPosition.quantity - currentPosition.availableQuantity
    : 0

  const maxBuyQty = player
    ? Math.floor((player.cash / (1 + FEE_RATE)) / execPrice / 100) * 100
    : 0
  const maxSellQty = currentPosition?.availableQuantity ?? 0

  const canBuy = !!(player && player.cash >= totalCost && quantity > 0)
  const canSell = !!(currentPosition && currentPosition.availableQuantity >= quantity && quantity > 0)

  const setPercent = (pct: number) => {
    if (tradeType === 'BUY') {
      const q = Math.floor((player!.cash * pct / 100 / (1 + FEE_RATE)) / execPrice / 100) * 100
      setQuantity(Math.max(100, q))
    } else {
      const q = Math.floor((maxSellQty * pct) / 100 / 100) * 100
      setQuantity(Math.max(100, q))
    }
  }

  const handleTrade = async () => {
    if (!player) return
    if (tradeType === 'BUY' && !canBuy) return
    if (tradeType === 'SELL' && !canSell) return

    setLoading(true)
    try {
      if (tradeType === 'BUY') {
        await buy({
          stockCode: stock.code,
          quantity,
          orderMode,
          price: orderMode === 'LIMIT' ? limitPrice : undefined,
        })
        addToast({ type: 'success', message: `买入 ${stock.name} ${quantity} 股成功` })
      } else {
        await sell({
          stockCode: stock.code,
          quantity,
          orderMode,
          price: orderMode === 'LIMIT' ? limitPrice : undefined,
        })
        addToast({ type: 'success', message: `卖出 ${stock.name} ${quantity} 股成功` })
      }
      setQuantity(100)
    } catch (err: any) {
      const msg = err?.response?.data?.error || '交易失败'
      addToast({ type: 'error', message: msg })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={compact ? 'p-2' : 'p-3'}>
      {/* 买入/卖出 切换 */}
      <div className="flex mb-2 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600">
        <button
          onClick={() => setTradeType('BUY')}
          className={`flex-1 py-1.5 text-sm font-bold transition-colors ${
            tradeType === 'BUY' ? 'bg-up text-white' : 'bg-white dark:bg-gray-800 text-gray-500 hover:bg-red-50'
          }`}
        >买入</button>
        <button
          onClick={() => setTradeType('SELL')}
          className={`flex-1 py-1.5 text-sm font-bold transition-colors ${
            tradeType === 'SELL' ? 'bg-down text-white' : 'bg-white dark:bg-gray-800 text-gray-500 hover:bg-green-50'
          }`}
        >卖出</button>
      </div>

      {/* 市价/限价 */}
      <div className="flex gap-1 mb-2">
        {(['MARKET', 'LIMIT'] as OrderMode[]).map((m) => (
          <button key={m} onClick={() => setOrderMode(m)}
            className={`flex-1 py-1 text-xs rounded transition-colors ${
              orderMode === m ? 'bg-primary text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500'
            }`}>
            {m === 'MARKET' ? '市价' : '限价'}
          </button>
        ))}
      </div>

      {/* 限价输入 */}
      {orderMode === 'LIMIT' && (
        <div className="mb-2">
          <div className="text-xs text-gray-500 mb-1">委托价格</div>
          <input
            type="number" step="0.01" value={limitPrice}
            onChange={(e) => setLimitPrice(Math.max(0.01, parseFloat(e.target.value) || stock.currentPrice))}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-number"
          />
        </div>
      )}

      {/* 持仓信息 */}
      {currentPosition && (
        <div className="mb-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded text-xs">
          <div className="flex justify-between text-blue-700 dark:text-blue-300">
            <span>持仓 {currentPosition.quantity} 股</span>
            <span>成本 ¥{currentPosition.averageCost.toFixed(2)}</span>
          </div>
          <div className="flex justify-between mt-0.5">
            <span className="text-green-600 dark:text-green-400">可卖 {currentPosition.availableQuantity} 股</span>
            {lockedQty > 0 && (
              <span className="text-orange-500">T+1冻结 {lockedQty} 股</span>
            )}
          </div>
        </div>
      )}

      {/* T+1 卖出预警 */}
      {tradeType === 'SELL' && lockedQty > 0 && quantity > maxSellQty && (
        <div className="mb-2 p-2 bg-orange-50 dark:bg-orange-900/20 rounded text-xs text-orange-600 dark:text-orange-400">
          ⚠ 今日买入 {lockedQty} 股受 T+1 限制，明日方可卖出
        </div>
      )}

      {/* 数量 */}
      <div className="mb-2">
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>数量（股）</span>
          <span>{tradeType === 'BUY' ? `最多买 ${maxBuyQty}` : `最多卖 ${maxSellQty}`}</span>
        </div>
        <div className="flex gap-1">
          <button onClick={() => setQuantity((q) => Math.max(100, q - 100))}
            className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded text-gray-600 dark:text-gray-300 text-sm">-</button>
          <input
            type="number" value={quantity} min={100} step={100}
            onChange={(e) => setQuantity(Math.max(100, parseInt(e.target.value) || 100))}
            className="flex-1 text-center px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-number"
          />
          <button onClick={() => setQuantity((q) => q + 100)}
            className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded text-gray-600 dark:text-gray-300 text-sm">+</button>
        </div>
        {/* 快捷百分比 */}
        <div className="flex gap-1 mt-1">
          {[25, 50, 75, 100].map((pct) => (
            <button key={pct} onClick={() => setPercent(pct)}
              disabled={tradeType === 'BUY' ? !player : maxSellQty < 100}
              className="flex-1 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 disabled:opacity-40">
              {pct}%
            </button>
          ))}
        </div>
      </div>

      {/* 费用摘要 */}
      <div className="mb-2 p-2 bg-gray-50 dark:bg-gray-700/50 rounded text-xs space-y-1">
        <div className="flex justify-between text-gray-500">
          <span>成交金额</span>
          <span className="font-number tabular-nums">¥{totalAmount.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</span>
        </div>
        <div className="flex justify-between text-gray-500">
          <span>手续费 ({(FEE_RATE * 1000).toFixed(1)}‰)</span>
          <span className="font-number tabular-nums">¥{fee.toFixed(2)}</span>
        </div>
        <div className="flex justify-between font-medium border-t border-gray-200 dark:border-gray-600 pt-1">
          <span>{tradeType === 'BUY' ? '需付' : '可得'}</span>
          <span className={`font-number tabular-nums ${tradeType === 'BUY' ? 'text-up' : 'text-down'}`}>
            ¥{totalCost.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}
          </span>
        </div>
      </div>

      {/* 提交按钮 */}
      <button
        onClick={handleTrade}
        disabled={loading || (tradeType === 'BUY' ? !canBuy : !canSell)}
        className={`w-full py-2 rounded font-bold text-sm text-white transition-colors ${
          tradeType === 'BUY'
            ? 'bg-up hover:bg-red-600 disabled:bg-gray-300 dark:disabled:bg-gray-600'
            : 'bg-down hover:bg-green-600 disabled:bg-gray-300 dark:disabled:bg-gray-600'
        } disabled:cursor-not-allowed`}
      >
        {loading ? '处理中...' : tradeType === 'BUY'
          ? (canBuy ? `买入 ${stock.name}` : '资金不足')
          : (canSell ? `卖出 ${stock.name}` : maxSellQty <= 0 ? (lockedQty > 0 ? 'T+1限制' : '无持仓') : '数量超限')
        }
      </button>
    </div>
  )
}
