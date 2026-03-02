import { useState } from 'react'
import type { Stock } from '../../core/models/Stock'
import type { Player } from '../../core/models/Player'
import type { Position } from '../../core/models/Position'
import { OrderType, OrderMode, OrderStatus } from '../../core/models/Order'
import { useGameStore } from '../../store/useGameStore'
import { GameConfig } from '../../core/constants/GameConfig'
import { v4 as uuidv4 } from 'uuid'

interface SellFormProps {
  stock: Stock
  player: Player | null
  position: Position | null
  onSuccess?: () => void
  onError?: (msg: string) => void
}

export default function SellForm({ stock, player, position, onSuccess, onError }: SellFormProps) {
  const [orderMode, setOrderMode] = useState<OrderMode>(OrderMode.MARKET)
  const [quantity, setQuantity] = useState(position?.availableQuantity || 0)
  const [limitPrice, setLimitPrice] = useState(stock.currentPrice)
  const [loading, setLoading] = useState(false)

  const { updateCash, updatePosition, removePosition, addTransaction, addOrder } = useGameStore()

  // 计算交易费用
  const price = orderMode === OrderMode.MARKET ? stock.currentPrice : limitPrice
  const totalAmount = price * quantity
  const fee = totalAmount * GameConfig.SELL_FEE_RATE
  const netAmount = totalAmount - fee

  // 验证卖出
  const canSell = position && position.availableQuantity >= quantity && quantity > 0

  // 快速选择数量
  const quickQuantities = [100, 500, 1000, 'ALL']

  const handleSell = async () => {
    if (!player || !canSell) {
      onError?.('持仓不足')
      return
    }

    setLoading(true)

    try {
      if (orderMode === OrderMode.MARKET) {
        // 市价卖出 - 立即成交

        // 增加资金
        updateCash(netAmount)

        // 更新持仓
        const newQuantity = position.quantity - quantity
        if (newQuantity <= 0) {
          removePosition(stock.code)
        } else {
          const newTotalCost = position.totalCost - totalAmount
          updatePosition(stock.code, {
            quantity: newQuantity,
            availableQuantity: position.availableQuantity - quantity,
            totalCost: newTotalCost,
          })
        }

        // 添加交易记录
        addTransaction({
          id: uuidv4(),
          playerId: player.id,
          stockCode: stock.code,
          stockName: stock.name,
          type: OrderType.SELL,
          quantity: quantity,
          price: stock.currentPrice,
          total: totalAmount,
          fee: fee,
          createdAt: Date.now(),
        })

        onSuccess?.()
      } else {
        // 限价卖出 - 创建挂单

        // 冻结持仓
        updatePosition(stock.code, {
          availableQuantity: position.availableQuantity - quantity,
        })

        // 创建订单
        addOrder({
          id: uuidv4(),
          playerId: player.id,
          stockCode: stock.code,
          stockName: stock.name,
          type: OrderType.SELL,
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
      onError?.('卖出失败')
    } finally {
      setLoading(false)
    }
  }

  // 获取最大可卖数量
  const maxSellQuantity = position?.availableQuantity || 0

  return (
    <div className="space-y-4">
      {/* 持仓信息 */}
      {position && (
        <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div>
              <div className="text-gray-500">持仓数量</div>
              <div className="font-medium">{position.quantity}</div>
            </div>
            <div>
              <div className="text-gray-500">可卖数量</div>
              <div className="font-medium text-green-500">{position.availableQuantity}</div>
            </div>
            <div>
              <div className="text-gray-500">持仓成本</div>
              <div className="font-number">¥{position.averageCost.toFixed(2)}</div>
            </div>
          </div>
        </div>
      )}

      {/* 订单模式选择 */}
      <div className="flex gap-2">
        <button
          onClick={() => setOrderMode(OrderMode.MARKET)}
          className={`flex-1 py-2 text-sm rounded-lg transition-colors ${
            orderMode === OrderMode.MARKET
              ? 'bg-down text-white'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
          }`}
        >
          市价卖出
        </button>
        <button
          onClick={() => setOrderMode(OrderMode.LIMIT)}
          className={`flex-1 py-2 text-sm rounded-lg transition-colors ${
            orderMode === OrderMode.LIMIT
              ? 'bg-down text-white'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
          }`}
        >
          限价卖出
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
          卖出数量 (股)
        </label>
        <input
          type="number"
          value={quantity}
          onChange={(e) => {
            const val = parseInt(e.target.value) || 0
            setQuantity(Math.min(maxSellQuantity, Math.max(0, val)))
          }}
          min="0"
          max={maxSellQuantity}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
        />
      </div>

      {/* 快速选择数量 */}
      <div className="flex gap-2">
        {quickQuantities.map((q) => {
          const value = q === 'ALL' ? maxSellQuantity : q as number
          const isAllButton = q === 'ALL'
          const isDisabled = isAllButton ? maxSellQuantity === 0 : value > maxSellQuantity
          return (
            <button
              key={q}
              onClick={() => setQuantity(value)}
              disabled={isDisabled}
              className={`flex-1 py-1 text-xs rounded disabled:opacity-50 disabled:cursor-not-allowed ${
                quantity === value
                  ? 'bg-down text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
              }`}
            >
              {q === 'ALL' ? '全部' : q}
            </button>
          )
        })}
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
          <span className="text-gray-600 dark:text-gray-400">手续费 (3%)</span>
          <span className="font-number text-red-500">¥{fee.toFixed(2)}</span>
        </div>
        <div className="flex justify-between pt-2 border-t border-gray-200 dark:border-gray-600 font-medium">
          <span>可得资金</span>
          <span className="font-number text-down">¥{netAmount.toLocaleString()}</span>
        </div>
      </div>

      {/* 预估盈亏 */}
      {position && quantity > 0 && (
        <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600 dark:text-gray-400">成本价</span>
            <span className="font-number">¥{(position.averageCost * quantity).toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600 dark:text-gray-400">预估盈亏</span>
            <span
              className={`font-number ${
                netAmount - position.averageCost * quantity >= 0 ? 'text-up' : 'text-down'
              }`}
            >
              {netAmount - position.averageCost * quantity >= 0 ? '+' : ''}
              ¥{(netAmount - position.averageCost * quantity).toFixed(2)}
            </span>
          </div>
        </div>
      )}

      {/* 卖出按钮 */}
      <button
        onClick={handleSell}
        disabled={!canSell || loading || maxSellQuantity === 0}
        className="w-full py-3 bg-down hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
      >
        {loading
          ? '处理中...'
          : maxSellQuantity === 0
          ? '无可卖持仓'
          : canSell
          ? '确认卖出'
          : '持仓不足'}
      </button>
    </div>
  )
}
