import axios from 'axios'

// API 配置
const API_BASE_URL = 'http://122.51.4.46'  // 通过80端口代理
const API_KEY = 'fbd12ccc6e459d8dce75897fd3d57972'

// 创建 axios 实例
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'X-API-Key': API_KEY,
    'Content-Type': 'application/json',
  },
})

// 请求拦截器：添加 JWT Token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// 响应拦截器：处理错误
api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      // Token 过期，清除登录状态
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

// 认证 API
export const authApi = {
  login: (username: string, password: string) =>
    api.post('/api/auth/login', { username, password }),
  
  register: (username: string, password: string, displayName: string) =>
    api.post('/api/auth/register', { username, password, displayName }),
  
  getProfile: () => api.get('/api/auth/me'),
}

// 股票市场 API
export const marketApi = {
  getStocks: () => api.get('/api/market/stocks'),
  
  getStock: (code: string) => api.get(`/api/market/stock/${code}`),
  
  getTimeline: (code: string) => api.get(`/api/market/stock/${code}/timeline`),
  
  getDaily: (code: string) => api.get(`/api/market/stock/${code}/daily`),
}

// 交易 API
export const tradeApi = {
  buy: (stockCode: string, quantity: number) =>
    api.post('/api/trade/buy', { stockCode, quantity }),
  
  sell: (stockCode: string, quantity: number) =>
    api.post('/api/trade/sell', { stockCode, quantity }),
}

// 玩家 API
export const playerApi = {
  getPortfolio: () => api.get('/api/player/portfolio'),
  
  getOrders: () => api.get('/api/orders'),
  
  getPositions: () => api.get('/api/positions'),
}

export default api
