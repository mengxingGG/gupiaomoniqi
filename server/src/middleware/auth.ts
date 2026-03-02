import { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../config/env.js';

// JWT 认证中间件
export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  try {
    // 验证 JWT
    await request.jwtVerify();
  } catch (err) {
    reply.status(401).send({
      success: false,
      error: 'Unauthorized: Invalid or expired token',
      code: 'UNAUTHORIZED'
    });
  }
}

// 可选的认证中间件（如果 token 存在则验证，不存在也继续）
export async function optionalAuthMiddleware(request: FastifyRequest, _reply: FastifyReply) {
  const authHeader = request.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      await request.jwtVerify();
    } catch (err) {
      // Token 无效，但继续执行
    }
  }
}

// API Key 验证中间件（非本地请求必须携带）
export async function apiKeyMiddleware(request: FastifyRequest, reply: FastifyReply) {
  // 本地请求（127.0.0.1 或 localhost）跳过 API Key 验证
  const ip = request.ip;
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') {
    return;
  }

  // 如果没有配置 API Key，不允许远程访问
  if (!env.API_KEY) {
    reply.status(403).send({
      success: false,
      error: 'Remote access is disabled. Please deploy locally.',
      code: 'REMOTE_DISABLED'
    });
    return;
  }

  // 验证 API Key
  const apiKey = request.headers['x-api-key'];
  if (!apiKey || apiKey !== env.API_KEY) {
    reply.status(403).send({
      success: false,
      error: 'Invalid API Key',
      code: 'INVALID_API_KEY'
    });
  }
}

// 组合中间件：需要认证
export const requireAuth = [authMiddleware];

// 组合中间件：可选认证 + API Key（用于需要保护的公开接口）
export const requireAuthOrKey = [optionalAuthMiddleware, apiKeyMiddleware];
