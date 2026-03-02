import { useMemo, useState, useEffect } from 'react'
import { useGameStore } from '../../store/useGameStore'

type FilterType = 'all' | 'buy' | 'sell'

export default function TransactionHistory() {
  const { transactions, fetchTransactions } = useGameStore()

  // 每次挂载时刷新交易记录
  useEffect(() => {
    fetchTransactions()
  }, [])

  // 过滤类型
  const [filterType, setFilterType] = useState<FilterType>('all')

  // 过滤后的交易记录
  const filteredTransactions = useMemo(() => {
    if (filterType === 'all') return transactions
    if (filterType === 'buy') return transactions.filter((t) => t.type === 'BUY')
    return transactions.filter((t) => t.type === 'SELL')
  }, [transactions, filterType])

  // 统计信息
  const stats = useMemo(() => {
    const buys = transactions.filter((t) => t.type === 'BUY')
    const sells = transactions.filter((t) => t.type === 'SELL')

    const buyAmount = buys.reduce((sum, t) => sum + t.total, 0)
    const sellAmount = sells.reduce((sum, t) => sum + t.total, 0)
    const totalFee = transactions.reduce((sum, t) => sum + t.fee, 0)

    return {
      buyCount: buys.length,
      sellCount: sells.length,
      buyAmount,
      sellAmount,
      totalFee,
      netAmount: sellAmount - buyAmount,
    }
  }, [transactions])

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

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg w-full max-w-md mx-auto">
      {/* 头部 */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <span className="text-2xl">📜</span>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">交易历史</h2>
        </div>
        <div className="text-sm text-gray-500 dark:text-gray-400">
          共 {transactions.length} 笔
        </div>
      </div>

      {/* 统计信息 */}
      <div className="grid grid-cols-3 gap-2 p-3 bg-gray-50 dark:bg-gray-700 text-xs">
        <div className="text-center">
          <div className="text-gray-500 dark:text-gray-400">买入</div>
          <div className="font-bold text-up">¥{(stats.buyAmount / 10000).toFixed(1)}万</div>
        </div>
        <div className="text-center">
          <div className="text-gray-500 dark:text-gray-400">卖出</div>
          <div className="font-bold text-down">¥{(stats.sellAmount / 10000).toFixed(1)}万</div>
        </div>
        <div className="text-center">
          <div className="text-gray-500 dark:text-gray-400">手续费</div>
          <div className="font-bold text-gray-700 dark:text-gray-300">¥{stats.totalFee.toFixed(0)}</div>
        </div>
      </div>

      {/* 过滤标签 */}
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        {(['all', 'buy', 'sell'] as FilterType[]).map((type) => (
          <button
            key={type}
            onClick={() => setFilterType(type)}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              filterType === type
                ? 'text-primary border-b-2 border-primary'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
            }`}
          >
            {type === 'all' ? '全部' : type === 'buy' ? '买入' : '卖出'}
          </button>
        ))}
      </div>

      {/* 交易列表 */}
      <div className="max-h-80 overflow-auto">
        {filteredTransactions.length === 0 ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">
            暂无交易记录
          </div>
        ) : (
          filteredTransactions.map((transaction) => (
            <div
              key={transaction.id}
              className="flex items-center justify-between p-3 border-b border-gray-100 dark:border-gray-700"
            >
              <div className="flex items-center gap-3">
                {/* 类型标识 */}
                <div
                  className={`w-8 h-8 flex items-center justify-center rounded-full text-sm font-bold ${
                    transaction.type === 'BUY'
                      ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                      : 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'
                  }`}
                >
                  {transaction.type === 'BUY' ? '买' : '卖'}
                </div>

                {/* 股票信息 */}
                <div>
                  <div className="font-medium text-gray-900 dark:text-white">
                    {transaction.stockName || transaction.stockCode}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {transaction.quantity}股 @ ¥{transaction.price.toFixed(2)}
                  </div>
                </div>
              </div>

              {/* 金额和时间 */}
              <div className="text-right">
                <div
                  className={`font-bold font-number ${
                    transaction.type === 'BUY' ? 'text-up' : 'text-down'
                  }`}
                >
                  {transaction.type === 'BUY' ? '-' : '+'}¥{transaction.total.toLocaleString()}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {formatTime(transaction.createdAt)}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
