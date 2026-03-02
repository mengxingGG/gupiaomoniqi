import { useEffect, useState } from 'react'
import { useAuthStore } from './store/useAuthStore'
import { useMarketStore } from './store/useMarketStore'
import { useGameStore } from './store/useGameStore'
import { useWebSocket } from './hooks/useWebSocket'
import LoginPage from './pages/LoginPage'
import MainLayout from './components/layout/MainLayout'

function AppContent() {
  const { token, fetchMe } = useAuthStore()
  const { fetchStocks } = useMarketStore()
  const { fetchPositions, fetchOrders, fetchLoans, fetchTransactions } = useGameStore()
  const [initializing, setInitializing] = useState(true)

  // Connect WebSocket for real-time price updates
  useWebSocket()

  useEffect(() => {
    const init = async () => {
      if (token) {
        try {
          await fetchMe()
          // Load initial data in parallel
          await Promise.all([
            fetchStocks(),
            fetchPositions(),
            fetchOrders(),
            fetchLoans(),
            fetchTransactions(),
          ])
        } catch {
          // fetchMe failure means invalid token - handled by axios interceptor (401 -> logout)
        }
      } else {
        // No token, still load market data for display
        try {
          await fetchStocks()
        } catch {
          // ignore
        }
      }
      setInitializing(false)
    }
    init()
  }, [token])

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

  if (!token) {
    return <LoginPage />
  }

  return <MainLayout />
}

export default function App() {
  return <AppContent />
}
