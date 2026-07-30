[CmdletBinding()]
param(
    [string]$Root = "C:\ProgramData\gupiaomoniqi",
    [string]$NodePath,
    [string]$PythonPath,
    [string]$TaskName = "Gupiaomoniqi-App",
    [ValidateRange(1, 65535)]
    [int]$Port = 3100,
    [switch]$DisableRealMarketSync,
    [switch]$DisableAiTrading,
    [ValidateRange(5, 600)]
    [int]$StartupTimeoutSeconds = 90,
    [switch]$DoNotStart
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "_Common.ps1")

function Get-CanonicalInstallPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $pathRoot = [System.IO.Path]::GetPathRoot($fullPath)
    if (
        -not [string]::Equals(
            $fullPath,
            $pathRoot,
            [StringComparison]::OrdinalIgnoreCase
        )
    ) {
        $fullPath = $fullPath.TrimEnd(
            [char[]]@(
                [System.IO.Path]::DirectorySeparatorChar,
                [System.IO.Path]::AltDirectorySeparatorChar
            )
        )
    }

    $missingSegments = New-Object System.Collections.Generic.List[string]
    $cursor = $fullPath
    while (-not (Test-Path -LiteralPath $cursor)) {
        $leaf = Split-Path -Leaf $cursor
        if ([string]::IsNullOrWhiteSpace($leaf)) {
            throw "无法解析路径的现存祖先：$Path"
        }
        $missingSegments.Insert(0, $leaf)
        $parent = Split-Path -Parent $cursor
        if (
            [string]::IsNullOrWhiteSpace($parent) -or
            [string]::Equals(
                $parent,
                $cursor,
                [StringComparison]::OrdinalIgnoreCase
            )
        ) {
            throw "无法解析路径的现存祖先：$Path"
        }
        $cursor = $parent
    }

    $canonical = (Get-Item -LiteralPath $cursor -Force).FullName
    foreach ($segment in $missingSegments) {
        $canonical = Join-Path $canonical $segment
    }
    return [System.IO.Path]::GetFullPath($canonical).TrimEnd("\")
}

function Test-SameInstallPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Left,

        [Parameter(Mandatory = $true)]
        [string]$Right
    )

    return [string]::Equals(
        (Get-CanonicalInstallPath -Path $Left),
        (Get-CanonicalInstallPath -Path $Right),
        [StringComparison]::OrdinalIgnoreCase
    )
}

function Assert-LocalFixedInstallPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$Description
    )

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    if ($fullPath.StartsWith("\\", [StringComparison]::Ordinal)) {
        throw "$Description 不允许使用 UNC/网络路径：$fullPath"
    }

    $pathRoot = [System.IO.Path]::GetPathRoot($fullPath)
    $drive = New-Object System.IO.DriveInfo($pathRoot)
    if ($drive.DriveType -ne [IO.DriveType]::Fixed) {
        throw "$Description 必须位于本机固定磁盘：$fullPath"
    }
}

function Get-ExpectedInstallRootIdentityMarker {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root
    )

    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes(
            $Root.ToLowerInvariant()
        )
        $identity = -join (
            $sha256.ComputeHash($bytes) |
                ForEach-Object { $_.ToString("x2") }
        )
        return "--gupiaomoniqi-root-id=$identity"
    }
    finally {
        $sha256.Dispose()
    }
}

function Test-InstallCommandLineToken {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CommandLine,

        [Parameter(Mandatory = $true)]
        [string]$Token
    )

    if (
        [string]::IsNullOrWhiteSpace($CommandLine) -or
        [string]::IsNullOrWhiteSpace($Token)
    ) {
        return $false
    }

    return [regex]::IsMatch(
        $CommandLine,
        (
            '(?:^|[\s"])' +
            [regex]::Escape($Token) +
            '(?=$|[\s"])'
        ),
        [Text.RegularExpressions.RegexOptions]::IgnoreCase
    )
}

function Assert-InstalledTaskBinding {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Task,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedRunner,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedRoot,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedNode,

        [Parameter(Mandatory = $true)]
        [int]$ExpectedPort
    )

    $taskRecords = @($Task)
    if ($taskRecords.Count -ne 1) {
        throw "同名计划任务必须且只能匹配一个根任务：$($Task.TaskName)"
    }
    $Task = $taskRecords[0]
    if (
        -not [string]::IsNullOrWhiteSpace([string]$Task.TaskPath) -and
        [string]$Task.TaskPath -ne "\"
    ) {
        throw "同名计划任务位于非根任务目录，拒绝覆盖：$($Task.TaskPath)"
    }

    $actions = @($Task.Actions)
    if ($actions.Count -ne 1) {
        throw "同名计划任务不是本应用的单动作任务，拒绝覆盖：$($Task.TaskName)"
    }
    $action = $actions[0]
    if (
        -not (Test-SameInstallPath `
            -Left ([string]$action.Execute) `
            -Right (Get-WindowsPowerShellPath))
    ) {
        throw "同名计划任务的启动程序不属于本应用，拒绝覆盖。"
    }
    if (
        [string]::IsNullOrWhiteSpace(
            [string]$action.WorkingDirectory
        ) -or
        -not (Test-SameInstallPath `
            -Left ([string]$action.WorkingDirectory) `
            -Right $ExpectedRoot)
    ) {
        throw "同名计划任务的工作目录不属于当前部署。"
    }

    $arguments = [string]$action.Arguments
    $argumentPattern = (
        '^\s*-NoLogo\s+-NoProfile\s+-NonInteractive\s+' +
        '-ExecutionPolicy\s+Bypass\s+-File\s+"' +
        [regex]::Escape($ExpectedRunner) +
        '"\s+-Root\s+"' +
        [regex]::Escape($ExpectedRoot) +
        '"\s+-NodePath\s+"' +
        [regex]::Escape($ExpectedNode) +
        '"\s+-Port\s+' +
        [regex]::Escape([string]$ExpectedPort) +
        '(?:\s+-PythonPath\s+"(?<python>[^"]+)")?' +
        '(?:\s+-DisableRealMarketSync)?' +
        '(?:\s+-DisableAiTrading)?\s*$'
    )
    $argumentMatch = [regex]::Match(
        $arguments,
        $argumentPattern,
        [Text.RegularExpressions.RegexOptions]::IgnoreCase
    )
    if (-not $argumentMatch.Success) {
        throw (
            "同名计划任务不是当前部署生成的完整启动命令，拒绝覆盖。实际：" +
            $arguments
        )
    }
    $taskPythonPath = $argumentMatch.Groups["python"].Value
    if (-not [string]::IsNullOrWhiteSpace($taskPythonPath)) {
        Assert-LocalFixedInstallPath `
            -Path $taskPythonPath `
            -Description "计划任务 Python"
        Assert-NoReparsePointInPathOrAncestors `
            -Path $taskPythonPath `
            -Description "计划任务 Python"
        if (
            -not (Test-Path -LiteralPath $taskPythonPath -PathType Leaf) -or
            [IO.Path]::GetExtension($taskPythonPath) -ne ".exe"
        ) {
            throw "计划任务 Python 不是本机现存的 exe：$taskPythonPath"
        }
    }

    $principalUserId = [string]$Task.Principal.UserId
    if (
        $principalUserId -ne "SYSTEM" -and
        $principalUserId -ne "S-1-5-18"
    ) {
        throw "应用计划任务必须由 SYSTEM 托管：$principalUserId"
    }
    if (
        [string]$Task.Principal.LogonType -ne "ServiceAccount" -or
        [string]$Task.Principal.RunLevel -ne "Highest"
    ) {
        throw "应用计划任务必须以 SYSTEM 服务账户最高权限运行。"
    }

    $triggers = @($Task.Triggers)
    $triggerClass = if ($triggers.Count -eq 1) {
        [string]$triggers[0].CimClass.CimClassName
    }
    else {
        ""
    }
    if (
        $triggers.Count -ne 1 -or
        $triggerClass -ne "MSFT_TaskBootTrigger" -or
        -not [bool]$triggers[0].Enabled
    ) {
        throw "应用计划任务必须且只能使用已启用的系统启动触发器。"
    }

    $settings = $Task.Settings
    try {
        $restartInterval = [Xml.XmlConvert]::ToTimeSpan(
            [string]$settings.RestartInterval
        )
        $executionTimeLimit = [Xml.XmlConvert]::ToTimeSpan(
            [string]$settings.ExecutionTimeLimit
        )
    }
    catch {
        throw "应用计划任务的时间设置无法解析。"
    }
    if (
        $null -eq $settings -or
        [string]$settings.MultipleInstances -ne "IgnoreNew" -or
        [int]$settings.RestartCount -ne 999 -or
        $restartInterval -ne (New-TimeSpan -Minutes 1) -or
        $executionTimeLimit -ne [TimeSpan]::Zero -or
        [bool]$settings.DisallowStartIfOnBatteries -or
        [bool]$settings.StopIfGoingOnBatteries -or
        -not [bool]$settings.StartWhenAvailable
    ) {
        throw "应用计划任务的单实例、重启或执行时限设置不安全。"
    }
}

function Get-InstalledAppTaskByName {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [switch]$AllowMissing
    )

    $tasks = @(
        Get-ScheduledTask `
            -TaskName $Name `
            -ErrorAction SilentlyContinue
    )
    if ($tasks.Count -gt 1) {
        throw "发现多个同名应用计划任务，拒绝模糊安装：$Name"
    }
    if ($tasks.Count -eq 0) {
        if ($AllowMissing) {
            return $null
        }
        throw "应用计划任务不存在：$Name"
    }

    $task = $tasks[0]
    if (
        -not [string]::IsNullOrWhiteSpace([string]$task.TaskPath) -and
        [string]$task.TaskPath -ne "\"
    ) {
        throw (
            "同名应用计划任务位于非根任务目录，拒绝覆盖：" +
            "$($task.TaskPath)$Name"
        )
    }
    return $task
}

function Get-ExpectedAppProcesses {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ExpectedNode,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedEntryPoint,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedRoot
    )

    $marker = "--gupiaomoniqi-root=$ExpectedRoot"
    $rootIdentityMarker = Get-ExpectedInstallRootIdentityMarker `
        -Root $ExpectedRoot
    return @(
        Get-CimInstance `
            -ClassName Win32_Process `
            -Filter "Name='node.exe'" `
            -ErrorAction SilentlyContinue |
        Where-Object {
            -not [string]::IsNullOrWhiteSpace(
                [string]$_.ExecutablePath
            ) -and
            (Test-SameInstallPath `
                -Left ([string]$_.ExecutablePath) `
                -Right $ExpectedNode) -and
            (
                (
                    (Test-InstallCommandLineToken `
                        -CommandLine ([string]$_.CommandLine) `
                        -Token $marker) -and
                    (Test-InstallCommandLineToken `
                        -CommandLine ([string]$_.CommandLine) `
                        -Token $rootIdentityMarker)
                ) -or
                (Test-InstallCommandLineToken `
                    -CommandLine ([string]$_.CommandLine) `
                    -Token $ExpectedEntryPoint)
            )
        }
    )
}

function Wait-InstalledAppHealthy {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DeploymentRoot,

        [Parameter(Mandatory = $true)]
        [string]$ApplicationTaskName,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedNode,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedEntryPoint,

        [Parameter(Mandatory = $true)]
        [int]$ApplicationPort,

        [Parameter(Mandatory = $true)]
        [DateTime]$NotBefore,

        [Parameter(Mandatory = $true)]
        [int]$TimeoutSeconds
    )

    $latestPath = Join-Path $DeploymentRoot "runtime\app-latest.json"
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $healthySince = $null
    $healthyProcessId = 0
    $lastError = $null

    do {
        try {
            $task = Get-InstalledAppTaskByName `
                -Name $ApplicationTaskName
            if ($task.State -ne "Running") {
                throw "计划任务状态为 $($task.State)"
            }
            Assert-InstalledTaskBinding `
                -Task $task `
                -ExpectedRunner (
                    Join-Path `
                        $DeploymentRoot `
                        "current\deploy\windows\Run-App.ps1"
                ) `
                -ExpectedRoot $DeploymentRoot `
                -ExpectedNode $ExpectedNode `
                -ExpectedPort $ApplicationPort
            if (-not (Test-Path -LiteralPath $latestPath -PathType Leaf)) {
                throw "应用状态文件尚未生成"
            }
            $state = Get-Content `
                -LiteralPath $latestPath `
                -Raw `
                -Encoding UTF8 |
                ConvertFrom-Json
            if ([string]$state.status -ne "running") {
                if ([string]$state.status -eq "stopped") {
                    throw "应用进程已经退出，退出码：$($state.exitCode)"
                }
                throw "应用状态不是 running"
            }
            $startedAt = [DateTime]::Parse(
                [string]$state.processStartedAt
            ).ToUniversalTime()
            if ($startedAt -lt $NotBefore.AddSeconds(-2)) {
                throw "应用状态仍属于安装前实例"
            }

            $processId = [int]$state.processId
            $expectedProcessMarker = "--gupiaomoniqi-root=$DeploymentRoot"
            $expectedRootIdentityMarker = (
                Get-ExpectedInstallRootIdentityMarker -Root $DeploymentRoot
            )
            $instanceNonce = [string]$state.instanceNonce
            $expectedInstanceMarker = (
                "--gupiaomoniqi-instance=$instanceNonce"
            )
            $process = Get-CimInstance `
                -ClassName Win32_Process `
                -Filter "ProcessId=$processId" `
                -ErrorAction SilentlyContinue
            if (
                $null -eq $process -or
                -not (Test-SameInstallPath `
                    -Left ([string]$process.ExecutablePath) `
                    -Right $ExpectedNode) -or
                $instanceNonce -notmatch "^[a-fA-F0-9]{32}$" -or
                -not [string]::Equals(
                    [string]$state.processMarker,
                    $expectedProcessMarker,
                    [StringComparison]::OrdinalIgnoreCase
                ) -or
                -not [string]::Equals(
                    [string]$state.rootIdentityMarker,
                    $expectedRootIdentityMarker,
                    [StringComparison]::OrdinalIgnoreCase
                ) -or
                [string]$state.instanceMarker -ne $expectedInstanceMarker -or
                -not (Test-InstallCommandLineToken `
                    -CommandLine ([string]$process.CommandLine) `
                    -Token $ExpectedEntryPoint) -or
                -not (Test-InstallCommandLineToken `
                    -CommandLine ([string]$process.CommandLine) `
                    -Token $expectedProcessMarker) -or
                -not (Test-InstallCommandLineToken `
                    -CommandLine ([string]$process.CommandLine) `
                    -Token $expectedRootIdentityMarker) -or
                -not (Test-InstallCommandLineToken `
                    -CommandLine ([string]$process.CommandLine) `
                    -Token $expectedInstanceMarker) -or
                [Math]::Abs((
                    $startedAt -
                    ([DateTime]$process.CreationDate).ToUniversalTime()
                ).TotalSeconds) -gt 5
            ) {
                throw "状态文件中的 PID 身份不属于本次安装"
            }

            $listenerIds = @(
                Get-NetTCPConnection `
                    -LocalPort $ApplicationPort `
                    -State Listen `
                    -ErrorAction SilentlyContinue |
                    Select-Object -ExpandProperty OwningProcess -Unique
            )
            if (
                $listenerIds.Count -ne 1 -or
                [int]$listenerIds[0] -ne $processId
            ) {
                throw "监听端口与本次 PID 不一致"
            }

            $health = Invoke-RestMethod `
                -Uri "http://127.0.0.1:$ApplicationPort/api/health" `
                -TimeoutSec 5
            if (
                [string]$health.data.status -ne "ok" -or
                [string]$health.data.database -ne "PGLITE" -or
                [int]$health.data.instrumentCount -le 0
            ) {
                throw "健康响应内容不完整或股票池为空"
            }

            if ($healthyProcessId -ne $processId) {
                $healthyProcessId = $processId
                $healthySince = Get-Date
            }
            if (
                $null -ne $healthySince -and
                ((Get-Date) - $healthySince).TotalSeconds -ge 5
            ) {
                return $processId
            }
        }
        catch {
            $lastError = $_.Exception.Message
            $healthySince = $null
            $healthyProcessId = 0
        }
        Start-Sleep -Seconds 1
    } while ((Get-Date) -lt $deadline)

    throw (
        "应用任务在 $TimeoutSeconds 秒内未形成稳定健康闭环。最后错误：" +
        $lastError
    )
}

Assert-LocalFixedInstallPath -Path $Root -Description "部署根目录"
Assert-WindowsAdministrator
$assertedRoot = Assert-SafeDeploymentRoot -Root $Root
$safeRoot = Get-CanonicalInstallPath -Path $assertedRoot
$currentDirectory = Join-Path $safeRoot "current"
Assert-NoReparsePointInPathOrAncestors `
    -Path $currentDirectory `
    -Description "生产代码目录"
$runnerPath = Join-Path $safeRoot "current\deploy\windows\Run-App.ps1"
$entryPoint = Join-Path $safeRoot "current\server\dist\index.js"
$resolvedNodePath = Resolve-NodeExecutable `
    -Root $safeRoot `
    -NodePath $NodePath
$resolvedPythonPath = Resolve-OptionalPythonExecutable `
    -Root $safeRoot `
    -PythonPath $PythonPath

if (-not (Test-Path -LiteralPath $entryPoint -PathType Leaf)) {
    throw "无法安装任务，生产入口不存在：$entryPoint"
}
if (-not (Test-Path -LiteralPath $runnerPath -PathType Leaf)) {
    throw "无法安装任务，受控启动脚本不存在：$runnerPath"
}
$runnerPath = (Resolve-Path -LiteralPath $runnerPath).Path

foreach ($path in @(
    (Join-Path $safeRoot "data"),
    (Join-Path $safeRoot "logs"),
    (Join-Path $safeRoot "runtime")
)) {
    Ensure-Directory -Path $path
}

$updateLockStream = $null
$launcherLockStream = $null
try {
    $updateLockPath = Join-Path $safeRoot "runtime\app-update.lock"
    try {
        $updateLockStream = [IO.File]::Open(
            $updateLockPath,
            [IO.FileMode]::OpenOrCreate,
            [IO.FileAccess]::ReadWrite,
            [IO.FileShare]::None
        )
    }
    catch {
        throw (
            "在线更新事务正在运行，Install-AppTask 不会并发修改计划任务：" +
            $updateLockPath
        )
    }

    $launcherLockPath = Join-Path $safeRoot "runtime\app-launcher.lock"
    try {
        $launcherLockStream = [IO.File]::Open(
            $launcherLockPath,
            [IO.FileMode]::OpenOrCreate,
            [IO.FileAccess]::ReadWrite,
            [IO.FileShare]::None
        )
    }
    catch {
        throw (
            "应用启动器正在运行或启动中，Install-AppTask 不会强停或覆盖任务。" +
            "代码更新请使用 Update-App.ps1。"
        )
    }

$existingTask = Get-InstalledAppTaskByName `
    -Name $TaskName `
    -AllowMissing
if ($null -ne $existingTask) {
    Assert-InstalledTaskBinding `
        -Task $existingTask `
        -ExpectedRunner $runnerPath `
        -ExpectedRoot $safeRoot `
        -ExpectedNode $resolvedNodePath `
        -ExpectedPort $Port
    if ($existingTask.State -eq "Running") {
        throw (
            "应用任务正在运行；Install-AppTask 不会强停 PGlite。" +
            "代码更新请使用 Update-App.ps1，修改任务参数前请先通过" +
            "受控停机确认服务已关闭。"
        )
    }
}

$runningAppProcesses = @(
    Get-ExpectedAppProcesses `
        -ExpectedNode $resolvedNodePath `
        -ExpectedEntryPoint $entryPoint `
        -ExpectedRoot $safeRoot
)
if ($runningAppProcesses.Count -gt 0) {
    throw (
        "发现仍在运行的本部署 Node，拒绝覆盖计划任务；PID：" +
        (($runningAppProcesses | Select-Object -ExpandProperty ProcessId) -join ",")
    )
}
$listenerIds = @(
    Get-NetTCPConnection `
        -LocalPort $Port `
        -State Listen `
        -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
)
if ($listenerIds.Count -gt 0) {
    throw (
        "端口 $Port 已被占用，拒绝安装并误把旧服务当作新服务；PID：" +
        ($listenerIds -join ",")
    )
}

$powerShellPath = Get-WindowsPowerShellPath
$argumentParts = @(
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-File", (ConvertTo-TaskQuotedArgument -Value $runnerPath),
    "-Root", (ConvertTo-TaskQuotedArgument -Value $safeRoot),
    "-NodePath", (ConvertTo-TaskQuotedArgument -Value $resolvedNodePath),
    "-Port", ([string]$Port)
)
if ($null -ne $resolvedPythonPath) {
    $argumentParts += @(
        "-PythonPath",
        (ConvertTo-TaskQuotedArgument -Value $resolvedPythonPath)
    )
    Write-Host "真实行情 Python 回退：$resolvedPythonPath"
}
else {
    Write-Warning (
        "未找到可用的 Python 3；应用仍会部署，但真实行情的 Python HTTP " +
        "回退暂不可用。可用 -PythonPath 指定完整 python.exe 路径后重装任务。"
    )
}
if ($DisableRealMarketSync) {
    $argumentParts += "-DisableRealMarketSync"
}
if ($DisableAiTrading) {
    $argumentParts += "-DisableAiTrading"
}
$arguments = $argumentParts -join " "

$action = New-ScheduledTaskAction `
    -Execute $powerShellPath `
    -Argument $arguments `
    -WorkingDirectory $safeRoot
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal `
    -UserId "SYSTEM" `
    -LogonType ServiceAccount `
    -RunLevel Highest
$settings = New-GupiaomoniqiTaskSettings

$task = New-ScheduledTask `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description "股票模拟器生产服务（仅监听 127.0.0.1:$Port）"

Register-ScheduledTask `
    -TaskName $TaskName `
    -TaskPath "\" `
    -InputObject $task `
    -Force | Out-Null

$registeredTask = Get-InstalledAppTaskByName -Name $TaskName
Assert-InstalledTaskBinding `
    -Task $registeredTask `
    -ExpectedRunner $runnerPath `
    -ExpectedRoot $safeRoot `
    -ExpectedNode $resolvedNodePath `
    -ExpectedPort $Port

    # 注册已完成后释放启动器互斥锁，让新任务的 Run-App 取得该锁。
    $launcherLockStream.Dispose()
    $launcherLockStream = $null

    if (-not $DoNotStart) {
        $notBefore = (Get-Date).ToUniversalTime()
        Start-ScheduledTask -TaskName $TaskName -TaskPath "\"
        $processId = Wait-InstalledAppHealthy `
            -DeploymentRoot $safeRoot `
            -ApplicationTaskName $TaskName `
            -ExpectedNode $resolvedNodePath `
            -ExpectedEntryPoint $entryPoint `
            -ApplicationPort $Port `
            -NotBefore $notBefore `
            -TimeoutSeconds $StartupTimeoutSeconds
        Write-Host "应用已稳定健康；PID=$processId"
    }

    Write-Host "应用计划任务已安装或更新：$TaskName"
}
finally {
    if ($null -ne $launcherLockStream) {
        $launcherLockStream.Dispose()
    }
    if ($null -ne $updateLockStream) {
        $updateLockStream.Dispose()
    }
}
