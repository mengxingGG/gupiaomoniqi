import { create } from 'zustand'
import { tradeApi } from '../api/trade'
import { loanApi, achievementApi } from '../api/player'
import { useAuthStore } from './useAuthStore'

interface Position {
  id: string
  playerId: string
  stockCode: string
  stockName: string
  market: string
  quantity: number
  availableQuantity: number
  averageCost: number
  totalCost: number
  buyDate: number
}

interface Order {
  id: string
  playerId: string
  stockCode: string
  stockName: string
  type: 'BUY' | 'SELL'
  orderMode: 'MARKET' | 'LIMIT'
  quantity: number
  price?: number
  executedPrice?: number
  status: 'PENDING' | 'EXECUTED' | 'CANCELLED'
  fee: number
  createdAt: number
  executedAt?: number
}

interface Transaction {
  id: string
  stockCode: string
  stockName: string
  type: 'BUY' | 'SELL'
  quantity: number
  price: number
  total: number
  fee: number
  createdAt: number
}

interface Loan {
  id: string
  playerId: string
  principal: number
  interest: number
  annualRate: number
  status: 'ACTIVE' | 'REPAID'
  borrowDate: number
  lastInterestDate: number
  lastInterestAt: number
}

interface Achievement {
  id: string
  name: string
  description: string
  icon?: string
  reward?: number
  unlocked: boolean
  unlockedAt?: number
}

interface GameState {
  positions: Position[]
  orders: Order[]
  transactions: Transaction[]
  loans: Loan[]
  achievements: Achievement[]

  fetchPositions: () => Promise<void>
  fetchOrders: (status?: string) => Promise<void>
  fetchTransactions: (limit?: number) => Promise<void>
  fetchLoans: () => Promise<void>
  fetchAchievements: () => Promise<void>

  buy: (input: { stockCode: string; quantity: number; orderMode: 'MARKET' | 'LIMIT'; price?: number }) => Promise<void>
  sell: (input: { stockCode: string; quantity: number; orderMode: 'MARKET' | 'LIMIT'; price?: number }) => Promise<void>
  cancelOrder: (orderId: string) => Promise<void>

  borrow: (amount: number) => Promise<void>
  repay: (loanId: string, amount: number) => Promise<void>
}

const mapPosition = (p: any): Position => ({
  id: p.id,
  playerId: p.player_id,
  stockCode: p.stock_code,
  stockName: p.stock_name,
  market: p.market,
  quantity: p.quantity,
  availableQuantity: p.available_quantity,
  averageCost: p.average_cost,
  totalCost: p.total_cost,
  buyDate: p.buy_date,
})

const mapOrder = (o: any): Order => ({
  id: o.id,
  playerId: o.player_id,
  stockCode: o.stock_code,
  stockName: o.stock_name,
  type: o.type,
  orderMode: o.order_mode,
  quantity: o.quantity,
  price: o.price,
  executedPrice: o.executed_price,
  status: o.status,
  fee: o.fee,
  createdAt: o.created_at,
  executedAt: o.executed_at,
})

const mapTransaction = (t: any): Transaction => ({
  id: t.id,
  stockCode: t.stock_code,
  stockName: t.stock_name,
  type: t.type,
  quantity: t.quantity,
  price: t.price,
  total: t.total,
  fee: t.fee,
  createdAt: t.created_at,
})

const mapLoan = (l: any): Loan => ({
  id: l.id,
  playerId: l.player_id ?? l.playerId ?? '',
  principal: l.principal,
  interest: l.interest,
  annualRate: l.annual_rate ?? l.annualRate,
  status: l.status,
  borrowDate: l.borrow_date ?? l.borrowDate,
  lastInterestDate: l.last_interest_at ?? l.lastInterestDate ?? l.borrow_date ?? l.borrowDate,
  lastInterestAt: l.last_interest_at ?? l.lastInterestAt,
})

export const useGameStore = create<GameState>((set) => ({
  positions: [],
  orders: [],
  transactions: [],
  loans: [],
  achievements: [],

  fetchPositions: async () => {
    const positions = await tradeApi.getPositions()
    set({ positions: positions.map(mapPosition) })
  },

  fetchOrders: async (status) => {
    const orders = await tradeApi.getOrders(status)
    set({ orders: orders.map(mapOrder) })
  },

  fetchTransactions: async (limit = 50) => {
    const transactions = await tradeApi.getTransactions(limit)
    set({ transactions: transactions.map(mapTransaction) })
  },

  fetchLoans: async () => {
    const loans = await loanApi.getLoans()
    set({ loans: loans.map(mapLoan) })
  },

  fetchAchievements: async () => {
    const achievements = await achievementApi.getAchievements()
    set({ achievements })
  },

  buy: async (input) => {
    const result = await tradeApi.buy(input)
    useAuthStore.getState().setPlayer(result.player)
    // 刷新持仓和订单
    const positions = await tradeApi.getPositions()
    const orders = await tradeApi.getOrders()
    set({
      positions: positions.map(mapPosition),
      orders: orders.map(mapOrder),
    })
  },

  sell: async (input) => {
    const result = await tradeApi.sell(input)
    useAuthStore.getState().setPlayer(result.player)
    const positions = await tradeApi.getPositions()
    const orders = await tradeApi.getOrders()
    set({
      positions: positions.map(mapPosition),
      orders: orders.map(mapOrder),
    })
  },

  cancelOrder: async (orderId) => {
    const result = await tradeApi.cancel(orderId)
    useAuthStore.getState().setPlayer(result.player)
    const orders = await tradeApi.getOrders()
    set({ orders: orders.map(mapOrder) })
  },

  borrow: async (amount) => {
    const result = await loanApi.borrow(amount)
    useAuthStore.getState().setPlayer(result.player)
    const loans = await loanApi.getLoans()
    set({ loans: loans.map(mapLoan) })
  },

  repay: async (loanId, amount) => {
    const result = await loanApi.repay(loanId, amount)
    useAuthStore.getState().setPlayer(result.player)
    const loans = await loanApi.getLoans()
    set({ loans: loans.map(mapLoan) })
  },
}))
