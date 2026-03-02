import apiClient from './client'

export const playerApi = {
  getMe: async () => {
    const res = await apiClient.get('/player/me')
    return res.data.data as { user: any; player: any; positions: any[]; loans: any[] }
  },

  deleteAccount: async () => {
    await apiClient.delete('/player/me')
  },
}

export const loanApi = {
  borrow: async (amount: number) => {
    const res = await apiClient.post('/loan/borrow', { amount })
    return res.data.data as { loan: any; player: any }
  },

  repay: async (loanId: string, amount: number) => {
    const res = await apiClient.post('/loan/repay', { loanId, amount })
    return res.data.data as { loan: any; player: any }
  },

  getLoans: async () => {
    const res = await apiClient.get('/loans')
    return res.data.data.loans as any[]
  },
}

export const giftCodeApi = {
  redeem: async (code: string) => {
    const res = await apiClient.post('/giftcode/redeem', { code })
    return res.data.data as { player: any; reward: any }
  },
}

export const rankingApi = {
  getRanking: async () => {
    const res = await apiClient.get('/ranking')
    return res.data.data.ranking as any[]
  },
}

export const achievementApi = {
  getAchievements: async () => {
    const res = await apiClient.get('/achievements')
    return res.data.data.achievements as any[]
  },
}
