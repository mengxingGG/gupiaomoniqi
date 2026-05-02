<template>
  <div class="stock-detail">
    <van-nav-bar
      :title="stock?.name || '股票详情'"
      left-arrow
      fixed
      placeholder
      @click-left="goBack"
    />
    
    <div v-if="stock" class="content">
      <!-- 价格信息 -->
      <div class="price-card" :class="priceClass(stock.change_percent)">
        <div class="current-price">{{ formatPrice(stock.current_price) }}</div>
        <div class="price-info">
          <span class="change">{{ formatChange(stock.change_percent) }}</span>
          <span class="change-amount">{{ formatChangeAmount(stock.change_amount) }}</span>
        </div>
        <div class="price-row">
          <div class="item">
            <span class="label">今开</span>
            <span class="value">{{ formatPrice(stock.open_price) }}</span>
          </div>
          <div class="item">
            <span class="label">最高</span>
            <span class="value">{{ formatPrice(stock.high_price) }}</span>
          </div>
          <div class="item">
            <span class="label">最低</span>
            <span class="value">{{ formatPrice(stock.low_price) }}</span>
          </div>
          <div class="item">
            <span class="label">昨收</span>
            <span class="value">{{ formatPrice(stock.previous_close) }}</span>
          </div>
        </div>
      </div>
      
      <!-- 交易按钮 -->
      <div class="trade-buttons">
        <van-button type="danger" block @click="showTradeDialog('buy')">
          买入
        </van-button>
        <van-button type="success" block @click="showTradeDialog('sell')">
          卖出
        </van-button>
      </div>
    </div>
    
    <van-loading v-else class="loading" />
    
    <!-- 交易弹窗 -->
    <van-dialog
      v-model:show="tradeDialogVisible"
      :title="tradeType === 'buy' ? '买入' : '卖出'"
      show-cancel-button
      @confirm="handleTrade"
    >
      <van-field
        v-model="tradeQuantity"
        type="number"
        label="数量"
        placeholder="请输入交易数量"
      />
    </van-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { showToast } from 'vant'
import { marketApi, tradeApi } from '../api'

interface Stock {
  code: string
  name: string
  current_price: number
  previous_close: number
  open_price: number
  high_price: number
  low_price: number
  change_percent: number
  change_amount: number
}

const router = useRouter()
const route = useRoute()

const stock = ref<Stock | null>(null)
const tradeDialogVisible = ref(false)
const tradeType = ref<'buy' | 'sell'>('buy')
const tradeQuantity = ref('')

const code = computed(() => route.params.code as string)

function formatPrice(price: number) {
  return price.toFixed(2)
}

function formatChange(change: number) {
  const sign = change >= 0 ? '+' : ''
  return `${sign}${change.toFixed(2)}%`
}

function formatChangeAmount(amount: number) {
  const sign = amount >= 0 ? '+' : ''
  return `${sign}${amount.toFixed(2)}`
}

function priceClass(change: number) {
  if (change > 0) return 'up'
  if (change < 0) return 'down'
  return ''
}

async function loadStock() {
  try {
    const res: any = await marketApi.getStock(code.value)
    if (res.success) {
      stock.value = res.data.stock
    }
  } catch (e) {
    showToast('加载失败')
  }
}

function showTradeDialog(type: 'buy' | 'sell') {
  tradeType.value = type
  tradeQuantity.value = ''
  tradeDialogVisible.value = true
}

async function handleTrade() {
  const quantity = parseInt(tradeQuantity.value)
  if (!quantity || quantity <= 0) {
    showToast('请输入有效数量')
    return
  }
  
  try {
    const api = tradeType.value === 'buy' ? tradeApi.buy : tradeApi.sell
    const res: any = await api(code.value, quantity)
    
    if (res.success) {
      showToast(tradeType.value === 'buy' ? '买入成功' : '卖出成功')
      await loadStock()
    } else {
      showToast(res.error || '交易失败')
    }
  } catch (e: any) {
    showToast(e.response?.data?.error || '交易失败')
  }
}

function goBack() {
  router.back()
}

onMounted(() => {
  loadStock()
})
</script>

<style scoped>
.stock-detail {
  min-height: 100vh;
  background: #f7f8fa;
}

.content {
  padding: 10px;
}

.price-card {
  background: white;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 10px;
}

.price-card.up {
  background: linear-gradient(135deg, #fff5f5 0%, #ffe0e0 100%);
}

.price-card.down {
  background: linear-gradient(135deg, #f0fff0 0%, #d4ffd4 100%);
}

.current-price {
  font-size: 32px;
  font-weight: bold;
  color: #333;
}

.price-card.up .current-price {
  color: #f44336;
}

.price-card.down .current-price {
  color: #4caf50;
}

.price-info {
  margin-top: 5px;
  font-size: 14px;
}

.price-info .change {
  margin-right: 10px;
}

.price-row {
  display: flex;
  margin-top: 20px;
  border-top: 1px solid #eee;
  padding-top: 15px;
}

.price-row .item {
  flex: 1;
  text-align: center;
}

.price-row .label {
  display: block;
  font-size: 12px;
  color: #999;
}

.price-row .value {
  display: block;
  font-size: 14px;
  margin-top: 5px;
}

.trade-buttons {
  display: flex;
  gap: 10px;
}

.loading {
  display: flex;
  justify-content: center;
  padding: 50px;
}
</style>
