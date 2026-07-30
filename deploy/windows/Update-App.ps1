[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SourceDirectory,

    [string]$Root = "C:\ProgramData\gupiaomoniqi",

    [string]$TaskName = "Gupiaomoniqi-App",

    [string]$NodePath,

    [string]$PythonPath,

    [ValidateRange(1, 65535)]
    [int]$Port = 3100,

    [switch]$UseProcessLauncher,

    [switch]$DisableRealMarketSync,

    [switch]$DisableAiTrading,

    [ValidateRange(5, 600)]
    [int]$StartupTimeoutSeconds = 120,

    [ValidateRange(5, 180)]
    [int]$GracefulStopTimeoutSeconds = 45,

    [ValidateRange(1, 30)]
    [int]$PostStopQuiesceSeconds = 5,

    [switch]$AllowForcedStop,

    [ValidateRange(2, 100)]
    [int]$LogRetentionCount = 14
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

. (Join-Path $PSScriptRoot "_Common.ps1")

Normalize-ProcessPathEnvironment

function Get-NormalizedPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $pathRoot = [System.IO.Path]::GetPathRoot($fullPath)
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

function Get-CanonicalPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $fullPath = Get-NormalizedPath -Path $Path
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
            (Test-SamePath -Left $parent -Right $cursor)
        ) {
            throw "无法解析路径的现存祖先：$Path"
        }
        $cursor = $parent
    }

    # DirectoryInfo.FullName 会把 PROGRA~1 等 DOS 8.3 别名展开成长路径。
    # reparse/mount point 由调用方的路径链检查单独拒绝。
    $canonical = (Get-Item -LiteralPath $cursor -Force).FullName
    foreach ($segment in $missingSegments) {
        $canonical = Join-Path $canonical $segment
    }
    return Get-NormalizedPath -Path $canonical
}

function Assert-LocalFileSystemPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$Description
    )

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    if ($fullPath.StartsWith("\\", [StringComparison]::Ordinal)) {
        throw (
            "$Description 不允许使用 UNC/网络路径；PGlite 与同盘原子切换" +
            "必须位于本机固定磁盘：$fullPath"
        )
    }

    $pathRoot = [System.IO.Path]::GetPathRoot($fullPath)
    $drive = New-Object System.IO.DriveInfo($pathRoot)
    if ($drive.DriveType -ne [IO.DriveType]::Fixed) {
        throw (
            "$Description 必须位于本机固定磁盘，不能使用映射网络盘、" +
            "可移动盘或虚拟路径：$fullPath"
        )
    }
}

function Test-SamePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Left,

        [Parameter(Mandatory = $true)]
        [string]$Right
    )

    return [string]::Equals(
        (Get-NormalizedPath -Path $Left),
        (Get-NormalizedPath -Path $Right),
        [StringComparison]::OrdinalIgnoreCase
    )
}

function Test-PathInside {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$Parent
    )

    $candidate = Get-NormalizedPath -Path $Path
    $container = Get-NormalizedPath -Path $Parent
    return (
        (Test-SamePath -Left $candidate -Right $container) -or
        $candidate.StartsWith(
            "$container\",
            [StringComparison]::OrdinalIgnoreCase
        )
    )
}

function Test-PathsOverlap {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Left,

        [Parameter(Mandatory = $true)]
        [string]$Right
    )

    return (
        (Test-PathInside -Path $Left -Parent $Right) -or
        (Test-PathInside -Path $Right -Parent $Left)
    )
}

function Assert-NoReparsePointInPathChain {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$Description
    )

    $cursor = Get-NormalizedPath -Path $Path
    while (-not [string]::IsNullOrWhiteSpace($cursor)) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if (
                ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
            ) {
                throw "$Description 的路径链不能包含链接或挂载点：$cursor"
            }
        }

        $parent = Split-Path -Parent $cursor
        if (
            [string]::IsNullOrWhiteSpace($parent) -or
            (Test-SamePath -Left $parent -Right $cursor)
        ) {
            break
        }
        $cursor = $parent
    }
}

function Assert-PathWithin {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$Parent,

        [Parameter(Mandatory = $true)]
        [string]$Description
    )

    if (-not (Test-PathInside -Path $Path -Parent $Parent)) {
        throw "$Description 越过了受控目录：$Path"
    }
}

function Assert-OutsideDeploymentData {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$DeploymentRoot
    )

    $dataDirectory = Join-Path $DeploymentRoot "data"
    if (Test-PathInside -Path $Path -Parent $dataDirectory) {
        throw "更新脚本拒绝读取或修改部署数据目录：$Path"
    }
}

function Get-OptionalPropertyValue {
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

function Copy-DirectoryContents {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Source,

        [Parameter(Mandatory = $true)]
        [string]$Destination
    )

    Ensure-Directory -Path $Destination
    foreach ($item in Get-ChildItem -LiteralPath $Source -Force) {
        Copy-Item `
            -LiteralPath $item.FullName `
            -Destination $Destination `
            -Recurse `
            -Force
    }
}

function Assert-NoReparsePoints {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $rootItem = Get-Item -LiteralPath $Path -Force
    $reparsePoint = if (
        ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
    ) {
        $rootItem
    }
    else {
        Get-ChildItem `
            -LiteralPath $Path `
            -Force `
            -Recurse |
            Where-Object {
                ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
            } |
            Select-Object -First 1
    }

    if ($null -ne $reparsePoint) {
        throw (
            "发布包不能包含符号链接或目录联接，避免更新越过暂存目录：{0}" -f
                $reparsePoint.FullName
        )
    }
}

function Assert-PowerShellSyntax {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Directory
    )

    foreach (
        $scriptFile in Get-ChildItem `
            -LiteralPath $Directory `
            -Filter "*.ps1" `
            -File
    ) {
        $tokens = $null
        $errors = $null
        [void][Management.Automation.Language.Parser]::ParseFile(
            $scriptFile.FullName,
            [ref]$tokens,
            [ref]$errors
        )
        if ($errors.Count -gt 0) {
            $messages = ($errors | ForEach-Object Message) -join "; "
            throw "PowerShell 语法检查失败：$($scriptFile.FullName)：$messages"
        }
    }
}

function Assert-ManifestFileInventory {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Manifest,

        [Parameter(Mandatory = $true)]
        [string]$Candidate
    )

    $manifestFilesValue = Get-OptionalPropertyValue `
        -InputObject $Manifest `
        -Name "payloadFiles"
    if ($null -eq $manifestFilesValue) {
        # 兼容尚未生成完整文件清单的 schemaVersion=1 发布包。
        return
    }

    $manifestFiles = @($manifestFilesValue)
    if ($manifestFiles.Count -eq 0) {
        throw "候选发布清单 payloadFiles 不能为空数组。"
    }

    $candidateRoot = Get-NormalizedPath -Path $Candidate
    $listedFiles = @{}
    foreach ($fileRecord in $manifestFiles) {
        if ($null -eq $fileRecord) {
            throw "候选发布清单 payloadFiles 包含空记录。"
        }

        $relativePath = [string](Get-OptionalPropertyValue `
            -InputObject $fileRecord `
            -Name "path")
        $sizeValue = Get-OptionalPropertyValue `
            -InputObject $fileRecord `
            -Name "size"
        $expectedHash = [string](Get-OptionalPropertyValue `
            -InputObject $fileRecord `
            -Name "sha256")
        $normalizedRelativePath = $relativePath.Replace("\", "/")
        $segments = @($normalizedRelativePath.Split("/"))
        if (
            [string]::IsNullOrWhiteSpace($relativePath) -or
            [IO.Path]::IsPathRooted($relativePath) -or
            $relativePath.Contains(":") -or
            $segments.Count -eq 0 -or
            @($segments | Where-Object {
                [string]::IsNullOrWhiteSpace($_) -or
                $_ -eq "." -or
                $_ -eq ".."
            }).Count -gt 0 -or
            $normalizedRelativePath.Equals(
                "release-manifest.json",
                [StringComparison]::OrdinalIgnoreCase
            )
        ) {
            throw "候选发布清单包含不安全的相对文件路径：$relativePath"
        }
        if (
            $sizeValue -isnot [int] -and
            $sizeValue -isnot [long]
        ) {
            throw "候选发布清单的文件大小必须是整数：$relativePath"
        }
        $expectedSize = [long]$sizeValue
        if ($expectedSize -lt 0) {
            throw "候选发布清单的文件大小不能为负数：$relativePath"
        }
        if ($expectedHash -notmatch "^[a-fA-F0-9]{64}$") {
            throw "候选发布清单的 SHA-256 无效：$relativePath"
        }
        if ($listedFiles.ContainsKey($normalizedRelativePath)) {
            throw "候选发布清单包含重复文件路径：$relativePath"
        }

        $candidateFile = Get-NormalizedPath -Path (
            Join-Path $candidateRoot $relativePath
        )
        if (-not (Test-PathInside -Path $candidateFile -Parent $candidateRoot)) {
            throw "候选发布清单文件越过发布目录：$relativePath"
        }
        if (-not (Test-Path -LiteralPath $candidateFile -PathType Leaf)) {
            throw "候选发布清单中的文件不存在：$relativePath"
        }

        $fileInfo = Get-Item -LiteralPath $candidateFile -Force
        if ([long]$fileInfo.Length -ne $expectedSize) {
            throw "候选发布清单文件大小不符：$relativePath"
        }
        $actualHash = (
            Get-FileHash -LiteralPath $candidateFile -Algorithm SHA256
        ).Hash
        if (
            -not $actualHash.Equals(
                $expectedHash,
                [StringComparison]::OrdinalIgnoreCase
            )
        ) {
            throw "候选发布清单文件哈希不符：$relativePath"
        }

        $listedFiles[$normalizedRelativePath] = $true
    }

    $actualFiles = @(
        Get-ChildItem -LiteralPath $candidateRoot -File -Force -Recurse |
        Where-Object {
            -not (
                (Get-NormalizedPath -Path $_.FullName).Equals(
                    (Join-Path $candidateRoot "release-manifest.json"),
                    [StringComparison]::OrdinalIgnoreCase
                )
            )
        }
    )
    foreach ($actualFile in $actualFiles) {
        $actualRelativePath = (
            (Get-NormalizedPath -Path $actualFile.FullName).Substring(
                $candidateRoot.Length + 1
            )
        ).Replace("\", "/")
        if (-not $listedFiles.ContainsKey($actualRelativePath)) {
            throw "候选目录包含发布清单未声明的文件：$actualRelativePath"
        }
    }
    if ($actualFiles.Count -ne $listedFiles.Count) {
        throw "候选发布清单文件数量与目录不一致。"
    }
}

function Assert-CandidateRelease {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Candidate,

        [Parameter(Mandatory = $true)]
        [string]$Current,

        [Parameter(Mandatory = $true)]
        [string]$NodeExecutable
    )

    $requiredFiles = @(
        "package.json",
        "package-lock.json",
        "release-manifest.json",
        "server\dist\index.js",
        "server\dist\runtime\ShutdownRequestWatcher.js",
        "web\dist\index.html",
        "start-domain.bat",
        "deploy\windows\_Common.ps1",
        "deploy\windows\Install-Cloudflared.ps1",
        "deploy\windows\Install-TunnelTask.ps1",
        "deploy\windows\Run-App.ps1",
        "deploy\windows\Run-QuickTunnel.ps1",
        "deploy\windows\Update-App.ps1"
    )
    foreach ($relativePath in $requiredFiles) {
        $candidatePath = Join-Path $Candidate $relativePath
        if (-not (Test-Path -LiteralPath $candidatePath -PathType Leaf)) {
            throw "候选版本缺少必需文件：$relativePath"
        }
    }

    $manifest = Get-Content `
        -LiteralPath (Join-Path $Candidate "release-manifest.json") `
        -Raw `
        -Encoding UTF8 |
        ConvertFrom-Json
    if ($manifest.schemaVersion -ne 1) {
        throw "候选发布清单版本不受支持。"
    }
    $databaseMigrationPolicy = [string](
        Get-OptionalPropertyValue `
            -InputObject $manifest `
            -Name "databaseMigrationPolicy"
    )
    $rollbackCompatible = Get-OptionalPropertyValue `
        -InputObject $manifest `
        -Name "rollbackCompatible"
    if (
        $databaseMigrationPolicy -ne "expand-contract" -or
        $rollbackCompatible -isnot [bool] -or
        -not [bool]$rollbackCompatible
    ) {
        throw (
            "候选发布清单未声明数据库回滚兼容性。发布包必须由生成器在" +
            "人工确认迁移遵循 expand-contract 后写入 " +
            "databaseMigrationPolicy=expand-contract 和 " +
            "rollbackCompatible=true。"
        )
    }
    foreach (
        $hashCheck in @(
            @{
                Property = "packageLockSha256"
                Path = "package-lock.json"
            },
            @{
                Property = "serverEntrySha256"
                Path = "server\dist\index.js"
            },
            @{
                Property = "webEntrySha256"
                Path = "web\dist\index.html"
            }
        )
    ) {
        $expectedHash = [string](
            Get-OptionalPropertyValue `
                -InputObject $manifest `
                -Name $hashCheck.Property
        )
        $actualHash = (
            Get-FileHash `
                -LiteralPath (Join-Path $Candidate $hashCheck.Path) `
                -Algorithm SHA256
        ).Hash
        if (
            [string]::IsNullOrWhiteSpace($expectedHash) -or
            -not $actualHash.Equals(
                $expectedHash,
                [StringComparison]::OrdinalIgnoreCase
            )
        ) {
            throw "候选发布清单校验失败：$($hashCheck.Path)"
        }
    }
    foreach ($forbiddenName in @("data", "runtime", "logs", "tools", ".git")) {
        $forbiddenPath = Join-Path $Candidate $forbiddenName
        if (Test-Path -LiteralPath $forbiddenPath) {
            throw "候选版本不能包含部署保留目录：$forbiddenName"
        }
    }
    Assert-ManifestFileInventory -Manifest $manifest -Candidate $Candidate

    $runScript = Get-Content `
        -LiteralPath (Join-Path $Candidate "deploy\windows\Run-App.ps1") `
        -Raw
    foreach (
        $requiredMarker in @(
            "APP_SHUTDOWN_REQUEST_PATH",
            "APP_SHUTDOWN_CONFIRMATION_PATH",
            "APP_INSTANCE_NONCE",
            "gracefulShutdownConfirmed",
            "identitySchemaVersion",
            "rootIdentityMarker",
            "instanceMarker",
            "--gupiaomoniqi-root="
        )
    ) {
        if (-not $runScript.Contains($requiredMarker)) {
            throw "候选启动脚本缺少受控停机标记：$requiredMarker"
        }
    }
    $candidateUpdater = Get-Content `
        -LiteralPath (Join-Path $Candidate "deploy\windows\Update-App.ps1") `
        -Raw
    foreach (
        $requiredUpdaterMarker in @(
            "Restore-InterruptedUpdate",
            "Wait-AppExitConfirmation",
            "app-update.lock",
            "payloadFiles"
        )
    ) {
        if (-not $candidateUpdater.Contains($requiredUpdaterMarker)) {
            throw "候选版本没有携带完整的下一次无损更新能力：$requiredUpdaterMarker"
        }
    }

    Assert-PowerShellSyntax `
        -Directory (Join-Path $Candidate "deploy\windows")

    & $NodeExecutable `
        --check `
        (Join-Path $Candidate "server\dist\index.js")
    if ($LASTEXITCODE -ne 0) {
        throw "候选 Node.js 入口未通过 node --check。"
    }

    $candidateNodeModules = Join-Path $Candidate "node_modules"
    $manifestIncludesNodeModules = [bool](
        Get-OptionalPropertyValue `
            -InputObject $manifest `
            -Name "includesNodeModules"
    )
    if (
        $manifestIncludesNodeModules -ne
        (Test-Path -LiteralPath $candidateNodeModules -PathType Container)
    ) {
        throw "发布清单中的依赖模式与候选目录不一致。"
    }
    if (-not (Test-Path -LiteralPath $candidateNodeModules -PathType Container)) {
        $currentNodeModules = Join-Path $Current "node_modules"
        if (
            -not (
                Test-Path `
                    -LiteralPath $currentNodeModules `
                    -PathType Container
            )
        ) {
            throw (
                "候选版本未携带 node_modules，当前版本也没有可复用依赖。"
            )
        }

        $candidateLockHash = (
            Get-FileHash `
                -LiteralPath (Join-Path $Candidate "package-lock.json") `
                -Algorithm SHA256
        ).Hash
        $currentLockPath = Join-Path $Current "package-lock.json"
        if (-not (Test-Path -LiteralPath $currentLockPath -PathType Leaf)) {
            throw "当前版本缺少 package-lock.json，无法验证依赖兼容性。"
        }
        $currentLockHash = (
            Get-FileHash `
                -LiteralPath $currentLockPath `
                -Algorithm SHA256
        ).Hash
        if ($candidateLockHash -ne $currentLockHash) {
            throw (
                "package-lock.json 已变化，不能复用旧 node_modules。" +
                "请生成包含无链接生产依赖的完整发布包。"
            )
        }
    }
}

function Add-CandidateWorkspaceLink {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Candidate,

        [Parameter(Mandatory = $true)]
        [string]$FinalCurrentDirectory
    )

    $candidateNodeModules = Join-Path $Candidate "node_modules"
    if (-not (Test-Path -LiteralPath $candidateNodeModules -PathType Container)) {
        return
    }

    $scopeDirectory = Join-Path `
        $candidateNodeModules `
        "@gupiaomoniqi"
    Ensure-Directory -Path $scopeDirectory
    $sharedLink = Join-Path $scopeDirectory "shared"
    if (Test-Path -LiteralPath $sharedLink) {
        $sharedItem = Get-Item -LiteralPath $sharedLink -Force
        if (
            ($sharedItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne
                0 -or
            -not (
                Test-Path `
                    -LiteralPath (Join-Path $sharedLink "package.json") `
                    -PathType Leaf
            ) -or
            -not (
                Test-Path `
                    -LiteralPath (Join-Path $sharedLink "src\index.ts") `
                    -PathType Leaf
            )
        ) {
            throw (
                "完整依赖包中的 @gupiaomoniqi/shared 必须是发布包内" +
                "实体目录，且包含 package.json 与 src/index.ts。"
            )
        }
        return
    }

    # 兼容旧 schemaVersion=1 完整包：它没有实体化 workspace 依赖，
    # 只在受控暂存目录内创建最终仍指向 current\shared 的目录联接。
    $finalSharedTarget = Join-Path $FinalCurrentDirectory "shared"
    New-Item `
        -ItemType Junction `
        -Path $sharedLink `
        -Target $finalSharedTarget | Out-Null
    $createdLink = Get-Item -LiteralPath $sharedLink -Force
    if (
        $createdLink.LinkType -ne "Junction" -or
        -not (Test-SamePath `
            -Left ([string]$createdLink.Target[0]) `
            -Right $finalSharedTarget)
    ) {
        throw "无法验证候选版本的内部 shared 目录联接。"
    }
}

function Read-AppRuntimeState {
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
            -Encoding UTF8 |
            ConvertFrom-Json
    }
    catch {
        throw "应用状态文件存在但无法解析，拒绝把未知实例当作已停止：$Path"
    }
}

function Get-PortListenerProcessIds {
    param(
        [Parameter(Mandatory = $true)]
        [int]$LocalPort
    )

    return @(
        Get-NetTCPConnection `
            -LocalPort $LocalPort `
            -State Listen `
            -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique
    )
}

function Get-ExpectedRootIdentityMarker {
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

function Test-CommandLineToken {
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

    $pattern = (
        '(?:^|[\s"])' +
        [regex]::Escape($Token) +
        '(?=$|[\s"])'
    )
    return [regex]::IsMatch(
        $CommandLine,
        $pattern,
        [Text.RegularExpressions.RegexOptions]::IgnoreCase
    )
}

function Get-AppProcessCandidates {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ExpectedNodeExecutable,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedEntryPoint,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedRoot
    )

    $expectedMarker = "--gupiaomoniqi-root=$ExpectedRoot"
    $expectedRootIdentityMarker = Get-ExpectedRootIdentityMarker `
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
            (Test-SamePath `
                -Left ([string]$_.ExecutablePath) `
                -Right $ExpectedNodeExecutable) -and
            (
                (
                    (Test-CommandLineToken `
                        -CommandLine ([string]$_.CommandLine) `
                        -Token $expectedMarker) -and
                    (Test-CommandLineToken `
                        -CommandLine ([string]$_.CommandLine) `
                        -Token $expectedRootIdentityMarker)
                ) -or
                (Test-CommandLineToken `
                    -CommandLine ([string]$_.CommandLine) `
                    -Token $ExpectedEntryPoint)
            )
        }
    )
}

function Assert-AppScheduledTaskBinding {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Task,

        [Parameter(Mandatory = $true)]
        [string]$DeploymentRoot,

        [Parameter(Mandatory = $true)]
        [string]$NodeExecutable,

        [Parameter(Mandatory = $true)]
        [int]$ApplicationPort
    )

    $taskRecords = @($Task)
    if ($taskRecords.Count -ne 1) {
        throw "应用计划任务必须且只能匹配一个根任务：$($Task.TaskName)"
    }
    $Task = $taskRecords[0]
    if (
        -not [string]::IsNullOrWhiteSpace([string]$Task.TaskPath) -and
        [string]$Task.TaskPath -ne "\"
    ) {
        throw "应用计划任务必须位于根任务目录：$($Task.TaskPath)"
    }

    $actions = @($Task.Actions)
    if ($actions.Count -ne 1) {
        throw "应用计划任务必须且只能有一个启动动作：$($Task.TaskName)"
    }

    $action = $actions[0]
    $powerShellPath = Get-WindowsPowerShellPath
    if (
        [string]::IsNullOrWhiteSpace([string]$action.Execute) -or
        -not (Test-SamePath `
            -Left ([string]$action.Execute) `
            -Right $powerShellPath)
    ) {
        throw "计划任务启动程序不属于本部署，拒绝操作：$($action.Execute)"
    }
    if (
        [string]::IsNullOrWhiteSpace(
            [string]$action.WorkingDirectory
        ) -or
        -not (Test-SamePath `
            -Left ([string]$action.WorkingDirectory) `
            -Right $DeploymentRoot)
    ) {
        throw "计划任务工作目录不属于当前部署，拒绝操作。"
    }

    $runnerPath = Join-Path `
        $DeploymentRoot `
        "current\deploy\windows\Run-App.ps1"
    $arguments = [string]$action.Arguments
    $argumentPattern = (
        '^\s*-NoLogo\s+-NoProfile\s+-NonInteractive\s+' +
        '-ExecutionPolicy\s+Bypass\s+-File\s+"' +
        [regex]::Escape($runnerPath) +
        '"\s+-Root\s+"' +
        [regex]::Escape($DeploymentRoot) +
        '"\s+-NodePath\s+"' +
        [regex]::Escape($NodeExecutable) +
        '"\s+-Port\s+' +
        [regex]::Escape([string]$ApplicationPort) +
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
            "计划任务参数不是当前部署生成的完整启动命令，拒绝操作。实际：" +
            $arguments
        )
    }
    $taskPythonPath = $argumentMatch.Groups["python"].Value
    if (-not [string]::IsNullOrWhiteSpace($taskPythonPath)) {
        Assert-LocalFileSystemPath `
            -Path $taskPythonPath `
            -Description "计划任务 Python"
        Assert-NoReparsePointInPathChain `
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

function Get-AppScheduledTaskByName {
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
        throw "发现多个同名应用计划任务，拒绝模糊操作：$Name"
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
            "同名应用计划任务位于非根任务目录，拒绝操作：" +
            "$($task.TaskPath)$Name"
        )
    }
    return $task
}

function Wait-AppScheduledTaskNotRunning {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [ValidateRange(1, 60)]
        [int]$TimeoutSeconds = 15
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $task = Get-AppScheduledTaskByName -Name $Name -AllowMissing
        if ($null -eq $task -or [string]$task.State -ne "Running") {
            return
        }
        Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $deadline)

    throw "应用计划任务未能在 $TimeoutSeconds 秒内停止：$Name"
}

function Get-ManagedAppProcess {
    param(
        [Parameter(Mandatory = $true)]
        [object]$RuntimeState,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedNodeExecutable,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedEntryPoint,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedRoot,

        [Parameter(Mandatory = $true)]
        [int]$ExpectedPort,

        [bool]$AllowLegacyIdentity = $true
    )

    $processIdValue = Get-OptionalPropertyValue `
        -InputObject $RuntimeState `
        -Name "processId"
    if ($null -eq $processIdValue) {
        return $null
    }
    $processId = [int]$processIdValue

    $process = Get-CimInstance `
        -ClassName Win32_Process `
        -Filter "ProcessId=$processId" `
        -ErrorAction SilentlyContinue
    if ($null -eq $process) {
        return $null
    }

    if (
        [string]::IsNullOrWhiteSpace([string]$process.ExecutablePath) -or
        -not (Test-SamePath `
            -Left ([string]$process.ExecutablePath) `
            -Right $ExpectedNodeExecutable)
    ) {
        throw (
            "PID $processId 的可执行文件与部署 Node 不符，拒绝终止：" +
            [string]$process.ExecutablePath
        )
    }

    $commandLine = [string]$process.CommandLine
    $expectedMarker = "--gupiaomoniqi-root=$ExpectedRoot"
    $expectedRootIdentityMarker = Get-ExpectedRootIdentityMarker `
        -Root $ExpectedRoot
    $instanceNonce = [string](Get-OptionalPropertyValue `
        -InputObject $RuntimeState `
        -Name "instanceNonce")
    $recordedProcessMarker = [string](Get-OptionalPropertyValue `
        -InputObject $RuntimeState `
        -Name "processMarker")
    $recordedRootIdentityMarker = [string](Get-OptionalPropertyValue `
        -InputObject $RuntimeState `
        -Name "rootIdentityMarker")
    $recordedInstanceMarker = [string](Get-OptionalPropertyValue `
        -InputObject $RuntimeState `
        -Name "instanceMarker")
    $recordedIdentitySchemaVersion = Get-OptionalPropertyValue `
        -InputObject $RuntimeState `
        -Name "identitySchemaVersion"
    $hasAnyModernIdentity = (
        $null -ne $recordedIdentitySchemaVersion -or
        -not [string]::IsNullOrWhiteSpace($recordedRootIdentityMarker) -or
        -not [string]::IsNullOrWhiteSpace($recordedInstanceMarker)
    )
    $hasCompleteModernIdentity = (
        $recordedIdentitySchemaVersion -is [int] -and
        [int]$recordedIdentitySchemaVersion -eq 1 -and
        $instanceNonce -match "^[a-fA-F0-9]{32}$" -and
        [string]::Equals(
            $recordedProcessMarker,
            $expectedMarker,
            [StringComparison]::OrdinalIgnoreCase
        ) -and
        [string]::Equals(
            $recordedRootIdentityMarker,
            $expectedRootIdentityMarker,
            [StringComparison]::OrdinalIgnoreCase
        ) -and
        $recordedInstanceMarker -eq (
            "--gupiaomoniqi-instance=$instanceNonce"
        ) -and
        (Test-CommandLineToken `
            -CommandLine $commandLine `
            -Token $ExpectedEntryPoint) -and
        (Test-CommandLineToken `
            -CommandLine $commandLine `
            -Token $expectedMarker) -and
        (Test-CommandLineToken `
            -CommandLine $commandLine `
            -Token $expectedRootIdentityMarker) -and
        (Test-CommandLineToken `
            -CommandLine $commandLine `
            -Token $recordedInstanceMarker)
    )

    if ($hasAnyModernIdentity -and -not $hasCompleteModernIdentity) {
        throw (
            "PID $processId 的新版实例身份字段不完整或与命令行不一致，" +
            "拒绝终止。"
        )
    }
    if (-not $hasAnyModernIdentity -and -not $AllowLegacyIdentity) {
        throw "PID $processId 缺少新版实例身份，拒绝把它当作候选进程。"
    }

    if (-not $hasCompleteModernIdentity) {
        $legacyEntryPoint = "server\dist\index.js"
        $listenerIds = @(
            Get-PortListenerProcessIds -LocalPort $ExpectedPort
        )
        $isLegacyManagedProcess = (
            (
                (Test-CommandLineToken `
                    -CommandLine $commandLine `
                    -Token $ExpectedEntryPoint) -or
                (Test-CommandLineToken `
                    -CommandLine $commandLine `
                    -Token $legacyEntryPoint)
            ) -and
            (
                (Test-CommandLineToken `
                    -CommandLine $commandLine `
                    -Token $expectedMarker) -or
                $listenerIds -contains $processId
            )
        )
        if (-not $isLegacyManagedProcess) {
            throw (
                "PID $processId 的命令行不属于当前部署，拒绝终止。"
            )
        }
    }

    $expectedStartedAt = Get-OptionalPropertyValue `
        -InputObject $RuntimeState `
        -Name "processStartedAt"
    if ($null -ne $expectedStartedAt -and $null -ne $process.CreationDate) {
        $recordedStart = [DateTime]::Parse(
            [string]$expectedStartedAt
        ).ToUniversalTime()
        $actualStart = (
            [DateTime]$process.CreationDate
        ).ToUniversalTime()
        if (
            [Math]::Abs(
                ($recordedStart - $actualStart).TotalSeconds
            ) -gt 5
        ) {
            throw (
                "PID $processId 已被复用，启动时间与状态文件不符，拒绝终止。"
            )
        }
    }

    return $process
}

function Wait-ProcessExit {
    param(
        [Parameter(Mandatory = $true)]
        [int]$ProcessId,

        [Parameter(Mandatory = $true)]
        [int]$TimeoutSeconds
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        if (
            $null -eq (
                Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
            )
        ) {
            return $true
        }
        Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $deadline)

    return $false
}

function Wait-AppExitConfirmation {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RuntimeStatePath,

        [Parameter(Mandatory = $true)]
        [int]$ProcessId,

        [Parameter(Mandatory = $true)]
        [string]$InstanceNonce,

        [ValidateRange(1, 60)]
        [int]$TimeoutSeconds = 15
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $state = Read-AppRuntimeState -Path $RuntimeStatePath
        if ($null -ne $state) {
            $stateProcessId = Get-OptionalPropertyValue `
                -InputObject $state `
                -Name "processId"
            $stateNonce = Get-OptionalPropertyValue `
                -InputObject $state `
                -Name "instanceNonce"
            $stateStatus = [string](Get-OptionalPropertyValue `
                -InputObject $state `
                -Name "status")
            $exitCode = Get-OptionalPropertyValue `
                -InputObject $state `
                -Name "exitCode"
            $gracefulShutdownConfirmed = Get-OptionalPropertyValue `
                -InputObject $state `
                -Name "gracefulShutdownConfirmed"
            $shutdownConfirmedAt = Get-OptionalPropertyValue `
                -InputObject $state `
                -Name "shutdownConfirmedAt"
            $shutdownConfirmationPath = Get-OptionalPropertyValue `
                -InputObject $state `
                -Name "shutdownConfirmationPath"

            if (
                $null -ne $stateProcessId -and
                [int]$stateProcessId -eq $ProcessId -and
                [string]$stateNonce -eq $InstanceNonce -and
                $stateStatus -eq "stopped"
            ) {
                if ($null -eq $exitCode -or [int]$exitCode -ne 0) {
                    throw (
                        "PID $ProcessId 已退出，但关闭确认的退出码不是 0；" +
                        "拒绝把异常退出当作数据库安全关闭。"
                    )
                }

                if (
                    $gracefulShutdownConfirmed -isnot [bool] -or
                    -not $gracefulShutdownConfirmed
                ) {
                    throw (
                        "PID $ProcessId 已退出，但应用没有写入优雅关闭确认；" +
                        "拒绝把未确认的退出当作数据库安全关闭。"
                    )
                }

                try {
                    $parsedStateConfirmationTime = [DateTimeOffset]::Parse(
                        [string]$shutdownConfirmedAt,
                        [Globalization.CultureInfo]::InvariantCulture,
                        [Globalization.DateTimeStyles]::RoundtripKind
                    )
                }
                catch {
                    throw (
                        "PID $ProcessId 已退出，但应用写入的优雅关闭时间无效；" +
                        "拒绝继续代码切换。"
                    )
                }

                $expectedConfirmationPath = Join-Path (
                    Split-Path -Parent $RuntimeStatePath
                ) "app-shutdown-confirmation.json"
                if (
                    [string]::IsNullOrWhiteSpace(
                        [string]$shutdownConfirmationPath
                    ) -or
                    -not (Test-SamePath `
                        -Left ([string]$shutdownConfirmationPath) `
                        -Right $expectedConfirmationPath)
                ) {
                    throw (
                        "PID $ProcessId 的关闭确认路径没有绑定当前部署运行目录；" +
                        "拒绝继续代码切换。"
                    )
                }
                if (
                    -not (
                        Test-Path `
                            -LiteralPath $expectedConfirmationPath `
                            -PathType Leaf
                    )
                ) {
                    throw "PID $ProcessId 的关闭确认文件不存在。"
                }
                Assert-NoReparsePointInPathChain `
                    -Path $expectedConfirmationPath `
                    -Description "应用关闭确认文件"

                try {
                    $confirmation = Get-Content `
                        -LiteralPath $expectedConfirmationPath `
                        -Raw `
                        -Encoding UTF8 |
                        ConvertFrom-Json
                    $confirmationVersion = Get-OptionalPropertyValue `
                        -InputObject $confirmation `
                        -Name "version"
                    $confirmationStatus = Get-OptionalPropertyValue `
                        -InputObject $confirmation `
                        -Name "status"
                    $confirmationProcessId = Get-OptionalPropertyValue `
                        -InputObject $confirmation `
                        -Name "processId"
                    $confirmationNonce = Get-OptionalPropertyValue `
                        -InputObject $confirmation `
                        -Name "instanceNonce"
                    $requestReceivedAt = [DateTimeOffset]::Parse(
                        [string](Get-OptionalPropertyValue `
                            -InputObject $confirmation `
                            -Name "requestReceivedAt"),
                        [Globalization.CultureInfo]::InvariantCulture,
                        [Globalization.DateTimeStyles]::RoundtripKind
                    )
                    $completedAt = [DateTimeOffset]::Parse(
                        [string](Get-OptionalPropertyValue `
                            -InputObject $confirmation `
                            -Name "completedAt"),
                        [Globalization.CultureInfo]::InvariantCulture,
                        [Globalization.DateTimeStyles]::RoundtripKind
                    )
                }
                catch {
                    throw (
                        "PID $ProcessId 的关闭确认文件无法解析；" +
                        "拒绝继续代码切换。"
                    )
                }

                if (
                    [int]$confirmationVersion -ne 1 -or
                    [string]$confirmationStatus -ne "closed" -or
                    $null -eq $confirmationProcessId -or
                    [int]$confirmationProcessId -ne $ProcessId -or
                    [string]$confirmationNonce -ne $InstanceNonce -or
                    $completedAt -lt $requestReceivedAt -or
                    [Math]::Abs((
                        $completedAt - $parsedStateConfirmationTime
                    ).TotalSeconds) -gt 1
                ) {
                    throw (
                        "PID $ProcessId 的关闭确认文件与状态中的实例、" +
                        "时间或完成状态不一致；拒绝继续代码切换。"
                    )
                }
                return $true
            }
        }
        Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $deadline)

    return $false
}

function Stop-AppInstance {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DeploymentRoot,

        [Parameter(Mandatory = $true)]
        [string]$ApplicationTaskName,

        [Parameter(Mandatory = $true)]
        [string]$NodeExecutable,

        [Parameter(Mandatory = $true)]
        [int]$ApplicationPort,

        [Parameter(Mandatory = $true)]
        [int]$GracefulTimeoutSeconds,

        [Parameter(Mandatory = $true)]
        [int]$QuiesceSeconds,

        [Parameter(Mandatory = $true)]
        [bool]$ForcedStopAllowed,

        [Parameter(Mandatory = $true)]
        [bool]$ProcessLauncher,

        [Parameter(Mandatory = $true)]
        [string]$UpdateLog,

        [Parameter(Mandatory = $true)]
        [ref]$Outcome
    )

    $Outcome.Value = [pscustomobject]@{
        TaskWasRunning = $false
        TaskWasDisabled = $false
        TaskDisabled = $false
        ManagedProcessId = $null
        ProcessStopped = $false
        GracefulStopConfirmed = $false
        SupervisorStopped = $false
        PortClear = $false
        StartupFence = $null
    }

    $latestPath = Join-Path $DeploymentRoot "runtime\app-latest.json"
    $entryPoint = Join-Path `
        $DeploymentRoot `
        "current\server\dist\index.js"
    $requestPath = Join-Path `
        $DeploymentRoot `
        "runtime\app-shutdown-request.json"
    $startupFence = $null

    try {
        $task = $null
        if (-not $ProcessLauncher) {
            $task = Get-AppScheduledTaskByName `
                -Name $ApplicationTaskName `
                -AllowMissing
            if ($null -eq $task) {
                throw "应用计划任务不存在：$ApplicationTaskName"
            }
            Assert-AppScheduledTaskBinding `
                -Task $task `
                -DeploymentRoot $DeploymentRoot `
                -NodeExecutable $NodeExecutable `
                -ApplicationPort $ApplicationPort

            $Outcome.Value.TaskWasRunning = $task.State -eq "Running"
            $Outcome.Value.TaskWasDisabled = $task.State -eq "Disabled"
            if ($task.State -ne "Disabled") {
                Disable-ScheduledTask `
                    -TaskName $ApplicationTaskName `
                    -TaskPath "\" | Out-Null
                $Outcome.Value.TaskDisabled = $true
            }
        }

        $runtimeState = Read-AppRuntimeState -Path $latestPath
        if ($null -eq $runtimeState) {
            $processCandidates = @(
                Get-AppProcessCandidates `
                    -ExpectedNodeExecutable $NodeExecutable `
                    -ExpectedEntryPoint $entryPoint `
                    -ExpectedRoot $DeploymentRoot
            )
            if ($processCandidates.Count -gt 0) {
                throw (
                    "没有可验证的状态文件，但发现疑似本部署 Node；拒绝继续。" +
                    "PID：" +
                    (($processCandidates |
                        Select-Object -ExpandProperty ProcessId) -join ",")
                )
            }
            $listenerIds = @(
                Get-PortListenerProcessIds -LocalPort $ApplicationPort
            )
            if ($listenerIds.Count -gt 0) {
                throw (
                    "没有应用状态文件，但端口 $ApplicationPort 正被占用；" +
                    "拒绝继续更新。"
                )
            }

            $startupFencePath = Join-Path `
                $DeploymentRoot `
                "runtime\app-launcher.lock"
            try {
                $startupFence = [IO.File]::Open(
                    $startupFencePath,
                    [IO.FileMode]::OpenOrCreate,
                    [IO.FileAccess]::ReadWrite,
                    [IO.FileShare]::None
                )
            }
            catch {
                throw (
                    "应用启动器仍在运行或启动中，但尚未写入可验证的状态；" +
                    "拒绝停止未知进程。"
                )
            }

            # 取得启动器栅栏后再次检查，关闭“首次扫描后刚启动 Node”的窗口。
            $processCandidates = @(
                Get-AppProcessCandidates `
                    -ExpectedNodeExecutable $NodeExecutable `
                    -ExpectedEntryPoint $entryPoint `
                    -ExpectedRoot $DeploymentRoot
            )
            $listenerIds = @(
                Get-PortListenerProcessIds -LocalPort $ApplicationPort
            )
            if (
                $processCandidates.Count -gt 0 -or
                $listenerIds.Count -gt 0
            ) {
                throw (
                    "取得启动器栅栏后发现 Node 或端口状态发生变化；" +
                    "拒绝在竞态中继续更新。"
                )
            }
            $Outcome.Value.ProcessStopped = $true
        }
        else {
            $managedProcess = Get-ManagedAppProcess `
                -RuntimeState $runtimeState `
                -ExpectedNodeExecutable $NodeExecutable `
                -ExpectedEntryPoint $entryPoint `
                -ExpectedRoot $DeploymentRoot `
                -ExpectedPort $ApplicationPort

            if ($null -ne $managedProcess) {
                $managedProcessId = [int]$managedProcess.ProcessId
                $Outcome.Value.ManagedProcessId = $managedProcessId
                $instanceNonce = Get-OptionalPropertyValue `
                    -InputObject $runtimeState `
                    -Name "instanceNonce"
                $configuredRequestPath = Get-OptionalPropertyValue `
                    -InputObject $runtimeState `
                    -Name "shutdownRequestPath"
                $canRequestGracefulShutdown = (
                    $null -ne $instanceNonce -and
                    [string]$instanceNonce -match "^[a-fA-F0-9]{32}$" -and
                    $null -ne $configuredRequestPath -and
                    (Test-SamePath `
                        -Left ([string]$configuredRequestPath) `
                        -Right $requestPath)
                )

                if ($canRequestGracefulShutdown) {
                    Write-AtomicJson -Path $requestPath -Value ([ordered]@{
                        version = 1
                        processId = $managedProcessId
                        instanceNonce = [string]$instanceNonce
                        requestedAt = (Get-Date).ToUniversalTime().ToString("o")
                        reason = "code-update"
                    })
                    Write-LauncherLog -Path $UpdateLog -Message (
                        "已向 PID $managedProcessId 写入受控优雅停机请求。"
                    )

                    if (
                        Wait-ProcessExit `
                            -ProcessId $managedProcessId `
                            -TimeoutSeconds $GracefulTimeoutSeconds
                    ) {
                        $Outcome.Value.ProcessStopped = $true
                        if (
                            -not (
                                Wait-AppExitConfirmation `
                                    -RuntimeStatePath $latestPath `
                                    -ProcessId $managedProcessId `
                                    -InstanceNonce ([string]$instanceNonce) `
                                    -TimeoutSeconds 15
                            )
                        ) {
                            throw (
                                "PID $managedProcessId 已退出，但未收到同实例的" +
                                "安全关闭确认。"
                            )
                        }
                        $Outcome.Value.GracefulStopConfirmed = $true
                        Write-LauncherLog -Path $UpdateLog -Message (
                            "PID $managedProcessId 已完成并确认优雅退出。"
                        )
                    }
                }

                if (
                    $null -ne (
                        Get-Process `
                            -Id $managedProcessId `
                            -ErrorAction SilentlyContinue
                    )
                ) {
                    $runtimeState = Read-AppRuntimeState -Path $latestPath
                    if ($null -eq $runtimeState) {
                        throw "强制停止前应用状态文件消失，拒绝按旧 PID 操作。"
                    }
                    $revalidatedProcess = Get-ManagedAppProcess `
                        -RuntimeState $runtimeState `
                        -ExpectedNodeExecutable $NodeExecutable `
                        -ExpectedEntryPoint $entryPoint `
                        -ExpectedRoot $DeploymentRoot `
                        -ExpectedPort $ApplicationPort
                    if (
                        $null -eq $revalidatedProcess -or
                        [int]$revalidatedProcess.ProcessId -ne $managedProcessId
                    ) {
                        throw "强制停止前 PID 身份发生变化，拒绝终止。"
                    }

                    if (-not $ForcedStopAllowed) {
                        Write-LauncherLog -Path $UpdateLog -Message (
                            "安全停止更新：当前进程未在时限内优雅退出，且未" +
                            "显式允许强制终止。代码尚未切换。"
                        )
                        throw (
                            "当前 Node 版本不支持或未完成受控优雅停机。" +
                            "为保护 PGlite 数据库，默认不强杀；代码尚未切换。" +
                            "仅在隔离副本已验证可恢复时才可显式使用 " +
                            "-AllowForcedStop。"
                        )
                    }

                    Write-LauncherLog -Path $UpdateLog -Message (
                        "高风险警告：已显式允许强制停止；再次验证 PID、" +
                        "可执行文件和命令行后，现在终止 PID $managedProcessId。"
                    )
                    Stop-Process -Id ([int]$revalidatedProcess.ProcessId) -Force
                    if (
                        -not (
                            Wait-ProcessExit `
                                -ProcessId $managedProcessId `
                                -TimeoutSeconds 15
                        )
                    ) {
                        throw "无法终止受管 Node 进程：PID $managedProcessId"
                    }
                    $Outcome.Value.ProcessStopped = $true
                }
            }
            else {
                $runtimeStatus = [string](Get-OptionalPropertyValue `
                    -InputObject $runtimeState `
                    -Name "status")
                if (
                    $runtimeStatus -notin @(
                        "starting",
                        "running",
                        "stopped",
                        "startup-failed"
                    )
                ) {
                    throw (
                        "状态文件声称应用为 $runtimeStatus，但对应 Node 不存在；" +
                        "拒绝在未知状态下切换代码。"
                    )
                }

                $startupFencePath = Join-Path `
                    $DeploymentRoot `
                    "runtime\app-launcher.lock"
                try {
                    $startupFence = [IO.File]::Open(
                        $startupFencePath,
                        [IO.FileMode]::OpenOrCreate,
                        [IO.FileAccess]::ReadWrite,
                        [IO.FileShare]::None
                    )
                }
                catch {
                    throw (
                        "状态文件中的 Node 不存在，但启动器仍在运行或正在" +
                        "处理该实例；拒绝在竞态中继续更新。"
                    )
                }

                $recheckedState = Read-AppRuntimeState -Path $latestPath
                $recheckedStatus = if ($null -eq $recheckedState) {
                    $null
                }
                else {
                    [string](Get-OptionalPropertyValue `
                        -InputObject $recheckedState `
                        -Name "status")
                }
                $processCandidates = @(
                    Get-AppProcessCandidates `
                        -ExpectedNodeExecutable $NodeExecutable `
                        -ExpectedEntryPoint $entryPoint `
                        -ExpectedRoot $DeploymentRoot
                )
                $listenerIds = @(
                    Get-PortListenerProcessIds -LocalPort $ApplicationPort
                )
                if (
                    $recheckedStatus -notin @(
                        "starting",
                        "running",
                        "stopped",
                        "startup-failed"
                    ) -or
                    $processCandidates.Count -gt 0 -or
                    $listenerIds.Count -gt 0
                ) {
                    throw (
                        "取得启动器栅栏后应用状态发生变化；" +
                        "拒绝在竞态中继续更新。"
                    )
                }
                $Outcome.Value.ProcessStopped = $true
            }
        }

        if ($ProcessLauncher) {
            $launcherProcessId = if ($null -eq $runtimeState) {
                $null
            }
            else {
                Get-OptionalPropertyValue `
                    -InputObject $runtimeState `
                    -Name "launcherProcessId"
            }
            if ($null -ne $launcherProcessId) {
                $launcherExited = Wait-ProcessExit `
                    -ProcessId ([int]$launcherProcessId) `
                    -TimeoutSeconds 15
                if (-not $launcherExited) {
                    $launcher = Get-CimInstance `
                        -ClassName Win32_Process `
                        -Filter "ProcessId=$launcherProcessId" `
                        -ErrorAction SilentlyContinue
                    $expectedRunner = Join-Path `
                        $DeploymentRoot `
                        "current\deploy\windows\Run-App.ps1"
                    $launcherStartedAt = Get-OptionalPropertyValue `
                        -InputObject $runtimeState `
                        -Name "launcherStartedAt"
                    if (
                        $null -eq $launcher -or
                        -not (Test-SamePath `
                            -Left ([string]$launcher.ExecutablePath) `
                            -Right (Get-WindowsPowerShellPath)) -or
                        ([string]$launcher.CommandLine).IndexOf(
                            $expectedRunner,
                            [StringComparison]::OrdinalIgnoreCase
                        ) -lt 0 -or
                        $null -eq $launcherStartedAt -or
                        [Math]::Abs((
                            [DateTime]::Parse(
                                [string]$launcherStartedAt
                            ).ToUniversalTime() -
                            ([DateTime]$launcher.CreationDate).ToUniversalTime()
                        ).TotalSeconds) -gt 5
                    ) {
                        throw (
                            "Node 已退出，但 PID $launcherProcessId 不是同一" +
                            "受控 PowerShell 启动器，拒绝终止。"
                        )
                    }
                    Stop-Process -Id ([int]$launcherProcessId) -Force
                    if (
                        -not (
                            Wait-ProcessExit `
                                -ProcessId ([int]$launcherProcessId) `
                                -TimeoutSeconds 10
                        )
                    ) {
                        throw "受控 PowerShell 启动器未能退出。"
                    }
                }
            }
            $Outcome.Value.SupervisorStopped = $true
        }
        else {
            Stop-ScheduledTask `
                -TaskName $ApplicationTaskName `
                -TaskPath "\" `
                -ErrorAction SilentlyContinue
            Wait-AppScheduledTaskNotRunning `
                -Name $ApplicationTaskName `
                -TimeoutSeconds 15
            $Outcome.Value.SupervisorStopped = $true
        }

        if ($null -eq $startupFence) {
            $startupFencePath = Join-Path `
                $DeploymentRoot `
                "runtime\app-launcher.lock"
            try {
                $startupFence = [IO.File]::Open(
                    $startupFencePath,
                    [IO.FileMode]::OpenOrCreate,
                    [IO.FileAccess]::ReadWrite,
                    [IO.FileShare]::None
                )
            }
            catch {
                throw (
                    "旧实例已停止，但无法取得启动器切换栅栏；" +
                    "拒绝在可能重新启动的窗口中移动代码。"
                )
            }
        }

        $processCandidates = @(
            Get-AppProcessCandidates `
                -ExpectedNodeExecutable $NodeExecutable `
                -ExpectedEntryPoint $entryPoint `
                -ExpectedRoot $DeploymentRoot
        )
        $listenerIds = @(
            Get-PortListenerProcessIds -LocalPort $ApplicationPort
        )
        if (
            $processCandidates.Count -gt 0 -or
            $listenerIds.Count -gt 0
        ) {
            throw (
                "取得启动器切换栅栏后仍发现本部署 Node 或监听端口；" +
                "Node PID：" +
                (($processCandidates |
                    Select-Object -ExpandProperty ProcessId) -join ",") +
                "；端口 PID：" +
                ($listenerIds -join ",")
            )
        }
        $Outcome.Value.PortClear = $true

        Start-Sleep -Seconds $QuiesceSeconds
        $Outcome.Value.StartupFence = $startupFence
        $startupFence = $null
    }
    catch {
        if ($null -ne $startupFence) {
            $startupFence.Dispose()
            $startupFence = $null
        }
        if (-not $ProcessLauncher -and $Outcome.Value.TaskDisabled) {
            try {
                Enable-ScheduledTask `
                    -TaskName $ApplicationTaskName `
                    -TaskPath "\" | Out-Null
            }
            catch {
                Write-LauncherLog -Path $UpdateLog -Message (
                    "停止失败后重新启用计划任务也失败，请立即人工检查任务状态。"
                )
            }
        }
        throw
    }
}

function Wait-ManagedAppHealthy {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DeploymentRoot,

        [Parameter(Mandatory = $true)]
        [string]$ApplicationTaskName,

        [Parameter(Mandatory = $true)]
        [string]$NodeExecutable,

        [Parameter(Mandatory = $true)]
        [int]$ApplicationPort,

        [Parameter(Mandatory = $true)]
        [DateTime]$NotBefore,

        [Parameter(Mandatory = $true)]
        [int]$TimeoutSeconds,

        [Parameter(Mandatory = $true)]
        [bool]$ProcessLauncher,

        [int]$ExpectedLauncherProcessId = 0,

        [switch]$AllowLegacyLauncher
    )

    $latestPath = Join-Path $DeploymentRoot "runtime\app-latest.json"
    $entryPoint = Join-Path `
        $DeploymentRoot `
        "current\server\dist\index.js"
    $healthUri = "http://127.0.0.1:$ApplicationPort/api/health"
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $lastError = $null
    $terminalFailure = $null
    $healthySince = $null
    $healthyProcessId = 0
    $minimumStableSeconds = 5

    do {
        try {
            $runtimeState = Read-AppRuntimeState -Path $latestPath
            if ($null -eq $runtimeState) {
                if (
                    $ProcessLauncher -and
                    $ExpectedLauncherProcessId -gt 0 -and
                    $null -eq (
                        Get-Process `
                            -Id $ExpectedLauncherProcessId `
                            -ErrorAction SilentlyContinue
                    )
                ) {
                    $terminalFailure = "启动器在生成应用状态前已经退出"
                    break
                }
                throw "应用状态文件尚未生成"
            }
            if (
                $ProcessLauncher -and
                $ExpectedLauncherProcessId -gt 0 -and
                $null -eq (
                    Get-Process `
                        -Id $ExpectedLauncherProcessId `
                        -ErrorAction SilentlyContinue
                )
            ) {
                $recordedLauncherProcessId = Get-OptionalPropertyValue `
                    -InputObject $runtimeState `
                    -Name "launcherProcessId"
                if (
                    $null -eq $recordedLauncherProcessId -or
                    [int]$recordedLauncherProcessId -ne
                        $ExpectedLauncherProcessId
                ) {
                    $terminalFailure = (
                        "本次启动器已退出，且状态文件没有绑定该启动器"
                    )
                    break
                }
            }

            $startedAtValue = Get-OptionalPropertyValue `
                -InputObject $runtimeState `
                -Name "processStartedAt"
            if ($null -eq $startedAtValue) {
                $startedAtValue = Get-OptionalPropertyValue `
                    -InputObject $runtimeState `
                    -Name "startedAt"
            }
            if (
                $null -eq $startedAtValue -or
                [DateTime]::Parse(
                    [string]$startedAtValue
                ).ToUniversalTime() -lt $NotBefore.AddSeconds(-2)
            ) {
                throw "应用状态仍属于更新前的进程"
            }

            $runtimeStatus = [string](Get-OptionalPropertyValue `
                -InputObject $runtimeState `
                -Name "status")
            if ($runtimeStatus -eq "stopped") {
                $exitCode = Get-OptionalPropertyValue `
                    -InputObject $runtimeState `
                    -Name "exitCode"
                $terminalFailure = (
                    "候选进程已经退出，退出码：$exitCode"
                )
                break
            }
            if ($runtimeStatus -ne "running") {
                throw "应用状态不是 running"
            }

            if ($ProcessLauncher) {
                $launcherProcessId = [int](Get-OptionalPropertyValue `
                    -InputObject $runtimeState `
                    -Name "launcherProcessId")
                if (
                    $ExpectedLauncherProcessId -gt 0 -and
                    $launcherProcessId -ne $ExpectedLauncherProcessId
                ) {
                    throw "状态文件中的启动器 PID 与本次启动不一致"
                }
                $launcher = Get-CimInstance `
                    -ClassName Win32_Process `
                    -Filter "ProcessId=$launcherProcessId" `
                    -ErrorAction SilentlyContinue
                $launcherStartedAt = Get-OptionalPropertyValue `
                    -InputObject $runtimeState `
                    -Name "launcherStartedAt"
                $expectedRunner = Join-Path `
                    $DeploymentRoot `
                    "current\deploy\windows\Run-App.ps1"
                if (
                    $null -eq $launcher -or
                    -not (Test-SamePath `
                        -Left ([string]$launcher.ExecutablePath) `
                        -Right (Get-WindowsPowerShellPath)) -or
                    -not (Test-CommandLineToken `
                        -CommandLine ([string]$launcher.CommandLine) `
                        -Token $expectedRunner) -or
                    $null -eq $launcherStartedAt -or
                    [Math]::Abs((
                        [DateTime]::Parse(
                            [string]$launcherStartedAt
                        ).ToUniversalTime() -
                        ([DateTime]$launcher.CreationDate).ToUniversalTime()
                    ).TotalSeconds) -gt 5
                ) {
                    $terminalFailure = "受控进程启动器已经退出或 PID 身份不符"
                    break
                }
            }
            else {
                $task = Get-AppScheduledTaskByName `
                    -Name $ApplicationTaskName
                Assert-AppScheduledTaskBinding `
                    -Task $task `
                    -DeploymentRoot $DeploymentRoot `
                    -NodeExecutable $NodeExecutable `
                    -ApplicationPort $ApplicationPort
                if ($task.State -ne "Running") {
                    $terminalFailure = (
                        "计划任务在候选进程启动后变为 $($task.State)"
                    )
                    break
                }
            }

            if (-not $AllowLegacyLauncher) {
                $instanceNonce = Get-OptionalPropertyValue `
                    -InputObject $runtimeState `
                    -Name "instanceNonce"
                if (
                    $null -eq $instanceNonce -or
                    [string]$instanceNonce -notmatch "^[a-fA-F0-9]{32}$"
                ) {
                    throw "候选版本未启用受控停机 nonce"
                }
            }

            $managedProcess = Get-ManagedAppProcess `
                -RuntimeState $runtimeState `
                -ExpectedNodeExecutable $NodeExecutable `
                -ExpectedEntryPoint $entryPoint `
                -ExpectedRoot $DeploymentRoot `
                -ExpectedPort $ApplicationPort `
                -AllowLegacyIdentity ([bool]$AllowLegacyLauncher)
            if ($null -eq $managedProcess) {
                throw "状态文件中的 Node 进程不存在"
            }

            $processId = [int]$managedProcess.ProcessId
            $listenerIds = @(
                Get-PortListenerProcessIds -LocalPort $ApplicationPort
            )
            if ($listenerIds.Count -ne 1 -or $listenerIds[0] -ne $processId) {
                throw "监听端口与状态文件 PID 不一致"
            }

            $response = Invoke-WebRequest `
                -Uri $healthUri `
                -UseBasicParsing `
                -TimeoutSec 5
            if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 400) {
                throw "健康检查返回 HTTP $($response.StatusCode)"
            }

            $health = $response.Content | ConvertFrom-Json
            if (
                [string]$health.data.status -ne "ok" -or
                [string]$health.data.database -ne "PGLITE" -or
                [int]$health.data.instrumentCount -le 0
            ) {
                throw (
                    "健康响应内容不完整：status=$($health.data.status)，" +
                    "database=$($health.data.database)，" +
                    "instrumentCount=$($health.data.instrumentCount)"
                )
            }

            if ($healthyProcessId -ne $processId) {
                $healthyProcessId = $processId
                $healthySince = Get-Date
            }
            if (
                $null -ne $healthySince -and
                ((Get-Date) - $healthySince).TotalSeconds -ge
                    $minimumStableSeconds
            ) {
                return [pscustomobject]@{
                    ProcessId = $processId
                    HealthStatus = [int]$response.StatusCode
                    StartedAt = [string]$startedAtValue
                    StableSeconds = $minimumStableSeconds
                    InstrumentCount = [int]$health.data.instrumentCount
                }
            }
        }
        catch {
            $lastError = $_.Exception.Message
            $healthySince = $null
            $healthyProcessId = 0
        }

        Start-Sleep -Seconds 1
    } while ((Get-Date) -lt $deadline)

    if ($null -ne $terminalFailure) {
        throw "候选应用启动失败：$terminalFailure"
    }

    throw (
        "应用在 $TimeoutSeconds 秒内未形成任务、PID、端口和健康闭环。" +
        "最后错误：$lastError"
    )
}

function Start-AppTaskAndWait {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DeploymentRoot,

        [Parameter(Mandatory = $true)]
        [string]$ApplicationTaskName,

        [Parameter(Mandatory = $true)]
        [string]$NodeExecutable,

        [Parameter(Mandatory = $true)]
        [int]$ApplicationPort,

        [Parameter(Mandatory = $true)]
        [int]$TimeoutSeconds,

        [Parameter(Mandatory = $true)]
        [bool]$ProcessLauncher,

        [string]$ExplicitPythonPath,

        [bool]$RealMarketSyncDisabled = $false,

        [bool]$AiTradingDisabled = $false,

        [switch]$AllowLegacyLauncher
    )

    $listenerIds = @(
        Get-PortListenerProcessIds -LocalPort $ApplicationPort
    )
    if ($listenerIds.Count -gt 0) {
        throw (
            "启动任务前端口 $ApplicationPort 已被占用；所有者 PID：" +
            ($listenerIds -join ",")
        )
    }

    $notBefore = (Get-Date).ToUniversalTime()
    $expectedLauncherProcessId = 0
    if ($ProcessLauncher) {
        $runnerPath = Join-Path `
            $DeploymentRoot `
            "current\deploy\windows\Run-App.ps1"
        if (-not (Test-Path -LiteralPath $runnerPath -PathType Leaf)) {
            throw "进程启动器不存在：$runnerPath"
        }
        $argumentParts = @(
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy", "Bypass",
            "-File", (ConvertTo-TaskQuotedArgument -Value $runnerPath),
            "-Root", (ConvertTo-TaskQuotedArgument -Value $DeploymentRoot),
            "-NodePath", (ConvertTo-TaskQuotedArgument -Value $NodeExecutable),
            "-Port", ([string]$ApplicationPort)
        )
        if (-not [string]::IsNullOrWhiteSpace($ExplicitPythonPath)) {
            $argumentParts += @(
                "-PythonPath",
                (ConvertTo-TaskQuotedArgument -Value $ExplicitPythonPath)
            )
        }
        if ($RealMarketSyncDisabled) {
            $argumentParts += "-DisableRealMarketSync"
        }
        if ($AiTradingDisabled) {
            $argumentParts += "-DisableAiTrading"
        }

        $launcherProcess = Start-Process `
            -FilePath (Get-WindowsPowerShellPath) `
            -ArgumentList ($argumentParts -join " ") `
            -WindowStyle Hidden `
            -PassThru
        $expectedLauncherProcessId = $launcherProcess.Id
    }
    else {
        $task = Get-AppScheduledTaskByName `
            -Name $ApplicationTaskName
        Assert-AppScheduledTaskBinding `
            -Task $task `
            -DeploymentRoot $DeploymentRoot `
            -NodeExecutable $NodeExecutable `
            -ApplicationPort $ApplicationPort
        Enable-ScheduledTask `
            -TaskName $ApplicationTaskName `
            -TaskPath "\" | Out-Null
        Start-ScheduledTask `
            -TaskName $ApplicationTaskName `
            -TaskPath "\"
    }

    return Wait-ManagedAppHealthy `
        -DeploymentRoot $DeploymentRoot `
        -ApplicationTaskName $ApplicationTaskName `
        -NodeExecutable $NodeExecutable `
        -ApplicationPort $ApplicationPort `
        -NotBefore $notBefore `
        -TimeoutSeconds $TimeoutSeconds `
        -ProcessLauncher $ProcessLauncher `
        -ExpectedLauncherProcessId $expectedLauncherProcessId `
        -AllowLegacyLauncher:$AllowLegacyLauncher
}

function Restore-InterruptedUpdate {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DeploymentRoot,

        [Parameter(Mandatory = $true)]
        [string]$ApplicationTaskName,

        [Parameter(Mandatory = $true)]
        [string]$NodeExecutable,

        [Parameter(Mandatory = $true)]
        [int]$ApplicationPort,

        [Parameter(Mandatory = $true)]
        [string]$CurrentDirectory,

        [Parameter(Mandatory = $true)]
        [string]$WorkDirectory,

        [Parameter(Mandatory = $true)]
        [string]$BackupDirectory,

        [Parameter(Mandatory = $true)]
        [string]$FailedDirectory,

        [Parameter(Mandatory = $true)]
        [string]$UpdateStatePath,

        [Parameter(Mandatory = $true)]
        [int]$GracefulTimeoutSeconds,

        [Parameter(Mandatory = $true)]
        [int]$QuiesceSeconds,

        [Parameter(Mandatory = $true)]
        [int]$StartupTimeoutSeconds,

        [Parameter(Mandatory = $true)]
        [bool]$ProcessLauncher,

        [string]$ExplicitPythonPath,

        [bool]$RealMarketSyncDisabled = $false,

        [bool]$AiTradingDisabled = $false,

        [Parameter(Mandatory = $true)]
        [string]$UpdateLog
    )

    $state = Read-AppRuntimeState -Path $UpdateStatePath
    if ($null -eq $state) {
        return
    }

    $status = [string](Get-OptionalPropertyValue `
        -InputObject $state `
        -Name "status")
    if ($status -in @("completed", "rolled-back", "recovered")) {
        return
    }

    $transactionId = [string](Get-OptionalPropertyValue `
        -InputObject $state `
        -Name "transactionId")
    if (
        $transactionId -notmatch
        "^[0-9]{8}-[0-9]{6}-[0-9]{3}-[a-fA-F0-9]{8}$"
    ) {
        throw (
            "发现非终态更新记录，但事务 ID 无效，拒绝猜测恢复路径：" +
            $transactionId
        )
    }

    $recordedLauncherMode = Get-OptionalPropertyValue `
        -InputObject $state `
        -Name "processLauncher"
    if (
        $null -ne $recordedLauncherMode -and
        $recordedLauncherMode -isnot [bool]
    ) {
        throw "上次中断更新的启动模式字段损坏，拒绝猜测恢复。"
    }
    if (
        $null -ne $recordedLauncherMode -and
        [bool]$recordedLauncherMode -ne $ProcessLauncher
    ) {
        throw (
            "上次中断更新使用的启动模式与本次不同；请使用相同的 " +
            "-UseProcessLauncher 设置重试。"
        )
    }

    $candidatePath = Get-OptionalPropertyValue `
        -InputObject $state `
        -Name "candidate"
    if ([string]::IsNullOrWhiteSpace([string]$candidatePath)) {
        $candidatePath = Join-Path `
            (Join-Path $WorkDirectory $transactionId) `
            "candidate"
    }
    $backupPath = Get-OptionalPropertyValue `
        -InputObject $state `
        -Name "backup"
    if ([string]::IsNullOrWhiteSpace([string]$backupPath)) {
        $backupPath = Join-Path $BackupDirectory "app-$transactionId"
    }
    $failedPath = Get-OptionalPropertyValue `
        -InputObject $state `
        -Name "recoveryFailed"
    if ([string]::IsNullOrWhiteSpace([string]$failedPath)) {
        $failedPath = Join-Path `
            $FailedDirectory `
            "app-$transactionId-recovery"
    }

    $candidatePath = Get-CanonicalPath -Path ([string]$candidatePath)
    $backupPath = Get-CanonicalPath -Path ([string]$backupPath)
    $failedPath = Get-CanonicalPath -Path ([string]$failedPath)
    Assert-PathWithin `
        -Path $candidatePath `
        -Parent $WorkDirectory `
        -Description "中断事务候选目录"
    Assert-PathWithin `
        -Path $backupPath `
        -Parent $BackupDirectory `
        -Description "中断事务备份目录"
    Assert-PathWithin `
        -Path $failedPath `
        -Parent $FailedDirectory `
        -Description "中断事务隔离目录"
    foreach ($controlledPath in @(
        $CurrentDirectory,
        $candidatePath,
        $backupPath,
        $failedPath
    )) {
        Assert-NoReparsePointInPathChain `
            -Path $controlledPath `
            -Description "中断事务恢复"
    }

    $candidateDependenciesValue = Get-OptionalPropertyValue `
        -InputObject $state `
        -Name "candidateHasNodeModules"
    if (
        $null -ne $candidateDependenciesValue -and
        $candidateDependenciesValue -isnot [bool]
    ) {
        throw "中断事务的依赖模式字段损坏，拒绝猜测恢复。"
    }
    $candidateHadOwnDependencies = [bool]$candidateDependenciesValue
    $reusedDependencies = -not $candidateHadOwnDependencies
    $backupExists = Test-Path -LiteralPath $backupPath -PathType Container
    $currentExists = Test-Path `
        -LiteralPath $CurrentDirectory `
        -PathType Container
    $candidateExists = Test-Path `
        -LiteralPath $candidatePath `
        -PathType Container
    $serviceStoppedValue = Get-OptionalPropertyValue `
        -InputObject $state `
        -Name "serviceStopped"
    if (
        $null -ne $serviceStoppedValue -and
        $serviceStoppedValue -isnot [bool]
    ) {
        throw "中断事务的停机状态字段损坏，拒绝猜测恢复。"
    }
    $serviceWasStopped = [bool]$serviceStoppedValue
    $currentNeedsDependencyRestore = (
        $currentExists -and
        $reusedDependencies -and
        -not (
            Test-Path `
                -LiteralPath (Join-Path $CurrentDirectory "node_modules") `
                -PathType Container
        )
    )
    $initialListenerIds = @(
        Get-PortListenerProcessIds -LocalPort $ApplicationPort
    )
    $requiresStoppedRecovery = (
        $backupExists -or
        $currentNeedsDependencyRestore -or
        $status -notin @("staging", "candidate-ready") -or
        $initialListenerIds.Count -eq 0
    )
    $recoveryFence = $null

    Write-LauncherLog -Path $UpdateLog -Message (
        "发现未完成更新并进入自恢复；Transaction=$transactionId；" +
        "Status=$status；Current=$currentExists；Backup=$backupExists；" +
        "Candidate=$candidateExists。"
    )
    Write-AtomicJson -Path $UpdateStatePath -Value ([ordered]@{
        transactionId = $transactionId
        status = "recovery-in-progress"
        recoveryStartedAt = (Get-Date).ToUniversalTime().ToString("o")
        candidate = $candidatePath
        backup = $backupPath
        recoveryFailed = $failedPath
        candidateHasNodeModules = $candidateHadOwnDependencies
        processLauncher = $ProcessLauncher
        serviceStopped = $serviceWasStopped
        log = $UpdateLog
    })

    try {
    if ($requiresStoppedRecovery) {
        $recoveryStopOutcome = $null
        try {
            Stop-AppInstance `
                -DeploymentRoot $DeploymentRoot `
                -ApplicationTaskName $ApplicationTaskName `
                -NodeExecutable $NodeExecutable `
                -ApplicationPort $ApplicationPort `
                -GracefulTimeoutSeconds $GracefulTimeoutSeconds `
                -QuiesceSeconds $QuiesceSeconds `
                -ForcedStopAllowed $false `
                -ProcessLauncher $ProcessLauncher `
                -UpdateLog $UpdateLog `
                -Outcome ([ref]$recoveryStopOutcome)
        }
        finally {
            if (
                $null -ne $recoveryStopOutcome -and
                $recoveryStopOutcome.ProcessStopped
            ) {
                $serviceWasStopped = $true
            }
            if (
                $null -ne $recoveryStopOutcome -and
                $null -ne $recoveryStopOutcome.StartupFence
            ) {
                $recoveryFence = $recoveryStopOutcome.StartupFence
            }
        }
    }

    if ($backupExists) {
        if (
            (Test-Path -LiteralPath $CurrentDirectory -PathType Container)
        ) {
            if (Test-Path -LiteralPath $failedPath) {
                throw "中断事务隔离目录已存在，拒绝覆盖：$failedPath"
            }
            Move-Item `
                -LiteralPath $CurrentDirectory `
                -Destination $failedPath
        }

        if ($reusedDependencies) {
            $backupNodeModules = Join-Path $backupPath "node_modules"
            if (
                -not (
                    Test-Path `
                        -LiteralPath $backupNodeModules `
                        -PathType Container
                )
            ) {
                $dependencyCandidates = @(
                    (Join-Path $failedPath "node_modules"),
                    (Join-Path $candidatePath "node_modules")
                )
                $dependencySource = $dependencyCandidates |
                    Where-Object {
                        Test-Path -LiteralPath $_ -PathType Container
                    } |
                    Select-Object -First 1
                if ($null -eq $dependencySource) {
                    throw "中断事务无法找回旧版本 node_modules。"
                }
                Move-Item `
                    -LiteralPath $dependencySource `
                    -Destination $backupNodeModules
            }
        }

        if (
            Test-Path -LiteralPath $CurrentDirectory -PathType Container
        ) {
            throw "恢复旧版本前 current 仍然存在，拒绝覆盖。"
        }
        Move-Item -LiteralPath $backupPath -Destination $CurrentDirectory
        $currentExists = $true
    }
    elseif ($currentExists -and $reusedDependencies) {
        $currentNodeModules = Join-Path $CurrentDirectory "node_modules"
        if (
            -not (
                Test-Path `
                    -LiteralPath $currentNodeModules `
                    -PathType Container
            )
        ) {
            $candidateNodeModules = Join-Path $candidatePath "node_modules"
            if (
                -not (
                    Test-Path `
                        -LiteralPath $candidateNodeModules `
                        -PathType Container
                )
            ) {
                throw "current 与候选目录均缺少可恢复的 node_modules。"
            }
            Move-Item `
                -LiteralPath $candidateNodeModules `
                -Destination $currentNodeModules
            $serviceWasStopped = $true
        }
    }
    elseif (-not $currentExists) {
        throw "中断事务同时缺少 current 和 backup，无法自动恢复。"
    }

    if ($null -ne $recoveryFence) {
        $recoveryFence.Dispose()
        $recoveryFence = $null
    }
    $ready = $null
    $listenerIds = @(
        Get-PortListenerProcessIds -LocalPort $ApplicationPort
    )
    if ($listenerIds.Count -eq 0 -and ($serviceWasStopped -or $backupExists)) {
        $ready = Start-AppTaskAndWait `
            -DeploymentRoot $DeploymentRoot `
            -ApplicationTaskName $ApplicationTaskName `
            -NodeExecutable $NodeExecutable `
            -ApplicationPort $ApplicationPort `
            -TimeoutSeconds $StartupTimeoutSeconds `
            -ProcessLauncher $ProcessLauncher `
            -ExplicitPythonPath $ExplicitPythonPath `
            -RealMarketSyncDisabled $RealMarketSyncDisabled `
            -AiTradingDisabled $AiTradingDisabled `
            -AllowLegacyLauncher
    }
    elseif ($listenerIds.Count -eq 1) {
        $runtimeState = Read-AppRuntimeState -Path (
            Join-Path $DeploymentRoot "runtime\app-latest.json"
        )
        if ($null -eq $runtimeState) {
            throw "恢复后端口已有监听，但缺少可验证的应用状态。"
        }
        $managedProcess = Get-ManagedAppProcess `
            -RuntimeState $runtimeState `
            -ExpectedNodeExecutable $NodeExecutable `
            -ExpectedEntryPoint (
                Join-Path $CurrentDirectory "server\dist\index.js"
            ) `
            -ExpectedRoot $DeploymentRoot `
            -ExpectedPort $ApplicationPort
        if (
            $null -eq $managedProcess -or
            [int]$managedProcess.ProcessId -ne [int]$listenerIds[0]
        ) {
            throw "恢复后的监听进程不属于当前部署。"
        }

        $recordedStartedAt = Get-OptionalPropertyValue `
            -InputObject $runtimeState `
            -Name "processStartedAt"
        if ($null -eq $recordedStartedAt) {
            $recordedStartedAt = Get-OptionalPropertyValue `
                -InputObject $runtimeState `
                -Name "startedAt"
        }
        if ($null -eq $recordedStartedAt) {
            throw "恢复后的已有服务缺少可验证的启动时间。"
        }
        $recordedStartedAtValue = [DateTime]::Parse(
            [string]$recordedStartedAt
        ).ToUniversalTime()
        $expectedLauncherProcessId = 0
        if ($ProcessLauncher) {
            $expectedLauncherProcessId = [int](
                Get-OptionalPropertyValue `
                    -InputObject $runtimeState `
                    -Name "launcherProcessId"
            )
        }
        $ready = Wait-ManagedAppHealthy `
            -DeploymentRoot $DeploymentRoot `
            -ApplicationTaskName $ApplicationTaskName `
            -NodeExecutable $NodeExecutable `
            -ApplicationPort $ApplicationPort `
            -NotBefore $recordedStartedAtValue.AddSeconds(-1) `
            -TimeoutSeconds $StartupTimeoutSeconds `
            -ProcessLauncher $ProcessLauncher `
            -ExpectedLauncherProcessId $expectedLauncherProcessId `
            -AllowLegacyLauncher
    }
    elseif ($listenerIds.Count -gt 1) {
        throw "恢复后出现多个端口监听所有者，拒绝继续。"
    }

    Write-AtomicJson -Path $UpdateStatePath -Value ([ordered]@{
        transactionId = $transactionId
        status = "recovered"
        recoveredAt = (Get-Date).ToUniversalTime().ToString("o")
        restoredCurrent = $CurrentDirectory
        isolatedCandidate = $failedPath
        processId = if ($null -ne $ready) { $ready.ProcessId } else { $null }
        log = $UpdateLog
        dataDirectoryTouched = $false
    })
    Write-LauncherLog -Path $UpdateLog -Message (
        "中断更新已恢复到旧版本；Transaction=$transactionId。"
    )
    }
    finally {
        if ($null -ne $recoveryFence) {
            $recoveryFence.Dispose()
        }
    }
}

Assert-LocalFileSystemPath -Path $Root -Description "部署根目录"
Assert-LocalFileSystemPath -Path $SourceDirectory -Description "候选发布目录"
if (-not $UseProcessLauncher) {
    Assert-WindowsAdministrator
}
$assertedRoot = Assert-SafeDeploymentRoot -Root $Root
$safeRoot = Get-CanonicalPath -Path $assertedRoot
$sourcePath = Get-CanonicalPath -Path $SourceDirectory
$currentDirectory = Join-Path $safeRoot "current"
$runtimeDirectory = Join-Path $safeRoot "runtime"
$backupDirectory = Join-Path $runtimeDirectory "backups"
$failedDirectory = Join-Path $runtimeDirectory "failed-updates"
$workDirectory = Join-Path $runtimeDirectory "update-work"

if (-not (Test-Path -LiteralPath $safeRoot -PathType Container)) {
    throw "部署根目录不存在，更新器不会创建新部署：$safeRoot"
}
if (-not (Test-Path -LiteralPath $sourcePath -PathType Container)) {
    throw "候选发布目录不存在：$sourcePath"
}
if (Test-PathsOverlap -Left $sourcePath -Right $safeRoot) {
    throw (
        "候选发布目录必须与整个部署根目录完全分离，不能相互包含。" +
        "请把发布包放到部署根目录的同级临时目录：$sourcePath"
    )
}
Assert-NoReparsePointInPathChain `
    -Path $safeRoot `
    -Description "部署根目录"
foreach ($protectedPath in @(
    (Join-Path $safeRoot "data"),
    $currentDirectory,
    $runtimeDirectory,
    $backupDirectory,
    $failedDirectory,
    $workDirectory
)) {
    Assert-NoReparsePointInPathChain `
        -Path $protectedPath `
        -Description "部署受控目录"
}
Assert-NoReparsePointInPathChain `
    -Path $sourcePath `
    -Description "候选发布目录"
Assert-NoReparsePoints -Path $sourcePath

Ensure-Directory -Path $runtimeDirectory
Assert-NoReparsePointInPathChain `
    -Path $runtimeDirectory `
    -Description "更新运行目录"
$lockPath = Join-Path $runtimeDirectory "app-update.lock"
$lockStream = $null
try {
    $lockStream = [IO.File]::Open(
        $lockPath,
        [IO.FileMode]::OpenOrCreate,
        [IO.FileAccess]::ReadWrite,
        [IO.FileShare]::None
    )
}
catch {
    throw "已有另一个更新事务正在运行：$lockPath"
}

$transactionId = (
    (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss-fff") +
    "-" +
    [Guid]::NewGuid().ToString("N").Substring(0, 8)
)
$transactionDirectory = Join-Path $workDirectory $transactionId
$candidateDirectory = Join-Path $transactionDirectory "candidate"
$backupPath = Join-Path $backupDirectory "app-$transactionId"
$failedPath = Join-Path $failedDirectory "app-$transactionId"
$updateStatePath = Join-Path $runtimeDirectory "app-update-latest.json"
$resolvedNodePath = $null
$oldReleaseMoved = $false
$candidateActivated = $false
$dependenciesTransferred = $false
$candidateHasNodeModules = $false
$serviceStopped = $false
$transactionStarted = $false
$logs = $null
$activationFence = $null

try {
    Ensure-Directory -Path $backupDirectory
    Ensure-Directory -Path $failedDirectory
    Ensure-Directory -Path $workDirectory
    foreach ($controlledDirectory in @(
        $backupDirectory,
        $failedDirectory,
        $workDirectory
    )) {
        Assert-NoReparsePointInPathChain `
            -Path $controlledDirectory `
            -Description "更新运行目录"
    }
    $logs = New-TraceLogSet `
        -Root $safeRoot `
        -Name "update" `
        -RetentionCount $LogRetentionCount
    $resolvedNodePath = Resolve-NodeExecutable `
        -Root $safeRoot `
        -NodePath $NodePath

    Restore-InterruptedUpdate `
        -DeploymentRoot $safeRoot `
        -ApplicationTaskName $TaskName `
        -NodeExecutable $resolvedNodePath `
        -ApplicationPort $Port `
        -CurrentDirectory $currentDirectory `
        -WorkDirectory $workDirectory `
        -BackupDirectory $backupDirectory `
        -FailedDirectory $failedDirectory `
        -UpdateStatePath $updateStatePath `
        -GracefulTimeoutSeconds $GracefulStopTimeoutSeconds `
        -QuiesceSeconds $PostStopQuiesceSeconds `
        -StartupTimeoutSeconds $StartupTimeoutSeconds `
        -ProcessLauncher ([bool]$UseProcessLauncher) `
        -ExplicitPythonPath $PythonPath `
        -RealMarketSyncDisabled ([bool]$DisableRealMarketSync) `
        -AiTradingDisabled ([bool]$DisableAiTrading) `
        -UpdateLog $logs.Launcher
    if (-not (Test-Path -LiteralPath $currentDirectory -PathType Container)) {
        throw "中断事务恢复后 current 仍不存在：$currentDirectory"
    }

    Write-LauncherLog -Path $logs.Launcher -Message (
        "开始无损代码更新；Transaction=$transactionId；" +
        "Source=$sourcePath；Root=$safeRoot"
    )
    Write-AtomicJson -Path $updateStatePath -Value ([ordered]@{
        transactionId = $transactionId
        status = "staging"
        startedAt = (Get-Date).ToUniversalTime().ToString("o")
        source = $sourcePath
        candidate = $candidateDirectory
        backup = $backupPath
        failedCandidate = $failedPath
        candidateHasNodeModules = $false
        processLauncher = [bool]$UseProcessLauncher
        log = $logs.Launcher
    })
    $transactionStarted = $true

    Ensure-Directory -Path $transactionDirectory
    Copy-DirectoryContents `
        -Source $sourcePath `
        -Destination $candidateDirectory
    Assert-NoReparsePoints -Path $candidateDirectory
    Assert-CandidateRelease `
        -Candidate $candidateDirectory `
        -Current $currentDirectory `
        -NodeExecutable $resolvedNodePath
    Add-CandidateWorkspaceLink `
        -Candidate $candidateDirectory `
        -FinalCurrentDirectory $currentDirectory

    $candidateHasNodeModules = Test-Path `
        -LiteralPath (Join-Path $candidateDirectory "node_modules") `
        -PathType Container
    Write-AtomicJson -Path $updateStatePath -Value ([ordered]@{
        transactionId = $transactionId
        status = "candidate-ready"
        updatedAt = (Get-Date).ToUniversalTime().ToString("o")
        source = $sourcePath
        candidate = $candidateDirectory
        backup = $backupPath
        failedCandidate = $failedPath
        candidateHasNodeModules = $candidateHasNodeModules
        processLauncher = [bool]$UseProcessLauncher
        serviceStopped = $false
        log = $logs.Launcher
    })
    Write-LauncherLog -Path $logs.Launcher -Message (
        "候选版本预检完成；携带独立依赖=$candidateHasNodeModules。"
    )

    $stopOutcome = $null
    try {
        Stop-AppInstance `
            -DeploymentRoot $safeRoot `
            -ApplicationTaskName $TaskName `
            -NodeExecutable $resolvedNodePath `
            -ApplicationPort $Port `
            -GracefulTimeoutSeconds $GracefulStopTimeoutSeconds `
            -QuiesceSeconds $PostStopQuiesceSeconds `
            -ForcedStopAllowed ([bool]$AllowForcedStop) `
            -ProcessLauncher ([bool]$UseProcessLauncher) `
            -UpdateLog $logs.Launcher `
            -Outcome ([ref]$stopOutcome)
    }
    finally {
        if ($null -ne $stopOutcome -and $stopOutcome.ProcessStopped) {
            $serviceStopped = $true
        }
        if (
            $null -ne $stopOutcome -and
            $null -ne $stopOutcome.StartupFence
        ) {
            $activationFence = $stopOutcome.StartupFence
        }
    }
    Write-AtomicJson -Path $updateStatePath -Value ([ordered]@{
        transactionId = $transactionId
        status = "service-stopped"
        updatedAt = (Get-Date).ToUniversalTime().ToString("o")
        source = $sourcePath
        candidate = $candidateDirectory
        backup = $backupPath
        failedCandidate = $failedPath
        candidateHasNodeModules = $candidateHasNodeModules
        processLauncher = [bool]$UseProcessLauncher
        serviceStopped = $serviceStopped
        gracefulStopConfirmed = [bool]$stopOutcome.GracefulStopConfirmed
        log = $logs.Launcher
    })

    if (-not $candidateHasNodeModules) {
        $currentNodeModules = Join-Path $currentDirectory "node_modules"
        $candidateNodeModules = Join-Path $candidateDirectory "node_modules"
        Write-AtomicJson -Path $updateStatePath -Value ([ordered]@{
            transactionId = $transactionId
            status = "transferring-dependencies"
            updatedAt = (Get-Date).ToUniversalTime().ToString("o")
            candidate = $candidateDirectory
            backup = $backupPath
            failedCandidate = $failedPath
            candidateHasNodeModules = $false
            processLauncher = [bool]$UseProcessLauncher
            serviceStopped = $serviceStopped
            log = $logs.Launcher
        })
        Move-Item `
            -LiteralPath $currentNodeModules `
            -Destination $candidateNodeModules
        $dependenciesTransferred = $true
        Write-AtomicJson -Path $updateStatePath -Value ([ordered]@{
            transactionId = $transactionId
            status = "dependencies-transferred"
            updatedAt = (Get-Date).ToUniversalTime().ToString("o")
            candidate = $candidateDirectory
            backup = $backupPath
            failedCandidate = $failedPath
            candidateHasNodeModules = $false
            dependenciesTransferred = $true
            processLauncher = [bool]$UseProcessLauncher
            serviceStopped = $serviceStopped
            log = $logs.Launcher
        })
        Write-LauncherLog -Path $logs.Launcher -Message (
            "已复用锁文件一致的当前生产依赖。"
        )
    }

    Write-AtomicJson -Path $updateStatePath -Value ([ordered]@{
        transactionId = $transactionId
        status = "moving-current-to-backup"
        updatedAt = (Get-Date).ToUniversalTime().ToString("o")
        candidate = $candidateDirectory
        backup = $backupPath
        failedCandidate = $failedPath
        candidateHasNodeModules = $candidateHasNodeModules
        dependenciesTransferred = $dependenciesTransferred
        processLauncher = [bool]$UseProcessLauncher
        serviceStopped = $serviceStopped
        log = $logs.Launcher
    })
    Move-Item -LiteralPath $currentDirectory -Destination $backupPath
    $oldReleaseMoved = $true
    Write-AtomicJson -Path $updateStatePath -Value ([ordered]@{
        transactionId = $transactionId
        status = "old-release-moved"
        updatedAt = (Get-Date).ToUniversalTime().ToString("o")
        candidate = $candidateDirectory
        backup = $backupPath
        failedCandidate = $failedPath
        candidateHasNodeModules = $candidateHasNodeModules
        dependenciesTransferred = $dependenciesTransferred
        processLauncher = [bool]$UseProcessLauncher
        serviceStopped = $serviceStopped
        log = $logs.Launcher
    })
    Write-AtomicJson -Path $updateStatePath -Value ([ordered]@{
        transactionId = $transactionId
        status = "activating-candidate"
        updatedAt = (Get-Date).ToUniversalTime().ToString("o")
        candidate = $candidateDirectory
        backup = $backupPath
        failedCandidate = $failedPath
        candidateHasNodeModules = $candidateHasNodeModules
        dependenciesTransferred = $dependenciesTransferred
        processLauncher = [bool]$UseProcessLauncher
        serviceStopped = $serviceStopped
        log = $logs.Launcher
    })
    Move-Item `
        -LiteralPath $candidateDirectory `
        -Destination $currentDirectory
    $candidateActivated = $true

    Write-AtomicJson -Path $updateStatePath -Value ([ordered]@{
        transactionId = $transactionId
        status = "starting-candidate"
        startedAt = (Get-Date).ToUniversalTime().ToString("o")
        source = $sourcePath
        candidate = $candidateDirectory
        backup = $backupPath
        failedCandidate = $failedPath
        candidateHasNodeModules = $candidateHasNodeModules
        dependenciesTransferred = $dependenciesTransferred
        processLauncher = [bool]$UseProcessLauncher
        serviceStopped = $serviceStopped
        log = $logs.Launcher
    })

    if ($null -eq $activationFence) {
        throw "候选启动前缺少连续持有的启动器切换栅栏。"
    }
    $activationFence.Dispose()
    $activationFence = $null

    $ready = Start-AppTaskAndWait `
        -DeploymentRoot $safeRoot `
        -ApplicationTaskName $TaskName `
        -NodeExecutable $resolvedNodePath `
        -ApplicationPort $Port `
        -TimeoutSeconds $StartupTimeoutSeconds `
        -ProcessLauncher ([bool]$UseProcessLauncher) `
        -ExplicitPythonPath $PythonPath `
        -RealMarketSyncDisabled ([bool]$DisableRealMarketSync) `
        -AiTradingDisabled ([bool]$DisableAiTrading)

    Write-AtomicJson -Path $updateStatePath -Value ([ordered]@{
        transactionId = $transactionId
        status = "completed"
        completedAt = (Get-Date).ToUniversalTime().ToString("o")
        processId = $ready.ProcessId
        healthStatus = $ready.HealthStatus
        backup = $backupPath
        log = $logs.Launcher
        dataDirectoryTouched = $false
    })
    Write-LauncherLog -Path $logs.Launcher -Message (
        "更新完成；PID=$($ready.ProcessId)；Backup=$backupPath。"
    )

    [pscustomobject]@{
        TransactionId = $transactionId
        Status = "Completed"
        ProcessId = $ready.ProcessId
        HealthStatus = $ready.HealthStatus
        Backup = $backupPath
        Log = $logs.Launcher
        DataDirectoryTouched = $false
    } | ConvertTo-Json -Compress
}
catch {
    if (-not $transactionStarted) {
        $preflightMessage = (
            "更新前置恢复或安全检查失败，未开始新的代码切换：" +
            $_.Exception.Message
        )
        if ($null -ne $logs) {
            Write-LauncherLog `
                -Path $logs.Launcher `
                -Message $preflightMessage
        }
        else {
            Write-Host $preflightMessage
        }
        throw
    }

    $updateError = $_
    $rollbackError = $null
    Write-LauncherLog -Path $logs.Launcher -Message (
        "更新失败，开始自动回滚：$($updateError.Exception.Message)"
    )

    try {
        if ($candidateActivated -and $null -eq $activationFence) {
            $rollbackStopOutcome = $null
            try {
                Stop-AppInstance `
                    -DeploymentRoot $safeRoot `
                    -ApplicationTaskName $TaskName `
                    -NodeExecutable $resolvedNodePath `
                    -ApplicationPort $Port `
                    -GracefulTimeoutSeconds $GracefulStopTimeoutSeconds `
                    -QuiesceSeconds $PostStopQuiesceSeconds `
                    -ForcedStopAllowed ([bool]$AllowForcedStop) `
                    -ProcessLauncher ([bool]$UseProcessLauncher) `
                    -UpdateLog $logs.Launcher `
                    -Outcome ([ref]$rollbackStopOutcome)
            }
            finally {
                if (
                    $null -ne $rollbackStopOutcome -and
                    $rollbackStopOutcome.ProcessStopped
                ) {
                    $serviceStopped = $true
                }
                if (
                    $null -ne $rollbackStopOutcome -and
                    $null -ne $rollbackStopOutcome.StartupFence
                ) {
                    $activationFence = $rollbackStopOutcome.StartupFence
                }
            }
        }
        elseif ($candidateActivated) {
            Write-LauncherLog -Path $logs.Launcher -Message (
                "候选代码尚未获准启动；继续持有启动器栅栏并直接恢复旧版本。"
            )
        }

        if ($oldReleaseMoved) {
            if ($dependenciesTransferred) {
                $dependencySource = if ($candidateActivated) {
                    Join-Path $currentDirectory "node_modules"
                }
                else {
                    Join-Path $candidateDirectory "node_modules"
                }
                if (
                    Test-Path `
                        -LiteralPath $dependencySource `
                        -PathType Container
                ) {
                    Move-Item `
                        -LiteralPath $dependencySource `
                        -Destination (Join-Path $backupPath "node_modules")
                }
            }

            if (
                $candidateActivated -and
                (Test-Path `
                    -LiteralPath $currentDirectory `
                    -PathType Container)
            ) {
                Move-Item `
                    -LiteralPath $currentDirectory `
                    -Destination $failedPath
            }
            Move-Item `
                -LiteralPath $backupPath `
                -Destination $currentDirectory
            $oldReleaseMoved = $false
            $candidateActivated = $false
        }
        elseif ($dependenciesTransferred) {
            $candidateNodeModules = Join-Path `
                $candidateDirectory `
                "node_modules"
            if (
                Test-Path `
                    -LiteralPath $candidateNodeModules `
                    -PathType Container
            ) {
                Move-Item `
                    -LiteralPath $candidateNodeModules `
                    -Destination (Join-Path $currentDirectory "node_modules")
            }
        }

        if ($serviceStopped) {
            if ($null -ne $activationFence) {
                $activationFence.Dispose()
                $activationFence = $null
            }
            $rollbackReady = Start-AppTaskAndWait `
                -DeploymentRoot $safeRoot `
                -ApplicationTaskName $TaskName `
                -NodeExecutable $resolvedNodePath `
                -ApplicationPort $Port `
                -TimeoutSeconds $StartupTimeoutSeconds `
                -ProcessLauncher ([bool]$UseProcessLauncher) `
                -ExplicitPythonPath $PythonPath `
                -RealMarketSyncDisabled ([bool]$DisableRealMarketSync) `
                -AiTradingDisabled ([bool]$DisableAiTrading) `
                -AllowLegacyLauncher
            Write-LauncherLog -Path $logs.Launcher -Message (
                "旧版本已恢复并重新受计划任务托管；" +
                "PID=$($rollbackReady.ProcessId)。"
            )
        }
    }
    catch {
        $rollbackError = $_
        Write-LauncherLog -Path $logs.Launcher -Message (
            "自动回滚未能恢复健康服务：$($_.Exception.Message)"
        )
    }

    Write-AtomicJson -Path $updateStatePath -Value ([ordered]@{
        transactionId = $transactionId
        status = if ($null -eq $rollbackError) {
            "rolled-back"
        }
        else {
            "rollback-failed"
        }
        failedAt = (Get-Date).ToUniversalTime().ToString("o")
        updateError = $updateError.Exception.Message
        rollbackError = if ($null -eq $rollbackError) {
            $null
        }
        else {
            $rollbackError.Exception.Message
        }
        backup = $backupPath
        failedCandidate = $failedPath
        log = $logs.Launcher
        dataDirectoryTouched = $false
    })

    if ($null -ne $rollbackError) {
        throw (
            "更新失败且自动回滚未恢复服务。更新错误：{0}；回滚错误：{1}；" +
            "日志：{2}" -f
                $updateError.Exception.Message,
                $rollbackError.Exception.Message,
                $logs.Launcher
        )
    }

    throw (
        "更新失败，旧版本已自动恢复。原因：{0}；日志：{1}" -f
            $updateError.Exception.Message,
            $logs.Launcher
    )
}
finally {
    if ($null -ne $activationFence) {
        $activationFence.Dispose()
    }
    if ($null -ne $lockStream) {
        $lockStream.Dispose()
    }
}
