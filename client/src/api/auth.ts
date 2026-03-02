import apiClient from './client'

export interface RegisterInput {
  username: string
  password: string
  displayName: string
}

export interface LoginInput {
  username: string
  password: string
}

export const authApi = {
  register: async (input: RegisterInput) => {
    const res = await apiClient.post('/auth/register', input)
    return res.data.data as { token: string; user: any; player: any }
  },

  login: async (input: LoginInput) => {
    const res = await apiClient.post('/auth/login', input)
    return res.data.data as { token: string; user: any; player: any }
  },

  logout: async () => {
    await apiClient.post('/auth/logout')
    localStorage.removeItem('token')
  },

  me: async () => {
    const res = await apiClient.get('/auth/me')
    return res.data.data as { user: any; player: any }
  },
}
