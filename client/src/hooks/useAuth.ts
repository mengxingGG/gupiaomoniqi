import { useAuthStore } from '../store/useAuthStore'

export function useAuth() {
  const { token, user, player, isLoading, login, register, logout, fetchMe } = useAuthStore()

  return {
    token,
    user,
    player,
    isLoading,
    isAuthenticated: !!token,
    login,
    register,
    logout,
    fetchMe,
  }
}
