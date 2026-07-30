[CmdletBinding()]
param(
    [string]$Root = "C:\ProgramData\gupiaomoniqi",
    [string]$DownloadUrl = (
        "https://github.com/cloudflare/cloudflared/releases/latest/download/" +
        "cloudflared-windows-amd64.exe"
    ),
    [string]$ExpectedSha256
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "_Common.ps1")

Assert-WindowsAdministrator
$safeRoot = Assert-SafeDeploymentRoot -Root $Root
$toolsDirectory = Join-Path $safeRoot "tools"
Ensure-Directory -Path $toolsDirectory

$destinationPath = Join-Path $toolsDirectory "cloudflared.exe"
$temporaryPath = Join-Path $toolsDirectory (
    "cloudflared.$([Guid]::NewGuid().ToString('N')).download.exe"
)

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest `
        -Uri $DownloadUrl `
        -OutFile $temporaryPath `
        -UseBasicParsing

    $download = Get-Item -LiteralPath $temporaryPath
    if ($download.Length -lt 1MB) {
        throw "下载的 cloudflared 文件异常小：$($download.Length) 字节"
    }

    $actualHash = (Get-FileHash `
        -LiteralPath $temporaryPath `
        -Algorithm SHA256).Hash.ToUpperInvariant()
    if (-not [string]::IsNullOrWhiteSpace($ExpectedSha256)) {
        $normalizedExpectedHash = $ExpectedSha256.Replace(" ", "").ToUpperInvariant()
        if ($actualHash -ne $normalizedExpectedHash) {
            throw (
                "cloudflared SHA-256 不匹配。期望：{0}；实际：{1}" -f
                    $normalizedExpectedHash,
                    $actualHash
            )
        }
    }

    $versionOutput = & $temporaryPath --version 2>&1
    if ($LASTEXITCODE -ne 0 -or ($versionOutput -join " ") -notmatch "cloudflared") {
        throw "下载文件无法作为 cloudflared 运行。"
    }

    Move-Item `
        -LiteralPath $temporaryPath `
        -Destination $destinationPath `
        -Force

    Write-Host "cloudflared 已安装或更新：$destinationPath"
    Write-Host "SHA256：$actualHash"
    Write-Host ($versionOutput -join [Environment]::NewLine)
}
finally {
    if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
        Remove-Item -LiteralPath $temporaryPath -Force
    }
}
