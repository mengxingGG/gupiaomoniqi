import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authService } from '../services/AuthService.js';
import { z } from 'zod';

// 注册输入验证
const registerSchema = z.object({
  username: z.string().min(3).max(20),
  password: z.string().min(6),
  displayName: z.string().min(1).max(50),
});

// 登录输入验证
const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

// 注册路由
export async function registerRoute(fastify: FastifyInstance) {
  fastify.post('/api/auth/register', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const input = registerSchema.parse(request.body);

      const result = await authService.register(input);

      // 生成 JWT
      const token = fastify.jwt.sign({
        userId: result.user.userId,
        username: result.user.username,
      });

      reply.send({
        success: true,
        data: {
          token,
          user: result.user,
          player: result.player,
        },
      });
    } catch (error: any) {
      if (error.message === 'USERNAME_EXISTS') {
        reply.status(400).send({
          success: false,
          error: '用户名已存在',
          code: 'USERNAME_EXISTS',
        });
        return;
      }
      reply.status(500).send({
        success: false,
        error: '注册失败',
        code: 'REGISTER_FAILED',
      });
    }
  });
}

// 登录路由
export async function loginRoute(fastify: FastifyInstance) {
  fastify.post('/api/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const input = loginSchema.parse(request.body);

      const result = await authService.login(input);

      // 生成 JWT
      const token = fastify.jwt.sign({
        userId: result.user.userId,
        username: result.user.username,
      });

      reply.send({
        success: true,
        data: {
          token,
          user: result.user,
          player: result.player,
        },
      });
    } catch (error: any) {
      if (error.message === 'INVALID_CREDENTIALS') {
        reply.status(401).send({
          success: false,
          error: '用户名或密码错误',
          code: 'INVALID_CREDENTIALS',
        });
        return;
      }
      reply.status(500).send({
        success: false,
        error: '登录失败',
        code: 'LOGIN_FAILED',
      });
    }
  });
}

// 登出路由
export async function logoutRoute(fastify: FastifyInstance) {
  fastify.post('/api/auth/logout', async (_request: FastifyRequest, reply: FastifyReply) => {
    // JWT 是无状态的，登出只需通知客户端删除 token
    reply.send({
      success: true,
      data: { message: '登出成功' },
    });
  });
}

// 获取当前用户信息
export async function meRoute(fastify: FastifyInstance) {
  fastify.get('/api/auth/me', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as any;
    const result = await authService.getMe(user.userId);

    if (!result) {
      reply.status(404).send({
        success: false,
        error: '用户不存在',
        code: 'USER_NOT_FOUND',
      });
      return;
    }

    reply.send({
      success: true,
      data: result,
    });
  });
}

// 导出所有认证路由
export async function authRoutes(fastify: FastifyInstance) {
  await registerRoute(fastify);
  await loginRoute(fastify);
  await logoutRoute(fastify);
  await meRoute(fastify);
}
