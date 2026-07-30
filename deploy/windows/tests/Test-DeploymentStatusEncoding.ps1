[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$statusScript = Join-Path (
    Split-Path -Parent $PSScriptRoot
) "Get-DeploymentStatus.ps1"
$powerShellPath = Join-Path $env:SystemRoot (
    "System32\WindowsPowerShell\v1.0\powershell.exe"
)
if (-not (Test-Path -LiteralPath $powerShellPath -PathType Leaf)) {
    throw "Windows PowerShell 5.1 was not found."
}

$expectedMessage = [Text.Encoding]::UTF8.GetString(
    [Convert]::FromBase64String(
        "UHl0aG9uIDMg5bey6aqM6K+B77yM5YW255uu5b2V5Lya5LuF5Yqg5YWlIE5vZGUg" +
        "5bqU55So5a2Q6L+b56iL55qEIFBhdGjjgII="
    )
)
$temporaryBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd("\")
$testRoot = Join-Path $temporaryBase (
    "gupiaomoniqi-status-encoding-$([Guid]::NewGuid().ToString('N'))"
)
$runtimeDirectory = Join-Path $testRoot "runtime"
$statePath = Join-Path $runtimeDirectory "app-latest.json"

try {
    [void][IO.Directory]::CreateDirectory($runtimeDirectory)
    $state = [ordered]@{
        status = "running"
        pythonFallback = [ordered]@{
            available = $true
            executable = "C:\Python311\python.exe"
            message = $expectedMessage
        }
    }
    $json = $state | ConvertTo-Json -Depth 8
    [IO.File]::WriteAllText(
        $statePath,
        $json,
        (New-Object Text.UTF8Encoding($false))
    )

    $stateBytes = [IO.File]::ReadAllBytes($statePath)
    if (
        $stateBytes.Length -ge 3 -and
        $stateBytes[0] -eq 0xEF -and
        $stateBytes[1] -eq 0xBB -and
        $stateBytes[2] -eq 0xBF
    ) {
        throw "The fixture must be UTF-8 without a BOM."
    }

    $defaultReadPreservedMessage = $false
    try {
        $defaultState = Get-Content -LiteralPath $statePath -Raw |
            ConvertFrom-Json
        $defaultReadPreservedMessage = (
            [string]$defaultState.pythonFallback.message -ceq
                $expectedMessage
        )
    }
    catch {
        $defaultReadPreservedMessage = $false
    }
    if (
        [Text.Encoding]::Default.CodePage -ne 65001 -and
        $defaultReadPreservedMessage
    ) {
        throw "The fixture did not expose the legacy default-encoding path."
    }

    $taskSuffix = [Guid]::NewGuid().ToString("N")
    $command = @"
[Console]::OutputEncoding = New-Object Text.UTF8Encoding(`$false)
& '$($statusScript.Replace("'", "''"))' ``
    -Root '$($testRoot.Replace("'", "''"))' ``
    -AppTaskName 'Gupiaomoniqi-Encoding-App-$taskSuffix' ``
    -TunnelTaskName 'Gupiaomoniqi-Encoding-Tunnel-$taskSuffix' ``
    -WaitSeconds 0 ``
    -RequestTimeoutSeconds 1 ``
    -SkipPublic
"@
    $encodedCommand = [Convert]::ToBase64String(
        [Text.Encoding]::Unicode.GetBytes($command)
    )
    $utf8 = New-Object Text.UTF8Encoding($false)
    $startInfo = New-Object Diagnostics.ProcessStartInfo
    $startInfo.FileName = $powerShellPath
    $startInfo.Arguments = (
        "-NoProfile -NonInteractive -ExecutionPolicy Bypass " +
        "-EncodedCommand $encodedCommand"
    )
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.StandardOutputEncoding = $utf8
    $startInfo.StandardErrorEncoding = $utf8

    $process = New-Object Diagnostics.Process
    $process.StartInfo = $startInfo
    try {
        if (-not $process.Start()) {
            throw "Failed to start Windows PowerShell."
        }
        $standardOutput = $process.StandardOutput.ReadToEnd()
        $standardError = $process.StandardError.ReadToEnd()
        $process.WaitForExit()
        $exitCode = $process.ExitCode
    }
    finally {
        $process.Dispose()
    }

    if ($exitCode -ne 1) {
        throw (
            "Expected the isolated deployment probe to report not ready " +
            "(exit 1), but received exit $exitCode. stderr: $standardError"
        )
    }
    try {
        $result = $standardOutput | ConvertFrom-Json
    }
    catch {
        throw (
            "Get-DeploymentStatus.ps1 did not emit valid JSON. " +
            "stderr: $standardError; stdout: $standardOutput"
        )
    }
    if (
        [string]$result.pythonFallback.message -cne $expectedMessage
    ) {
        throw (
            "The UTF-8 pythonFallback.message was not preserved. Actual: " +
            [string]$result.pythonFallback.message
        )
    }

    [pscustomobject]@{
        passed = $true
        powerShellVersion = $PSVersionTable.PSVersion.ToString()
        defaultCodePage = [Text.Encoding]::Default.CodePage
        utf8Bom = $false
        message = $result.pythonFallback.message
    } | ConvertTo-Json -Compress
}
finally {
    $resolvedTestRoot = [IO.Path]::GetFullPath($testRoot).TrimEnd("\")
    if (
        $resolvedTestRoot.StartsWith(
            "$temporaryBase\gupiaomoniqi-status-encoding-",
            [StringComparison]::OrdinalIgnoreCase
        ) -and
        (Test-Path -LiteralPath $resolvedTestRoot -PathType Container)
    ) {
        Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
    }
}
