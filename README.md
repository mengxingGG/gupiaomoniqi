# 四海股票模拟盘

一个同时提供虚拟市场和真实行情模拟交易的股票练习程序。所有交易均为模拟，不会连接券商或产生真实资金风险。

## 主要功能

- 内置沪深、港股、美股、英股各 300 只模拟股票，共 1200 只。
- 支持真实行情模拟盘，与虚拟盘使用独立资金、持仓和成交记录。
- 支持市价单、限价单、撤单和订单管理；可按手、数量或资金比例交易，并区分 T+0、T+1 规则。
- 提供自选股、持仓优先刷新、分时与 K 线图、盘口和账户详情。
- 内置规则 AI 交易者；模拟盘还可选接入 OpenAI 兼容的本地 LLM，运行 10 名不同风格的智能交易者。
- 提供 Web 页面和 Android 客户端。

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

## 可选 LLM 智能交易者

复制根目录的 `config.example.json` 为 `config.json`，填写 llama.cpp 的接口地址和模型 ID，再将 `enabled` 改为 `true`。未配置、模型离线或通信失败时，该功能会自动停用，不影响普通行情和交易。

HTTP 地址仅允许本机或可信局域网；公网模型接口请使用 HTTPS。部署版从持久数据目录读取 `config.json`，应用更新不会覆盖它。

## Android

Android 客户端位于 `android/`，可在应用设置中填写服务器地址。正式 APK 随 GitHub Release 提供，应用也可从设置页检查服务器更新。
公网服务器请使用 HTTPS 地址；HTTP 仅用于可信局域网环境。

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
