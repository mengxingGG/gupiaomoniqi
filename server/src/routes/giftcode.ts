import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { giftCodeService } from '../services/GiftCodeService.js';
import { z } from 'zod';

// 兑换输入验证
const redeemSchema = z.object({
  code: z.string().min(1),
});

// 兑换路由
export async function redeemRoute(fastify: FastifyInstance) {
  fastify.post('/api/giftcode/redeem', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user as any;
      const input = redeemSchema.parse(request.body);

      const result = giftCodeService.redeem(user.userId, input.code);

      reply.send({
        success: true,
        data: {
          amount: result.amount,
          player: result.player,
        },
      });
    } catch (error: any) {
      const errorMap: Record<string, { code: string; message: string }> = {
        CODE_ALREADY_USED: { code: 'CODE_ALREADY_USED', message: '该礼包码已被使用' },
        INVALID_CODE: { code: 'INVALID_CODE', message: '无效的礼包码' },
        PLAYER_NOT_FOUND: { code: 'PLAYER_NOT_FOUND', message: '玩家不存在' },
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
        error: '兑换失败',
        code: 'REDEEM_FAILED',
      });
    }
  });
}

// 导出路由
export async function giftCodeRoutes(fastify: FastifyInstance) {
  await redeemRoute(fastify);
}
