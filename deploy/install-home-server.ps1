[CmdletBinding()]
param(
    [string]$RepositoryUrl = 'https://github.com/moonsugugu/hidden-bomb.git',
    [string]$ProjectDirectory = 'C:\homeserver\apps\hidden-bomb',
    [string]$Branch = 'main',
    [switch]$SkipScheduledTasks
)

# ⚠️ 현재 운영 중인 집 노트북은 이 스크립트를 쓰지 않는다.
# HomeServer-Startup / HomeServer-AutoDeploy / HomeServer-Watchdog 중앙 체계가
# 모든 앱을 함께 관리하고 있으므로, 이 스크립트는 새 기기에 처음 올릴 때만 쓴다.
# 운영 중인 노트북에서 실행하면 예약 작업이 중복 등록된다.

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
    # 작업 이름에 프로젝트 이름을 반드시 넣는다.
    # 예전에 balance-mate에서 그대로 복사해 온 이름을 쓰고 있었는데,
    # -Force 때문에 Balance Mate의 예약 작업을 이 프로젝트 폴더로 덮어써 버렸을 것이다.
    Register-ScheduledTask -TaskName 'HiddenBomb GitHub auto deploy' -Action $watchAction -Trigger $trigger -Principal $principal -Force | Out-Null
    Register-ScheduledTask -TaskName 'HiddenBomb watchdog' -Action $watchdogAction -Trigger $trigger -Principal $principal -Force | Out-Null
}

Write-Host "Hidden Bomb 홈 서버 설치 완료: $ProjectDirectory"
Write-Host 'Cloudflare Tunnel 설정은 deploy/cloudflared-config.example.yml을 참고하세요.'
