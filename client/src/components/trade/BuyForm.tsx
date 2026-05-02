import { useState } from 'react'
import type { Stock } from '../../core/models/Stock'
import type { Player } from '../../core/models/Player'
import { OrderType, OrderMode, OrderStatus } from '../../core/models/Order'
import { useGameStore } from '../../store/useGameStore'
import { GameConfig } from '../../core/constants/GameConfig'
import { v4 as uuidv4 } from 'uuid'

interface BuyFormProps {
  stock: Stock
  player: Player | null
  onSuccess?: () => void
  onError?: (msg: string) => void
}

export default function BuyForm({ stock, player, onSuccess, onError }: BuyFormProps) {
  const [orderMode, setOrderMode] = useState<OrderMode>(OrderMode.MARKET)
  const [quantity, setQuantity] = useState(100)
  const [limitPrice, setLimitPrice] = useState(stock.currentPrice)
  const [loading, setLoading] = useState(false)

  const { updateCash, addPosition, updatePosition, addTransaction, positions, addOrder } = useGameStore()

  // 计算交易费用
  const price = orderMode === OrderMode.MARKET ? stock.currentPrice : limitPrice
  const totalAmount = price * quantity
  const fee = totalAmount * GameConfig.BUY_FEE_RATE
  const totalCost = totalAmount + fee

  // 验证买入
  const canBuy = player && player.cash >= totalCost

  // 快速选择数量
  const quickQuantities = [100, 500, 1000, 5000]

  const handleBuy = async () => {
    if (!player || !canBuy) {
      onError?.('资金不足')
      return
    }

    setLoading(true)

    try {
      if (orderMode === OrderMode.MARKET) {
        // 市价买入 - 立即成交
        // 扣除资金
        updateCash(-totalCost)

        // 处理持仓
        const existingPosition = positions.find((p) => p.stockCode === stock.code)
        if (existingPosition) {
          const newQuantity = existingPosition.quantity + quantity
          const newTotalCost = existingPosition.totalCost + totalAmount
          updatePosition(stock.code, {
            quantity: newQuantity,
            availableQuantity: existingPosition.availableQuantity + quantity,
            averageCost: newTotalCost / newQuantity,
            totalCost: newTotalCost,
          })
        } else {
          addPosition({
            id: uuidv4(),
            playerId: player.id,
            stockCode: stock.code,
            stockName: stock.name,
            quantity: quantity,
            availableQuantity: quantity,
            averageCost: totalAmount / quantity,
            totalCost: totalAmount,
            buyDate: Date.now(),
            market: stock.market,
          })
        }

        // 添加交易记录
        addTransaction({
          id: uuidv4(),
          playerId: player.id,
          stockCode: stock.code,
          stockName: stock.name,
          type: OrderType.BUY,
          quantity: quantity,
          price: stock.currentPrice,
          total: totalAmount,
          fee: fee,
          createdAt: Date.now(),
        })

        onSuccess?.()
      } else {
        // 限价买入 - 创建挂单
        const frozenAmount = limitPrice * quantity + fee

        if (player.cash < frozenAmount) {
          onError?.('资金不足，无法冻结委托资金')
          setLoading(false)
          return
        }

        // 冻结资金
        updateCash(-frozenAmount)

        // 创建订单
        addOrder({
          id: uuidv4(),
          playerId: player.id,
          stockCode: stock.code,
          stockName: stock.name,
          type: OrderType.BUY,
          orderMode: OrderMode.LIMIT,
          quantity: quantity,
          price: limitPrice,
          status: OrderStatus.PENDING,
          createdAt: Date.now(),
          fee: fee,
        })

        onSuccess?.()
      }
    } catch (error) {
      onError?.('买入失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* 订单模式选择 */}
      <div className="flex gap-2">
        <button
          onClick={() => setOrderMode(OrderMode.MARKET)}
          className={`flex-1 py-2 text-sm rounded-lg transition-colors ${
            orderMode === OrderMode.MARKET
              ? 'bg-primary text-white'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
          }`}
        >
          市价买入
        </button>
        <button
          onClick={() => setOrderMode(OrderMode.LIMIT)}
          className={`flex-1 py-2 text-sm rounded-lg transition-colors ${
            orderMode === OrderMode.LIMIT
              ? 'bg-primary text-white'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
          }`}
        >
          限价买入
        </button>
      </div>

      {/* 限价价格输入 */}
      {orderMode === OrderMode.LIMIT && (
        <div>
          <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
            委托价格
          </label>
          <div className="relative">
            <input
              type="number"
              value={limitPrice}
              onChange={(e) => setLimitPrice(parseFloat(e.target.value) || 0)}
              step="0.01"
              className="w-full px-3 py-2 pr-8 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">
              元
            </span>
          </div>
        </div>
      )}

      {/* 数量输入 */}
      <div>
        <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
          买入数量 (股)
        </label>
        <input
          type="number"
          value={quantity}
          onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
          min="1"
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
        />
      </div>

      {/* 快速选择数量 */}
      <div className="flex gap-2">
        {quickQuantities.map((q) => (
          <button
            key={q}
            onClick={() => setQuantity(q)}
            className={`flex-1 py-1 text-xs rounded ${
              quantity === q
                ? 'bg-primary text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
            }`}
          >
            {q}
          </button>
        ))}
      </div>

      {/* 费用明细 */}
      <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-600 dark:text-gray-400">当前价格</span>
          <span className="font-number">¥{stock.currentPrice.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600 dark:text-gray-400">委托价格</span>
          <span className="font-number">
            ¥{(orderMode === 'MARKET' ? stock.currentPrice : limitPrice).toFixed(2)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600 dark:text-gray-400">成交金额</span>
          <span className="font-number">¥{totalAmount.toLocaleString()}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600 dark:text-gray-400">手续费 (5%)</span>
          <span className="font-number text-red-500">¥{fee.toFixed(2)}</span>
        </div>
        <div className="flex justify-between pt-2 border-t border-gray-200 dark:border-gray-600 font-medium">
          <span>需要资金</span>
          <span className="font-number text-up">¥{totalCost.toLocaleString()}</span>
        </div>
      </div>

      {/* 可用资金提示 */}
      {player && (
        <div className="text-xs text-gray-500 dark:text-gray-400">
          可用资金: ¥{player.cash.toLocaleString()}
          {totalCost > player.cash && (
            <span className="text-red-500 ml-2">(资金不足)</span>
          )}
        </div>
      )}

      {/* 买入按钮 */}
      <button
        onClick={handleBuy}
        disabled={!canBuy || loading}
        className="w-full py-3 bg-up hover:bg-red-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
      >
        {loading ? '处理中...' : canBuy ? '确认买入' : '资金不足'}
      </button>
    </div>
  )
}
