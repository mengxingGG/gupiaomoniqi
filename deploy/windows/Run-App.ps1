[CmdletBinding()]
param(
    [string]$Root = "C:\ProgramData\gupiaomoniqi",
    [string]$NodePath,
    [string]$PythonPath,
    [ValidateRange(1, 65535)]
    [int]$Port = 3100,
    [switch]$DisableRealMarketSync,
    [switch]$DisableAiTrading,
    [ValidateRange(2, 100)]
    [int]$LogRetentionCount = 14
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "_Common.ps1")

function Get-StableRootIdentity {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes(
            $Path.ToLowerInvariant()
        )
        return -join (
            $sha256.ComputeHash($bytes) |
                ForEach-Object { $_.ToString("x2") }
        )
    }
    finally {
        $sha256.Dispose()
    }
}

function Get-JsonPropertyValue {
    param(
        [Parameter(Mandatory = $true)]
        [object]$InputObject,

        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $property = $InputObject.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $null
    }
    return $property.Value
}

function Test-ShutdownConfirmation {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [int]$ProcessId,

        [Parameter(Mandatory = $true)]
        [string]$InstanceNonce
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $null
    }

    try {
        $confirmation = Get-Content `
            -LiteralPath $Path `
            -Raw `
            -Encoding UTF8 |
            ConvertFrom-Json
        if (
            (Get-JsonPropertyValue $confirmation "version") -ne 1 -or
            (Get-JsonPropertyValue $confirmation "status") -ne "closed" -or
            [int](Get-JsonPropertyValue $confirmation "processId") -ne
                $ProcessId -or
            (Get-JsonPropertyValue $confirmation "instanceNonce") -ne
                $InstanceNonce
        ) {
            return $null
        }

        $completedAt = [string](
            Get-JsonPropertyValue $confirmation "completedAt"
        )
        $parsedCompletedAt = [DateTime]::MinValue
        if (
            [string]::IsNullOrWhiteSpace($completedAt) -or
            -not [DateTime]::TryParse(
                $completedAt,
                [ref]$parsedCompletedAt
            )
        ) {
            return $null
        }
        return $parsedCompletedAt.ToUniversalTime().ToString("o")
    }
    catch {
        return $null
    }
}

function Initialize-NativeProcessApi {
    if ($null -ne ("Gupiaomoniqi.NativeProcessApi" -as [type])) {
        return
    }

    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace Gupiaomoniqi {
    public static class NativeProcessApi {
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern IntPtr OpenProcess(
            uint desiredAccess,
            bool inheritHandle,
            int processId
        );

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool GetExitCodeProcess(
            IntPtr processHandle,
            out uint exitCode
        );

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool CloseHandle(IntPtr handle);
    }
}
"@
}

Normalize-ProcessPathEnvironment
Initialize-NativeProcessApi
$safeRoot = Assert-SafeDeploymentRoot -Root $Root
$releaseDirectory = Join-Path $safeRoot "current"
$entryPoint = Join-Path $releaseDirectory "server\dist\index.js"
$nodeExecutable = Resolve-NodeExecutable -Root $safeRoot -NodePath $NodePath

if (-not (Test-Path -LiteralPath $entryPoint -PathType Leaf)) {
    throw "生产入口不存在：$entryPoint。请先完成 npm run build 并部署 current 目录。"
}

$dataDirectory = Join-Path $safeRoot "data"
$runtimeDirectory = Join-Path $safeRoot "runtime"
$appUpdateDirectory = Join-Path $dataDirectory "app-updates"
Ensure-Directory -Path $dataDirectory
Ensure-Directory -Path $runtimeDirectory
Ensure-Directory -Path (Join-Path $dataDirectory "pgdata")
Ensure-Directory -Path (Join-Path $dataDirectory "real-pgdata")
Ensure-Directory -Path $appUpdateDirectory

$launcherStartedAt = (
    Get-Process -Id $PID
).StartTime.ToUniversalTime().ToString("o")
$launcherLockPath = Join-Path $runtimeDirectory "app-launcher.lock"
$launcherLock = $null
$nativeProcessHandle = [IntPtr]::Zero
try {
    $launcherLock = [IO.File]::Open(
        $launcherLockPath,
        [IO.FileMode]::OpenOrCreate,
        [IO.FileAccess]::ReadWrite,
        [IO.FileShare]::None
    )
    $lockPayload = [ordered]@{
        launcherProcessId = $PID
        launcherStartedAt = $launcherStartedAt
        root = $safeRoot
    } | ConvertTo-Json -Compress
    $lockBytes = (
        New-Object Text.UTF8Encoding($false)
    ).GetBytes($lockPayload)
    $launcherLock.SetLength(0)
    $launcherLock.Write($lockBytes, 0, $lockBytes.Length)
    $launcherLock.Flush()
}
catch {
    if ($null -ne $launcherLock) {
        $launcherLock.Dispose()
    }
    throw (
        "同一部署根已有启动器持有单实例锁，拒绝启动第二个实例：" +
        $launcherLockPath
    )
}

try {
$logs = New-TraceLogSet `
    -Root $safeRoot `
    -Name "app" `
    -RetentionCount $LogRetentionCount

$resolvedPythonPath = Resolve-OptionalPythonExecutable `
    -Root $safeRoot `
    -PythonPath $PythonPath
$pythonFallback = if ($null -ne $resolvedPythonPath) {
    [ordered]@{
        available = $true
        executable = $resolvedPythonPath
        message = (
            "Python 3 已验证，其目录会仅加入 Node 应用子进程的 Path。"
        )
    }
}
else {
    [ordered]@{
        available = $false
        executable = $null
        message = (
            "未找到可用的 Python 3；真实行情 Python HTTP 回退不可用，" +
            "应用其他功能继续运行。"
        )
    }
}

$env:NODE_ENV = "production"
$env:HOST = "127.0.0.1"
$env:PORT = [string]$Port
$env:SERVE_WEB = "true"
$env:DATABASE_DIR = Join-Path $dataDirectory "pgdata"
$env:REAL_DATABASE_DIR = Join-Path $dataDirectory "real-pgdata"
$env:MARKET_SEED_PATH = Join-Path $dataDirectory "market-seeds.json"
$env:REAL_MARKET_SYNC_ENABLED = if ($DisableRealMarketSync) {
    "false"
}
else {
    "true"
}
$env:AI_TRADING_ENABLED = if ($DisableAiTrading) {
    "false"
}
else {
    "true"
}
$env:APP_UPDATE_DIR = $appUpdateDirectory

$latestPath = Join-Path $runtimeDirectory "app-latest.json"
$shutdownRequestPath = Join-Path (
    $runtimeDirectory
) "app-shutdown-request.json"
$shutdownConfirmationPath = Join-Path (
    $runtimeDirectory
) "app-shutdown-confirmation.json"
$instanceNonce = [Guid]::NewGuid().ToString("N")
$processMarker = "--gupiaomoniqi-root=$safeRoot"
$rootIdentity = Get-StableRootIdentity -Path $safeRoot
$rootIdentityMarker = "--gupiaomoniqi-root-id=$rootIdentity"
$instanceMarker = "--gupiaomoniqi-instance=$instanceNonce"
$startedAt = (Get-Date).ToUniversalTime().ToString("o")

$rootMarkerPattern = (
    [regex]::Escape($processMarker) +
    '(?="|\s|$)'
)
$existingRootProcesses = @(
    Get-CimInstance `
        -ClassName Win32_Process `
        -Filter "Name='node.exe'" `
        -ErrorAction SilentlyContinue |
        Where-Object {
            -not [string]::IsNullOrWhiteSpace(
                [string]$_.CommandLine
            ) -and
            [regex]::IsMatch(
                [string]$_.CommandLine,
                $rootMarkerPattern,
                [Text.RegularExpressions.RegexOptions]::IgnoreCase
            )
        }
)
if ($existingRootProcesses.Count -gt 0) {
    throw (
        "检测到同一部署根仍有 Node 进程，拒绝启动第二个实例；PID：" +
        (($existingRootProcesses | Select-Object -ExpandProperty ProcessId) -join ",")
    )
}

foreach (
    $staleControlPath in @(
        $shutdownRequestPath,
        $shutdownConfirmationPath
    )
) {
    if (Test-Path -LiteralPath $staleControlPath -PathType Leaf) {
        Remove-Item -LiteralPath $staleControlPath -Force
    }
}

Write-AtomicJson -Path $latestPath -Value ([ordered]@{
    identitySchemaVersion = 1
    startedAt = $startedAt
    status = "starting"
    processId = $null
    launcherProcessId = $PID
    launcherStartedAt = $launcherStartedAt
    processExecutable = $nodeExecutable
    entryPoint = $entryPoint
    processMarker = $processMarker
    rootIdentityMarker = $rootIdentityMarker
    instanceMarker = $instanceMarker
    instanceNonce = $instanceNonce
    shutdownRequestPath = $shutdownRequestPath
    shutdownConfirmationPath = $shutdownConfirmationPath
    host = "127.0.0.1"
    port = $Port
    realMarketSyncEnabled = (-not $DisableRealMarketSync)
    aiTradingEnabled = (-not $DisableAiTrading)
})

Write-LauncherLog -Path $logs.Launcher -Message (
    "启动应用；Node={0}；WorkingDirectory={1}" -f
        $nodeExecutable,
        $releaseDirectory
)
if ($pythonFallback.available) {
    Write-LauncherLog -Path $logs.Launcher -Message (
        "真实行情 Python 回退可用；Python={0}" -f $resolvedPythonPath
    )
}
else {
    Write-LauncherLog -Path $logs.Launcher -Message (
        "警告：真实行情 Python 回退不可用；未找到或无法验证 Python 3。"
    )
}

$process = $null
$processStartedAt = $null
try {
    $originalProcessPath = [Environment]::GetEnvironmentVariable(
        "Path",
        "Process"
    )
    try {
        if ($null -ne $resolvedPythonPath) {
            $pythonDirectory = Split-Path -Parent $resolvedPythonPath
            $childPath = if (
                [string]::IsNullOrWhiteSpace($originalProcessPath)
            ) {
                $pythonDirectory
            }
            else {
                "$pythonDirectory;$originalProcessPath"
            }
            [Environment]::SetEnvironmentVariable(
                "Path",
                $childPath,
                "Process"
            )
        }

        $env:APP_RUNTIME_DIR = $runtimeDirectory
        $env:APP_SHUTDOWN_REQUEST_PATH = $shutdownRequestPath
        $env:APP_SHUTDOWN_CONFIRMATION_PATH = $shutdownConfirmationPath
        $env:APP_INSTANCE_NONCE = $instanceNonce
        $entryPointArgument = ConvertTo-TaskQuotedArgument -Value $entryPoint
        $markerArgument = ConvertTo-TaskQuotedArgument -Value $processMarker
        $rootIdentityArgument = ConvertTo-TaskQuotedArgument `
            -Value $rootIdentityMarker
        $instanceArgument = ConvertTo-TaskQuotedArgument `
            -Value $instanceMarker
        $process = Start-Process `
            -FilePath $nodeExecutable `
            -ArgumentList @(
                $entryPointArgument,
                $markerArgument,
                $rootIdentityArgument,
                $instanceArgument
            ) `
            -WorkingDirectory $releaseDirectory `
            -WindowStyle Hidden `
            -RedirectStandardOutput $logs.Stdout `
            -RedirectStandardError $logs.Stderr `
            -PassThru
        $nativeProcessHandle = [Gupiaomoniqi.NativeProcessApi]::OpenProcess(
            [uint32]0x00101000,
            $false,
            $process.Id
        )
        if ($nativeProcessHandle -eq [IntPtr]::Zero) {
            $nativeError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
            throw (
                "无法持有 Node 进程句柄，拒绝产生不可验证的受管实例；" +
                "PID=$($process.Id)；Win32Error=$nativeError"
            )
        }
    }
    finally {
        [Environment]::SetEnvironmentVariable(
            "Path",
            $originalProcessPath,
            "Process"
        )
    }

    $processStartedAt = (
        $process.StartTime.ToUniversalTime().ToString("o")
    )
    Write-AtomicJson -Path $latestPath -Value ([ordered]@{
        identitySchemaVersion = 1
        startedAt = $startedAt
        processStartedAt = $processStartedAt
        status = "running"
        processId = $process.Id
        launcherProcessId = $PID
        launcherStartedAt = $launcherStartedAt
        processExecutable = $nodeExecutable
        entryPoint = $entryPoint
        processMarker = $processMarker
        rootIdentityMarker = $rootIdentityMarker
        instanceMarker = $instanceMarker
        instanceNonce = $instanceNonce
        shutdownRequestPath = $shutdownRequestPath
        shutdownConfirmationPath = $shutdownConfirmationPath
        host = "127.0.0.1"
        port = $Port
        realMarketSyncEnabled = (-not $DisableRealMarketSync)
        aiTradingEnabled = (-not $DisableAiTrading)
        pythonFallback = $pythonFallback
        stdout = $logs.Stdout
        stderr = $logs.Stderr
        launcher = $logs.Launcher
    })

    Write-LauncherLog -Path $logs.Launcher -Message (
        "Node 进程已启动并发布受管状态；PID={0}" -f $process.Id
    )
}
catch {
    $startupError = $_
    if ($null -ne $process) {
        try {
            $process.Refresh()
            if (-not $process.HasExited) {
                try {
                    Write-AtomicJson `
                        -Path $shutdownRequestPath `
                        -Value ([ordered]@{
                            version = 1
                            processId = $process.Id
                            instanceNonce = $instanceNonce
                            requestedAt = (
                                Get-Date
                            ).ToUniversalTime().ToString("o")
                            reason = "launcher-state-publish-failed"
                        })
                    [void]$process.WaitForExit(10000)
                    $process.Refresh()
                }
                catch {
                    # 状态发布已经失败；停机请求失败时继续精确清理刚启动的子进程。
                }
            }
            if (-not $process.HasExited) {
                Stop-Process -InputObject $process -Force
                [void]$process.WaitForExit(10000)
            }
            if ($process.HasExited) {
                $process.WaitForExit()
            }
        }
        catch {
            Write-LauncherLog -Path $logs.Launcher -Message (
                "严重警告：启动状态发布失败后，精确清理 Node 子进程也失败；" +
                "PID=$($process.Id)。"
            )
        }
    }

    try {
        Write-AtomicJson -Path $latestPath -Value ([ordered]@{
            identitySchemaVersion = 1
            startedAt = $startedAt
            processStartedAt = $processStartedAt
            stoppedAt = (Get-Date).ToUniversalTime().ToString("o")
            status = "startup-failed"
            processId = if ($null -eq $process) {
                $null
            }
            else {
                $process.Id
            }
            launcherProcessId = $PID
            launcherStartedAt = $launcherStartedAt
            processExecutable = $nodeExecutable
            entryPoint = $entryPoint
            processMarker = $processMarker
            rootIdentityMarker = $rootIdentityMarker
            instanceMarker = $instanceMarker
            instanceNonce = $instanceNonce
            shutdownRequestPath = $shutdownRequestPath
            shutdownConfirmationPath = $shutdownConfirmationPath
            startupError = $startupError.Exception.Message
        })
    }
    catch {
        # 原始故障可能就是状态目录不可写，不能用二次记录错误覆盖根因。
    }
    throw $startupError
}

$process.WaitForExit()
$process.WaitForExit()
$process.Refresh()
$nativeExitCode = [uint32]0
$exitCodeRead = (
    $nativeProcessHandle -ne [IntPtr]::Zero -and
    [Gupiaomoniqi.NativeProcessApi]::GetExitCodeProcess(
        $nativeProcessHandle,
        [ref]$nativeExitCode
    )
)
$exitCode = if (-not $exitCodeRead) {
    -1
}
else {
    [long]$nativeExitCode
}
$stoppedAt = (Get-Date).ToUniversalTime().ToString("o")
$shutdownConfirmedAt = if ($exitCode -eq 0) {
    Test-ShutdownConfirmation `
        -Path $shutdownConfirmationPath `
        -ProcessId $process.Id `
        -InstanceNonce $instanceNonce
}
else {
    $null
}
$gracefulShutdownConfirmed = $null -ne $shutdownConfirmedAt

Write-AtomicJson -Path $latestPath -Value ([ordered]@{
    identitySchemaVersion = 1
    startedAt = $startedAt
    processStartedAt = $processStartedAt
    stoppedAt = $stoppedAt
    status = "stopped"
    processId = $process.Id
    launcherProcessId = $PID
    launcherStartedAt = $launcherStartedAt
    processExecutable = $nodeExecutable
    entryPoint = $entryPoint
    processMarker = $processMarker
    rootIdentityMarker = $rootIdentityMarker
    instanceMarker = $instanceMarker
    instanceNonce = $instanceNonce
    shutdownRequestPath = $shutdownRequestPath
    shutdownConfirmationPath = $shutdownConfirmationPath
    gracefulShutdownConfirmed = $gracefulShutdownConfirmed
    shutdownConfirmedAt = $shutdownConfirmedAt
    host = "127.0.0.1"
    port = $Port
    realMarketSyncEnabled = (-not $DisableRealMarketSync)
    aiTradingEnabled = (-not $DisableAiTrading)
    exitCode = $exitCode
    pythonFallback = $pythonFallback
    stdout = $logs.Stdout
    stderr = $logs.Stderr
    launcher = $logs.Launcher
})

Write-LauncherLog -Path $logs.Launcher -Message (
    "Node 进程退出；PID={0}；ExitCode={1}；优雅关闭确认={2}" -f
        $process.Id,
        $exitCode,
        $gracefulShutdownConfirmed
)

throw (
    "应用服务进程已经退出，计划任务将负责重启。退出码：{0}；错误日志：{1}" -f
        $exitCode,
        $logs.Stderr
)
}
finally {
    if ($nativeProcessHandle -ne [IntPtr]::Zero) {
        [void][Gupiaomoniqi.NativeProcessApi]::CloseHandle(
            $nativeProcessHandle
        )
    }
    $launcherLock.Dispose()
}
