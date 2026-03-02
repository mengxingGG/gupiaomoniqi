import { create } from 'zustand'

type Theme = 'light' | 'dark'
type Language = 'zh-CN' | 'en-US'
export type Page = 'trading' | 'portfolio' | 'orders' | 'history' | 'loan' | 'achievement' | 'ranking'

interface Toast {
  id: string
  type: 'success' | 'error' | 'info' | 'warning'
  message: string
  duration?: number
}

interface UIState {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void

  language: Language
  setLanguage: (language: Language) => void

  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void

  currentPage: Page
  setCurrentPage: (page: Page) => void

  activeModal: string | null
  setActiveModal: (modal: string | null) => void

  searchQuery: string
  setSearchQuery: (query: string) => void

  toasts: Toast[]
  addToast: (toast: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
}

export const useUIStore = create<UIState>((set) => ({
  theme: 'light',
  language: 'zh-CN',
  sidebarOpen: true,
  currentPage: 'trading',
  activeModal: null,
  searchQuery: '',
  toasts: [],

  setTheme: (theme) => {
    set({ theme })
    localStorage.setItem('theme', theme)
  },

  toggleTheme: () => {
    set((state) => {
      const newTheme = state.theme === 'light' ? 'dark' : 'light'
      localStorage.setItem('theme', newTheme)
      return { theme: newTheme }
    })
  },

  setLanguage: (language) => set({ language }),

  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  setCurrentPage: (page) => set({ currentPage: page }),

  setActiveModal: (modal) => set({ activeModal: modal }),

  setSearchQuery: (query) => set({ searchQuery: query }),

  addToast: (toast) => {
    const id = Date.now().toString()
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }))
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
    }, toast.duration || 3000)
  },

  removeToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}))

// 初始化主题
const savedTheme = localStorage.getItem('theme') as Theme | null
if (savedTheme) {
  useUIStore.getState().setTheme(savedTheme)
}
