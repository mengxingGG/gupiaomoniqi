import { z } from 'zod';

// 环境变量验证 Schema
const envSchema = z.object({
  SERVER_HOST: z.string().default('127.0.0.1'),
  SERVER_PORT: z.string().default('3001'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  API_KEY: z.string().optional(),
  DB_PATH: z.string().default('./data/stock_simulator.db'),
  LLM_CONFIG_PATH: z.string().default('./data/llm-config.json'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  NODE_ENV: z.enum(['development', 'production']).default('development'),
});

// 加载环境变量
function loadEnv() {
  // 从 process.env 读取
  const env = {
    SERVER_HOST: process.env.SERVER_HOST || '127.0.0.1',
    SERVER_PORT: process.env.SERVER_PORT || '3001',
    JWT_SECRET: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production',
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
    API_KEY: process.env.API_KEY,
    DB_PATH: process.env.DB_PATH || './data/stock_simulator.db',
    LLM_CONFIG_PATH: process.env.LLM_CONFIG_PATH || './data/llm-config.json',
    CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:5173',
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    NODE_ENV: process.env.NODE_ENV || 'development',
  };

  // 验证
  const result = envSchema.safeParse(env);

  if (!result.success) {
    console.error('❌ Environment validation failed:');
    console.error(result.error.format());
    process.exit(1);
  }

  return result.data;
}

export const env = loadEnv();

// 打印配置信息（不包含敏感信息）
export function printEnv() {
  console.log('📋 Server Configuration:');
  console.log(`  Host: ${env.SERVER_HOST}`);
  console.log(`  Port: ${env.SERVER_PORT}`);
  console.log(`  Database: ${env.DB_PATH}`);
  console.log(`  CORS Origin: ${env.CORS_ORIGIN}`);
  console.log(`  Log Level: ${env.LOG_LEVEL}`);
  console.log(`  Node Env: ${env.NODE_ENV}`);
  console.log(`  API Key: ${env.API_KEY ? 'configured' : 'not configured'}`);
}
