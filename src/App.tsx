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

type Mode = "home" | "student" | "teacher";
type Target = {
  room: string;
  name: string;
  role: "student" | "teacher";
  roomCount?: number;
  /** 모둠 1기기 모드에서 이 기기로 함께 들어오는 사람들. */
  names?: string[];
};

const MAX_RETRY_DELAY_MS = 8_000;

/** QR로 들어오면 주소에 방 코드가 붙어 있다. */
function roomFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return (params.get("room") || "").trim().toUpperCase();
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
        setMode("student");
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
          if (message.room && message.room !== "NEW" && targetRef.current)
            targetRef.current = { ...targetRef.current, room: message.room };
          if (message.hub && targetRef.current)
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

  return (
    <Shell error={error}>
      <Home onConnect={connect} connecting={connecting} />
    </Shell>
  );
}

function Shell({ children, error }: { children: React.ReactNode; error: string }) {
  return (
    <div className="shell">
      <header className="brand-bar">
        <span className="brand-logo">💣 폭탄카드</span>
        <div className="brand-right">
          <MadeBy />
          <BrandLinks />
        </div>
      </header>
      {error && <p className="error-bar">{error}</p>}
      <main className="shell-main">{children}</main>
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
        <h1>💣 폭탄카드</h1>
        <p>
          주사위를 굴려 나온 숫자만큼 <strong>연속으로 정답 카드</strong>를 골라야 해요.
          <br />
          폭탄을 밟으면 그 차례는 끝!
        </p>
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
