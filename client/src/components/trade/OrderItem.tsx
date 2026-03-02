import type { Order } from '../../core/models/Order'

interface OrderItemProps {
  order: Order
  onCancel?: () => void
}

export default function OrderItem({ order, onCancel }: OrderItemProps) {
  // 格式化时间
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  // 获取状态样式
  const getStatusStyle = () => {
    switch (order.status) {
      case 'PENDING':
        return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
      case 'EXECUTED':
        return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
      case 'CANCELLED':
        return 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
      case 'PARTIAL':
        return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
      default:
        return 'bg-gray-100 text-gray-500'
    }
  }

  // 获取状态文字
  const getStatusText = () => {
    switch (order.status) {
      case 'PENDING':
        return '待执行'
      case 'EXECUTED':
        return '已成交'
      case 'CANCELLED':
        return '已撤销'
      case 'PARTIAL':
        return '部分成交'
      default:
        return order.status
    }
  }

  // 获取订单类型样式
  const getTypeStyle = () => {
    return order.type === 'BUY'
      ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
      : 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'
  }

  // 获取订单模式文字
  const getModeText = () => {
    return order.orderMode === 'MARKET' ? '市价' : '限价'
  }

  // 计算订单金额
  const orderAmount = (order.price || order.executedPrice || 0) * (order.executedQuantity || order.quantity)

  return (
    <div className="p-3 border-b border-gray-100 dark:border-gray-700">
      {/* 头部：股票名称 + 状态 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 text-xs rounded ${getTypeStyle()}`}>
            {order.type === 'BUY' ? '买入' : '卖出'}
          </span>
          <span className="font-medium text-gray-900 dark:text-white">
            {order.stockName || order.stockCode}
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {getModeText()}
          </span>
        </div>
        <span className={`px-2 py-0.5 text-xs rounded ${getStatusStyle()}`}>
          {getStatusText()}
        </span>
      </div>

      {/* 订单详情 */}
      <div className="grid grid-cols-3 gap-2 text-sm mb-2">
        <div>
          <div className="text-gray-500 dark:text-gray-400 text-xs">委托价格</div>
          <div className="font-number">
            ¥{order.price?.toFixed(2) || order.executedPrice?.toFixed(2) || '-'}
          </div>
        </div>
        <div>
          <div className="text-gray-500 dark:text-gray-400 text-xs">委托数量</div>
          <div className="font-number">{order.quantity}</div>
        </div>
        <div>
          <div className="text-gray-500 dark:text-gray-400 text-xs">成交数量</div>
          <div className="font-number">
            {order.executedQuantity !== undefined ? order.executedQuantity : '-'}
          </div>
        </div>
      </div>

      {/* 金额和时间 */}
      <div className="flex items-center justify-between text-sm">
        <div className="text-gray-500 dark:text-gray-400">
          {formatTime(order.createdAt)}
        </div>
        <div className="font-number text-gray-900 dark:text-white">
          ¥{orderAmount.toLocaleString()}
        </div>
      </div>

      {/* 撤销按钮 */}
      {order.status === 'PENDING' && onCancel && (
        <button
          onClick={onCancel}
          className="mt-2 w-full py-1.5 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-400 rounded transition-colors"
        >
          撤销委托
        </button>
      )}
    </div>
  )
}
