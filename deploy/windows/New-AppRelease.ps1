[CmdletBinding()]
param(
    [string]$ProjectRoot = (
        [System.IO.Path]::GetFullPath(
            (Join-Path $PSScriptRoot "..\..")
        )
    ),

    [Parameter(Mandatory = $true)]
    [string]$DestinationDirectory,

    [switch]$SkipBuild,

    [switch]$ReuseServerDependencies,

    [switch]$ConfirmBackwardCompatibleMigrations
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

. (Join-Path $PSScriptRoot "_Common.ps1")

Normalize-ProcessPathEnvironment

function ConvertTo-NormalizedFullPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    return ConvertTo-NormalizedWindowsPath -Path $Path
}

function Test-IsSameOrDescendantPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$ParentPath
    )

    $candidate = ConvertTo-NormalizedFullPath -Path $Path
    $parent = ConvertTo-NormalizedFullPath -Path $ParentPath
    if (
        [string]::Equals(
            $candidate,
            $parent,
            [StringComparison]::OrdinalIgnoreCase
        )
    ) {
        return $true
    }

    $prefix = $parent
    if (
        -not $prefix.EndsWith(
            [string][System.IO.Path]::DirectorySeparatorChar,
            [StringComparison]::Ordinal
        )
    ) {
        $prefix += [System.IO.Path]::DirectorySeparatorChar
    }

    return $candidate.StartsWith(
        $prefix,
        [StringComparison]::OrdinalIgnoreCase
    )
}

function Assert-NoReparsePointInPathOrAncestors {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$Description
    )

    $currentPath = ConvertTo-NormalizedFullPath -Path $Path
    while ($true) {
        $attributes = $null
        try {
            $attributes = [System.IO.File]::GetAttributes($currentPath)
        }
        catch [System.IO.FileNotFoundException] {
            # 尚未创建的目标路径是正常状态，继续检查其现有祖先。
        }
        catch [System.IO.DirectoryNotFoundException] {
            # 中间目录尚未创建时，继续向上检查最近的现有祖先。
        }
        catch {
            throw "无法安全检查${Description}路径属性：$currentPath；$($_.Exception.Message)"
        }

        if (
            $null -ne $attributes -and
            (
                $attributes -band
                [System.IO.FileAttributes]::ReparsePoint
            ) -ne 0
        ) {
            throw "${Description}路径或其祖先包含链接/目录联接，拒绝继续：$currentPath"
        }

        $pathRoot = ConvertTo-NormalizedFullPath -Path (
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
        $currentPath = ConvertTo-NormalizedFullPath -Path $parent.FullName
    }
}

function Copy-ReleaseItem {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Source,

        [Parameter(Mandatory = $true)]
        [string]$Destination
    )

    $parent = Split-Path -Parent $Destination
    Ensure-Directory -Path $parent
    Copy-Item `
        -LiteralPath $Source `
        -Destination $Destination `
        -Recurse `
        -Force
}

function Copy-DirectoryWithoutJunctions {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Source,

        [Parameter(Mandatory = $true)]
        [string]$Destination
    )

    $robocopy = Join-Path $env:SystemRoot "System32\robocopy.exe"
    if (-not (Test-Path -LiteralPath $robocopy -PathType Leaf)) {
        throw "未找到 robocopy.exe，无法生成无目录联接的依赖包。"
    }

    Ensure-Directory -Path $Destination
    & $robocopy `
        $Source `
        $Destination `
        /E `
        /XJ `
        /COPY:DAT `
        /DCOPY:DAT `
        /R:1 `
        /W:1 `
        /NFL `
        /NDL `
        /NJH `
        /NJS `
        /NP
    $robocopyExitCode = $LASTEXITCODE
    if ($robocopyExitCode -gt 7) {
        throw "robocopy 复制生产依赖失败，退出码：$robocopyExitCode"
    }
    $global:LASTEXITCODE = 0
}

function Assert-NoReleaseReparsePoints {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $rootItem = Get-Item -LiteralPath $Path -Force
    if (
        ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
    ) {
        throw "发布目录本身是链接，拒绝交付：$($rootItem.FullName)"
    }

    $reparsePoint = @(
        Get-ChildItem `
            -LiteralPath $Path `
            -Force `
            -Recurse |
            Where-Object {
                ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
            } |
            Select-Object -First 1
    )[0]
    if ($null -ne $reparsePoint) {
        throw "发布目录仍包含链接，拒绝交付：$($reparsePoint.FullName)"
    }
}

$sourceRoot = ConvertTo-NormalizedFullPath -Path $ProjectRoot
$destination = ConvertTo-NormalizedFullPath -Path $DestinationDirectory
if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) {
    throw "项目根目录不存在：$sourceRoot"
}

Assert-NoReparsePointInPathOrAncestors `
    -Path $sourceRoot `
    -Description "项目根目录"
Assert-NoReparsePointInPathOrAncestors `
    -Path $destination `
    -Description "发布目标"

if (
    [string]::Equals(
        $destination,
        $sourceRoot,
        [StringComparison]::OrdinalIgnoreCase
    )
) {
    throw "发布目录不能与项目根目录相同：$destination"
}

$dataDirectories = @(
    (Join-Path $sourceRoot "data"),
    (Join-Path $sourceRoot "server\data")
)
foreach ($dataDirectory in $dataDirectories) {
    if (
        Test-IsSameOrDescendantPath `
            -Path $destination `
            -ParentPath $dataDirectory
    ) {
        throw "拒绝在任何项目数据目录中生成发布包：$destination"
    }
}

$recursiveCopySources = @(
    "deploy\windows",
    "scripts",
    "server\dist",
    "shared\src",
    "web\dist",
    "node_modules"
)
foreach ($relativeSource in $recursiveCopySources) {
    $copySource = Join-Path $sourceRoot $relativeSource
    if (
        Test-IsSameOrDescendantPath `
            -Path $destination `
            -ParentPath $copySource
    ) {
        throw (
            "发布目录不能等于或位于待复制的源目录中：" +
            "$relativeSource；目标：$destination"
        )
    }
}

if (Test-Path -LiteralPath $destination) {
    throw "发布目录必须尚不存在，避免覆盖已有文件：$destination"
}

if (-not $ConfirmBackwardCompatibleMigrations) {
    throw (
        "生成发布包前必须显式传入 " +
        "-ConfirmBackwardCompatibleMigrations，确认数据库变更仅包含" +
        "新增表、列、索引等向后兼容迁移。破坏性迁移必须安排独立维护窗口" +
        "并先完成数据库冷备。"
    )
}

if (-not $SkipBuild) {
    $npmCommands = @(
        Get-Command `
            npm.cmd `
            -CommandType Application `
            -ErrorAction Stop
    )
    $npmPath = [string]$npmCommands[0].Source
    Push-Location $sourceRoot
    try {
        & $npmPath run build
        if ($LASTEXITCODE -ne 0) {
            throw "npm run build 失败，退出码：$LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
}

$requiredSourceFiles = @(
    "start-domain.bat",
    "package.json",
    "package-lock.json",
    "server\package.json",
    "server\dist\index.js",
    "server\dist\runtime\ShutdownRequestWatcher.js",
    "shared\package.json",
    "shared\src\index.ts",
    "web\package.json",
    "web\dist\index.html",
    "deploy\windows\_Common.ps1",
    "deploy\windows\Install-Cloudflared.ps1",
    "deploy\windows\Install-TunnelTask.ps1",
    "deploy\windows\Run-App.ps1",
    "deploy\windows\Run-QuickTunnel.ps1",
    "deploy\windows\Update-App.ps1"
)
foreach ($relativePath in $requiredSourceFiles) {
    if (
        -not (
            Test-Path `
                -LiteralPath (Join-Path $sourceRoot $relativePath) `
                -PathType Leaf
        )
    ) {
        throw "构建后的项目缺少发布文件：$relativePath"
    }
}

$finalDestination = $destination
$destinationParent = Split-Path -Parent $finalDestination
if ([string]::IsNullOrWhiteSpace($destinationParent)) {
    throw "无法确定发布目录的父目录：$finalDestination"
}
Ensure-Directory -Path $destinationParent
Assert-NoReparsePointInPathOrAncestors `
    -Path $destinationParent `
    -Description "发布目标父目录"

$destinationLeaf = Split-Path -Leaf $finalDestination
$stagingDestination = Join-Path $destinationParent (
    ".$destinationLeaf.staging.$([Guid]::NewGuid().ToString('N'))"
)
if (Test-Path -LiteralPath $stagingDestination) {
    throw "临时发布目录意外存在：$stagingDestination"
}
New-Item `
    -ItemType Directory `
    -Path $stagingDestination `
    -ErrorAction Stop | Out-Null
Assert-NoReparsePointInPathOrAncestors `
    -Path $stagingDestination `
    -Description "临时发布目录"

$destination = $stagingDestination
$published = $false
try {
foreach (
    $relativePath in @(
        "start-domain.bat",
        "package.json",
        "package-lock.json",
        "LICENSE"
    )
) {
    $sourcePath = Join-Path $sourceRoot $relativePath
    if (Test-Path -LiteralPath $sourcePath -PathType Leaf) {
        Copy-ReleaseItem `
            -Source $sourcePath `
            -Destination (Join-Path $destination $relativePath)
    }
}

foreach ($relativeDirectory in @("deploy\windows", "scripts")) {
    $sourcePath = Join-Path $sourceRoot $relativeDirectory
    if (Test-Path -LiteralPath $sourcePath -PathType Container) {
        Copy-ReleaseItem `
            -Source $sourcePath `
            -Destination (Join-Path $destination $relativeDirectory)
    }
}

foreach ($component in @("server", "shared", "web")) {
    Ensure-Directory -Path (Join-Path $destination $component)
    Copy-ReleaseItem `
        -Source (Join-Path $sourceRoot "$component\package.json") `
        -Destination (Join-Path $destination "$component\package.json")
}
Copy-ReleaseItem `
    -Source (Join-Path $sourceRoot "server\dist") `
    -Destination (Join-Path $destination "server\dist")
Copy-ReleaseItem `
    -Source (Join-Path $sourceRoot "shared\src") `
    -Destination (Join-Path $destination "shared\src")
Copy-ReleaseItem `
    -Source (Join-Path $sourceRoot "web\dist") `
    -Destination (Join-Path $destination "web\dist")

$includesNodeModules = -not $ReuseServerDependencies
if ($includesNodeModules) {
    $sourceNodeModules = Join-Path $sourceRoot "node_modules"
    if (
        -not (
            Test-Path `
                -LiteralPath $sourceNodeModules `
                -PathType Container
        )
    ) {
        throw "本地 node_modules 不存在，无法生成独立依赖包。"
    }

    $releaseNodeModules = Join-Path $destination "node_modules"
    Copy-DirectoryWithoutJunctions `
        -Source $sourceNodeModules `
        -Destination $releaseNodeModules

    # npm workspaces 在源码树中是 junction，/XJ 会有意跳过它们。
    # 服务运行时直接导入 shared，因此必须在独立发布包中实体化该包。
    $releaseWorkspaceScope = Join-Path $releaseNodeModules "@gupiaomoniqi"
    Ensure-Directory -Path $releaseWorkspaceScope
    $releaseSharedPackage = Join-Path $releaseWorkspaceScope "shared"
    if (Test-Path -LiteralPath $releaseSharedPackage) {
        throw "生产依赖复制后 shared 工作区路径不应已存在：$releaseSharedPackage"
    }
    New-Item `
        -ItemType Directory `
        -Path $releaseSharedPackage `
        -ErrorAction Stop | Out-Null
    Copy-ReleaseItem `
        -Source (Join-Path $sourceRoot "shared\package.json") `
        -Destination (Join-Path $releaseSharedPackage "package.json")
    Copy-ReleaseItem `
        -Source (Join-Path $sourceRoot "shared\src") `
        -Destination (Join-Path $releaseSharedPackage "src")

    $nodeExecutable = Resolve-NodeExecutable -Root $sourceRoot
    $typescriptCompiler = Join-Path `
        $sourceRoot `
        "node_modules\typescript\bin\tsc"
    if (-not (Test-Path -LiteralPath $typescriptCompiler -PathType Leaf)) {
        throw "发布包缺少 TypeScript 编译器，无法生成 shared 运行时代码。"
    }
    $releaseSharedDist = Join-Path $releaseSharedPackage "dist"
    & $nodeExecutable `
        $typescriptCompiler `
        (Join-Path $sourceRoot "shared\src\index.ts") `
        --module NodeNext `
        --moduleResolution NodeNext `
        --target ES2023 `
        --declaration `
        --outDir $releaseSharedDist `
        --strict `
        --skipLibCheck
    if ($LASTEXITCODE -ne 0) {
        throw "shared 运行时代码编译失败，退出码：$LASTEXITCODE"
    }
    $global:LASTEXITCODE = 0

    $releaseSharedManifestPath = Join-Path `
        $releaseSharedPackage `
        "package.json"
    $releaseSharedManifest = Get-Content `
        -LiteralPath $releaseSharedManifestPath `
        -Raw `
        -Encoding UTF8 |
        ConvertFrom-Json
    $releaseSharedManifest.types = "./dist/index.d.ts"
    $releaseSharedManifest.module = "./dist/index.js"
    $releaseSharedManifest.exports = [ordered]@{
        "." = [ordered]@{
            types = "./dist/index.d.ts"
            import = "./dist/index.js"
            default = "./dist/index.js"
        }
    }
    Write-AtomicJson `
        -Path $releaseSharedManifestPath `
        -Value $releaseSharedManifest

    foreach (
        $relativeRuntimeFile in @(
            "package.json",
            "dist\index.js",
            "dist\index.d.ts"
        )
    ) {
        $runtimeFile = Join-Path $releaseSharedPackage $relativeRuntimeFile
        if (-not (Test-Path -LiteralPath $runtimeFile -PathType Leaf)) {
            throw "发布包缺少 shared 运行时文件：$runtimeFile"
        }
    }

    $resolutionProbe = Join-Path (
        Join-Path $destination "server\dist"
    ) ".release-workspace-probe.mjs"
    $probeSource = @'
import path from "node:path";
import { fileURLToPath } from "node:url";

const expected = path.resolve(process.argv[2], "dist", "index.js");
const resolved = path.resolve(
  fileURLToPath(import.meta.resolve("@gupiaomoniqi/shared"))
);
if (resolved.toLowerCase() !== expected.toLowerCase()) {
  throw new Error(`shared resolved outside release: ${resolved}`);
}
await import("@gupiaomoniqi/shared");
'@
    try {
        Write-AtomicText -Path $resolutionProbe -Value $probeSource
        & $nodeExecutable $resolutionProbe $releaseSharedPackage
        if ($LASTEXITCODE -ne 0) {
            throw "发布包内 shared 运行时依赖解析失败，退出码：$LASTEXITCODE"
        }
    }
    finally {
        if (Test-Path -LiteralPath $resolutionProbe -PathType Leaf) {
            Remove-Item -LiteralPath $resolutionProbe -Force
        }
        $global:LASTEXITCODE = 0
    }
}

Assert-NoReleaseReparsePoints -Path $destination

$payloadRootPrefix = $destination.TrimEnd("\") + "\"
$payloadFiles = @(
    Get-ChildItem `
        -LiteralPath $destination `
        -File `
        -Force `
        -Recurse |
        Sort-Object FullName |
        ForEach-Object {
            if (
                -not $_.FullName.StartsWith(
                    $payloadRootPrefix,
                    [StringComparison]::OrdinalIgnoreCase
                )
            ) {
                throw "发布文件越出临时发布目录：$($_.FullName)"
            }

            [ordered]@{
                path = $_.FullName.Substring(
                    $payloadRootPrefix.Length
                ).Replace("\", "/")
                size = [long]$_.Length
                sha256 = (
                    Get-FileHash `
                        -LiteralPath $_.FullName `
                        -Algorithm SHA256
                ).Hash.ToLowerInvariant()
            }
        }
)

$manifest = [ordered]@{
    schemaVersion = 1
    createdAt = (Get-Date).ToUniversalTime().ToString("o")
    includesNodeModules = $includesNodeModules
    databaseMigrationPolicy = "expand-contract"
    rollbackCompatible = $true
    packageLockSha256 = (
        Get-FileHash `
            -LiteralPath (Join-Path $destination "package-lock.json") `
            -Algorithm SHA256
    ).Hash.ToLowerInvariant()
    serverEntrySha256 = (
        Get-FileHash `
            -LiteralPath (Join-Path $destination "server\dist\index.js") `
            -Algorithm SHA256
    ).Hash.ToLowerInvariant()
    webEntrySha256 = (
        Get-FileHash `
            -LiteralPath (Join-Path $destination "web\dist\index.html") `
            -Algorithm SHA256
    ).Hash.ToLowerInvariant()
    payloadFiles = $payloadFiles
}
Write-AtomicJson `
    -Path (Join-Path $destination "release-manifest.json") `
    -Value $manifest

Assert-NoReleaseReparsePoints -Path $destination
Assert-NoReparsePointInPathOrAncestors `
    -Path $destinationParent `
    -Description "发布目标父目录"
if (Test-Path -LiteralPath $finalDestination) {
    throw "发布目录在构建期间被其他进程创建，拒绝覆盖：$finalDestination"
}

[System.IO.Directory]::Move($destination, $finalDestination)
$published = $true
$destination = $finalDestination
}
finally {
    if (
        -not $published -and
        (
            Test-Path `
                -LiteralPath $stagingDestination `
                -PathType Container
        )
    ) {
        Assert-NoReparsePointInPathOrAncestors `
            -Path $stagingDestination `
            -Description "待清理临时发布目录"
        Remove-Item `
            -LiteralPath $stagingDestination `
            -Recurse `
            -Force
    }
}

[pscustomobject]@{
    Destination = $destination
    IncludesNodeModules = $includesNodeModules
    DatabaseMigrationPolicy = $manifest.databaseMigrationPolicy
    RollbackCompatible = $manifest.rollbackCompatible
    PackageLockSha256 = $manifest.packageLockSha256
    ServerEntrySha256 = $manifest.serverEntrySha256
    WebEntrySha256 = $manifest.webEntrySha256
    PayloadFileCount = @($manifest.payloadFiles).Count
} | ConvertTo-Json -Compress
