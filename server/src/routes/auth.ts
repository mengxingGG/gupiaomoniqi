import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authService, RegisterInput, LoginInput } from '../services/AuthService.js';
import { z, ZodError } from 'zod';

// 注册输入验证
const registerSchema = z.object({
  username: z.string().min(3, '用户名至少 3 个字符').max(20, '用户名最多 20 个字符')
    .regex(/^[a-zA-Z0-9_]+$/, '用户名只能包含字母、数字和下划线'),
  password: z.string()
    .min(8, '密码至少 8 个字符')
    .max(128, '密码最多 128 个字符')
    .regex(/[A-Z]/, '密码必须包含至少一个大写字母')
    .regex(/[a-z]/, '密码必须包含至少一个小写字母')
    .regex(/[0-9]/, '密码必须包含至少一个数字'),
  displayName: z.string().min(1, '昵称不能为空').max(50, '昵称最多 50 个字符'),
});

// 登录输入验证
const loginSchema = z.object({
  username: z.string().min(1, '用户名不能为空'),
  password: z.string().min(1, '密码不能为空'),
});

// 注册路由（严格限流：每分钟最多 5 次）
export async function registerRoute(fastify: FastifyInstance) {
  fastify.post('/api/auth/register', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 minute',
        errorResponseBuilder: () => ({
          success: false,
          error: '注册请求过于频繁，请稍后再试',
          code: 'RATE_LIMIT_EXCEEDED',
        }),
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const input = registerSchema.parse(request.body);

      const result = await authService.register(input as RegisterInput);

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
      console.error('注册错误:', error);
      
      // Zod 验证错误
      if (error instanceof ZodError) {
        const firstError = error.errors[0];
        reply.status(400).send({
          success: false,
          error: firstError.message || '输入验证失败',
          code: 'VALIDATION_ERROR',
        });
        return;
      }
      
      // 用户名已存在错误
      if (error.message === 'USERNAME_EXISTS') {
        reply.status(400).send({
          success: false,
          error: '用户名已存在',
          code: 'USERNAME_EXISTS',
        });
        return;
      }
      
      // 其他错误
      reply.status(500).send({
        success: false,
        error: '注册失败',
        code: 'REGISTER_FAILED',
      });
    }
  });
}

// 登录路由（严格限流：每分钟最多 10 次）
export async function loginRoute(fastify: FastifyInstance) {
  fastify.post('/api/auth/login', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
        errorResponseBuilder: () => ({
          success: false,
          error: '登录请求过于频繁，请稍后再试',
          code: 'RATE_LIMIT_EXCEEDED',
        }),
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const input = loginSchema.parse(request.body);

      const result = await authService.login(input as LoginInput);

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
      console.error('登录错误:', error);
      
      // Zod 验证错误
      if (error instanceof ZodError) {
        const firstError = error.errors[0];
        reply.status(400).send({
          success: false,
          error: firstError.message || '输入验证失败',
          code: 'VALIDATION_ERROR',
        });
        return;
      }
      
      // 无效凭据错误
      if (error.message === 'INVALID_CREDENTIALS') {
        reply.status(401).send({
          success: false,
          error: '用户名或密码错误',
          code: 'INVALID_CREDENTIALS',
        });
        return;
      }
      
      // 其他错误
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
