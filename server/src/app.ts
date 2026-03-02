import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import { env, printEnv } from './config/env.js';
import { initDatabase, closeDatabase, saveDatabase } from './db/index.js';

// 路由导入
import { authRoutes } from './routes/auth.js';
import { marketRoutes } from './routes/market.js';
import { tradeRoutes } from './routes/trade.js';
import { dataRoutes } from './routes/positions.js';
import { playerRoutes } from './routes/player.js';
import { loanRoutes } from './routes/loan.js';
import { giftCodeRoutes } from './routes/giftcode.js';
import { rankingRoutes } from './routes/ranking.js';
import { achievementRoutes } from './routes/achievements.js';
import { startPriceEngine, setWebSocketServer, addAIPressure } from './market/MarketEngine.js';

import { WebSocketServer } from 'ws';

// 扩展 Fastify 实例类型
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

async function buildApp() {
  // 初始化数据库（包含表创建）
  await initDatabase();

  const fastify = Fastify({
    logger: {
      level: env.LOG_LEVEL,
    },
  });

  // 注册 CORS
  await fastify.register(cors, {
    origin: env.CORS_ORIGIN,
    credentials: true,
  });

  // 注册 JWT
  await fastify.register(fastifyJwt, {
    secret: env.JWT_SECRET,
  });

  // 认证装饰器
  fastify.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.status(401).send({
        success: false,
        error: 'Unauthorized',
        code: 'UNAUTHORIZED',
      });
    }
  });

  // 注册路由
  await authRoutes(fastify);
  await marketRoutes(fastify);
  await tradeRoutes(fastify);
  await dataRoutes(fastify);
  await playerRoutes(fastify);
  await loanRoutes(fastify);
  await giftCodeRoutes(fastify);
  await rankingRoutes(fastify);
  await achievementRoutes(fastify);

  // AI 压力提交接口
  fastify.post('/api/market/ai-pressure', {
    preHandler: [fastify.authenticate],
  }, async (request: any, reply) => {
    const { pressures } = request.body || {};
    if (Array.isArray(pressures)) {
      for (const p of pressures) {
        if (p.code && typeof p.netVolume === 'number') {
          addAIPressure(p.code, p.netVolume);
        }
      }
    }
    reply.send({ success: true });
  });

  // WebSocket 路由已移除（使用下方 noServer 模式处理）

  // 启动价格引擎
  startPriceEngine(5000);

  return fastify;
}

async function start() {
  printEnv();

  try {
    const app = await buildApp();

    // 获取 WebSocket 服务器实例
    const server = app.server;
    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url || '', `http://${request.headers.host}`);
      console.log(`[WS] Upgrade request: ${request.url}, pathname: ${url.pathname}`);
      if (url.pathname === '/ws/market') {
        wss.handleUpgrade(request, socket, head, (ws) => {
          console.log('[WS] handleUpgrade complete, emitting connection');
          wss.emit('connection', ws, request);
        });
      } else {
        console.log(`[WS] Unknown path, destroying socket`);
        socket.destroy();
      }
    });

    wss.on('connection', (ws: any) => {
      console.log('WebSocket client connected');
      ws.on('close', () => console.log('WebSocket client disconnected'));
      ws.on('error', (error: any) => console.error('WebSocket error:', error));
    });

    setWebSocketServer(wss);

    await app.listen({ port: parseInt(env.SERVER_PORT), host: env.SERVER_HOST });
    console.log(`\n🚀 Server running at http://${env.SERVER_HOST}:${env.SERVER_PORT}\n`);

    // 优雅关闭
    const shutdown = async () => {
      console.log('\n🛑 Shutting down...');
      saveDatabase();
      closeDatabase();
      await app.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
