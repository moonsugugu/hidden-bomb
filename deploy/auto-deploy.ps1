[CmdletBinding()]
param(
    [string]$ProjectDirectory = (Join-Path $PSScriptRoot '..'),
    [string]$Branch = 'main',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$ProjectDirectory = (Resolve-Path $ProjectDirectory).Path
$LogDirectory = Join-Path $ProjectDirectory 'deploy\logs'
$LogPath = Join-Path $LogDirectory 'auto-deploy.log'
New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null

function Write-DeployLog([string]$Message) {
    $line = "{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -LiteralPath $LogPath -Value $line -Encoding utf8
    Write-Host $line
}

Set-Location $ProjectDirectory
if (-not (Test-Path (Join-Path $ProjectDirectory '.git'))) {
    throw "Git 저장소가 아닙니다: $ProjectDirectory"
}

$dirtyFiles = @(git status --porcelain)
if ($dirtyFiles.Count -gt 0) {
    throw "서버 작업 폴더에 수동 변경이 있어 자동 배포를 중단했습니다: $($dirtyFiles -join ', ')"
}

$before = (git rev-parse HEAD).Trim()
git fetch --prune origin $Branch
$remoteHead = (git rev-parse "origin/$Branch").Trim()
$hasBuild = Test-Path (Join-Path $ProjectDirectory 'dist\index.html')

if (-not $Force -and $before -eq $remoteHead -and $hasBuild) {
    Write-DeployLog "변경 없음: $remoteHead"
    return
}

Write-DeployLog "배포 시작: $before -> $remoteHead"
git checkout $Branch
git pull --ff-only origin $Branch
npm.cmd ci
npm.cmd run build

if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
    throw 'PM2가 설치되어 있지 않습니다. npm install --global pm2 를 먼저 실행하세요.'
}

pm2 startOrRestart (Join-Path $ProjectDirectory 'deploy\ecosystem.config.cjs') --update-env
pm2 save

$health = $null
for ($attempt = 1; $attempt -le 10; $attempt += 1) {
    try {
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3202/health' -TimeoutSec 5
        if ($health.ok -eq $true -and $health.game -eq 'hidden-bomb') { break }
    } catch {
        if ($attempt -eq 10) { throw }
    }
    Start-Sleep -Seconds 2
}

Write-DeployLog "배포 완료: $($health.game) port=$($health.port) rooms=$($health.rooms)"
