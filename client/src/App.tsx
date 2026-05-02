import { useEffect, useState } from 'react'
import { useAuthStore } from './store/useAuthStore'
import { useMarketStore } from './store/useMarketStore'
import { useGameStore } from './store/useGameStore'
import { useWebSocket } from './hooks/useWebSocket'
import LoginPage from './pages/LoginPage'
import MainLayout from './components/layout/MainLayout'

function AppContent() {
  const { token, user, fetchMe, clearAuth } = useAuthStore()
  const { fetchStocks } = useMarketStore()
  const { fetchPositions, fetchOrders, fetchLoans, fetchTransactions } = useGameStore()
  const [initializing, setInitializing] = useState(true)
  const [initStarted, setInitStarted] = useState(false)

  // Connect WebSocket for real-time price updates
  useWebSocket()

  useEffect(() => {
    // 防止重复初始化
    if (initStarted) return
    setInitStarted(true)

    const init = async () => {
      try {
        // 总是加载公开的市场数据
        await fetchStocks()
        
        // 如果有token，尝试验证并加载用户数据
        if (token) {
          try {
            await fetchMe()
            // 验证成功后加载其他数据
            await Promise.all([
              fetchPositions(),
              fetchOrders(),
              fetchLoans(),
              fetchTransactions(),
            ])
          } catch (err: any) {
            // fetchMe 失败，token无效，清除认证状态
            if (err?.response?.status === 401) {
              clearAuth()
            }
            // 其他错误忽略，保持当前状态
          }
        }
      } catch (err) {
        // 市场数据加载失败，忽略
        console.error('初始化失败:', err)
      } finally {
        setInitializing(false)
      }
    }
    
    init()
  }, [token, initStarted])

  if (initializing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-500 dark:text-gray-400">正在加载...</p>
        </div>
      </div>
    )
  }

  // 有token且用户信息已加载完成，显示主界面
  if (token && user) {
    return <MainLayout />
  }

  // 其他情况显示登录页
  return <LoginPage />
}

export default function App() {
  return <AppContent />
}
