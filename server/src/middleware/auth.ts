import { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../config/env.js';

// 获取真实客户端 IP（考虑代理）
function getRealIp(request: FastifyRequest): string {
  // 优先使用 X-Forwarded-For（代理转发）
  const forwarded = request.headers['x-forwarded-for'];
  if (forwarded) {
    // X-Forwarded-For 可能是字符串或数组
    const forwardedStr = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    if (forwardedStr) {
      // 可能是逗号分隔的列表，第一个是最原始的客户端
      const ips = forwardedStr.split(',').map(ip => ip.trim());
      if (ips.length > 0 && ips[0]) {
        return ips[0];
      }
    }
  }
  // 否则使用直接连接的 IP
  return request.ip;
}

// 检查是否为真正的本地请求（非代理）
function isLocalRequest(request: FastifyRequest): boolean {
  const connectionIp = request.ip;
  
  // 如果连接 IP 不是本地地址，则不是本地请求
  const isLocalConnection = connectionIp === '127.0.0.1' || 
                            connectionIp === '::1' || 
                            connectionIp === '::ffff:127.0.0.1';
  
  if (!isLocalConnection) {
    return false;
  }
  
  // 检查是否有代理转发的真实 IP
  const forwarded = request.headers['x-forwarded-for'];
  if (forwarded) {
    const forwardedStr = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    if (forwardedStr) {
      const ips = forwardedStr.split(',').map(ip => ip.trim());
      const realIp = ips[0];
      // 如果真实 IP 不是本地，说明是通过代理的远程请求
      if (realIp && !(realIp === '127.0.0.1' || realIp === '::1' || realIp === '::ffff:127.0.0.1' || realIp === 'localhost')) {
        return false;
      }
    }
  }
  
  // 检查 X-Real-IP（nginx 常用）
  const realIp = request.headers['x-real-ip'];
  if (realIp && typeof realIp === 'string') {
    if (!(realIp === '127.0.0.1' || realIp === '::1' || realIp === '::ffff:127.0.0.1' || realIp === 'localhost')) {
      return false;
    }
  }
  
  return true;
}

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
  // 如果有代理标记头，说明是通过前端代理的请求，需要验证 API Key
  const proxyBy = request.headers['x-proxy-by'];
  if (proxyBy === 'vite-preview') {
    if (!process.env.API_KEY) {
      reply.status(503).send({
        success: false,
        error: 'Remote access is disabled',
        code: 'REMOTE_DISABLED'
      });
      return;
    }
    const apiKey = request.headers['x-api-key'];
    if (!apiKey || apiKey !== process.env.API_KEY) {
      reply.status(403).send({
        success: false,
        error: 'Invalid API Key',
        code: 'INVALID_API_KEY'
      });
      return;
    }
    return;
  }
  
  // 只有真正的本地请求才跳过 API Key 验证
  if (isLocalRequest(request)) {
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

// 管理员 API Key 验证中间件
export async function adminAuthMiddleware(request: FastifyRequest, reply: FastifyReply) {
  // 只有真正的本地请求才跳过验证
  if (isLocalRequest(request)) {
    return;
  }

  // 必须配置管理员 API Key
  if (!env.ADMIN_API_KEY) {
    reply.status(503).send({
      success: false,
      error: 'Admin API is disabled',
      code: 'ADMIN_DISABLED'
    });
    return;
  }

  // 验证管理员 API Key
  const adminKey = request.headers['x-admin-api-key'];
  if (!adminKey || adminKey !== env.ADMIN_API_KEY) {
    reply.status(403).send({
      success: false,
      error: 'Invalid Admin API Key',
      code: 'INVALID_ADMIN_KEY'
    });
  }
}

// 组合中间件：需要认证
export const requireAuth = [authMiddleware];

// 组合中间件：可选认证 + API Key（用于需要保护的公开接口）
export const requireAuthOrKey = [optionalAuthMiddleware, apiKeyMiddleware];

// 组合中间件：管理员权限
export const requireAdmin = [adminAuthMiddleware];

// 灵活认证：接受 JWT 或 API Key 任一
export async function authOrApiKeyMiddleware(request: FastifyRequest, reply: FastifyReply) {
  // 调试：打印请求信息
  console.log('[AUTH DEBUG] URL:', request.url);
  console.log('[AUTH DEBUG] IP:', request.ip);
  console.log('[AUTH DEBUG] X-Proxy-By:', request.headers['x-proxy-by']);
  console.log('[AUTH DEBUG] X-Forwarded-For:', request.headers['x-forwarded-for']);
  console.log('[AUTH DEBUG] X-API-Key:', request.headers['x-api-key'] ? 'present' : 'absent');
  
  // 1. 先检查 JWT
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      await request.jwtVerify();
      console.log('[AUTH DEBUG] JWT valid, passed');
      return; // JWT 有效，通过
    } catch (err) {
      console.log('[AUTH DEBUG] JWT invalid, checking API Key');
    }
  }
  
  // 2. 检查 API Key
  const apiKey = request.headers['x-api-key'];
  if (apiKey && env.API_KEY && apiKey === env.API_KEY) {
    console.log('[AUTH DEBUG] API Key valid, passed');
    return; // API Key 有效，通过
  }
  
  // 3. 本地请求允许通过
  if (isLocalRequest(request)) {
    console.log('[AUTH DEBUG] Local request, passed');
    return;
  }
  
  // 4. 都不满足，拒绝
  console.log('[AUTH DEBUG] All checks failed, rejecting');
  reply.status(401).send({
    success: false,
    error: 'Authentication required. Please login or provide a valid API Key.',
    code: 'AUTH_REQUIRED'
  });
}
