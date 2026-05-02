import { lazy, Suspense } from 'react'
import Header from './Header'
import Sidebar from './Sidebar'
import { useUIStore } from '../../store/useUIStore'
import SettingsModal from '../settings/SettingsModal'

const TradingPage    = lazy(() => import('../../pages/TradingPage'))
const PortfolioPage  = lazy(() => import('../../pages/PortfolioPage'))
const OrdersPage     = lazy(() => import('../../pages/OrdersPage'))
const HistoryPage    = lazy(() => import('../../pages/HistoryPage'))
const LoanPage       = lazy(() => import('../../pages/LoanPage'))
const AchievementPage = lazy(() => import('../../pages/AchievementPage'))
const RankingPage    = lazy(() => import('../../pages/RankingPage'))

function PageFallback() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

export default function MainLayout() {
  const { sidebarOpen, currentPage, activeModal, setActiveModal } = useUIStore()

  return (
    <div className="flex flex-col h-screen bg-gray-100 dark:bg-gray-900 overflow-hidden">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        {sidebarOpen && <Sidebar />}
        <main className="flex-1 overflow-hidden">
          <Suspense fallback={<PageFallback />}>
            {currentPage === 'trading'     && <TradingPage />}
            {currentPage === 'portfolio'   && <PortfolioPage />}
            {currentPage === 'orders'      && <OrdersPage />}
            {currentPage === 'history'     && <HistoryPage />}
            {currentPage === 'loan'        && <LoanPage />}
            {currentPage === 'achievement' && <AchievementPage />}
            {currentPage === 'ranking'     && <RankingPage />}
          </Suspense>
        </main>
      </div>

      {/* 设置覆盖层 */}
      {activeModal === 'settings' && (
        <SettingsModal />
      )}
    </div>
  )
}
