[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = "Medium")]
param(
    [Parameter(Mandatory = $true)]
    [string]$DeploymentIp
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "_Common.ps1")

Assert-WindowsAdministrator

$parsedIp = $null
if (-not [System.Net.IPAddress]::TryParse($DeploymentIp, [ref]$parsedIp)) {
    throw "部署端 IP 不是有效的单一 IP 地址：$DeploymentIp"
}
$normalizedIp = $parsedIp.ToString()
$projectHttpRuleNames = @(
    "Gupiaomoniqi-HTTP-In-TCP-80",
    "Gupiaomoniqi-HTTPS-In-TCP-443"
)

$disabledProjectRules = New-Object System.Collections.Generic.List[string]
$restrictedSshRuleNames = New-Object System.Collections.Generic.List[string]
foreach ($ruleName in $projectHttpRuleNames) {
    if ([string]::IsNullOrWhiteSpace($ruleName)) {
        continue
    }

    $rule = Get-NetFirewallRule `
        -Name $ruleName `
        -PolicyStore PersistentStore `
        -ErrorAction SilentlyContinue
    if ($null -ne $rule -and $rule.Enabled -eq "True") {
        if ($PSCmdlet.ShouldProcess(
            $ruleName,
            "禁用本项目明确命名的 HTTP/HTTPS 入站规则"
        )) {
            Disable-NetFirewallRule `
                -Name $ruleName `
                -PolicyStore PersistentStore | Out-Null
            $disabledProjectRules.Add($ruleName)
        }
    }
}

$activeAllowRules = @(
    Get-NetFirewallRule `
        -PolicyStore ActiveStore `
        -Enabled True `
        -Direction Inbound `
        -Action Allow
)
$sshRules = New-Object System.Collections.Generic.List[object]
$otherHttpRules = New-Object System.Collections.Generic.List[object]

foreach ($rule in $activeAllowRules) {
    $portFilters = @($rule | Get-NetFirewallPortFilter)
    foreach ($portFilter in $portFilters) {
        $protocol = [string]$portFilter.Protocol
        $localPort = [string]$portFilter.LocalPort
        $ports = @($localPort -split ",")

        if (
            $protocol -eq "TCP" -and
            $ports -contains "22"
        ) {
            $sshRules.Add($rule)
            break
        }

        if (
            $protocol -eq "TCP" -and
            (
                $ports -contains "80" -or
                $ports -contains "443"
            )
        ) {
            if ($projectHttpRuleNames -notcontains $rule.Name) {
                $otherHttpRules.Add($rule)
            }
            break
        }
    }
}

if ($sshRules.Count -eq 0) {
    $sshRuleName = "Gupiaomoniqi-SSH-In-TCP-22"
    if ($PSCmdlet.ShouldProcess(
        $sshRuleName,
        "创建仅允许 $normalizedIp 访问 TCP 22 的入站规则"
    )) {
        New-NetFirewallRule `
            -Name $sshRuleName `
            -DisplayName "Gupiaomoniqi SSH deployment access" `
            -Description (
                "仅允许指定部署电脑访问 OpenSSH；由股票模拟器部署脚本管理。"
            ) `
            -Enabled True `
            -Direction Inbound `
            -Action Allow `
            -Protocol TCP `
            -LocalPort 22 `
            -RemoteAddress $normalizedIp | Out-Null
        $restrictedSshRuleNames.Add($sshRuleName)
    }
}
else {
    $seenRuleIds = @{}
    foreach ($sshRule in $sshRules) {
        $ruleId = "{0}|{1}" -f $sshRule.PolicyStoreSource, $sshRule.Name
        if ($seenRuleIds.ContainsKey($ruleId)) {
            continue
        }
        $seenRuleIds[$ruleId] = $true

        if ($sshRule.PolicyStoreSourceType -eq "GroupPolicy") {
            throw (
                "发现组策略下发的 SSH 放行规则，无法由本脚本安全收窄：" +
                "$($sshRule.DisplayName)。请先由组策略管理员限制来源地址。"
            )
        }

        if ($PSCmdlet.ShouldProcess(
            $sshRule.DisplayName,
            "将 SSH 入站来源限制为 $normalizedIp"
        )) {
            $addressFilters = @($sshRule | Get-NetFirewallAddressFilter)
            foreach ($addressFilter in $addressFilters) {
                $addressFilter |
                    Set-NetFirewallAddressFilter `
                        -RemoteAddress $normalizedIp | Out-Null
            }
            $restrictedSshRuleNames.Add([string]$sshRule.DisplayName)
        }
    }
}

$result = [ordered]@{
    deploymentIp = $normalizedIp
    disabledProjectHttpRules = @($disabledProjectRules)
    restrictedSshRules = @($restrictedSshRuleNames | Select-Object -Unique)
    untouchedHttpHttpsRules = @(
        $otherHttpRules |
            Select-Object Name, DisplayName, PolicyStoreSourceType -Unique
    )
    note = (
        "未删除任何防火墙规则；非本项目明确命名的 80/443 规则只报告、不修改。"
    )
}

$result | ConvertTo-Json -Depth 6
