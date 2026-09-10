[CmdletBinding()]
param(
    [string]$ProjectDirectory = (Join-Path $PSScriptRoot '..'),
    [string]$Branch = 'main',
    [int]$IntervalSeconds = 60
)

$ErrorActionPreference = 'Continue'
$ProjectDirectory = (Resolve-Path $ProjectDirectory).Path
$DeployScript = Join-Path $ProjectDirectory 'deploy\auto-deploy.ps1'

while ($true) {
    try {
        & $DeployScript -ProjectDirectory $ProjectDirectory -Branch $Branch
    } catch {
        $message = "{0} 자동 배포 확인 실패: {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $_.Exception.Message
        Write-Host $message
        Add-Content -LiteralPath (Join-Path $ProjectDirectory 'deploy\logs\auto-deploy.log') -Value $message -Encoding utf8
    }
    Start-Sleep -Seconds ([Math]::Max(15, $IntervalSeconds))
}
