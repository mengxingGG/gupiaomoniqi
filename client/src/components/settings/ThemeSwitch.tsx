import { useUIStore } from '../../store/useUIStore'

export default function ThemeSwitch() {
  const { theme, setTheme, toggleTheme } = useUIStore()

  const themes = [
    { value: 'light', label: '浅色', icon: '☀️', description: '白天模式' },
    { value: 'dark', label: '深色', icon: '🌙', description: '夜间模式' },
  ]

  return (
    <div className="space-y-4">
      {/* 主题选择 */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          选择主题
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {themes.map((t) => (
            <button
              key={t.value}
              onClick={() => setTheme(t.value as 'light' | 'dark')}
              className={`p-4 rounded-lg border-2 transition-all ${
                theme === t.value
                  ? 'border-primary bg-primary/10'
                  : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'
              }`}
            >
              <div className="text-3xl mb-1">{t.icon}</div>
              <div className="font-medium text-gray-900 dark:text-white">{t.label}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">{t.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* 快速切换 */}
      <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
        <div>
          <div className="font-medium text-gray-900 dark:text-white">快速切换</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            一键切换浅色/深色模式
          </div>
        </div>
        <button
          onClick={toggleTheme}
          className="px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg transition-colors"
        >
          切换
        </button>
      </div>

      {/* 涨跌颜色设置 */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          涨跌颜色说明
        </h3>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="w-4 h-4 rounded bg-up"></span>
            <span className="text-gray-600 dark:text-gray-400">上涨 (红色)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-4 h-4 rounded bg-down"></span>
            <span className="text-gray-600 dark:text-gray-400">下跌 (绿色)</span>
          </div>
        </div>
      </div>

      {/* 系统主题跟随 */}
      <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
        <div>
          <div className="font-medium text-gray-900 dark:text-white">跟随系统</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            自动跟随系统主题设置
          </div>
        </div>
        <button
          onClick={() => {
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
            setTheme(prefersDark ? 'dark' : 'light')
          }}
          className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 rounded transition-colors"
        >
          跟随系统
        </button>
      </div>
    </div>
  )
}
