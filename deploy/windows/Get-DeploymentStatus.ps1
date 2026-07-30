[CmdletBinding()]
param(
    [string]$Root = "C:\ProgramData\gupiaomoniqi",
    [string]$AppTaskName = "Gupiaomoniqi-App",
    [string]$TunnelTaskName = "Gupiaomoniqi-Cloudflare-Quick-Tunnel",
    [ValidateRange(0, 600)]
    [int]$WaitSeconds = 0,
    [ValidateRange(1, 30)]
    [int]$RequestTimeoutSeconds = 8,
    [switch]$SkipPublic
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "_Common.ps1")

function Test-StatusSamePath {
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

function Get-TaskStatus {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [string]$ExpectedRunner,

        [string]$ExpectedRoot
    )

    $tasks = @(
        Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    )
    if ($tasks.Count -eq 0) {
        return [ordered]@{
            exists = $false
            state = "Missing"
            bindingValid = $false
            taskPath = $null
            lastRunTime = $null
            lastTaskResult = $null
        }
    }
    if ($tasks.Count -ne 1) {
        return [ordered]@{
            exists = $true
            state = "Ambiguous"
            bindingValid = $false
            taskPath = $null
            lastRunTime = $null
            lastTaskResult = $null
        }
    }

    $task = $tasks[0]
    $bindingValid = $true
    if (
        -not [string]::IsNullOrWhiteSpace($ExpectedRunner) -or
        -not [string]::IsNullOrWhiteSpace($ExpectedRoot)
    ) {
        $actions = @($task.Actions)
        $bindingValid = (
            $actions.Count -eq 1 -and
            ([string]$task.TaskPath -eq "\" -or
                [string]::IsNullOrWhiteSpace([string]$task.TaskPath)) -and
            (Test-StatusSamePath `
                -Left ([string]$actions[0].Execute) `
                -Right (Get-WindowsPowerShellPath))
        )
        if ($bindingValid) {
            $arguments = [string]$actions[0].Arguments
            foreach ($requiredFragment in @(
                ('-File "{0}"' -f $ExpectedRunner),
                ('-Root "{0}"' -f $ExpectedRoot)
            )) {
                if ($arguments.IndexOf(
                    $requiredFragment,
                    [StringComparison]::OrdinalIgnoreCase
                ) -lt 0) {
                    $bindingValid = $false
                    break
                }
            }
        }
    }
    $info = Get-ScheduledTaskInfo -TaskName $Name
    return [ordered]@{
        exists = $true
        state = [string]$task.State
        bindingValid = $bindingValid
        taskPath = [string]$task.TaskPath
        lastRunTime = if ($info.LastRunTime -eq [DateTime]::MinValue) {
            $null
        }
        else {
            $info.LastRunTime.ToUniversalTime().ToString("o")
        }
        lastTaskResult = $info.LastTaskResult
    }
}

function Invoke-StatusProbe {
    param([Parameter(Mandatory = $true)][uri]$Uri)

    try {
        $response = Invoke-WebRequest `
            -Uri $Uri `
            -UseBasicParsing `
            -TimeoutSec $RequestTimeoutSeconds
        return [ordered]@{
            ok = (
                $response.StatusCode -ge 200 -and
                $response.StatusCode -lt 400
            )
            statusCode = [int]$response.StatusCode
            error = $null
        }
    }
    catch {
        return [ordered]@{
            ok = $false
            statusCode = $null
            error = $_.Exception.Message
        }
    }
}

function Get-OptionalPropertyValue {
    param(
        [object]$Value,

        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    if ($null -eq $Value) {
        return $null
    }
    $property = $Value.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $null
    }
    return $property.Value
}

function Get-TunnelRuntimeStatus {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $result = [ordered]@{
        available = $false
        parseError = $null
        schemaVersion = $null
        updatedAt = $null
        startedAt = $null
        supervisorStartedAt = $null
        stoppedAt = $null
        status = "unknown"
        supervisorProcessId = $null
        processId = $null
        processStartedAt = $null
        executablePath = $null
        originUrl = $null
        quickTunnelUrl = $null
        lastQuickTunnelUrl = $null
        adoptedExistingProcess = $null
        exitCode = $null
        exitCodeAvailable = $false
        error = $null
        logs = [ordered]@{
            stdout = $null
            stderr = $null
            launcher = $null
        }
    }

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $result
    }

    try {
        $state = Get-Content `
            -LiteralPath $Path `
            -Raw `
            -Encoding UTF8 | ConvertFrom-Json
        $result.available = $true
        foreach ($propertyName in @(
            "schemaVersion",
            "updatedAt",
            "startedAt",
            "supervisorStartedAt",
            "stoppedAt",
            "status",
            "supervisorProcessId",
            "processId",
            "processStartedAt",
            "executablePath",
            "originUrl",
            "quickTunnelUrl",
            "lastQuickTunnelUrl",
            "adoptedExistingProcess",
            "exitCode",
            "exitCodeAvailable",
            "error"
        )) {
            $propertyValue = Get-OptionalPropertyValue `
                -Value $state `
                -Name $propertyName
            if ($null -ne $propertyValue) {
                $result[$propertyName] = $propertyValue
            }
        }
        foreach ($logName in @("stdout", "stderr", "launcher")) {
            $result.logs[$logName] = Get-OptionalPropertyValue `
                -Value $state `
                -Name $logName
        }
    }
    catch {
        $result.parseError = $_.Exception.Message
    }

    return $result
}

function Get-TunnelProcessVerification {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Runtime
    )

    $result = [ordered]@{
        alive = $false
        error = $null
    }
    if (@("connecting", "running") -notcontains [string]$Runtime.status) {
        $result.error = "运行状态尚未报告 cloudflared 进程。"
        return $result
    }

    try {
        $processId = [int]$Runtime.processId
        if ($processId -le 0) {
            throw "状态中没有有效 PID"
        }
        if ([string]::IsNullOrWhiteSpace(
            [string]$Runtime.executablePath
        )) {
            throw "状态中没有可执行文件路径"
        }
        if ([string]::IsNullOrWhiteSpace(
            [string]$Runtime.processStartedAt
        )) {
            throw "状态中没有进程启动时间"
        }

        $process = [System.Diagnostics.Process]::GetProcessById($processId)
        try {
            $process.Refresh()
            if ($process.HasExited) {
                throw "PID 已退出"
            }
            if (-not (Test-StatusSamePath `
                -Left $process.MainModule.FileName `
                -Right ([string]$Runtime.executablePath))
            ) {
                throw "PID 的可执行文件路径不匹配"
            }
            $recordedStart = [DateTime]::Parse(
                [string]$Runtime.processStartedAt
            ).ToUniversalTime()
            if ([Math]::Abs(
                (
                    $recordedStart -
                    $process.StartTime.ToUniversalTime()
                ).TotalSeconds
            ) -gt 5) {
                throw "PID 的启动时间不匹配"
            }
        }
        finally {
            $process.Dispose()
        }
        $result.alive = $true
    }
    catch {
        $result.error = $_.Exception.Message
    }
    return $result
}

$safeRoot = Assert-SafeDeploymentRoot -Root $Root
$urlPath = Join-Path $safeRoot "runtime\cloudflare-quick-url.txt"
$cloudflaredLatestPath = Join-Path `
    $safeRoot `
    "runtime\cloudflared-latest.json"
$expectedTunnelRunner = Join-Path `
    $safeRoot `
    "current\deploy\windows\Run-QuickTunnel.ps1"
$deadline = (Get-Date).AddSeconds($WaitSeconds)

do {
    $appTaskStatus = Get-TaskStatus -Name $AppTaskName
    $tunnelTaskStatus = Get-TaskStatus `
        -Name $TunnelTaskName `
        -ExpectedRunner $expectedTunnelRunner `
        -ExpectedRoot $safeRoot
    $localHealth = Invoke-StatusProbe `
        -Uri "http://127.0.0.1:3100/api/health"
    $localWeb = Invoke-StatusProbe -Uri "http://127.0.0.1:3100/"
    $tunnelRuntime = Get-TunnelRuntimeStatus `
        -Path $cloudflaredLatestPath
    $tunnelProcessVerification = Get-TunnelProcessVerification `
        -Runtime $tunnelRuntime

    $quickTunnelUrl = $null
    if (Test-Path -LiteralPath $urlPath -PathType Leaf) {
        $urlContent = Get-Content `
            -LiteralPath $urlPath `
            -Raw `
            -Encoding UTF8
        $candidateUrl = ([string]$urlContent).Trim().TrimEnd("/")
        $runtimeUrl = ([string]$tunnelRuntime.quickTunnelUrl).TrimEnd("/")
        if (
            $tunnelProcessVerification.alive -and
            [string]$tunnelRuntime.status -eq "running" -and
            $candidateUrl -match (
                "^https://[a-zA-Z0-9-]+\.trycloudflare\.com$"
            ) -and
            [string]::Equals(
                $candidateUrl,
                $runtimeUrl,
                [StringComparison]::OrdinalIgnoreCase
            )
        ) {
            $quickTunnelUrl = $candidateUrl
        }
    }

    $publicHealth = [ordered]@{
        skipped = [bool]$SkipPublic
        ok = $false
        statusCode = $null
        error = if ($SkipPublic) {
            $null
        }
        elseif ($null -eq $quickTunnelUrl) {
            "尚未生成 Cloudflare Quick Tunnel 地址。"
        }
        else {
            $null
        }
    }
    $publicWeb = [ordered]@{
        skipped = [bool]$SkipPublic
        ok = $false
        statusCode = $null
        error = $publicHealth.error
    }

    if (-not $SkipPublic -and $null -ne $quickTunnelUrl) {
        $publicHealth = Invoke-StatusProbe `
            -Uri "$quickTunnelUrl/api/health"
        $publicHealth.skipped = $false
        $publicWeb = Invoke-StatusProbe -Uri "$quickTunnelUrl/"
        $publicWeb.skipped = $false
    }

    $applicationReady = (
        $appTaskStatus.exists -and
        $appTaskStatus.state -eq "Running" -and
        $localHealth.ok -and
        $localWeb.ok
    )
    $tunnelTaskRunning = (
        $tunnelTaskStatus.exists -and
        $tunnelTaskStatus.state -eq "Running" -and
        $tunnelTaskStatus.bindingValid
    )
    $tunnelProcessReportedAlive = (
        [bool]$tunnelProcessVerification.alive
    )
    $tunnelAlive = (
        $tunnelTaskRunning -and
        $tunnelProcessReportedAlive
    )
    $publicOriginReady = (
        -not $SkipPublic -and
        $publicHealth.ok -and
        $publicWeb.ok
    )
    $ready = (
        $applicationReady -and
        $tunnelAlive -and
        (
            $SkipPublic -or
            $publicOriginReady
        )
    )

    if ($ready -or (Get-Date) -ge $deadline) {
        break
    }

    Start-Sleep -Seconds 1
} while ($true)

$appLatestPath = Join-Path $safeRoot "runtime\app-latest.json"
$pythonFallbackStatus = [ordered]@{
    available = $false
    executable = $null
    message = "应用状态文件尚未生成，无法确认 Python 回退状态。"
}
if (Test-Path -LiteralPath $appLatestPath -PathType Leaf) {
    try {
        $appLatest = Get-Content `
            -LiteralPath $appLatestPath `
            -Raw `
            -Encoding UTF8 | ConvertFrom-Json
        $pythonProperty = $appLatest.PSObject.Properties["pythonFallback"]
        if ($null -ne $pythonProperty -and $null -ne $pythonProperty.Value) {
            $pythonFallbackStatus = $pythonProperty.Value
        }
        else {
            $pythonFallbackStatus.message = (
                "应用状态文件来自旧版本，未包含 Python 回退状态。"
            )
        }
    }
    catch {
        $pythonFallbackStatus.message = (
            "应用状态文件无法解析：{0}" -f $_.Exception.Message
        )
    }
}

$status = [ordered]@{
    checkedAt = (Get-Date).ToUniversalTime().ToString("o")
    root = $safeRoot
    ready = $ready
    applicationReady = $applicationReady
    tunnelAlive = $tunnelAlive
    tasks = [ordered]@{
        app = $appTaskStatus
        tunnel = $tunnelTaskStatus
    }
    local = [ordered]@{
        health = $localHealth
        web = $localWeb
    }
    cloudflare = [ordered]@{
        quickTunnelUrl = $quickTunnelUrl
        urlPublished = $null -ne $quickTunnelUrl
        tunnelTaskRunning = $tunnelTaskRunning
        processReportedAlive = $tunnelProcessReportedAlive
        processVerification = $tunnelProcessVerification
        tunnelAlive = $tunnelAlive
        publicOriginReady = $publicOriginReady
        runtime = $tunnelRuntime
        health = $publicHealth
        web = $publicWeb
    }
    pythonFallback = $pythonFallbackStatus
    latestStateFiles = [ordered]@{
        app = $appLatestPath
        cloudflared = $cloudflaredLatestPath
    }
}

$status | ConvertTo-Json -Depth 8

if (-not $ready) {
    exit 1
}
