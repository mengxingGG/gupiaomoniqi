import apiClient from './client'

export interface BuyInput {
  stockCode: string
  quantity: number
  orderMode: 'MARKET' | 'LIMIT'
  price?: number
}

export interface SellInput {
  stockCode: string
  quantity: number
  orderMode: 'MARKET' | 'LIMIT'
  price?: number
}

export const tradeApi = {
  buy: async (input: BuyInput) => {
    const res = await apiClient.post('/trade/buy', input)
    return res.data.data as { order: any; player: any }
  },

  sell: async (input: SellInput) => {
    const res = await apiClient.post('/trade/sell', input)
    return res.data.data as { order: any; player: any }
  },

  cancel: async (orderId: string) => {
    const res = await apiClient.post('/trade/cancel', { orderId })
    return res.data.data as { order: any; player: any }
  },

  getOrders: async (status?: string) => {
    const params = status ? { status } : {}
    const res = await apiClient.get('/orders', { params })
    return res.data.data.orders as any[]
  },

  getPositions: async () => {
    const res = await apiClient.get('/positions')
    return res.data.data.positions as any[]
  },

  getTransactions: async (limit = 50) => {
    const res = await apiClient.get('/transactions', { params: { limit } })
    return res.data.data.transactions as any[]
  },
}
