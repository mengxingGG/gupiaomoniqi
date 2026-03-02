import { useState, useEffect } from 'react'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import Modal from '../common/Modal'
import GiftCodeInput from '../settings/GiftCodeInput'

export default function Header() {
  const { user, player, logout } = useAuthStore()
  const { toggleTheme, theme, toggleSidebar, setActiveModal } = useUIStore()
  const [showGiftCode, setShowGiftCode] = useState(false)
  const [clock, setClock] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const formatMoney = (amount: number) =>
    new Intl.NumberFormat('zh-CN', {
      style: 'currency', currency: 'CNY',
      minimumFractionDigits: 0, maximumFractionDigits: 0,
    }).format(amount)

  const clockTime = clock.toLocaleTimeString('zh-CN', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  })

  const profitRate = player
    ? ((player.totalAssets - player.initialCash) / player.initialCash) * 100
    : 0

  const handleLogout = async () => {
    await logout()
  }

  return (
    <>
      <header className="flex items-center justify-between h-12 px-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shrink-0">
        {/* 左侧 */}
        <div className="flex items-center gap-3">
          <button
            onClick={toggleSidebar}
            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
            title="切换侧边栏"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16"/>
            </svg>
          </button>
          <span className="text-sm font-bold text-primary">股市模拟器 2.0</span>
          {/* 实时时钟 */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 bg-gray-50 dark:bg-gray-700 rounded">
            <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-green-500 animate-pulse" />
            <span className="font-mono text-sm font-bold text-gray-800 dark:text-gray-100 tabular-nums tracking-wide">
              {clockTime}
            </span>
          </div>
          {user && (
            <div className="hidden md:flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <span>{user.displayName}</span>
              {player && (
                <>
                  <span className="text-gray-200 dark:text-gray-600">|</span>
                  <span>第{player.tradingDay}交易日</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* 右侧 */}
        <div className="flex items-center gap-1.5">
          {/* 资产信息 */}
          {player && (
            <div className="hidden sm:flex items-center gap-4 mr-2">
              <div className="text-right">
                <div className="text-[10px] text-gray-400">总资产</div>
                <div className="text-sm font-bold text-up font-number tabular-nums">{formatMoney(player.totalAssets)}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-gray-400">收益率</div>
                <div className={`text-sm font-bold font-number tabular-nums ${profitRate >= 0 ? 'text-up' : 'text-down'}`}>
                  {profitRate >= 0 ? '+' : ''}{profitRate.toFixed(2)}%
                </div>
              </div>
            </div>
          )}

          {/* 礼包码 */}
          <button
            onClick={() => setShowGiftCode(true)}
            className="px-2 py-1 text-xs rounded bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 hover:bg-amber-100 border border-amber-200 dark:border-amber-700"
            title="兑换礼包码"
          >
            🎁 礼包码
          </button>

          {/* 主题切换 */}
          <button onClick={toggleTheme} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500" title="切换主题">
            {theme === 'light' ? '🌙' : '☀️'}
          </button>

          {/* 设置 */}
          <button
            onClick={() => setActiveModal('settings')}
            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
            title="设置"
          >
            ⚙️
          </button>

          {/* 退出登录 */}
          <button
            onClick={handleLogout}
            className="px-2 py-1 text-xs rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
            title="退出登录"
          >
            退出
          </button>
        </div>
      </header>

      {/* 礼包码 Modal */}
      <Modal isOpen={showGiftCode} onClose={() => setShowGiftCode(false)} title="🎁 兑换礼包码" size="md">
        <GiftCodeInput />
      </Modal>
    </>
  )
}
