# 四海股票模拟盘

一个同时提供虚拟市场和真实行情模拟交易的股票练习程序。所有交易均为模拟，不会连接券商或产生真实资金风险。

## 主要功能

- 内置沪深、港股、美股、英股各 300 只模拟股票，共 1200 只。
- 支持真实行情模拟盘，与虚拟盘使用独立资金、持仓和成交记录。
- 支持市价单、限价单、撤单和订单管理；可按手、数量或资金比例交易，并区分 T+0、T+1 规则。
- 提供自选股、持仓优先刷新、分时与 K 线图、盘口和账户详情。
- 内置规则 AI 交易者；模拟盘还可选接入 OpenAI 兼容的本地 LLM，运行 10 名不同风格的智能交易者。
- 提供 Web 页面和 Android 客户端。
- 注册邮箱先通过六位验证码验证；支持邮箱找回密码；旧账户登录或自动登录后会强制验证并补充邮箱，也支持服务器本机紧急重置。

## Windows 一键启动

需要 Node.js 22 或更高版本。

```bat
start.bat
```

`start.bat` 会准备本地数据库并统一启动后端和前端，不会启动或重启域名隧道。

部署机上的 Cloudflare 域名保活独立运行：

```bat
start-domain.bat
```

该脚本只负责安装或恢复隧道计划任务。已经运行的隧道会直接复用，不会因为应用更新而主动更换地址。

## 手动开发

```bash
npm install
npm run local:prepare
npm run dev
```

默认地址：

- Web：`http://localhost:5173`
- API：`http://localhost:3100`
- 健康检查：`http://localhost:3100/api/health`

本地首次初始化会使用沪深、港股、美股、英股各 300 只的种子数据。已有可用数据库时不会覆盖股票池。

## 持久配置与 SMTP

复制根目录的 `config.example.json` 为 `config.json`。`smtp` 支持 QQ 邮箱 `smtp.qq.com:465` SSL 与授权码，仅发送验证码、不接收邮件；`llmTrading` 可选接入 llama.cpp。各段未启用或配置无效时会分别安全停用。

配置路径统一按“显式启动参数 → `APP_CONFIG_PATH` → 工作目录 `config.json`”解析。Linux systemd 固定读取 `/var/lib/gupiaomoniqi/config.json`，Windows 启动器读取持久数据目录，应用更新不会覆盖。HTTP LLM 地址仅允许本机或可信局域网；公网模型接口请使用 HTTPS。具体部署和权限见 [运行性能与账户恢复](docs/运行性能与账户恢复.md)。

## 性能与账户恢复

服务端保留 4 GB V8 堆安全围栏，分钟 K 线采用有界内存缓存和按需历史查询；真实行情全市场默认 5 分钟刷新一轮，自选、持仓和详情热页仍按秒刷新。SMTP 配置、旧账户补邮箱和本机紧急改密命令见 [运行性能与账户恢复](docs/运行性能与账户恢复.md)。

## Android

Android 客户端位于 `android/`，生产服务地址固定为 `https://gupiaomoniqi.org`，普通用户无需填写或切换服务器。正式 APK 随 GitHub Release 提供，应用也可从设置页检查服务器更新。

构建环境：

- JDK 17
- Android SDK Platform 35

```powershell
.\android\gradlew.bat -p android :app:assembleRelease
```

## 验证

```bash
npm test
npm run build
```

## 说明

真实行情接口的可用性和刷新速度会受到网络环境及数据来源限制。程序会保留最后一次成功行情，不会因单次请求失败清空股票数据。

本项目仅用于学习、测试和模拟交易，不构成投资建议。
