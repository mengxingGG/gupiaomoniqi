import OrderList from '../components/trade/OrderList'

export default function OrdersPage() {
  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-800 overflow-hidden">
      <div className="px-4 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <h2 className="text-base font-bold text-gray-900 dark:text-white">委托管理</h2>
        <p className="text-xs text-gray-500 mt-0.5">限价委托中的资金/持仓已冻结，可随时撤单解冻</p>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <OrderList />
      </div>
    </div>
  )
}
