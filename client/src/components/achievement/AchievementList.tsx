import { useEffect } from 'react'
import { useGameStore } from '../../store/useGameStore'

interface AchievementListProps {
  onClose?: () => void
}

export default function AchievementList({ onClose }: AchievementListProps) {
  const { achievements, fetchAchievements } = useGameStore()

  useEffect(() => {
    fetchAchievements()
  }, [])

  const unlockedCount = achievements.filter(a => a.unlocked).length
  const totalCount = achievements.length

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg w-full max-w-md mx-auto">
      {/* 头部 */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🏆</span>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">成就</h2>
        </div>
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {unlockedCount} / {totalCount}
        </div>
      </div>

      {/* 进度条 */}
      {totalCount > 0 && (
        <div className="px-4 py-2 bg-gray-50 dark:bg-gray-700">
          <div className="h-2 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${(unlockedCount / totalCount) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* 成就列表 */}
      <div className="max-h-96 overflow-auto">
        {achievements.length === 0 ? (
          <div className="p-8 text-center text-gray-400">暂无成就数据</div>
        ) : (
          achievements.map((achievement) => (
            <div
              key={achievement.id}
              className={`flex items-center gap-3 p-3 border-b border-gray-100 dark:border-gray-700 ${
                achievement.unlocked ? '' : 'opacity-50'
              }`}
            >
              <div className={`w-10 h-10 flex items-center justify-center rounded-full text-xl ${
                achievement.unlocked
                  ? 'bg-yellow-100 dark:bg-yellow-900/30'
                  : 'bg-gray-100 dark:bg-gray-700'
              }`}>
                {achievement.icon || '🏆'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-gray-900 dark:text-white text-sm">
                  {achievement.name}
                  {achievement.unlocked && <span className="ml-1 text-yellow-500">✓</span>}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {achievement.description}
                </div>
                {achievement.unlocked && achievement.unlockedAt && (
                  <div className="text-xs text-gray-400 mt-0.5">
                    {new Date(achievement.unlockedAt).toLocaleDateString('zh-CN')}
                  </div>
                )}
              </div>
              {achievement.reward && (
                <div className="text-xs text-yellow-600 font-medium whitespace-nowrap">
                  +¥{(achievement.reward / 10000).toFixed(0)}万
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {onClose && (
        <div className="p-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="w-full py-2 px-4 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg transition-colors"
          >
            关闭
          </button>
        </div>
      )}
    </div>
  )
}
