<template>
  <div class="portfolio-page">
    <van-nav-bar title="我的持仓" fixed placeholder />
    
    <van-pull-refresh v-model="refreshing" @refresh="onRefresh">
      <!-- 资产概览 -->
      <div class="asset-card">
        <div class="total-assets">
          <span class="label">总资产</span>
          <span class="value">¥{{ formatMoney(portfolio.totalAssets) }}</span>
        </div>
        <div class="asset-row">
          <div class="item">
            <span class="label">可用资金</span>
            <span class="value">¥{{ formatMoney(portfolio.balance) }}</span>
          </div>
          <div class="item">
            <span class="label">持仓市值</span>
            <span class="value">¥{{ formatMoney(portfolio.marketValue) }}</span>
          </div>
          <div class="item">
            <span class="label">总盈亏</span>
            <span class="value" :class="profitClass">{{ formatProfit(portfolio.totalProfit) }}</span>
          </div>
        </div>
      </div>
      
      <!-- 持仓列表 -->
      <div class="section-title">持仓明细</div>
      <div class="position-list">
        <van-cell-group v-if="positions.length > 0" inset>
          <van-cell
            v-for="pos in positions"
            :key="pos.stock_code"
            :title="pos.stock_name"
            :label="pos.stock_code"
            is-link
            @click="goStock(pos.stock_code)"
          >
            <template #value>
              <div class="position-info">
                <div>{{ pos.quantity }}股</div>
                <div :class="profitClass">¥{{ formatMoney(pos.profit) }}</div>
              </div>
            </template>
          </van-cell>
        </van-cell-group>
        
        <van-empty v-else description="暂无持仓" />
      </div>
      
      <!-- 委托订单 -->
      <div class="section-title">委托订单</div>
      <div class="order-list">
        <van-cell-group v-if="orders.length > 0" inset>
          <van-cell
            v-for="order in orders"
            :key="order.id"
            :title="order.stock_name"
            :label="formatTime(order.created_at)"
          >
            <template #value>
              <div class="order-info">
                <van-tag :type="order.type === 'buy' ? 'danger' : 'success'">
                  {{ order.type === 'buy' ? '买入' : '卖出' }}
                </van-tag>
                <span>{{ order.quantity }}股</span>
              </div>
            </template>
          </van-cell>
        </van-cell-group>
        
        <van-empty v-else description="暂无委托" />
      </div>
    </van-pull-refresh>
    
    <van-tabbar v-model="activeTab" fixed>
      <van-tabbar-item icon="chart-trending-o" to="/">行情</van-tabbar-item>
      <van-tabbar-item icon="balance-list-o" to="/portfolio">持仓</van-tabbar-item>
      <van-tabbar-item icon="user-o" to="/profile">我的</van-tabbar-item>
    </van-tabbar>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'
import { playerApi } from '../api'

const router = useRouter()

const portfolio = ref({
  totalAssets: 0,
  balance: 0,
  marketValue: 0,
  totalProfit: 0,
})
const positions = ref<any[]>([])
const orders = ref<any[]>([])
const refreshing = ref(false)
const activeTab = ref(1)

function formatMoney(value: number) {
  return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatProfit(value: number) {
  const sign = value >= 0 ? '+' : ''
  return `${sign}${formatMoney(value)}`
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleString('zh-CN')
}

const profitClass = computed(() => {
  return portfolio.value.totalProfit >= 0 ? 'profit' : 'loss'
})

async function loadData() {
  try {
    const [portfolioRes, positionsRes, ordersRes] = await Promise.all([
      playerApi.getPortfolio() as any,
      playerApi.getPositions() as any,
      playerApi.getOrders() as any,
    ])
    
    if (portfolioRes.success) {
      portfolio.value = portfolioRes.data
    }
    if (positionsRes.success) {
      positions.value = positionsRes.data.positions || []
    }
    if (ordersRes.success) {
      orders.value = ordersRes.data.orders || []
    }
  } catch (e) {
    showToast('加载失败')
  }
}

async function onRefresh() {
  await loadData()
  refreshing.value = false
  showToast('刷新成功')
}

function goStock(code: string) {
  router.push(`/stock/${code}`)
}

onMounted(() => {
  loadData()
})
</script>

<script lang="ts">
import { computed } from 'vue'
export default {
  name: 'Portfolio',
}
</script>

<style scoped>
.portfolio-page {
  min-height: 100vh;
  background: #f7f8fa;
  padding-bottom: 60px;
}

.asset-card {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 20px;
  margin: 10px;
  border-radius: 8px;
}

.total-assets {
  text-align: center;
}

.total-assets .label {
  display: block;
  font-size: 14px;
  opacity: 0.8;
}

.total-assets .value {
  display: block;
  font-size: 28px;
  font-weight: bold;
  margin-top: 5px;
}

.asset-row {
  display: flex;
  margin-top: 20px;
  padding-top: 15px;
  border-top: 1px solid rgba(255,255,255,0.2);
}

.asset-row .item {
  flex: 1;
  text-align: center;
}

.asset-row .label {
  display: block;
  font-size: 12px;
  opacity: 0.8;
}

.asset-row .value {
  display: block;
  font-size: 14px;
  margin-top: 5px;
}

.section-title {
  padding: 15px 10px 10px;
  font-size: 14px;
  color: #666;
}

.position-info, .order-info {
  text-align: right;
}

.position-info .profit {
  color: #f44336;
}

.position-info .loss {
  color: #4caf50;
}

.order-info {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
