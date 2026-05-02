import { dbUtils } from '../db/index.js';

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

// 内存缓存：每个股票的最后记录时间（毫秒）
const lastRecordTime = new Map<string, number>();

// 历史数据记录间隔（毫秒），默认 30 秒
const HISTORY_INTERVAL = 30000;

// 最大存储空间：3GB
const MAX_TOTAL_SIZE = 3 * 1024 * 1024 * 1024;

// 当前历史数据总大小（字节）
let totalHistorySize = 0;

// 解析 price_history JSON
function parsePriceHistory(jsonStr: string): any[] {
  try {
    return JSON.parse(jsonStr || '[]');
  } catch {
    return [];
  }
}

// 计算 JSON 字符串字节大小（近似）
function estimateJsonSize(json: string): number {
  // 中文字符约 3 字节 + 基本字符串开销
  let size = 0;
  for (let i = 0; i < json.length; i++) {
    const code = json.charCodeAt(i);
    if (code > 127) size += 3;
    else size += 1;
  }
  return size;
}

// 初始化：计算当前历史数据总大小
function initHistorySize() {
  try {
    const stocks = dbUtils.query<any>('SELECT code, price_history FROM stocks');
    for (const s of stocks) {
      if (s.price_history) {
        totalHistorySize += estimateJsonSize(s.price_history);
      }
    }
    console.log(`📊 初始历史数据大小: ${(totalHistorySize / 1024 / 1024).toFixed(2)} MB`);
  } catch (e) {
    console.error('初始化历史数据大小失败:', e);
  }
}

// 保存价格历史记录（环形缓冲区策略）
function recordPriceHistory(code: string, price: number, volume: number, turnover: number) {
  const now = Date.now();
  const lastTime = lastRecordTime.get(code) || 0;
  
  // 每隔 HISTORY_INTERVAL 记录一次
  if (now - lastTime < HISTORY_INTERVAL) {
    return;
  }
  
  lastRecordTime.set(code, now);
  
  // 获取当前历史数据
  const stockList = dbUtils.query<any>('SELECT price_history FROM stocks WHERE code = ?', [code]);
  if (stockList.length === 0) return;
  
  const currentHistory = parsePriceHistory(stockList[0].price_history);
  
  // 新记录
  const newRecord = {
    time: now,
    price: price,
    volume: volume,
    turnover: turnover,
  };
  
  const newRecordJson = JSON.stringify(newRecord);
  const newRecordSize = estimateJsonSize(newRecordJson);
  
  // 添加新记录
  currentHistory.push(newRecord);
  
  // 如果超过 3GB，移除最旧的记录（FIFO 环形缓冲）
  while (totalHistorySize + newRecordSize > MAX_TOTAL_SIZE && currentHistory.length > 0) {
    const removed = currentHistory.shift();
    if (removed) {
      const removedJson = JSON.stringify(removed);
      const removedSize = estimateJsonSize(removedJson);
      totalHistorySize -= removedSize;
    }
  }
  
  totalHistorySize += newRecordSize;
  
  // 更新数据库
  const newHistoryJson = JSON.stringify(currentHistory);
  dbUtils.run(
    'UPDATE stocks SET price_history = ? WHERE code = ?',
    [newHistoryJson, code]
  );
  
  // 定期报告总大小（每 100 条记录）
  if (Math.random() < 0.001) {
    console.log(`📊 历史数据总大小: ${(totalHistorySize / 1024 / 1024 / 1024).toFixed(2)} GB / 3 GB`);
  }
}

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

// 更新单只股票价格
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

  // 生成成交量和成交额
  const newVolume = stock.volume + Math.floor(Math.random() * 100000);
  const newTurnover = stock.turnover + newPrice * Math.random() * 10000;

  // 更新数据库
  dbUtils.run(
    `UPDATE stocks SET current_price = ?, high_price = ?, low_price = ?, change_percent = ?, change_amount = ?, volume = ?, turnover = ?, updated_at = ? WHERE code = ?`,
    [
      newPrice,
      Math.max(stock.high_price, newPrice),
      Math.min(stock.low_price, newPrice),
      changePercent,
      changeAmount,
      newVolume,
      newTurnover,
      now,
      code
    ]
  );

  // 记录历史数据
  recordPriceHistory(code, newPrice, newVolume, newTurnover);

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

  // 用事务批量更新
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
    if (client.readyState === 1) {
      client.send(message);
    }
  });
}

// 启动价格更新定时器
export function startPriceEngine(intervalMs: number = 5000) {
  // 初始化历史数据大小计算
  initHistorySize();
  
  console.log(`🚀 Starting price engine (interval: ${intervalMs}ms, max history: 3GB total)`);

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
