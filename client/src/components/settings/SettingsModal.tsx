import { useState } from 'react'
import { useUIStore } from '../../store/useUIStore'
import { useAuthStore } from '../../store/useAuthStore'
import { playerApi } from '../../api/player'
import GiftCodeInput from './GiftCodeInput'
import ThemeSwitch from './ThemeSwitch'
import HelpPanel from './HelpPanel'

export default function SettingsModal() {
  const { setActiveModal } = useUIStore()
  const { user, player, logout } = useAuthStore()
  const [activeTab, setActiveTab] = useState<'settings' | 'gift' | 'theme' | 'help'>('settings')

  const handleClose = () => setActiveModal(null)

  const handleDeleteAccount = async () => {
    if (confirm('确定要注销账号吗？此操作将删除所有数据，不可恢复！')) {
      try {
        await playerApi.deleteAccount()
        await logout()
      } catch {
        alert('注销失败，请重试')
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">设置</h2>
          <button onClick={handleClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">✕</button>
        </div>

        {/* Tab 导航 */}
        <div className="flex border-b border-gray-200 dark:border-gray-700">
          {[
            { id: 'settings', label: '设置', icon: '⚙️' },
            { id: 'gift', label: '礼包码', icon: '🎁' },
            { id: 'theme', label: '主题', icon: '🎨' },
            { id: 'help', label: '帮助', icon: '❓' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
              }`}
            >
              <span className="mr-1">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* 内容区域 */}
        <div className="p-4 overflow-auto max-h-[60vh]">
          {/* 设置 Tab */}
          {activeTab === 'settings' && (
            <div className="space-y-4">
              {/* 账户信息 */}
              {user && player && (
                <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <h3 className="font-medium text-gray-900 dark:text-white mb-2">账户信息</h3>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="text-gray-500">显示名称:</div>
                    <div className="text-gray-900 dark:text-white">{user.displayName}</div>
                    <div className="text-gray-500">用户名:</div>
                    <div className="text-gray-900 dark:text-white">{user.username}</div>
                    <div className="text-gray-500">初始资金:</div>
                    <div className="text-gray-900 dark:text-white">¥{player.initialCash.toLocaleString()}</div>
                    <div className="text-gray-500">当前交易日:</div>
                    <div className="text-gray-900 dark:text-white">第 {player.tradingDay} 日</div>
                  </div>
                </div>
              )}

              {/* 账户操作 */}
              <div>
                <h3 className="font-medium text-gray-900 dark:text-white mb-2">账户操作</h3>
                <div className="space-y-2">
                  <button
                    onClick={handleDeleteAccount}
                    className="w-full py-2 px-4 bg-red-100 dark:bg-red-900/30 hover:bg-red-200 text-red-600 rounded-lg transition-colors"
                  >
                    注销账号（删除所有数据）
                  </button>
                </div>
              </div>

              {/* 游戏信息 */}
              <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg text-sm">
                <h3 className="font-medium text-gray-900 dark:text-white mb-2">游戏信息</h3>
                <div className="space-y-1 text-gray-600 dark:text-gray-400">
                  <p>版本: 2.0.0</p>
                  <p>买卖手续费: 0.3‰</p>
                  <p>借款利率: 17%/年</p>
                  <p>数据存储: 服务端（永久保留）</p>
                </div>
              </div>
            </div>
          )}

          {/* 礼包码 Tab */}
          {activeTab === 'gift' && <GiftCodeInput />}

          {/* 主题 Tab */}
          {activeTab === 'theme' && <ThemeSwitch />}

          {/* 帮助 Tab */}
          {activeTab === 'help' && <HelpPanel />}
        </div>
      </div>
    </div>
  )
}
