import type { AchievementDefinition } from '../../core/models/Achievement'

interface AchievementItemProps {
  achievement: AchievementDefinition
  progress: number
  target: number
  isUnlocked: boolean
}

export default function AchievementItem({
  achievement,
  progress,
  target,
  isUnlocked,
}: AchievementItemProps) {
  // 计算进度百分比
  const progressPercent = Math.min(100, Math.round((progress / target) * 100))

  // 格式化进度显示
  const formatProgress = () => {
    if (achievement.condition.type === 'ASSETS_REACH') {
      if (achievement.id.includes('million') || achievement.id.includes('billion')) {
        return `${(progress / 10000).toFixed(1)}万 / ${(target / 10000).toFixed(0)}万`
      }
      return `${progress.toFixed(1)}倍 / ${target}倍`
    }
    return `${Math.floor(progress)} / ${target}`
  }

  return (
    <div
      className={`flex items-center gap-3 p-3 border-b border-gray-100 dark:border-gray-700 ${
        isUnlocked
          ? 'bg-yellow-50 dark:bg-yellow-900/20'
          : 'opacity-60'
      }`}
    >
      {/* 图标 */}
      <div
        className={`w-10 h-10 flex items-center justify-center text-xl rounded-lg ${
          isUnlocked
            ? 'bg-yellow-100 dark:bg-yellow-900/40'
            : 'bg-gray-100 dark:bg-gray-700'
        }`}
      >
        {achievement.icon || '🏆'}
      </div>

      {/* 信息 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3
            className={`font-medium ${
              isUnlocked
                ? 'text-yellow-700 dark:text-yellow-400'
                : 'text-gray-700 dark:text-gray-300'
            }`}
          >
            {achievement.name}
          </h3>
          {isUnlocked && (
            <span className="text-yellow-500" title="已解锁">
              ✓
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
          {achievement.description}
        </p>

        {/* 进度条 */}
        {!isUnlocked && (
          <div className="mt-1">
            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-0.5">
              <span>进度</span>
              <span>{formatProgress()}</span>
            </div>
            <div className="h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* 奖励 */}
      {achievement.reward && (
        <div
          className={`text-xs text-center ${
            isUnlocked
              ? 'text-yellow-600 dark:text-yellow-400'
              : 'text-gray-400 dark:text-gray-500'
          }`}
        >
          <div>奖励</div>
          <div className="font-bold">
            ¥{achievement.reward.toLocaleString()}
          </div>
        </div>
      )}
    </div>
  )
}
