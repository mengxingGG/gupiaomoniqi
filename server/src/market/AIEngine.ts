import { dbUtils } from '../db/index.js';
import { addAIPressure } from './MarketEngine.js';
import { getAIDecision, checkOllamaHealth, type MarketContext } from '../services/OllamaService.js';

interface AITrader {
  id: string;
  name: string;
  cash: number;
  total_assets: number;
  strategy_type: string;
  psychology_type: string;
  risk_level: number;
  trade_frequency: number;
  last_trade_at: number | null;
  total_trades: number;
  win_count: number;
  loss_count: number;
  is_smart?: number; // 1 = LLM驱动
}

// Ollama 服务状态
let ollamaAvailable = false;
let lastHealthCheck = 0;

interface Stock {
  code: string;
  name: string;
  market: string;
  current_price: number;
  change_percent: number;
  volume: number;
  turnover: number;
}

interface Position {
  stock_code: string;
  stock_name: string;
  quantity: number;
  available_quantity: number;
  average_cost: number;
}

// 策略配置：资金使用比例
const STRATEGY_CONFIG: Record<string, { buyRatio: [number, number], sellRatio: [number, number], holdDays: number }> = {
  'conservative': { buyRatio: [0.05, 0.10], sellRatio: [0.30, 0.50], holdDays: 5 },
  'aggressive': { buyRatio: [0.15, 0.25], sellRatio: [0.50, 0.80], holdDays: 2 },
  'value': { buyRatio: [0.10, 0.15], sellRatio: [0.30, 0.50], holdDays: 7 },
  'technical': { buyRatio: [0.10, 0.20], sellRatio: [0.40, 0.70], holdDays: 3 },
  'random': { buyRatio: [0.05, 0.20], sellRatio: [0.20, 0.60], holdDays: 4 },
  'momentum': { buyRatio: [0.15, 0.25], sellRatio: [0.50, 0.80], holdDays: 2 },
  'contrarian': { buyRatio: [0.10, 0.20], sellRatio: [0.30, 0.60], holdDays: 4 },
};

// 检查 Ollama 服务状态（每分钟检查一次）
async function checkOllama(): Promise<boolean> {
  const now = Date.now();
  if (now - lastHealthCheck > 60000) {
    ollamaAvailable = await checkOllamaHealth();
    lastHealthCheck = now;
    if (ollamaAvailable) {
      console.log('🤖 Ollama 服务可用');
    } else {
      console.log('⚠️ Ollama 服务不可用，使用模拟决策');
    }
  }
  return ollamaAvailable;
}

// 随机选择 5-10 个 AI 交易者（优先选择智能 AI）
function selectRandomTraders(): AITrader[] {
  const count = 5 + Math.floor(Math.random() * 6); // 5-10
  
  // 优先选择智能 AI
  const smartTraders = dbUtils.query<AITrader>(
    `SELECT * FROM ai_traders 
     WHERE (cash > 10000 OR total_assets > 10000) AND is_smart = 1
     ORDER BY RANDOM() 
     LIMIT ?`,
    [count]
  ) as AITrader[];
  
  // 如果智能 AI 不够，补充普通 AI
  if (smartTraders.length < count) {
    const normalTraders = dbUtils.query<AITrader>(
      `SELECT * FROM ai_traders 
       WHERE (cash > 10000 OR total_assets > 10000) AND (is_smart = 0 OR is_smart IS NULL)
       ORDER BY RANDOM() 
       LIMIT ?`,
      [count - smartTraders.length]
    ) as AITrader[];
    
    return [...smartTraders, ...normalTraders];
  }
  
  return smartTraders;
}

// 获取 AI 持仓
function getTraderPositions(traderId: string): Position[] {
  return dbUtils.query<Position>(
    `SELECT stock_code, stock_name, quantity, available_quantity, average_cost 
     FROM ai_positions 
     WHERE trader_id = ?`,
    [traderId]
  ) as Position[];
}

// 获取股票样本
function getStockSample(count: number = 20): Stock[] {
  return dbUtils.query<Stock>(
    `SELECT code, name, market, current_price, change_percent, volume, turnover 
     FROM stocks 
     ORDER BY RANDOM() 
     LIMIT ?`,
    [count]
  ) as Stock[];
}

// 计算交易手数（1手=100股）
function calculateLots(amount: number, price: number): number {
  const shares = Math.floor(amount / price);
  const lots = Math.floor(shares / 100);
  return Math.max(lots, 1); // 至少1手
}

// 基于策略的模拟决策
function simulateDecision(trader: AITrader, positions: Position[], stocks: Stock[]): { action: string; stock_code: string; quantity: number; reason: string } {
  const config = STRATEGY_CONFIG[trader.strategy_type] || STRATEGY_CONFIG['random'];
  const random = Math.random();
  
  // 计算持仓压力
  const hasPositions = positions.length > 0;
  const idleRounds = trader.last_trade_at ? Math.floor((Date.now() - trader.last_trade_at) / (5 * 60 * 1000)) : 0;
  
  // 决策权重
  let buyWeight = 0.3;
  let sellWeight = hasPositions ? 0.3 : 0;
  let holdWeight = 0.4;
  
  // 持仓压力：持仓多时增加卖出倾向
  if (hasPositions && idleRounds > 3) {
    sellWeight += 0.2;
    holdWeight -= 0.1;
  }
  
  // 现金压力：现金多时增加买入倾向
  const cashRatio = trader.cash / trader.total_assets;
  if (cashRatio > 0.7) {
    buyWeight += 0.2;
    holdWeight -= 0.1;
  }
  
  // 根据策略调整
  if (trader.strategy_type === 'momentum' || trader.strategy_type === 'aggressive') {
    buyWeight += 0.1;
    sellWeight += 0.1;
    holdWeight -= 0.2;
  } else if (trader.strategy_type === 'conservative') {
    holdWeight += 0.2;
    buyWeight -= 0.1;
  }
  
  // 归一化
  const total = buyWeight + sellWeight + holdWeight;
  buyWeight /= total;
  sellWeight /= total;
  holdWeight /= total;
  
  // 决策
  if (random < buyWeight) {
    // 买入
    const stock = selectStockForBuy(trader, stocks);
    if (!stock) return { action: 'hold', stock_code: '', quantity: 0, reason: '无合适股票' };
    
    const ratio = config.buyRatio[0] + Math.random() * (config.buyRatio[1] - config.buyRatio[0]);
    const amount = trader.cash * ratio;
    const lots = calculateLots(amount, stock.current_price);
    const quantity = lots * 100;
    
    return {
      action: 'buy',
      stock_code: stock.code,
      quantity,
      reason: `${trader.psychology_type}策略买入，使用${(ratio * 100).toFixed(0)}%资金`
    };
  } else if (random < buyWeight + sellWeight && hasPositions) {
    // 卖出
    const position = selectPositionForSell(trader, positions, stocks);
    if (!position) return { action: 'hold', stock_code: '', quantity: 0, reason: '无可卖持仓' };
    
    const ratio = config.sellRatio[0] + Math.random() * (config.sellRatio[1] - config.sellRatio[0]);
    const sellQty = Math.floor(position.available_quantity * ratio);
    const lots = Math.floor(sellQty / 100);
    const quantity = lots * 100;
    
    if (quantity < 100) {
      return { action: 'hold', stock_code: '', quantity: 0, reason: '可卖数量不足1手' };
    }
    
    return {
      action: 'sell',
      stock_code: position.stock_code,
      quantity,
      reason: `${trader.psychology_type}策略卖出${(ratio * 100).toFixed(0)}%持仓`
    };
  }
  
  return { action: 'hold', stock_code: '', quantity: 0, reason: `${trader.psychology_type}观望` };
}

// 🧠 智能 AI 决策（调用 Ollama）
async function smartDecision(trader: AITrader, positions: Position[], stocks: Stock[]): Promise<{ action: string; stock_code: string; quantity: number; reason: string }> {
  // 构建上下文
  const ctx: MarketContext = {
    trader_name: trader.name,
    strategy: trader.strategy_type,
    cash: trader.cash,
    total_assets: trader.total_assets,
    positions: positions.map(p => {
      const stock = stocks.find(s => s.code === p.stock_code);
      const currentPrice = stock?.current_price || p.average_cost;
      return {
        stock_code: p.stock_code,
        stock_name: p.stock_name,
        quantity: p.quantity,
        avg_cost: p.average_cost,
        current_price: currentPrice,
        profit_percent: ((currentPrice - p.average_cost) / p.average_cost) * 100
      };
    }),
    market_snapshot: stocks.slice(0, 15).map(s => ({
      code: s.code,
      name: s.name,
      price: s.current_price,
      change_percent: s.change_percent,
      volume: s.volume
    }))
  };

  // 调用 Ollama（超时 8 秒）
  const decision = await getAIDecision(ctx, 8000);
  
  // 验证决策有效性
  if (decision.action === 'buy') {
    if (!decision.stock_code || decision.stock_code.length < 3) {
      return { action: 'hold', stock_code: '', quantity: 0, reason: '买入股票代码无效' };
    }
    // 确保股票存在
    const stock = stocks.find(s => s.code === decision.stock_code);
    if (!stock) {
      // 尝试匹配股票名
      const stockByName = stocks.find(s => s.name.includes(decision.stock_code) || decision.stock_code.includes(s.name));
      if (stockByName) {
        decision.stock_code = stockByName.code;
      } else {
        return { action: 'hold', stock_code: '', quantity: 0, reason: '股票不存在' };
      }
    }
    // 计算合理数量
    const stock2 = stocks.find(s => s.code === decision.stock_code)!;
    const maxQty = Math.floor(trader.cash * 0.3 / stock2.current_price / 100) * 100;
    if (!decision.quantity || decision.quantity < 100) {
      decision.quantity = Math.min(500, maxQty); // 默认 5 手
    } else {
      decision.quantity = Math.min(decision.quantity, maxQty);
    }
  } else if (decision.action === 'sell') {
    if (!decision.stock_code) {
      // AI 没指定，选择亏损最多的持仓
      const lossPos = positions.filter(p => p.available_quantity >= 100)
        .map(p => {
          const stock = stocks.find(s => s.code === p.stock_code);
          const profit = stock ? ((stock.current_price - p.average_cost) / p.average_cost) : 0;
          return { ...p, profit };
        })
        .sort((a, b) => a.profit - b.profit);
      
      if (lossPos.length > 0) {
        decision.stock_code = lossPos[0].stock_code;
        decision.quantity = Math.min(decision.quantity || 100, lossPos[0].available_quantity);
      } else {
        return { action: 'hold', stock_code: '', quantity: 0, reason: '无可卖持仓' };
      }
    }
  }
  
  return {
    action: decision.action,
    stock_code: decision.stock_code || '',
    quantity: decision.quantity || 0,
    reason: decision.reason
  };
}

// 选择买入股票
function selectStockForBuy(trader: AITrader, stocks: Stock[]): Stock | null {
  if (stocks.length === 0) return null;
  
  // 根据策略选择
  let candidates = [...stocks];
  
  switch (trader.strategy_type) {
    case 'momentum':
      // 动量型：选涨幅大的
      candidates.sort((a, b) => b.change_percent - a.change_percent);
      break;
    case 'contrarian':
      // 逆向型：选跌幅大的
      candidates.sort((a, b) => a.change_percent - b.change_percent);
      break;
    case 'value':
      // 价值型：选跌幅或小幅波动的
      candidates = candidates.filter(s => s.change_percent < 2);
      break;
    case 'technical':
      // 技术型：选成交量大的
      candidates.sort((a, b) => b.volume - a.volume);
      break;
    default:
      // 随机
      break;
  }
  
  // 从前5个候选中随机选
  const top = candidates.slice(0, 5);
  return top[Math.floor(Math.random() * top.length)];
}

// 选择卖出持仓
function selectPositionForSell(trader: AITrader, positions: Position[], stocks: Stock[]): Position | null {
  const sellable = positions.filter(p => p.available_quantity >= 100);
  if (sellable.length === 0) return null;
  
  // 获取当前价格，计算盈亏
  const withProfit = sellable.map(p => {
    const stock = stocks.find(s => s.code === p.stock_code);
    const currentPrice = stock?.current_price || p.average_cost;
    const profitPercent = (currentPrice - p.average_cost) / p.average_cost * 100;
    return { ...p, profitPercent };
  });
  
  // 根据策略排序
  switch (trader.strategy_type) {
    case 'momentum':
    case 'aggressive':
      // 激进/动量：优先卖亏损的（止损）
      withProfit.sort((a, b) => a.profitPercent - b.profitPercent);
      break;
    case 'value':
    case 'conservative':
      // 价值/保守：优先卖盈利的（止盈）
      withProfit.sort((a, b) => b.profitPercent - a.profitPercent);
      break;
    default:
      // 随机
      break;
  }
  
  return withProfit[0];
}

// 执行交易决策
async function executeDecision(trader: AITrader, decision: { action: string; stock_code: string; quantity: number; reason: string }): Promise<void> {
  const now = Date.now();
  
  if (decision.action === 'hold' || !decision.stock_code || decision.quantity < 100) {
    return;
  }

  const stock = dbUtils.queryOne<Stock>(
    'SELECT * FROM stocks WHERE code = ?',
    [decision.stock_code]
  );

  if (!stock) {
    console.log(`[AI] ${trader.name}: 股票不存在 ${decision.stock_code}`);
    return;
  }

  try {
    if (decision.action === 'buy') {
      const totalCost = stock.current_price * decision.quantity;
      const fee = totalCost * 0.0003;
      
      if (totalCost + fee > trader.cash) {
        console.log(`[AI] ${trader.name} 资金不足，需要${(totalCost / 10000).toFixed(2)}万，只有${(trader.cash / 10000).toFixed(2)}万`);
        return;
      }

      // 添加 AI 压力
      addAIPressure(decision.stock_code, decision.quantity);

      // 更新 AI 持仓
      const existing = dbUtils.queryOne<any>(
        'SELECT * FROM ai_positions WHERE trader_id = ? AND stock_code = ?',
        [trader.id, decision.stock_code]
      );
      
      if (existing) {
        const newQty = existing.quantity + decision.quantity;
        const newAvgCost = (existing.average_cost * existing.quantity + totalCost) / newQty;
        dbUtils.run(
          'UPDATE ai_positions SET quantity = ?, average_cost = ? WHERE id = ?',
          [newQty, newAvgCost, existing.id]
        );
      } else {
        const isT0 = stock.market.endsWith('_T0');
        dbUtils.run(
          'INSERT INTO ai_positions (id, trader_id, stock_code, stock_name, quantity, average_cost, available_quantity, market, buy_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [`${trader.id}_${decision.stock_code}`, trader.id, decision.stock_code, stock.name, decision.quantity, stock.current_price, isT0 ? decision.quantity : 0, stock.market, now]
        );
      }

      // 扣除资金
      dbUtils.run(
        'UPDATE ai_traders SET cash = cash - ?, total_trades = total_trades + 1, last_trade_at = ? WHERE id = ?',
        [totalCost + fee, now, trader.id]
      );

      const lots = decision.quantity / 100;
      console.log(`[AI] ${trader.name} 买入 ${stock.name} ${lots}手(${decision.quantity}股) @¥${stock.current_price.toFixed(2)} = ¥${(totalCost/10000).toFixed(2)}万 | ${decision.reason}`);

    } else if (decision.action === 'sell') {
      const position = dbUtils.queryOne<any>(
        'SELECT * FROM ai_positions WHERE trader_id = ? AND stock_code = ?',
        [trader.id, decision.stock_code]
      );

      if (!position || position.available_quantity < decision.quantity) {
        console.log(`[AI] ${trader.name} 可卖数量不足`);
        return;
      }

      // 添加 AI 压力
      addAIPressure(decision.stock_code, -decision.quantity);

      // 计算收益
      const proceeds = stock.current_price * decision.quantity;
      const fee = proceeds * 0.0003;
      const profit = (stock.current_price - position.average_cost) * decision.quantity;
      const profitPercent = (stock.current_price - position.average_cost) / position.average_cost * 100;

      // 更新持仓
      const newQty = position.quantity - decision.quantity;
      if (newQty <= 0) {
        dbUtils.run('DELETE FROM ai_positions WHERE id = ?', [position.id]);
      } else {
        const newAvail = Math.min(position.available_quantity, newQty);
        dbUtils.run(
          'UPDATE ai_positions SET quantity = ?, available_quantity = ? WHERE id = ?',
          [newQty, newAvail, position.id]
        );
      }

      // 增加资金
      dbUtils.run(
        'UPDATE ai_traders SET cash = cash + ?, total_trades = total_trades + 1, win_count = win_count + ?, loss_count = loss_count + ?, last_trade_at = ? WHERE id = ?',
        [proceeds - fee, profit > 0 ? 1 : 0, profit < 0 ? 1 : 0, now, trader.id]
      );

      const lots = decision.quantity / 100;
      const profitStr = profit >= 0 ? `盈利¥${profit.toFixed(0)}` : `亏损¥${Math.abs(profit).toFixed(0)}`;
      console.log(`[AI] ${trader.name} 卖出 ${stock.name} ${lots}手(${decision.quantity}股) @¥${stock.current_price.toFixed(2)} = ¥${(proceeds/10000).toFixed(2)}万 | ${profitStr}(${profitPercent >= 0 ? '+' : ''}${profitPercent.toFixed(1)}%) | ${decision.reason}`);
    }
  } catch (error) {
    console.error(`[AI] ${trader.name} 交易失败:`, error);
  }
}

// 处理单个 AI 交易者
async function processTrader(trader: AITrader): Promise<void> {
  const positions = getTraderPositions(trader.id);
  const stocks = getStockSample(20);
  
  // 根据类型选择决策方式
  let decision: { action: string; stock_code: string; quantity: number; reason: string };
  
  if (trader.is_smart === 1 && await checkOllama()) {
    // 🧠 智能 AI：调用 LLM
    decision = await smartDecision(trader, positions, stocks);
    console.log(`[AI-LLM] ${trader.name} 智能决策: ${decision.action} ${decision.stock_code || '-'} | ${decision.reason}`);
  } else {
    // 🎲 普通 AI：模拟决策
    decision = simulateDecision(trader, positions, stocks);
  }
  
  await executeDecision(trader, decision);
}

// 更新 AI 总资产
function updateTraderAssets(): void {
  const traders = dbUtils.query<{ id: string; cash: number }>(
    'SELECT id, cash FROM ai_traders'
  );

  for (const trader of traders) {
    const positions = dbUtils.query<{ stock_code: string; quantity: number }>(
      'SELECT stock_code, quantity FROM ai_positions WHERE trader_id = ?',
      [trader.id]
    );

    let positionValue = 0;
    for (const pos of positions) {
      const stock = dbUtils.queryOne<{ current_price: number }>(
        'SELECT current_price FROM stocks WHERE code = ?',
        [pos.stock_code]
      );
      if (stock) {
        positionValue += pos.quantity * stock.current_price;
      }
    }

    const totalAssets = trader.cash + positionValue;
    dbUtils.run(
      'UPDATE ai_traders SET total_assets = ? WHERE id = ?',
      [totalAssets, trader.id]
    );
  }
}

// 主入口：激活一轮 AI 交易
export async function runAITradingRound(): Promise<void> {
  const traders = selectRandomTraders();
  
  if (traders.length === 0) {
    console.log('[AI] 无可用交易者');
    return;
  }

  console.log(`[AI] 本轮激活 ${traders.length} 个交易者: ${traders.map(t => t.name).join(', ')}`);

  // 异步处理
  for (const trader of traders) {
    processTrader(trader).catch(err => {
      console.error(`[AI] ${trader.name} 处理失败:`, err);
    });
  }

  // 延迟更新总资产
  setTimeout(() => {
    updateTraderAssets();
  }, 3000);
}

// 启动 AI 交易引擎
export async function startAITradingEngine(intervalMs: number = 300000): Promise<void> {
  // 首次检查 Ollama
  ollamaAvailable = await checkOllamaHealth();
  lastHealthCheck = Date.now();
  
  const smartCount = dbUtils.queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM ai_traders WHERE is_smart = 1'
  )?.count || 0;
  
  console.log(`🤖 启动 AI 交易引擎 (每 ${Math.round(intervalMs / 60000)} 分钟激活一轮)`);
  console.log(`   交易单位: 1手=100股`);
  console.log(`   智能 AI: ${smartCount} 个 ${ollamaAvailable ? '✅ Ollama可用' : '⚠️ Ollama不可用'}`);
  console.log(`   策略: 7种 (保守/激进/价值/技术/随机/动量/逆向)`);
  
  // 5秒后执行第一次
  setTimeout(() => {
    runAITradingRound().catch(err => {
      console.error('[AI] 首轮交易执行失败:', err);
    });
  }, 5000);
  
  // 定时执行
  setInterval(() => {
    runAITradingRound().catch(err => {
      console.error('[AI] 交易轮执行失败:', err);
    });
  }, intervalMs);
}

// 设置 AI 交易者为智能模式
export function setSmartAITraders(traderIds: string[]): void {
  // 先重置所有
  dbUtils.run('UPDATE ai_traders SET is_smart = 0');
  
  // 设置指定交易者
  for (const id of traderIds) {
    dbUtils.run('UPDATE ai_traders SET is_smart = 1 WHERE id = ?', [id]);
  }
  
  console.log(`[AI] 已设置 ${traderIds.length} 个智能 AI 交易者`);
}

// 创建智能 AI 交易者
export function createSmartAITrader(name: string, strategy: string, initialCash: number = 500000): string {
  const id = `smart_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  dbUtils.run(
    `INSERT INTO ai_traders (id, name, cash, total_assets, strategy_type, psychology_type, is_smart, risk_level, trade_frequency, total_trades, win_count, loss_count) 
     VALUES (?, ?, ?, ?, ?, ?, 1, 5, 5, 0, 0, 0)`,
    [id, name, initialCash, initialCash, strategy, strategy]
  );
  
  console.log(`[AI] 创建智能交易者: ${name} (${strategy}) 初始资金¥${(initialCash/10000).toFixed(0)}万`);
  return id;
}

// 每日重置 T+1 持仓
export function resetAIPositionsT1(): void {
  const result = dbUtils.run(
    `UPDATE ai_positions SET available_quantity = quantity 
     WHERE market LIKE '%_T1' OR market NOT LIKE '%_T0'`
  );
  console.log(`[AI] T+1 持仓可卖数量已重置 (${result.changes} 条)`);
}

// 获取 AI 排行榜
export function getAIRanking(limit: number = 10): any[] {
  return dbUtils.query(
    `SELECT id, name, psychology_type, cash, total_assets, total_trades, win_count, 
            CASE WHEN total_trades > 0 THEN ROUND(win_count * 100.0 / total_trades, 1) ELSE 0 END as win_rate
     FROM ai_traders 
     ORDER BY total_assets DESC 
     LIMIT ?`,
    [limit]
  );
}
