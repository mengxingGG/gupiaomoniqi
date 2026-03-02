interface RankItemProps {
  rank: number
  name: string
  avatar: string
  value: number
  isPlayer?: boolean
  rankType: 'asset' | 'profit'
}

export default function RankItem({
  rank,
  name,
  avatar,
  value,
  isPlayer,
  rankType,
}: RankItemProps) {
  // 格式化数值
  const formatValue = () => {
    if (rankType === 'asset') {
      if (value >= 100000000) {
        return `¥${(value / 100000000).toFixed(1)}亿`
      }
      if (value >= 10000) {
        return `¥${(value / 10000).toFixed(0)}万`
      }
      return `¥${value.toFixed(0)}`
    } else {
      // 收益率
      const profitRate = ((value - 1000000) / 1000000) * 100
      const prefix = profitRate >= 0 ? '+' : ''
      return `${prefix}${profitRate.toFixed(1)}%`
    }
  }

  // 获取排名样式
  const getRankStyle = () => {
    if (rank === 1) return 'bg-yellow-100 dark:bg-yellow-900/40 border-yellow-400'
    if (rank === 2) return 'bg-gray-100 dark:bg-gray-700 border-gray-300'
    if (rank === 3) return 'bg-orange-100 dark:bg-orange-900/40 border-orange-400'
    return ''
  }

  // 获取排名徽章
  const getRankBadge = () => {
    if (rank === 1) return '🥇'
    if (rank === 2) return '🥈'
    if (rank === 3) return '🥉'
    return rank
  }

  return (
    <div
      className={`flex items-center gap-3 px-4 py-2 border-b border-gray-100 dark:border-gray-700 ${
        isPlayer ? 'bg-blue-50 dark:bg-blue-900/20' : ''
      } ${getRankStyle()}`}
    >
      {/* 排名 */}
      <div className="w-8 text-center">
        <span className="text-lg">{getRankBadge()}</span>
      </div>

      {/* 头像 */}
      <div className="w-8 h-8 flex items-center justify-center text-lg bg-gray-200 dark:bg-gray-600 rounded-full">
        {avatar}
      </div>

      {/* 名称 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="font-medium text-gray-900 dark:text-white truncate">
            {name}
          </span>
          {isPlayer && (
            <span className="text-xs text-blue-500">(你)</span>
          )}
        </div>
      </div>

      {/* 数值 */}
      <div className="text-right">
        <div
          className={`font-bold font-number ${
            isPlayer ? 'text-primary' : 'text-gray-700 dark:text-gray-300'
          }`}
        >
          {formatValue()}
        </div>
      </div>
    </div>
  )
}
