import { useState } from 'react'
import { useGameStore } from '../../store/useGameStore'

const OrderStatus = {
  PENDING: 'PENDING',
  EXECUTED: 'EXECUTED',
  CANCELLED: 'CANCELLED',
  PARTIAL: 'PARTIAL',
} as const

type OrderStatusType = typeof OrderStatus[keyof typeof OrderStatus]

interface Order {
  id: string
  playerId: string
  stockCode: string
  stockName: string
  type: 'BUY' | 'SELL'
  orderMode: 'MARKET' | 'LIMIT'
  quantity: number
  price?: number
  executedPrice?: number
  executedQuantity?: number
  status: string
  fee: number
  createdAt: number
  executedAt?: number
}

type FilterStatus = 'all' | OrderStatusType
type FilterType = 'all' | 'BUY' | 'SELL'

function fmtTime(ts: number) {
  const d = new Date(ts)
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const STATUS_TABS: { key: FilterStatus; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: OrderStatus.PENDING, label: '委托中' },
  { key: OrderStatus.EXECUTED, label: '已成交' },
  { key: OrderStatus.CANCELLED, label: '已撤销' },
]

export default function OrderList() {
  const { orders, cancelOrder } = useGameStore()
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all')
  const [filterType, setFilterType] = useState<FilterType>('all')

  const filteredOrders = orders
    .filter(o => filterStatus === 'all' || o.status === filterStatus)
    .filter(o => filterType === 'all' || o.type === filterType)
    .sort((a, b) => b.createdAt - a.createdAt)

  const stats = {
    all: orders.length,
    pending: orders.filter(o => o.status === OrderStatus.PENDING).length,
    executed: orders.filter(o => o.status === OrderStatus.EXECUTED).length,
    cancelled: orders.filter(o => o.status === OrderStatus.CANCELLED).length,
  }

  const handleCancel = async (order: Order) => {
    if (order.status !== OrderStatus.PENDING) return
    try {
      await cancelOrder(order.id)
    } catch {
      alert('撤单失败，请重试')
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* 统计栏 */}
      <div className="flex items-center gap-4 px-4 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shrink-0 text-xs">
        <span className="text-gray-500">共 <b className="text-gray-800 dark:text-gray-200">{stats.all}</b> 笔</span>
        <span className="text-yellow-600">委托中 <b>{stats.pending}</b></span>
        <span className="text-green-600">已成交 <b>{stats.executed}</b></span>
        <span className="text-gray-400">已撤销 <b>{stats.cancelled}</b></span>

        {/* 买卖过滤 */}
        <div className="ml-auto flex gap-1">
          {([['all', '全部'], ['BUY', '买入'], ['SELL', '卖出']] as [FilterType, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setFilterType(k)}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${
                filterType === k
                  ? (k === 'BUY' ? 'bg-up text-white' : k === 'SELL' ? 'bg-down text-white' : 'bg-primary text-white')
                  : 'bg-white dark:bg-gray-700 text-gray-500 border border-gray-200 dark:border-gray-600'
              }`}>{l}</button>
          ))}
        </div>
      </div>

      {/* 状态 Tab */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 shrink-0 bg-white dark:bg-gray-800">
        {STATUS_TABS.map(tab => (
          <button key={tab.key} onClick={() => setFilterStatus(tab.key)}
            className={`flex-1 py-2 text-xs font-medium transition-colors border-b-2 ${
              filterStatus === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700'
            }`}>
            {tab.label}
            {tab.key !== 'all' && (
              <span className="ml-1 text-gray-400">({stats[tab.key === OrderStatus.PENDING ? 'pending' : tab.key === OrderStatus.EXECUTED ? 'executed' : 'cancelled']})</span>
            )}
          </button>
        ))}
      </div>

      {/* 表头 */}
      <div className="grid text-xs text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 shrink-0"
        style={{ gridTemplateColumns: '80px 90px 50px 44px 72px 56px 72px 56px 68px 64px' }}>
        <div className="px-3 py-2">时间</div>
        <div className="px-2 py-2">股票</div>
        <div className="px-2 py-2 text-center">方向</div>
        <div className="px-2 py-2 text-center">类型</div>
        <div className="px-2 py-2 text-right">委托价</div>
        <div className="px-2 py-2 text-right">委托量</div>
        <div className="px-2 py-2 text-right">成交价</div>
        <div className="px-2 py-2 text-right">成交量</div>
        <div className="px-2 py-2 text-center">状态</div>
        <div className="px-2 py-2 text-center">操作</div>
      </div>

      {/* 订单列表 */}
      <div className="flex-1 overflow-auto">
        {filteredOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-gray-400 dark:text-gray-500 text-sm">
            <span className="text-3xl mb-2">📋</span>
            暂无委托记录
          </div>
        ) : (
          filteredOrders.map(order => (
            <OrderRow key={order.id} order={order} onCancel={() => handleCancel(order)} />
          ))
        )}
      </div>
    </div>
  )
}

function OrderRow({ order, onCancel }: { order: Order; onCancel: () => void }) {
  const isBuy = order.type === 'BUY'

  const statusStyle = {
    [OrderStatus.PENDING]: 'text-yellow-600 dark:text-yellow-400',
    [OrderStatus.EXECUTED]: 'text-green-600 dark:text-green-400',
    [OrderStatus.CANCELLED]: 'text-gray-400',
    [OrderStatus.PARTIAL]: 'text-blue-500',
  }[order.status] ?? 'text-gray-400'

  const statusText = {
    [OrderStatus.PENDING]: '委托中',
    [OrderStatus.EXECUTED]: '已成交',
    [OrderStatus.CANCELLED]: '已撤销',
    [OrderStatus.PARTIAL]: '部分成交',
  }[order.status] ?? order.status

  return (
    <div
      className="grid text-xs border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
      style={{ gridTemplateColumns: '80px 90px 50px 44px 72px 56px 72px 56px 68px 64px' }}
    >
      <div className="px-3 py-2.5 text-gray-500 dark:text-gray-400 font-mono whitespace-nowrap overflow-hidden">
        {fmtTime(order.createdAt)}
      </div>
      <div className="px-2 py-2.5">
        <div className="font-medium text-gray-900 dark:text-white truncate">{order.stockName || order.stockCode}</div>
        <div className="text-gray-400 font-mono text-[10px]">{order.stockCode}</div>
      </div>
      <div className="px-2 py-2.5 text-center">
        <span className={`px-1.5 py-0.5 rounded font-medium ${
          isBuy ? 'bg-red-50 dark:bg-red-900/20 text-up' : 'bg-green-50 dark:bg-green-900/20 text-down'
        }`}>
          {isBuy ? '买入' : '卖出'}
        </span>
      </div>
      <div className="px-2 py-2.5 text-center text-gray-500 dark:text-gray-400">
        {order.orderMode === 'MARKET' ? '市价' : '限价'}
      </div>
      <div className="px-2 py-2.5 text-right font-number text-gray-800 dark:text-gray-200">
        {order.price != null ? order.price.toFixed(2) : '市价'}
      </div>
      <div className="px-2 py-2.5 text-right font-number text-gray-800 dark:text-gray-200">
        {order.quantity.toLocaleString()}
      </div>
      <div className="px-2 py-2.5 text-right font-number text-gray-800 dark:text-gray-200">
        {order.executedPrice != null ? order.executedPrice.toFixed(2) : '—'}
      </div>
      <div className="px-2 py-2.5 text-right font-number text-gray-800 dark:text-gray-200">
        {order.executedQuantity != null ? order.executedQuantity.toLocaleString() : '—'}
      </div>
      <div className={`px-2 py-2.5 text-center font-medium ${statusStyle}`}>
        {statusText}
      </div>
      <div className="px-2 py-2.5 text-center">
        {order.status === OrderStatus.PENDING ? (
          <button
            onClick={onCancel}
            className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-600 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 rounded transition-colors"
          >
            撤单
          </button>
        ) : (
          <span className="text-gray-300 dark:text-gray-600">—</span>
        )}
      </div>
    </div>
  )
}
