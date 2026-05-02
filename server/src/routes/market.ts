import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { dbUtils, saveDatabase } from '../db/index.js';
import { adminAuthMiddleware, authOrApiKeyMiddleware } from '../middleware/auth.js';
import fs from 'fs';
import path from 'path';

// 获取所有股票（列表用，不含历史数据）
// 公开访问，无需认证
export async function getStocksRoute(fastify: FastifyInstance) {
  fastify.get('/api/market/stocks', async (_request: FastifyRequest, reply: FastifyReply) => {
    const allStocks = dbUtils.query<any>('SELECT code, name, market, industry, current_price, previous_close, open_price, high_price, low_price, volume, turnover, change_percent, change_amount, updated_at FROM stocks ORDER BY code');
    reply.send({
      success: true,
      data: { stocks: allStocks },
    });
  });
}

// 获取单只股票
export async function getStockRoute(fastify: FastifyInstance) {
  fastify.get('/api/market/stock/:code', {
    preHandler: [authOrApiKeyMiddleware],
  }, async (request: FastifyRequest<{ Params: { code: string } }>, reply: FastifyReply) => {
    const { code } = request.params;
    const stock = dbUtils.queryOne<any>('SELECT * FROM stocks WHERE code = ?', [code]);

    if (!stock) {
      reply.status(404).send({
        success: false,
        error: '股票不存在',
        code: 'STOCK_NOT_FOUND',
      });
      return;
    }

    reply.send({
      success: true,
      data: { stock },
    });
  });
}

// 获取分时数据（支持 limit 参数，只返回最新的 N 条）
export async function getTimelineRoute(fastify: FastifyInstance) {
  fastify.get('/api/market/stock/:code/timeline', {
    preHandler: [authOrApiKeyMiddleware],
  }, async (request: FastifyRequest<{ Params: { code: string }, Querystring: { limit?: string } }>, reply: FastifyReply) => {
    const { code } = request.params;
    const limit = parseInt(request.query.limit || '120', 10); // 默认返回最近120条（约1小时）
    
    const stock = dbUtils.queryOne<any>('SELECT price_history FROM stocks WHERE code = ?', [code]);
    
    if (!stock || !stock.price_history) {
      reply.send({ success: true, data: { timeline: [] } });
      return;
    }

    try {
      const history = JSON.parse(stock.price_history);
      
      // 只取最新的 limit 条数据
      const recentHistory = history.slice(-limit);
      
      const timeline = recentHistory.map((p: any) => ({
        time: p.time,
        price: p.price,
        volume: p.volume,
      }));
      
      reply.send({ success: true, data: { timeline, total: history.length } });
    } catch (e) {
      reply.send({ success: true, data: { timeline: [] } });
    }
  });
}

// 获取K线数据（支持 limit 和 period 参数）
// period: '1m' | '5m' | '15m' | '1h' | '1d'
export async function getDailyKRoute(fastify: FastifyInstance) {
  fastify.get('/api/market/stock/:code/kline', {
    preHandler: [authOrApiKeyMiddleware],
  }, async (request: FastifyRequest<{ Params: { code: string }, Querystring: { limit?: string, period?: string } }>, reply: FastifyReply) => {
    const { code } = request.params;
    const limit = parseInt(request.query.limit || '100', 10); // 默认返回100根K线
    const period = request.query.period || '1h'; // 默认1小时周期
    
    const stock = dbUtils.queryOne<any>('SELECT price_history FROM stocks WHERE code = ?', [code]);
    
    if (!stock || !stock.price_history) {
      reply.send({ success: true, data: { kline: [] } });
      return;
    }

    try {
      const history = JSON.parse(stock.price_history);
      
      // 计算需要的最原始数据条数（估算）
      const periodMs: Record<string, number> = {
        '1m': 60 * 1000,
        '5m': 5 * 60 * 1000,
        '15m': 15 * 60 * 1000,
        '1h': 60 * 60 * 1000,
        '1d': 24 * 60 * 60 * 1000,
      };
      
      const periodInterval = periodMs[period] || periodMs['1h'];
      const recordInterval = 30000; // 30秒一条记录
      
      // 估算需要的原始数据条数
      const neededRecords = Math.ceil((limit * periodInterval) / recordInterval) * 2;
      
      // 只取需要的部分数据
      const recentHistory = history.slice(-neededRecords);
      
      // 按周期聚合K线
      const klineMap = new Map<number, any>();
      for (const p of recentHistory) {
        const periodKey = Math.floor(p.time / periodInterval);
        const existing = klineMap.get(periodKey);
        if (!existing) {
          klineMap.set(periodKey, { 
            time: periodKey * periodInterval, 
            open: p.price, 
            high: p.price, 
            low: p.price, 
            close: p.price,
            volume: p.volume,
            turnover: p.turnover || 0,
          });
        } else {
          existing.high = Math.max(existing.high, p.price);
          existing.low = Math.min(existing.low, p.price);
          existing.close = p.price;
          existing.volume = Math.max(existing.volume, p.volume);
          existing.turnover = Math.max(existing.turnover || 0, p.turnover || 0);
        }
      }
      
      // 排序并限制数量
      let kline = Array.from(klineMap.values())
        .sort((a, b) => a.time - b.time)
        .slice(-limit);
      
      reply.send({ 
        success: true, 
        data: { 
          kline,
          period,
          total: kline.length,
        } 
      });
    } catch (e) {
      reply.send({ success: true, data: { kline: [] } });
    }
  });
}

// 保留旧接口兼容性
export async function getDailyKRouteLegacy(fastify: FastifyInstance) {
  fastify.get('/api/market/stock/:code/daily', {
    preHandler: [authOrApiKeyMiddleware],
  }, async (request: FastifyRequest<{ Params: { code: string } }>, reply: FastifyReply) => {
    const { code } = request.params;
    const stock = dbUtils.queryOne<any>('SELECT price_history FROM stocks WHERE code = ?', [code]);
    
    if (!stock || !stock.price_history) {
      reply.send({ success: true, data: { daily: [] } });
      return;
    }

    try {
      const history = JSON.parse(stock.price_history);
      
      // 只取最近 24 小时的数据（约 2880 条记录）
      const recentHistory = history.slice(-3000);
      const now = Date.now();
      const oneDayAgo = now - 24 * 60 * 60 * 1000;
      
      // 按小时聚合
      const hourlyMap = new Map<number, any>();
      for (const p of recentHistory) {
        if (p.time < oneDayAgo) continue;
        
        const hourKey = Math.floor(p.time / (60 * 60 * 1000));
        const existing = hourlyMap.get(hourKey);
        if (!existing) {
          hourlyMap.set(hourKey, { 
            time: hourKey * 60 * 60 * 1000, 
            open: p.price, 
            high: p.price, 
            low: p.price, 
            close: p.price,
            volume: p.volume,
          });
        } else {
          existing.high = Math.max(existing.high, p.price);
          existing.low = Math.min(existing.low, p.price);
          existing.close = p.price;
          existing.volume = Math.max(existing.volume, p.volume);
        }
      }
      
      const daily = Array.from(hourlyMap.values()).sort((a, b) => a.time - b.time);
      
      reply.send({ success: true, data: { daily } });
    } catch (e) {
      reply.send({ success: true, data: { daily: [] } });
    }
  });
}

// 导入股票种子数据
export async function importStocksRoute(fastify: FastifyInstance) {
  fastify.post('/api/admin/import-stocks', {
    preHandler: [adminAuthMiddleware],
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      // 查找 initial-stocks.json
      const possiblePaths = [
        './data/initial-stocks.json',
        '../data/initial-stocks.json',
        '../../data/initial-stocks.json',
        path.join(process.cwd(), 'data', 'initial-stocks.json'),
      ];

      let stocksData: any[] = [];
      let loadedPath = '';

      for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
          const content = fs.readFileSync(p, 'utf-8');
          const parsed = JSON.parse(content);
          // 支持 { stocks: [...] } 或 [...] 两种格式
          stocksData = parsed.stocks || parsed;
          loadedPath = p;
          break;
        }
      }

      if (stocksData.length === 0) {
        reply.status(404).send({
          success: false,
          error: '找不到股票数据文件 initial-stocks.json',
          code: 'FILE_NOT_FOUND',
        });
        return;
      }

      // 导入股票
      const now = Date.now();
      let imported = 0;

      for (const s of stocksData) {
        // 检查是否已存在
        const existing = dbUtils.queryOne<any>('SELECT code FROM stocks WHERE code = ?', [s.code]);

        if (!existing) {
          const price = s.price || s.currentPrice || 10;
          dbUtils.run(
            `INSERT INTO stocks (code, name, market, industry, current_price, previous_close, open_price, high_price, low_price, volume, turnover, change_percent, change_amount, price_history, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [s.code, s.name, s.market, s.industry || null, price, price, price, price, price, 0, 0, 0, 0, '[]', now]
          );
          imported++;
        }
      }

      saveDatabase();

      reply.send({
        success: true,
        data: { imported, total: stocksData.length, loadedPath },
      });
    } catch (error: any) {
      reply.status(500).send({
        success: false,
        error: '导入失败: ' + error.message,
        code: 'IMPORT_FAILED',
      });
    }
  });
}

// 导出所有市场路由
export async function marketRoutes(fastify: FastifyInstance) {
  await getStocksRoute(fastify);
  await getStockRoute(fastify);
  await getTimelineRoute(fastify);
  await getDailyKRoute(fastify);      // 新的 kline 接口
  await getDailyKRouteLegacy(fastify); // 保留旧接口兼容
  await importStocksRoute(fastify);
}
