<template>
  <div class="profile-page">
    <van-nav-bar title="我的" fixed placeholder />
    
    <div class="user-card">
      <van-image round width="60" height="60" :src="avatarUrl" />
      <div class="user-info">
        <div class="name">{{ userStore.user?.displayName || '未登录' }}</div>
        <div class="username">@{{ userStore.user?.username }}</div>
      </div>
    </div>
    
    <van-cell-group inset class="menu-group">
      <van-cell title="账户余额" :value="formatMoney(userStore.user?.balance || 0)" />
      <van-cell title="总资产" :value="formatMoney(userStore.user?.totalAssets || 0)" />
    </van-cell-group>
    
    <van-cell-group inset class="menu-group">
      <van-cell title="设置" is-link to="/settings" />
      <van-cell title="关于" is-link />
    </van-cell-group>
    
    <div class="logout">
      <van-button block type="danger" plain @click="handleLogout">
        退出登录
      </van-button>
    </div>
    
    <van-tabbar v-model="activeTab" fixed>
      <van-tabbar-item icon="chart-trending-o" to="/">行情</van-tabbar-item>
      <van-tabbar-item icon="balance-list-o" to="/portfolio">持仓</van-tabbar-item>
      <van-tabbar-item icon="user-o" to="/profile">我的</van-tabbar-item>
    </van-tabbar>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { showDialog } from 'vant'
import { useUserStore } from '../stores/user'

const router = useRouter()
const userStore = useUserStore()

const activeTab = ref(2)

const avatarUrl = computed(() => {
  const name = userStore.user?.displayName || 'User'
  return `https://api.dicebear.com/7.x/initials/svg?seed=${name}`
})

function formatMoney(value: number) {
  return '¥' + value.toLocaleString('zh-CN', { minimumFractionDigits: 2 })
}

function handleLogout() {
  showDialog({
    title: '提示',
    message: '确定要退出登录吗？',
  }).then(() => {
    userStore.logout()
    router.replace('/login')
  }).catch(() => {
    // 取消
  })
}
</script>

<style scoped>
.profile-page {
  min-height: 100vh;
  background: #f7f8fa;
  padding-bottom: 60px;
}

.user-card {
  display: flex;
  align-items: center;
  padding: 30px 20px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.user-info {
  margin-left: 15px;
}

.user-info .name {
  font-size: 18px;
  font-weight: bold;
}

.user-info .username {
  font-size: 14px;
  opacity: 0.8;
  margin-top: 5px;
}

.menu-group {
  margin-top: 10px;
}

.logout {
  padding: 30px 20px;
}
</style>
