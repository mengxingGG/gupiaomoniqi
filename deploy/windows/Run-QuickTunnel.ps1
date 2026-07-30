[CmdletBinding()]
param(
    [string]$Root = "C:\ProgramData\gupiaomoniqi",
    [string]$CloudflaredPath,
    [uri]$OriginUrl = "http://127.0.0.1:3100",
    [ValidateRange(2, 100)]
    [int]$LogRetentionCount = 14,
    [ValidateRange(1, 60)]
    [int]$StatusPollSeconds = 2
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "_Common.ps1")

function Get-StatePropertyValue {
    param(
        [object]$State,

        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    if ($null -eq $State) {
        return $null
    }

    $property = $State.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $null
    }
    return $property.Value
}

function Read-TunnelState {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $null
    }

    try {
        return Get-Content `
            -LiteralPath $Path `
            -Raw `
            -Encoding UTF8 | ConvertFrom-Json
    }
    catch {
        return $null
    }
}

function Get-QuickTunnelUrl {
    param(
        [string[]]$LogPaths
    )

    $candidateUrl = $null
    foreach ($logPath in @($LogPaths)) {
        if (
            [string]::IsNullOrWhiteSpace($logPath) -or
            -not (Test-Path -LiteralPath $logPath -PathType Leaf)
        ) {
            continue
        }

        $content = Get-Content `
            -LiteralPath $logPath `
            -Raw `
            -Encoding UTF8 `
            -ErrorAction SilentlyContinue
        if ($null -eq $content) {
            continue
        }

        $matches = [regex]::Matches(
            [string]$content,
            "https://[a-zA-Z0-9-]+\.trycloudflare\.com"
        )
        if ($matches.Count -gt 0) {
            $candidateUrl = $matches[$matches.Count - 1].Value
        }
    }

    return $candidateUrl
}

function Get-UrlFileValue {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $null
    }

    $content = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    if ($null -eq $content) {
        return $null
    }
    $candidateUrl = ([string]$content).Trim()
    if ($candidateUrl -match (
        "^https://[a-zA-Z0-9-]+\.trycloudflare\.com/?$"
    )) {
        return $candidateUrl.TrimEnd("/")
    }
    return $null
}

function Test-SamePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Left,

        [Parameter(Mandatory = $true)]
        [string]$Right
    )

    return [string]::Equals(
        [System.IO.Path]::GetFullPath($Left).TrimEnd("\"),
        [System.IO.Path]::GetFullPath($Right).TrimEnd("\"),
        [StringComparison]::OrdinalIgnoreCase
    )
}

function Get-SafeStateLogPath {
    param(
        [Parameter(Mandatory = $true)]
        [object]$State,

        [Parameter(Mandatory = $true)]
        [string]$PropertyName,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedLogDirectory
    )

    $candidate = [string](
        Get-StatePropertyValue -State $State -Name $PropertyName
    )
    if ([string]::IsNullOrWhiteSpace($candidate)) {
        throw "已有 cloudflared 状态缺少日志路径：$PropertyName"
    }

    $fullCandidate = [System.IO.Path]::GetFullPath($candidate)
    $fullLogDirectory = (
        [System.IO.Path]::GetFullPath($ExpectedLogDirectory).TrimEnd("\") +
        "\"
    )
    if (-not $fullCandidate.StartsWith(
        $fullLogDirectory,
        [StringComparison]::OrdinalIgnoreCase
    )) {
        throw "拒绝使用部署日志目录以外的状态路径：$fullCandidate"
    }
    if (-not (Test-Path -LiteralPath $fullCandidate -PathType Leaf)) {
        throw "已有 cloudflared 状态引用的日志不存在：$fullCandidate"
    }
    Assert-NoReparsePointInPathOrAncestors `
        -Path $fullCandidate `
        -Description "cloudflared 日志"

    return $fullCandidate
}

function Get-AdoptableCloudflaredProcess {
    param(
        [object]$State,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedExecutable,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedOriginUrl
    )

    $processIdValue = Get-StatePropertyValue `
        -State $State `
        -Name "processId"
    if ($null -eq $processIdValue) {
        return $null
    }

    $stateOriginUrl = [string](
        Get-StatePropertyValue -State $State -Name "originUrl"
    )
    if (-not [string]::Equals(
        $stateOriginUrl,
        $ExpectedOriginUrl,
        [StringComparison]::Ordinal
    )) {
        return $null
    }

    $stateExecutable = [string](
        Get-StatePropertyValue -State $State -Name "executablePath"
    )
    if (
        -not [string]::IsNullOrWhiteSpace($stateExecutable) -and
        -not (Test-SamePath `
            -Left $stateExecutable `
            -Right $ExpectedExecutable)
    ) {
        return $null
    }

    try {
        $existingProcess = [System.Diagnostics.Process]::GetProcessById(
            [int]$processIdValue
        )
    }
    catch [System.ArgumentException] {
        return $null
    }

    try {
        $existingProcess.Refresh()
        if ($existingProcess.HasExited) {
            $existingProcess.Dispose()
            return $null
        }
        if (-not (Test-SamePath `
            -Left $existingProcess.MainModule.FileName `
            -Right $ExpectedExecutable)
        ) {
            $existingProcess.Dispose()
            return $null
        }

        $recordedStartValue = Get-StatePropertyValue `
            -State $State `
            -Name "processStartedAt"
        if ($null -eq $recordedStartValue) {
            # 兼容旧状态格式；旧 startedAt 在启动进程前瞬间写入。
            $recordedStartValue = Get-StatePropertyValue `
                -State $State `
                -Name "startedAt"
        }
        if ($null -eq $recordedStartValue) {
            $existingProcess.Dispose()
            return $null
        }

        $recordedStart = [DateTime]::Parse(
            [string]$recordedStartValue
        ).ToUniversalTime()
        $actualStart = $existingProcess.StartTime.ToUniversalTime()
        if ([Math]::Abs(
            ($recordedStart - $actualStart).TotalSeconds
        ) -gt 10) {
            $existingProcess.Dispose()
            return $null
        }

        return $existingProcess
    }
    catch {
        $existingProcess.Dispose()
        throw (
            "无法验证状态文件中的 cloudflared 进程身份；为避免重复隧道，" +
            "拒绝再启动一个进程。{0}" -f $_.Exception.Message
        )
    }
}

if (
    -not $OriginUrl.IsAbsoluteUri -or
    @("http", "https") -notcontains $OriginUrl.Scheme.ToLowerInvariant()
) {
    throw "OriginUrl 必须是绝对 HTTP 或 HTTPS 地址：$OriginUrl"
}

$safeRoot = Assert-SafeDeploymentRoot -Root $Root
if (
    [System.IO.Path]::GetFullPath($safeRoot).StartsWith(
        "\\",
        [StringComparison]::Ordinal
    )
) {
    throw "部署根目录不允许使用 UNC/网络路径。"
}
$cloudflaredExecutable = Resolve-CloudflaredExecutable `
    -Root $safeRoot `
    -CloudflaredPath $CloudflaredPath
Assert-NoReparsePointInPathOrAncestors `
    -Path $cloudflaredExecutable `
    -Description "cloudflared 可执行文件"
if (
    [System.IO.Path]::GetExtension($cloudflaredExecutable) -ne ".exe" -or
    [System.IO.Path]::GetFullPath($cloudflaredExecutable).StartsWith(
        "\\",
        [StringComparison]::Ordinal
    )
) {
    throw "cloudflared 必须是本机固定磁盘上的 .exe：$cloudflaredExecutable"
}
$runtimeDirectory = Join-Path $safeRoot "runtime"
$logDirectory = Join-Path $safeRoot "logs\cloudflared"
Ensure-Directory -Path $runtimeDirectory
Ensure-Directory -Path $logDirectory

$urlPath = Join-Path $runtimeDirectory "cloudflare-quick-url.txt"
$latestPath = Join-Path $runtimeDirectory "cloudflared-latest.json"
$lockPath = Join-Path $runtimeDirectory "cloudflared-supervisor.lock"
$originAbsoluteUrl = $OriginUrl.AbsoluteUri
$supervisorStartedAt = (Get-Date).ToUniversalTime().ToString("o")
$lockStream = $null
$process = $null

try {
    try {
        $lockStream = [System.IO.File]::Open(
            $lockPath,
            [System.IO.FileMode]::OpenOrCreate,
            [System.IO.FileAccess]::ReadWrite,
            [System.IO.FileShare]::None
        )
    }
    catch [System.IO.IOException] {
        $runningState = Read-TunnelState -Path $latestPath
        $runningStatus = [string](
            Get-StatePropertyValue -State $runningState -Name "status"
        )
        $runningUrl = Get-UrlFileValue -Path $urlPath
        Write-Host (
            "已有隧道监督器持有单实例锁；复用现有进程。" +
            "状态={0}；URL={1}" -f
                $runningStatus,
                $(if ($null -eq $runningUrl) {
                    "尚未生成"
                }
                else {
                    $runningUrl
                })
        )
        return
    }

    $lockMetadata = (
        "supervisorProcessId={0}`nsupervisorStartedAt={1}`nroot={2}`n" -f
            $PID,
            $supervisorStartedAt,
            $safeRoot
    )
    $lockBytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes(
        $lockMetadata
    )
    $lockStream.SetLength(0)
    $lockStream.Write($lockBytes, 0, $lockBytes.Length)
    $lockStream.Flush()

    $existingState = Read-TunnelState -Path $latestPath
    $process = Get-AdoptableCloudflaredProcess `
        -State $existingState `
        -ExpectedExecutable $cloudflaredExecutable `
        -ExpectedOriginUrl $originAbsoluteUrl

    $adoptedExistingProcess = $null -ne $process
    $quickTunnelUrl = $null
    if ($adoptedExistingProcess) {
        $logs = [pscustomobject]@{
            Stdout = Get-SafeStateLogPath `
                -State $existingState `
                -PropertyName "stdout" `
                -ExpectedLogDirectory $logDirectory
            Stderr = Get-SafeStateLogPath `
                -State $existingState `
                -PropertyName "stderr" `
                -ExpectedLogDirectory $logDirectory
            Launcher = Get-SafeStateLogPath `
                -State $existingState `
                -PropertyName "launcher" `
                -ExpectedLogDirectory $logDirectory
        }
        $startedAt = [string](
            Get-StatePropertyValue -State $existingState -Name "startedAt"
        )
        if ([string]::IsNullOrWhiteSpace($startedAt)) {
            $startedAt = $process.StartTime.ToUniversalTime().ToString("o")
        }
        $processStartedAt = $process.StartTime.ToUniversalTime().ToString("o")
        $quickTunnelUrl = Get-UrlFileValue -Path $urlPath
        if ($null -eq $quickTunnelUrl) {
            $stateUrl = [string](
                Get-StatePropertyValue `
                    -State $existingState `
                    -Name "quickTunnelUrl"
            )
            if ($stateUrl -match (
                "^https://[a-zA-Z0-9-]+\.trycloudflare\.com/?$"
            )) {
                $quickTunnelUrl = $stateUrl.TrimEnd("/")
            }
        }
        if ($null -eq $quickTunnelUrl) {
            $quickTunnelUrl = Get-QuickTunnelUrl `
                -LogPaths @($logs.Stdout, $logs.Stderr)
        }
        if ($null -ne $quickTunnelUrl) {
            Write-AtomicText -Path $urlPath -Value $quickTunnelUrl
        }
        Write-LauncherLog -Path $logs.Launcher -Message (
            "监督器已接管仍在运行的 cloudflared；PID={0}；不重建隧道。" -f
                $process.Id
        )
    }
    else {
        $logs = New-TraceLogSet `
            -Root $safeRoot `
            -Name "cloudflared" `
            -RetentionCount $LogRetentionCount
        $startedAt = (Get-Date).ToUniversalTime().ToString("o")
        $processStartedAt = $null

        # 新 cloudflared 进程尚未拿到 URL；清空上一进程的临时地址。
        Write-AtomicText -Path $urlPath -Value ""
        Write-AtomicJson -Path $latestPath -Value ([ordered]@{
            schemaVersion = 2
            updatedAt = (Get-Date).ToUniversalTime().ToString("o")
            startedAt = $startedAt
            supervisorStartedAt = $supervisorStartedAt
            status = "starting"
            supervisorProcessId = $PID
            processId = $null
            processStartedAt = $null
            executablePath = $cloudflaredExecutable
            originUrl = $originAbsoluteUrl
            quickTunnelUrl = $null
            lastQuickTunnelUrl = $null
            adoptedExistingProcess = $false
            stdout = $logs.Stdout
            stderr = $logs.Stderr
            launcher = $logs.Launcher
        })
        Write-LauncherLog -Path $logs.Launcher -Message (
            "启动独立 Cloudflare Quick Tunnel；Origin={0}；Executable={1}" -f
                $originAbsoluteUrl,
                $cloudflaredExecutable
        )

        $arguments = @(
            "tunnel",
            "--no-autoupdate",
            "--protocol", "http2",
            "--url", $originAbsoluteUrl
        )
        Normalize-ProcessPathEnvironment
        try {
            $process = Start-Process `
                -FilePath $cloudflaredExecutable `
                -ArgumentList $arguments `
                -WindowStyle Hidden `
                -RedirectStandardOutput $logs.Stdout `
                -RedirectStandardError $logs.Stderr `
                -PassThru
            $process.Refresh()
            $processStartedAt = (
                $process.StartTime.ToUniversalTime().ToString("o")
            )
            # PID 获取后立即落盘；后续日志写入失败也能被下一监督器识别/接管。
            Write-AtomicJson -Path $latestPath -Value ([ordered]@{
                schemaVersion = 2
                updatedAt = (Get-Date).ToUniversalTime().ToString("o")
                startedAt = $startedAt
                stoppedAt = $null
                supervisorStartedAt = $supervisorStartedAt
                status = "connecting"
                supervisorProcessId = $PID
                processId = $process.Id
                processStartedAt = $processStartedAt
                executablePath = $cloudflaredExecutable
                originUrl = $originAbsoluteUrl
                quickTunnelUrl = $null
                lastQuickTunnelUrl = $null
                adoptedExistingProcess = $false
                exitCode = $null
                exitCodeAvailable = $false
                error = $null
                stdout = $logs.Stdout
                stderr = $logs.Stderr
                launcher = $logs.Launcher
            })
        }
        catch {
            $startFailure = $_
            if ($null -ne $process) {
                try {
                    $process.Refresh()
                    if (-not $process.HasExited) {
                        $process.Kill()
                        $null = $process.WaitForExit(5000)
                    }
                }
                catch {
                    # 下面仍以原始启动/状态写入错误失败，任务会再次尝试。
                }
            }
            try {
                Write-AtomicJson -Path $latestPath -Value ([ordered]@{
                    schemaVersion = 2
                    updatedAt = (Get-Date).ToUniversalTime().ToString("o")
                    startedAt = $startedAt
                    stoppedAt = (Get-Date).ToUniversalTime().ToString("o")
                    supervisorStartedAt = $supervisorStartedAt
                    status = "stopped"
                    supervisorProcessId = $PID
                    processId = if ($null -eq $process) {
                        $null
                    }
                    else {
                        $process.Id
                    }
                    processStartedAt = $processStartedAt
                    exitCode = $null
                    executablePath = $cloudflaredExecutable
                    originUrl = $originAbsoluteUrl
                    quickTunnelUrl = $null
                    lastQuickTunnelUrl = $null
                    adoptedExistingProcess = $false
                    exitCodeAvailable = $false
                    error = $startFailure.Exception.Message
                    stdout = $logs.Stdout
                    stderr = $logs.Stderr
                    launcher = $logs.Launcher
                })
            }
            catch {
                # 原始错误优先；状态目录本身不可写时无法再可靠落盘。
            }
            try {
                Write-LauncherLog -Path $logs.Launcher -Message (
                    "cloudflared 启动失败：{0}" -f
                        $startFailure.Exception.Message
                )
            }
            catch {
                # 启动日志不可写时仍抛出原始错误。
            }
            throw $startFailure
        }

        Write-LauncherLog -Path $logs.Launcher -Message (
            "cloudflared 进程已启动；PID={0}；不等待本地后端健康。" -f
                $process.Id
        )
    }

    $runtimeState = [ordered]@{
        schemaVersion = 2
        updatedAt = (Get-Date).ToUniversalTime().ToString("o")
        startedAt = $startedAt
        stoppedAt = $null
        supervisorStartedAt = $supervisorStartedAt
        status = if ($null -eq $quickTunnelUrl) {
            "connecting"
        }
        else {
            "running"
        }
        supervisorProcessId = $PID
        processId = $process.Id
        processStartedAt = $processStartedAt
        executablePath = $cloudflaredExecutable
        originUrl = $originAbsoluteUrl
        quickTunnelUrl = $quickTunnelUrl
        lastQuickTunnelUrl = $quickTunnelUrl
        adoptedExistingProcess = $adoptedExistingProcess
        exitCode = $null
        exitCodeAvailable = $false
        error = $null
        stdout = $logs.Stdout
        stderr = $logs.Stderr
        launcher = $logs.Launcher
    }
    Write-AtomicJson -Path $latestPath -Value $runtimeState

    if ($null -ne $quickTunnelUrl) {
        Write-LauncherLog -Path $logs.Launcher -Message (
            "继续使用当前 Quick Tunnel 地址：$quickTunnelUrl"
        )
    }

    while (-not $process.HasExited) {
        if ($null -eq $quickTunnelUrl) {
            $discoveredUrl = Get-QuickTunnelUrl `
                -LogPaths @($logs.Stdout, $logs.Stderr)
            if ($null -ne $discoveredUrl) {
                $quickTunnelUrl = $discoveredUrl
                Write-AtomicText -Path $urlPath -Value $quickTunnelUrl
                $runtimeState.updatedAt = (
                    Get-Date
                ).ToUniversalTime().ToString("o")
                $runtimeState.status = "running"
                $runtimeState.quickTunnelUrl = $quickTunnelUrl
                $runtimeState.lastQuickTunnelUrl = $quickTunnelUrl
                Write-AtomicJson -Path $latestPath -Value $runtimeState
                Write-LauncherLog -Path $logs.Launcher -Message (
                    "Quick Tunnel 已就绪：$quickTunnelUrl"
                )
            }
        }

        Start-Sleep -Seconds $StatusPollSeconds
        $process.Refresh()
    }

    $process.WaitForExit()
    $process.Refresh()
    if ($null -eq $quickTunnelUrl) {
        # 进程可能刚输出 URL 就退出；保留审计值，但不再标记为当前 URL。
        $quickTunnelUrl = Get-QuickTunnelUrl `
            -LogPaths @($logs.Stdout, $logs.Stderr)
    }
    $exitCode = $null
    try {
        $exitCode = $process.ExitCode
    }
    catch {
        # 被接管进程的退出码偶尔不可读取；状态仍明确记录进程已停止。
    }
    $stoppedAt = (Get-Date).ToUniversalTime().ToString("o")

    # Quick Tunnel 地址只承诺在同一 cloudflared 进程生命周期内复用。
    Write-AtomicText -Path $urlPath -Value ""
    $runtimeState.updatedAt = $stoppedAt
    $runtimeState.stoppedAt = $stoppedAt
    $runtimeState.status = "stopped"
    $runtimeState.exitCode = $exitCode
    $runtimeState.exitCodeAvailable = $null -ne $exitCode
    $runtimeState.quickTunnelUrl = $null
    $runtimeState.lastQuickTunnelUrl = $quickTunnelUrl
    Write-AtomicJson -Path $latestPath -Value $runtimeState
    Write-LauncherLog -Path $logs.Launcher -Message (
        "cloudflared 进程退出；PID={0}；ExitCode={1}；计划任务将自动重启。" -f
            $process.Id,
            $exitCode
    )

    throw ((
        "cloudflared 服务进程已经退出，计划任务将负责重启。退出码：{0}；" +
        "错误日志：{1}"
    ) -f $exitCode, $logs.Stderr)
}
finally {
    if ($null -ne $process) {
        $process.Dispose()
    }
    if ($null -ne $lockStream) {
        $lockStream.Dispose()
    }
}
