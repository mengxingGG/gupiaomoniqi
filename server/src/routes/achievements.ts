import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { dbUtils } from '../db/index.js';

// 成就定义
const achievementDefinitions = [
  { id: 'first_trade', name: '初出茅庐', description: '完成第一笔交易' },
  { id: 'ten_trades', name: '小试牛刀', description: '完成10笔交易' },
  { id: 'hundred_trades', name: '交易达人', description: '完成100笔交易' },
  { id: 'first_stock', name: '股东一枚', description: '买入第一只股票' },
  { id: 'five_stocks', name: '分散投资', description: '同时持有5只股票' },
  { id: 'millionaire', name: '百万富翁', description: '总资产超过100万' },
  { id: 'ten_million', name: '千万富翁', description: '总资产超过1000万' },
  { id: 'profit_10', name: '盈利10%', description: '收益率达到10%' },
  { id: 'profit_50', name: '盈利50%', description: '收益率达到50%' },
  { id: 'profit_100', name: '翻倍', description: '收益率达到100%' },
  { id: 'borrow_first', name: '负债前行', description: '第一次借款' },
  { id: 'repay_first', name: '有借有还', description: '还清第一笔贷款' },
];

// 获取成就列表
export async function getAchievementsRoute(fastify: FastifyInstance) {
  fastify.get('/api/achievements', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as any;

    // 获取已解锁的成就
    const unlocked = dbUtils.query<any>(
      'SELECT * FROM achievements WHERE player_id = ?',
      [user.userId]
    );
    const unlockedIds = new Set(unlocked.map(a => a.achievement_id));

    const achievements = achievementDefinitions.map(def => ({
      id: def.id,
      name: def.name,
      description: def.description,
      unlocked: unlockedIds.has(def.id),
      unlockedAt: unlocked.find(u => u.achievement_id === def.id)?.unlocked_at,
    }));

    reply.send({
      success: true,
      data: { achievements },
    });
  });
}

// 导出路由
export async function achievementRoutes(fastify: FastifyInstance) {
  await getAchievementsRoute(fastify);
}
