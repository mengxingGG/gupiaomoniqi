import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { rankingService } from '../services/RankingService.js';

// 获取总排行榜（玩家 + AI）
export async function getRankingRoute(fastify: FastifyInstance) {
  fastify.get('/api/ranking', async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
    const limit = parseInt(request.query.limit || '100', 10);
    const ranking = rankingService.getRanking(limit);

    reply.send({
      success: true,
      data: { ranking },
    });
  });
}

// 获取 AI 交易者排行榜
export async function getAIRankingRoute(fastify: FastifyInstance) {
  fastify.get('/api/ranking/ai', async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
    const limit = parseInt(request.query.limit || '100', 10);
    const ranking = rankingService.getAIRanking(limit);

    reply.send({
      success: true,
      data: { ranking },
    });
  });
}

// 导出路由
export async function rankingRoutes(fastify: FastifyInstance) {
  await getRankingRoute(fastify);
  await getAIRankingRoute(fastify);
}
