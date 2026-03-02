import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { dbUtils } from '../db/index.js';

// 获取当前玩家信息
export async function getPlayerRoute(fastify: FastifyInstance) {
  fastify.get('/api/player/me', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as any;
    const player = dbUtils.queryOne<any>('SELECT * FROM players WHERE id = ?', [user.userId]);

    if (!player) {
      reply.status(404).send({
        success: false,
        error: '玩家不存在',
        code: 'PLAYER_NOT_FOUND',
      });
      return;
    }

    reply.send({
      success: true,
      data: { player },
    });
  });
}

// 更新玩家设置
export async function updatePlayerSettingsRoute(fastify: FastifyInstance) {
  fastify.put('/api/player/settings', {
    preHandler: [fastify.authenticate],
  }, async (request: any, reply: FastifyReply) => {
    const user = request.user as any;
    const { isPaused, tradingDay } = request.body || {};

    const player = dbUtils.queryOne<any>('SELECT * FROM players WHERE id = ?', [user.userId]);

    if (!player) {
      reply.status(404).send({
        success: false,
        error: '玩家不存在',
        code: 'PLAYER_NOT_FOUND',
      });
      return;
    }

    const updates: string[] = [];
    const values: any[] = [];

    if (isPaused !== undefined) {
      updates.push('is_paused = ?');
      values.push(isPaused);
    }
    if (tradingDay !== undefined) {
      updates.push('trading_day = ?');
      values.push(tradingDay);
    }

    if (updates.length > 0) {
      updates.push('updated_at = ?');
      values.push(Date.now());
      values.push(user.userId);

      dbUtils.run(
        `UPDATE players SET ${updates.join(', ')} WHERE id = ?`,
        values
      );
    }

    const updated = dbUtils.queryOne<any>('SELECT * FROM players WHERE id = ?', [user.userId]);

    reply.send({
      success: true,
      data: { player: updated },
    });
  });
}

// 注销账号
export async function deleteAccountRoute(fastify: FastifyInstance) {
  fastify.delete('/api/player/me', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as any;

    try {
      dbUtils.run('DELETE FROM accounts WHERE id = ?', [user.userId]);

      reply.send({
        success: true,
        data: { message: '账号已注销' },
      });
    } catch (error) {
      reply.status(500).send({
        success: false,
        error: '注销失败',
        code: 'DELETE_FAILED',
      });
    }
  });
}

// 导出路由
export async function playerRoutes(fastify: FastifyInstance) {
  await getPlayerRoute(fastify);
  await updatePlayerSettingsRoute(fastify);
  await deleteAccountRoute(fastify);
}
