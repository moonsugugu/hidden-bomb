# 집 노트북 배포

이 프로젝트는 집 노트북에서 `127.0.0.1`로만 서비스하고 Cloudflare Tunnel로 외부에 공개합니다.
포트 포워딩이나 `0.0.0.0` 바인딩은 사용하지 않습니다.

## 현재 운영 상태 (2026-09-11 배포 완료)

**운영 중입니다.** <https://hiddenbomb.moonsunezip.com>

| 항목 | 값 |
| --- | --- |
| 게임 서버(WebSocket) | PM2 `hidden-bomb-game` · 포트 **3203** |
| 운영 웹 서버 | PM2 `hidden-bomb-web` · 포트 **3007** |
| 로컬 개발 | 포트 `3005` (`npm run dev`) |

운영 노트북은 **HomeServer-Startup / HomeServer-AutoDeploy / HomeServer-Watchdog**
중앙 체계가 모든 앱을 함께 관리합니다.

- GitHub `main`을 **3분마다** 확인해 자동으로 테스트·빌드·재배포
- 웹 3007과 게임 3203을 **5분마다** 점검하고 장애 시 자동 재시작

> ⚠️ **3202는 Balance Mate가 쓰고 있습니다.** 처음 계획은 3202였지만 충돌해서 3203으로 옮겼습니다.
> 새 앱을 붙일 때는 `pm2 status`로 빈 포트를 먼저 확인하세요.

## 1. 최초 설치 (새 기기에 처음 올릴 때만)

> ⚠️ **운영 중인 노트북에서는 이 절차를 쓰지 마세요.** 중앙 체계에 이미 통합되어 있어
> 예약 작업이 중복 등록됩니다. 아래는 새 기기에 처음 구축할 때만 씁니다.

집 노트북에 Git, Node.js 20 이상, Cloudflare Tunnel, PowerShell 5.1 이상을 준비합니다.

```powershell
New-Item -ItemType Directory -Force C:\homeserver\apps | Out-Null
git clone --branch main https://github.com/moonsugugu/hidden-bomb.git C:\homeserver\apps\hidden-bomb
Set-Location C:\homeserver\apps\hidden-bomb
Set-ExecutionPolicy -Scope Process Bypass
.\deploy\install-home-server.ps1
```

설치 스크립트는 `npm ci`, 프런트 빌드, PM2 실행을 진행하고 로그인할 때마다 자동 배포 감지와
watchdog을 시작하도록 작업 스케줄러에 `HiddenBomb GitHub auto deploy`,
`HiddenBomb watchdog` 이름으로 등록합니다.

> 예약 작업 이름에는 **반드시 프로젝트 이름**을 넣으세요. 예전에는 balance-mate에서 복사해 온
> `BalanceMate ...` 이름을 그대로 쓰고 있었는데, `-Force` 때문에 Balance Mate의 예약 작업이
> 이 프로젝트 폴더를 가리키도록 덮어써져 Balance Mate 자동 배포가 조용히 망가졌을 겁니다.

**설치 후 노트북이 절전 상태가 되지 않도록 전원 설정을 반드시 확인하세요.**
수업 중 노트북이 절전되면 7개 모둠이 한꺼번에 끊깁니다.

## 2. Cloudflare Tunnel

기존 `C:\homeserver\cloudflared\config.yml`에서 마지막 `service: http_status:404` 위에
[`cloudflared-config.example.yml`](cloudflared-config.example.yml)의 두 ingress 항목을 추가합니다.
기존 `tunnel`과 `credentials-file` 값은 그대로 둡니다.

```powershell
cloudflared tunnel route dns <터널이름> hiddenbomb.moonsunezip.com
```

Cloudflare Tunnel 프로세스를 재시작한 뒤 확인합니다.

```text
https://hiddenbomb.moonsunezip.com
https://hiddenbomb.moonsunezip.com/health
```

`/v1/game` WebSocket은 같은 호스트의 `127.0.0.1:3203`로 전달됩니다.
브라우저는 운영 도메인을 보고 자동으로 `wss://hiddenbomb.moonsunezip.com/v1/game`을 선택합니다.

## 3. 자동 감지·자동 배포

- `watch-github.ps1`: 60초마다 GitHub `main`의 새 커밋을 확인합니다.
- `auto-deploy.ps1`: 변경이 있으면 fast-forward pull → `npm ci` → `npm run build` → PM2 reload를 실행합니다.
- `watchdog.ps1`: 30초마다 `http://127.0.0.1:3203/health`를 확인하고 실패하면 PM2를 재시작합니다.
- 로그: `deploy\logs\auto-deploy.log`, `deploy\logs\watchdog.log`

이 저장소는 공개라 clone과 pull에 별도 인증이 필요 없습니다.
push할 일이 생기면 OS 자격 증명 관리자나 SSH로 인증을 저장하세요.
**토큰이나 비밀번호를 이 저장소의 `.env`나 PowerShell 파일에 적지 마세요.** 공개 저장소입니다.

## 4. 수동 점검

```powershell
Set-Location C:\homeserver\apps\hidden-bomb
pm2 status
Invoke-RestMethod http://127.0.0.1:3203/health
pm2 logs hidden-bomb-game --lines 50
```

`/health` 응답 예시:

```json
{ "ok": true, "game": "hidden-bomb", "rooms": 7, "hubs": 1, "maxHubRooms": 7, "maxPlayers": 4 }
```

## 5. 상태 보관에 대해

방과 게임 진행 상태는 **게임 서버 메모리에만** 있습니다. PM2가 재시작하면 진행 중이던
게임과 방 코드가 사라집니다. 한 판이 10~15분이라 수업 중 재시작만 피하면 문제가 없지만,
자동 배포는 쉬는 시간에 이루어지도록 커밋 시점을 조절하는 편이 좋습니다.
아무도 없는 방은 60초 뒤 자동으로 정리됩니다.
