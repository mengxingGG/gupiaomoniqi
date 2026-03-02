import { useState } from 'react'
import { useAuthStore } from '../store/useAuthStore'

type Mode = 'login' | 'register'

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState('')
  const { login, register, isLoading } = useAuthStore()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    try {
      if (mode === 'login') {
        await login(username, password)
      } else {
        if (!displayName.trim()) {
          setError('请输入显示名称')
          return
        }
        await register(username, password, displayName)
      }
    } catch (err: any) {
      const msg = err?.response?.data?.error
      if (msg) {
        setError(msg)
      } else if (mode === 'login') {
        setError('用户名或密码错误')
      } else {
        setError('注册失败，请检查输入')
      }
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="text-4xl mb-2">📈</div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">股市模拟器 2.0</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">体验真实的股票交易，无风险学习投资</p>
        </div>

        {/* 表单卡片 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8">
          {/* 切换登录/注册 */}
          <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600 mb-6">
            <button
              onClick={() => { setMode('login'); setError('') }}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                mode === 'login'
                  ? 'bg-primary text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-500 hover:bg-gray-50'
              }`}
            >
              登录
            </button>
            <button
              onClick={() => { setMode('register'); setError('') }}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                mode === 'register'
                  ? 'bg-primary text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-500 hover:bg-gray-50'
              }`}
            >
              注册
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* 显示名称（仅注册） */}
            {mode === 'register' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  显示名称
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="将显示在排行榜中（1-50字符）"
                  maxLength={50}
                  required
                  className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            )}

            {/* 用户名 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                用户名
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={mode === 'register' ? '3-20个字符，用于登录' : '输入用户名'}
                minLength={mode === 'register' ? 3 : 1}
                maxLength={20}
                required
                className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* 密码 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                密码
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'register' ? '至少6位' : '输入密码'}
                minLength={mode === 'register' ? 6 : 1}
                required
                className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* 错误提示 */}
            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-900/30 rounded-lg text-sm text-red-600 dark:text-red-400">
                {error}
              </div>
            )}

            {/* 提交按钮 */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 bg-primary hover:bg-primary-hover disabled:bg-gray-300 text-white font-medium rounded-lg transition-colors disabled:cursor-not-allowed"
            >
              {isLoading ? '处理中...' : mode === 'login' ? '登录' : '注册并开始游戏'}
            </button>
          </form>

          {/* 提示 */}
          {mode === 'register' && (
            <p className="mt-4 text-xs text-center text-gray-500 dark:text-gray-400">
              注册即获得 <span className="font-bold text-primary">¥1,000,000</span> 初始资金，开启你的投资之旅
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
