<template>
  <div class="register-page">
    <van-nav-bar title="注册账号" left-arrow @click-left="goBack" />
    
    <van-form @submit="handleRegister">
      <van-cell-group inset>
        <van-field
          v-model="username"
          name="username"
          label="用户名"
          placeholder="3-20字符，字母数字下划线"
          :rules="[
            { required: true, message: '请输入用户名' },
            { pattern: /^[a-zA-Z0-9_]{3,20}$/, message: '用户名格式不正确' }
          ]"
        />
        <van-field
          v-model="displayName"
          name="displayName"
          label="昵称"
          placeholder="请输入昵称"
          :rules="[{ required: true, message: '请输入昵称' }]"
        />
        <van-field
          v-model="password"
          type="password"
          name="password"
          label="密码"
          placeholder="至少8位，包含大小写和数字"
          :rules="[
            { required: true, message: '请输入密码' },
            { validator: validatePassword, message: '密码需包含大小写字母和数字，至少8位' }
          ]"
        />
        <van-field
          v-model="confirmPassword"
          type="password"
          name="confirmPassword"
          label="确认密码"
          placeholder="请再次输入密码"
          :rules="[
            { required: true, message: '请确认密码' },
            { validator: (v) => v === password, message: '两次密码不一致' }
          ]"
        />
      </van-cell-group>
      
      <div class="button-group">
        <van-button round block type="primary" native-type="submit" :loading="loading">
          注册
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
const displayName = ref('')
const password = ref('')
const confirmPassword = ref('')
const loading = ref(false)

function validatePassword(value: string) {
  if (value.length < 8) return false
  if (!/[A-Z]/.test(value)) return false
  if (!/[a-z]/.test(value)) return false
  if (!/[0-9]/.test(value)) return false
  return true
}

async function handleRegister() {
  loading.value = true
  try {
    const result = await userStore.register(username.value, password.value, displayName.value)
    if (result.success) {
      showToast('注册成功')
      router.replace('/')
    } else {
      showToast(result.error || '注册失败')
    }
  } catch (e: any) {
    showToast(e.response?.data?.error || '注册失败')
  } finally {
    loading.value = false
  }
}

function goBack() {
  router.back()
}
</script>

<style scoped>
.register-page {
  min-height: 100vh;
  background: #f7f8fa;
}

.van-cell-group {
  margin: 16px;
}

.button-group {
  padding: 20px 26px;
}
</style>
