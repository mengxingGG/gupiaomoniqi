# 四海股票模拟盘

四海股票模拟盘是一个面向体验和练习的股票模拟交易系统，分为虚拟盘和真实行情盘两条独立线路。真实行情会跟随市场动态变化，但不会连接真实券商，也不会让你承受真实亏损；你可以更放心地练习看盘、下单、持仓和复盘。

## 这个产品能做什么

- 真实行情盘跟随市场动态变化，覆盖沪深、港股、美股、英股；
- 虚拟盘提供更活跃的内部市场，适合练习交易节奏和仓位控制；
- 两个盘共用同一个账号，但资金、持仓、成交和奖励彼此隔离；
- 每个模拟盘首次进入都会获得一笔起始资金，不用担心一开始没法交易；
- 每天签到都可以领取奖励金；
- 礼包码 `666666` 和 `888888` 都可以领取奖励，但每个账户只能使用一次；
- 真实股票数据会由服务自动同步并持续写入真实行情数据库，无需手工更新表数据。

## 主要体验

- 真实盘可查看行情列表、详情、走势图、持仓和成交记录；
- 真实盘会优先刷新你正在查看、已持仓和已加入自选的股票；
- 模拟盘价格波动更活跃，适合练习追踪波动和交易反应；
- 支持按涨跌幅排序，方便快速查看强势和弱势股票；
- 支持每日签到、礼包码奖励和统一账户登录；
- 支持低配云服务器部署，默认已针对 `2 核 4G` 做负载收敛与自适应降载。

## 本地使用

要求：

- Node.js `22+`

Windows 一键启动：

```bat
start.bat
```

手动启动：

```bash
npm install
npm run data:init
npm run dev
```

`data:init` 和 `start.bat` 都会先检查本地数据库。虚拟盘数据库与种子文件同时缺失时，系统会自动从东方财富获取沪深、港股、美股、英股各 `300` 只，共 `1200` 只初始模拟股票；无论快照是自动抓取还是提前生成，导入数据库并复核成功后都会删除 JSON 快照。已有可用数据库时不会重复抓取。

也可以只生成种子快照：

```bash
npm run data:seed
```

访问地址：

- Web：`http://localhost:5173`
- 虚拟盘：`http://localhost:5173/`
- 真实行情盘：`http://localhost:5173/real`
- 健康检查：`http://localhost:3100/api/health`
- 真实行情状态：`http://localhost:3100/api/real-market/status`

## 云服务器部署

推荐环境：

- Ubuntu `22.04+`
- `2 核 4G` 或更高
- 已开放 `80`、`443` 端口

### 首次装机

先在服务器执行基础环境初始化：

```bash
sudo bash /tmp/gupiaomoniqi-deploy/bootstrap.sh
```

再上传 `deploy/` 目录中的部署文件到服务器 `/tmp/gupiaomoniqi-deploy/`，然后执行：

```bash
sudo bash /tmp/gupiaomoniqi-deploy/configure-host.sh <公网 IP 或域名>
```

这一步会完成：

- Node.js 与 Nginx 安装
- `gupiaomoniqi` 系统用户创建
- `systemd` 服务注册
- 反向代理与 HTTPS 自签证书配置

### 代码更新部署

如果数据库已经提前部署好，只需要更新代码，使用下面这条流程即可。这个流程不会替换：

- `/var/lib/gupiaomoniqi/pgdata`
- `/var/lib/gupiaomoniqi/real-pgdata`

本地先完成构建与校验：

```bash
npm install
npm run typecheck
npm test
npm run build
```

然后打包代码归档。打包时保留 `package.json`、`package-lock.json`、`server/`、`shared/`、`web/`、`deploy/` 等代码文件，排除 `node_modules`、`.git` 和 `server/data`。

上传 `code.tar.gz` 到服务器 `/tmp/gupiaomoniqi-deploy/` 后执行：

```bash
sudo bash /tmp/gupiaomoniqi-deploy/install-code-release.sh \
  /tmp/gupiaomoniqi-deploy/code.tar.gz
```

执行完成后会：

- 解压新版本到 `/opt/gupiaomoniqi/releases/<release-id>`
- 更新 `/opt/gupiaomoniqi/current` 软链接
- 重启 `gupiaomoniqi` 服务
- 保留现有虚拟盘和真实行情数据库目录

### 首次全量部署

如果你需要第一次连数据库一起部署，仍可使用原有全量脚本：

```bash
sudo bash /tmp/gupiaomoniqi-deploy/install-release.sh \
  /path/to/data.tar.gz \
  /tmp/gupiaomoniqi-deploy/code.tar.gz
```

这个脚本适合首发或整库迁移，不适合你当前这种“数据库已就位，只更新代码”的场景。

## 部署后检查

服务状态：

```bash
systemctl status gupiaomoniqi --no-pager
systemctl status nginx --no-pager
```

快速验证：

```bash
curl http://127.0.0.1:3100/api/health
curl http://127.0.0.1:3100/api/real-market/status
sudo bash /tmp/gupiaomoniqi-deploy/verify-host.sh <公网 IP 或域名>
node /tmp/gupiaomoniqi-deploy/verify-public.mjs https://<公网 IP 或域名>
```

## 常用说明

- 真实行情同步默认开启，服务启动后会自动刷新真实股票并更新真实行情数据库；
- 如果外部行情接口短时波动，系统会保留最后一次成功数据，不会直接清空真实盘；
- 每天签到可领取奖励；
- 礼包码 `666666`、`888888` 每个账户只能使用一次；
- 真实盘和虚拟盘都只用于模拟体验，不会产生真实券商交易。

## 常用环境变量

```text
PORT=3100
HOST=127.0.0.1
DATABASE_DIR=/var/lib/gupiaomoniqi/pgdata
REAL_DATABASE_DIR=/var/lib/gupiaomoniqi/real-pgdata
REAL_MARKET_SYNC_ENABLED=true
REAL_MARKET_PAGE_SIZE=100
REAL_MARKET_CONCURRENCY=12
REAL_MARKET_FULL_SWEEP_MS=10000
REAL_MARKET_HOT_REFRESH_MS=1000
REAL_MARKET_HOT_PAGES_PER_ROUND=8
REAL_MARKET_REQUEST_TIMEOUT_MS=8000
REAL_MARKET_QUOTE_MAX_AGE_MS=120000
AI_TRADER_COUNT=1800
AI_ACTIVE_PER_ROUND=96
AI_ROUND_INTERVAL_MS=1500
```

## 目的

这个项目的目标不是“预测市场”，而是提供一个更安心的模拟交易环境：

- 让你在真实行情节奏下练习交易，而不是拿真实资金冒险；
- 让你在低成本服务器上也能长期稳定运行自己的模拟盘；
- 让部署、上线、更新和日常使用都尽量简单直接。
