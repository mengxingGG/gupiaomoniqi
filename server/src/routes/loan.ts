import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { loanService } from '../services/LoanService.js';
import { z } from 'zod';

// 借款输入验证
const borrowSchema = z.object({
  amount: z.number().positive(),
});

// 还款输入验证
const repaySchema = z.object({
  loanId: z.string(),
  amount: z.number().positive(),
});

// 借款路由
export async function borrowRoute(fastify: FastifyInstance) {
  fastify.post('/api/loan/borrow', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user as any;
      const input = borrowSchema.parse(request.body);

      const result = loanService.borrow(user.userId, input.amount);

      reply.send({
        success: true,
        data: {
          loan: result.loan,
          player: result.player,
        },
      });
    } catch (error: any) {
      const errorMap: Record<string, { code: string; message: string }> = {
        INVALID_AMOUNT: { code: 'INVALID_AMOUNT', message: '金额必须大于0' },
        PLAYER_NOT_FOUND: { code: 'PLAYER_NOT_FOUND', message: '玩家不存在' },
        LOAN_LIMIT_EXCEEDED: { code: 'LOAN_LIMIT_EXCEEDED', message: '借款额度已达上限' },
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
        error: '借款失败',
        code: 'BORROW_FAILED',
      });
    }
  });
}

// 还款路由
export async function repayRoute(fastify: FastifyInstance) {
  fastify.post('/api/loan/repay', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user as any;
      const input = repaySchema.parse(request.body);

      const result = loanService.repay(user.userId, input.loanId, input.amount);

      reply.send({
        success: true,
        data: {
          loan: result.loan,
          player: result.player,
        },
      });
    } catch (error: any) {
      const errorMap: Record<string, { code: string; message: string }> = {
        INVALID_AMOUNT: { code: 'INVALID_AMOUNT', message: '金额必须大于0' },
        LOAN_NOT_FOUND: { code: 'LOAN_NOT_FOUND', message: '借贷记录不存在' },
        UNAUTHORIZED: { code: 'UNAUTHORIZED', message: '无权操作' },
        LOAN_ALREADY_REPAID: { code: 'LOAN_ALREADY_REPAID', message: '贷款已还清' },
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
        error: '还款失败',
        code: 'REPAY_FAILED',
      });
    }
  });
}

// 获取借贷记录
export async function getLoansRoute(fastify: FastifyInstance) {
  fastify.get('/api/loans', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as any;
    const loans = loanService.getLoans(user.userId);

    reply.send({
      success: true,
      data: { loans },
    });
  });
}

// 导出路由
export async function loanRoutes(fastify: FastifyInstance) {
  await borrowRoute(fastify);
  await repayRoute(fastify);
  await getLoansRoute(fastify);
}
