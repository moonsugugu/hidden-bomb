import http from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import {
  BombRoom,
  TeacherHub,
  MAX_HUB_ROOMS,
  MAX_PLAYERS,
  normalizeConfig,
  normalizeName,
  normalizeRoomCode,
} from "./bomb-game.mjs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 3203);
const GAME_NAME = "hidden-bomb";
const SOCKET_HEARTBEAT_MS = 5_000;
// 엑셀로 올린 문제 세트가 한 번에 들어오므로 여유 있게 잡는다.
// 의심의밤은 단어 두 개만 오갔지만 여기서는 문장 200개가 올라올 수 있다.
const MAX_PAYLOAD_BYTES = 262_144;
const ROOM_TTL_MS = 60_000;

const rooms = new Map();
const hubs = new Map();
const socketsByRoom = new Map();
const spectatorsByRoom = new Map();
const socketsByHub = new Map();

function send(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

function errorAndClose(socket, message) {
  send(socket, { type: "error", message });
  setTimeout(() => socket.close(1008, message), 30);
}

function newCode(prefix = "") {
  let code;
  do
    code = `${prefix}${Math.random()
      .toString(36)
      .slice(2, prefix ? 6 : 7)
      .toUpperCase()}`;
  while (rooms.has(code) || hubs.has(code));
  return code;
}

function roomSockets(code) {
  if (!socketsByRoom.has(code)) socketsByRoom.set(code, new Map());
  return socketsByRoom.get(code);
}

function spectatorSockets(code) {
  if (!spectatorsByRoom.has(code)) spectatorsByRoom.set(code, new Map());
  return spectatorsByRoom.get(code);
}

function hubSockets(code) {
  if (!socketsByHub.has(code)) socketsByHub.set(code, new Map());
  return socketsByHub.get(code);
}

function broadcastRoom(room) {
  if (!room) return;
  const sockets = socketsByRoom.get(room.code);
  if (sockets) for (const [playerId, socket] of sockets) send(socket, room.snapshotFor(playerId));
  const spectators = spectatorsByRoom.get(room.code);
  if (spectators)
    for (const socket of spectators.values()) send(socket, room.snapshotFor(null, { spectator: true }));
  if (room.hubCode) broadcastHub(hubs.get(room.hubCode));
}

function broadcastHub(hub) {
  if (!hub) return;
  const sockets = socketsByHub.get(hub.code);
  if (sockets) for (const socket of sockets.values()) send(socket, hub.snapshot());
}

function bindRoomSocket(socket, room, playerId) {
  const sockets = roomSockets(room.code);
  const previous = sockets.get(playerId);
  if (previous && previous !== socket) {
    previous.replaced = true;
    previous.close(1000, "reconnected");
  }
  sockets.set(playerId, socket);
  socket.roomCode = room.code;
  socket.playerId = playerId;
}

function bindHubSocket(socket, hub) {
  const sockets = hubSockets(hub.code);
  const previous = sockets.get(hub.teacherId);
  if (previous && previous !== socket) {
    previous.replaced = true;
    previous.close(1000, "reconnected");
  }
  sockets.set(hub.teacherId, socket);
  socket.hubCode = hub.code;
  socket.teacherId = hub.teacherId;
}

function bindSpectatorSocket(socket, room) {
  const key = randomUUID();
  spectatorSockets(room.code).set(key, socket);
  socket.roomCode = room.code;
  socket.spectatorKey = key;
  socket.spectator = true;
}

function detachSocket(socket) {
  if (socket.spectator) {
    const spectators = spectatorsByRoom.get(socket.roomCode);
    if (spectators?.get(socket.spectatorKey) === socket) spectators.delete(socket.spectatorKey);
    if (spectators && spectators.size === 0) spectatorsByRoom.delete(socket.roomCode);
    return;
  }

  const room = rooms.get(socket.roomCode);
  const roomMap = socketsByRoom.get(socket.roomCode);
  if (roomMap?.get(socket.playerId) === socket) roomMap.delete(socket.playerId);
  if (roomMap && roomMap.size === 0) socketsByRoom.delete(socket.roomCode);
  if (room && !socket.replaced) {
    room.setConnected(socket.playerId, false);
    broadcastRoom(room);
  }

  const hub = hubs.get(socket.hubCode);
  const hubMap = socketsByHub.get(socket.hubCode);
  if (hubMap?.get(socket.teacherId) === socket) hubMap.delete(socket.teacherId);
  if (hubMap && hubMap.size === 0) socketsByHub.delete(socket.hubCode);
  if (hub && !socket.replaced) hub.emptySince = Date.now();
}

/* ── 방 만들기 ────────────────────────────────────────── */

function handleCreateRoom(socket, message) {
  if (socket.roomCode || socket.hubCode) return errorAndClose(socket, "이미 방에 들어가 있어요.");
  const name = normalizeName(message.name || socket.requestedName);
  if (!name) return send(socket, { type: "error", message: "방장이 될 이름을 입력해 주세요." });
  const code = newCode();
  const hostId = socket.requestedPlayerId || randomUUID();
  const room = new BombRoom(code, normalizeConfig(message.config));
  const joined = room.addPlayer({ id: hostId, name, isHost: true });
  if (!joined.ok) return send(socket, { type: "error", message: joined.error });
  rooms.set(code, room);
  bindRoomSocket(socket, room, hostId);
  send(socket, { type: "room_created", room: code, playerId: hostId });
  send(socket, { type: "connected", room: code, playerId: hostId, game: GAME_NAME });
  broadcastRoom(room);
}

function handleCreateHub(socket, message) {
  if (socket.roomCode || socket.hubCode) return errorAndClose(socket, "이미 방에 들어가 있어요.");
  const teacherName = normalizeName(message.teacherName || socket.requestedName) || "담임 선생님";
  const teacherId = socket.requestedTeacherId || randomUUID();
  const hub = new TeacherHub(newCode("T"), teacherId, teacherName, message.roomCount);
  hubs.set(hub.code, hub);
  for (const room of hub.rooms.values()) rooms.set(room.code, room);
  bindHubSocket(socket, hub);
  send(socket, { type: "hub_created", hub: hub.code, teacherId: hub.teacherId });
  send(socket, {
    type: "connected",
    hub: hub.code,
    teacherId: hub.teacherId,
    game: GAME_NAME,
    role: "teacher",
  });
  broadcastHub(hub);
}

/* ── 선생님 명령 ──────────────────────────────────────── */

function handleTeacherInput(socket, message) {
  const hub = hubs.get(socket.hubCode);
  if (!hub || socket.teacherId !== hub.teacherId)
    return send(socket, { type: "error", message: "통합방을 찾을 수 없어요." });

  switch (message.type) {
    case "create_child_room": {
      const result = hub.createChildRoom(message.config, message.label);
      if (!result.ok) return send(socket, { type: "error", message: result.error });
      rooms.set(result.room.code, result.room);
      return broadcastHub(hub);
    }
    case "remove_child_room": {
      const result = hub.removeChildRoom(message.roomCode);
      if (!result.ok) return send(socket, { type: "error", message: result.error });
      rooms.delete(result.code);
      socketsByRoom.delete(result.code);
      spectatorsByRoom.delete(result.code);
      return broadcastHub(hub);
    }
    case "apply_all": {
      const result = hub.applyToAll(message.config);
      if (!result.ok) send(socket, { type: "error", message: result.error });
      for (const room of hub.rooms.values()) broadcastRoom(room);
      return broadcastHub(hub);
    }
    case "start_all": {
      const result = hub.startAll();
      if (result.failures.length)
        send(socket, { type: "notice", message: result.failures.join(" / ") });
      for (const room of hub.rooms.values()) broadcastRoom(room);
      return broadcastHub(hub);
    }
    case "teacher_action": {
      const room = hub.getRoom(message.roomCode);
      if (!room) return send(socket, { type: "error", message: "모둠 방을 찾을 수 없어요." });
      const payload = { type: message.action };
      if (message.config) payload.config = message.config;
      if (message.items) payload.items = message.items;
      if (message.index !== undefined) payload.index = message.index;
      const result = room.handle(hub.teacherId, payload);
      if (!result.ok) return send(socket, { type: "error", message: result.error });
      return broadcastRoom(room);
    }
    default:
      return send(socket, { type: "error", message: "알 수 없는 선생님 명령이에요." });
  }
}

function handleStudentInput(socket, message) {
  const room = rooms.get(socket.roomCode);
  if (!room) return send(socket, { type: "error", message: "방이 존재하지 않아요." });
  const result = room.handle(socket.playerId, message);
  if (!result.ok) return send(socket, { type: "error", message: result.error });
  broadcastRoom(room);
}

/* ── 재접속 ───────────────────────────────────────────── */

function attachExistingHub(socket) {
  const hub = hubs.get(normalizeRoomCode(socket.requestedRoom));
  if (!hub) return errorAndClose(socket, "통합방을 찾을 수 없어요. 코드를 확인해 주세요.");
  if (socket.requestedTeacherId !== hub.teacherId)
    return errorAndClose(socket, "담임 선생님 인증 정보가 맞지 않아요.");
  bindHubSocket(socket, hub);
  hub.emptySince = null;
  send(socket, {
    type: "connected",
    hub: hub.code,
    teacherId: hub.teacherId,
    game: GAME_NAME,
    role: "teacher",
  });
  broadcastHub(hub);
}

function attachExistingRoomSpectator(socket) {
  const room = rooms.get(normalizeRoomCode(socket.requestedRoom));
  const hub = hubs.get(normalizeRoomCode(socket.requestedHub));
  if (!room || !hub || room.hubCode !== hub.code)
    return errorAndClose(socket, "관전할 모둠 방을 찾을 수 없어요. 방 코드를 확인해 주세요.");
  if (socket.requestedTeacherId !== hub.teacherId)
    return errorAndClose(socket, "선생님 관전 인증 정보가 맞지 않아요.");

  bindSpectatorSocket(socket, room);
  send(socket, {
    type: "connected",
    room: room.code,
    hub: hub.code,
    teacherId: hub.teacherId,
    game: GAME_NAME,
    role: "spectator",
  });
  send(socket, room.snapshotFor(null, { spectator: true }));
}

function attachExistingRoom(socket) {
  const room = rooms.get(normalizeRoomCode(socket.requestedRoom));
  if (!room) return errorAndClose(socket, "방을 찾을 수 없어요. 방 코드를 확인해 주세요.");
  const requestedPlayerId = socket.requestedPlayerId;
  let joined;
  if (requestedPlayerId && room.getPlayer(requestedPlayerId)) {
    joined = room.reconnectPlayer(requestedPlayerId, socket.requestedName);
  } else if (socket.requestedNames.length > 1) {
    // 한 기기가 여러 명을 맡는다. 대표 참가자에 소켓을 묶고 나머지는 같은 주인을 공유한다.
    const result = room.addPlayers(socket.requestedNames);
    joined = result.ok ? { ok: true, player: result.primary } : result;
  } else {
    joined = room.addPlayer({ name: socket.requestedNames[0] || socket.requestedName });
  }
  if (!joined.ok) return errorAndClose(socket, joined.error);
  bindRoomSocket(socket, room, joined.player.id);
  send(socket, { type: "connected", room: room.code, playerId: joined.player.id, game: GAME_NAME });
  broadcastRoom(room);
}

/* ── 서버 ─────────────────────────────────────────────── */

const httpServer = http.createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(
      JSON.stringify({
        ok: true,
        game: GAME_NAME,
        rooms: rooms.size,
        hubs: hubs.size,
        maxHubRooms: MAX_HUB_ROOMS,
        maxPlayers: MAX_PLAYERS,
        uptime: Math.round(process.uptime()),
      }),
    );
    return;
  }
  response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ error: "not found" }));
});

const websocketServer = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });

httpServer.on("upgrade", (request, socket, head) => {
  let url;
  try {
    url = new URL(request.url, `http://${HOST}:${PORT}`);
  } catch {
    socket.destroy();
    return;
  }
  if (url.pathname !== "/v1/game" || url.searchParams.get("game") !== GAME_NAME) {
    socket.destroy();
    return;
  }
  websocketServer.handleUpgrade(request, socket, head, (client) =>
    websocketServer.emit("connection", client, request, url),
  );
});

websocketServer.on("connection", (socket, _request, url) => {
  socket.isAlive = true;
  socket.on("pong", () => {
    socket.isAlive = true;
  });
  socket.requestedRoom = url.searchParams.get("room") || "NEW";
  socket.requestedName = normalizeName(url.searchParams.get("name"));
  // 모둠 1기기 모드: 한 태블릿으로 여러 명이 들어올 때 이름을 쉼표로 넘긴다.
  socket.requestedNames = (url.searchParams.get("names") || "")
    .split(",")
    .map((name) => normalizeName(name))
    .filter(Boolean)
    .slice(0, MAX_PLAYERS);
  socket.requestedPlayerId = url.searchParams.get("playerId") || "";
  socket.requestedTeacherId = url.searchParams.get("teacherId") || "";
  socket.requestedHub = url.searchParams.get("hub") || "";
  socket.requestedWatch = url.searchParams.get("watch") === "1";
  socket.requestedRole = url.searchParams.get("role") || "student";

  send(socket, {
    type: "connected",
    room: socket.requestedRoom === "NEW" ? null : normalizeRoomCode(socket.requestedRoom),
    game: GAME_NAME,
    canCreate: true,
  });

  if (socket.requestedRoom !== "NEW") {
    if (socket.requestedRole === "teacher" && socket.requestedWatch)
      attachExistingRoomSpectator(socket);
    else if (socket.requestedRole === "teacher") attachExistingHub(socket);
    else attachExistingRoom(socket);
  }

  socket.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return send(socket, { type: "error", message: "메시지 형식이 올바르지 않아요." });
    }
    if (!socket.roomCode && !socket.hubCode && message.type === "create_room")
      return handleCreateRoom(socket, message);
    if (!socket.roomCode && !socket.hubCode && message.type === "create_hub")
      return handleCreateHub(socket, message);
    if (socket.spectator)
      return send(socket, { type: "error", message: "관전 중에는 게임을 조작할 수 없어요." });
    if (socket.hubCode) return handleTeacherInput(socket, message);
    if (socket.roomCode) return handleStudentInput(socket, message);
    send(socket, { type: "error", message: "먼저 방을 만들거나 통합방을 만들어 주세요." });
  });

  socket.on("close", () => detachSocket(socket));
});

// 공개 시간·턴 제한 시간이 지난 방을 진행시킨다.
setInterval(() => {
  for (const room of rooms.values()) if (room.tick()) broadcastRoom(room);
}, 250).unref();

// 절전이나 네트워크 단절로 죽은 소켓을 정리한다.
setInterval(() => {
  for (const socket of websocketServer.clients) {
    if (socket.isAlive === false) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}, SOCKET_HEARTBEAT_MS).unref();

// 아무도 없는 방을 치운다. 통합방이 사라지면 딸린 모둠 방도 함께 지운다.
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.emptySince && !room.hubCode && now - room.emptySince > ROOM_TTL_MS) {
      rooms.delete(code);
      socketsByRoom.delete(code);
    }
  }
  for (const [code, hub] of hubs) {
    if (hub.emptySince && now - hub.emptySince > ROOM_TTL_MS) {
      hubs.delete(code);
      socketsByHub.delete(code);
      for (const [roomCode, room] of rooms)
        if (room.hubCode === code) {
          rooms.delete(roomCode);
          spectatorsByRoom.delete(roomCode);
        }
    }
  }
}, 30_000).unref();

httpServer.listen(PORT, HOST, () => {
  console.log(`[${GAME_NAME}] ws://${HOST}:${PORT}/v1/game?game=${GAME_NAME}`);
  console.log(`[${GAME_NAME}] 모둠 ${MAX_PLAYERS}명까지 · 통합방 ${MAX_HUB_ROOMS}개 모둠 방까지`);
});
