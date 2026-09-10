[CmdletBinding()]
param(
    [string]$RepositoryUrl = 'https://github.com/moonsugugu/hidden-bomb.git',
    [string]$ProjectDirectory = 'C:\homeserver\apps\hidden-bomb',
    [string]$Branch = 'main',
    [switch]$SkipScheduledTasks
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git이 설치되어 있지 않습니다.' }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'Node.js/npm이 설치되어 있지 않습니다.' }

$parentDirectory = Split-Path -Parent $ProjectDirectory
New-Item -ItemType Directory -Force -Path $parentDirectory | Out-Null

if (-not (Test-Path (Join-Path $ProjectDirectory '.git'))) {
    git clone --branch $Branch $RepositoryUrl $ProjectDirectory
}

Set-Location $ProjectDirectory
if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
    npm.cmd install --global pm2
}

npm.cmd ci
npm.cmd run build
pm2 startOrRestart (Join-Path $ProjectDirectory 'deploy\ecosystem.config.cjs') --update-env
pm2 save

if (-not $SkipScheduledTasks) {
    $watchScript = Join-Path $ProjectDirectory 'deploy\watch-github.ps1'
    $watchdogScript = Join-Path $ProjectDirectory 'deploy\watchdog.ps1'
    $userId = if ($env:USERDOMAIN) { "$($env:USERDOMAIN)\$($env:USERNAME)" } else { $env:USERNAME }
    $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Highest
    $watchAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$watchScript`" -ProjectDirectory `"$ProjectDirectory`""
    $watchdogAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$watchdogScript`" -ProjectDirectory `"$ProjectDirectory`""
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    Register-ScheduledTask -TaskName 'BalanceMate GitHub auto deploy' -Action $watchAction -Trigger $trigger -Principal $principal -Force | Out-Null
    Register-ScheduledTask -TaskName 'BalanceMate watchdog' -Action $watchdogAction -Trigger $trigger -Principal $principal -Force | Out-Null
}

Write-Host "Balance Mate 홈 서버 설치 완료: $ProjectDirectory"
Write-Host 'Cloudflare Tunnel 설정은 deploy/cloudflared-config.example.yml을 참고하세요.'
