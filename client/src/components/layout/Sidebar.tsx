import { useUIStore, type Page } from '../../store/useUIStore'
import { useGameStore } from '../../store/useGameStore'
import { useAuthStore } from '../../store/useAuthStore'

const menuItems: { id: Page; label: string; icon: string }[] = [
  { id: 'trading',     label: '行情交易', icon: '📈' },
  { id: 'portfolio',   label: '我的持仓', icon: '💼' },
  { id: 'orders',      label: '委托管理', icon: '📋' },
  { id: 'history',     label: '成交记录', icon: '📜' },
  { id: 'loan',        label: '融资借贷', icon: '💳' },
  { id: 'achievement', label: '成就系统', icon: '🏆' },
  { id: 'ranking',     label: '财富排行', icon: '📊' },
]

export default function Sidebar() {
  const { currentPage, setCurrentPage } = useUIStore()
  const { positions, transactions, loans } = useGameStore()
  const { player } = useAuthStore()

  const badges: Partial<Record<Page, number>> = {
    portfolio: positions.length,
    history:   transactions.length,
    loan:      loans.filter(l => l.status === 'ACTIVE').length,
  }

  return (
    <aside className="w-44 shrink-0 flex flex-col bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700">
      <nav className="flex-1 py-2 px-2 space-y-0.5">
        {menuItems.map((item) => {
          const isActive = currentPage === item.id
          const badge = badges[item.id]
          return (
            <button
              key={item.id}
              onClick={() => setCurrentPage(item.id)}
              className={`w-full flex items-center justify-between px-3 py-2.5 text-sm rounded-lg transition-colors ${
                isActive
                  ? 'bg-primary/10 text-primary font-medium border-l-2 border-primary'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <span className="text-base">{item.icon}</span>
                <span>{item.label}</span>
              </span>
              {badge !== undefined && badge > 0 && (
                <span className="px-1.5 py-0.5 text-[10px] bg-primary text-white rounded-full min-w-[18px] text-center">
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      {/* 底部资产显示 */}
      {player && (
        <div className="px-3 py-3 border-t border-gray-200 dark:border-gray-700">
          <div className="text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">可用资金</div>
          <div className="font-bold text-sm text-gray-900 dark:text-white font-number tabular-nums">
            ¥{player.cash.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}
          </div>
        </div>
      )}
    </aside>
  )
}
