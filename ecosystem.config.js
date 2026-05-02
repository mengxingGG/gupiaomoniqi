module.exports = {
  apps: [
    {
      name: "stock-server",
      script: "npm",
      args: "run start",
      cwd: "/www/gupiaomoniqi-prod/股票模拟器2.0/server",
      instances: 1,
      autorestart: true,
      watch: false,
      kill_timeout: 10000,  // 给10秒时间优雅关闭
      wait_ready: true,     // 等待进程发送 ready 信号
      listen_timeout: 10000,
      env: {
        NODE_ENV: "production",
        SERVER_HOST: "127.0.0.1",
        SERVER_PORT: "3009",
        JWT_SECRET: "b8c3b96b05f96c7ea72a1f746bc4c35e123fc1282d695525595bcaaeff1dee08",
        JWT_EXPIRES_IN: "7d",
        API_KEY: "fbd12ccc6e459d8dce75897fd3d57972",
        ADMIN_API_KEY: "admin_06f2db0b251cd9ff6aca4e9502055561",
        DB_PATH: "./data/stock_simulator.db",
        LLM_CONFIG_PATH: "./data/llm-config.json",
        CORS_ORIGIN: "*",
        LOG_LEVEL: "info"
      }
    },
    {
      name: "stock-client",
      script: "npm",
      args: "run preview -- --port 80 --host 0.0.0.0",
      cwd: "/www/gupiaomoniqi-prod/股票模拟器2.0/client",
      instances: 1,
      autorestart: true,
      watch: false,
      kill_timeout: 5000
    }
  ]
}
