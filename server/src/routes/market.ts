import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { dbUtils, saveDatabase } from '../db/index.js';
import fs from 'fs';
import path from 'path';

// 获取所有股票
export async function getStocksRoute(fastify: FastifyInstance) {
  fastify.get('/api/market/stocks', async (_request: FastifyRequest, reply: FastifyReply) => {
    const allStocks = dbUtils.query<any>('SELECT * FROM stocks ORDER BY code');
    reply.send({
      success: true,
      data: { stocks: allStocks },
    });
  });
}

// 获取单只股票
export async function getStockRoute(fastify: FastifyInstance) {
  fastify.get('/api/market/stock/:code', async (request: FastifyRequest<{ Params: { code: string } }>, reply: FastifyReply) => {
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

// 导入股票种子数据
export async function importStocksRoute(fastify: FastifyInstance) {
  fastify.post('/api/admin/import-stocks', async (_request: FastifyRequest, reply: FastifyReply) => {
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
  await importStocksRoute(fastify);
}
