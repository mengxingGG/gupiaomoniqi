import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { tradeService } from '../services/TradeService.js';
import { z } from 'zod';

// 买入输入验证
const buySchema = z.object({
  stockCode: z.string(),
  quantity: z.number().int().positive(),
  orderMode: z.enum(['MARKET', 'LIMIT']),
  price: z.number().positive().optional(),
});

// 卖出输入验证
const sellSchema = z.object({
  stockCode: z.string(),
  quantity: z.number().int().positive(),
  orderMode: z.enum(['MARKET', 'LIMIT']),
  price: z.number().positive().optional(),
});

// 撤单输入验证
const cancelSchema = z.object({
  orderId: z.string(),
});

// 买入路由
export async function buyRoute(fastify: FastifyInstance) {
  fastify.post('/api/trade/buy', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user as any;
      const input = buySchema.parse(request.body);

      const result = await tradeService.buy({
        playerId: user.userId,
        ...input,
      });

      reply.send({
        success: true,
        data: {
          order: result.order,
          player: result.player,
        },
      });
    } catch (error: any) {
      const errorMap: Record<string, { code: string; message: string }> = {
        STOCK_NOT_FOUND: { code: 'STOCK_NOT_FOUND', message: '股票不存在' },
        PLAYER_NOT_FOUND: { code: 'PLAYER_NOT_FOUND', message: '玩家不存在' },
        INSUFFICIENT_FUNDS: { code: 'INSUFFICIENT_FUNDS', message: '资金不足' },
      };

      const err = errorMap[error.message];
      if (err) {
        reply.status(400).send({
          success: false,
          error: err.message,
          code: err.code,
        });
        return;
      }

      console.error('[BUY ERROR]', error?.message, error?.stack);
      reply.status(500).send({
        success: false,
        error: '交易失败',
        code: 'TRADE_FAILED',
      });
    }
  });
}

// 卖出路由
export async function sellRoute(fastify: FastifyInstance) {
  fastify.post('/api/trade/sell', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user as any;
      const input = sellSchema.parse(request.body);

      const result = await tradeService.sell({
        playerId: user.userId,
        ...input,
      });

      reply.send({
        success: true,
        data: {
          order: result.order,
          player: result.player,
        },
      });
    } catch (error: any) {
      const errorMap: Record<string, { code: string; message: string }> = {
        STOCK_NOT_FOUND: { code: 'STOCK_NOT_FOUND', message: '股票不存在' },
        PLAYER_NOT_FOUND: { code: 'PLAYER_NOT_FOUND', message: '玩家不存在' },
        NO_POSITION: { code: 'NO_POSITION', message: '没有持仓' },
        INSUFFICIENT_AVAILABLE_QUANTITY: { code: 'INSUFFICIENT_AVAILABLE_QUANTITY', message: '可卖数量不足' },
      };

      const err = errorMap[error.message];
      if (err) {
        reply.status(400).send({
          success: false,
          error: err.message,
          code: err.code,
        });
        return;
      }

      console.error('[SELL ERROR]', error?.message, error?.stack);
      reply.status(500).send({
        success: false,
        error: '交易失败',
        code: 'TRADE_FAILED',
      });
    }
  });
}

// 撤单路由
export async function cancelRoute(fastify: FastifyInstance) {
  fastify.post('/api/trade/cancel', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user as any;
      const input = cancelSchema.parse(request.body);

      const result = await tradeService.cancel(input.orderId, user.userId);

      reply.send({
        success: true,
        data: {
          order: result.order,
          player: result.player,
        },
      });
    } catch (error: any) {
      const errorMap: Record<string, { code: string; message: string }> = {
        ORDER_NOT_FOUND: { code: 'ORDER_NOT_FOUND', message: '订单不存在' },
        ORDER_NOT_PENDING: { code: 'ORDER_NOT_PENDING', message: '只能撤_pending状态的订单' },
      };

      const err = errorMap[error.message];
      if (err) {
        reply.status(400).send({
          success: false,
          error: err.message,
          code: err.code,
        });
        return;
      }

      reply.status(500).send({
        success: false,
        error: '撤单失败',
        code: 'CANCEL_FAILED',
      });
    }
  });
}

// 导出所有交易路由
export async function tradeRoutes(fastify: FastifyInstance) {
  await buyRoute(fastify);
  await sellRoute(fastify);
  await cancelRoute(fastify);
}
