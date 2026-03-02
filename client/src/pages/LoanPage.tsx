import LoanPanel from '../components/loan/LoanPanel'

export default function LoanPage() {
  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-900 overflow-hidden">
      <div className="px-4 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-base font-bold text-gray-900 dark:text-white">💳 融资借贷</h2>
      </div>
      <div className="flex-1 overflow-auto p-4 max-w-2xl mx-auto w-full">
        <LoanPanel />
      </div>
    </div>
  )
}
