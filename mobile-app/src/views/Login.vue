<template>
  <div class="login-page">
    <div class="logo">
      <span class="logo-icon">📈</span>
      <h1>股票模拟器</h1>
    </div>
    
    <van-form @submit="handleLogin">
      <van-cell-group inset>
        <van-field
          v-model="username"
          name="username"
          label="用户名"
          placeholder="请输入用户名"
          :rules="[{ required: true, message: '请输入用户名' }]"
        />
        <van-field
          v-model="password"
          type="password"
          name="password"
          label="密码"
          placeholder="请输入密码"
          :rules="[{ required: true, message: '请输入密码' }]"
        />
      </van-cell-group>
      
      <div class="button-group">
        <van-button round block type="primary" native-type="submit" :loading="loading">
          登录
        </van-button>
        <van-button round block plain @click="goRegister">
          没有账号？去注册
        </van-button>
      </div>
    </van-form>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'
import { useUserStore } from '../stores/user'

const router = useRouter()
const userStore = useUserStore()

const username = ref('')
const password = ref('')
const loading = ref(false)

async function handleLogin() {
  loading.value = true
  try {
    const result = await userStore.login(username.value, password.value)
    if (result.success) {
      showToast('登录成功')
      router.replace('/')
    } else {
      showToast(result.error || '登录失败')
    }
  } catch (e: any) {
    showToast(e.response?.data?.error || '登录失败')
  } finally {
    loading.value = false
  }
}

function goRegister() {
  router.push('/register')
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  padding: 60px 20px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.logo {
  text-align: center;
  margin-bottom: 40px;
  color: white;
}

.logo-icon {
  font-size: 60px;
}

.logo h1 {
  margin-top: 10px;
  font-size: 24px;
}

.van-cell-group {
  margin: 0;
}

.button-group {
  margin-top: 20px;
  padding: 0 10px;
}

.button-group .van-button {
  margin-bottom: 10px;
}
</style>
