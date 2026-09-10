import { useCallback, useEffect, useRef, useState } from "react";
import type { GameState, HubState, ServerMessage } from "./types";
import {
  clearSession,
  isGameState,
  isHubState,
  lastSession,
  openGameSocket,
  rememberSession,
  savePlayerId,
  saveTeacherId,
  sendJson,
} from "./gameClient";
import { BrandLinks, MadeBy } from "./branding";
import StudentView from "./StudentView";
import TeacherView from "./TeacherView";
import { unlockAudio } from "./sound";

type Mode = "home" | "student" | "teacher" | "spectator";
type Target = {
  room: string;
  name: string;
  role: "student" | "teacher";
  roomCount?: number;
  hubCode?: string;
  spectator?: boolean;
  /** 모둠 1기기 모드에서 이 기기로 함께 들어오는 사람들. */
  names?: string[];
};

const MAX_RETRY_DELAY_MS = 8_000;
const ORIGINAL_VIDEO_URL = "https://www.youtube.com/watch?v=LBD1a_c2SIY";

/** QR로 들어오면 주소에 방 코드가 붙어 있다. */
function roomFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return (params.get("room") || "").trim().toUpperCase();
}

function watchFromUrl() {
  return new URLSearchParams(window.location.search).get("watch") === "1";
}

function hubFromUrl() {
  return (new URLSearchParams(window.location.search).get("hub") || "").trim().toUpperCase();
}

export default function App() {
  const [mode, setMode] = useState<Mode>("home");
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [hubState, setHubState] = useState<HubState | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [connecting, setConnecting] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const targetRef = useRef<Target | null>(null);
  const retryRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);

  const send = useCallback((message: Record<string, unknown>) => {
    sendJson(socketRef.current, message);
  }, []);

  const teardown = useCallback(() => {
    if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
    targetRef.current = null;
    retryRef.current = 0;
    const socket = socketRef.current;
    socketRef.current = null;
    socket?.close(1000, "left");
  }, []);

  const connect = useCallback((target: Target) => {
    targetRef.current = target;
    setConnecting(true);
    setError("");

    const socket = openGameSocket(target.room, target.name, {
      role: target.role === "teacher" ? "teacher" : undefined,
      names: target.names,
      hubCode: target.hubCode,
      spectator: target.spectator,
    });
    socketRef.current = socket;

    socket.onopen = () => {
      setConnecting(false);
      retryRef.current = 0;
      if (target.room === "NEW") {
        if (target.role === "teacher")
          sendJson(socket, {
            type: "create_hub",
            teacherName: target.name,
            roomCount: target.roomCount ?? 7,
          });
        else sendJson(socket, { type: "create_room", name: target.name });
      }
    };

    socket.onmessage = (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      if (isGameState(message)) {
        setGameState(message);
        setMode(target.spectator ? "spectator" : "student");
        return;
      }
      if (isHubState(message)) {
        setHubState(message);
        setMode("teacher");
        return;
      }

      switch (message.type) {
        case "connected":
          if (message.playerId) {
            savePlayerId(message.playerId, message.room ?? undefined);
            rememberSession("student", message.room ?? target.room, target.name);
          }
          if (message.teacherId) {
            saveTeacherId(message.teacherId, message.hub);
            rememberSession("teacher", message.hub ?? target.room, target.name);
          }
          // 방을 새로 만든 뒤에는 그 방 코드로 다시 붙어야 재접속이 된다.
          if (message.room && message.room !== "NEW" && targetRef.current && !target.spectator)
            targetRef.current = { ...targetRef.current, room: message.room };
          if (message.hub && targetRef.current && !target.spectator)
            targetRef.current = { ...targetRef.current, room: message.hub };
          break;
        case "error":
          setError(message.message);
          break;
        case "notice":
          setNotice(message.message);
          window.setTimeout(() => setNotice(""), 6_000);
          break;
        default:
          break;
      }
    };

    socket.onclose = (event) => {
      setConnecting(false);
      if (socketRef.current !== socket) return; // 이미 새 연결로 갈아탔다
      socketRef.current = null;

      // 1008은 서버가 거절한 경우(방 없음·인증 불일치)라 다시 붙어도 소용없다.
      // 'reconnected'는 다른 탭이 이어받은 경우다.
      const fatal = event.code === 1008 || event.reason === "reconnected";
      const current = targetRef.current;
      if (fatal || !current) {
        targetRef.current = null;
        setMode("home");
        setGameState(null);
        setHubState(null);
        if (fatal && event.reason) setError(event.reason);
        return;
      }

      // 학교 와이파이가 잠깐 끊기거나 태블릿이 절전에서 깨어난 경우 자동으로 다시 붙는다.
      const delay = Math.min(MAX_RETRY_DELAY_MS, 800 * 2 ** retryRef.current);
      retryRef.current += 1;
      setError(`연결이 끊겼어요. ${Math.round(delay / 100) / 10}초 뒤에 다시 시도할게요…`);
      retryTimerRef.current = window.setTimeout(() => connect(current), delay);
    };
  }, []);

  useEffect(() => () => teardown(), [teardown]);

  // 선생님 대시보드의 "관전" 링크는 새 탭에서 이 주소로 자동 입장한다.
  useEffect(() => {
    const room = roomFromUrl();
    if (!room || !watchFromUrl()) return;
    const previous = lastSession();
    connect({
      room,
      name: previous?.kind === "teacher" ? previous.name : "선생님",
      role: "teacher",
      hubCode: hubFromUrl(),
      spectator: true,
    });
  }, [connect]);

  const leave = () => {
    teardown();
    clearSession();
    setGameState(null);
    setHubState(null);
    setMode("home");
    setError("");
    if (roomFromUrl()) window.history.replaceState({}, "", window.location.pathname);
  };

  if (mode === "teacher" && hubState)
    return (
      <Shell error={error}>
        <TeacherView state={hubState} send={send} onLeave={leave} notice={notice} />
      </Shell>
    );

  if (mode === "student" && gameState)
    return (
      <Shell error={error}>
        <StudentView state={gameState} send={send} onLeave={leave} />
      </Shell>
    );

  if (mode === "spectator" && gameState)
    return (
      <Shell error={error}>
        <StudentView state={gameState} send={send} onLeave={leave} spectator />
      </Shell>
    );

  return (
    <Shell error={error}>
      <Home onConnect={connect} connecting={connecting} />
    </Shell>
  );
}

function Shell({ children, error }: { children: React.ReactNode; error: string }) {
  const [guideOpen, setGuideOpen] = useState(false);

  useEffect(() => {
    if (!guideOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setGuideOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [guideOpen]);

  return (
    <div className="shell" onPointerDownCapture={unlockAudio}>
      <header className="brand-bar">
        <div className="brand-lockup">
          <div className="brand-title-wrap">
            <span className="brand-logo">히든밤</span>
            <span className="brand-collab">이종대왕 X 문수네집</span>
          </div>
          <MadeBy />
        </div>
        <div className="brand-right">
          <BrandLinks />
          <button
            type="button"
            className="guide-button"
            aria-haspopup="dialog"
            aria-expanded={guideOpen}
            onClick={() => setGuideOpen(true)}
          >
            🎮 게임하는 법
          </button>
        </div>
      </header>
      {error && <p className="error-bar">{error}</p>}
      <main className="shell-main">{children}</main>
      {guideOpen && <HowToPlayDialog onClose={() => setGuideOpen(false)} />}
    </div>
  );
}

function HowToPlayDialog({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  return (
    <div
      className="guide-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="guide-dialog" role="dialog" aria-modal="true" aria-labelledby="guide-title">
        <header className="guide-dialog-head">
          <div>
            <p className="guide-eyebrow">HIDDENBOMB PLAYBOOK</p>
            <h2 id="guide-title">히든밤 게임하는 법</h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="guide-close"
            aria-label="게임하는 법 닫기"
            onClick={onClose}
          >
            닫기
          </button>
        </header>

        <ol className="guide-steps">
          <li>
            <strong>방 만들기</strong>
            <span>선생님이 방을 만들고 QR 또는 방 코드를 친구들에게 알려 줘요.</span>
          </li>
          <li>
            <strong>주사위 굴리기</strong>
            <span>내 차례가 되면 주사위를 굴린 숫자만큼 카드를 이어서 골라요.</span>
          </li>
          <li>
            <strong>같이 예상하기</strong>
            <span>누군가 연 문제는 방 안의 친구 모두에게 보이고, 정답을 함께 예상해요.</span>
          </li>
          <li>
            <strong>자동 판정</strong>
            <span>설정한 시간이 지나면 카드가 자동으로 안전 또는 폭탄 판정을 받아요.</span>
          </li>
        </ol>

        <a
          className="guide-video"
          href={ORIGINAL_VIDEO_URL}
          target="_blank"
          rel="noreferrer"
        >
          <span className="guide-video-icon" aria-hidden="true">
            ▶
          </span>
          <span className="guide-video-copy">
            <strong>오리지널 히든밤 놀이 영상</strong>
            <small>YouTube에서 실제 놀이 모습 보기</small>
          </span>
          <span className="guide-video-arrow" aria-hidden="true">
            ↗
          </span>
        </a>

        <p className="guide-note">💡 폭탄을 밟으면 그 차례는 끝나고, 안전한 카드는 다음 카드를 계속 고를 수 있어요.</p>
      </section>
    </div>
  );
}

function Home({
  onConnect,
  connecting,
}: {
  onConnect: (target: Target) => void;
  connecting: boolean;
}) {
  const urlRoom = roomFromUrl();
  const previous = lastSession();
  const [tab, setTab] = useState<"student" | "teacher">(urlRoom ? "student" : "teacher");
  const [name, setName] = useState(previous?.name ?? "");
  const [room, setRoom] = useState(urlRoom);
  const [roomCount, setRoomCount] = useState(7);
  // 태블릿이 모둠당 한 대뿐인 교실을 위한 모드.
  const [shared, setShared] = useState(false);
  const [mateNames, setMateNames] = useState(["", "", "", ""]);
  const [mateCount, setMateCount] = useState(2);

  const mates = mateNames.slice(0, mateCount).map((value) => value.trim());
  const matesFilled = mates.every((value) => value.length > 0);
  const matesUnique = new Set(mates).size === mates.length;

  const canJoin = room.trim().length > 0 && (shared ? matesFilled && matesUnique : name.trim().length > 0);
  const canHost = name.trim().length > 0;

  const joinAsStudent = () =>
    onConnect(
      shared
        ? { room: room.trim(), name: mates[0], role: "student", names: mates }
        : { room: room.trim(), name: name.trim(), role: "student" },
    );

  return (
    <div className="home">
      <section className="home-hero">
        <div className="home-hero-art" aria-hidden="true">
          <img src="/hiddenbomb-hero.png" alt="" />
        </div>
        <div className="home-hero-copy">
          <p className="home-kicker">이종대왕X문수네집 콜라보 게임앱</p>
          <h1>
            <span className="home-hero-bomb" aria-hidden="true">
              💣
            </span>{" "}
            히든밤
          </h1>
          <p>
            주사위가 나온 만큼 폭탄을 피해 <strong>정답 카드를 연속으로 찾아요!</strong>
          </p>
          <div className="home-badges" aria-label="히든밤 게임 특징">
            <span>👀 모두 함께 보기</span>
            <span>⏱ 3~15초 자동 판정</span>
            <span>🎲 주사위 대결</span>
          </div>
        </div>
      </section>

      <div className="home-tabs">
        <button
          type="button"
          className={tab === "teacher" ? "is-on" : ""}
          onClick={() => setTab("teacher")}
        >
          선생님
        </button>
        <button
          type="button"
          className={tab === "student" ? "is-on" : ""}
          onClick={() => setTab("student")}
        >
          학생
        </button>
      </div>

      {tab === "teacher" ? (
        <section className="home-panel">
          <label className="field">
            <span className="field-label">선생님 이름</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="예: 문수쌤"
              maxLength={12}
            />
          </label>
          <label className="field">
            <span className="field-label">모둠 수 {roomCount}개</span>
            <input
              type="range"
              min={1}
              max={7}
              value={roomCount}
              onChange={(event) => setRoomCount(Number(event.target.value))}
            />
            <p className="field-hint">최대 7모둠까지 동시에 열 수 있어요.</p>
          </label>
          <button
            type="button"
            className="primary big"
            disabled={!canHost || connecting}
            onClick={() => onConnect({ room: "NEW", name: name.trim(), role: "teacher", roomCount })}
          >
            {connecting ? "여는 중…" : "모둠 방 만들기"}
          </button>
          <p className="field-hint">
            방을 만들면 모둠마다 QR이 나와요. 인쇄해서 책상에 두거나 화면에 띄워 주세요.
          </p>
        </section>
      ) : (
        <section className="home-panel">
          <div className="field">
            <span className="field-label">어떻게 참여하나요?</span>
            <div className="chip-row">
              <button
                type="button"
                className={`chip ${shared ? "" : "is-on"}`}
                onClick={() => setShared(false)}
              >
                한 사람이 한 기기
              </button>
              <button
                type="button"
                className={`chip ${shared ? "is-on" : ""}`}
                onClick={() => setShared(true)}
              >
                한 기기를 같이 써요
              </button>
            </div>
            <p className="field-hint">
              {shared
                ? "태블릿 한 대를 모둠이 돌려 가며 써요. 자기 차례가 되면 기기를 넘겨받으면 돼요."
                : "각자 자기 기기로 들어와요."}
            </p>
          </div>

          {shared ? (
            <div className="field">
              <span className="field-label">이 기기로 함께하는 친구 {mateCount}명</span>
              <div className="chip-row">
                {[2, 3, 4].map((count) => (
                  <button
                    key={count}
                    type="button"
                    className={`chip ${mateCount === count ? "is-on" : ""}`}
                    onClick={() => setMateCount(count)}
                  >
                    {count}명
                  </button>
                ))}
              </div>
              <div className="mate-inputs">
                {Array.from({ length: mateCount }, (_, index) => (
                  <input
                    key={index}
                    value={mateNames[index]}
                    onChange={(event) => {
                      const next = [...mateNames];
                      next[index] = event.target.value;
                      setMateNames(next);
                    }}
                    placeholder={`${index + 1}번 친구 이름`}
                    maxLength={12}
                  />
                ))}
              </div>
              {!matesUnique && matesFilled && (
                <p className="field-hint warn">같은 이름을 두 번 적었어요.</p>
              )}
              <p className="field-hint">차례는 적은 순서대로 돌아가요.</p>
            </div>
          ) : (
            <label className="field">
              <span className="field-label">내 이름</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="예: 가람"
                maxLength={12}
              />
            </label>
          )}

          <label className="field">
            <span className="field-label">방 코드</span>
            <input
              value={room}
              onChange={(event) => setRoom(event.target.value.toUpperCase())}
              placeholder="예: S4K2"
              maxLength={12}
              autoCapitalize="characters"
            />
            {urlRoom && <p className="field-hint">QR로 들어와서 방 코드가 채워졌어요.</p>}
          </label>
          <button
            type="button"
            className="primary big"
            disabled={!canJoin || connecting}
            onClick={joinAsStudent}
          >
            {connecting ? "들어가는 중…" : "방 들어가기"}
          </button>
        </section>
      )}
    </div>
  );
}
