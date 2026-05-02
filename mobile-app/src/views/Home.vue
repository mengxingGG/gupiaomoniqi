<template>
  <div class="home-page">
    <van-nav-bar title="股票模拟器" fixed placeholder>
      <template #right>
        <van-icon name="user-o" size="20" @click="goProfile" />
      </template>
    </van-nav-bar>
    
    <van-pull-refresh v-model="refreshing" @refresh="onRefresh">
      <van-list
        v-model:loading="loading"
        :finished="finished"
        finished-text=""
        @load="onLoad"
      >
        <van-search
          v-model="searchText"
          placeholder="搜索股票代码或名称"
          shape="round"
        />
        
        <div class="stock-list">
          <van-cell
            v-for="stock in filteredStocks"
            :key="stock.code"
            :title="stock.name"
            :label="stock.code"
            is-link
            @click="goDetail(stock.code)"
          >
            <template #value>
              <div class="stock-price" :class="priceClass(stock.change_percent)">
                <div class="price">{{ formatPrice(stock.current_price) }}</div>
                <div class="change">{{ formatChange(stock.change_percent) }}</div>
              </div>
            </template>
          </van-cell>
        </div>
      </van-list>
    </van-pull-refresh>
    
    <van-tabbar v-model="activeTab" fixed>
      <van-tabbar-item icon="chart-trending-o" to="/">行情</van-tabbar-item>
      <van-tabbar-item icon="balance-list-o" to="/portfolio">持仓</van-tabbar-item>
      <van-tabbar-item icon="user-o" to="/profile">我的</van-tabbar-item>
    </van-tabbar>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'
import { marketApi } from '../api'

interface Stock {
  code: string
  name: string
  current_price: number
  change_percent: number
}

const router = useRouter()

const stocks = ref<Stock[]>([])
const searchText = ref('')
const loading = ref(false)
const refreshing = ref(false)
const finished = ref(true)
const activeTab = ref(0)

// 过滤股票
const filteredStocks = computed(() => {
  if (!searchText.value) return stocks.value
  const search = searchText.value.toLowerCase()
  return stocks.value.filter(s => 
    s.code.toLowerCase().includes(search) || 
    s.name.toLowerCase().includes(search)
  )
})

// 格式化价格
function formatPrice(price: number) {
  return price.toFixed(2)
}

// 格式化涨跌幅
function formatChange(change: number) {
  const sign = change >= 0 ? '+' : ''
  return `${sign}${change.toFixed(2)}%`
}

// 价格颜色
function priceClass(change: number) {
  if (change > 0) return 'up'
  if (change < 0) return 'down'
  return ''
}

// 加载股票数据
async function loadStocks() {
  try {
    const res: any = await marketApi.getStocks()
    if (res.success) {
      stocks.value = res.data.stocks
    }
  } catch (e) {
    showToast('加载失败')
  }
}

function onLoad() {
  // 已在 onMounted 加载
}

async function onRefresh() {
  await loadStocks()
  refreshing.value = false
  showToast('刷新成功')
}

function goDetail(code: string) {
  router.push(`/stock/${code}`)
}

function goProfile() {
  router.push('/profile')
}

onMounted(() => {
  loadStocks()
})
</script>

<style scoped>
.home-page {
  min-height: 100vh;
  background: #f7f8fa;
  padding-bottom: 60px;
}

.van-search {
  position: sticky;
  top: 46px;
  z-index: 1;
}

.stock-list {
  background: white;
  margin: 10px;
  border-radius: 8px;
  overflow: hidden;
}

.stock-price {
  text-align: right;
}

.stock-price .price {
  font-size: 16px;
  font-weight: 500;
}

.stock-price .change {
  font-size: 12px;
}

.stock-price.up {
  color: #f44336;
}

.stock-price.down {
  color: #4caf50;
}
</style>
