import { useState, useEffect } from 'react'
import { useAuthStore } from '../../store/useAuthStore'
import { rankingApi } from '../../api/player'
import RankItem from './RankItem'

type RankType = 'asset' | 'profit'

interface RankingEntry {
  rank: number
  displayName: string
  totalAssets: number
  initialCash: number
  profitRate: number
  isCurrentUser?: boolean
}

export default function RankList() {
  const { user } = useAuthStore()
  const [rankType, setRankType] = useState<RankType>('asset')
  const [ranking, setRanking] = useState<RankingEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const data = await rankingApi.getRanking()
        const entries: RankingEntry[] = data.map((r: any, i: number) => ({
          rank: i + 1,
          displayName: r.display_name || r.displayName,
          totalAssets: r.total_assets ?? r.totalAssets ?? 0,
          initialCash: r.initial_cash ?? r.initialCash ?? 1000000,
          profitRate: r.profit_rate ?? (r.total_assets - r.initial_cash) / r.initial_cash * 100,
          isCurrentUser: r.username === user?.username,
        }))
        setRanking(entries)
      } catch {
        // ignore
      } finally {
        setLoading(false)
      }
    }
    load()
    // 每 30 秒刷新一次排行榜
    const timer = setInterval(load, 30000)
    return () => clearInterval(timer)
  }, [user])

  const sorted = [...ranking].sort((a, b) =>
    rankType === 'asset' ? b.totalAssets - a.totalAssets : b.profitRate - a.profitRate
  ).map((r, i) => ({ ...r, rank: i + 1 }))

  const playerRank = sorted.findIndex(r => r.isCurrentUser) + 1
  const topThree = sorted.slice(0, 3)

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg w-full max-w-md mx-auto p-8 text-center text-gray-400">
        加载中...
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg w-full max-w-md mx-auto">
      {/* 头部 */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <span className="text-2xl">📊</span>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">排行榜</h2>
        </div>
        <div className="text-sm text-gray-500 dark:text-gray-400">{sorted.length} 人参与</div>
      </div>

      {/* 切换标签 */}
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setRankType('asset')}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            rankType === 'asset'
              ? 'text-primary border-b-2 border-primary'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
          }`}
        >
          总资产排行
        </button>
        <button
          onClick={() => setRankType('profit')}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            rankType === 'profit'
              ? 'text-primary border-b-2 border-primary'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
          }`}
        >
          收益率排行
        </button>
      </div>

      {/* 玩家排名提示 */}
      {playerRank > 3 && (
        <div className="px-4 py-2 bg-blue-50 dark:bg-blue-900/20 text-sm text-blue-600 dark:text-blue-400">
          您的排名: 第 <span className="font-bold">{playerRank}</span> 名
        </div>
      )}

      {/* 排行榜列表 */}
      <div className="max-h-96 overflow-auto">
        {/* 前三名展示 */}
        {rankType === 'asset' && topThree.length >= 1 && (
          <div className="flex justify-center items-end gap-2 p-4 bg-gradient-to-b from-gray-50 dark:from-gray-700 to-transparent">
            {topThree[1] && (
              <div className="text-center">
                <div className="w-12 h-12 mx-auto mb-1 flex items-center justify-center text-2xl bg-gray-200 dark:bg-gray-600 rounded-full">
                  👤
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate w-16">
                  {topThree[1].displayName}
                </div>
                <div className="text-sm font-bold text-gray-700 dark:text-gray-300">
                  ¥{(topThree[1].totalAssets / 10000).toFixed(0)}万
                </div>
                <div className="text-lg">🥈</div>
              </div>
            )}
            {topThree[0] && (
              <div className="text-center">
                <div className="w-14 h-14 mx-auto mb-1 flex items-center justify-center text-3xl bg-yellow-100 dark:bg-yellow-900/40 rounded-full border-2 border-yellow-400">
                  👤
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate w-20">
                  {topThree[0].displayName}
                </div>
                <div className="text-sm font-bold text-yellow-600 dark:text-yellow-400">
                  ¥{(topThree[0].totalAssets / 10000).toFixed(0)}万
                </div>
                <div className="text-2xl">🥇</div>
              </div>
            )}
            {topThree[2] && (
              <div className="text-center">
                <div className="w-12 h-12 mx-auto mb-1 flex items-center justify-center text-2xl bg-orange-100 dark:bg-orange-900/40 rounded-full">
                  👤
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate w-16">
                  {topThree[2].displayName}
                </div>
                <div className="text-sm font-bold text-gray-700 dark:text-gray-300">
                  ¥{(topThree[2].totalAssets / 10000).toFixed(0)}万
                </div>
                <div className="text-lg">🥉</div>
              </div>
            )}
          </div>
        )}

        {/* 排名列表 */}
        {sorted.map((item) => (
          <RankItem
            key={item.rank}
            rank={item.rank}
            name={item.displayName}
            avatar={item.isCurrentUser ? '👤' : '🤖'}
            value={rankType === 'asset' ? item.totalAssets : item.profitRate}
            isPlayer={item.isCurrentUser}
            rankType={rankType}
          />
        ))}

        {sorted.length === 0 && (
          <div className="p-8 text-center text-gray-400">暂无排名数据</div>
        )}
      </div>
    </div>
  )
}
