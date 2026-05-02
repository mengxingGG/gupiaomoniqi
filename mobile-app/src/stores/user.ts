import { defineStore } from 'pinia'
import { ref } from 'vue'
import { authApi } from '../api'

interface User {
  id: number
  username: string
  displayName: string
  balance: number
  totalAssets: number
}

// 创建 store 函数
const useUserStore = defineStore('user', () => {
  const user = ref<User | null>(null)
  const token = ref<string | null>(null)
  const isLoggedIn = ref(false)

  // 初始化：从 localStorage 恢复状态
  function init() {
    const savedToken = localStorage.getItem('token')
    const savedUser = localStorage.getItem('user')
    
    if (savedToken && savedUser) {
      token.value = savedToken
      user.value = JSON.parse(savedUser)
      isLoggedIn.value = true
    }
  }

  // 登录
  async function login(username: string, password: string) {
    const res: any = await authApi.login(username, password)
    
    if (res.success) {
      token.value = res.data.token
      user.value = res.data.user
      isLoggedIn.value = true
      
      localStorage.setItem('token', res.data.token)
      localStorage.setItem('user', JSON.stringify(res.data.user))
      
      return { success: true }
    }
    
    return { success: false, error: res.error }
  }

  // 注册
  async function register(username: string, password: string, displayName: string) {
    const res: any = await authApi.register(username, password, displayName)
    
    if (res.success) {
      // 注册成功后自动登录
      return login(username, password)
    }
    
    return { success: false, error: res.error }
  }

  // 退出登录
  function logout() {
    user.value = null
    token.value = null
    isLoggedIn.value = false
    
    localStorage.removeItem('token')
    localStorage.removeItem('user')
  }

  // 刷新用户信息
  async function refreshProfile() {
    try {
      const res: any = await authApi.getProfile()
      if (res.success) {
        user.value = res.data.user
        localStorage.setItem('user', JSON.stringify(res.data.user))
      }
    } catch (e) {
      console.error('刷新用户信息失败', e)
    }
  }

  return {
    user,
    token,
    isLoggedIn,
    init,
    login,
    register,
    logout,
    refreshProfile,
  }
})

// 同时提供命名导出和默认导出
export { useUserStore }
export default useUserStore
