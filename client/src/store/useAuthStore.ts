import { create } from 'zustand'
import { authApi } from '../api/auth'

interface User {
  userId: string
  username: string
  displayName: string
}

interface PlayerData {
  id: string
  cash: number
  initialCash: number
  totalAssets: number
  tradingDay: number
  isPaused: number
  updatedAt: number
}

// Map snake_case server player data to camelCase
function mapPlayer(p: any): PlayerData {
  if (!p) return p
  return {
    id: p.id,
    cash: p.cash,
    initialCash: p.initial_cash ?? p.initialCash ?? 1000000,
    totalAssets: p.total_assets ?? p.totalAssets ?? p.cash,
    tradingDay: p.trading_day ?? p.tradingDay ?? 1,
    isPaused: p.is_paused ?? p.isPaused ?? 0,
    updatedAt: p.updated_at ?? p.updatedAt ?? Date.now(),
  }
}

interface AuthState {
  token: string | null
  user: User | null
  player: PlayerData | null
  isLoading: boolean

  login: (username: string, password: string) => Promise<void>
  register: (username: string, password: string, displayName: string) => Promise<void>
  logout: () => Promise<void>
  fetchMe: () => Promise<void>
  setPlayer: (player: PlayerData) => void
  clearAuth: () => void
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: localStorage.getItem('token'),
  user: null,
  player: null,
  isLoading: false,

  login: async (username, password) => {
    set({ isLoading: true })
    try {
      const data = await authApi.login({ username, password })
      localStorage.setItem('token', data.token)
      set({ token: data.token, user: data.user, player: mapPlayer(data.player), isLoading: false })
    } catch (err) {
      set({ isLoading: false })
      throw err
    }
  },

  register: async (username, password, displayName) => {
    set({ isLoading: true })
    try {
      const data = await authApi.register({ username, password, displayName })
      localStorage.setItem('token', data.token)
      set({ token: data.token, user: data.user, player: mapPlayer(data.player), isLoading: false })
    } catch (err) {
      set({ isLoading: false })
      throw err
    }
  },

  logout: async () => {
    try {
      await authApi.logout()
    } finally {
      localStorage.removeItem('token')
      set({ token: null, user: null, player: null })
    }
  },

  fetchMe: async () => {
    set({ isLoading: true })
    try {
      const data = await authApi.me()
      set({ user: data.user, player: mapPlayer(data.player), isLoading: false })
    } catch (err) {
      localStorage.removeItem('token')
      set({ token: null, user: null, player: null, isLoading: false })
    }
  },

  setPlayer: (player) => set({ player: mapPlayer(player) }),

  clearAuth: () => {
    localStorage.removeItem('token')
    set({ token: null, user: null, player: null })
  },
}))
