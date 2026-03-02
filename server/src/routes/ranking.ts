import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { rankingService } from '../services/RankingService.js';

// 获取排行榜
export async function getRankingRoute(fastify: FastifyInstance) {
  fastify.get('/api/ranking', async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
    const limit = parseInt(request.query.limit || '20', 10);
    const rankings = rankingService.getRanking(limit);

    reply.send({
      success: true,
      data: { rankings },
    });
  });
}

// 导出路由
export async function rankingRoutes(fastify: FastifyInstance) {
  await getRankingRoute(fastify);
}
