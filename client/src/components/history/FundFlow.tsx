import { useMemo, useState } from 'react'
import { useGameStore } from '../../store/useGameStore'
import { useAuthStore } from '../../store/useAuthStore'

// 资金流水记录类型
interface FundFlowRecord {
  id: string
  type: 'deposit' | 'withdraw' | 'buy' | 'sell' | 'gift' | 'borrow' | 'repay' | 'fee'
  amount: number
  description: string
  timestamp: number
  balance: number
}

export default function FundFlow() {
  const { transactions, loans, achievements } = useGameStore()
  const { player } = useAuthStore()
  const [filterType, setFilterType] = useState<string>('all')

  // 生成资金流水记录
  const fundFlowRecords = useMemo(() => {
    const records: FundFlowRecord[] = []
    let balance = player?.initialCash || 1000000

    // 添加初始资金记录
    records.push({
      id: 'initial',
      type: 'deposit',
      amount: player?.initialCash || 1000000,
      description: '初始资金',
      timestamp: player?.updatedAt || Date.now(),
      balance: balance,
    })

    // 从交易记录生成流水
    transactions.forEach((t) => {
      if (t.type === 'BUY') {
        balance -= t.total + t.fee
        records.push({
          id: t.id,
          type: 'buy',
          amount: -(t.total + t.fee),
          description: `买入 ${t.stockName || t.stockCode} ${t.quantity}股`,
          timestamp: t.createdAt,
          balance: balance,
        })
      } else {
        balance += t.total - t.fee
        records.push({
          id: t.id,
          type: 'sell',
          amount: t.total - t.fee,
          description: `卖出 ${t.stockName || t.stockCode} ${t.quantity}股`,
          timestamp: t.createdAt,
          balance: balance,
        })
      }
    })

    // 从借款记录生成流水
    loans.forEach((loan) => {
      if (loan.status === 'ACTIVE') {
        balance += loan.principal
        records.push({
          id: `borrow-${loan.id}`,
          type: 'borrow',
          amount: loan.principal,
          description: `借款到账`,
          timestamp: loan.borrowDate,
          balance: balance,
        })
      }
    })

    // 从成就奖励生成流水
    achievements.forEach((a) => {
      // 这里可以根据成就ID查找奖励金额
      const giftAchievements = ['double_money', 'triple_money', 'millionaire', 'ten_million', 'hundred_million']
      if (giftAchievements.includes(a.id)) {
        const rewards: Record<string, number> = {
          double_money: 1000000,
          triple_money: 2000000,
          millionaire: 0,
          ten_million: 5000000,
          hundred_million: 10000000,
        }
        const reward = rewards[a.id] || 0
        if (reward > 0) {
          balance += reward
          records.push({
            id: `gift-${a.id}`,
            type: 'gift',
            amount: reward,
            description: `成就奖励: ${a.id}`,
            timestamp: a.unlockedAt,
            balance: balance,
          })
        }
      }
    })

    // 按时间倒序排列
    records.sort((a, b) => b.timestamp - a.timestamp)

    return records
  }, [player, transactions, loans, achievements])

  // 过滤后的记录
  const filteredRecords = useMemo(() => {
    if (filterType === 'all') return fundFlowRecords
    return fundFlowRecords.filter((r) => r.type === filterType)
  }, [fundFlowRecords, filterType])

  // 统计信息
  const stats = useMemo(() => {
    const deposits = fundFlowRecords
      .filter((r) => ['deposit', 'sell', 'gift', 'borrow'].includes(r.type))
      .reduce((sum, r) => sum + r.amount, 0)
    const withdraws = fundFlowRecords
      .filter((r) => ['buy', 'repay'].includes(r.type))
      .reduce((sum, r) => sum + Math.abs(r.amount), 0)

    return {
      totalIn: deposits,
      totalOut: withdraws,
      net: deposits - withdraws,
      currentBalance: player?.cash || 0,
    }
  }, [fundFlowRecords, player])

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

  // 获取类型样式
  const getTypeStyle = (type: string) => {
    switch (type) {
      case 'deposit':
      case 'gift':
      case 'borrow':
        return 'text-green-500 bg-green-50 dark:bg-green-900/20'
      case 'withdraw':
      case 'sell':
        return 'text-green-500 bg-green-50 dark:bg-green-900/20'
      case 'buy':
      case 'repay':
        return 'text-red-500 bg-red-50 dark:bg-red-900/20'
      case 'fee':
        return 'text-gray-500 bg-gray-50 dark:bg-gray-700'
      default:
        return 'text-gray-500 bg-gray-50'
    }
  }

  // 获取类型标签
  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'deposit': return '存入'
      case 'withdraw': return '取出'
      case 'buy': return '买入'
      case 'sell': return '卖出'
      case 'gift': return '奖励'
      case 'borrow': return '借款'
      case 'repay': return '还款'
      case 'fee': return '手续费'
      default: return type
    }
  }

  const filterOptions = [
    { value: 'all', label: '全部' },
    { value: 'deposit', label: '存入' },
    { value: 'buy', label: '买入' },
    { value: 'sell', label: '卖出' },
    { value: 'gift', label: '奖励' },
    { value: 'borrow', label: '借款' },
  ]

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg w-full max-w-md mx-auto">
      {/* 头部 */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <span className="text-2xl">💰</span>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">资金流水</h2>
        </div>
      </div>

      {/* 统计信息 */}
      <div className="grid grid-cols-2 gap-2 p-3 bg-gray-50 dark:bg-gray-700 text-xs">
        <div className="text-center">
          <div className="text-gray-500 dark:text-gray-400">总收入</div>
          <div className="font-bold text-green-500">+¥{stats.totalIn.toLocaleString()}</div>
        </div>
        <div className="text-center">
          <div className="text-gray-500 dark:text-gray-400">总支出</div>
          <div className="font-bold text-red-500">-¥{stats.totalOut.toLocaleString()}</div>
        </div>
      </div>

      {/* 当前余额 */}
      <div className="px-4 py-3 bg-blue-50 dark:bg-blue-900/20">
        <div className="text-center">
          <div className="text-sm text-blue-600 dark:text-blue-400">当前可用资金</div>
          <div className="text-2xl font-bold text-blue-700 dark:text-blue-300">
            ¥{player?.cash.toLocaleString() || 0}
          </div>
        </div>
      </div>

      {/* 过滤标签 */}
      <div className="flex flex-wrap gap-1 p-2 border-b border-gray-200 dark:border-gray-700">
        {filterOptions.map((option) => (
          <button
            key={option.value}
            onClick={() => setFilterType(option.value)}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${
              filterType === option.value
                ? 'bg-primary text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* 流水列表 */}
      <div className="max-h-80 overflow-auto">
        {filteredRecords.length === 0 ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">
            暂无流水记录
          </div>
        ) : (
          filteredRecords.map((record) => (
            <div
              key={record.id}
              className="flex items-center justify-between p-3 border-b border-gray-100 dark:border-gray-700"
            >
              <div className="flex items-center gap-3">
                {/* 类型标签 */}
                <span
                  className={`px-2 py-1 text-xs rounded ${getTypeStyle(record.type)}`}
                >
                  {getTypeLabel(record.type)}
                </span>

                {/* 描述 */}
                <div>
                  <div className="text-sm text-gray-900 dark:text-white">
                    {record.description}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {formatTime(record.timestamp)}
                  </div>
                </div>
              </div>

              {/* 金额和余额 */}
              <div className="text-right">
                <div
                  className={`font-bold font-number ${
                    record.amount >= 0 ? 'text-green-500' : 'text-red-500'
                  }`}
                >
                  {record.amount >= 0 ? '+' : ''}¥{Math.abs(record.amount).toLocaleString()}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  余 ¥{record.balance.toLocaleString()}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
