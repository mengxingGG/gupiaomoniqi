import { create } from 'zustand'
import { marketApi } from '../api/market'

export interface StockData {
  code: string
  name: string
  market: string
  industry?: string
  currentPrice: number
  previousClose: number
  openPrice: number
  highPrice: number
  lowPrice: number
  volume: number
  turnover: number
  changePercent: number
  changeAmount: number
  priceHistory: any[]
  updatedAt: number
  lastUpdate: number  // alias for updatedAt, for compatibility with Stock type
}

interface MarketState {
  stocks: StockData[]
  selectedStock: StockData | null
  marketType: string
  isConnected: boolean
  lastUpdate: number

  setStocks: (stocks: StockData[]) => void
  updateStockPrice: (update: Partial<StockData> & { code: string }) => void
  selectStock: (stock: StockData | null) => void
  setMarketType: (type: string) => void
  setConnected: (connected: boolean) => void
  fetchStocks: () => Promise<void>
}

export const useMarketStore = create<MarketState>((set, get) => ({
  stocks: [],
  selectedStock: null,
  marketType: 'ALL',
  isConnected: false,
  lastUpdate: 0,

  setStocks: (stocks) => set({ stocks }),

  updateStockPrice: (update) => {
    set((state) => {
      const idx = state.stocks.findIndex((s) => s.code === update.code)
      if (idx === -1) return {}

      const newStocks = [...state.stocks]
      newStocks[idx] = { ...newStocks[idx], ...update }

      const selectedStock =
        state.selectedStock?.code === update.code
          ? { ...state.selectedStock, ...update }
          : state.selectedStock

      return { stocks: newStocks, selectedStock, lastUpdate: Date.now() }
    })
  },

  selectStock: (stock) => set({ selectedStock: stock }),

  setMarketType: (type) => set({ marketType: type }),

  setConnected: (connected) => set({ isConnected: connected }),

  fetchStocks: async () => {
    try {
      const stocks = await marketApi.getStocks()
      // 后端返回 snake_case，转换为 camelCase
      const mapped: StockData[] = stocks.map((s: any) => ({
        code: s.code,
        name: s.name,
        market: s.market,
        industry: s.industry,
        currentPrice: s.current_price,
        previousClose: s.previous_close,
        openPrice: s.open_price,
        highPrice: s.high_price,
        lowPrice: s.low_price,
        volume: s.volume,
        turnover: s.turnover,
        changePercent: s.change_percent,
        changeAmount: s.change_amount,
        priceHistory: s.price_history ? JSON.parse(s.price_history) : [],
        updatedAt: s.updated_at,
        lastUpdate: s.updated_at,
      }))
      set({ stocks: mapped })
    } catch (err) {
      console.error('Failed to fetch stocks:', err)
    }
  },
}))
