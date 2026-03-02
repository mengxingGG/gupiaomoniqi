import { useState } from 'react'
import type { Loan } from '../../core/models/Loan'

interface LoanRecordProps {
  loan: Loan
  availableCash: number
  onRepay: (amount: number) => void
}

export default function LoanRecord({ loan, availableCash, onRepay }: LoanRecordProps) {
  const [repayAmount, setRepayAmount] = useState(loan.principal + loan.interest)

  // 计算应还金额
  const totalDebt = loan.principal + loan.interest

  // 快速还款金额
  const quickAmounts = [
    { label: '还一半', amount: Math.floor(totalDebt / 2) },
    { label: '还清', amount: totalDebt },
  ]

  return (
    <div className="p-4 border-b border-gray-100 dark:border-gray-700">
      {/* 借款信息 */}
      <div className="flex justify-between items-start mb-3">
        <div>
          <div className="font-medium text-gray-900 dark:text-white">
            借款 ¥{loan.principal.toLocaleString()}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            利率: {loan.annualRate * 100}%/年
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-bold text-red-500">
            应还: ¥{totalDebt.toLocaleString()}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            本金: ¥{loan.principal.toLocaleString()} | 利息: ¥{loan.interest.toFixed(0)}
          </div>
        </div>
      </div>

      {/* 还款输入 */}
      <div className="mb-3">
        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
          还款金额
        </label>
        <div className="flex gap-2">
          <input
            type="number"
            value={repayAmount}
            onChange={(e) =>
              setRepayAmount(
                Math.max(0, Math.min(totalDebt, parseInt(e.target.value) || 0))
              )
            }
            className="flex-1 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
        </div>

        {/* 快速选择 */}
        <div className="flex gap-2 mt-1">
          {quickAmounts.map((item) => (
            <button
              key={item.label}
              onClick={() => setRepayAmount(item.amount)}
              className="flex-1 py-1 text-xs bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* 还款按钮 */}
      <button
        onClick={() => onRepay(repayAmount)}
        disabled={repayAmount <= 0 || repayAmount > availableCash}
        className="w-full py-2 bg-green-500 hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
      >
        {repayAmount > availableCash ? '资金不足' : '确认还款'}
      </button>

      {/* 可用资金提示 */}
      <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 text-center">
        可用资金: ¥{availableCash.toLocaleString()}
      </div>
    </div>
  )
}
