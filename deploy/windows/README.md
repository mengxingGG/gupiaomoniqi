# Windows 局域网生产部署

本目录用于把股票模拟器部署到 Windows 机器，并通过 Cloudflare Quick
Tunnel 暂时提供 HTTPS 访问。应用和隧道是两个彼此独立的 `SYSTEM` 计划
任务，都会开机启动，无需用户登录。应用的启动、停止和版本更新不会停止、
重启或重新安装隧道任务。

> Quick Tunnel 的 `*.trycloudflare.com` 地址是临时地址。脚本会尽量复用
> 同一个仍在运行的 `cloudflared` 进程，因此应用重启不会改变当前地址；
> 但 `cloudflared` 进程一旦实际退出并重建，地址仍可能变化，绝不保证跨
> 进程重启稳定。不适合接受地址变化的场景应改用 Cloudflare Named Tunnel。

## 目录约定

默认部署根目录为 `C:\ProgramData\gupiaomoniqi`：

```text
C:\ProgramData\gupiaomoniqi\
  current\                 已构建的完整项目
    server\dist\index.js
    web\dist\
    node_modules\
    deploy\windows\
  data\
    market-seeds.json
    pgdata\
    real-pgdata\
  logs\
    app\
    cloudflared\
  runtime\
    app-latest.json
    cloudflared-latest.json
    cloudflare-quick-url.txt
    cloudflared-supervisor.lock
  tools\
    cloudflared.exe
    node\node.exe           可选；也可使用系统安装的 Node.js
```

应用是单个 Node.js 进程，固定监听 `127.0.0.1:3100`，并设置
`SERVE_WEB=true` 同时提供 Web、API 和 WebSocket。数据库目录不会放在
`current` 中，因此更新代码时不会覆盖数据库。

## 前置条件

- Windows PowerShell 5.1，以管理员身份运行。
- Node.js 22 或更高版本。
- Python 3 为可选依赖，仅用于真实行情 HTTP 请求失败后的备用通道。
- `current` 已包含 `npm run build` 的产物以及运行依赖。
- Windows 的默认出站策略允许连接互联网。Cloudflare Tunnel 只需要出站
  连接，不需要开放路由器或 Windows 的 80、443 入站端口。
- 部署根目录、`current\deploy\windows`、`tools` 及 `cloudflared.exe`
  必须位于本机固定磁盘，路径链中不能有符号链接或目录联接。交给 `SYSTEM`
  执行的目录和文件只允许 `SYSTEM`、Administrators、当前安装管理员或
  TrustedInstaller 写入。隧道任务安装器会把部署根目录内、明确列出的执行
  路径收紧为 SYSTEM/Administrators 完全控制、Users 只读执行，再复核所有者
  和 DACL；部署根目录外的 `cloudflared` 路径只校验、不擅自修改，发现普通
  用户可写、网络或可移动路径时会拒绝安装。

先安装或更新官方 `cloudflared`：

```powershell
Set-Location "C:\ProgramData\gupiaomoniqi\current"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  ".\deploy\windows\Install-Cloudflared.ps1"
```

脚本从 Cloudflare 的 GitHub 官方发布地址下载，打印实际 SHA-256。正式、
可重复的部署建议从发布页取得校验值，并传入：

```powershell
.\deploy\windows\Install-Cloudflared.ps1 `
  -ExpectedSha256 "<官方发布页 SHA-256>"
```

## 安装或更新开机任务

应用进程显式保留 4096 MB V8 堆安全围栏。K 线有界缓存、SMTP 机器级环境变量和服务器本机紧急改密说明见 [`docs/运行性能与账户恢复.md`](../../docs/运行性能与账户恢复.md)。

首次部署可按以下顺序执行；隧道并不依赖应用已经健康，也可以先安装：

```powershell
Set-Location "C:\ProgramData\gupiaomoniqi\current"

.\deploy\windows\Install-AppTask.ps1
.\deploy\windows\Install-TunnelTask.ps1

.\deploy\windows\Get-DeploymentStatus.ps1 -WaitSeconds 120
```

`Install-AppTask.ps1` 会自动检查当前管理员账户的用户级 Python 安装。也可
显式传入完整路径；例如目标机当前安装位置：

```powershell
.\deploy\windows\Install-AppTask.ps1 `
  -PythonPath "C:\Users\11611\AppData\Local\Programs\Python\Python314\python.exe"
```

安装脚本和运行脚本都会实际启动一次 Python 进行 Python 3 验证。验证成功
后，Python 所在目录只会前置到 Node 应用子进程的 `Path`，不会修改机器或
用户的永久环境变量。未找到 Python 不会阻止应用部署，但启动日志、
`runtime\app-latest.json` 和状态检查中的 `pythonFallback` 会明确显示回退
不可用。

因为应用计划任务以 `SYSTEM` 运行，显式指定的 Python 安装目录应只允许
受信任的管理员修改，避免把不可信的可执行文件交给高权限任务运行。

任务名称分别是：

- `Gupiaomoniqi-App`
- `Gupiaomoniqi-Cloudflare-Quick-Tunnel`

两个安装脚本的生命周期不同：

- `Install-TunnelTask.ps1` 在任务定义和参数完全相同时只复用现有任务。
  如果任务正在运行，它不会重新注册任务、停止 `cloudflared` 或清空当前
  URL。它会核对 Enabled、SYSTEM principal、开机触发、单实例、失败重启、
  电池和无限执行时限；只有首次安装、隧道参数/任务版本变化或这些设置漂移
  时才会替换任务定义。
- 日常应用发布只运行 `Update-App.ps1`，或在受控停机后维护应用任务；不要
  把重新安装隧道任务放进应用启动、停止或更新流程。
- 隧道任务使用开机触发、`MultipleInstances=IgnoreNew`、一分钟失败重启和
  无限执行时限。运行器另有部署目录内的独占文件锁，重复启动不会再创建
  一个 Quick Tunnel。

隧道启动不等待 `127.0.0.1:3100`。应用尚未启动、正在更新或暂时故障时，
`cloudflared` 仍保持出站连接和当前进程内的临时地址；这段时间通过公网
访问应用可能返回 502，应用恢复后同一隧道继续转发。

若显式修改 `OriginUrl` 或 `CloudflaredPath`，安装器会验证旧 PID、可执行
文件路径和启动时间。旧进程与新配置兼容时由新监督器接管；不兼容时先停止
经验证的旧进程，确认退出后才启动新配置，避免留下第二条无人监管的隧道。

当前临时 HTTPS 地址保存在：

```text
C:\ProgramData\gupiaomoniqi\runtime\cloudflare-quick-url.txt
```

## 后续在线更新应用

先在开发电脑生成完整发布包。数据库迁移必须确认只包含向后兼容的
expand-contract 变更：

```powershell
.\deploy\windows\New-AppRelease.ps1 `
  -DestinationDirectory "C:\releases\gupiaomoniqi-20260730" `
  -ConfirmBackwardCompatibleMigrations
```

把发布包传到目标机部署根目录的外部，例如
`C:\ProgramData\gupiaomoniqi-release-20260730`。发布包不能放进
`C:\ProgramData\gupiaomoniqi`，更不能放进 `data`。

在目标机管理员 PowerShell 中执行：

```powershell
& "C:\ProgramData\gupiaomoniqi\current\deploy\windows\Update-App.ps1" `
  -SourceDirectory "C:\ProgramData\gupiaomoniqi-release-20260730"
```

更新器会校验完整文件清单，先取得单实例切换栅栏，再要求旧进程返回
PID、nonce、退出码和数据库关闭确认。确认失败就取消更新；候选启动或健康
检查失败则自动恢复旧程序。`data` 和隧道任务都不参与代码切换。

正常更新不要传 `-AllowForcedStop`。旧版若没有关闭确认能力，应先安排停机，
保留 `data` 并完成一次冷切换；新版接管后，后续更新统一使用上述流程。

## 防火墙收敛

Cloudflare Tunnel 不需要 80、443 入站。部署完成并确认 SSH 密钥可登录后，
从部署电脑上查出自己的局域网 IP，然后在目标机管理员 PowerShell 执行：

```powershell
.\deploy\windows\Set-DeploymentFirewall.ps1 `
  -DeploymentIp "192.168.50.121"
```

先预览可以使用：

```powershell
.\deploy\windows\Set-DeploymentFirewall.ps1 `
  -DeploymentIp "192.168.50.121" `
  -WhatIf
```

安全边界：

- 只禁用精确命名为
  `Gupiaomoniqi-HTTP-In-TCP-80` 和
  `Gupiaomoniqi-HTTPS-In-TCP-443` 的项目入站规则。
- 不删除任何防火墙规则。
- 其他名称的 80、443 入站规则只会在结果中报告，不会擅自修改。
- 所有已启用的 TCP 22 入站放行规则都会被收窄到指定部署 IP；如发现无法
  本地修改的组策略规则，脚本会停止并明确报错。

请不要在没有确认部署电脑静态 IP 或 DHCP 保留地址前收窄 SSH，否则部署
电脑换 IP 后会失去连接。紧急恢复需在目标机本地控制台修改防火墙。

如果 Windows 使用默认“允许出站”策略，不需要新增出站规则；这不会将
80、443 服务直接暴露到局域网或公网。若企业策略默认阻止出站，应仅针对
`cloudflared.exe` 放行所需连接，并由网络管理员审查，不要建立宽泛的全局
出站放行规则。

## 状态与日志

状态脚本分别检查：

- 应用与隧道计划任务；
- `cloudflared-latest.json` 报告的监督器、进程和当前 URL 状态；
- 本地 `/api/health`；
- 本地 Web 首页；
- 当前 Quick Tunnel 的公网健康接口和首页。

JSON 结果中的 `tunnelAlive` 只在任务绑定正确，并且 PID、可执行文件路径和
启动时间都与状态文件一致时才表示 `cloudflared` 仍在运行；
`applicationReady` 表示本地应用可用；`cloudflare.publicOriginReady` 表示
当前公网地址能够成功访问应用。后端不可用时后两项及整体 `ready` 可以为
`false`，但 `tunnelAlive` 仍应为 `true`。

只检查本机、不请求公网：

```powershell
.\deploy\windows\Get-DeploymentStatus.ps1 -SkipPublic
```

每次新建 `cloudflared` 进程都会创建新的 stdout、stderr 和 launcher 日志，
并仅保留最近 14 次同类日志。若监督器异常退出但它启动的 `cloudflared`
仍在运行，下一实例会校验 PID、可执行文件路径和启动时间并接管原进程，
不会创建新隧道。最新进程、当前/上一个 URL、可读取时的退出码和日志路径
记录在 `runtime\cloudflared-latest.json`；Windows 无法提供退出码时，
`exitCodeAvailable` 为 `false`。健康检查失败时，状态脚本退出码为 `1`，
便于自动化判断。

## 常用维护命令

```powershell
Stop-ScheduledTask -TaskName "Gupiaomoniqi-App"
Start-ScheduledTask -TaskName "Gupiaomoniqi-App"

Get-Content `
  "C:\ProgramData\gupiaomoniqi\runtime\cloudflare-quick-url.txt"

Get-ScheduledTask -TaskName "Gupiaomoniqi-*"
```

Windows PowerShell 5.1 的 ScheduledTasks 模块没有
`Restart-ScheduledTask`。也不要把简单的 `Stop-ScheduledTask` /
`Start-ScheduledTask` 当成“更换临时域名”的命令：若原 `cloudflared` 仍在
运行，监督器会接管并继续复用它。只有在明确安排隧道维护时才应实际终止
`cloudflared`；进程重建后 Quick Tunnel 地址可能变化。

更新应用代码不需要也不应停止隧道；请使用 `Update-App.ps1`，它只管理应用
任务。不要删除 `data` 目录；它包含虚拟盘和真实行情模拟盘的独立数据库。
