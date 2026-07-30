[CmdletBinding()]
param(
    [string]$Root = "C:\ProgramData\gupiaomoniqi",
    [string]$CloudflaredPath,
    [ValidatePattern("^[a-zA-Z0-9_.-]+$")]
    [string]$TaskName = "Gupiaomoniqi-Cloudflare-Quick-Tunnel",
    [uri]$OriginUrl = "http://127.0.0.1:3100",
    [ValidateRange(5, 600)]
    [int]$StartupTimeoutSeconds = 120,
    [switch]$DoNotStart,
    [switch]$PreserveRunningTunnel
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "_Common.ps1")

function Assert-SecureSystemExecutionPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$Description
    )

    $fullPath = ConvertTo-NormalizedWindowsPath -Path $Path
    Assert-NoReparsePointInPathOrAncestors `
        -Path $fullPath `
        -Description $Description

    $driveRoot = [System.IO.Path]::GetPathRoot($fullPath)
    $drive = New-Object System.IO.DriveInfo($driveRoot)
    if ($drive.DriveType -ne [System.IO.DriveType]::Fixed) {
        throw "$Description 必须位于本机固定磁盘：$fullPath"
    }

    $acl = Get-Acl -LiteralPath $fullPath
    try {
        $ownerSid = (
            (New-Object Security.Principal.NTAccount($acl.Owner)).Translate(
                [Security.Principal.SecurityIdentifier]
            )
        ).Value
    }
    catch {
        throw "$Description 的所有者无法解析：$($acl.Owner)"
    }

    $currentSid = (
        [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    )
    $trustedInstallerSid = (
        "S-1-5-80-956008885-3418522649-1831038044-" +
        "1853292631-2271478464"
    )
    $trustedOwner = (
        @(
            "S-1-5-18",
            "S-1-5-32-544",
            $trustedInstallerSid,
            $currentSid
        ) -contains $ownerSid
    )
    if (-not $trustedOwner) {
        throw (
            "{0} 的所有者不是 SYSTEM、Administrators、当前管理员或受信任" +
            "服务：{1}" -f $Description, $acl.Owner
        )
    }

    $writeMask = (
        [Security.AccessControl.FileSystemRights]::Write -bor
        [Security.AccessControl.FileSystemRights]::Modify -bor
        [Security.AccessControl.FileSystemRights]::FullControl -bor
        [Security.AccessControl.FileSystemRights]::ChangePermissions -bor
        [Security.AccessControl.FileSystemRights]::TakeOwnership
    )
    foreach ($rule in $acl.Access) {
        if (
            $rule.AccessControlType -ne
                [Security.AccessControl.AccessControlType]::Allow -or
            (
                $rule.FileSystemRights -band $writeMask
            ) -eq 0
        ) {
            continue
        }

        try {
            $ruleSid = $rule.IdentityReference.Translate(
                [Security.Principal.SecurityIdentifier]
            ).Value
        }
        catch {
            throw (
                "$Description 含无法解析的写权限主体：" +
                $rule.IdentityReference
            )
        }
        $trustedWriter = (
            @(
                "S-1-5-18",
                "S-1-5-32-544",
                "S-1-3-0",
                $trustedInstallerSid,
                $currentSid,
                $ownerSid
            ) -contains $ruleSid
        )
        if (-not $trustedWriter) {
            throw (
                "{0} 允许非受信任主体写入，拒绝交给 SYSTEM 执行：{1} ({2})" -f
                    $Description,
                    $rule.IdentityReference,
                    $rule.FileSystemRights
            )
        }
    }
}

function Set-SecureSystemExecutionAcl {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $fullPath = ConvertTo-NormalizedWindowsPath -Path $Path
    $item = Get-Item -LiteralPath $fullPath -Force
    $isDirectory = $item.PSIsContainer
    $inheritanceFlags = if ($isDirectory) {
        (
            [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
            [Security.AccessControl.InheritanceFlags]::ObjectInherit
        )
    }
    else {
        [Security.AccessControl.InheritanceFlags]::None
    }

    $acl = Get-Acl -LiteralPath $fullPath
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($existingRule in @($acl.Access)) {
        $null = $acl.RemoveAccessRuleSpecific($existingRule)
    }
    $administrators = New-Object Security.Principal.SecurityIdentifier(
        "S-1-5-32-544"
    )
    $system = New-Object Security.Principal.SecurityIdentifier(
        "S-1-5-18"
    )
    $users = New-Object Security.Principal.SecurityIdentifier(
        "S-1-5-32-545"
    )
    $acl.SetOwner($administrators)
    foreach ($identity in @($administrators, $system)) {
        $acl.AddAccessRule((
            New-Object Security.AccessControl.FileSystemAccessRule(
                $identity,
                [Security.AccessControl.FileSystemRights]::FullControl,
                $inheritanceFlags,
                [Security.AccessControl.PropagationFlags]::None,
                [Security.AccessControl.AccessControlType]::Allow
            )
        ))
    }
    $acl.AddAccessRule((
        New-Object Security.AccessControl.FileSystemAccessRule(
            $users,
            [Security.AccessControl.FileSystemRights]::ReadAndExecute,
            $inheritanceFlags,
            [Security.AccessControl.PropagationFlags]::None,
            [Security.AccessControl.AccessControlType]::Allow
        )
    ))
    Set-Acl -LiteralPath $fullPath -AclObject $acl
}

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

function Get-TaskPropertyValue {
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

function Test-TaskDuration {
    param(
        [object]$Value,

        [Parameter(Mandatory = $true)]
        [TimeSpan]$Expected
    )

    if ($null -eq $Value) {
        return $false
    }
    if ($Value -is [TimeSpan]) {
        return ([TimeSpan]$Value) -eq $Expected
    }

    try {
        return [System.Xml.XmlConvert]::ToTimeSpan(
            [string]$Value
        ) -eq $Expected
    }
    catch {
        try {
            return [TimeSpan]::Parse([string]$Value) -eq $Expected
        }
        catch {
            return $false
        }
    }
}

function Test-AtStartupTrigger {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Trigger
    )

    $triggerEnabled = Get-TaskPropertyValue `
        -Value $Trigger `
        -Name "Enabled"
    if ($null -eq $triggerEnabled -or -not [bool]$triggerEnabled) {
        return $false
    }

    $cimClass = Get-TaskPropertyValue -Value $Trigger -Name "CimClass"
    $cimClassName = [string](
        Get-TaskPropertyValue -Value $cimClass -Name "CimClassName"
    )
    if ($cimClassName -eq "MSFT_TaskBootTrigger") {
        return $true
    }

    # 供隔离合成测试使用；真实 ScheduledTasks 对象走上面的 CIM 类型。
    return (
        [string](
            Get-TaskPropertyValue -Value $Trigger -Name "Kind"
        ) -eq "Boot" -and
        [bool](
            Get-TaskPropertyValue -Value $Trigger -Name "AtStartup"
        )
    )
}

function Test-TaskArgumentsTargetDeployment {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Task,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedRunner,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedRoot
    )

    $actions = @($Task.Actions)
    foreach ($action in $actions) {
        $arguments = [string]$action.Arguments
        $matchesDeployment = $true
        foreach ($requiredFragment in @(
            ('-File "{0}"' -f $ExpectedRunner),
            ('-Root "{0}"' -f $ExpectedRoot)
        )) {
            if ($arguments.IndexOf(
                $requiredFragment,
                [StringComparison]::OrdinalIgnoreCase
            ) -lt 0) {
                $matchesDeployment = $false
                break
            }
        }
        if ($matchesDeployment) {
            return $true
        }
    }
    return $false
}

function Assert-TunnelTaskOwnership {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Task,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedRunner,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedRoot
    )

    $actions = @($Task.Actions)
    if ($actions.Count -ne 1) {
        throw "同名计划任务不是本隧道的单动作任务，拒绝覆盖：$($Task.TaskName)"
    }
    if (-not (Test-SameInstallPath `
        -Left ([string]$actions[0].Execute) `
        -Right (Get-WindowsPowerShellPath))
    ) {
        throw "同名计划任务的启动程序不属于本隧道，拒绝覆盖。"
    }
    if (-not (Test-TaskArgumentsTargetDeployment `
        -Task $Task `
        -ExpectedRunner $ExpectedRunner `
        -ExpectedRoot $ExpectedRoot)
    ) {
        throw "同名计划任务未绑定当前部署根目录，拒绝覆盖。"
    }
}

function Test-CurrentTunnelTaskDefinition {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Task,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedPowerShell,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedArguments,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedDescription
    )

    $actions = @($Task.Actions)
    if ($actions.Count -ne 1) {
        return $false
    }
    if (-not (Test-SameInstallPath `
        -Left ([string]$actions[0].Execute) `
        -Right $ExpectedPowerShell)
    ) {
        return $false
    }
    if (-not [string]::Equals(
        [string]$actions[0].Arguments,
        $ExpectedArguments,
        [StringComparison]::Ordinal
    )) {
        return $false
    }
    if (-not [string]::Equals(
        [string]$Task.Description,
        $ExpectedDescription,
        [StringComparison]::Ordinal
    )) {
        return $false
    }

    if ([string]$Task.State -eq "Disabled") {
        return $false
    }

    $principal = Get-TaskPropertyValue -Value $Task -Name "Principal"
    $principalUser = [string](
        Get-TaskPropertyValue -Value $principal -Name "UserId"
    )
    if (@("SYSTEM", "S-1-5-18") -notcontains $principalUser) {
        return $false
    }
    if (
        [string](
            Get-TaskPropertyValue -Value $principal -Name "LogonType"
        ) -ne "ServiceAccount" -or
        [string](
            Get-TaskPropertyValue -Value $principal -Name "RunLevel"
        ) -ne "Highest"
    ) {
        return $false
    }

    $triggers = @(
        Get-TaskPropertyValue -Value $Task -Name "Triggers"
    )
    if (
        $triggers.Count -ne 1 -or
        -not (Test-AtStartupTrigger -Trigger $triggers[0])
    ) {
        return $false
    }

    $settings = Get-TaskPropertyValue -Value $Task -Name "Settings"
    if (
        $null -eq $settings -or
        -not [bool](
            Get-TaskPropertyValue -Value $settings -Name "Enabled"
        ) -or
        -not [bool](
            Get-TaskPropertyValue `
                -Value $settings `
                -Name "StartWhenAvailable"
        ) -or
        $null -eq (
            Get-TaskPropertyValue `
                -Value $settings `
                -Name "DisallowStartIfOnBatteries"
        ) -or
        [bool](
            Get-TaskPropertyValue `
                -Value $settings `
                -Name "DisallowStartIfOnBatteries"
        ) -or
        $null -eq (
            Get-TaskPropertyValue `
                -Value $settings `
                -Name "StopIfGoingOnBatteries"
        ) -or
        [bool](
            Get-TaskPropertyValue `
                -Value $settings `
                -Name "StopIfGoingOnBatteries"
        ) -or
        [string](
            Get-TaskPropertyValue `
                -Value $settings `
                -Name "MultipleInstances"
        ) -ne "IgnoreNew" -or
        [int](
            Get-TaskPropertyValue -Value $settings -Name "RestartCount"
        ) -ne 999 -or
        -not (Test-TaskDuration `
            -Value (
                Get-TaskPropertyValue `
                    -Value $settings `
                    -Name "RestartInterval"
            ) `
            -Expected (New-TimeSpan -Minutes 1)) -or
        -not (Test-TaskDuration `
            -Value (
                Get-TaskPropertyValue `
                    -Value $settings `
                    -Name "ExecutionTimeLimit"
            ) `
            -Expected ([TimeSpan]::Zero))
    ) {
        return $false
    }

    return $true
}

function Get-InstalledTaskByName {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $matchingTasks = @(
        Get-ScheduledTask `
            -TaskName $Name `
            -ErrorAction SilentlyContinue
    )
    if ($matchingTasks.Count -gt 1) {
        throw "发现多个同名计划任务，拒绝模糊更新：$Name"
    }
    if ($matchingTasks.Count -eq 0) {
        return $null
    }

    $taskPath = [string]$matchingTasks[0].TaskPath
    if (
        -not [string]::IsNullOrWhiteSpace($taskPath) -and
        $taskPath -ne "\"
    ) {
        throw "同名计划任务位于非根任务目录，拒绝覆盖：$taskPath$Name"
    }
    return $matchingTasks[0]
}

function Get-VerifiedTunnelProcessSnapshot {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DeploymentRoot
    )

    $latestPath = Join-Path `
        $DeploymentRoot `
        "runtime\cloudflared-latest.json"
    if (-not (Test-Path -LiteralPath $latestPath -PathType Leaf)) {
        return $null
    }

    try {
        $state = Get-Content `
            -LiteralPath $latestPath `
            -Raw `
            -Encoding UTF8 | ConvertFrom-Json
    }
    catch {
        throw "无法解析现有隧道状态，拒绝盲目替换任务：$($_.Exception.Message)"
    }

    $processId = [int](
        Get-TaskPropertyValue -Value $state -Name "processId"
    )
    if ($processId -le 0) {
        return $null
    }
    try {
        $process = [System.Diagnostics.Process]::GetProcessById($processId)
    }
    catch [System.ArgumentException] {
        return $null
    }

    try {
        $process.Refresh()
        if ($process.HasExited) {
            $process.Dispose()
            return $null
        }

        $actualExecutable = $process.MainModule.FileName
        $stateExecutable = [string](
            Get-TaskPropertyValue `
                -Value $state `
                -Name "executablePath"
        )
        if (
            -not [string]::IsNullOrWhiteSpace($stateExecutable) -and
            -not (Test-SameInstallPath `
                -Left $stateExecutable `
                -Right $actualExecutable)
        ) {
            throw "状态文件中的 PID 可执行路径不匹配"
        }

        $recordedStartValue = Get-TaskPropertyValue `
            -Value $state `
            -Name "processStartedAt"
        if ($null -eq $recordedStartValue) {
            $recordedStartValue = Get-TaskPropertyValue `
                -Value $state `
                -Name "startedAt"
        }
        $recordedStart = [DateTime]::Parse(
            [string]$recordedStartValue
        ).ToUniversalTime()
        if ([Math]::Abs(
            (
                $recordedStart -
                $process.StartTime.ToUniversalTime()
            ).TotalSeconds
        ) -gt 10) {
            throw "状态文件中的 PID 启动时间不匹配"
        }

        Assert-NoReparsePointInPathOrAncestors `
            -Path $actualExecutable `
            -Description "现有 cloudflared 可执行文件"
        return [pscustomobject]@{
            Process = $process
            ExecutablePath = $actualExecutable
            OriginUrl = [string](
                Get-TaskPropertyValue -Value $state -Name "originUrl"
            )
        }
    }
    catch {
        $process.Dispose()
        throw (
            "发现状态中的 PID 仍存活但无法验证为受控 cloudflared；" +
            "为避免双隧道，拒绝继续。{0}" -f $_.Exception.Message
        )
    }
}

function Wait-QuickTunnelUrl {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DeploymentRoot,

        [Parameter(Mandatory = $true)]
        [string]$TunnelTaskName,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedCloudflared,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedOriginUrl,

        [DateTime]$NotBefore = [DateTime]::MinValue,

        [Parameter(Mandatory = $true)]
        [int]$TimeoutSeconds
    )

    $urlPath = Join-Path `
        $DeploymentRoot `
        "runtime\cloudflare-quick-url.txt"
    $latestPath = Join-Path `
        $DeploymentRoot `
        "runtime\cloudflared-latest.json"
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $lastState = "尚无状态文件"
    $lastTaskState = "Missing"

    do {
        $state = $null
        $task = Get-InstalledTaskByName -Name $TunnelTaskName
        if ($null -ne $task) {
            $lastTaskState = [string]$task.State
        }

        if (Test-Path -LiteralPath $latestPath -PathType Leaf) {
            try {
                $state = Get-Content `
                    -LiteralPath $latestPath `
                    -Raw `
                    -Encoding UTF8 | ConvertFrom-Json
                $lastState = [string]$state.status
            }
            catch {
                $lastState = "状态文件无法解析：$($_.Exception.Message)"
            }
        }

        if (
            $null -ne $task -and
            [string]$task.State -eq "Running" -and
            $null -ne $state -and
            [string](
                Get-TaskPropertyValue -Value $state -Name "status"
            ) -eq "running"
        ) {
            try {
                $stateUrl = [string](
                    Get-TaskPropertyValue `
                        -Value $state `
                        -Name "quickTunnelUrl"
                )
                if ($stateUrl -notmatch (
                    "^https://[a-zA-Z0-9-]+\.trycloudflare\.com/?$"
                )) {
                    throw "状态中的 URL 无效"
                }
                if (-not (Test-Path -LiteralPath $urlPath -PathType Leaf)) {
                    throw "URL 文件不存在"
                }
                $urlContent = Get-Content `
                    -LiteralPath $urlPath `
                    -Raw `
                    -Encoding UTF8
                $fileUrl = ([string]$urlContent).Trim().TrimEnd("/")
                $stateUrl = $stateUrl.TrimEnd("/")
                if (-not [string]::Equals(
                    $fileUrl,
                    $stateUrl,
                    [StringComparison]::OrdinalIgnoreCase
                )) {
                    throw "URL 文件与运行状态不属于同一代进程"
                }

                $stateOrigin = [string](
                    Get-TaskPropertyValue `
                        -Value $state `
                        -Name "originUrl"
                )
                if (-not [string]::Equals(
                    $stateOrigin,
                    $ExpectedOriginUrl,
                    [StringComparison]::Ordinal
                )) {
                    throw "状态中的 Origin 与当前任务不一致"
                }
                $stateExecutable = [string](
                    Get-TaskPropertyValue `
                        -Value $state `
                        -Name "executablePath"
                )
                if (-not (Test-SameInstallPath `
                    -Left $stateExecutable `
                    -Right $ExpectedCloudflared)
                ) {
                    throw "状态中的可执行文件与当前任务不一致"
                }

                $updatedAt = [DateTime]::Parse(
                    [string](
                        Get-TaskPropertyValue `
                            -Value $state `
                            -Name "updatedAt"
                    )
                ).ToUniversalTime()
                if (
                    $NotBefore -ne [DateTime]::MinValue -and
                    $updatedAt -lt $NotBefore.AddSeconds(-2)
                ) {
                    throw "状态文件仍属于启动前实例"
                }

                $processId = [int](
                    Get-TaskPropertyValue `
                        -Value $state `
                        -Name "processId"
                )
                if ($processId -le 0) {
                    throw "状态中没有有效的 cloudflared PID"
                }
                $process = [System.Diagnostics.Process]::GetProcessById(
                    $processId
                )
                try {
                    $process.Refresh()
                    if (
                        $process.HasExited -or
                        -not (Test-SameInstallPath `
                            -Left $process.MainModule.FileName `
                            -Right $ExpectedCloudflared)
                    ) {
                        throw "状态中的 PID 不属于当前 cloudflared"
                    }
                    $recordedProcessStart = [DateTime]::Parse(
                        [string](
                            Get-TaskPropertyValue `
                                -Value $state `
                                -Name "processStartedAt"
                        )
                    ).ToUniversalTime()
                    if ([Math]::Abs(
                        (
                            $recordedProcessStart -
                            $process.StartTime.ToUniversalTime()
                        ).TotalSeconds
                    ) -gt 5) {
                        throw "状态中的 PID 启动时间不匹配"
                    }
                }
                finally {
                    $process.Dispose()
                }

                return $stateUrl
            }
            catch {
                $lastState = (
                    "{0}；尚未通过进程代际校验：{1}" -f
                        $lastState,
                        $_.Exception.Message
                )
            }
        }

        Start-Sleep -Seconds 1
    } while ((Get-Date) -lt $deadline)

    throw (
        "隧道任务在 {0} 秒内尚未生成临时域名；任务状态={1}；" +
        "运行状态={2}。任务会继续在后台连接，且不会因本地后端未启动而退出。" +
        "状态文件：{3}" -f
            $TimeoutSeconds,
            $lastTaskState,
            $lastState,
            $latestPath
    )
}

if (
    -not $OriginUrl.IsAbsoluteUri -or
    @("http", "https") -notcontains $OriginUrl.Scheme.ToLowerInvariant()
) {
    throw "OriginUrl 必须是绝对 HTTP 或 HTTPS 地址：$OriginUrl"
}

Assert-WindowsAdministrator
$assertedRoot = Assert-SafeDeploymentRoot -Root $Root
if (
    [System.IO.Path]::GetFullPath($assertedRoot).StartsWith(
        "\\",
        [StringComparison]::Ordinal
    )
) {
    throw "部署根目录不允许使用 UNC/网络路径。"
}
$safeRoot = Get-CanonicalInstallPath -Path $assertedRoot
$runnerPath = Join-Path `
    $safeRoot `
    "current\deploy\windows\Run-QuickTunnel.ps1"
if (-not (Test-Path -LiteralPath $runnerPath -PathType Leaf)) {
    throw "无法安装任务，受控隧道启动脚本不存在：$runnerPath"
}
$runnerPath = (Resolve-Path -LiteralPath $runnerPath).Path
Assert-NoReparsePointInPathOrAncestors `
    -Path $runnerPath `
    -Description "隧道启动脚本"
$runnerCommonPath = Join-Path `
    (Split-Path -Parent $runnerPath) `
    "_Common.ps1"
if (-not (Test-Path -LiteralPath $runnerCommonPath -PathType Leaf)) {
    throw "无法安装任务，共享启动库不存在：$runnerCommonPath"
}

$resolvedCloudflaredPath = Resolve-CloudflaredExecutable `
    -Root $safeRoot `
    -CloudflaredPath $CloudflaredPath
Assert-NoReparsePointInPathOrAncestors `
    -Path $resolvedCloudflaredPath `
    -Description "cloudflared 可执行文件"
if (
    [System.IO.Path]::GetExtension($resolvedCloudflaredPath) -ne ".exe"
) {
    throw "cloudflared 必须是本机 .exe 可执行文件：$resolvedCloudflaredPath"
}
if (
    [System.IO.Path]::GetFullPath($resolvedCloudflaredPath).StartsWith(
        "\\",
        [StringComparison]::Ordinal
    )
) {
    throw "cloudflared 不允许来自 UNC/网络路径。"
}

$securePaths = @(
    [pscustomobject]@{
        Path = $safeRoot
        Description = "部署根目录"
    },
    [pscustomobject]@{
        Path = (Join-Path $safeRoot "current")
        Description = "current 目录"
    },
    [pscustomobject]@{
        Path = (Join-Path $safeRoot "current\deploy")
        Description = "部署脚本目录"
    },
    [pscustomobject]@{
        Path = (Split-Path -Parent $runnerPath)
        Description = "Windows 启动脚本目录"
    },
    [pscustomobject]@{
        Path = $runnerPath
        Description = "隧道启动脚本"
    },
    [pscustomobject]@{
        Path = $runnerCommonPath
        Description = "共享启动库"
    },
    [pscustomobject]@{
        Path = (Split-Path -Parent $resolvedCloudflaredPath)
        Description = "cloudflared 目录"
    },
    [pscustomobject]@{
        Path = $resolvedCloudflaredPath
        Description = "cloudflared 可执行文件"
    }
)

# ProgramData 默认可能继承 Users 写权限。安装器只修改当前部署根目录
# 内、明确列出的执行路径；外部 cloudflared 安装目录只校验、不改 ACL。
$deploymentPrefix = $safeRoot.TrimEnd("\") + "\"
$hardenedPaths = @{}
foreach ($securePath in $securePaths) {
    $normalizedSecurePath = ConvertTo-NormalizedWindowsPath `
        -Path $securePath.Path
    $isDeploymentOwnedPath = (
        [string]::Equals(
            $normalizedSecurePath,
            $safeRoot,
            [StringComparison]::OrdinalIgnoreCase
        ) -or
        $normalizedSecurePath.StartsWith(
            $deploymentPrefix,
            [StringComparison]::OrdinalIgnoreCase
        )
    )
    $pathKey = $normalizedSecurePath.ToUpperInvariant()
    if (
        $isDeploymentOwnedPath -and
        -not $hardenedPaths.ContainsKey($pathKey)
    ) {
        Set-SecureSystemExecutionAcl -Path $normalizedSecurePath
        $hardenedPaths[$pathKey] = $true
    }
}

foreach ($securePath in $securePaths) {
    Assert-SecureSystemExecutionPath `
        -Path $securePath.Path `
        -Description $securePath.Description
}

foreach ($path in @(
    (Join-Path $safeRoot "logs"),
    (Join-Path $safeRoot "runtime")
)) {
    Ensure-Directory -Path $path
}

$powerShellPath = Get-WindowsPowerShellPath
$argumentParts = @(
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-File", (ConvertTo-TaskQuotedArgument -Value $runnerPath),
    "-Root", (ConvertTo-TaskQuotedArgument -Value $safeRoot),
    "-CloudflaredPath", (
        ConvertTo-TaskQuotedArgument -Value $resolvedCloudflaredPath
    ),
    "-OriginUrl", (
        ConvertTo-TaskQuotedArgument -Value $OriginUrl.AbsoluteUri
    )
)
$arguments = $argumentParts -join " "
$taskDescription = (
    "GUPIAOMONIQI_TUNNEL_KEEPALIVE_V2 | " +
    "独立 Cloudflare Quick Tunnel 常驻任务（仅出站连接）"
)

$existingTask = Get-InstalledTaskByName -Name $TaskName
if ($null -ne $existingTask) {
    Assert-TunnelTaskOwnership `
        -Task $existingTask `
        -ExpectedRunner $runnerPath `
        -ExpectedRoot $safeRoot
}

$allTasks = @(Get-ScheduledTask -ErrorAction SilentlyContinue)
foreach ($candidateTask in $allTasks) {
    $sameTask = (
        [string]::Equals(
            [string]$candidateTask.TaskName,
            $TaskName,
            [StringComparison]::OrdinalIgnoreCase
        ) -and
        (
            [string]::IsNullOrWhiteSpace(
                [string]$candidateTask.TaskPath
            ) -or
            [string]$candidateTask.TaskPath -eq "\"
        )
    )
    if ($sameTask) {
        continue
    }
    if (Test-TaskArgumentsTargetDeployment `
        -Task $candidateTask `
        -ExpectedRunner $runnerPath `
        -ExpectedRoot $safeRoot
    ) {
        throw (
            "当前部署已经绑定另一个隧道任务，拒绝重复安装：" +
            "$($candidateTask.TaskPath)$($candidateTask.TaskName)"
        )
    }
}

$definitionIsCurrent = (
    $null -ne $existingTask -and
    (Test-CurrentTunnelTaskDefinition `
        -Task $existingTask `
        -ExpectedPowerShell $powerShellPath `
        -ExpectedArguments $arguments `
        -ExpectedDescription $taskDescription)
)

if (
    $PreserveRunningTunnel -and
    $null -ne $existingTask -and
    [string]$existingTask.State -eq "Running"
) {
    $runningTunnel = Get-VerifiedTunnelProcessSnapshot `
        -DeploymentRoot $safeRoot
    if ($null -eq $runningTunnel) {
        throw (
            "隧道任务正在运行，但尚不能验证其 cloudflared 进程；" +
            "保活入口不会重启或替换现有任务。请稍后重试并检查运行日志。"
        )
    }

    try {
        if (
            -not (Test-SameInstallPath `
                -Left $runningTunnel.ExecutablePath `
                -Right $resolvedCloudflaredPath) -or
            -not [string]::Equals(
                $runningTunnel.OriginUrl,
                $OriginUrl.AbsoluteUri,
                [StringComparison]::Ordinal
            )
        ) {
            throw (
                "运行中的隧道参数与当前请求不同；保活入口不会中断现有域名。" +
                "如需改参数，请另行安排隧道维护窗口。"
            )
        }
    }
    finally {
        $runningTunnel.Process.Dispose()
    }

    $quickTunnelUrl = Wait-QuickTunnelUrl `
        -DeploymentRoot $safeRoot `
        -TunnelTaskName $TaskName `
        -ExpectedCloudflared $resolvedCloudflaredPath `
        -ExpectedOriginUrl $OriginUrl.AbsoluteUri `
        -TimeoutSeconds $StartupTimeoutSeconds
    Write-Host (
        "检测到现有隧道正在运行；保留原任务、原进程和当前域名，不重新注册。"
    )
    if (-not $definitionIsCurrent) {
        Write-Warning (
            "隧道任务定义存在漂移；为保留当前域名，本次未修改。" +
            "请另行安排隧道维护窗口后再更新任务定义。"
        )
    }
    Write-Host "Cloudflare 当前临时地址：$quickTunnelUrl"
    return
}

$reusedRunningTask = (
    $definitionIsCurrent -and
    [string]$existingTask.State -eq "Running"
)

if (-not $definitionIsCurrent) {
    # 无论旧任务当前是 Running、Ready 还是 Disabled，都先验证状态文件中
    # 可能遗留的进程。否则定义变更可能留下无人监管的第二条隧道。
    $previousTunnel = Get-VerifiedTunnelProcessSnapshot `
        -DeploymentRoot $safeRoot

    if (
        $null -ne $existingTask -and
        [string]$existingTask.State -eq "Running"
    ) {
        # 仅任务定义确实变化时停一次；同配置重复安装绝不打断当前域名。
        Stop-ScheduledTask -TaskName $TaskName
        Wait-ScheduledTaskNotRunning -TaskName $TaskName
    }

    if ($null -ne $previousTunnel) {
        try {
            $previousTunnel.Process.Refresh()
            if (-not $previousTunnel.Process.HasExited) {
                $canAdoptPreviousProcess = (
                    (Test-SameInstallPath `
                        -Left $previousTunnel.ExecutablePath `
                        -Right $resolvedCloudflaredPath) -and
                    [string]::Equals(
                        $previousTunnel.OriginUrl,
                        $OriginUrl.AbsoluteUri,
                        [StringComparison]::Ordinal
                    )
                )
                if (-not $canAdoptPreviousProcess) {
                    # 参数变化时不能让旧配置成为无人监管的第二条隧道。
                    $previousTunnel.Process.Kill()
                    if (-not $previousTunnel.Process.WaitForExit(10000)) {
                        throw (
                            "旧配置 cloudflared 未能在 10 秒内退出；" +
                            "拒绝启动新配置。PID={0}" -f
                                $previousTunnel.Process.Id
                        )
                    }
                    Write-Host (
                        "旧隧道配置进程已停止；PID={0}" -f
                            $previousTunnel.Process.Id
                    )
                }
            }
        }
        finally {
            $previousTunnel.Process.Dispose()
        }
    }

    $action = New-ScheduledTaskAction `
        -Execute $powerShellPath `
        -Argument $arguments
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
        -Description $taskDescription

    Register-ScheduledTask `
        -TaskName $TaskName `
        -TaskPath "\" `
        -InputObject $task `
        -Force | Out-Null

    $existingTask = Get-InstalledTaskByName -Name $TaskName
    Assert-TunnelTaskOwnership `
        -Task $existingTask `
        -ExpectedRunner $runnerPath `
        -ExpectedRoot $safeRoot
    if (-not (Test-CurrentTunnelTaskDefinition `
        -Task $existingTask `
        -ExpectedPowerShell $powerShellPath `
        -ExpectedArguments $arguments `
        -ExpectedDescription $taskDescription)
    ) {
        throw "计划任务注册后定义校验失败：$TaskName"
    }
    Write-Host "隧道计划任务已安装或更新：$TaskName"
}
elseif ($reusedRunningTask) {
    Write-Host (
        "隧道任务配置未变化；复用当前任务和 cloudflared 进程，不重新注册。"
    )
}
else {
    Write-Host "隧道任务配置未变化；复用已安装的任务定义。"
}

if (-not $DoNotStart) {
    $currentTask = Get-InstalledTaskByName -Name $TaskName
    $notBefore = [DateTime]::MinValue
    if ([string]$currentTask.State -ne "Running") {
        $notBefore = (Get-Date).ToUniversalTime()
        Start-ScheduledTask -TaskName $TaskName -TaskPath "\"
    }

    $quickTunnelUrl = Wait-QuickTunnelUrl `
        -DeploymentRoot $safeRoot `
        -TunnelTaskName $TaskName `
        -ExpectedCloudflared $resolvedCloudflaredPath `
        -ExpectedOriginUrl $OriginUrl.AbsoluteUri `
        -NotBefore $notBefore `
        -TimeoutSeconds $StartupTimeoutSeconds
    Write-Host "Cloudflare 当前临时地址：$quickTunnelUrl"
}

if ($DoNotStart) {
    Write-Host "隧道任务配置完成；按 -DoNotStart 要求未启动新的任务实例。"
}
