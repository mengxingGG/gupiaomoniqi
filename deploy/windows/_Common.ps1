Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

function ConvertTo-NormalizedWindowsPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        throw "路径不能为空。"
    }

    if (
        $Path.StartsWith("\\?\", [StringComparison]::Ordinal) -or
        $Path.StartsWith("\\.\", [StringComparison]::Ordinal) -or
        $Path.StartsWith("\??\", [StringComparison]::Ordinal)
    ) {
        throw "拒绝使用 Windows 设备路径：$Path"
    }

    $fullPath = [System.IO.Path]::GetFullPath($Path).Replace(
        [System.IO.Path]::AltDirectorySeparatorChar,
        [System.IO.Path]::DirectorySeparatorChar
    )
    $pathRoot = [System.IO.Path]::GetPathRoot($fullPath)
    if ([string]::IsNullOrWhiteSpace($pathRoot)) {
        throw "路径缺少磁盘根目录：$Path"
    }

    # 8.3 短路径会让同一个目录产生两个字符串，进而绕过目录边界判断。
    # 部署脚本没有使用短路径的必要，因此直接拒绝这类高风险输入。
    $relativePart = $fullPath.Substring($pathRoot.Length)
    foreach (
        $segment in @(
            $relativePart.Split(
                [char[]]@(
                    [System.IO.Path]::DirectorySeparatorChar,
                    [System.IO.Path]::AltDirectorySeparatorChar
                ),
                [StringSplitOptions]::RemoveEmptyEntries
            )
        )
    ) {
        if ($segment -match "~[0-9]+(?:\.|$)") {
            throw "拒绝使用 Windows 8.3 短路径别名：$fullPath"
        }
    }

    if (
        [string]::Equals(
            $fullPath,
            $pathRoot,
            [StringComparison]::OrdinalIgnoreCase
        )
    ) {
        return $pathRoot
    }

    return $fullPath.TrimEnd(
        [char[]]@(
            [System.IO.Path]::DirectorySeparatorChar,
            [System.IO.Path]::AltDirectorySeparatorChar
        )
    )
}

function Assert-NoReparsePointInPathOrAncestors {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [string]$Description = "目标"
    )

    $currentPath = ConvertTo-NormalizedWindowsPath -Path $Path
    while ($true) {
        try {
            $attributes = [System.IO.File]::GetAttributes($currentPath)
            if (
                (
                    $attributes -band
                    [System.IO.FileAttributes]::ReparsePoint
                ) -ne 0
            ) {
                throw "${Description}路径或其祖先包含链接/目录联接：$currentPath"
            }
        }
        catch [System.IO.FileNotFoundException] {
            # 尚未创建的路径会继续检查最近的现有祖先。
        }
        catch [System.IO.DirectoryNotFoundException] {
            # 中间目录尚未创建时继续向上检查。
        }

        $pathRoot = ConvertTo-NormalizedWindowsPath -Path (
            [System.IO.Path]::GetPathRoot($currentPath)
        )
        if (
            [string]::Equals(
                $currentPath,
                $pathRoot,
                [StringComparison]::OrdinalIgnoreCase
            )
        ) {
            break
        }

        $parent = [System.IO.Directory]::GetParent($currentPath)
        if ($null -eq $parent) {
            break
        }
        $currentPath = ConvertTo-NormalizedWindowsPath -Path $parent.FullName
    }
}

function Assert-WindowsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    $isAdministrator = $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator
    )

    if (-not $isAdministrator) {
        throw "此操作必须在管理员 Windows PowerShell 中执行。"
    }
}

function Assert-SafeDeploymentRoot {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root
    )

    if ([string]::IsNullOrWhiteSpace($Root)) {
        throw "部署根目录不能为空。"
    }

    $fullPath = ConvertTo-NormalizedWindowsPath -Path $Root
    $driveRoot = [System.IO.Path]::GetPathRoot($fullPath)
    if (
        [string]::Equals(
            $fullPath.TrimEnd("\"),
            $driveRoot.TrimEnd("\"),
            [StringComparison]::OrdinalIgnoreCase
        )
    ) {
        throw "拒绝将磁盘根目录用作部署目录：$fullPath"
    }

    Assert-NoReparsePointInPathOrAncestors `
        -Path $fullPath `
        -Description "部署根目录"
    return $fullPath
}

function Ensure-Directory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $fullPath = ConvertTo-NormalizedWindowsPath -Path $Path
    Assert-NoReparsePointInPathOrAncestors `
        -Path $fullPath `
        -Description "目录"

    if (Test-Path -LiteralPath $fullPath) {
        if (-not (Test-Path -LiteralPath $fullPath -PathType Container)) {
            throw "目标已存在但不是目录：$fullPath"
        }
    }
    else {
        New-Item -ItemType Directory -Path $fullPath -Force | Out-Null
    }

    Assert-NoReparsePointInPathOrAncestors `
        -Path $fullPath `
        -Description "目录"
}

function Normalize-ProcessPathEnvironment {
    $pathValue = [Environment]::GetEnvironmentVariable(
        "Path",
        "Process"
    )
    if ([string]::IsNullOrWhiteSpace($pathValue)) {
        $pathValue = [Environment]::GetEnvironmentVariable(
            "PATH",
            "Process"
        )
    }

    # 某些 SSH/开发环境同时注入 Path 与 PATH，Windows PowerShell 5.1 的
    # Start-Process 会因此在构造环境字典时失败。这里只规范当前脚本进程。
    [Environment]::SetEnvironmentVariable("PATH", $null, "Process")
    [Environment]::SetEnvironmentVariable("Path", $pathValue, "Process")
}

function New-TraceLogSet {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root,

        [Parameter(Mandatory = $true)]
        [ValidatePattern("^[a-zA-Z0-9_-]+$")]
        [string]$Name,

        [ValidateRange(2, 100)]
        [int]$RetentionCount = 14
    )

    $safeRoot = Assert-SafeDeploymentRoot -Root $Root
    $logDirectory = Join-Path $safeRoot "logs\$Name"
    Ensure-Directory -Path $logDirectory
    Assert-NoReparsePointInPathOrAncestors `
        -Path $logDirectory `
        -Description "日志目录"

    $timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss-fff")
    $stdoutPath = Join-Path $logDirectory "$Name-$timestamp.stdout.log"
    $stderrPath = Join-Path $logDirectory "$Name-$timestamp.stderr.log"
    $launcherPath = Join-Path $logDirectory "$Name-$timestamp.launcher.log"

    New-Item -ItemType File -Path $stdoutPath -Force | Out-Null
    New-Item -ItemType File -Path $stderrPath -Force | Out-Null
    New-Item -ItemType File -Path $launcherPath -Force | Out-Null

    foreach ($stream in @("stdout", "stderr", "launcher")) {
        $pattern = "$Name-*.$stream.log"
        $oldLogs = @(
            Get-ChildItem -LiteralPath $logDirectory -Filter $pattern -File |
                Sort-Object LastWriteTimeUtc -Descending |
                Select-Object -Skip $RetentionCount
        )

        foreach ($oldLog in $oldLogs) {
            Assert-NoReparsePointInPathOrAncestors `
                -Path $oldLog.FullName `
                -Description "旧日志"
            Remove-Item -LiteralPath $oldLog.FullName -Force
        }
    }

    return [pscustomobject]@{
        Directory = $logDirectory
        Stdout = $stdoutPath
        Stderr = $stderrPath
        Launcher = $launcherPath
    }
}

function Write-LauncherLog {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    $timestamp = (Get-Date).ToUniversalTime().ToString("o")
    $line = "[$timestamp] $Message"
    Add-Content -LiteralPath $Path -Value $line -Encoding UTF8
    Write-Host $line
}

function Write-AtomicText {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$Value
    )

    $parent = Split-Path -Parent $Path
    Ensure-Directory -Path $parent

    $temporaryPath = "$Path.$([Guid]::NewGuid().ToString('N')).tmp"
    try {
        [System.IO.File]::WriteAllText(
            $temporaryPath,
            $Value,
            (New-Object System.Text.UTF8Encoding($false))
        )
        Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
    }
    finally {
        if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
}

function Write-AtomicJson {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [object]$Value
    )

    $json = $Value | ConvertTo-Json -Depth 8
    Write-AtomicText -Path $Path -Value $json
}

function Resolve-NodeExecutable {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root,

        [string]$NodePath
    )

    $safeRoot = Assert-SafeDeploymentRoot -Root $Root
    $candidates = New-Object System.Collections.Generic.List[string]

    if (-not [string]::IsNullOrWhiteSpace($NodePath)) {
        $candidates.Add($NodePath)
    }

    $candidates.Add((Join-Path $safeRoot "tools\node\node.exe"))
    $candidates.Add((Join-Path $safeRoot "tools\node.exe"))

    if (-not [string]::IsNullOrWhiteSpace($env:ProgramFiles)) {
        $candidates.Add((Join-Path $env:ProgramFiles "nodejs\node.exe"))
    }

    $programFilesX86 = [Environment]::GetEnvironmentVariable(
        "ProgramFiles(x86)",
        "Process"
    )
    if (-not [string]::IsNullOrWhiteSpace($programFilesX86)) {
        $candidates.Add((Join-Path $programFilesX86 "nodejs\node.exe"))
    }

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    $nodeCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue
    if ($null -ne $nodeCommand) {
        return $nodeCommand.Source
    }

    throw "未找到 node.exe。请安装 Node.js 22，或用 -NodePath 指定可执行文件。"
}

function Test-Python3Executable {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [ValidateRange(1, 30)]
        [int]$TimeoutSeconds = 5
    )

    if (
        [string]::IsNullOrWhiteSpace($Path) -or
        -not (Test-Path -LiteralPath $Path -PathType Leaf)
    ) {
        return $null
    }

    $resolvedPath = (Resolve-Path -LiteralPath $Path).Path
    if ([System.IO.Path]::GetExtension($resolvedPath) -ne ".exe") {
        return $null
    }

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $resolvedPath
    $startInfo.Arguments = (
        '-c "import sys; print(sys.executable); ' +
        'raise SystemExit(0 if sys.version_info[0] == 3 else 7)"'
    )
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    try {
        if (-not $process.Start()) {
            return $null
        }

        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            try {
                $process.Kill()
                $process.WaitForExit()
            }
            catch {
                # 验证超时后尽力终止探测进程，不影响应用部署。
            }
            return $null
        }

        $stdout = $process.StandardOutput.ReadToEnd().Trim()
        if ($process.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($stdout)) {
            return $null
        }

        return $resolvedPath
    }
    catch {
        return $null
    }
    finally {
        $process.Dispose()
    }
}

function Resolve-OptionalPythonExecutable {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root,

        [string]$PythonPath
    )

    $safeRoot = Assert-SafeDeploymentRoot -Root $Root
    $candidates = New-Object System.Collections.Generic.List[string]

    if (-not [string]::IsNullOrWhiteSpace($PythonPath)) {
        $candidates.Add($PythonPath)
    }

    $candidates.Add((Join-Path $safeRoot "tools\python\python.exe"))
    $candidates.Add((Join-Path $safeRoot "tools\python.exe"))

    if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        $localPythonRoot = Join-Path $env:LOCALAPPDATA "Programs\Python"
        if (Test-Path -LiteralPath $localPythonRoot -PathType Container) {
            $localInstallations = @(
                Get-ChildItem `
                    -LiteralPath $localPythonRoot `
                    -Directory `
                    -ErrorAction SilentlyContinue |
                    Where-Object { $_.Name -like "Python*" } |
                    Sort-Object Name -Descending
            )
            foreach ($installation in $localInstallations) {
                $candidates.Add((Join-Path $installation.FullName "python.exe"))
            }
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($env:ProgramFiles)) {
        $systemInstallations = @(
            Get-ChildItem `
                -Path (Join-Path $env:ProgramFiles "Python*") `
                -Directory `
                -ErrorAction SilentlyContinue |
                Sort-Object Name -Descending
        )
        foreach ($installation in $systemInstallations) {
            $candidates.Add((Join-Path $installation.FullName "python.exe"))
        }
    }

    $pythonCommand = Get-Command `
        python.exe `
        -CommandType Application `
        -ErrorAction SilentlyContinue
    if (
        $null -ne $pythonCommand -and
        $pythonCommand.Source -notlike "*\WindowsApps\*"
    ) {
        $candidates.Add($pythonCommand.Source)
    }

    $seen = @{}
    foreach ($candidate in $candidates) {
        if ([string]::IsNullOrWhiteSpace($candidate)) {
            continue
        }

        $key = $candidate.ToLowerInvariant()
        if ($seen.ContainsKey($key)) {
            continue
        }
        $seen[$key] = $true

        $validated = Test-Python3Executable -Path $candidate
        if ($null -ne $validated) {
            return $validated
        }
    }

    return $null
}

function Resolve-CloudflaredExecutable {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root,

        [string]$CloudflaredPath
    )

    $safeRoot = Assert-SafeDeploymentRoot -Root $Root
    $candidates = New-Object System.Collections.Generic.List[string]

    if (-not [string]::IsNullOrWhiteSpace($CloudflaredPath)) {
        $candidates.Add($CloudflaredPath)
    }
    $candidates.Add((Join-Path $safeRoot "tools\cloudflared.exe"))

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    $cloudflaredCommand = Get-Command cloudflared.exe -CommandType Application -ErrorAction SilentlyContinue
    if ($null -ne $cloudflaredCommand) {
        return $cloudflaredCommand.Source
    }

    throw "未找到 cloudflared.exe。请先运行 Install-Cloudflared.ps1。"
}

function Get-WindowsPowerShellPath {
    $path = Join-Path $env:SystemRoot (
        "System32\WindowsPowerShell\v1.0\powershell.exe"
    )
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "未找到 Windows PowerShell：$path"
    }
    return $path
}

function ConvertTo-TaskQuotedArgument {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Value
    )

    if ($Value.Contains('"')) {
        throw "计划任务参数不能包含双引号：$Value"
    }

    return '"' + $Value + '"'
}

function New-GupiaomoniqiTaskSettings {
    return New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -MultipleInstances IgnoreNew `
        -RestartCount 999 `
        -RestartInterval (New-TimeSpan -Minutes 1) `
        -ExecutionTimeLimit ([TimeSpan]::Zero)
}

function Wait-ScheduledTaskNotRunning {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TaskName,

        [ValidateRange(1, 60)]
        [int]$TimeoutSeconds = 15
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $task = Get-ScheduledTask `
            -TaskName $TaskName `
            -ErrorAction SilentlyContinue
        if ($null -eq $task -or $task.State -ne "Running") {
            return
        }
        Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $deadline)

    throw "计划任务未能在 $TimeoutSeconds 秒内停止：$TaskName"
}

function Wait-HttpSuccess {
    param(
        [Parameter(Mandatory = $true)]
        [uri]$Uri,

        [ValidateRange(1, 3600)]
        [int]$TimeoutSeconds = 60,

        [ValidateRange(1, 30)]
        [int]$RequestTimeoutSeconds = 5
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try {
            $response = Invoke-WebRequest `
                -Uri $Uri `
                -UseBasicParsing `
                -TimeoutSec $RequestTimeoutSeconds
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
                return $true
            }
        }
        catch {
            # 启动窗口内失败是预期状态，直到总超时才由调用方报错。
        }

        Start-Sleep -Seconds 1
    } while ((Get-Date) -lt $deadline)

    return $false
}
