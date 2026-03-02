import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { tradeService } from '../services/TradeService.js';

// 获取持仓列表
export async function getPositionsRoute(fastify: FastifyInstance) {
  fastify.get('/api/positions', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as any;
    const positions = tradeService.getPositions(user.userId);

    reply.send({
      success: true,
      data: { positions },
    });
  });
}

// 获取委托单列表
export async function getOrdersRoute(fastify: FastifyInstance) {
  fastify.get('/api/orders', {
    preHandler: [fastify.authenticate],
  }, async (request: any, reply: FastifyReply) => {
    const user = request.user as any;
    const { status } = request.query;
    let orders = tradeService.getOrders(user.userId);

    // 过滤状态
    if (status) {
      orders = orders.filter((o: any) => o.status === status);
    }

    reply.send({
      success: true,
      data: { orders },
    });
  });
}

// 获取成交记录
export async function getTransactionsRoute(fastify: FastifyInstance) {
  fastify.get('/api/transactions', {
    preHandler: [fastify.authenticate],
  }, async (request: any, reply: FastifyReply) => {
    const user = request.user as any;
    const limit = parseInt(request.query.limit || '50', 10);
    const transactions = tradeService.getTransactions(user.userId, limit);

    reply.send({
      success: true,
      data: { transactions },
    });
  });
}

// 导出路由
export async function dataRoutes(fastify: FastifyInstance) {
  await getPositionsRoute(fastify);
  await getOrdersRoute(fastify);
  await getTransactionsRoute(fastify);
}
