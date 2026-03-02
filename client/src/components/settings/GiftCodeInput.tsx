import { useState } from 'react'
import { giftCodeApi } from '../../api/player'
import { useAuthStore } from '../../store/useAuthStore'

export default function GiftCodeInput() {
  const { setPlayer } = useAuthStore()
  const [code, setCode] = useState('')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [loading, setLoading] = useState(false)

  const handleRedeem = async () => {
    if (!code.trim()) {
      setMessage({ type: 'error', text: '请输入礼包码' })
      return
    }

    setLoading(true)
    setMessage(null)

    try {
      const data = await giftCodeApi.redeem(code.trim())
      setPlayer(data.player)
      const reward = data.reward
      setMessage({
        type: 'success',
        text: `兑换成功! 获得 ¥${reward?.amount?.toLocaleString() || '奖励'}`,
      })
      setCode('')
    } catch (err: any) {
      const msg = err?.response?.data?.error || '礼包码无效或已使用'
      setMessage({ type: 'error', text: msg })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          输入礼包码
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="请输入礼包码"
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white uppercase"
            onKeyDown={(e) => e.key === 'Enter' && handleRedeem()}
          />
          <button
            onClick={handleRedeem}
            disabled={loading || !code.trim()}
            className="px-4 py-2 bg-primary hover:bg-primary-hover disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
          >
            {loading ? '兑换中...' : '兑换'}
          </button>
        </div>
      </div>

      {message && (
        <div
          className={`p-3 rounded-lg text-sm ${
            message.type === 'success'
              ? 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400'
              : 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="text-xs text-gray-500 dark:text-gray-400">
        <p>提示: 礼包码不区分大小写，每个账号只能使用一次。</p>
      </div>
    </div>
  )
}
