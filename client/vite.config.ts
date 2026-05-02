import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 80,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3009',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '/api'), // 保持 /api 前缀
      },
      '/ws': {
        target: 'ws://127.0.0.1:3009',
        ws: true,
      },
    },
  },
  preview: {
    port: 80,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3009',
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/api/, '/api'), // 保持 /api 前缀
        headers: {
          // 代理时添加标记头，让后端识别这是代理请求
          'X-Proxy-By': 'vite-preview',
        },
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            // 传递真实客户端 IP
            const existingForwarded = req.headers['x-forwarded-for'];
            const clientIp = req.socket?.remoteAddress || 'unknown';
            
            if (existingForwarded) {
              // 已有 X-Forwarded-For，追加当前客户端 IP
              proxyReq.setHeader('X-Forwarded-For', `${existingForwarded}, ${clientIp}`);
            } else {
              // 新建 X-Forwarded-For
              proxyReq.setHeader('X-Forwarded-For', clientIp);
            }
          });
        },
      },
      '/ws': {
        target: 'ws://127.0.0.1:3009',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  esbuild: {
    drop: [],
  },
})
