import { dbUtils, getDb } from '../db/index.js';

export interface StockPrice {
  code: string;
  name: string;
  price: number;
  changePercent: number;
  changeAmount: number;
  volume: number;
  turnover: number;
  timestamp: number;
}

// 内存缓存股票价格
const priceCache = new Map<string, StockPrice>();

// WebSocket 客户端集合
let wss: any = null;

// AI 压力缓存
const aiPressureCache = new Map<string, number>();

// 设置 WebSocket 服务器
export function setWebSocketServer(wsServer: any) {
  wss = wsServer;
}

// 添加 AI 压力
export function addAIPressure(code: string, netVolume: number) {
  const current = aiPressureCache.get(code) || 0;
  aiPressureCache.set(code, current + netVolume);
}

// 清除 AI 压力
export function clearAIPressure() {
  aiPressureCache.clear();
}

// 获取当前 AI 压力
export function getAIPressure(code: string): number {
  return aiPressureCache.get(code) || 0;
}

// 更新单只股票价格（在事务内调用，不触发 saveDatabase）
function updateStockPriceInTransaction(code: string): StockPrice | null {
  const stockList = dbUtils.query<any>('SELECT * FROM stocks WHERE code = ?', [code]);
  if (stockList.length === 0) return null;

  const stock = stockList[0];
  let newPrice = stock.current_price;

  // 1. 随机游走（±2% 最大单次波动）
  const randomWalk = (Math.random() - 0.5) * 0.04;
  newPrice = newPrice * (1 + randomWalk);

  // 2. 叠加 AI 压力
  const pressure = getAIPressure(code);
  if (pressure !== 0) {
    const pressureEffect = pressure / 10000 * 0.01;
    newPrice = newPrice * (1 + pressureEffect);
  }

  // 3. 涨跌停限制（±10% 相对昨收）
  const limitUp = stock.previous_close * 1.10;
  const limitDown = stock.previous_close * 0.90;
  newPrice = Math.max(limitDown, Math.min(limitUp, newPrice));

  // 计算涨跌
  const changeAmount = newPrice - stock.previous_close;
  const changePercent = (changeAmount / stock.previous_close) * 100;

  const now = Date.now();

  // 更新数据库（直接用底层 db，不触发 saveDatabase）
  getDb().run(
    `UPDATE stocks SET current_price = ?, high_price = ?, low_price = ?, change_percent = ?, change_amount = ?, volume = ?, turnover = ?, updated_at = ? WHERE code = ?`,
    [
      newPrice,
      Math.max(stock.high_price, newPrice),
      Math.min(stock.low_price, newPrice),
      changePercent,
      changeAmount,
      stock.volume + Math.floor(Math.random() * 100000),
      stock.turnover + newPrice * Math.random() * 10000,
      now,
      code
    ]
  );

  const result: StockPrice = {
    code,
    name: stock.name,
    price: newPrice,
    changePercent,
    changeAmount,
    volume: stock.volume,
    turnover: stock.turnover,
    timestamp: now,
  };

  // 更新缓存
  priceCache.set(code, result);

  return result;
}

// 更新所有股票价格
export async function updateAllStockPrices(): Promise<StockPrice[]> {
  const allStocks = dbUtils.query<any>('SELECT code FROM stocks');
  const results: StockPrice[] = [];

  // 用事务批量更新，只触发一次 saveDatabase
  dbUtils.transaction(() => {
    for (const s of allStocks) {
      const result = updateStockPriceInTransaction(s.code);
      if (result) {
        results.push(result);
      }
    }
  });

  // 清除 AI 压力
  clearAIPressure();

  return results;
}

// 广播价格更新
function broadcastPriceUpdate(prices: StockPrice[]) {
  if (!wss) return;

  const message = JSON.stringify({
    type: 'price_update',
    data: prices,
  });

  wss.clients.forEach((client: any) => {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(message);
    }
  });
}

// 启动价格更新定时器
export function startPriceEngine(intervalMs: number = 5000) {
  console.log(`🚀 Starting price engine (interval: ${intervalMs}ms)`);

  setInterval(async () => {
    try {
      const prices = await updateAllStockPrices();
      broadcastPriceUpdate(prices);
    } catch (error) {
      console.error('Price engine error:', error);
    }
  }, intervalMs);
}

// 获取缓存的价格
export function getCachedPrice(code: string): StockPrice | undefined {
  return priceCache.get(code);
}

// 获取所有缓存的价格
export function getAllCachedPrices(): StockPrice[] {
  return Array.from(priceCache.values());
}
