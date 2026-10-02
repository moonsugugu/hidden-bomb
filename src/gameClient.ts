import type { GameState, HubState, ServerMessage } from "./types";

export const GAME_NAME = "hidden-bomb";

const savedPlayerKey = "hidden-bomb-player-id";
const savedTeacherKey = "hidden-bomb-teacher-id";

function scopedKey(base: string, room?: string) {
  const normalized = room?.trim().toUpperCase();
  return normalized ? `${base}:${normalized}` : base;
}

export function gameWebSocketBase() {
  if (import.meta.env.VITE_GAME_WS_URL) return import.meta.env.VITE_GAME_WS_URL;
  const { hostname, protocol, host } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1")
    return "ws://127.0.0.1:3203/v1/game";
  // 운영에서는 Cloudflare Tunnel이 같은 도메인의 /v1/game을 게임 서버로 넘겨준다.
  return `${protocol === "https:" ? "wss" : "ws"}://${host}/v1/game`;
}

export function savedPlayerId(room?: string) {
  return (
    window.localStorage.getItem(scopedKey(savedPlayerKey, room)) ||
    window.localStorage.getItem(savedPlayerKey) ||
    ""
  );
}

export function savePlayerId(id: string, room?: string) {
  if (!id) return;
  window.localStorage.setItem(savedPlayerKey, id);
  if (room && room !== "NEW") window.localStorage.setItem(scopedKey(savedPlayerKey, room), id);
}

export function savedTeacherId(room?: string) {
  return (
    window.localStorage.getItem(scopedKey(savedTeacherKey, room)) ||
    window.localStorage.getItem(savedTeacherKey) ||
    ""
  );
}

export function saveTeacherId(id: string, room?: string) {
  if (!id) return;
  window.localStorage.setItem(savedTeacherKey, id);
  if (room && room !== "NEW") window.localStorage.setItem(scopedKey(savedTeacherKey, room), id);
}

/** 새로고침이나 절전에서 돌아왔을 때 같은 사람으로 다시 붙기 위해 마지막 방을 기억한다. */
export function rememberSession(kind: "student" | "teacher", room: string, name: string) {
  window.localStorage.setItem("hidden-bomb-last", JSON.stringify({ kind, room, name }));
}

export function lastSession(): { kind: "student" | "teacher"; room: string; name: string } | null {
  try {
    const raw = window.localStorage.getItem("hidden-bomb-last");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearSession() {
  window.localStorage.removeItem("hidden-bomb-last");
}

export function openGameSocket(
  room: string,
  name: string,
  options: { role?: "teacher"; names?: string[]; hubCode?: string; spectator?: boolean } = {},
) {
  const url = new URL(gameWebSocketBase());
  url.searchParams.set('delta','1');
  url.searchParams.set("room", room || "NEW");
  url.searchParams.set("game", GAME_NAME);
  if (name) url.searchParams.set("name", name);
  // 모둠 1기기 모드: 한 태블릿으로 들어오는 사람들의 이름을 함께 보낸다.
  if (options.names && options.names.length > 1)
    url.searchParams.set("names", options.names.join(","));
  if (options.role === "teacher") {
    url.searchParams.set("role", "teacher");
    if (options.hubCode) url.searchParams.set("hub", options.hubCode);
    if (options.spectator) url.searchParams.set("watch", "1");
    const teacherId = savedTeacherId(room);
    if (teacherId) url.searchParams.set("teacherId", teacherId);
  } else {
    const playerId = savedPlayerId(room);
    if (playerId) url.searchParams.set("playerId", playerId);
  }
  return new WebSocket(url);
}

export function sendJson(socket: WebSocket | null, message: Record<string, unknown>) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

export function isGameState(message: ServerMessage): message is GameState {
  return message.type === "state";
}

export function isHubState(message: ServerMessage): message is HubState {
  return message.type === "hub_state";
}

/** 학생이 QR로 들어올 때 쓰는 주소. */
export function joinUrl(roomCode: string) {
  return `${window.location.origin}/?room=${roomCode}`;
}

/** 선생님 대시보드에서 특정 모둠을 새 탭으로 관전할 때 쓰는 주소. */
export function spectateUrl(roomCode: string, hubCode: string) {
  const url = new URL(window.location.origin);
  url.searchParams.set("room", roomCode);
  url.searchParams.set("hub", hubCode);
  url.searchParams.set("watch", "1");
  return url.toString();
}
