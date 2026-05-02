/**
 * Ollama 本地 LLM 服务
 * 用于 AI 交易者的智能决策
 */

const OLLAMA_API = 'http://localhost:11434';
const MODEL = 'qwen2.5:0.5b';

export interface AIDecision {
  action: 'buy' | 'sell' | 'hold';
  stock_code?: string;
  quantity?: number;
  reason: string;
  confidence: number; // 0-100
}

export interface MarketContext {
  trader_name: string;
  strategy: string;
  cash: number;
  total_assets: number;
  positions: {
    stock_code: string;
    stock_name: string;
    quantity: number;
    avg_cost: number;
    current_price: number;
    profit_percent: number;
  }[];
  market_snapshot: {
    code: string;
    name: string;
    price: number;
    change_percent: number;
    volume: number;
  }[];
}

/**
 * 调用 Ollama API 生成决策
 */
export async function askOllama(prompt: string): Promise<string> {
  try {
    const response = await fetch(`${OLLAMA_API}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        stream: false,
        options: {
          temperature: 0.7,
          top_p: 0.9,
          num_predict: 200, // 限制输出长度
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const data = await response.json() as { response?: string };
    return data.response || '';
  } catch (error) {
    console.error('[Ollama] API 调用失败:', error);
    return '';
  }
}

/**
 * 构建 AI 交易决策 prompt
 */
function buildDecisionPrompt(ctx: MarketContext): string {
  const posInfo = ctx.positions.length > 0
    ? ctx.positions.map(p => 
        `${p.stock_name}(${p.stock_code}): ${p.quantity}股，成本¥${p.avg_cost.toFixed(2)}，现价¥${p.current_price.toFixed(2)}，${p.profit_percent >= 0 ? '盈' : '亏'}${Math.abs(p.profit_percent).toFixed(1)}%`
      ).join('\n')
    : '无持仓';

  const marketInfo = ctx.market_snapshot
    .slice(0, 10) // 只展示前10只
    .map(s => `${s.name}(${s.code}) ¥${s.price.toFixed(2)} ${s.change_percent >= 0 ? '+' : ''}${s.change_percent.toFixed(1)}%`)
    .join('\n');

  const stockCodes = ctx.market_snapshot.slice(0, 10).map(s => s.code).join(',');

  return `你是股票交易员"${ctx.trader_name}"，采用${ctx.strategy}策略。

【账户】现金:${(ctx.cash/10000).toFixed(0)}万 总资产:${(ctx.total_assets/10000).toFixed(0)}万

【持仓】
${posInfo}

【行情】
${marketInfo}

【任务】做出交易决策。
- 买入：选一只看涨的股票
- 卖出：选一只需要止损或止盈的持仓
- 持仓：观望不动

【输出格式】严格输出以下JSON，不要有其他文字：
{"action":"buy","stock_code":"000001","quantity":5,"reason":"看好银行股"}
或
{"action":"sell","stock_code":"000002","quantity":10,"reason":"止损"}
或
{"action":"hold","reason":"等待机会"}

可选股票代码：${stockCodes}
action只能是buy/sell/hold其中一个。
quantity单位是手，1手=100股。`;
}

/**
 * 解析 AI 返回的决策
 */
function parseDecision(response: string): AIDecision {
  // 尝试提取 JSON
  const jsonMatch = response.match(/\{[^}]+\}/);
  if (!jsonMatch) {
    return { action: 'hold', reason: '无法解析决策', confidence: 0 };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    
    // 验证并修正 action
    let action: 'buy' | 'sell' | 'hold' = 'hold';
    const actionStr = String(parsed.action || '').toLowerCase();
    if (actionStr === 'buy' || actionStr.includes('买')) {
      action = 'buy';
    } else if (actionStr === 'sell' || actionStr.includes('卖')) {
      action = 'sell';
    }
    
    // 提取股票代码（可能带括号，需要清理）
    let stockCode = String(parsed.stock_code || '');
    const codeMatch = stockCode.match(/\d{6}/);
    if (codeMatch) {
      stockCode = codeMatch[0];
    }
    
    // 解析数量（手 -> 股）
    let quantity = 0;
    if (parsed.quantity) {
      const qty = parseInt(parsed.quantity, 10);
      if (!isNaN(qty) && qty > 0) {
        quantity = qty * 100; // 手转股
      }
    }
    
    return {
      action,
      stock_code: stockCode,
      quantity,
      reason: String(parsed.reason || ''),
      confidence: parseInt(parsed.confidence, 10) || 50
    };
  } catch {
    return { action: 'hold', reason: 'JSON解析失败', confidence: 0 };
  }
}

/**
 * 获取 AI 交易决策（带超时）
 */
export async function getAIDecision(ctx: MarketContext, timeoutMs: number = 10000): Promise<AIDecision> {
  const prompt = buildDecisionPrompt(ctx);
  
  // 超时控制
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await askOllama(prompt);
    clearTimeout(timeout);
    
    const decision = parseDecision(response);
    console.log(`[Ollama] ${ctx.trader_name} 决策: ${decision.action} ${decision.stock_code || '-'} | 信心:${decision.confidence}% | ${decision.reason}`);
    
    return decision;
  } catch (error: any) {
    clearTimeout(timeout);
    console.error(`[Ollama] ${ctx.trader_name} 决策失败:`, error.message);
    return { action: 'hold', reason: '决策超时', confidence: 0 };
  }
}

/**
 * 健康检查
 */
export async function checkOllamaHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_API}/api/tags`, { 
      method: 'GET',
      signal: AbortSignal.timeout(3000)
    });
    return response.ok;
  } catch {
    return false;
  }
}