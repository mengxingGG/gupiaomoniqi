import { useState, useMemo } from 'react'
import { useGameStore } from '../../store/useGameStore'
import { useAuthStore } from '../../store/useAuthStore'
import { GameConfig } from '../../core/constants/GameConfig'
import LoanRecord from './LoanRecord'

export default function LoanPanel() {
  const { loans, borrow, repay } = useGameStore()
  const { player } = useAuthStore()
  const [borrowAmount, setBorrowAmount] = useState(100000)
  const [activeTab, setActiveTab] = useState<'borrow' | 'repay'>('borrow')
  const [loading, setLoading] = useState(false)

  const loanInfo = useMemo(() => {
    if (!player) return null

    const totalDebt = loans.reduce((sum, loan) => sum + loan.principal + loan.interest, 0)
    const maxAmount = player.initialCash * GameConfig.LOAN_MULTIPLIER
    const available = maxAmount - totalDebt

    return {
      maxAmount,
      totalDebt,
      available,
      hasLoan: loans.length > 0,
      activeLoans: loans.filter((l) => l.status === 'ACTIVE'),
    }
  }, [player, loans])

  const handleBorrow = async () => {
    if (!player || !loanInfo) return
    if (borrowAmount <= 0) { alert('请输入正确的借款金额'); return }
    if (borrowAmount > loanInfo.available) { alert('超过可借款额度'); return }

    setLoading(true)
    try {
      await borrow(borrowAmount)
      setBorrowAmount(100000)
      alert(`借款成功! 获得 ¥${borrowAmount.toLocaleString()}`)
    } catch (err: any) {
      alert(err?.response?.data?.error || '借款失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  const handleRepay = async (loanId: string, amount: number) => {
    if (!player) return
    if (amount > player.cash) { alert('资金不足'); return }

    setLoading(true)
    try {
      await repay(loanId, amount)
      alert(`还款成功! ¥${amount.toLocaleString()}`)
    } catch (err: any) {
      alert(err?.response?.data?.error || '还款失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  const quickAmounts = [100000, 500000, 1000000, 2000000]

  if (!player || !loanInfo) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg w-full max-w-md mx-auto p-4">
        <p className="text-gray-500">加载中...</p>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg w-full max-w-md mx-auto">
      {/* 头部 */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <span className="text-2xl">💳</span>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">借贷中心</h2>
        </div>
      </div>

      {/* 借款额度信息 */}
      <div className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400">借款额度</div>
            <div className="font-bold text-gray-900 dark:text-white">
              ¥{(loanInfo.maxAmount / 10000).toFixed(0)}万
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400">已借金额</div>
            <div className="font-bold text-red-500">
              ¥{(loanInfo.totalDebt / 10000).toFixed(0)}万
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400">可用额度</div>
            <div className="font-bold text-green-500">
              ¥{(loanInfo.available / 10000).toFixed(0)}万
            </div>
          </div>
        </div>
        <div className="mt-3 text-center text-xs text-gray-500 dark:text-gray-400">
          年利率: {GameConfig.LOAN_ANNUAL_RATE * 100}%
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setActiveTab('borrow')}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            activeTab === 'borrow'
              ? 'text-primary border-b-2 border-primary'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
          }`}
        >
          借款
        </button>
        <button
          onClick={() => setActiveTab('repay')}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            activeTab === 'repay'
              ? 'text-primary border-b-2 border-primary'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
          }`}
        >
          还款 ({loanInfo.activeLoans.length})
        </button>
      </div>

      {/* 借款表单 */}
      {activeTab === 'borrow' && (
        <div className="p-4">
          <div className="mb-4">
            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-2">借款金额</label>
            <div className="flex gap-2 mb-2">
              <input
                type="number"
                value={borrowAmount}
                onChange={(e) =>
                  setBorrowAmount(Math.max(0, Math.min(loanInfo.available, parseInt(e.target.value) || 0)))
                }
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
              <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center">元</div>
            </div>
            <div className="flex gap-2">
              {quickAmounts.map((amount) => (
                <button
                  key={amount}
                  onClick={() => setBorrowAmount(Math.min(amount, loanInfo.available))}
                  disabled={amount > loanInfo.available}
                  className="flex-1 py-1 text-xs bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {amount / 10000}万
                </button>
              ))}
            </div>
          </div>

          <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg text-sm">
            <div className="flex justify-between mb-1">
              <span className="text-gray-600 dark:text-gray-400">借款金额</span>
              <span className="font-number">¥{borrowAmount.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">年利率</span>
              <span className="font-number">{GameConfig.LOAN_ANNUAL_RATE * 100}%</span>
            </div>
          </div>

          <button
            onClick={handleBorrow}
            disabled={loading || borrowAmount <= 0 || borrowAmount > loanInfo.available}
            className="w-full py-3 bg-primary hover:bg-primary-hover disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
          >
            {loading ? '处理中...' : '确认借款'}
          </button>
        </div>
      )}

      {/* 还款列表 */}
      {activeTab === 'repay' && (
        <div className="max-h-64 overflow-auto">
          {loanInfo.activeLoans.length === 0 ? (
            <div className="p-8 text-center text-gray-500 dark:text-gray-400">
              暂无借款记录
            </div>
          ) : (
            loanInfo.activeLoans.map((loan) => (
              <LoanRecord
                key={loan.id}
                loan={loan as any}
                availableCash={player.cash}
                onRepay={(amount) => handleRepay(loan.id, amount)}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}
