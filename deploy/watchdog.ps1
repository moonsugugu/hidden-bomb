[CmdletBinding()]
param(
    [string]$ProjectDirectory = (Join-Path $PSScriptRoot '..'),
    [int]$IntervalSeconds = 30
)

$ErrorActionPreference = 'Continue'
$ProjectDirectory = (Resolve-Path $ProjectDirectory).Path
$LogDirectory = Join-Path $ProjectDirectory 'deploy\logs'
$LogPath = Join-Path $LogDirectory 'watchdog.log'
$Ecosystem = Join-Path $ProjectDirectory 'deploy\ecosystem.config.cjs'
New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null

function Write-WatchdogLog([string]$Message) {
    $line = "{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -LiteralPath $LogPath -Value $line -Encoding utf8
    Write-Host $line
}

while ($true) {
    $healthy = $false
    try {
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3202/health' -TimeoutSec 5
        $healthy = $health.ok -eq $true -and $health.game -eq 'hidden-bomb'
    } catch {
        $healthy = $false
    }

    if (-not $healthy) {
        try {
            if (-not (Get-Command pm2 -ErrorAction Stop)) { throw 'PM2가 없습니다.' }
            Write-WatchdogLog 'health 실패. PM2 프로세스를 재시작합니다.'
            pm2 startOrRestart $Ecosystem --update-env
            pm2 save
        } catch {
            Write-WatchdogLog "재시작 실패: $($_.Exception.Message)"
        }
    }

    Start-Sleep -Seconds ([Math]::Max(15, $IntervalSeconds))
}
