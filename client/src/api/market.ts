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

  submitAIPressure: async (pressures: { code: string; netVolume: number }[]) => {
    await apiClient.post('/market/ai-pressure', { pressures })
  },
}
