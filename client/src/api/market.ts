import apiClient from './client'

export const marketApi = {
  getStocks: async () => {
    const res = await apiClient.get('/market/stocks')
    return res.data.data.stocks as any[]
  },

  getStock: async (code: string) => {
    const res = await apiClient.get(`/market/stock/${code}`)
    return res.data.data.stock as any
  },

  // 分时数据：按需获取，默认最近 120 条（约 1 小时）
  getTimeline: async (code: string, limit: number = 120) => {
    const res = await apiClient.get(`/market/stock/${code}/timeline`, {
      params: { limit }
    })
    return res.data.data.timeline as any[]
  },

  // K线数据：支持多周期，按需获取
  // period: '1m' | '5m' | '15m' | '1h' | '1d'
  getKline: async (code: string, limit: number = 100, period: string = '1h') => {
    const res = await apiClient.get(`/market/stock/${code}/kline`, {
      params: { limit, period }
    })
    return res.data.data.kline as any[]
  },

  // 日K数据（旧接口，保留兼容）
  getDailyK: async (code: string) => {
    const res = await apiClient.get(`/market/stock/${code}/daily`)
    return res.data.data.daily as any[]
  },

  submitAIPressure: async (pressures: { code: string; netVolume: number }[]) => {
    await apiClient.post('/market/ai-pressure', { pressures })
  },
}
