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
  timeline: any[]    // 分时数据
  dailyK: any[]      // 日K数据
  updatedAt: number
  lastUpdate: number  // alias for updatedAt, for compatibility with Stock type
}

interface MarketState {
  stocks: StockData[]
  selectedStock: StockData | null
  marketType: string
  isConnected: boolean
  lastUpdate: number
  loadingDetail: boolean

  setStocks: (stocks: StockData[]) => void
  updateStockPrice: (update: Partial<StockData> & { code: string }) => void
  selectStock: (stock: StockData | null) => void
  clearStockDetail: () => void  // 释放当前股票详情数据
  setMarketType: (type: string) => void
  setConnected: (connected: boolean) => void
  fetchStocks: () => Promise<void>
  fetchStockDetail: (code: string) => Promise<void>
}

export const useMarketStore = create<MarketState>((set, get) => ({
  stocks: [],
  selectedStock: null,
  marketType: 'ALL',
  isConnected: false,
  lastUpdate: 0,
  loadingDetail: false,

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

  // 释放当前股票详情数据，释放内存
  clearStockDetail: () => {
    const current = get().selectedStock
    if (current) {
      // 清空大数据字段，释放内存
      set({
        selectedStock: {
          ...current,
          timeline: [],
          dailyK: [],
          priceHistory: [],
        }
      })
    }
  },

  setMarketType: (type) => set({ marketType: type }),

  setConnected: (connected) => set({ isConnected: connected }),

  fetchStocks: async () => {
    try {
      const stocks = await marketApi.getStocks()
      // 后端返回 snake_case，转换为 camelCase（不含历史数据）
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
        priceHistory: [],
        timeline: [],
        dailyK: [],
        updatedAt: s.updated_at,
        lastUpdate: s.updated_at,
      }))
      set({ stocks: mapped })
    } catch (err) {
      console.error('Failed to fetch stocks:', err)
    }
  },

  fetchStockDetail: async (code: string) => {
    set({ loadingDetail: true })
    try {
      // 并行获取分时和日K数据（带 limit 参数，按需获取）
      const [timeline, dailyK] = await Promise.all([
        marketApi.getTimeline(code, 120),  // 最近 120 条分时数据
        marketApi.getKline(code, 100, '1h'),  // 最近 100 根小时K线
      ])
      
      // 从 stocks 列表获取基本信息
      const basicInfo = get().stocks.find(s => s.code === code)
      
      const detail: StockData = {
        code,
        name: basicInfo?.name || '',
        market: basicInfo?.market || '',
        currentPrice: basicInfo?.currentPrice || 0,
        previousClose: basicInfo?.previousClose || 0,
        openPrice: basicInfo?.openPrice || 0,
        highPrice: basicInfo?.highPrice || 0,
        lowPrice: basicInfo?.lowPrice || 0,
        volume: basicInfo?.volume || 0,
        turnover: basicInfo?.turnover || 0,
        changePercent: basicInfo?.changePercent || 0,
        changeAmount: basicInfo?.changeAmount || 0,
        priceHistory: [],
        timeline,
        dailyK,
        updatedAt: Date.now(),
        lastUpdate: Date.now(),
      }
      
      set({
        selectedStock: detail,
        loadingDetail: false,
      })
    } catch (err) {
      console.error('Failed to fetch stock detail:', err)
      set({ loadingDetail: false })
    }
  },
}))
