# 股票模拟器 2.0 - 安全配置

## 🔐 安全加固完成 (2026-03-07)

### 架构说明

```
安卓客户端 ──(公网)──> 前端代理(80端口) ──(本地)──> 后端API(3009端口)
                              │
                              ▼
                    X-Proxy-By: vite-preview
                    (触发 API Key 验证)
```

**安全原理**：
- 后端绑定 127.0.0.1，只接受本地连接
- 前端代理通过 `X-Proxy-By: vite-preview` 标记所有转发请求
- 后端检测到此头后强制要求 API Key
- 本地直接访问后端（无代理标记）无需 API Key

### 1. 密钥配置

| 配置项 | 用途 | 备注 |
|--------|------|------|
| JWT_SECRET | JWT 签名密钥 | 64字符随机hex |
| API_KEY | 客户端访问密钥 | 安卓客户端需携带 |
| ADMIN_API_KEY | 管理接口密钥 | 管理员操作专用 |

### 2. 速率限制

| 端点 | 限制 | 时间窗口 |
|------|------|----------|
| 全局 | 100 次/分钟 | 防止滥用 |
| /api/auth/register | 5 次/分钟 | 防止批量注册 |
| /api/auth/login | 10 次/分钟 | 防止暴力破解 |

### 3. 认证保护

| 端点 | 认证方式 |
|------|----------|
| /api/auth/me | JWT Token |
| /api/trade/* | JWT Token |
| /api/player/* | JWT Token |
| /api/positions | JWT Token |
| /api/orders | JWT Token |
| /api/market/stocks | API Key (代理请求) |
| /api/admin/* | Admin API Key (远程) |

### 4. 密码策略

- 最小长度：8 字符
- 必须包含：大写字母、小写字母、数字
- 用户名规则：3-20字符，仅字母数字下划线

### 5. 远程访问

安卓客户端访问需要：
```http
X-API-Key: fbd12ccc6e459d8dce75897fd3d57972
```

管理接口访问需要：
```http
X-Admin-API-Key: admin_06f2db0b251cd9ff6aca4e9502055561
```

### 6. 本地访问特权

- 直接访问后端 (127.0.0.1:3009) 无需 API Key
- 通过前端代理的请求必须携带 API Key
- 管理接口本地访问无需认证

## ⚠️ 开放公网前

- [x] 前端代理自动标记转发请求
- [x] API Key 验证机制已启用
- [ ] 配置 HTTPS（推荐使用 nginx 反向代理）
- [ ] 设置防火墙规则，只开放 80 端口
- [ ] 配置 CORS_ORIGIN 为具体域名（当前为 *）

## 📁 相关文件

- 服务端配置: `server/.env`
- PM2 配置: `ecosystem.config.js`
- 认证中间件: `server/src/middleware/auth.ts`
- Vite 代理配置: `client/vite.config.ts`
- 密钥文件: `API_KEYS.md`
